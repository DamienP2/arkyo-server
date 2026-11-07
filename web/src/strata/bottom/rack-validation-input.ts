/**
 * Entrée de `validateRack()` (`lib/services/rack-validation.ts`) composée à
 * partir des données d'un contenant de l'onglet Rack : `canvas-data`, slots à
 * jour et câbles du contenant (onglet Contrôles du dock bas Strata).
 *
 * Même composition que le synoptique d'arkyo
 * (`components/synoptique/hooks/use-validation-report.ts`) :
 *   - un slot par équipement, ports à plat (`quantity ?? 1` par entrée, lecture
 *     `rackConnectors` partagée avec la face), type et famille du connecteur ;
 *   - un panel est développé en rangées virtuelles d'1 U (`<slot>__row<n>`,
 *     `expandPanelSlots`), seules les rangées équipées comptent, deux ports
 *     (arrière, avant) par emplacement ; les extrémités de câble passent en
 *     coordonnées de rangée (`realToVirtual`) ;
 *   - une extrémité sur un adaptateur devient `__a__:<adaptateur>:<côté>` ;
 *   - famille d'un signal = sa fonction (`functionId`), signaux IP = `isIp`.
 *
 * Écarts, faute de données dans l'onglet Rack : pas de zones ni de positions
 * (contrôles de zones propres au synoptique), adaptateurs seulement s'ils
 * sont fournis, et l'index d'un port de composant (châssis modulaire), qui
 * désigne la connectique de la carte, n'est pas contrôlé.
 */

import type { RackCanvasData } from "@/app/(fullscreen)/project/[id]/rack/rack-tab-client";
import type { Slot } from "@/components/synoptique/lib/types";
import type { ValidationInput } from "@/lib/services/rack-validation";
import { portCount } from "../drawings/face-layout";
import { flattenSlots, rackConnectors, type RackConnectionRow } from "./rack-model";

const ADAPTER_PREFIX = "__a__:";
const ROW = "__row";

const rowId = (slotId: string, rowIdx: number) => `${slotId}${ROW}${rowIdx}`;

type InputSlot = ValidationInput["slots"][number];
type InputPort = InputSlot["ports"][number];

export type ValidationExtras = {
  /** Slots à jour (sinon ceux de `canvas-data`). */
  slots?: readonly Slot[];
  connections?: readonly RackConnectionRow[] | null;
  adapters?: ReadonlyArray<{ id: string; name?: string | null; attachedSlotId?: string | null }>;
};

export function toValidationInput(canvasData: RackCanvasData, extras: ValidationExtras = {}): ValidationInput {
  const slots = flattenSlots(extras.slots ?? canvasData.rack.slots);
  const connections = extras.connections ?? [];
  const typeById = new Map(canvasData.connectorTypes.map((t) => [t.id, t]));

  const signalFamilyByName = new Map<string, string | null>();
  const ipSignalNames = new Set<string>();
  for (const s of canvasData.signals) {
    const sig = s as { name: string; functionId?: string | null; category?: string | null; isIp?: boolean | null };
    signalFamilyByName.set(sig.name, sig.functionId ?? sig.category ?? null);
    if (sig.isIp) ipSignalNames.add(sig.name);
  }

  const typeName = (id: string | null | undefined) => (id ? (typeById.get(id)?.name ?? null) : null);
  const typeFamily = (id: string | null | undefined) => {
    const t = id ? (typeById.get(id) as { functionId?: string | null; category?: string | null } | undefined) : undefined;
    return t?.category ?? t?.functionId ?? null;
  };

  const inputSlots: InputSlot[] = [];
  for (const s of slots) {
    const prefix = s.label?.trim() || null;
    if (s.panel) {
      const panel = s.panel;
      const perU = Math.max(1, panel.slotsPerU ?? 1);
      const panelName = prefix ? `${prefix} - ${panel.name}` : panel.name;
      for (let r = 0; r < Math.max(1, panel.heightU); r++) {
        const row = panel.slots
          .filter((ps) => Math.floor((ps.position - 1) / perU) === r)
          .sort((a, b) => a.position - b.position);
        if (!row.some((ps) => ps.connectorTypeId != null)) continue;
        const ports: InputPort[] = [];
        for (let i = 0; i < Math.max(1, perU * 2); i++) {
          const ps = row[Math.floor(i / 2)];
          ports.push({
            index: i,
            signalName: null,
            direction: null,
            connectorTypeName: ps?.connectorType?.name ?? typeName(ps?.connectorTypeId),
            connectorCategory: ps?.connectorType?.category ?? null,
          });
        }
        inputSlots.push({
          id: rowId(s.id, r),
          label: panelName,
          equipmentId: null,
          panelId: panel.id,
          panelName,
          parentSlotId: s.id,
          ports,
        });
      }
      continue;
    }
    const ports: InputPort[] = [];
    let flat = 0;
    // Même lecture de la connectique que la face et les index de câble.
    for (const c of rackConnectors(s.equipment?.connectors)) {
      for (let i = 0; i < portCount(c); i++) {
        ports.push({
          index: flat++,
          signalName: c.signalName || null,
          direction: c.direction ?? null,
          connectorTypeName: typeName(c.connectorTypeId),
          connectorCategory: typeFamily(c.connectorTypeId),
        });
      }
    }
    const base = s.equipment?.name ?? null;
    inputSlots.push({
      id: s.id,
      label: base ? (prefix ? `${prefix} - ${base}` : base) : prefix,
      equipmentId: s.equipment?.id ?? s.equipmentId ?? null,
      panelId: null,
      panelName: null,
      parentSlotId: s.id,
      ports,
    });
  }

  const slotById = new Map(slots.map((s) => [s.id, s]));
  /** Extrémité en coordonnées de validation (rangée de panel, adaptateur). */
  const endpoint = (
    slotId: string | null,
    index: number | null,
    adapterId: string | null | undefined,
    adapterSide: string | null | undefined,
    componentItemId: string | null | undefined,
  ): { slotId: string; index: number | null } => {
    if (adapterId) return { slotId: `${ADAPTER_PREFIX}${adapterId}:${adapterSide ?? "left"}`, index: null };
    if (!slotId) return { slotId: "", index: null };
    if (componentItemId) return { slotId, index: null };
    const panel = slotById.get(slotId)?.panel;
    if (!panel || index == null) return { slotId, index };
    if (panel.heightU <= 1) return { slotId: rowId(slotId, 0), index };
    const perRow = Math.max(1, panel.slotsPerU) * 2;
    return { slotId: rowId(slotId, Math.floor(index / perRow)), index: index % perRow };
  };

  const adapterUse = new Map<string, number>();
  for (const c of connections) {
    for (const id of [c.fromAdapterId, c.toAdapterId]) if (id) adapterUse.set(id, (adapterUse.get(id) ?? 0) + 1);
  }

  return {
    slots: inputSlots,
    connections: connections.map((c) => {
      const f = endpoint(c.fromSlotId, c.fromConnectorIndex, c.fromAdapterId, c.fromAdapterSide, c.fromComponentItemId);
      const t = endpoint(c.toSlotId, c.toConnectorIndex, c.toAdapterId, c.toAdapterSide, c.toComponentItemId);
      return {
        id: c.id,
        label: c.label ?? null,
        fromSlotId: f.slotId,
        fromConnectorIndex: f.index,
        toSlotId: t.slotId,
        toConnectorIndex: t.index,
      };
    }),
    adapters: (extras.adapters ?? []).map((a) => ({
      id: a.id,
      name: a.name ?? null,
      attachedSlotId: a.attachedSlotId ?? null,
      connectionCount: adapterUse.get(a.id) ?? 0,
    })),
    zones: [],
    signalFamilyByName,
    ipSignalNames,
  };
}

/** Slot réel d'un id de validation (rangée de panel `<slot>__row<n>` → `<slot>`). */
export function realSlotId(id: string): string {
  const i = id.indexOf(ROW);
  return i >= 0 ? id.slice(0, i) : id;
}
