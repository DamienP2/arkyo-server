/**
 * Disposition d'une face d'équipement (interface Strata) : algorithme de la
 * maquette (`catalogue.js`, `faceSVG`) porté en fonction pure.
 */

import { describe, expect, test } from "vitest";
import type { ConnectorEntry } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import {
  CONNECTOR_MM,
  DEFAULT_CONNECTOR_MM,
  FACE_AVAILABLE_MM,
  FACE_X0_MM,
  GROUP_GAP_MM,
  connectorWidthResolver,
  layoutFace,
  type FaceGroup,
} from "./face-layout";

const TYPES = [
  { id: "ct-bnc", name: "BNC", iconId: "bnc" },
  { id: "ct-rj45", name: "RJ45", iconId: "rj45" },
  { id: "ct-xlr3", name: "XLR 3", iconId: "xlr3" },
  { id: "ct-cee", name: "CEE 16 A", iconId: "cee" },
];
const widthOf = connectorWidthResolver(TYPES);

function entry(p: Partial<ConnectorEntry>): ConnectorEntry {
  return {
    id: "c",
    face: "REAR",
    connectorTypeId: "ct-bnc",
    signalName: "12G-SDI",
    quantity: 1,
    label: "SDI IN",
    direction: "IN",
    gender: "FEMALE",
    ...p,
  };
}

/** Largeur totale occupée : groupes + espaces de 9 mm. */
const total = (groups: FaceGroup[]) =>
  groups.reduce((a, g) => a + g.width, 0) + Math.max(0, groups.length - 1) * GROUP_GAP_MM;

describe("layoutFace", () => {
  // Algorithme de la maquette : 69,9 mm utiles / pas de 11,94 mm (BNC 11 mm × 0,92 × 1,18)
  // = 5 rangées (le 4 × 10 du plan supposait 14 mm ; arbitrage : option A).
  test("layoutFace : 40 BNC en 2U tiennent sur 5 rangées", () => {
    const [g] = layoutFace([entry({ quantity: 40 })], "REAR", 2, widthOf);
    expect(g.rows).toBe(5);
    expect(g.cols).toBe(8);
    expect(g.count).toBe(40);
    expect(g.entryIndex).toBe(0);
    expect(g.label).toBe("SDI IN");
    // Pas de grille = 1,18 × la taille du pictogramme.
    expect(g.pitch).toBeCloseTo(g.size * 1.18, 6);
  });

  test("réduit l'échelle quand la face déborde", () => {
    const entries = [
      entry({ quantity: 64, label: "SDI IN" }),
      entry({ quantity: 64, label: "SDI OUT", direction: "OUT" }),
      entry({ quantity: 48, label: "AES", connectorTypeId: "ct-xlr3", signalName: "AES3" }),
      entry({ quantity: 24, label: "LAN", connectorTypeId: "ct-rj45", signalName: "Ethernet 1G", direction: "BOTH" }),
    ];
    const groups = layoutFace(entries, "REAR", 1, widthOf);
    expect(groups).toHaveLength(4);
    expect(total(groups)).toBeLessThanOrEqual(FACE_AVAILABLE_MM);
    // L'échelle a bien été réduite : un BNC fait moins que 0,92 × 11 mm.
    expect(groups[0].size).toBeLessThan(0.92 * CONNECTOR_MM.bnc);
    // Les groupes se suivent de gauche à droite, espacés de 9 mm, dans la zone utile.
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i].x).toBeCloseTo(groups[i - 1].x + groups[i - 1].width + GROUP_GAP_MM, 6);
    }
    expect(groups[0].x).toBeGreaterThanOrEqual(FACE_X0_MM);
    expect(groups[3].x + groups[3].width).toBeLessThanOrEqual(FACE_X0_MM + FACE_AVAILABLE_MM + 1e-6);
  });

  test("ignore les entrées d'une autre face", () => {
    const groups = layoutFace(
      [
        entry({ face: "FRONT", label: "MON" }),
        entry({ face: "REAR", label: "SDI IN" }),
        entry({ face: "LEFT", label: "USB" }),
        entry({ face: "REAR", label: "REF" }),
      ],
      "REAR",
      1,
      widthOf,
    );
    expect(groups.map((g) => [g.entryIndex, g.label])).toEqual([
      [1, "SDI IN"],
      [3, "REF"],
    ]);
    expect(layoutFace([entry({ face: "REAR" })], "FRONT", 1, widthOf)).toEqual([]);
  });

  test("quantity 0 et connectorTypeId inconnu ne plantent pas", () => {
    expect(widthOf("inconnu")).toBe(DEFAULT_CONNECTOR_MM);
    // Ancien identifiant d'icône (alias de `ConnectorIcon`) : largeur du connecteur réel.
    expect(widthOf("ct-cee")).toBe(CONNECTOR_MM.cee16);
    let groups: FaceGroup[] = [];
    expect(() => {
      groups = layoutFace(
        [
          entry({ quantity: 0 }),
          entry({ connectorTypeId: "inconnu", quantity: 3 }),
          entry({ quantity: Number.NaN as unknown as number }),
          entry({ quantity: -2 }),
        ],
        "REAR",
        Number.NaN,
        widthOf,
      );
    }).not.toThrow();
    expect(groups.map((g) => g.count)).toEqual([0, 3, 0, 0]);
    expect(groups[0].cols).toBe(0);
    // Largeur par défaut (14 mm) pour le type inconnu.
    expect(groups[1].size / groups[0].size).toBeCloseTo(DEFAULT_CONNECTOR_MM / CONNECTOR_MM.bnc, 6);
    for (const g of groups) {
      for (const v of [g.x, g.width, g.pitch, g.size, g.rows, g.cols]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
