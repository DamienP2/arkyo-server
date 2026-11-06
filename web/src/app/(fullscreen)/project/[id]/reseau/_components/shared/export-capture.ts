// ── Capture du canvas Map → PNG / JPEG / SVG / PDF ─────────────────────────
//
// Le canvas Map est un `<svg>` rendu par `TopologyCanvas`. On expose deux
// stratégies :
//   - PNG / JPEG : capture via html-to-image (canvas raster, déjà utilisé
//     côté synoptique).
//   - SVG        : sérialisation directe de l'élément `<svg>` (vectoriel,
//     éditable dans Illustrator / Inkscape).
//   - PDF        : capture PNG haute résolution embarquée dans un PDF A4
//     paysage, avec cartouche projet (logo, titre, méta-données).
//
// jsPDF et html-to-image sont déjà chargés via CDN (cf. lib/pdf,
// lib/export/synoptic-capture) — pas de nouvelle dépendance.

import { captureElementToCanvas } from "@/lib/export/synoptic-capture";
// arkyo-server: bundlé (hors ligne) : `ensureJsPdf` remplace le <script> du CDN.
import { JSPDF_BASE, ensureJsPdf } from "@/lib/pdf/load-jspdf";


// ── « Aplatissement » des widgets d'édition pendant la capture ─────────────
// L'utilisateur veut un PDF qui montre juste l'INFORMATION, pas les champs
// éditables (bordures d'input, chevrons de dropdown, poignées de drag…).
// On injecte une classe sur le container, dont la feuille de style masque
// ces ornements visuels — les couleurs des badges (qui utilisent un style
// `background` inline) restent intactes.

const FLATTEN_STYLE_ID = "__arkyo_export_flatten_style";
const FLATTEN_CLASS = "arkyo-export-flat";
const FLATTEN_CSS = `
.${FLATTEN_CLASS} input[type="text"],
.${FLATTEN_CLASS} input[type="number"],
.${FLATTEN_CLASS} input[type="search"] {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
  padding: 0 2px !important;
}
/* Trigger des dropdowns custom : pas de style inline « background » → on
   retire la bordure. Les badges plein-couleur ont un style inline et sont
   donc épargnés par le :not() sélecteur. */
.${FLATTEN_CLASS} button:not([style*="background"]) {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
}
/* Icônes d'édition / réordonnancement / action en hover — non pertinentes
   dans une capture imprimable. */
.${FLATTEN_CLASS} svg.lucide-chevron-down,
.${FLATTEN_CLASS} svg.lucide-grip-vertical,
.${FLATTEN_CLASS} svg.lucide-x,
.${FLATTEN_CLASS} svg.lucide-rotate-ccw,
.${FLATTEN_CLASS} svg.lucide-refresh-cw,
.${FLATTEN_CLASS} svg.lucide-filter,
.${FLATTEN_CLASS} svg.lucide-zap {
  display: none !important;
}
.${FLATTEN_CLASS} [aria-label="Réordonner la colonne"],
.${FLATTEN_CLASS} [aria-label="Vider"],
.${FLATTEN_CLASS} [aria-label="Vider la source"],
.${FLATTEN_CLASS} [aria-label="Réinitialiser l'équipement"],
.${FLATTEN_CLASS} [aria-label*="Réinitialiser"] {
  display: none !important;
}
.${FLATTEN_CLASS} .cursor-grab { cursor: default !important; }
`;

function ensureFlattenStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(FLATTEN_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = FLATTEN_STYLE_ID;
  style.textContent = FLATTEN_CSS;
  document.head.appendChild(style);
}

export async function captureWithFlatten(
  el: HTMLElement,
  opts: Parameters<typeof captureElementToCanvas>[1] = {},
): Promise<HTMLCanvasElement> {
  ensureFlattenStyle();
  el.classList.add(FLATTEN_CLASS);
  try {
    return await captureElementToCanvas(el, opts);
  } finally {
    el.classList.remove(FLATTEN_CLASS);
  }
}

import type { ExportPdfMeta, RGB } from "./export-pdf";

// ── Logo Arkyo (monogramme) ────────────────────────────────────────────────
// SVG du monogramme — reproduit fidèlement `ArkyoLogo` de app/site/page.tsx.
// Rasterisé à la volée en PNG pour embarquement dans jsPDF.

function arkyoMonogramSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <path d="M26 84 L26 28 C26 6 74 6 74 28 L74 84" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="26" y1="58" x2="74" y2="58" stroke="${color}" stroke-width="2.8" stroke-linecap="round" opacity="0.4"/>
    <circle cx="62" cy="58" r="2.5" fill="${color}" opacity="0.7"/>
  </svg>`;
}

async function arkyoLogoPngDataUrl(
  color: string = "#14181E",
  size: number = 128,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const svg = arkyoMonogramSvg(color);
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return reject(new Error("Canvas 2D context unavailable"));
      }
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to rasterize Arkyo logo SVG"));
    };
    img.src = url;
  });
}

// ── Helpers de téléchargement ──────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── PNG / JPEG ─────────────────────────────────────────────────────────────

export async function captureToPng(
  el: HTMLElement,
  filename: string,
  background: string = "#ffffff",
) {
  const canvas = await captureWithFlatten(el, {
    pixelRatio: 2,
    background,
  });
  await new Promise<void>((resolve) =>
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename);
      resolve();
    }, "image/png"),
  );
}

export async function captureToJpeg(
  el: HTMLElement,
  filename: string,
  background: string = "#ffffff",
  quality: number = 0.92,
) {
  const canvas = await captureWithFlatten(el, {
    pixelRatio: 2,
    background,
  });
  await new Promise<void>((resolve) =>
    canvas.toBlob(
      (blob) => {
        if (blob) downloadBlob(blob, filename);
        resolve();
      },
      "image/jpeg",
      quality,
    ),
  );
}

// ── SVG (sérialisation directe du <svg>) ───────────────────────────────────

export function captureSvgToFile(svgEl: SVGSVGElement, filename: string) {
  // On clone pour ne pas polluer le SVG live (on injecte les attributs
  // xmlns + viewBox si manquants pour que le SVG soit autonome).
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!clone.getAttribute("xmlns:xlink")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  // Si viewBox manquant mais width/height présents, on infère.
  if (!clone.getAttribute("viewBox")) {
    const w = clone.getAttribute("width");
    const h = clone.getAttribute("height");
    if (w && h) clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], {
    type: "image/svg+xml;charset=utf-8",
  });
  downloadBlob(blob, filename);
}

// ── PDF avec cartouche projet + image embarquée ────────────────────────────

const ACCENT_DEFAULT: RGB = { r: 20, g: 184, b: 166 }; // teal (Map)

export async function captureToPdf({
  el,
  title,
  stamp,
  filename,
  meta,
  background = "#ffffff",
}: {
  el: HTMLElement;
  /** Date d'export formatée (YYYY-MM-DD). Affichée discrètement. */
  stamp: string;
  filename: string;
  meta?: ExportPdfMeta;
  background?: string;
  /** Conservée pour compat des appels existants — non utilisée dans le
   *  rendu épuré (le cartouche reste neutre). */
  title?: string;
  accentColor?: RGB;
}) {
  const { jsPDF } = await loadJsPDF();
  const canvas = await captureWithFlatten(el, {
    pixelRatio: 2,
    background,
  });
  // JPEG plutôt que PNG pour réduire drastiquement la taille du PDF
  // (capture haute résolution → PNG facilement > 10 Mo qui dépasse la
  // limite du body Next.js). Quality 0.85 reste imperceptible à l'œil
  // pour un tableau colorée.
  const imgData = canvas.toDataURL("image/jpeg", 0.85);

  const doc = new jsPDF({
    ...JSPDF_BASE,
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });
  const pageW = 297;
  const pageH = 210;
  const margin = 12;

  const setText = (rgb: RGB | [number, number, number]) => {
    if (Array.isArray(rgb)) doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    else doc.setTextColor(rgb.r, rgb.g, rgb.b);
  };
  const setFill = (rgb: RGB | [number, number, number]) => {
    if (Array.isArray(rgb)) doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    else doc.setFillColor(rgb.r, rgb.g, rgb.b);
  };

  // Cartouche reproduisant le header global de l'app
  // (cf. components/layout/topbar.tsx) : bande sombre var(--arkyo-slate)
  // avec monogramme bleu + « arkyo » blanc bold + « .io » soft normal,
  // suivi du séparateur « | » et du nom du projet.
  const SLATE: RGB = { r: 42, g: 39, b: 64 }; // --arkyo-slate
  const CLOUD: RGB = { r: 255, g: 255, b: 255 }; // blanc pur (cf. topbar)
  const SOFT: RGB = { r: 160, g: 157, b: 178 }; // --arkyo-soft (date / .io)
  const MID: RGB = { r: 107, g: 104, b: 128 }; // --arkyo-mid (pipe)

  const headerH = 7.5; // hauteur compacte
  const logoSize = 4.5; // mm
  const logoX = margin;
  const logoY = (headerH - logoSize) / 2;
  // Baseline calé avec le centre vertical du logo (helvetica ~0.7 em).
  const baseline = headerH / 2 + 1;

  // Bande de fond
  setFill(SLATE);
  doc.rect(0, 0, pageW, headerH, "F");

  // Helper de mesure de largeur texte avec le contexte courant.
  const measure = (s: string): number => {
    try {
      const w = (doc as unknown as { getTextWidth?: (s: string) => number })
        .getTextWidth?.(s);
      if (typeof w === "number") return w;
    } catch {
      /* noop */
    }
    return s.length * 2; // fallback approximatif
  };

  // Picto Arkyo (couleur arkyo-blue-light)
  let cursorX = logoX;
  try {
    const logoDataUrl = await arkyoLogoPngDataUrl("#5a74ff", 192);
    doc.addImage(logoDataUrl, "PNG", cursorX, logoY, logoSize, logoSize);
    cursorX += logoSize + 2;
  } catch {
    /* fallback : on dessine juste le mot ci-dessous */
  }

  // « arkyo » blanc bold
  // arkyo-server: habillage Strata (nom affiché « Strata Arkyo » à la place
  // de « arkyo » + « .io », spec Strata §6)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setText(CLOUD);
  doc.text("Strata Arkyo", cursorX, baseline);
  cursorX += measure("Strata Arkyo");

  if (meta?.projectName) {
    // Séparateur « | » mid
    cursorX += 2;
    setText(MID);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("|", cursorX, baseline);
    cursorX += measure("|") + 2;
    // Nom du projet en soft medium (~bold)
    setText(SOFT);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(meta.projectName, cursorX, baseline);
  }

  // Type de document — coin haut droit, uppercase, blanc bold.
  if (title) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setText(CLOUD);
    doc.text(title.toUpperCase(), pageW - margin, baseline, {
      align: "right",
    });
  }

  // Image — pleine largeur, fit dans la hauteur disponible (entre la bande
  // d'en-tête et le footer).
  const footerH = 6;
  const imgTop = headerH + 4;
  const availW = pageW - margin * 2;
  const availH = pageH - imgTop - footerH - 2;
  const ratio = canvas.width / canvas.height;
  let imgW = availW;
  let imgH = imgW / ratio;
  if (imgH > availH) {
    imgH = availH;
    imgW = imgH * ratio;
  }
  const imgX = (pageW - imgW) / 2;
  doc.addImage(imgData, "JPEG", imgX, imgTop, imgW, imgH);

  // ── Footer ─────────────────────────────────────────────────────────────
  // Ligne de séparation discrète + 3 zones :
  //   - gauche : type de document + nom projet
  //   - centre : Page X / Y
  //   - droite : date d'export formatée (jj/mm/aaaa)
  const footerLineY = pageH - footerH;
  const footerTextY = pageH - 2.5;
  const footerColor: RGB = { r: 150, g: 150, b: 160 };
  doc.setDrawColor(235, 235, 240);
  doc.setLineWidth(0.15);
  doc.line(margin, footerLineY, pageW - margin, footerLineY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  setText(footerColor);

  const leftParts: string[] = [];
  if (title) leftParts.push(title);
  if (meta?.projectName) leftParts.push(meta.projectName);
  const left = leftParts.join(" — ");
  if (left) doc.text(left, margin, footerTextY);

  doc.text(`Page 1 / 1`, pageW / 2, footerTextY, { align: "center" });

  doc.text(`Exporté le ${formatDate(stamp)}`, pageW - margin, footerTextY, {
    align: "right",
  });

  // On extrait le blob via `output("blob")` plutôt que d'utiliser
  // `doc.save()` directement : le nom de fichier y est maîtrisé.
  try {
    downloadBlob(doc.output("blob"), filename);
  } catch {
    // Fallback : si `output("blob")` n'est pas disponible sur cette version
    // de jsPDF, on retombe sur `save()` (download natif).
    doc.save(filename);
  }
}

// ── Date utilities (duplication minimale avec export-pdf) ──────────────────

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

// jsPDF loader (réplique pattern lib/pdf/synoptic-export).
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
  /** Largeur du texte dans le contexte de police courant (unité du doc). */
  getTextWidth: (text: string) => number;
  /** Replie un texte à la largeur donnée, dans la police courante. */
  splitTextToSize: (text: string, maxWidth: number) => string[];
  addPage: (
    format?: string | [number, number],
    orientation?: "portrait" | "landscape",
  ) => void;
  addImage: (
    imageData: string,
    format: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ) => void;
  save: (filename: string) => void;
  output: (type: "blob") => Blob;
};

export function loadJsPDF(): Promise<{ jsPDF: new (opts: unknown) => JsPDFDoc }> {
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
