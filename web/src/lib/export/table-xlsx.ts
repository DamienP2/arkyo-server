// ── Builder XLSX (.xlsx réel) — SheetJS chargé via CDN ─────────────────────
//
// Même pattern que `loadJsPDF` (reseau/_components/shared/export-capture.ts) :
// script CDN injecté à la demande + cache module — aucune dépendance npm.
// Typage minimal local de la surface SheetJS utilisée (pas de @types).

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type XlsxCellValue = string | number | null;

export type XlsxColumn = {
  /** Clé de la valeur dans les `rows`. */
  key: string;
  /** Libellé de l'en-tête (1ʳᵉ ligne de la feuille). */
  label: string;
};

export type XlsxSheetSpec = {
  sheetName: string;
  columns: XlsxColumn[];
  rows: Array<Record<string, XlsxCellValue>>;
};

// ── Typage minimal SheetJS ──────────────────────────────────────────────────

type SheetJsWorksheet = {
  "!cols"?: Array<{ wch: number }>;
};

type SheetJsWorkbook = {
  SheetNames: string[];
};

type SheetJsModule = {
  utils: {
    book_new: () => SheetJsWorkbook;
    aoa_to_sheet: (data: XlsxCellValue[][]) => SheetJsWorksheet;
    book_append_sheet: (
      wb: SheetJsWorkbook,
      ws: SheetJsWorksheet,
      name?: string,
    ) => void;
  };
  write: (
    wb: SheetJsWorkbook,
    opts: { bookType: "xlsx"; type: "array" },
  ) => ArrayBuffer;
};

// ── Loader CDN avec cache module ────────────────────────────────────────────

// arkyo-server: bundlé (hors ligne) — SheetJS vient du paquet npm `xlsx`
// (import dynamique, chunk séparé) au lieu du script CDN injecté
// (`SHEETJS_CDN_URL` et `<script>` retirés) : le serveur tourne en réseau local.

let sheetJsPromise: Promise<SheetJsModule> | null = null;

export function loadSheetJS(): Promise<SheetJsModule> {
  if (sheetJsPromise) return sheetJsPromise;
  sheetJsPromise = import("xlsx").then((m) => m as unknown as SheetJsModule); // arkyo-server: bundlé (hors ligne)
  // En cas d'échec (offline…), on invalide le cache pour permettre un retry.
  sheetJsPromise.catch(() => {
    sheetJsPromise = null;
  });
  return sheetJsPromise;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Noms de feuille Excel : max 31 caractères, sans []:*?/\ ni vide. */
function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").trim();
  return (cleaned || "Feuille").slice(0, 31);
}

/** Largeurs de colonnes approximatives (autofit) : max(len) borné [6, 60]. */
function computeColumnWidths(
  columns: XlsxColumn[],
  data: XlsxCellValue[][],
): Array<{ wch: number }> {
  return columns.map((col, j) => {
    let width = col.label.length;
    for (const row of data) {
      const v = row[j];
      if (v == null) continue;
      const len = String(v).length;
      if (len > width) width = len;
    }
    return { wch: Math.min(Math.max(width + 2, 6), 60) };
  });
}

// ── Builders ────────────────────────────────────────────────────────────────

/**
 * Construit un classeur `.xlsx` multi-feuilles. Première ligne de chaque
 * feuille = labels des colonnes ; les nombres restent typés nombre.
 */
export async function buildXlsxBlobMulti(
  sheets: XlsxSheetSpec[],
): Promise<Blob> {
  const XLSX = await loadSheetJS();
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  for (const sheet of sheets) {
    const data = sheet.rows.map((row) =>
      sheet.columns.map((col) => row[col.key] ?? null),
    );
    const ws = XLSX.utils.aoa_to_sheet([
      sheet.columns.map((c) => c.label),
      ...data,
    ]);
    ws["!cols"] = computeColumnWidths(sheet.columns, data);

    // Dédoublonne les noms de feuille (contrainte Excel : unicité).
    let name = sanitizeSheetName(sheet.sheetName);
    let n = 2;
    while (usedNames.has(name)) {
      name = `${sanitizeSheetName(sheet.sheetName).slice(0, 28)} ${n}`;
      n += 1;
    }
    usedNames.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], { type: XLSX_MIME });
}

/** Construit un classeur `.xlsx` à feuille unique. */
export function buildXlsxBlob(sheet: XlsxSheetSpec): Promise<Blob> {
  return buildXlsxBlobMulti([sheet]);
}
