/**
 * lib/services/import/parse-tabular.ts
 *
 * Normalisation d'un tableur en matrice `{ headers, rows }`.
 *
 * 100 % pur — aucune dépendance Prisma / React / Next / DOM.
 *
 * Deux entrées :
 *  - CSV : `parseCsv(text)` — auto-détection du séparateur (`;` / `,` / tab),
 *    BOM UTF-8, guillemets doubles avec échappement `""`, retours de ligne
 *    (`\n`, `\r\n`, `\r`), champs multi-lignes entre guillemets.
 *  - XLSX : `normalizeMatrix(matrix)` — le classeur est déjà extrait en
 *    matrice `unknown[][]` (le chargement SheetJS se fait côté client via le
 *    loader CDN existant, ou côté serveur via `parseXlsxBuffer`). On se
 *    contente de figer la 1ʳᵉ ligne en en-têtes et de stringifier les cellules.
 */

export type TabularMatrix = {
  /** Présent uniquement pour un classeur XLSX multi-feuilles. */
  sheetNames?: string[];
  /** En-têtes (1ʳᵉ ligne), toujours des chaînes (jamais null). */
  headers: string[];
  /** Lignes de données (hors en-tête), chaque cellule stringifiée. */
  rows: string[][];
};

const CANDIDATE_DELIMITERS = [";", ",", "\t"] as const;
type Delimiter = (typeof CANDIDATE_DELIMITERS)[number];

/** Retire un éventuel BOM UTF-8 en tête de chaîne. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Devine le séparateur en comptant les occurrences hors guillemets sur les
 * premières lignes. Celui qui donne le plus grand nombre de colonnes stable
 * gagne ; `;` l'emporte en cas d'égalité (usage FR fréquent).
 */
export function detectDelimiter(text: string): Delimiter {
  const sample = stripBom(text).split(/\r\n|\r|\n/).slice(0, 20).join("\n");
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const delim of CANDIDATE_DELIMITERS) {
    const counts = countDelimiterPerLine(sample, delim);
    if (counts.length === 0) continue;
    // Nombre de colonnes = occurrences + 1 ; on veut > 1 colonne et régulier.
    const nonZero = counts.filter((c) => c > 0);
    if (nonZero.length === 0) continue;
    const total = nonZero.reduce((a, b) => a + b, 0);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    const regular = max === min ? 1 : 0;
    const score = total + regular * 5;
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }
  return best;
}

/** Compte les occurrences du séparateur par ligne, en ignorant les guillemets. */
function countDelimiterPerLine(text: string, delim: string): number[] {
  const counts: number[] = [];
  let inQuotes = false;
  let current = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "\n" && !inQuotes) {
      counts.push(current);
      current = 0;
    } else if (ch === delim && !inQuotes) {
      current += 1;
    }
  }
  counts.push(current);
  return counts;
}

/**
 * Parse un CSV complet en lignes de champs. Gère guillemets, `""` échappé,
 * champs multi-lignes, et les 3 styles de fin de ligne.
 */
function parseCsvRows(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delim) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // \r\n ou \r seul
      pushRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Dernier champ / dernière ligne (si le fichier ne finit pas par un saut).
  if (field.length > 0 || row.length > 0) pushRow();

  return rows;
}

/** Retire les lignes entièrement vides (champs tous vides après trim). */
function dropEmptyRows(rows: string[][]): string[][] {
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Parse un texte CSV en matrice `{ headers, rows }`.
 * La 1ʳᵉ ligne non vide devient les en-têtes. Les colonnes des lignes plus
 * courtes/longues sont ajustées à la largeur des en-têtes.
 */
export function parseCsv(text: string, delimiter?: Delimiter): TabularMatrix {
  const clean = stripBom(text ?? "");
  const delim = delimiter ?? detectDelimiter(clean);
  const raw = dropEmptyRows(parseCsvRows(clean, delim));
  if (raw.length === 0) return { headers: [], rows: [] };

  const headers = raw[0].map((h) => h.trim());
  const width = headers.length;
  const rows = raw.slice(1).map((r) => normalizeRowWidth(r, width));
  return { headers, rows };
}

/** Ajuste une ligne à `width` colonnes (complète avec "" ou tronque). */
function normalizeRowWidth(row: string[], width: number): string[] {
  if (row.length === width) return row;
  if (row.length > width) return row.slice(0, width);
  return [...row, ...Array(width - row.length).fill("")];
}

/** Stringifie une cellule XLSX (nombre/bool/date/null) en texte propre. */
function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Normalise une matrice brute (issue de SheetJS `sheet_to_json({header:1})`)
 * en `{ headers, rows }`. Première ligne = en-têtes.
 */
export function normalizeMatrix(
  matrix: unknown[][],
  sheetNames?: string[],
): TabularMatrix {
  const rowsRaw = (matrix ?? []).map((r) => (r ?? []).map(cellToString));
  const nonEmpty = dropEmptyRows(rowsRaw);
  if (nonEmpty.length === 0) {
    return { headers: [], rows: [], ...(sheetNames ? { sheetNames } : {}) };
  }
  const headers = nonEmpty[0].map((h) => h.trim());
  const width = headers.length;
  const rows = nonEmpty.slice(1).map((r) => normalizeRowWidth(r, width));
  return { headers, rows, ...(sheetNames ? { sheetNames } : {}) };
}
