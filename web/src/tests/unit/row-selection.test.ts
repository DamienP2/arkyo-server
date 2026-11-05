import { describe, expect, it } from "vitest";
import { applyDragSelection, computeRange } from "@/components/catalogue/use-row-selection";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ids = ["a", "b", "c", "d", "e"];

// ─── computeRange ────────────────────────────────────────────────────────────

describe("computeRange", () => {
  it("ancre avant la cible → plage dans l'ordre de la liste", () => {
    const range = computeRange(ids, "b", "d");

    expect(range).toEqual(["b", "c", "d"]);
  });

  it("ancre après la cible (ordre inversé) → même plage, ordre de la liste conservé", () => {
    const range = computeRange(ids, "d", "b");

    expect(range).toEqual(["b", "c", "d"]);
  });

  it("ancre === cible → plage à un seul élément", () => {
    const range = computeRange(ids, "c", "c");

    expect(range).toEqual(["c"]);
  });

  it("anchorId null → repli sur la cible seule", () => {
    const range = computeRange(ids, null, "c");

    expect(range).toEqual(["c"]);
  });

  it("anchorId absent de la liste (purgé après filtre) → repli sur la cible seule", () => {
    const range = computeRange(ids, "id-disparu", "c");

    expect(range).toEqual(["c"]);
  });

  it("targetId absent de la liste → plage vide", () => {
    const range = computeRange(ids, "b", "id-inconnu");

    expect(range).toEqual([]);
  });
});

// ─── applyDragSelection ──────────────────────────────────────────────────────

describe("applyDragSelection", () => {
  it("mode select : ajoute la plage sans perdre la sélection de base", () => {
    const base = new Set(["a"]);

    const next = applyDragSelection(base, ["c", "d"], "select");

    expect(next).toEqual(new Set(["a", "c", "d"]));
  });

  it("mode deselect : retire la plage, conserve le reste de la sélection", () => {
    const base = new Set(["a", "b", "c", "d"]);

    const next = applyDragSelection(base, ["b", "c"], "deselect");

    expect(next).toEqual(new Set(["a", "d"]));
  });

  it("immuabilité : le Set de base n'est jamais muté", () => {
    const base = new Set(["a"]);

    const next = applyDragSelection(base, ["b"], "select");

    expect(base).toEqual(new Set(["a"]));
    expect(next).not.toBe(base);
  });

  it("scénario combiné : sélection existante + plage Shift qui chevauche → union sans doublons", () => {
    // Sélection déjà faite via Cmd+clic sur "a" et "c".
    const base = new Set(["a", "c"]);

    // Shift+clic étend une plage b..d, qui chevauche "c" déjà sélectionné.
    const range = computeRange(ids, "b", "d");
    const next = applyDragSelection(base, range, "select");

    expect(next).toEqual(new Set(["a", "b", "c", "d"]));
    expect(next.size).toBe(4);
  });
});
