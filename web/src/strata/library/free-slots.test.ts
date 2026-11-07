/**
 * U libres d'un rack pour la bibliothèque Strata : départs possibles d'un
 * équipement de `heightU` U sur une face, et refus d'un dépôt comme le canvas.
 */

import { describe, expect, test } from "vitest";
import type { Slot } from "@/components/synoptique/lib/types";
import { dropRefused, freeStartUs } from "./free-slots";

function slot(id: string, startU: number | null, heightU: number | null, extra: Partial<Slot> = {}): Slot {
  return {
    id,
    view: "FRONT",
    equipmentId: "eq",
    parentSlotId: null,
    startU,
    heightU,
    widthFraction: "FULL",
    column: 0,
    ...extra,
  } as Slot;
}

describe("freeStartUs", () => {
  // Rack 42U occupé de U2 à U3 et de U38 à U39.
  const slots = [slot("a", 2, 2), slot("b", 38, 2)];

  test("équipement de 2U : ni U1, ni U2, ni U37, ni U38 ; U4 inclus", () => {
    const free = freeStartUs(slots, 42, 2, "FRONT");
    for (const u of [1, 2, 37, 38]) expect(free).not.toContain(u);
    expect(free).toContain(4);
    expect(free[0]).toBe(4);
    // Le haut du rack : U40-U41 et U41-U42 tiennent, U42 déborde.
    expect(free).toContain(41);
    expect(free).not.toContain(42);
  });

  test("ignore les autres faces, les fantômes et les enfants d'étagère", () => {
    const others = [
      slot("rear", 1, 4, { view: "REAR" }),
      slot("ghost", null, null),
      slot("child", 1, 1, { parentSlotId: "shelf" }),
    ];
    expect(freeStartUs(others, 4, 1, "FRONT")).toEqual([1, 2, 3, 4]);
  });

  test("un demi-format occupe la rangée pour un équipement pleine largeur", () => {
    const half = [slot("h", 1, 1, { widthFraction: "HALF", column: 1 })];
    expect(freeStartUs(half, 3, 1, "FRONT")).toEqual([2, 3]);
  });

  test("équipement plus haut que le rack : aucun U", () => {
    expect(freeStartUs([], 2, 3, "FRONT")).toEqual([]);
  });
});

describe("dropRefused", () => {
  const slots = [slot("a", 12, 1)];

  test("U occupé : refusé", () => {
    expect(dropRefused({ uIndex: 12, col: 0, view: "FRONT" }, 1, slots, 42)).toBe(true);
  });

  test("U libre : accepté", () => {
    expect(dropRefused({ uIndex: 14, col: 0, view: "FRONT" }, 1, slots, 42)).toBe(false);
  });

  test("2U au-dessus d'un occupé : aimanté comme le canvas, donc accepté", () => {
    // U11-U12 collide, le canvas aimante à U10 (fenêtre ±1).
    expect(dropRefused({ uIndex: 11, col: 0, view: "FRONT" }, 2, slots, 42)).toBe(false);
  });

  test("2U sans place dans la fenêtre d'aimantation : refusé", () => {
    const tight = [slot("a", 10, 1), slot("b", 12, 2)];
    expect(dropRefused({ uIndex: 11, col: 0, view: "FRONT" }, 2, tight, 42)).toBe(true);
  });
});
