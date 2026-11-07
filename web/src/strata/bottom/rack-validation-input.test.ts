/**
 * Onglet Contrôles du dock bas (interface Strata, spec §6.2) : `validateRack()`
 * branché sur les données du contenant courant (`canvas-data` de la 4b et
 * câbles du contenant).
 */

import { describe, expect, test } from "vitest";
import { validateRack } from "@/lib/services/rack-validation";
import { realSlotId, toValidationInput } from "./rack-validation-input";
import { CONNECTIONS, RACK, SLOTS } from "./test-fixtures";

describe("toValidationInput", () => {
  test("canvas-data réel : validateRack renvoie les compteurs attendus", () => {
    const report = validateRack(toValidationInput(RACK, { slots: SLOTS, connections: CONNECTIONS }));
    // Erreurs : port SDI OUT 1 de CAM 1 câblé deux fois, AES ↔ SDI (familles
    // Audio / Vidéo). Avertissements : câble sans numéro, port 1 du patch
    // câblé d'un seul côté. Information : alimentation sans câble.
    expect(report.counts).toEqual({ error: 2, warning: 2, info: 1 });
    expect(report.issues.map((i) => i.kind).sort()).toEqual(
      ["equipment_unused", "panel_partial", "port_overused", "signal_mismatch", "unlabelled_cable"].sort(),
    );
    const overused = report.issues.find((i) => i.kind === "port_overused")!;
    expect(overused.refs.slotIds).toEqual(["s1"]);
    expect(overused.subject).toBe("CAM 1 - Caméra X");
    expect(report.issues.find((i) => i.kind === "equipment_unused")!.refs.slotIds).toEqual(["s4"]);
  });

  test("sans câble : chaque équipement est signalé inutilisé, chaque panel équipé aussi", () => {
    const report = validateRack(toValidationInput(RACK));
    expect(report.counts).toEqual({ error: 0, warning: 0, info: 4 });
    const panel = report.issues.find((i) => i.kind === "panel_unused")!;
    // Le panel est développé en rangées virtuelles, comme dans le synoptique.
    expect(panel.refs.slotIds).toEqual(["s2__row0"]);
    expect(realSlotId(panel.refs.slotIds![0])).toBe("s2");
  });

  test("ports à plat, type et famille du connecteur", () => {
    const input = toValidationInput(RACK, { slots: SLOTS });
    const cam = input.slots.find((s) => s.id === "s1")!;
    expect(cam.ports.map((p) => [p.index, p.signalName, p.connectorTypeName])).toEqual([
      [0, "12G-SDI", "BNC"],
      [1, "12G-SDI", "BNC"],
      [2, "12G-SDI", "BNC"],
    ]);
    expect(input.signalFamilyByName.get("AES3")).toBe("f2");
    const row = input.slots.find((s) => s.id === "s2__row0")!;
    expect(row.ports).toHaveLength(16);
    expect(row.panelName).toBe("PATCH A - Patch BNC 8");
  });

  test("extrémité sur un adaptateur : identifiant virtuel du validateur", () => {
    const input = toValidationInput(RACK, {
      slots: SLOTS,
      connections: [{ ...CONNECTIONS[0], toSlotId: null, toConnectorIndex: null, toAdapterId: "a1", toAdapterSide: "right" }],
      adapters: [{ id: "a1", name: "BNC/HDMI" }],
    });
    expect(input.connections[0].toSlotId).toBe("__a__:a1:right");
    expect(input.adapters).toEqual([{ id: "a1", name: "BNC/HDMI", attachedSlotId: null, connectionCount: 1 }]);
  });
});
