import { describe, expect, it } from "vitest";
import { formatDimensionLabel } from "@/lib/services/dimensions";

describe("formatDimensionLabel", () => {
  it('formate une valeur entière en U', () => {
    expect(formatDimensionLabel(1, "U")).toBe("1U");
  });

  it('formate une valeur décimale en U', () => {
    expect(formatDimensionLabel(1.5, "U")).toBe("1.5U");
  });

  it('formate en pouces avec le caractère double prime U+2033', () => {
    expect(formatDimensionLabel(19, "INCH")).toBe("19″");
  });

  it('formate en millimètres avec espace', () => {
    expect(formatDimensionLabel(600, "MM")).toBe("600 mm");
  });

  it('formate en mètres avec espace', () => {
    expect(formatDimensionLabel(305, "M")).toBe("305 m");
  });

  it('formate en degrés avec le symbole °', () => {
    expect(formatDimensionLabel(45, "DEG")).toBe("45°");
  });

  it('fallback : unité inconnue préfixée par un espace', () => {
    expect(formatDimensionLabel(10, "KG")).toBe("10 KG");
  });
});
