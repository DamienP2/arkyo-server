/**
 * Générateur PDF de la liste du matériel — variante « Grille allégée ».
 *
 * Page A4 paysage entièrement cadrée : cartouche d'en-tête en cellules (logo
 * de l'espace — ou son nom à défaut, document, projet, client/lieu, tournage),
 * tableau sans traits verticaux, hiérarchie Emplacement (bande d'encre) →
 * Contenant (ligne grasse soulignée) → items, sous-total par contenant, total
 * par emplacement, pied de page en cellules avec la pagination « n / N ».
 *
 * Générateur DÉDIÉ, distinct de `lib/export/table-pdf.ts` :
 *  - il consomme des lignes TYPÉES (`BomTableRow`) pour dessiner chaque nature
 *    de ligne différemment, là où le générateur partagé ne connaît que des
 *    tableaux plats ;
 *  - son cartouche est métier (espace, client, tournage), données dont les
 *    autres consommateurs du générateur partagé (sections du document
 *    composite : câblage, réseau…) ne disposent pas.
 * Le générateur partagé reste donc inchangé pour ses 8 appels existants.
 *
 * jsPDF est chargé via CDN à la demande. Polices : helvetica + courier du
 * cœur jsPDF (aucun embed).
 */

import { loadJsPDF } from "@/app/(fullscreen)/project/[id]/reseau/_components/shared/export-capture";
import type { TechnicalPageFormat } from "@/lib/export/technical-table-pdf";
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
  RULE,
  WHITE,
  loadImageAsDataUrl,
} from "@/lib/print/technical-frame";

import {
  formatBomPower,
  formatBomWeight,
  type BomTable,
  type BomTableColumn,
  type BomTableRow,
  type BomTotals,
} from "./bom-table";

// ── Cotes (mm) ───────────────────────────────────────────────────────────────
//
// Cotes, registre de traits et couleurs viennent de `lib/print/technical-frame`
// — source unique partagée avec le cartouche « Modèle standard » de l'export
// Rack, qui dessine la même grammaire en SVG. Les alias locaux ci-dessous
// gardent le corps du générateur lisible.

/** Géométrie de page par format — la mise en page coule dans la boîte choisie. */
const PAGE_MM: Record<
  TechnicalPageFormat,
  { w: number; h: number; js: [string, "portrait" | "landscape"] }
> = {
  A4_PORTRAIT: { w: 210, h: 297, js: ["a4", "portrait"] },
  A4_LANDSCAPE: { w: 297, h: 210, js: ["a4", "landscape"] },
  A3_PORTRAIT: { w: 297, h: 420, js: ["a3", "portrait"] },
  A3_LANDSCAPE: { w: 420, h: 297, js: ["a3", "landscape"] },
};

const LW_TOTAL = LW.total; // trait des totaux
const LW_FRAME = LW.frame; // cadre, bordures du cartouche, souligné d'en-têtes
const LW_CELL = LW.cell; // séparateurs de cellules du cartouche / pied
const LW_GROUP = LW.group; // souligné d'un contenant
const LW_HAIR = LW.hair; // filets entre items

const FRAME_X = FRAME_MARGIN;
const FRAME_Y = FRAME_MARGIN;

/** Hauteurs de ligne par nature. */
const ROW_H = {
  columns: 6,
  item: 4.6,
  location: 6.4,
  container: 5.4,
  subtotal: 4.8,
  total: 5.6,
} as const;

// ── Entrée ───────────────────────────────────────────────────────────────────

export type BomPdfEspace = {
  name?: string | null;
  /** URL du logo uploadé — converti en dataURL pour jsPDF. */
  logoUrl?: string | null;
};

/**
 * Données du cartouche. Volontairement RÉDUIT à ce que le cartouche affiche :
 * projet et lieu. Ni client ni dates de tournage — ces informations vivent
 * dans la fiche projet, les répéter sur chaque feuille de l'inventaire n'aide
 * personne à la manutention.
 */
export type BomPdfMeta = {
  projectName?: string | null;
  location?: string | null;
};

export type BomPdfInput = {
  table: BomTable;
  espace?: BomPdfEspace;
  meta?: BomPdfMeta;
  /** Titre du document — cellule DOCUMENT du cartouche. */
  title?: string;
  /** Format de page — défaut : A4 paysage (rendu historique). */
  format?: TechnicalPageFormat;
};

type JsPdfDoc = InstanceType<Awaited<ReturnType<typeof loadJsPDF>>["jsPDF"]>;

// ── Générateur ───────────────────────────────────────────────────────────────

export async function buildBomPdf(
  input: BomPdfInput,
): Promise<{ blob: Blob; pageCount: number }> {
  const { table, espace, meta } = input;
  const title = input.title ?? "Inventaire";
  const geo = PAGE_MM[input.format ?? "A4_LANDSCAPE"];
  const FRAME_W = geo.w - FRAME_MARGIN * 2;
  const FRAME_H = geo.h - FRAME_MARGIN * 2;

  const logo = espace?.logoUrl
    ? await loadImageAsDataUrl(espace.logoUrl)
    : null;

  const { jsPDF } = await loadJsPDF();
  const doc: JsPdfDoc = new jsPDF({
    ...JSPDF_BASE,
    orientation: geo.js[1],
    unit: "mm",
    format: geo.js[0],
  });

  const setFill = (c: typeof INK) => doc.setFillColor(c.r, c.g, c.b);
  const setDraw = (c: typeof INK) => doc.setDrawColor(c.r, c.g, c.b);
  const setText = (c: typeof INK) => doc.setTextColor(c.r, c.g, c.b);
  const line = (x1: number, y1: number, x2: number, y2: number, w: number) => {
    doc.setLineWidth(w);
    doc.line(x1, y1, x2, y2);
  };
  /** Tronque à la largeur disponible, suffixe « … ». */
  const fit = (text: string, maxW: number): string => {
    if (doc.getTextWidth(text) <= maxW) return text;
    let cut = text;
    while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > maxW) {
      cut = cut.slice(0, -1);
    }
    return `${cut}…`;
  };

  // ── Largeurs de colonnes ───────────────────────────────────────────────────
  // `table.columns` porte déjà les colonnes EFFECTIVES : sélection, ordre
  // personnalisé, colonnes à totaux épinglées en fin, et retrait de celles que
  // les bandes de groupe portent (cf. `buildBomTable`).
  const cols = table.columns;
  // Les colonnes numériques ont une largeur fixe (l'alignement à droite porte
  // la lecture) ; le reste se partage l'espace au prorata de poids fixes.
  const innerW = FRAME_W - PAD_X * 2;
  const FIXED: Partial<Record<BomTableColumn["key"], number>> = {
    quantity: 14,
    heightU: 16,
    weight: 20,
    power: 20,
  };
  const WEIGHT: Partial<Record<BomTableColumn["key"], number>> = {
    location: 1.2,
    container: 1.3,
    type: 0.8,
    name: 2.6,
    brand: 1,
    category: 1,
  };
  const fixedTotal = cols.reduce((sum, c) => sum + (FIXED[c.key] ?? 0), 0);
  const weightTotal = cols.reduce(
    (sum, c) => sum + (FIXED[c.key] ? 0 : (WEIGHT[c.key] ?? 1)),
    0,
  );
  const flexSpace = Math.max(20, innerW - fixedTotal);
  const colW = cols.map(
    (c) =>
      FIXED[c.key] ?? (flexSpace * (WEIGHT[c.key] ?? 1)) / (weightTotal || 1),
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
  /** Début de la zone des totaux — les colonnes cumulées, épinglées en fin. */
  const firstTotaledIdx = cols.findIndex((c) => c.totaled);

  // ── Pagination (pré-calcul) ────────────────────────────────────────────────
  const rowHeight = (row: BomTableRow): number =>
    row.kind === "item"
      ? ROW_H.item
      : row.kind === "group-location"
        ? ROW_H.location
        : row.kind === "group-container"
          ? ROW_H.container
          : row.kind === "subtotal"
            ? ROW_H.subtotal
            : ROW_H.total;

  const bodyTop = (pageIndex: number) =>
    FRAME_Y + (pageIndex === 0 ? HEADER_H : HEADER_SLIM_H) + PAD_TOP;
  const bodyBottom = FRAME_Y + FRAME_H - FOOTER_H;

  const pages: BomTableRow[][] = [];
  {
    let current: BomTableRow[] = [];
    let y = bodyTop(0) + ROW_H.columns;
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i]!;
      const h = rowHeight(row);
      // Un titre de groupe seul en bas de page est orphelin : on exige la
      // place pour lui ET la ligne qui suit.
      const needed =
        row.kind === "group-location" || row.kind === "group-container"
          ? h + rowHeight(table.rows[i + 1] ?? row)
          : h;
      if (y + needed > bodyBottom && current.length > 0) {
        pages.push(current);
        current = [];
        y = bodyTop(pages.length) + ROW_H.columns;
      }
      current.push(row);
      y += h;
    }
    pages.push(current);
  }
  const pageCount = pages.length;

  // ── Dessin ────────────────────────────────────────────────────────────────

  const drawFrame = () => {
    setDraw(INK);
    doc.setLineWidth(LW_FRAME);
    doc.rect(FRAME_X, FRAME_Y, FRAME_W, FRAME_H);
  };

  const drawHeaderFull = () => {
    const y0 = FRAME_Y;
    const yBottom = y0 + HEADER_H;
    setDraw(INK);
    line(FRAME_X, yBottom, FRAME_X + FRAME_W, yBottom, LW_FRAME);

    // Cellule 1 : le logo de l'espace S'IL EXISTE, seul et centré — il porte
    // l'identité. Sinon, le nom en toutes lettres, même rôle.
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
    line(
      FRAME_X + LOGO_CELL_W,
      y0,
      FRAME_X + LOGO_CELL_W,
      yBottom,
      LW_CELL,
    );

    // Cellules d'information. Le projet est l'information dominante : il vient
    // juste après le logo, en corps de titre, sur la cellule la plus large.
    const rest = FRAME_W - LOGO_CELL_W;
    const cells: Array<{
      label: string;
      value: string;
      flex: number;
      big?: boolean;
    }> = [
      {
        label: "PROJET",
        value: meta?.projectName?.trim() || "—",
        flex: 2,
        big: true,
      },
      { label: "LIEU", value: meta?.location?.trim() || "—", flex: 1.1 },
      { label: "DOCUMENT", value: title, flex: 0.8 },
    ];
    const sum = cells.reduce((a, c) => a + c.flex, 0);
    let x = FRAME_X + LOGO_CELL_W;
    cells.forEach((cell, i) => {
      const w = (rest * cell.flex) / sum;
      doc.setFont("courier", "normal");
      doc.setFontSize(7);
      setText(MUTED);
      doc.text(cell.label, x + 5, y0 + 5);
      doc.setFont("helvetica", cell.big ? "bold" : "normal");
      doc.setFontSize(cell.big ? 14 : 10);
      setText(INK);
      doc.text(fit(cell.value, w - 10), x + 5, y0 + 11);
      x += w;
      if (i < cells.length - 1) {
        setDraw(INK);
        line(x, y0, x, yBottom, LW_CELL);
      }
    });
  };

  /** Pages 2+ : rappel d'une ligne, le cadre reste fermé. */
  const drawHeaderSlim = () => {
    const yBottom = FRAME_Y + HEADER_SLIM_H;
    setDraw(INK);
    line(FRAME_X, yBottom, FRAME_X + FRAME_W, yBottom, LW_FRAME);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setText(INK);
    // Même hiérarchie que le cartouche : le projet d'abord, le document ensuite.
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
    line(FRAME_X, yTop, FRAME_X + FRAME_W, yTop, LW_FRAME);
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
      line(xName, yTop, xName, yTop + FOOTER_H, LW_CELL);
    }
    setDraw(INK);
    line(xSheet, yTop, xSheet, yTop + FOOTER_H, LW_CELL);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.text(sheet, xSheet + 5, baseline);
  };

  /** Rangée d'en-tête de colonnes — répétée sur chaque page. */
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
      y + ROW_H.columns - 1,
      tableRight,
      y + ROW_H.columns - 1,
      LW_FRAME,
    );
    return y + ROW_H.columns;
  };

  /** Valeurs numériques d'un total, alignées sur leurs colonnes. */
  const drawTotalsCells = (
    y: number,
    totals: BomTotals,
    opts: { bold: boolean; ruleWidth: number },
  ) => {
    doc.setFont("courier", opts.bold ? "bold" : "normal");
    doc.setFontSize(8.5);
    setText(INK);
    cols.forEach((c, i) => {
      // Seules les colonnes CUMULÉES portent un total — « Quantité » est
      // chiffrée mais jamais additionnée.
      if (!c.totaled) return;
      const value =
        c.key === "weight"
          ? String(formatBomWeight(totals.weightKg) || "")
          : c.key === "power"
            ? String(formatBomPower(totals.powerW) || "")
            : "";
      if (!value) return;
      setDraw(opts.bold ? INK : RULE);
      line(colX[i]!, y - 0.6, colX[i]! + colW[i]!, y - 0.6, opts.ruleWidth);
      doc.text(value, colX[i]! + colW[i]! - 2, y + 3.4, { align: "right" });
    });
  };

  pages.forEach((rows, pageIndex) => {
    if (pageIndex > 0) doc.addPage(geo.js[0], geo.js[1]);
    drawFrame();
    if (pageIndex === 0) drawHeaderFull();
    else drawHeaderSlim();
    drawFooter(pageIndex + 1);

    let y = bodyTop(pageIndex);
    y = drawColumnHeader(y);

    for (const row of rows) {
      const h = rowHeight(row);
      switch (row.kind) {
        case "group-location": {
          // Bande d'encre pleine, texte négatif, pastille carrée dessinée
          // (pas de glyphe : les polices cœur de jsPDF n'ont pas « ■ »).
          const bandY = y + 1;
          const bandH = h - 2;
          setFill(INK);
          doc.rect(FRAME_X + PAD_X, bandY, tableRight - FRAME_X - PAD_X, bandH, "F");
          setFill(WHITE);
          doc.rect(FRAME_X + PAD_X + 3, bandY + bandH / 2 - 1, 2, 2, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9.5);
          setText(WHITE);
          doc.text(
            fit(row.label, tableRight - FRAME_X - PAD_X - 16),
            FRAME_X + PAD_X + 8,
            bandY + bandH / 2 + 1.3,
          );
          break;
        }
        case "group-container": {
          const x = FRAME_X + PAD_X + 5;
          doc.setFont("helvetica", row.free ? "bolditalic" : "bold");
          doc.setFontSize(9);
          setText(row.free ? MUTED : INK);
          const label = fit(row.label, tableRight - x - 40);
          doc.text(label, x, y + 3.6);
          if (row.meta) {
            const afterX = x + doc.getTextWidth(label) + 2.5;
            doc.setFont("courier", "normal");
            doc.setFontSize(7.5);
            setText(MUTED);
            doc.text(`· ${row.meta}`, afterX, y + 3.6);
          }
          setDraw(INK);
          line(FRAME_X + PAD_X, y + h - 0.8, tableRight, y + h - 0.8, LW_GROUP);
          break;
        }
        case "item": {
          setText(INK);
          cols.forEach((c, i) => {
            const raw = row.cells[i];
            const value = raw === null || raw === undefined ? "" : String(raw);
            if (!value) return;
            const mono = c.numeric;
            doc.setFont(mono ? "courier" : "helvetica", "normal");
            doc.setFontSize(mono ? 8.5 : 9);
            if (c.numeric) {
              doc.text(
                fit(value, colW[i]! - 2),
                colX[i]! + colW[i]! - 2,
                y + 3.3,
                { align: "right" },
              );
            } else {
              // Retrait de la 1re colonne pour aligner les items sous le
              // libellé de leur groupe — sans regroupement, pas de retrait.
              const indent = i === 0 && table.groupBy !== "none" ? 5 : 0;
              doc.text(
                fit(value, colW[i]! - 3 - indent),
                colX[i]! + indent,
                y + 3.3,
              );
            }
          });
          setDraw(HAIR);
          line(FRAME_X + PAD_X, y + h - 0.4, tableRight, y + h - 0.4, LW_HAIR);
          break;
        }
        case "subtotal": {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          setText(MUTED);
          const labelRight =
            firstTotaledIdx === -1 ? tableRight : colX[firstTotaledIdx]! - 3;
          doc.text(row.label, labelRight, y + 3.4, { align: "right" });
          drawTotalsCells(y, row.totals, { bold: false, ruleWidth: LW_CELL });
          break;
        }
        case "total": {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8.5);
          setText(INK);
          const labelRight =
            firstTotaledIdx === -1 ? tableRight : colX[firstTotaledIdx]! - 3;
          doc.text(
            fit(row.label, labelRight - FRAME_X - PAD_X),
            labelRight,
            y + 3.6,
            { align: "right" },
          );
          drawTotalsCells(y, row.totals, { bold: true, ruleWidth: LW_TOTAL });
          break;
        }
      }
      y += h;
    }
  });

  return { blob: doc.output("blob") as Blob, pageCount };
}
