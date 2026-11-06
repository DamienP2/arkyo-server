/**
 * Export PDF « blueprint » d'une vue canvas (synoptique, cartographie,
 * élévations rack, plans…) habillée par un modèle Cartouche
 * (`TenantPrintTemplate` — Administration > Paramètres > Impression).
 *
 * Rendu : page au format papier du modèle (surchargable). Le cartouche est
 * le **layout WYSIWYG** dessiné par l'utilisateur dans l'admin
 * (PrintLayoutEditor) : rasterisé en transparent et superposé au plan capturé.
 *
 * Secours (modèle sans layout) : cadre « dessin technique » (double bordure +
 * colonne cartouche droite, primitives de `lib/pdf/synoptic-export.ts`) avec
 * les `slots` du modèle : `slotValues[key] ?? defaultValue ?? sample` — le
 * premier slot TEXT/VARIABLE fait office de titre, LOGO ignoré.
 *
 * jsPDF est chargé via CDN (pattern existant) — aucune dépendance npm.
 */
// arkyo-server: bundlé (hors ligne) : `loadJsPDF` (export-capture) charge le
// jsPDF 2.5.1 embarqué (`lib/pdf/load-jspdf.ts`), plus aucun CDN.

import {
  captureWithFlatten,
  loadJsPDF,
} from "@/app/(fullscreen)/project/[id]/reseau/_components/shared/export-capture";
import { downloadBlob } from "@/lib/export/download-blob";
import { JSPDF_BASE } from "@/lib/pdf/load-jspdf";
import { CARTOUCHE_LAYER_DPI } from "@/lib/print/technical-frame";
import {
  computeCartoucheFrame,
  drawCartoucheChrome,
  type CartoucheField,
} from "@/lib/pdf/synoptic-export";
import {
  adaptPrintLayoutToSize,
  getPaperDimensionsMm,
  type Orientation,
  type PaperFormat,
  type PrintLayout,
} from "@/lib/services/print-layout";
import {
  renderPrintLayoutToSvgString,
  svgStringToPngDataUrl,
} from "@/lib/print/render-print-layout";

// ── Types (modèle Cartouche = TenantPrintTemplate côté client) ───────────────

export type CartoucheSlotType = "TEXT" | "VARIABLE" | "LOGO";

export type CartoucheSlot = {
  key: string;
  label: string;
  type: CartoucheSlotType;
  defaultValue?: string;
  sample?: string;
};

export type CartoucheTemplate = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  paperFormat: PaperFormat;
  orientation: Orientation;
  slots: CartoucheSlot[];
  /**
   * Layout WYSIWYG dessiné dans l'admin (PrintLayoutEditor) : cadre, bloc
   * titre, textes, logo… C'est LE rendu du cartouche choisi par l'utilisateur.
   * Les `slots` ne servent que de secours pour un modèle sans layout.
   */
  layout?: PrintLayout | null;
  isActive?: boolean;
  sortOrder?: number;
};

/** Vrai si le modèle porte un layout WYSIWYG exploitable. */
export function cartoucheHasLayout(
  template: CartoucheTemplate,
): template is CartoucheTemplate & { layout: PrintLayout } {
  return (
    !!template.layout &&
    Array.isArray(template.layout.elements) &&
    template.layout.elements.length > 0
  );
}

/** Valeur affichée pour un slot : saisie > défaut du modèle > exemple. */
export function resolveSlotValue(slot: CartoucheSlot, slotValues: Record<string, string>): string {
  return slotValues[slot.key] ?? slot.defaultValue ?? slot.sample ?? "";
}

// ── Export ───────────────────────────────────────────────────────────────────

export type ExportBlueprintInput = {
  /** Élément DOM à capturer (via `captureWithFlatten`, pixelRatio 2). */
  el?: HTMLElement;
  /** Alternative : image déjà capturée (data URL PNG ou JPEG). */
  imageDataUrl?: string;
  /** Modèle Cartouche (`TenantPrintTemplate`). */
  template: CartoucheTemplate;
  /** Valeurs saisies pour les slots, indexées par `slot.key`. */
  slotValues: Record<string, string>;
  /** Surcharge du format papier (défaut : celui du modèle). */
  paperFormat?: PaperFormat;
  /** Surcharge de l'orientation (défaut : celle du modèle). */
  orientation?: Orientation;
  /** Nom du fichier téléchargé. */
  filename: string;
  /** Couleur de fond de la capture et de la zone de dessin (défaut blanc). */
  background?: string;
  /** Éléments à masquer pendant la capture (grille, chrome d'édition…). */
  hideSelectors?: string[];
  /**
   * Variables `{namespace.champ}` interpolées dans le layout WYSIWYG du
   * modèle (nom du projet, espace, dates… — cf. `buildBaseOverrides`).
   */
  overrides?: Record<string, string | null | undefined>;
};

/** Doc jsPDF instancié via `loadJsPDF` (typage structurel du loader CDN). */
type JsPdfDocInstance = InstanceType<Awaited<ReturnType<typeof loadJsPDF>>["jsPDF"]>;

type BlueprintPageImage = {
  imgData: string;
  imgFormat: "PNG" | "JPEG";
  srcW: number;
  srcH: number;
};

/** Mesure une image data URL (dimensions natives). */
async function toPageImage(dataUrl: string): Promise<BlueprintPageImage> {
  const size = await loadImageSize(dataUrl);
  return {
    imgData: dataUrl,
    imgFormat: dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG",
    srcW: size.w,
    srcH: size.h,
  };
}

/** Letterbox centré d'une image dans une zone, avec retrait. */
function placeImage(
  doc: JsPdfDocInstance,
  img: BlueprintPageImage,
  zone: { x: number; y: number; w: number; h: number },
  marginMm: number,
): void {
  const availW = zone.w - marginMm * 2;
  const availH = zone.h - marginMm * 2;
  const ratio = img.srcW / Math.max(1, img.srcH);
  let iW = availW;
  let iH = iW / ratio;
  if (iH > availH) {
    iH = availH;
    iW = iH * ratio;
  }
  const iX = zone.x + (zone.w - iW) / 2;
  const iY = zone.y + (zone.h - iH) / 2;
  doc.addImage(img.imgData, img.imgFormat, iX, iY, iW, iH);
}

/**
 * Source SVG du layout WYSIWYG, à la taille de la page cible.
 *
 * Séparée de la rasterisation : un cartouche est du TEXTE et des FILETS, et le
 * rendu vectoriel du PDF le consomme tel quel. Le rasteriser pour l'incruster
 * était une perte pure — c'est exactement ce qu'on voit mollir au zoom.
 */
export function buildCartoucheLayoutSvg(
  template: CartoucheTemplate & { layout: PrintLayout },
  overrides: Record<string, string | null | undefined>,
  PW: number,
  PH: number,
): string {
  // Taille de CONCEPTION du layout : estampillée à la sauvegarde par
  // l'éditeur (`designSizeMm`) ; rétrocompat : anciens layouts sans champ =
  // conçus au format du modèle.
  const src =
    template.layout.designSizeMm ??
    getPaperDimensionsMm(template.paperFormat, template.orientation);
  const dst = { w: PW, h: PH };
  // Ancrage intelligent si la page CIBLE diffère de la conception : chaque
  // élément garde sa taille réelle en mm et reste accroché au bord le plus
  // proche ; les cadres qui longent la feuille s'étirent avec elle
  // (`adaptPrintLayoutToSize`). Le SVG a le viewBox de la page CIBLE.
  const layout = adaptPrintLayoutToSize(template.layout, src, dst);
  return renderPrintLayoutToSvgString(layout, overrides, template.paperFormat, {
    orientation: template.orientation,
    transparentBackground: true,
    sizeMm: dst,
  });
}

/**
 * Rasterise le layout WYSIWYG du modèle en PNG transparent pleine page.
 * Exporté pour le poster synoptique (même composition, jsPDF différent).
 *
 * Résolution : 300 dpi plafonnés à 12 000 px de côté, PUIS rabattus dans un
 * budget de surface. L'ancien plafond de 6 000 px bridait un A0 à ~128 dpi —
 * c'est ce qui rendait les grands formats mous au zoom, et le budget n'entrait
 * alors jamais en jeu.
 */
export async function rasterizeCartoucheLayout(
  template: CartoucheTemplate & { layout: PrintLayout },
  overrides: Record<string, string | null | undefined>,
  PW: number,
  PH: number,
  opts?: {
    /**
     * Plafond de surface du bitmap produit. Sans lui, un A1 sort à ~25 Mpx :
     * acceptable pour une planche d'impression, mortel pour un calque d'écran
     * régénéré à chaque réglage. L'appelant qui prévisualise donne un budget.
     */
    maxPixels?: number;
  },
): Promise<string> {
  const svg = buildCartoucheLayoutSvg(template, overrides, PW, PH);
  let dpi = Math.min(CARTOUCHE_LAYER_DPI, (25.4 * 12000) / Math.max(PW, PH));
  {
    // Budget de pixels ABSOLU : on ramène la résolution jusqu'à ce que la
    // surface tienne. Un facteur relatif ne protégerait de rien, la surface
    // dépendant du format de page. Le défaut vaut pour l'impression ; un
    // appelant qui prévisualise donne le sien, bien plus bas.
    const maxPixels = opts?.maxPixels ?? 36_000_000;
    const area = ((PW * dpi) / 25.4) * ((PH * dpi) / 25.4);
    if (area > maxPixels) dpi *= Math.sqrt(maxPixels / area);
  }
  const wPx = Math.max(1, Math.round((PW * dpi) / 25.4));
  const hPx = Math.max(1, Math.round((PH * dpi) / 25.4));
  return svgStringToPngDataUrl(svg, wPx, hPx, { transparent: true });
}

/**
 * Rendu d'UNE page blueprint dans le doc courant.
 *
 * Modèle AVEC layout WYSIWYG (cas normal — le cartouche dessiné par
 * l'utilisateur dans l'admin) : fond blanc → plan letterboxé pleine page avec
 * retrait → layout rasterisé en transparent PAR-DESSUS (ses blocs pleins
 * masquent l'image dessous, comme un vrai cartouche papier).
 *
 * Modèle SANS layout (secours) : cadre technique + chrome générique depuis
 * les `slots` (premier slot = titre du bandeau, LOGO ignoré).
 */
async function drawBlueprintPage(
  doc: JsPdfDocInstance,
  opts: {
    PW: number;
    PH: number;
    background: string;
    img: BlueprintPageImage;
    template: CartoucheTemplate;
    slotValues: Record<string, string>;
    overrides?: Record<string, string | null | undefined>;
  },
): Promise<void> {
  const { PW, PH, background, img, template, slotValues } = opts;

  // Retrait de l'image capturée : ~8 mm sur A4, proportionnel au-delà.
  const CONTENT_MARGIN_MM = Math.max(8, Math.min(PW, PH) * 0.04);

  if (cartoucheHasLayout(template)) {
    const overlay = await rasterizeCartoucheLayout(
      template,
      { ...opts.overrides, ...slotValues },
      PW,
      PH,
    );
    fillHex(doc, 0, 0, PW, PH, "#ffffff");
    placeImage(doc, img, { x: 0, y: 0, w: PW, h: PH }, CONTENT_MARGIN_MM);
    doc.addImage(overlay, "PNG", 0, 0, PW, PH);
    return;
  }

  // ── Secours : chrome générique depuis les slots ─────────────────────────
  const frame = computeCartoucheFrame(PW, PH);
  fillHex(doc, 0, 0, PW, PH, "#ffffff");
  fillHex(doc, frame.drawX, frame.drawY, frame.drawW, frame.drawH, background);
  placeImage(
    doc,
    img,
    { x: frame.drawX, y: frame.drawY, w: frame.drawW, h: frame.drawH },
    CONTENT_MARGIN_MM,
  );
  drawSlotChrome(doc, PW, PH, template, slotValues);
}

/**
 * Chrome générique dessiné depuis les `slots` — SEUL rendu possible pour un
 * modèle sans layout WYSIWYG. Premier slot TEXT/VARIABLE = titre du bandeau,
 * LOGO ignoré (le chrome de secours ne sait pas placer d'image).
 */
function drawSlotChrome(
  doc: JsPdfDocInstance,
  PW: number,
  PH: number,
  template: CartoucheTemplate,
  slotValues: Record<string, string>,
): void {
  const frame = computeCartoucheFrame(PW, PH);
  const printable = template.slots.filter((s) => s.type !== "LOGO");
  const [titleSlot, ...restSlots] = printable;
  const fields: CartoucheField[] = restSlots.map((s) => ({
    label: s.label,
    value: resolveSlotValue(s, slotValues),
  }));
  drawCartoucheChrome(doc, frame, {
    headerTitle: template.name.toUpperCase(),
    headerSubtitle: titleSlot ? resolveSlotValue(titleSlot, slotValues) : undefined,
    fields,
    columns: 1,
  });
}

/** Téléchargement (fallback `doc.save`). */
function finishBlueprintDoc(doc: JsPdfDocInstance, filename: string): void {
  try {
    downloadBlob(doc.output("blob"), filename);
  } catch {
    doc.save(filename);
  }
}

/**
 * Cœur de la génération blueprint : produit le PDF et le renvoie en blob, SANS
 * effet de bord (ni téléchargement, ni enregistrement Documents).
 *
 * C'est ce que consomme l'aperçu du modal d'export (`previewExport`) : appeler
 * `exportBlueprintPdf` pour prévisualiser déclencherait un vrai téléchargement
 * à chaque changement de réglage.
 *
 * Lève une erreur si ni `el` ni `imageDataUrl` n'est fourni (le feedback
 * utilisateur est à la charge de l'appelant, comme pour `exportSynopticPDF`).
 */
/**
 * Multiplication de la capture blueprint. 2 laissait une planche molle dès
 * qu'on zoomait ; 3 approche la résolution d'impression sans faire exploser
 * l'allocation (la vue capturée est un écran, pas une page entière).
 */
const BLUEPRINT_CAPTURE_RATIO = 3;

export async function buildBlueprintPdf(
  input: Omit<ExportBlueprintInput, "filename">,
): Promise<Blob> {
  const { el, imageDataUrl, template, slotValues } = input;
  const background = input.background ?? "#ffffff";
  const paperFormat = input.paperFormat ?? template.paperFormat;
  const orientation = input.orientation ?? template.orientation;
  const { w: PW, h: PH } = getPaperDimensionsMm(paperFormat, orientation);

  // ── Capture / image source ────────────────────────────────────────────
  let img: BlueprintPageImage;
  if (el) {
    const canvas = await captureWithFlatten(el, {
      pixelRatio: BLUEPRINT_CAPTURE_RATIO,
      background,
      hideSelectors: input.hideSelectors,
    });
    // PNG, sans perte. Un JPEG à 0,85 posait des artefacts de blocs le long de
    // chaque filet et de chaque lettre : sur un document TECHNIQUE, c'est
    // exactement ce que l'on regarde en zoomant. Le poids gagné ne valait pas
    // une planche floue.
    img = {
      imgData: canvas.toDataURL("image/png"),
      imgFormat: "PNG",
      srcW: canvas.width,
      srcH: canvas.height,
    };
    // Tampon relâché dès l'extraction : jsPDF va allouer autant.
    canvas.width = 0;
    canvas.height = 0;
  } else if (imageDataUrl) {
    img = await toPageImage(imageDataUrl);
  } else {
    throw new Error("buildBlueprintPdf : fournir `el` ou `imageDataUrl`.");
  }

  const { jsPDF } = await loadJsPDF();
  const doc = new jsPDF({
    ...JSPDF_BASE,
    orientation: PW > PH ? "landscape" : "portrait",
    unit: "mm",
    format: [PW, PH],
  });
  await drawBlueprintPage(doc, {
    PW,
    PH,
    background,
    img,
    template,
    slotValues,
    overrides: input.overrides,
  });
  return doc.output("blob") as Blob;
}

/**
 * Génère PUIS télécharge. Contrat inchangé pour les appelants historiques —
 * seul le cœur a été extrait (`buildBlueprintPdf`).
 */
export async function exportBlueprintPdf(input: ExportBlueprintInput): Promise<void> {
  const { filename, ...core } = input;
  downloadBlob(await buildBlueprintPdf(core), filename);
}

// ── Export « composé » (mise en page libre de plusieurs vues sur UNE page) ──

/**
 * Une vue posée sur la page, en coordonnées PAGE (mm, origine coin haut-gauche
 * de la feuille). Contrairement au blueprint classique — qui letterboxe UNE
 * capture sur toute la page — ici l'appelant a déjà décidé de la position et de
 * la taille de chaque vue : le générateur ne recadre rien.
 */
export type ComposedBlueprintItem = {
  /** Image de la vue. PNG transparent recommandé (les vues se chevauchent). */
  dataUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Habillage de la page. Deux sources possibles, une seule sémantique : un
 * calque pleine page composité PAR-DESSUS les vues.
 *  - `template` : modèle Cartouche de l'espace (layout WYSIWYG, ou chrome de
 *    secours depuis ses slots) ;
 *  - `image`    : calque déjà rasterisé par l'appelant — c'est ce que fournit
 *    le « Modèle standard », dessiné en SVG pour être identique à l'écran et
 *    dans le document.
 */
export type ComposedBlueprintOverlay =
  | {
      kind: "template";
      template: CartoucheTemplate;
      slotValues: Record<string, string>;
      /** Variables `{namespace.champ}` interpolées dans le layout WYSIWYG. */
      overrides?: Record<string, string | null | undefined>;
    }
  | { kind: "image"; dataUrl: string }
  | { kind: "none" };

export type BuildComposedBlueprintInput = {
  /** Vues à poser, du fond vers le dessus (l'ordre du tableau EST le z-order). */
  items: ComposedBlueprintItem[];
  overlay: ComposedBlueprintOverlay;
  paperFormat: PaperFormat;
  orientation: Orientation;
  /** Couleur de la feuille (défaut blanc). */
  background?: string;
};

/**
 * Génère UNE page portant plusieurs vues à leur position exacte, habillée par
 * le cartouche du modèle. Pur : renvoie un blob, sans effet de bord — c'est ce
 * que consomment à la fois l'aperçu et les deux actions du modal d'export.
 *
 * Le cartouche est composité PAR-DESSUS les vues, comme dans le blueprint
 * classique : ses blocs pleins masquent ce qui passe dessous, exactement comme
 * l'éditeur de mise en page le montre à l'écran.
 */
export async function buildComposedBlueprintPdf(
  input: BuildComposedBlueprintInput,
): Promise<Blob> {
  const { items, overlay } = input;
  const background = input.background ?? "#ffffff";
  const { w: PW, h: PH } = getPaperDimensionsMm(
    input.paperFormat,
    input.orientation,
  );

  const { jsPDF } = await loadJsPDF();
  const doc = new jsPDF({
    ...JSPDF_BASE,
    orientation: PW > PH ? "landscape" : "portrait",
    unit: "mm",
    format: [PW, PH],
  });

  fillHex(doc, 0, 0, PW, PH, background);
  for (const item of items) {
    if (item.w <= 0 || item.h <= 0) continue;
    const format = item.dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
    doc.addImage(item.dataUrl, format, item.x, item.y, item.w, item.h);
  }

  if (overlay.kind === "image") {
    doc.addImage(overlay.dataUrl, "PNG", 0, 0, PW, PH);
  } else if (overlay.kind === "template") {
    const { template, slotValues } = overlay;
    if (cartoucheHasLayout(template)) {
      const png = await rasterizeCartoucheLayout(
        template,
        { ...overlay.overrides, ...slotValues },
        PW,
        PH,
      );
      doc.addImage(png, "PNG", 0, 0, PW, PH);
    } else {
      drawSlotChrome(doc, PW, PH, template, slotValues);
    }
  }

  return doc.output("blob") as Blob;
}

// ── Export multi-pages (1 image = 1 page PDF, chacune avec son cartouche) ───

export type ExportBlueprintMultiInput = {
  /**
   * Images déjà capturées, dans l'ordre des pages. `slotOverrides` surcharge
   * `slotValues` pour cette page uniquement (ex. slot « titre » = nom de la
   * page de dessin).
   */
  images: Array<{ dataUrl: string; slotOverrides?: Record<string, string> }>;
  /** Modèle Cartouche (`TenantPrintTemplate`). */
  template: CartoucheTemplate;
  /** Valeurs communes des slots, indexées par `slot.key`. */
  slotValues: Record<string, string>;
  /** Surcharge du format papier (défaut : celui du modèle). */
  paperFormat?: PaperFormat;
  /** Surcharge de l'orientation (défaut : celle du modèle). */
  orientation?: Orientation;
  /** Nom du fichier téléchargé. */
  filename: string;
  /** Couleur de fond de la zone de dessin (défaut blanc). */
  background?: string;
  /** Variables `{namespace.champ}` interpolées dans le layout WYSIWYG. */
  overrides?: Record<string, string | null | undefined>;
};

/**
 * Variante multi-pages d'`exportBlueprintPdf` : chaque image devient une page
 * du même document, au même format papier, chacune avec son cartouche.
 */
export async function exportBlueprintPdfMulti(
  input: ExportBlueprintMultiInput,
): Promise<void> {
  const { template, slotValues, filename } = input;
  if (input.images.length === 0) {
    throw new Error("exportBlueprintPdfMulti : aucune image fournie.");
  }
  const background = input.background ?? "#ffffff";
  const paperFormat = input.paperFormat ?? template.paperFormat;
  const orientation = input.orientation ?? template.orientation;
  const { w: PW, h: PH } = getPaperDimensionsMm(paperFormat, orientation);

  const pages = await Promise.all(input.images.map((im) => toPageImage(im.dataUrl)));

  const { jsPDF } = await loadJsPDF();
  const doc = new jsPDF({
    ...JSPDF_BASE,
    orientation: PW > PH ? "landscape" : "portrait",
    unit: "mm",
    format: [PW, PH],
  });
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) doc.addPage();
    await drawBlueprintPage(doc, {
      PW,
      PH,
      background,
      img: pages[i]!,
      template,
      slotValues: { ...slotValues, ...input.images[i]?.slotOverrides },
      overrides: input.overrides,
    });
  }
  finishBlueprintDoc(doc, filename);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fillHex(
  doc: { setFillColor: (r: number, g: number, b: number) => void; rect: (x: number, y: number, w: number, h: number, style?: string) => void },
  x: number,
  y: number,
  w: number,
  h: number,
  hex: string,
) {
  const c = hex.replace("#", "");
  doc.setFillColor(
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
  );
  doc.rect(x, y, w, h, "F");
}

function loadImageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("exportBlueprintPdf : image illisible."));
    img.src = dataUrl;
  });
}

