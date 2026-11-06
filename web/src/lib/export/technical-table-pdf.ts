/**
 * Générateur de LISTE technique — grammaire « grille allégée » (3B).
 *
 * Même vocabulaire que le cartouche standard et que la liste du matériel :
 * cadre fin, cartouche en cellules (logo · PROJET · LIEU · DOCUMENT), en-têtes
 * de colonnes en mono soulignés, filets entre lignes, pied paginé « n / N ».
 *
 * ── Pourquoi il existe ────────────────────────────────────────────────────
 * `lib/export/table-pdf.ts` rend un tableau correct mais dans un autre
 * registre — bande ambre, helvetica, sans cadre. Dans un dossier ouvert par
 * une page de garde 3B et refermé sur des plans 3B, ces listes juraient. Or la
 * cohérence d'un dossier technique n'est pas une coquetterie : c'est ce qui le
 * fait lire comme UN document plutôt que comme une agrafe de fichiers.
 *
 * ── Pourquoi il ne remplace pas `bom-pdf.ts` ──────────────────────────────
 * L'inventaire consomme des lignes TYPÉES (emplacement, contenant, item,
 * sous-total, total) qu'il dessine différemment, et cumule des colonnes. Ici,
 * les lignes sont plates. Vouloir un seul générateur pour les deux aurait
 * donné un moteur paramétrable que personne ne saurait plus lire.
 *
 * jsPDF est chargé via CDN à la demande. Polices : helvetica + courier du
 * cœur jsPDF, aucun embarquement.
 */

import { loadJsPDF } from "@/app/(fullscreen)/project/[id]/reseau/_components/shared/export-capture";
import { JSPDF_BASE } from "@/lib/pdf/load-jspdf";
import {
  FOOTER_H,
  FRAME_MARGIN,
  HAIR,
  HEADER_H,
  HEADER_SLIM_H,
  INK,
  LOGO_CELL_W,
  LW,
  MUTED,
  PAD_TOP,
  PAD_X,
  loadImageAsDataUrl,
} from "@/lib/print/technical-frame";

// ── Format de page ───────────────────────────────────────────────────────────

export type TechnicalPageFormat =
  | "A4_PORTRAIT"
  | "A4_LANDSCAPE"
  | "A3_PORTRAIT"
  | "A3_LANDSCAPE";

export const TECHNICAL_PAGE_FORMATS: ReadonlyArray<{
  value: TechnicalPageFormat;
  label: string;
}> = [
  { value: "A4_PORTRAIT", label: "A4 portrait" },
  { value: "A4_LANDSCAPE", label: "A4 paysage" },
  { value: "A3_PORTRAIT", label: "A3 portrait" },
  { value: "A3_LANDSCAPE", label: "A3 paysage" },
] as const;

export const DEFAULT_TECHNICAL_FORMAT: TechnicalPageFormat = "A4_LANDSCAPE";

export function isTechnicalPageFormat(v: unknown): v is TechnicalPageFormat {
  return (
    v === "A4_PORTRAIT" ||
    v === "A4_LANDSCAPE" ||
    v === "A3_PORTRAIT" ||
    v === "A3_LANDSCAPE"
  );
}

/** Papier et orientation, DÉCORRÉLÉS — les deux axes que l'interface propose. */
export function technicalFormatOf(
  paper: "A4" | "A3",
  orientation: "PORTRAIT" | "LANDSCAPE",
): TechnicalPageFormat {
  return `${paper}_${orientation}` as TechnicalPageFormat;
}

export function technicalFormatParts(format: TechnicalPageFormat): {
  paper: "A4" | "A3";
  orientation: "PORTRAIT" | "LANDSCAPE";
} {
  const [paper, orientation] = format.split("_") as [
    "A4" | "A3",
    "PORTRAIT" | "LANDSCAPE",
  ];
  return { paper, orientation };
}

const PAGE_MM: Record<
  TechnicalPageFormat,
  { w: number; h: number; orientation: "portrait" | "landscape"; jsFormat: string }
> = {
  A4_PORTRAIT: { w: 210, h: 297, orientation: "portrait", jsFormat: "a4" },
  A4_LANDSCAPE: { w: 297, h: 210, orientation: "landscape", jsFormat: "a4" },
  A3_PORTRAIT: { w: 297, h: 420, orientation: "portrait", jsFormat: "a3" },
  A3_LANDSCAPE: { w: 420, h: 297, orientation: "landscape", jsFormat: "a3" },
};

// ── Entrée ───────────────────────────────────────────────────────────────────

export type TechnicalTableColumn = {
  label: string;
  /** Aligné à droite, largeur resserrée. Déduit des données si omis. */
  numeric?: boolean;
  /** Poids de répartition de l'espace restant. Défaut : 1. */
  weight?: number;
};

export type TechnicalTableMeta = {
  projectName?: string | null;
  location?: string | null;
};

export type TechnicalTableEspace = {
  name?: string | null;
  logoUrl?: string | null;
};

export type TechnicalTableInput = {
  /** Cellule DOCUMENT du cartouche et pied de page. */
  title: string;
  columns: Array<string | TechnicalTableColumn>;
  rows: Array<Array<string | number | null | undefined>>;
  meta?: TechnicalTableMeta;
  espace?: TechnicalTableEspace;
  /** Date d'édition — non imprimée pour l'instant, réservée au cartouche. */
  stamp?: string;
  format?: TechnicalPageFormat;
};

// ── Cotes ────────────────────────────────────────────────────────────────────

const ROW_H = 4.6;
const COLUMNS_ROW_H = 6;
/** Largeur d'une colonne numérique — l'alignement à droite porte la lecture. */
const NUMERIC_W = 18;

type JsPdfDoc = InstanceType<Awaited<ReturnType<typeof loadJsPDF>>["jsPDF"]>;

// ── Générateur ───────────────────────────────────────────────────────────────

export async function buildTechnicalTablePdf(
  input: TechnicalTableInput,
): Promise<{ blob: Blob; pageCount: number }> {
  const { title, rows, meta, espace } = input;
  const page = PAGE_MM[input.format ?? DEFAULT_TECHNICAL_FORMAT];

  const cols: TechnicalTableColumn[] = input.columns.map((c, i) =>
    typeof c === "string"
      ? {
          label: c,
          // Détection : une colonne dont TOUTES les valeurs renseignées sont
          // des nombres se lit alignée à droite. Déduire vaut mieux
          // qu'imposer à chaque appelant de le déclarer.
          numeric:
            rows.length > 0 &&
            rows.every((r) => {
              const v = r[i];
              return v == null || v === "" || typeof v === "number";
            }),
        }
      : c,
  );

  const logo = espace?.logoUrl ? await loadImageAsDataUrl(espace.logoUrl) : null;

  const { jsPDF } = await loadJsPDF();
  const doc: JsPdfDoc = new jsPDF({
    ...JSPDF_BASE,
    orientation: page.orientation,
    unit: "mm",
    format: page.jsFormat,
  });

  const FRAME_X = FRAME_MARGIN;
  const FRAME_Y = FRAME_MARGIN;
  const FRAME_W = page.w - FRAME_MARGIN * 2;
  const FRAME_H = page.h - FRAME_MARGIN * 2;

  const setFill = (c: typeof INK) => doc.setFillColor(c.r, c.g, c.b);
  const setDraw = (c: typeof INK) => doc.setDrawColor(c.r, c.g, c.b);
  const setText = (c: typeof INK) => doc.setTextColor(c.r, c.g, c.b);
  const line = (x1: number, y1: number, x2: number, y2: number, w: number) => {
    doc.setLineWidth(w);
    doc.line(x1, y1, x2, y2);
  };
  const fit = (text: string, maxW: number): string => {
    if (maxW <= 0) return "";
    if (doc.getTextWidth(text) <= maxW) return text;
    let cut = text;
    while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > maxW) {
      cut = cut.slice(0, -1);
    }
    return `${cut}…`;
  };

  // ── Largeurs de colonnes ───────────────────────────────────────────────────
  const innerW = FRAME_W - PAD_X * 2;
  const numericTotal = cols.reduce((s, c) => s + (c.numeric ? NUMERIC_W : 0), 0);
  const weightTotal = cols.reduce(
    (s, c) => s + (c.numeric ? 0 : (c.weight ?? 1)),
    0,
  );
  const flexSpace = Math.max(20, innerW - numericTotal);
  const colW = cols.map((c) =>
    c.numeric ? NUMERIC_W : (flexSpace * (c.weight ?? 1)) / (weightTotal || 1),
  );
  const colX: number[] = [];
  {
    let x = FRAME_X + PAD_X;
    for (const w of colW) {
      colX.push(x);
      x += w;
    }
  }
  const tableRight = FRAME_X + FRAME_W - PAD_X;

  // ── Pagination (pré-calcul) ────────────────────────────────────────────────
  const bodyTop = (pageIndex: number) =>
    FRAME_Y + (pageIndex === 0 ? HEADER_H : HEADER_SLIM_H) + PAD_TOP;
  const bodyBottom = FRAME_Y + FRAME_H - FOOTER_H;

  const pages: Array<typeof rows> = [];
  {
    let current: typeof rows = [];
    let y = bodyTop(0) + COLUMNS_ROW_H;
    for (const row of rows) {
      if (y + ROW_H > bodyBottom && current.length > 0) {
        pages.push(current);
        current = [];
        y = bodyTop(pages.length) + COLUMNS_ROW_H;
      }
      current.push(row);
      y += ROW_H;
    }
    pages.push(current);
  }
  const pageCount = pages.length;

  // ── Dessin ────────────────────────────────────────────────────────────────

  const drawFrame = () => {
    setDraw(INK);
    doc.setLineWidth(LW.frame);
    doc.rect(FRAME_X, FRAME_Y, FRAME_W, FRAME_H);
  };

  const drawHeaderFull = () => {
    const y0 = FRAME_Y;
    const yBottom = y0 + HEADER_H;
    setDraw(INK);
    line(FRAME_X, yBottom, FRAME_X + FRAME_W, yBottom, LW.frame);

    // Le logo de l'espace S'IL EXISTE, seul et centré — il porte l'identité.
    // Sinon le nom en toutes lettres, même rôle. Jamais les deux.
    const name = (espace?.name ?? "").trim();
    if (logo) {
      const availW = LOGO_CELL_W - 10;
      const availH = HEADER_H - 5;
      let logoH = availH;
      let logoW = logoH * logo.ratio;
      if (logoW > availW) {
        logoW = availW;
        logoH = logoW / logo.ratio;
      }
      doc.addImage(
        logo.dataUrl,
        "PNG",
        FRAME_X + (LOGO_CELL_W - logoW) / 2,
        y0 + (HEADER_H - logoH) / 2,
        logoW,
        logoH,
      );
    } else if (name) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      setText(INK);
      doc.text(
        fit(name.toUpperCase(), LOGO_CELL_W - 10),
        FRAME_X + 5,
        y0 + HEADER_H / 2 + 1.2,
      );
    }
    setDraw(INK);
    line(FRAME_X + LOGO_CELL_W, y0, FRAME_X + LOGO_CELL_W, yBottom, LW.cell);

    const rest = FRAME_W - LOGO_CELL_W;
    const cells = [
      {
        label: "PROJET",
        value: meta?.projectName?.trim() || "—",
        flex: 2,
        big: true,
        split: false,
      },
      {
        label: "LIEU",
        value: meta?.location?.trim() || "—",
        flex: 1.1,
        big: false,
        split: false,
      },
      // La cellule DOCUMENT se lit sur DEUX lignes quand le titre porte une
      // famille (« Préparation — Contenants ») : la famille au-dessus, le
      // document en dessous — comme la feuille HTML de l'aperçu.
      { label: "DOCUMENT", value: title, flex: 0.8, big: false, split: true },
    ];
    const sum = cells.reduce((a, c) => a + c.flex, 0);
    let x = FRAME_X + LOGO_CELL_W;
    cells.forEach((cell, i) => {
      const w = (rest * cell.flex) / sum;
      doc.setFont("courier", "normal");
      doc.setFontSize(7);
      setText(MUTED);
      doc.text(cell.label, x + 5, y0 + 5);
      const dash = cell.split ? cell.value.indexOf(" — ") : -1;
      if (dash >= 0) {
        const l1 = cell.value.slice(0, dash);
        const l2 = cell.value.slice(dash + 3);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        setText(INK);
        doc.text(fit(l1, w - 10), x + 5, y0 + 8.8);
        doc.text(fit(l2, w - 10), x + 5, y0 + 12.4);
      } else {
        doc.setFont("helvetica", cell.big ? "bold" : "normal");
        doc.setFontSize(cell.big ? 14 : 10);
        setText(INK);
        doc.text(fit(cell.value, w - 10), x + 5, y0 + 11);
      }
      x += w;
      if (i < cells.length - 1) {
        setDraw(INK);
        line(x, y0, x, yBottom, LW.cell);
      }
    });
  };

  /** Pages 2+ : rappel d'une ligne, le cadre reste fermé. */
  const drawHeaderSlim = () => {
    const yBottom = FRAME_Y + HEADER_SLIM_H;
    setDraw(INK);
    line(FRAME_X, yBottom, FRAME_X + FRAME_W, yBottom, LW.frame);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setText(INK);
    doc.text(
      fit(
        [meta?.projectName?.trim(), title].filter(Boolean).join(" — "),
        FRAME_W - 60,
      ),
      FRAME_X + 5,
      FRAME_Y + 4.8,
    );
    const name = (espace?.name ?? "").trim();
    if (name) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      setText(MUTED);
      doc.text(name, FRAME_X + FRAME_W - 5, FRAME_Y + 4.8, { align: "right" });
    }
  };

  const drawFooter = (pageNum: number) => {
    const yTop = FRAME_Y + FRAME_H - FOOTER_H;
    setDraw(INK);
    line(FRAME_X, yTop, FRAME_X + FRAME_W, yTop, LW.frame);
    const baseline = yTop + 4.6;

    const sheet = `${pageNum} / ${pageCount}`;
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    const sheetW = doc.getTextWidth(sheet) + 10;
    const name = (espace?.name ?? "").trim();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const nameW = name ? doc.getTextWidth(name) + 10 : 0;

    const xSheet = FRAME_X + FRAME_W - sheetW;
    const xName = xSheet - nameW;

    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const left = `${meta?.projectName ? `${meta.projectName} — ` : ""}${title}`;
    doc.text(fit(left, xName - FRAME_X - 10), FRAME_X + 5, baseline);
    if (name) {
      doc.text(name, xName + 5, baseline);
      setDraw(INK);
      line(xName, yTop, xName, yTop + FOOTER_H, LW.cell);
    }
    setDraw(INK);
    line(xSheet, yTop, xSheet, yTop + FOOTER_H, LW.cell);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.text(sheet, xSheet + 5, baseline);
  };

  const drawColumnHeader = (y: number): number => {
    doc.setFont("courier", "normal");
    doc.setFontSize(7.5);
    setText(MUTED);
    cols.forEach((c, i) => {
      const label = c.label.toUpperCase();
      if (c.numeric) {
        doc.text(fit(label, colW[i]! - 2), colX[i]! + colW[i]! - 2, y + 3.6, {
          align: "right",
        });
      } else {
        doc.text(fit(label, colW[i]! - 3), colX[i]!, y + 3.6);
      }
    });
    setDraw(INK);
    line(
      FRAME_X + PAD_X,
      y + COLUMNS_ROW_H - 1,
      tableRight,
      y + COLUMNS_ROW_H - 1,
      LW.frame,
    );
    return y + COLUMNS_ROW_H;
  };

  const drawRow = (
    y: number,
    row: (typeof rows)[number],
    isLast: boolean,
  ): number => {
    doc.setFontSize(8.5);
    setText(INK);
    cols.forEach((c, i) => {
      const raw = row[i];
      const value = raw == null ? "" : String(raw);
      if (!value) return;
      // Les valeurs numériques en mono : elles s'alignent chiffre à chiffre,
      // ce qu'une police proportionnelle ne fait pas.
      doc.setFont(c.numeric ? "courier" : "helvetica", "normal");
      if (c.numeric) {
        doc.text(fit(value, colW[i]! - 2), colX[i]! + colW[i]! - 2, y + 3.2, {
          align: "right",
        });
      } else {
        doc.text(fit(value, colW[i]! - 3), colX[i]!, y + 3.2);
      }
    });
    if (!isLast) {
      setDraw(HAIR);
      line(FRAME_X + PAD_X, y + ROW_H, tableRight, y + ROW_H, LW.hair);
    }
    return y + ROW_H;
  };

  // ── Assemblage ────────────────────────────────────────────────────────────
  pages.forEach((pageRows, index) => {
    if (index > 0) doc.addPage(page.jsFormat, page.orientation);
    setFill(INK);
    drawFrame();
    if (index === 0) drawHeaderFull();
    else drawHeaderSlim();
    drawFooter(index + 1);

    let y = bodyTop(index);
    y = drawColumnHeader(y);
    pageRows.forEach((row, i) => {
      y = drawRow(y, row, i === pageRows.length - 1);
    });
  });

  return { blob: doc.output("blob") as Blob, pageCount };
}
