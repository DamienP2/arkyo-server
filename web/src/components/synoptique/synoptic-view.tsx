"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
} from "react";
import { Trash2, X, Cable, Eraser, Hash, Eye, PenLine, Lock } from "@/components/ui/icons";
import { FloatingContextMenu, type FloatingMenuItem } from "@/components/editor-shell/floating-context-menu";
import { FloatingLegend } from "@/components/ui/floating-legend";
import { PortAdapterPicker } from "@/components/synoptique/components/port-adapter-picker";
import { SynopticRenumberDialog, type CableExample } from "@/components/synoptique/components/synoptic-renumber-dialog";
import type { CableNumberingConfig, CableDirDigit } from "@/lib/services/cable-numbering";
import {
  SynopticAdapterPicker,
  type AdapterDTO,
  type AdapterPickerContext,
} from "@/components/synoptique/components/synoptic-adapter-picker";
import {
  SynopticAdapterNode,
  type SynopticAdapterInstance,
  ADAPTER_W as ADAPTER_NODE_W,
  ADAPTER_TITLE_H as ADAPTER_NODE_TITLE_H,
  ADAPTER_PORT_PAD_TOP as ADAPTER_NODE_PAD_TOP,
  ADAPTER_PORT_H as ADAPTER_NODE_PORT_H,
  adapterNodeHeight,
} from "@/components/synoptique/components/synoptic-adapter-node";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import {
  computeCartoucheFrame,
  drawCartoucheChrome,
  type CartoucheDoc,
  type CartoucheField,
} from "@/lib/pdf/synoptic-export";
import {
  buildCartoucheLayoutSvg,
  cartoucheHasLayout,
  rasterizeCartoucheLayout,
  resolveSlotValue,
  type CartoucheTemplate,
} from "@/lib/print/export-with-cartouche";
import { useSynopticHistory, type SynopticSnapshot } from "@/components/synoptique/hooks/use-synoptic-history";
import { syncSnapshotToDb } from "@/components/synoptique/lib/snapshot-sync";
import { snapIf, snapCoord } from "@/components/synoptique/lib/grid";
import { buildCablePath, buildCablePathWithWaypoints } from "@/components/synoptique/lib/cable-paths";
import { computeSceneBounds, computeFitAllViewport } from "@/components/synoptique/lib/fit-all";
import type { SceneBounds } from "@/components/synoptique/lib/fit-all";
import {
  collectSceneLayers,
  ensureSvg2Pdf,
  drawSceneLayers,
  drawOverlaySvg,
  recalibrateDuplicateMarkers,
  type VectorDoc,
  type VectorFrame,
} from "@/lib/pdf/synoptic-vector";
import { inlineSvgPresentation } from "@/lib/export/svg-inline-styles";
import { ensureJsPdf, JSPDF_BASE } from "@/lib/pdf/load-jspdf";
import {
  buildEquipmentCards,
  type CardBadge,
  type CardSlotInput,
  type EquipmentCardDescriptor,
  type LegendDescriptor,
} from "@/components/synoptique/lib/scene-descriptor";
import {
  drawEquipmentCards,
  drawLegend,
  resolveCardPalette,
  type CardDoc,
  type CardPalette,
} from "@/lib/pdf/synoptic-cards";

// ── Helpers virtualisation adapter endpoints ───────────────────────────────
// ─── Connection virtualisation — extrait dans _lib/connection-devirt ────────
import {
  adapterVirtualSlotId,
  parseAdapterSlotId,
  virtualizeConnection,
  devirtualizeEndpoint,
  type DbConnection,
} from "@/components/synoptique/lib/connection-devirt";
import {
  defaultRackCablingAdapter,
  type CablingApiAdapter,
} from "@/components/synoptique/lib/cabling-api";

// Mesure la largeur réelle d'un texte via un <span> off-screen
let _measureSpan: HTMLSpanElement | null = null;
function measureLabelWidth(
  text: string,
  fontSize: number,
  fontFamily?: string | null,
  fontWeight?: string,
  fontStyle?: string,
): number {
  if (typeof document === "undefined") return text.length * fontSize * 0.55;
  if (!_measureSpan) {
    _measureSpan = document.createElement("span");
    _measureSpan.style.position = "absolute";
    _measureSpan.style.visibility = "hidden";
    _measureSpan.style.whiteSpace = "pre";
    _measureSpan.style.top = "-9999px";
    _measureSpan.style.left = "-9999px";
    _measureSpan.style.pointerEvents = "none";
    document.body.appendChild(_measureSpan);
  }
  _measureSpan.style.fontFamily = fontFamily ?? "system-ui";
  _measureSpan.style.fontSize = `${fontSize}px`;
  _measureSpan.style.fontWeight = fontWeight ?? "normal";
  _measureSpan.style.fontStyle = fontStyle ?? "normal";
  _measureSpan.textContent = text || " ";
  return _measureSpan.getBoundingClientRect().width;
}
import { SynopticClearLabelsDialog } from "@/components/synoptique/components/synoptic-clear-labels-dialog";
import { SynopticDecableDialog } from "@/components/synoptique/components/synoptic-decable-dialog";
import { RackEditorConfirmDialog } from "@/components/synoptique/components/rack-editor-confirm-dialog";
import { useConfirm } from "@/components/synoptique/hooks/use-confirm";
import {
  useConfirm as useConfirmDialog,
  type ConfirmOptions,
} from "@/components/ui/confirm-dialog";
import { SynopticEmptyInfoDialog } from "@/components/synoptique/components/synoptic-empty-info-dialog";
import { useValidationReport } from "@/components/synoptique/hooks/use-validation-report";
import { useCableLaneOffsets } from "@/components/synoptique/hooks/use-cable-lane-offsets";
import { estimateCableLength, CONNECTOR_DEPTHS } from "@/lib/services/cable-length";
import type {
  ConnectorEntry,
  ConnectorTypeInfo,
  RackSlotWithEquipment,
  SlotComponent,
  RackConnection,
  Port,
  PortRef,
  Zone,
  CanvasLabel,
  DbZone,
  DbLabel,
  ExternalPortData,
  ExternalPortKind,
  ZoneLabelPos,
} from "@/components/synoptique/types/synoptic";
import {
  NODE_W,
  PANEL_NODE_W,
  PORT_H,
  NODE_HEADER_H,
  NODE_MIN_H,
  SNAP_RADIUS,
  SVG_W,
  SVG_H,
  ZONE_COLORS,
  isPanelVirtualId,
  getVirtualRowInfo,
  panelVirtualId,
  virtualToReal,
  realToVirtual,
  expandPanelSlots,
  autoLayout,
} from "@/components/synoptique/types/synoptic";
import { SynopticNode, incompatReason } from "@/components/synoptique/components/synoptic-node";
import { SynopticToasts } from "@/components/synoptique/components/synoptic-toasts";
import { SynopticRulers } from "@/components/synoptique/components/synoptic-rulers";
import { SynopticMiniMap } from "@/components/synoptique/components/synoptic-mini-map";
import { SynopticIncompatTooltip } from "@/components/synoptique/components/synoptic-incompat-tooltip";
import { SynopticDrawingHint } from "@/components/synoptique/components/synoptic-drawing-hint";
import { useCursorHint } from "@/components/editor-shell/hooks/use-cursor-hint";
import { SynopticZoneColorPicker } from "@/components/synoptique/components/synoptic-zone-color-picker";
import { SynopticLabelToolbar } from "@/components/synoptique/components/synoptic-label-toolbar";
import { SynopticLabelInput } from "@/components/synoptique/components/synoptic-label-input";
import { SynopticCableModelDialog } from "@/components/synoptique/components/synoptic-cable-model-dialog";
import { CanvasContextMenu, type CanvasMenuItem } from "@/components/editor-shell/canvas-context-menu";
import { apiFetch } from "@/lib/client-id";
import {
  externalBubble,
  externalPortKind,
} from "@/components/synoptique/lib/external-ports";
import { useLiveCursors } from "@/components/synoptique/hooks/use-live-cursors";
import { RemoteCursorsOverlay } from "@/components/synoptique/components/remote-cursors-overlay";

// ─── SynopticView ─────────────────────────────────────────────────────────────

/**
 * `useConfirm()` (design system) LÈVE hors `<ConfirmProvider>`. Le SynopticView
 * est aussi monté dans une racine React détachée pour l'export dossier
 * (`dossier-synoptic.tsx` → `createRoot`), sans provider : on dégrade au lieu
 * de casser le rendu. `null` = pas de confirmation possible (aucune pose n'a
 * lieu dans ce contexte de rendu hors écran).
 */
function useOptionalConfirm(): ((options: ConfirmOptions) => Promise<boolean>) | null {
  try {
    // useContext est appelé inconditionnellement — seul le throw est intercepté.
    return useConfirmDialog();
  } catch {
    return null;
  }
}

type Props = {
  rackId: string;
  rackName?: string;
  rackCableId?: number | null;
  rackCableCode?: string | null;
  rackNumberingOverride?: Partial<CableNumberingConfig> | null;
  slots: RackSlotWithEquipment[];
  connectorTypes: ConnectorTypeInfo[];
  initialConnections: RackConnection[];
  initialZones?: DbZone[];
  initialLabels?: DbLabel[];
  initialPanelRows?: { slotId: string; rowIndex: number; synopticX: number; synopticY: number }[];
  initialAdapters?: SynopticAdapterInstance[];
  initialExternalPorts?: ExternalPortData[];
  signals?: {
    name: string;
    color: string;
    cablePrefix?: string | null;
    cableSuffix?: string | null;
    category?: string | null;
    categoryRef?: { name: string; cablePrefix: string | null; cableSuffix: string | null } | null;
    /** Signal IP (transporté sur LAN). Deux ports IP peuvent se câbler entre
     *  eux sans matching strict de signal ni de connecteur (cas typique :
     *  câblage via switch IT). */
    isIp?: boolean;
  }[];
  signalCategories?: { name: string; cablePrefix: string | null; cableSuffix: string | null }[];
  isVisible?: boolean;
  /**
   * Publie l'état de cette instance vers les stores GLOBAUX du shell —
   * `useTopbarActions` (faisceaux, guides, mini-map, calques, historique,
   * validation, sélection) et `useCursorHint`. Défaut : `true`.
   *
   * ── Pourquoi cette prop existe ──────────────────────────────────────────
   * Ces stores sont globaux, et la publication suit un motif
   * publier-au-montage / RÉINITIALISER-au-démontage. Le composant était donc
   * un singleton d'application de fait : une seconde instance écrasait les
   * liaisons de la première, et son démontage les remettait à zéro — panneau
   * Faisceaux vidé, poignées de guides mortes, rapport de validation d'une
   * autre vue.
   *
   * `false` rend l'instance MUETTE : elle lit les préférences du store (grille,
   * calques masqués…) mais n'y écrit rien. C'est ce qui permet de monter une
   * seconde vue — sur-modal d'export, hôte de génération hors écran — pendant
   * que l'éditeur visible garde la main sur le shell.
   *
   * ── Ce que la prop couvre AUSSI ─────────────────────────────────────────
   * Les huit écouteurs `keydown` posés sur `window` (annuler/rétablir,
   * Suppr, Échap, raccourcis d'outils). Ils ne sont pas un détail : une
   * seconde instance les attache elle aussi, et un `Suppr` frappé n'importe où
   * atteindrait sa sélection — donc l'API de câblage, donc la base. Une
   * instance muette n'est pas l'éditeur de la page : elle ne publie rien et
   * elle n'écoute pas le clavier global. Les deux tiennent au même
   * interrupteur parce que c'est la même règle.
   *
   * Les écritures des GESTIONNAIRES de la souris ne sont pas gardées : elles
   * demandent un geste sur cette instance-là, et une instance muette est une
   * instance qu'on regarde.
   */
  publishToShell?: boolean;
  onConnectionsChange?: (connections: RackConnection[]) => void;
  /** Called whenever the renumber panel content (or null) changes — used by parent to render in RightPanel overlay. */
  onRenumberPanelChange?: (node: ReactNode | null) => void;
  /** Called whenever the manual numbering panel content (or null) changes. */
  onManualPanelChange?: (node: ReactNode | null) => void;
  /** Called whenever the cable selection changes — passes resolved data, rendered by parent with its own design. */
  onCableDetailsChange?: (data: CableSelectionDetails | null) => void;
  /** Called whenever the connection selection changes — ids of selected connections. */
  onSelectionChange?: (ids: string[]) => void;
  /** Called whenever an adapter is selected — passes resolved data, rendered by parent in right panel. */
  onAdapterDetailsChange?: (data: AdapterSelectionDetails | null) => void;
  /** Called whenever a zone is selected — passes resolved data, rendered by parent in right panel. */
  onZoneDetailsChange?: (data: ZoneSelectionDetails | null) => void;
  /** Called whenever a canvas label is selected — passes resolved data, rendered by parent in right panel. */
  onLabelDetailsChange?: (data: LabelSelectionDetails | null) => void;
  /** Called whenever a node (equipment/panel/accessory slot) is selected — passes resolved data, rendered by parent in right panel. */
  onNodeDetailsChange?: (data: NodeSelectionDetails | null) => void;
  /** Called whenever a single external port is selected — null si aucun. */
  onExternalDetailsChange?: (data: ExternalPortSelectionDetails | null) => void;
  /** Called whenever multi-external-port selection changes. */
  onMultiExternalSelectionChange?: (ports: ExternalPortSummary[]) => void;
  /** Called whenever the active synoptic tool changes (shell bridge). */
  onToolChange?: (toolId: string) => void;
  /** Called whenever the multi-cable selection changes — passes enriched summaries with resolved signal names. */
  onMultiCableSelectionChange?: (cables: CableSummary[]) => void;
  /** Called whenever the multi-node (équipements) selection changes — passes
   *  a summary {nodeCount, rackCount}. Permet au parent d'afficher un panneau
   *  multi-équipements. rackCount = 1 en mode focus rack, = nodeCount en mode
   *  général (1 node = 1 rack en général). */
  onMultiNodeSelectionChange?: (summary: {
    nodeCount: number;
    rackCount: number;
  }) => void;
  /** Called whenever the internal zoom value changes (shell bridge for topbar display). */
  onZoomChange?: (zoom: number) => void;
  /** Paramètres de numérotation câbles (pad, separator, suffixSep) — passés depuis la page via appConfig. */
  cableNumbering?: {
    pad: number;
    sep1: string;
    sep2: string;
    includeRack: boolean;
    template: string;
    templateEnabled: boolean;
    /** @deprecated compat */ separator?: string;
    /** @deprecated compat */ suffixSep?: string;
  };
  /**
   * Adapter API câblage injecté — toutes les mutations connexion passent par lui.
   *
   * Par défaut : `defaultRackCablingAdapter(rackId)` qui frappe les routes
   * `/api/racks/[rackId]/connections|renumber|...` (mode rack focus inchangé).
   *
   * En mode général (vue Générale projet), on injecte un adapter sur mesure
   * qui mappe vers `/api/tenant/projects/[projectId]/synoptic/connections`.
   */
  cablingApi?: CablingApiAdapter;
  /**
   * Mode d'utilisation du SynopticView.
   *
   * - `"rack"` (défaut) : éditeur rack focus complet (renumber, audit, external ports,
   *   adapters, validation rack-graph). Comportement actuel inchangé.
   * - `"general"` : vue Générale projet — désactive renumber / audit / external ports
   *   / adapters (features rack-only) et utilise les slots synthétiques (1 par rack).
   *   Le câblage, les multi-cables, l'incompatibilité, les infobulles, le pan/zoom,
   *   la sélection, les zones/labels passent par EXACTEMENT le même chemin de code.
   * - `"location"` : vue d'un emplacement — agrégat multi-rack de slots RÉELS.
   *   Le décor (zones / labels / bundles / adaptateurs / ports externes) reste
   *   actif, ancré sur le rack virtuel du lieu passé en `rackId` (« pivot »).
   *   Les écritures ancrées à un slot sont routées vers le contenant réel du
   *   slot (`slot.rackId`). Undo/redo local-only (comme `"general"`).
   */
  mode?: "rack" | "general" | "location";
  /**
   * Clé de namespace des préférences locales (pan/zoom, mini-map, repères,
   * calques, style de câble). Défaut : `rackId`. La vue lieu passe
   * `loc:<locationId>` pour ne pas partager l'état du rack pivot.
   */
  viewKey?: string;
  /**
   * Contenants à écouter en SSE (`/api/racks/[id]/events`). Défaut : `[rackId]`.
   * La vue lieu passe tous les racks de l'emplacement.
   */
  sseRackIds?: string[];
  /**
   * Libellés de contenants (`rackId` → nom) affichés en pastille dans l'entête
   * des nœuds. Fourni uniquement par la vue lieu, et volontairement SANS le
   * rack virtuel : les équipements libres n'ont pas de pastille. Absent ⇒
   * aucune pastille (vues rack et générale strictement inchangées).
   */
  rackLabels?: Record<string, { name: string; color: string }>;
  /**
   * Texte de l'état vide (aucun nœud à afficher). Défaut : formulation rack
   * (« Aucun élément câblable »). Les vues agrégées passent leur propre copie.
   */
  emptyState?: { title: string; description: string };
  /**
   * Salle de curseurs live (Phase 3b). Si `undefined`, dérivée en
   * `synoptic:{rackId}` (surface synoptique du rack). Le parent (vue Générale
   * projet) peut passer une salle projet (`synoptic:{projectId}`). `null`
   * désactive complètement les curseurs.
   */
  liveRoom?: string | null;
};

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

/**
 * Chrome d'éditeur retiré de toute copie destinée à un rendu. Liste fixe et
 * non négociable : grille, repères, règles et minimap sont des aides de
 * travail, elles n'ont rien à faire sur un document remis au client.
 */
const EXPORT_HIDE_SELECTORS = [
  "[data-synoptic-grid]",
  "[data-synoptic-guides]",
  "[data-guide-hit]",
  "[data-synoptic-rulers]",
  "[data-minimap]",
  // Palettes flottantes de sélection (libellé, couleur de zone) : elles
  // vivent DANS le canvas et se seraient donc retrouvées sur la feuille.
  "[data-toolbar]",
  // Couche de prise des extrémités de câble (outil Déplacer) : des cibles de
  // pointeur invisibles, mais que le rendu vectoriel émettrait en chemins.
  "[data-synoptic-hit]",
] as const;

/** Respiration autour du plan lors de l'ajustement, en part du petit côté. */
const EXPORT_FIT_PADDING_RATIO = 0.03;
/** Agrandissement maximal à l'ajustement — un petit plan doit remplir sa zone. */
const EXPORT_MAX_ZOOM = 6;

/** Formats papier du poster, en mm, TOUJOURS paysage. */
const PAGE_MM: Record<string, [number, number]> = {
  A0: [1189, 841],
  A1: [841, 594],
  A2: [594, 420],
  A3: [420, 297],
  A4: [297, 210],
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

export const SynopticView = forwardRef<SynopticViewHandle, Props>(function SynopticView(
  {
    rackId,
    rackName = "Synoptique",
    rackCableId = null,
    rackCableCode = null,
    rackNumberingOverride = null,
    slots,
    connectorTypes,
    initialConnections,
    initialZones = [],
    initialLabels = [],
    initialPanelRows = [],
    initialAdapters = [],
    initialExternalPorts = [],
    signals = [],
    signalCategories = [],
    isVisible = true,
    publishToShell = true,
    onConnectionsChange,
    onRenumberPanelChange,
    onManualPanelChange,
    onCableDetailsChange,
    onSelectionChange,
    onAdapterDetailsChange,
    onZoneDetailsChange,
    onLabelDetailsChange,
    onNodeDetailsChange,
    onExternalDetailsChange,
    onMultiCableSelectionChange,
    onMultiNodeSelectionChange,
    onMultiExternalSelectionChange,
    onToolChange,
    onZoomChange,
    cableNumbering,
    cablingApi,
    mode = "rack",
    viewKey,
    sseRackIds,
    rackLabels,
    emptyState,
    liveRoom,
  },
  ref,
) {
  // ── Adapter API câblage (injection point) ─────────────────────────────────
  // Si l'appelant fournit `cablingApi`, on l'utilise tel quel (mode général).
  // Sinon on construit l'adapter rack par défaut (parité 1:1 avec l'existant).
  const cabling = useMemo<CablingApiAdapter>(
    () => cablingApi ?? defaultRackCablingAdapter(rackId),
    [cablingApi, rackId],
  );
  // Ref stable vers l'adapter — consommée par les effets qui ne doivent pas
  // se ré-abonner quand l'adapter change d'identité.
  const cablingRef = useRef(cabling);
  cablingRef.current = cabling;
  // Drapeau pratique pour gater les features rack-only dans tout le composant.
  const isGeneralMode = mode === "general";
  // Vue lieu : agrégat multi-rack de slots RÉELS (décor actif, écritures
  // routées par slot).
  const isLocationMode = mode === "location";
  // Toute vue agrégée (générale OU lieu) : le rackId scalaire ne suffit pas à
  // décrire la surface. Sert à gater ce qui n'a de sens qu'en mono-rack.
  const isAggregate = mode !== "rack";
  const isLocationModeRef = useRef(isLocationMode);
  isLocationModeRef.current = isLocationMode;
  // Namespace des préférences locales — `rackId` par défaut (parité stricte
  // avec les modes rack et général).
  const viewKeyBase = viewKey ?? rackId;

  // ── Curseurs live (Phase 3b) ─────────────────────────────────────────────
  // Salle = celle fournie, sinon `synoptic:{rackId}` (surface synoptique du
  // rack). Le serveur préfixe le tenant. Tout est silencieux si le service WS
  // est absent. Sélections distantes (halo) NON câblées ici (état de sélection
  // fragmenté — reporté) : curseurs seuls.
  const liveCursorRoom =
    liveRoom !== undefined ? liveRoom : rackId ? `synoptic:${rackId}` : null;
  const { peers: livePeers, sendCursor: sendLiveCursor } =
    useLiveCursors(liveCursorRoom);
  const sendLiveCursorRef = useRef(sendLiveCursor);
  sendLiveCursorRef.current = sendLiveCursor;
  const { confirmState: delConfirmState, confirm: delConfirm, cancel: delCancel } = useConfirm();
  // Filter slots that have equipment with at least 1 connector, OR a panel with at least 1 placed connector

  const activeSlots = useMemo(() => {
    // Inclure tout slot (top-level ou child posé sur étagère) qui a au moins
    // 1 point de connexion : panel avec ≥1 connecteur placé, ou équipement
    // (rackable OU non-rackable) avec ≥1 connecteur. Les étagères elles-mêmes
    // sans équipement direct ne s'affichent pas — seuls les enfants visibles.
    const hasConnectors = (s: (typeof slots)[number]): boolean => {
      // Nœud synthétique qui doit rester visible même sans port (bloc lieu /
      // contenant de la vue Générale).
      if (s.renderWhenEmpty) return true;
      if (s.panel) {
        return s.panel.slots.some((ps) => ps.connectorTypeId != null);
      }
      if (
        Array.isArray(s.equipment?.connectors) &&
        (s.equipment.connectors as ConnectorEntry[]).length > 0
      ) {
        return true;
      }
      // Un châssis peut n'avoir aucun connecteur propre mais héberger des
      // composants (cartes) porteurs de connecteurs — le nœud hôte doit alors
      // s'afficher pour rendre les ports composants.
      const comps = (s as { components?: SlotComponent[] }).components;
      return (
        Array.isArray(comps) &&
        comps.some(
          (c) =>
            Array.isArray(c.equipment?.connectors) &&
            (c.equipment.connectors as ConnectorEntry[]).length > 0,
        )
      );
    };
    const result: typeof slots = [];
    for (const s of slots) {
      if (hasConnectors(s)) result.push(s);
      const children = (s as { children?: typeof slots }).children;
      if (Array.isArray(children)) {
        for (const child of children) {
          if (hasConnectors(child)) result.push(child);
        }
      }
    }
    return result;
  }, [slots]);

  // Expand multi-U panels into virtual 1-U row nodes
  const expandedSlots = useMemo(() => expandPanelSlots(activeSlots), [activeSlots]);

  // Node positions (x, y) — built entirely from DB data (no localStorage) to avoid hydration mismatch
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(() => {
    const map = new Map<string, { x: number; y: number }>();
    // Real equipment slots — position from DB fields
    for (const s of activeSlots) {
      if (!s.panel && s.synopticX != null && s.synopticY != null) {
        map.set(s.id, { x: s.synopticX, y: s.synopticY });
      }
    }
    // Virtual panel rows — position from DB (initialPanelRows)
    for (const row of initialPanelRows) {
      const virtualId = panelVirtualId(row.slotId, row.rowIndex);
      map.set(virtualId, { x: row.synopticX, y: row.synopticY });
    }
    // Auto-layout for anything without a saved position
    const expanded = expandPanelSlots(activeSlots);
    const needsLayout = expanded.filter((s) => !map.has(s.id));
    if (needsLayout.length > 0) {
      const auto = autoLayout(needsLayout, connectorTypes, map);
      auto.forEach((pos, id) => map.set(id, pos));
    }
    return map;
  });

  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  // Forward refs pour l'undo/redo — assignés plus bas (après déclaration de history/captureSnapshot).
  // Permet aux callbacks déclarés tôt (adapters) d'appeler pushSnapshot sans TDZ.
  const pushHistoryRef = useRef<(() => void) | null>(null);

  // ── Adaptateurs synoptique ──────────────────────────────────────────────
  const [adapters, setAdapters] = useState<SynopticAdapterInstance[]>(initialAdapters);
  // Re-sync sur refetch SSE cross-client.
  useEffect(() => {
    setAdapters(initialAdapters);
  }, [initialAdapters]);
  // ── Sorties externes (outil "Connexions externe") ───────────────────────
  // Marqueur posé sur un port libre : trait horizontal + bulle flottante.
  // Base de la future vue Général qui reliera ces marques entre racks.
  const [externalPorts, setExternalPorts] =
    useState<ExternalPortData[]>(initialExternalPorts);
  useEffect(() => {
    setExternalPorts(initialExternalPorts);
  }, [initialExternalPorts]);
  // Index par slotId → Set des portIndex marqués externes — passé à SynopticNode
  // pour remplir le port dot HTML directement (pas de cercle SVG séparé).
  const externalPortsBySlot = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const ext of externalPorts) {
      // Virtualiser pour matcher l'ID de slot utilisé par SynopticNode (panel rows).
      const virt = realToVirtual(ext.slotId, ext.portIndex, activeSlots);
      let set = map.get(virt.slotId);
      if (!set) {
        set = new Set();
        map.set(virt.slotId, set);
      }
      set.add(virt.portIndex);
    }
    return map;
  }, [externalPorts, activeSlots]);

  // ── Résolution du contenant d'une écriture ancrée à un slot ──────────────
  //
  // En vue rack / générale, TOUTES les écritures visent le `rackId` scalaire.
  // En vue lieu, les slots viennent de plusieurs contenants et portent chacun
  // leur `rackId` : les routes `/api/racks/[id]/{slots,panel-rows,external-ports,
  // adapters}` doivent être adressées au contenant réel, pas au pivot.
  //
  // Fallback systématique sur `rackId` (pivot) → comportement identique au
  // mode rack tant qu'aucun slot ne porte de `rackId`.
  const adaptersForRackRef = useRef(adapters);
  adaptersForRackRef.current = adapters;
  const slotRackMap = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (list: RackSlotWithEquipment[]) => {
      for (const s of list) {
        const rid = s.rackId;
        if (rid) map.set(s.id, rid);
        const children = (s as { children?: RackSlotWithEquipment[] }).children;
        if (Array.isArray(children)) walk(children);
      }
    };
    walk(slots);
    return map;
  }, [slots]);
  const externalPortRackMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ext of externalPorts) {
      if (ext.rackId) map.set(ext.id, ext.rackId);
    }
    return map;
  }, [externalPorts]);

  /** Contenant d'un slot (réel, panel row virtuel, ou adaptateur virtuel). */
  const rackFor = useCallback(
    (slotId: string | null | undefined): string => {
      if (!slotId) return rackId;
      const direct = slotRackMap.get(slotId);
      if (direct) return direct;
      const ad = parseAdapterSlotId(slotId);
      if (ad) {
        const inst = adaptersForRackRef.current.find((a) => a.id === ad.adapterId);
        if (inst?.rackId) return inst.rackId;
        const attached = inst?.attachedSlotId
          ? slotRackMap.get(inst.attachedSlotId)
          : undefined;
        return attached ?? rackId;
      }
      const info = getVirtualRowInfo(slotId);
      if (info) return slotRackMap.get(info.slotId) ?? rackId;
      return rackId;
    },
    [rackId, slotRackMap],
  );
  /** Contenant d'un adaptateur : sa propre baie, sinon celle de son port hôte. */
  const rackForAdapter = useCallback(
    (adapterId: string): string => {
      const inst = adaptersForRackRef.current.find((a) => a.id === adapterId);
      if (inst?.rackId) return inst.rackId;
      return rackFor(inst?.attachedSlotId ?? null);
    },
    [rackFor],
  );
  /** Contenant d'un marqueur externe (porté par le payload agrégé). */
  const rackForExternalPort = useCallback(
    (externalId: string, slotId?: string | null): string =>
      externalPortRackMap.get(externalId) ?? rackFor(slotId),
    [externalPortRackMap, rackFor],
  );
  // Refs stables — consommées par les callbacks/effets déjà en place pour ne
  // modifier AUCUNE liste de dépendances existante.
  const rackForRef = useRef(rackFor);
  rackForRef.current = rackFor;
  const rackForAdapterRef = useRef(rackForAdapter);
  rackForAdapterRef.current = rackForAdapter;
  const rackForExternalPortRef = useRef(rackForExternalPort);
  rackForExternalPortRef.current = rackForExternalPort;

  // Faisceaux (bundles) de câbles — metadata partagée par plusieurs câbles
  const [bundles, setBundles] = useState<{ id: string; name: string; color: string }[]>([]);
  useEffect(() => {
    // Mode général : pas de bundles rack-scoped (route 404 sur rackId logique)
    if (isGeneralMode) return;
    fetch(`/api/racks/${rackId}/bundles`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setBundles(
            data
              .map((b: Record<string, unknown>) => ({
                id: String(b.id ?? ""),
                name: String(b.name ?? ""),
                color: String(b.color ?? "#6366f1"),
              }))
              .filter((b) => b.id),
          );
        }
      })
      .catch(() => {});
  }, [rackId, isGeneralMode]);
  const bundleById = useMemo(() => new Map(bundles.map((b) => [b.id, b])), [bundles]);

  // Calcule les extras de hauteur causés par les adaptateurs attachés.
  // Pour chaque slot : par côté (left/right), accumuler les fan-out rows en
  // ordre des ports → marginBottom sous le port avec adapter, cumul AVANT chaque port.
  type SlotExtras = {
    marginsByPortIdx: Map<number, number>; // marginBottom à ajouter SOUS ce port (visuel)
    cumulByPortIdx: Map<number, number>; // extra-y AVANT ce port (calcul positions)
    extraNodeHeight: number;
  };
  const [selectedAdapterId, setSelectedAdapterId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "cable" | "adapter" | "zone" | "label";
    id: string;
  } | null>(null);
  const [portAdapterMenu, setPortAdapterMenu] = useState<{
    x: number;
    y: number;
    slotId: string;
    portIndex: number;
    connectorTypeId: string | null;
    gender: string | null;
    side: "left" | "right";
  } | null>(null);
  const [adapterPickerOpen, setAdapterPickerOpen] = useState(false);
  const [adapterPickerCtx, setAdapterPickerCtx] = useState<AdapterPickerContext | null>(null);
  // Cible de placement — toujours attaché à un port d'équipement
  const [adapterPlaceTarget, setAdapterPlaceTarget] = useState<{
    slotId: string;
    side: "left" | "right";
    portIndex: number;
    x: number;
    y: number;
  } | null>(null);

  const openAdapterPickerForPort = useCallback(
    (
      slotId: string,
      side: "left" | "right",
      portIndex: number,
      ct: { id: string; name: string } | null,
      x: number,
      y: number,
    ) => {
      setAdapterPickerCtx({
        sourceConnectorTypeId: ct?.id ?? null,
        sourceConnectorTypeName: ct?.name ?? null,
      });
      setAdapterPlaceTarget({ slotId, side, portIndex, x, y });
      setAdapterPickerOpen(true);
    },
    [],
  );

  const handleAdapterPicked = useCallback(
    async (adapter: AdapterDTO) => {
      const target = adapterPlaceTarget;
      if (!target) {
        setAdapterPickerOpen(false);
        return;
      }
      const body = {
        adapterId: adapter.id,
        x: target.x,
        y: target.y,
        attachedSlotId: target.slotId,
        attachedSide: target.side,
        attachedPortIndex: target.portIndex,
      };
      try {
        const res = await apiFetch(`/api/racks/${rackForRef.current(target.slotId)}/adapters`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const created = (await res.json()) as SynopticAdapterInstance;
          // Dédup : le SSE "adapter_added" peut arriver avant la réponse POST
          pushHistoryRef.current?.();
          setAdapters((prev) =>
            prev.some((a) => a.id === created.id) ? prev : [...prev, created],
          );
        }
      } finally {
        setAdapterPickerOpen(false);
        setAdapterPlaceTarget(null);
        setAdapterPickerCtx(null);
      }
    },
    [adapterPlaceTarget, rackId],
  );

  // Drag & drop d'un adaptateur — listeners window (la couche SVG est pointer-events:none).
  // zoom est lu via une ref globale `adapterLiveZoomRef` mise à jour plus bas.
  // Cas "free" : adapter non-attaché → on translate (x,y).
  // Cas "attached" : adapter attaché à un port équipement → en mode move, on permet
  //   de le déplacer vers un autre port libre (snap < 30px). PointerUp commit via PATCH.
  type AdapterDrag = {
    id: string;
    mode: "free" | "rebind";
    // free
    startMouseX: number;
    startMouseY: number;
    startAdX: number;
    startAdY: number;
    // rebind
    originalAttachedSlotId: string | null;
    originalAttachedPortIndex: number | null;
    originalAttachedSide: "left" | "right" | null;
    cursor: { x: number; y: number } | null; // SVG coords, where the adapter anchor is
    snap: { slotId: string; portIndex: number; side: "left" | "right" } | null;
    snapIncompat: boolean; // true si le snap actuel est incompatible (CT/direction)
    snapIncompatMsg: string | null;
  };
  const adapterDragRef = useRef<AdapterDrag | null>(null);
  const [adapterDrag, setAdapterDrag] = useState<AdapterDrag | null>(null);
  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;
  const adapterLiveZoomRef = useRef(1);

  const handleAdapterPointerDownRef = useRef<((id: string, e: React.PointerEvent) => void) | null>(
    null,
  );
  const handleAdapterPointerDown = useCallback(
    (adapterId: string, e: React.PointerEvent) => {
      e.stopPropagation();
      const adapterLocked = lockedLayerIdsRef.current.has(adapterId);
      if (toolRef.current === "erase") {
        if (adapterLocked) {
          selectOnly("adapter", adapterId);
          return;
        }
        pushHistoryRef.current?.();
        setAdapters((prev) => prev.filter((a) => a.id !== adapterId));
        setSelectedAdapterId(null);
        void apiFetch(
          `/api/racks/${rackForAdapterRef.current(adapterId)}/adapters/${adapterId}`,
          { method: "DELETE" },
        );
        return;
      }
      // Mode select : sélectionne, attend un mouvement > seuil avant de basculer en move.
      if (toolRef.current === "select") {
        selectOnly("adapter", adapterId);
        if (adapterLocked) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const THRESHOLD = 4;
        const onMove = (ev: PointerEvent) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (dx * dx + dy * dy < THRESHOLD * THRESHOLD) return;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          setToolRef.current("move");
          handleAdapterPointerDownRef.current?.(adapterId, {
            ...e,
            clientX: startX,
            clientY: startY,
            stopPropagation: () => {},
          } as React.PointerEvent);
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp, { once: true });
        return;
      }
      // En mode move : sélectionner + drag.
      if (toolRef.current === "move") {
        selectOnly("adapter", adapterId);
      } else {
        selectOnly("adapter", adapterId);
        return;
      }
      if (adapterLocked) return;
      const ad = adaptersRef.current.find((a) => a.id === adapterId);
      if (!ad) return;
      // Push pre-drag snapshot (capture adapters before move/rebind)
      pushHistoryRef.current?.();
      if (ad.attachedSlotId && ad.attachedPortIndex != null && ad.attachedSide) {
        // Mode rebind : détache visuellement, suit le curseur, snap sur port libre au up.
        adapterDragRef.current = {
          id: adapterId,
          mode: "rebind",
          startMouseX: e.clientX,
          startMouseY: e.clientY,
          startAdX: ad.x,
          startAdY: ad.y,
          originalAttachedSlotId: ad.attachedSlotId,
          originalAttachedPortIndex: ad.attachedPortIndex,
          originalAttachedSide: ad.attachedSide,
          cursor: null,
          snap: null,
          snapIncompat: false,
          snapIncompatMsg: null,
        };
        setAdapterDrag(adapterDragRef.current);
      } else {
        adapterDragRef.current = {
          id: adapterId,
          mode: "free",
          startMouseX: e.clientX,
          startMouseY: e.clientY,
          startAdX: ad.x,
          startAdY: ad.y,
          originalAttachedSlotId: null,
          originalAttachedPortIndex: null,
          originalAttachedSide: null,
          cursor: null,
          snap: null,
          snapIncompat: false,
          snapIncompatMsg: null,
        };
      }
    },
    [rackId],
  );
  handleAdapterPointerDownRef.current = handleAdapterPointerDown;

  // Refs pour accéder au snap helpers depuis le handler window (lazy init — populated below)
  const slotPortsRef = useRef<Map<string, Port[]> | null>(null);
  const adaptersForSnapRef = useRef<SynopticAdapterInstance[]>(adapters);
  adaptersForSnapRef.current = adapters;
  const isPortOccupiedRef = useRef<((sid: string, pi: number) => boolean) | null>(null);
  const adapterDragContainerRef = useRef<HTMLDivElement | null>(null);
  const adapterDragViewRef = useRef<{ pan: { x: number; y: number }; zoom: number }>({
    pan: { x: 0, y: 0 },
    zoom: 1,
  });
  const adapterDragGetPortCenterRef = useRef<
    | ((
        slotId: string,
        portIndex: number,
      ) => { x: number; y: number; side: "left" | "right" } | null)
    | null
  >(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = adapterDragRef.current;
      if (!drag) return;
      const z = adapterLiveZoomRef.current || 1;
      if (drag.mode === "free") {
        const dx = (e.clientX - drag.startMouseX) / z;
        const dy = (e.clientY - drag.startMouseY) / z;
        const snapS = useTopbarActions.getState();
        const { x: nx, y: ny } = snapIf(
          drag.startAdX + dx,
          drag.startAdY + dy,
          snapS.gridStep,
          snapS.snapEnabled,
        );
        setAdapters((prev) => prev.map((a) => (a.id === drag.id ? { ...a, x: nx, y: ny } : a)));
        return;
      }
      // Mode rebind : convertit clientX/Y en coords SVG via containerRef + viewRef
      const el = adapterDragContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { pan: p } = adapterDragViewRef.current;
      const sx = (e.clientX - rect.left - p.x) / z;
      const sy = (e.clientY - rect.top - p.y) / z;

      // Cherche le port équipement libre le plus proche (rayon 30 / zoom).
      const RADIUS = 30 / z;
      let best: { slotId: string; portIndex: number; side: "left" | "right"; dist: number } | null =
        null;
      const sp = slotPortsRef.current;
      const getCenter = adapterDragGetPortCenterRef.current;
      const isOcc = isPortOccupiedRef.current;
      const adAttached = new Set<string>();
      // ports déjà occupés par un autre adaptateur (key = "slotId#portIndex")
      adaptersForSnapRef.current.forEach((a) => {
        if (a.id === drag.id) return; // soi-même : on libère
        if (a.attachedSlotId && a.attachedPortIndex != null) {
          adAttached.add(`${a.attachedSlotId}#${a.attachedPortIndex}`);
        }
      });
      if (sp && getCenter) {
        sp.forEach((ports, sid) => {
          ports.forEach((port) => {
            // Skip occupied (par câble OU autre adapter). On AUTORISE le port d'origine.
            const isOrigin =
              sid === drag.originalAttachedSlotId &&
              port.portIndex === drag.originalAttachedPortIndex;
            if (!isOrigin) {
              if (isOcc?.(sid, port.portIndex)) return;
              if (adAttached.has(`${sid}#${port.portIndex}`)) return;
            }
            const c = getCenter(sid, port.portIndex);
            if (!c) return;
            const d = Math.hypot(c.x - sx, c.y - sy);
            if (d <= RADIUS && (!best || d < best.dist)) {
              best = { slotId: sid, portIndex: port.portIndex, side: port.side, dist: d };
            }
          });
        });
      }
      // Compat check CT + direction sur le snap proposé (comparé au port d'origine
      // de l'adaptateur). Si incompat → snap visuel rouge + tooltip.
      let snapIncompat = false;
      let snapIncompatMsg: string | null = null;
      if (best !== null && drag.originalAttachedSlotId && drag.originalAttachedPortIndex != null) {
        const b = best as {
          slotId: string;
          portIndex: number;
          side: "left" | "right";
          dist: number;
        };
        const origPorts = getPortsForSlotOrAdapterRef.current(drag.originalAttachedSlotId);
        const origPort = origPorts.find((p) => p.portIndex === drag.originalAttachedPortIndex);
        const dstPorts = getPortsForSlotOrAdapterRef.current(b.slotId);
        const dstPort = dstPorts.find((p) => p.portIndex === b.portIndex);
        if (origPort && dstPort) {
          // Adapter rebind : vérif restreinte au type de connecteur uniquement
          // (pas de contrôle direction/signal).
          const srcTypeId = origPort.entry.connectorTypeId ?? null;
          const dstTypeId = dstPort.entry.connectorTypeId ?? null;
          if (srcTypeId && dstTypeId && srcTypeId !== dstTypeId) {
            const msg = "Types de connecteur differents";
            snapIncompat = true;
            snapIncompatMsg = msg;
            setIncompatTooltipRef.current({ msg, x: e.clientX, y: e.clientY });
          } else {
            setIncompatTooltipRef.current(null);
          }
        }
      } else {
        setIncompatTooltipRef.current(null);
      }
      const next: AdapterDrag = {
        ...drag,
        cursor: { x: sx, y: sy },
        snap: best,
        snapIncompat,
        snapIncompatMsg,
      };
      adapterDragRef.current = next;
      setAdapterDrag(next);
    };
    const onUp = async () => {
      const drag = adapterDragRef.current;
      adapterDragRef.current = null;
      setAdapterDrag(null);
      if (!drag) return;
      if (drag.mode === "free") {
        const ad = adaptersRef.current.find((a) => a.id === drag.id);
        if (!ad) return;
        const snap = useTopbarActions.getState();
        const finalX = snap.snapEnabled ? snapCoord(ad.x, snap.gridStep) : ad.x;
        const finalY = snap.snapEnabled ? snapCoord(ad.y, snap.gridStep) : ad.y;
        if (finalX !== ad.x || finalY !== ad.y) {
          setAdapters((prev) =>
            prev.map((a) => (a.id === drag.id ? { ...a, x: finalX, y: finalY } : a)),
          );
        }
        await apiFetch(
          `/api/racks/${rackForAdapterRef.current(drag.id)}/adapters/${drag.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ x: finalX, y: finalY }),
          },
        );
        return;
      }
      // Nettoie le tooltip incompat quoi qu'il arrive.
      setIncompatTooltipRef.current(null);
      // Rebind : si snap valide ET différent de l'origine → PATCH attachedSlot/Side/PortIndex
      const snap = drag.snap;
      if (!snap) return; // pas de snap → annulation, l'adapter reste sur son port d'origine
      // Si incompatible (CT/direction) → annulation + toast. Pas de rollback local nécessaire
      // (l'anchor reste sur le port d'origine, rien n'a été muté côté état).
      if (drag.snapIncompat) {
        pushToastRef.current("Connecteurs incompatibles — déplacement annulé", "warn");
        return;
      }
      const sameAsOrigin =
        snap.slotId === drag.originalAttachedSlotId &&
        snap.portIndex === drag.originalAttachedPortIndex &&
        snap.side === drag.originalAttachedSide;
      if (sameAsOrigin) return;
      // Vue lieu : un adaptateur appartient à un contenant. Le rattacher à un
      // port d'un AUTRE contenant demanderait de le déplacer en base — non
      // supporté en v1, on annule proprement.
      if (
        isLocationModeRef.current &&
        rackForRef.current(snap.slotId) !== rackForAdapterRef.current(drag.id)
      ) {
        pushToastRef.current(
          "Déplacement vers un autre contenant non pris en charge",
          "warn",
        );
        return;
      }
      // Update local optimiste
      setAdapters((prev) =>
        prev.map((a) =>
          a.id === drag.id
            ? {
                ...a,
                attachedSlotId: snap.slotId,
                attachedSide: snap.side,
                attachedPortIndex: snap.portIndex,
              }
            : a,
        ),
      );
      try {
        await apiFetch(
          `/api/racks/${rackForAdapterRef.current(drag.id)}/adapters/${drag.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attachedSlotId: snap.slotId,
              attachedSide: snap.side,
              attachedPortIndex: snap.portIndex,
            }),
          },
        );
      } catch {
        // Rollback en cas d'erreur réseau
        setAdapters((prev) =>
          prev.map((a) =>
            a.id === drag.id
              ? {
                  ...a,
                  attachedSlotId: drag.originalAttachedSlotId,
                  attachedSide: drag.originalAttachedSide,
                  attachedPortIndex: drag.originalAttachedPortIndex,
                }
              : a,
          ),
        );
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [rackId]);

  const handleAdapterDelete = useCallback(
    async (adapterId: string) => {
      pushHistoryRef.current?.();
      const targetRackId = rackForAdapterRef.current(adapterId);
      setAdapters((prev) => prev.filter((a) => a.id !== adapterId));
      setSelectedAdapterId(null);
      await apiFetch(`/api/racks/${targetRackId}/adapters/${adapterId}`, { method: "DELETE" });
    },
    [rackId],
  );

  // Auto-layout for slots added after mount (e.g. new equipment dropped in Design)
  // Without this, fitAll skips them (no position) until the user moves them once.
  useEffect(() => {
    const missing = expandedSlots.filter((s) => !positionsRef.current.has(s.id));
    if (missing.length === 0) return;
    const auto = autoLayout(missing, connectorTypes, positionsRef.current);
    if (auto.size === 0) return;
    setPositions((prev) => {
      const next = new Map(prev);
      auto.forEach((pos, id) => {
        if (!next.has(id)) next.set(id, pos);
      });
      return next;
    });
    // Allow fitAll to re-frame including the new nodes
    viewInitializedRef.current = false;
  }, [expandedSlots, connectorTypes]);

  // Track which IDs have already been persisted this session to avoid duplicate writes
  const persistedIds = useRef(
    new Set<string>([
      ...initialPanelRows.map((r) => panelVirtualId(r.slotId, r.rowIndex)),
      ...activeSlots.filter((s) => !s.panel && s.synopticX != null).map((s) => s.id),
    ]),
  );

  // Persist auto-layout positions for any new slots not yet in DB
  useEffect(() => {
    const expanded = expandPanelSlots(activeSlots);
    for (const s of expanded) {
      if (persistedIds.current.has(s.id)) continue;
      const pos = positionsRef.current.get(s.id);
      if (!pos) continue;
      persistedIds.current.add(s.id);
      if (isPanelVirtualId(s.id)) {
        const info = getVirtualRowInfo(s.id);
        if (info) {
          apiFetch(`/api/racks/${rackForRef.current(info.slotId)}/panel-rows`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slotId: info.slotId,
              rowIndex: info.rowIdx,
              x: pos.x,
              y: pos.y,
            }),
          });
        }
      } else if (!s.panel) {
        // Passe par l'adapter : en rack et en lieu il frappe exactement la même
        // route qu'avant (`/api/racks/[rack du slot]/slots/[id]`) ; en vue
        // Générale il route vers la position de bloc (lieu ou contenant) au
        // lieu d'une route rack inexistante.
        cablingRef.current
          .persistSlotPosition(s.id, pos.x, pos.y)
          .catch(() => {});
      }
    }
  }, [activeSlots, rackId]);

  const [connections, setConnections] = useState<RackConnection[]>(() =>
    initialConnections.map((c) => virtualizeConnection(c as DbConnection, activeSlots)),
  );
  // Re-sync depuis le parent quand le payload arrive d'un refetch (SSE crossClient).
  // Les events propres au tab sont déjà filtrés par clientId → cet effet ne tire
  // que sur des updates externes. La forme cible passe par virtualizeConnection.
  useEffect(() => {
    setConnections(initialConnections.map((c) => virtualizeConnection(c as DbConnection, activeSlots)));
  }, [initialConnections]);
  const onConnectionsChangeRef = useRef(onConnectionsChange);
  onConnectionsChangeRef.current = onConnectionsChange;
  useEffect(() => {
    onConnectionsChangeRef.current?.(connections);
  }, [connections]);

  // Publie la liste des faisceaux + leur compteur au store (panneau général)
  useEffect(() => {
    if (!publishToShell) return;
    const count = new Map<string, number>();
    for (const c of connections) {
      const bid = (c as unknown as { bundleId?: string | null }).bundleId ?? null;
      if (bid) count.set(bid, (count.get(bid) ?? 0) + 1);
    }
    useTopbarActions
      .getState()
      .setSynopticBundles(bundles.map((b) => ({ ...b, count: count.get(b.id) ?? 0 })));
    return () => {
      useTopbarActions.getState().setSynopticBundles([]);
    };
  }, [bundles, connections, publishToShell]);
  // Expose le handler d'action bundle (rename / color / delete) au panneau
  useEffect(() => {
    if (!publishToShell) return;
    useTopbarActions.getState().setOnBundleAction(async (action, bundleId, payload) => {
      if (action === "delete") {
        const res = await apiFetch(`/api/racks/${rackId}/bundles/${bundleId}`, { method: "DELETE" });
        if (res.ok) {
          setBundles((prev) => prev.filter((b) => b.id !== bundleId));
          setConnections((prev) =>
            prev.map((c) => {
              if ((c as unknown as { bundleId?: string | null }).bundleId === bundleId)
                return { ...c, bundleId: null } as typeof c;
              return c;
            }),
          );
        }
      } else if (action === "rename" && payload) {
        const res = await apiFetch(`/api/racks/${rackId}/bundles/${bundleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: payload }),
        });
        if (res.ok)
          setBundles((prev) => prev.map((b) => (b.id === bundleId ? { ...b, name: payload } : b)));
      } else if (action === "color" && payload) {
        const res = await apiFetch(`/api/racks/${rackId}/bundles/${bundleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ color: payload }),
        });
        if (res.ok)
          setBundles((prev) => prev.map((b) => (b.id === bundleId ? { ...b, color: payload } : b)));
      }
    });
    return () => {
      useTopbarActions.getState().setOnBundleAction(undefined);
    };
  }, [rackId, publishToShell]);
  const [tool, setToolRaw] = useState<
    | "pan"
    | "select"
    | "move"
    | "label"
    | "zone"
    | "adapter"
    | "external"
    | "cable"
    | "numbering"
    | "erase"
    | "zoom"
  >("select");
  const zoomVariantRef = useRef<"in" | "out">("in");
  // Cancel any open inline label editor when switching away from label tool.
  // (Defined after useState so the effect lives near related state declarations.)
  const SYNOPTIC_TOOL_KEY = "synoptic.tool";
  const VALID_TOOLS = [
    "pan",
    "select",
    "move",
    "label",
    "zone",
    "adapter",
    "external",
    "cable",
    "numbering",
    "erase",
    "zoom",
  ] as const;
  const setTool = useCallback(
    (
      value:
        | "pan"
        | "select"
        | "move"
        | "label"
        | "zone"
        | "adapter"
        | "external"
        | "cable"
        | "numbering"
        | "erase"
        | "zoom",
    ) => {
      setToolRaw(value);
      try {
        localStorage.setItem(SYNOPTIC_TOOL_KEY, value);
      } catch {}
    },
    [],
  );
  const setToolRef = useRef(setTool);
  setToolRef.current = setTool;
  const onToolChangeRef = useRef(onToolChange);
  onToolChangeRef.current = onToolChange;
  // Skip le tout premier firing (mount) : la sync initiale shell ↔ view est
  // assurée par le bridge useEffect[activeToolId] du parent. Notifier
  // onToolChange au mount déclencherait une boucle setState (handleSynopticToolChange
  // → setTool → bridge → setActiveTool → tool change → useEffect → ...) quand
  // le parent est wrappé directement en WorkspaceProvider workspace="synoptic"
  // (cas project tab — pas le rack-editor qui démarre en "design").
  const initialToolFiredRef = useRef(false);
  useEffect(() => {
    if (!initialToolFiredRef.current) {
      initialToolFiredRef.current = true;
      return;
    }
    onToolChangeRef.current?.(tool);
  }, [tool]);
  // Restore persisted tool after mount (avoids SSR hydration mismatch).
  // Si onToolChange est fourni, le parent gère la persistance via son propre
  // shell store (clé `arkyo-last-tool-synoptic`) — on skip pour éviter une
  // divergence entre `synoptic.tool` (interne) et la clé shell, qui
  // déclencherait un ping-pong infini avec le bridge useEffect.
  useEffect(() => {
    if (onToolChangeRef.current) return;
    try {
      const saved = localStorage.getItem(SYNOPTIC_TOOL_KEY);
      if (saved && (VALID_TOOLS as readonly string[]).includes(saved)) {
        setToolRaw(saved as (typeof VALID_TOOLS)[number]);
      } else {
        // Backward compat : ancienne clé
        const legacy = localStorage.getItem("synoptic-tool");
        if (legacy && (VALID_TOOLS as readonly string[]).includes(legacy)) {
          setToolRaw(legacy as (typeof VALID_TOOLS)[number]);
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // showLegend est hydraté depuis le store persisté (arkyo:topbar-prefs) APRÈS
  // le mount client, pour éviter un mismatch SSR/CSR (le store Zustand+persist
  // hydrate depuis localStorage uniquement côté client). Au premier render
  // server ET client, la valeur reste false → markup identique. Le useEffect
  // synchronise ensuite avec la préférence utilisateur.
  const [showLegend, setShowLegend] = useState(false);
  useEffect(() => {
    setShowLegend(useTopbarActions.getState().synopticLegendVisible);
  }, []);

  // ── Style defaults for label / zone creation (local UI state) ───────────
  // Hydrated from the persisted topbar store on mount; writes come via imperative handle.
  const [labelFont, setLabelFont] = useState<string>(
    () => useTopbarActions.getState().synopticLabelFont,
  );
  const [labelFontSize, setLabelFontSize] = useState<number>(
    () => useTopbarActions.getState().synopticLabelFontSize,
  );
  const [labelColor, setLabelColor] = useState<string>(
    () => useTopbarActions.getState().synopticLabelColor,
  );
  const [zoneColor, setZoneColor] = useState<string>(() => useTopbarActions.getState().zoneColor);

  // ── Zones (physical areas drawn on canvas) ───────────────────────────────
  const [zones, setZones] = useState<Zone[]>(
    initialZones.map((z) => ({
      ...z,
      labelPosition: (z.labelPosition as ZoneLabelPos) ?? "top-left",
    })),
  );
  // Re-sync sur refetch SSE cross-client.
  useEffect(() => {
    setZones(
      initialZones.map((z) => ({
        ...z,
        labelPosition: (z.labelPosition as ZoneLabelPos) ?? "top-left",
      })),
    );
  }, [initialZones]);
  const [drawingZone, setDrawingZone] = useState<{
    sx: number;
    sy: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const drawingZoneRef = useRef(drawingZone);
  drawingZoneRef.current = drawingZone;
  const [hoveredZoneLabelId, setHoveredZoneLabelId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedZoneIds, setSelectedZoneIds] = useState<Set<string>>(new Set());
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(new Set());
  const zoneResizeDragRef = useRef<{
    handle: string;
    zoneId: string;
    origZone: Zone;
    startCX: number;
    startCY: number;
  } | null>(null);

  const createZoneApi = async (zone: Zone) => {
    const res = await apiFetch(`/api/racks/${rackId}/zones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: zone.label,
        labelPosition: zone.labelPosition,
        color: zone.color,
        x: zone.x,
        y: zone.y,
        w: zone.w,
        h: zone.h,
        borderRadius: zone.borderRadius,
        borderWidth: zone.borderWidth,
        borderStyle: zone.borderStyle,
        opacity: zone.opacity,
        labelFontSize: zone.labelFontSize,
        labelFontWeight: zone.labelFontWeight,
        labelFontStyle: zone.labelFontStyle,
        labelTextDecoration: zone.labelTextDecoration,
        labelFontFamily: zone.labelFontFamily,
      }),
    });
    const created = await res.json();
    // Replace temp id with server id — guard against SSE race (zone_added may have already added the real id)
    setZones((prev) => {
      const withoutTemp = prev.filter((z) => z.id !== zone.id);
      if (withoutTemp.some((z) => z.id === created.id)) return withoutTemp; // SSE already added real zone
      return [...withoutTemp, { ...zone, id: created.id }];
    });
  };
  const reloadZones = useCallback(() => {
    fetch(`/api/racks/${rackId}/zones`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Zone[] | null) => {
        if (Array.isArray(data)) {
          setZones(
            data.map((z) => ({
              ...z,
              labelPosition: (z.labelPosition as ZoneLabelPos) ?? "top-left",
            })),
          );
        }
      })
      .catch(() => {});
  }, [rackId]);
  const updateZoneApi = (zone: Zone) => {
    apiFetch(`/api/racks/${rackId}/zones/${zone.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: zone.label,
        labelPosition: zone.labelPosition,
        color: zone.color,
        x: zone.x,
        y: zone.y,
        w: zone.w,
        h: zone.h,
        borderRadius: zone.borderRadius,
        borderWidth: zone.borderWidth,
        borderStyle: zone.borderStyle,
        opacity: zone.opacity,
        labelFontSize: zone.labelFontSize,
        labelFontWeight: zone.labelFontWeight,
        labelFontStyle: zone.labelFontStyle,
        labelTextDecoration: zone.labelTextDecoration,
        labelFontFamily: zone.labelFontFamily,
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      })
      .catch(() => {
        pushToast("Échec mise à jour de la zone — rechargement", "error");
        reloadZones();
      });
  };
  const deleteZoneApi = (zoneId: string) => {
    apiFetch(`/api/racks/${rackId}/zones/${zoneId}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
      })
      .catch(() => {
        pushToast("Échec suppression de la zone — rechargement", "error");
        reloadZones();
      });
  };

  // ── Free text labels ──────────────────────────────────────────────────────
  const [canvasLabels, setCanvasLabels] = useState<CanvasLabel[]>(initialLabels);
  // Re-sync sur refetch SSE cross-client.
  useEffect(() => {
    setCanvasLabels(initialLabels);
  }, [initialLabels]);

  // Load labels from API on mount (client-side) — more reliable than SSR initialLabels
  useEffect(() => {
    fetch(`/api/racks/${rackId}/labels`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CanvasLabel[]) => {
        if (Array.isArray(data) && data.length > 0) setCanvasLabels(data);
      })
      .catch(() => {});
     
  }, [rackId]);
  const [drawingLabel, setDrawingLabel] = useState<{
    sx: number;
    sy: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const drawingLabelRef = useRef(drawingLabel);
  drawingLabelRef.current = drawingLabel;
  // Inline label editor — click in label tool → input at click position, live binding on sub-bar
  const [inlineLabel, setInlineLabel] = useState<{ x: number; y: number; text: string } | null>(
    null,
  );
  const inlineLabelRef = useRef(inlineLabel);
  inlineLabelRef.current = inlineLabel;
  const inlineLabelInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (tool !== "label" && inlineLabel) setInlineLabel(null);
    if (tool !== "zone" && drawingZone) setDrawingZone(null);
  }, [tool, inlineLabel, drawingZone]);
  // Label modal — create or edit
  const [labelEditing, setLabelEditing] = useState<
    { mode: "create"; draft: CanvasLabel } | { mode: "edit"; labelId: string } | null
  >(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);

  // ── Dialog "choisir le type de câble" — s'ouvre après la pose (second clic)
  // d'un câble dans le synoptique. Le câble est déjà créé en DB ; le dialog
  // assigne juste le `catalogCableModelId`. `lastCableModelId` mémorise le
  // dernier choix pour pré-sélectionner au prochain tracé (workflow batch).
  const [pendingCableModelDialog, setPendingCableModelDialog] = useState<
    {
      connIds: string[];
      signalName: string | null;
      /** Nom du connecteur côté `from` du dernier câble posé — sert à
       *  filtrer les cordons compatibles dans le dialog (insensible au sens). */
      fromConnectorName: string | null;
      /** Nom du connecteur côté `to`. */
      toConnectorName: string | null;
      /** Genre du connecteur côté `from` (MALE/FEMALE/NEUTRAL). */
      fromGender: string | null;
      /** Genre du connecteur côté `to`. */
      toGender: string | null;
      /** Couleur signal (depuis le store synoptique). */
      signalColor: string | null;
      /** Catégorie/fonction signal (depuis le store). */
      signalCategory: string | null;
    } | null
  >(null);
  const [lastCableModelId, setLastCableModelId] = useState<string | null>(null);

  const createLabelApi = async (lbl: CanvasLabel) => {
    try {
      const res = await apiFetch(`/api/racks/${rackId}/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: lbl.text,
          x: lbl.x,
          y: lbl.y,
          fontSize: lbl.fontSize,
          color: lbl.color,
          fontWeight: lbl.fontWeight,
          fontFamily: lbl.fontFamily,
          fontStyle: lbl.fontStyle,
          textDecoration: lbl.textDecoration,
          pill: lbl.pill,
          pillBg: lbl.pillBg,
          pillRadius: lbl.pillRadius,
        }),
      });
      if (!res.ok) {
        console.error("createLabel failed", res.status);
        return;
      }
      const created = await res.json();
      setCanvasLabels((prev) => {
        const withoutTemp = prev.filter((l) => l.id !== lbl.id);
        if (withoutTemp.some((l) => l.id === created.id)) return withoutTemp;
        return [...withoutTemp, { ...lbl, id: created.id }];
      });
    } catch (err) {
      console.error("createLabel error", err);
    }
  };
  const reloadLabels = useCallback(() => {
    fetch(`/api/racks/${rackId}/labels`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CanvasLabel[] | null) => {
        if (Array.isArray(data)) setCanvasLabels(data);
      })
      .catch(() => {});
  }, [rackId]);
  const updateLabelApi = (lbl: CanvasLabel) => {
    apiFetch(`/api/racks/${rackId}/labels/${lbl.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: lbl.text,
        x: lbl.x,
        y: lbl.y,
        fontSize: lbl.fontSize,
        color: lbl.color,
        fontWeight: lbl.fontWeight,
        fontFamily: lbl.fontFamily,
        fontStyle: lbl.fontStyle,
        textDecoration: lbl.textDecoration,
        pill: lbl.pill,
        pillBg: lbl.pillBg,
        pillRadius: lbl.pillRadius,
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      })
      .catch(() => {
        pushToast("Échec mise à jour du label — rechargement", "error");
        reloadLabels();
      });
  };
  const deleteLabelApi = (labelId: string) => {
    apiFetch(`/api/racks/${rackId}/labels/${labelId}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
      })
      .catch(() => {
        pushToast("Échec suppression du label — rechargement", "error");
        reloadLabels();
      });
  };

  // ── External ports API helpers ──────────────────────────────────────────────
  // En mode général : pas d'external ports (les ports externes des racks sont
  // déjà projetés directement dans les slots synthétiques par GeneralCanvas).
  // En mode lieu : les marqueurs viennent de PLUSIEURS contenants — un GET
  // rack-scoped écraserait la liste agrégée. Le rafraîchissement est assuré
  // par le refetch du payload lieu (SSE côté tab-client).
  const reloadExternalPorts = useCallback(() => {
    if (isAggregate) return;
    fetch(`/api/racks/${rackId}/external-ports`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ExternalPortData[] | null) => {
        if (Array.isArray(data)) setExternalPorts(data);
      })
      .catch(() => {});
  }, [rackId, isAggregate]);
  const updateExternalPortApi = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<
          ExternalPortData,
          "labelX" | "labelY" | "label" | "slotId" | "portIndex" | "kind"
        >
      >,
      /** Rollback local explicite — indispensable en vue agrégée où le
       *  rechargement rack-scoped est inopérant. */
      onError?: () => void,
    ) => {
      apiFetch(`/api/racks/${rackForExternalPortRef.current(id, patch.slotId)}/external-ports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
        })
        .catch(() => {
          pushToast("Échec mise à jour du marqueur externe", "error");
          onError?.();
          reloadExternalPorts();
        });
    },
    [rackId, reloadExternalPorts],
  );
  const deleteExternalPortApi = useCallback(
    (id: string) => {
      apiFetch(`/api/racks/${rackForExternalPortRef.current(id)}/external-ports/${id}`, {
        method: "DELETE",
      })
        .then((r) => {
          if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
        })
        .catch(() => {
          pushToast("Échec suppression du marqueur externe — rechargement", "error");
          reloadExternalPorts();
        });
    },
    [rackId, reloadExternalPorts],
  );

  // ── Renumber modal ────────────────────────────────────────────────────────
  const [showRenumberModal, setShowRenumberModal] = useState(false);
  // Equipment order for numbering (non-panel slots with connections)
  const [renumberOnlyUnlabelled, setRenumberOnlyUnlabelled] = useState(true);

  // ── Clear labels confirm modal ─────────────────────────────────────────────
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showNoCableInfo, setShowNoCableInfo] = useState(false);

  // ── Manual numbering modal ─────────────────────────────────────────────────
  const [showManualNumberModal, setShowManualNumberModal] = useState(false);
  const manualNumberIdsRef = useRef<string[]>([]);
  const [manualNumberIds, setManualNumberIds] = useState<string[]>([]);
  const [manualScopeNodeId, setManualScopeNodeId] = useState<string | null>(null);
  const manualScopeNodeIdRef = useRef<string | null>(null);

  // Confirm decable modal ─────────────────────────────────────────────────
  const [showDecableModal, setShowDecableModal] = useState(false);

  // ── PDF export ─────────────────────────────────────────────────────────────
  const [showPdfModal, setShowPdfModal] = useState(false);
  const exportSynopticPDFRef = useRef<((opts?: SynopticPdfExportOpts) => Promise<SynopticExportResult>) | null>(
    null,
  );
  /** Renseigné plus bas — déclaré ici pour rester accessible au handle. */
  const buildExportCloneRef = useRef<
    ((opts?: SynopticExportCloneOpts) => SynopticExportClone | null) | null
  >(null);

  // Ref holding latest implementations for imperative handle methods defined later in the component
  const imperativeActionsRef = useRef({
    startManualNumberForCable: (_connId: string) => {},
    clearCableLabel: async (_connId: string) => {},
    deleteCable: async (_connId: string) => {},
    startManualNumberForCables: (_ids: string[]) => {},
    clearCableLabelsForIds: async (_ids: string[]) => {},
    deleteCablesForIds: async (_ids: string[]) => {},
  });
  useImperativeHandle(
    ref,
    () => ({
      openPdfModal: () => setShowPdfModal(true),
      openRenumberModal: () => setShowRenumberModal(true),
      openManualNumberModal: () => setShowManualNumberModal(true),
      openAdapterPicker: () => {
        setAdapterPickerCtx(null);
        setAdapterPickerOpen(true);
      },
      insertAdapterAtPort: async (adapterId, port) => {
        if (!port.side) return;
        const portCenter = getPortCenterRef.current?.(port.slotId, port.portIndex);
        const ADAPTER_W = 130;
        const FIRST_PORT_Y = 14 + 4 + 28 / 2;
        const px = port.side === "right" ? (portCenter?.x ?? 0) : (portCenter?.x ?? 0) - ADAPTER_W;
        const py = (portCenter?.y ?? 0) - FIRST_PORT_Y;
        try {
          const res = await apiFetch(`/api/racks/${rackForRef.current(port.slotId)}/adapters`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              adapterId,
              x: px,
              y: py,
              attachedSlotId: port.slotId,
              attachedSide: port.side,
              attachedPortIndex: port.portIndex,
            }),
          });
          if (res.ok) {
            const created = (await res.json()) as SynopticAdapterInstance;
            pushHistoryRef.current?.();
            setAdapters((prev) =>
              prev.some((a) => a.id === created.id) ? prev : [...prev, created],
            );
          }
        } catch {
          // silent
        }
      },
      clearAllLabels: () => setShowClearConfirm(true),
      clearAllCables: () => setShowDecableModal(true),
      exportPdf: async (opts) => {
        const run = exportSynopticPDFRef.current;
        if (!run) throw new Error("Canvas synoptique indisponible.");
        return run(opts);
      },
      buildExportClone: (opts) =>
        buildExportCloneRef.current?.(opts) ?? null,
      closePdfModal: () => setShowPdfModal(false),
      closeRenumberPanel: () => setShowRenumberModal(false),
      closeManualPanel: () => setShowManualNumberModal(false),
      deleteAdapter: (id: string) => {
        if (lockedLayerIdsRef.current.has(id)) return;
        void handleAdapterDelete(id);
      },
      updateAdapterLabel: (id: string, label: string | null) => {
        const targetRackId = rackForAdapterRef.current(id);
        setAdapters((prev) => prev.map((a) => (a.id === id ? { ...a, label } : a)));
        void apiFetch(`/api/racks/${targetRackId}/adapters/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        });
      },
      updateZone: (id, patch) => {
        if (lockedLayerIdsRef.current.has(id)) return;
        pushHistoryRef.current?.();
        setZones((prev) => {
          const next = prev.map((z) => (z.id === id ? { ...z, ...patch } : z));
          const updated = next.find((z) => z.id === id);
          if (updated) updateZoneApi(updated);
          return next;
        });
      },
      deleteZone: (id) => {
        if (lockedLayerIdsRef.current.has(id)) return;
        pushHistoryRef.current?.();
        setSelectedZoneId(null);
        deleteZoneApi(id);
        setZones((prev) => prev.filter((z) => z.id !== id));
      },
      openEditZoneModal: (_id) => {
        // No-op : édition via le panneau de propriétés droit uniquement.
      },
      updateLabel: (id, patch) => {
        if (lockedLayerIdsRef.current.has(id)) return;
        pushHistoryRef.current?.();
        setCanvasLabels((prev) => {
          const next = prev.map((l) => (l.id === id ? { ...l, ...patch } : l));
          const updated = next.find((l) => l.id === id);
          if (updated) updateLabelApi(updated);
          return next;
        });
      },
      deleteLabel: (id) => {
        if (lockedLayerIdsRef.current.has(id)) return;
        pushHistoryRef.current?.();
        setSelectedLabelId(null);
        deleteLabelApi(id);
        setCanvasLabels((prev) => prev.filter((l) => l.id !== id));
      },
      openEditLabelModal: (id) => {
        setLabelEditing({ mode: "edit", labelId: id });
      },
      startManualNumberForCable: (connId: string) => {
        imperativeActionsRef.current.startManualNumberForCable(connId);
      },
      clearCableLabel: async (connId: string) => {
        await imperativeActionsRef.current.clearCableLabel(connId);
      },
      deleteCable: async (connId: string) => {
        await imperativeActionsRef.current.deleteCable(connId);
      },
      startManualNumberForCables: (ids: string[]) => {
        imperativeActionsRef.current.startManualNumberForCables(ids);
      },
      clearCableLabelsForIds: async (ids: string[]) => {
        await imperativeActionsRef.current.clearCableLabelsForIds(ids);
      },
      deleteCablesForIds: async (ids: string[]) => {
        await imperativeActionsRef.current.deleteCablesForIds(ids);
      },
      setZoomVariant: (v) => {
        zoomVariantRef.current = v;
      },
      setActiveTool: (toolId: string) => {
        if ((VALID_TOOLS as readonly string[]).includes(toolId)) {
          setToolRef.current(toolId as (typeof VALID_TOOLS)[number]);
        }
      },
      getActiveTool: () => toolRef.current,
      setConnectionStyle: (ids, style) => {
        pushHistoryRef.current?.();
        setConnStyles((prev) => {
          const next = new Map(prev);
          ids.forEach((id) => next.set(id, style));
          return next;
        });
        for (const id of ids) {
          cabling.patchOne(id, { cableStyle: style }).catch(console.error);
        }
      },
      setConnectionNotes: (id, notes) => {
        setConnections((prev) =>
          prev.map((c) => (c.id === id ? ({ ...c, notes } as typeof c) : c)),
        );
        cabling.patchOne(id, { notes }).catch(console.error);
      },
      setConnectionTags: (id, tags) => {
        setConnections((prev) => prev.map((c) => (c.id === id ? ({ ...c, tags } as typeof c) : c)));
        cabling.patchOne(id, { tags }).catch(console.error);
      },
      setConnectionCableModel: (id, cableModelId) => {
        setConnections((prev) =>
          prev.map((c) =>
            c.id === id ? ({ ...c, catalogCableModelId: cableModelId } as typeof c) : c,
          ),
        );
        cabling.patchOne(id, { catalogCableModelId: cableModelId }).catch(console.error);
      },
      setExternalLabel: (id, label) => {
        // Le handle est créé une seule fois (deps []) → lire la liste via le
        // ref, sinon on capture l'état du premier rendu (les marqueurs créés
        // ensuite seraient introuvables).
        const target = externalPortsRef.current.find((e) => e.id === id);
        if (!target) return;
        // Optimistic + PATCH (slotId/portIndex requis dans le payload).
        const previousLabel = target.label ?? null;
        setExternalPorts((prev) =>
          prev.map((e) => (e.id === id ? { ...e, label } : e)),
        );
        updateExternalPortApi(
          id,
          {
            slotId: target.slotId,
            portIndex: target.portIndex,
            labelX: target.labelX,
            labelY: target.labelY,
            label,
          },
          () =>
            setExternalPorts((prev) =>
              prev.map((e) => (e.id === id ? { ...e, label: previousLabel } : e)),
            ),
        );
      },
      setExternalKind: (id, kind) => {
        const target = externalPortsRef.current.find((e) => e.id === id);
        if (!target) return;
        const previousKind = externalPortKind(target);
        if (previousKind === kind) return;
        // Optimiste + rollback explicite si le PATCH échoue.
        setExternalPorts((prev) =>
          prev.map((e) => (e.id === id ? { ...e, kind } : e)),
        );
        updateExternalPortApi(
          id,
          {
            slotId: target.slotId,
            portIndex: target.portIndex,
            labelX: target.labelX,
            labelY: target.labelY,
            kind,
          },
          () =>
            setExternalPorts((prev) =>
              prev.map((e) => (e.id === id ? { ...e, kind: previousKind } : e)),
            ),
        );
      },
      deleteExternalPort: (id) => {
        setExternalPorts((prev) => prev.filter((e) => e.id !== id));
        if (selectedExternalId === id) setSelectedExternalId(null);
        setSelectedExternalIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        deleteExternalPortApi(id);
      },
      deleteExternalPortsForIds: (ids) => {
        const idSet = new Set(ids);
        setExternalPorts((prev) => prev.filter((e) => !idSet.has(e.id)));
        if (selectedExternalId && idSet.has(selectedExternalId)) {
          setSelectedExternalId(null);
        }
        setSelectedExternalIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
        for (const id of ids) deleteExternalPortApi(id);
      },
      setCableStyle: (v) => setCableStyle(v),
      setCableCount: (v) => setCableCount(v),
      setCableMode: (v) => setCableMode(v),
      setLabelFont: (v) => setLabelFont(v),
      setLabelFontSize: (v) => setLabelFontSize(v),
      setLabelColor: (v) => setLabelColor(v),
      setZoneColor: (v) => setZoneColor(v),
      zoomIn: () => handleZoomIn(),
      zoomOut: () => handleZoomOut(),
      zoomFit: () => fitAllRef.current?.(),
      zoomReset: () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        viewRef.current = { pan: { x: 0, y: 0 }, zoom: 1 };
      },
      zoomCenter: () => handleCenterRef.current?.(),
      getZoom: () => viewRef.current.zoom,
    }),
    [],
  );
  const [pdfFormat, setPdfFormat] = useState<"A0" | "A1" | "A2" | "A3" | "A4">("A1");
  const [pdfRevision, setPdfRevision] = useState("A");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [cableCount, setCableCount] = useState<"single" | "multi">(
    () => useTopbarActions.getState().cableCount,
  );
  const [cableMode, setCableMode] = useState<"auto" | "multipoint">(
    () => useTopbarActions.getState().cableMode,
  );
  // Multi-cable: phase 1 = manual source selection, phase 2 = pick destination
  const [multiSrcPorts, setMultiSrcPorts] = useState<{
    slotId: string;
    portIndices: number[];
  } | null>(null);
  const [multiSrcConfirmed, setMultiSrcConfirmed] = useState(false);
  const multiSrcPortsRef = useRef(multiSrcPorts);
  multiSrcPortsRef.current = multiSrcPorts;
  const multiSrcConfirmedRef = useRef(multiSrcConfirmed);
  multiSrcConfirmedRef.current = multiSrcConfirmed;
  // Tooltip near mouse when dst has partial compatibility
  const [multiHoverTooltip, setMultiHoverTooltip] = useState<{
    screenX: number;
    screenY: number;
    lines: string[];
  } | null>(null);
  const [toasts, setToasts] = useState<
    { id: number; lines: string[]; type: "warn" | "error" | "info" | "success" }[]
  >([]);
  const toastIdRef = useRef(0);
  const pushToast = useCallback(
    (
      lines: string | string[],
      type: "warn" | "error" | "info" | "success" = "warn",
      duration = 4000,
    ) => {
      const id = ++toastIdRef.current;
      const arr = Array.isArray(lines) ? lines : [lines];
      setToasts((prev) => [...prev, { id, lines: arr, type }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
    },
    [],
  );
  // cable* preferences — hydrated from persisted topbar store on mount, writes come via imperative handle.
  const [cableStyle, setCableStyle] = useState<"ortho" | "rounded" | "arrow">(
    () => useTopbarActions.getState().cableStyle,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Multi-sélection nodes (équipements/panels/accessoires) — alimenté par
  // rubber-band et Shift/Cmd+click. Convention : `selectedNodeId` reste le
  // focus du panneau de propriétés (dernier cliqué) ; `selectedNodeIds`
  // contient l'ensemble complet (peut être vide si rien sélectionné, sinon
  // contient au minimum selectedNodeId). Drag d'un node du set → drag de tout
  // le set avec le même delta.
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [selectedConnIds, setSelectedConnIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!onSelectionChange) return;
    const ids: string[] = [];
    if (selectedConnIds && selectedConnIds.size > 0) {
      selectedConnIds.forEach((id) => ids.push(id));
    } else if (selectedConnId) {
      ids.push(selectedConnId);
    }
    onSelectionChange(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConnId, selectedConnIds]);
  const [selectedExternalId, setSelectedExternalId] = useState<string | null>(null);
  const [selectedExternalIds, setSelectedExternalIds] = useState<Set<string>>(new Set());
  // Helper pour sélectionner un élément et clear tous les autres — mutuellement exclusif
  const selectOnly = useCallback(
    (kind: "node" | "conn" | "adapter" | "zone" | "label" | "external", id: string | null) => {
      setSelectedNodeId(kind === "node" ? id : null);
      setSelectedNodeIds(kind === "node" ? new Set(id ? [id] : []) : new Set());
      setSelectedConnId(kind === "conn" ? id : null);
      setSelectedConnIds(kind === "conn" ? new Set(id ? [id] : []) : new Set());
      setSelectedAdapterId(kind === "adapter" ? id : null);
      setSelectedZoneId(kind === "zone" ? id : null);
      setSelectedZoneIds(kind === "zone" ? new Set(id ? [id] : []) : new Set());
      setSelectedLabelId(kind === "label" ? id : null);
      setSelectedLabelIds(kind === "label" ? new Set(id ? [id] : []) : new Set());
      setSelectedExternalId(kind === "external" ? id : null);
      setSelectedExternalIds(
        kind === "external" ? new Set(id ? [id] : []) : new Set(),
      );
    },
    [],
  );

  const [previewConnIds, setPreviewConnIds] = useState<Set<string>>(new Set());
  const [previewExternalIds, setPreviewExternalIds] = useState<Set<string>>(
    new Set(),
  );
  const [previewZoneIds, setPreviewZoneIds] = useState<Set<string>>(new Set());
  const [previewLabelIds, setPreviewLabelIds] = useState<Set<string>>(new Set());
  // Preview multi-sélection nodes : alimenté pendant le rubber-band, vidé au
  // commit. Affiche un ring subtil sur les équipements survolés.
  const [previewNodeIds, setPreviewNodeIds] = useState<Set<string>>(new Set());
  const [incompatTooltip, setIncompatTooltip] = useState<{
    msg: string;
    x: number;
    y: number;
  } | null>(null);
  const [rubberBand, setRubberBand] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [drawingFrom, setDrawingFrom] = useState<{ slotId: string; portIndex: number } | null>(
    null,
  );
  const [drawingWaypoints, setDrawingWaypoints] = useState<{ x: number; y: number }[]>([]);
  const [drawingDirection, setDrawingDirection] = useState<"H" | "V">("H");
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const mousePosRef = useRef(mousePos);
  mousePosRef.current = mousePos;
  const [snapTarget, setSnapTarget] = useState<{ slotId: string; portIndex: number } | null>(null);
  /** Neutralise le prochain onPortClick React : le geste a été traité comme un
   *  DRAG par les listeners natifs (cf. onMove/onUp), le click de fin de geste
   *  ne doit pas relancer un tracé. Uniquement armé sur le chemin drag — le
   *  clic-clic passe intégralement par le handler React du port. */
  const suppressPortClickRef = useRef(false);
  const handlePortClickRef = useRef<((slotId: string, portIndex: number) => void) | null>(null);
  /** Geste souris en cours avec l'outil câble : origine écran, port sous le
   *  point de départ, et bascule « ce geste est un drag » (au-delà du seuil).
   *  Sert à distinguer clic-clic (rien ici, tout via React) et drag port→port. */
  const cableDownRef = useRef<{
    x: number;
    y: number;
    hit: { slotId: string; portIndex: number } | null;
    dragging: boolean;
  } | null>(null);
  // ── Endpoint drag (move tool) — drag an existing connection endpoint onto a new port ──
  // side = "from" | "to" : l'autre extrémité reste fixe. originalSlotId/PortIndex permettent
  // l'annulation silencieuse si drop hors port valide. cursor = position canvas live pour preview.
  const [endpointDrag, setEndpointDrag] = useState<{
    connId: string;
    side: "from" | "to";
    originalSlotId: string;
    originalPortIndex: number;
    cursor: { x: number; y: number } | null;
    snap: { slotId: string; portIndex: number } | null;
    snapIncompat: boolean;
    snapIncompatMsg: string | null;
  } | null>(null);
  const endpointDragRef = useRef<typeof endpointDrag>(null);
  endpointDragRef.current = endpointDrag;
  // Persisted waypoints per connection id — initialised from DB (initialConnections.waypoints)
  const [connWaypoints, setConnWaypoints] = useState<Map<string, { x: number; y: number }[]>>(
    () => {
      const map = new Map<string, { x: number; y: number }[]>();
      for (const conn of initialConnections) {
        if (Array.isArray(conn.waypoints)) {
          map.set(conn.id, conn.waypoints as { x: number; y: number }[]);
        }
      }
      return map;
    },
  );
  // Per-cable style — initialised from DB (initialConnections.cableStyle)
  const [connStyles, setConnStyles] = useState<Map<string, "ortho" | "rounded" | "arrow">>(() => {
    const map = new Map<string, "ortho" | "rounded" | "arrow">();
    for (const conn of initialConnections) {
      if (
        conn.cableStyle === "ortho" ||
        conn.cableStyle === "rounded" ||
        conn.cableStyle === "arrow"
      ) {
        map.set(conn.id, conn.cableStyle);
      }
    }
    return map;
  });
  const connStylesRef = useRef(connStyles);
  connStylesRef.current = connStyles;
  // No-op — styles are now persisted to DB via PATCH on each connection
  const saveConnStyles = (_next: Map<string, "ortho" | "rounded" | "arrow">) => {};

  // Pan / zoom — restored from localStorage after mount to avoid SSR hydration mismatch
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [miniMapVisible, setMiniMapVisible] = useState<boolean>(false);
  const miniMapHydratedRef = useRef(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem(`synoptic-minimap-${viewKeyBase}`);
      if (v !== null) setMiniMapVisible(v !== "hidden");
    } catch {}
    miniMapHydratedRef.current = true;
  }, [viewKeyBase]);
  useEffect(() => {
    if (!miniMapHydratedRef.current) return;
    try {
      localStorage.setItem(
        `synoptic-minimap-${viewKeyBase}`,
        miniMapVisible ? "visible" : "hidden",
      );
    } catch {}
  }, [miniMapVisible, viewKeyBase]);
  const setMiniMap = useTopbarActions((s) => s.setMiniMap);
  // Grid / snap / rulers — état réactif depuis le store
  const gridEnabled = useTopbarActions((s) => s.gridEnabled);
  const gridStep = useTopbarActions((s) => s.gridStep);
  const rulersEnabled = useTopbarActions((s) => s.rulersEnabled);
  const gridMajorEvery = useTopbarActions((s) => s.gridMajorEvery);
  const gridColor = useTopbarActions((s) => s.gridColor);
  const gridOpacity = useTopbarActions((s) => s.gridOpacity);
  const rulerColor = useTopbarActions((s) => s.rulerColor);
  const guidesVisible = useTopbarActions((s) => s.guidesVisible);
  // Calques — ids cachés / verrouillés (source unique : store zustand)
  const hiddenLayerIds = useTopbarActions((s) => s.hiddenLayerIds);
  const lockedLayerIds = useTopbarActions((s) => s.lockedLayerIds);
  const hiddenLayerIdsRef = useRef(hiddenLayerIds);
  hiddenLayerIdsRef.current = hiddenLayerIds;
  const lockedLayerIdsRef = useRef(lockedLayerIds);
  lockedLayerIdsRef.current = lockedLayerIds;
  // Résout si un slotId (réel, virtuel panel, ou adapter virtual) correspond à un calque masqué/verrouillé
  const isSlotHidden = useCallback(
    (slotId: string): boolean => {
      if (hiddenLayerIds.has(slotId)) return true;
      const info = getVirtualRowInfo(slotId);
      if (info && hiddenLayerIds.has(info.slotId)) return true;
      const ad = parseAdapterSlotId(slotId);
      if (ad && hiddenLayerIds.has(ad.adapterId)) return true;
      return false;
    },
    [hiddenLayerIds],
  );
  const isSlotLocked = useCallback(
    (slotId: string): boolean => {
      if (lockedLayerIds.has(slotId)) return true;
      const info = getVirtualRowInfo(slotId);
      if (info && lockedLayerIds.has(info.slotId)) return true;
      const ad = parseAdapterSlotId(slotId);
      if (ad && lockedLayerIds.has(ad.adapterId)) return true;
      return false;
    },
    [lockedLayerIds],
  );
  const isSlotLockedRef = useRef(isSlotLocked);
  isSlotLockedRef.current = isSlotLocked;
  // Taille container pour dimensionner les règles
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        // ARRONDI à l'entier, puis comparaison PAR VALEUR.
        //
        // Sans ces deux gardes, le rappel posait un objet NEUF à chaque
        // notification : re-rendu garanti, donc re-mise en page, donc nouvelle
        // notification. Tant que la boîte est imposée de l'extérieur (le shell
        // de l'onglet), l'observateur ne tire qu'une fois et rien ne se voit ;
        // mais que la hauteur devienne dépendante du CONTENU — un montage dans
        // un parent qui n'est pas un conteneur flex, et `flex-1` ne s'applique
        // plus — et la boucle s'installe : quelques dizaines de rendus par
        // seconde d'un composant qui en compte des milliers, le fil principal
        // saturé, les requêtes réseau qui n'arrivent plus jamais au JS.
        //
        // Le garde est ici et pas chez l'appelant : c'est une propriété que ce
        // composant doit tenir lui-même, quelle que soit la boîte qu'on lui
        // donne.
        const w = Math.round(e.contentRect.width);
        const h = Math.round(e.contentRect.height);
        setContainerSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Guides (repères) — par rack, persistés localStorage
  type Guide = { pos: number; color?: string };
  const [guides, setGuides] = useState<{ v: Guide[]; h: Guide[] }>({ v: [], h: [] });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`synoptic-guides-${viewKeyBase}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.v) || !Array.isArray(parsed.h)) return;
      // Migration : ancien format number[] → { pos }[]
      const normalize = (arr: unknown[]): Guide[] =>
        arr
          .map((item) => {
            if (typeof item === "number") return { pos: item };
            if (item && typeof item === "object" && typeof (item as Guide).pos === "number") {
              const g = item as Guide;
              return g.color ? { pos: g.pos, color: g.color } : { pos: g.pos };
            }
            return null;
          })
          .filter((g): g is Guide => g !== null);
      setGuides({ v: normalize(parsed.v), h: normalize(parsed.h) });
    } catch {}
  }, [viewKeyBase]);
  const persistGuides = useCallback(
    (g: { v: Guide[]; h: Guide[] }) => {
      try {
        localStorage.setItem(`synoptic-guides-${viewKeyBase}`, JSON.stringify(g));
      } catch {}
    },
    [viewKeyBase],
  );
  const [draggingGuide, setDraggingGuide] = useState<{
    orientation: "h" | "v";
    pos: number;
    existingIndex: number | null;
  } | null>(null);
  // Multi-sélection : clés de la forme "v-0" | "h-2"
  const [selectedGuideKeys, setSelectedGuideKeys] = useState<Set<string>>(new Set());
  const guideKey = (orientation: "h" | "v", index: number) => `${orientation}-${index}`;
  const selectedGuideKeysRef = useRef(selectedGuideKeys);
  selectedGuideKeysRef.current = selectedGuideKeys;
  const guidesRef = useRef(guides);
  guidesRef.current = guides;
  const deleteSelectedGuide = useCallback(() => {
    const keys = selectedGuideKeysRef.current;
    if (keys.size === 0) return;
    const vIdx = new Set<number>();
    const hIdx = new Set<number>();
    keys.forEach((k) => {
      const [o, i] = k.split("-");
      const n = parseInt(i, 10);
      if (!Number.isFinite(n)) return;
      if (o === "v") vIdx.add(n);
      else if (o === "h") hIdx.add(n);
    });
    setGuides((g) => {
      const next = {
        v: g.v.filter((_, i) => !vIdx.has(i)),
        h: g.h.filter((_, i) => !hIdx.has(i)),
      };
      persistGuides(next);
      return next;
    });
    setSelectedGuideKeys(new Set());
  }, [persistGuides]);
  // Publie count + clearAll + guide sélectionné (single) + delete dans le store topbar
  useEffect(() => {
    if (!publishToShell) return;
    // Si exactement un seul repère sélectionné, publier sa position. Sinon null.
    let sel: { orientation: "h" | "v"; index: number; pos: number } | null = null;
    if (selectedGuideKeys.size === 1) {
      const k = selectedGuideKeys.values().next().value as string;
      const [o, iStr] = k.split("-");
      const i = parseInt(iStr, 10);
      if ((o === "v" || o === "h") && Number.isFinite(i)) {
        const entry = (o === "h" ? guides.h : guides.v)[i];
        if (entry !== undefined) sel = { orientation: o, index: i, pos: entry.pos };
      }
    }
    // Couleur commune si tous les sélectionnés partagent la même valeur (sinon null)
    let sharedColor: string | null | undefined = undefined;
    selectedGuideKeys.forEach((k) => {
      const [o, iStr] = k.split("-");
      const i = parseInt(iStr, 10);
      const entry = o === "h" ? guides.h[i] : guides.v[i];
      if (!entry) return;
      const c = entry.color ?? null;
      if (sharedColor === undefined) sharedColor = c;
      else if (sharedColor !== c) sharedColor = null;
    });
    const applyColor = (color: string | null) => {
      setGuides((g) => {
        const cloneV = [...g.v];
        const cloneH = [...g.h];
        selectedGuideKeys.forEach((k) => {
          const [o, iStr] = k.split("-");
          const i = parseInt(iStr, 10);
          if (o === "h" && cloneH[i])
            cloneH[i] = color === null ? { pos: cloneH[i].pos } : { pos: cloneH[i].pos, color };
          else if (o === "v" && cloneV[i])
            cloneV[i] = color === null ? { pos: cloneV[i].pos } : { pos: cloneV[i].pos, color };
        });
        const next = { v: cloneV, h: cloneH };
        persistGuides(next);
        return next;
      });
    };
    useTopbarActions.getState().setSynopticGuidesHandlers({
      count: guides.v.length + guides.h.length,
      onClear: () => {
        setGuides({ v: [], h: [] });
        persistGuides({ v: [], h: [] });
        setSelectedGuideKeys(new Set());
      },
      selected: sel,
      selectedCount: selectedGuideKeys.size,
      selectedColor: sharedColor === undefined ? null : sharedColor,
      onDeleteSelected: deleteSelectedGuide,
      onSetSelectedColor: applyColor,
    });
    return () => {
      useTopbarActions.getState().setSynopticGuidesHandlers({
        count: 0,
        onClear: undefined,
        selected: null,
        onDeleteSelected: undefined,
      });
    };
  }, [guides, persistGuides, selectedGuideKeys, deleteSelectedGuide, publishToShell]);

  // Démarrer le drag d'un nouveau repère depuis une règle
  const handleGuideStart = useCallback(
    (orientation: "h" | "v", e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { pan: p, zoom: z } = viewRef.current;
      const cx = (e.clientX - rect.left - p.x) / z;
      const cy = (e.clientY - rect.top - p.y) / z;
      let lastPos = orientation === "h" ? cy : cx;
      setDraggingGuide({ orientation, pos: lastPos, existingIndex: null });
      const onMove = (ev: PointerEvent) => {
        const r2 = el.getBoundingClientRect();
        const { pan: p2, zoom: z2 } = viewRef.current;
        const cx2 = (ev.clientX - r2.left - p2.x) / z2;
        const cy2 = (ev.clientY - r2.top - p2.y) / z2;
        const raw = orientation === "h" ? cy2 : cx2;
        const snapS = useTopbarActions.getState();
        lastPos = snapS.snapEnabled ? snapCoord(raw, snapS.gridStep) : raw;
        setDraggingGuide({ orientation, pos: lastPos, existingIndex: null });
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        const r2 = el.getBoundingClientRect();
        const localX = ev.clientX - r2.left;
        const localY = ev.clientY - r2.top;
        const inCanvas = localX > 18 && localY > 18;
        setDraggingGuide(null);
        if (inCanvas) {
          const defaultColor = useTopbarActions.getState().guideDefaultColor;
          setGuides((g) => {
            const newGuide: Guide = defaultColor
              ? { pos: lastPos, color: defaultColor }
              : { pos: lastPos };
            const next =
              orientation === "h"
                ? { ...g, h: [...g.h, newGuide] }
                : { ...g, v: [...g.v, newGuide] };
            persistGuides(next);
            return next;
          });
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [persistGuides],
  );

  // Clic / drag sur un repère existant :
  //   - clic sans déplacement (< 3px) → sélection
  //   - clic + drag → déplacement (+ drop sur règle = suppression)
  const handleGuideDragStart = useCallback(
    (orientation: "h" | "v", index: number, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = containerRef.current;
      if (!el) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      const THRESHOLD = 3;
      const onPreMove = (ev: PointerEvent) => {
        const dx = Math.abs(ev.clientX - startX);
        const dy = Math.abs(ev.clientY - startY);
        if (dx < THRESHOLD && dy < THRESHOLD) return;
        // Bascule en mode drag
        window.removeEventListener("pointermove", onPreMove);
        window.removeEventListener("pointerup", onPreUp);
        dragging = true;
        beginDrag();
      };
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const onPreUp = () => {
        window.removeEventListener("pointermove", onPreMove);
        window.removeEventListener("pointerup", onPreUp);
        if (!dragging) {
          const key = guideKey(orientation, index);
          setSelectedGuideKeys((prev) => {
            if (additive) {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            }
            return new Set([key]);
          });
        }
      };
      window.addEventListener("pointermove", onPreMove);
      window.addEventListener("pointerup", onPreUp, { once: true });

      const beginDrag = () => {
        const currentGuide = orientation === "h" ? guides.h[index] : guides.v[index];
        let lastPos = currentGuide.pos;
        setDraggingGuide({ orientation, pos: lastPos, existingIndex: index });
        const onMove = (ev: PointerEvent) => {
          const r2 = el.getBoundingClientRect();
          const { pan: p2, zoom: z2 } = viewRef.current;
          const cx2 = (ev.clientX - r2.left - p2.x) / z2;
          const cy2 = (ev.clientY - r2.top - p2.y) / z2;
          const raw = orientation === "h" ? cy2 : cx2;
          const snapS = useTopbarActions.getState();
          lastPos = snapS.snapEnabled ? snapCoord(raw, snapS.gridStep) : raw;
          setDraggingGuide({ orientation, pos: lastPos, existingIndex: index });
        };
        const onUp = (ev: PointerEvent) => {
          window.removeEventListener("pointermove", onMove);
          const r2 = el.getBoundingClientRect();
          const localX = ev.clientX - r2.left;
          const localY = ev.clientY - r2.top;
          const inCanvas = localX > 18 && localY > 18;
          setDraggingGuide(null);
          setGuides((g) => {
            let next = g;
            if (inCanvas) {
              if (orientation === "h") {
                const h = [...g.h];
                h[index] = { ...h[index], pos: lastPos };
                next = { ...g, h };
              } else {
                const v = [...g.v];
                v[index] = { ...v[index], pos: lastPos };
                next = { ...g, v };
              }
            } else {
              if (orientation === "h") next = { ...g, h: g.h.filter((_, i) => i !== index) };
              else next = { ...g, v: g.v.filter((_, i) => i !== index) };
            }
            persistGuides(next);
            return next;
          });
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp, { once: true });
      };
    },
    [guides, persistGuides],
  );

  // Position curseur en canvas-space pour les indicateurs sur les règles
  const [cursorCanvas, setCursorCanvas] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !rulersEnabled) {
      setCursorCanvas(null);
      return;
    }
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const { pan: p, zoom: z } = viewRef.current;
      setCursorCanvas({
        x: (e.clientX - rect.left - p.x) / z,
        y: (e.clientY - rect.top - p.y) / z,
      });
    };
    const onLeave = () => setCursorCanvas(null);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [rulersEnabled]);
  useEffect(() => {
    if (!publishToShell) return;
    setMiniMap("synoptic", {
      visible: miniMapVisible,
      onToggle: () => setMiniMapVisible((v) => !v),
    });
    return () => setMiniMap("synoptic", { visible: false, onToggle: undefined });
  }, [miniMapVisible, setMiniMap, publishToShell]);
  // Bridge zoom value to shell topbar
  useEffect(() => {
    onZoomChange?.(zoom);
  }, [zoom, onZoomChange]);
  // Sync live zoom for adapter drag handler (déclaré plus haut, à update à chaque render)
  adapterLiveZoomRef.current = zoom;
  const viewInitializedRef = useRef(false);

  // ── Undo/Redo history (state local + sync DB en arrière-plan) ─────────────
  const history = useSynopticHistory(50);
  const [syncingUndo, setSyncingUndo] = useState(false);
  const captureSnapshot = useCallback(
    (): SynopticSnapshot => ({
      connections: JSON.parse(JSON.stringify(connections)),
      connWaypoints: Array.from(connWaypoints.entries()),
      connStyles: Array.from(connStyles.entries()),
      zones: JSON.parse(JSON.stringify(zones)),
      canvasLabels: JSON.parse(JSON.stringify(canvasLabels)),
      adapters: JSON.parse(JSON.stringify(adapters)),
      positions: Array.from(positions.entries()),
    }),
    [connections, connWaypoints, connStyles, zones, canvasLabels, adapters, positions],
  );
  // Câble le forward ref pour les callbacks déclarés tôt (adapters).
  pushHistoryRef.current = () => {
    history.push(captureSnapshot());
  };
  const restoreSnapshot = useCallback(
    (s: SynopticSnapshot, rollbackStacks?: () => void) => {
      // Capture l'état courant AVANT la mutation locale → servira au diff DB.
      const before = captureSnapshot();
      // 1. Restore state local immédiatement (feedback UI instantané)
      setConnections(s.connections as RackConnection[]);
      setConnWaypoints(new Map(s.connWaypoints as [string, { x: number; y: number }[]][]));
      setConnStyles(new Map(s.connStyles as [string, "ortho" | "rounded" | "arrow"][]));
      setZones(s.zones as Zone[]);
      setCanvasLabels(s.canvasLabels as CanvasLabel[]);
      setAdapters(s.adapters as SynopticAdapterInstance[]);
      setPositions(new Map(s.positions));
      // En mode général, le rackId est un identifiant logique (préfixé
       // `general:`) et la route `/api/racks/[rackId]/connections` n'est pas
       // applicable (FK violée → 500). L'undo/redo en mode général reste
       // local-only pour l'instant : pas de sync DB cross-table (chaque
       // mutateur du cabling adapter persiste déjà via /api/tenant/projects/
       // [id]/synoptic/connections). Le rollback DB n'est donc pas tenté.
       // Même verdict en vue lieu : le diff de snapshot est mono-rack (il
       // reconstruit des URLs `/api/racks/[rackId]/…` à partir du pivot) et ne
       // sait pas router par contenant → undo/redo local-only.
      if (isAggregate) {
        return;
      }
      // 2. Sync DB en arrière-plan. Si ça foire → toast + reload page.
      setSyncingUndo(true);
      const devirtConn = (c: Record<string, unknown>) => ({
        ...(c.id ? { id: c.id } : {}),
        ...devirtualizeEndpoint(
          c.fromSlotId as string,
          c.fromConnectorIndex as number,
          "from",
          activeSlots,
        ),
        ...devirtualizeEndpoint(
          c.toSlotId as string,
          c.toConnectorIndex as number,
          "to",
          activeSlots,
        ),
        label: (c.label as string | null | undefined) ?? null,
        color: (c.color as string | null | undefined) ?? null,
        waypoints: (c.waypoints as unknown) ?? null,
        cableStyle: (c.cableStyle as string | null | undefined) ?? null,
      });
      const syncOpts = {
        rackId,
        isVirtualId: isPanelVirtualId,
        getVirtualRowInfo: (id: string) => {
          const info = getVirtualRowInfo(id);
          return info ? { slotId: info.slotId, rowIdx: info.rowIdx } : null;
        },
        devirtualizeConnection: devirtConn,
      };
      void syncSnapshotToDb(before, s, syncOpts)
        .catch(async (err) => {
          console.error("[undo/redo] DB sync failed, rolling back", err);
          // 1. Rollback local : on remet l'état courant avant l'undo/redo pour que
          // le canvas reflète la réalité DB. On suspend l'historique pour éviter
          // de polluer les stacks avec le rollback lui-même.
          try {
            setConnections(before.connections as RackConnection[]);
            setConnWaypoints(
              new Map(before.connWaypoints as [string, { x: number; y: number }[]][]),
            );
            setConnStyles(new Map(before.connStyles as [string, "ortho" | "rounded" | "arrow"][]));
            setZones(before.zones as Zone[]);
            setCanvasLabels(before.canvasLabels as CanvasLabel[]);
            setAdapters(before.adapters as SynopticAdapterInstance[]);
            setPositions(new Map(before.positions));
          } catch {}
          // 2. Rollback DB : on tente de rejouer le diff inverse (target → before)
          // pour annuler les opérations partielles déjà appliquées.
          try {
            await syncSnapshotToDb(s, before, syncOpts);
            // Rollback des stacks : undo/redo est annulé → l'op reste disponible.
            rollbackStacks?.();
            pushToast(
              ["Undo annulé", "Impossible de synchroniser la DB — retour à l'état précédent"],
              "warn",
              4000,
            );
          } catch (rollbackErr) {
            console.error("[undo/redo] DB rollback also failed, reloading", rollbackErr);
            pushToast(["DB incohérente", "Rechargement de la page"], "error", 3000);
            setTimeout(() => window.location.reload(), 1500);
          }
        })
        .finally(() => setSyncingUndo(false));
    },
    [captureSnapshot, rackId, pushToast],
  );
  useEffect(() => {
    if (!publishToShell) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      )
        return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (syncingUndo) {
        e.preventDefault();
        return;
      }
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        history.undo(captureSnapshot, restoreSnapshot);
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        history.redo(captureSnapshot, restoreSnapshot);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, captureSnapshot, restoreSnapshot, syncingUndo, publishToShell]);

  // Publie les handlers undo/redo dans le store topbar
  useEffect(() => {
    if (!publishToShell) return;
    useTopbarActions.getState().setHistory("synoptic", {
      onUndo: () => {
        if (!syncingUndo) history.undo(captureSnapshot, restoreSnapshot);
      },
      onRedo: () => {
        if (!syncingUndo) history.redo(captureSnapshot, restoreSnapshot);
      },
      canUndo: history.canUndo && !syncingUndo,
      canRedo: history.canRedo && !syncingUndo,
    });
  }, [
    history.canUndo,
    history.canRedo,
    captureSnapshot,
    restoreSnapshot,
    syncingUndo,
    publishToShell,
  ]);

  // Nettoie au démontage
  useEffect(() => {
    if (!publishToShell) return;
    return () => {
      useTopbarActions.getState().setHistory("synoptic", { canUndo: false, canRedo: false });
    };
  }, [publishToShell]);

  // Pan/zoom persistés par rack dans localStorage — restaurés au montage (sinon fitAll)
  const viewStorageKey = `synoptic-view:${viewKeyBase}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(viewStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { pan?: { x: number; y: number }; zoom?: number };
      if (saved && saved.pan && typeof saved.zoom === "number" && isFinite(saved.zoom)) {
        setPan(saved.pan);
        setZoom(saved.zoom);
        viewInitializedRef.current = true; // inhibe l'auto-fit initial
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKeyBase]);
  // Sauvegarde (debounce) à chaque changement de pan/zoom
  useEffect(() => {
    if (!viewInitializedRef.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(viewStorageKey, JSON.stringify({ pan, zoom }));
      } catch {}
    }, 150);
    return () => clearTimeout(t);
  }, [pan, zoom, viewStorageKey]);

  // ── SSE — real-time updates from other clients ───────────────────────────────
  const sseRackIdsKey = (sseRackIds && sseRackIds.length > 0 ? sseRackIds : [rackId]).join(",");
  useEffect(() => {
    // Instance muette : aucun flux. Ce n'est pas seulement une économie de
    // connexions — une vue d'export est un INSTANTANÉ, et un rafraîchissement
    // en cours de capture ferait bouger le plan sous l'objectif.
    //
    // Le garde vit ICI et non sur `sseRackIds` : une liste vide retombe sur
    // `[rackId]` (repli des vues mono-contenant), passer `[]` n'aurait donc
    // rien coupé du tout.
    if (!publishToShell) return;
    // Mode général : pas de SSE rack-scoped (route 404 sur rackId logique).
    // En général, les updates inter-client se font via la SSE app globale
    // consommée par le tab-client (re-fetch payload général).
    if (isGeneralMode) return;
    // Vue lieu : un flux par contenant de l'emplacement. Le handler est déjà
    // adressé par id d'entité (connexion, zone, label, slot, adaptateur…) donc
    // il est partageable tel quel entre les flux.
    const watchedRackIds =
      sseRackIds && sseRackIds.length > 0 ? sseRackIds : [rackId];
    const sources = watchedRackIds.map((rid) => new EventSource(`/api/racks/${rid}/events`));
    const onMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data) as { type: string } & Record<string, unknown>;
        if (msg.type === "connection_added") {
          const conn = virtualizeConnection(msg.connection as DbConnection, activeSlots);
          setConnections((prev) => (prev.some((c) => c.id === conn.id) ? prev : [...prev, conn]));
          if (Array.isArray(conn.waypoints)) {
            const wpts = conn.waypoints as { x: number; y: number }[];
            setConnWaypoints((prev) => {
              if (prev.has(conn.id)) return prev;
              const next = new Map(prev);
              next.set(conn.id, wpts);
              return next;
            });
          }
          if (
            conn.cableStyle === "ortho" ||
            conn.cableStyle === "rounded" ||
            conn.cableStyle === "arrow"
          ) {
            setConnStyles((prev) => {
              if (prev.has(conn.id)) return prev;
              const next = new Map(prev);
              next.set(conn.id, conn.cableStyle as "ortho" | "rounded" | "arrow");
              return next;
            });
          }
        } else if (msg.type === "connection_updated") {
          const conn = virtualizeConnection(msg.connection as DbConnection, activeSlots);
          setConnections((prev) => prev.map((c) => (c.id === conn.id ? conn : c)));
          if (conn.waypoints !== undefined) {
            const wpts = Array.isArray(conn.waypoints)
              ? (conn.waypoints as { x: number; y: number }[])
              : [];
            setConnWaypoints((prev) => {
              const next = new Map(prev);
              next.set(conn.id, wpts);
              return next;
            });
          }
          if (
            conn.cableStyle === "ortho" ||
            conn.cableStyle === "rounded" ||
            conn.cableStyle === "arrow"
          ) {
            setConnStyles((prev) => {
              const next = new Map(prev);
              next.set(conn.id, conn.cableStyle as "ortho" | "rounded" | "arrow");
              return next;
            });
          } else if (conn.cableStyle === null) {
            setConnStyles((prev) => {
              const next = new Map(prev);
              next.delete(conn.id);
              return next;
            });
          }
        } else if (msg.type === "connection_removed") {
          const connId = msg.connId as string;
          setConnections((prev) => prev.filter((c) => c.id !== connId));
          setConnStyles((prev) => {
            const next = new Map(prev);
            next.delete(connId);
            return next;
          });
          setConnWaypoints((prev) => {
            const next = new Map(prev);
            next.delete(connId);
            return next;
          });
        } else if (msg.type === "label_added") {
          const l = msg.label as CanvasLabel;
          setCanvasLabels((prev) => (prev.some((x) => x.id === l.id) ? prev : [...prev, l]));
        } else if (msg.type === "label_updated") {
          const l = msg.label as CanvasLabel;
          setCanvasLabels((prev) => prev.map((x) => (x.id === l.id ? l : x)));
        } else if (msg.type === "label_removed") {
          const labelId = msg.labelId as string;
          setCanvasLabels((prev) => prev.filter((x) => x.id !== labelId));
        } else if (msg.type === "zone_added") {
          const z = msg.zone as DbZone;
          const norm = { ...z, labelPosition: (z.labelPosition as ZoneLabelPos) ?? "top-left" };
          setZones((prev) => (prev.some((z) => z.id === norm.id) ? prev : [...prev, norm]));
        } else if (msg.type === "zone_updated") {
          const z = msg.zone as DbZone;
          const norm = { ...z, labelPosition: (z.labelPosition as ZoneLabelPos) ?? "top-left" };
          setZones((prev) => prev.map((existing) => (existing.id === norm.id ? norm : existing)));
        } else if (msg.type === "zone_removed") {
          const zoneId = msg.zoneId as string;
          setZones((prev) => prev.filter((z) => z.id !== zoneId));
        } else if (msg.type === "panelrow_updated") {
          const { slotId, rowIndex, x, y } = msg as unknown as {
            slotId: string;
            rowIndex: number;
            x: number;
            y: number;
          };
          const virtualId = panelVirtualId(slotId, rowIndex);
          setPositions((prev) => {
            const cur = prev.get(virtualId);
            if (cur && cur.x === x && cur.y === y) return prev;
            const next = new Map(prev);
            next.set(virtualId, { x, y });
            return next;
          });
        } else if (msg.type === "slot_updated") {
          const slot = (
            msg as unknown as {
              slot: { id: string; synopticX: number | null; synopticY: number | null };
            }
          ).slot;
          if (slot && slot.synopticX != null && slot.synopticY != null) {
            setPositions((prev) => {
              const cur = prev.get(slot.id);
              if (cur && cur.x === slot.synopticX && cur.y === slot.synopticY) return prev;
              const next = new Map(prev);
              next.set(slot.id, { x: slot.synopticX!, y: slot.synopticY! });
              return next;
            });
          }
        } else if (msg.type === "adapter_added") {
          const ad = msg.adapter as SynopticAdapterInstance;
          setAdapters((prev) => (prev.some((a) => a.id === ad.id) ? prev : [...prev, ad]));
        } else if (msg.type === "adapter_updated") {
          const ad = msg.adapter as SynopticAdapterInstance;
          setAdapters((prev) => prev.map((a) => (a.id === ad.id ? ad : a)));
        } else if (msg.type === "adapter_removed") {
          const adapterId = msg.adapterId as string;
          setAdapters((prev) => prev.filter((a) => a.id !== adapterId));
        }
      } catch {}
    };
    for (const es of sources) es.onmessage = onMessage;
    return () => {
      for (const es of sources) es.close();
    };
    // `sseRackIdsKey` sérialise la liste : évite de rouvrir les flux à chaque
    // render sur une nouvelle référence de tableau.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackId, isGeneralMode, sseRackIdsKey, publishToShell]);

  // Single mutable ref holding BOTH current pan and zoom — always in sync
  const viewRef = useRef({ pan, zoom });
  viewRef.current = { pan, zoom }; // update every render (synchronous, no effect needed)
  adapterDragViewRef.current = viewRef.current;

  const panDragRef = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const rubberBandRef = useRef<{
    active: boolean;
    sx: number;
    sy: number;
    additive: boolean;
  } | null>(null);
  const commitRubberBandRef = useRef<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    additive: boolean;
  } | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const cableModeRef = useRef(cableMode);
  cableModeRef.current = cableMode;
  const cableStyleRef = useRef(cableStyle);
  cableStyleRef.current = cableStyle;
  const cableCountRef = useRef(cableCount);
  cableCountRef.current = cableCount;
  const drawingDirectionRef = useRef(drawingDirection);
  drawingDirectionRef.current = drawingDirection;
  const containerRef = useRef<HTMLDivElement>(null);
  const transformContentRef = useRef<HTMLDivElement>(null);
  // Bridge containerRef vers le handler de drag adapter (déclaré plus haut)
  adapterDragContainerRef.current = containerRef.current;

  // Diffuse la position curseur (coords MONDE) aux collaborateurs. Conversion
  // écran→monde via la même transformation que le reste du canvas :
  //   world = (screen - rect - pan) / zoom (via viewRef, toujours à jour).
  // Throttle 33 Hz intégré au hook.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const { pan: p, zoom: z } = viewRef.current;
      const wx = (e.clientX - rect.left - p.x) / (z || 1);
      const wy = (e.clientY - rect.top - p.y) / (z || 1);
      sendLiveCursorRef.current(wx, wy);
    };
    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, []);
  const getPortCenterRef = useRef<typeof getPortCenter | null>(null);
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections; // always current — avoids stale closures in async callbacks

  const segHandleDragRef = useRef<{
    connId: string;
    segIdx: number;
    isH: boolean;
    startClient: number;
    originalWaypoints: { x: number; y: number }[];
  } | null>(null);

  // ── Connector type lookup (réutilisé par adapters & slotPorts) ──────────────
  const connectorTypeMap = useMemo(
    () =>
      Object.fromEntries(connectorTypes.map((c) => [c.id, c])) as Record<
        string,
        { id: string; name?: string; color?: string | null }
      >,
    [connectorTypes],
  );

  // ── Ports per slot ──────────────────────────────────────────────────────────
  const slotPorts = useMemo(() => {
    const ctMap = Object.fromEntries(connectorTypes.map((c) => [c.id, c]));
    // Signal name → color map for fallback when connector type has no color or is unknown
    const sigColorMap = Object.fromEntries(signals.map((s) => [s.name, s.color]));

    // Enrich a ct with signal color fallback: if ct exists but color is missing/default,
    // or if ct is null, try to get color from the port's signalName
    const resolveCt = (
      ct: ConnectorTypeInfo | null,
      entry: ConnectorEntry,
    ): ConnectorTypeInfo | null => {
      // Signal color always takes priority over connector type color
      const sigCol = entry.signalName ? sigColorMap[entry.signalName] : undefined;
      if (!ct) {
        if (sigCol) return { id: "", name: "", iconId: "", color: sigCol, category: "" };
        return null;
      }
      if (sigCol) return { ...ct, color: sigCol };
      return ct;
    };

    const map = new Map<string, Port[]>();
    for (const slot of expandedSlots) {
      const ports: Port[] = [];

      if (slot.panel) {
        const occupiedSlots = slot.panel.slots
          .filter((ps) => ps.connectorTypeId != null)
          .sort((a, b) => a.position - b.position);
        for (let colIdx = 0; colIdx < occupiedSlots.length; colIdx++) {
          const ps = occupiedSlots[colIdx];
          const ctRaw = ps.connectorTypeId
            ? (ctMap[ps.connectorTypeId] ?? (ps.connectorType as ConnectorTypeInfo | null))
            : null;
          const eRight: ConnectorEntry = {
            face: "FRONT",
            connectorTypeId: ps.connectorTypeId ?? undefined,
            quantity: 1,
            direction: "BIDIR",
          };
          const eLeft: ConnectorEntry = {
            face: "REAR",
            connectorTypeId: ps.connectorTypeId ?? undefined,
            quantity: 1,
            direction: "BIDIR",
          };
          const ct = resolveCt(ctRaw, eRight);
          ports.push({
            portIndex: colIdx * 2,
            entryIndex: colIdx,
            unitIndex: 0,
            totalUnits: 1,
            entry: eRight,
            ct,
            side: "right",
          });
          ports.push({
            portIndex: colIdx * 2 + 1,
            entryIndex: colIdx,
            unitIndex: 0,
            totalUnits: 1,
            entry: eLeft,
            ct,
            side: "left",
          });
        }
      } else {
        const entries: ConnectorEntry[] = Array.isArray(slot.equipment?.connectors)
          ? (slot.equipment.connectors as ConnectorEntry[])
          : [];
        let flatIndex = 0;
        for (let ei = 0; ei < entries.length; ei++) {
          const e = entries[ei];
          const ctRaw = e.connectorTypeId ? (ctMap[e.connectorTypeId] ?? null) : null;
          const ct = resolveCt(ctRaw, e);
          const dir = e.direction?.toUpperCase();
          const side: "left" | "right" = dir === "IN" ? "left" : "right";
          const qty = e.quantity ?? 1;
          for (let u = 0; u < qty; u++) {
            ports.push({
              portIndex: flatIndex,
              entryIndex: ei,
              unitIndex: u,
              totalUnits: qty,
              entry: e,
              ct,
              side,
            });
            flatIndex++;
          }
        }

        // ── Ports des composants (châssis modulaire type openGear) ──────────
        // Rendus à la suite des ports de l'hôte, dans l'ordre slotIndex, avec
        // la MÊME convention d'éclatement par quantité. L'index global (portIndex)
        // continue le compteur de l'hôte — cohérence absolue avec `componentPortMap`.
        const comps = Array.isArray(slot.components) ? [...slot.components] : [];
        comps.sort((a, b) => a.slotIndex - b.slotIndex);
        let entryCursor = entries.length; // entryIndex global (dividers propres)
        for (const comp of comps) {
          const cEntries: ConnectorEntry[] = Array.isArray(comp.equipment?.connectors)
            ? (comp.equipment.connectors as ConnectorEntry[])
            : [];
          const n = comp.slotIndex + 1;
          const span = comp.slotSpan ?? 1;
          const compName = comp.equipment?.name ?? `Composant ${n}`;
          const groupLabel =
            span > 1
              ? `Slot ${n}–${n + span - 1} · ${compName}`
              : `Slot ${n} · ${compName}`;
          for (let ei = 0; ei < cEntries.length; ei++) {
            const e = cEntries[ei];
            const ctRaw = e.connectorTypeId ? (ctMap[e.connectorTypeId] ?? null) : null;
            const ct = resolveCt(ctRaw, e);
            const dir = e.direction?.toUpperCase();
            const side: "left" | "right" = dir === "IN" ? "left" : "right";
            const qty = e.quantity ?? 1;
            const entryWithGroup: ConnectorEntry = { ...e, groupLabel };
            for (let u = 0; u < qty; u++) {
              ports.push({
                portIndex: flatIndex,
                entryIndex: entryCursor,
                unitIndex: u,
                totalUnits: qty,
                entry: entryWithGroup,
                ct,
                side,
              });
              flatIndex++;
            }
            entryCursor++;
          }
        }
      }

      map.set(slot.id, ports);
    }
    return map;
  }, [expandedSlots, connectorTypes, signals]);

  // ── Publier les items de calque vers le store topbar ─────────────────────
  const layerItems = useMemo(() => {
    const sigByName = new Map((signals ?? []).map((s) => [s.name, s]));
    const items: import("@/components/editor-shell/topbar-actions-context").SynopticLayerItem[] = [];
    for (const slot of activeSlots) {
      if (slot.panel) {
        items.push({
          id: slot.id,
          kind: "panel",
          name: slot.label ?? slot.panel.name ?? `Panel ${slot.startU}U`,
          equipmentCategory: "Panels",
        });
      } else if (slot.equipment) {
        items.push({
          id: slot.id,
          kind: "equipment",
          // Priorité au label utilisateur, fallback au nom commercial.
          name: slot.label ?? slot.equipment.name,
          equipmentCategory: slot.equipment.category ?? "Autres",
        });
      }
    }
    for (const a of adapters) {
      items.push({ id: a.id, kind: "adapter", name: a.adapter?.name ?? "Adaptateur" });
    }
    for (const c of connections) {
      const ports = slotPorts.get(c.fromSlotId) ?? [];
      const port = ports.find((p) => p.portIndex === c.fromConnectorIndex);
      const sigName = port?.entry.signalName ?? null;
      const sig = sigName ? sigByName.get(sigName) : null;
      items.push({
        id: c.id,
        kind: "cable",
        name: c.label ?? `Câble ${c.id.slice(-4)}`,
        color: (c.color as string | null | undefined) ?? sig?.color ?? null,
        signalName: sigName,
        signalCategoryName: sig?.categoryRef?.name ?? sig?.category ?? null,
      });
    }
    for (const z of zones) {
      items.push({ id: z.id, kind: "zone", name: z.label ?? "Zone", color: z.color });
    }
    for (const l of canvasLabels) {
      items.push({ id: l.id, kind: "label", name: l.text?.slice(0, 32) || "Texte" });
    }
    for (const ext of externalPorts) {
      // Nom = label utilisateur si présent, sinon targetLabel résolu (rack
      // cible inter-rack), sinon le port de rattachement.
      const slot = activeSlots.find((s) => s.id === ext.slotId);
      const fallback = slot
        ? `${slot.label ?? slot.equipment?.name ?? "Slot"} · port ${ext.portIndex + 1}`
        : `Externe ${ext.id.slice(-4)}`;
      const userLabel =
        ext.label && ext.label.trim().length > 0 ? ext.label.trim() : null;
      const targetLabel =
        ext.targetLabel && ext.targetLabel.trim().length > 0
          ? ext.targetLabel.trim()
          : null;
      items.push({
        id: ext.id,
        kind: "external",
        name: userLabel ?? targetLabel ?? fallback,
      });
    }
    return items;
  }, [activeSlots, adapters, connections, zones, canvasLabels, externalPorts, signals, slotPorts]);
  // Dispatch idempotent : ne pousse les layerItems au store que si le contenu
  // a *vraiment* changé. Évite la boucle infinie quand `layerItems` est
  // recalculé à chaque render (useMemo) mais que le résultat structurel est
  // identique — chaque dispatch zustand re-render le SynopticLayersPanel,
  // ce qui peut indirectement re-render le parent → re-render SynopticView →
  // useMemo recalcule layerItems (nouvelle ref, même contenu) → reboucle.
  //
  // Le cleanup à [] est aussi séparé : il ne doit tirer qu'au démontage final
  // (pas à chaque changement de dep), sinon on dispatche deux mises à jour
  // rapprochées (vide + plein) à chaque changement.
  const lastLayerItemsKeyRef = useRef<string>("");
  useEffect(() => {
    // Hash léger : longueur + concat id|name|kind|color pour chaque item.
    // Comparaison structurelle sans JSON.stringify complet (plus rapide).
    const key = layerItems
      .map(
        (i) =>
          `${i.kind}:${i.id}:${i.name}:${(i as { color?: string | null }).color ?? ""}:${(i as { signalName?: string | null }).signalName ?? ""}`,
      )
      .join("|");
    if (!publishToShell) return;
    if (lastLayerItemsKeyRef.current === key) return;
    lastLayerItemsKeyRef.current = key;
    useTopbarActions.getState().setSynopticLayerItems(layerItems);
  }, [layerItems, publishToShell]);

  useEffect(() => {
    if (!publishToShell) return;
    // Cleanup au seul démontage final — pas à chaque changement de dep.
    return () => {
      useTopbarActions.getState().setSynopticLayerItems([]);
    };
  }, [publishToShell]);

  // Expose l'état de la légende au panneau calques.
  // Important : au démontage, on déconnecte le handler mais on PRÉSERVE
  // `synopticLegendVisible` (persisté via partialize) pour qu'un autre
  // canvas (ou un reload) puisse hydrater la préférence utilisateur.
  useEffect(() => {
    if (!publishToShell) return;
    useTopbarActions.getState().setSynopticLegendHandlers({
      visible: showLegend,
      onToggle: () => setShowLegend((v) => !v),
    });
    return () => {
      // Conserve la valeur visible courante au démontage — on retire
      // uniquement le callback toggle. La préférence reste persistée.
      useTopbarActions
        .getState()
        .setSynopticLegendHandlers({ visible: showLegend, onToggle: undefined });
    };
  }, [showLegend, publishToShell]);

  // Validation BOM/graphe en temps réel — extrait dans _hooks/use-validation-report.
  useValidationReport({
    expandedSlots,
    slots,
    connections,
    adapters,
    zones,
    positions,
    signals,
    connectorTypes,
    externalPorts,
    publish: publishToShell,
  });

  // Expose un handler de sélection d'issue : rack-editor appelle ça quand
  // l'utilisateur clique une entrée du rapport pour focus l'élément fautif.
  useEffect(() => {
    if (!publishToShell) return;
    const onIssue = (iss: import("@/lib/services/rack-validation").ValidationIssue) => {
      const cid = iss.refs.connectionIds?.[0];
      const aid = iss.refs.adapterIds?.[0];
      const sid = iss.refs.slotIds?.[0];
      const zid = iss.refs.zoneIds?.[0];
      if (cid) {
        selectOnly("conn", cid);
        setSelectedConnIds(new Set(iss.refs.connectionIds ?? [cid]));
      } else if (aid) {
        selectOnly("adapter", aid);
      } else if (sid) {
        selectOnly("node", sid);
      } else if (zid) {
        selectOnly("zone", zid);
      }
    };
    useTopbarActions.getState().setOnSelectValidationIssue(onIssue);
    return () => {
      useTopbarActions.getState().setOnSelectValidationIssue(undefined);
    };
  }, [selectOnly, publishToShell]);

  // Expose un handler de suppression en masse depuis le panneau calques
  useEffect(() => {
    if (!publishToShell) return;
    useTopbarActions.getState().setOnBulkDeleteLayerItems((layerItems) => {
      const cableIds: string[] = [];
      const adapterIds: string[] = [];
      const zoneIds: string[] = [];
      const labelIds: string[] = [];
      for (const it of layerItems) {
        if (it.kind === "cable") cableIds.push(it.id);
        else if (it.kind === "adapter") adapterIds.push(it.id);
        else if (it.kind === "zone") zoneIds.push(it.id);
        else if (it.kind === "label") labelIds.push(it.id);
      }
      // Câbles : batch
      if (cableIds.length > 0) {
        pushHistoryRef.current?.();
        setConnections((prev) => prev.filter((c) => !cableIds.includes(c.id)));
        setConnStyles((prev) => {
          const next = new Map(prev);
          cableIds.forEach((id) => next.delete(id));
          return next;
        });
        void cabling.deleteBatch(cableIds);
      }
      // Zones / Labels / Adapters : un par un
      for (const id of zoneIds) {
        pushHistoryRef.current?.();
        setZones((prev) => prev.filter((z) => z.id !== id));
        deleteZoneApi(id);
      }
      for (const id of labelIds) {
        pushHistoryRef.current?.();
        setCanvasLabels((prev) => prev.filter((l) => l.id !== id));
        deleteLabelApi(id);
      }
      for (const id of adapterIds) {
        void handleAdapterDelete(id);
      }
      // Nettoie la multi-sélection
      useTopbarActions.getState().clearLayerMultiSelect();
      setSelectedConnIds(new Set());
      setSelectedZoneId(null);
      setSelectedLabelId(null);
      setSelectedAdapterId(null);
    });
    return () => {
      useTopbarActions.getState().setOnBulkDeleteLayerItems(undefined);
    };
  }, [rackId, publishToShell]);

  // Expose le handler de renommage depuis le panneau calques (zones / labels uniquement)
  useEffect(() => {
    if (!publishToShell) return;
    useTopbarActions.getState().setOnRenameLayerItem((id, kind, name) => {
      if (kind === "zone") {
        setZones((prev) => {
          const next = prev.map((z) => (z.id === id ? { ...z, label: name } : z));
          const updated = next.find((z) => z.id === id);
          if (updated) updateZoneApi(updated);
          return next;
        });
      } else if (kind === "label") {
        setCanvasLabels((prev) => {
          const next = prev.map((l) => (l.id === id ? { ...l, text: name } : l));
          const updated = next.find((l) => l.id === id);
          if (updated) updateLabelApi(updated);
          return next;
        });
      }
    });
    return () => {
      useTopbarActions.getState().setOnRenameLayerItem(undefined);
    };
  }, [publishToShell]);

  // Persistance hidden/locked par rack (localStorage)
  useEffect(() => {
    if (!publishToShell) return;
    try {
      const raw = localStorage.getItem(`synoptic-layers-${viewKeyBase}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const hidden = Array.isArray(parsed?.hidden)
        ? parsed.hidden.filter((s: unknown) => typeof s === "string")
        : [];
      const locked = Array.isArray(parsed?.locked)
        ? parsed.locked.filter((s: unknown) => typeof s === "string")
        : [];
      if (hidden.length > 0) useTopbarActions.getState().setManyLayersHidden(hidden, true);
      if (locked.length > 0) useTopbarActions.getState().setManyLayersLocked(locked, true);
    } catch {}
    return () => {
      // Reset à l'unmount pour ne pas polluer le rack suivant.
      useTopbarActions
        .getState()
        .setManyLayersHidden([...useTopbarActions.getState().hiddenLayerIds], false);
      useTopbarActions
        .getState()
        .setManyLayersLocked([...useTopbarActions.getState().lockedLayerIds], false);
    };
  }, [viewKeyBase, publishToShell]);
  // Sauvegarde au moindre changement
  const hiddenSerialized = useMemo(() => [...hiddenLayerIds].sort().join(","), [hiddenLayerIds]);
  const lockedSerialized = useMemo(() => [...lockedLayerIds].sort().join(","), [lockedLayerIds]);
  useEffect(() => {
    // Une instance muette ne mémorise pas non plus les préférences de calques :
    // elle n'a pas de calques à elle, elle lit ceux de l'éditeur.
    if (!publishToShell) return;
    try {
      localStorage.setItem(
        `synoptic-layers-${viewKeyBase}`,
        JSON.stringify({ hidden: [...hiddenLayerIds], locked: [...lockedLayerIds] }),
      );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenSerialized, lockedSerialized, viewKeyBase, publishToShell]);

  // Consomme les demandes de sélection depuis le panneau calques (+ recentre la vue)
  const pendingLayerSelection = useTopbarActions((s) => s.pendingLayerSelection);
  useEffect(() => {
    // Une instance muette ne CONSOMME pas non plus : le signal appartient à
    // l'éditeur visible, l'intercepter le lui volerait.
    if (!publishToShell) return;
    if (!pendingLayerSelection) return;
    const { id, kind } = pendingLayerSelection;
    const kindToSelectKind: Record<typeof kind, Parameters<typeof selectOnly>[0] | null> = {
      equipment: "node",
      panel: "node",
      cable: "conn",
      adapter: "adapter",
      zone: "zone",
      label: "label",
      external: "external",
    };
    const selKind = kindToSelectKind[kind];
    if (selKind) {
      // Panel : l'id est le real slot id ; la sélection s'appuie sur les row virtuelles.
      // On sélectionne la première row visible correspondante.
      let selId = id;
      if (kind === "panel") {
        const firstRow = expandedSlots.find((s) => {
          const info = getVirtualRowInfo(s.id);
          return info?.slotId === id;
        });
        if (firstRow) selId = firstRow.id;
      }
      selectOnly(selKind, selId);
    }

    // Calcule les bounds canvas-space de l'élément
    let bx1: number | null = null,
      by1: number | null = null,
      bx2: number | null = null,
      by2: number | null = null;
    if (kind === "equipment" || kind === "panel") {
      // Calcule la bbox union des entités visibles correspondant au layer item :
      //  - Équipement : un seul slot réel.
      //  - Panel : potentiellement plusieurs rows virtuelles (slotId__row0, __row1, ...).
      const matchingIds: string[] = [];
      for (const s of expandedSlots) {
        if (s.id === id) matchingIds.push(s.id);
        else {
          const info = getVirtualRowInfo(s.id);
          if (info && info.slotId === id) matchingIds.push(s.id);
        }
      }
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const sid of matchingIds) {
        const pos = positions.get(sid);
        if (!pos) continue;
        const slot = expandedSlots.find((s) => s.id === sid);
        const nodeW = slot?.panel ? PANEL_NODE_W : NODE_W;
        const ports = slotPorts.get(sid) ?? [];
        const portRows = Math.max(
          ports.filter((p) => p.side === "left").length,
          ports.filter((p) => p.side === "right").length,
        );
        const extra = slotAdapterExtras.get(sid)?.extraNodeHeight ?? 0;
        // Même formule que le rendu réel (cf. fitAll)
        const nodeH = Math.max(NODE_MIN_H, NODE_HEADER_H + portRows * PORT_H + 16) + extra;
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + nodeW);
        maxY = Math.max(maxY, pos.y + nodeH);
      }
      if (Number.isFinite(minX)) {
        bx1 = minX;
        by1 = minY;
        bx2 = maxX;
        by2 = maxY;
      }
    } else if (kind === "zone") {
      const z = zones.find((z) => z.id === id);
      if (z) {
        bx1 = z.x;
        by1 = z.y;
        bx2 = z.x + z.w;
        by2 = z.y + z.h;
      }
    } else if (kind === "label") {
      const l = canvasLabels.find((l) => l.id === id);
      if (l) {
        const size = l.fontSize ?? 14;
        bx1 = l.x - 4;
        by1 = l.y - size;
        bx2 = l.x + (l.text?.length ?? 4) * size * 0.6;
        by2 = l.y + 4;
      }
    } else if (kind === "adapter") {
      const a = adapters.find((a) => a.id === id);
      if (a) {
        // Si attaché à un équipement, la position réelle est dérivée du port (live.x/y),
        // pas a.x/a.y. Utilise la même logique que le rendu.
        let ax = a.x,
          ay = a.y;
        if (a.attachedSlotId && a.attachedPortIndex != null && a.attachedSide) {
          const portCenter = getPortCenterRef.current?.(a.attachedSlotId, a.attachedPortIndex);
          if (portCenter) {
            ax = a.attachedSide === "right" ? portCenter.x : portCenter.x - ADAPTER_NODE_W;
            const FIRST_PORT_Y =
              ADAPTER_NODE_TITLE_H + ADAPTER_NODE_PAD_TOP + ADAPTER_NODE_PORT_H / 2;
            ay = portCenter.y - FIRST_PORT_Y;
          }
        }
        bx1 = ax;
        by1 = ay;
        bx2 = ax + ADAPTER_NODE_W;
        by2 = ay + adapterNodeHeight(a);
      }
    } else if (kind === "cable") {
      const c = connections.find((c) => c.id === id);
      if (c) {
        const from = getPortCenterRef.current?.(c.fromSlotId, c.fromConnectorIndex);
        const to = getPortCenterRef.current?.(c.toSlotId, c.toConnectorIndex);
        if (from && to) {
          bx1 = Math.min(from.x, to.x);
          by1 = Math.min(from.y, to.y);
          bx2 = Math.max(from.x, to.x);
          by2 = Math.max(from.y, to.y);
        }
      }
    }

    if (
      bx1 != null &&
      by1 != null &&
      bx2 != null &&
      by2 != null &&
      containerSize.w > 0 &&
      containerSize.h > 0
    ) {
      const bw = Math.max(10, bx2 - bx1);
      const bh = Math.max(10, by2 - by1);
      const cx = (bx1 + bx2) / 2;
      const cy = (by1 + by2) / 2;
      // Marges asymétriques : priorité à la hauteur (équipements souvent hauts/étroits),
      // marge latérale généreuse pour voir le contexte.
      const MARGIN_V = 0.12; // 12% en haut/bas → élément occupe ~76% de la hauteur
      const MARGIN_H = 0.25; // 25% sur les côtés → respiration horizontale
      const availW = containerSize.w * (1 - 2 * MARGIN_H);
      const availH = containerSize.h * (1 - 2 * MARGIN_V);
      // Hauteur = critère dominant. On ne réduit via la largeur QUE si débordement réel.
      let targetZoom = availH / bh;
      if (bw * targetZoom > availW) targetZoom = availW / bw;
      targetZoom = Math.max(0.25, Math.min(2.5, targetZoom));
      const newPan = {
        x: containerSize.w / 2 - cx * targetZoom,
        y: containerSize.h / 2 - cy * targetZoom,
      };
      viewRef.current = { pan: newPan, zoom: targetZoom };
      setPan(newPan);
      setZoom(targetZoom);
    }

    useTopbarActions.getState().clearPendingLayerSelection();
  }, [
    pendingLayerSelection,
    selectOnly,
    positions,
    expandedSlots,
    zones,
    canvasLabels,
    adapters,
    connections,
    slotPorts,
    containerSize,
    publishToShell,
  ]);

  // Publie la sélection courante (merge de tous les types) pour highlighter dans le panneau calques
  useEffect(() => {
    if (!publishToShell) return;
    const ids = new Set<string>();
    if (selectedNodeId) ids.add(selectedNodeId);
    if (selectedZoneId) ids.add(selectedZoneId);
    if (selectedLabelId) ids.add(selectedLabelId);
    if (selectedAdapterId) ids.add(selectedAdapterId);
    if (selectedConnId) ids.add(selectedConnId);
    selectedConnIds.forEach((id) => ids.add(id));
    useTopbarActions.getState().setSelectedSynopticIds(ids);
  }, [
    selectedNodeId,
    selectedZoneId,
    selectedLabelId,
    selectedAdapterId,
    selectedConnId,
    selectedConnIds,
    publishToShell,
  ]);

  // ── Cable numbering map: consecutive per (signal + direction) across all slots ─
  // Key = "slotId:portIndex", value = sequential number (1-based)
  // Separate counter per signal name + direction (IN/OUT/BIDIR)
  const portCableNumbers = useMemo(() => {
    const result = new Map<string, number>();
    const sorted = [...expandedSlots].sort((a, b) => (a.startU ?? 0) - (b.startU ?? 0));
    const counters = new Map<string, number>(); // "signalName:dirDigit" → next number
    for (const slot of sorted) {
      const ports = slotPorts.get(slot.id) ?? [];
      for (const port of ports) {
        const sigName = port.entry.signalName;
        if (!sigName) continue;
        const dir = port.entry.direction?.toUpperCase();
        const dirDigit = dir === "IN" ? "1" : dir === "OUT" ? "2" : "3";
        const key = `${sigName}:${dirDigit}`;
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        result.set(`${slot.id}:${port.portIndex}`, n);
      }
    }
    return result;
  }, [expandedSlots, slotPorts]);

  // ── Extras visuels causés par les adaptateurs attachés ─────────────────────
  // Pour chaque slot où des adaptateurs sont attachés, on calcule combien de
  // rows supplémentaires il faut intercaler (par côté) et où.
  const slotAdapterExtras = useMemo(() => {
    const out = new Map<string, SlotExtras>();
    const bySlot = new Map<string, SynopticAdapterInstance[]>();
    for (const a of adapters) {
      if (!a.attachedSlotId || a.attachedPortIndex == null) continue;
      const arr = bySlot.get(a.attachedSlotId) ?? [];
      arr.push(a);
      bySlot.set(a.attachedSlotId, arr);
    }
    for (const [slotId, slotAdapters] of bySlot) {
      const ports = slotPorts.get(slotId) ?? [];
      const sides: ("left" | "right")[] = ["left", "right"];
      const margins = new Map<number, number>();
      const cumul = new Map<number, number>();
      let leftTotal = 0;
      let rightTotal = 0;
      for (const side of sides) {
        const sidePorts = ports.filter((p) => p.side === side);
        let acc = 0;
        for (const p of sidePorts) {
          cumul.set(p.portIndex, acc);
          const ad = slotAdapters.find(
            (a) => a.attachedPortIndex === p.portIndex && a.attachedSide === side,
          );
          if (ad && ad.adapter) {
            // fanCount = nombre maximum de ports d'un côté de l'adapter
            const inCount = (ad.adapter.inputs ?? []).reduce((s, e) => s + (e.quantity ?? 1), 0);
            const outCount = (ad.adapter.outputs ?? []).reduce((s, e) => s + (e.quantity ?? 1), 0);
            const fanCount = Math.max(inCount, outCount);
            const extra = Math.max(0, fanCount - 1) * PORT_H;
            if (extra > 0) {
              margins.set(p.portIndex, extra);
              acc += extra;
            }
          }
        }
        if (side === "left") leftTotal = acc;
        else rightTotal = acc;
      }
      out.set(slotId, {
        marginsByPortIdx: margins,
        cumulByPortIdx: cumul,
        extraNodeHeight: Math.max(leftTotal, rightTotal),
      });
    }
    return out;
  }, [adapters, slotPorts]);

  // ── Resolve connections: DB real IDs → virtual panel node IDs ───────────────
  // connections state stores real slot IDs (as returned by DB).
  // For rendering/port-lookup we need virtual node IDs (e.g. "slotId__row0").
  const resolvedConnections = useMemo(
    () =>
      connections.map((conn) => {
        const from = realToVirtual(conn.fromSlotId, conn.fromConnectorIndex, activeSlots);
        const to = realToVirtual(conn.toSlotId, conn.toConnectorIndex, activeSlots);
        return {
          ...conn,
          fromSlotId: from.slotId,
          fromConnectorIndex: from.portIndex,
          toSlotId: to.slotId,
          toConnectorIndex: to.portIndex,
        };
      }),
    [connections, activeSlots],
  );
  const resolvedConnectionsRef = useRef(resolvedConnections);
  resolvedConnectionsRef.current = resolvedConnections;
  const externalPortsRef = useRef(externalPorts);
  externalPortsRef.current = externalPorts;

  // ── Obstacles : bboxes des nodes visibles, pour évitement du tracé auto ──
  const nodeObstacles = useMemo(() => {
    const out: { id: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const slot of expandedSlots) {
      if (hiddenLayerIds.has(slot.id)) continue;
      const pos = positions.get(slot.id);
      if (!pos) continue;
      const nodeW = slot.panel ? PANEL_NODE_W : NODE_W;
      const ports = slotPorts.get(slot.id) ?? [];
      const portRows = Math.max(
        ports.filter((p) => p.side === "left").length,
        ports.filter((p) => p.side === "right").length,
      );
      const extra = slotAdapterExtras.get(slot.id)?.extraNodeHeight ?? 0;
      const nodeH = Math.max(NODE_MIN_H, NODE_HEADER_H + portRows * PORT_H + 16) + extra;
      out.push({ id: slot.id, x1: pos.x, y1: pos.y, x2: pos.x + nodeW, y2: pos.y + nodeH });
    }
    return out;
  }, [expandedSlots, positions, slotPorts, slotAdapterExtras, hiddenLayerIds]);
  const nodeObstaclesRef = useRef(nodeObstacles);
  nodeObstaclesRef.current = nodeObstacles;

  // Ajuste le midX pour éviter les nodes qui se trouvent sur le trajet vertical.
  // Retourne un midX éventuellement décalé.
  const avoidObstaclesMidX = useCallback(
    (midX: number, y1: number, y2: number, srcSlotId: string, dstSlotId: string): number => {
      const yTop = Math.min(y1, y2);
      const yBot = Math.max(y1, y2);
      const obstacles = nodeObstaclesRef.current.filter(
        (o) =>
          o.id !== srcSlotId &&
          o.id !== dstSlotId &&
          o.y1 < yBot &&
          o.y2 > yTop &&
          o.x1 < midX &&
          o.x2 > midX,
      );
      if (obstacles.length === 0) return midX;
      // Pour chaque obstacle, choisir le côté (gauche ou droite) le moins éloigné
      const MARGIN = 18;
      let adjusted = midX;
      for (const o of obstacles) {
        const distLeft = adjusted - (o.x1 - MARGIN);
        const distRight = o.x2 + MARGIN - adjusted;
        // Si l'obstacle chevauche toujours, pousser du côté le plus proche
        if (adjusted > o.x1 && adjusted < o.x2) {
          if (distLeft <= distRight) adjusted = o.x1 - MARGIN;
          else adjusted = o.x2 + MARGIN;
        }
      }
      return adjusted;
    },
    [],
  );

  // ── Lane offsets : câbles parallèles entre 2 mêmes nodes décalés en lane ──
  // Pour éviter les croisements, on ordonne les câbles par Y source (puis Y dest)
  // avant d'assigner les offsets : les ports les plus hauts prennent les lanes basses.
  // LANE_SPACING = gridStep (PORT_H) pour rester aligné avec la grille.
  // Flag hydratation : gate le rendu des câbles pour éviter mismatch SSR/client.
  const [cablesHydrated, setCablesHydrated] = useState(false);
  useEffect(() => {
    setCablesHydrated(true);
  }, []);
  // Lane offsets pour câbles parallèles — extrait dans _hooks/use-cable-lane-offsets.
  const cableLaneOffsets = useCableLaneOffsets(resolvedConnections, getPortCenterRef);

  // ── Deduce panel port directions from connected equipment ────────────────────
  // Key: `${virtualSlotId}:${portIndex}` → "IN" | "OUT"
  const panelPortDirs = useMemo(() => {
    const map = new Map<string, "IN" | "OUT" | "BIDIR">();
    // Index O(1) pour les lookups dans la boucle (évite .find() quadratique).
    const expandedSlotById = new Map(expandedSlots.map((s) => [s.id, s]));
    const adaptersById = new Map(adapters.map((a) => [a.id, a]));
    const portByIdx = new Map<string, Map<number, Port>>();
    for (const [sid, ports] of slotPorts) {
      const pm = new Map<number, Port>();
      for (const p of ports) pm.set(p.portIndex, p);
      portByIdx.set(sid, pm);
    }
    // Résout la direction effective à l'autre bout du câble.
    // Cas adaptateur (passif) : on remonte à l'équipement attaché via attachedSlotId
    // pour hériter de sa direction. Cas normal (équipement direct OU panel → panel) :
    // lookup direct dans slotPorts.
    const resolveOtherDir = (otherSlotId: string, otherPortIdx: number): string | undefined => {
      const directDir = portByIdx
        .get(otherSlotId)
        ?.get(otherPortIdx)
        ?.entry.direction?.toUpperCase();
      if (directDir) return directDir;
      // Fallback adaptateur : si lookup direct a échoué et que otherSlotId est un adapter virtuel,
      // remonter à l'équipement attaché.
      const ad = parseAdapterSlotId(otherSlotId);
      if (ad) {
        const adp = adaptersById.get(ad.adapterId);
        if (!adp || !adp.attachedSlotId || adp.attachedPortIndex == null) return undefined;
        return portByIdx
          .get(adp.attachedSlotId)
          ?.get(adp.attachedPortIndex)
          ?.entry.direction?.toUpperCase();
      }
      return undefined;
    };
    for (const conn of resolvedConnections) {
      const process = (
        panelSlotId: string,
        panelPortIdx: number,
        otherSlotId: string,
        otherPortIdx: number,
      ) => {
        const panelSlot = expandedSlotById.get(panelSlotId);
        if (!panelSlot?.panel) return;
        const otherDir = resolveOtherDir(otherSlotId, otherPortIdx);
        if (!otherDir) return;
        const homologueIdx = panelPortIdx % 2 === 0 ? panelPortIdx + 1 : panelPortIdx - 1;
        if (otherDir === "BIDIR" || otherDir === "BOTH") {
          // Signal bidirectionnel — les deux ports du panel sont BIDIR
          map.set(`${panelSlotId}:${panelPortIdx}`, "BIDIR");
          map.set(`${panelSlotId}:${homologueIdx}`, "BIDIR");
          return;
        }
        const thisDir: "IN" | "OUT" = otherDir === "OUT" ? "IN" : "OUT";
        const homologueDir: "IN" | "OUT" = otherDir === "OUT" ? "OUT" : "IN";
        map.set(`${panelSlotId}:${panelPortIdx}`, thisDir);
        map.set(`${panelSlotId}:${homologueIdx}`, homologueDir);
      };
      process(conn.fromSlotId, conn.fromConnectorIndex, conn.toSlotId, conn.toConnectorIndex);
      process(conn.toSlotId, conn.toConnectorIndex, conn.fromSlotId, conn.fromConnectorIndex);
    }
    return map;
  }, [resolvedConnections, expandedSlots, slotPorts, adapters]);

  // ── Compatible targets when drawing ─────────────────────────────────────────
  // Key: slotId → Set<portIndex> of ports that are valid destinations for current drawingFrom
  // Set des signaux IP — utilisé par compatibleTargets, incompatReason
  // (tooltips), et passé à SynopticNode pour relâcher les contrôles signal/
  // connecteur quand les deux ports sont IP.
  const ipSignalNames = useMemo(() => {
    const set = new Set<string>();
    for (const s of signals) if ((s as { isIp?: boolean }).isIp) set.add(s.name);
    return set;
  }, [signals]);

  // Map signalName → couleur. Utilisée pour colorer les câbles (priorité sur
  // la couleur du connecteur) et la légende.
  const sigColorByName = useMemo<Record<string, string>>(
    () => Object.fromEntries(signals.map((s) => [s.name, s.color])),
    [signals],
  );

  const compatibleTargets = useMemo(() => {
    const map = new Map<string, Set<number>>();
    if (!drawingFrom) return map;
    const srcSlotId = multiSrcPorts?.slotId ?? drawingFrom.slotId;

    // Multi phase 2: all free ports on ALL other slots, no compatibility filter
    if (multiSrcConfirmed && multiSrcPorts) {
      for (const [slotId, ports] of slotPorts) {
        if (slotId === srcSlotId) continue;
        for (const port of ports) {
          if (
            resolvedConnectionsRef.current.some(
              (c) =>
                (c.fromSlotId === slotId && c.fromConnectorIndex === port.portIndex) ||
                (c.toSlotId === slotId && c.toConnectorIndex === port.portIndex),
            )
          )
            continue;
          if (!map.has(slotId)) map.set(slotId, new Set());
          map.get(slotId)!.add(port.portIndex);
        }
      }
      return map;
    }

    // Single mode: filter by direction, connector type, signal
    const srcPort = slotPorts
      .get(drawingFrom.slotId)
      ?.find((p) => p.portIndex === drawingFrom.portIndex);
    if (!srcPort) return map;
    const isBidir = (d?: string) => !d || d === "BIDIR" || d === "BOTH";
    const srcDirRaw = srcPort.entry.direction?.toUpperCase();
    const srcDir = isBidir(srcDirRaw)
      ? (panelPortDirs.get(`${drawingFrom.slotId}:${drawingFrom.portIndex}`) ?? null)
      : srcDirRaw;
    const srcTypeId = srcPort.entry.connectorTypeId ?? null;
    const srcSignal = srcPort.entry.signalName ?? null;
    const srcIsIp = !!srcSignal && ipSignalNames.has(srcSignal);
    for (const [slotId, ports] of slotPorts) {
      if (slotId === drawingFrom.slotId) continue;
      for (const port of ports) {
        if (
          resolvedConnectionsRef.current.some(
            (c) =>
              (c.fromSlotId === slotId && c.fromConnectorIndex === port.portIndex) ||
              (c.toSlotId === slotId && c.toConnectorIndex === port.portIndex),
          )
        )
          continue;
        const dstDirRaw = port.entry.direction?.toUpperCase();
        const dstDir = isBidir(dstDirRaw)
          ? (panelPortDirs.get(`${slotId}:${port.portIndex}`) ?? null)
          : dstDirRaw;
        if (srcDir && dstDir && srcDir === dstDir) continue;
        const dstSignal = port.entry.signalName ?? null;
        const dstIsIp = !!dstSignal && ipSignalNames.has(dstSignal);
        // Règle de compatibilité :
        // - Deux ports IP : on relâche signal + connecteur (switch IT
        //   imaginaire entre les deux).
        // - Un port sans signal (switching/transit déclaré dans
        //   l'équipement) : on relâche aussi — ce port porte le signal du
        //   pair, peu importe le connecteur physique.
        const bothIp = srcIsIp && dstIsIp;
        const oneIsPassthrough = !srcSignal || !dstSignal;
        if (!bothIp && !oneIsPassthrough) {
          const dstTypeId = port.entry.connectorTypeId ?? null;
          if (srcTypeId && dstTypeId && srcTypeId !== dstTypeId) continue;
          if (srcSignal && dstSignal && srcSignal !== dstSignal) continue;
        }
        if (!map.has(slotId)) map.set(slotId, new Set());
        map.get(slotId)!.add(port.portIndex);
      }
    }
    return map;
  }, [drawingFrom, multiSrcConfirmed, multiSrcPorts, slotPorts, panelPortDirs, ipSignalNames]);

  // ── Multi snap targets: all destination ports used by multi cables when snap is active ──
  // Map<slotId, Set<portIndex>> — one entry per real destination port (snap + relative neighbors)
  const multiSnapTargetsMap = useMemo(() => {
    const map = new Map<string, Set<number>>();
    if (!multiSrcConfirmed || !multiSrcPorts || !snapTarget) return map;
    const srcIndices = multiSrcPorts.portIndices;
    const dstPorts = slotPorts.get(snapTarget.slotId) ?? [];
    const firstDst = dstPorts.find((p) => p.portIndex === snapTarget.portIndex);
    if (!firstDst) return map;
    const dstSide = firstDst.side;
    const dstSidePorts = dstPorts
      .filter((p) => p.side === dstSide)
      .sort((a, b) => a.portIndex - b.portIndex);
    const startI = dstSidePorts.findIndex((p) => p.portIndex === snapTarget.portIndex);
    const indices = new Set<number>();
    // Aperçu = ce qui sera réellement posé : ports consécutifs du côté visé,
    // sans filtre de type ni d'occupation (cf. phase 2 de handlePortClick).
    srcIndices.forEach((_, i) => {
      const dp = dstSidePorts[startI + i];
      if (!dp) return;
      indices.add(dp.portIndex);
    });
    if (indices.size > 0) map.set(snapTarget.slotId, indices);
    return map;
  }, [multiSrcConfirmed, multiSrcPorts, snapTarget, slotPorts]);

  // ── Pan + zoom-toward-cursor (native listeners, passive:false for wheel) ────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Don't attach while hidden — getBoundingClientRect() returns zeros and breaks pan/zoom math
    if (!isVisible) return;

    // Track whether the pointer has actually moved (to distinguish click from drag)
    const pointerMovedRef = { current: false };

    /** Port le plus proche d'une position écran, dans SNAP_RADIUS (espace
     *  canvas). Inclut le port source : relâcher/cliquer dessus doit rester
     *  l'annulation du tracé, pas une pose sur le port voisin. */
    const nearestPort = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const { pan: p, zoom: z } = viewRef.current;
      const cx = (clientX - r.left - p.x) / z;
      const cy = (clientY - r.top - p.y) / z;
      let bestD = SNAP_RADIUS;
      let best: { slotId: string; portIndex: number } | null = null;
      for (const c of getSnapCenters()) {
        const d = Math.hypot(c.x - cx, c.y - cy);
        if (d < bestD) {
          bestD = d;
          best = { slotId: c.slotId, portIndex: c.portIndex };
        }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      // Nouveau geste → le port cliqué reprend toujours la main (avant toute
      // sortie anticipée, sinon un drag sans pose pourrait laisser la garde
      // armée et manger un clic ultérieur).
      suppressPortClickRef.current = false;
      const target = e.target as HTMLElement;
      // Si le clic démarre sur une règle (zone 18×containerH ou containerW×18), ignorer
      // complètement — la règle gère elle-même la création de repères.
      const rect = el.getBoundingClientRect();
      const lx = e.clientX - rect.left;
      const ly = e.clientY - rect.top;
      const rulersOn = useTopbarActions.getState().rulersEnabled;
      if (rulersOn && (lx < 18 || ly < 18)) return;
      // Si le clic atteint un hit-zone de repère, ignorer aussi.
      if (target.closest("[data-guide-hit]")) return;
      // Mini-map : navigation indépendante, ne déclenche jamais un outil.
      if (target.closest("[data-minimap]")) return;
      const onToolbar = target.closest("[data-toolbar]") || target.closest("button");
      const onNode = target.closest("[data-node]") || target.closest("[data-port]");
      const onCable = (target as unknown as SVGElement).closest?.("[data-cable]");
      const onZone = (target as unknown as SVGElement).closest?.("[data-zone]");
      const onLabel = (target as unknown as SVGElement).closest?.("[data-canvas-label]");
      const onAdapter = (target as unknown as SVGElement).closest?.("[data-adapter]");

      // ── Middle mouse: always pan ────────────────────────────────────────────
      if (e.button === 1) {
        e.preventDefault();
        const { pan: p } = viewRef.current;
        panDragRef.current = { active: true, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y };
        el.setPointerCapture(e.pointerId);
        return;
      }

      if (e.button !== 0) return;
      if (onToolbar) return;
      pointerMovedRef.current = false;
      // Outil câble : on MÉMORISE seulement le geste. Aucun appel ici — le
      // clic-clic doit rester intégralement piloté par le handler React du
      // port (un appel au pointerdown se ferait annuler par le click qui suit
      // sur le même port : « clic sur le port source = annulation »).
      // `hit` = port sous le point de départ, capté maintenant car au drop le
      // pointeur aura bougé. Nul sur un adaptateur : ses ports sont absents du
      // snap et son propre handler pointerdown amorce déjà le tracé.
      cableDownRef.current =
        toolRef.current === "cable" && !onCable
          ? {
              x: e.clientX,
              y: e.clientY,
              hit: onAdapter ? null : nearestPort(e.clientX, e.clientY),
              dragging: false,
            }
          : null;

      // ── Drawing in multipoint mode: add waypoint on empty canvas click ──────
      // Pas d'ajout de waypoint quand on est en mode pan temporaire (espace maintenu) :
      // l'utilisateur veut paner la grille sans perdre le câblage en cours.
      const canAddWaypoint =
        toolRef.current !== "pan" &&
        drawingFromRef.current &&
        cableModeRef.current === "multipoint" &&
        (cableCountRef.current === "single" ||
          (multiSrcConfirmedRef.current && multiSrcPortsRef.current));
      if (canAddWaypoint && !onNode && !onCable && !onZone && !onLabel) {
        const rect = el.getBoundingClientRect();
        const { pan: p, zoom: z } = viewRef.current;
        const cx = (e.clientX - rect.left - p.x) / z;
        const cy = (e.clientY - rect.top - p.y) / z;
        const df = drawingFromRef.current;
        const portC =
          df && getPortCenterRef.current ? getPortCenterRef.current(df.slotId, df.portIndex) : null;
        const dir = drawingDirectionRef.current;
        const snapS = useTopbarActions.getState();
        const snappedCx = snapS.snapEnabled ? snapCoord(cx, snapS.gridStep) : cx;
        const snappedCy = snapS.snapEnabled ? snapCoord(cy, snapS.gridStep) : cy;
        setDrawingWaypoints((prev) => {
          let lastX = snappedCx,
            lastY = snappedCy;
          if (prev.length > 0) {
            lastX = prev[prev.length - 1].x;
            lastY = prev[prev.length - 1].y;
          } else if (portC) {
            lastX = portC.x;
            lastY = portC.y;
          }
          const newPt = dir === "H" ? { x: snappedCx, y: lastY } : { x: lastX, y: snappedCy };
          return [...prev, newPt];
        });
        setDrawingDirection((d) => (d === "H" ? "V" : "H"));
        e.preventDefault();
        return;
      }

      const currentTool = toolRef.current;

      // ── Clic dans le vide → déselectionner tout (tous les outils) ────────────
      const onExternal = !!(target as unknown as SVGElement).closest?.(
        "[data-external-port=\"true\"]",
      );
      if (!onNode && !onCable && !onZone && !onLabel && !onAdapter && !onExternal) {
        setSelectedConnId(null);
        setSelectedConnIds(new Set());
        setSelectedAdapterId(null);
        setSelectedZoneId(null);
        setSelectedLabelId(null);
        setSelectedNodeId(null);
        setSelectedExternalId(null);
        setSelectedExternalIds(new Set());
      }

      // ── Pan tool: always pan regardless of what's under the cursor ───────────
      if (currentTool === "pan") {
        const { pan: p } = viewRef.current;
        panDragRef.current = { active: true, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y };
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      // ── Label tool: open inline input at click position (live preview) ──────
      if (currentTool === "label" && !onNode && !onCable && !onZone && !onLabel) {
        // If an inline editor is already open elsewhere, let its blur handler commit/cancel
        const isInInlineInput = (e.target as HTMLElement).closest?.("[data-inline-label-input]");
        if (isInInlineInput) return;
        const rect = el.getBoundingClientRect();
        const { pan: p, zoom: z } = viewRef.current;
        const cx = (e.clientX - rect.left - p.x) / z;
        const cy = (e.clientY - rect.top - p.y) / z;
        setSelectedLabelId(null);
        setInlineLabel({ x: cx, y: cy, text: "" });
        e.preventDefault();
        return;
      }

      // ── Adapter tool: pose l'adaptateur sélectionné dans la gallerie topbar ─
      if (currentTool === "adapter" && !onNode && !onCable && !onZone && !onLabel && !onAdapter) {
        const pickingId = useTopbarActions.getState().pickingAdapterId;
        if (!pickingId) {
          // Clic vide sans adaptateur présélectionné → annule le port "pending" éventuel.
          if (useTopbarActions.getState().pendingAdapterPort) {
            useTopbarActions.getState().setPendingAdapterPort(null);
          }
          e.preventDefault();
          return;
        }
        const rect = el.getBoundingClientRect();
        const { pan: p, zoom: z } = viewRef.current;
        const cx = (e.clientX - rect.left - p.x) / z;
        const cy = (e.clientY - rect.top - p.y) / z;
        (async () => {
          try {
            const res = await apiFetch(`/api/racks/${rackId}/adapters`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ adapterId: pickingId, x: cx, y: cy }),
            });
            if (res.ok) {
              const created = (await res.json()) as SynopticAdapterInstance;
              pushHistoryRef.current?.();
              setAdapters((prev) =>
                prev.some((a) => a.id === created.id) ? prev : [...prev, created],
              );
            }
          } catch {
            // silent
          }
        })();
        e.preventDefault();
        return;
      }

      // ── Zoom tool: click to zoom at cursor ─────────────────────────────────
      if (currentTool === "zoom") {
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = zoomVariantRef.current === "out" ? 1 / 1.2 : 1.2;
        const { pan: p, zoom: z } = viewRef.current;
        const worldX = (cx - p.x) / z;
        const worldY = (cy - p.y) / z;
        const newZoom = Math.max(0.2, Math.min(4, z * factor));
        const newPanX = cx - worldX * newZoom;
        const newPanY = cy - worldY * newZoom;
        viewRef.current = { pan: { x: newPanX, y: newPanY }, zoom: newZoom };
        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
        e.preventDefault();
        return;
      }

      // ── Zone tool: draw rectangle ────────────────────────────────────────────
      if (currentTool === "zone" && !onNode && !onCable && !onZone && !onLabel) {
        const rect = el.getBoundingClientRect();
        const { pan: p, zoom: z } = viewRef.current;
        const cx = (e.clientX - rect.left - p.x) / z;
        const cy = (e.clientY - rect.top - p.y) / z;
        setDrawingZone({ sx: cx, sy: cy, x: cx, y: cy, w: 0, h: 0 });
        setSelectedZoneId(null);
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      // ── Select tool: rubber-band on empty canvas
      if (currentTool === "select" && !onNode && !onCable && !onZone && !onLabel && !onAdapter) {
        const rect = el.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        rubberBandRef.current = { active: true, sx, sy, additive: e.shiftKey };
        // Don't commit rubber-band until pointer actually moves (avoids flash on simple click)
        setSelectedNodeId(null);
        setSelectedZoneId(null);
        setSelectedLabelId(null);
        if (!e.shiftKey) setSelectedConnId(null);
        setDrawingFrom(null);
        setDrawingWaypoints([]);
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      // ── Fallback pan : sur canvas vide hors mode move/erase/cable/numbering ───
      if (
        currentTool !== "move" &&
        currentTool !== "erase" &&
        currentTool !== "cable" &&
        currentTool !== "numbering" &&
        !onNode &&
        !onCable &&
        !onZone &&
        !onLabel &&
        !onAdapter
      ) {
        const { pan: p } = viewRef.current;
        panDragRef.current = { active: true, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y };
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    };

    const onMove = (e: PointerEvent) => {
      pointerMovedRef.current = true;

      // ── Drag-to-connect : amorçage du tracé au 1er déplacement ──────────────
      // Bouton relâché hors du conteneur → le geste est mort, on nettoie.
      if (cableDownRef.current && (e.buttons & 1) === 0) cableDownRef.current = null;
      const cd = cableDownRef.current;
      if (
        cd &&
        !cd.dragging &&
        toolRef.current === "cable" &&
        !endpointDragRef.current &&
        Math.hypot(e.clientX - cd.x, e.clientY - cd.y) > 4
      ) {
        cd.dragging = true;
        // Presser un port puis relâcher sur un autre ne posait rien : le click
        // React ne remonte que sur l'ancêtre commun des deux cibles, donc aucun
        // port ne le recevait. On amorce ici, une fois le drag avéré — un clic
        // sans mouvement ne passe jamais par ce chemin.
        if (cd.hit && !drawingFromRef.current && !multiSrcPortsRef.current) {
          handlePortClickRef.current?.(cd.hit.slotId, cd.hit.portIndex);
        }
        // Le click de fin de geste (si down et up tombent sur le même port)
        // annulerait le tracé qu'on vient d'amorcer.
        if (drawingFromRef.current || cd.hit) suppressPortClickRef.current = true;
      }

      // ── Endpoint drag (move tool) — priorité absolue ─────────────────────────
      if (endpointDragRef.current) {
        const rect = el.getBoundingClientRect();
        const { pan: p, zoom: z } = viewRef.current;
        const cx = (e.clientX - rect.left - p.x) / z;
        const cy = (e.clientY - rect.top - p.y) / z;
        const drag = endpointDragRef.current;
        // Snap : port libre le plus proche dans SNAP_RADIUS, en excluant le port d'origine
        const gpc = getPortCenterRef.current;
        const allPorts = slotPortsRef.current;
        let bestDist = SNAP_RADIUS;
        let bestTarget: { slotId: string; portIndex: number } | null = null;
        // Seule cible refusée : l'AUTRE extrémité du même câble (les deux bouts
        // sur le même port = câble dégénéré). Un port déjà câblé par une autre
        // liaison reste une cible valide — la validation signale le doublon.
        const isOwnOtherEnd = (sid: string, portIdx: number) => {
          const c = resolvedConnectionsRef.current.find((x) => x.id === drag.connId);
          if (!c) return false;
          return drag.side === "from"
            ? c.toSlotId === sid && c.toConnectorIndex === portIdx
            : c.fromSlotId === sid && c.fromConnectorIndex === portIdx;
        };
        if (gpc && allPorts) {
          // Centres mémoïsés (cf. getSnapCenters) — la boucle tourne à chaque move.
          for (const center of getSnapCenters()) {
            if (
              center.slotId === drag.originalSlotId &&
              center.portIndex === drag.originalPortIndex
            )
              continue;
            if (isOwnOtherEnd(center.slotId, center.portIndex)) continue;
            const dist = Math.hypot(center.x - cx, center.y - cy);
            if (dist < bestDist) {
              bestDist = dist;
              bestTarget = { slotId: center.slotId, portIndex: center.portIndex };
            }
          }
        }
        // Ports virtuels des adaptateurs (côté "sortie" libre + côté "anchor" non-attaché)
        if (gpc) {
          const adList = adaptersForSnapRef.current;
          for (const ad of adList) {
            const flipped = ad.attachedSide === "left";
            const anchorSide: "left" | "right" = flipped ? "right" : "left";
            const countSide = (side: "left" | "right") => {
              const dbInputs = ad.adapter.inputs ?? [];
              const dbOutputs = ad.adapter.outputs ?? [];
              const entries =
                side === "left" ? (flipped ? dbOutputs : dbInputs) : flipped ? dbInputs : dbOutputs;
              return entries.reduce((s, e) => s + (e.quantity ?? 1), 0);
            };
            for (const side of ["left", "right"] as const) {
              const vsid = adapterVirtualSlotId(ad.id, side);
              const n = countSide(side);
              for (let portIdx = 0; portIdx < n; portIdx++) {
                // Skip port ancre (attaché à l'équipement)
                if (ad.attachedSlotId && side === anchorSide && portIdx === 0) continue;
                if (vsid === drag.originalSlotId && portIdx === drag.originalPortIndex) continue;
                if (isOwnOtherEnd(vsid, portIdx)) continue;
                const center = gpc(vsid, portIdx);
                if (!center) continue;
                const dist = Math.hypot(center.x - cx, center.y - cy);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestTarget = { slotId: vsid, portIndex: portIdx };
                }
              }
            }
          }
        }
        // Compat check : compare le port cible (bestTarget) avec l'AUTRE extrémité
        // (qui reste fixe). CT match + direction ok via incompatReason.
        let snapIncompat = false;
        let snapIncompatMsg: string | null = null;
        if (bestTarget) {
          const conn = resolvedConnectionsRef.current.find((c) => c.id === drag.connId);
          if (conn) {
            const otherSlotId = drag.side === "from" ? conn.toSlotId : conn.fromSlotId;
            const otherPortIdx =
              drag.side === "from" ? conn.toConnectorIndex : conn.fromConnectorIndex;
            const otherPorts = getPortsForSlotOrAdapterRef.current(otherSlotId);
            const otherPort = otherPorts.find((p) => p.portIndex === otherPortIdx);
            const dstPorts = getPortsForSlotOrAdapterRef.current(bestTarget.slotId);
            const dstPort = dstPorts.find((p) => p.portIndex === bestTarget.portIndex);
            if (otherPort && dstPort) {
              const msg = incompatReason(
                otherPort,
                dstPort,
                bestTarget.slotId,
                panelPortDirsRef.current,
                false,
                ipSignalNames,
              );
              if (msg) {
                snapIncompat = true;
                snapIncompatMsg = msg;
                setIncompatTooltipRef.current({ msg, x: e.clientX, y: e.clientY });
              } else {
                setIncompatTooltipRef.current(null);
              }
            }
          }
        } else {
          setIncompatTooltipRef.current(null);
        }
        setEndpointDrag((prev) =>
          prev
            ? { ...prev, cursor: { x: cx, y: cy }, snap: bestTarget, snapIncompat, snapIncompatMsg }
            : null,
        );
        return;
      }

      if (drawingZoneRef.current) {
        const rect = el.getBoundingClientRect();
        const { pan: p, zoom: z } = viewRef.current;
        const cx = (e.clientX - rect.left - p.x) / z;
        const cy = (e.clientY - rect.top - p.y) / z;
        setDrawingZone((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            x: Math.min(prev.sx, cx),
            y: Math.min(prev.sy, cy),
            w: Math.abs(cx - prev.sx),
            h: Math.abs(cy - prev.sy),
          };
        });
        return;
      }
      if (drawingLabelRef.current) {
        const rect = el.getBoundingClientRect();
        const { pan: p, zoom: z } = viewRef.current;
        const cx = (e.clientX - rect.left - p.x) / z;
        const cy = (e.clientY - rect.top - p.y) / z;
        setDrawingLabel((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            x: Math.min(prev.sx, cx),
            y: Math.min(prev.sy, cy),
            w: Math.abs(cx - prev.sx),
            h: Math.abs(cy - prev.sy),
          };
        });
        return;
      }
      if (panDragRef.current.active) {
        const nx = panDragRef.current.ox + (e.clientX - panDragRef.current.sx);
        const ny = panDragRef.current.oy + (e.clientY - panDragRef.current.sy);
        viewRef.current = { ...viewRef.current, pan: { x: nx, y: ny } };
        setPan({ x: nx, y: ny });
      }
      if (rubberBandRef.current?.active && pointerMovedRef.current) {
        const rect = el.getBoundingClientRect();
        const { sx, sy } = rubberBandRef.current;
        const x2 = e.clientX - rect.left;
        const y2 = e.clientY - rect.top;
        setRubberBand({ x1: sx, y1: sy, x2, y2 });
        // Live preview: update hits during drag (câbles, zones, labels)
        setPreviewConnIds(computeRubberBandHits(sx, sy, x2, y2));
        const { pan: p, zoom: z } = viewRef.current;
        const rx1 = (Math.min(sx, x2) - p.x) / z;
        const rx2 = (Math.max(sx, x2) - p.x) / z;
        const ry1 = (Math.min(sy, y2) - p.y) / z;
        const ry2 = (Math.max(sy, y2) - p.y) / z;
        const zHits = new Set<string>();
        for (const z0 of zones) {
          if (z0.x < rx2 && z0.x + z0.w > rx1 && z0.y < ry2 && z0.y + z0.h > ry1) zHits.add(z0.id);
        }
        setPreviewZoneIds(zHits);
        const lHits = new Set<string>();
        for (const lbl of canvasLabels) {
          const lx1 = lbl.x - 8,
            ly1 = lbl.y - 8;
          const lx2 = lbl.x + (lbl.text?.length ?? 1) * (lbl.fontSize ?? 14) * 0.6 + 8;
          const ly2 = lbl.y + (lbl.fontSize ?? 14) + 8;
          if (lx1 < rx2 && lx2 > rx1 && ly1 < ry2 && ly2 > ry1) lHits.add(lbl.id);
        }
        setPreviewLabelIds(lHits);
        // Preview live pour les ExternalPort (bulle + trait).
        const extHits = new Set<string>();
        const segHitsRect2 = (
          ax: number,
          ay: number,
          bx: number,
          by: number,
        ): boolean => {
          const ptIn = (px: number, py: number) =>
            px >= rx1 && px <= rx2 && py >= ry1 && py <= ry2;
          if (ptIn(ax, ay) || ptIn(bx, by)) return true;
          const edges = [
            [rx1, ry1, rx2, ry1],
            [rx2, ry1, rx2, ry2],
            [rx2, ry2, rx1, ry2],
            [rx1, ry2, rx1, ry1],
          ] as const;
          for (const [ex1, ey1, ex2, ey2] of edges) {
            const d = (bx - ax) * (ey2 - ey1) - (by - ay) * (ex2 - ex1);
            if (Math.abs(d) < 1e-10) continue;
            const t = ((ex1 - ax) * (ey2 - ey1) - (ey1 - ay) * (ex2 - ex1)) / d;
            const u = ((ex1 - ax) * (by - ay) - (ey1 - ay) * (bx - ax)) / d;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
          }
          return false;
        };
        const OFFSET_EXT = 80;
        const BOX_H_EXT2 = 18;
        for (const ext of externalPortsRef.current) {
          const virt = realToVirtual(ext.slotId, ext.portIndex, activeSlots);
          const center = getPortCenterRef.current?.(virt.slotId, virt.portIndex);
          if (!center) continue;
          // Même source de vérité que le rendu (badge EXT inclus).
          const BOX_W = externalBubble(ext).width;
          const lx =
            center.side === "left"
              ? center.x - OFFSET_EXT - BOX_W / 2
              : center.x + OFFSET_EXT + BOX_W / 2;
          const ly = center.y;
          const bxl = lx - BOX_W / 2;
          const bxr = lx + BOX_W / 2;
          const byt = ly - BOX_H_EXT2 / 2;
          const byb = ly + BOX_H_EXT2 / 2;
          const boxHit = bxl < rx2 && bxr > rx1 && byt < ry2 && byb > ry1;
          const lineX2 = center.side === "left" ? bxr : bxl;
          const segHit = segHitsRect2(center.x, center.y, lineX2, ly);
          if (boxHit || segHit) extHits.add(ext.id);
        }
        setPreviewExternalIds(extHits);
        // Preview live des nodes (équipements/panels/accessoires). Même hit-
        // test que dans applyRubberBandSelection (cohérence visuelle entre
        // preview et commit final).
        const nHits = new Set<string>();
        const spm = slotPortsRef.current ?? new Map<string, Port[]>();
        for (const s of expandedSlots) {
          if (isSlotLockedRef.current(s.id)) continue;
          const pos = positionsRef.current.get(s.id);
          if (!pos) continue;
          const nodeW = s.panel ? PANEL_NODE_W : NODE_W;
          const ports = spm.get(s.id) ?? [];
          let lefts = 0;
          let rights = 0;
          for (const p of ports) {
            if (p.side === "left") lefts++;
            else rights++;
          }
          const maxP = Math.max(lefts, rights, 1);
          const nodeH = NODE_HEADER_H + Math.max(NODE_MIN_H, maxP * PORT_H);
          if (pos.x < rx2 && pos.x + nodeW > rx1 && pos.y < ry2 && pos.y + nodeH > ry1) {
            nHits.add(s.id);
          }
        }
        setPreviewNodeIds(nHits);
      }
    };

    const onUp = (e: PointerEvent) => {
      // ── Drag-to-connect : relâcher sur un port pose le câble ────────────────
      // `dragging` n'est armé que par onMove : un clic sans déplacement ne
      // passe jamais ici et reste géré par le handler React du port.
      const down = cableDownRef.current;
      cableDownRef.current = null;
      const dragSrc = drawingFromRef.current;
      if (down?.dragging && toolRef.current === "cable" && dragSrc && !endpointDragRef.current) {
        // Cible recalculée depuis la position de relâchement : snapTarget peut
        // avoir une frame de retard (coalescence rAF).
        const hit = nearestPort(e.clientX, e.clientY);
        // Relâché sur le port d'origine (micro-drag) → on laisse le tracé armé.
        if (hit && !(hit.slotId === dragSrc.slotId && hit.portIndex === dragSrc.portIndex)) {
          handlePortClickRef.current?.(hit.slotId, hit.portIndex);
          suppressPortClickRef.current = true;
          return;
        }
      }

      // ── Endpoint drag drop (move tool) — priorité absolue ────────────────────
      if (endpointDragRef.current) {
        const drag = endpointDragRef.current;
        const snap = drag.snap;
        setIncompatTooltipRef.current(null);
        if (snap) {
          (async () => {
            try {
              // Port cible déjà câblé → confirmation, puis remplacement (le
              // câble déplacé n'est évidemment pas sa propre victime).
              const outcome = await confirmReplaceOnPortsRef.current?.(
                [{ slotId: snap.slotId, portIndex: snap.portIndex }],
                drag.connId,
              );
              if (outcome === "cancelled") return;
              // Incompatibilité CT/direction : on déplace quand même (politique
              // « aucun blocage de pose ») et on alerte — la validation temps
              // réel reprend l'anomalie.
              if (drag.snapIncompat) {
                pushToastRef.current(
                  [
                    drag.snapIncompatMsg?.split(" — ")[0] ?? "Connecteurs incompatibles",
                    "Déplacement appliqué — signalé par la validation",
                  ],
                  "warn",
                );
              }
              const body = devirtualizeEndpoint(
                snap.slotId,
                snap.portIndex,
                drag.side,
                activeSlots,
              );
              const dbConn = await cabling.patchOne(drag.connId, body);
              if (dbConn) {
                const updated = virtualizeConnection(dbConn, activeSlots);
                setConnections((prev) =>
                  prev.map((c) => (c.id === drag.connId ? { ...c, ...updated } : c)),
                );
              }
            } catch {
              // silent
            }
          })();
        }
        setEndpointDrag(null);
        return;
      }

      // Zone: commit if big enough, stay on zone tool
      if (drawingZoneRef.current) {
        const dz = drawingZoneRef.current;
        if (dz.w > 20 && dz.h > 20) {
          const id = `zone-${Date.now()}`;
          const topbarState = useTopbarActions.getState();
          const color =
            topbarState.zoneColor || ZONE_COLORS[Math.floor(Math.random() * ZONE_COLORS.length)];
          const defaultLabel = topbarState.zoneLabel || "Zone";
          const defaultPos = (topbarState.zoneLabelPosition ?? "top-left") as ZoneLabelPos;
          const zone: Zone = {
            id,
            x: dz.x,
            y: dz.y,
            w: dz.w,
            h: dz.h,
            label: defaultLabel,
            labelPosition: defaultPos,
            color,
          };
          pushHistoryRef.current?.();
          setZones((prev) => [...prev, zone]);
          createZoneApi(zone);
          selectOnly("zone", zone.id);
        }
        setDrawingZone(null);
        // Stay on zone tool — user explicitly switches away
        return;
      }

      // Label: commit if big enough
      if (drawingLabelRef.current) {
        const dl = drawingLabelRef.current;
        const MIN_SIZE = 10;
        const fontSize =
          dl.h > MIN_SIZE ? Math.round(Math.max(10, Math.min(dl.h * 0.75, 120))) : labelFontSize;
        const id = `label-${Date.now()}`;
        const draft: CanvasLabel = {
          id,
          text: "",
          x: dl.x,
          y: dl.y + fontSize,
          fontSize,
          color: labelColor,
          fontWeight: "normal",
          fontFamily: labelFont,
        };
        setLabelEditing({ mode: "create", draft });
        setDrawingLabel(null);
        // Stay on label tool — user explicitly switches away
        return;
      }

      // Pan: if pointer didn't move = simple click → deselect
      if (panDragRef.current.active) {
        panDragRef.current.active = false;
        if (!pointerMovedRef.current) {
          setSelectedNodeId(null);
          setSelectedConnId(null);
          setSelectedConnIds(new Set());
          setSelectedZoneId(null);
          setSelectedLabelId(null);
          setSelectedAdapterId(null);
          if (!drawingFromRef.current) {
            setDrawingFrom(null);
            setDrawingWaypoints([]);
          }
        }
      }

      // Select rubber-band: commit if dragged, otherwise just deselect
      if (rubberBandRef.current?.active) {
        rubberBandRef.current.active = false;
        if (pointerMovedRef.current) {
          setRubberBand((prev) => {
            if (prev)
              commitRubberBandRef.current = {
                ...prev,
                additive: rubberBandRef.current?.additive ?? false,
              };
            return null;
          });
          // previewConnIds is cleared in the commit useEffect
        } else {
          setRubberBand(null);
          setPreviewConnIds(new Set());
          setPreviewExternalIds(new Set());
          setPreviewNodeIds(new Set());
          setSelectedConnId(null);
          setSelectedConnIds(new Set());
          setSelectedZoneId(null);
          setSelectedLabelId(null);
          setSelectedAdapterId(null);
          setSelectedGuideKeys(new Set());
        }
      }
      void e;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Read CURRENT values from the ref (updated every render — never stale)
      const { pan: p, zoom: z } = viewRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newZ = Math.min(5, Math.max(0.1, z * factor));
      const ratio = newZ / z;
      const newPan = { x: mx - (mx - p.x) * ratio, y: my - (my - p.y) * ratio };
      // Update the ref immediately so rapid wheel events don't see stale values
      viewRef.current = { pan: newPan, zoom: newZ };
      setZoom(newZ);
      setPan(newPan);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [isVisible]); // re-attach when becoming visible (was hidden at mount)

  // ── Track mouse for drawing-cable preview + magnetic snap ────────────────────
  // NOTE: slotPortsRef is declared earlier (line ~282); assignment happens at line ~1732.
  const connWaypointsRef = useRef(connWaypoints);
  connWaypointsRef.current = connWaypoints;
  const drawingFromRef = useRef(drawingFrom);
  drawingFromRef.current = drawingFrom;
  const panelPortDirsRef = useRef(panelPortDirs);
  panelPortDirsRef.current = panelPortDirs;
  // Le tooltip d'incompatibilité n'est plus rendu en flottant (CursorHint prend
  // le relais) : seul `msg` est lu. On dédoublonne donc sur le message pour
  // éviter un setState (= re-render complet du synoptique) par pointermove.
  const setIncompatTooltipRef = useRef<
    (v: { msg: string; x: number; y: number } | null) => void
  >(() => {});
  setIncompatTooltipRef.current = useCallback(
    (v: { msg: string; x: number; y: number } | null) => {
      setIncompatTooltip((prev) => {
        if (!v) return prev === null ? prev : null;
        return prev && prev.msg === v.msg ? prev : v;
      });
    },
    [],
  );

  // ── Cache des centres de ports pour le snap magnétique ─────────────────────
  // getPortCenter refait des filtres par slot à chaque appel ; la boucle de
  // snap l'appelle pour CHAQUE port à chaque frame. On mémoïse la liste tant
  // que la géométrie (positions / ports / adaptateurs) n'a pas changé.
  const snapCentersRef = useRef<{
    keys: [unknown, unknown, unknown];
    list: { slotId: string; portIndex: number; x: number; y: number }[];
  } | null>(null);
  const getSnapCenters = useCallback(() => {
    const posMap = positionsRef.current;
    const portMap = slotPortsRef.current;
    const adList = adaptersRef.current;
    const cached = snapCentersRef.current;
    if (
      cached &&
      cached.keys[0] === posMap &&
      cached.keys[1] === portMap &&
      cached.keys[2] === adList
    )
      return cached.list;
    const gpc = getPortCenterRef.current;
    const list: { slotId: string; portIndex: number; x: number; y: number }[] = [];
    if (gpc && portMap) {
      for (const [sid, ports] of portMap) {
        for (const port of ports) {
          const c = gpc(sid, port.portIndex);
          if (c) list.push({ slotId: sid, portIndex: port.portIndex, x: c.x, y: c.y });
        }
      }
    }
    snapCentersRef.current = { keys: [posMap, portMap, adList], list };
    return list;
  }, []);

  useEffect(() => {
    if (!drawingFrom) {
      setSnapTarget(null);
      return;
    }
    // Coalescence rAF : un pointermove peut arriver à 120+ Hz, chaque setState
    // re-rend tout le synoptique. On ne traite que la dernière position par frame.
    let raf = 0;
    let pending: { clientX: number; clientY: number } | null = null;

    const process = (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { pan: p, zoom: z } = viewRef.current;
      const cx = (clientX - rect.left - p.x) / z;
      const cy = (clientY - rect.top - p.y) / z;

      // Magnetic snap — port le plus proche dans SNAP_RADIUS. Aucun filtre
      // métier : un port déjà câblé reste une cible valide (la validation
      // signalera le doublon), sinon la pose devient impossible.
      const df = drawingFromRef.current;
      if (!df) {
        setMousePos({ x: cx, y: cy });
        setSnapTarget(null);
        return;
      }
      const allPorts = slotPortsRef.current;
      if (!allPorts) {
        setMousePos({ x: cx, y: cy });
        setSnapTarget(null);
        return;
      }

      let bestDist = SNAP_RADIUS;
      let bestTarget: { slotId: string; portIndex: number } | null = null;
      for (const c of getSnapCenters()) {
        if (c.slotId === df.slotId && c.portIndex === df.portIndex) continue;
        const dist = Math.hypot(c.x - cx, c.y - cy);
        if (dist < bestDist) {
          bestDist = dist;
          bestTarget = { slotId: c.slotId, portIndex: c.portIndex };
        }
      }
      const snapHit = bestTarget;
      // Aimanté : l'aperçu du câble est ancré sur le centre du port, la
      // position souris n'est plus lue → on évite un re-render par frame.
      if (!snapHit || mousePosRef.current === null) setMousePos({ x: cx, y: cy });
      setSnapTarget((prev) => {
        if (prev === snapHit) return prev;
        if (
          prev &&
          snapHit &&
          prev.slotId === snapHit.slotId &&
          prev.portIndex === snapHit.portIndex
        )
          return prev;
        return snapHit;
      });

      // Incompat tooltip for snap target — not shown during multi phase 1 (source range selection)
      const inMultiPhase1 = multiSrcPortsRef.current && !multiSrcConfirmedRef.current;
      if (snapHit && !inMultiPhase1) {
        const srcPort = allPorts.get(df.slotId)?.find((pt) => pt.portIndex === df.portIndex);
        const dstPort = allPorts
          .get(snapHit.slotId)
          ?.find((pt) => pt.portIndex === snapHit.portIndex);
        if (srcPort && dstPort) {
          const msg = incompatReason(
            srcPort,
            dstPort,
            snapHit.slotId,
            panelPortDirsRef.current,
            isPortOccupiedRef.current?.(snapHit.slotId, snapHit.portIndex) ?? false,
            ipSignalNames,
          );
          if (msg) {
            setIncompatTooltipRef.current({ msg, x: clientX, y: clientY });
          } else {
            setIncompatTooltipRef.current(null);
          }
        } else {
          setIncompatTooltipRef.current(null);
        }
      } else {
        setIncompatTooltipRef.current(null);
      }

      // Multi hover tooltip: combien de ports destination consécutifs sont libres
      const msp = multiSrcPortsRef.current;
      const confirmed = multiSrcConfirmedRef.current;
      let nextMultiHover: { screenX: number; screenY: number; lines: string[] } | null = null;
      if (confirmed && msp && snapHit && snapHit.slotId !== msp.slotId) {
        const dstPorts = allPorts.get(snapHit.slotId) ?? [];
        const firstDst = dstPorts.find((pt) => pt.portIndex === snapHit.portIndex);
        if (firstDst) {
          const dstSidePorts = dstPorts
            .filter((pt) => pt.side === firstDst.side)
            .sort((a, b) => a.portIndex - b.portIndex);
          const startI = dstSidePorts.findIndex((pt) => pt.portIndex === snapHit.portIndex);
          const total = msp.portIndices.length;
          let free = 0;
          let busy = 0;
          for (let i = startI; i < dstSidePorts.length && free + busy < total; i++) {
            const dp = dstSidePorts[i];
            if (
              resolvedConnectionsRef.current.some(
                (c) =>
                  (c.fromSlotId === snapHit.slotId && c.fromConnectorIndex === dp.portIndex) ||
                  (c.toSlotId === snapHit.slotId && c.toConnectorIndex === dp.portIndex),
              )
            )
              busy++;
            else free++;
          }
          if (free + busy < total) {
            nextMultiHover = {
              screenX: clientX + 12,
              screenY: clientY + 12,
              lines: [
                `${free + busy} / ${total} ports disponibles`,
                "La plage s'arrête au dernier port de ce côté",
              ],
            };
          } else if (busy > 0) {
            nextMultiHover = {
              screenX: clientX + 12,
              screenY: clientY + 12,
              lines: [
                `${busy} / ${total} ports déjà câblés`,
                "Pose possible — doublons signalés par la validation",
              ],
            };
          }
        }
      }
      setMultiHoverTooltip((prev) => {
        if (!nextMultiHover) return prev === null ? prev : null;
        if (prev && prev.lines.join("|") === nextMultiHover.lines.join("|")) return prev;
        return nextMultiHover;
      });
    };

    const flush = () => {
      raf = 0;
      const ev = pending;
      pending = null;
      if (ev) process(ev.clientX, ev.clientY);
    };
    // pointermove et non mousemove : un pointerdown avec preventDefault (cf.
    // drag-to-connect) supprime les événements souris de compatibilité, le
    // fantôme se figerait pendant le drag.
    const onMove = (e: PointerEvent) => {
      pending = { clientX: e.clientX, clientY: e.clientY };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };

  }, [drawingFrom, getSnapCenters, ipSignalNames]);

  // ── Node drag ───────────────────────────────────────────────────────────────
  const nodeDragRef = useRef<{
    primaryId: string;
    startX: number;
    startY: number;
    /** ids effectivement draggés. Si single → [primaryId]. Si multi → tous
     *  les nodes sélectionnés non-lockés (incluant primaryId). Delta uniforme
     *  appliqué à chacun. */
    dragIds: string[];
    /** Positions originales au début du drag, pour chaque id. */
    origPositions: Map<string, { x: number; y: number }>;
    axisLock?: "x" | "y" | null;
  } | null>(null);
  const handleNodeDragStartRef = useRef<((slotId: string, e: React.PointerEvent) => void) | null>(
    null,
  );

  const handleNodeDragStart = useCallback(
    (slotId: string, e: React.PointerEvent) => {
      // Lock : autorise la sélection mais bloque tout démarrage de drag.
      if (isSlotLockedRef.current(slotId)) {
        selectOnly("node", slotId);
        return;
      }
      // En mode "select", on attend un mouvement > seuil avant de basculer en "move".
      // Un simple clic (sans mouvement) n'active pas le déplacement.
      if (toolRef.current === "select") {
        const startX = e.clientX;
        const startY = e.clientY;
        const THRESHOLD = 4;
        const onMove = (ev: PointerEvent) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (dx * dx + dy * dy < THRESHOLD * THRESHOLD) return;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          setToolRef.current("move");
          // Relance la séquence de drag en mode "move" avec l'événement d'origine.
          // Note : on passe un pseudo-event avec les coords de départ pour conserver l'offset.
          handleNodeDragStartRef.current?.(slotId, {
            ...e,
            clientX: startX,
            clientY: startY,
            stopPropagation: () => {},
          } as React.PointerEvent);
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp, { once: true });
        return;
      }
      if (toolRef.current !== "move") return;
      e.stopPropagation();
      // Push pre-drag snapshot for undo/redo (capture positions/waypoints before mutation)
      history.push(captureSnapshot());

      // ── Détermine les ids à drag : multi si slotId fait partie du set
      //    sélectionné (et le set contient >1 entrée), sinon single.
      const multiSet = selectedNodeIdsRef.current;
      const isMulti = multiSet.size > 1 && multiSet.has(slotId);
      const dragIds: string[] = isMulti
        ? Array.from(multiSet).filter((id) => !isSlotLockedRef.current(id))
        : [slotId];
      // Garantit que primaryId est dans dragIds (si pas lock).
      if (!dragIds.includes(slotId)) dragIds.push(slotId);

      const origPositions = new Map<string, { x: number; y: number }>();
      for (const id of dragIds) {
        const p = positionsRef.current.get(id) ?? { x: 0, y: 0 };
        origPositions.set(id, { x: p.x, y: p.y });
      }
      const dragSet = new Set(dragIds);

      // Snapshot original waypoints + port centers pour TOUS les câbles touchés.
      // Un câble est "touché" si AU MOINS UN endpoint est dans dragSet.
      // Cas particulier "fullyInside" : si from ET to sont dans dragSet → on
      // translate tous les waypoints en bloc (pas d'ajustement de stub).
      const origWaypoints = new Map<string, { x: number; y: number }[]>();
      const origPortCenters = new Map<
        string,
        {
          from: { x: number; y: number; side: "left" | "right" } | null;
          to: { x: number; y: number; side: "left" | "right" } | null;
        }
      >();
      const connFullyInside = new Set<string>();
      for (const conn of resolvedConnectionsRef.current) {
        const fromIn = dragSet.has(conn.fromSlotId);
        const toIn = dragSet.has(conn.toSlotId);
        if (!fromIn && !toIn) continue;
        const wpts = connWaypointsRef.current.get(conn.id);
        if (wpts && wpts.length > 0)
          origWaypoints.set(
            conn.id,
            wpts.map((p) => ({ ...p })),
          );
        origPortCenters.set(conn.id, {
          from: getPortCenterRef.current?.(conn.fromSlotId, conn.fromConnectorIndex) ?? null,
          to: getPortCenterRef.current?.(conn.toSlotId, conn.toConnectorIndex) ?? null,
        });
        if (fromIn && toIn) connFullyInside.add(conn.id);
      }

      const primaryOrig = origPositions.get(slotId) ?? { x: 0, y: 0 };
      nodeDragRef.current = {
        primaryId: slotId,
        startX: e.clientX,
        startY: e.clientY,
        dragIds,
        origPositions,
      };
      setDraggingNodeId(slotId);

      // Given a delta (dx,dy), ajuste les waypoints :
      //  - câble fully-inside : translate tous les waypoints en bloc
      //  - câble half-inside : ajuste le stub côté node draggé (logique
      //    historique single-drag), depuis le snapshot original.
      const fixWaypoints = (dx: number, dy: number) => {
        if (origWaypoints.size === 0) return;
        setConnWaypoints((prev) => {
          const next = new Map(prev);
          for (const conn of resolvedConnectionsRef.current) {
            const orig = origWaypoints.get(conn.id);
            if (!orig || orig.length === 0) continue;
            const fromIn = dragSet.has(conn.fromSlotId);
            const toIn = dragSet.has(conn.toSlotId);
            if (!fromIn && !toIn) continue;
            const n = orig.length;
            // Fully inside : translation pure.
            if (connFullyInside.has(conn.id)) {
              next.set(
                conn.id,
                orig.map((p) => ({ x: p.x + dx, y: p.y + dy })),
              );
              continue;
            }

            const centers = origPortCenters.get(conn.id);
            const updated = orig.map((p) => ({ ...p }));

            // Half-inside : ajuste uniquement le stub côté draggé. Reprend
            // l'alignement strict (cf. logique historique conservée).
            if (fromIn && !toIn && centers?.from) {
              const { x: px, y: py } = centers.from;
              const seg0Horiz = Math.abs(orig[0].y - py) < Math.abs(orig[0].x - px);
              updated[0] = seg0Horiz
                ? { x: orig[0].x, y: py + dy }
                : { x: px + dx, y: orig[0].y };
            } else if (toIn && !fromIn && centers?.to) {
              const { x: px, y: py } = centers.to;
              const segNHoriz = Math.abs(orig[n - 1].y - py) < Math.abs(orig[n - 1].x - px);
              updated[n - 1] = segNHoriz
                ? { x: orig[n - 1].x, y: py + dy }
                : { x: px + dx, y: orig[n - 1].y };
            }

            next.set(conn.id, updated);
          }
          return next;
        });
      };

      const onMove = (ev: PointerEvent) => {
        if (!nodeDragRef.current || nodeDragRef.current.primaryId !== slotId) return;
        const drag = nodeDragRef.current;
        const { startX, startY } = drag;
        const z = viewRef.current.zoom;
        let dx = (ev.clientX - startX) / z;
        let dy = (ev.clientY - startY) / z;
        if (ev.shiftKey) {
          if (!drag.axisLock && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
            drag.axisLock = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
          }
          if (drag.axisLock === "x") dy = 0;
          else if (drag.axisLock === "y") dx = 0;
        } else {
          drag.axisLock = null;
        }
        const snap = useTopbarActions.getState();
        // Snap basé sur le primaryId (référence stable du drag). Le delta
        // effectif est ensuite appliqué uniformément à tous les ids.
        const snapped = snapIf(
          primaryOrig.x + dx,
          primaryOrig.y + dy,
          snap.gridStep,
          snap.snapEnabled,
        );
        const effectiveDx = snapped.x - primaryOrig.x;
        const effectiveDy = snapped.y - primaryOrig.y;
        setPositions((prev) => {
          const next = new Map(prev);
          for (const id of drag.dragIds) {
            const orig = drag.origPositions.get(id);
            if (!orig) continue;
            next.set(id, { x: orig.x + effectiveDx, y: orig.y + effectiveDy });
          }
          return next;
        });
        fixWaypoints(effectiveDx, effectiveDy);
      };
      const onUp = (ev: PointerEvent) => {
        if (!nodeDragRef.current || nodeDragRef.current.primaryId !== slotId) return;
        const drag = nodeDragRef.current;
        const { startX, startY } = drag;
        const z = viewRef.current.zoom;
        let dx = (ev.clientX - startX) / z;
        let dy = (ev.clientY - startY) / z;
        if (drag.axisLock === "x") dy = 0;
        else if (drag.axisLock === "y") dx = 0;
        const snap = useTopbarActions.getState();
        const snapped = snapIf(
          primaryOrig.x + dx,
          primaryOrig.y + dy,
          snap.gridStep,
          snap.snapEnabled,
        );
        const effectiveDx = snapped.x - primaryOrig.x;
        const effectiveDy = snapped.y - primaryOrig.y;
        // Final update — même si snap n'a rien changé, on consolide.
        setPositions((prev) => {
          const next = new Map(prev);
          for (const id of drag.dragIds) {
            const orig = drag.origPositions.get(id);
            if (!orig) continue;
            next.set(id, { x: orig.x + effectiveDx, y: orig.y + effectiveDy });
          }
          return next;
        });
        nodeDragRef.current = null;
        setDraggingNodeId(null);

        // Persist waypoints DB pour tous les câbles touchés.
        const curWaypoints = connWaypointsRef.current;
        for (const conn of resolvedConnectionsRef.current) {
          if (!dragSet.has(conn.fromSlotId) && !dragSet.has(conn.toSlotId)) continue;
          const wpts = curWaypoints.get(conn.id);
          if (wpts && wpts.length > 0) {
            cabling.patchOne(conn.id, { waypoints: wpts }).catch(console.error);
          }
        }
        // Persist positions DB pour TOUS les ids draggés.
        for (const id of drag.dragIds) {
          const orig = drag.origPositions.get(id);
          if (!orig) continue;
          const nx = orig.x + effectiveDx;
          const ny = orig.y + effectiveDy;
          if (isPanelVirtualId(id)) {
            const info = getVirtualRowInfo(id);
            if (info && !isGeneralMode) {
              apiFetch(`/api/racks/${rackForRef.current(info.slotId)}/panel-rows`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  slotId: info.slotId,
                  rowIndex: info.rowIdx,
                  x: nx,
                  y: ny,
                }),
              }).catch(console.error);
            }
          } else {
            cabling.persistSlotPosition(id, nx, ny).catch(console.error);
          }
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    },
    [rackId, history, captureSnapshot],
  );
  handleNodeDragStartRef.current = handleNodeDragStart;

  // ── Helper: check port occupation ──────────────────────────────────────────
  const isPortOccupied = useCallback(
    (sid: string, pi: number) =>
      resolvedConnectionsRef.current.some(
        (c) =>
          (c.fromSlotId === sid && c.fromConnectorIndex === pi) ||
          (c.toSlotId === sid && c.toConnectorIndex === pi),
      ),
    [],
  );
  isPortOccupiedRef.current = isPortOccupied;
  slotPortsRef.current = slotPorts;

  // ── Bridge multi-nodes (équipements) → parent ────────────────────────────
  // Émis à chaque changement du Set selectedNodeIds. nodeCount = taille du
  // set ; rackCount = 1 en focus rack, = nodeCount en général (1 node = 1
  // rack en mode général).
  //
  // ⚠️ Garde anti-boucle : on n'appelle le parent QUE si nodeCount ou rackCount
  // change réellement. Sinon, créer un nouvel objet `{nodeCount, rackCount}` à
  // chaque render déclenche un re-render parent (nouvelle référence), qui
  // re-render le SynopticView, qui recalcule layerItems, qui re-tire le
  // useEffect → loop infinie. La valeur précédente est tracée via un ref.
  const lastMultiNodeRef = useRef<{ nodeCount: number; rackCount: number }>({
    nodeCount: 0,
    rackCount: 0,
  });
  useEffect(() => {
    if (!onMultiNodeSelectionChange) return;
    const nodeCount = selectedNodeIds.size;
    // Vue lieu : les nœuds appartiennent à plusieurs contenants — on compte les
    // contenants distincts de la sélection.
    const rackCount = isGeneralMode
      ? nodeCount
      : isLocationMode
        ? new Set([...selectedNodeIds].map((id) => rackForRef.current(id))).size
        : nodeCount > 0
          ? 1
          : 0;
    const prev = lastMultiNodeRef.current;
    if (prev.nodeCount === nodeCount && prev.rackCount === rackCount) return;
    lastMultiNodeRef.current = { nodeCount, rackCount };
    onMultiNodeSelectionChange({ nodeCount, rackCount });
  }, [selectedNodeIds, isGeneralMode, isLocationMode, onMultiNodeSelectionChange]);

  // ── Bridge multi-câbles → parent ───────────────────────────────────────────
  useEffect(() => {
    if (!onMultiCableSelectionChange) return;
    if (selectedConnIds.size === 0) {
      onMultiCableSelectionChange([]);
      return;
    }
    const summaries: CableSummary[] = [];
    for (const id of selectedConnIds) {
      const conn = connections.find((c) => c.id === id);
      if (!conn) continue;
      const rconn = resolvedConnections.find((c) => c.id === id) ?? conn;
      // Résoudre l'endpoint source en passant par l'adapter si besoin
      const resolveDisplayEndpoint = (
        slotId: string,
        portIndex: number,
      ): { slotId: string; portIndex: number } => {
        const ad = parseAdapterSlotId(slotId);
        if (!ad) return { slotId, portIndex };
        const adp = adapters.find((a) => a.id === ad.adapterId);
        if (!adp || !adp.attachedSlotId || adp.attachedPortIndex == null)
          return { slotId, portIndex };
        return { slotId: adp.attachedSlotId, portIndex: adp.attachedPortIndex };
      };
      const fromDisp = resolveDisplayEndpoint(rconn.fromSlotId, rconn.fromConnectorIndex);
      const toDisp = resolveDisplayEndpoint(rconn.toSlotId, rconn.toConnectorIndex);
      const fromPort = slotPorts
        .get(fromDisp.slotId)
        ?.find((p) => p.portIndex === fromDisp.portIndex);
      const toPort = slotPorts.get(toDisp.slotId)?.find((p) => p.portIndex === toDisp.portIndex);
      // Fallback sur toPort : un port switching/transit n'a pas de signal
      // propre — il transporte celui du pair.
      const signalName =
        fromPort?.entry.signalName ??
        toPort?.entry.signalName ??
        fromPort?.entry.label ??
        toPort?.entry.label ??
        fromPort?.ct?.name ??
        null;
      // Couleur câble = couleur sémantique du signal résolu (priorité) avant
      // la couleur physique du connecteur. Permet aux câbles passant par un
      // switch (signal vide d'un côté) d'adopter la couleur du signal du pair.
      const sigColor = signalName ? sigColorByName[signalName] : undefined;
      const color =
        conn.color ?? sigColor ?? fromPort?.ct?.color ?? toPort?.ct?.color ?? "#94a3b8";
      summaries.push({
        id: conn.id,
        label: conn.label ?? null,
        color,
        signalName,
        catalogCableModelId:
          (rconn as { catalogCableModelId?: string | null })
            .catalogCableModelId ?? null,
        cableStyle:
          (connStyles.get(conn.id) as "ortho" | "rounded" | "arrow" | undefined) ??
          null,
      });
    }
    onMultiCableSelectionChange(summaries);
  }, [
    selectedConnIds,
    connections,
    resolvedConnections,
    adapters,
    slotPorts,
    // connStyles doit être dans les deps pour que les summaries soient
    // re-générées après un changement de style — sinon le segmented multi
    // (focus rack ET général) garde son ancien commonStyle actif visuellement.
    connStyles,
    onMultiCableSelectionChange,
  ]);

  // ── Bridge ExternalPort selection → parent right panel ───────────────────
  // Single (selectedExternalId) → CableSelectionDetails-like
  useEffect(() => {
    if (!onExternalDetailsChange) return;
    if (!selectedExternalId || selectedExternalIds.size > 1) {
      onExternalDetailsChange(null);
      return;
    }
    const ext = externalPorts.find((e) => e.id === selectedExternalId);
    if (!ext) {
      onExternalDetailsChange(null);
      return;
    }
    const virt = realToVirtual(ext.slotId, ext.portIndex, activeSlots);
    const slot = expandedSlots.find((s) => s.id === virt.slotId);
    const ports = slotPorts.get(virt.slotId) ?? [];
    const portInfo = ports.find((p) => p.portIndex === virt.portIndex);
    const slotName =
      slot?.label ?? slot?.panel?.name ?? slot?.equipment?.name ?? "—";
    const dirRaw = portInfo?.entry.direction;
    const direction: "IN" | "OUT" | "BIDIR" | null =
      dirRaw === "IN" || dirRaw === "OUT" || dirRaw === "BIDIR" ? dirRaw : null;
    const extKind = externalPortKind(ext);
    const isWorld = extKind === "MONDE";
    const data: ExternalPortSelectionDetails = {
      id: ext.id,
      kind: extKind,
      // Sur un port MONDE, `label` porte l'étiquette libre (pas un numéro de
      // câble) → l'entête n'affiche que la numérotation résolue s'il y en a une.
      label: isWorld
        ? (ext.targetCableLabel?.trim() || null)
        : ext.label?.trim() || ext.targetCableLabel?.trim() || null,
      worldLabel: isWorld ? (ext.label?.trim() || null) : null,
      color: portInfo?.ct?.color ?? "#94a3b8",
      signalName: portInfo?.entry.signalName ?? null,
      notes: null,
      connectorTypeName: portInfo?.ct?.name ?? null,
      from: {
        slotName,
        portLabel: portInfo?.entry.signalName ?? portInfo?.entry.label ?? null,
        portNum: virt.portIndex + 1,
        connectorLabel: portInfo
          ? (portInfo.entry.label ?? portInfo.ct?.name ?? "") +
            (portInfo.totalUnits > 1 ? ` ${portInfo.unitIndex + 1}` : "")
          : null,
        direction,
      },
      targetLabel: ext.targetLabel ?? null,
    };
    onExternalDetailsChange(data);
  }, [
    onExternalDetailsChange,
    selectedExternalId,
    selectedExternalIds,
    externalPorts,
    activeSlots,
    expandedSlots,
    slotPorts,
  ]);

  // Multi (selectedExternalIds.size > 1) → summaries
  useEffect(() => {
    if (!onMultiExternalSelectionChange) return;
    if (selectedExternalIds.size <= 1) {
      onMultiExternalSelectionChange([]);
      return;
    }
    const summaries: ExternalPortSummary[] = [];
    for (const id of selectedExternalIds) {
      const ext = externalPorts.find((e) => e.id === id);
      if (!ext) continue;
      const virt = realToVirtual(ext.slotId, ext.portIndex, activeSlots);
      const ports = slotPorts.get(virt.slotId) ?? [];
      const portInfo = ports.find((p) => p.portIndex === virt.portIndex);
      summaries.push({
        id: ext.id,
        label: ext.label ?? null,
        color: portInfo?.ct?.color ?? "#94a3b8",
        signalName: portInfo?.entry.signalName ?? null,
        targetLabel: ext.targetLabel ?? null,
      });
    }
    onMultiExternalSelectionChange(summaries);
  }, [
    onMultiExternalSelectionChange,
    selectedExternalIds,
    externalPorts,
    activeSlots,
    slotPorts,
  ]);

  // ── Helper: récupère les ports d'un slot OU d'un adaptateur (via virtual ID) ─
  // Pour les adaptateurs (slotId = "__a__:<adapterId>:<side>"), on construit la liste
  // de Port à la volée depuis `adapters[].adapter.inputs/outputs`.
  // Un adaptateur est **passif** : les ports du côté « sortie » (opposé à l'anchor attaché)
  // héritent du `signalName` et de la `direction` du port équipement source. Seul le
  // `connectorTypeId` reste propre à la sortie adapter. Cela permet aux checks de compat
  // (incompatReason) standard de fonctionner directement sans override de signal.
  const getPortsForSlotOrAdapter = useCallback(
    (sid: string): Port[] => {
      const ad = parseAdapterSlotId(sid);
      if (!ad) return slotPorts.get(sid) ?? [];
      const adp = adapters.find((a) => a.id === ad.adapterId);
      if (!adp) return [];
      const dbInputs = adp.adapter.inputs ?? [];
      const dbOutputs = adp.adapter.outputs ?? [];
      // En mode flipped (attaché côté gauche d'un eqp), les inputs/outputs visuels sont inversés.
      const flipped = adp.attachedSide === "left";
      const entries =
        ad.side === "left" ? (flipped ? dbOutputs : dbInputs) : flipped ? dbInputs : dbOutputs;
      const portSide: "left" | "right" = ad.side;

      // Résoudre le port équipement source (anchor) pour hériter signalName + direction
      // sur les ports du côté « sortie ». Le côté anchor visuel est `attachedSide`
      // (flipped → right, sinon left). Les ports du côté « anchor » n'ont pas besoin
      // d'être validés (le dot anchor est marqué occupied et non-cliquable côté rendu).
      const anchorSide: "left" | "right" = flipped ? "right" : "left";
      const isOutputSide = ad.side !== anchorSide;
      let srcSignalName: string | undefined;
      let srcDirection: string | undefined;
      if (isOutputSide && adp.attachedSlotId && adp.attachedPortIndex != null) {
        const attachedPorts = slotPorts.get(adp.attachedSlotId) ?? [];
        const attachedPort = attachedPorts.find((pp) => pp.portIndex === adp.attachedPortIndex);
        if (attachedPort) {
          srcSignalName = attachedPort.entry.signalName;
          srcDirection = attachedPort.entry.direction;
        }
      }

      const out: Port[] = [];
      let portIdx = 0;
      entries.forEach((e, entryIndex) => {
        const qty = e.quantity ?? 1;
        for (let u = 0; u < qty; u++) {
          const entry: ConnectorEntry = {
            connectorTypeId: e.connectorTypeId,
            quantity: qty,
            label: e.label,
            // Héritage : côté sortie = se comporte comme le port équipement source,
            // seul le connectorTypeId change. Côté anchor = non-cliquable, peu importe.
            signalName: srcSignalName,
            direction: srcDirection,
          };
          const ctInfo = e.connectorTypeId
            ? (connectorTypes.find((ct) => ct.id === e.connectorTypeId) ?? null)
            : null;
          out.push({
            portIndex: portIdx,
            entryIndex,
            unitIndex: u,
            totalUnits: qty,
            entry,
            ct: ctInfo,
            side: portSide,
          });
          portIdx++;
        }
      });
      return out;
    },
    [slotPorts, adapters, connectorTypes],
  );

  // Refs for use inside window listeners (adapter drag, endpoint drag)
  const getPortsForSlotOrAdapterRef = useRef(getPortsForSlotOrAdapter);
  getPortsForSlotOrAdapterRef.current = getPortsForSlotOrAdapter;
  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;

  // ── Remplacement sur port déjà câblé ────────────────────────────────────────
  // Politique : un port ne porte jamais deux câbles. Viser un port occupé n'est
  // pas refusé — on demande confirmation, puis la pose REMPLACE (suppression
  // des liaisons existantes sur ce port, quelle que soit l'extrémité).
  const askConfirm = useOptionalConfirm();

  /** Connexions occupant l'un des ports visés (from OU to). */
  const connectionsOnPorts = useCallback(
    (ports: { slotId: string; portIndex: number }[]) => {
      const keys = new Set(ports.map((p) => `${p.slotId}:${p.portIndex}`));
      return resolvedConnectionsRef.current.filter(
        (c) =>
          keys.has(`${c.fromSlotId}:${c.fromConnectorIndex}`) ||
          keys.has(`${c.toSlotId}:${c.toConnectorIndex}`),
      );
    },
    [],
  );

  /**
   * Libère les ports visés après confirmation.
   *
   * - `"free"`      : aucun port occupé, rien à faire (l'appelant pousse sa
   *                   propre entrée d'historique).
   * - `"replaced"`  : câbles existants supprimés. L'entrée d'historique a été
   *                   poussée AVANT la suppression → l'appelant ne doit PAS en
   *                   pousser une seconde, pour qu'un seul undo restaure les
   *                   câbles supprimés et retire la nouvelle pose.
   * - `"cancelled"` : l'utilisateur a refusé, aucune mutation.
   */
  const confirmReplaceOnPorts = useCallback(
    async (
      ports: { slotId: string; portIndex: number }[],
      excludeConnId?: string,
    ): Promise<"free" | "replaced" | "cancelled"> => {
      const victims = connectionsOnPorts(ports).filter((c) => c.id !== excludeConnId);
      if (victims.length === 0) return "free";
      if (askConfirm) {
        const labels = victims.map((c) => c.label?.trim()).filter((l): l is string => !!l);
        const shown = labels.slice(0, 6).join(", ");
        const rest = labels.length > 6 ? ` (+${labels.length - 6})` : "";
        const occupiedPorts = new Set(
          victims.flatMap((c) => [
            `${c.fromSlotId}:${c.fromConnectorIndex}`,
            `${c.toSlotId}:${c.toConnectorIndex}`,
          ]),
        );
        const manyPorts =
          ports.filter((p) => occupiedPorts.has(`${p.slotId}:${p.portIndex}`)).length > 1;
        const description =
          victims.length === 1 ? (
            labels.length === 1 ? (
              <>
                Le câble <strong>{labels[0]}</strong> branché sur ce port sera supprimé.
              </>
            ) : (
              <>Le câble existant branché sur ce port sera supprimé.</>
            )
          ) : (
            <>
              <strong>{victims.length} câbles</strong> branchés sur ces ports seront supprimés
              {labels.length > 0 ? ` : ${shown}${rest}` : ""}.
            </>
          );
        const ok = await askConfirm({
          title: manyPorts ? "Ports déjà câblés" : "Port déjà câblé",
          description,
          variant: "destructive",
          confirmLabel: "Remplacer",
          cancelLabel: "Annuler",
        });
        if (!ok) return "cancelled";
      }
      // Snapshot AVANT suppression : undo unique pour suppression + pose.
      // Hors mono-rack, `restoreSnapshot` sort avant la synchro DB (le diff est
      // mono-rack et ne sait pas router par contenant) : l'undo ne restaurerait
      // rien en base. On préfère ne pas empiler d'entrée trompeuse et le dire.
      if (isAggregate) {
        pushToast("Remplacement définitif — annulation indisponible dans cette vue", "warn");
      } else {
        pushHistoryRef.current?.();
      }
      const ids = victims.map((c) => c.id);
      const idSet = new Set(ids);
      setConnections((prev) => prev.filter((c) => !idSet.has(c.id)));
      setConnStyles((prev) => {
        const next = new Map(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setConnWaypoints((prev) => {
        const next = new Map(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setSelectedConnId((prev) => (prev && idSet.has(prev) ? null : prev));
      setSelectedConnIds((prev) => {
        if (![...prev].some((id) => idSet.has(id))) return prev;
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      try {
        await cabling.deleteBatch(ids);
      } catch {
        // silent — l'état local est déjà à jour, le SSE/reload réconciliera
      }
      return "replaced";
    },
    [askConfirm, connectionsOnPorts, cabling, isAggregate, pushToast],
  );
  const confirmReplaceOnPortsRef = useRef(confirmReplaceOnPorts);
  confirmReplaceOnPortsRef.current = confirmReplaceOnPorts;

  // ── Port click — create connection(s) ───────────────────────────────────────
  const handlePortClick = useCallback(
    async (slotId: string, portIndex: number) => {
      // ════ ADAPTER tool — clic sur port équipement libre = ouvre picker filtré ═
      // (Skippé si on clique sur un port d'adaptateur lui-même : on enchaîne directement
      // sur le flow câble standard.)
      // (Skippé aussi si un câble est en cours de tracé : l'outil adapter reste actif
      // après placement mais on doit laisser terminer le câble, notamment quand la
      // source est un port d'adaptateur et la destination un port d'équipement.)
      if (
        toolRef.current === "adapter" &&
        !parseAdapterSlotId(slotId) &&
        !drawingFrom &&
        !multiSrcPorts
      ) {
        const port = slotPorts.get(slotId)?.find((p) => p.portIndex === portIndex);
        if (!port) return;
        // Un adaptateur s'enfiche physiquement sur le port : impossible si un
        // câble y est déjà. (Refus structurel, pas une règle de compatibilité.)
        if (isPortOccupied(slotId, portIndex)) {
          pushToast("Port déjà câblé — retirer le câble avant l'adaptateur", "warn");
          return;
        }
        const ctId = port.entry.connectorTypeId ?? null;
        // Ouvre un menu contextuel à la position du port, filtré aux adaptateurs compatibles.
        const center = getPortCenterRef.current?.(slotId, portIndex);
        const el = containerRef.current;
        if (!center || !el) return;
        const rect = el.getBoundingClientRect();
        const { pan: p, zoom: z } = viewRef.current;
        const screenX = rect.left + center.x * z + p.x;
        const screenY = rect.top + center.y * z + p.y;
        setPortAdapterMenu({
          x: screenX,
          y: screenY,
          slotId,
          portIndex,
          connectorTypeId: ctId,
          gender: port.entry.gender ?? null,
          side: port.side,
        });
        return;
      }

      // ════ EXTERNAL tool — marque un port libre comme sortie externe ═════════
      if (toolRef.current === "external") {
        // Pas sur un port d'adaptateur — réservé aux ports équipement.
        if (parseAdapterSlotId(slotId)) {
          pushToast("Les marqueurs externes ne sont posés que sur des ports équipement", "warn");
          return;
        }
        // Convertir virtuel panel → réel pour matcher la DB.
        const real = virtualToReal(slotId, portIndex, activeSlots);
        // Refuser si déjà câblé ou déjà marqué externe.
        if (isPortOccupied(slotId, portIndex)) {
          pushToast("Port déjà câblé", "warn");
          return;
        }
        if (
          externalPorts.some(
            (e) => e.slotId === real.slotId && e.portIndex === real.portIndex,
          )
        ) {
          pushToast("Ce port est déjà marqué comme externe", "warn");
          return;
        }
        // Position auto : 120 px à l'extérieur du port (côté gauche/droit).
        const center = getPortCenterRef.current?.(slotId, portIndex);
        if (!center) return;
        const OFFSET = 120;
        const labelX = center.side === "left" ? center.x - OFFSET : center.x + OFFSET;
        const labelY = center.y;
        // Optimistic add avec id temporaire.
        const tempId = `tmp-ext-${Date.now()}`;
        const optimistic: ExternalPortData = {
          id: tempId,
          // Porté dès l'optimiste pour que PATCH/DELETE visent le bon
          // contenant en vue agrégée avant la réponse serveur.
          rackId: rackForRef.current(real.slotId),
          slotId: real.slotId,
          portIndex: real.portIndex,
          labelX,
          labelY,
          label: null,
        };
        setExternalPorts((prev) => [...prev, optimistic]);
        try {
          const res = await apiFetch(`/api/racks/${rackForRef.current(real.slotId)}/external-ports`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slotId: real.slotId,
              portIndex: real.portIndex,
              labelX,
              labelY,
            }),
          });
          if (!res.ok) {
            // Retirer l'optimiste et signaler.
            setExternalPorts((prev) => prev.filter((e) => e.id !== tempId));
            if (res.status === 409) {
              pushToast("Ce port est déjà marqué comme externe", "warn");
            } else {
              pushToast("Échec création du marqueur externe", "error");
            }
            return;
          }
          const created = (await res.json()) as ExternalPortData;
          setExternalPorts((prev) =>
            prev.map((e) => (e.id === tempId ? created : e)),
          );
        } catch {
          setExternalPorts((prev) => prev.filter((e) => e.id !== tempId));
          pushToast("Échec création du marqueur externe", "error");
        }
        return;
      }

      // Le câblage est strictement réservé à l'outil "cable".
      if (toolRef.current !== "cable") return;

      // ════ SINGLE mode ════════════════════════════════════════════════════════
      if (cableCount === "single") {
        if (!drawingFrom) {
          setDrawingFrom({ slotId, portIndex });
          setDrawingWaypoints([]);
          setDrawingDirection("H");
          return;
        }
        if (drawingFrom.slotId === slotId && drawingFrom.portIndex === portIndex) {
          setDrawingFrom(null);
          setDrawingWaypoints([]);
          return;
        }
        const fromPort = getPortsForSlotOrAdapter(drawingFrom.slotId).find(
          (p) => p.portIndex === drawingFrom.portIndex,
        );
        const toPort = getPortsForSlotOrAdapter(slotId).find((p) => p.portIndex === portIndex);
        // Politique produit : la pose n'est JAMAIS refusée. Les incohérences
        // métier (sens identique, signal/connecteur différents) sont signalées
        // ici puis reprises par la validation temps réel
        // (lib/services/rack-validation.ts). On collecte, on pose, on alerte.
        // Seule exception : un port déjà câblé passe par une confirmation de
        // remplacement (le câble existant est supprimé, jamais empilé).
        const poseWarnings: string[] = [];
        const replaced = await confirmReplaceOnPorts([
          { slotId: drawingFrom.slotId, portIndex: drawingFrom.portIndex },
          { slotId, portIndex },
        ]);
        if (replaced === "cancelled") {
          setDrawingFrom(null);
          setDrawingWaypoints([]);
          setMultiHoverTooltip(null);
          return;
        }
        {
          const isBidir = (d?: string) => !d || d === "BIDIR" || d === "BOTH";
          const effDir = (port: Port | undefined, sid: string, pi: number) => {
            const d = port?.entry.direction?.toUpperCase();
            if (d && !isBidir(d)) return d;
            return panelPortDirs.get(`${sid}:${pi}`);
          };
          const fromDir = effDir(fromPort, drawingFrom.slotId, drawingFrom.portIndex);
          const toDir = effDir(toPort, slotId, portIndex);
          if (!isBidir(fromDir) && !isBidir(toDir) && fromDir === toDir) {
            poseWarnings.push(fromDir === "IN" ? "Deux entrées reliées" : "Deux sorties reliées");
          }
        }
        // Rectify last waypoint
        let savedWaypoints = drawingWaypoints;
        if (cableModeRef.current === "multipoint" && drawingWaypoints.length > 0) {
          const toCenter = getPortCenterRef.current?.(slotId, portIndex);
          if (toCenter) {
            const EXIT = 40;
            const ex2 = toCenter.x + (toCenter.side === "left" ? -EXIT : EXIT);
            const adjusted = [...drawingWaypoints];
            const last = adjusted[adjusted.length - 1];
            adjusted[adjusted.length - 1] =
              drawingDirectionRef.current === "H"
                ? { x: last.x, y: toCenter.y }
                : { x: ex2, y: last.y };
            savedWaypoints = adjusted;
          }
        }
        // Couleur câble à la création : couleur sémantique du signal résolu
        // (priorité), fallback connecteur. Fallback toPort sur signal pour
        // les ports switching/transit (pas de signal propre).
        const createSigName =
          fromPort?.entry.signalName ?? toPort?.entry.signalName ?? null;
        const createSigColor = createSigName ? sigColorByName[createSigName] : undefined;
        const connColor =
          createSigColor ?? fromPort?.ct?.color ?? toPort?.ct?.color ?? null;
        // virtualToReal n'est utilisé que pour les ports panel virtuels — adapter slotIds
        // ne sont pas affectés (parseAdapterSlotId retourne non-null et virtualToReal les
        // ignore en absence de match).
        const fromReal = parseAdapterSlotId(drawingFrom.slotId)
          ? { slotId: drawingFrom.slotId, portIndex: drawingFrom.portIndex }
          : virtualToReal(drawingFrom.slotId, drawingFrom.portIndex, activeSlots);
        const toReal = parseAdapterSlotId(slotId)
          ? { slotId, portIndex }
          : virtualToReal(slotId, portIndex, activeSlots);
        const style = cableStyleRef.current;
        let dbConn: DbConnection | null = null;
        try {
          dbConn = await cabling.createOne({
            ...devirtualizeEndpoint(fromReal.slotId, fromReal.portIndex, "from", activeSlots),
            ...devirtualizeEndpoint(toReal.slotId, toReal.portIndex, "to", activeSlots),
            color: connColor,
            cableStyle: style,
            waypoints: savedWaypoints.length > 0 ? savedWaypoints : null,
          });
        } catch {
          dbConn = null;
        }
        if (dbConn) {
          const conn = virtualizeConnection(dbConn, activeSlots);
          // Remplacement : l'entrée d'historique a déjà été poussée avant la
          // suppression — une seconde couperait l'undo en deux.
          if (replaced !== "replaced") history.push(captureSnapshot());
          setConnections((prev) => (prev.some((c) => c.id === conn.id) ? prev : [...prev, conn]));
          setConnStyles((prev) => {
            const next = new Map(prev);
            next.set(conn.id, style);
            return next;
          });
          if (savedWaypoints.length > 0) {
            setConnWaypoints((prev) => {
              const next = new Map(prev);
              next.set(conn.id, savedWaypoints);
              return next;
            });
          }
          // Ouvre le dialog pour choisir le type de câble physique. Le câble
          // existe déjà ; le dialog appelle setConnectionCableModel pour
          // assigner le CableModel (ou skip = laisse null).
          // Fallback toPort : un port switching/transit n'a pas de signal
          // propre — il transporte celui du pair.
          {
            const sigName =
              fromPort?.entry.signalName ?? toPort?.entry.signalName ?? null;
            const sigInfo = sigName
              ? (signals ?? []).find((s) => s.name === sigName)
              : null;
            setPendingCableModelDialog({
              connIds: [conn.id],
              signalName: sigName,
              fromConnectorName: fromPort?.ct?.name ?? null,
              toConnectorName: toPort?.ct?.name ?? null,
              fromGender: fromPort?.entry.gender ?? null,
              toGender: toPort?.entry.gender ?? null,
              signalColor: sigInfo?.color ?? null,
              signalCategory:
                sigInfo?.categoryRef?.name ?? sigInfo?.category ?? null,
            });
          }
          if (poseWarnings.length > 0) {
            pushToast([...poseWarnings, "Câble posé — signalé par la validation"], "warn");
          }
        } else {
          pushToast("Échec de la pose du câble", "error");
        }
        setDrawingFrom(null);
        setDrawingWaypoints([]);
        return;
      }

      // ════ MULTI mode ═════════════════════════════════════════════════════════
      // Phase 2: sources confirmed, picking destination
      if (multiSrcConfirmed && multiSrcPorts) {
        if (multiSrcPorts.slotId === slotId) {
          // Clicking own slot in phase 2 → cancel
          setMultiSrcPorts(null);
          setMultiSrcConfirmed(false);
          setDrawingFrom(null);
          setDrawingWaypoints([]);
          setMultiHoverTooltip(null);
          return;
        }
        const srcIndices = multiSrcPorts.portIndices;
        const dstPorts = getPortsForSlotOrAdapter(slotId);
        const firstDstPort = dstPorts.find((p) => p.portIndex === portIndex);
        if (!firstDstPort) return;
        // Build consecutive dst candidates starting from clicked port, same side.
        // Aucun filtre métier (type de connecteur, occupation) : la plage suit
        // simplement l'ordre physique des ports, la validation signale ensuite.
        const dstSide = firstDstPort.side;
        const dstSidePorts = dstPorts
          .filter((p) => p.side === dstSide)
          .sort((a, b) => a.portIndex - b.portIndex);
        const startIdx = dstSidePorts.findIndex((p) => p.portIndex === portIndex);
        const dstCandidates: number[] = [];
        for (
          let i = startIdx;
          i < dstSidePorts.length && dstCandidates.length < srcIndices.length;
          i++
        ) {
          dstCandidates.push(dstSidePorts[i].portIndex);
        }

        // Un seul modal pour toute la plage. Restreint aux paires réellement
        // câblées (dstCandidates peut être plus court que la plage source) pour
        // ne pas supprimer des câbles sur des ports qui ne seront pas recâblés.
        const pairCount = Math.min(srcIndices.length, dstCandidates.length);
        const multiReplaced = await confirmReplaceOnPorts([
          ...srcIndices
            .slice(0, pairCount)
            .map((pi) => ({ slotId: multiSrcPorts.slotId, portIndex: pi })),
          ...dstCandidates.slice(0, pairCount).map((pi) => ({ slotId, portIndex: pi })),
        ]);
        if (multiReplaced === "cancelled") {
          setMultiSrcPorts(null);
          setMultiSrcConfirmed(false);
          setDrawingFrom(null);
          setDrawingWaypoints([]);
          setMultiHoverTooltip(null);
          return;
        }

        // Multi-câbles : couleur sémantique du signal source en priorité.
        const multiSrcPort0 = getPortsForSlotOrAdapter(multiSrcPorts.slotId).find(
          (p) => p.portIndex === srcIndices[0],
        );
        const multiDstPort0 = getPortsForSlotOrAdapter(slotId).find(
          (p) => p.portIndex === dstCandidates[0],
        );
        const multiSigName =
          multiSrcPort0?.entry.signalName ?? multiDstPort0?.entry.signalName ?? null;
        const multiSigColor = multiSigName ? sigColorByName[multiSigName] : undefined;
        const connColor =
          multiSigColor ?? multiSrcPort0?.ct?.color ?? null;
        const style = cableStyleRef.current;
        const refPortCenter = getPortCenterRef.current?.(multiSrcPorts.slotId, srcIndices[0]);
        const refY = refPortCenter?.y ?? 0;
        const attempts = Math.min(srcIndices.length, dstCandidates.length);
        type BatchPayload = Record<string, unknown>;
        const payloads: BatchPayload[] = [];
        const payloadWaypoints: (null | { x: number; y: number }[])[] = [];
        for (let i = 0; i < attempts; i++) {
          const fromReal2 = parseAdapterSlotId(multiSrcPorts.slotId)
            ? { slotId: multiSrcPorts.slotId, portIndex: srcIndices[i] }
            : virtualToReal(multiSrcPorts.slotId, srcIndices[i], activeSlots);
          const toReal2 = parseAdapterSlotId(slotId)
            ? { slotId, portIndex: dstCandidates[i] }
            : virtualToReal(slotId, dstCandidates[i], activeSlots);
          let wpts: { x: number; y: number }[] = [];
          if (drawingWaypoints.length > 0) {
            const srcCenter = getPortCenterRef.current?.(multiSrcPorts.slotId, srcIndices[i]);
            const dy = (srcCenter?.y ?? refY) - refY;
            const dstCenter = getPortCenterRef.current?.(slotId, dstCandidates[i]);
            const EXIT = 40;
            const ex2 = dstCenter ? dstCenter.x + (dstCenter.side === "left" ? -EXIT : EXIT) : 0;
            const adjusted = drawingWaypoints.map((wp) => ({ x: wp.x, y: wp.y + dy }));
            const last = adjusted[adjusted.length - 1];
            adjusted[adjusted.length - 1] =
              drawingDirectionRef.current === "H"
                ? { x: last.x, y: dstCenter?.y ?? last.y }
                : { x: ex2, y: last.y };
            wpts = adjusted;
          }
          payloads.push({
            ...devirtualizeEndpoint(fromReal2.slotId, fromReal2.portIndex, "from", activeSlots),
            ...devirtualizeEndpoint(toReal2.slotId, toReal2.portIndex, "to", activeSlots),
            color: connColor,
            cableStyle: style,
            waypoints: wpts.length > 0 ? wpts : null,
          });
          payloadWaypoints.push(wpts.length > 0 ? wpts : null);
        }
        const newConns: RackConnection[] = [];
        const newConnsWaypoints: { connId: string; wpts: { x: number; y: number }[] }[] = [];
        if (payloads.length > 0) {
          try {
            const created = await cabling.createBatch(
              payloads as Parameters<typeof cabling.createBatch>[0],
            );
            created.forEach((dbConn, idx) => {
              const conn = virtualizeConnection(dbConn, activeSlots);
              newConns.push(conn);
              const wpts = payloadWaypoints[idx];
              if (wpts && wpts.length > 0) newConnsWaypoints.push({ connId: conn.id, wpts });
            });
          } catch {
            // silent — laisser l'optimistic state vide pour cet échec batch
          }
        }
        if (newConns.length) {
          // Remplacement : historique déjà poussé avant la suppression.
          if (multiReplaced !== "replaced") pushHistoryRef.current?.();
          setConnections((prev) => {
            const ids = new Set(prev.map((c) => c.id));
            return [...prev, ...newConns.filter((c) => !ids.has(c.id))];
          });
          setConnStyles((prev) => {
            const next = new Map(prev);
            newConns.forEach((c) => next.set(c.id, style));
            return next;
          });
          if (newConnsWaypoints.length > 0) {
            setConnWaypoints((prev) => {
              const next = new Map(prev);
              newConnsWaypoints.forEach(({ connId, wpts }) => next.set(connId, wpts));
              return next;
            });
          }
          if (newConns.length < srcIndices.length) {
            pushToast(
              [
                `${newConns.length} / ${srcIndices.length} câbles posés`,
                "Ports destination insuffisants sur ce côté",
              ],
              "warn",
            );
          } else {
            pushToast(
              `${newConns.length} câble${newConns.length > 1 ? "s" : ""} posé${newConns.length > 1 ? "s" : ""}`,
              "success",
              2500,
            );
          }
          // Ouvre le dialog pour assigner le type à tous les câbles posés.
          // Le signalName est dérivé du 1er port source (mode multi sur même slot).
          const firstSrcIdx = srcIndices[0];
          const firstSrcPort =
            multiSrcPorts && firstSrcIdx !== undefined
              ? slotPorts
                  .get(multiSrcPorts.slotId)
                  ?.find((p) => p.portIndex === firstSrcIdx)
              : null;
          // Premier port destination — sert au filtrage par connecteurs.
          const firstDstIdx = dstCandidates[0];
          const firstDstPort =
            firstDstIdx !== undefined
              ? slotPorts.get(slotId)?.find((p) => p.portIndex === firstDstIdx)
              : null;
          {
            const sigName = firstSrcPort?.entry?.signalName ?? null;
            const sigInfo = sigName
              ? (signals ?? []).find((s) => s.name === sigName)
              : null;
            setPendingCableModelDialog({
              connIds: newConns.map((c) => c.id),
              signalName: sigName,
              fromConnectorName: firstSrcPort?.ct?.name ?? null,
              toConnectorName: firstDstPort?.ct?.name ?? null,
              fromGender: firstSrcPort?.entry?.gender ?? null,
              toGender: firstDstPort?.entry?.gender ?? null,
              signalColor: sigInfo?.color ?? null,
              signalCategory:
                sigInfo?.categoryRef?.name ?? sigInfo?.category ?? null,
            });
          }
        } else {
          pushToast("Aucun câble posé — aucun port destination disponible", "error");
        }
        setMultiSrcPorts(null);
        setMultiSrcConfirmed(false);
        setDrawingFrom(null);
        setDrawingWaypoints([]);
        setMultiHoverTooltip(null);
        return;
      }

      // Phase 1: building source selection
      if (!multiSrcPorts) {
        // First source port clicked
        const port = getPortsForSlotOrAdapter(slotId).find((p) => p.portIndex === portIndex);
        if (!port) return;
        setMultiSrcPorts({ slotId, portIndices: [portIndex] });
        setDrawingFrom({ slotId, portIndex });
        setDrawingWaypoints([]);
        setDrawingDirection("H");
        return;
      }

      if (multiSrcPorts.slotId !== slotId) {
        // Different slot in phase 1 → restart from this port
        const port = getPortsForSlotOrAdapter(slotId).find((p) => p.portIndex === portIndex);
        if (!port) return;
        setMultiSrcPorts({ slotId, portIndices: [portIndex] });
        setDrawingFrom({ slotId, portIndex });
        setDrawingWaypoints([]);
        setDrawingDirection("H");
        return;
      }

      // Second click on same slot → compute range, auto-confirm
      const srcPorts = getPortsForSlotOrAdapter(slotId);
      const firstPort = srcPorts.find((p) => p.portIndex === multiSrcPorts.portIndices[0]);
      const clickedPort = srcPorts.find((p) => p.portIndex === portIndex);
      if (!firstPort || !clickedPort) return;

      // Must be same side
      if (clickedPort.side !== firstPort.side) {
        pushToast("Les ports doivent être du même côté", "warn");
        return;
      }

      // All ports on that side, sorted by portIndex
      const sameSide = srcPorts
        .filter((p) => p.side === firstPort.side)
        .sort((a, b) => a.portIndex - b.portIndex);
      const idx1 = sameSide.findIndex((p) => p.portIndex === firstPort.portIndex);
      const idx2 = sameSide.findIndex((p) => p.portIndex === clickedPort.portIndex);
      if (idx1 === -1 || idx2 === -1) return;

      const rangeStart = Math.min(idx1, idx2);
      const rangeEnd = Math.max(idx1, idx2);

      // Toute la plage est retenue — pas de filtre signal ni occupation : la
      // pose reste possible, les incohérences sont signalées à la création
      // puis par la validation.
      const selected = sameSide.slice(rangeStart, rangeEnd + 1).map((p) => p.portIndex);

      if (selected.length === 0) return;

      setMultiSrcPorts({ slotId, portIndices: selected });
      setDrawingFrom({ slotId, portIndex: selected[0] });
      setMultiSrcConfirmed(true);
    },
    [
      cableCount,
      drawingFrom,
      drawingWaypoints,
      multiSrcPorts,
      multiSrcConfirmed,
      rackId,
      slotPorts,
      pushToast,
      isPortOccupied,
      confirmReplaceOnPorts,
      getPortsForSlotOrAdapter,
      externalPorts,
      activeSlots,
    ],
  );
  handlePortClickRef.current = handlePortClick;

  /**
   * Entrée DOM du clic sur un port (handlers React des nodes/adaptateurs).
   *
   * Seul ce chemin consomme `suppressPortClickRef` : quand un drag a déjà été
   * traité par les listeners natifs, le `click` de fin de geste doit être
   * ignoré. Les appels internes (drag-to-connect) passent par
   * `handlePortClickRef` et ne sont donc jamais avalés par leur propre garde.
   */
  const handlePortClickFromDom = useCallback((slotId: string, portIndex: number) => {
    if (suppressPortClickRef.current) {
      suppressPortClickRef.current = false;
      return;
    }
    void handlePortClickRef.current?.(slotId, portIndex);
  }, []);

  // ── Delete connection(s) ───────────────────────────────────────────────────
  const handleDeleteConnection = useCallback(
    async (connId: string) => {
      history.push(captureSnapshot());
      setConnections((prev) => prev.filter((c) => c.id !== connId));
      setConnStyles((prev) => {
        const next = new Map(prev);
        next.delete(connId);
        return next;
      });
      await cabling.deleteOne(connId);
      setSelectedConnId(null);
    },
    [cabling, history, captureSnapshot],
  );

  const handleDeleteSelected = useCallback(async () => {
    const ids = Array.from(selectedConnIds);
    if (ids.length === 0) return;
    pushHistoryRef.current?.();
    setConnections((prev) => prev.filter((c) => !ids.includes(c.id)));
    setConnStyles((prev) => {
      const next = new Map(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    await cabling.deleteBatch(ids);
    setSelectedConnIds(new Set());
    if (ids.length > 1) pushToast(`${ids.length} câbles supprimés`, "success", 2500);
  }, [selectedConnIds, cabling, pushToast]);

  // ── Open manual numbering modal with auto pre-fill ────────────────────────
  const handleOpenManualNumber = useCallback(
    async (overrideIds?: string[], nodeId?: string) => {
      let ids = overrideIds ?? Array.from(selectedConnIds);
      let sourceNode = nodeId ?? null;
      // Si un node est sélectionné et pas de câbles → prendre les câbles du node
      if (ids.length === 0 && selectedNodeId) {
        ids = connections
          .filter((c) => c.fromSlotId === selectedNodeId || c.toSlotId === selectedNodeId)
          .map((c) => c.id);
        sourceNode = selectedNodeId;
      }
      manualNumberIdsRef.current = ids;
      setManualNumberIds(ids);
      setManualScopeNodeId(sourceNode);
      manualScopeNodeIdRef.current = sourceNode;
      if (ids.length === 0) return;

      setShowManualNumberModal(true);
    },
    [selectedConnIds, selectedNodeId, connections],
  );

  // Keep imperativeActionsRef in sync with latest callbacks
  imperativeActionsRef.current = {
    startManualNumberForCable: (connId: string) => {
      handleOpenManualNumber([connId]);
    },
    clearCableLabel: async (connId: string) => {
      pushHistoryRef.current?.();
      await cabling.renumber({ clearIds: [connId] }).catch(() => []);
      setConnections((prev) => prev.map((c) => (c.id === connId ? { ...c, label: null } : c)));
    },
    deleteCable: async (connId: string) => {
      await handleDeleteConnection(connId);
    },
    startManualNumberForCables: (ids: string[]) => {
      handleOpenManualNumber(ids);
    },
    clearCableLabelsForIds: async (ids: string[]) => {
      if (ids.length === 0) return;
      pushHistoryRef.current?.();
      await cabling.renumber({ clearIds: ids }).catch(() => []);
      setConnections((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, label: null } : c)));
    },
    deleteCablesForIds: async (ids: string[]) => {
      if (ids.length === 0) return;
      pushHistoryRef.current?.();
      setConnections((prev) => prev.filter((c) => !ids.includes(c.id)));
      setConnStyles((prev) => {
        const next = new Map(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      await cabling.deleteBatch(ids);
      setSelectedConnIds(new Set());
    },
  };

  const handleClearSelectedLabels = useCallback(async () => {
    const ids = Array.from(selectedConnIds);
    if (ids.length === 0) return;
    pushHistoryRef.current?.();
    await cabling.renumber({ clearIds: ids }).catch(() => []);
    setConnections((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, label: null } : c)));
  }, [selectedConnIds, cabling]);

  // ── Renumber ───────────────────────────────────────────────────────────────
  // Open renumber modal — build equipment list (non-panel, with at least one connection)
  const handleRenumber = useCallback(() => {
    if (connections.length === 0) {
      setShowNoCableInfo(true);
      return;
    }
    setShowRenumberModal(true);
  }, [connections, expandedSlots]);

  // Override numbering — local state pour refléter PATCHs du dialog
  const [liveRackOverride, setLiveRackOverride] = useState<Partial<CableNumberingConfig> | null>(
    rackNumberingOverride,
  );

  // Compute ordered connection IDs from user-defined equipment priority + signal grouping
  const confirmRenumber = useCallback(
    async (
      override?: CableNumberingConfig,
      direction?: { horizontal: "ltr" | "rtl"; vertical: "ttb" | "btt" },
      /** Si fourni, ne numérote que ces câbles (mode sélection). */
      scopeIds?: string[],
      /** Si fourni, le slot "propriétaire" pour la direction IN/OUT (équipement sélectionné). */
      scopeNodeId?: string,
    ) => {
      setShowRenumberModal(false);
      setShowManualNumberModal(false);
      const isSelection = scopeIds && scopeIds.length > 0;
      const targetConns = isSelection
        ? connections.filter((c) => scopeIds.includes(c.id))
        : connections;
      if (targetConns.length === 0) return;
      pushHistoryRef.current?.();

      const dir = direction ?? { horizontal: "ltr", vertical: "ttb" };
      const hSign = dir.horizontal === "ltr" ? 1 : -1;
      const vSign = dir.vertical === "ttb" ? 1 : -1;

      // Position spatiale d'un slot sur le canvas (positions map).
      const slotPos = (id: string) => positions.get(id) ?? { x: 0, y: 0 };

      // "Owner" d'un câble :
      //  - Si scopeNodeId (numérotation équipement) → toujours cet équipement.
      //  - Sinon : côté non-panel, puis priorité spatiale.
      const getOwnerSlotId = (conn: RackConnection): string => {
        if (scopeNodeId) {
          if (conn.fromSlotId === scopeNodeId) return conn.fromSlotId;
          if (conn.toSlotId === scopeNodeId) return conn.toSlotId;
        }
        const fromSlot = expandedSlots.find((s) => s.id === conn.fromSlotId);
        const toSlot = expandedSlots.find((s) => s.id === conn.toSlotId);
        const fromIsPanel = !!fromSlot?.panel;
        const toIsPanel = !!toSlot?.panel;
        if (fromIsPanel && !toIsPanel) return conn.toSlotId;
        if (!fromIsPanel && toIsPanel) return conn.fromSlotId;
        const pf = slotPos(conn.fromSlotId);
        const pt = slotPos(conn.toSlotId);
        const cmp = pf.y * vSign - pt.y * vSign || pf.x * hSign - pt.x * hSign;
        return cmp <= 0 ? conn.fromSlotId : conn.toSlotId;
      };

      const getSignal = (slotId: string, portIndex: number): string => {
        const port = slotPorts.get(slotId)?.find((p) => p.portIndex === portIndex);
        return port?.entry.signalName ?? "__nosignal__";
      };

      const getOwnerSide = (conn: RackConnection): "left" | "right" => {
        const ownerSlotId = getOwnerSlotId(conn);
        const isFrom = ownerSlotId === conn.fromSlotId;
        const portIndex = isFrom ? conn.fromConnectorIndex : conn.toConnectorIndex;
        const port = slotPorts.get(ownerSlotId)?.find((p) => p.portIndex === portIndex);
        return port?.side ?? "left";
      };

      // Tri spatial : axe vertical (primaire) puis horizontal (secondaire),
      // groupé par signal, puis par port index au sein d'un même équipement.
      const sorted = [...targetConns].sort((a, b) => {
        const sigA =
          getSignal(a.fromSlotId, a.fromConnectorIndex) ||
          getSignal(a.toSlotId, a.toConnectorIndex);
        const sigB =
          getSignal(b.fromSlotId, b.fromConnectorIndex) ||
          getSignal(b.toSlotId, b.toConnectorIndex);
        if (sigA !== sigB) return sigA.localeCompare(sigB);
        const sideA = getOwnerSide(a);
        const sideB = getOwnerSide(b);
        if (sideA !== sideB) return sideA === "left" ? -1 : 1;
        // Position spatiale de l'équipement propriétaire
        const posA = slotPos(getOwnerSlotId(a));
        const posB = slotPos(getOwnerSlotId(b));
        const vy = posA.y * vSign - posB.y * vSign;
        if (Math.abs(vy) > 5) return vy;
        const vx = posA.x * hSign - posB.x * hSign;
        if (Math.abs(vx) > 5) return vx;
        return a.fromConnectorIndex - b.fromConnectorIndex;
      });

      const sideMap: Record<string, "left" | "right"> = {};
      const seen = new Set<string>();
      const orderedIds: string[] = [];
      for (const conn of sorted) {
        if (seen.has(conn.id)) continue;
        seen.add(conn.id);
        orderedIds.push(conn.id);
        sideMap[conn.id] = getOwnerSide(conn);
      }

      try {
        const updated = await cabling.renumber({
          orderedIds,
          sideMap,
          // En mode sélection : on renumérote TOUT (y compris les déjà numérotés)
          // car l'utilisateur a explicitement choisi ces câbles.
          onlyUnlabelled: isSelection ? false : renumberOnlyUnlabelled,
          ...(isSelection ? { partial: true } : {}),
          ...(override ? { override } : {}),
        });
        setConnections(updated.map((c) => virtualizeConnection(c, activeSlots)));
        const labelled = updated.filter((c) => c.label).length;
        pushToast(
          `${labelled} câble${labelled > 1 ? "s" : ""} numéroté${labelled > 1 ? "s" : ""}`,
          "success",
          2500,
        );
      } catch {
        pushToast("Échec de la numérotation", "error");
      }
    },
    [connections, expandedSlots, positions, slotPorts, cabling, renumberOnlyUnlabelled, pushToast],
  );

  // Persist override sur le rack (sans renuméroter)
  const handleSaveOverride = useCallback(
    async (override: CableNumberingConfig) => {
      try {
        await cabling.patchRackConfig({ numberingOverride: override });
        setLiveRackOverride(override);
      } catch {
        // silent
      }
    },
    [cabling],
  );

  // Persist override puis renumérote
  const handleSaveAndConfirm = useCallback(
    async (override: CableNumberingConfig) => {
      await handleSaveOverride(override);
      await confirmRenumber(override);
    },
    [handleSaveOverride, confirmRenumber],
  );

  // Réinit override rack → admin
  const handleResetToAdmin = useCallback(async () => {
    try {
      await cabling.patchRackConfig({ numberingOverride: null });
      setLiveRackOverride(null);
    } catch {
      // silent
    }
  }, [cabling]);

  // Exemples live pour le dialog : 5 premières connexions avec signal résolu
  const cableExamples = useMemo<CableExample[]>(() => {
    // Lookup tolérante : case + diacritiques ignorés (NFD strip)
    const norm = (s: string) =>
      s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    const catByNormName = new Map(signalCategories.map((c) => [norm(c.name), c]));

    const out: CableExample[] = [];
    const seen = new Set<string>();
    for (const conn of connections) {
      if (out.length >= 5) break;
      const fromPort = getPortsForSlotOrAdapter(conn.fromSlotId).find(
        (p) => p.portIndex === conn.fromConnectorIndex,
      );
      const toPort = getPortsForSlotOrAdapter(conn.toSlotId).find(
        (p) => p.portIndex === conn.toConnectorIndex,
      );
      const sigName = fromPort?.entry.signalName ?? toPort?.entry.signalName ?? null;
      if (!sigName || seen.has(sigName)) continue;
      seen.add(sigName);
      const sig = signals.find((s) => s.name === sigName);
      const fallbackCat =
        sig?.categoryRef ??
        (sig?.category ? (catByNormName.get(norm(sig.category)) ?? null) : null);
      const prefix = sig?.cablePrefix?.trim() || fallbackCat?.cablePrefix?.trim() || "";
      const suffix = sig?.cableSuffix?.trim() || fallbackCat?.cableSuffix?.trim() || "";
      const dir = (fromPort?.entry.direction ?? "").toUpperCase();
      const dirDigit: CableDirDigit = dir === "BIDI" ? "3" : dir === "OUT" ? "2" : "1";
      out.push({
        signalLabel: sigName,
        signalPrefix: prefix,
        signalSuffix: suffix,
        dirDigit,
        zoneCode: null, // exemples génériques, zone réelle calculée à la renum
      });
    }
    return out;
  }, [connections, slotPorts, signals, signalCategories]);

  // ── Panel bridge : publie le contenu du dialog Renumber au parent ─────────
  useEffect(() => {
    if (!onRenumberPanelChange) return;
    if (!showRenumberModal) {
      onRenumberPanelChange(null);
      return;
    }
    onRenumberPanelChange(
      <SynopticRenumberDialog
        rackId={rackId}
        rackCableCode={rackCableCode}
        rackOverride={liveRackOverride}
        adminDefaults={
          cableNumbering
            ? {
                pad: cableNumbering.pad,
                sep1: cableNumbering.sep1 ?? cableNumbering.separator ?? "-",
                sep2: cableNumbering.sep2 ?? cableNumbering.suffixSep ?? "",
                includeRack: cableNumbering.includeRack ?? true,
                template: cableNumbering.template ?? "",
                templateEnabled: cableNumbering.templateEnabled ?? false,
              }
            : undefined
        }
        examples={cableExamples}
        equipOrder={[]}
        onEquipOrderChange={() => {}}
        onlyUnlabelled={renumberOnlyUnlabelled}
        onOnlyUnlabelledChange={setRenumberOnlyUnlabelled}
        onCancel={() => setShowRenumberModal(false)}
        onConfirm={confirmRenumber}
        onSaveAndConfirm={handleSaveAndConfirm}
        onSaveOverride={handleSaveOverride}
        onResetToAdmin={handleResetToAdmin}
      />,
    );
  }, [
    onRenumberPanelChange,
    showRenumberModal,
    rackId,
    rackCableCode,
    liveRackOverride,
    cableExamples,
    renumberOnlyUnlabelled,
    confirmRenumber,
    handleSaveAndConfirm,
    handleSaveOverride,
    handleResetToAdmin,
  ]);

  // ── Panel bridge : publie le contenu du dialog numérotation sélection au parent ───
  // IDs de câbles ciblés par la numérotation sélection (state réactif + ref stable).
  const manualScopeIds = manualNumberIds;
  const manualScopeIdsRef = useRef(manualScopeIds);
  manualScopeIdsRef.current = manualScopeIds;

  useEffect(() => {
    if (!onManualPanelChange) return;
    if (!showManualNumberModal) {
      onManualPanelChange(null);
      return;
    }
    onManualPanelChange(
      <SynopticRenumberDialog
        rackId={rackId}
        rackCableCode={rackCableCode}
        rackOverride={liveRackOverride}
        adminDefaults={
          cableNumbering
            ? {
                pad: cableNumbering.pad,
                sep1: cableNumbering.sep1 ?? cableNumbering.separator ?? "-",
                sep2: cableNumbering.sep2 ?? cableNumbering.suffixSep ?? "",
                includeRack: cableNumbering.includeRack ?? true,
                template: cableNumbering.template ?? "",
                templateEnabled: cableNumbering.templateEnabled ?? false,
              }
            : undefined
        }
        scope="selection"
        selectedCount={manualScopeIds.length}
        examples={[]}
        equipOrder={[]}
        onEquipOrderChange={() => {}}
        onlyUnlabelled={renumberOnlyUnlabelled}
        onOnlyUnlabelledChange={setRenumberOnlyUnlabelled}
        onCancel={() => setShowManualNumberModal(false)}
        onConfirm={(config, dir) =>
          confirmRenumber(
            config,
            dir,
            manualScopeIdsRef.current,
            manualScopeNodeIdRef.current ?? undefined,
          )
        }
        onSaveAndConfirm={() => {}}
        onSaveOverride={handleSaveOverride}
        onResetToAdmin={() => {}}
      />,
    );
  }, [
    onManualPanelChange,
    showManualNumberModal,
    manualScopeIds,
    rackId,
    rackCableCode,
    liveRackOverride,
    cableNumbering,
    renumberOnlyUnlabelled,
    confirmRenumber,
    handleSaveOverride,
  ]);

  // ── Panel bridge : publie les données du câble sélectionné au parent ──
  useEffect(() => {
    if (!onCableDetailsChange) return;
    if (!selectedConnId || selectedConnIds.size > 1) {
      onCableDetailsChange(null);
      return;
    }
    const conn = connections.find((c) => c.id === selectedConnId);
    if (!conn) {
      onCableDetailsChange(null);
      return;
    }
    const rconn = resolvedConnections.find((c) => c.id === selectedConnId) ?? conn;

    const resolveDisplayEndpoint = (
      slotId: string,
      portIndex: number,
    ): { slotId: string; portIndex: number } => {
      const ad = parseAdapterSlotId(slotId);
      if (!ad) return { slotId, portIndex };
      const adp = adapters.find((a) => a.id === ad.adapterId);
      if (!adp || !adp.attachedSlotId || adp.attachedPortIndex == null)
        return { slotId, portIndex };
      return { slotId: adp.attachedSlotId, portIndex: adp.attachedPortIndex };
    };
    const getAdapterHop = (
      slotId: string,
      portIndex: number,
    ): { adapterName: string; adapterPortNum: number } | null => {
      const ad = parseAdapterSlotId(slotId);
      if (!ad) return null;
      const adp = adapters.find((a) => a.id === ad.adapterId);
      if (!adp) return null;
      return { adapterName: adp.adapter.name, adapterPortNum: portIndex + 1 };
    };
    const sidePortNum = (slotId: string, portIndex: number) => {
      const ports = slotPorts.get(slotId) ?? [];
      const port = ports.find((p) => p.portIndex === portIndex);
      if (!port) return portIndex + 1;
      const slot = expandedSlots.find((s) => s.id === slotId);
      // Panel ports: visual numbering matches entryIndex + 1 (one row per connector)
      if (slot?.panel) return port.entryIndex + 1;
      return port.unitIndex + 1;
    };
    const normalizeDir = (dir: string | undefined): "IN" | "OUT" | "BIDIR" | null => {
      if (!dir) return null;
      const u = dir.toUpperCase();
      if (u === "OUT") return "OUT";
      if (u === "IN") return "IN";
      if (u === "BIDIR" || u === "BOTH") return "BIDIR";
      return null;
    };

    const fromDisp = resolveDisplayEndpoint(rconn.fromSlotId, rconn.fromConnectorIndex);
    const toDisp = resolveDisplayEndpoint(rconn.toSlotId, rconn.toConnectorIndex);
    const fromSlot = expandedSlots.find((s) => s.id === fromDisp.slotId);
    const toSlot = expandedSlots.find((s) => s.id === toDisp.slotId);
    const fromPort = slotPorts
      .get(fromDisp.slotId)
      ?.find((p) => p.portIndex === fromDisp.portIndex);
    const toPort = slotPorts.get(toDisp.slotId)?.find((p) => p.portIndex === toDisp.portIndex);
    // Fallback toPort : un port switching/transit n'a pas de signal propre —
    // il transporte celui du pair.
    const signalName =
      fromPort?.entry.signalName ??
      toPort?.entry.signalName ??
      fromPort?.entry.label ??
      toPort?.entry.label ??
      fromPort?.ct?.name ??
      null;
    // Couleur câble : couleur sémantique du signal résolu prioritaire.
    const sigColor = signalName ? sigColorByName[signalName] : undefined;
    const color =
      conn.color ?? sigColor ?? fromPort?.ct?.color ?? toPort?.ct?.color ?? "#6366f1";

    const rawTags = (conn as unknown as { tags?: unknown }).tags;
    const tags: CableTag[] = Array.isArray(rawTags)
      ? (rawTags as unknown[])
          .map((t) => {
            if (t && typeof t === "object" && "color" in t && "text" in t) {
              const tt = t as { color: unknown; text: unknown };
              return { color: String(tt.color ?? "#64748b"), text: String(tt.text ?? "") };
            }
            return null;
          })
          .filter((t): t is CableTag => t !== null)
      : [];
    const rawNotes = (conn as unknown as { notes?: unknown }).notes;
    const notes = typeof rawNotes === "string" ? rawNotes : null;

    // Estimation longueur de câble
    let estimatedLengthM: number | null = null;
    try {
      const realIdA = fromDisp.slotId.includes("__row")
        ? fromDisp.slotId.split("__row")[0]
        : fromDisp.slotId;
      const realIdB = toDisp.slotId.includes("__row")
        ? toDisp.slotId.split("__row")[0]
        : toDisp.slotId;
      const slotA = slots.find((s) => s.id === realIdA);
      const slotB = slots.find((s) => s.id === realIdB);
      if (slotA && slotB) {
        // Face du port : panels = front, équipements = rear (convention standard)
        const faceA = slotA.panel ? ("front" as const) : ("rear" as const);
        const faceB = slotB.panel ? ("front" as const) : ("rear" as const);
        // Profondeur connecteur depuis le type de connecteur
        const ctA = fromPort?.ct?.name?.toUpperCase() ?? "";
        const ctB = toPort?.ct?.name?.toUpperCase() ?? "";
        const result = estimateCableLength({
          startU_A: slotA.startU ?? 1,
          heightU_A: slotA.equipment?.heightU ?? slotA.heightU ?? 1,
          startU_B: slotB.startU ?? 1,
          heightU_B: slotB.equipment?.heightU ?? slotB.heightU ?? 1,
          portFace_A: faceA,
          portFace_B: faceB,
          connectorDepth_A: CONNECTOR_DEPTHS[ctA] ?? CONNECTOR_DEPTHS.default,
          connectorDepth_B: CONNECTOR_DEPTHS[ctB] ?? CONNECTOR_DEPTHS.default,
          rackDepthMm: (slots[0] as unknown as { depthMm?: number })?.depthMm ?? 600,
        });
        estimatedLengthM = result.roundedM;
      }
    } catch {}

    const data: CableSelectionDetails = {
      id: conn.id,
      label: conn.label ?? null,
      color,
      signalName,
      cableStyle: connStyles.get(conn.id) ?? cableStyle,
      notes,
      tags,
      from: {
        slotName: fromSlot?.label ?? fromSlot?.panel?.name ?? fromSlot?.equipment?.name ?? "—",
        portLabel: fromPort?.entry.signalName ?? fromPort?.entry.label ?? null,
        portNum: sidePortNum(fromDisp.slotId, fromDisp.portIndex),
        connectorLabel: fromPort
          ? (fromPort.entry.label ?? fromPort.ct?.name ?? "") +
            (fromPort.totalUnits > 1 ? ` ${fromPort.unitIndex + 1}` : "")
          : null,
        direction: normalizeDir(fromPort?.entry.direction),
        adapterHop: getAdapterHop(rconn.fromSlotId, rconn.fromConnectorIndex),
      },
      to: {
        slotName: toSlot?.label ?? toSlot?.panel?.name ?? toSlot?.equipment?.name ?? "—",
        portLabel: toPort?.entry.signalName ?? toPort?.entry.label ?? null,
        portNum: sidePortNum(toDisp.slotId, toDisp.portIndex),
        connectorLabel: toPort
          ? (toPort.entry.label ?? toPort.ct?.name ?? "") +
            (toPort.totalUnits > 1 ? ` ${toPort.unitIndex + 1}` : "")
          : null,
        direction: normalizeDir(toPort?.entry.direction),
        adapterHop: getAdapterHop(rconn.toSlotId, rconn.toConnectorIndex),
      },
      estimatedLengthM,
      catalogCableModelId:
        (rconn as { catalogCableModelId?: string | null })
          .catalogCableModelId ?? null,
    };
    onCableDetailsChange(data);
  }, [
    onCableDetailsChange,
    selectedConnId,
    selectedConnIds,
    connections,
    resolvedConnections,
    adapters,
    expandedSlots,
    slotPorts,
    connStyles,
    cableStyle,
  ]);

  // ── Bridge adapter selection → parent right panel ────────────────────────
  useEffect(() => {
    if (!onAdapterDetailsChange) return;
    if (!selectedAdapterId) {
      onAdapterDetailsChange(null);
      return;
    }
    const ad = adapters.find((a) => a.id === selectedAdapterId);
    if (!ad) {
      onAdapterDetailsChange(null);
      return;
    }

    const attached = ad.attachedSlotId
      ? expandedSlots.find((s) => s.id === ad.attachedSlotId)
      : null;
    const attachedName = attached
      ? (attached.equipment?.name ?? attached.panel?.name ?? attached.label ?? null)
      : null;
    const attachedPortNum = ad.attachedPortIndex != null ? ad.attachedPortIndex + 1 : null;
    // Libellé du port attaché
    let attachedPortLabel: string | null = null;
    let attachedConnectorLabel: string | null = null;
    if (attached && ad.attachedPortIndex != null) {
      const ports = slotPorts.get(attached.id) ?? [];
      const port = ports.find((p) => p.portIndex === ad.attachedPortIndex);
      if (port) {
        const sigName = port.entry.signalName ?? port.entry.label ?? port.ct?.name ?? "";
        const dir = port.entry.direction?.toUpperCase();
        const dirLabel =
          dir === "OUT"
            ? "OUT"
            : dir === "IN"
              ? "IN"
              : dir === "BIDIR" || dir === "BOTH"
                ? "BIDI"
                : "";
        attachedPortLabel = [sigName, dirLabel, String(attachedPortNum)].filter(Boolean).join(" ");
        // Libellé exact connecteur (identique au rendu SynopticNode)
        attachedConnectorLabel =
          (port.entry.label ?? port.ct?.name ?? "") +
          (port.totalUnits > 1 ? ` ${port.unitIndex + 1}` : "");
      }
    }

    // Fusionne inputs + outputs en une liste unifiée avec direction
    const connectors: AdapterSelectionDetails["connectors"] = [];
    for (const io of ad.adapter.inputs ?? []) {
      const ct = io.connectorTypeId ? connectorTypeMap[io.connectorTypeId] : null;
      connectors.push({
        connectorTypeName: ct?.name ?? null,
        connectorColor: ct?.color ?? null,
        quantity: io.quantity ?? 1,
        direction: "IN",
      });
    }
    for (const io of ad.adapter.outputs ?? []) {
      const ct = io.connectorTypeId ? connectorTypeMap[io.connectorTypeId] : null;
      connectors.push({
        connectorTypeName: ct?.name ?? null,
        connectorColor: ct?.color ?? null,
        quantity: io.quantity ?? 1,
        direction: "OUT",
      });
    }

    onAdapterDetailsChange({
      id: ad.id,
      name: ad.adapter.name,
      label: ad.label ?? null,
      attachedSlotName: attachedName,
      attachedPortNum,
      attachedPortLabel,
      attachedConnectorLabel,
      connectors,
      reference: ad.adapter.reference ?? null,
      attachedSide: ad.attachedSide,
    });
  }, [selectedAdapterId, adapters, expandedSlots, connectorTypeMap, onAdapterDetailsChange]);

  // Bridge zone selection → parent right panel
  useEffect(() => {
    if (!onZoneDetailsChange) return;
    if (!selectedZoneId) {
      onZoneDetailsChange(null);
      return;
    }
    const z = zones.find((zz) => zz.id === selectedZoneId);
    if (!z) {
      onZoneDetailsChange(null);
      return;
    }
    onZoneDetailsChange({
      id: z.id,
      label: z.label,
      labelPosition: z.labelPosition,
      color: z.color,
      borderRadius: z.borderRadius,
      borderWidth: z.borderWidth,
      borderStyle: z.borderStyle,
      opacity: z.opacity,
      labelFontSize: z.labelFontSize,
      labelFontWeight: z.labelFontWeight,
      labelFontStyle: z.labelFontStyle,
      labelTextDecoration: z.labelTextDecoration,
      labelFontFamily: z.labelFontFamily,
    });
  }, [selectedZoneId, zones, onZoneDetailsChange]);

  // Bridge label selection → parent right panel
  useEffect(() => {
    if (!onLabelDetailsChange) return;
    if (!selectedLabelId) {
      onLabelDetailsChange(null);
      return;
    }
    const l = canvasLabels.find((ll) => ll.id === selectedLabelId);
    if (!l) {
      onLabelDetailsChange(null);
      return;
    }
    onLabelDetailsChange({
      id: l.id,
      text: l.text,
      color: l.color,
      fontWeight: l.fontWeight,
      fontSize: l.fontSize,
      fontFamily: l.fontFamily,
      fontStyle: l.fontStyle,
      textDecoration: l.textDecoration,
      pill: l.pill,
      pillBg: l.pillBg,
      pillRadius: l.pillRadius,
    });
  }, [selectedLabelId, canvasLabels, onLabelDetailsChange]);

  // ── Node selection bridge ──────────────────────────────────────────────────
  useEffect(() => {
    if (!onNodeDetailsChange) return;
    if (!selectedNodeId) {
      onNodeDetailsChange(null);
      return;
    }
    const slot =
      expandedSlots.find((s) => s.id === selectedNodeId) ??
      slots.find((s) => s.id === selectedNodeId);
    if (!slot) {
      onNodeDetailsChange(null);
      return;
    }
    const eq = slot.equipment;
    const panel = slot.panel;
    // Récap connecteurs : agrège par connectorTypeId depuis equipment.connectors
    // (côté équipement) ou panel.slots (côté panel).
    const ctById = new Map(connectorTypes.map((ct) => [ct.id, ct]));
    const connectors: Array<{
      name: string;
      color: string;
      count: number;
      signalName: string | null;
      direction: string | null;
    }> = [];
    if (panel) {
      const agg = new Map<
        string,
        {
          name: string;
          color: string;
          count: number;
          signalName: string | null;
          direction: string | null;
        }
      >();
      for (const ps of panel.slots ?? []) {
        if (!ps.connectorTypeId) continue;
        const ct = ctById.get(ps.connectorTypeId);
        const name = ct?.name ?? "?";
        const cur = agg.get(name) ?? {
          name,
          color: ct?.color ?? "#94a3b8",
          count: 0,
          signalName: null,
          direction: null,
        };
        cur.count += 1;
        agg.set(name, cur);
      }
      connectors.push(...agg.values());
    } else if (Array.isArray(eq?.connectors)) {
      const agg = new Map<
        string,
        {
          name: string;
          color: string;
          count: number;
          signalName: string | null;
          direction: string | null;
        }
      >();
      for (const entry of eq.connectors as Array<{
        connectorTypeId?: string;
        quantity?: number;
        signalName?: string;
        direction?: string;
      }>) {
        if (!entry.connectorTypeId) continue;
        const ct = ctById.get(entry.connectorTypeId);
        const name = ct?.name ?? "?";
        const qty = entry.quantity ?? 1;
        const dir = entry.direction?.toUpperCase() ?? null;
        const key = `${name}|${entry.signalName ?? ""}|${dir ?? ""}`;
        const cur = agg.get(key) ?? {
          name,
          color: ct?.color ?? "#94a3b8",
          count: 0,
          signalName: entry.signalName ?? null,
          direction: dir,
        };
        cur.count += qty;
        agg.set(key, cur);
      }
      connectors.push(...agg.values());
    }
    onNodeDetailsChange({
      slotId: slot.id,
      label: slot.label ?? null,
      equipmentName: eq?.name ?? null,
      panelName: panel?.name ?? null,
      brandName: eq?.brand?.name ?? null,
      reference: eq?.reference ?? null,
      category: eq?.category ?? null,
      heightU: eq?.heightU ?? panel?.heightU ?? null,
      widthFraction: slot.widthFraction ?? null,
      powerW: eq?.powerW ?? null,
      weightKg: eq?.weight ?? null,
      depthMm: eq?.depthMm ?? null,
      imageUrl: eq?.imageUrl ?? null,
      notes: slot.notes ?? null,
      view: (slot as unknown as { view?: string }).view ?? null,
      startU: slot.startU ?? null,
      connectors,
    });
  }, [selectedNodeId, expandedSlots, slots, connectorTypes, onNodeDetailsChange]);

  const handleClearLabels = useCallback(() => {
    setShowClearConfirm(true);
  }, []);

  const confirmClearLabels = useCallback(async () => {
    setShowClearConfirm(false);
    pushHistoryRef.current?.();
    try {
      await cabling.renumber({ clearOnly: true });
      setConnections((prev) => prev.map((c) => ({ ...c, label: null })));
      pushToast("Numéros effacés", "success", 2500);
    } catch {
      pushToast("Échec de l'effacement", "error");
    }
  }, [cabling, pushToast]);

  // ── Returns the raw corner polyline of a cable (no curve smoothing) ──────────
  // Mirrors makePath/makePathWithWaypoints geometry for accurate hit-testing.
  const getCablePoints = useCallback(
    (conn: (typeof resolvedConnections)[0]): { x: number; y: number }[] => {
      const from = getPortCenterRef.current?.(conn.fromSlotId, conn.fromConnectorIndex);
      const to = getPortCenterRef.current?.(conn.toSlotId, conn.toConnectorIndex);
      if (!from || !to) return [];
      const wpts = connWaypoints.get(conn.id) ?? [];
      const { x: x1, y: y1, side: side1 } = from;
      const { x: x2, y: y2, side: side2 } = to;

      // Multipoint cable with user waypoints
      if (wpts.length > 0) {
        const EXIT = 40;
        const ex1 = x1 + (side1 === "right" ? EXIT : -EXIT);
        const ex2 = x2 + (side2 === "left" ? -EXIT : EXIT);
        return [{ x: x1, y: y1 }, { x: ex1, y: y1 }, ...wpts, { x: ex2, y: y2 }, { x: x2, y: y2 }];
      }

      // Auto-routed cable
      const isInToOut = side1 === "left" && side2 === "right";
      const isFoldBack = side1 === "right" && side2 === "left" && x2 <= x1;
      const isSameSide = side1 === side2;
      const STUB = 48;
      const MARGIN = 56;

      if (isSameSide) {
        const colX =
          side1 === "right" ? Math.max(x1, x2) + STUB + MARGIN : Math.min(x1, x2) - STUB - MARGIN;
        return [
          { x: x1, y: y1 },
          { x: colX, y: y1 },
          { x: colX, y: y2 },
          { x: x2, y: y2 },
        ];
      }
      if (isInToOut) {
        const colLeft = x1 - STUB;
        const colRight = x2 + STUB;
        const midY = (y1 + y2) / 2;
        return [
          { x: x1, y: y1 },
          { x: colLeft, y: y1 },
          { x: colLeft, y: midY },
          { x: colRight, y: midY },
          { x: colRight, y: y2 },
          { x: x2, y: y2 },
        ];
      }
      if (isFoldBack) {
        const colNear = x1 + STUB + MARGIN;
        const colFar = x2 - STUB - MARGIN;
        const bypassY = bypassYMapRef.current.get(conn.id) ?? Math.max(y1, y2) + MARGIN * 2;
        return [
          { x: x1, y: y1 },
          { x: colNear, y: y1 },
          { x: colNear, y: bypassY },
          { x: colFar, y: bypassY },
          { x: colFar, y: y2 },
          { x: x2, y: y2 },
        ];
      }
      // Standard ortho/rounded: H mx V y2 H x2
      const gap = Math.max(Math.abs(x2 - x1) * 0.4, 50);
      const ex1 = x1 + (side1 === "right" ? gap : -gap);
      const ex2 = x2 + (side2 === "left" ? -gap : gap);
      const mx = (ex1 + ex2) / 2;
      return [
        { x: x1, y: y1 },
        { x: mx, y: y1 },
        { x: mx, y: y2 },
        { x: x2, y: y2 },
      ];
    },
    [connWaypoints],
  );

  // ── Shared hit-test: screen rect → Set of conn IDs ──────────────────────────
  const computeRubberBandHits = useCallback(
    (x1: number, y1: number, x2: number, y2: number): Set<string> => {
      const { pan: p, zoom: z } = viewRef.current;
      const toCanvas = (sx: number, sy: number) => ({ x: (sx - p.x) / z, y: (sy - p.y) / z });
      const c1 = toCanvas(Math.min(x1, x2), Math.min(y1, y2));
      const c2 = toCanvas(Math.max(x1, x2), Math.max(y1, y2));

      const ptInRect = (px: number, py: number) =>
        px >= c1.x && px <= c2.x && py >= c1.y && py <= c2.y;

      const segIntersectsRect = (ax: number, ay: number, bx: number, by: number): boolean => {
        if (ptInRect(ax, ay) || ptInRect(bx, by)) return true;
        const edges = [
          [c1.x, c1.y, c2.x, c1.y],
          [c2.x, c1.y, c2.x, c2.y],
          [c2.x, c2.y, c1.x, c2.y],
          [c1.x, c2.y, c1.x, c1.y],
        ] as const;
        for (const [ex1, ey1, ex2, ey2] of edges) {
          const d = (bx - ax) * (ey2 - ey1) - (by - ay) * (ex2 - ex1);
          if (Math.abs(d) < 1e-10) continue;
          const t = ((ex1 - ax) * (ey2 - ey1) - (ey1 - ay) * (ex2 - ex1)) / d;
          const u = ((ex1 - ax) * (by - ay) - (ey1 - ay) * (bx - ax)) / d;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
        }
        return false;
      };

      const ids = new Set<string>();
      for (const conn of resolvedConnectionsRef.current) {
        const pts = getCablePoints(conn);
        if (pts.length < 2) continue;
        let hit = false;
        for (let i = 0; i < pts.length - 1 && !hit; i++) {
          hit = segIntersectsRect(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        }
        if (hit) ids.add(conn.id);
      }
      return ids;
    },
    [getCablePoints],
  );

  // ── Rubber-band commit → finalise selection (câbles + repères) ────────────
  useEffect(() => {
    const rect = commitRubberBandRef.current;
    if (!rect) return;
    commitRubberBandRef.current = null;
    const hits = computeRubberBandHits(rect.x1, rect.y1, rect.x2, rect.y2);
    if (rect.additive) {
      setSelectedConnIds((prev) => new Set([...prev, ...hits]));
    } else {
      setSelectedConnIds(hits);
    }
    // Rubber-band est en screen-space (pixels container) → convertir en canvas-space
    const { pan: _p, zoom: _z } = viewRef.current;
    const sx1 = Math.min(rect.x1, rect.x2);
    const sx2 = Math.max(rect.x1, rect.x2);
    const sy1 = Math.min(rect.y1, rect.y2);
    const sy2 = Math.max(rect.y1, rect.y2);
    const rx1 = (sx1 - _p.x) / _z;
    const rx2 = (sx2 - _p.x) / _z;
    const ry1 = (sy1 - _p.y) / _z;
    const ry2 = (sy2 - _p.y) / _z;
    const g = guidesRef.current;
    const guideHits = new Set<string>();
    g.v.forEach((gv, i) => {
      if (gv.pos >= rx1 && gv.pos <= rx2) guideHits.add(guideKey("v", i));
    });
    g.h.forEach((gh, i) => {
      if (gh.pos >= ry1 && gh.pos <= ry2) guideHits.add(guideKey("h", i));
    });
    if (rect.additive) {
      setSelectedGuideKeys((prev) => new Set([...prev, ...guideHits]));
    } else {
      setSelectedGuideKeys(guideHits);
    }
    // Zones : intersect rubber-band (canvas-space) avec zone.x/y/w/h.
    const zoneHits = new Set<string>();
    for (const z of zones) {
      const zx1 = z.x,
        zy1 = z.y,
        zx2 = z.x + z.w,
        zy2 = z.y + z.h;
      if (zx1 < rx2 && zx2 > rx1 && zy1 < ry2 && zy2 > ry1) zoneHits.add(z.id);
    }
    if (rect.additive) setSelectedZoneIds((prev) => new Set([...prev, ...zoneHits]));
    else setSelectedZoneIds(zoneHits);
    if (zoneHits.size === 0 && !rect.additive) setSelectedZoneId(null);
    // Labels : intersect avec la bbox estimée (label.x/y + dimensions approx).
    const labelHits = new Set<string>();
    for (const lbl of canvasLabels) {
      const lx1 = lbl.x - 8,
        ly1 = lbl.y - 8;
      const lx2 = lbl.x + (lbl.text?.length ?? 1) * (lbl.fontSize ?? 14) * 0.6 + 8;
      const ly2 = lbl.y + (lbl.fontSize ?? 14) + 8;
      if (lx1 < rx2 && lx2 > rx1 && ly1 < ry2 && ly2 > ry1) labelHits.add(lbl.id);
    }
    if (rect.additive) setSelectedLabelIds((prev) => new Set([...prev, ...labelHits]));
    else setSelectedLabelIds(labelHits);
    if (labelHits.size === 0 && !rect.additive) setSelectedLabelId(null);

    // Nodes (équipements / panels / accessoires) : intersect avec la bbox du
    // node. Hauteur approximée par (header + ports * PORT_H) — cohérent avec
    // les hauteurs visuelles utilisées dans le rendu (cf. fit-all.ts).
    const nodeHits = new Set<string>();
    const slotPortsMap = slotPortsRef.current ?? new Map<string, Port[]>();
    for (const s of expandedSlots) {
      if (isSlotLockedRef.current(s.id)) continue;
      const pos = positionsRef.current.get(s.id);
      if (!pos) continue;
      const nodeW = s.panel ? PANEL_NODE_W : NODE_W;
      const ports = slotPortsMap.get(s.id) ?? [];
      const portsBySide = ports.reduce(
        (acc, p) => {
          if (p.side === "left") acc.left++;
          else acc.right++;
          return acc;
        },
        { left: 0, right: 0 },
      );
      const maxPorts = Math.max(portsBySide.left, portsBySide.right, 1);
      const nodeH = NODE_HEADER_H + Math.max(NODE_MIN_H, maxPorts * PORT_H);
      const nx1 = pos.x;
      const ny1 = pos.y;
      const nx2 = pos.x + nodeW;
      const ny2 = pos.y + nodeH;
      if (nx1 < rx2 && nx2 > rx1 && ny1 < ry2 && ny2 > ry1) nodeHits.add(s.id);
    }
    if (rect.additive) {
      setSelectedNodeIds((prev) => new Set([...prev, ...nodeHits]));
    } else {
      setSelectedNodeIds(nodeHits);
      // selectedNodeId reste le focus du panneau prop : si le set vide → null,
      // sinon on prend le 1er de la sélection (ordre stable de expandedSlots).
      if (nodeHits.size === 0) setSelectedNodeId(null);
      else setSelectedNodeId(nodeHits.values().next().value ?? null);
    }
    // Connexions externes : hit-test sur la bulle (rect) ET le trait
    // (segment port→bulle).
    const extHits = new Set<string>();
    const segHitsRect = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
    ): boolean => {
      const ptIn = (px: number, py: number) =>
        px >= rx1 && px <= rx2 && py >= ry1 && py <= ry2;
      if (ptIn(ax, ay) || ptIn(bx, by)) return true;
      const edges = [
        [rx1, ry1, rx2, ry1],
        [rx2, ry1, rx2, ry2],
        [rx2, ry2, rx1, ry2],
        [rx1, ry2, rx1, ry1],
      ] as const;
      for (const [ex1, ey1, ex2, ey2] of edges) {
        const d = (bx - ax) * (ey2 - ey1) - (by - ay) * (ex2 - ex1);
        if (Math.abs(d) < 1e-10) continue;
        const t = ((ex1 - ax) * (ey2 - ey1) - (ey1 - ay) * (ex2 - ex1)) / d;
        const u = ((ex1 - ax) * (by - ay) - (ey1 - ay) * (bx - ax)) / d;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
      }
      return false;
    };
    const OFFSET = 80;
    const BOX_H_EXT = 18;
    for (const ext of externalPortsRef.current) {
      const virt = realToVirtual(ext.slotId, ext.portIndex, activeSlots);
      const center = getPortCenterRef.current?.(virt.slotId, virt.portIndex);
      if (!center) continue;
      // Même source de vérité que le rendu (badge EXT inclus).
      const BOX_W = externalBubble(ext).width;
      const lx =
        center.side === "left"
          ? center.x - OFFSET - BOX_W / 2
          : center.x + OFFSET + BOX_W / 2;
      const ly = center.y;
      const bxl = lx - BOX_W / 2;
      const bxr = lx + BOX_W / 2;
      const byt = ly - BOX_H_EXT / 2;
      const byb = ly + BOX_H_EXT / 2;
      // Bbox bulle ∩ rubber-band ?
      const boxHit = bxl < rx2 && bxr > rx1 && byt < ry2 && byb > ry1;
      // Segment trait port → bulle ∩ rubber-band ?
      const lineX2 = center.side === "left" ? bxr : bxl;
      const segHit = segHitsRect(center.x, center.y, lineX2, ly);
      if (boxHit || segHit) extHits.add(ext.id);
    }
    if (rect.additive) {
      setSelectedExternalIds((prev) => new Set([...prev, ...extHits]));
    } else {
      setSelectedExternalIds(extHits);
    }
    if (extHits.size === 0 && !rect.additive) setSelectedExternalId(null);
    setPreviewConnIds(new Set());
    setPreviewZoneIds(new Set());
    setPreviewLabelIds(new Set());
    setPreviewExternalIds(new Set());
    setPreviewNodeIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubberBand]);

  // ── Keyboard Delete for selected cables ─────────────────────────────────────
  useEffect(() => {
    if (!publishToShell) return;
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      if (selectedConnIds.size > 0) {
        e.preventDefault();
        const ids = Array.from(selectedConnIds).filter((id) => !lockedLayerIdsRef.current.has(id));
        if (ids.length === 0) return;
        const n = ids.length;
        const ok = await delConfirm({
          title: "Supprimer les câbles ?",
          message: `Confirmer la suppression de ${n} câble${n > 1 ? "s" : ""}.`,
          confirmLabel: "Supprimer",
          variant: "danger",
        });
        if (ok) handleDeleteSelected();
        return;
      }
      if (selectedConnId) {
        if (lockedLayerIdsRef.current.has(selectedConnId)) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        const ok = await delConfirm({
          title: "Supprimer le câble ?",
          message: "Confirmer la suppression de ce câble.",
          confirmLabel: "Supprimer",
          variant: "danger",
        });
        if (ok) handleDeleteConnection(selectedConnId);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectedConnIds,
    selectedConnId,
    handleDeleteSelected,
    handleDeleteConnection,
    delConfirm,
    publishToShell,
  ]);

  // ── Enter: confirm multi-source selection ───────────────────────────────────
  useEffect(() => {
    if (!publishToShell) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      const msp = multiSrcPortsRef.current;
      if (!msp || multiSrcConfirmedRef.current) return;
      if (msp.portIndices.length === 0) return;
      e.preventDefault();
      setMultiSrcConfirmed(true);
      // drawingFrom stays on first port for snap/preview
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [publishToShell]);

  // ── Escape: cancel drawing / clear selection ────────────────────────────────
  useEffect(() => {
    if (!publishToShell) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      setDrawingFrom(null);
      setDrawingWaypoints([]);
      setMultiSrcPorts(null);
      setMultiSrcConfirmed(false);
      setMultiHoverTooltip(null);
      setSelectedNodeId(null);
      setSelectedConnId(null);
      setSelectedConnIds(new Set());
      setSelectedLabelId(null);
      setSelectedZoneId(null);
      setSelectedAdapterId(null);
      setSelectedGuideKeys(new Set());
      setDrawingZone(null);
      useTopbarActions.getState().clearLayerMultiSelect();
      if (toolRef.current === "zone")
        setTool(prevToolRef.current !== "zone" ? prevToolRef.current : "pan");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishToShell]);

  // ── Delete selected guide (repère) via Del / Backspace ──────────────────────
  useEffect(() => {
    if (!publishToShell) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active as HTMLElement).isContentEditable)
      )
        return;
      if (selectedGuideKeysRef.current.size === 0) return;
      e.preventDefault();
      e.stopPropagation();
      deleteSelectedGuide();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [deleteSelectedGuide, publishToShell]);

  // ── Delete selected zone, label or adapter ───────────────────────────────────
  const selectedZoneIdRef = useRef(selectedZoneId);
  selectedZoneIdRef.current = selectedZoneId;
  const selectedLabelIdRef = useRef(selectedLabelId);
  selectedLabelIdRef.current = selectedLabelId;
  const selectedZoneIdsRef = useRef(selectedZoneIds);
  selectedZoneIdsRef.current = selectedZoneIds;
  // Multi-sélection nodes : utilisé par handleNodeDragStart pour décider si
  // le drag concerne 1 seul node ou l'ensemble du set (multi-drag).
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;

  // Sync : si le single selectedNodeId tombe à null (désélection globale —
  // clic vide, Escape, etc.) on clear aussi le set multi pour rester cohérent.
  // Évite de modifier les ~10 endroits qui font setSelectedNodeId(null).
  useEffect(() => {
    if (selectedNodeId === null && selectedNodeIds.size > 0) {
      setSelectedNodeIds(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);
  const selectedLabelIdsRef = useRef(selectedLabelIds);
  selectedLabelIdsRef.current = selectedLabelIds;
  const selectedAdapterIdRef = useRef(selectedAdapterId);
  selectedAdapterIdRef.current = selectedAdapterId;
  const selectedExternalIdRef = useRef(selectedExternalId);
  selectedExternalIdRef.current = selectedExternalId;
  useEffect(() => {
    if (!publishToShell) return;
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active as HTMLElement).isContentEditable)
      )
        return;
      // Multi-sélection zones : supprime toutes (hors locked).
      const zids = selectedZoneIdsRef.current;
      if (zids.size > 1) {
        const deletable = [...zids].filter((id) => !lockedLayerIdsRef.current.has(id));
        if (deletable.length === 0) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        const ok = await delConfirm({
          title: `Supprimer ${deletable.length} zone${deletable.length > 1 ? "s" : ""} ?`,
          message: "Confirmer la suppression groupée.",
          confirmLabel: "Supprimer",
          variant: "danger",
        });
        if (!ok) return;
        pushHistoryRef.current?.();
        setSelectedZoneId(null);
        setSelectedZoneIds(new Set());
        for (const id of deletable) deleteZoneApi(id);
        setZones((prev) => prev.filter((z) => !deletable.includes(z.id)));
        return;
      }
      const zid = selectedZoneIdRef.current;
      if (zid) {
        if (lockedLayerIdsRef.current.has(zid)) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        const ok = await delConfirm({
          title: "Supprimer la zone ?",
          message: "Confirmer la suppression de cette zone.",
          confirmLabel: "Supprimer",
          variant: "danger",
        });
        if (!ok) return;
        pushHistoryRef.current?.();
        setSelectedZoneId(null);
        deleteZoneApi(zid);
        setZones((prev) => prev.filter((z) => z.id !== zid));
        return;
      }
      // Multi-sélection labels.
      const lids = selectedLabelIdsRef.current;
      if (lids.size > 1) {
        const deletable = [...lids].filter((id) => !lockedLayerIdsRef.current.has(id));
        if (deletable.length === 0) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        const ok = await delConfirm({
          title: `Supprimer ${deletable.length} label${deletable.length > 1 ? "s" : ""} ?`,
          message: "Confirmer la suppression groupée.",
          confirmLabel: "Supprimer",
          variant: "danger",
        });
        if (!ok) return;
        pushHistoryRef.current?.();
        setSelectedLabelId(null);
        setSelectedLabelIds(new Set());
        for (const id of deletable) deleteLabelApi(id);
        setCanvasLabels((prev) => prev.filter((l) => !deletable.includes(l.id)));
        return;
      }
      const lid = selectedLabelIdRef.current;
      if (lid) {
        if (lockedLayerIdsRef.current.has(lid)) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        const ok = await delConfirm({
          title: "Supprimer le label ?",
          message: "Confirmer la suppression de ce label.",
          confirmLabel: "Supprimer",
          variant: "danger",
        });
        if (!ok) return;
        pushHistoryRef.current?.();
        setSelectedLabelId(null);
        deleteLabelApi(lid);
        setCanvasLabels((prev) => prev.filter((l) => l.id !== lid));
        return;
      }
      const aid = selectedAdapterIdRef.current;
      if (aid) {
        if (lockedLayerIdsRef.current.has(aid)) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        const ok = await delConfirm({
          title: "Supprimer l'adaptateur ?",
          message: "Confirmer la suppression de cet adaptateur.",
          confirmLabel: "Supprimer",
          variant: "danger",
        });
        if (!ok) return;
        void handleAdapterDelete(aid);
        return;
      }
      // Connexion externe sélectionnée
      const extId = selectedExternalIdRef.current;
      if (extId) {
        e.preventDefault();
        setExternalPorts((prev) => prev.filter((e2) => e2.id !== extId));
        setSelectedExternalId(null);
        deleteExternalPortApi(extId);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleAdapterDelete, delConfirm, publishToShell]);

  // ── Clipboard (copy / cut / paste) ───────────────────────────────────────────
  // Uniquement zones et labels — jamais câbles ni adaptateurs.
  type ClipboardItem = { kind: "zone"; data: Zone } | { kind: "label"; data: CanvasLabel };

  type Clipboard = {
    items: ClipboardItem[];
    originX: number;
    originY: number;
  };

  const clipboardRef = useRef<Clipboard | null>(null);

  // Keep stable refs so callbacks can read latest state without being re-created on every render.
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const canvasLabelsRef = useRef(canvasLabels);
  canvasLabelsRef.current = canvasLabels;
  const adaptersRef2 = useRef(adapters);
  adaptersRef2.current = adapters;

  const copySelection = useCallback(() => {
    const items: ClipboardItem[] = [];
    let minX = Infinity,
      minY = Infinity;
    const zid = selectedZoneIdRef.current;
    if (zid) {
      const z = zonesRef.current.find((zz) => zz.id === zid);
      if (z) {
        items.push({ kind: "zone", data: z });
        minX = Math.min(minX, z.x);
        minY = Math.min(minY, z.y);
      }
    }
    const lid = selectedLabelIdRef.current;
    if (lid) {
      const l = canvasLabelsRef.current.find((ll) => ll.id === lid);
      if (l) {
        items.push({ kind: "label", data: l });
        minX = Math.min(minX, l.x);
        minY = Math.min(minY, l.y);
      }
    }
    if (items.length === 0) return;
    clipboardRef.current = {
      items,
      originX: minX === Infinity ? 0 : minX,
      originY: minY === Infinity ? 0 : minY,
    };
    pushToastRef.current(
      `${items.length} élément${items.length > 1 ? "s" : ""} copié${items.length > 1 ? "s" : ""}`,
      "info",
    );
  }, []);

  const cutSelection = useCallback(() => {
    copySelection();
    const zid = selectedZoneIdRef.current;
    if (zid) {
      pushHistoryRef.current?.();
      setSelectedZoneId(null);
      deleteZoneApi(zid);
      setZones((prev) => prev.filter((z) => z.id !== zid));
    }
    const lid = selectedLabelIdRef.current;
    if (lid) {
      pushHistoryRef.current?.();
      setSelectedLabelId(null);
      deleteLabelApi(lid);
      setCanvasLabels((prev) => prev.filter((l) => l.id !== lid));
    }
  }, [copySelection]);

  const pasteClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip) return;
    pushHistoryRef.current?.();
    const OFFSET = 24;
    const dx = OFFSET;
    const dy = OFFSET;

    for (const item of clip.items) {
      if (item.kind === "zone") {
        const newZone: Zone = {
          ...item.data,
          id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          x: item.data.x + dx,
          y: item.data.y + dy,
        };
        setZones((prev) => [...prev, newZone]);
        void createZoneApi(newZone);
      } else if (item.kind === "label") {
        const newLabel: CanvasLabel = {
          ...item.data,
          id: `label-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          x: item.data.x + dx,
          y: item.data.y + dy,
        };
        setCanvasLabels((prev) => [...prev, newLabel]);
        void createLabelApi(newLabel);
      }
    }
    pushToastRef.current(
      `${clip.items.length} élément${clip.items.length > 1 ? "s" : ""} collé${clip.items.length > 1 ? "s" : ""}`,
      "info",
    );
  }, [rackId]);

  useEffect(() => {
    if (!publishToShell) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      )
        return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "c") {
        e.preventDefault();
        copySelection();
      } else if (e.key === "x") {
        e.preventDefault();
        cutSelection();
      } else if (e.key === "v") {
        e.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, cutSelection, pasteClipboard, publishToShell]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  const prevToolRef = useRef<
    | "pan"
    | "select"
    | "move"
    | "label"
    | "zone"
    | "adapter"
    | "external"
    | "cable"
    | "numbering"
    | "erase"
    | "zoom"
  >("pan");
  useEffect(() => {
    if (!publishToShell) return;
    const onDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      // Tools
      if (k === "h") {
        prevToolRef.current = "pan";
        setTool("pan");
      }
      if (k === "s") {
        prevToolRef.current = "select";
        setTool("select");
      }
      if (k === "v") {
        prevToolRef.current = "move";
        setTool("move");
      }
      if (k === "t") {
        prevToolRef.current = toolRef.current !== "label" ? toolRef.current : prevToolRef.current;
        setTool("label");
      }
      if (k === "z") setTool("zone"); // prevToolRef already holds current tool
      if (k === "a" && !e.shiftKey) {
        prevToolRef.current = toolRef.current !== "adapter" ? toolRef.current : prevToolRef.current;
        setTool("adapter");
      }
      if (k === "c") {
        prevToolRef.current = toolRef.current !== "cable" ? toolRef.current : prevToolRef.current;
        setTool("cable");
      }
      if (k === "x") {
        prevToolRef.current =
          toolRef.current !== "external" ? toolRef.current : prevToolRef.current;
        setTool("external");
      }
      // Cable count
      if (k === "1") setCableCount("single");
      if (k === "2") setCableCount("multi");
      // Routing mode (auto routing déplacé sur Shift+A pour libérer A pour Adaptateur)
      if (k === "a" && e.shiftKey) setCableMode("auto");
      if (k === "m") setCableMode("multipoint");
      // Cable style (Q / W) — E est désormais réservé à l'outil Gomme
      if (k === "q") setCableStyle("ortho");
      if (k === "w") setCableStyle("rounded");
      if (k === "e") {
        prevToolRef.current = toolRef.current !== "erase" ? toolRef.current : prevToolRef.current;
        setTool("erase");
      }
      // Numbering
      if (k === "n") handleRenumber();
      // Note: Backspace is reserved for element deletion (handled in dedicated
      // effect above). Clear-labels is triggered from toolbar/menus only.
      // Temp pan with Space
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        prevToolRef.current = toolRef.current;
        setTool("pan");
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setTool(prevToolRef.current);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [handleRenumber, handleClearLabels, publishToShell]);

  // ── Compute port center purely from layout math (no DOM reads) ───────────────
  const getPortCenter = useCallback(
    (
      slotId: string,
      portIndex: number,
    ): { x: number; y: number; side: "left" | "right" } | null => {
      // Adapter virtual slotId : "__a__:<adapterId>:<side>"
      const ad = parseAdapterSlotId(slotId);
      if (ad) {
        const adapter = adapters.find((a) => a.id === ad.adapterId);
        if (!adapter) return null;
        // Position live de l'adaptateur (suit l'équipement attaché)
        let adX = adapter.x;
        let adY = adapter.y;
        if (adapter.attachedSlotId && adapter.attachedPortIndex != null) {
          const anchorCenter = getPortCenterRef.current?.(
            adapter.attachedSlotId,
            adapter.attachedPortIndex,
          );
          if (anchorCenter) {
            const FIRST_PORT_Y =
              ADAPTER_NODE_TITLE_H + ADAPTER_NODE_PAD_TOP + ADAPTER_NODE_PORT_H / 2;
            adX =
              adapter.attachedSide === "right" ? anchorCenter.x : anchorCenter.x - ADAPTER_NODE_W;
            adY = anchorCenter.y - FIRST_PORT_Y;
          }
        }
        const cy =
          adY +
          ADAPTER_NODE_TITLE_H +
          ADAPTER_NODE_PAD_TOP +
          portIndex * ADAPTER_NODE_PORT_H +
          ADAPTER_NODE_PORT_H / 2;
        const cx = ad.side === "left" ? adX : adX + ADAPTER_NODE_W;
        return { x: cx, y: cy, side: ad.side };
      }
      const pos = positions.get(slotId);
      if (!pos) return null;
      const ports = slotPorts.get(slotId) ?? [];
      const port = ports.find((p) => p.portIndex === portIndex);
      if (!port) return null;

      const leftPorts = ports.filter((p) => p.side === "left");
      const rightPorts = ports.filter((p) => p.side === "right");
      const nodeH = Math.max(
        NODE_MIN_H,
        NODE_HEADER_H + Math.max(leftPorts.length, rightPorts.length) * PORT_H + 12,
      );
      void nodeH;

      const sidePorts = port.side === "left" ? leftPorts : rightPorts;
      const sideIdx = sidePorts.findIndex((p) => p.portIndex === portIndex);
      if (sideIdx === -1) return null;

      const slot = expandedSlots.find((s) => s.id === slotId);
      const nodeW = slot?.panel ? PANEL_NODE_W : NODE_W;
      const cumulExtra = slotAdapterExtras.get(slotId)?.cumulByPortIdx.get(portIndex) ?? 0;

      // Détecte le mode "grouped" (equipment grouping en vue Générale) : si au
      // moins un port a un groupLabel, SynopticNode rend en bandes avec headers
      // intercalés. Il faut ajuster Y pour matcher visuellement la position du
      // dot port HTML.
      const hasAnyGroup = !slot?.panel && ports.some((p) => !!p.entry.groupLabel);
      let y: number;
      if (hasAnyGroup) {
        const HEADER_ROW_H = 22;
        // Reconstruit le même ordre de segments que SynopticNode : ordre du
        // tableau `ports` complet (hôte d'abord — groupLabel null —, puis
        // composants par slotIndex). DOIT rester symétrique de la dérivation
        // d'ordre dans SynopticNode, sinon les câbles s'ancrent à côté des ports.
        const orderedLabels: (string | null)[] = [];
        const seen = new Set<string | null>();
        for (const p of ports) {
          const lbl = p.entry.groupLabel ?? null;
          if (!seen.has(lbl)) {
            seen.add(lbl);
            orderedLabels.push(lbl);
          }
        }
        const myLabel = port.entry.groupLabel ?? null;
        let cumulY = 0;
        for (const lbl of orderedLabels) {
          const segLeft = leftPorts.filter((p) => (p.entry.groupLabel ?? null) === lbl);
          const segRight = rightPorts.filter((p) => (p.entry.groupLabel ?? null) === lbl);
          const headerH = lbl ? HEADER_ROW_H : 0;
          const rows = Math.max(segLeft.length, segRight.length);
          if (lbl === myLabel) {
            // Index du port dans son segment (pas dans toute la side)
            const myList = port.side === "left" ? segLeft : segRight;
            const idxInSeg = myList.findIndex((p) => p.portIndex === portIndex);
            y =
              pos.y +
              NODE_HEADER_H +
              6 +
              cumulY +
              headerH +
              idxInSeg * PORT_H +
              cumulExtra +
              PORT_H / 2;
            break;
          }
          cumulY += headerH + rows * PORT_H;
        }
        // Fallback (shouldn't happen) : formule historique
        y ??=
          pos.y + NODE_HEADER_H + 6 + sideIdx * PORT_H + cumulExtra + PORT_H / 2;
      } else {
        y = pos.y + NODE_HEADER_H + 6 + sideIdx * PORT_H + cumulExtra + PORT_H / 2;
      }
      const x = port.side === "left" ? pos.x : pos.x + nodeW;
      return { x, y, side: port.side };
    },
    [positions, slotPorts, expandedSlots, slotAdapterExtras, adapters],
  );
  getPortCenterRef.current = getPortCenter;
  adapterDragGetPortCenterRef.current = getPortCenter;

  // ── Cable paths — thin wrappers autour de _lib/cable-paths (fonctions pures) ──
  const makePath = useCallback(
    (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      side1: "left" | "right",
      side2: "left" | "right",
      styleOverride?: "ortho" | "rounded" | "arrow",
      safeBypassY?: number,
      laneOffset: number = 0,
      srcSlotId?: string,
      dstSlotId?: string,
    ): string => {
      const snap = useTopbarActions.getState();
      return buildCablePath(
        x1,
        y1,
        x2,
        y2,
        side1,
        side2,
        styleOverride ?? cableStyleRef.current,
        { snapEnabled: snap.snapEnabled, gridStep: snap.gridStep },
        {
          safeBypassY,
          laneOffset,
          srcSlotId,
          dstSlotId,
          avoidObstacles: avoidObstaclesMidX,
        },
      );
    },
    [avoidObstaclesMidX],
  );

  const makePathWithWaypoints = useCallback(
    (
      x1: number,
      y1: number,
      side1: "left" | "right",
      x2: number,
      y2: number,
      side2: "left" | "right",
      waypoints: { x: number; y: number }[],
      styleOverride?: "ortho" | "rounded" | "arrow",
      safeBypassY?: number,
      laneOffset: number = 0,
      srcSlotId?: string,
      dstSlotId?: string,
    ): string => {
      const snap = useTopbarActions.getState();
      return buildCablePathWithWaypoints(
        x1,
        y1,
        side1,
        x2,
        y2,
        side2,
        waypoints,
        styleOverride ?? cableStyleRef.current,
        { snapEnabled: snap.snapEnabled, gridStep: snap.gridStep },
        {
          safeBypassY,
          laneOffset,
          srcSlotId,
          dstSlotId,
          avoidObstacles: avoidObstaclesMidX,
        },
      );
    },
    [avoidObstaclesMidX],
  );

  // ── Compute midpoint + tangent angle for the direction arrow ─────────────────
  const getCableMidArrow = useCallback(
    (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      side1: "left" | "right",
      side2: "left" | "right",
    ): { mx: number; my: number; angle: number } => {
      const out1 = side1 === "right" ? 1 : -1;
      const out2 = side2 === "left" ? -1 : 1;
      const gap = Math.max(Math.abs(x2 - x1) * 0.4, 50);
      const ex1 = x1 + out1 * gap;
      const ex2 = x2 + out2 * gap;

      // Ortho & rounded: H ex1 V y2 H x2 — midpoint is on the vertical segment
      const midX = (ex1 + ex2) / 2;
      const segH1 = Math.abs(midX - x1);
      const segV = Math.abs(y2 - y1);
      const segH2 = Math.abs(x2 - midX);
      const total = segH1 + segV + segH2;
      const half = total / 2;
      if (half < segH1) {
        // midpoint on first horizontal segment
        const t = half / segH1;
        return { mx: x1 + t * (midX - x1), my: y1, angle: x2 > x1 ? 0 : 180 };
      } else if (half < segH1 + segV) {
        // midpoint on vertical segment
        const t = (half - segH1) / segV;
        const sy = y2 > y1 ? 1 : -1;
        return { mx: midX, my: y1 + t * (y2 - y1), angle: sy > 0 ? 90 : -90 };
      } else {
        // midpoint on last horizontal segment
        const t = (half - segH1 - segV) / segH2;
        return { mx: midX + t * (x2 - midX), my: y2, angle: x2 > midX ? 0 : 180 };
      }
    },
    [cableStyle],
  );

  // ── Auto-fit quand on devient visible (si pas de vue sauvegardée) ──────────
  useEffect(() => {
    if (!isVisible) return;
    if (viewInitializedRef.current) return;
    let attempts = 0;
    const tryFit = () => {
      const el = containerRef.current;
      if (el && el.getBoundingClientRect().width > 0) {
        fitAllRef.current();
      } else if (attempts < 20) {
        attempts++;
        setTimeout(tryFit, 50);
      }
    };
    setTimeout(tryFit, 30);
     
  }, [isVisible]);

  // ── Fit all ─────────────────────────────────────────────────────────────────
  const fitAllRef = useRef<() => void>(() => {});
  const handleCenterRef = useRef<() => void>(() => {});
  // Compute bbox of all visible content (nodes + zones + labels + cables)
  const computeBounds = useCallback(() => {
    if (
      expandedSlots.length === 0 &&
      zones.length === 0 &&
      canvasLabels.length === 0 &&
      adapters.length === 0
    )
      return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const expand = (x: number, y: number) => {
      if (!isFinite(x) || !isFinite(y)) return;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    for (const slot of expandedSlots) {
      const pos = positions.get(slot.id);
      if (!pos) continue;
      const ports = slotPorts.get(slot.id) ?? [];
      const leftCount = ports.filter((p) => p.side === "left").length;
      const rightCount = ports.filter((p) => p.side === "right").length;
      const nodeW = slot.panel ? PANEL_NODE_W : NODE_W;
      const h = Math.max(NODE_MIN_H, NODE_HEADER_H + Math.max(leftCount, rightCount) * PORT_H + 12);
      expand(pos.x, pos.y);
      expand(pos.x + nodeW, pos.y + h);
    }
    for (const ad of adapters) {
      let adX = ad.x,
        adY = ad.y;
      if (ad.attachedSlotId && ad.attachedPortIndex != null) {
        const anchorCenter = getPortCenterRef.current?.(ad.attachedSlotId, ad.attachedPortIndex);
        if (anchorCenter) {
          const FIRST_PORT_Y =
            ADAPTER_NODE_TITLE_H + ADAPTER_NODE_PAD_TOP + ADAPTER_NODE_PORT_H / 2;
          adX = ad.attachedSide === "right" ? anchorCenter.x : anchorCenter.x - ADAPTER_NODE_W;
          adY = anchorCenter.y - FIRST_PORT_Y;
        }
      }
      const adH = adapterNodeHeight(ad);
      expand(adX, adY);
      expand(adX + ADAPTER_NODE_W, adY + adH);
    }
    for (const zone of zones) {
      expand(zone.x, zone.y);
      expand(zone.x + zone.w, zone.y + zone.h);
    }
    for (const lbl of canvasLabels) {
      const approxW = lbl.text.length * lbl.fontSize * 0.6;
      expand(lbl.x, lbl.y - lbl.fontSize);
      expand(lbl.x + approxW, lbl.y);
    }
    if (!isFinite(minX) || !isFinite(minY)) return null;
    return { minX, minY, maxX, maxY };
  }, [expandedSlots, positions, slotPorts, zones, canvasLabels, adapters]);

  // Center current content without changing zoom
  const handleCenter = useCallback(() => {
    const b = computeBounds();
    if (!b) return;
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    const z = viewRef.current.zoom;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const newPan = { x: width / 2 - cx * z, y: height / 2 - cy * z };
    if (!isFinite(newPan.x) || !isFinite(newPan.y)) return;
    viewRef.current = { pan: newPan, zoom: z };
    setPan(newPan);
  }, [computeBounds]);
  handleCenterRef.current = handleCenter;

  // Always keep ref pointing to latest fitAll (avoids stale closure in useEffect)
  // Calcule les pan/zoom pour englober toute la scène sans muter l'état.
  // Retourne aussi la bbox pour usages externes (export offscreen).
  // Fit-all — logique pure extraite dans _lib/fit-all.ts
  const computeFitAll = useCallback(
    (targetW?: number, targetH?: number) => {
      const el = containerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const w = targetW ?? rect.width;
      const h = targetH ?? rect.height;
      if (w === 0 || h === 0) return null;
      const bounds = computeSceneBounds(
        expandedSlots,
        positions,
        slotPorts,
        zones,
        canvasLabels,
        adapters,
        getPortCenterRef.current,
      );
      if (!bounds) return null;
      return computeFitAllViewport(bounds, w, h);
    },
    [expandedSlots, positions, slotPorts, zones, canvasLabels, adapters],
  );

  const fitAll = useCallback(() => {
    const r = computeFitAll();
    if (!r) return;
    viewRef.current = { pan: r.pan, zoom: r.zoom };
    setZoom(r.zoom);
    setPan(r.pan);
    viewInitializedRef.current = true;
  }, [computeFitAll]);
  fitAllRef.current = fitAll;

  // ── Zoom helpers for toolbar ──────────────────────────────────────────────
  const handleZoomIn = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const { pan: p, zoom: z } = viewRef.current;
    const mx = width / 2;
    const my = height / 2;
    const newZ = Math.min(5, z * 1.25);
    const ratio = newZ / z;
    const newPan = { x: mx - (mx - p.x) * ratio, y: my - (my - p.y) * ratio };
    viewRef.current = { pan: newPan, zoom: newZ };
    setZoom(newZ);
    setPan(newPan);
  }, []);
  const handleZoomOut = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const { pan: p, zoom: z } = viewRef.current;
    const mx = width / 2;
    const my = height / 2;
    const newZ = Math.min(5, z / 1.25);
    const ratio = newZ / z;
    const newPan = { x: mx - (mx - p.x) * ratio, y: my - (my - p.y) * ratio };
    viewRef.current = { pan: newPan, zoom: newZ };
    setZoom(newZ);
    setPan(newPan);
  }, []);

  // ── Style change handler for toolbar ──────────────────────────────────────
  const handleToolbarStyleChange = useCallback(
    (style: "ortho" | "rounded" | "arrow") => {
      const sel = selectedConnId;
      if (sel) {
        pushHistoryRef.current?.();
        setConnStyles((prev) => {
          const next = new Map(prev);
          next.set(sel, style);
          saveConnStyles(next);
          return next;
        });
        void cabling.patchOne(sel, { cableStyle: style }).catch(console.error);
      } else {
        setCableStyle(style);
        try {
          localStorage.setItem(`synoptic-cable-style-${viewKeyBase}`, style);
        } catch {}
      }
    },
    [selectedConnId, viewKeyBase, cabling, saveConnStyles, setCableStyle],
  );

  // Ref for bypassYMap so exportSynopticPDF (declared before bypassYMap) can access it
  const bypassYMapRef = useRef(new Map<string, number>());

  /**
   * Traduit la scène en descripteurs de cartes pour le rendu vectoriel.
   *
   * C'est l'adaptateur entre l'état de la vue et le module PUR
   * `scene-descriptor` : les dérivations d'affichage (libellé de port,
   * direction effective, pastille pleine, badges) sont reprises telles quelles
   * de `SynopticNode`. Les ANCRES, elles, ne sont pas recalculées : elles
   * viennent de `getPortCenter`, celle-là même qui ancre les câbles.
   */
  const buildExportCardInputs = useCallback((): CardSlotInput[] => {
    const out: CardSlotInput[] = [];
    for (const slot of expandedSlots) {
      if (isSlotHidden(slot.id)) continue;
      const ports = slotPorts.get(slot.id) ?? [];
      const eq = slot.equipment;
      const panel = slot.panel;
      const virtual = isPanelVirtualId(slot.id) ? getVirtualRowInfo(slot.id) : null;

      const connected = new Set<number>();
      for (const c of resolvedConnections) {
        if (c.fromSlotId === slot.id) connected.add(c.fromConnectorIndex);
        if (c.toSlotId === slot.id) connected.add(c.toConnectorIndex);
      }
      for (const a of adapters) {
        if (a.attachedSlotId === slot.id && a.attachedPortIndex != null) {
          connected.add(a.attachedPortIndex);
        }
      }
      const external = externalPortsBySlot.get(slot.id);

      const badges: CardBadge[] = [];
      if (!panel) {
        if (eq?.heightU != null && eq.heightU > 0)
          badges.push({ text: `${eq.heightU}U`, color: null });
        if (eq?.powerW != null && eq.powerW > 0)
          badges.push({ text: `${eq.powerW}W`, color: null });
        if (eq?.weight != null && eq.weight > 0)
          badges.push({ text: `${eq.weight}kg`, color: null });
      }

      const rack = rackLabels ? rackLabels[rackFor(slot.id)] : undefined;

      out.push({
        id: slot.id,
        isPanel: !!panel,
        title: slot.label ?? (panel ? panel.name : (eq?.reference ?? eq?.name ?? "—")),
        subtitle: panel
          ? null
          : ([eq?.brand?.name, eq?.name].filter(Boolean).join(" · ") || null),
        rowLabel: panel && virtual ? `U${virtual.rowIdx + 1}` : null,
        container:
          !panel && rack ? { label: rack.name, color: rack.color ?? null } : null,
        badges,
        ports: ports.map((p) => {
          const signalType = p.ct
            ? `${p.ct.name}${p.ct.version ? ` ${p.ct.version}` : ""}`
            : null;
          const base = p.entry.label?.trim() || signalType || "—";
          const rawDir = p.entry.direction?.toUpperCase();
          const dir = panel
            ? panelPortDirs.get(`${slot.id}:${p.portIndex}`)
            : rawDir === "BIDIR" || rawDir === "BOTH"
              ? "BIDIR"
              : rawDir === "IN" || rawDir === "OUT"
                ? rawDir
                : undefined;
          const num = p.entryIndex + 1;
          return {
            portIndex: p.portIndex,
            side: p.side,
            color: p.ct?.color ?? "#71717a",
            label: p.totalUnits > 1 ? `${base} ${p.unitIndex + 1}` : base,
            panelLabel: panel
              ? `${num} · ${signalType ?? "—"} · ${num}`
              : null,
            direction: (dir ?? null) as CardSlotInput["ports"][number]["direction"],
            filled: connected.has(p.portIndex) || !!external?.has(p.portIndex),
            entryIndex: p.entryIndex,
            groupLabel: p.entry.groupLabel ?? null,
          };
        }),
      });
    }
    return out;
  }, [
    expandedSlots,
    slotPorts,
    resolvedConnections,
    adapters,
    externalPortsBySlot,
    panelPortDirs,
    rackLabels,
    rackFor,
    isSlotHidden,
  ]);

  /**
   * Signaux présents, pour la légende. Même dérivation que le panneau flottant
   * — fallback sur le port pair quand un port de transit n'a pas de signal
   * propre.
   */
  const buildLegendRows = useCallback(() => {
    const present = new Map<string, { name: string; color: string; count: number }>();
    for (const conn of connections) {
      const fromPorts = getPortsForSlotOrAdapterRef.current?.(conn.fromSlotId) ?? [];
      const toPorts = getPortsForSlotOrAdapterRef.current?.(conn.toSlotId) ?? [];
      const fromP = fromPorts.find((p) => p.portIndex === conn.fromConnectorIndex);
      const toP = toPorts.find((p) => p.portIndex === conn.toConnectorIndex);
      const sigName = fromP?.entry.signalName ?? toP?.entry.signalName ?? null;
      if (!sigName) continue;
      const sigInfo = (signals ?? []).find((s) => s.name === sigName);
      const color =
        (conn.color as string | null | undefined) ?? sigInfo?.color ?? "#888";
      const prev = present.get(sigName);
      if (prev) prev.count++;
      else present.set(sigName, { name: sigName, color, count: 1 });
    }
    return [...present.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [connections, signals]);

  /**
   * Prépare une COPIE prête à rendre de la scène : sous-arbre cloné, chrome
   * d'édition retiré, cadrage appliqué.
   *
   * Partagée entre l'export (qui la capture hors écran) et l'aperçu du modal
   * (qui la monte dans la feuille). C'est ce partage qui garantit que le
   * document produit est exactement ce que l'aperçu montre — une seule
   * préparation, pas deux implémentations parallèles.
   *
   * La copie ne rend QUE le plan. Tout le reste — grille, repères, règles,
   * minimap, fond de canevas — appartient à l'éditeur, pas au document ; rien
   * de tout cela n'est négociable par option, un export montre le plan.
   */
  const buildExportClone = useCallback(
    (opts?: SynopticExportCloneOpts): SynopticExportClone | null => {
      const el = containerRef.current;
      if (!el) return null;

      const rect = el.getBoundingClientRect();
      const width = Math.max(1, Math.round(opts?.box?.w ?? rect.width));
      const height = Math.max(1, Math.round(opts?.box?.h ?? rect.height));

      const bounds =
        computeSceneBounds(
          expandedSlots,
          positions,
          slotPorts,
          zones,
          canvasLabels,
          adapters,
          getPortCenterRef.current,
        ) ?? null;
      // Ajustement par défaut : le plan remplit la boîte. Pas de plafond à 1 —
      // sur une feuille, un petit plan doit remplir sa zone (voir `maxZoom`).
      const fit = bounds
        ? computeFitAllViewport(
            bounds,
            width,
            height,
            Math.round(Math.min(width, height) * EXPORT_FIT_PADDING_RATIO),
            EXPORT_MAX_ZOOM,
          )
        : null;
      const camera: SynopticExportCamera =
        opts?.camera ??
        (fit
          ? { zoom: fit.zoom, pan: fit.pan }
          : { zoom: viewRef.current.zoom, pan: viewRef.current.pan });

      const node = el.cloneNode(true) as HTMLElement;
      for (const sel of EXPORT_HIDE_SELECTORS) {
        node.querySelectorAll(sel).forEach((n) => (n as HTMLElement).remove());
      }
      const inner = node.querySelector<HTMLElement>("[data-synoptic-transform]");
      if (inner) {
        inner.style.transform = `translate(${camera.pan.x}px, ${camera.pan.y}px) scale(${camera.zoom})`;
      }
      node.style.width = `${width}px`;
      node.style.height = `${height}px`;
      // Le fond de canevas est une couleur d'ÉDITEUR (et sombre selon le
      // thème) : sur une feuille blanche il se verrait comme un aplat. La
      // copie est transparente, le support fournit le fond.
      node.style.background = "transparent";
      // Copie inerte : aucun geste ne doit l'atteindre.
      node.style.pointerEvents = "none";
      return { node, width, height, camera, bounds };
    },
    [expandedSlots, positions, slotPorts, zones, canvasLabels, adapters],
  );
  buildExportCloneRef.current = buildExportClone;

  // ── PDF export ─────────────────────────────────────────────────────────────
  // Thin React wrapper around lib/pdf/synoptic-export.ts. Builds a snapshot
  // of the current scene + viewport and delegates the heavy lifting (canvas
  // raster + jsPDF cartouche layout) to a pure module.
  const exportSynopticPDF = useCallback(
    async (opts?: SynopticPdfExportOpts): Promise<SynopticExportResult> => {
      setPdfLoading(true);
      setShowPdfModal(false);
      // Une seule trace, en fin de génération : format, taille de capture et
      // durée totale. De quoi repérer une dérive sans bruiter la console — le
      // détail étape par étape a servi au diagnostic, il n'a plus lieu d'être.
      const t0 = performance.now();
      /**
       * Hôte hors écran de la copie. Déclaré ICI et démonté dans le `finally` :
       * le rendu vectoriel a besoin que la copie reste ATTACHÉE pendant tout
       * l'assemblage (svg2pdf mesure les textes via le moteur de rendu), on ne
       * peut donc plus la retirer aussitôt après la capture.
       */
      let mountedHost: HTMLElement | null = null;
      try {
        const kind = opts?.kind ?? "pdf";
        /**
         * Mode DEMANDÉ, tracé avant toute chose. Sans cette ligne, un document
         * sorti en image est ambigu : réglage jamais basculé, ou repli
         * silencieux ? La trace d'entrée et celle de sortie se lisent ensemble
         * et lèvent le doute sans instrumenter le reste.
         */
        const requestedRender = opts?.render ?? "raster";
        console.info(`[poster] demande : ${kind} / rendu ${requestedRender}`);
        // Le cadrage vient de l'aperçu : le document EST ce que la page montre.
        const prepared = buildExportCloneRef.current?.({
          box: opts?.frame?.box,
          camera: opts?.frame?.camera,
        });
        if (!prepared) throw new Error("Vue synoptique introuvable.");
        const { node: clone, width: targetW, height: targetH } = prepared;

        // Capture offscreen via clone → aucun flash visuel.
        const { captureElementToCanvas, canvasToPngDataUrl } = await import(
          "@/lib/export/synoptic-capture"
        );
        // Positionne le clone offscreen (absolu, pointer-events none, hors viewport)
        // mais avec les dimensions réelles pour que html-to-image fonctionne.
        const host = document.createElement("div");
        host.style.position = "fixed";
        host.style.left = "-99999px";
        host.style.top = "0";
        host.style.width = `${targetW}px`;
        host.style.height = `${targetH}px`;
        host.style.pointerEvents = "none";
        host.style.background = "#ffffff";
        clone.style.width = `${targetW}px`;
        clone.style.height = `${targetH}px`;
        host.appendChild(clone);
        document.body.appendChild(host);
        mountedHost = host;

        // ── Rendu vectoriel : préparation ────────────────────────────────
        // TOUT ce qui peut échouer se joue AVANT la capture : chargement de
        // svg2pdf, présence de couches, aplatissement des styles. Un échec ici
        // ramène simplement au rendu image, sans que rien n'ait été produit.
        // Une fois l'assemblage lancé, le repli coûterait une seconde capture.
        let vector: {
          layers: { base: SVGSVGElement[]; over: SVGSVGElement[] };
          frame: VectorFrame;
          cards: EquipmentCardDescriptor[];
          legend: LegendDescriptor | null;
          palette: CardPalette;
        } | null = null;
        // Chronos par étape : sans eux, un export lent ne dit pas OÙ il est
        // lent, et on optimise à l'aveugle.
        let msInline = 0;
        let msCapture = 0;
        let msEncode = 0;
        if (kind === "pdf" && requestedRender === "vector") {
          try {
            const layers = collectSceneLayers(clone);
            if (layers.base.length + layers.over.length === 0) {
              throw new Error("Aucune couche de scène à vectoriser.");
            }
            await ensureSvg2Pdf();
            const tInline0 = performance.now();
            let dropped = 0;
            for (const layer of [...layers.base, ...layers.over]) {
              dropped += await inlineSvgPresentation(layer);
            }
            msInline = Math.round(performance.now() - tInline0);
            // Repères de doublon recalés sur la police du document : leur
            // position dépend de la largeur d'un texte, qui change avec la
            // substitution de police.
            const recalibrated = recalibrateDuplicateMarkers(clone);
            // Les cartes sont redessinées : leurs ancres viennent de
            // `getPortCenter`, la même fonction qui pose les câbles.
            const cards = buildEquipmentCards(
              buildExportCardInputs(),
              positions,
              (slotId, portIndex) => getPortCenterRef.current?.(slotId, portIndex),
            );
            // La légende est du HTML flottant : sa boîte est MESURÉE sur la
            // copie, dans le repère de la feuille. C'est ce qui la place là où
            // l'aperçu la montre, plutôt qu'à un coin décidé d'avance.
            const legendEl = clone.querySelector<HTMLElement>(".synoptic-legend");
            const legend: LegendDescriptor | null = legendEl
              ? {
                  x: legendEl.offsetLeft,
                  y: legendEl.offsetTop,
                  w: legendEl.offsetWidth,
                  h: legendEl.offsetHeight,
                  title: "Légende",
                  rows: buildLegendRows(),
                  emptyText: "Aucun signal câblé pour l'instant.",
                }
              : null;
            const pageMm = PAGE_MM[opts?.format ?? pdfFormat];
            // `PAGE_MM` est déclaré en paysage : le portrait échange les cotes.
            const pageVec =
              opts?.orientation === "PORTRAIT"
                ? { w: pageMm[1], h: pageMm[0] }
                : { w: pageMm[0], h: pageMm[1] };
            vector = {
              layers,
              frame: {
                box: { w: targetW, h: targetH },
                camera: prepared.camera,
                page: pageVec,
              },
              cards,
              legend,
              // Palette lue sur la COPIE : c'est elle qui porte le thème
              // courant, et un thème sombre y sera remplacé par celui du
              // document.
              palette: resolveCardPalette(clone),
            };
            // Retirée de la copie SEULEMENT une fois le vectoriel acquis :
            // elle sera redessinée. La retirer plus tôt l'aurait fait
            // disparaître d'un repli image survenu entre-temps.
            legendEl?.remove();
            console.info(
              `[poster] vectoriel prêt — ${layers.base.length + layers.over.length} couche(s), ${cards.length} carte(s)${legend ? ", légende" : ""}, ${dropped} élément(s) invisibles retirés, ${recalibrated} repère(s) recalé(s)`,
            );
          } catch (e) {
            // Un repli MUET est pire que l'échec : l'utilisateur repart avec un
            // document qu'il croit vectoriel, et personne ne sait que la bascule
            // n'a rien donné. Console pour la cause, toast pour le fait.
            console.warn("[poster] vectoriel indisponible, repli image", e);
            pushToast("Rendu vectoriel indisponible — export en image.", "warn");
            vector = null;
          }
        }

        // ── Capture ──────────────────────────────────────────────────────
        // En VECTORIEL, il n'y en a plus AUCUNE : les couches partent en
        // objets et les cartes sont redessinées. C'est là que disparaissent
        // les secondes de sérialisation `html-to-image` — le coût dominant de
        // l'export, et la cause de l'onglet qui semblait figé.
        const needsCapture = kind === "png" || !vector;
        let canvas: HTMLCanvasElement | null = null;
        let capturedW = 0;
        let capturedH = 0;

        if (needsCapture) {
          // Budget de pixels ABSOLU. La surface source dépend de la taille de
          // la zone de travail : un ratio seul ne dit rien de la mémoire
          // allouée, et c'est ce qui faisait tomber l'onglet sur un grand plan.
          //
          // 64 Mpx : allocation TRANSITOIRE (un canvas, une dataURL, relâchés
          // dès l'assemblage) et non un cumul. Elle reste sous le plafond de
          // surface d'un canvas navigateur (2^28 px sur Chromium).
          const maxPixels = opts?.maxCapturePixels ?? 64_000_000;
          const wanted = opts?.pixelRatio ?? 4;
          const sourcePixels = Math.max(1, targetW * targetH);
          const ratio = Math.min(wanted, Math.sqrt(maxPixels / sourcePixels));
          if (ratio < wanted) {
            console.info(
              `[synoptic-export] capture ramenée à ×${ratio.toFixed(2)} (budget ${Math.round(maxPixels / 1e6)} MP)`,
            );
          }
          // Délai de garde. `html-to-image` n'expose aucune annulation : la
          // course laisse la sérialisation se poursuivre en arrière-plan, mais
          // elle rend la main à l'interface au lieu de la laisser figée
          // indéfiniment. C'est un garde-fou, pas un correctif — si ce délai se
          // déclenche, la cause est en amont.
          const CAPTURE_TIMEOUT_MS = 60_000;
          const tCapture0 = performance.now();
          canvas = await Promise.race([
            captureElementToCanvas(clone, {
              pixelRatio: ratio,
              background: "#ffffff",
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Capture interrompue après ${CAPTURE_TIMEOUT_MS / 1000} s — plan trop lourd à sérialiser.`,
                    ),
                  ),
                CAPTURE_TIMEOUT_MS,
              ),
            ),
          ]);
          msCapture = Math.round(performance.now() - tCapture0);
          // Cotes retenues AVANT toute libération du tampon : la trace doit
          // survivre au relâchement du canvas.
          capturedW = canvas.width;
          capturedH = canvas.height;
        }

        /**
         * Trace unique de fin de génération. Elle annonce le mode RÉELLEMENT
         * employé, et le signale explicitement quand il diffère de la demande —
         * c'est ce qui distingue un réglage jamais basculé d'un repli.
         */
        const summary = (label: string, blob?: Blob) => {
          const mode = vector
            ? `vectoriel (${vector.layers.base.length + vector.layers.over.length} couches, ${vector.cards.length} cartes)`
            : requestedRender === "vector"
              ? "image (REPLI)"
              : "image";
          const steps = [
            msInline ? `aplatissement ${msInline}` : null,
            needsCapture ? `capture ${msCapture}` : "sans capture",
            msEncode ? `encodage ${msEncode}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const size = needsCapture ? ` — capture ${capturedW}×${capturedH}` : "";
          // Le POIDS est le signe le plus lisible du mode réellement employé :
          // un plan vectoriel pèse quelques mégaoctets là où le même en image
          // en pèse cent.
          const weight = blob
            ? ` — ${(blob.size / 1e6).toFixed(blob.size < 1e7 ? 2 : 1)} Mo`
            : "";
          console.info(
            `[poster] ${label} ${mode}${size}${weight} — ${steps} — total ${Math.round(performance.now() - t0)} ms`,
          );
        };

        if (kind === "png") {
          // `needsCapture` est vrai dès que `kind === "png"` : le canvas existe
          // forcément. Le contrôle est là pour que ça reste vrai après une
          // retouche de la condition, pas pour couvrir un cas connu.
          if (!canvas) throw new Error("Capture indisponible pour l'image.");
          // Copie en `const` : le rétrécissement de type d'un `let` ne survit
          // pas à une fermeture.
          const shot = canvas;
          const blob = await new Promise<Blob>((resolve, reject) =>
            shot.toBlob(
              (b) => (b ? resolve(b) : reject(new Error("Capture PNG échouée."))),
              "image/png",
            ),
          );
          summary("PNG", blob);
          return { blob, pageCount: 1 };
        }
        // PDF : charge jsPDF via CDN (même approche que l'ancien export).
        type JsPDFClass = new (
          opts: Record<string, unknown>,
        ) => Record<string, unknown>;
        await ensureJsPdf();
        const JsPDFCtor = (window as unknown as { jspdf: { jsPDF: JsPDFClass } }).jspdf.jsPDF;
        const format = opts?.format ?? pdfFormat;
        // `PAGE_MM` est déclaré en paysage : le portrait échange les cotes.
        const isPortrait = opts?.orientation === "PORTRAIT";
        const [landW, landH] = PAGE_MM[format];
        const wMm = isPortrait ? landH : landW;
        const hMm = isPortrait ? landW : landH;
        // `JSPDF_BASE` porte `compress: true`. Sans lui, jsPDF écrit les images
        // SANS AUCUN filtre : le seul logo du cartouche pèse alors 600×600×3 =
        // 1,1 Mo de flux brut, et une capture pleine page se comptait en
        // centaines de mégaoctets.
        const doc = new JsPDFCtor({
          ...JSPDF_BASE,
          unit: "mm",
          format: [wMm, hMm],
          orientation: isPortrait ? "portrait" : "landscape",
        }) as unknown as VectorDoc & {
          setDrawColor: (r: number, g?: number, b?: number) => void;
          setFillColor: (r: number, g?: number, b?: number) => void;
          setTextColor: (r: number, g?: number, b?: number) => void;
          setLineWidth: (w: number) => void;
          rect: (
            x: number,
            y: number,
            w: number,
            h: number,
            style?: string | null,
          ) => void;
          line: (x1: number, y1: number, x2: number, y2: number) => void;
          setFontSize: (s: number) => void;
          setFont: (f: string, style?: string) => void;
          text: (t: string, x: number, y: number) => void;
          addImage: (url: string, type: string, x: number, y: number, w: number, h: number) => void;
          output: (type: "blob") => Blob;
        };

        // ── Layout ─────────────────────────────────────────────────────────
        // Le cartouche provient TOUJOURS du modèle d'impression choisi par
        // l'utilisateur (`TenantPrintTemplate`). Cas normal : le layout
        // WYSIWYG du modèle est rasterisé en transparent et superposé au plan.
        // Secours (modèle sans layout) : chrome générique depuis les slots.
        if (!opts?.cartouche) {
          throw new Error("Aucun modèle de cartouche sélectionné (Paramètres › Impression).");
        }
        const { template, slotValues = {} } = opts.cartouche;
        const now = new Date();
        const date = now.toLocaleDateString("fr-FR");
        const rev = opts?.revision ?? pdfRevision;

        // PNG, sans perte : le plan est du TRAIT et du TEXTE. Un JPEG y
        // sèmerait des artefacts de blocs sur chaque filet, précisément ce
        // qu'on regarde en zoomant.
        //
        // Encodage ASYNCHRONE : `toDataURL` est synchrone et fige l'onglet
        // plusieurs secondes sur un canvas de cette taille — c'est ce qui
        // donnait l'impression d'un plantage. En vectoriel il n'y a plus de
        // canvas du tout.
        let planImage: { dataUrl: string; ratio: number } | null = null;
        if (canvas) {
          const tEncode0 = performance.now();
          const ratioCanvas = canvas.width / canvas.height;
          planImage = { dataUrl: await canvasToPngDataUrl(canvas), ratio: ratioCanvas };
          msEncode = Math.round(performance.now() - tEncode0);
          // Le canvas a fait son office : on relâche son tampon MAINTENANT
          // plutôt que d'attendre le ramasse-miettes. À 64 Mpx il pèse ~256 Mo,
          // et jsPDF va en allouer autant pour l'assemblage.
          canvas.width = 0;
          canvas.height = 0;
        }

        // Fond blanc pleine page dans tous les cas.
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, wMm, hMm, "F");

        const letterbox = (zone: { x: number; y: number; w: number; h: number }) => {
          if (!planImage) return;
          const ratioBox = zone.w / zone.h;
          const drawW = planImage.ratio > ratioBox ? zone.w : zone.h * planImage.ratio;
          const drawH = planImage.ratio > ratioBox ? zone.w / planImage.ratio : zone.h;
          doc.addImage(
            planImage.dataUrl,
            "PNG",
            zone.x + (zone.w - drawW) / 2,
            zone.y + (zone.h - drawH) / 2,
            drawW,
            drawH,
          );
        };

        // Le plan couvre TOUTE la feuille, le cartouche se pose par-dessus :
        // ses bandes sont opaques, elles masquent ce qui passe dessous. C'est
        // le même découpage qu'à l'aperçu, où le plan est cadré librement et
        // coupé au bord de la page. `letterbox` reste le garde-fou du chemin
        // hérité, dont la capture n'a pas le format de la feuille.
        const fullPage = { x: 0, y: 0, w: wMm, h: hMm };

        /**
         * Pose le plan sur la feuille.
         *
         * En vectoriel, l'ordre de peinture de l'écran est respecté : couches
         * `base` (câbles, zones, libellés) → CARTES d'équipement → couches
         * `over` (adaptateurs, ports externes, qui portent un z-index).
         * Intercaler les cartes entre les deux est ce qui évite de voir les
         * câbles passer par-dessus les équipements.
         */
        const drawPlan = async (zone = fullPage) => {
          if (!vector) {
            letterbox(zone);
            return;
          }
          await drawSceneLayers(doc, vector.layers.base, vector.frame);
          drawEquipmentCards(
            doc as unknown as CardDoc,
            vector.cards,
            vector.frame,
            vector.palette,
          );
          await drawSceneLayers(doc, vector.layers.over, vector.frame);
          // La légende flotte AU-DESSUS du plan et hors de son repère : elle
          // vient donc en dernier, comme à l'écran.
          if (vector.legend) {
            drawLegend(
              doc as unknown as CardDoc,
              vector.legend,
              vector.frame,
              vector.palette,
            );
          }
        };

        if (opts.cartouche.overlaySvg) {
          // ── Calque fourni par l'appelant (« Modèle standard ») ───────────
          const { overlaySvg, rasterizeOverlay } = opts.cartouche;
          await drawPlan();
          if (vector) {
            await drawOverlaySvg(doc, overlaySvg, { w: wMm, h: hMm });
          } else if (rasterizeOverlay) {
            doc.addImage(await rasterizeOverlay(), "PNG", 0, 0, wMm, hMm);
          } else {
            throw new Error("Habillage indisponible en rendu image.");
          }
        } else if (!template) {
          throw new Error("Aucun modèle de cartouche sélectionné (Paramètres › Impression).");
        } else if (cartoucheHasLayout(template)) {
          // ── Layout WYSIWYG : plan pleine page + overlay.
          await drawPlan();
          const overrides = {
            ...opts.cartouche.overrides,
            "{rack.name}": rackName,
            "{date.iso}": now.toISOString().slice(0, 10),
            ...slotValues,
          };
          if (vector) {
            // La source SVG plutôt que son aplat : c'est le gain le plus net du
            // vectoriel, un cartouche n'étant que du texte et des filets.
            await drawOverlaySvg(
              doc,
              buildCartoucheLayoutSvg(template, overrides, wMm, hMm),
              { w: wMm, h: hMm },
            );
          } else {
            doc.addImage(
              await rasterizeCartoucheLayout(template, overrides, wMm, hMm),
              "PNG",
              0,
              0,
              wMm,
              hMm,
            );
          }
        } else {
          // ── Secours : cadre technique + chrome depuis les slots.
          const frame = computeCartoucheFrame(wMm, hMm);
          await drawPlan({
            x: frame.drawX,
            y: frame.drawY,
            w: frame.drawW,
            h: frame.drawH,
          });
          const printable = template.slots.filter((s) => s.type !== "LOGO");
          const [titleSlot, ...restSlots] = printable;
          const fields: CartoucheField[] = [
            ...restSlots.map((s) => ({
              label: s.label,
              value: resolveSlotValue(s, slotValues),
            })),
            { label: "RÉV.", value: rev || "—", size: 6, bold: true },
            { label: "DATE", value: date, size: 4.5 },
            // Le cadrage est libre : aucune échelle normalisée ne peut être
            // annoncée. Mieux vaut le dire que d'imprimer une valeur fausse.
            { label: "ÉCHELLE", value: "Libre", size: 4.5 },
            { label: "FORMAT", value: format, size: 5, bold: true },
          ];
          drawCartoucheChrome(doc as unknown as CartoucheDoc, frame, {
            headerTitle: template.name.toUpperCase(),
            headerSubtitle: titleSlot
              ? resolveSlotValue(titleSlot, slotValues)
              : rackName,
            fields,
            columns: 1,
          });
        }

        // Cœur PUR : on rend le blob. Ni téléchargement, ni enregistrement, ni
        // `alert` — l'erreur remonte à l'appelant, qui la présente comme
        // n'importe quel autre échec d'export.
        const blob = doc.output("blob");
        summary(format, blob);
        return { blob, pageCount: 1 };
      } finally {
        // La copie hors écran est démontée quoi qu'il arrive — elle reste
        // attachée pendant tout l'assemblage vectoriel.
        mountedHost?.remove();
        setPdfLoading(false);
      }
    },
    [
      pdfFormat,
      pdfRevision,
      rackName,
      signals,
      resolvedConnections,
      slotPorts,
      positions,
      expandedSlots,
      zones,
      connWaypoints,
      getPortCenter,
      makePathWithWaypoints,
      pushToast,
      buildExportCardInputs,
      buildLegendRows,
    ],
  );
  exportSynopticPDFRef.current = exportSynopticPDF;

  const isEmpty = activeSlots.length === 0;

  // ── SVG canvas size (large virtual space) ──────────────────────────────────
  const SVG_W = 8000;
  const SVG_H = 8000;

  // ── Pre-compute bypassYMap (fold-back cable staggering) — memoized ────────
  const bypassYMap = useMemo(() => {
    const STUB = 48,
      MARGIN = 56;
    const nodeBottom = (slotId: string) => {
      const pos = positions.get(slotId);
      if (!pos) return 0;
      const ports = slotPorts.get(slotId) ?? [];
      const lc = ports.filter((p: Port) => p.side === "left").length;
      const rc = ports.filter((p: Port) => p.side === "right").length;
      return pos.y + Math.max(NODE_MIN_H, NODE_HEADER_H + Math.max(lc, rc) * PORT_H + 12);
    };
    type ConnBypass = { id: string; baseY: number; corridorKey: string; sortY: number };
    const bypassInfos: ConnBypass[] = [];
    for (const conn of resolvedConnections) {
      const from = getPortCenter(conn.fromSlotId, conn.fromConnectorIndex);
      const to = getPortCenter(conn.toSlotId, conn.toConnectorIndex);
      if (!from || !to) continue;
      const isFoldBack =
        (from.side === "right" && to.side === "left" && to.x <= from.x) || from.side === to.side;
      if (!isFoldBack) continue;
      const baseY = Math.max(nodeBottom(conn.fromSlotId), nodeBottom(conn.toSlotId)) + 56;
      const colNear = from.side === "right" ? from.x + STUB + MARGIN : from.x - STUB - MARGIN;
      const colFar = to.side === "left" ? to.x - STUB - MARGIN : to.x + STUB + MARGIN;
      const corridorKey = `${Math.round(colNear)}_${Math.round(colFar)}`;
      bypassInfos.push({ id: conn.id, baseY, corridorKey, sortY: (from.y + to.y) / 2 });
    }
    const corridorGroups = new Map<string, ConnBypass[]>();
    for (const info of bypassInfos) {
      const g = corridorGroups.get(info.corridorKey) ?? [];
      g.push(info);
      corridorGroups.set(info.corridorKey, g);
    }
    const map = new Map<string, number>();
    for (const group of corridorGroups.values()) {
      group.sort((a, b) => a.sortY - b.sortY);
      group.forEach((info, idx) => {
        map.set(info.id, info.baseY + idx * PORT_H);
      });
    }
    return map;
  }, [resolvedConnections, positions, slotPorts, getPortCenter]);
  bypassYMapRef.current = bypassYMap;

  // Labels en doublon — memoized pour éviter recalcul à chaque render du câble layer.
  const duplicateLabels = useMemo(() => {
    const count = new Map<string, number>();
    for (const c of connections) {
      if (c.label) count.set(c.label, (count.get(c.label) ?? 0) + 1);
    }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([l]) => l));
  }, [connections]);

  // ── Reset drawing state when cable options change mid-draw ──────────────
  // Évite les états hybrides (ex. Simple → Multiple avec un port déjà sélectionné).
  useEffect(() => {
    setDrawingFrom(null);
    setDrawingWaypoints([]);
    setMultiSrcPorts(null);
    setMultiSrcConfirmed(false);
    setMultiHoverTooltip(null);
    setIncompatTooltip(null);
  }, [cableCount, cableMode]);

  // ── Libère le port source dès qu'on quitte l'outil câble ────────────────
  useEffect(() => {
    if (tool !== "cable") {
      setDrawingFrom(null);
      setDrawingWaypoints([]);
      setMultiSrcPorts(null);
      setMultiSrcConfirmed(false);
      setMultiHoverTooltip(null);
      setIncompatTooltip(null);
    }
  }, [tool]);

  // ── Libère l'état de picking adaptateur quand on quitte l'outil Adaptateur
  useEffect(() => {
    // Muette : l'outil de CETTE instance ne dit rien de ce que l'éditeur
    // visible est en train de faire — annuler son picking serait un vol.
    if (!publishToShell) return;
    if (tool !== "adapter") {
      const s = useTopbarActions.getState();
      if (s.pickingAdapterId) s.setPickingAdapterId(null);
      if (s.pendingAdapterPort) s.setPendingAdapterPort(null);
    }
  }, [tool, publishToShell]);

  // ── Cursor hint (drawing state → useCursorHint store) ────────────────────
  const setHintLabel = useCursorHint((s) => s.set);
  const clearHint = useCursorHint((s) => s.clear);

  useEffect(() => {
    if (!publishToShell) return;
    // Synoptic masqué (workspace ≠ synoptic) → clear immédiat
    if (!isVisible) {
      clearHint();
      return;
    }
    // Multi mode phase 1 (source range selection) — vérifié AVANT drawingFrom
    if (tool === "cable" && cableCount === "multi" && multiSrcPorts && !multiSrcConfirmed) {
      const n = multiSrcPorts.portIndices.length;
      if (n === 1) {
        setHintLabel(
          "source +",
          "Cliquez le dernier port du range ou Enter pour confirmer cette source seule",
        );
        return;
      }
      setHintLabel(`sources ×${n}`, "Ajoutez d'autres sources ou Enter pour confirmer la plage");
      return;
    }
    if (tool === "cable" && drawingFrom) {
      // Incompatible port hovered — highest priority
      if (incompatTooltip) {
        // Avertissement, pas refus : la pose reste possible sur cette cible
        // (port occupé = remplacement après confirmation).
        const replaces = incompatTooltip.msg.startsWith("Port déjà câblé");
        setHintLabel(
          replaces ? "⚠ remplacement" : "⚠ incompatible",
          incompatTooltip.msg,
          "error",
        );
        return;
      }
      // Multi-hover info during drawing
      if (multiHoverTooltip) {
        setHintLabel("câblage partiel", multiHoverTooltip.lines.join(" · "), "default");
        return;
      }
      // Port compatible détecté via snapTarget (sans incompat)
      if (snapTarget && !incompatTooltip) {
        setHintLabel(
          "compatible",
          "Port compatible — relâchez ou cliquez pour connecter",
          "success",
        );
        return;
      }
      if (cableMode === "multipoint") {
        setHintLabel("+ point", "Cliquez pour poser un waypoint · Enter pour fermer");
        return;
      }
      setHintLabel("cible ?", "Cliquez sur un port cible");
      return;
    }
    clearHint();
    return clearHint;
  }, [
    isVisible,
    tool,
    drawingFrom,
    cableMode,
    cableCount,
    multiSrcPorts,
    multiSrcConfirmed,
    incompatTooltip,
    multiHoverTooltip,
    snapTarget,
    setHintLabel,
    clearHint,
    publishToShell,
  ]);

  const canvasMenu: CanvasMenuItem[] = [
    {
      id: "zoom-all",
      label: "Zoom sur tout",
      onSelect: () => {
        try {
          fitAll();
        } catch {}
      },
      shortcut: "F",
    },
    {
      id: "center",
      label: "Centrer la vue",
      onSelect: () => {
        try {
          handleCenter();
        } catch {}
      },
      separatorAfter: true,
    },
    {
      id: "toggle-legend",
      label: showLegend ? "Masquer la légende" : "Afficher la légende",
      onSelect: () => setShowLegend((v) => !v),
    },
  ];

  if (isEmpty) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--muted-foreground)]">
        <div className="space-y-2 text-center">
          <p className="text-sm font-semibold">
            {emptyState?.title ?? "Aucun élément câblable"}
          </p>
          <p className="text-xs">
            {emptyState?.description ??
              "Ajoute des équipements ou panels avec des connecteurs via l'inventaire."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <CanvasContextMenu items={canvasMenu}>
      <div
        className={`relative flex-1 overflow-hidden bg-[var(--canvas-bg)] outline-none select-none${tool === "erase" ? "synoptic-erase-mode" : ""}`}
        ref={containerRef}
        style={{
          cursor: drawingFrom
            ? "crosshair"
            : tool === "zoom"
              ? "zoom-in"
              : tool === "zone" ||
                  tool === "label" ||
                  tool === "adapter" ||
                  tool === "external" ||
                  tool === "cable"
                ? "crosshair"
                : tool === "select"
                  ? "default"
                  : tool === "move"
                    ? "move"
                    : tool === "erase"
                      ? "default"
                      : panDragRef.current?.active
                        ? "grabbing"
                        : "grab",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        tabIndex={-1}
        onDoubleClick={(e) => {
          // Double-clic sur zone vide → fit all
          const target = e.target as HTMLElement;
          if (
            target.closest("[data-node]") ||
            target.closest("[data-zone]") ||
            target.closest("[data-canvas-label]") ||
            target.closest("[data-adapter]") ||
            target.closest("[data-cable]") ||
            target.closest("[data-minimap]") ||
            target.closest("[data-guide-hit]") ||
            target.closest("[data-toolbar]") ||
            target.closest("button")
          )
            return;
          // Ignore aussi les règles (top 18 / left 18) si rulers actifs
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect && useTopbarActions.getState().rulersEnabled) {
            const lx = e.clientX - rect.left;
            const ly = e.clientY - rect.top;
            if (lx < 18 || ly < 18) return;
          }
          try {
            fitAllRef.current?.();
          } catch {}
        }}
      >
        {/* Guides (repères) — fins traits cyan, rendus SOUS les éléments canvas */}
        {guidesVisible && (guides.v.length > 0 || guides.h.length > 0 || draggingGuide) && (
          <svg
            data-synoptic-guides
            className="pointer-events-none absolute inset-0"
            width="100%"
            height="100%"
          >
            {guides.v.map((gv, i) => {
              if (draggingGuide?.orientation === "v" && draggingGuide.existingIndex === i)
                return null;
              const sx = gv.pos * zoom + pan.x;
              if (sx < -1 || sx > containerSize.w + 1) return null;
              const sel = selectedGuideKeys.has(guideKey("v", i));
              return (
                <line
                  key={`gv-${i}`}
                  x1={sx}
                  x2={sx}
                  y1={0}
                  y2={containerSize.h}
                  stroke={gv.color ?? "var(--accent)"}
                  strokeWidth={sel ? 1.5 : 1}
                  opacity={sel ? 1 : 0.6}
                  strokeDasharray={sel ? "5 3" : undefined}
                />
              );
            })}
            {guides.h.map((gh, i) => {
              if (draggingGuide?.orientation === "h" && draggingGuide.existingIndex === i)
                return null;
              const sy = gh.pos * zoom + pan.y;
              if (sy < -1 || sy > containerSize.h + 1) return null;
              const sel = selectedGuideKeys.has(guideKey("h", i));
              return (
                <line
                  key={`gh-${i}`}
                  x1={0}
                  x2={containerSize.w}
                  y1={sy}
                  y2={sy}
                  stroke={gh.color ?? "var(--accent)"}
                  strokeWidth={sel ? 1.5 : 1}
                  opacity={sel ? 1 : 0.6}
                  strokeDasharray={sel ? "5 3" : undefined}
                />
              );
            })}
            {draggingGuide &&
              (() => {
                if (draggingGuide.orientation === "v") {
                  const sx = draggingGuide.pos * zoom + pan.x;
                  return (
                    <line
                      x1={sx}
                      x2={sx}
                      y1={0}
                      y2={containerSize.h}
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      opacity={0.9}
                    />
                  );
                }
                const sy = draggingGuide.pos * zoom + pan.y;
                return (
                  <line
                    x1={0}
                    x2={containerSize.w}
                    y1={sy}
                    y2={sy}
                    stroke="var(--accent)"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                    opacity={0.9}
                  />
                );
              })()}
          </svg>
        )}
        {/* Hit zones invisibles pour drag/delete des repères existants */}
        {guidesVisible &&
          guides.v.map((gv, i) => {
            const sx = gv.pos * zoom + pan.x;
            if (sx < 0 || sx > containerSize.w) return null;
            return (
              <div
                key={`ghit-v-${i}`}
                data-guide-hit="v"
                className="absolute"
                style={{
                  left: sx - 3,
                  top: 0,
                  width: 7,
                  height: containerSize.h,
                  cursor: "ew-resize",
                  zIndex: 4,
                }}
                onPointerDown={(e) => handleGuideDragStart("v", i, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setGuides((g) => {
                    const next = { ...g, v: g.v.filter((_, j) => j !== i) };
                    persistGuides(next);
                    return next;
                  });
                }}
                title="Glissez pour déplacer · Clic droit pour supprimer"
              />
            );
          })}
        {guidesVisible &&
          guides.h.map((gh, i) => {
            const sy = gh.pos * zoom + pan.y;
            if (sy < 0 || sy > containerSize.h) return null;
            return (
              <div
                key={`ghit-h-${i}`}
                data-guide-hit="h"
                className="absolute"
                style={{
                  left: 0,
                  top: sy - 3,
                  width: containerSize.w,
                  height: 7,
                  cursor: "ns-resize",
                  zIndex: 4,
                }}
                onPointerDown={(e) => handleGuideDragStart("h", i, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setGuides((g) => {
                    const next = { ...g, h: g.h.filter((_, j) => j !== i) };
                    persistGuides(next);
                    return next;
                  });
                }}
                title="Glissez pour déplacer · Clic droit pour supprimer"
              />
            );
          })}

        {/* Règles top + left */}
        {rulersEnabled && containerSize.w > 0 && containerSize.h > 0 && (
          <SynopticRulers
            pan={pan}
            zoom={zoom}
            step={gridStep}
            majorEvery={gridMajorEvery}
            width={containerSize.w}
            height={containerSize.h}
            cursor={cursorCanvas}
            onGuideStart={handleGuideStart}
          />
        )}

        {/* Overflow indicator : flèche vers l'élément sélectionné quand il est hors viewport */}
        {containerSize.w > 0 &&
          containerSize.h > 0 &&
          (() => {
            const firstId =
              selectedNodeId ??
              selectedZoneId ??
              selectedLabelId ??
              selectedAdapterId ??
              selectedConnId;
            if (!firstId) return null;
            // Calcule centre canvas-space (même logique que recentrage)
            let cx: number | null = null,
              cy: number | null = null;
            const slot = expandedSlots.find((s) => s.id === firstId);
            if (slot) {
              const pos = positions.get(firstId);
              if (pos) {
                const nodeW = slot.panel ? PANEL_NODE_W : NODE_W;
                const ports = slotPorts.get(firstId) ?? [];
                const portRows = Math.max(
                  ports.filter((p) => p.side === "left").length,
                  ports.filter((p) => p.side === "right").length,
                );
                const nodeH = Math.max(NODE_MIN_H, NODE_HEADER_H + portRows * PORT_H + 16);
                cx = pos.x + nodeW / 2;
                cy = pos.y + nodeH / 2;
              }
            } else {
              const z = zones.find((z) => z.id === firstId);
              if (z) {
                cx = z.x + z.w / 2;
                cy = z.y + z.h / 2;
              } else {
                const l = canvasLabels.find((l) => l.id === firstId);
                if (l) {
                  cx = l.x;
                  cy = l.y;
                } else {
                  const a = adapters.find((a) => a.id === firstId);
                  if (a) {
                    cx = a.x + 65;
                    cy = a.y + 40;
                  } else {
                    const c = connections.find((c) => c.id === firstId);
                    if (c) {
                      const from = getPortCenterRef.current?.(c.fromSlotId, c.fromConnectorIndex);
                      const to = getPortCenterRef.current?.(c.toSlotId, c.toConnectorIndex);
                      if (from && to) {
                        cx = (from.x + to.x) / 2;
                        cy = (from.y + to.y) / 2;
                      }
                    }
                  }
                }
              }
            }
            if (cx == null || cy == null) return null;
            const sx = cx * zoom + pan.x;
            const sy = cy * zoom + pan.y;
            const MARGIN = 24;
            const onScreen =
              sx >= -MARGIN &&
              sx <= containerSize.w + MARGIN &&
              sy >= -MARGIN &&
              sy <= containerSize.h + MARGIN;
            if (onScreen) return null;
            // Clamp position à l'écran, déterminer direction
            const edgeMargin = 14;
            const clampedX = Math.max(edgeMargin, Math.min(containerSize.w - edgeMargin, sx));
            const clampedY = Math.max(edgeMargin, Math.min(containerSize.h - edgeMargin, sy));
            // Angle du vecteur vers l'élément
            const dx = sx - clampedX;
            const dy = sy - clampedY;
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            return (
              <button
                type="button"
                onClick={() => {
                  const newPan = {
                    x: containerSize.w / 2 - cx! * zoom,
                    y: containerSize.h / 2 - cy! * zoom,
                  };
                  viewRef.current = { pan: newPan, zoom };
                  setPan(newPan);
                }}
                className="absolute z-30 flex items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110 active:scale-95"
                style={{
                  left: clampedX - 14,
                  top: clampedY - 14,
                  width: 28,
                  height: 28,
                  background: "var(--accent)",
                  color: "var(--accent-foreground)",
                  border: "2px solid var(--surface)",
                }}
                title="Recentrer sur la sélection"
              >
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 14 14"
                  style={{ transform: `rotate(${angle}deg)` }}
                >
                  <path
                    d="M 3 7 L 10 7 M 7 4 L 10 7 L 7 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            );
          })()}

        {/* Grid background — lignes mineures (chaque step) + majeures (tous les N steps), aligné au canvas */}
        {gridEnabled &&
          (() => {
            const BASE = gridStep;
            const step = BASE * zoom;
            if (step < 4) return null;
            const major = step * gridMajorEvery;
            const offX = ((pan.x % step) + step) % step;
            const offY = ((pan.y % step) + step) % step;
            const majOffX = ((pan.x % major) + major) % major;
            const majOffY = ((pan.y % major) + major) % major;
            return (
              <svg
                data-synoptic-grid
                className="pointer-events-none absolute inset-0"
                width="100%"
                height="100%"
              >
                <defs>
                  <pattern
                    id="synoptic-grid-minor"
                    x={offX}
                    y={offY}
                    width={step}
                    height={step}
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d={`M 0 0 L ${step} 0 M 0 0 L 0 ${step}`}
                      stroke={gridColor}
                      strokeOpacity={0.4 * gridOpacity}
                      strokeWidth={0.6}
                      fill="none"
                    />
                  </pattern>
                  <pattern
                    id="synoptic-grid-major"
                    x={majOffX}
                    y={majOffY}
                    width={major}
                    height={major}
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d={`M 0 0 L ${major} 0 M 0 0 L 0 ${major}`}
                      stroke={gridColor}
                      strokeOpacity={0.75 * gridOpacity}
                      strokeWidth={1}
                      fill="none"
                    />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#synoptic-grid-minor)" />
                <rect width="100%" height="100%" fill="url(#synoptic-grid-major)" />
              </svg>
            );
          })()}

        {/* Transformed canvas */}
        <div
          ref={transformContentRef}
          data-synoptic-transform
          className="absolute"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            width: SVG_W,
            height: SVG_H,
            overflow: "visible",
          }}
        >
          {/* SVG for connections */}
          {/* `data-scene-layer` : couche de SCÈNE, exportable telle quelle en
              vectoriel. `base` = sous les cartes d'équipement, `over` = par
              dessus. L'ordre de peinture du PDF s'en déduit sans compter les
              enfants ni deviner un z-index. */}
          <svg
            data-scene-layer="base"
            className="absolute inset-0 overflow-visible"
            style={{ pointerEvents: "none" }}
            width={SVG_W}
            height={SVG_H}
          >
            {/* ── Zones ── */}
            {zones.map((zone) => {
              if (hiddenLayerIds.has(zone.id)) return null;
              const isSel =
                selectedZoneId === zone.id ||
                selectedZoneIds.has(zone.id) ||
                previewZoneIds.has(zone.id);
              const HANDLE_R = 6;
              const handles = [
                { id: "TL", cx: zone.x, cy: zone.y, cursor: "nwse-resize" },
                { id: "TC", cx: zone.x + zone.w / 2, cy: zone.y, cursor: "ns-resize" },
                { id: "TR", cx: zone.x + zone.w, cy: zone.y, cursor: "nesw-resize" },
                { id: "ML", cx: zone.x, cy: zone.y + zone.h / 2, cursor: "ew-resize" },
                { id: "MR", cx: zone.x + zone.w, cy: zone.y + zone.h / 2, cursor: "ew-resize" },
                { id: "BL", cx: zone.x, cy: zone.y + zone.h, cursor: "nesw-resize" },
                { id: "BC", cx: zone.x + zone.w / 2, cy: zone.y + zone.h, cursor: "ns-resize" },
                { id: "BR", cx: zone.x + zone.w, cy: zone.y + zone.h, cursor: "nwse-resize" },
              ];

              const startResize = (handle: string, e: React.PointerEvent) => {
                if (toolRef.current !== "select" && toolRef.current !== "move") return;
                e.nativeEvent.stopImmediatePropagation();
                const el = containerRef.current;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                const { pan: p, zoom: z } = viewRef.current;
                const cx = (e.clientX - rect.left - p.x) / z;
                const cy = (e.clientY - rect.top - p.y) / z;
                pushHistoryRef.current?.();
                zoneResizeDragRef.current = {
                  handle,
                  zoneId: zone.id,
                  origZone: { ...zone },
                  startCX: cx,
                  startCY: cy,
                };
                (e.target as Element).setPointerCapture(e.pointerId);

                const onMove = (ev: PointerEvent) => {
                  const drag = zoneResizeDragRef.current;
                  if (!drag) return;
                  const r2 = el.getBoundingClientRect();
                  const { pan: p2, zoom: z2 } = viewRef.current;
                  const cx2 = (ev.clientX - r2.left - p2.x) / z2;
                  const cy2 = (ev.clientY - r2.top - p2.y) / z2;
                  const ddx = cx2 - drag.startCX;
                  const ddy = cy2 - drag.startCY;
                  const o = drag.origZone;
                  const MIN = 40;
                  let { x, y, w, h } = o;
                  if (handle.includes("L")) {
                    x = Math.min(o.x + ddx, o.x + o.w - MIN);
                    w = o.w - (x - o.x);
                  }
                  if (handle.includes("R")) {
                    w = Math.max(o.w + ddx, MIN);
                  }
                  if (handle.startsWith("T")) {
                    y = Math.min(o.y + ddy, o.y + o.h - MIN);
                    h = o.h - (y - o.y);
                  }
                  if (handle.startsWith("B")) {
                    h = Math.max(o.h + ddy, MIN);
                  }
                  {
                    const snapS = useTopbarActions.getState();
                    if (snapS.snapEnabled) {
                      const step = snapS.gridStep;
                      const x1 = snapCoord(x, step);
                      const y1 = snapCoord(y, step);
                      const x2 = snapCoord(x + w, step);
                      const y2 = snapCoord(y + h, step);
                      x = x1;
                      y = y1;
                      w = Math.max(MIN, x2 - x1);
                      h = Math.max(MIN, y2 - y1);
                    }
                  }
                  setZones((prev) =>
                    prev.map((z) => (z.id === drag.zoneId ? { ...z, x, y, w, h } : z)),
                  );
                };
                const onUp = () => {
                  window.removeEventListener("pointermove", onMove);
                  const drag = zoneResizeDragRef.current;
                  zoneResizeDragRef.current = null;
                  if (!drag) return;
                  const snap = useTopbarActions.getState();
                  setZones((prev) => {
                    const next = prev.map((z) => {
                      if (z.id !== drag.zoneId) return z;
                      if (!snap.snapEnabled) return z;
                      const x1 = snapCoord(z.x, snap.gridStep);
                      const y1 = snapCoord(z.y, snap.gridStep);
                      const x2 = snapCoord(z.x + z.w, snap.gridStep);
                      const y2 = snapCoord(z.y + z.h, snap.gridStep);
                      return {
                        ...z,
                        x: x1,
                        y: y1,
                        w: Math.max(40, x2 - x1),
                        h: Math.max(40, y2 - y1),
                      };
                    });
                    const updated = next.find((z) => z.id === drag.zoneId);
                    if (updated) updateZoneApi(updated);
                    return next;
                  });
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp, { once: true });
              };

              return (
                <g
                  key={zone.id}
                  data-zone="true"
                  data-zone-id={zone.id}
                  style={{ pointerEvents: tool === "cable" ? "none" : "all" }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectOnly("zone", zone.id);
                    setContextMenu({ x: e.clientX, y: e.clientY, type: "zone", id: zone.id });
                  }}
                >
                  {/* Fill — drag to move, click to select, double-click to rename */}
                  {(() => {
                    return null;
                  })()}
                  {/* Halo de sélection unifié : ring accent décalé de 4px sur l'extérieur. */}
                  {isSel && (
                    <rect
                      x={zone.x - 4}
                      y={zone.y - 4}
                      width={zone.w + 8}
                      height={zone.h + 8}
                      rx={(zone.borderRadius ?? 8) + 4}
                      ry={(zone.borderRadius ?? 8) + 4}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      strokeOpacity={0.9}
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                  <rect
                    x={zone.x}
                    y={zone.y}
                    width={zone.w}
                    height={zone.h}
                    rx={zone.borderRadius ?? 8}
                    ry={zone.borderRadius ?? 8}
                    fill={zone.color}
                    fillOpacity={zone.opacity ?? 0.12}
                    stroke={zone.color}
                    strokeWidth={zone.borderWidth ?? 2}
                    strokeDasharray={
                      zone.borderStyle === "dashed"
                        ? "6 3"
                        : zone.borderStyle === "dotted"
                          ? "2 3"
                          : undefined
                    }
                    style={{ cursor: tool === "move" ? "move" : "default" }}
                    onPointerDown={(e) => {
                      e.nativeEvent.stopImmediatePropagation();
                      const zoneLocked = lockedLayerIdsRef.current.has(zone.id);
                      if (toolRef.current === "erase") {
                        e.stopPropagation();
                        if (zoneLocked) {
                          selectOnly("zone", zone.id);
                          return;
                        }
                        pushHistoryRef.current?.();
                        setSelectedZoneId(null);
                        deleteZoneApi(zone.id);
                        setZones((prev) => prev.filter((z) => z.id !== zone.id));
                        return;
                      }
                      // En mode move ou select : sélectionner + préparer drag (bascule
                      // auto vers "move" au dépassement du seuil en mode select).
                      if (toolRef.current !== "move" && toolRef.current !== "select") {
                        selectOnly("zone", zone.id);
                        return;
                      }
                      const startedInSelect = toolRef.current === "select";
                      // Cmd/Shift+Clic : ajoute/toggle dans la multi-sélection zones.
                      if (e.metaKey || e.ctrlKey || e.shiftKey) {
                        setSelectedZoneIds((prev) => {
                          const seed =
                            prev.size > 0
                              ? prev
                              : selectedZoneId
                                ? new Set([selectedZoneId])
                                : new Set<string>();
                          const next = new Set(seed);
                          if (e.shiftKey && !(e.metaKey || e.ctrlKey)) next.add(zone.id);
                          else {
                            if (next.has(zone.id)) next.delete(zone.id);
                            else next.add(zone.id);
                          }
                          return next;
                        });
                        setSelectedNodeId(null);
                        setSelectedLabelId(null);
                        setSelectedLabelIds(new Set());
                        setSelectedAdapterId(null);
                        setSelectedConnId(null);
                        setSelectedConnIds(new Set());
                        setSelectedZoneId(zone.id);
                        return;
                      }
                      selectOnly("zone", zone.id);
                      if (zoneLocked) return;
                      // Alt+drag → duplique la zone et déplace la copie
                      let targetId = zone.id;
                      if (e.altKey) {
                        const dupe: Zone = { ...zone, id: `zone-${Date.now()}` };
                        targetId = dupe.id;
                        pushHistoryRef.current?.();
                        setZones((prev) => [...prev, dupe]);
                        createZoneApi(dupe);
                        selectOnly("zone", dupe.id);
                      }
                      const el = containerRef.current;
                      if (!el) return;
                      const rect = el.getBoundingClientRect();
                      const { pan: p, zoom: z } = viewRef.current;
                      const startCX = (e.clientX - rect.left - p.x) / z;
                      const startCY = (e.clientY - rect.top - p.y) / z;
                      const origX = zone.x,
                        origY = zone.y;
                      // Si Alt+Drag a dupliqué : on veut que la copie suive le pointeur
                      // sans attendre de seuil (le user a déjà "cliqué" pour dupliquer).
                      let moved = e.altKey;
                      let historyPushed = !startedInSelect || e.altKey;
                      if (!startedInSelect && !e.altKey) pushHistoryRef.current?.();
                      const onMove = (ev: PointerEvent) => {
                        const r2 = el.getBoundingClientRect();
                        const { pan: p2, zoom: z2 } = viewRef.current;
                        const cx2 = (ev.clientX - r2.left - p2.x) / z2;
                        const cy2 = (ev.clientY - r2.top - p2.y) / z2;
                        const ddx = cx2 - startCX,
                          ddy = cy2 - startCY;
                        if (Math.abs(ddx) > 2 || Math.abs(ddy) > 2) moved = true;
                        if (moved) {
                          if (startedInSelect && toolRef.current === "select")
                            setToolRef.current("move");
                          if (!historyPushed) {
                            pushHistoryRef.current?.();
                            historyPushed = true;
                          }
                          {
                            const snapS = useTopbarActions.getState();
                            const { x: nx, y: ny } = snapIf(
                              origX + ddx,
                              origY + ddy,
                              snapS.gridStep,
                              snapS.snapEnabled,
                            );
                            setZones((prev) =>
                              prev.map((z) => (z.id === targetId ? { ...z, x: nx, y: ny } : z)),
                            );
                          }
                        }
                      };
                      const onUp = () => {
                        window.removeEventListener("pointermove", onMove);
                        if (moved) {
                          const snap = useTopbarActions.getState();
                          setZones((prev) => {
                            const next = prev.map((z) => {
                              if (z.id !== targetId) return z;
                              const { x, y } = snap.snapEnabled
                                ? {
                                    x: snapCoord(z.x, snap.gridStep),
                                    y: snapCoord(z.y, snap.gridStep),
                                  }
                                : { x: z.x, y: z.y };
                              return { ...z, x, y };
                            });
                            const updated = next.find((z) => z.id === targetId);
                            if (updated) updateZoneApi(updated);
                            return next;
                          });
                        }
                      };
                      window.addEventListener("pointermove", onMove);
                      window.addEventListener("pointerup", onUp, { once: true });
                    }}
                  />
                  {/* Label + hover edit pencil */}
                  {(() => {
                    const PAD = 14;
                    const isTop = zone.labelPosition.startsWith("top");
                    const isLeft = zone.labelPosition.endsWith("left");
                    const lx = isLeft ? zone.x + PAD : zone.x + zone.w - PAD;
                    const ly = isTop ? zone.y + PAD + 14 : zone.y + zone.h - PAD;
                    const anchor = isLeft ? "start" : "end";
                    const isHovered = hoveredZoneLabelId === zone.id && !isSel;
                    // Pencil positioned right after the label text (or at a fixed offset when empty)
                    const labelW = zone.label
                      ? Math.min(zone.label.length * 9, zone.w - PAD * 2 - 24)
                      : 0;
                    const pencilX = isLeft ? lx + labelW + 14 : lx - labelW - 14;
                    return (
                      <g
                        style={{ cursor: tool === "move" ? "move" : "default" }}
                        onMouseEnter={() => setHoveredZoneLabelId(zone.id)}
                        onMouseLeave={() => setHoveredZoneLabelId(null)}
                      >
                        {/* Invisible hit area so hover works even when label is empty */}
                        <rect
                          x={isLeft ? lx : lx - 80}
                          y={ly - 16}
                          width={80}
                          height={20}
                          fill="transparent"
                          style={{ pointerEvents: "all" }}
                        />
                        <text
                          x={lx}
                          y={ly}
                          textAnchor={anchor}
                          fontSize={zone.labelFontSize ?? 18}
                          fontWeight={zone.labelFontWeight ?? "600"}
                          fontStyle={zone.labelFontStyle ?? "normal"}
                          textDecoration={zone.labelTextDecoration ?? "none"}
                          fontFamily={zone.labelFontFamily || "system-ui"}
                          style={{
                            fill: "var(--foreground)",
                            userSelect: "none",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {zone.label?.toUpperCase()}
                        </text>
                      </g>
                    );
                  })()}
                  {/* Cadenas discret en haut-droite si la zone est verrouillée */}
                  {lockedLayerIds.has(zone.id) &&
                    (() => {
                      const inv = 1 / Math.max(0.1, zoom);
                      const ICON = 14;
                      const anchorX = zone.x + zone.w - 4 * inv;
                      const anchorY = zone.y + 4 * inv;
                      return (
                        <g
                          pointerEvents="none"
                          opacity={0.55}
                          transform={`translate(${anchorX}, ${anchorY}) scale(${inv}) translate(-${ICON}, 0)`}
                        >
                          <rect
                            width={ICON}
                            height={ICON}
                            rx={2}
                            style={{ fill: "var(--surface)", stroke: "var(--muted-foreground)" }}
                            strokeWidth={1}
                          />
                          <rect
                            x={3.5}
                            y={7}
                            width={7}
                            height={5}
                            rx={1}
                            style={{ fill: "var(--muted-foreground)" }}
                          />
                          <path
                            d="M 4.5 7 V 5.5 A 2.5 2.5 0 0 1 9.5 5.5 V 7"
                            fill="none"
                            style={{ stroke: "var(--muted-foreground)" }}
                            strokeWidth={1.2}
                          />
                        </g>
                      );
                    })()}
                  {/* Delete corner button — only when selected */}
                  {isSel && (
                    <g
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        pushHistoryRef.current?.();
                        setSelectedZoneId(null);
                        deleteZoneApi(zone.id);
                        setZones((prev) => prev.filter((z) => z.id !== zone.id));
                      }}
                    >
                      <circle cx={zone.x + zone.w} cy={zone.y} r={10} fill={zone.color} />
                      <text
                        x={zone.x + zone.w}
                        y={zone.y + 4.5}
                        textAnchor="middle"
                        fontSize={13}
                        fill="white"
                        fontFamily="system-ui"
                        fontWeight="bold"
                        style={{ pointerEvents: "none" }}
                      >
                        ×
                      </text>
                    </g>
                  )}
                  {/* Resize handles — only when selected */}
                  {isSel &&
                    handles.map((h) => (
                      <circle
                        key={h.id}
                        cx={h.cx}
                        cy={h.cy}
                        r={HANDLE_R}
                        // arkyo-server: habillage Strata (fond de poignée de sélection : --surface)
                        fill="var(--surface)"
                        stroke={zone.color}
                        strokeWidth={2}
                        style={{ cursor: h.cursor }}
                        onPointerDown={(e) => startResize(h.id, e)}
                      />
                    ))}
                </g>
              );
            })}
            {/* Zone being drawn */}
            {drawingZone && drawingZone.w > 2 && drawingZone.h > 2 && (
              <rect
                x={drawingZone.x}
                y={drawingZone.y}
                width={drawingZone.w}
                height={drawingZone.h}
                rx={8}
                fill="#6366f115"
                stroke="#6366f1"
                strokeWidth={1.5}
                strokeDasharray="6 3"
              />
            )}
            {drawingLabel &&
              drawingLabel.w > 2 &&
              drawingLabel.h > 2 &&
              (() => {
                const fs = Math.round(Math.max(10, Math.min(drawingLabel.h * 0.75, 120)));
                return (
                  <g>
                    <rect
                      x={drawingLabel.x}
                      y={drawingLabel.y}
                      width={drawingLabel.w}
                      height={drawingLabel.h}
                      fill="#f59e0b08"
                      stroke="#f59e0b"
                      strokeWidth={1.5}
                      strokeDasharray="6 3"
                      rx={4}
                    />
                    <text
                      x={drawingLabel.x + 4}
                      y={drawingLabel.y + fs}
                      fontSize={fs}
                      fill="#f59e0b80"
                      fontFamily="system-ui"
                      style={{ pointerEvents: "none" }}
                    >
                      Aa
                    </text>
                  </g>
                );
              })()}
            {/* ── Canvas labels ── */}
            {canvasLabels.map((lbl) => {
              if (hiddenLayerIds.has(lbl.id)) return null;
              const isSel =
                selectedLabelId === lbl.id ||
                selectedLabelIds.has(lbl.id) ||
                previewLabelIds.has(lbl.id);
              const measuredW = measureLabelWidth(
                lbl.text,
                lbl.fontSize,
                lbl.fontFamily,
                lbl.fontWeight,
                lbl.fontStyle,
              );
              const lblW = lbl.width ?? Math.max(measuredW, lbl.fontSize * 0.5);

              // Bounding box — serré autour du texte.
              // Mode pillule : padding symétrique (haut=bas plus petit, gauche=droite plus grand).
              const isPill = !!lbl.pill;
              const PAD_X = isPill ? Math.max(10, lbl.fontSize * 0.5) : 2;
              const PAD_TOP = isPill ? Math.max(4, lbl.fontSize * 0.22) : 1;
              const PAD_BOT = isPill ? PAD_TOP : 3;
              const boxX = lbl.x - PAD_X; // left edge
              const boxY = lbl.y - lbl.fontSize - PAD_TOP; // top edge
              const boxW = lblW + PAD_X * 2; // total width
              const boxH = lbl.fontSize + PAD_TOP + PAD_BOT; // total height
              const boxR = boxX + boxW; // right edge
              const boxB = boxY + boxH; // bottom edge

              const startLabelResize = (handle: string, e: React.PointerEvent) => {
                if (toolRef.current !== "select") return;
                e.nativeEvent.stopImmediatePropagation();
                const el = containerRef.current;
                if (!el) return;
                const domRect = el.getBoundingClientRect();
                const { pan: p, zoom: z } = viewRef.current;
                const startCX = (e.clientX - domRect.left - p.x) / z;
                const startCY = (e.clientY - domRect.top - p.y) / z;
                // Snapshot original box edges (what we actually resize)
                const orig = {
                  boxL: boxX,
                  boxR,
                  boxT: boxY,
                  boxB,
                  x: lbl.x,
                  y: lbl.y,
                  fontSize: lbl.fontSize,
                  w: lblW,
                };
                (e.target as Element).setPointerCapture(e.pointerId);
                const MIN_W = 20,
                  MIN_FS = 8;

                const onMove = (ev: PointerEvent) => {
                  const r2 = el.getBoundingClientRect();
                  const { pan: p2, zoom: z2 } = viewRef.current;
                  const cx2 = (ev.clientX - r2.left - p2.x) / z2;
                  const cy2 = (ev.clientY - r2.top - p2.y) / z2;
                  const ddx = cx2 - startCX;
                  const ddy = cy2 - startCY;

                  // Compute new box edges based on which handle is dragged
                  let newL = orig.boxL,
                    newR = orig.boxR,
                    newT = orig.boxT,
                    newB = orig.boxB;
                  if (handle.includes("L"))
                    newL = Math.min(orig.boxL + ddx, orig.boxR - MIN_W - PAD_X * 2);
                  if (handle.includes("R"))
                    newR = Math.max(orig.boxR + ddx, orig.boxL + MIN_W + PAD_X * 2);
                  if (handle.includes("T"))
                    newT = Math.min(orig.boxT + ddy, orig.boxB - MIN_FS - PAD_TOP - PAD_BOT);
                  if (handle.includes("B"))
                    newB = Math.max(orig.boxB + ddy, orig.boxT + MIN_FS + PAD_TOP + PAD_BOT);

                  // Derive label fields from new box edges
                  const newFontSize = Math.round(newB - newT - PAD_TOP - PAD_BOT);
                  const newW = newR - newL - PAD_X * 2;
                  const newX = newL + PAD_X; // text left = box left + pad
                  const newY = newB - PAD_BOT; // text baseline = box bottom - pad

                  setCanvasLabels((prev) =>
                    prev.map((l) =>
                      l.id !== lbl.id
                        ? l
                        : {
                            ...l,
                            x: newX,
                            y: newY,
                            fontSize: Math.max(newFontSize, MIN_FS),
                            width: Math.max(newW, MIN_W),
                          },
                    ),
                  );
                };

                const onUp = () => {
                  window.removeEventListener("pointermove", onMove);
                  setCanvasLabels((prev) => {
                    const l = prev.find((l) => l.id === lbl.id);
                    if (l) updateLabelApi(l);
                    return prev;
                  });
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp, { once: true });
              };

              // Resize handles retirés : la taille du label se règle désormais via le slider dans le panneau Propriétés.
              void startLabelResize;
              const handles: Array<{ id: string; cx: number; cy: number; cursor: string }> = [];

              return (
                <g
                  key={lbl.id}
                  data-canvas-label="true"
                  data-label-id={lbl.id}
                  style={{ pointerEvents: tool === "cable" ? "none" : "all" }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectOnly("label", lbl.id);
                    setContextMenu({ x: e.clientX, y: e.clientY, type: "label", id: lbl.id });
                  }}
                >
                  {/* Halo de sélection unifié */}
                  {isSel && (
                    <rect
                      x={boxX - 4}
                      y={boxY - 4}
                      width={boxW + 8}
                      height={boxH + 8}
                      rx={(lbl.pillRadius ?? 6) + 4}
                      ry={(lbl.pillRadius ?? 6) + 4}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      strokeOpacity={0.9}
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                  {/* Fond pillule (optionnel) */}
                  {isPill && (
                    <rect
                      x={boxX}
                      y={boxY}
                      width={boxW}
                      height={boxH}
                      rx={lbl.pillRadius ?? 12}
                      ry={lbl.pillRadius ?? 12}
                      fill={lbl.pillBg ?? "var(--accent)"}
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                  {/* Invisible hit area */}
                  <rect
                    x={boxX}
                    y={boxY}
                    width={boxW}
                    height={boxH}
                    fill="transparent"
                    style={{ cursor: tool === "move" ? "move" : "default" }}
                    onPointerDown={(e) => {
                      e.nativeEvent.stopImmediatePropagation();
                      const lblLocked = lockedLayerIdsRef.current.has(lbl.id);
                      if (toolRef.current === "erase") {
                        e.stopPropagation();
                        if (lblLocked) {
                          selectOnly("label", lbl.id);
                          return;
                        }
                        pushHistoryRef.current?.();
                        setSelectedLabelId(null);
                        deleteLabelApi(lbl.id);
                        setCanvasLabels((prev) => prev.filter((l) => l.id !== lbl.id));
                        return;
                      }
                      if (toolRef.current !== "move" && toolRef.current !== "select") {
                        selectOnly("label", lbl.id);
                        return;
                      }
                      const startedInSelect = toolRef.current === "select";
                      // Cmd/Shift+Clic : multi-sélection labels.
                      if (e.metaKey || e.ctrlKey || e.shiftKey) {
                        setSelectedLabelIds((prev) => {
                          const seed =
                            prev.size > 0
                              ? prev
                              : selectedLabelId
                                ? new Set([selectedLabelId])
                                : new Set<string>();
                          const next = new Set(seed);
                          if (e.shiftKey && !(e.metaKey || e.ctrlKey)) next.add(lbl.id);
                          else {
                            if (next.has(lbl.id)) next.delete(lbl.id);
                            else next.add(lbl.id);
                          }
                          return next;
                        });
                        setSelectedNodeId(null);
                        setSelectedZoneId(null);
                        setSelectedZoneIds(new Set());
                        setSelectedAdapterId(null);
                        setSelectedConnId(null);
                        setSelectedConnIds(new Set());
                        setSelectedLabelId(lbl.id);
                        return;
                      }
                      selectOnly("label", lbl.id);
                      if (lblLocked) return;
                      // Alt+drag → duplique le label et déplace la copie
                      let targetId = lbl.id;
                      if (e.altKey) {
                        const dupe: CanvasLabel = { ...lbl, id: `label-${Date.now()}` };
                        targetId = dupe.id;
                        pushHistoryRef.current?.();
                        setCanvasLabels((prev) => [...prev, dupe]);
                        createLabelApi(dupe);
                        selectOnly("label", dupe.id);
                      }
                      const el = containerRef.current;
                      if (!el) return;
                      const rect = el.getBoundingClientRect();
                      const { pan: p, zoom: z } = viewRef.current;
                      const startCX = (e.clientX - rect.left - p.x) / z;
                      const startCY = (e.clientY - rect.top - p.y) / z;
                      const origX = lbl.x,
                        origY = lbl.y;
                      // Alt+Drag dupe → suivre le pointeur immédiatement.
                      let moved = e.altKey;
                      let historyPushed = !startedInSelect || e.altKey;
                      if (!startedInSelect && !e.altKey) pushHistoryRef.current?.();
                      const onMove = (ev: PointerEvent) => {
                        const r2 = el.getBoundingClientRect();
                        const { pan: p2, zoom: z2 } = viewRef.current;
                        const cx2 = (ev.clientX - r2.left - p2.x) / z2;
                        const cy2 = (ev.clientY - r2.top - p2.y) / z2;
                        const ddx = cx2 - startCX,
                          ddy = cy2 - startCY;
                        if (Math.abs(ddx) > 2 || Math.abs(ddy) > 2) moved = true;
                        if (moved) {
                          if (startedInSelect && toolRef.current === "select")
                            setToolRef.current("move");
                          if (!historyPushed) {
                            pushHistoryRef.current?.();
                            historyPushed = true;
                          }
                          {
                            const snapS = useTopbarActions.getState();
                            const { x: nx, y: ny } = snapIf(
                              origX + ddx,
                              origY + ddy,
                              snapS.gridStep,
                              snapS.snapEnabled,
                            );
                            setCanvasLabels((prev) =>
                              prev.map((l) => (l.id === targetId ? { ...l, x: nx, y: ny } : l)),
                            );
                          }
                        }
                      };
                      const onUp = () => {
                        window.removeEventListener("pointermove", onMove);
                        if (!moved) return;
                        const snap = useTopbarActions.getState();
                        setCanvasLabels((prev) => {
                          const next = prev.map((l) => {
                            if (l.id !== targetId) return l;
                            if (!snap.snapEnabled) return l;
                            return {
                              ...l,
                              x: snapCoord(l.x, snap.gridStep),
                              y: snapCoord(l.y, snap.gridStep),
                            };
                          });
                          const updated = next.find((l) => l.id === targetId);
                          if (updated) updateLabelApi(updated);
                          return next;
                        });
                      };
                      window.addEventListener("pointermove", onMove);
                      window.addEventListener("pointerup", onUp, { once: true });
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setLabelEditing({ mode: "edit", labelId: lbl.id });
                    }}
                  />
                  <text
                    x={isPill ? boxX + boxW / 2 : lbl.x}
                    y={isPill ? boxY + boxH / 2 : lbl.y}
                    fontSize={lbl.fontSize}
                    fill={lbl.color}
                    fontWeight={lbl.fontWeight}
                    fontFamily={lbl.fontFamily ?? "system-ui"}
                    fontStyle={lbl.fontStyle ?? "normal"}
                    textDecoration={lbl.textDecoration ?? "none"}
                    textAnchor={isPill ? "middle" : "start"}
                    dominantBaseline={isPill ? "central" : undefined}
                    style={{ userSelect: "none", pointerEvents: "none" }}
                  >
                    {lbl.text}
                  </text>
                  {lockedLayerIds.has(lbl.id) &&
                    (() => {
                      const inv = 1 / Math.max(0.1, zoom);
                      const ICON = 12;
                      const anchorX = boxX - 4 * inv;
                      const anchorY = boxY + boxH / 2;
                      return (
                        <g
                          pointerEvents="none"
                          opacity={0.55}
                          transform={`translate(${anchorX}, ${anchorY}) scale(${inv}) translate(-${ICON}, -${ICON / 2})`}
                        >
                          <rect
                            width={ICON}
                            height={ICON}
                            rx={2}
                            style={{ fill: "var(--surface)", stroke: "var(--muted-foreground)" }}
                            strokeWidth={1}
                          />
                          <rect
                            x={3}
                            y={6}
                            width={6}
                            height={4.5}
                            rx={0.8}
                            style={{ fill: "var(--muted-foreground)" }}
                          />
                          <path
                            d="M 4 6 V 4.5 A 2 2 0 0 1 8 4.5 V 6"
                            fill="none"
                            style={{ stroke: "var(--muted-foreground)" }}
                            strokeWidth={1.1}
                          />
                        </g>
                      );
                    })()}
                  {handles.map((h) => (
                    <circle
                      key={h.id}
                      cx={h.cx}
                      cy={h.cy}
                      r={5}
                      // arkyo-server: habillage Strata (fond de poignée de sélection : --surface)
                      fill="var(--surface)"
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                      style={{ cursor: h.cursor, pointerEvents: "all" }}
                      onPointerDown={(e) => {
                        e.nativeEvent.stopImmediatePropagation();
                        startLabelResize(h.id, e);
                      }}
                    />
                  ))}
                </g>
              );
            })}
            {cablesHydrated &&
              (() => {
                return resolvedConnections.map((conn) => {
                  if (hiddenLayerIds.has(conn.id)) return null;
                  const fromPorts = getPortsForSlotOrAdapter(conn.fromSlotId);
                  const toPorts = getPortsForSlotOrAdapter(conn.toSlotId);
                  const fromPort = fromPorts.find(
                    (p: Port) => p.portIndex === conn.fromConnectorIndex,
                  );
                  const toPort = toPorts.find((p: Port) => p.portIndex === conn.toConnectorIndex);
                  let from = getPortCenter(conn.fromSlotId, conn.fromConnectorIndex);
                  let to = getPortCenter(conn.toSlotId, conn.toConnectorIndex);
                  // ── Endpoint drag live preview: override the dragged end position ──
                  if (endpointDrag && endpointDrag.connId === conn.id) {
                    const snapCenter = endpointDrag.snap
                      ? getPortCenter(endpointDrag.snap.slotId, endpointDrag.snap.portIndex)
                      : null;
                    const pos =
                      snapCenter ??
                      (endpointDrag.cursor
                        ? {
                            x: endpointDrag.cursor.x,
                            y: endpointDrag.cursor.y,
                            side: "left" as const,
                          }
                        : null);
                    if (pos) {
                      if (endpointDrag.side === "from") from = pos;
                      else to = pos;
                    }
                  }
                  if (!from || !to) return null;
                  // Couleur câble : signal résolu prioritaire (fallback toPort
                  // pour les ports switching/transit) avant connecteur.
                  const sigName =
                    fromPort?.entry.signalName ?? toPort?.entry.signalName ?? null;
                  const sigColor = sigName ? sigColorByName[sigName] : undefined;
                  const color =
                    conn.color ??
                    sigColor ??
                    fromPort?.ct?.color ??
                    toPort?.ct?.color ??
                    "#6366f1";
                  const safeBypassY = bypassYMap.get(conn.id);
                  const isSelected = selectedConnId === conn.id || selectedConnIds.has(conn.id);
                  const isMultiSelected = selectedConnIds.has(conn.id);
                  const isPreview = previewConnIds.has(conn.id) && !isSelected;
                  const isActive = isSelected;
                  const isDuplicateLabel = !!(conn.label && duplicateLabels.has(conn.label));

                  // ── Arrow stub style ──────────────────────────────────────────────
                  const connStyle = connStyles.get(conn.id) ?? cableStyle;
                  if (connStyle === "arrow") {
                    const AH = 5; // arrowhead half-height
                    const AL = 9; // arrowhead length
                    const CHAR_W = 5.5; // approx px per char at fontSize 8
                    const GAP = 12; // space between arrowhead tip and equip label

                    const sharedLbl = conn.label ?? "";
                    const fromSlot = expandedSlots.find((s) => s.id === conn.fromSlotId);
                    const toSlot = expandedSlots.find((s) => s.id === conn.toSlotId);
                    const fromAdpParsed = parseAdapterSlotId(conn.fromSlotId);
                    const toAdpParsed = parseAdapterSlotId(conn.toSlotId);
                    const fromAdpInst = fromAdpParsed
                      ? adapters.find((a) => a.id === fromAdpParsed.adapterId)
                      : null;
                    const toAdpInst = toAdpParsed
                      ? adapters.find((a) => a.id === toAdpParsed.adapterId)
                      : null;

                    const fromPorts = getPortsForSlotOrAdapter(conn.fromSlotId);
                    const toPorts2 = getPortsForSlotOrAdapter(conn.toSlotId);
                    const fromPortObj = fromPorts.find(
                      (p) => p.portIndex === conn.fromConnectorIndex,
                    );
                    const toPortObj = toPorts2.find((p) => p.portIndex === conn.toConnectorIndex);
                    const fromPortLabel = fromPortObj
                      ? (fromPortObj.entry.label ?? fromPortObj.ct?.name ?? "") +
                        (fromPortObj.totalUnits > 1 ? ` ${fromPortObj.unitIndex + 1}` : "")
                      : "";
                    const toPortLabel = toPortObj
                      ? (toPortObj.entry.label ?? toPortObj.ct?.name ?? "") +
                        (toPortObj.totalUnits > 1 ? ` ${toPortObj.unitIndex + 1}` : "")
                      : "";
                    const srcEquip =
                      (fromAdpInst
                        ? (fromAdpInst.label ?? fromAdpInst.adapter.name)
                        : (fromSlot?.label ??
                          fromSlot?.equipment?.reference ??
                          fromSlot?.equipment?.name ??
                          "?")) + (fromPortLabel ? ` ${fromPortLabel}` : "");
                    const dstEquip =
                      (toAdpInst
                        ? (toAdpInst.label ?? toAdpInst.adapter.name)
                        : (toSlot?.label ??
                          toSlot?.equipment?.reference ??
                          toSlot?.equipment?.name ??
                          "?")) + (toPortLabel ? ` ${toPortLabel}` : "");

                    // Stub length = enough to fit the tip equip label
                    // For adapter endpoints (short labels, close to equipment), use shorter stubs
                    const fromIsAdp = !!fromAdpParsed;
                    const toIsAdp = !!toAdpParsed;
                    const rawSrcStub = Math.max(40, dstEquip.length * CHAR_W + AL + GAP + 10);
                    const rawDstStub = Math.max(40, srcEquip.length * CHAR_W + AL + GAP + 10);
                    const hDist = Math.abs(to.x - from.x);
                    const maxStub = hDist > 0 ? hDist * 0.4 : 80;
                    const srcStub =
                      fromIsAdp || toIsAdp
                        ? Math.min(rawSrcStub, Math.max(40, maxStub))
                        : rawSrcStub;
                    const dstStub =
                      fromIsAdp || toIsAdp
                        ? Math.min(rawDstStub, Math.max(40, maxStub))
                        : rawDstStub;

                    const srcDir = from.side === "right" ? 1 : -1;
                    const dstDir = to.side === "left" ? -1 : 1;

                    const srcTip = from.x + srcDir * srcStub;
                    const dstTip = to.x + dstDir * dstStub;

                    // Arrowhead polygon: base at tipX, point extends srcDir*AL
                    const arrowPoly = (tipX: number, y: number, dir: number) =>
                      `${tipX},${y - AH} ${tipX + dir * AL},${y} ${tipX},${y + AH}`;

                    // Equip label positioned just beyond arrowhead point
                    const srcEquipX = srcTip + srcDir * (AL + GAP);
                    const srcEquipAnchor = srcDir > 0 ? "start" : "end";
                    const dstEquipX = dstTip + dstDir * (AL + GAP);
                    const dstEquipAnchor = dstDir > 0 ? "start" : "end";

                    const clickProps = {
                      "data-cable": "true" as const,
                      style: {
                        pointerEvents: tool === "select" ? ("all" as const) : ("none" as const),
                        cursor: "pointer" as const,
                      },
                      onClick: (e: React.MouseEvent) => {
                        e.stopPropagation();
                        if (toolRef.current === "move") return;
                        if (e.metaKey || e.ctrlKey || e.shiftKey) {
                          const already =
                            selectedConnIds.has(conn.id) || selectedConnId === conn.id;
                          setSelectedConnIds((prev) => {
                            const seed =
                              prev.size > 0
                                ? prev
                                : selectedConnId
                                  ? new Set([selectedConnId])
                                  : new Set<string>();
                            const next = new Set(seed);
                            if (e.shiftKey && !(e.metaKey || e.ctrlKey)) {
                              next.add(conn.id);
                            } else {
                              if (next.has(conn.id)) next.delete(conn.id);
                              else next.add(conn.id);
                            }
                            return next;
                          });
                          setSelectedZoneId(null);
                          setSelectedLabelId(null);
                          setSelectedAdapterId(null);
                          setSelectedNodeId(null);
                          const isShiftOnly = e.shiftKey && !(e.metaKey || e.ctrlKey);
                          if (!isShiftOnly && already && selectedConnId === conn.id)
                            setSelectedConnId(null);
                          else setSelectedConnId(conn.id);
                          return;
                        }
                        selectOnly("conn", conn.id);
                      },
                      onContextMenu: (e: React.MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectOnly("conn", conn.id);
                        setContextMenu({ x: e.clientX, y: e.clientY, type: "cable", id: conn.id });
                      },
                    };

                    // Ring de sélection unifié : préfiltre léger, le halo accent est rendu
                    // via un path dédié (voir ci-dessous) pour garder un rendu sobre.
                    const selRing =
                      isPreview && !isActive ? { filter: `drop-shadow(0 0 2px ${color})` } : {};
                    const srcAnimPath = `M ${from.x} ${from.y} L ${srcTip} ${from.y}`;
                    const dstAnimPath = `M ${dstTip} ${to.y} L ${to.x} ${to.y}`;

                    return (
                      <g key={conn.id} style={selRing}>
                        {/* Halo de sélection unifié (arrow style) */}
                        {isActive && (
                          <>
                            <line
                              x1={from.x}
                              y1={from.y}
                              x2={srcTip}
                              y2={from.y}
                              stroke="var(--accent)"
                              strokeWidth={6}
                              strokeOpacity={0.35}
                              strokeLinecap="round"
                              style={{ pointerEvents: "none" }}
                            />
                            <line
                              x1={to.x}
                              y1={to.y}
                              x2={dstTip}
                              y2={to.y}
                              stroke="var(--accent)"
                              strokeWidth={6}
                              strokeOpacity={0.35}
                              strokeLinecap="round"
                              style={{ pointerEvents: "none" }}
                            />
                          </>
                        )}
                        {/* ── Source stub (outward arrow →) ── */}
                        <line
                          x1={from.x}
                          y1={from.y}
                          x2={srcTip}
                          y2={from.y}
                          stroke={color}
                          strokeWidth={1.5}
                          opacity={0.9}
                          style={{ pointerEvents: "none" }}
                        />
                        <polygon
                          points={arrowPoly(srcTip, from.y, srcDir)}
                          fill={color}
                          opacity={0.9}
                          style={{ pointerEvents: "none" }}
                        />
                        {/* Above stub: connector type closest to port, label further */}
                        <text
                          x={from.x + srcDir * 8}
                          y={from.y - 5}
                          textAnchor={srcDir > 0 ? "start" : "end"}
                          fontSize={8}
                          fontFamily="system-ui"
                          style={{ pointerEvents: "none", userSelect: "none" }}
                          suppressHydrationWarning
                        >
                          {srcDir > 0 ? (
                            <>
                              <tspan
                                style={{ fill: "var(--muted-foreground)" }}
                                suppressHydrationWarning
                              >
                                {fromPort?.ct?.name ?? ""}
                              </tspan>
                              {fromPort?.ct?.name && sharedLbl && (
                                <tspan
                                  dx={8}
                                  fill={color}
                                  fontWeight="600"
                                  suppressHydrationWarning
                                >
                                  {sharedLbl}
                                </tspan>
                              )}
                            </>
                          ) : (
                            <>
                              <tspan fill={color} fontWeight="600" suppressHydrationWarning>
                                {sharedLbl}
                              </tspan>
                              {sharedLbl && fromPort?.ct?.name && (
                                <tspan
                                  dx={8}
                                  style={{ fill: "var(--muted-foreground)" }}
                                  suppressHydrationWarning
                                >
                                  {fromPort?.ct?.name ?? ""}
                                </tspan>
                              )}
                            </>
                          )}
                        </text>
                        {/* At arrow tip level: remote equip + port label */}
                        <text
                          x={srcEquipX}
                          y={from.y}
                          textAnchor={srcEquipAnchor}
                          dominantBaseline="middle"
                          fontSize={8}
                          fontFamily="system-ui"
                          style={{
                            fill: "var(--muted-foreground)",
                            pointerEvents: "none",
                            userSelect: "none",
                          }}
                        >
                          {dstEquip}
                        </text>
                        {isActive && (
                          <circle
                            r={5}
                            fill={color}
                            opacity={0.9}
                            style={{ filter: `drop-shadow(0 0 4px ${color})` }}
                          >
                            <animateMotion dur="1.4s" repeatCount="indefinite" path={srcAnimPath} />
                          </circle>
                        )}
                        <line
                          x1={from.x}
                          y1={from.y}
                          x2={srcTip}
                          y2={from.y}
                          stroke="transparent"
                          strokeWidth={20}
                          {...clickProps}
                        />

                        {/* ── Destination stub (inward arrow ←) ── */}
                        <line
                          x1={to.x}
                          y1={to.y}
                          x2={dstTip}
                          y2={to.y}
                          stroke={color}
                          strokeWidth={1.5}
                          opacity={0.9}
                          style={{ pointerEvents: "none" }}
                        />
                        <polygon
                          points={arrowPoly(dstTip, to.y, -dstDir)}
                          fill={color}
                          opacity={0.9}
                          style={{ pointerEvents: "none" }}
                        />
                        {/* Above stub: connector type closest to port, label further */}
                        <text
                          x={to.x + dstDir * 8}
                          y={to.y - 5}
                          textAnchor={dstDir > 0 ? "start" : "end"}
                          fontSize={8}
                          fontFamily="system-ui"
                          style={{ pointerEvents: "none", userSelect: "none" }}
                          suppressHydrationWarning
                        >
                          {dstDir > 0 ? (
                            <>
                              <tspan
                                style={{ fill: "var(--muted-foreground)" }}
                                suppressHydrationWarning
                              >
                                {toPort?.ct?.name ?? ""}
                              </tspan>
                              {toPort?.ct?.name && sharedLbl && (
                                <tspan
                                  dx={8}
                                  fill={color}
                                  fontWeight="600"
                                  suppressHydrationWarning
                                >
                                  {sharedLbl}
                                </tspan>
                              )}
                            </>
                          ) : (
                            <>
                              <tspan fill={color} fontWeight="600" suppressHydrationWarning>
                                {sharedLbl}
                              </tspan>
                              {sharedLbl && toPort?.ct?.name && (
                                <tspan
                                  dx={8}
                                  style={{ fill: "var(--muted-foreground)" }}
                                  suppressHydrationWarning
                                >
                                  {toPort?.ct?.name ?? ""}
                                </tspan>
                              )}
                            </>
                          )}
                        </text>
                        {/* At arrow tip level: remote equip + port label */}
                        <text
                          x={dstEquipX}
                          y={to.y}
                          textAnchor={dstEquipAnchor}
                          dominantBaseline="middle"
                          fontSize={8}
                          fontFamily="system-ui"
                          style={{
                            fill: "var(--muted-foreground)",
                            pointerEvents: "none",
                            userSelect: "none",
                          }}
                        >
                          {srcEquip}
                        </text>
                        {isActive && (
                          <circle
                            r={5}
                            fill={color}
                            opacity={0.9}
                            style={{ filter: `drop-shadow(0 0 4px ${color})` }}
                          >
                            <animateMotion dur="1.4s" repeatCount="indefinite" path={dstAnimPath} />
                          </circle>
                        )}
                        <line
                          x1={to.x}
                          y1={to.y}
                          x2={dstTip}
                          y2={to.y}
                          stroke="transparent"
                          strokeWidth={20}
                          {...clickProps}
                        />
                        {isDuplicateLabel &&
                          conn.label &&
                          (() => {
                            const S = 5.5;
                            const CHAR = 5.2;
                            const GAP = 4;
                            const labelW = conn.label.length * CHAR;
                            const renderArrowTri = (
                              px: number,
                              py: number,
                              dir: number,
                              ctName: string,
                            ) => {
                              const totalW =
                                (ctName.length > 0 ? ctName.length * CHAR + 8 : 0) + labelW;
                              const tx = px + dir * (8 + totalW + GAP + S);
                              const ty = py - 5;
                              return (
                                <g style={{ pointerEvents: "none" }}>
                                  <polygon
                                    points={`${tx},${ty - S} ${tx + S * 0.866},${ty + S * 0.5} ${tx - S * 0.866},${ty + S * 0.5}`}
                                    fill="#f59e0b"
                                    opacity={0.95}
                                  />
                                  <text
                                    x={tx}
                                    y={ty + S * 0.35}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    fontSize={6}
                                    fontWeight="900"
                                    fill="white"
                                    fontFamily="system-ui"
                                    style={{ userSelect: "none" }}
                                  >
                                    !
                                  </text>
                                </g>
                              );
                            };
                            return (
                              <>
                                {renderArrowTri(from.x, from.y, srcDir, fromPort?.ct?.name ?? "")}
                                {renderArrowTri(to.x, to.y, dstDir, toPort?.ct?.name ?? "")}
                              </>
                            );
                          })()}
                      </g>
                    );
                  }

                  const wpts = connWaypoints.get(conn.id) ?? [];
                  const laneOffset = cableLaneOffsets.get(conn.id) ?? 0;
                  const path = makePathWithWaypoints(
                    from.x,
                    from.y,
                    from.side,
                    to.x,
                    to.y,
                    to.side,
                    wpts,
                    connStyle,
                    safeBypassY,
                    laneOffset,
                    conn.fromSlotId,
                    conn.toSlotId,
                  );
                  // Bundle halo : si le câble fait partie d'un faisceau, halo coloré plus épais en dessous du câble.
                  const bundleId =
                    (conn as unknown as { bundleId?: string | null }).bundleId ?? null;
                  const bundle = bundleId ? bundleById.get(bundleId) : null;
                  return (
                    <g key={conn.id}>
                      {/* Halo du faisceau : discret mais visible */}
                      {bundle && (
                        <path
                          d={path}
                          fill="none"
                          stroke={bundle.color}
                          strokeOpacity={0.55}
                          strokeWidth={5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                      {/* Wide transparent hit area — active en mode select et erase */}
                      <path
                        data-cable="true"
                        d={path}
                        fill="none"
                        stroke="rgba(0,0,0,0)"
                        strokeWidth={20}
                        style={{
                          pointerEvents: tool === "select" || tool === "erase" ? "stroke" : "none",
                          cursor: tool === "erase" ? "not-allowed" : "pointer",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const cableLocked = lockedLayerIdsRef.current.has(conn.id);
                          if (tool === "erase") {
                            if (cableLocked) {
                              selectOnly("conn", conn.id);
                              return;
                            }
                            handleDeleteConnection(conn.id);
                            return;
                          }
                          if (tool === "move") return;
                          // Cmd/Ctrl+Clic = toggle · Shift+Clic = extend (ajoute sans retirer).
                          if (e.metaKey || e.ctrlKey || e.shiftKey) {
                            const already =
                              selectedConnIds.has(conn.id) || selectedConnId === conn.id;
                            setSelectedConnIds((prev) => {
                              const seed =
                                prev.size > 0
                                  ? prev
                                  : selectedConnId
                                    ? new Set([selectedConnId])
                                    : new Set<string>();
                              const next = new Set(seed);
                              if (e.shiftKey && !(e.metaKey || e.ctrlKey)) {
                                // Shift seul → extend (toujours ajouter)
                                next.add(conn.id);
                              } else {
                                // Cmd/Ctrl → toggle
                                if (next.has(conn.id)) next.delete(conn.id);
                                else next.add(conn.id);
                              }
                              return next;
                            });
                            setSelectedZoneId(null);
                            setSelectedLabelId(null);
                            setSelectedAdapterId(null);
                            setSelectedNodeId(null);
                            const isShiftOnly = e.shiftKey && !(e.metaKey || e.ctrlKey);
                            if (!isShiftOnly && already && selectedConnId === conn.id)
                              setSelectedConnId(null);
                            else setSelectedConnId(conn.id);
                            return;
                          }
                          selectOnly("conn", conn.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Si le câble fait partie de la multi-sélection, on la conserve.
                          // Sinon, on bascule en sélection unique sur ce câble.
                          if (!selectedConnIds.has(conn.id)) {
                            selectOnly("conn", conn.id);
                          } else {
                            setSelectedConnId(conn.id);
                          }
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            type: "cable",
                            id: conn.id,
                          });
                        }}
                      />
                      {/* Halo de sélection unifié : path accent sous le câble, sobre. */}
                      {isActive && (
                        <path
                          d={path}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth={6}
                          strokeOpacity={0.35}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                      {/* Visible line — épaisseur/opacité stables ; la sélection est
                    traduite uniquement par le halo accent ci-dessus. */}
                      <path
                        d={path}
                        fill="none"
                        stroke={color}
                        strokeWidth={isPreview ? 2 : 1.5}
                        opacity={isPreview ? 0.9 : isActive ? 0.9 : 0.6}
                        style={{
                          pointerEvents: "none",
                          filter: isPreview ? `drop-shadow(0 0 3px ${color})` : undefined,
                        }}
                      />
                      {/* Connector type labels + cable number at both ends */}
                      {(() => {
                        const isUnlabelled = !conn.label;
                        const cableLabel = conn.label ?? "—";
                        const labelFill = isUnlabelled ? "#9ca3af" : color;
                        const labelWeight = isUnlabelled ? "400" : "600";
                        // Texte ancré vers l'extérieur du nœud : port droit → start, port gauche → end
                        const fromAnchor = from.side === "right" ? "start" : "end";
                        const fromOx = from.side === "right" ? 8 : -8;
                        const toAnchor = to.side === "right" ? "start" : "end";
                        const toOx = to.side === "right" ? 8 : -8;
                        return (
                          <>
                            {/* FROM end — connecteur toujours le plus proche du port */}
                            <text
                              x={from.x + fromOx}
                              y={from.y - 5}
                              textAnchor={fromAnchor}
                              fontSize={8}
                              fontFamily="system-ui"
                              style={{ pointerEvents: "none" }}
                              suppressHydrationWarning
                            >
                              {fromAnchor === "end" ? (
                                <>
                                  <tspan
                                    fill={labelFill}
                                    fontWeight={labelWeight}
                                    fontStyle={isUnlabelled ? "italic" : undefined}
                                    suppressHydrationWarning
                                  >
                                    {cableLabel}
                                  </tspan>
                                  {fromPort?.ct?.name && (
                                    <tspan
                                      dx={8}
                                      style={{ fill: "var(--muted-foreground)" }}
                                      suppressHydrationWarning
                                    >
                                      {fromPort.ct.name}
                                    </tspan>
                                  )}
                                </>
                              ) : (
                                <>
                                  <tspan
                                    style={{ fill: "var(--muted-foreground)" }}
                                    suppressHydrationWarning
                                  >
                                    {fromPort?.ct?.name ?? ""}
                                  </tspan>
                                  <tspan
                                    dx={fromPort?.ct?.name ? 8 : 0}
                                    fill={labelFill}
                                    fontWeight={labelWeight}
                                    fontStyle={isUnlabelled ? "italic" : undefined}
                                    suppressHydrationWarning
                                  >
                                    {cableLabel}
                                  </tspan>
                                </>
                              )}
                            </text>
                            {/* TO end — connecteur toujours le plus proche du port */}
                            <text
                              x={to.x + toOx}
                              y={to.y - 5}
                              textAnchor={toAnchor}
                              fontSize={8}
                              fontFamily="system-ui"
                              style={{ pointerEvents: "none" }}
                              suppressHydrationWarning
                            >
                              {toAnchor === "end" ? (
                                <>
                                  <tspan
                                    fill={labelFill}
                                    fontWeight={labelWeight}
                                    fontStyle={isUnlabelled ? "italic" : undefined}
                                    suppressHydrationWarning
                                  >
                                    {cableLabel}
                                  </tspan>
                                  {toPort?.ct?.name && (
                                    <tspan
                                      dx={8}
                                      style={{ fill: "var(--muted-foreground)" }}
                                      suppressHydrationWarning
                                    >
                                      {toPort.ct.name}
                                    </tspan>
                                  )}
                                </>
                              ) : (
                                <>
                                  <tspan
                                    style={{ fill: "var(--muted-foreground)" }}
                                    suppressHydrationWarning
                                  >
                                    {toPort?.ct?.name ?? ""}
                                  </tspan>
                                  <tspan
                                    dx={toPort?.ct?.name ? 8 : 0}
                                    fill={labelFill}
                                    fontWeight={labelWeight}
                                    fontStyle={isUnlabelled ? "italic" : undefined}
                                    suppressHydrationWarning
                                  >
                                    {cableLabel}
                                  </tspan>
                                </>
                              )}
                            </text>
                          </>
                        );
                      })()}
                      {/* ── Duplicate label warning triangles — one at each end, next to the label ── */}
                      {isDuplicateLabel &&
                        conn.label &&
                        (() => {
                          const S = 5.5;
                          const CHAR = 5.2; // approx px per char at fontSize 8
                          const GAP = 4;
                          const cableLabel = conn.label;
                          const labelW = cableLabel.length * CHAR;

                          // Triangle positionné à l'extrémité extérieure du label (après le texte le plus loin du port)
                          const renderTri = (
                            px: number,
                            py: number,
                            side: "left" | "right",
                            ctName: string,
                          ) => {
                            const dir = side === "right" ? 1 : -1;
                            // Text layout: port ±8 → ctName → gap8 → label (anchor=end: order reversed but same total width)
                            const totalW =
                              (ctName.length > 0 ? ctName.length * CHAR + 8 : 0) + labelW;
                            const tx = px + dir * (8 + totalW + GAP + S);
                            const ty = py - 5;
                            return (
                              // Les attributs `data-dup-*` servent au rendu
                              // vectoriel : la largeur du libellé y est estimée
                              // (CHAR px/caractère), or le PDF substitue sa
                              // police et cette estimation glisse. L'export
                              // remesure et recale le repère — voir
                              // `recalibrateDuplicateMarkers`.
                              <g
                                data-dup-tri
                                data-dir={dir}
                                data-est-w={totalW}
                                data-ct={ctName}
                                data-label={cableLabel}
                                style={{ pointerEvents: "none" }}
                              >
                                <polygon
                                  points={`${tx},${ty - S} ${tx + S * 0.866},${ty + S * 0.5} ${tx - S * 0.866},${ty + S * 0.5}`}
                                  fill="#f59e0b"
                                  opacity={0.95}
                                />
                                <text
                                  x={tx}
                                  y={ty + S * 0.35}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fontSize={6}
                                  fontWeight="900"
                                  fill="white"
                                  fontFamily="system-ui"
                                  style={{ userSelect: "none" }}
                                >
                                  !
                                </text>
                              </g>
                            );
                          };

                          return (
                            <>
                              {renderTri(from.x, from.y, from.side, fromPort?.ct?.name ?? "")}
                              {renderTri(to.x, to.y, to.side, toPort?.ct?.name ?? "")}
                            </>
                          );
                        })()}
                    </g>
                  );
                }); // resolvedConnections.map
              })()}{" "}
            {/* IIFE */}
            {/* Drawing preview */}
            {drawingFrom &&
              mousePos &&
              (() => {
                const from = getPortCenter(drawingFrom.slotId, drawingFrom.portIndex);
                if (!from) return null;
                const fromPort = slotPorts
                  .get(drawingFrom.slotId)
                  ?.find((p) => p.portIndex === drawingFrom.portIndex);
                const color = fromPort?.ct?.color ?? "#6366f1";

                // Snapped destination position
                const snapCenter = snapTarget
                  ? getPortCenter(snapTarget.slotId, snapTarget.portIndex)
                  : null;
                const destX = snapCenter?.x ?? mousePos.x;
                const destY = snapCenter?.y ?? mousePos.y;
                const destSide = snapCenter?.side ?? "left";

                // ── Arrow style preview ───────────────────────────────────────────
                if (cableStyle === "arrow") {
                  const AH = 5;
                  const AL = 9;
                  const STUB = 70;
                  const arrowPoly = (tipX: number, y: number, dir: number) =>
                    `${tipX},${y - AH} ${tipX + dir * AL},${y} ${tipX},${y + AH}`;

                  // Multi-cable phase 2: show arrow preview for all selected source ports
                  if (cableCount === "multi" && multiSrcConfirmed && multiSrcPorts) {
                    const srcIndices =
                      multiSrcPorts.slotId === drawingFrom.slotId
                        ? multiSrcPorts.portIndices
                        : [drawingFrom.portIndex];
                    // Build dst candidates
                    let dstIndices: (number | undefined)[] = srcIndices.map(() => undefined);
                    if (snapTarget) {
                      const dstPorts = slotPorts.get(snapTarget.slotId) ?? [];
                      const firstDst = dstPorts.find((p) => p.portIndex === snapTarget.portIndex);
                      if (firstDst) {
                        const dstSide = firstDst.side;
                        const dstSidePorts = dstPorts
                          .filter((p) => p.side === dstSide)
                          .sort((a, b) => a.portIndex - b.portIndex);
                        const startI = dstSidePorts.findIndex(
                          (p) => p.portIndex === snapTarget.portIndex,
                        );
                        // Aperçu = ports consécutifs réellement câblés (pas de
                        // filtre par type de connecteur).
                        dstIndices = srcIndices.map(
                          (_, i) => dstSidePorts[startI + i]?.portIndex,
                        );
                      }
                    }
                    return (
                      <>
                        {srcIndices.map((pi, i) => {
                          const pc = getPortCenter(drawingFrom.slotId, pi);
                          if (!pc) return null;
                          const srcDir = pc.side === "right" ? 1 : -1;
                          const srcTip = pc.x + srcDir * STUB;
                          let tx = destX;
                          let ty = destY + i * PORT_H;
                          let ts = destSide;
                          if (dstIndices[i] !== undefined) {
                            const dc = getPortCenter(snapTarget!.slotId, dstIndices[i]!);
                            if (dc) {
                              tx = dc.x;
                              ty = dc.y;
                              ts = dc.side;
                            }
                          }
                          const dstDir = ts === "left" ? -1 : 1;
                          const dstTip = tx + dstDir * STUB;
                          const op = Math.max(0.25, 0.85 - i * 0.08);
                          return (
                            <g key={pi}>
                              <line
                                x1={pc.x}
                                y1={pc.y}
                                x2={srcTip}
                                y2={pc.y}
                                stroke={color}
                                strokeWidth={1.5}
                                strokeDasharray="5 3"
                                opacity={op}
                                style={{ pointerEvents: "none" }}
                              />
                              <polygon
                                points={arrowPoly(srcTip, pc.y, srcDir)}
                                fill={color}
                                opacity={op}
                                style={{ pointerEvents: "none" }}
                              />
                              <line
                                x1={tx}
                                y1={ty}
                                x2={dstTip}
                                y2={ty}
                                stroke={color}
                                strokeWidth={1.5}
                                strokeDasharray="5 3"
                                opacity={op * 0.7}
                                style={{ pointerEvents: "none" }}
                              />
                              <polygon
                                points={arrowPoly(dstTip, ty, -dstDir)}
                                fill={color}
                                opacity={op * 0.7}
                                style={{ pointerEvents: "none" }}
                              />
                            </g>
                          );
                        })}
                      </>
                    );
                  }

                  // Single cable arrow preview
                  const srcDir = from.side === "right" ? 1 : -1;
                  const dstDir = destSide === "left" ? -1 : 1;
                  const srcTip = from.x + srcDir * STUB;
                  const dstTip = destX + dstDir * STUB;
                  return (
                    <>
                      {/* Source stub */}
                      <line
                        x1={from.x}
                        y1={from.y}
                        x2={srcTip}
                        y2={from.y}
                        stroke={color}
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                        opacity={0.85}
                        style={{ pointerEvents: "none" }}
                      />
                      <polygon
                        points={arrowPoly(srcTip, from.y, srcDir)}
                        fill={color}
                        opacity={0.85}
                        style={{ pointerEvents: "none" }}
                      />
                      {/* Destination ghost stub */}
                      <line
                        x1={destX}
                        y1={destY}
                        x2={dstTip}
                        y2={destY}
                        stroke={color}
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                        opacity={0.6}
                        style={{ pointerEvents: "none" }}
                      />
                      <polygon
                        points={arrowPoly(dstTip, destY, -dstDir)}
                        fill={color}
                        opacity={0.6}
                        style={{ pointerEvents: "none" }}
                      />
                    </>
                  );
                }

                // ── Build multipoint preview path — waypoints offset by (dy) from reference port ──
                // refY = Y of the reference port (first selected src), dy = vertical offset for this cable
                const buildMultipointPath = (
                  fx: number,
                  fy: number,
                  tx: number,
                  ty: number,
                  refY: number,
                ) => {
                  const dy = fy - refY; // vertical offset vs reference port
                  // Shift all waypoints by dy so each cable runs parallel
                  const shiftedWps = drawingWaypoints.map((wp) => ({ x: wp.x, y: wp.y + dy }));
                  const lastWp =
                    shiftedWps.length > 0 ? shiftedWps[shiftedWps.length - 1] : { x: fx, y: fy };
                  const segEnd =
                    drawingDirection === "H" ? { x: tx, y: lastWp.y } : { x: lastWp.x, y: ty };
                  const pts = [{ x: fx, y: fy }, ...shiftedWps, segEnd];
                  let d = `M ${pts[0].x} ${pts[0].y}`;
                  for (let i = 1; i < pts.length; i++) {
                    const r = 10;
                    const p1 = pts[i - 1];
                    const cur = pts[i];
                    const next = pts[i + 1];
                    if (next) {
                      const dx = cur.x - p1.x;
                      const dy2 = cur.y - p1.y;
                      const nx = next.x - cur.x;
                      const ny = next.y - cur.y;
                      const cr = Math.min(r, Math.abs(dx || dy2) / 2, Math.abs(nx || ny) / 2);
                      const ex = dx !== 0 ? (dx > 0 ? 1 : -1) : 0;
                      const ey = dy2 !== 0 ? (dy2 > 0 ? 1 : -1) : 0;
                      const fx2 = nx !== 0 ? (nx > 0 ? 1 : -1) : 0;
                      const fy2 = ny !== 0 ? (ny > 0 ? 1 : -1) : 0;
                      d += ` L ${cur.x - ex * cr} ${cur.y - ey * cr} Q ${cur.x} ${cur.y} ${cur.x + fx2 * cr} ${cur.y + fy2 * cr}`;
                    } else {
                      d += ` L ${cur.x} ${cur.y}`;
                    }
                  }
                  return d;
                };

                if (cableCount === "multi") {
                  // No preview in phase 1 (sources not yet confirmed)
                  if (!multiSrcConfirmed) return null;
                  // Phase 2: sources confirmed → preview all selected src ports
                  const srcIndices =
                    multiSrcPorts && multiSrcPorts.slotId === drawingFrom.slotId
                      ? multiSrcPorts.portIndices
                      : [drawingFrom.portIndex];

                  // Build dst candidates from snap target
                  let dstIndices: (number | undefined)[] = srcIndices.map(() => undefined);
                  if (snapTarget) {
                    const dstPorts = slotPorts.get(snapTarget.slotId) ?? [];
                    const firstDst = dstPorts.find((p) => p.portIndex === snapTarget.portIndex);
                    if (firstDst) {
                      const dstSide = firstDst.side;
                      const dstSidePorts = dstPorts
                        .filter((p) => p.side === dstSide)
                        .sort((a, b) => a.portIndex - b.portIndex);
                      const startI = dstSidePorts.findIndex(
                        (p) => p.portIndex === snapTarget.portIndex,
                      );
                      // Aperçu = ports consécutifs réellement câblés (pas de
                      // filtre par type de connecteur).
                      dstIndices = srcIndices.map((_, i) => dstSidePorts[startI + i]?.portIndex);
                    }
                  }

                  return (
                    <>
                      {srcIndices.map((pi, i) => {
                        const portCenter = getPortCenter(drawingFrom.slotId, pi);
                        if (!portCenter) return null;
                        let tx = destX;
                        let ty = destY + i * PORT_H;
                        let ts = destSide;
                        if (dstIndices[i] !== undefined) {
                          const dc = getPortCenter(snapTarget!.slotId, dstIndices[i]!);
                          if (dc) {
                            tx = dc.x;
                            ty = dc.y;
                            ts = dc.side;
                          }
                        }
                        // In multipoint mode: only show preview once at least one waypoint is confirmed
                        const path =
                          cableMode === "multipoint" && multiSrcConfirmed
                            ? buildMultipointPath(portCenter.x, portCenter.y, tx, ty, from.y)
                            : makePath(portCenter.x, portCenter.y, tx, ty, portCenter.side, ts);
                        return (
                          <path
                            key={pi}
                            d={path}
                            fill="none"
                            stroke={color}
                            strokeWidth={1.5}
                            strokeDasharray="6 3"
                            opacity={Math.max(0.25, 0.85 - i * 0.08)}
                          />
                        );
                      })}
                      {/* Waypoint dots in multipoint phase 2 */}
                      {cableMode === "multipoint" &&
                        multiSrcConfirmed &&
                        drawingWaypoints.map((wp, i) => (
                          <circle key={i} cx={wp.x} cy={wp.y} r={4} fill={color} opacity={0.8} />
                        ))}
                    </>
                  );
                }

                if (cableMode === "multipoint") {
                  const previewD = buildMultipointPath(from.x, from.y, destX, destY, from.y);
                  const lastWp =
                    drawingWaypoints.length > 0
                      ? drawingWaypoints[drawingWaypoints.length - 1]
                      : { x: from.x, y: from.y };
                  const segEnd =
                    drawingDirection === "H"
                      ? { x: destX, y: lastWp.y }
                      : { x: lastWp.x, y: destY };
                  return (
                    <>
                      <path
                        d={previewD}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        strokeDasharray="6 3"
                        opacity={0.9}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {drawingWaypoints.map((wp, i) => (
                        <circle key={i} cx={wp.x} cy={wp.y} r={4} fill={color} opacity={0.8} />
                      ))}
                      <circle
                        cx={segEnd.x}
                        cy={segEnd.y}
                        r={3}
                        fill="none"
                        stroke={color}
                        strokeWidth={1.5}
                        opacity={0.6}
                      />
                    </>
                  );
                }

                const path = makePathWithWaypoints(
                  from.x,
                  from.y,
                  from.side,
                  destX,
                  destY,
                  destSide,
                  drawingWaypoints,
                );
                return (
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeDasharray={snapCenter ? "none" : "6 3"}
                    opacity={0.9}
                  />
                );
              })()}
          </svg>

          {/* SVG orange line — zIndex:1, above cables; node port dots (zIndex:2, no stacking context) appear above */}
          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            style={{ zIndex: 1 }}
            width={SVG_W}
            height={SVG_H}
          >
            {resolvedConnections.map((conn) => {
              if (hiddenLayerIds.has(conn.id)) return null;
              if (selectedConnId !== conn.id) return null;
              const from = getPortCenter(conn.fromSlotId, conn.fromConnectorIndex);
              const to = getPortCenter(conn.toSlotId, conn.toConnectorIndex);
              if (!from || !to) return null;
              const S = "#f97316";
              return (
                <g key={conn.id}>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={S}
                    strokeWidth={3}
                    strokeLinecap="round"
                    opacity={0.35}
                  />
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={S}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    opacity={0.9}
                    style={{ filter: `drop-shadow(0 0 4px ${S})` }}
                  />
                  <circle cx={from.x} cy={from.y} r={4} fill={S} opacity={0.8} />
                  <circle cx={to.x} cy={to.y} r={4} fill={S} opacity={0.8} />
                </g>
              );
            })}
          </svg>

          {/* ── SVG layer : Adaptateurs synoptique ── */}
          {adapters.length > 0 && (
            <svg
              data-scene-layer="over"
              className="pointer-events-none absolute inset-0 overflow-visible"
              style={{ zIndex: 4 }}
              width={SVG_W}
              height={SVG_H}
            >
              {adapters.map((ad) => {
                if (hiddenLayerIds.has(ad.id)) return null;
                // Si l'adaptateur est attaché à un port d'équipement, on dérive sa
                // position en live depuis la position du slot pour qu'il SUIVE
                // l'équipement quand il est déplacé.
                let live = ad;
                const isRebinding = adapterDrag?.mode === "rebind" && adapterDrag.id === ad.id;
                const FIRST_PORT_Y = 14 + 4 + 28 / 2; // = 32
                const ADAPTER_W = 130;
                if (isRebinding && adapterDrag.cursor) {
                  // Pendant le rebind : si snap, position adapter sur le port snap.
                  // Sinon, position centrée sur le curseur (anchor row au centre).
                  const snap = adapterDrag.snap;
                  if (snap) {
                    const portCenter = getPortCenterRef.current?.(snap.slotId, snap.portIndex);
                    if (portCenter) {
                      const x = snap.side === "right" ? portCenter.x : portCenter.x - ADAPTER_W;
                      const y = portCenter.y - FIRST_PORT_Y;
                      live = { ...ad, x, y };
                    }
                  } else {
                    // Aucun snap : le port d'origine (anchor) suit le curseur
                    const originSide = adapterDrag.originalAttachedSide ?? ad.attachedSide;
                    // attachedSide === "right" → anchor sur bord GAUCHE de l'adaptateur (x = cursor.x)
                    // attachedSide === "left"  → anchor sur bord DROIT de l'adaptateur (x = cursor.x - W)
                    const x =
                      originSide === "right"
                        ? adapterDrag.cursor.x
                        : adapterDrag.cursor.x - ADAPTER_W;
                    const y = adapterDrag.cursor.y - FIRST_PORT_Y;
                    live = { ...ad, x, y };
                  }
                } else if (ad.attachedSlotId && ad.attachedPortIndex != null) {
                  const portCenter = getPortCenterRef.current?.(
                    ad.attachedSlotId,
                    ad.attachedPortIndex,
                  );
                  if (portCenter) {
                    const x =
                      ad.attachedSide === "right"
                        ? portCenter.x // attaché à un OUT eqp → adapter à droite, anchor gauche aligné
                        : portCenter.x - ADAPTER_W; // attaché à un IN eqp → adapter à gauche, anchor droit aligné
                    const y = portCenter.y - FIRST_PORT_Y;
                    live = { ...ad, x, y };
                  }
                }
                // Si attaché côté IN équipement → mirroir adapter (anchor à droite, fan-out à gauche)
                // Pendant rebind : utiliser le snap.side en preview, sinon attachedSide actuel.
                const effectiveAttachedSide =
                  isRebinding && adapterDrag.snap ? adapterDrag.snap.side : ad.attachedSide;
                const flipped = effectiveAttachedSide === "left";
                const adapterLocked = lockedLayerIds.has(ad.id);
                return (
                  <g
                    key={ad.id}
                    data-adapter="true"
                    style={{ pointerEvents: "auto" }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      selectOnly("adapter", ad.id);
                      setContextMenu({ x: e.clientX, y: e.clientY, type: "adapter", id: ad.id });
                    }}
                  >
                    {adapterLocked &&
                      (() => {
                        const inv = 1 / Math.max(0.1, zoom);
                        const ICON = 14;
                        // X : centré horizontalement (même colonne que précédemment).
                        // Y : aligné sur le milieu du premier port (ADAPTER_TITLE_H + PAD + PORT_H/2 = 32).
                        const anchorX = live.x + 65 - (ICON / 2) * inv;
                        const anchorY = live.y + 32 - (ICON / 2) * inv;
                        return (
                          <g
                            pointerEvents="none"
                            opacity={0.55}
                            transform={`translate(${anchorX}, ${anchorY}) scale(${inv})`}
                          >
                            <rect
                              width={ICON}
                              height={ICON}
                              rx={2}
                              fill="#ffffff"
                              stroke="#374151"
                              strokeWidth={1}
                            />
                            <rect x={3.5} y={7} width={7} height={5} rx={1} fill="#374151" />
                            <path
                              d="M 4.5 7 V 5.5 A 2.5 2.5 0 0 1 9.5 5.5 V 7"
                              fill="none"
                              stroke="#374151"
                              strokeWidth={1.2}
                            />
                          </g>
                        );
                      })()}
                    <SynopticAdapterNode
                      adapter={live}
                      selected={selectedAdapterId === ad.id}
                      ctMap={connectorTypeMap}
                      cursor={tool === "move" ? "move" : "default"}
                      onPointerDown={(e) => handleAdapterPointerDown(ad.id, e)}
                      onPortDown={(side, portIndex) => {
                        // Relais vers le flow câble standard avec virtual slotId
                        handlePortClickFromDom(adapterVirtualSlotId(ad.id, side), portIndex);
                      }}
                      isAttached={!!ad.attachedSlotId}
                      flipped={flipped}
                      drawingFromCtId={(() => {
                        if (!drawingFrom) return null;
                        const ad = parseAdapterSlotId(drawingFrom.slotId);
                        if (ad) {
                          const adp = adapters.find((a) => a.id === ad.adapterId);
                          if (!adp) return null;
                          const entries =
                            ad.side === "left"
                              ? (adp.adapter.inputs ?? [])
                              : (adp.adapter.outputs ?? []);
                          // Si flipped (attaché à gauche eqp), inputs/outputs visuels sont inversés
                          const visual =
                            adp.attachedSide === "left"
                              ? ad.side === "left"
                                ? (adp.adapter.outputs ?? [])
                                : (adp.adapter.inputs ?? [])
                              : entries;
                          // Find connectorTypeId for the portIndex
                          let flat = 0;
                          for (const e of visual) {
                            const qty = e.quantity ?? 1;
                            if (drawingFrom.portIndex < flat + qty)
                              return e.connectorTypeId ?? null;
                            flat += qty;
                          }
                          return null;
                        }
                        const port = slotPorts
                          .get(drawingFrom.slotId)
                          ?.find((p) => p.portIndex === drawingFrom.portIndex);
                        return port?.entry.connectorTypeId ?? null;
                      })()}
                      getIncompatMsg={(side, portIndex) => {
                        if (!drawingFrom) return null;
                        // Multi phase 1 (sélection de la plage source) : pas de tooltip tant que les 2 extrémités ne sont pas confirmées
                        if (multiSrcPorts && !multiSrcConfirmed) return null;
                        const srcPort =
                          getPortsForSlotOrAdapter(drawingFrom.slotId).find(
                            (p) => p.portIndex === drawingFrom.portIndex,
                          ) ?? null;
                        if (!srcPort) return null;
                        const virtSlotId = adapterVirtualSlotId(ad.id, side);
                        const dstPort = getPortsForSlotOrAdapter(virtSlotId).find(
                          (p) => p.portIndex === portIndex,
                        );
                        if (!dstPort) return null;
                        const isOcc = isPortOccupied(virtSlotId, portIndex);
                        return incompatReason(
                          srcPort,
                          dstPort,
                          virtSlotId,
                          panelPortDirs,
                          isOcc,
                          ipSignalNames,
                        );
                      }}
                      multiSelectedPorts={(() => {
                        if (
                          !multiSrcPorts ||
                          (multiSrcPorts.slotId !== adapterVirtualSlotId(ad.id, "left") &&
                            multiSrcPorts.slotId !== adapterVirtualSlotId(ad.id, "right"))
                        )
                          return null;
                        const side = multiSrcPorts.slotId.endsWith(":left") ? "left" : "right";
                        const set = new Set<string>();
                        multiSrcPorts.portIndices.forEach((pi) => set.add(`${side}:${pi}`));
                        return set;
                      })()}
                      multiCompatPorts={(() => {
                        if (!multiSrcConfirmed || !multiSrcPorts) return null;
                        const leftVid = adapterVirtualSlotId(ad.id, "left");
                        const rightVid = adapterVirtualSlotId(ad.id, "right");
                        const compat = compatibleTargets.get(leftVid);
                        const compat2 = compatibleTargets.get(rightVid);
                        if (!compat && !compat2) return null;
                        const set = new Set<string>();
                        compat?.forEach((pi) => set.add(`left:${pi}`));
                        compat2?.forEach((pi) => set.add(`right:${pi}`));
                        return set.size > 0 ? set : null;
                      })()}
                      onIncompatHover={(msg, x, y) =>
                        setIncompatTooltipRef.current(
                          msg && x != null && y != null ? { msg, x, y } : null,
                        )
                      }
                      cableToolActive={tool === "cable" || tool === "adapter" || tool === "external"}
                    />
                  </g>
                );
              })}
              {/* Snap indicator pendant rebind d'adaptateur */}
              {adapterDrag?.mode === "rebind" &&
                adapterDrag.snap &&
                (() => {
                  const c = getPortCenterRef.current?.(
                    adapterDrag.snap.slotId,
                    adapterDrag.snap.portIndex,
                  );
                  if (!c) return null;
                  // arkyo-server: habillage Strata (accroche incompatible / compatible : --danger / --success)
                  const color = adapterDrag.snapIncompat ? "var(--danger)" : "var(--success)";
                  return (
                    <g>
                      <circle cx={c.x} cy={c.y} r={9} fill={color} opacity={0.35} />
                      <circle cx={c.x} cy={c.y} r={5} fill={color} />
                    </g>
                  );
                })()}
            </svg>
          )}

          {/* ── SVG layer : Sortie externe (outil "Connexions externe") ── */}
          {externalPorts.length > 0 && (
            <svg
              data-scene-layer="over"
              className="absolute inset-0 overflow-visible"
              style={{ zIndex: 4, pointerEvents: "none" }}
              width={SVG_W}
              height={SVG_H}
            >
              {externalPorts.map((ext) => {
                if (hiddenLayerIds.has(ext.id)) return null;
                // Virtualiser pour matcher la layout (port panel virtuel vs port équipement).
                const virt = realToVirtual(ext.slotId, ext.portIndex, activeSlots);
                const center = getPortCenterRef.current?.(virt.slotId, virt.portIndex);
                if (!center) return null;
                // Position fixe : la bulle suit toujours le port à OFFSET px,
                // côté = côté du port. La longueur du trait est constante,
                // et la bulle suit l'équipement quand il se déplace.
                // Note : on ne dessine plus de cercle SVG à l'origine — le port
                // dot HTML de l'équipement est rempli (cf. SynopticNode).
                const OFFSET = 200;
                const ly = center.y;
                // Bulle = "à quoi le port est rattaché" (rack + équipement +
                // connecteur cible, résolu serveur via ProjectConnection).
                // Le label câble (numérotation) est affiché ailleurs, près du
                // port, comme pour les câbles internes.
                // Contenu + largeur : MONDE → étiquette libre + badge EXT ;
                // INTER_LIEU → cible résolue ou « Non rattaché ».
                const bubble = externalBubble(ext);
                const text = bubble.text;
                const BOX_W = bubble.width;
                const BOX_H = 18;
                const RX = 6;
                // La bulle est ancrée par son BORD intérieur (pas centre) pour
                // grandir vers l'extérieur sans empiéter sur le rack.
                const lx =
                  center.side === "left"
                    ? center.x - OFFSET - BOX_W / 2
                    : center.x + OFFSET + BOX_W / 2;
                // Le trait part du port jusqu'au bord proche de la bulle.
                const boxLeft = lx - BOX_W / 2;
                const boxRight = lx + BOX_W / 2;
                const lineX2 = center.side === "left" ? boxRight : boxLeft;
                // Couleur — récupère le connecteur du port (couleur signal/ct).
                const ports = slotPorts.get(virt.slotId) ?? [];
                const portInfo = ports.find((p) => p.portIndex === virt.portIndex);
                const portColor = portInfo?.ct?.color ?? "var(--accent)";
                const isSelected =
                  selectedExternalId === ext.id ||
                  selectedExternalIds.has(ext.id) ||
                  previewExternalIds.has(ext.id);
                const startExternalDrag = (e: React.PointerEvent) => {
                  // Mode erase : suppression immédiate.
                  if (toolRef.current === "erase") {
                    e.nativeEvent.stopImmediatePropagation();
                    e.stopPropagation();
                    setExternalPorts((prev) => prev.filter((e2) => e2.id !== ext.id));
                    deleteExternalPortApi(ext.id);
                    return;
                  }
                  e.nativeEvent.stopImmediatePropagation();
                  e.stopPropagation();
                  // Shift/Cmd → délègue à handleExtSelect (multi-select).
                  // Pas de drag dans ce cas.
                  if (e.shiftKey || e.metaKey || e.ctrlKey) {
                    handleExtSelect(e);
                    return;
                  }
                  const el = containerRef.current;
                  if (!el) return;
                  const startClientX = e.clientX;
                  const startClientY = e.clientY;
                  let moved = false;
                  // Trackera le port cible si snap atteint pendant le drag.
                  let snapTargetPort: {
                    slotId: string;
                    portIndex: number;
                  } | null = null;
                  const SNAP_RADIUS = 60; // px (espace canvas) — généreux pour faciliter le drop
                  // Seuil de drag : 6px pour absorber le micro-jitter au clic
                  // simple. En dessous, on traite comme un clic (sélection).
                  const DRAG_THRESHOLD = 6;
                  const onMove = (ev: PointerEvent) => {
                    if (
                      !moved &&
                      (Math.abs(ev.clientX - startClientX) > DRAG_THRESHOLD ||
                        Math.abs(ev.clientY - startClientY) > DRAG_THRESHOLD)
                    ) {
                      moved = true;
                    }
                    if (!moved) return;
                    const r2 = el.getBoundingClientRect();
                    const { pan: p2, zoom: z2 } = viewRef.current;
                    const cx2 = (ev.clientX - r2.left - p2.x) / z2;
                    const cy2 = (ev.clientY - r2.top - p2.y) / z2;
                    // Hit-test : cherche le port libre le plus proche du curseur.
                    let bestPort: typeof snapTargetPort = null;
                    let bestDist = SNAP_RADIUS;
                    for (const [sid, plist] of slotPorts.entries()) {
                      // Pas de snap sur un port adaptateur.
                      if (parseAdapterSlotId(sid)) continue;
                      for (const port of plist) {
                        const pc = getPortCenterRef.current?.(sid, port.portIndex);
                        if (!pc) continue;
                        const dx = pc.x - cx2;
                        const dy = pc.y - cy2;
                        const d = Math.sqrt(dx * dx + dy * dy);
                        if (d > bestDist) continue;
                        // Convertir vers réel pour exclure le port courant + les déjà occupés.
                        const real = virtualToReal(sid, port.portIndex, activeSlots);
                        if (
                          real.slotId === ext.slotId &&
                          real.portIndex === ext.portIndex
                        )
                          continue;
                        if (isPortOccupied(sid, port.portIndex)) continue;
                        if (
                          externalPorts.some(
                            (e2) =>
                              e2.id !== ext.id &&
                              e2.slotId === real.slotId &&
                              e2.portIndex === real.portIndex,
                          )
                        )
                          continue;
                        bestDist = d;
                        bestPort = { slotId: sid, portIndex: port.portIndex };
                      }
                    }
                    snapTargetPort = bestPort;
                    if (bestPort) {
                      // Preview : on mute slotId/portIndex pour que la bulle
                      // saute visuellement sur le nouveau port (lx/ly recalcul auto).
                      setExternalPorts((prev) =>
                        prev.map((e2) =>
                          e2.id === ext.id
                            ? {
                                ...e2,
                                slotId: bestPort!.slotId,
                                portIndex: bestPort!.portIndex,
                              }
                            : e2,
                        ),
                      );
                    } else {
                      // Pas de snap : on rétablit le port d'origine pour le preview.
                      setExternalPorts((prev) =>
                        prev.map((e2) =>
                          e2.id === ext.id
                            ? { ...e2, slotId: ext.slotId, portIndex: ext.portIndex }
                            : e2,
                        ),
                      );
                    }
                  };
                  const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    if (!moved) {
                      // Clic simple sans drag → sélection mono.
                      // (Shift/Cmd est traité en amont, avant le drag.)
                      selectOnly("external", ext.id);
                      return;
                    }
                    if (snapTargetPort) {
                      // Persiste le changement de port (slotId/portIndex).
                      // labelX/labelY restent null (position dérivée du port à chaque render).
                      const real = virtualToReal(
                        snapTargetPort.slotId,
                        snapTargetPort.portIndex,
                        activeSlots,
                      );
                      updateExternalPortApi(ext.id, {
                        slotId: real.slotId,
                        portIndex: real.portIndex,
                        labelX: null,
                        labelY: null,
                      });
                    }
                    // Si pas de snap → on n'a rien changé côté DB (preview rétabli à l'origine).
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp, { once: true });
                };
                const onBoxPointerDown = (e: React.PointerEvent) => {
                  if (toolRef.current === "erase") {
                    e.nativeEvent.stopImmediatePropagation();
                    e.stopPropagation();
                    setExternalPorts((prev) => prev.filter((e2) => e2.id !== ext.id));
                    deleteExternalPortApi(ext.id);
                    return;
                  }
                  startExternalDrag(e);
                };
                // Handler unifié : sélection au pointerdown (mouseup gère mal
                // les clicks sur SVG <rect>/<line>). Shift/Cmd multi-select +
                // mode erase + sélection mono. Pattern stable sans drag.
                const handleExtSelect = (e: React.PointerEvent | React.MouseEvent) => {
                  e.stopPropagation();
                  if (e.nativeEvent && "stopImmediatePropagation" in e.nativeEvent) {
                    (e.nativeEvent as Event).stopImmediatePropagation();
                  }
                  if (tool === "move") return;
                  if (tool === "erase") {
                    setExternalPorts((prev) =>
                      prev.filter((e2) => e2.id !== ext.id),
                    );
                    deleteExternalPortApi(ext.id);
                    return;
                  }
                  if (e.metaKey || e.ctrlKey || e.shiftKey) {
                    const already =
                      selectedExternalIds.has(ext.id) || selectedExternalId === ext.id;
                    setSelectedExternalIds((prev) => {
                      const seed =
                        prev.size > 0
                          ? prev
                          : selectedExternalId
                            ? new Set([selectedExternalId])
                            : new Set<string>();
                      const next = new Set(seed);
                      if (e.shiftKey && !(e.metaKey || e.ctrlKey)) {
                        next.add(ext.id);
                      } else {
                        if (next.has(ext.id)) next.delete(ext.id);
                        else next.add(ext.id);
                      }
                      return next;
                    });
                    setSelectedZoneId(null);
                    setSelectedZoneIds(new Set());
                    setSelectedLabelId(null);
                    setSelectedLabelIds(new Set());
                    setSelectedAdapterId(null);
                    setSelectedNodeId(null);
                    setSelectedConnId(null);
                    setSelectedConnIds(new Set());
                    const isShiftOnly = e.shiftKey && !(e.metaKey || e.ctrlKey);
                    if (!isShiftOnly && already && selectedExternalId === ext.id)
                      setSelectedExternalId(null);
                    else setSelectedExternalId(ext.id);
                    return;
                  }
                  selectOnly("external", ext.id);
                };
                const extClickProps = {
                  "data-external-port": "true" as const,
                  style: {
                    pointerEvents: "all" as const,
                    cursor: "pointer" as const,
                  },
                  onPointerDown: handleExtSelect,
                };
                return (
                  <g
                    key={ext.id}
                    data-external-port="true"
                    data-external-id={ext.id}
                  >
                    {/* Halo de sélection unifié — pattern aligné sur les
                        câbles internes : path/line accent en dessous avec
                        strokeWidth élevé et opacité réduite. Visible sur le
                        trait ET la bulle. */}
                    {isSelected && (
                      <>
                        <line
                          x1={center.x}
                          y1={center.y}
                          x2={lineX2}
                          y2={ly}
                          stroke="var(--accent)"
                          strokeWidth={6}
                          strokeOpacity={0.35}
                          strokeLinecap="round"
                          style={{ pointerEvents: "none" }}
                        />
                        <rect
                          x={boxLeft - 2}
                          y={ly - BOX_H / 2 - 2}
                          width={BOX_W + 4}
                          height={BOX_H + 4}
                          rx={RX + 2}
                          ry={RX + 2}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth={6}
                          strokeOpacity={0.35}
                          strokeLinejoin="round"
                          style={{ pointerEvents: "none" }}
                        />
                      </>
                    )}
                    {/* Trait horizontal port → bulle (couleur connecteur).
                        Affichage seulement — la sélection passe par la <line>
                        de hit ci-dessous (strokeWidth large, transparent). */}
                    <line
                      x1={center.x}
                      y1={center.y}
                      x2={lineX2}
                      y2={ly}
                      stroke={portColor}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      opacity={0.9}
                      style={{ pointerEvents: "none" }}
                    />
                    {/* Hit-zone CLIQUABLE du trait — ligne transparente épaisse
                        avec pointerEvents="stroke" pour capture sur la stroke. */}
                    <line
                      data-external-port="true"
                      x1={center.x}
                      y1={center.y}
                      x2={lineX2}
                      y2={ly}
                      stroke="rgba(0,0,0,0)"
                      strokeWidth={20}
                      strokeLinecap="round"
                      style={{
                        pointerEvents: "stroke" as const,
                        cursor: "pointer" as const,
                      }}
                      onPointerDown={handleExtSelect}
                    />
                    {/* Plus de cercle SVG à l'origine — le port dot HTML de
                        l'équipement (cf. SynopticNode) est rempli en couleur
                        connecteur via la prop `externalPortKeys`.
                        Zone de hit invisible autour du port pour permettre la
                        saisie/drag — radius 12 (un peu plus que le dot). */}
                    <circle
                      cx={center.x}
                      cy={center.y}
                      r={12}
                      fill="transparent"
                      style={{
                        pointerEvents: "all",
                        cursor: toolRef.current === "erase" ? "not-allowed" : "move",
                      }}
                      onPointerDown={onBoxPointerDown}
                    />
                    {/* Bulle rectangle arrondi (couleur connecteur) : cible
                        résolue (inter-emplacements) ou étiquette libre +
                        badge EXT (lien externe). Cliquable (cable-like) —
                        pattern aligné EXACTEMENT sur les câbles : pas de
                        onPointerDown, juste les extClickProps. Le clic en mode
                        erase reste pris en charge via l'extClickProps. */}
                    <rect
                      x={boxLeft}
                      y={ly - BOX_H / 2}
                      width={BOX_W}
                      height={BOX_H}
                      rx={RX}
                      ry={RX}
                      fill={`color-mix(in srgb, ${portColor} ${bubble.isWorld ? 18 : 12}%, var(--card))`}
                      stroke={portColor}
                      // « Lien externe » = destination assumée hors projet →
                      // bordure pleine plus marquée. Inter-emplacements garde
                      // le trait fin actuel.
                      strokeWidth={bubble.isWorld ? 1.75 : 1.25}
                      opacity={0.95}
                      {...extClickProps}
                    />
                    {bubble.isWorld && (
                      <>
                        <rect
                          x={boxLeft + 5}
                          y={ly - 6}
                          width={22}
                          height={12}
                          rx={3}
                          ry={3}
                          fill={`color-mix(in srgb, ${portColor} 30%, var(--card))`}
                          style={{ pointerEvents: "none" }}
                        />
                        <text
                          x={boxLeft + 16}
                          y={ly}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={7}
                          fontWeight={700}
                          letterSpacing={0.5}
                          fontFamily="var(--font-mono)"
                          fill={portColor}
                          style={{ userSelect: "none", pointerEvents: "none" }}
                        >
                          EXT
                        </text>
                      </>
                    )}
                    <text
                      x={lx + bubble.badgeW / 2}
                      y={ly}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={10}
                      fontFamily="var(--font-mono)"
                      fontStyle={bubble.isPlaceholder ? "italic" : "normal"}
                      fill={bubble.isPlaceholder ? "var(--muted-foreground)" : portColor}
                      style={{ userSelect: "none", pointerEvents: "none" }}
                    >
                      {text}
                    </text>
                    {/* Label câble — placé près du port équipement (pas au
                        milieu du trait), même style que les câbles internes :
                        nom connecteur (BNC, XLR…) à côté du port + numéro
                        câble (priorité au label GENERAL si disponible). */}
                    {(() => {
                      // Sur un port MONDE, `label` porte l'étiquette de la
                      // bulle — surtout pas le numéro de câble.
                      const cableLabel = bubble.isWorld
                        ? (ext.targetCableLabel?.trim() ?? "")
                        : ext.label?.trim() || ext.targetCableLabel?.trim() || "";
                      const hasLabel = cableLabel.length > 0;
                      const connectorName = portInfo?.ct?.name ?? "";
                      const onLeft = center.side === "left";
                      // Décalage horizontal côté trait (vers la bulle).
                      const fromOx = onLeft ? -8 : 8;
                      const fromAnchor: "start" | "end" = onLeft ? "end" : "start";
                      return (
                        <text
                          x={center.x + fromOx}
                          y={center.y - 5}
                          textAnchor={fromAnchor}
                          fontSize={8}
                          fontFamily="system-ui"
                          style={{ userSelect: "none", pointerEvents: "none" }}
                        >
                          {fromAnchor === "end" ? (
                            <>
                              <tspan
                                fontWeight={hasLabel ? 600 : 400}
                                fontStyle={hasLabel ? "normal" : "italic"}
                                fill={hasLabel ? portColor : "#9ca3af"}
                              >
                                {hasLabel ? cableLabel : "—"}
                              </tspan>
                              {connectorName && (
                                <tspan dx={8} style={{ fill: "var(--muted-foreground)" }}>
                                  {connectorName}
                                </tspan>
                              )}
                            </>
                          ) : (
                            <>
                              {connectorName && (
                                <tspan style={{ fill: "var(--muted-foreground)" }}>
                                  {connectorName}
                                </tspan>
                              )}
                              <tspan
                                dx={connectorName ? 8 : 0}
                                fontWeight={hasLabel ? 600 : 400}
                                fontStyle={hasLabel ? "normal" : "italic"}
                                fill={hasLabel ? portColor : "#9ca3af"}
                              >
                                {hasLabel ? cableLabel : "—"}
                              </tspan>
                            </>
                          )}
                        </text>
                      );
                    })()}
                  </g>
                );
              })}
            </svg>
          )}

          {/* SVG overlay — drawn ABOVE nodes: animation dots */}
          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            style={{ zIndex: 5 }}
            width={SVG_W}
            height={SVG_H}
          >
            {resolvedConnections.map((conn) => {
              if (hiddenLayerIds.has(conn.id)) return null;
              if (selectedConnId !== conn.id) return null;
              const isArrow = (connStyles.get(conn.id) ?? cableStyle) === "arrow";
              const from = getPortCenter(conn.fromSlotId, conn.fromConnectorIndex);
              const to = getPortCenter(conn.toSlotId, conn.toConnectorIndex);
              if (!from || !to) return null;
              const fromPort = getPortsForSlotOrAdapter(conn.fromSlotId).find(
                (p) => p.portIndex === conn.fromConnectorIndex,
              );
              const toPort = getPortsForSlotOrAdapter(conn.toSlotId).find(
                (p) => p.portIndex === conn.toConnectorIndex,
              );
              // Arrow-style: only render the straight selection line (animation is in first pass)
              if (isArrow) {
                const STRAIGHT = "#f97316";
                return (
                  <g key={conn.id}>
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={STRAIGHT}
                      strokeWidth={3}
                      strokeLinecap="round"
                      opacity={0.35}
                    />
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={STRAIGHT}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      opacity={0.9}
                      style={{ filter: `drop-shadow(0 0 4px ${STRAIGHT})` }}
                    />
                    <circle cx={from.x} cy={from.y} r={4} fill={STRAIGHT} opacity={0.8} />
                    <circle cx={to.x} cy={to.y} r={4} fill={STRAIGHT} opacity={0.8} />
                  </g>
                );
              }
              // Couleur câble : signal résolu prioritaire (fallback toPort
              // pour les ports switching/transit) avant connecteur.
              const sigNameRen =
                fromPort?.entry.signalName ?? toPort?.entry.signalName ?? null;
              const sigColorRen = sigNameRen ? sigColorByName[sigNameRen] : undefined;
              const color =
                conn.color ??
                sigColorRen ??
                fromPort?.ct?.color ??
                toPort?.ct?.color ??
                "#6366f1";
              const wpts = connWaypoints.get(conn.id) ?? [];
              const animBypassY = bypassYMap.get(conn.id);
              const laneOffset = cableLaneOffsets.get(conn.id) ?? 0;
              const path = makePathWithWaypoints(
                from.x,
                from.y,
                from.side,
                to.x,
                to.y,
                to.side,
                wpts,
                undefined,
                animBypassY,
                laneOffset,
                conn.fromSlotId,
                conn.toSlotId,
              );
              const revPath = makePathWithWaypoints(
                to.x,
                to.y,
                to.side,
                from.x,
                from.y,
                from.side,
                [...wpts].reverse(),
                undefined,
                animBypassY,
              );
              // Detect real BIDIR (not panel ports) — check the slot itself, not entry.face
              const fromSlot2 = expandedSlots.find((s) => s.id === conn.fromSlotId);
              const toSlot2 = expandedSlots.find((s) => s.id === conn.toSlotId);
              const fromIsPanel2 = !!fromSlot2?.panel;
              const toIsPanel2 = !!toSlot2?.panel;
              const fromDirRaw2 = fromPort?.entry.direction?.toUpperCase();
              const toDirRaw2 = toPort?.entry.direction?.toUpperCase();
              const isBidir2 =
                (!fromIsPanel2 && (fromDirRaw2 === "BIDIR" || fromDirRaw2 === "BOTH")) ||
                (!toIsPanel2 && (toDirRaw2 === "BIDIR" || toDirRaw2 === "BOTH"));
              const isReversed2 = !isBidir2 && fromDirRaw2 === "IN";
              const fwdPath = isReversed2 ? revPath : path;
              // Constant speed: compute real path length through all points (port stubs included)
              const EXIT_LEN = 40;
              const ex1pt = {
                x: from.x + (from.side === "right" ? EXIT_LEN : -EXIT_LEN),
                y: from.y,
              };
              const ex2pt = { x: to.x + (to.side === "left" ? -EXIT_LEN : EXIT_LEN), y: to.y };
              const allPtsLen = [
                { x: from.x, y: from.y },
                ex1pt,
                ...wpts,
                ex2pt,
                { x: to.x, y: to.y },
              ];
              const pathLen = allPtsLen.reduce((acc, pt, i) => {
                if (i === 0) return 0;
                return (
                  acc + Math.abs(pt.x - allPtsLen[i - 1].x) + Math.abs(pt.y - allPtsLen[i - 1].y)
                );
              }, 0);
              const dur2 = `${Math.max(0.5, pathLen / 400).toFixed(2)}s`;
              return (
                <g key={conn.id}>
                  {/* Signal dot — forward */}
                  <circle
                    r={6}
                    fill={color}
                    opacity={0.95}
                    style={{
                      filter: `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 10px ${color})`,
                    }}
                  >
                    <animateMotion
                      dur={dur2}
                      repeatCount="indefinite"
                      path={fwdPath}
                      rotate="auto"
                    />
                  </circle>
                  {/* Second dot — reverse direction, only for real BIDIR ports */}
                  {isBidir2 && (
                    <circle
                      r={6}
                      fill={color}
                      opacity={0.95}
                      style={{
                        filter: `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 10px ${color})`,
                      }}
                    >
                      <animateMotion
                        dur={dur2}
                        repeatCount="indefinite"
                        path={revPath}
                        rotate="auto"
                      />
                    </circle>
                  )}

                  {/* ── Segment drag handles ── */}
                  {(() => {
                    const EXIT = 40;
                    const ex1 = { x: from.x + (from.side === "right" ? EXIT : -EXIT), y: from.y };
                    const ex2 = { x: to.x + (to.side === "left" ? -EXIT : EXIT), y: to.y };

                    // For cables with no waypoints: compute the natural mid-segment point
                    const allPts: { x: number; y: number }[] =
                      wpts.length > 0
                        ? [{ x: from.x, y: from.y }, ex1, ...wpts, ex2, { x: to.x, y: to.y }]
                        : (() => {
                            const gap = Math.max(Math.abs(to.x - from.x) * 0.4, 50);
                            const fx = from.side === "right" ? gap : -gap;
                            const tx = to.side === "left" ? -gap : gap;
                            const mx = (from.x + fx + (to.x + tx)) / 2;
                            return [
                              { x: from.x, y: from.y },
                              { x: from.x + fx, y: from.y },
                              { x: mx, y: from.y },
                              { x: mx, y: to.y },
                              { x: to.x + tx, y: to.y },
                              { x: to.x, y: to.y },
                            ];
                          })();

                    const handles: { segIdx: number; mx: number; my: number; isH: boolean }[] = [];
                    // Segments 2..allPts.length-4 — skip port stubs AND first/last arm segments
                    for (let i = 2; i < allPts.length - 3; i++) {
                      const p1 = allPts[i];
                      const p2 = allPts[i + 1];
                      const isH = Math.abs(p2.y - p1.y) < 0.5;
                      const isV = Math.abs(p2.x - p1.x) < 0.5;
                      if (!isH && !isV) continue;
                      const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                      if (segLen < 20) continue; // too short
                      handles.push({
                        segIdx: i,
                        mx: (p1.x + p2.x) / 2,
                        my: (p1.y + p2.y) / 2,
                        isH,
                      });
                    }

                    return handles.map(({ segIdx, mx: hx, my: hy, isH }) => (
                      <g
                        key={segIdx}
                        data-cable="true"
                        style={{ pointerEvents: "all", cursor: isH ? "ns-resize" : "ew-resize" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          pushHistoryRef.current?.();
                          const currentWpts = connWaypoints.get(conn.id) ?? [];
                          // For no-waypoint cables, synthesize 2 waypoints from the natural mid-segment
                          const initWpts =
                            currentWpts.length > 0
                              ? [...currentWpts]
                              : [
                                  { x: allPts[2].x, y: allPts[2].y },
                                  { x: allPts[3].x, y: allPts[3].y },
                                ];
                          segHandleDragRef.current = {
                            connId: conn.id,
                            segIdx,
                            isH,
                            startClient: isH ? e.clientY : e.clientX,
                            originalWaypoints: initWpts,
                          };
                          const onMove = (ev: PointerEvent) => {
                            const drag = segHandleDragRef.current;
                            if (!drag || drag.connId !== conn.id) return;
                            const rawDelta =
                              ((isH ? ev.clientY : ev.clientX) - drag.startClient) /
                              viewRef.current.zoom;
                            const snapS = useTopbarActions.getState();
                            const newWpts = drag.originalWaypoints.map((wp, wi) => {
                              const isStart = wi === segIdx - 2;
                              const isEnd = wi === segIdx - 1;
                              if (!isStart && !isEnd) return wp;
                              if (isH) {
                                const ny = snapS.snapEnabled
                                  ? snapCoord(wp.y + rawDelta, snapS.gridStep)
                                  : wp.y + rawDelta;
                                return { ...wp, y: ny };
                              }
                              const nx = snapS.snapEnabled
                                ? snapCoord(wp.x + rawDelta, snapS.gridStep)
                                : wp.x + rawDelta;
                              return { ...wp, x: nx };
                            });
                            setConnWaypoints((prev) => {
                              const next = new Map(prev);
                              next.set(conn.id, newWpts);
                              return next;
                            });
                          };
                          const onUp = () => {
                            setConnWaypoints((prev) => {
                              const wpts = prev.get(conn.id);
                              if (wpts && wpts.length > 0) {
                                void cabling.patchOne(conn.id, { waypoints: wpts }).catch(console.error);
                              }
                              return prev;
                            });
                            segHandleDragRef.current = null;
                            window.removeEventListener("pointermove", onMove);
                            window.removeEventListener("pointerup", onUp);
                          };
                          window.addEventListener("pointermove", onMove);
                          window.addEventListener("pointerup", onUp, { once: true });
                        }}
                      >
                        {/* Handle body */}
                        <rect
                          x={hx - 7}
                          y={hy - 7}
                          width={14}
                          height={14}
                          rx={3}
                          // arkyo-server: habillage Strata (fond de poignée de sélection : --surface)
                          fill="var(--surface)"
                          stroke={color}
                          strokeWidth={1.5}
                          opacity={0.95}
                          style={{ filter: `drop-shadow(0 1px 3px rgba(0,0,0,0.25))` }}
                        />
                        {/* Direction arrow */}
                        {isH ? (
                          <path
                            d={`M ${hx} ${hy - 3.5} L ${hx} ${hy + 3.5} M ${hx - 2} ${hy - 1.5} L ${hx} ${hy - 3.5} L ${hx + 2} ${hy - 1.5} M ${hx - 2} ${hy + 1.5} L ${hx} ${hy + 3.5} L ${hx + 2} ${hy + 1.5}`}
                            stroke={color}
                            strokeWidth={1.2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        ) : (
                          <path
                            d={`M ${hx - 3.5} ${hy} L ${hx + 3.5} ${hy} M ${hx - 1.5} ${hy - 2} L ${hx - 3.5} ${hy} L ${hx - 1.5} ${hy + 2} M ${hx + 1.5} ${hy - 2} L ${hx + 3.5} ${hy} L ${hx + 1.5} ${hy + 2}`}
                            stroke={color}
                            strokeWidth={1.2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        )}
                      </g>
                    ));
                  })()}
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {expandedSlots.map((slot) => {
            if (isSlotHidden(slot.id)) return null;
            const pos = positions.get(slot.id) ?? { x: 0, y: 0 };
            const ports = slotPorts.get(slot.id) ?? [];
            const connectedPortIndices = new Set([
              ...resolvedConnections.flatMap((c) => {
                const res: number[] = [];
                if (c.fromSlotId === slot.id) res.push(c.fromConnectorIndex);
                if (c.toSlotId === slot.id) res.push(c.toConnectorIndex);
                return res;
              }),
              // Ports occupés par un adaptateur attaché
              ...adapters
                .filter((a) => a.attachedSlotId === slot.id && a.attachedPortIndex != null)
                .map((a) => a.attachedPortIndex as number),
            ]);
            const selectedSrcIndices = (() => {
              if (!multiSrcPorts || multiSrcPorts.slotId !== slot.id) return new Set<number>();
              if (multiSrcConfirmed) return new Set(multiSrcPorts.portIndices);
              const slotPortsList = slotPorts.get(slot.id) ?? [];
              const firstPort = slotPortsList.find(
                (p) => p.portIndex === multiSrcPorts.portIndices[0],
              );
              if (!firstPort) return new Set(multiSrcPorts.portIndices);
              return new Set(
                slotPortsList
                  .filter(
                    (p) =>
                      p.side === firstPort.side &&
                      (p.entry.connectorTypeId ?? null) ===
                        (firstPort.entry.connectorTypeId ?? null) &&
                      (p.entry.signalName ?? null) === (firstPort.entry.signalName ?? null) &&
                      !resolvedConnections.some(
                        (c) =>
                          (c.fromSlotId === slot.id && c.fromConnectorIndex === p.portIndex) ||
                          (c.toSlotId === slot.id && c.toConnectorIndex === p.portIndex),
                      ),
                  )
                  .map((p) => p.portIndex),
              );
            })();
            const compatiblePortIndices = compatibleTargets.get(slot.id) ?? new Set<number>();
            const drawingFromPort = drawingFrom
              ? (getPortsForSlotOrAdapter(drawingFrom.slotId).find(
                  (p) => p.portIndex === drawingFrom.portIndex,
                ) ?? null)
              : null;
            return (
              <div
                key={slot.id}
                data-node="true"
                data-slot-id={slot.id}
                style={{
                  position: "relative",
                  zIndex: draggingNodeId === slot.id ? 100 : undefined,
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  selectOnly("node", slot.id);
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    type: "node" as "cable",
                    id: slot.id,
                  });
                }}
              >
                <SynopticNode
                  slot={slot}
                  x={pos.x}
                  y={pos.y}
                  containerLabel={
                    rackLabels ? (rackLabels[rackFor(slot.id)]?.name ?? null) : null
                  }
                  containerColor={
                    rackLabels
                      ? (rackLabels[rackFor(slot.id)]?.color ?? null)
                      : null
                  }
                  connectorTypes={connectorTypes}
                  ports={ports}
                  isSelected={selectedNodeId === slot.id || selectedNodeIds.has(slot.id)}
                  isPreview={previewNodeIds.has(slot.id)}
                  drawingFrom={drawingFrom}
                  snapTarget={snapTarget}
                  connectedPortIndices={connectedPortIndices}
                  selectedSrcIndices={selectedSrcIndices}
                  compatiblePortIndices={compatiblePortIndices}
                  multiSnapIndices={multiSnapTargetsMap.get(slot.id) ?? new Set()}
                  multiSrcConfirmed={multiSrcConfirmed}
                  drawingFromPort={drawingFromPort}
                  panelPortDirs={panelPortDirs}
                  canDrag={tool === "move" || tool === "select"}
                  onSelect={(e) => {
                    // Shift / Cmd / Ctrl → toggle dans le set multi sans
                    // toucher aux autres types de sélection. selectedNodeId
                    // suit le dernier cliqué (pour le panneau de propriétés
                    // single). Click simple → selectOnly classique (clear le
                    // reste, sélection mono).
                    const additive = !!(e && (e.shiftKey || e.metaKey || e.ctrlKey));
                    if (additive) {
                      // Clear les autres types pour éviter une sélection mixte
                      // (les sets multi non-node restent dans leur état actuel
                      // via setSelectedNodeIds — pas de side-effect).
                      setSelectedConnId(null);
                      setSelectedConnIds(new Set());
                      setSelectedAdapterId(null);
                      setSelectedZoneId(null);
                      setSelectedZoneIds(new Set());
                      setSelectedLabelId(null);
                      setSelectedLabelIds(new Set());
                      setSelectedExternalId(null);
                      setSelectedExternalIds(new Set());
                      setSelectedNodeIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(slot.id)) next.delete(slot.id);
                        else next.add(slot.id);
                        return next;
                      });
                      // selectedNodeId = dernier cliqué (pour le panneau prop).
                      setSelectedNodeId(slot.id);
                    } else {
                      selectOnly("node", slot.id);
                    }
                  }}
                  onDragStart={(e) => handleNodeDragStart(slot.id, e)}
                  onPortClick={handlePortClickFromDom}
                  onPortRef={() => {}}
                  portExtras={slotAdapterExtras.get(slot.id)?.marginsByPortIdx}
                  extraNodeHeight={slotAdapterExtras.get(slot.id)?.extraNodeHeight ?? 0}
                  externalPortIndices={externalPortsBySlot.get(slot.id)}
                  ipSignalNames={ipSignalNames}
                  onIncompatHover={(msg, x, y) =>
                    setIncompatTooltipRef.current(
                      msg && x != null && y != null ? { msg, x, y } : null,
                    )
                  }
                  cableToolActive={tool === "cable" || tool === "adapter" || tool === "external"}
                />
                {/* Badge cadenas discret si équipement/panel verrouillé */}
                {isSlotLocked(slot.id) &&
                  (() => {
                    const inv = 1 / Math.max(0.1, zoom);
                    const size = 14 * inv;
                    return (
                      <div
                        className="pointer-events-none absolute flex items-center justify-center rounded"
                        style={{
                          left: pos.x + 4 * inv,
                          top: pos.y + 4 * inv,
                          width: size,
                          height: size,
                          background: "color-mix(in srgb, var(--surface) 90%, transparent)",
                          border:
                            "1px solid color-mix(in srgb, var(--foreground) 25%, transparent)",
                        }}
                      >
                        <Lock
                          style={{
                            width: size * 0.6,
                            height: size * 0.6,
                            color: "color-mix(in srgb, var(--foreground) 55%, transparent)",
                          }}
                        />
                      </div>
                    );
                  })()}
              </div>
            );
          })}

          {/* ── Endpoint drag hit handles (move tool) — couche au-dessus des nodes HTML ── */}
          {tool === "move" && (
            <svg
              // Couche de PRISE, pas de scène : uniquement des cibles de
              // pointeur. Retirée de toute copie destinée à un rendu.
              data-synoptic-hit
              className="absolute inset-0 overflow-visible"
              style={{ zIndex: 50, pointerEvents: "none" }}
              width={SVG_W}
              height={SVG_H}
            >
              {resolvedConnections.map((conn) => {
                if (hiddenLayerIds.has(conn.id)) return null;
                const from = getPortCenter(conn.fromSlotId, conn.fromConnectorIndex);
                const to = getPortCenter(conn.toSlotId, conn.toConnectorIndex);
                if (!from || !to) return null;
                const isDraggingFrom =
                  endpointDrag?.connId === conn.id && endpointDrag.side === "from";
                const isDraggingTo = endpointDrag?.connId === conn.id && endpointDrag.side === "to";
                return (
                  <g key={`eph-${conn.id}`} style={{ pointerEvents: "auto" }}>
                    {!isDraggingFrom && (
                      <>
                        <circle
                          cx={from.x}
                          cy={from.y}
                          r={12}
                          fill="rgba(0,0,0,0)"
                          style={{ pointerEvents: "all", cursor: "move" }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            e.nativeEvent.stopImmediatePropagation();
                            const el = containerRef.current;
                            el?.setPointerCapture?.(e.pointerId);
                            pushHistoryRef.current?.();
                            setEndpointDrag({
                              connId: conn.id,
                              side: "from",
                              originalSlotId: conn.fromSlotId,
                              originalPortIndex: conn.fromConnectorIndex,
                              cursor: null,
                              snap: null,
                              snapIncompat: false,
                              snapIncompatMsg: null,
                            });
                          }}
                        />
                      </>
                    )}
                    {!isDraggingTo && (
                      <>
                        <circle
                          cx={to.x}
                          cy={to.y}
                          r={12}
                          fill="rgba(0,0,0,0)"
                          style={{ pointerEvents: "all", cursor: "move" }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            e.nativeEvent.stopImmediatePropagation();
                            const el = containerRef.current;
                            el?.setPointerCapture?.(e.pointerId);
                            pushHistoryRef.current?.();
                            setEndpointDrag({
                              connId: conn.id,
                              side: "to",
                              originalSlotId: conn.toSlotId,
                              originalPortIndex: conn.toConnectorIndex,
                              cursor: null,
                              snap: null,
                              snapIncompat: false,
                              snapIncompatMsg: null,
                            });
                          }}
                        />
                      </>
                    )}
                    {endpointDrag?.connId === conn.id &&
                      endpointDrag.cursor &&
                      (() => {
                        const pos = endpointDrag.snap
                          ? getPortCenter(endpointDrag.snap.slotId, endpointDrag.snap.portIndex)
                          : endpointDrag.cursor;
                        if (!pos) return null;
                        const snapping = !!endpointDrag.snap;
                        const incompat = snapping && endpointDrag.snapIncompat;
                        // arkyo-server: habillage Strata (accroche incompatible / compatible : --danger / --success)
                        const snapColor = incompat ? "var(--danger)" : "var(--success)";
                        return (
                          <g style={{ pointerEvents: "none" }}>
                            <circle
                              cx={pos.x}
                              cy={pos.y}
                              r={snapping ? 8 : 5}
                              fill={snapping ? snapColor : "#f97316"}
                              opacity={snapping ? 0.55 : 0.85}
                            />
                            {snapping && (
                              <circle
                                cx={pos.x}
                                cy={pos.y}
                                r={12}
                                fill="none"
                                stroke={snapColor}
                                strokeWidth={1.5}
                                opacity={0.7}
                              />
                            )}
                          </g>
                        );
                      })()}
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* ── Pan overlay: intercepts all pointer events on elements in pan mode ── */}
        {tool === "pan" && (
          <div
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            style={{ zIndex: 9 }}
            onDoubleClick={(e) => {
              // Temporarily hide overlay to hit-test elements underneath
              const overlay = e.currentTarget as HTMLDivElement;
              overlay.style.pointerEvents = "none";
              const under = document.elementFromPoint(e.clientX, e.clientY);
              overlay.style.pointerEvents = "";
              if (!under) return;
              const nodeEl = (under as Element).closest("[data-node]") as HTMLElement | null;
              const zoneEl = (under as Element).closest("[data-zone]") as SVGElement | null;
              const labelEl = (under as Element).closest(
                "[data-canvas-label]",
              ) as SVGElement | null;
              if (!nodeEl && !zoneEl && !labelEl) return;
              setTool("select");
              if (nodeEl) {
                const slotId = nodeEl.dataset.slotId;
                if (slotId) {
                  selectOnly("node", slotId);
                }
              } else if (zoneEl) {
                const zoneId = zoneEl.dataset.zoneId;
                if (zoneId) {
                  selectOnly("zone", zoneId);
                }
              } else if (labelEl) {
                const labelId = labelEl.dataset.labelId;
                if (labelId) {
                  selectOnly("label", labelId);
                }
              }
            }}
          />
        )}

        {/* ── Rubber-band selection overlay (screen-space) ─────────────── */}
        {rubberBand && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: Math.min(rubberBand.x1, rubberBand.x2),
              top: Math.min(rubberBand.y1, rubberBand.y2),
              width: Math.abs(rubberBand.x2 - rubberBand.x1),
              height: Math.abs(rubberBand.y2 - rubberBand.y1),
              border: "1.5px dashed var(--accent)",
              background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              zIndex: 5,
            }}
          />
        )}

        {/* ── Inline label editor (tool === "label" + click empty) ─────────────── */}
        {inlineLabel &&
          (() => {
            // Convert canvas coords (text baseline bottom-left) → screen coords.
            // inlineLabel.{x,y} stores the click point; use it as the baseline origin.
            const screenX = inlineLabel.x * zoom + pan.x;
            const screenY = inlineLabel.y * zoom + pan.y;
            const scaledFontSize = labelFontSize * zoom;
            // Place input so its text baseline roughly aligns with the click point.
            const topPx = screenY - scaledFontSize;
            const commit = () => {
              const raw = inlineLabelRef.current?.text.trim() ?? "";
              const current = inlineLabelRef.current;
              setInlineLabel(null);
              if (!current) return;
              const text = raw || "À modifier…";
              const id = `label-${Date.now()}`;
              const store = useTopbarActions.getState();
              const lbl: CanvasLabel = {
                id,
                text,
                x: current.x,
                y: current.y,
                fontSize: labelFontSize,
                color: labelColor,
                fontWeight: "normal",
                fontFamily: labelFont,
                pill: store.synopticLabelPill,
                pillBg: store.synopticLabelPill ? store.synopticLabelPillBg : null,
                pillRadius: store.synopticLabelPillRadius,
              };
              pushHistoryRef.current?.();
              setCanvasLabels((prev) => [...prev, lbl]);
              createLabelApi(lbl);
            };
            const cancel = () => commit();
            return (
              <input
                data-inline-label-input
                data-toolbar
                ref={inlineLabelInputRef}
                autoFocus
                type="text"
                value={inlineLabel.text}
                onChange={(e) =>
                  setInlineLabel((prev) => (prev ? { ...prev, text: e.target.value } : prev))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancel();
                  }
                }}
                onBlur={(e) => {
                  // Ne commit pas tant que le focus reste dans le conteneur du canvas
                  // ou sur un élément du shell (toolbar, panneau droit). Permet à l'utilisateur
                  // de modifier les options (pillule, police, couleur) sans perdre le label.
                  const next = e.relatedTarget as HTMLElement | null;
                  if (
                    next &&
                    (next.closest("[data-toolbar]") ||
                      next.tagName === "INPUT" ||
                      next.tagName === "BUTTON")
                  ) {
                    // refocus après l'action
                    requestAnimationFrame(() => inlineLabelInputRef.current?.focus());
                    return;
                  }
                  commit();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                placeholder="À modifier…"
                className="absolute m-0 border-0 outline-none"
                style={(() => {
                  const store = useTopbarActions.getState();
                  const pill = store.synopticLabelPill;
                  const pillBg = store.synopticLabelPillBg;
                  const pillRadius = store.synopticLabelPillRadius;
                  // Padding en coord canvas → scaled en écran
                  const PAD_X = pill ? 10 : 2;
                  const PAD_TOP = pill ? 4 : 1;
                  return {
                    left: screenX - PAD_X * zoom,
                    top: topPx - PAD_TOP * zoom,
                    color: labelColor,
                    fontFamily: labelFont,
                    fontSize: scaledFontSize,
                    lineHeight: `${scaledFontSize * 1.2}px`,
                    zIndex: 20,
                    minWidth: Math.max(60, scaledFontSize * 5),
                    caretColor: labelColor,
                    background: pill ? pillBg : "transparent",
                    borderRadius: pill ? pillRadius * zoom : 0,
                    paddingLeft: PAD_X * zoom,
                    paddingRight: PAD_X * zoom,
                    paddingTop: PAD_TOP * zoom,
                    paddingBottom: (pill ? 6 : 3) * zoom,
                  };
                })()}
              />
            );
          })()}

        {/* SynopticToolbar migrée vers le shell (LeftToolbar + topbars contextuelles) */}

        {/* Ancien panneau flottant de sélection câble — remplacé par le panneau droit du shell */}

        {/* ── Infobulle incompatibilité — remplacée par CursorHint (variant error) ── */}
        {/* <SynopticIncompatTooltip incompatTooltip={incompatTooltip} multiHoverTooltip={multiHoverTooltip} /> */}

        {/* ── Drawing hint ─────────────────────────────────────────────── */}
        {/* Remplacé par CursorHint global (shell) */}

        {/* Ancien color picker zone — remplacé par le panneau droit du shell */}

        {/* ── Zone label modal (création + édition) — portal on document.body to avoid container event interference ── */}
        {/* Ancien modal d'édition de zone retiré — édition via le panneau droit uniquement */}

        {/* Dialog PDF rendu maintenant depuis rack-editor en overlay du panneau droit */}

        {/* Ancienne toolbar label — remplacé par le panneau droit du shell */}

        {/* ── Label modal (création + édition) ──────────────────────────── */}
        <SynopticLabelInput
          labelEditing={labelEditing}
          canvasLabels={canvasLabels}
          viewRef={viewRef}
          onConfirm={(labelId, text) => {
            const finalText = text.trim() || "Libellé";
            pushHistoryRef.current?.();
            if (labelId === null && labelEditing?.mode === "create") {
              const newLbl = { ...labelEditing.draft, text: finalText };
              setCanvasLabels((prev) => [...prev, newLbl]);
              createLabelApi(newLbl);
              selectOnly("label", newLbl.id);
            } else if (labelId) {
              setCanvasLabels((prev) => {
                const next = prev.map((l) => (l.id === labelId ? { ...l, text: finalText } : l));
                const updated = next.find((l) => l.id === labelId);
                if (updated) updateLabelApi(updated);
                return next;
              });
            }
            setLabelEditing(null);
          }}
          onCancel={() => setLabelEditing(null)}
        />

        {/* Ancien panneau flottant adapter — remplacé par le panneau droit du shell */}

        {/* ── Adapter picker modal ───────────────────────────────────────── */}
        <SynopticAdapterPicker
          open={adapterPickerOpen}
          context={adapterPickerCtx}
          onCancel={() => {
            setAdapterPickerOpen(false);
            setAdapterPickerCtx(null);
            setAdapterPlaceTarget(null);
          }}
          onPick={handleAdapterPicked}
        />

        {/* Renumérotation rendue maintenant depuis rack-editor en overlay du panneau droit (via onRenumberPanelChange) */}
        {/* Numérotation manuelle idem (via onManualPanelChange) */}

        <SynopticClearLabelsDialog
          open={showClearConfirm}
          onCancel={() => setShowClearConfirm(false)}
          onConfirm={confirmClearLabels}
        />

        {/* ── Dialog choix type de câble (s'ouvre au second clic de pose) ─── */}
        <SynopticCableModelDialog
          open={pendingCableModelDialog !== null}
          signalName={pendingCableModelDialog?.signalName ?? null}
          fromConnectorName={pendingCableModelDialog?.fromConnectorName ?? null}
          toConnectorName={pendingCableModelDialog?.toConnectorName ?? null}
          fromGender={pendingCableModelDialog?.fromGender ?? null}
          toGender={pendingCableModelDialog?.toGender ?? null}
          signalColor={pendingCableModelDialog?.signalColor ?? null}
          signalCategory={pendingCableModelDialog?.signalCategory ?? null}
          defaultModelId={lastCableModelId}
          onSkip={() => setPendingCableModelDialog(null)}
          onConfirm={(cableModelId) => {
            const ids = pendingCableModelDialog?.connIds ?? [];
            setPendingCableModelDialog(null);
            if (cableModelId) setLastCableModelId(cableModelId);
            // Assignation côté state local + PATCH via cabling.patchOne
            // (réutilise le pattern setConnectionCableModel).
            setConnections((prev) =>
              prev.map((c) =>
                ids.includes(c.id)
                  ? ({ ...c, catalogCableModelId: cableModelId } as typeof c)
                  : c,
              ),
            );
            for (const id of ids) {
              cabling
                .patchOne(id, { catalogCableModelId: cableModelId })
                .catch(console.error);
            }
          }}
        />

        <RackEditorConfirmDialog
          {...delConfirmState}
          onCancel={delCancel}
          confirmVariant={delConfirmState.variant}
        />

        <SynopticEmptyInfoDialog
          open={showNoCableInfo}
          title="Aucun câble à numéroter"
          message="Tracez d'abord des câbles entre les équipements du rack avant de lancer la numérotation."
          onClose={() => setShowNoCableInfo(false)}
        />

        <SynopticDecableDialog
          open={showDecableModal}
          connectionCount={connections.length}
          onCancel={() => setShowDecableModal(false)}
          onConfirm={async () => {
            setShowDecableModal(false);
            pushHistoryRef.current?.();
            const ids = connections.map((c) => c.id);
            setConnections([]);
            setConnWaypoints(new Map());
            if (ids.length > 0) {
              try {
                await cabling.deleteBatch(ids);
                pushToast(
                  `${ids.length} câble${ids.length > 1 ? "s" : ""} supprimé${ids.length > 1 ? "s" : ""}`,
                  "success",
                  2500,
                );
              } catch {
                pushToast("Échec du décâblage", "error");
              }
            }
          }}
        />

        {/* Curseurs distants — repère MONDE reconstitué par la même transform
            (translate pan + scale zoom) ; l'overlay applique la contre-échelle
            1/zoom pour une taille écran constante. */}
        <div
          className="pointer-events-none absolute top-0 left-0"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <RemoteCursorsOverlay peers={livePeers} zoom={zoom} />
        </div>

        <SynopticToasts toasts={toasts} />

        {/* Légende — liste des signaux présents sur le rack avec leur couleur.
            Utilise le composant partagé `FloatingLegend` (design carto +
            déplaçable + redimensionnable, position persistée). */}
        {showLegend &&
          (() => {
            const presentSignals = new Map<
              string,
              { name: string; color: string; count: number }
            >();
            for (const conn of connections) {
              // Fallback toPort : un port switching/transit n'a pas de signal
              // propre → on prend celui du pair.
              const fromPorts = getPortsForSlotOrAdapter(conn.fromSlotId);
              const fromP = fromPorts.find((p) => p.portIndex === conn.fromConnectorIndex);
              const toPorts = getPortsForSlotOrAdapter(conn.toSlotId);
              const toP = toPorts.find((p) => p.portIndex === conn.toConnectorIndex);
              const sigName =
                fromP?.entry.signalName ?? toP?.entry.signalName ?? null;
              if (!sigName) continue;
              const sigInfo = (signals ?? []).find((s) => s.name === sigName);
              const color = (conn.color as string | null | undefined) ?? sigInfo?.color ?? "#888";
              const prev = presentSignals.get(sigName);
              if (prev) prev.count++;
              else presentSignals.set(sigName, { name: sigName, color, count: 1 });
            }
            const list = [...presentSignals.values()].sort((a, b) => a.name.localeCompare(b.name));
            return (
              // `synoptic-legend` est un MARQUEUR d'export, pas un style : le
              // rendu vectoriel redessine la légende et a besoin de retrouver
              // sa boîte dans la copie. Une classe et non un `data-*` parce que
              // `FloatingLegend` est un composant partagé, qui n'a pas à
              // connaître nos besoins d'export.
              <FloatingLegend
                className="synoptic-legend"
                onClose={() => setShowLegend(false)}
              >
                {list.length === 0 ? (
                  <p className="text-muted-foreground py-1 text-[10px] italic">
                    Aucun signal câblé pour l&apos;instant.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 py-0.5">
                    {list.map((s) => (
                      <li key={s.name} className="flex items-center gap-2 text-[11px]">
                        <span
                          className="h-2.5 w-2.5 flex-shrink-0 rounded-full ring-1 ring-black/10"
                          style={{ background: s.color }}
                        />
                        <span className="flex-1 truncate" title={s.name}>
                          {s.name}
                        </span>
                        <span
                          className="text-muted-foreground text-[10px]"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {s.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </FloatingLegend>
            );
          })()}

        {/* Mini-map de navigation */}
        {miniMapVisible && (
          <SynopticMiniMap
            nodes={expandedSlots
              .map((s) => {
                const pos = positions.get(s.id);
                if (!pos) return null;
                const ports = slotPorts.get(s.id) ?? [];
                const leftCount = ports.filter((p) => p.side === "left").length;
                const rightCount = ports.filter((p) => p.side === "right").length;
                const nodeW = s.panel ? PANEL_NODE_W : NODE_W;
                const nodeH = Math.max(
                  NODE_MIN_H,
                  NODE_HEADER_H + Math.max(leftCount, rightCount) * PORT_H + 12,
                );
                return { id: s.id, x: pos.x, y: pos.y, w: nodeW, h: nodeH, color: "var(--accent)" };
              })
              .filter(
                (
                  n,
                ): n is { id: string; x: number; y: number; w: number; h: number; color: string } =>
                  n !== null,
              )}
            zones={zones.map((z) => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h, color: z.color }))}
            canvasW={containerRef.current?.clientWidth ?? 800}
            canvasH={containerRef.current?.clientHeight ?? 600}
            pan={pan}
            zoom={zoom}
            onPanChange={(newPan) => {
              viewRef.current = { ...viewRef.current, pan: newPan };
              setPan(newPan);
            }}
            onClose={() => setMiniMapVisible(false)}
          />
        )}

        {contextMenu &&
          (() => {
            const items: FloatingMenuItem[] = [];
            if (contextMenu.type === "cable") {
              const ctxConn = connections.find((c) => c.id === contextMenu.id);
              const ctxBundleId =
                (ctxConn as unknown as { bundleId?: string | null })?.bundleId ?? null;
              const inBundle = !!ctxBundleId;
              const inSelection = selectedConnIds.has(contextMenu.id) && selectedConnIds.size > 1;
              items.push(
                {
                  id: "props",
                  label: "Voir les propriétés",
                  icon: <Eye className="h-3.5 w-3.5" />,
                  onSelect: () => selectOnly("conn", contextMenu.id),
                  separatorAfter: true,
                },
                // Bundle actions
                ...(inSelection
                  ? [
                      {
                        id: "bundle-create",
                        label: `Créer un faisceau (${selectedConnIds.size})`,
                        icon: <Cable className="h-3.5 w-3.5" />,
                        onSelect: async () => {
                          const name = window.prompt("Nom du faisceau :", "Faisceau");
                          if (!name) return;
                          const ids = [...selectedConnIds];
                          const res = await apiFetch(`/api/racks/${rackId}/bundles`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name, cableIds: ids }),
                          });
                          if (res.ok) {
                            const b = await res.json();
                            setBundles((prev) => [
                              ...prev,
                              { id: b.id, name: b.name, color: b.color },
                            ]);
                            setConnections((prev) =>
                              prev.map((c) =>
                                ids.includes(c.id) ? ({ ...c, bundleId: b.id } as typeof c) : c,
                              ),
                            );
                          }
                        },
                        separatorAfter: true,
                      } as const,
                    ]
                  : []),
                ...(inBundle
                  ? [
                      {
                        id: "bundle-remove",
                        label: "Retirer du faisceau",
                        icon: <X className="h-3.5 w-3.5" />,
                        onSelect: async () => {
                          await apiFetch(`/api/racks/${rackId}/bundles/${ctxBundleId}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ removeCableIds: [contextMenu.id] }),
                          });
                          setConnections((prev) =>
                            prev.map((c) =>
                              c.id === contextMenu.id ? ({ ...c, bundleId: null } as typeof c) : c,
                            ),
                          );
                        },
                        separatorAfter: true,
                      } as const,
                    ]
                  : []),
                ...(inSelection
                  ? [
                      {
                        id: "partial-renumber",
                        label: `Renuméroter auto la sélection (${selectedConnIds.size})`,
                        icon: <Hash className="h-3.5 w-3.5" />,
                        onSelect: async () => {
                          const ids = [...selectedConnIds];
                          // Reconstruit sideMap pour la sélection (le côté source = left par défaut)
                          const sideMap: Record<string, "left" | "right"> = {};
                          for (const id of ids) sideMap[id] = "left";
                          pushHistoryRef.current?.();
                          try {
                            const updated = await cabling.renumber({
                              orderedIds: ids,
                              sideMap,
                              partial: true,
                            });
                            setConnections((prev) =>
                              prev.map((c) => {
                                const u = updated.find((x) => x.id === c.id);
                                return u ? { ...c, label: u.label ?? null } : c;
                              }),
                            );
                            pushToast(
                              `${ids.length} câble${ids.length > 1 ? "s" : ""} renuméroté${ids.length > 1 ? "s" : ""}`,
                              "success",
                              2500,
                            );
                          } catch {
                            // silent
                          }
                        },
                        separatorAfter: true,
                      } as const,
                    ]
                  : []),
                {
                  id: "manual-number",
                  label: "Numérotation sélection",
                  icon: <Hash className="h-3.5 w-3.5" />,
                  onSelect: () => handleOpenManualNumber([contextMenu.id]),
                },
                {
                  id: "clear-label",
                  label: "Effacer le numéro",
                  icon: <Eraser className="h-3.5 w-3.5" />,
                  onSelect: () => {
                    pushHistoryRef.current?.();
                    void cabling.renumber({ clearIds: [contextMenu.id] }).catch(() => []);
                    setConnections((prev) =>
                      prev.map((c) => (c.id === contextMenu.id ? { ...c, label: null } : c)),
                    );
                  },
                },
                {
                  id: "reset-path",
                  label: "Réinitialiser le tracé",
                  icon: <Eraser className="h-3.5 w-3.5" />,
                  onSelect: () => {
                    pushHistoryRef.current?.();
                    setConnWaypoints((prev) => {
                      const next = new Map(prev);
                      next.set(contextMenu.id, []);
                      return next;
                    });
                    void cabling.patchOne(contextMenu.id, { waypoints: [] }).catch(console.error);
                  },
                  separatorAfter: true,
                },
                {
                  id: "delete",
                  label: "Supprimer le câble",
                  icon: <Trash2 className="h-3.5 w-3.5" />,
                  onSelect: async () => {
                    const ok = await delConfirm({
                      title: "Supprimer le câble ?",
                      message: "Confirmer la suppression de ce câble.",
                      confirmLabel: "Supprimer",
                      variant: "danger",
                    });
                    if (ok) handleDeleteConnection(contextMenu.id);
                  },
                  danger: true,
                },
              );
            } else if ((contextMenu.type as string) === "node") {
              const nodeConnIds = connections
                .filter((c) => c.fromSlotId === contextMenu.id || c.toSlotId === contextMenu.id)
                .map((c) => c.id);
              items.push(
                {
                  id: "props",
                  label: "Voir les propriétés",
                  icon: <Eye className="h-3.5 w-3.5" />,
                  onSelect: () => selectOnly("node", contextMenu.id),
                  separatorAfter: true,
                },
                {
                  id: "manual-number",
                  label: "Numérotation sélection",
                  icon: <Hash className="h-3.5 w-3.5" />,
                  onSelect: () => handleOpenManualNumber(nodeConnIds, contextMenu.id),
                  disabled: nodeConnIds.length === 0,
                },
              );
            } else if (contextMenu.type === "adapter") {
              items.push(
                {
                  id: "props",
                  label: "Voir les propriétés",
                  icon: <Eye className="h-3.5 w-3.5" />,
                  onSelect: () => selectOnly("adapter", contextMenu.id),
                  separatorAfter: true,
                },
                {
                  id: "delete",
                  label: "Supprimer l'adaptateur",
                  icon: <Trash2 className="h-3.5 w-3.5" />,
                  onSelect: async () => {
                    const ok = await delConfirm({
                      title: "Supprimer l'adaptateur ?",
                      message: "Confirmer la suppression de cet adaptateur.",
                      confirmLabel: "Supprimer",
                      variant: "danger",
                    });
                    if (ok) void handleAdapterDelete(contextMenu.id);
                  },
                  danger: true,
                },
              );
            } else if (contextMenu.type === "zone") {
              items.push(
                {
                  id: "props",
                  label: "Voir les propriétés",
                  icon: <Eye className="h-3.5 w-3.5" />,
                  onSelect: () => selectOnly("zone", contextMenu.id),
                  separatorAfter: true,
                },
                {
                  id: "delete",
                  label: "Supprimer la zone",
                  icon: <Trash2 className="h-3.5 w-3.5" />,
                  onSelect: async () => {
                    const ok = await delConfirm({
                      title: "Supprimer la zone ?",
                      message: "Confirmer la suppression de cette zone.",
                      confirmLabel: "Supprimer",
                      variant: "danger",
                    });
                    if (!ok) return;
                    pushHistoryRef.current?.();
                    setSelectedZoneId(null);
                    deleteZoneApi(contextMenu.id);
                    setZones((prev) => prev.filter((z) => z.id !== contextMenu.id));
                  },
                  danger: true,
                },
              );
            } else if (contextMenu.type === "label") {
              items.push(
                {
                  id: "props",
                  label: "Voir les propriétés",
                  icon: <Eye className="h-3.5 w-3.5" />,
                  onSelect: () => selectOnly("label", contextMenu.id),
                  separatorAfter: true,
                },
                {
                  id: "edit-text",
                  label: "Modifier le texte",
                  icon: <PenLine className="h-3.5 w-3.5" />,
                  onSelect: () => setLabelEditing({ mode: "edit", labelId: contextMenu.id }),
                },
                {
                  id: "delete",
                  label: "Supprimer le label",
                  icon: <Trash2 className="h-3.5 w-3.5" />,
                  onSelect: async () => {
                    const ok = await delConfirm({
                      title: "Supprimer le label ?",
                      message: "Confirmer la suppression de ce label.",
                      confirmLabel: "Supprimer",
                      variant: "danger",
                    });
                    if (!ok) return;
                    pushHistoryRef.current?.();
                    setSelectedLabelId(null);
                    deleteLabelApi(contextMenu.id);
                    setCanvasLabels((prev) => prev.filter((l) => l.id !== contextMenu.id));
                  },
                  danger: true,
                },
              );
            }
            return (
              <FloatingContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                items={items}
                onClose={() => setContextMenu(null)}
              />
            );
          })()}

        {portAdapterMenu && (
          <PortAdapterPicker
            x={portAdapterMenu.x}
            y={portAdapterMenu.y}
            portConnectorTypeId={portAdapterMenu.connectorTypeId}
            portGender={portAdapterMenu.gender}
            portSide={portAdapterMenu.side}
            ctMap={connectorTypes.reduce(
              (acc, ct) => {
                acc[ct.id] = { name: ct.name, color: ct.color };
                return acc;
              },
              {} as Record<string, { name?: string; color?: string | null }>,
            )}
            onPick={async (a) => {
              const body = {
                adapterId: a.id,
                x: 0,
                y: 0,
                attachedSlotId: portAdapterMenu.slotId,
                attachedSide: portAdapterMenu.side,
                attachedPortIndex: portAdapterMenu.portIndex,
              };
              try {
                const res = await apiFetch(
                  `/api/racks/${rackForRef.current(portAdapterMenu.slotId)}/adapters`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  },
                );
                if (res.ok) {
                  const created = (await res.json()) as SynopticAdapterInstance;
                  pushHistoryRef.current?.();
                  setAdapters((prev) =>
                    prev.some((x) => x.id === created.id) ? prev : [...prev, created],
                  );
                }
              } finally {
                setPortAdapterMenu(null);
              }
            }}
            onClose={() => setPortAdapterMenu(null)}
          />
        )}
      </div>
    </CanvasContextMenu>
  );
});
