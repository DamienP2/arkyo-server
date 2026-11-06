/**
 * Grammaire du cartouche technique arkyo — « grille allégée ».
 *
 * SOURCE UNIQUE des cotes et du registre de traits partagés par :
 *  - `inventaire/_lib/bom-pdf.ts` (dessin natif jsPDF de la liste du matériel) ;
 *  - `standardCartoucheSvg` ci-dessous (habillage « Modèle standard » de
 *    l'export Rack, rasterisé et composité par-dessus la composition).
 *
 * Les deux consommateurs dessinent avec des outils différents (jsPDF vs SVG)
 * mais dans la MÊME unité : le millimètre. Les valeurs se transposent donc
 * telles quelles d'un rendu à l'autre — c'est ce qui permet de n'avoir qu'un
 * seul jeu de constantes.
 */

// ── Registre de traits ───────────────────────────────────────────────────────

/** 1 point typographique en mm. */
export const PT = 0.3528;

/**
 * Épaisseurs de trait, en mm. Registre volontairement FIN — trait de plan au
 * tire-ligne, pas au marqueur. La hiérarchie relative est ce qui compte :
 * total > cadre > séparateurs de cellules ≈ souligné de groupe > filets.
 */
export const LW = {
  total: 0.7 * PT,
  frame: 0.5 * PT,
  cell: 0.28 * PT,
  group: 0.3 * PT,
  hair: 0.2 * PT,
} as const;

// ── Couleurs ─────────────────────────────────────────────────────────────────

export type Rgb = { r: number; g: number; b: number };

export const INK: Rgb = { r: 24, g: 27, b: 38 };
export const MUTED: Rgb = { r: 107, g: 112, b: 128 };
export const HAIR: Rgb = { r: 236, g: 238, b: 242 };
export const RULE: Rgb = { r: 201, g: 204, b: 216 };
export const WHITE: Rgb = { r: 255, g: 255, b: 255 };

export const INK_HEX = "#181b26";
export const MUTED_HEX = "#6b7080";
export const WHITE_HEX = "#ffffff";

// ── Cotes de page ────────────────────────────────────────────────────────────

/**
 * Marge entre le bord de page et le cadre. Volontairement au plus serré : le
 * cadre EST la marge visuelle du document, il n'a pas besoin d'être doublé
 * d'un blanc généreux.
 *
 * 3 mm est le PLANCHER — c'est la zone non imprimable des imprimantes de
 * bureau courantes. En descendant plus bas, le trait du cadre serait rogné à
 * l'impression (voire absent sur les bords les plus contraints).
 */
export const FRAME_MARGIN = 3;
export const HEADER_H = 14;
/** En-tête réduit des pages 2+ : une seule ligne de rappel. */
export const HEADER_SLIM_H = 7;
export const FOOTER_H = 7;
/** Retraits internes de la zone de contenu. */
export const PAD_X = 6;
export const PAD_TOP = 4;
/** Largeur de la cellule qui porte le logo de l'espace. */
export const LOGO_CELL_W = 44;

/**
 * Résolution du calque de cartouche rasterisé, en dpi.
 *
 * 200 et non 300 : ce calque est du TRAIT et du texte vectoriel aplati, pas de
 * la photo. À 200 dpi un filet reste net à l'impression, et le nombre de pixels
 * tombe de 44 %.
 *
 * Ce n'est pas qu'une question de poids. Le flux est dégonflé à la génération
 * (cf. `JSPDF_BASE`), et le deflate est proportionnel au nombre de pixels
 * BRUTS : sur un A3, 300 dpi donnaient 52 Mo à compresser en JavaScript sur le
 * fil principal. 200 dpi ramène cela à 23 Mo — le même document, sans l'attente.
 *
 * Si le rendu paraît mou à l'impression, c'est ici et nulle part ailleurs que
 * la valeur se remonte.
 */
export const CARTOUCHE_LAYER_DPI = 200;

// ── Chargement du logo ───────────────────────────────────────────────────────

/**
 * Largeur maximale du logo re-encodé, en pixels.
 *
 * La cellule qui le porte fait au plus `LOGO_CELL_W` (44 mm) ; à 300 dpi cela
 * représente 520 px. 600 px couvre donc l'impression avec de la marge, et
 * TOUT ce qui dépasse est du poids pur.
 *
 * Ce n'est pas une micro-optimisation : le logo est ré-embarqué dans CHAQUE
 * feuille jsPDF d'un dossier. Un logo de 1,9 Mo re-encodé tel quel pesait plus
 * de 11 Mo sur six feuilles — pour une vignette de 44 mm.
 */
const LOGO_MAX_PX = 600;

/**
 * Charge une image distante et la convertit en dataURL PNG. Indispensable dans
 * les DEUX rendus : jsPDF n'accepte pas une URL, et un SVG rasterisé via un
 * blob (`svgStringToPngDataUrl`) ne charge aucune ressource externe — seule
 * une image embarquée en dataURL y est visible.
 *
 * L'image est RAMENÉE à la résolution d'usage du cartouche. Le faire ici plutôt
 * que chez chaque appelant est délibéré : cette fonction n'a qu'un usage — la
 * vignette d'un cartouche — et tous ses appelants la dessinent dans une cellule
 * de quelques centimètres. Un appelant qui aurait besoin de la pleine
 * résolution devrait charger l'image lui-même, pas passer par le chargeur de
 * cartouche.
 *
 * Renvoie `null` si le chargement échoue (logo servi sans CORS → canvas
 * « tainted ») : le cartouche retombe alors sur le nom de l'espace.
 */
export function loadImageAsDataUrl(
  url: string,
  options?: { maxPx?: number },
): Promise<{ dataUrl: string; ratio: number } | null> {
  const maxPx = options?.maxPx ?? LOGO_MAX_PX;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const srcW = img.naturalWidth || img.width;
        const srcH = img.naturalHeight || img.height;
        if (srcW === 0 || srcH === 0) {
          resolve(null);
          return;
        }
        // Réduction proportionnelle sur le plus grand côté : un logo en
        // bandeau et un logo carré doivent tous deux tenir dans le budget.
        const scale = Math.min(1, maxPx / Math.max(srcW, srcH));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(srcW * scale));
        canvas.height = Math.max(1, Math.round(srcH * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          dataUrl: canvas.toDataURL("image/png"),
          // Ratio de la SOURCE : la réduction est proportionnelle, mais
          // l'arrondi au pixel ferait dériver la mise en page du cartouche.
          ratio: srcW / srcH,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ── Cartouche standard (SVG) ─────────────────────────────────────────────────

const SANS = "Helvetica, Arial, sans-serif";
/**
 * Piles de polices SANS nom entre guillemets. Un SVG est du XML STRICT : un
 * `font-family="…"Liberation Mono"…"` rendrait le document entier illisible —
 * pas seulement le texte fautif — et l'image ne se chargerait tout simplement
 * pas. Les familles retenues couvrent toutes les plateformes sans avoir besoin
 * d'un nom composé.
 */
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}

export type StandardCartoucheInput = {
  /** Dimensions de la feuille, en mm, orientation comprise. */
  pageW: number;
  pageH: number;
  projectName?: string | null;
  /** Lieu — cellule LIEU. */
  location?: string | null;
  /** Nature du document — cellule DOCUMENT (« Racks »). */
  documentLabel: string;
  espaceName?: string | null;
  /** Logo déjà converti en dataURL (cf. `loadImageAsDataUrl`). */
  logo?: { dataUrl: string; ratio: number } | null;
  pageNum?: number;
  pageCount?: number;
};

/**
 * Zone de composition : ce qui reste entre l'en-tête et le pied, à l'intérieur
 * du cadre. C'est la surface utile de la feuille pour poser des vues.
 */
export function standardCartoucheContentZone(
  pageW: number,
  pageH: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: FRAME_MARGIN,
    y: FRAME_MARGIN + HEADER_H,
    w: pageW - FRAME_MARGIN * 2,
    h: pageH - FRAME_MARGIN * 2 - HEADER_H - FOOTER_H,
  };
}

/**
 * Cellule de PAGINATION du pied — le tiers droit, celui qui porte `n / N`.
 *
 * Exportée pour l'assembleur de dossier : une fois les documents empilés, la
 * numérotation interne de chaque feuille (« 1 / 1 ») ne dit plus rien de juste,
 * et la pagination continue doit prendre SA place — pas se poser à côté, ce qui
 * donnait deux nombres l'un sur l'autre. Les cotes viennent d'ici pour que les
 * deux écritures tombent exactement au même endroit.
 *
 * Toutes les cotes sont en millimètres, `y` et `baseline` mesurés depuis le
 * HAUT de la page (repère du SVG).
 */
export function standardFooterPageCell(
  pageW: number,
  pageH: number,
): {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Ligne de base du texte. */
  baseline: number;
  /** Bord droit du texte — il est aligné à droite. */
  right: number;
  /** Corps du texte, en points. */
  fontSize: number;
} {
  const fx = FRAME_MARGIN;
  const fw = pageW - FRAME_MARGIN * 2;
  const footerTop = pageH - FRAME_MARGIN - FOOTER_H;
  return {
    x: fx + (fw * 2) / 3,
    y: footerTop,
    w: fw / 3,
    h: FOOTER_H,
    baseline: footerTop + FOOTER_H / 2 + 1,
    right: fx + fw - PAD_X,
    fontSize: 8,
  };
}

/**
 * Zone de composition d'un cartouche WYSIWYG. Un layout libre ne déclare pas
 * la surface qu'il laisse au plan : on retient un simple retrait, dérivé du
 * petit côté et jamais inférieur à 8 mm.
 *
 * Fonction partagée à dessein — l'aperçu à l'écran et le document doivent
 * poser le plan au même endroit ; deux formules jumelles auraient divergé.
 */
export function wysiwygContentZone(
  pageW: number,
  pageH: number,
): { x: number; y: number; w: number; h: number } {
  const margin = Math.max(8, Math.min(pageW, pageH) * 0.04);
  return {
    x: margin,
    y: margin,
    w: pageW - margin * 2,
    h: pageH - margin * 2,
  };
}

/**
 * Cartouche « Modèle standard » en SVG, à l'échelle du millimètre (viewBox en
 * mm : les cotes ci-dessus s'appliquent sans conversion).
 *
 * Le fond de page reste TRANSPARENT — seuls l'en-tête et le pied sont opaques :
 * ils masquent ce qui passe dessous, exactement comme les blocs pleins d'un
 * cartouche WYSIWYG, tandis que la zone de composition laisse voir les vues.
 *
 * Chaque cellule clippe son texte : sans mesure de police disponible en SVG,
 * le découpage est ce qui garantit qu'un nom long ne déborde pas sur la
 * cellule voisine.
 */
export function standardCartoucheSvg(input: StandardCartoucheInput): string {
  const { pageW: PW, pageH: PH } = input;
  const fx = FRAME_MARGIN;
  const fy = FRAME_MARGIN;
  const fw = PW - FRAME_MARGIN * 2;
  const fh = PH - FRAME_MARGIN * 2;
  const headerBottom = fy + HEADER_H;
  const footerTop = fy + fh - FOOTER_H;

  const parts: string[] = [];
  const clips: string[] = [];
  let clipSeq = 0;

  /** Enregistre un clip rectangulaire et renvoie son identifiant. */
  const clip = (x: number, y: number, w: number, h: number): string => {
    const id = `tfc${++clipSeq}`;
    clips.push(
      `<clipPath id="${id}"><rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(
        Math.max(0, w),
      )}" height="${fmt(Math.max(0, h))}"/></clipPath>`,
    );
    return id;
  };

  const text = (
    value: string,
    x: number,
    y: number,
    opts: {
      size: number;
      bold?: boolean;
      mono?: boolean;
      color?: string;
      anchor?: "start" | "middle" | "end";
      clipId?: string;
      letterSpacing?: number;
    },
  ) => {
    if (!value) return;
    parts.push(
      // `esc` sur la police aussi : une pile qui contiendrait un nom composé
      // casserait tout le document XML, et donc l'image entière.
      `<text x="${fmt(x)}" y="${fmt(y)}" font-family="${esc(
        opts.mono ? MONO : SANS,
      )}" font-size="${fmt(opts.size * PT)}"${
        opts.bold ? ' font-weight="700"' : ""
      } fill="${opts.color ?? INK_HEX}" text-anchor="${
        opts.anchor ?? "start"
      }"${
        opts.letterSpacing
          ? ` letter-spacing="${fmt(opts.letterSpacing * PT)}"`
          : ""
      }${opts.clipId ? ` clip-path="url(#${opts.clipId})"` : ""}>${esc(
        value,
      )}</text>`,
    );
  };

  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
  ) =>
    parts.push(
      `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(
        y2,
      )}" stroke="${INK_HEX}" stroke-width="${fmt(width)}"/>`,
    );

  // Bandes opaques — en-tête et pied masquent la composition qui passerait
  // dessous ; la zone centrale reste transparente.
  parts.push(
    `<rect x="${fmt(fx)}" y="${fmt(fy)}" width="${fmt(fw)}" height="${fmt(
      HEADER_H,
    )}" fill="${WHITE_HEX}"/>`,
    `<rect x="${fmt(fx)}" y="${fmt(footerTop)}" width="${fmt(
      fw,
    )}" height="${fmt(FOOTER_H)}" fill="${WHITE_HEX}"/>`,
  );

  // Cadre de page.
  parts.push(
    `<rect x="${fmt(fx)}" y="${fmt(fy)}" width="${fmt(fw)}" height="${fmt(
      fh,
    )}" fill="none" stroke="${INK_HEX}" stroke-width="${fmt(LW.frame)}"/>`,
  );
  line(fx, headerBottom, fx + fw, headerBottom, LW.frame);
  line(fx, footerTop, fx + fw, footerTop, LW.frame);

  // ── Cellule 1 : logo de l'espace, seul et centré. Sinon son nom. ──────────
  const espaceName = (input.espaceName ?? "").trim();
  if (input.logo) {
    const availW = LOGO_CELL_W - 10;
    const availH = HEADER_H - 5;
    let h = availH;
    let w = h * input.logo.ratio;
    if (w > availW) {
      w = availW;
      h = w / input.logo.ratio;
    }
    parts.push(
      `<image x="${fmt(fx + (LOGO_CELL_W - w) / 2)}" y="${fmt(
        fy + (HEADER_H - h) / 2,
      )}" width="${fmt(w)}" height="${fmt(h)}" href="${esc(
        input.logo.dataUrl,
      )}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  } else if (espaceName) {
    text(espaceName.toUpperCase(), fx + 5, fy + HEADER_H / 2 + 1.2, {
      size: 10,
      bold: true,
      clipId: clip(fx, fy, LOGO_CELL_W - 5, HEADER_H),
    });
  }
  line(fx + LOGO_CELL_W, fy, fx + LOGO_CELL_W, headerBottom, LW.cell);

  // ── Cellules d'information ────────────────────────────────────────────────
  // Le projet est l'information dominante : juste après le logo, en corps de
  // titre, sur la cellule la plus large. Mêmes proportions que `bom-pdf.ts`.
  const cells: Array<{ label: string; value: string; flex: number; big?: boolean }> = [
    {
      label: "PROJET",
      value: input.projectName?.trim() || "—",
      flex: 2,
      big: true,
    },
    { label: "LIEU", value: input.location?.trim() || "—", flex: 1.1 },
    { label: "DOCUMENT", value: input.documentLabel, flex: 0.8 },
  ];
  const rest = fw - LOGO_CELL_W;
  const sum = cells.reduce((a, c) => a + c.flex, 0);
  let x = fx + LOGO_CELL_W;
  cells.forEach((cell, i) => {
    const w = (rest * cell.flex) / sum;
    const cellClip = clip(x, fy, w - 5, HEADER_H);
    text(cell.label, x + 5, fy + 5, {
      size: 7,
      mono: true,
      color: MUTED_HEX,
      letterSpacing: 0.6,
      clipId: cellClip,
    });
    text(cell.value, x + 5, fy + 11, {
      size: cell.big ? 14 : 10,
      bold: cell.big,
      clipId: cellClip,
    });
    x += w;
    if (i < cells.length - 1) line(x, fy, x, headerBottom, LW.cell);
  });

  // ── Pied : document à gauche, espace au centre, pagination à droite ───────
  const footerBaseline = footerTop + FOOTER_H / 2 + 1;
  const left = [input.projectName?.trim(), input.documentLabel]
    .filter(Boolean)
    .join(" — ");
  text(left, fx + PAD_X, footerBaseline, {
    size: 8,
    color: MUTED_HEX,
    clipId: clip(fx, footerTop, fw / 3, FOOTER_H),
  });
  if (espaceName) {
    text(espaceName, fx + fw / 2, footerBaseline, {
      size: 8,
      color: MUTED_HEX,
      anchor: "middle",
      clipId: clip(fx + fw / 3, footerTop, fw / 3, FOOTER_H),
    });
  }
  text(
    `${input.pageNum ?? 1} / ${input.pageCount ?? 1}`,
    fx + fw - PAD_X,
    footerBaseline,
    {
      size: 8,
      mono: true,
      color: MUTED_HEX,
      anchor: "end",
      clipId: clip(fx + (fw * 2) / 3, footerTop, fw / 3, FOOTER_H),
    },
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(PW)}mm" height="${fmt(
      PH,
    )}mm" viewBox="0 0 ${fmt(PW)} ${fmt(PH)}">`,
    clips.length > 0 ? `<defs>${clips.join("")}</defs>` : "",
    parts.join(""),
    `</svg>`,
  ].join("");
}
