// ── Helper PDF — tableau A4 paysage avec en-tête riche et accent coloré ────
//
// jsPDF chargé via CDN à la demande (cf. lib/pdf/synoptic-export.ts) — pas
// d'ajout au bundle, pas de dépendance npm.
//
// Le PDF généré reprend l'identité Arkyo :
//   - Bande accent en haut (couleur de la section)
//   - Titre de section + nom du projet
//   - Bloc méta-données (client, lieu, dates) sur la 1ʳᵉ page
//   - En-tête de tableau coloré
//   - Lignes alternées subtiles
//   - Pied de page (nom projet · pagination · date d'export)

// arkyo-server: bundlé (hors ligne) : `ensureJsPdf` remplace le <script> du CDN.
import { JSPDF_BASE, ensureJsPdf } from "@/lib/pdf/load-jspdf";

export type ExportPdfMeta = {
  projectName?: string;
  clientName?: string | null;
  location?: string | null;
  shootingDate?: string | null;
  shootingEndDate?: string | null;
  commissioningDate?: string | null;
};

export type RGB = { r: number; g: number; b: number };

const ACCENT_DEFAULT: RGB = { r: 245, g: 158, b: 11 }; // ambre

export async function exportTableToPdf({
  title,
  stamp,
  headers,
  rows,
  filename,
  meta,
  accentColor = ACCENT_DEFAULT,
}: {
  /** Titre de la section (« Adressage IP », « Adressage 2110 », …). */
  title: string;
  /** Date d'export formatée (YYYY-MM-DD). */
  stamp: string;
  headers: string[];
  rows: string[][];
  filename: string;
  /** Méta-données du projet — affichées sur la 1ʳᵉ page si présentes. */
  meta?: ExportPdfMeta;
  /** Couleur d'accent — défaut ambre Arkyo. */
  accentColor?: RGB;
}) {
  const { jsPDF } = await loadJsPDF();
  const doc = new jsPDF({
    ...JSPDF_BASE,
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  // ── Dimensions ──────────────────────────────────────────────────────────
  const pageW = 297;
  const pageH = 210;
  const margin = 12;
  const accent = accentColor;

  // ── Helpers de couleurs ─────────────────────────────────────────────────
  const setFill = (rgb: RGB | [number, number, number]) => {
    if (Array.isArray(rgb)) doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    else doc.setFillColor(rgb.r, rgb.g, rgb.b);
  };
  const setDraw = (rgb: RGB | [number, number, number]) => {
    if (Array.isArray(rgb)) doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
    else doc.setDrawColor(rgb.r, rgb.g, rgb.b);
  };
  const setText = (rgb: RGB | [number, number, number]) => {
    if (Array.isArray(rgb)) doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    else doc.setTextColor(rgb.r, rgb.g, rgb.b);
  };

  // ── Bande accent en tête (page 1) ───────────────────────────────────────
  setFill(accent);
  doc.rect(0, 0, pageW, 2, "F");

  // Logo Arkyo (simple texte)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  setText({ r: 80, g: 80, b: 90 });
  // arkyo-server: habillage Strata (nom affiché, spec Strata §6)
  doc.text("STRATA ARKYO", margin, 9);

  // Titre section — gros + en accent
  doc.setFontSize(18);
  setText(accent);
  doc.text(title.toUpperCase(), margin, 17);

  // Nom du projet (sous le titre)
  if (meta?.projectName) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    setText({ r: 60, g: 60, b: 70 });
    doc.text(meta.projectName, margin, 23);
  }

  // Date d'export — coin haut droit
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText({ r: 130, g: 130, b: 140 });
  doc.text(`Export du ${stamp}`, pageW - margin, 9, { align: "right" });

  // ── Bloc méta-données (client / lieu / dates) sur 1 ligne ──────────────
  const hasMeta = !!(
    meta &&
    (meta.clientName ||
      meta.location ||
      meta.shootingDate ||
      meta.shootingEndDate ||
      meta.commissioningDate)
  );
  let cursorY = meta?.projectName ? 29 : 24;
  if (hasMeta) {
    // Fond léger derrière les méta
    setFill([249, 250, 251]);
    doc.rect(margin, cursorY, pageW - margin * 2, 9, "F");
    setDraw({ r: accent.r, g: accent.g, b: accent.b });
    doc.setLineWidth(0.6);
    doc.line(margin, cursorY, margin, cursorY + 9);

    const items: Array<{ label: string; value: string }> = [];
    if (meta?.clientName) items.push({ label: "Client", value: meta.clientName });
    if (meta?.location) items.push({ label: "Lieu", value: meta.location });
    const dateStr = formatDateRange(meta?.shootingDate, meta?.shootingEndDate);
    if (dateStr) items.push({ label: "Tournage", value: dateStr });
    if (meta?.commissioningDate)
      items.push({
        label: "Mise en service",
        value: formatDate(meta.commissioningDate),
      });

    if (items.length > 0) {
      const colW = (pageW - margin * 2 - 4) / items.length;
      items.forEach((it, i) => {
        const x = margin + 4 + i * colW;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        setText({ r: accent.r, g: accent.g, b: accent.b });
        doc.text(it.label.toUpperCase(), x, cursorY + 3.5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        setText({ r: 40, g: 40, b: 50 });
        // Tronque si trop long
        const maxChars = Math.floor((colW - 2) / 1.8);
        const display =
          it.value.length > maxChars
            ? it.value.slice(0, Math.max(1, maxChars - 1)) + "…"
            : it.value;
        doc.text(display, x, cursorY + 7.5);
      });
    }
    cursorY += 13;
  } else {
    cursorY += 3;
  }

  // ── Table ──────────────────────────────────────────────────────────────
  const cols = headers.length;
  if (cols === 0) {
    doc.save(filename);
    return;
  }
  const tableX = margin;
  const tableY = cursorY;
  const tableW = pageW - margin * 2;
  const colW = tableW / cols;
  const rowH = 6.5;
  const footerH = 10; // espace réservé en bas
  const maxRowY = pageH - margin - footerH;

  const drawTableHeader = (y: number) => {
    setFill(accent);
    doc.rect(tableX, y, tableW, rowH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setText({ r: 255, g: 255, b: 255 });
    headers.forEach((h, i) => {
      doc.text(h, tableX + colW * i + 2, y + rowH * 0.7);
    });
  };

  const drawPageFooter = (pageNum: number, totalPages: number) => {
    setDraw({ r: 230, g: 230, b: 235 });
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - 9, pageW - margin, pageH - 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText({ r: 130, g: 130, b: 140 });
    const left = meta?.projectName
      ? `${meta.projectName} — ${title}`
      : title;
    doc.text(left, margin, pageH - 5);
    doc.text(
      `Page ${pageNum} / ${totalPages}`,
      pageW / 2,
      pageH - 5,
      { align: "center" },
    );
    doc.text(`Exporté le ${stamp}`, pageW - margin, pageH - 5, {
      align: "right",
    });
  };

  // 1ʳᵉ passe : on calcule le nombre de pages pour pouvoir afficher « Page X / Y ».
  // Approche simple : on simule sans dessiner, juste pour compter.
  let estimatedPages = 1;
  {
    let y = tableY + rowH;
    for (let i = 0; i < rows.length; i++) {
      if (y + rowH > maxRowY) {
        estimatedPages += 1;
        y = margin + rowH; // header re-rendu + 1 row
      }
      y += rowH;
    }
  }

  drawTableHeader(tableY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  setText({ r: 30, g: 30, b: 40 });

  let y = tableY + rowH;
  let pageNum = 1;
  let rowIdx = 0;
  for (const row of rows) {
    if (y + rowH > maxRowY) {
      drawPageFooter(pageNum, estimatedPages);
      doc.addPage();
      pageNum += 1;
      // Bande accent en haut sur chaque page suivante (allégée)
      setFill(accent);
      doc.rect(0, 0, pageW, 1.2, "F");
      y = margin;
      drawTableHeader(y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      setText({ r: 30, g: 30, b: 40 });
      y += rowH;
    }
    // Zebra léger (1 ligne sur 2 fond très subtil)
    if (rowIdx % 2 === 1) {
      setFill([250, 250, 252]);
      doc.rect(tableX, y, tableW, rowH, "F");
    }
    row.forEach((cell, i) => {
      const txt = (cell ?? "").toString();
      const maxChars = Math.floor((colW - 4) / 1.6);
      const display =
        txt.length > maxChars
          ? txt.slice(0, Math.max(1, maxChars - 1)) + "…"
          : txt;
      doc.text(display, tableX + colW * i + 2, y + rowH * 0.7);
    });
    setDraw({ r: 235, g: 235, b: 240 });
    doc.setLineWidth(0.1);
    doc.line(tableX, y + rowH, tableX + tableW, y + rowH);
    y += rowH;
    rowIdx += 1;
  }
  drawPageFooter(pageNum, estimatedPages);

  doc.save(filename);
}

// ── Date formatting ────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const s = formatDate(start);
  const e = formatDate(end);
  if (s && e) return s === e ? s : `${s} → ${e}`;
  return s || e;
}

type JsPDFDoc = {
  setFillColor: (r: number, g: number, b: number) => void;
  setDrawColor: (r: number, g: number, b: number) => void;
  setTextColor: (r: number, g: number, b: number) => void;
  setLineWidth: (w: number) => void;
  setFontSize: (s: number) => void;
  setFont: (family: string, style?: string) => void;
  text: (
    text: string,
    x: number,
    y: number,
    options?: { align?: "left" | "center" | "right" },
  ) => void;
  rect: (x: number, y: number, w: number, h: number, style?: string) => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  addPage: () => void;
  save: (filename: string) => void;
};

function loadJsPDF(): Promise<{ jsPDF: new (opts: unknown) => JsPDFDoc }> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as {
      jspdf?: { jsPDF: new (opts: unknown) => JsPDFDoc };
    };
    if (w.jspdf) {
      resolve(w.jspdf);
      return;
    }
    // arkyo-server: bundlé (hors ligne) : jsPDF 2.5.1 vient du paquet npm via
    // `ensureJsPdf` (lib/pdf/load-jspdf.ts), qui pose `window.jspdf` comme le
    // build UMD du CDN ; plus de balise <script>.
    ensureJsPdf().then(
      () => {
        if (w.jspdf) resolve(w.jspdf);
        else reject(new Error("jsPDF failed to expose window.jspdf"));
      },
      () => reject(new Error("Failed to load jsPDF")),
    );
  });
}
