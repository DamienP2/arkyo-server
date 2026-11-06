// arkyo-server: bouchon phase 4a (Task 12), remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/inventaire/_lib/bom-pdf.ts).
// Mêmes types d'entrée (:91-118) ; `buildBomPdf` n'est appelé que par le
// dossier (bouchon de la phase 6) : il échoue avec un message explicite.
import type { BomTable } from "./bom-table";

/** arkyo:lib/export/technical-table-pdf.ts:44-48. */
type TechnicalPageFormat =
  | "A4_PORTRAIT"
  | "A4_LANDSCAPE"
  | "A3_PORTRAIT"
  | "A3_LANDSCAPE";

export type BomPdfEspace = {
  name?: string | null;
  logoUrl?: string | null;
};

export type BomPdfMeta = {
  projectName?: string | null;
  location?: string | null;
};

export type BomPdfInput = {
  table: BomTable;
  espace?: BomPdfEspace;
  meta?: BomPdfMeta;
  title?: string;
  format?: TechnicalPageFormat;
};

export async function buildBomPdf(
  _input: BomPdfInput,
): Promise<{ blob: Blob; pageCount: number }> {
  throw new Error("Export PDF de l'inventaire : bientôt disponible.");
}
