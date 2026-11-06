import { describe, expect, it } from "vitest";
import {
  computeBomRemaining,
  deriveBomFromSlots,
  validateInventoryRef,
  type BomItem,
  type SlotInput,
  type SlotRefForCount,
} from "@/lib/services/rack-inventory";

describe("deriveBomFromSlots", () => {
  it("retourne un BOM vide pour une liste de slots vide", () => {
    expect(deriveBomFromSlots([])).toEqual([]);
  });

  it("agrège 3 slots équipements distincts en 3 BomItem quantity=1", () => {
    const slots: SlotInput[] = [
      { equipmentId: "eq-a", panelId: null },
      { equipmentId: "eq-b", panelId: null },
      { equipmentId: "eq-c", panelId: null },
    ];

    const bom = deriveBomFromSlots(slots);

    expect(bom).toHaveLength(3);
    expect(bom).toEqual([
      { equipmentId: "eq-a", quantity: 1 },
      { equipmentId: "eq-b", quantity: 1 },
      { equipmentId: "eq-c", quantity: 1 },
    ]);
  });

  it("agrège 5 slots du même équipement en 1 BomItem quantity=5", () => {
    const slots: SlotInput[] = Array.from({ length: 5 }, () => ({
      equipmentId: "eq-x",
      panelId: null,
    }));

    const bom = deriveBomFromSlots(slots);

    expect(bom).toHaveLength(1);
    expect(bom[0]).toEqual({ equipmentId: "eq-x", quantity: 5 });
  });

  it("mix slots équipement + panel produit 2 BomItem (un par kind)", () => {
    const slots: SlotInput[] = [
      { equipmentId: "eq-1", panelId: null },
      { equipmentId: "eq-1", panelId: null },
      { equipmentId: null, panelId: "panel-1" },
      { equipmentId: null, panelId: "panel-1" },
      { equipmentId: null, panelId: "panel-1" },
    ];

    const bom = deriveBomFromSlots(slots);

    expect(bom).toHaveLength(2);
    expect(bom).toContainEqual({ equipmentId: "eq-1", quantity: 2 });
    expect(bom).toContainEqual({ panelId: "panel-1", quantity: 3 });
  });

  it("ignore les slots sans equipmentId NI panelId (étagère vide, plaque)", () => {
    const slots: SlotInput[] = [
      { equipmentId: null, panelId: null },
      { equipmentId: "eq-a", panelId: null },
      { equipmentId: null, panelId: null },
      { equipmentId: null, panelId: "panel-z" },
      { equipmentId: null, panelId: null },
    ];

    const bom = deriveBomFromSlots(slots);

    expect(bom).toHaveLength(2);
    expect(bom).toContainEqual({ equipmentId: "eq-a", quantity: 1 });
    expect(bom).toContainEqual({ panelId: "panel-z", quantity: 1 });
  });

  it("slot avec equipmentId ET panelId — priorité à equipmentId (panelId ignoré)", () => {
    // Cas illogique théoriquement impossible mais protégé par règle métier
    // documentée : equipmentId prime, panelId est ignoré.
    const slots: SlotInput[] = [
      { equipmentId: "eq-conflict", panelId: "panel-conflict" },
    ];

    const bom = deriveBomFromSlots(slots);

    expect(bom).toHaveLength(1);
    expect(bom[0]).toEqual({ equipmentId: "eq-conflict", quantity: 1 });
    expect(bom[0]).not.toHaveProperty("panelId");
  });

  it("préserve l'ordre de première apparition des références", () => {
    const slots: SlotInput[] = [
      { equipmentId: null, panelId: "panel-2" },
      { equipmentId: "eq-1", panelId: null },
      { equipmentId: null, panelId: "panel-2" },
      { equipmentId: "eq-1", panelId: null },
    ];

    const bom = deriveBomFromSlots(slots);

    expect(bom).toEqual([
      { panelId: "panel-2", quantity: 2 },
      { equipmentId: "eq-1", quantity: 2 },
    ]);
  });
});

describe("validateInventoryRef", () => {
  it("body avec uniquement equipmentId → kind equipment", () => {
    expect(validateInventoryRef({ equipmentId: "eq-42" })).toEqual({
      kind: "equipment",
      refId: "eq-42",
    });
  });

  it("body avec uniquement panelId → kind panel", () => {
    expect(validateInventoryRef({ panelId: "panel-42" })).toEqual({
      kind: "panel",
      refId: "panel-42",
    });
  });

  it("body avec uniquement adapterId → kind adapter", () => {
    expect(validateInventoryRef({ adapterId: "adapter-42" })).toEqual({
      kind: "adapter",
      refId: "adapter-42",
    });
  });

  it("body vide ({}) → throw avec message contenant 'manquante'", () => {
    expect(() => validateInventoryRef({})).toThrow(/manquante/i);
  });

  it("body avec tous les champs null/undefined → throw 'manquante'", () => {
    expect(() =>
      validateInventoryRef({
        equipmentId: null,
        panelId: undefined,
        adapterId: null,
      }),
    ).toThrow(/manquante/i);
  });

  it("body avec chaîne vide pour la seule ref → throw 'manquante'", () => {
    expect(() => validateInventoryRef({ equipmentId: "" })).toThrow(/manquante/i);
  });

  it("body avec equipmentId + panelId → throw avec message contenant 'Plusieurs'", () => {
    expect(() =>
      validateInventoryRef({ equipmentId: "eq-1", panelId: "panel-1" }),
    ).toThrow(/Plusieurs/);
  });

  it("body avec equipmentId + adapterId → throw 'Plusieurs'", () => {
    expect(() =>
      validateInventoryRef({ equipmentId: "eq-1", adapterId: "adapter-1" }),
    ).toThrow(/Plusieurs/);
  });

  it("body avec les 3 refs → throw 'Plusieurs'", () => {
    expect(() =>
      validateInventoryRef({
        equipmentId: "eq-1",
        panelId: "panel-1",
        adapterId: "adapter-1",
      }),
    ).toThrow(/Plusieurs/);
  });

  it("body avec champs null/undefined mélangés (un seul non-null) → traite correctement", () => {
    expect(
      validateInventoryRef({
        equipmentId: null,
        panelId: "panel-only",
        adapterId: undefined,
      }),
    ).toEqual({ kind: "panel", refId: "panel-only" });

    expect(
      validateInventoryRef({
        equipmentId: undefined,
        panelId: null,
        adapterId: "adapter-only",
      }),
    ).toEqual({ kind: "adapter", refId: "adapter-only" });

    expect(
      validateInventoryRef({
        equipmentId: "eq-only",
        panelId: null,
        adapterId: null,
      }),
    ).toEqual({ kind: "equipment", refId: "eq-only" });
  });

  it("ignore les chaînes vides quand une autre ref valide est présente", () => {
    expect(
      validateInventoryRef({
        equipmentId: "",
        panelId: "panel-real",
        adapterId: "",
      }),
    ).toEqual({ kind: "panel", refId: "panel-real" });
  });

  // ----- Cas accessoires -----

  it("body avec accessory plaque 2U plein → succès accessory", () => {
    expect(
      validateInventoryRef({
        accessoryType: "plaque",
        accessoryHeightU: 2,
        accessoryVariant: "plein",
      }),
    ).toEqual({
      kind: "accessory",
      accessoryType: "plaque",
      accessoryHeightU: 2,
      accessoryVariant: "plein",
    });
  });

  it("body avec accessoryType seul → throw 'Accessoire incomplet'", () => {
    expect(() =>
      validateInventoryRef({ accessoryType: "plaque" }),
    ).toThrow(/Accessoire incomplet/);
  });

  it("body avec accessoryHeightU seul → throw 'Accessoire incomplet'", () => {
    expect(() =>
      validateInventoryRef({ accessoryHeightU: 2 }),
    ).toThrow(/Accessoire incomplet/);
  });

  it("body avec plaque + heightU SANS variant → throw 'Variant requis'", () => {
    expect(() =>
      validateInventoryRef({
        accessoryType: "plaque",
        accessoryHeightU: 2,
      }),
    ).toThrow(/Variant requis/);
  });

  it("body avec plaque + heightU + variant invalide → throw 'Variant requis'", () => {
    expect(() =>
      validateInventoryRef({
        accessoryType: "plaque",
        accessoryHeightU: 2,
        accessoryVariant: "n-importe-quoi",
      }),
    ).toThrow(/Variant requis/);
  });

  it("body avec etagere 2U + profondeur sans variant → succès, variant=undefined", () => {
    const ref = validateInventoryRef({
      accessoryType: "etagere",
      accessoryHeightU: 2,
      accessoryDepthMm: 450,
    });
    expect(ref).toEqual({
      kind: "accessory",
      accessoryType: "etagere",
      accessoryHeightU: 2,
      accessoryDepthMm: 450,
    });
    expect(ref).not.toHaveProperty("accessoryVariant");
  });

  it("body avec tiroir 1U + profondeur + variant → variant ignoré (renvoyé undefined)", () => {
    const ref = validateInventoryRef({
      accessoryType: "tiroir",
      accessoryHeightU: 1,
      accessoryDepthMm: 300,
      accessoryVariant: "plein",
    });
    expect(ref).toEqual({
      kind: "accessory",
      accessoryType: "tiroir",
      accessoryHeightU: 1,
      accessoryDepthMm: 300,
    });
    expect(ref).not.toHaveProperty("accessoryVariant");
  });

  it("body avec accessoryType invalide → throw", () => {
    expect(() =>
      validateInventoryRef({
        accessoryType: "invalide",
        accessoryHeightU: 2,
      }),
    ).toThrow(/Type d'accessoire invalide/);
  });

  it("body avec accessoryHeightU=5 → accepté (1U → 8U)", () => {
    expect(
      validateInventoryRef({
        accessoryType: "etagere",
        accessoryHeightU: 5,
        accessoryDepthMm: 300,
      }),
    ).toMatchObject({ kind: "accessory", accessoryHeightU: 5 });
  });

  it("body avec accessoryHeightU=9 → throw", () => {
    expect(() =>
      validateInventoryRef({
        accessoryType: "etagere",
        accessoryHeightU: 9,
        accessoryDepthMm: 300,
      }),
    ).toThrow(/Hauteur U/);
  });

  it("body avec accessoryHeightU=0 → throw", () => {
    expect(() =>
      validateInventoryRef({
        accessoryType: "etagere",
        accessoryHeightU: 0,
      }),
    ).toThrow(/Hauteur U/);
  });

  it("body avec equipmentId + accessoire complet → throw 'Plusieurs'", () => {
    expect(() =>
      validateInventoryRef({
        equipmentId: "eq-1",
        accessoryType: "plaque",
        accessoryHeightU: 2,
        accessoryVariant: "plein",
      }),
    ).toThrow(/Plusieurs/);
  });

  it("body avec panelId + accessoire complet → throw 'Plusieurs'", () => {
    expect(() =>
      validateInventoryRef({
        panelId: "p-1",
        accessoryType: "tiroir",
        accessoryHeightU: 1,
        accessoryDepthMm: 300,
      }),
    ).toThrow(/Plusieurs/);
  });
});

describe("computeBomRemaining", () => {
  it("liste vide BOM → []", () => {
    expect(computeBomRemaining([], [])).toEqual([]);
  });

  it("BOM equipment quantity=5, 0 slots → remaining 5", () => {
    const bom: BomItem[] = [{ equipmentId: "eq-a", quantity: 5 }];
    const result = computeBomRemaining(bom, []);
    expect(result).toEqual([{ equipmentId: "eq-a", quantity: 5, remaining: 5 }]);
  });

  it("BOM equipment quantity=5, 3 slots match → remaining 2", () => {
    const bom: BomItem[] = [{ equipmentId: "eq-a", quantity: 5 }];
    const slots: SlotRefForCount[] = [
      { equipmentId: "eq-a", panelId: null },
      { equipmentId: "eq-a", panelId: null },
      { equipmentId: "eq-a", panelId: null },
      { equipmentId: "eq-other", panelId: null },
      { equipmentId: null, panelId: "p-1" },
    ];
    const result = computeBomRemaining(bom, slots);
    expect(result).toEqual([
      { equipmentId: "eq-a", quantity: 5, remaining: 2 },
    ]);
  });

  it("BOM accessory plaque 2U plein quantity=3, 1 slot match → remaining 2", () => {
    const bom: BomItem[] = [
      {
        accessoryType: "plaque",
        accessoryHeightU: 2,
        accessoryVariant: "plein",
        quantity: 3,
      },
    ];
    const slots: SlotRefForCount[] = [
      {
        equipmentId: null,
        panelId: null,
        accessoryType: "plaque",
        accessoryHeightU: 2,
        accessoryVariant: "plein",
      },
      // variant différent → pas de match
      {
        equipmentId: null,
        panelId: null,
        accessoryType: "plaque",
        accessoryHeightU: 2,
        accessoryVariant: "aere",
      },
      // hauteur différente → pas de match
      {
        equipmentId: null,
        panelId: null,
        accessoryType: "plaque",
        accessoryHeightU: 1,
        accessoryVariant: "plein",
      },
      // type différent → pas de match
      {
        equipmentId: null,
        panelId: null,
        accessoryType: "etagere",
        accessoryHeightU: 2,
      },
    ];
    const result = computeBomRemaining(bom, slots);
    expect(result).toEqual([
      {
        accessoryType: "plaque",
        accessoryHeightU: 2,
        accessoryVariant: "plein",
        quantity: 3,
        remaining: 2,
      },
    ]);
  });

  it("BOM accessory etagere 2U quantity=2, 2 slots match (variant ignoré) → remaining 0", () => {
    const bom: BomItem[] = [
      {
        accessoryType: "etagere",
        accessoryHeightU: 2,
        quantity: 2,
      },
    ];
    const slots: SlotRefForCount[] = [
      {
        equipmentId: null,
        panelId: null,
        accessoryType: "etagere",
        accessoryHeightU: 2,
      },
      {
        equipmentId: null,
        panelId: null,
        accessoryType: "etagere",
        accessoryHeightU: 2,
      },
    ];
    const result = computeBomRemaining(bom, slots);
    expect(result[0]?.remaining).toBe(0);
  });

  it("BOM panel quantity=2, 5 slots placés mais autre panelId → remaining 2", () => {
    const bom: BomItem[] = [{ panelId: "p-real", quantity: 2 }];
    const slots: SlotRefForCount[] = Array.from({ length: 5 }, () => ({
      equipmentId: null,
      panelId: "p-other",
    }));
    const result = computeBomRemaining(bom, slots);
    expect(result).toEqual([{ panelId: "p-real", quantity: 2, remaining: 2 }]);
  });

  it("count négatif clampé à 0 (BOM=2, 5 slots match → remaining 0)", () => {
    const bom: BomItem[] = [{ equipmentId: "eq-a", quantity: 2 }];
    const slots: SlotRefForCount[] = Array.from({ length: 5 }, () => ({
      equipmentId: "eq-a",
      panelId: null,
    }));
    const result = computeBomRemaining(bom, slots);
    expect(result[0]?.remaining).toBe(0);
  });

  it("BOM adapter quantity=3, 1 slot avec adapterId match → remaining 2", () => {
    const bom: BomItem[] = [{ adapterId: "ad-1", quantity: 3 }];
    const slots: SlotRefForCount[] = [
      { equipmentId: null, panelId: null, adapterId: "ad-1" },
      { equipmentId: null, panelId: null, adapterId: "ad-2" },
      { equipmentId: null, panelId: null },
    ];
    const result = computeBomRemaining(bom, slots);
    expect(result[0]?.remaining).toBe(2);
  });

  it("plusieurs BomItem retournés dans le même ordre", () => {
    const bom: BomItem[] = [
      { equipmentId: "eq-a", quantity: 3 },
      { panelId: "p-1", quantity: 2 },
      {
        accessoryType: "tiroir",
        accessoryHeightU: 1,
        quantity: 1,
      },
    ];
    const slots: SlotRefForCount[] = [
      { equipmentId: "eq-a", panelId: null },
      { equipmentId: null, panelId: "p-1" },
    ];
    const result = computeBomRemaining(bom, slots);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ equipmentId: "eq-a", remaining: 2 });
    expect(result[1]).toMatchObject({ panelId: "p-1", remaining: 1 });
    expect(result[2]).toMatchObject({
      accessoryType: "tiroir",
      accessoryHeightU: 1,
      remaining: 1,
    });
  });
});
