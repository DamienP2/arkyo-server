/**
 * lib/services/import/coerce.ts
 *
 * Conversion des cellules texte d'un tableur vers les types attendus par
 * `TenantEquipment`, avec collecte d'erreurs par cellule. 100 % pur.
 *
 * Types gérés : `text`, `int`, `number`, `bool`, `enum` (widthFraction).
 * - Nombres : accepte virgule décimale FR, espaces (séparateurs de milliers),
 *   unités suffixes courantes (`kg`, `w`, `mm`, `u`…) qu'on retire.
 * - Booléens : oui/non, true/false, vrai/faux, 1/0, x…
 * - widthFraction : FULL / HALF / THIRD / QUARTER + synonymes (1/1, 1/2, 1/3,
 *   1/4, plein, demi, tiers, quart, 100 %, 50 %…).
 */

import { FIELD_KIND, type TargetField } from "./detect-columns";

// ─── widthFraction ───────────────────────────────────────────────────────────

export const WIDTH_FRACTIONS = ["FULL", "HALF", "THIRD", "QUARTER"] as const;
export type WidthFractionValue = (typeof WIDTH_FRACTIONS)[number];

const WIDTH_FRACTION_MAP: Record<string, WidthFractionValue> = {
  full: "FULL",
  "1": "FULL",
  "1/1": "FULL",
  "1 1": "FULL",
  "100": "FULL",
  "100%": "FULL",
  plein: "FULL",
  pleine: "FULL",
  entier: "FULL",
  entiere: "FULL",
  half: "HALF",
  "1/2": "HALF",
  "1 2": "HALF",
  "0.5": "HALF",
  "50": "HALF",
  "50%": "HALF",
  demi: "HALF",
  moitie: "HALF",
  third: "THIRD",
  "1/3": "THIRD",
  "1 3": "THIRD",
  "33": "THIRD",
  "33%": "THIRD",
  tiers: "THIRD",
  quarter: "QUARTER",
  "1/4": "QUARTER",
  "1 4": "QUARTER",
  "0.25": "QUARTER",
  "25": "QUARTER",
  "25%": "QUARTER",
  quart: "QUARTER",
};

// ─── Booléens ────────────────────────────────────────────────────────────────

const BOOL_TRUE = new Set(["oui", "yes", "y", "true", "vrai", "1", "x", "o", "on"]);
const BOOL_FALSE = new Set(["non", "no", "n", "false", "faux", "0", "off"]);

// ─── Résultat de coercition d'une cellule ────────────────────────────────────

export type CoercedValue = string | number | boolean | null;

export type CoerceError = {
  field: TargetField;
  value: string;
  message: string;
};

// ─── Coercitions unitaires ───────────────────────────────────────────────────

/** Nettoie une chaîne numérique : trim, virgule→point, retire espaces/unités. */
function cleanNumeric(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".")
    // retire un suffixe d'unité alphabétique ou % éventuel
    .replace(/[a-zA-Z%µ°"]+$/u, "");
}

export function coerceNumber(raw: string): { value: number | null; error?: string } {
  const t = raw.trim();
  if (t === "") return { value: null };
  const cleaned = cleanNumeric(t);
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return { value: null, error: `"${raw}" n'est pas un nombre valide` };
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    return { value: null, error: `"${raw}" n'est pas un nombre valide` };
  }
  return { value: n };
}

export function coerceInt(raw: string): { value: number | null; error?: string } {
  const t = raw.trim();
  if (t === "") return { value: null };
  // Tolère "2U", "12 U" pour heightU → extrait l'entier.
  const unitMatch = t.match(/^(\d+)\s*u$/i);
  const source = unitMatch ? unitMatch[1] : t;
  const res = coerceNumber(source);
  if (res.value == null) return res;
  if (!Number.isInteger(res.value)) {
    return { value: Math.round(res.value) };
  }
  return { value: res.value };
}

export function coerceBool(raw: string): { value: boolean | null; error?: string } {
  const t = raw.trim();
  if (t === "") return { value: null };
  const nv = t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (BOOL_TRUE.has(nv)) return { value: true };
  if (BOOL_FALSE.has(nv)) return { value: false };
  return { value: null, error: `"${raw}" n'est pas un booléen (oui/non)` };
}

export function coerceWidthFraction(raw: string): {
  value: WidthFractionValue | null;
  error?: string;
} {
  const t = raw.trim();
  if (t === "") return { value: null };
  const key = t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
  const direct = WIDTH_FRACTION_MAP[key] ?? WIDTH_FRACTION_MAP[key.replace(/%$/, "")];
  if (direct) return { value: direct };
  // Essai sur la forme "1 2" (espace au lieu de slash) déjà couverte ; sinon échec.
  return {
    value: null,
    error: `"${raw}" n'est pas une largeur reconnue (FULL/HALF/THIRD/QUARTER)`,
  };
}

// ─── Coercition d'une cellule pour un champ donné ────────────────────────────

/**
 * Convertit `raw` selon le type du champ `field`. Retourne la valeur coercée
 * (ou `null` si vide) et une éventuelle erreur.
 */
export function coerceField(
  field: TargetField,
  raw: string,
): { value: CoercedValue; error?: string } {
  const kind = FIELD_KIND[field];
  switch (kind) {
    case "int":
      return coerceInt(raw);
    case "number":
      return coerceNumber(raw);
    case "bool":
      return coerceBool(raw);
    case "enum":
      return coerceWidthFraction(raw);
    case "text":
    default: {
      const t = raw.trim();
      return { value: t === "" ? null : t };
    }
  }
}

// ─── Coercition d'une ligne complète ─────────────────────────────────────────

export type RowMapping = { field: TargetField; index: number }[];

export type CoercedRow = {
  /** Valeurs coercées par champ cible. */
  values: Partial<Record<TargetField, CoercedValue>>;
  /** Erreurs de cellule (n'empêchent pas forcément l'import : champ mis à null). */
  errors: CoerceError[];
};

/**
 * Coerce une ligne brute (`string[]`) selon un mapping `field → colonne`.
 * `tags` est éclaté en tableau (séparateurs `,` `;` `|`). Les autres champs
 * suivent leur type. Les erreurs sont collectées mais la valeur fautive est
 * mise à `null` (l'appelant décide si c'est bloquant).
 */
export function coerceRow(row: string[], mapping: RowMapping): CoercedRow {
  const values: Partial<Record<TargetField, CoercedValue>> = {};
  const errors: CoerceError[] = [];

  for (const { field, index } of mapping) {
    const raw = row[index] ?? "";
    const { value, error } = coerceField(field, raw);
    if (error) errors.push({ field, value: raw, message: error });
    values[field] = value;
  }

  return { values, errors };
}

/** Éclate une chaîne de tags en tableau nettoyé (`,` `;` `|` séparateurs). */
export function splitTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
}
