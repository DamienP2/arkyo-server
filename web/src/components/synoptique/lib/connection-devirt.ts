/**
 * Virtualisation / dévirtualisation des connexions.
 *
 * Les connexions en DB stockent fromSlotId/toSlotId OU fromAdapterId/toAdapterId.
 * Côté client, tout est unifié en slotId (réel, panel virtuel row, ou adapter virtuel).
 * Ce module gère les conversions dans les 2 sens.
 */

import type {
  RackSlotWithEquipment,
  RackConnection,
  SlotComponent,
} from "@/components/synoptique/types/synoptic";
import {
  isPanelVirtualId,
  virtualToReal,
  expandedPortCount,
} from "@/components/synoptique/types/synoptic";

// ── Adapter virtual slot IDs ────────────────────────────────────────────────

export const ADAPTER_SLOTID_PREFIX = "__a__:";

export function adapterVirtualSlotId(adapterId: string, side: "left" | "right"): string {
  return `${ADAPTER_SLOTID_PREFIX}${adapterId}:${side}`;
}

export function parseAdapterSlotId(
  slotId: string | null | undefined,
): { adapterId: string; side: "left" | "right" } | null {
  if (!slotId || !slotId.startsWith(ADAPTER_SLOTID_PREFIX)) return null;
  const rest = slotId.slice(ADAPTER_SLOTID_PREFIX.length);
  const i = rest.lastIndexOf(":");
  if (i < 0) return null;
  const side = rest.slice(i + 1);
  if (side !== "left" && side !== "right") return null;
  return { adapterId: rest.slice(0, i), side };
}

// ── Component ports (châssis modulaires type openGear) ──────────────────────
//
// Les ports d'un composant sont rendus sur le nœud de l'équipement HÔTE, à la
// suite des ports de l'hôte, dans l'ordre `slotIndex` croissant. En DB, une
// connexion vers un port de composant stocke le slot HÔTE + `fromComponentItemId`
// + `fromConnectorIndex` RELATIF aux connectors du composant. Côté client, tout
// est aplati en un index GLOBAL unique sur le slot hôte.
//
// Ce module est LE seul point de vérité de l'offset : rendu, virtualisation et
// dévirtualisation l'utilisent tous — aucun calcul dupliqué.

type SlotForPorts = {
  panel?: { slots: { connectorTypeId: string | null }[] } | null;
  equipment?: { connectors?: unknown } | null;
  components?: SlotComponent[] | null;
};

/**
 * Nombre de ports (éclatés par quantité) de l'HÔTE d'un slot — panel ou
 * équipement. Doit rester strictement aligné sur la construction des ports
 * dans `synoptic-view.tsx` (slotPorts) :
 *   - panel : 2 ports (avant/arrière) par connecteur placé,
 *   - équipement : somme des quantités des `ConnectorEntry`.
 */
export function hostPortCount(slot: SlotForPorts): number {
  if (slot.panel) {
    return slot.panel.slots.filter((ps) => ps.connectorTypeId != null).length * 2;
  }
  return expandedPortCount(slot.equipment?.connectors ?? null);
}

export type ComponentPortMap = {
  /** Nombre de ports de l'hôte (les ports composants commencent à cet index). */
  hostPortCount: number;
  /** Index global du port composant, ou null si le composant/relIndex est hors borne. */
  toGlobal: (componentItemId: string, relIndex: number) => number | null;
  /** Résout un index global : `null` = port hôte, sinon composant + index relatif. */
  fromGlobal: (globalIndex: number) => { componentItemId: string; relIndex: number } | null;
};

export function componentPortMap(slot: SlotForPorts): ComponentPortMap {
  const host = hostPortCount(slot);
  const comps = Array.isArray(slot.components) ? [...slot.components] : [];
  comps.sort((a, b) => a.slotIndex - b.slotIndex);
  const ranges: { itemId: string; start: number; count: number }[] = [];
  let cursor = host;
  for (const c of comps) {
    const count = expandedPortCount(c.equipment?.connectors ?? null);
    ranges.push({ itemId: c.itemId, start: cursor, count });
    cursor += count;
  }
  return {
    hostPortCount: host,
    toGlobal(componentItemId, relIndex) {
      const r = ranges.find((x) => x.itemId === componentItemId);
      if (!r) return null;
      if (relIndex < 0 || relIndex >= r.count) return null;
      return r.start + relIndex;
    },
    fromGlobal(globalIndex) {
      if (globalIndex < host) return null;
      for (const r of ranges) {
        if (globalIndex >= r.start && globalIndex < r.start + r.count) {
          return { componentItemId: r.itemId, relIndex: globalIndex - r.start };
        }
      }
      return null;
    },
  };
}

// ── DB → Client (virtualisation) ────────────────────────────────────────────

export type DbConnection = RackConnection & {
  fromAdapterId?: string | null;
  fromAdapterSide?: "left" | "right" | null;
  fromAdapterPortIndex?: number | null;
  toAdapterId?: string | null;
  toAdapterSide?: "left" | "right" | null;
  toAdapterPortIndex?: number | null;
  /** Non-null ⇒ le port from appartient à ce composant (connectorIndex relatif). */
  fromComponentItemId?: string | null;
  /** Non-null ⇒ le port to appartient à ce composant (connectorIndex relatif). */
  toComponentItemId?: string | null;
};

/**
 * DB → client. Les endpoints composants (`from/toComponentItemId` non-null)
 * sont aplatis en index GLOBAL sur le slot hôte via `componentPortMap`.
 * `slots` est requis pour résoudre l'offset ; en son absence (consommateurs sans
 * composants, ex. rig-editor), on retombe sur l'index brut (comportement inchangé).
 */
export function virtualizeConnection(
  c: DbConnection,
  slots?: RackSlotWithEquipment[],
): RackConnection {
  const resolveIndex = (
    slotId: string | null,
    componentItemId: string | null | undefined,
    relIndex: number,
  ): number => {
    if (!componentItemId || !slots) return relIndex;
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return relIndex;
    return componentPortMap(slot).toGlobal(componentItemId, relIndex) ?? relIndex;
  };

  const fromSlotId =
    c.fromSlotId ??
    (c.fromAdapterId && c.fromAdapterSide
      ? adapterVirtualSlotId(c.fromAdapterId, c.fromAdapterSide)
      : "");
  const fromConnectorIndex = c.fromAdapterId
    ? (c.fromAdapterPortIndex ?? 0)
    : resolveIndex(c.fromSlotId, c.fromComponentItemId, c.fromConnectorIndex ?? 0);
  const toSlotId =
    c.toSlotId ??
    (c.toAdapterId && c.toAdapterSide ? adapterVirtualSlotId(c.toAdapterId, c.toAdapterSide) : "");
  const toConnectorIndex = c.toAdapterId
    ? (c.toAdapterPortIndex ?? 0)
    : resolveIndex(c.toSlotId, c.toComponentItemId, c.toConnectorIndex ?? 0);
  return { ...c, fromSlotId, fromConnectorIndex, toSlotId, toConnectorIndex };
}

// ── Client → DB (dévirtualisation) ──────────────────────────────────────────

/**
 * Convertit un endpoint client (slotId unifié) en payload DB.
 *
 * Gère 4 cas :
 *   1. adapter virtual id → fromAdapterId/Side/PortIndex
 *   2. panel virtual row id → realSlotId + globalPortIndex
 *   3. port composant (index global ≥ hostPortCount) → slot hôte + componentItemId + index relatif
 *   4. slot réel → pass-through
 */
export function devirtualizeEndpoint(
  slotId: string,
  portIndex: number,
  prefix: "from" | "to",
  slotsForPanel?: RackSlotWithEquipment[],
): Record<string, string | number | null> {
  const ad = parseAdapterSlotId(slotId);
  if (ad) {
    return {
      [`${prefix}SlotId`]: null,
      [`${prefix}ConnectorIndex`]: null,
      [`${prefix}AdapterId`]: ad.adapterId,
      [`${prefix}AdapterSide`]: ad.side,
      [`${prefix}AdapterPortIndex`]: portIndex,
      [`${prefix}ComponentItemId`]: null,
    };
  }
  if (isPanelVirtualId(slotId) && slotsForPanel) {
    const real = virtualToReal(slotId, portIndex, slotsForPanel);
    return {
      [`${prefix}SlotId`]: real.slotId,
      [`${prefix}ConnectorIndex`]: real.portIndex,
      [`${prefix}AdapterId`]: null,
      [`${prefix}AdapterSide`]: null,
      [`${prefix}AdapterPortIndex`]: null,
      [`${prefix}ComponentItemId`]: null,
    };
  }
  // Slot réel : le port peut appartenir à un composant si son index global
  // dépasse le nombre de ports de l'hôte.
  if (slotsForPanel) {
    const slot = slotsForPanel.find((s) => s.id === slotId);
    if (slot) {
      const comp = componentPortMap(slot).fromGlobal(portIndex);
      if (comp) {
        return {
          [`${prefix}SlotId`]: slotId,
          [`${prefix}ConnectorIndex`]: comp.relIndex,
          [`${prefix}AdapterId`]: null,
          [`${prefix}AdapterSide`]: null,
          [`${prefix}AdapterPortIndex`]: null,
          [`${prefix}ComponentItemId`]: comp.componentItemId,
        };
      }
    }
  }
  return {
    [`${prefix}SlotId`]: slotId,
    [`${prefix}ConnectorIndex`]: portIndex,
    [`${prefix}AdapterId`]: null,
    [`${prefix}AdapterSide`]: null,
    [`${prefix}AdapterPortIndex`]: null,
    [`${prefix}ComponentItemId`]: null,
  };
}
