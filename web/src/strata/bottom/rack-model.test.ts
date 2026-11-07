/**
 * Une seule lecture de la connectique (`rackConnectors`) pour la face, les
 * entrées, l'occupation et les index de câble : une entrée sans quantité
 * compte pour 1 port partout (arkyo : `quantity ?? 1`), une entrée illisible
 * garde sa place.
 */

import { describe, expect, test } from "vitest";
import type { Slot } from "@/components/synoptique/lib/types";
import { totalPorts } from "../catalogue-model";
import { layoutFace } from "../drawings/face-layout";
import { validateRack } from "@/lib/services/rack-validation";
import { portKeyOfIndex, rackConnectors, slotLinks, type RackConnectionRow } from "./rack-model";
import { toValidationInput } from "./rack-validation-input";
import { RACK } from "./test-fixtures";

const RAW = [
  { face: "REAR", connectorTypeId: "ct-bnc", signalName: "12G-SDI", label: "SDI", direction: "OUT", gender: "FEMALE" },
  null,
  { face: "REAR", connectorTypeId: "ct-bnc", signalName: "12G-SDI", label: "REF", direction: "IN", gender: "FEMALE", quantity: 2 },
];

const slot = {
  id: "s9",
  label: "X",
  view: "FRONT",
  startU: 1,
  heightU: 1,
  parentSlotId: null,
  equipment: { id: "eq9", name: "Boîtier", connectors: RAW },
} as unknown as Slot;

const cable = (id: string, index: number): RackConnectionRow => ({
  id,
  fromSlotId: "s9",
  fromConnectorIndex: index,
  toSlotId: null,
  toConnectorIndex: null,
  label: id,
});

describe("rackConnectors", () => {
  test("entrée sans quantité = 1 port ; index, comptes et face s'accordent", () => {
    const entries = rackConnectors(RAW);
    expect(entries.map((e) => [e.label, e.quantity])).toEqual([
      ["SDI", 1],
      ["", 0],
      ["REF", 2],
    ]);
    expect(totalPorts(entries)).toBe(3);
    // Index de câble à plat : 0 → SDI, 1 et 2 → REF 1 et 2 (l'entrée illisible ne compte pas).
    expect([0, 1, 2, 3].map((i) => portKeyOfIndex(entries, i))).toEqual(["0:1", "2:1", "2:2", null]);
    expect(slotLinks(slot, [cable("V-1", 0), cable("V-2", 2)])).toEqual({ "0:1": "V-1", "2:2": "V-2" });
    // La face dessine le port de l'entrée sans quantité, pas l'entrée illisible.
    expect(layoutFace(entries, "REAR", 1, () => 11).map((g) => [g.entryIndex, g.count])).toEqual([
      [0, 1],
      [2, 2],
    ]);
  });

  test("les contrôles lisent les mêmes ports", () => {
    const input = toValidationInput(RACK, { slots: [slot], connections: [cable("V-1", 0), cable("V-2", 2)] });
    expect(input.slots[0].ports.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(validateRack(input).issues.some((i) => i.kind === "missing_port")).toBe(false);
  });
});
