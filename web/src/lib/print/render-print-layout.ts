/**
 * Rendu d'un PrintLayout (éditeur cartouche / modèles d'export PDF) en SVG
 * string, puis en PNG dataURL pour intégration dans jsPDF.
 *
 * Les coordonnées du layout sont en mm — on génère un SVG dont le viewBox
 * correspond aux dimensions papier (par défaut A4 portrait = 210×297 mm).
 *
 * Les variables `{namespace.field}` sont résolues via `overrides` puis
 * fallback sur les samples de `lib/services/print-layout.ts`. Les variables
 * image utilisent l'URL fournie en override si présente, sinon affichent un
 * placeholder gris pointillé.
 */

import {
  getPaperDimensionsMm,
  type Orientation,
  type PaperFormat,
  type PrintBackground,
  type PrintElement,
  type PrintLayout,
  resolveVariables,
} from "@/lib/services/print-layout";

const MM_PER_PX = 25.4 / 96; // 1 mm ≈ 3.78 px à 96 dpi
export const mmToPx = (mm: number, dpi = 96): number => (mm * dpi) / 25.4;

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const fmt = (n: number): string =>
  Number.isFinite(n) ? Number(n.toFixed(3)).toString() : "0";

const renderBackground = (
  bg: PrintBackground | null | undefined,
  w: number,
  h: number,
): { def: string; fill: string } => {
  if (!bg) return { def: "", fill: "#ffffff" };
  if (bg.type === "SOLID") return { def: "", fill: bg.color };
  // IMAGE — non supporté dans l'export PDF (rendu vectoriel). On revient au fond blanc.
  // Pour supporter, il faudrait embarquer l'image en base64 dans le SVG.
  if (bg.type === "IMAGE") return { def: "", fill: "#ffffff" };
  // LINEAR_GRADIENT — angle en degrés (0 = haut → bas, 90 = gauche → droite).
  const angleRad = ((bg.angle ?? 0) - 90) * (Math.PI / 180);
  const cx = w / 2;
  const cy = h / 2;
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  // Projection des coins sur l'axe pour calculer les extrémités du gradient.
  const half = Math.abs(dx) * (w / 2) + Math.abs(dy) * (h / 2);
  const x1 = cx - dx * half;
  const y1 = cy - dy * half;
  const x2 = cx + dx * half;
  const y2 = cy + dy * half;
  const id = "bgGradient";
  const def = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(
    x1,
  )}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}">
    <stop offset="0%" stop-color="${escapeXml(bg.from)}"/>
    <stop offset="100%" stop-color="${escapeXml(bg.to)}"/>
  </linearGradient></defs>`;
  return { def, fill: `url(#${id})` };
};

const renderElement = (
  el: PrintElement,
  overrides: Record<string, string | null | undefined>,
): string => {
  switch (el.type) {
    case "RECT": {
      const rx = typeof el.rx === "number" ? ` rx="${fmt(el.rx)}"` : "";
      return `<rect x="${fmt(el.x)}" y="${fmt(el.y)}" width="${fmt(
        el.w,
      )}" height="${fmt(el.h)}"${rx} fill="${escapeXml(
        el.fill,
      )}" stroke="${escapeXml(el.stroke)}" stroke-width="${fmt(
        el.strokeWidth,
      )}"/>`;
    }
    case "ELLIPSE": {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      const rx = el.w / 2;
      const ry = el.h / 2;
      return `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(
        rx,
      )}" ry="${fmt(ry)}" fill="${escapeXml(el.fill)}" stroke="${escapeXml(
        el.stroke,
      )}" stroke-width="${fmt(el.strokeWidth)}"/>`;
    }
    case "LINE": {
      return `<line x1="${fmt(el.x1)}" y1="${fmt(el.y1)}" x2="${fmt(
        el.x2,
      )}" y2="${fmt(el.y2)}" stroke="${escapeXml(
        el.stroke,
      )}" stroke-width="${fmt(el.strokeWidth)}" stroke-linecap="round"/>`;
    }
    case "TEXT": {
      const content = el.isVariable
        ? resolveVariables(el.text, overrides)
        : el.text;
      // SVG text n'a pas de wrap natif → on coupe en lignes manuelles sur
      // les \n et on positionne via tspan. Largeur respectée
      // approximativement (pas de mesure de fonte). Suffit pour des champs
      // de cartouche / pages de garde courts.
      const fontSizeMm = el.fontSize * MM_PER_PX;
      const lineHeight = fontSizeMm * 1.25;
      const lines = content.split(/\n/);
      const anchor =
        el.align === "center" ? "middle" : el.align === "right" ? "end" : "start";
      const xAnchor =
        el.align === "center"
          ? el.x + el.w / 2
          : el.align === "right"
            ? el.x + el.w
            : el.x;
      // Baseline du 1er line : on cale en bas du fontSize comme dans l'éditeur.
      const tspans = lines
        .map((ln, i) => {
          const dy = i === 0 ? fontSizeMm : lineHeight;
          return `<tspan x="${fmt(xAnchor)}" dy="${fmt(dy)}">${escapeXml(ln)}</tspan>`;
        })
        .join("");
      const weight = el.fontWeight === "bold" ? "bold" : "normal";
      const style = el.fontStyle === "italic" ? "italic" : "normal";
      return `<text x="${fmt(xAnchor)}" y="${fmt(
        el.y,
      )}" font-family="Helvetica, Arial, sans-serif" font-size="${fmt(
        fontSizeMm,
      )}" font-weight="${weight}" font-style="${style}" fill="${escapeXml(
        el.color,
      )}" text-anchor="${anchor}">${tspans}</text>`;
    }
    case "IMAGE": {
      const resolvedUrl = el.isVariable
        ? (overrides[el.url] ?? "")
        : el.url;
      if (!resolvedUrl) {
        // Placeholder : rectangle pointillé gris pour signaler une variable
        // non résolue ou une URL vide.
        return `<g><rect x="${fmt(el.x)}" y="${fmt(el.y)}" width="${fmt(
          el.w,
        )}" height="${fmt(
          el.h,
        )}" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="0.4" stroke-dasharray="1.5 1"/></g>`;
      }
      return `<image x="${fmt(el.x)}" y="${fmt(el.y)}" width="${fmt(
        el.w,
      )}" height="${fmt(
        el.h,
      )}" href="${escapeXml(resolvedUrl)}" preserveAspectRatio="xMidYMid meet"/>`;
    }
  }
};

/**
 * Construit le SVG complet d'une page de modèle d'export PDF ou de cartouche.
 * viewBox en mm pour cohérence avec les coordonnées des éléments.
 *
 * `opts.orientation` : PORTRAIT par défaut (comportement historique des
 * modèles Export PDF, figés A4 portrait). Les cartouches peuvent être paysage.
 * `opts.transparentBackground` : omet le fond de feuille — utilisé pour
 * superposer le layout (cadre + cartouche dessinés) au-dessus d'un plan
 * capturé ; seuls les éléments pleins masquent l'image dessous.
 * `opts.sizeMm` : dimensions explicites du viewBox en mm — prime sur
 * format/orientation (utilisé quand le layout a été adapté à une page cible
 * via `adaptPrintLayoutToSize`).
 */
export function renderPrintLayoutToSvgString(
  layout: PrintLayout,
  overrides: Record<string, string | null | undefined> = {},
  format: PaperFormat = "A4",
  opts?: {
    orientation?: Orientation;
    transparentBackground?: boolean;
    sizeMm?: { w: number; h: number };
  },
): string {
  const { w, h } =
    opts?.sizeMm ?? getPaperDimensionsMm(format, opts?.orientation ?? "PORTRAIT");
  const transparent = opts?.transparentBackground === true;
  const { def, fill } = transparent
    ? { def: "", fill: "none" }
    : renderBackground(layout.background, w, h);
  const sortedElements = [...layout.elements].sort(
    (a, b) => (a.z ?? 0) - (b.z ?? 0),
  );
  const elements = sortedElements
    .map((el) => renderElement(el, overrides))
    .join("");
  const bgRect = transparent
    ? ""
    : `<rect x="0" y="0" width="${w}" height="${h}" fill="${escapeXml(fill)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">
    ${def}
    ${bgRect}
    ${elements}
  </svg>`;
}

/**
 * Convertit un SVG string en PNG dataURL via Canvas — sans dépendance
 * externe. Browser only. Le PNG produit a les dimensions pixel demandées.
 */
export function svgStringToPngDataUrl(
  svg: string,
  widthPx: number,
  heightPx: number,
  opts?: { transparent?: boolean },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = widthPx;
        canvas.height = heightPx;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("Canvas 2D context indisponible"));
          return;
        }
        if (!opts?.transparent) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, widthPx, heightPx);
        }
        ctx.drawImage(img, 0, 0, widthPx, heightPx);
        URL.revokeObjectURL(url);
        // Encodage ASYNCHRONE. `toDataURL` est synchrone : sur un cartouche A0
        // à 36 Mpx il fige l'onglet plusieurs secondes, sans repeinte — ce que
        // l'utilisateur lit comme un plantage. `toBlob` confie l'encodage au
        // navigateur, `FileReader` la conversion base64.
        //
        // Bénéfice au passage : au-delà de la taille maximale de canvas du
        // navigateur, `toDataURL` ne levait pas — il renvoyait « data:, », et
        // l'échec se propageait en calque VIDE. `toBlob` rend `null`, un échec
        // franc qu'on transforme en erreur.
        // Nommé `png` et non `blob` : `blob` désigne déjà la source SVG au
        // dessus, et deux blobs de natures opposées sous le même nom est le
        // genre de détail qui coûte une demi-heure six mois plus tard.
        canvas.toBlob((png) => {
          if (!png) {
            reject(
              new Error(
                `Rasterisation impossible à ${widthPx}×${heightPx} px (limite du navigateur).`,
              ),
            );
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () =>
            reject(new Error("Lecture du calque rasterisé échouée."));
          reader.readAsDataURL(png);
        }, "image/png");
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e instanceof Error ? e : new Error("Échec du chargement SVG"));
    };
    img.src = url;
  });
}
