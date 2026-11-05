export type DimensionUnit = "U" | "INCH" | "MM" | "M" | "DEG";

const UNIT_SUFFIX: Record<DimensionUnit, string> = {
  U: "U",
  INCH: "″",
  MM: " mm",
  M: " m",
  DEG: "°",
};

/**
 * Formate la valeur+unité d'un preset de dimension en libellé d'affichage.
 * Ex: (19, "INCH") → "19″", (600, "MM") → "600 mm", (1.5, "U") → "1.5U".
 *
 * Pour CABLE_LENGTH avec `isReel=true`, la mention "touret" est rendue
 * séparément par les composants UI (badge), pas dans cette string.
 */
export function formatDimensionLabel(value: number, unit: string): string {
  const suffix = UNIT_SUFFIX[unit as DimensionUnit] ?? ` ${unit}`;
  return `${value}${suffix}`;
}
