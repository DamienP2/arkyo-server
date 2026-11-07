"use client";

import { useEffect } from "react";
import { validateRack } from "@/lib/services/rack-validation";
import {
  realToVirtual,
  type RackSlotWithEquipment,
  type RackConnection,
  type ConnectorEntry,
  type ConnectorTypeInfo,
  type Zone,
} from "@/components/synoptique/types/synoptic";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import { parseAdapterSlotId } from "@/components/synoptique/lib/connection-devirt";
import type { SynopticAdapterInstance } from "@/components/synoptique/components/synoptic-adapter-node";

type ValidationDeps = {
  expandedSlots: RackSlotWithEquipment[];
  slots: RackSlotWithEquipment[];
  connections: RackConnection[];
  adapters: SynopticAdapterInstance[];
  zones: Zone[];
  positions: Map<string, { x: number; y: number }>;
  signals: Array<{ name: string; color: string; category?: string | null }>;
  connectorTypes: ConnectorTypeInfo[];
  /** Connexions externes — comptées comme câbles dans la validation. */
  externalPorts?: Array<{
    id: string;
    slotId: string;
    portIndex: number;
    label: string | null;
    /** Label câble venant de la ProjectConnection (vue GENERAL). */
    targetCableLabel?: string | null;
  }>;
  /**
   * Publie le rapport dans le store GLOBAL du shell. Défaut : `true`.
   *
   * `false` pour une instance muette (sur-modal d'export, hôte de génération) :
   * le store n'a qu'un rapport, et c'est celui de l'éditeur visible. Une
   * seconde vue qui le remplacerait ferait afficher au panneau Validation les
   * anomalies d'une AUTRE vue, sans que rien ne le signale — et il n'y
   * reviendrait qu'au prochain changement de ses propres dépendances.
   */
  publish?: boolean;
};

export function useValidationReport(deps: ValidationDeps) {
  const {
    expandedSlots,
    slots,
    connections,
    adapters,
    zones,
    positions,
    signals,
    connectorTypes,
    externalPorts,
    publish = true,
  } = deps;

  useEffect(() => {
    // Muette : on ne calcule même pas. La validation parcourt tous les slots,
    // tous les ports et toutes les connexions — la faire tourner pour jeter le
    // résultat coûterait sans rien apporter.
    if (!publish) return;
    const signalFamilyByName = new Map<string, string | null>();
    const ipSignalNames = new Set<string>();
    for (const s of signals) {
      const fam = (s as { category?: string | null }).category ?? null;
      signalFamilyByName.set(s.name, fam);
      if ((s as { isIp?: boolean }).isIp) ipSignalNames.add(s.name);
    }
    const ctById = new Map(connectorTypes.map((ct) => [ct.id, ct]));
    const slotInputs = expandedSlots.map((s) => {
      const ports: Array<{
        index: number;
        signalName: string | null;
        direction: string | null;
        connectorTypeName?: string | null;
        connectorCategory?: string | null;
      }> = [];
      if (s.panel) {
        const panelSlots = s.panel.slots ?? [];
        const slotsPerU = s.panel.slotsPerU ?? 1;
        const count = Math.max(1, slotsPerU * 2);
        for (let i = 0; i < count; i++) {
          const physicalIdx = Math.floor(i / 2);
          const ps = panelSlots[physicalIdx];
          const ctName = ps?.connectorType?.name ?? null;
          const ctCat = ps?.connectorType?.category ?? null;
          ports.push({
            index: i,
            signalName: null,
            direction: null,
            connectorTypeName: ctName,
            connectorCategory: ctCat,
          });
        }
      } else {
        const connectors = (s.equipment?.connectors ?? []) as ConnectorEntry[];
        let flat = 0;
        for (const c of Array.isArray(connectors) ? connectors : []) {
          const qty = c.quantity ?? 1;
          const ct = c.connectorTypeId ? ctById.get(c.connectorTypeId) : null;
          for (let i = 0; i < qty; i++) {
            ports.push({
              index: flat++,
              signalName: c.signalName ?? null,
              direction: c.direction ?? null,
              connectorTypeName: ct?.name ?? null,
              connectorCategory: ct?.category ?? null,
            });
          }
        }
      }
      const slotPrefix = s.label?.trim() ? s.label.trim() : null;
      const baseName = s.equipment?.name ?? s.panel?.name ?? null;
      const label = baseName ? (slotPrefix ? `${slotPrefix} - ${baseName}` : baseName) : slotPrefix;
      const panelId = s.panel?.id ?? null;
      const panelName = s.panel?.name
        ? slotPrefix
          ? `${slotPrefix} - ${s.panel.name}`
          : s.panel.name
        : null;
      const parentSlotId = s.id.includes("__row") ? s.id.split("__row")[0] : s.id;
      return {
        id: s.id,
        label,
        equipmentId: s.equipment?.id ?? null,
        panelId,
        panelName,
        parentSlotId,
        ports,
      };
    });

    const adapterConnCount = new Map<string, number>();
    for (const a of adapters) adapterConnCount.set(a.id, 0);
    for (const c of connections) {
      const fromAdp = parseAdapterSlotId(c.fromSlotId);
      const toAdp = parseAdapterSlotId(c.toSlotId);
      if (fromAdp && adapterConnCount.has(fromAdp.adapterId))
        adapterConnCount.set(fromAdp.adapterId, (adapterConnCount.get(fromAdp.adapterId) ?? 0) + 1);
      if (toAdp && adapterConnCount.has(toAdp.adapterId))
        adapterConnCount.set(toAdp.adapterId, (adapterConnCount.get(toAdp.adapterId) ?? 0) + 1);
    }

    const mapEndpoint = (slotId: string, portIndex: number | null) => {
      if (portIndex == null) return { slotId, portIndex };
      const real = slots.find((s) => s.id === slotId);
      if (!real?.panel) return { slotId, portIndex };
      const v = realToVirtual(slotId, portIndex, slots);
      return { slotId: v.slotId, portIndex: v.portIndex };
    };

    const report = validateRack({
      slots: slotInputs,
      connections: connections.map((c) => {
        const f = mapEndpoint(c.fromSlotId, c.fromConnectorIndex ?? null);
        const t = mapEndpoint(c.toSlotId, c.toConnectorIndex ?? null);
        return {
          id: c.id,
          label: c.label ?? null,
          fromSlotId: f.slotId,
          fromConnectorIndex: f.portIndex,
          toSlotId: t.slotId,
          toConnectorIndex: t.portIndex,
        };
      }),
      adapters: adapters.map((a) => ({
        id: a.id,
        name: (a as unknown as { adapter?: { name?: string } }).adapter?.name ?? null,
        attachedSlotId: a.attachedSlotId ?? null,
        connectionCount: adapterConnCount.get(a.id) ?? 0,
      })),
      zones: zones.map((z) => ({
        id: z.id,
        label: z.label ?? null,
        bounds: { x: z.x, y: z.y, w: z.w, h: z.h },
      })),
      externalPorts: externalPorts?.map((e) => ({
        id: e.id,
        slotId: e.slotId,
        portIndex: e.portIndex,
        label: e.label,
        targetCableLabel: e.targetCableLabel ?? null,
      })),
      slotPositions: positions,
      signalFamilyByName,
      ipSignalNames,
    });

    useTopbarActions.getState().setValidationReport(report);
    useTopbarActions
      .getState()
      .setValidationCounts(report.counts.error, report.counts.warning, report.counts.info);
  }, [
    expandedSlots,
    slots,
    connections,
    adapters,
    zones,
    signals,
    connectorTypes,
    positions,
    publish,
  ]);
}
