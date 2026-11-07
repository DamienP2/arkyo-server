/**
 * `useValidationReport` (arkyo:components/synoptique/hooks/use-validation-report.ts)
 * compose l'entrée de `validateRack` (arkyo:lib/services/rack-validation.ts, ses
 * cas sont couverts par `tests/unit/rack-validation.test.ts`, copié d'arkyo) à
 * partir de l'état du synoptique, puis publie le rapport dans le store du shell.
 *
 * Le scénario ci-dessous déclenche les 11 contrôles numérotés de `validateRack` :
 * 1 slot/port manquant, 2 label en doublon, 3 port sur-utilisé, 4 signal
 * incompatible, 5 câble sans label, 6 slot vide, 6a équipement non câblé,
 * 6b panel (inutilisé, partiel), 7 adaptateur orphelin, 8 zone sans nom,
 * 9 zone vide.
 */

import { afterEach, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { useValidationReport } from "./use-validation-report";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import {
  expandPanelSlots,
  type ConnectorTypeInfo,
  type RackConnection,
  type RackSlotWithEquipment,
  type Zone,
} from "@/components/synoptique/types/synoptic";
import type { SynopticAdapterInstance } from "@/components/synoptique/components/synoptic-adapter-node";

afterEach(() => {
  useTopbarActions.getState().setValidationReport(null);
  useTopbarActions.getState().setValidationCounts(0, 0, 0);
});

function slot(id: string, extra: Partial<RackSlotWithEquipment> = {}): RackSlotWithEquipment {
  return {
    id,
    equipmentId: null,
    startU: 1,
    heightU: 1,
    label: null,
    widthFraction: null,
    notes: null,
    synopticX: null,
    synopticY: null,
    equipment: null,
    ...extra,
  };
}

function equipment(id: string, name: string, connectors: unknown) {
  return {
    id,
    name,
    reference: null,
    category: null,
    heightU: 1,
    weight: null,
    powerW: null,
    depthMm: null,
    imageUrl: null,
    connectors,
  };
}

function conn(
  id: string,
  from: [string, number],
  to: [string, number],
  label: string | null,
): RackConnection {
  return {
    id,
    rackId: "r1",
    fromSlotId: from[0],
    fromConnectorIndex: from[1],
    toSlotId: to[0],
    toConnectorIndex: to[1],
    label,
    color: null,
    waypoints: null,
    cableStyle: null,
  };
}

const connectorTypes: ConnectorTypeInfo[] = [
  { id: "bnc", name: "BNC", iconId: "bnc", color: "#000000", category: "Vidéo" },
];
const signals = [
  { name: "SDI", color: "#000000", category: "Vidéo" },
  { name: "AES", color: "#000000", category: "Audio" },
];

const cam = slot("cam", {
  equipmentId: "e-cam",
  label: "CAM",
  equipment: equipment("e-cam", "Caméra", [
    { connectorTypeId: "bnc", quantity: 2, direction: "OUT", signalName: "SDI" },
  ]),
});
const mix = slot("mix", {
  equipmentId: "e-mix",
  label: "MIX",
  equipment: equipment("e-mix", "Mélangeur", [
    { connectorTypeId: "bnc", quantity: 2, direction: "IN", signalName: "AES" },
  ]),
});
const idle = slot("idle", {
  equipmentId: "e-idle",
  equipment: equipment("e-idle", "Moniteur", [{ connectorTypeId: "bnc", quantity: 1, direction: "IN" }]),
});
const empty = slot("empty");
const panelOf = (id: string, name: string) =>
  slot(id, {
    panel: {
      id: `p-${id}`,
      name,
      heightU: 1,
      slotsPerU: 2,
      slots: [
        { position: 1, connectorTypeId: "bnc", connectorType: null },
        { position: 2, connectorTypeId: "bnc", connectorType: null },
      ],
    },
  });
const usedPanel = panelOf("pan1", "Patch A");
const unusedPanel = panelOf("pan2", "Patch B");

const slots = [cam, mix, idle, empty, usedPanel, unusedPanel];
// Comme le synoptique : les panels deviennent des rangées virtuelles `<slot>__row<n>`.
const expandedSlots = expandPanelSlots(slots);

const connections: RackConnection[] = [
  // 4 (signal SDI ↔ AES) et 5 (sans label).
  conn("c1", ["cam", 0], ["mix", 0], null),
  // 1 (port #6 introuvable sur MIX).
  conn("c2", ["cam", 1], ["mix", 5], "V-001"),
  // 2 (label V-001 en doublon) et 3 (MIX port #1 sur-utilisé).
  conn("c3", ["cam", 1], ["mix", 0], "V-001"),
  // 1 (slot supprimé).
  conn("c4", ["gone", 0], ["cam", 0], "V-002"),
  // 6b (panel partiel : un seul côté du port physique #1 câblé).
  conn("c5", ["pan1", 0], ["mix", 1], "V-003"),
];

const adapters = [
  {
    id: "adp1",
    rackId: "r1",
    adapterId: null,
    adapter: { name: "BNC/HDMI" },
    x: 0,
    y: 0,
    attachedSlotId: null,
    attachedSide: null,
    attachedPortIndex: null,
    label: null,
    notes: null,
  },
] as unknown as SynopticAdapterInstance[];

const zones: Zone[] = [
  {
    id: "z1",
    x: 5000,
    y: 5000,
    w: 10,
    h: 10,
    label: "",
    labelPosition: "top-left",
    color: "#000000",
  },
];

const positions = new Map([["cam", { x: 10, y: 10 }]]);

test("validation_report_11_checks : le rapport publié couvre les 11 contrôles", () => {
  renderHook(() =>
    useValidationReport({
      expandedSlots,
      slots,
      connections,
      adapters,
      zones,
      positions,
      signals,
      connectorTypes,
    }),
  );
  const report = useTopbarActions.getState().validationReport;
  expect(report).not.toBeNull();
  const kinds = new Set(report!.issues.map((i) => i.kind));
  expect([...kinds].sort()).toEqual(
    [
      "missing_slot",
      "missing_port",
      "duplicate_label",
      "port_overused",
      "signal_mismatch",
      "unlabelled_cable",
      "empty_slot",
      "equipment_unused",
      "panel_unused",
      "panel_partial",
      "orphan_adapter",
      "unnamed_zone",
      "empty_zone",
    ].sort(),
  );
  // Libellés composés par le hook : « préfixe - nom » pour un slot étiqueté.
  const overused = report!.issues.filter((i) => i.kind === "port_overused").map((i) => i.subject);
  expect(overused).toContain("MIX - Mélangeur");
  const unused = report!.issues.find((i) => i.kind === "panel_unused");
  expect(unused?.subject).toBe("Patch B");
  // Compteurs recopiés dans le store.
  const s = useTopbarActions.getState();
  expect([s.validationErrorCount, s.validationWarningCount, s.validationInfoCount]).toEqual([
    report!.counts.error,
    report!.counts.warning,
    report!.counts.info,
  ]);
  expect(report!.counts.error).toBeGreaterThan(0);
});

test("validation_report_11_checks : une instance muette (publish: false) ne touche pas au store", () => {
  renderHook(() =>
    useValidationReport({
      expandedSlots,
      slots,
      connections,
      adapters,
      zones,
      positions,
      signals,
      connectorTypes,
      publish: false,
    }),
  );
  expect(useTopbarActions.getState().validationReport).toBeNull();
  expect(useTopbarActions.getState().validationErrorCount).toBe(0);
});
