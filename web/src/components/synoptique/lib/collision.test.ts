// arkyo-server: arkyo n'a pas de test Vitest de `collision.ts` (aucun sous
// `tests/unit`, aucun à côté du fichier) ; ces cas couvrent ses helpers purs
// tels qu'ils sont copiés.
import { describe, expect, it } from "vitest";
import {
  colToPct,
  colsCollide,
  findFreeColForWf,
  findValidStartUNear,
  isRowFullyCovered,
  pctOverlap,
} from "./collision";
import type { Slot, WidthFraction } from "./types";

function slot(id: string, startU: number | null, heightU: number | null, wf: WidthFraction = "FULL", column = 0, extra: Partial<Slot> = {}): Slot {
  return {
    id,
    view: "FRONT",
    equipmentId: null,
    parentSlotId: null,
    startU,
    heightU,
    widthFraction: wf,
    column,
    label: null,
    notes: null,
    panelLabels: null,
    equipment: null,
    panel: null,
    synopticX: null,
    synopticY: null,
    ...extra,
  };
}

describe("colToPct / pctOverlap / colsCollide", () => {
  it("convertit une colonne en intervalle de pourcentage", () => {
    expect(colToPct(0, "FULL")).toEqual([0, 100]);
    expect(colToPct(1, "HALF")).toEqual([50, 100]);
  });
  it("deux demi-largeurs côte à côte ne se chevauchent pas", () => {
    expect(pctOverlap([0, 50], [50, 100])).toBe(false);
    expect(colsCollide(0, "HALF", 1, "HALF")).toBe(false);
    expect(colsCollide(0, "FULL", 1, "HALF")).toBe(true);
  });
});

describe("isRowFullyCovered", () => {
  it("vrai pour un slot pleine largeur, faux pour une demi-largeur seule", () => {
    expect(isRowFullyCovered(10, [slot("a", 10, 2)])).toBe(true);
    expect(isRowFullyCovered(11, [slot("a", 10, 2)])).toBe(true);
    expect(isRowFullyCovered(12, [slot("a", 10, 2)])).toBe(false);
    expect(isRowFullyCovered(10, [slot("a", 10, 1, "HALF", 0)])).toBe(false);
    expect(isRowFullyCovered(10, [slot("a", 10, 1, "HALF", 0), slot("b", 10, 1, "HALF", 1)])).toBe(true);
  });
  it("ignore les slots fantômes (startU = null)", () => {
    expect(isRowFullyCovered(1, [slot("g", null, null)])).toBe(false);
  });
});

describe("findFreeColForWf", () => {
  it("renvoie la première colonne libre, ou null", () => {
    const slots = [slot("a", 5, 1, "HALF", 0)];
    expect(findFreeColForWf(5, 1, "HALF", slots)).toBe(1);
    expect(findFreeColForWf(5, 1, "FULL", slots)).toBeNull();
    expect(findFreeColForWf(5, 1, "FULL", slots, "a")).toBe(0);
    expect(findFreeColForWf(6, 1, "FULL", slots)).toBe(0);
  });
});

describe("findValidStartUNear", () => {
  const slots = [slot("a", 10, 2)];
  it("1U : la position du curseur, ou null en cas de collision ou hors bornes", () => {
    expect(findValidStartUNear(9, 1, 0, "FULL", "FRONT", slots, undefined, 42)).toBe(9);
    expect(findValidStartUNear(10, 1, 0, "FULL", "FRONT", slots, undefined, 42)).toBeNull();
    expect(findValidStartUNear(43, 1, 0, "FULL", "FRONT", slots, undefined, 42)).toBeNull();
    expect(findValidStartUNear(0, 1, 0, "FULL", "FRONT", slots, undefined, 42)).toBeNull();
  });
  it("multi-U : aimante vers la position libre la plus proche", () => {
    // 2U posé en 9 chevauche [10, 12) : la plus proche libre est 8.
    expect(findValidStartUNear(9, 2, 0, "FULL", "FRONT", slots, undefined, 42)).toBe(8);
    // 2U posé en 11 : 12 est libre.
    expect(findValidStartUNear(11, 2, 0, "FULL", "FRONT", slots, undefined, 42)).toBe(12);
    // Le haut du rack borne la recherche.
    expect(findValidStartUNear(42, 2, 0, "FULL", "FRONT", [], undefined, 42)).toBe(41);
  });
  it("ignore une autre face, les enfants d'étagère et le slot déplacé", () => {
    expect(findValidStartUNear(10, 1, 0, "FULL", "REAR", slots, undefined, 42)).toBe(10);
    expect(findValidStartUNear(10, 1, 0, "FULL", "FRONT", slots, "a", 42)).toBe(10);
    const child = [slot("c", 10, 1, "FULL", 0, { parentSlotId: "shelf" })];
    expect(findValidStartUNear(10, 1, 0, "FULL", "FRONT", child, undefined, 42)).toBe(10);
  });
});
