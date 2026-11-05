/**
 * Types et helpers pour l'éditeur de cartouche d'impression (Phase B).
 *
 * Le layout d'un PrintTemplate est un JSON serializable contenant une liste
 * d'éléments (texte, rectangle, ellipse, ligne, image). Coordonnées en mm,
 * origine top-left du papier.
 *
 * Pas de couches en Phase B simple — `elements[]` est rendu dans l'ordre.
 */

export type PaperFormat = "A4" | "A3" | "A2" | "A1" | "A0" | "LETTER" | "LEGAL";
export type Orientation = "PORTRAIT" | "LANDSCAPE";

/** Dimensions papier en mm (portrait : width × height). */
export const PAPER_SIZES_MM: Record<PaperFormat, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
  LETTER: { w: 216, h: 279 },
  LEGAL: { w: 216, h: 356 },
};

/** Retourne (w, h) en mm selon orientation (paysage = swap). */
export function getPaperDimensionsMm(format: PaperFormat, orientation: Orientation) {
  const base = PAPER_SIZES_MM[format];
  return orientation === "LANDSCAPE" ? { w: base.h, h: base.w } : base;
}

// ── Layout types ────────────────────────────────────────────────────────────

export type ElementType = "TEXT" | "RECT" | "ELLIPSE" | "LINE" | "IMAGE" | "EQUIPMENT" | "ZONE" | "CABLE";

interface BaseElement {
  id: string;
  type: ElementType;
  /** Ordre Z pour le rendu : plus grand = au-dessus. */
  z?: number;
}

export interface TextElement extends BaseElement {
  type: "TEXT";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Contenu textuel. */
  text: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  /**
   * @deprecated rétro-compat — l'alignement n'est plus exposé dans l'UI du
   * Drawing (aligné sur le pattern synoptique : center si pill, start sinon).
   * Conservé pour ne pas casser les layouts existants en mode Print Template.
   */
  align: "left" | "center" | "right";
  color: string;
  /**
   * @deprecated rétro-compat — système de variables retiré côté Drawing.
   * Conservé pour le mode Print Template legacy.
   */
  isVariable?: boolean;
  /** Police : CSS variable (sans/mono/serif) ou family explicite. */
  fontFamily?: string | null;
  /** Décoration : "underline" / "line-through" / undefined. */
  textDecoration?: string;
  // Mode pilule (fond coloré arrondi autour du texte — pattern synoptique).
  pill?: boolean;
  pillBg?: string | null;
  pillRadius?: number;
}

export interface RectElement extends BaseElement {
  type: "RECT";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  rx?: number;
}

export interface EllipseElement extends BaseElement {
  type: "ELLIPSE";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface LineElement extends BaseElement {
  type: "LINE";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
}

export interface ImageElement extends BaseElement {
  type: "IMAGE";
  x: number;
  y: number;
  w: number;
  h: number;
  /** URL de l'image. Vide = placeholder empty-state dans le canvas. */
  url: string;
  /**
   * @deprecated rétro-compat — le système de variables sur les images n'est
   * plus utilisé en mode Drawing. Conservé pour ne pas casser les layouts
   * existants en mode Print Template ; ignoré côté Drawing.
   */
  isVariable?: boolean;
  /** Rotation en degrés (sens horaire), appliquée à l'image. Default 0. */
  imageRotation?: number;

  // Légende textuelle optionnelle (sans cadre — texte libre positionné par
  // rapport à l'image).
  /** Texte de la légende. Vide = pas de légende affichée. */
  caption?: string;
  /** Position de la légende relativement à l'image. Default "BOTTOM". */
  captionPosition?: "TOP" | "BOTTOM" | "LEFT" | "RIGHT";
  /** Taille du texte en mm. Default 3mm. */
  captionFontSize?: number;
  /** Couleur du texte (hex). Default "#0f172a". */
  captionColor?: string;
  /** Gras. */
  captionBold?: boolean;
  /** Italique. */
  captionItalic?: boolean;
  /** Souligné. */
  captionUnderline?: boolean;
}

export type PrintElement = TextElement | RectElement | EllipseElement | LineElement | ImageElement;

// ── Drawing-specific element types (SCHEMA canvas) ──────────────────────────

/**
 * Source d'image affichée dans un EquipmentBlock du Schéma.
 *  - "SCHEMA" : image de principe (par défaut, schemaImageUrl du catalogue)
 *  - "ICON"   : pictogramme simplifié (iconUrl du catalogue)
 *  - "PHOTO"  : photo produit principale (imageUrl du catalogue)
 *  - "UPLOAD" : image custom uploadée par l'utilisateur (imageUrlOverride)
 */
/**
 * Source de l'image affichée pour un EquipmentElement :
 *  - SCHEMA       : schemaImageUrl propre à l'équipement
 *  - ICON         : iconImageUrl propre à l'équipement
 *  - PHOTO        : photoImageUrl propre à l'équipement (imageUrl catalogue)
 *  - UPLOAD       : imageUrlOverride (image custom uploadée sur l'instance)
 *  - TYPE_SCHEMA  : schéma générique hérité du CatalogType (typeSchemaImageUrl)
 *  - TYPE_ICON    : icône générique héritée du CatalogType (typeIconId si URL)
 */
export type EquipmentImageSource =
  | "SCHEMA"
  | "ICON"
  | "PHOTO"
  | "UPLOAD"
  | "TYPE_SCHEMA"
  | "TYPE_ICON";

/**
 * Bloc équipement — issu du BOM d'inventaire du projet.
 * Une instance par unité de quantité du RackInventoryItem (qty=3 ⇒ 3 blocs).
 * Dénormalisé pour un rendu sans fetch supplémentaire.
 */
export interface EquipmentElement extends BaseElement {
  type: "EQUIPMENT";
  x: number;
  y: number;
  w: number;
  h: number;
  /** ID du RackInventoryItem source. Utilisé pour resync depuis BOM. */
  inventoryItemId: string;
  /**
   * Index d'instance (0..quantity-1) — distingue plusieurs blocs issus du même
   * RackInventoryItem (cas qty > 1). Optionnel pour rétro-compat (anciens blocs
   * sans champ = instance 0).
   */
  instanceIndex?: number;
  /** Nom catalogue (source de vérité). Affiché si pas de `labelOverride`. */
  name: string;
  /**
   * Surcharge utilisateur du libellé. Si défini, remplace `name` au rendu et
   * persiste à travers les resyncs. Null/undefined = libellé catalogue.
   */
  labelOverride?: string | null;
  reference?: string | null;
  /** Image active à l'affichage (résolue selon `imageSource`, dénormalisée). */
  imageUrl?: string | null;
  /** Image de principe (schemaImageUrl) — pré-fetchée pour le sélecteur. */
  schemaImageUrl?: string | null;
  /** Photo produit principale — pré-fetchée pour le sélecteur. */
  photoImageUrl?: string | null;
  /** Icône simplifiée — pré-fetchée pour le sélecteur. */
  iconImageUrl?: string | null;
  /** Image custom uploadée par l'utilisateur (utilisée si imageSource=UPLOAD). */
  imageUrlOverride?: string | null;
  /** Choix actuel de la source d'image. Default dépend du kind de page. */
  imageSource?: EquipmentImageSource;
  /**
   * Rotation appliquée UNIQUEMENT à l'image (et pas au texte / pill catégorie).
   * Valeurs courantes : 0, 90, 180, 270 (degrés, sens horaire). Default 0.
   */
  imageRotation?: number;

  // Champs spécifiques au Plan de feu (page kind === "LIGHTING").
  // Tous optionnels — affichés uniquement si présents ET si la page autorise leur affichage
  // (cf. DrawingLayout.lightingDisplay).
  /** Channel console (norme USITT — numéro logique). */
  channel?: number | null;
  /** Unit number (numéro de position physique sur la barre, USITT). */
  unitNumber?: string | null;
  /** Univers DMX (1..N). */
  dmxUniverse?: number | null;
  /** Adresse DMX dans l'univers (1..512). */
  dmxAddress?: number | null;
  /** Footprint DMX (nb de canaux occupés). Dénormalisé depuis Equipment.dmxChannelsDefault au resync. */
  dmxFootprint?: number | null;
  /** Mode DMX sélectionné (nom). Optionnel — sert seulement à l'affichage si présent. */
  dmxMode?: string | null;

  // Visibilité des sous-éléments du bloc équipement.
  // Au moins un doit rester visible (validation côté inspector). Default = tous visibles.
  hideFrame?: boolean;
  hideLabel?: boolean;
  hideReference?: boolean;
  hideImage?: boolean;
  /** Cache la pill catégorie/fonction (par défaut affichée si disponible). */
  hideCategory?: boolean;
  /** Couleur du cadre (border). Default "#cbd5e1". */
  frameColor?: string | null;
  // Catégorie principale — dénormalisée depuis Equipment.category(Id) au resync.
  categoryName?: string | null;
  /** Couleur hex de la catégorie (défaut #6b7280 si non définie côté catalogue). */
  categoryColor?: string | null;
  /** Nom du type spécifique (Caméra studio, Console broadcast, Fresnel, …). */
  typeName?: string | null;
  /** Nom du type parent quand typeName est un sous-type (désambiguïsation). */
  typeParentName?: string | null;
  /** Icône du type (nom lucide ex. "camera" ou URL uploadée). */
  typeIconId?: string | null;
  /** Schéma de principe par défaut du type (URL uploadée). */
  typeSchemaImageUrl?: string | null;
  /** Nom de marque (dénormalisé pour la légende LIGHTING). */
  brandName?: string | null;
  /** Puissance unitaire en watts (pour conso totale estimée). */
  powerW?: number | null;
}

/**
 * Toggles d'affichage des annotations Plan de feu (par page LIGHTING).
 * Défaut : tout activé. Permet de sortir plusieurs vues (implantation sans DMX,
 * patch avec DMX, etc.) depuis le même set d'éléments.
 */
export interface LightingDisplay {
  showChannel?: boolean;
  showDmx?: boolean;
  showUnit?: boolean;
}

/** Zone colorée avec bordure pointillée. */
export interface ZoneElement extends BaseElement {
  type: "ZONE";
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  /** Couleur bordure pointillée hex. */
  color: string;
}

/** Côtés d'ancrage d'un câble sur un EquipmentElement. */
export type CableAnchor = "TOP" | "RIGHT" | "BOTTOM" | "LEFT";

/**
 * Direction de la flèche sur un câble (style Visio / Draw.io).
 * - "NONE" : aucune flèche, simple trait
 * - "TO"   : flèche unidirectionnelle source → cible (défaut)
 * - "BOTH" : double flèche (bidirectionnel)
 *
 * Rétro-compat : si absent sur un CableElement legacy, traiter comme "TO".
 */
export type ArrowDirection = "NONE" | "TO" | "BOTH";

/**
 * Type de tracé d'un lien (inspiré de Draw.io).
 * - "STRAIGHT"        : ligne droite entre source et cible (défaut).
 * - "ORTHOGONAL"      : chemin à angles droits (L-shape ou Z-shape).
 * - "HORIZONTAL"      : segment horizontal central + verticaux courts aux extrémités.
 * - "VERTICAL"        : segment vertical central + horizontaux courts aux extrémités.
 * - "CURVED"          : courbe de Bézier cubique fluide.
 * - "ENTITY_RELATION" : 2 segments rectilignes type ER (step minimaliste).
 */
export type LinkRouting =
  | "STRAIGHT"
  | "ORTHOGONAL"
  | "HORIZONTAL"
  | "VERTICAL"
  | "CURVED"
  | "ENTITY_RELATION";

/** Style du trait d'un lien. */
export type LinkStyle = "SOLID" | "DASHED" | "DOTTED";

/** Style d'une extrémité de lien. */
export type LinkEndStyle = "NONE" | "ARROW";

/**
 * Positions possibles du label sur un lien. Multi-select :
 *  - START : à proximité de l'extrémité source
 *  - CENTER : au milieu (défaut)
 *  - END : à proximité de l'extrémité cible
 * Combinaisons possibles : ex. `["START", "END"]` pour un label aux 2 bouts.
 */
export type LinkLabelPosition = "START" | "CENTER" | "END";

/** Lien entre deux éléments linkables (EQUIPMENT / RECT / ELLIPSE / IMAGE / TEXT / ZONE). */
export interface CableElement extends BaseElement {
  type: "CABLE";
  /** Ancrage source : id du linkable + côté. */
  fromEq: { id: string; anchor: CableAnchor };
  toEq: { id: string; anchor: CableAnchor };
  /** Label centré sur le trait (libre). */
  label: string;
  /** Couleur du trait + label hex. */
  color: string;
  /**
   * @deprecated utiliser `startArrow` + `endArrow`.
   * Direction de la flèche legacy. Conservé pour rétro-compat lecture seule
   * sur les câbles persistés avant l'introduction des champs séparés.
   */
  arrow?: ArrowDirection;
  /** Type de tracé. Default "STRAIGHT" si absent. */
  routing?: LinkRouting;
  /** Style du trait. Default "SOLID" si absent. */
  lineStyle?: LinkStyle;
  /** Style de l'extrémité source. Default "NONE" si absent. */
  startArrow?: LinkEndStyle;
  /** Style de l'extrémité cible. Default "ARROW" si absent. */
  endArrow?: LinkEndStyle;
  /** Épaisseur du trait en mm. Default 0.6mm si absent. */
  strokeWidth?: number;
  /** Taille du label en mm (hauteur de caractère). Default 3mm si absent. */
  labelFontSize?: number;
  /**
   * Position(s) du label sur le lien. Multi-select : peut être au centre,
   * près de la source, près de la cible, ou plusieurs à la fois.
   * Default `["CENTER"]` si absent.
   */
  labelPositions?: LinkLabelPosition[];
  /**
   * Référence optionnelle à un type de signal (CatalogSignalType ou
   * TenantSignalType). Quand défini, propose une cohérence automatique
   * label = signal.name + color = signal.color. L'utilisateur peut écraser
   * ces valeurs après ; le `signalTypeId` reste une trace référentielle.
   */
  signalTypeId?: string | null;
}

/**
 * Résout les arrows effectifs d'un câble en tenant compte du champ legacy `arrow`.
 * Priorité aux nouveaux champs `startArrow` / `endArrow` ; sinon fallback sur `arrow`.
 */
export function resolveLinkArrows(c: CableElement): {
  startArrow: LinkEndStyle;
  endArrow: LinkEndStyle;
} {
  if (c.startArrow !== undefined || c.endArrow !== undefined) {
    return {
      startArrow: c.startArrow ?? "NONE",
      endArrow: c.endArrow ?? "NONE",
    };
  }
  const legacy = c.arrow ?? "TO";
  if (legacy === "NONE") return { startArrow: "NONE", endArrow: "NONE" };
  if (legacy === "TO") return { startArrow: "NONE", endArrow: "ARROW" };
  return { startArrow: "ARROW", endArrow: "ARROW" };
}

export type DrawingElement = PrintElement | EquipmentElement | ZoneElement | CableElement;

/**
 * Layout pour le canvas Drawing (SCHEMA / CAMERAS / LIGHTING / AUDIO).
 * Étend PrintLayout en remplaçant `elements: PrintElement[]` par
 * `elements: DrawingElement[]` — rétro-compatible avec les cartouches
 * (TEXT/RECT/ELLIPSE/LINE/IMAGE restent valides dans DrawingElement).
 */
export interface DrawingLayout extends Omit<PrintLayout, "elements"> {
  elements: DrawingElement[];
}

export interface PrintLayout {
  version: 1;
  /**
   * Taille de la feuille de CONCEPTION en mm (largeur × hauteur, orientation
   * incluse). Estampillée à la sauvegarde par l'éditeur WYSIWYG (cartouches :
   * A4 dans l'orientation du modèle ; modèles Export PDF : A4 portrait).
   * Absente sur les anciens layouts → considérés conçus au format du modèle
   * (`paperFormat` + `orientation`). Sert de source à `adaptPrintLayoutToSize`
   * quand le format d'export diffère de la conception.
   */
  designSizeMm?: { w: number; h: number };
  /** Pas de la grille en mm (5 par défaut). Détermine la finesse du snap. */
  gridSize: number;
  /** Affichage du quadrillage visuel sur la feuille (true par défaut). */
  showGrid?: boolean;
  /** Snap magnétique activé/désactivé (true par défaut). */
  snapEnabled?: boolean;
  /** Couleur du quadrillage (hex, "#000000" par défaut). */
  gridColor?: string;
  /** Opacité du quadrillage (0-1, 0.06 par défaut). */
  gridOpacity?: number;
  /** Mode aperçu : résout les variables avec leurs valeurs d'exemple. */
  previewEnabled?: boolean;
  /**
   * Arrière-plan de la feuille (couleur pleine ou dégradé linéaire).
   * Si null/undefined : feuille blanche par défaut.
   */
  background?: PrintBackground | null;
  elements: PrintElement[];
  /**
   * Toggles d'affichage des annotations Plan de feu (drawing mode uniquement,
   * pour les pages de kind LIGHTING). Ignoré en mode print classique.
   * Défaut implicite : tout activé.
   */
  lightingDisplay?: LightingDisplay;
  /**
   * Affichage de la légende du plan (drawing mode). Défaut implicite : true.
   * - SCHEMA : signaux des câbles
   * - CAMERAS / LIGHTING / AUDIO : types de fixtures
   */
  legendEnabled?: boolean;
  /**
   * Position et taille manuelle de la légende (mm). Si non définie : auto
   * (coin bas-gauche du papier, hauteur ajustée au contenu).
   */
  legend?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

/**
 * Arrière-plan de la feuille — pleine couleur ou dégradé linéaire.
 * `angle` en degrés (0 = haut→bas, 90 = gauche→droite, etc.).
 */
/** Mode d'affichage d'un background image. */
export type ImageFit = "COVER" | "CONTAIN" | "FILL" | "TILE";

export type PrintBackground =
  | { type: "SOLID"; color: string }
  | { type: "LINEAR_GRADIENT"; from: string; to: string; angle: number }
  | {
      type: "IMAGE";
      /** URL ou data-URL (upload encodé en base64). */
      url: string;
      /** Mode d'ajustement : COVER (remplit, peut couper), CONTAIN (entier visible, peut laisser des bords), FILL (déforme pour remplir), TILE (répète). */
      fit: ImageFit;
      /** Opacité 0-1, default 1. */
      opacity?: number;
    };

export const DEFAULT_LAYOUT: PrintLayout = {
  version: 1,
  gridSize: 5,
  showGrid: true,
  snapEnabled: true,
  gridColor: "#000000",
  gridOpacity: 0.06,
  elements: [],
};

// ── Snap helpers ────────────────────────────────────────────────────────────

export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

// ── Adaptation à un autre format (ancrage intelligent) ─────────────────────

/**
 * Seuil « étirable » : un élément qui couvre au moins ce ratio de l'axe
 * source est considéré comme longeant la feuille (cadre) → il suit la
 * feuille en conservant ses écarts aux deux bords.
 */
export const ADAPT_STRETCH_MIN_RATIO = 0.6;

/**
 * Tolérance « centré » : si les écarts aux deux bords diffèrent de moins de
 * cette valeur (mm) et que l'élément n'est pas étirable, il est re-centré à
 * taille native sur l'axe cible.
 */
export const ADAPT_CENTER_TOLERANCE_MM = 2;

/** Tolérance src == dst : en-deçà, le layout est retourné tel quel. */
const ADAPT_EPSILON_MM = 0.01;

type AdaptedAxis = { pos: number; size: number };

/**
 * Adapte un segment [pos, pos+size] d'un axe source vers un axe cible :
 *  - étirable (≥ ADAPT_STRETCH_MIN_RATIO de l'axe source) → conserve les
 *    DEUX écarts aux bords (la taille suit la feuille) ;
 *  - centré (écarts quasi égaux) → re-centré à taille native ;
 *  - sinon → ancré au bord le plus proche, à taille native.
 */
function adaptAxis(
  pos: number,
  size: number,
  srcLen: number,
  dstLen: number,
): AdaptedAxis {
  const leftGap = pos;
  const rightGap = srcLen - pos - size;
  if (size >= ADAPT_STRETCH_MIN_RATIO * srcLen) {
    return { pos: leftGap, size: Math.max(0, dstLen - leftGap - rightGap) };
  }
  if (Math.abs(leftGap - rightGap) < ADAPT_CENTER_TOLERANCE_MM) {
    return { pos: (dstLen - size) / 2, size };
  }
  return leftGap <= rightGap
    ? { pos, size }
    : { pos: dstLen - rightGap - size, size };
}

/** Replace une coordonnée dans la boîte adaptée en préservant sa position relative. */
function remapInAxis(v: number, min: number, size: number, adapted: AdaptedAxis): number {
  const t = size > 0 ? (v - min) / size : 0;
  return adapted.pos + t * adapted.size;
}

/**
 * Adapte un PrintLayout conçu pour une feuille `src` (mm) vers une feuille
 * `dst` (mm) SANS homothétie : chaque élément garde sa taille réelle en mm
 * (les textes gardent leur corps) et reste accroché au bord le plus proche ;
 * les éléments qui longent la feuille (cadres) suivent la feuille et
 * s'étirent. Les deux axes (x/largeur, y/hauteur) sont traités indépendamment.
 *
 * LINE : la bounding box des extrémités est adaptée par axe avec les mêmes
 * règles, puis les extrémités sont replacées en préservant leur ordre et leur
 * direction. `background` et le reste du layout sont inchangés.
 *
 * Fonction pure — retourne le layout d'entrée si src == dst (à ε près).
 */
export function adaptPrintLayoutToSize(
  layout: PrintLayout,
  src: { w: number; h: number },
  dst: { w: number; h: number },
): PrintLayout {
  if (
    Math.abs(src.w - dst.w) < ADAPT_EPSILON_MM &&
    Math.abs(src.h - dst.h) < ADAPT_EPSILON_MM
  ) {
    return layout;
  }

  const elements = layout.elements.map((el): PrintElement => {
    if (el.type === "LINE") {
      const minX = Math.min(el.x1, el.x2);
      const maxX = Math.max(el.x1, el.x2);
      const minY = Math.min(el.y1, el.y2);
      const maxY = Math.max(el.y1, el.y2);
      const ax = adaptAxis(minX, maxX - minX, src.w, dst.w);
      const ay = adaptAxis(minY, maxY - minY, src.h, dst.h);
      return {
        ...el,
        x1: remapInAxis(el.x1, minX, maxX - minX, ax),
        x2: remapInAxis(el.x2, minX, maxX - minX, ax),
        y1: remapInAxis(el.y1, minY, maxY - minY, ay),
        y2: remapInAxis(el.y2, minY, maxY - minY, ay),
      };
    }
    // TEXT / RECT / ELLIPSE / IMAGE : boîte x/y/w/h. Pour TEXT, `fontSize`
    // n'est volontairement PAS modifié (taille réelle conservée).
    const ax = adaptAxis(el.x, el.w, src.w, dst.w);
    const ay = adaptAxis(el.y, el.h, src.h, dst.h);
    return { ...el, x: ax.pos, w: ax.size, y: ay.pos, h: ay.size };
  });

  return { ...layout, elements };
}

// ── ID generation ───────────────────────────────────────────────────────────

let elementIdCounter = 0;
export function generateElementId(): string {
  elementIdCounter += 1;
  return `el-${Date.now()}-${elementIdCounter}`;
}

// ── Variables disponibles (pour l'auto-completion / picker) ─────────────────

export const PRINT_VARIABLES: Array<{
  key: string;
  label: string;
  category: "projet" | "espace" | "rack" | "user" | "date";
  sample: string;
}> = [
  // Projet
  {
    key: "{projet.nom}",
    label: "Nom du projet",
    category: "projet",
    sample: "Tour Eiffel - Studio A",
  },
  {
    key: "{projet.reference}",
    label: "Référence projet",
    category: "projet",
    sample: "PROJ-2026-001",
  },
  { key: "{projet.rackCount}", label: "Nb de racks", category: "projet", sample: "12" },
  // Espace
  { key: "{espace.nom}", label: "Nom espace", category: "espace", sample: "France Télévisions" },
  {
    key: "{espace.adresse}",
    label: "Adresse espace",
    category: "espace",
    sample: "7 Esplanade Henri de France",
  },
  { key: "{espace.logo}", label: "Logo espace", category: "espace", sample: "(image)" },
  // Rack courant
  { key: "{rack.name}", label: "Nom du rack", category: "rack", sample: "Rack régie principale" },
  { key: "{rack.position}", label: "Position du plan", category: "rack", sample: "1/12" },
  { key: "{rack.uCount}", label: "Nb d'unités U", category: "rack", sample: "42U" },
  // Utilisateur
  {
    key: "{user.fullName}",
    label: "Auteur (prénom + nom)",
    category: "user",
    sample: "Jean Dupont",
  },
  { key: "{user.email}", label: "Email auteur", category: "user", sample: "j.dupont@exemple.fr" }, // arkyo-server: habillage Strata (exemple sans le domaine du SaaS)
  // Date
  { key: "{date.iso}", label: "Date ISO", category: "date", sample: "2026-04-30" },
  { key: "{date.long}", label: "Date longue", category: "date", sample: "30 avril 2026" },
  { key: "{date.year}", label: "Année", category: "date", sample: "2026" },
];

/**
 * Résout les variables `{xxx.yyy}` dans une chaîne. Priorise les `overrides`
 * (valeurs réelles : nom du tenant, etc.) sinon retombe sur les `sample` de
 * PRINT_VARIABLES. Les tokens inconnus sont laissés tels quels.
 */
export function resolveVariables(
  text: string,
  overrides?: Record<string, string | null | undefined>,
): string {
  return text.replace(/\{[a-z]+\.[a-zA-Z]+\}/g, (match) => {
    if (overrides && overrides[match]) return overrides[match] as string;
    const v = PRINT_VARIABLES.find((x) => x.key === match);
    return v ? v.sample : match;
  });
}

/**
 * Récupère la valeur d'une clé de variable. Priorise les `overrides`,
 * sinon retombe sur le sample. Renvoie la clé brute si inconnue.
 */
export function getVariableSample(
  key: string,
  overrides?: Record<string, string | null | undefined>,
): string {
  if (overrides && overrides[key]) return overrides[key] as string;
  const v = PRINT_VARIABLES.find((x) => x.key === key);
  return v?.sample ?? v?.label ?? key;
}
