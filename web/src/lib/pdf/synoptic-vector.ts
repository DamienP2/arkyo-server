/**
 * Rendu VECTORIEL des couches de scène du synoptique.
 *
 * ── Le pari ───────────────────────────────────────────────────────────────
 * On ne redessine pas les câbles, zones, libellés, adaptateurs et ports
 * externes : on envoie au PDF **les `<svg>` de l'écran**, pris dans la copie
 * que `buildExportClone` produit déjà. Il n'existe donc pas de second renderer
 * pour ces familles, et rien à maintenir en parallèle — c'est précisément la
 * dérive qui avait fini par tuer l'ancien exportateur programmatique, où
 * chaque nouveau type d'annotation manquait au PDF pendant des mois.
 *
 * Cela n'est possible que parce que ces couches sont du SVG NATIF : aucun
 * `foreignObject` nulle part, que des `path`, `rect`, `circle`, `polygon`,
 * `line`, `text`/`tspan` et `g`. Les cartes d'équipement, elles, sont du HTML :
 * elles sont REDESSINÉES en primitives par `lib/pdf/synoptic-cards.ts`. C'est
 * le seul endroit du chemin vectoriel où un second renderer existe, et donc le
 * seul que le garde-fou anti-dérive ait à surveiller.
 *
 * ── Ordre de peinture ─────────────────────────────────────────────────────
 * Les couches portent `data-scene-layer="base" | "over"` : `base` passe SOUS
 * les cartes (câbles, zones, libellés), `over` par-dessus (adaptateurs, ports
 * externes, qui portent un `z-index` à l'écran). L'appelant intercale l'image
 * des cartes entre les deux. Déduire cet ordre d'un index d'enfant aurait cassé
 * au premier ajout de couche.
 *
 * ── Repère ────────────────────────────────────────────────────────────────
 * Une couche est un `<svg width=SVG_W height=SVG_H>` calé en `inset-0` dans le
 * nœud de transformation, lui-même en `translate(pan) scale(zoom)` à l'origine
 * de la boîte. La boîte couvre la feuille. Donc, pour un point de coordonnées
 * utilisateur `u` :
 *
 *     mm = (pan + u × zoom) × (page.w / box.w)
 *
 * ce qui se traduit directement en rectangle de destination pour `doc.svg()`,
 * sans matrice à composer.
 */

import { ensureJsPdf } from "@/lib/pdf/load-jspdf";

/** Couches exportables, dans l'ordre de peinture de l'écran. */
export const SCENE_LAYER_SELECTOR = "svg[data-scene-layer]";

// Les listes du garde-fou anti-dérive (`RENDERED_ELEMENT_KINDS`,
// `PENDING_REDRAW_KINDS`) vivent dans `synoptic-cards.ts` : c'est le SEUL
// renderer à redessiner quoi que ce soit. Les couches SVG transitent, elles
// n'ont rien à déclarer.

export type VectorFrame = {
  /** Boîte de rendu de la copie, en px CSS. */
  box: { w: number; h: number };
  /**
   * Cadrage de la scène dans cette boîte — structurellement identique à
   * `SynopticExportCamera`. Redéclaré plutôt qu'importé : ce module doit rester
   * en dessous de la vue dans le graphe de dépendances, pas à côté d'elle.
   */
  camera: { zoom: number; pan: { x: number; y: number } };
  /** Page cible, en mm. */
  page: { w: number; h: number };
};

/** Sous-ensemble de jsPDF utilisé ici — `svg()` est ajouté par svg2pdf. */
export type VectorDoc = {
  svg: (
    el: Element,
    opts: { x: number; y: number; width: number; height: number },
  ) => Promise<unknown>;
  saveGraphicsState: () => void;
  restoreGraphicsState: () => void;
  /**
   * `style` accepte `null` : c'est l'idiome jsPDF pour poser un chemin SANS le
   * peindre, préalable obligé à `clip()`. L'omettre fait retomber sur le style
   * par défaut — un TRAIT — et dessine le rectangle de découpe sur la page.
   */
  rect: (
    x: number,
    y: number,
    w: number,
    h: number,
    style?: string | null,
  ) => void;
  clip: () => void;
  discardPath?: () => void;
};

// arkyo-server: bundlé (hors ligne) : svg2pdf.js 2.2.3 (version du CDN d'arkyo)
// vient du paquet npm, chargé à la demande par `import()` ; plus d'URL de CDN.

let svg2pdfPromise: Promise<void> | null = null;

/**
 * Charge svg2pdf depuis le CDN. Il se greffe sur le prototype de jsPDF, qui
 * DOIT donc être chargé avant — l'appelant s'en assure, comme pour le reste de
 * la chaîne d'export.
 */
export function ensureSvg2Pdf(): Promise<void> {
  if (svg2pdfPromise) return svg2pdfPromise;
  svg2pdfPromise = (async () => {
    if (typeof window === "undefined") throw new Error("SSR: no window");
    // Ordre imposé : svg2pdf se greffe sur le prototype de jsPDF.
    await ensureJsPdf();
    const w = window as unknown as { svg2pdf?: unknown };
    if (w.svg2pdf) return;
    // arkyo-server: bundlé (hors ligne) : `import()` du paquet à la place de la
    // balise <script>. Le module se greffe à l'import sur le prototype du
    // `jspdf` npm, le même module que `ensureJsPdf` expose sur `window.jspdf`.
    await import("svg2pdf.js").then(
      (mod) => {
        w.svg2pdf = mod;
      },
      () => {
        throw new Error("Chargement de svg2pdf impossible.");
      },
    );
  })().catch((e) => {
    // Un échec de CDN ne doit pas condamner la session : la prochaine
    // tentative repart de zéro, et l'appelant se replie sur l'image.
    svg2pdfPromise = null;
    throw e;
  });
  return svg2pdfPromise;
}

/**
 * Recale les repères de numéro en double sur la police du DOCUMENT.
 *
 * À l'écran, le triangle est posé après le libellé de câble, dont la largeur
 * est ESTIMÉE à tant de pixels par caractère. C'est suffisant tant que la
 * police reste celle du navigateur ; le PDF lui en substitue une autre, et le
 * repère se met à flotter à côté du texte qu'il désigne.
 *
 * On remesure donc le libellé dans la police cible et on décale le groupe de
 * l'écart. Un `translate` sur le `<g>` suffit : ni le triangle ni son « ! » ne
 * bougent l'un par rapport à l'autre.
 *
 * La mesure passe par un canvas 2D plutôt que par jsPDF : elle doit avoir lieu
 * AVANT que le document n'existe, au moment où l'on prépare la copie.
 */
export function recalibrateDuplicateMarkers(root: Element): number {
  const marks = root.querySelectorAll<SVGGElement>("g[data-dup-tri]");
  if (marks.length === 0) return 0;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  // Même famille et même corps que ce que `inlineSvgPresentation` impose au
  // texte des libellés — sinon on corrigerait vers une troisième métrique.
  ctx.font = "8px Helvetica, Arial, sans-serif";
  const measure = (t: string) => ctx.measureText(t).width;

  let moved = 0;
  for (const g of Array.from(marks)) {
    const dir = Number(g.getAttribute("data-dir")) || 1;
    const estimated = Number(g.getAttribute("data-est-w"));
    if (!Number.isFinite(estimated)) continue;
    const ct = g.getAttribute("data-ct") ?? "";
    const label = g.getAttribute("data-label") ?? "";
    // Même composition qu'à l'écran : nom du connecteur, écart de 8, libellé.
    const real = (ct ? measure(ct) + 8 : 0) + measure(label);
    const dx = dir * (real - estimated);
    if (Math.abs(dx) < 0.5) continue;
    const prev = g.getAttribute("transform");
    g.setAttribute(
      "transform",
      `${prev ? `${prev} ` : ""}translate(${dx.toFixed(2)} 0)`,
    );
    moved += 1;
  }
  return moved;
}

/** Couches de scène de la copie, réparties selon leur place dans la pile. */
export function collectSceneLayers(cloneRoot: Element): {
  base: SVGSVGElement[];
  over: SVGSVGElement[];
} {
  const all = Array.from(
    cloneRoot.querySelectorAll<SVGSVGElement>(SCENE_LAYER_SELECTOR),
  );
  return {
    base: all.filter((el) => el.getAttribute("data-scene-layer") === "base"),
    over: all.filter((el) => el.getAttribute("data-scene-layer") === "over"),
  };
}

/** Rectangle de destination, en mm, d'une couche de scène. */
function layerRect(layer: SVGSVGElement, frame: VectorFrame) {
  // Facteur mm/px. La boîte a l'aspect de la page (elle EST la feuille) : les
  // deux rapports coïncident. On prend le plus petit par sûreté — une dérive
  // d'arrondi ne doit pas étirer la scène.
  const s = Math.min(frame.page.w / frame.box.w, frame.page.h / frame.box.h);
  const w = Number(layer.getAttribute("width")) || frame.box.w;
  const h = Number(layer.getAttribute("height")) || frame.box.h;
  const { zoom, pan } = frame.camera;
  return {
    x: pan.x * s,
    y: pan.y * s,
    width: w * zoom * s,
    height: h * zoom * s,
  };
}

/**
 * Dessine une liste de couches. Le contenu est découpé à la feuille : sans
 * cela, un plan cadré serré laisserait dans le fichier tout ce qui déborde —
 * invisible à l'écran, mais présent à l'ouverture dans un éditeur vectoriel.
 */
export async function drawSceneLayers(
  doc: VectorDoc,
  layers: SVGSVGElement[],
  frame: VectorFrame,
): Promise<void> {
  if (layers.length === 0) return;
  doc.saveGraphicsState();
  // `null` : chemin posé, PAS peint. Sans lui, jsPDF retombe sur son style par
  // défaut et trace le rectangle de découpe tout autour de la page.
  doc.rect(0, 0, frame.page.w, frame.page.h, null);
  doc.clip();
  doc.discardPath?.();
  try {
    for (const layer of layers) {
      await doc.svg(layer, layerRect(layer, frame));
    }
  } finally {
    doc.restoreGraphicsState();
  }
}

/**
 * Dessine un habillage pleine page depuis sa source SVG.
 *
 * Le cartouche est déjà produit en SVG (`standardCartoucheSvg`,
 * `renderPrintLayoutToSvgString`) : le rasteriser pour l'incruster était une
 * perte pure. C'est le gain le plus net du vectoriel — un cartouche, c'est du
 * texte et des filets, exactement ce qu'un aplat de pixels rend mal.
 */
export async function drawOverlaySvg(
  doc: VectorDoc,
  svgSource: string,
  page: { w: number; h: number },
): Promise<void> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-99999px";
  host.style.top = "0";
  host.style.pointerEvents = "none";
  host.innerHTML = svgSource;
  const el = host.firstElementChild;
  if (!el) throw new Error("Cartouche SVG illisible.");
  // Attaché : `svg2pdf` mesure les textes via le moteur de rendu, et un
  // fragment détaché ne mesure rien.
  document.body.appendChild(host);
  try {
    await doc.svg(el, { x: 0, y: 0, width: page.w, height: page.h });
  } finally {
    host.remove();
  }
}
