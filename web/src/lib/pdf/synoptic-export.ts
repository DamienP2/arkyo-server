/**
 * lib/pdf/synoptic-export.ts
 *
 * Primitives partagées du cadre « dessin technique » (bordure double +
 * cartouche colonne droite) utilisées par :
 *  - le poster synoptique (components/synoptique/synoptic-view.tsx)
 *  - l'export blueprint générique (lib/print/export-with-cartouche.ts)
 *
 * Le contenu du cartouche vient TOUJOURS d'un modèle d'impression
 * (`TenantPrintTemplate`) choisi par l'utilisateur — l'ancien générateur
 * autonome à champs codés en dur a été supprimé.
 *
 * Module pur (aucun import React) ; le `doc` jsPDF est fourni par l'appelant.
 */

export type CartoucheDoc = {
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
};

/** Géométrie du cadre : zone de dessin (gauche) + colonne cartouche (droite). */
export type CartoucheFrame = {
  pageW: number;
  pageH: number;
  border: number;
  inner: number;
  cartW: number;
  /** Zone de dessin (à gauche du cartouche). */
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
  /** Colonne cartouche. */
  cartX: number;
  cartY: number;
  cartH: number;
};

/** Calcule la géométrie du cadre pour une page `pageW × pageH` (mm). */
export function computeCartoucheFrame(pageW: number, pageH: number, cartW = 58): CartoucheFrame {
  const BORDER = 6;
  const INNER = 3;
  const BI = BORDER + INNER;
  return {
    pageW,
    pageH,
    border: BORDER,
    inner: INNER,
    cartW,
    drawX: BI,
    drawY: BI,
    drawW: pageW - BI - cartW - BI,
    drawH: pageH - BI * 2,
    cartX: pageW - BI - cartW,
    cartY: BI,
    cartH: pageH - BI * 2,
  };
}

/** Champ label/valeur du cartouche. `size`/`bold` stylent la valeur. */
export type CartoucheField = {
  label: string;
  value: string;
  size?: number;
  bold?: boolean;
};

export type CartoucheChromeSpec = {
  /** Petite ligne accent uppercase du bandeau (ex. « SYNOPTIQUE DE CÂBLAGE »). */
  headerTitle: string;
  /** Grande ligne blanche du bandeau (nom de baie, titre du document…). */
  headerSubtitle?: string;
  /** Champs label/valeur rendus sous le bandeau. */
  fields: CartoucheField[];
  /** 2 = grille 2 champs/ligne (poster synoptique), 1 = pleine largeur. */
  columns?: 1 | 2;
  accent?: string;
  /** Hauteur (mm) réservée en bas de colonne, dessinée via `drawBottom`. */
  bottomHeight?: number;
  drawBottom?: (
    doc: CartoucheDoc,
    area: { x: number; y: number; w: number; h: number },
  ) => void;
};

/**
 * Dessine le chrome du cartouche : masque blanc à droite (cache tout
 * débordement d'image), colonne cartouche (bandeau + champs + bloc bas
 * optionnel) puis double bordure par-dessus tout. À appeler APRÈS avoir
 * dessiné l'image dans la zone de dessin.
 */
export function drawCartoucheChrome(
  doc: CartoucheDoc,
  frame: CartoucheFrame,
  spec: CartoucheChromeSpec,
): void {
  const { pageW, pageH, border, inner, cartW } = frame;
  const BI = border + inner;
  const CX = frame.cartX;
  const CY = frame.cartY;
  const CH = frame.cartH;
  const accent = spec.accent ?? "#6366f1";
  const columns = spec.columns ?? 2;

  const h2r = (hex: string): [number, number, number] => {
    const c = hex.replace("#", "");
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  };
  const sf = (hex: string) => {
    const [r, g, b] = h2r(hex);
    doc.setFillColor(r, g, b);
  };
  const ss = (hex: string, lw = 0.3) => {
    const [r, g, b] = h2r(hex);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(lw);
  };
  const st = (hex: string) => {
    const [r, g, b] = h2r(hex);
    doc.setTextColor(r, g, b);
  };
  const fillRect = (x: number, y: number, w: number, h: number, col: string) => {
    sf(col);
    doc.rect(x, y, w, h, "F");
  };
  const ln = (x1: number, y1: number, x2: number, y2: number, col: string, lw = 0.3) => {
    ss(col, lw);
    doc.line(x1, y1, x2, y2);
  };
  // Mesure texte (mm, police courante) — via jsPDF.getTextWidth si dispo.
  const measure = (s: string): number | null => {
    const g = (doc as unknown as { getTextWidth?: (t: string) => number }).getTextWidth;
    if (typeof g !== "function") return null;
    try {
      return g.call(doc, s);
    } catch {
      return null;
    }
  };
  // Texte tronqué avec « … » si plus large que maxW.
  const txtFit = (
    s: string,
    x: number,
    y: number,
    col: string,
    size: number,
    bold: boolean,
    maxW: number,
  ) => {
    st(col);
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    let t = s;
    const w0 = measure(t);
    if (w0 !== null && w0 > maxW) {
      while (t.length > 1 && (measure(t + "…") ?? 0) > maxW) t = t.slice(0, -1);
      t = t + "…";
    }
    doc.text(t, x, y);
  };
  const sep = (y: number) => {
    ss("#e2e8f0", 0.25);
    doc.line(CX, y, CX + cartW, y);
  };

  // ── Masque blanc côté droit + fond cartouche ──────────────────────────
  fillRect(CX, 0, pageW - CX, pageH, "#ffffff");
  fillRect(CX, CY, cartW, CH, "#f8fafc");
  ln(CX, CY, CX, CY + CH, "#1e293b", 0.5);

  // ── Bandeau ───────────────────────────────────────────────────────────
  const hasSub = !!spec.headerSubtitle;
  const HDR_H = hasSub ? 26 : 12;
  let cy = CY;
  fillRect(CX, cy, cartW, HDR_H, "#0f172a");
  fillRect(CX, cy, 3, HDR_H, accent);
  txtFit(spec.headerTitle, CX + 6, cy + (hasSub ? 6 : 7), accent, 3, true, cartW - 9);
  if (hasSub) txtFit(spec.headerSubtitle ?? "", CX + 6, cy + 17, "#ffffff", 7, true, cartW - 9);
  cy += HDR_H;

  // ── Champs label/valeur ───────────────────────────────────────────────
  const META_H = 13;
  const HALF = cartW / 2;
  const bottomH = spec.drawBottom ? Math.max(0, spec.bottomHeight ?? 0) : 0;
  const fieldsBottom = CY + CH - bottomH;
  const step = columns === 2 ? 2 : 1;
  for (let i = 0; i < spec.fields.length; i += step) {
    if (cy + META_H > fieldsBottom) break; // plus de place — champs suivants ignorés
    const rowBg = (i / step) % 2 === 0 ? "#f8fafc" : "#ffffff";
    fillRect(CX, cy, cartW, META_H, rowBg);
    sep(cy);
    const drawCell = (f: CartoucheField, x: number, maxW: number) => {
      txtFit(f.label, x, cy + 4, "#94a3b8", 3, true, maxW);
      txtFit(f.value || "—", x, cy + 11, "#0f172a", f.size ?? 4.5, f.bold ?? false, maxW);
    };
    if (columns === 2) {
      ln(CX + HALF, cy, CX + HALF, cy + META_H, "#e2e8f0", 0.25);
      drawCell(spec.fields[i], CX + 3, HALF - 5);
      const right = spec.fields[i + 1];
      if (right) drawCell(right, CX + HALF + 2, HALF - 5);
    } else {
      drawCell(spec.fields[i], CX + 3, cartW - 6);
    }
    cy += META_H;
  }

  // ── Espace central blanc ──────────────────────────────────────────────
  const midH = fieldsBottom - cy;
  if (midH > 0) {
    fillRect(CX, cy, cartW, midH, "#ffffff");
    sep(cy);
  }

  // ── Bloc bas (légende…) ───────────────────────────────────────────────
  if (spec.drawBottom && bottomH > 0) {
    spec.drawBottom(doc, { x: CX, y: CY + CH - bottomH, w: cartW, h: bottomH });
  }

  // ── Double bordure (par-dessus tout) ──────────────────────────────────
  ss("#1e293b", 0.8);
  doc.rect(border, border, pageW - border * 2, pageH - border * 2);
  ss("#1e293b", 0.25);
  doc.rect(BI, BI, pageW - BI * 2, pageH - BI * 2);
}
