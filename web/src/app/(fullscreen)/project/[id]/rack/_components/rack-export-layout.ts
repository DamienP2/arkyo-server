/**
 * Modèle de la mise en page d'export du Rack : une feuille, plusieurs objets
 * posés librement dessus.
 *
 * TOUTES les coordonnées sont en **millimètres sur la feuille**, origine au
 * coin haut-gauche du papier — le même repère que le cartouche et que
 * `buildComposedBlueprintPdf`. La composition ne dépend donc ni du zoom de
 * l'éditeur ni de la résolution des captures.
 *
 * En revanche elle SUIT le format papier : changer de feuille remet la
 * composition à l'échelle (`rescaleLayout`). Le millimètre reste l'unité de
 * stockage, mais on ne conserve pas les cotes absolues d'un format à l'autre —
 * ce serait le bon choix pour un plan coté, c'est le mauvais pour une planche :
 * une composition pensée en A4 devenait un timbre-poste au milieu d'un A0, et
 * une composition A0 débordait d'un A4. Ce qui doit se conserver, c'est
 * l'allure de la page.
 *
 * Deux natures d'objet, une seule manipulation :
 *  - `rack`     : une vue d'un contenant ;
 *  - `location` : une vue d'un LIEU — tous ses contenants rackables côte à
 *    côte, dans l'ordre de l'inventaire, agrégés en UN objet. Le groupe se
 *    déplace et se redimensionne d'un bloc ; c'est le lieu qu'on pose sur la
 *    planche, pas ses racks un par un.
 *
 * La HAUTEUR d'un objet n'est pas stockée : elle se déduit du ratio naturel du
 * rendu (mesuré dans l'éditeur, recalculé depuis la capture à l'export). Une
 * élévation a un ratio imposé par sa hauteur en U — le stocker ouvrirait la
 * porte à une composition déformée.
 */

import type { ViewId } from "@/components/synoptique/lib/types";
import {
  getPaperDimensionsMm,
  type Orientation,
  type PaperFormat,
} from "@/lib/services/print-layout";

import type { RackRenderMode } from "./rack-tab-left-toolbar";

/** Vues proposées à l'ajout, dans l'ordre de lecture d'un dossier technique. */
export const RACK_EXPORT_VIEWS: ReadonlyArray<{ id: ViewId; label: string }> = [
  { id: "FRONT", label: "Avant" },
  { id: "REAR", label: "Arrière" },
  { id: "REAR_INTERIOR", label: "Arr. int." },
  { id: "SIDE", label: "Côté" },
];

type ItemBase = {
  id: string;
  /** Coin haut-gauche sur la feuille (mm). */
  x: number;
  y: number;
  /** Largeur sur la feuille (mm). La hauteur suit le ratio naturel. */
  w: number;
  /**
   * Mode de rendu des équipements, PROPRE à cet objet. Une planche mêle
   * volontiers une élévation standard et une photo du même rack — le mode ne
   * peut donc pas être global.
   *
   * Absent = mode courant de l'onglet, résolu à l'affichage. C'est ce qui rend
   * les compositions enregistrées avant ce champ lisibles sans migration.
   */
  renderMode?: RackRenderMode;
  /**
   * Libellé imprimé AU-DESSUS de la vue, sur le document. Quand il est saisi,
   * il REMPLACE l'entête automatique (nom du contenant ou du lieu) : deux
   * titres empilés diraient la même chose deux fois, et c'est l'utilisateur qui
   * sait comment sa planche doit se lire. Vide ou absent = entête automatique.
   */
  label?: string;
};

export type RackExportRackItem = ItemBase & {
  kind: "rack";
  rackId: string;
  /**
   * Vues CUMULABLES, rendues côte à côte dans l'ordre. Un contenant se lit
   * volontiers avant + arrière sur la même planche, et les poser comme deux
   * objets séparés obligeait à les aligner à la main.
   */
  views: ViewId[];
};

export type RackExportLocationItem = ItemBase & {
  kind: "location";
  locationId: string;
  /**
   * Vue UNIQUE. Un lieu déploie déjà ses contenants côte à côte : cumuler les
   * vues produirait une grille à deux dimensions illisible sur une feuille.
   */
  view: ViewId;
};

/**
 * Objet posé mais pas encore configuré. Il occupe une place sur la feuille et
 * se manipule comme les autres, mais ne désigne aucune cible — et n'est donc
 * JAMAIS exporté. C'est ce qui permet d'ajouter puis de choisir, au lieu de
 * devoir tout décider avant de voir quoi que ce soit.
 */
export type RackExportPlaceholderItem = ItemBase & { kind: "placeholder" };

export type RackExportItem =
  | RackExportRackItem
  | RackExportLocationItem
  | RackExportPlaceholderItem;

/** Objets réellement imprimables — les emplacements vides sont écartés. */
export function exportableItems(
  layout: RackExportLayout,
): Array<RackExportRackItem | RackExportLocationItem> {
  return layout.items.filter(
    (i): i is RackExportRackItem | RackExportLocationItem =>
      i.kind !== "placeholder",
  );
}

/** Vues portées par un objet, quelle que soit sa nature. */
export function itemViews(item: RackExportItem): ViewId[] {
  if (item.kind === "rack") return item.views;
  if (item.kind === "location") return [item.view];
  return [];
}

export type RackExportLayout = {
  items: RackExportItem[];
  /**
   * Feuille pour laquelle la composition a été établie (mm). C'est ce qui rend
   * la composition AUTO-DESCRIPTIVE : sans elle, un lecteur qui restaure une
   * composition ne peut pas savoir sur quel papier elle a été posée, et ne peut
   * donc pas la remettre à l'échelle.
   *
   * Le cas n'est pas théorique : la planche du dossier impose son format et
   * relit la MÊME composition que l'onglet. Sans repère de départ, une
   * composition A4 portrait arrivait telle quelle sur A3 paysage — un objet de
   * 297 mm de haut, à cheval sur l'en-tête et le pied du cartouche.
   *
   * Absente sur les compositions antérieures à ce champ : on renonce alors à
   * la mise à l'échelle plutôt que de deviner un format d'origine.
   */
  page?: { w: number; h: number };
};

export const EMPTY_RACK_EXPORT_LAYOUT: RackExportLayout = { items: [] };

/** Feuille déclarée par une composition, si elle est exploitable. */
export function layoutPage(
  layout: RackExportLayout,
): { w: number; h: number } | null {
  const p = layout.page;
  if (!p || !Number.isFinite(p.w) || !Number.isFinite(p.h)) return null;
  return p.w > 0 && p.h > 0 ? { w: p.w, h: p.h } : null;
}

/** Largeur minimale d'un objet (mm) — en dessous, plus rien n'est lisible. */
export const MIN_ITEM_W_MM = 15;

const VIEW_IDS: ViewId[] = ["FRONT", "REAR", "REAR_INTERIOR", "SIDE"];
const RENDER_MODE_IDS: RackRenderMode[] = ["standard", "graphic", "photo"];

/**
 * Validateur des réglages restaurés. Volontairement TOLÉRANT sur la nature de
 * l'objet : les compositions enregistrées avant l'arrivée des objets « lieu »
 * n'ont pas de `kind`. Les rejeter en bloc ferait perdre la composition à la
 * première ouverture. C'est `normalizeRackExportLayout` qui remet la forme.
 */
export function isRackExportLayout(v: unknown): v is RackExportLayout {
  if (typeof v !== "object" || v === null) return false;
  const items = (v as { items?: unknown }).items;
  if (!Array.isArray(items)) return false;
  return items.every((it) => {
    if (typeof it !== "object" || it === null) return false;
    const o = it as Record<string, unknown>;
    return (
      typeof o.id === "string" &&
      typeof o.x === "number" &&
      Number.isFinite(o.x) &&
      typeof o.y === "number" &&
      Number.isFinite(o.y) &&
      typeof o.w === "number" &&
      Number.isFinite(o.w) &&
      o.w > 0
    );
  });
}

/**
 * Remet une composition restaurée en forme : `kind` absent ⇒ objet contenant
 * (seule nature qui existait avant), et les objets dont la cible a disparu du
 * projet sont écartés.
 *
 * Migration douce, jamais réécrite dans le stockage : un contenant absent d'un
 * rendu transitoire ne doit pas détruire la composition.
 */
export function normalizeRackExportLayout(
  layout: RackExportLayout,
  known: { rackIds: ReadonlySet<string>; locationIds: ReadonlySet<string> },
): RackExportLayout {
  const items: RackExportItem[] = [];
  for (const raw of layout.items) {
    // Pas d'intersection des membres de l'union : leurs `kind` littéraux
    // incompatibles la réduiraient à `never`. Forme neutre équivalente.
    const o = raw as Partial<{
      id: string;
      x: number;
      y: number;
      w: number;
      view: ViewId;
      views: ViewId[];
      kind: RackExportItem["kind"];
      rackId: string;
      locationId: string;
      renderMode: RackRenderMode;
      label: string;
    }>;
    const base = {
      id: o.id!,
      x: o.x!,
      y: o.y!,
      w: o.w!,
      label: typeof o.label === "string" && o.label.trim() ? o.label : undefined,
      // Mode absent (champ récent) ou inconnu → non défini, donc résolu sur le
      // mode courant de l'onglet à l'affichage.
      renderMode: RENDER_MODE_IDS.includes(o.renderMode as RackRenderMode)
        ? o.renderMode
        : undefined,
    };

    if (o.kind === "placeholder") {
      items.push({ ...base, kind: "placeholder" });
      continue;
    }

    if (o.kind === "location" || (!o.rackId && o.locationId)) {
      if (!o.locationId || !known.locationIds.has(o.locationId)) continue;
      // Un lieu n'a qu'une vue ; si la composition en portait plusieurs (forme
      // corrompue), on retient la première valide.
      const view = [o.view, ...(o.views ?? [])].find((v) =>
        VIEW_IDS.includes(v as ViewId),
      );
      if (!view) continue;
      items.push({ ...base, kind: "location", locationId: o.locationId, view });
      continue;
    }

    if (!o.rackId || !known.rackIds.has(o.rackId)) continue;
    // Migration douce : `view` seul (forme antérieure aux vues cumulables)
    // devient une liste à un élément.
    const views = (
      Array.isArray(o.views) ? o.views : o.view ? [o.view] : []
    ).filter((v): v is ViewId => VIEW_IDS.includes(v));
    if (views.length === 0) continue;
    items.push({ ...base, kind: "rack", rackId: o.rackId, views });
  }
  // La feuille de référence est CONSERVÉE : c'est elle qui permettra de remettre
  // la composition à l'échelle si le lecteur impose un autre papier.
  const page = layoutPage(layout);
  return page ? { items, page } : { items };
}

/**
 * Égalité par VALEUR de deux compositions.
 *
 * Indispensable parce que plusieurs effets recalculent la composition à chaque
 * passe et produisent presque toujours un objet NEUF au contenu identique.
 * Publier un tel objet relance les effets qui en dépendent — et, la
 * composition étant persistée, déclenche en prime une écriture `localStorage`
 * synchrone. Comparer les identités ne protège de rien : il faut comparer les
 * valeurs.
 */
export function sameLayout(a: RackExportLayout, b: RackExportLayout): boolean {
  if (a === b) return true;
  if (a.items.length !== b.items.length) return false;
  const EPS = 1e-6;
  // La feuille de référence fait partie de la valeur : une composition qui vient
  // d'adopter un nouveau papier a bel et bien changé, même si ses objets n'ont
  // pas bougé — sans quoi le repère ne serait jamais écrit.
  const pa = layoutPage(a);
  const pb = layoutPage(b);
  if (!pa !== !pb) return false;
  if (pa && pb && (Math.abs(pa.w - pb.w) > EPS || Math.abs(pa.h - pb.h) > EPS)) {
    return false;
  }
  for (let i = 0; i < a.items.length; i++) {
    const x = a.items[i]!;
    const y = b.items[i]!;
    if (x === y) continue;
    if (
      x.id !== y.id ||
      x.kind !== y.kind ||
      x.renderMode !== y.renderMode ||
      x.label !== y.label ||
      Math.abs(x.x - y.x) > EPS ||
      Math.abs(x.y - y.y) > EPS ||
      Math.abs(x.w - y.w) > EPS
    ) {
      return false;
    }
    if (x.kind === "rack" && y.kind === "rack") {
      if (x.rackId !== y.rackId) return false;
      if (x.views.length !== y.views.length) return false;
      if (x.views.some((v, k) => v !== y.views[k])) return false;
    }
    if (x.kind === "location" && y.kind === "location") {
      if (x.locationId !== y.locationId || x.view !== y.view) return false;
    }
  }
  return true;
}

/** Dimensions de la feuille en mm, orientation comprise. */
export function pageSizeMm(
  paperFormat: PaperFormat,
  orientation: Orientation,
): { w: number; h: number } {
  return getPaperDimensionsMm(paperFormat, orientation);
}

let itemCounter = 0;
export function nextRackExportItemId(): string {
  itemCounter += 1;
  return `rx-${Date.now().toString(36)}-${itemCounter}`;
}

/**
 * Largeur maximale d'un objet (ou d'une boîte de groupe) sur la feuille :
 * jamais plus grand que le papier, ni en largeur ni en hauteur. La hauteur
 * découlant de la largeur par le ratio, la borne se ramène à une seule valeur.
 *
 * `ratio` = largeur / hauteur de l'objet ou de la boîte.
 */
export function capWidthToPage(
  w: number,
  ratio: number,
  page: { w: number; h: number },
): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return Math.min(w, page.w);
  const maxW = Math.min(page.w, page.h * ratio);
  return Math.max(Math.min(MIN_ITEM_W_MM, maxW), Math.min(w, maxW));
}

/**
 * Remet une composition à l'échelle d'une nouvelle feuille.
 *
 * Un SEUL facteur, tiré de la largeur, appliqué à `x`, `y` et `w`. Deux
 * facteurs (un par axe) déformeraient les objets — leur ratio est imposé par
 * leur contenu — et surtout la transformation ne serait plus réversible :
 * A4 → A0 → A4 doit rendre exactement la composition de départ, ce que garantit
 * un facteur scalaire dont l'aller et le retour sont inverses l'un de l'autre.
 */
export function rescaleLayout(
  layout: RackExportLayout,
  from: { w: number; h: number },
  to: { w: number; h: number },
): RackExportLayout {
  if (from.w <= 0 || Math.abs(from.w - to.w) < 0.001) {
    // Même largeur : rien à mettre à l'échelle, mais la composition change bel
    // et bien de feuille de référence.
    return { ...layout, page: { w: to.w, h: to.h } };
  }
  const s = to.w / from.w;
  return {
    items: layout.items.map((i) => ({
      ...i,
      x: i.x * s,
      y: i.y * s,
      w: i.w * s,
    })),
    page: { w: to.w, h: to.h },
  };
}

/**
 * Ramène un objet DANS la zone de composition : taille rabattue à la zone, puis
 * coin replacé à l'intérieur.
 *
 * À n'appliquer que lorsque la feuille CHANGE — jamais en régime courant. Ce
 * n'est pas la même règle que `capWidthToPage` : pendant la manipulation,
 * l'utilisateur a le droit de faire déborder un objet sous le cartouche, c'est
 * un choix de composition. Mais quand le papier change sous ses pieds, personne
 * n'a choisi la taille qui en résulte — atterrir dans la surface utile est le
 * seul aboutissement raisonnable, sans quoi une composition adoptée d'un autre
 * format arrive à cheval sur l'en-tête et le pied.
 *
 * `ratio` = largeur / hauteur de l'objet.
 */
export function fitIntoZone(
  x: number,
  y: number,
  w: number,
  ratio: number,
  zone: Rect,
): { x: number; y: number; w: number } {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return { x, y, w: Math.min(w, zone.w) };
  }
  const maxW = Math.min(zone.w, zone.h * ratio);
  const nextW = Math.max(Math.min(MIN_ITEM_W_MM, maxW), Math.min(w, maxW));
  const nextH = nextW / ratio;
  return {
    w: nextW,
    x: Math.min(Math.max(x, zone.x), zone.x + zone.w - nextW),
    y: Math.min(Math.max(y, zone.y), zone.y + zone.h - nextH),
  };
}

/**
 * Ramène un objet dans la feuille. On borne le COIN, pas l'objet entier : un
 * objet plus grand que la page (un lieu de six racks sur A4) doit rester
 * manipulable, sinon il serait collé en haut à gauche sans pouvoir être
 * recadré.
 */
export function clampItemPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  page: { w: number; h: number },
): { x: number; y: number } {
  const minX = Math.min(0, page.w - w);
  const minY = Math.min(0, page.h - h);
  return {
    x: Math.max(minX, Math.min(x, page.w - Math.min(w, page.w))),
    y: Math.max(minY, Math.min(y, page.h - Math.min(h, page.h))),
  };
}

/**
 * Largeur par défaut d'un objet qu'on vient d'ajouter, rapportée à la ZONE DE
 * COMPOSITION (et non à la feuille brute) : assez grand pour être lisible,
 * assez petit pour laisser de la place aux autres. La hauteur commande pour un
 * objet vertical (une élévation seule), la largeur pour un objet large (un lieu
 * de plusieurs racks) — d'où les deux bornes.
 */
export function defaultItemWidthMm(ratio: number, zone: Rect): number {
  const byHeight = zone.h * 0.86 * ratio;
  const byWidth = zone.w * (ratio > 1.2 ? 0.9 : 0.45);
  return Math.max(MIN_ITEM_W_MM, Math.min(byHeight, byWidth));
}

/**
 * Position d'un nouvel objet.
 *
 *  - Feuille vide → CENTRÉ dans la zone de composition. Un premier objet posé
 *    dans un coin donne une page qui a l'air ratée avant même d'avoir commencé.
 *  - Sinon → à droite du dernier posé si ça tient, à défaut en haut à gauche.
 *    Pas de cascade en diagonale : sur une feuille, des élévations s'alignent,
 *    elles ne s'empilent pas.
 *
 * Poser dans la ZONE et non sur la feuille est ce qui évite qu'un objet
 * atterrisse sous la bande d'en-tête d'un cartouche, où il serait masqué sans
 * que l'utilisateur comprenne pourquoi.
 */
export function placeNewItem(
  items: ReadonlyArray<Rect>,
  w: number,
  h: number,
  zone: Rect,
): { x: number; y: number } {
  const GAP = 8;
  const last = items[items.length - 1];
  if (!last) {
    return {
      x: zone.x + Math.max(0, (zone.w - w) / 2),
      y: zone.y + Math.max(0, (zone.h - h) / 2),
    };
  }
  const x = last.x + last.w + GAP;
  if (x + w <= zone.x + zone.w) return { x, y: last.y };
  return { x: zone.x, y: zone.y };
}

// ── Magnétisme d'alignement ─────────────────────────────────────────────────

export type Rect = { x: number; y: number; w: number; h: number };

/** Boîte englobante d'un ensemble de rectangles. `null` si l'ensemble est vide. */
export function boundingBox(rects: ReadonlyArray<Rect>): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Intersection (au sens strict) de deux rectangles — sélection au lasso. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/** Lignes d'accrochage retenues, en mm sur la feuille (pour les guides). */
export type SnapGuides = { x: number[]; y: number[] };

export const NO_SNAP_GUIDES: SnapGuides = { x: [], y: [] };

/**
 * Le magnétisme se raisonne en PIXELS ÉCRAN, pas en millimètres : ce qui doit
 * rester constant, c'est la distance que le curseur peut couvrir avant que
 * l'accroche lâche. Une tolérance fixée en mm serait inatteignable en vue
 * d'ensemble (2 mm ≈ 3 px à l'échelle d'ajustement — il fallait viser au pixel
 * près, d'où l'impression que les guides ne s'affichaient pas) et envahissante
 * en gros plan.
 */
export const SNAP_TOLERANCE_PX = 7;
/** Bornes en mm — garde-fous aux extrêmes de zoom. */
export const SNAP_TOLERANCE_MIN_MM = 0.4;
export const SNAP_TOLERANCE_MAX_MM = 6;

/**
 * Tolérance d'accrochage en mm pour un facteur d'affichage donné
 * (`pxPerMm` = pixels écran par millimètre de feuille, zoom compris).
 */
export function snapToleranceMm(pxPerMm: number): number {
  if (pxPerMm <= 0) return SNAP_TOLERANCE_MIN_MM;
  return Math.max(
    SNAP_TOLERANCE_MIN_MM,
    Math.min(SNAP_TOLERANCE_MAX_MM, SNAP_TOLERANCE_PX / pxPerMm),
  );
}

/** Les trois lignes d'un rectangle sur un axe : début, milieu, fin. */
function axisLines(pos: number, size: number): number[] {
  return [pos, pos + size / 2, pos + size];
}

/** Lignes de référence d'une feuille et d'une liste de rectangles. */
export function snapLinesFor(
  targets: ReadonlyArray<Rect>,
  page: { w: number; h: number },
): { x: number[]; y: number[] } {
  const x = [0, page.w / 2, page.w];
  const y = [0, page.h / 2, page.h];
  for (const t of targets) {
    x.push(...axisLines(t.x, t.w));
    y.push(...axisLines(t.y, t.h));
  }
  return { x, y };
}

/**
 * Accroche UNE valeur (un bord) sur la ligne la plus proche. Renvoie `null`
 * hors tolérance — l'appelant distingue ainsi « rien accroché » de « accroché
 * à la même valeur ».
 */
export function snapValue(
  value: number,
  lines: readonly number[],
  tolerance: number,
): { value: number; line: number } | null {
  let best: { value: number; line: number } | null = null;
  let bestDelta = tolerance;
  for (const line of lines) {
    const delta = Math.abs(line - value);
    if (delta <= bestDelta) {
      bestDelta = delta;
      best = { value: line, line };
    }
  }
  return best;
}

/**
 * Accroche un rectangle en déplacement sur les lignes des autres objets et de
 * la feuille. Les trois bords de CHAQUE axe sont candidats (gauche / centre /
 * droite, haut / milieu / bas) : c'est ce qui permet d'aligner deux objets par
 * leur centre autant que par leur bord.
 *
 * Fonction pure — l'appelant décide d'appliquer ou non (touche Alt).
 */
export function snapRect(
  rect: Rect,
  lines: { x: readonly number[]; y: readonly number[] },
  tolerance: number,
): { x: number; y: number; guides: SnapGuides } {
  const guides: SnapGuides = { x: [], y: [] };
  let dx: number | null = null;
  let dy: number | null = null;
  let bestX = tolerance;
  let bestY = tolerance;

  for (const edge of axisLines(rect.x, rect.w)) {
    const hit = snapValue(edge, lines.x, bestX);
    if (!hit) continue;
    const delta = Math.abs(hit.line - edge);
    if (delta <= bestX) {
      bestX = delta;
      dx = hit.line - edge;
      guides.x = [hit.line];
    }
  }
  for (const edge of axisLines(rect.y, rect.h)) {
    const hit = snapValue(edge, lines.y, bestY);
    if (!hit) continue;
    const delta = Math.abs(hit.line - edge);
    if (delta <= bestY) {
      bestY = delta;
      dy = hit.line - edge;
      guides.y = [hit.line];
    }
  }

  return {
    x: rect.x + (dx ?? 0),
    y: rect.y + (dy ?? 0),
    guides,
  };
}
