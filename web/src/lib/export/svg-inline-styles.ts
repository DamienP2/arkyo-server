/**
 * Aplatissement des styles d'un sous-arbre SVG en attributs de présentation
 * littéraux.
 *
 * ── Pourquoi ──────────────────────────────────────────────────────────────
 * Nos couches de scène s'appuient sur les variables du thème :
 * `stroke="var(--accent)"`, `style={{ fill: "var(--muted-foreground)" }}`,
 * `color-mix(in srgb, …)`. Le navigateur les résout, `svg2pdf` non : il lit les
 * attributs et les styles en ligne, sans cascade ni fonction CSS. Sans cette
 * passe, un rendu vectoriel sort en noir ou sans contour.
 *
 * On procède donc comme `html-to-image` : on interroge le style CALCULÉ de
 * chaque nœud et on le réécrit en attribut. L'élément doit être ATTACHÉ au
 * document — `getComputedStyle` ne résout rien sur un fragment détaché.
 *
 * ── Ce que la passe retire aussi ──────────────────────────────────────────
 *  - les `filter` (halos `drop-shadow` d'édition) : sans effet en PDF, mais
 *    `svg2pdf` s'y perd ;
 *  - tout élément INVISIBLE — `display:none`, `visibility:hidden`, ou dont le
 *    fond ET le contour sont entièrement transparents. C'est le cas des zones
 *    de clic des câbles (contour `rgba(0,0,0,0)` de 20 px) : à l'écran elles ne
 *    coûtent rien, en vectoriel elles doubleraient le nombre de chemins du
 *    document. Le critère est volontairement « ce qui ne se voit pas », pas une
 *    liste de sélecteurs : il n'a rien à suivre quand le rendu évolue.
 *
 * ── Polices ───────────────────────────────────────────────────────────────
 * `svg2pdf` ne dispose que des polices de base du PDF. On tranche ici plutôt
 * que de lui laisser deviner : toute pile monospace devient `courier`, le reste
 * `helvetica`. La substitution change la largeur des textes ; c'est pour cela
 * que les libellés de câbles sont ancrés (`text-anchor`) et non positionnés au
 * pixel — l'ancrage survit au changement de police, pas une coordonnée absolue.
 */

/** Propriétés recopiées en attributs. Ordre sans importance. */
const PAINT_PROPS = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
] as const;

const TEXT_PROPS = [
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
] as const;

const SHAPE_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
]);

/** Alpha effectif d'une couleur calculée. `none` → 0. */
function paintAlpha(value: string): number {
  const v = value.trim();
  if (!v || v === "none" || v === "transparent") return 0;
  const m = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (!m) return 1; // url(#…), currentColor résolu, mot-clé : on suppose visible
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 4) return 1;
  const a = Number.parseFloat(parts[3]);
  return Number.isFinite(a) ? a : 1;
}

/** `6px 4px` → `6 4`. Les longueurs en attribut SVG se passent d'unité. */
function stripPx(value: string): string {
  return value.replace(/px/g, "");
}

function pdfFontFamily(computed: string): string {
  return /mono|courier|consolas/i.test(computed) ? "courier" : "helvetica";
}

type Plan = {
  el: Element;
  /** `true` → à retirer, les attributs ne sont alors pas calculés. */
  drop: boolean;
  attrs: Array<[string, string]>;
};

/** Rend la main au navigateur — le temps d'une peinture. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Éléments lus par tour. `getComputedStyle` est le coût dominant. */
const READ_BATCH = 250;
/** Éléments écrits par tour — l'écriture est bien moins chère. */
const WRITE_BATCH = 1500;

/** Tous les éléments du sous-arbre, en ordre document. */
function collect(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    out.push(el);
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  return out;
}

function planFor(el: Element): Plan {
  const style = window.getComputedStyle(el);

  if (style.display === "none" || style.visibility === "hidden") {
    return { el, drop: true, attrs: [] };
  }

  const tag = el.tagName.toLowerCase();

  if (SHAPE_TAGS.has(tag)) {
    const fillA =
      paintAlpha(style.getPropertyValue("fill")) *
      Number(style.getPropertyValue("fill-opacity") || 1);
    const strokeA =
      paintAlpha(style.getPropertyValue("stroke")) *
      Number(style.getPropertyValue("stroke-opacity") || 1);
    if (fillA <= 0.001 && strokeA <= 0.001) return { el, drop: true, attrs: [] };
  }

  const attrs: Array<[string, string]> = [];
  for (const prop of PAINT_PROPS) {
    const value = style.getPropertyValue(prop);
    if (!value) continue;
    // `stroke-dasharray: none` est la valeur par défaut, mais écrite en
    // attribut elle donne un motif vide que les convertisseurs lisent comme
    // une liste de NaN — le trait disparaît. On ne l'écrit que s'il y a un
    // motif. Idem pour un décalage nul, qui n'apporte rien.
    if (prop === "stroke-dasharray" && (value === "none" || !/\d/.test(value)))
      continue;
    if (prop === "stroke-dashoffset" && Number.parseFloat(value) === 0) continue;
    attrs.push([prop, stripPx(value)]);
  }
  if (tag === "text" || tag === "tspan") {
    for (const prop of TEXT_PROPS) {
      const value = style.getPropertyValue(prop);
      if (!value || value === "auto" || value === "normal") continue;
      attrs.push([prop, value]);
    }
    attrs.push([
      "font-family",
      pdfFontFamily(style.getPropertyValue("font-family")),
    ]);
  }
  return { el, drop: false, attrs };
}

/**
 * Aplatit tout le sous-arbre SVG de `root` (racine incluse si c'en est une).
 * Mute les nœuds sur place : à n'appeler que sur une COPIE.
 *
 * ── Deux passes, et ce n'est pas un détail ────────────────────────────────
 * Lire un style calculé puis écrire un attribut sur le même arbre, en boucle,
 * salit le style à chaque tour et force le navigateur à tout recalculer à la
 * lecture suivante. Sur les quelques milliers d'éléments d'un grand plan, le
 * coût devient quadratique. On LIT donc tout d'abord, puis on écrit — le
 * recalcul n'a lieu qu'une fois.
 *
 * ── Et par LOTS, avec cession du fil ──────────────────────────────────────
 * Même en deux passes, la boucle reste plusieurs secondes de travail
 * synchrone : l'onglet se fige, sans curseur d'attente ni repeinte, et
 * l'utilisateur croit à un plantage. On rend donc la main entre les lots.
 * L'invariant tient : les lectures n'invalident rien entre elles, et les
 * écritures ne relisent plus rien.
 *
 * @returns nombre d'éléments retirés parce qu'invisibles.
 */
export async function inlineSvgPresentation(root: Element): Promise<number> {
  // Un seul parcours de structure, sans toucher au style : c'est peu coûteux
  // et cela évite d'entrelacer descente et lecture.
  const elements = collect(root);

  // ── Passe 1 : lecture seule ──────────────────────────────────────────────
  const plans: Plan[] = [];
  for (let i = 0; i < elements.length; i += READ_BATCH) {
    const end = Math.min(i + READ_BATCH, elements.length);
    for (let j = i; j < end; j++) plans.push(planFor(elements[j]));
    if (end < elements.length) await yieldToUi();
  }

  // ── Passe 2 : écriture ───────────────────────────────────────────────────
  // Retirer un parent emporte ses descendants : les écritures qui suivent sur
  // un nœud détaché sont sans effet, et sans danger.
  let dropped = 0;
  for (let i = 0; i < plans.length; i += WRITE_BATCH) {
    const end = Math.min(i + WRITE_BATCH, plans.length);
    for (let j = i; j < end; j++) {
      const plan = plans[j];
      if (plan.drop) {
        plan.el.remove();
        dropped += 1;
        continue;
      }
      for (const [name, value] of plan.attrs) plan.el.setAttribute(name, value);
      // Les halos d'édition n'ont pas de traduction PDF et déroutent le
      // convertisseur : on les retire plutôt que de les laisser interpréter.
      (plan.el as SVGElement).style?.removeProperty("filter");
      plan.el.removeAttribute("filter");
    }
    if (end < plans.length) await yieldToUi();
  }
  return dropped;
}
