// arkyo-server: module provisoire (phase 4c, Task 9) — remplacé par la copie
// brute de arkyo:components/synoptique/synoptic-view.tsx à la Task 11.
// Il ne porte que les types exportés que les panneaux de propriétés copiés à
// la Task 9 importent (`import type`), recopiés tels quels d'arkyo
// (synoptic-view.tsx:367-400 et 436-816), pour que `tsc` passe en attendant
// la vue elle-même (14 023 l.). Aucun code d'exécution : ces types sont
// effacés à la compilation.
import type { SceneBounds } from "@/components/synoptique/lib/fit-all";
import type { CartoucheTemplate } from "@/lib/print/export-with-cartouche";
import type {
  Zone,
  CanvasLabel,
  ExternalPortKind,
  ZoneLabelPos,
} from "@/components/synoptique/types/synoptic";


/**
 * Sortie du générateur « poster ». Le cœur est PUR : il ne télécharge rien et
 * n'enregistre rien — c'est l'appelant (`ExportMenu` via `ProjectViewExport`)
 * qui décide du geste. L'aperçu, lui, ne consomme plus ce blob : il monte
 * directement la copie de `buildExportClone` dans la feuille. Générer un PDF
 * grand format pour l'afficher coûtait des dizaines de secondes.
 *
 * Le NOM du fichier n'est pas décidé ici : il relève de la convention de
 * l'onglet, pas du générateur.
 */
export type SynopticExportResult = { blob: Blob; pageCount: number };

/**
 * Cadrage « caméra » du plan : échelle et décalage appliqués à la scène dans
 * une boîte de rendu donnée. Exactement le couple `(zoom, pan)` du canvas.
 */
export type SynopticExportCamera = {
  zoom: number;
  pan: { x: number; y: number };
};

/**
 * Cadrage complet d'un rendu hors écran : la boîte (en px CSS) et la caméra.
 *
 * C'est la SEULE définition du périmètre exporté. L'ancien couple « vue
 * actuelle / vue complète » a disparu : l'utilisateur cadre lui-même dans
 * l'aperçu, et le document reproduit ce cadrage. Deux réglages pour la même
 * décision se contredisaient dès qu'on touchait à l'un des deux.
 */
export type SynopticExportFrame = {
  box: { w: number; h: number };
  camera: SynopticExportCamera;
};

export type SynopticPdfExportOpts = {
  format: "A0" | "A1" | "A2" | "A3" | "A4";
  /**
   * Orientation de la page. Défaut : paysage — l'orientation historique du
   * poster. Le portrait sert aux feuilles du dossier, dont chaque page choisit
   * son papier ET sa mise en page.
   */
  orientation?: "PORTRAIT" | "LANDSCAPE";
  /**
   * Cadrage à reproduire — celui de l'aperçu. Absent : la scène est ajustée
   * d'office dans la boîte naturelle (taille à l'écran).
   */
  frame?: SynopticExportFrame;
  revision: string;
  /**
   * Résolution de la capture. 3 à l'export (qualité d'impression), abaissée
   * pour l'aperçu.
   */
  pixelRatio?: number;
  /**
   * PLAFOND ABSOLU de pixels pour la capture. Indispensable : la surface
   * source dépend de la taille de la zone de travail, un simple ratio ne dit
   * donc rien de la mémoire consommée. Le ratio effectif est rabattu pour
   * tenir dans ce budget.
   */
  maxCapturePixels?: number;
  /** Type de sortie : pdf (cartouche) ou png (image brute). Défaut : pdf. */
  kind?: "pdf" | "png";
  /**
   * Nature du rendu du plan dans le PDF.
   *  - `"raster"` (défaut) : une image de la scène, posée pleine page ;
   *  - `"vector"` : les couches SVG de la scène envoyées telles quelles au PDF,
   *    les cartes d'équipement restant en image. Le trait, le texte des câbles
   *    et le cartouche deviennent alors des objets, pas des pixels.
   *
   * Le vectoriel se replie SILENCIEUSEMENT sur l'image en cas d'échec : mieux
   * vaut un document moins fin qu'un export qui ne sort pas.
   */
  render?: "raster" | "vector";
  /**
   * Habillage du plan. OBLIGATOIRE pour `kind: "pdf"` — l'ancien cartouche
   * codé en dur est supprimé, sans spec l'export échoue.
   *
   * Deux sources, une seule sémantique — un calque pleine page composité par
   * dessus le plan :
   *  - `overlaySvg` (+ `rasterizeOverlay`) : calque fourni par l'appelant.
   *    C'est ce que produit le « Modèle standard », dessiné en SVG pour être
   *    identique à l'écran et dans le document. Il prime sur `template`.
   *  - `template` : modèle `TenantPrintTemplate` de l'espace. Layout WYSIWYG
   *    rasterisé et superposé (cas normal), ou chrome générique depuis les
   *    slots à défaut ; `overrides` fournit les variables `{namespace.champ}`.
   *
   * Le plan est posé PLEINE PAGE dans les deux cas : c'est le calque qui
   * masque, pas une zone réservée. Une zone de composition en plus du calque
   * revenait à décrire deux fois la même géométrie, avec le risque de les voir
   * diverger.
   */
  cartouche?: {
    template?: CartoucheTemplate;
    slotValues?: Record<string, string>;
    overrides?: Record<string, string | null | undefined>;
    /**
     * Calque pleine page, sous sa forme SOURCE. Le cartouche est dessiné en
     * SVG : en rendu vectoriel on l'envoie tel quel au PDF. Sa présence
     * sélectionne ce mode d'habillage.
     */
    overlaySvg?: string;
    /**
     * Aplatissement du MÊME calque, à la demande. Une fonction et non une
     * valeur : la rasterisation d'un cartouche A0 coûte plusieurs secondes de
     * fil principal, et le rendu vectoriel n'en a aucun besoin. La calculer
     * d'office, c'était figer l'onglet pour un résultat jeté.
     */
    rasterizeOverlay?: () => Promise<string>;
  };
};

export interface AdapterSelectionDetails {
  id: string;
  name: string;
  label: string | null;
  attachedSlotName: string | null;
  attachedPortNum: number | null;
  attachedPortLabel: string | null;
  attachedConnectorLabel: string | null;
  connectors: Array<{
    connectorTypeName: string | null;
    connectorColor: string | null;
    quantity: number;
    direction: "IN" | "OUT" | "BIDI";
  }>;
  reference: string | null;
  attachedSide: "left" | "right" | null;
}

export interface ZoneSelectionDetails {
  id: string;
  label: string;
  labelPosition: ZoneLabelPos;
  color: string;
  borderRadius?: number;
  borderWidth?: number;
  borderStyle?: string;
  opacity?: number;
  labelFontSize?: number;
  labelFontWeight?: string;
  labelFontStyle?: string;
  labelTextDecoration?: string;
  labelFontFamily?: string | null;
}

export interface LabelSelectionDetails {
  id: string;
  text: string;
  color: string;
  fontWeight: string;
  fontSize?: number;
  fontFamily?: string | null;
  fontStyle?: string;
  textDecoration?: string;
  pill?: boolean;
  pillBg?: string | null;
  pillRadius?: number;
}

export interface CableSummary {
  id: string;
  label: string | null;
  color: string;
  signalName: string | null;
  /** Modèle de câble physique assigné (soft-FK → main.CableModel.id). */
  catalogCableModelId: string | null;
  /** Style de tracé (ortho/rounded/arrow) — utilisé par le panneau multi
   *  pour marquer visuellement le style actif quand il est commun. Null si
   *  pas défini explicitement (défaut "ortho"). */
  cableStyle: "ortho" | "rounded" | "arrow" | null;
}

/**
 * Détails d'un ExternalPort sélectionné — alimente le panneau de propriétés
 * (mêmes infos qu'un câble côté source, sans cible interne).
 */
export interface ExternalPortSelectionDetails {
  id: string;
  /** Nature de la sortie (inter-emplacements ou lien externe). */
  kind: ExternalPortKind;
  label: string | null;
  /** Étiquette libre saisie sur un port MONDE (null si non renseignée). */
  worldLabel: string | null;
  color: string;
  signalName: string | null;
  notes: string | null;
  /** Type connecteur physique source (BNC, XLR…). */
  connectorTypeName: string | null;
  from: {
    slotName: string;
    portLabel: string | null;
    portNum: number;
    connectorLabel: string | null;
    direction: "IN" | "OUT" | "BIDIR" | null;
  };
  /** Cible externe libre (ex. "Régie A", "Patch panel"). */
  targetLabel: string | null;
}

export interface ExternalPortSummary {
  id: string;
  label: string | null;
  color: string;
  signalName: string | null;
  targetLabel: string | null;
}

export interface CableTag {
  color: string;
  text: string;
}

export interface CableSelectionDetails {
  id: string;
  label: string | null;
  color: string;
  signalName: string | null;
  cableStyle: "ortho" | "rounded" | "arrow";
  notes: string | null;
  tags: CableTag[];
  from: {
    slotName: string;
    portLabel: string | null;
    portNum: number;
    /** Nom du connecteur sur l'équipement (ex. "SDI In", "Audio Out 1"). */
    connectorLabel: string | null;
    direction: "IN" | "OUT" | "BIDIR" | null;
    adapterHop: { adapterName: string; adapterPortNum: number } | null;
  };
  to: {
    slotName: string;
    portLabel: string | null;
    portNum: number;
    connectorLabel: string | null;
    direction: "IN" | "OUT" | "BIDIR" | null;
    adapterHop: { adapterName: string; adapterPortNum: number } | null;
  };
  /** Longueur estimée (m, arrondie au demi-mètre). null si calcul impossible. */
  estimatedLengthM: number | null;
  /** Modèle de câble physique sélectionné (soft-FK → main.CableModel). */
  catalogCableModelId: string | null;
}

export interface NodeSelectionDetails {
  slotId: string;
  label: string | null;
  equipmentName: string | null;
  panelName: string | null;
  brandName: string | null;
  reference: string | null;
  category: string | null;
  heightU: number | null;
  widthFraction: string | null;
  powerW: number | null;
  weightKg: number | null;
  depthMm: number | null;
  imageUrl: string | null;
  notes: string | null;
  view: string | null;
  startU: number | null;
  connectors: Array<{
    name: string;
    color: string;
    count: number;
    signalName: string | null;
    direction: string | null;
  }>;
}

export type SynopticExportCloneOpts = {
  /**
   * Boîte de rendu en px CSS. Défaut : la taille du canvas à l'écran.
   * L'aperçu impose la sienne — celle de la zone de composition de la feuille,
   * pour que la copie n'ait ni bande noire ni recadrage entre l'écran et le
   * document.
   */
  box?: { w: number; h: number };
  /** Cadrage à appliquer. Absent : ajustement au contenu dans la boîte. */
  camera?: SynopticExportCamera;
};

export type SynopticExportClone = {
  node: HTMLElement;
  width: number;
  height: number;
  /** Cadrage effectivement appliqué (celui demandé, ou l'ajustement calculé). */
  camera: SynopticExportCamera;
  /** Emprise du contenu en coordonnées de scène — null si la scène est vide. */
  bounds: SceneBounds | null;
};

export type SynopticViewHandle = {
  openPdfModal: () => void;
  openRenumberModal: () => void;
  openManualNumberModal: () => void;
  startManualNumberForCable: (connId: string) => void;
  clearCableLabel: (connId: string) => Promise<void>;
  deleteCable: (connId: string) => Promise<void>;
  clearAllLabels: () => void;
  clearAllCables: () => void;
  exportPdf: (opts: SynopticPdfExportOpts) => Promise<SynopticExportResult>;
  /**
   * Copie inerte de la scène, prête à être montée telle quelle. Alimente
   * l'aperçu vivant du modal d'export — même préparation que la capture.
   */
  buildExportClone: (opts?: SynopticExportCloneOpts) => SynopticExportClone | null;
  /** Ferme le modal PDF s'il est ouvert. */
  closePdfModal: () => void;
  /** Ferme le panneau renumber s'il est ouvert (pour toggle côté parent). */
  closeRenumberPanel: () => void;
  /** Ferme le panneau manual s'il est ouvert. */
  closeManualPanel: () => void;
  /** Ouvre le picker d'adaptateur sans contexte de port (depuis la topbar de l'outil Adapter). */
  openAdapterPicker: () => void;
  /** Insère un adaptateur inline sur un port déjà désigné (workflow port-first). */
  insertAdapterAtPort: (
    adapterId: string,
    port: { slotId: string; portIndex: number; side: "left" | "right" | null },
  ) => Promise<void>;
  /** Supprime un adaptateur par son id. */
  deleteAdapter: (id: string) => void;
  /** Met à jour le label d'un adaptateur. */
  updateAdapterLabel: (id: string, label: string | null) => void;
  /** Met à jour une zone (couleur, label, labelPosition). */
  updateZone: (
    id: string,
    patch: Partial<
      Pick<
        Zone,
        | "label"
        | "color"
        | "labelPosition"
        | "borderRadius"
        | "borderWidth"
        | "borderStyle"
        | "opacity"
        | "labelFontSize"
        | "labelFontWeight"
        | "labelFontStyle"
        | "labelTextDecoration"
        | "labelFontFamily"
      >
    >,
  ) => void;
  /** Supprime une zone par son id. */
  deleteZone: (id: string) => void;
  /** Ouvre le modal d'édition d'une zone. */
  openEditZoneModal: (id: string) => void;
  /** Met à jour un label canvas (couleur, fontWeight, fontSize, fontFamily, text). */
  updateLabel: (
    id: string,
    patch: Partial<
      Pick<
        CanvasLabel,
        | "color"
        | "fontWeight"
        | "fontSize"
        | "fontFamily"
        | "text"
        | "fontStyle"
        | "textDecoration"
        | "pill"
        | "pillBg"
        | "pillRadius"
      >
    >,
  ) => void;
  /** Supprime un label canvas par son id. */
  deleteLabel: (id: string) => void;
  /** Ouvre le modal d'édition d'un label canvas. */
  openEditLabelModal: (id: string) => void;
  /** Ouvre le dialog de numérotation manuelle pour les IDs passés. */
  startManualNumberForCables: (ids: string[]) => void;
  /** Efface les labels des câbles dont les IDs sont passés. */
  clearCableLabelsForIds: (ids: string[]) => Promise<void>;
  /** Supprime les câbles dont les IDs sont passés. */
  deleteCablesForIds: (ids: string[]) => Promise<void>;
  /** Modifie le style de tracé des câbles dont les IDs sont passés. */
  setConnectionStyle: (ids: string[], style: "ortho" | "rounded" | "arrow") => void;
  /** Met à jour les notes libres d'un câble (texte). */
  setConnectionNotes: (id: string, notes: string | null) => void;
  /** Met à jour la liste de tags d'un câble. */
  setConnectionTags: (id: string, tags: CableTag[]) => void;
  /** Assigne (ou retire avec null) le modèle de câble physique. */
  setConnectionCableModel: (id: string, cableModelId: string | null) => void;
  /** Met à jour le label d'une connexion externe. */
  setExternalLabel: (id: string, label: string | null) => void;
  /** Bascule la nature d'une connexion externe (inter-emplacements / externe). */
  setExternalKind: (id: string, kind: ExternalPortKind) => void;
  /** Supprime une connexion externe. */
  deleteExternalPort: (id: string) => void;
  /** Supprime plusieurs connexions externes. */
  deleteExternalPortsForIds: (ids: string[]) => void;
  /** Définit l'outil actif depuis l'extérieur (shell LeftToolbar). */
  setActiveTool: (toolId: string) => void;
  /** Retourne l'outil actif courant. */
  getActiveTool: () => string;
  /** Variant actif de l'outil zoom ("in" | "out"). */
  setZoomVariant: (v: "in" | "out") => void;
  /** Setters pour options d'outils (cable, label, zone) pilotées depuis la topbar contextuelle. */
  setCableStyle: (v: "ortho" | "rounded" | "arrow") => void;
  setCableCount: (v: "single" | "multi") => void;
  setCableMode: (v: "auto" | "multipoint") => void;
  setLabelFont: (v: string) => void;
  setLabelFontSize: (v: number) => void;
  setLabelColor: (v: string) => void;
  setZoneColor: (v: string) => void;
  /** Zoom/fit/center handlers exposés au shell (ZoomTopbar). */
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
  zoomReset: () => void;
  zoomCenter: () => void;
  getZoom: () => number;
};
