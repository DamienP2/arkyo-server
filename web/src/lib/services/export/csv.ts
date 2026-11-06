// ── Helpers CSV purs ────────────────────────────────────────────────────────
//
// Aucune dépendance React / Prisma / DOM — data → string.
// Séparateur `;` par défaut (convention FR / Excel), guillemets doublés,
// BOM UTF-8 optionnel pour qu'Excel ouvre l'accentuation correctement.

export type CsvOptions = {
  /** Séparateur de colonnes. Défaut `;` (Excel FR). */
  separator?: string;
  /** Préfixe le BOM UTF-8 (U+FEFF) pour Excel. Défaut `true`. */
  bom?: boolean;
  /** Fin de ligne. Défaut CRLF (compat Excel/Windows). */
  eol?: string;
};

/** Échappe une valeur : entoure de guillemets et double les guillemets internes. */
export function escapeCsvValue(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replaceAll('"', '""')}"`;
}

/** Construit une chaîne CSV à partir d'en-têtes + lignes. */
export function buildCsv(
  headers: string[],
  rows: Array<Array<unknown>>,
  options: CsvOptions = {},
): string {
  const { separator = ";", bom = true, eol = "\r\n" } = options;
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvValue).join(separator));
  for (const row of rows) {
    lines.push(row.map(escapeCsvValue).join(separator));
  }
  return (bom ? "﻿" : "") + lines.join(eol);
}
