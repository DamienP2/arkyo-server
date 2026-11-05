import { describe, expect, it } from "vitest";
import {
  coerceNumber,
  coerceInt,
  coerceBool,
  coerceWidthFraction,
  coerceField,
  coerceRow,
  splitTags,
  type RowMapping,
} from "@/lib/services/import/coerce";

describe("coerceNumber", () => {
  it("parse un entier et un décimal (virgule FR)", () => {
    expect(coerceNumber("450").value).toBe(450);
    expect(coerceNumber("6,5").value).toBe(6.5);
  });
  it("retire les unités et espaces", () => {
    expect(coerceNumber("6.5 kg").value).toBe(6.5);
    expect(coerceNumber("1 200").value).toBe(1200);
  });
  it("chaîne vide → null sans erreur", () => {
    const r = coerceNumber("");
    expect(r.value).toBeNull();
    expect(r.error).toBeUndefined();
  });
  it("texte non numérique → erreur", () => {
    const r = coerceNumber("abc");
    expect(r.value).toBeNull();
    expect(r.error).toBeTruthy();
  });
});

describe("coerceInt", () => {
  it("tolère le suffixe U", () => {
    expect(coerceInt("2U").value).toBe(2);
    expect(coerceInt("12 U").value).toBe(12);
  });
  it("arrondit un décimal", () => {
    expect(coerceInt("2.7").value).toBe(3);
  });
});

describe("coerceBool", () => {
  it("reconnaît oui/non FR", () => {
    expect(coerceBool("oui").value).toBe(true);
    expect(coerceBool("Non").value).toBe(false);
  });
  it("reconnaît true/false/1/0/x", () => {
    expect(coerceBool("true").value).toBe(true);
    expect(coerceBool("0").value).toBe(false);
    expect(coerceBool("x").value).toBe(true);
  });
  it("valeur inconnue → erreur", () => {
    expect(coerceBool("peut-être").error).toBeTruthy();
  });
});

describe("coerceWidthFraction", () => {
  it("mappe les libellés canoniques", () => {
    expect(coerceWidthFraction("FULL").value).toBe("FULL");
    expect(coerceWidthFraction("half").value).toBe("HALF");
  });
  it("mappe les fractions et synonymes FR", () => {
    expect(coerceWidthFraction("1/2").value).toBe("HALF");
    expect(coerceWidthFraction("1/3").value).toBe("THIRD");
    expect(coerceWidthFraction("quart").value).toBe("QUARTER");
    expect(coerceWidthFraction("100%").value).toBe("FULL");
    expect(coerceWidthFraction("plein").value).toBe("FULL");
  });
  it("valeur inconnue → erreur", () => {
    expect(coerceWidthFraction("2/5").error).toBeTruthy();
  });
});

describe("coerceField", () => {
  it("route selon le type du champ", () => {
    expect(coerceField("heightU", "3U").value).toBe(3);
    expect(coerceField("weight", "6,5").value).toBe(6.5);
    expect(coerceField("is2110", "oui").value).toBe(true);
    expect(coerceField("widthFraction", "demi").value).toBe("HALF");
    expect(coerceField("name", "  Caméra  ").value).toBe("Caméra");
  });
});

describe("splitTags", () => {
  it("éclate sur , ; |", () => {
    expect(splitTags("hd, sdi ; ip")).toEqual(["hd", "sdi", "ip"]);
  });
  it("chaîne vide → []", () => {
    expect(splitTags("")).toEqual([]);
    expect(splitTags(null)).toEqual([]);
  });
});

describe("coerceRow", () => {
  const mapping: RowMapping = [
    { field: "name", index: 0 },
    { field: "heightU", index: 1 },
    { field: "weight", index: 2 },
    { field: "is2110", index: 3 },
  ];

  it("coerce une ligne complète", () => {
    const { values, errors } = coerceRow(["Switch", "1", "3,2", "oui"], mapping);
    expect(values.name).toBe("Switch");
    expect(values.heightU).toBe(1);
    expect(values.weight).toBe(3.2);
    expect(values.is2110).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("collecte les erreurs de cellule et met null", () => {
    const { values, errors } = coerceRow(["Switch", "abc", "", "peut-être"], mapping);
    expect(values.name).toBe("Switch");
    expect(values.heightU).toBeNull();
    expect(values.is2110).toBeNull();
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.map((e) => e.field)).toContain("heightU");
    expect(errors.map((e) => e.field)).toContain("is2110");
  });
});
