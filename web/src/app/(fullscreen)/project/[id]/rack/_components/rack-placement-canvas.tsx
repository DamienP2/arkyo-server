"use client";

/**
 * RackPlacementCanvas — version onglet Rack du projet (placement physique).
 *
 * Composant extrait du gros `rack-editor.tsx` : il porte UNIQUEMENT le
 * canvas de placement (pan/zoom, vues FRONT/REAR/REAR_INTERIOR/SIDE,
 * drag&drop équipements/panels/accessoires). Il ne porte PAS :
 *  - le synoptique / les zones / les labels / les connexions
 *  - les workspace contexts (`useWorkspace`, `useTopbarActions`)
 *  - les raccourcis clavier globaux du shell
 *  - les adapters / construction / orphan / portLabel
 *
 * Le DndContext est fourni par le parent (`RackTabClient`) — ce composant
 * consomme uniquement `useDroppable` / `useDraggable` via les
 * sous-composants `RackVisual`, `SideRackVisual`, `Draggable*`.
 *
 * Le parent expose les handlers DnD via le `RackPlacementCanvasHandle`
 * (forwardRef + useImperativeHandle).
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import type { Equipment } from "@/components/synoptique/lib/types";
import { GripVertical } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

import { RackVisual } from "@/app/(app)/rigs/[id]/rack/[rackId]/_components/rack-visual";
import { SideRackVisual } from "@/app/(app)/rigs/[id]/rack/[rackId]/_components/side-rack-visual";
import { CategoryLegend } from "./category-legend";
import { ToastStack } from "@/app/(app)/rigs/[id]/rack/[rackId]/_components/toast-stack";
import {
  DragOverlaySlot,
  DragOverlayShelfItem,
} from "@/app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-items";
import { sortByChildOrder } from "@/app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-slot";
import { RackEditorConfirmDialog } from "@/app/(app)/rigs/[id]/rack/[rackId]/_components/rack-editor-confirm-dialog";
import {
  CanvasContextMenu,
  type CanvasMenuItem,
} from "@/components/editor-shell/canvas-context-menu";

import { useToasts } from "@/components/synoptique/hooks/use-toasts";
import { useRackSync } from "@/components/synoptique/hooks/use-rack-sync";
import { useConfirm } from "@/components/synoptique/hooks/use-confirm";
import { useLiveCursors } from "@/components/synoptique/hooks/use-live-cursors";
import { RemoteCursorsOverlay } from "@/components/synoptique/components/remote-cursors-overlay";
import { apiFetch } from "@/lib/client-id";

import type {
  AccessoryType,
  ActiveItem,
  PanelItem,
  Rack,
  Slot,
  ViewId,
  WidthFraction,
} from "@/components/synoptique/lib/types";
import {
  FRONT_OUTER_W,
  RACK_BODY_W,
  PLAQUE_STYLES,
  RACK_DEPTH_DEFAULT,
  RACK_WIDTH_MM,
  SIDE_PANEL_W,
  U_HEIGHT_PX,
  VIEWS,
  rackBodyHeight,
} from "@/components/synoptique/lib/constants";
import { CategoryColorCtx } from "@/components/synoptique/lib/colors";
import {
  colsCollide,
  findFreeColForWf,
  findValidStartUNear,
} from "@/components/synoptique/lib/collision";

// Échelle px/mm réelle, partagée entre la vue avant et la vue côté. Dérivée de
// la largeur HORS-TOUT (FRONT_OUTER_W ↔ RACK_WIDTH_MM) : garantit que la vue
// côté reste proportionnelle à la réalité (profondeur réelle vs largeur 19").
const PX_PER_MM = FRONT_OUTER_W / RACK_WIDTH_MM;

// ── Types ─────────────────────────────────────────────────────────────────────

type CategoryWithChildren = {
  id: string;
  name: string;
  color: string;
  children: { id: string; name: string; color: string }[];
};

/**
 * Message unique du dépôt raté d'un équipement non rackable — mêmes mots quel
 * que soit l'affichage (contenant ou emplacement).
 */
const SHELF_ONLY_MISS_MESSAGE = "Cet équipement se pose sur une étagère.";

/** Refus d'un dépôt venu d'un autre contenant — même phrase partout. */
function foreignToastMessage(rackName: string | null): string {
  return rackName
    ? `Cet élément appartient à « ${rackName} ».`
    : "Cet élément appartient à un autre contenant.";
}

export type RackPlacementCanvasHandle = {
  /** Contenant piloté par ce canvas — routage DnD en affichage multi-rack. */
  rackId: string;
  /** `true` si ce canvas porte le slot demandé (étagère, slot déplacé…). */
  ownsSlot: (slotId: string) => boolean;
  /** Délégué par le DndContext parent à `onDragStart`. */
  handleDragStart: (e: DragStartEvent) => void;
  /** Délégué par le DndContext parent à `onDragOver`. */
  handleDragOver: (e: DragOverEvent) => void;
  /** Délégué par le DndContext parent à `onDragEnd`. */
  handleDragEnd: (e: DragEndEvent) => Promise<void>;
  /**
   * Abandonne le drag en cours SANS rien placer — appelé sur les canvases non
   * ciblés d'un affichage multi-rack, pour qu'ils nettoient ghost et hover.
   */
  cancelDrag: () => void;
  /**
   * Signale un dépôt raté d'un élément « étagère seulement » (équipement non
   * rackable) quand AUCUN contenant n'a été ciblé — en affichage multi-rack,
   * `handleDragEnd` n'est alors appelé sur personne, donc le message doit être
   * demandé explicitement par le DndContext parent.
   *
   * Renvoie `true` si CE contenant a affiché le message (curseur au-dessus de
   * lui) : le parent s'arrête là, un seul message pour tout l'affichage.
   */
  notifyShelfOnlyMiss: () => boolean;
  /**
   * Vide la sélection locale sans notifier le parent — rend la sélection
   * exclusive entre les colonnes d'un affichage multi-rack.
   */
  clearSelection: () => void;
  /** Recadre le contenu pour qu'il rentre dans la viewport courante. */
  fitAll: () => void;
  /** Centre le contenu sans changer le zoom. */
  centerContent: () => void;
  /** Incrémente le zoom (clamp max 2). */
  zoomIn: () => void;
  /** Décrémente le zoom (clamp min = zoom de fitAll). */
  zoomOut: () => void;
};

export type RackPlacementCanvasProps = {
  rack: Rack;
  initialSlots: Slot[];
  allEquipment: Equipment[];
  allPanels: PanelItem[];
  rackAccessories: Equipment[];
  categories: CategoryWithChildren[];
  patchPanelDepthMm: number;
  cableSafetyDepthMm: number;
  /** Vues visibles (FRONT/REAR/REAR_INTERIOR). SIDE est toujours rendue. */
  visibleViews: ViewId[];
  /** Mode d'affichage : `real` = représentation 1:1 ; `schema` = ascii info. */
  viewMode: "real" | "schema";
  /**
   * Mode de rendu des ÉQUIPEMENTS rackés :
   *  - "standard" : box couleur + nom (défaut, inchangé)
   *  - "graphic"  : image du symbole vecto (rackSymbolUrl / rackSymbolRearUrl)
   *  - "photo"    : photo (rackPhotoFrontUrl / rackPhotoRearUrl)
   * Repli sur "standard" par face si l'image manque. Panels/accessoires
   * gardent toujours le rendu standard.
   */
  renderMode?: "standard" | "graphic" | "photo";
  onViewsChange?: (views: ViewId[]) => void;
  /** Notifié au parent quand l'utilisateur sélectionne un slot (pour le right panel). */
  onSlotSelect?: (slot: Slot | null) => void;
  /** Outil canvas courant (controlled). Si fourni, le state local est ignoré. */
  canvasTool?: "select" | "move";
  /** Notifié quand l'outil change (raccourcis clavier, etc.). */
  onCanvasToolChange?: (tool: "select" | "move") => void;
  /**
   * Notifié à chaque changement de slots (placement / déplacement / suppression).
   * Permet au parent de synchroniser la sidebar BOM (calcul `remaining` à jour).
   */
  onSlotsChange?: (slots: Slot[]) => void;
  /**
   * Notifié à chaque changement de zoom canvas (wheel, pinch, zoomIn/zoomOut).
   * Permet à la toolbar parent d'afficher le pourcentage live et de
   * synchroniser son `zoom` prop.
   */
  onZoomChange?: (zoom: number) => void;
  className?: string;
  /**
   * Mode « embarqué » : le canvas ne rend QUE ses colonnes de vues, sans son
   * viewport (pan/zoom), ses raccourcis globaux, sa légende ni ses curseurs
   * distants — ces éléments appartiennent au conteneur parent qui empile
   * plusieurs contenants côte à côte (affichage par emplacement).
   *
   * Toute la mécanique de placement (collisions, étagères, dialog quantité,
   * POST /slots, hover preview, `useRackSync`) reste identique et locale au
   * contenant. Absent ⇒ comportement mono-rack historique, inchangé.
   */
  embedded?: boolean;
  /** Titre de colonne en mode embarqué (nom du contenant). */
  headerLabel?: string;
  /** Zoom du viewport parent — nécessaire au calcul du grab offset. */
  getExternalZoom?: () => number;
  /**
   * Rend le `DragOverlay` partagé. En mode embarqué il doit rester à `false` :
   * le ghost est rendu par le conteneur, HORS de son wrapper transformé.
   */
  renderDragOverlay?: boolean;
  /** Publie l'élément en cours de drag (ghost rendu par le conteneur). */
  onActiveItemChange?: (item: ActiveItem | null) => void;
  /**
   * Rend l'entête de colonne saisissable (mode embarqué) : le conteneur s'en
   * sert pour réordonner les contenants par drag horizontal.
   */
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
  /**
   * Publie la raison d'un dépôt refusé sur CE contenant (`null` = survol
   * valide ou aucune cible). Consommé par le conteneur multi-contenants, qui
   * rend le ghost — et donc l'infobulle « Interdit » qui l'accompagne.
   */
  onDropInvalidChange?: (reason: string | null) => void;
  /**
   * Contenant non éligible à l'élément en cours de drag (affichage par
   * emplacement — l'élément appartient à un AUTRE contenant). Le canvas est
   * alors inerte pour ce drag : aucune cellule droppable n'est montée, aucun
   * survol n'est calculé. Le conteneur l'éteint visuellement en parallèle.
   */
  dropDisabled?: boolean;
};

/**
 * Contenu du ghost de drag (preview qui suit le curseur).
 *
 * Extrait pour être rendu par un conteneur multi-rack HORS de son wrapper
 * `transform: translate() scale()` : un `DragOverlay` monté sous un ancêtre
 * transformé hérite de ce dernier comme bloc conteneur (règle CSS des
 * `position: fixed` sous transform), donc ses coordonnées viewport sont
 * décalées ET remises à l'échelle → ghost très loin du curseur.
 */
export function RackDragOverlayContent({
  active,
  invalidReason,
}: {
  active: ActiveItem | null;
  /** Raison du refus si la cible survolée est invalide (`null` = OK). */
  invalidReason?: string | null;
}) {
  return (
    <div className="relative inline-block">
      {active?.kind === "equipment" && (
        <DragOverlaySlot
          label={active.equipment.name}
          heightU={active.equipment.heightU ?? 1}
          widthFraction={active.wf}
          category={active.equipment.category}
        />
      )}
      {active?.kind === "slot" && (
        <DragOverlaySlot
          label={
            active.slot.label ??
            active.slot.panel?.name ??
            active.slot.equipment?.name ??
            "—"
          }
          heightU={active.slot.heightU ?? 1}
          widthFraction={active.slot.widthFraction}
          category={
            active.slot.panel
              ? "Panels de patch"
              : active.slot.equipment?.category
          }
        />
      )}
      {active?.kind === "panel" && (
        <DragOverlaySlot
          label={active.panel.name}
          heightU={active.panel.heightU}
          widthFraction="FULL"
          category="Panels de patch"
        />
      )}
      {active?.kind === "configured-accessory" && (
        <DragOverlaySlot
          label={`${
            active.accessoryType === "plaque"
              ? "Plaque"
              : active.accessoryType === "etagere"
                ? "Étagère"
                : "Tiroir"
          } ${active.heightU}U`}
          heightU={active.heightU}
          widthFraction="FULL"
          category="Accessoire rack"
        />
      )}
      {active?.kind === "shelf-equipment" && (
        <DragOverlayShelfItem equipment={active.equipment} />
      )}
      {active?.kind === "shelf-child" && active.slot.equipment && (
        <DragOverlayShelfItem equipment={active.slot.equipment} />
      )}
      {/* Badge d'interdiction — rond rouge collé au coin de l'aperçu, sans
          texte (le ghost rouge dans la baie porte déjà l'information de
          position). La raison (`invalidReason`) ne sert plus que de booléen. */}
      {/* Interdit : l'aperçu draggé est « barré » — voile rouge léger + une
          diagonale nette d'un coin à l'autre (signe universel d'interdiction,
          lisible quel que soit le zoom). La raison reste en `title`. */}
      {active && invalidReason && (
        <span
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-md motion-safe:animate-[rack-drop-hint_120ms_ease-out]"
          style={{
            background: "color-mix(in srgb, var(--destructive) 10%, transparent)",
          }}
          title={invalidReason}
        >
          <svg
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
            aria-hidden
          >
            <line
              x1="2"
              y1="98"
              x2="98"
              y2="2"
              stroke="var(--destructive)"
              strokeWidth="3"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              opacity="0.85"
            />
          </svg>
        </span>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export const RackPlacementCanvas = forwardRef<
  RackPlacementCanvasHandle,
  RackPlacementCanvasProps
>(function RackPlacementCanvas(
  {
    rack: initialRack,
    initialSlots,
    // allEquipment / allPanels / rackAccessories ne sont pas consommés par le
    // canvas lui-même (il utilise les slots déjà résolus par le serveur). Ces
    // catalogues sont remontés au parent via `onCanvasDataChange` et lus par
    // la sidebar. On garde les props dans le contrat pour ne pas surcharger
    // l'appelant à les supprimer s'ils en ont besoin plus tard.
    allEquipment: _allEquipment,
    allPanels: _allPanels,
    rackAccessories: _rackAccessories,
    categories,
    patchPanelDepthMm,
    cableSafetyDepthMm,
    visibleViews: visibleViewsProp,
    viewMode,
    renderMode = "standard",
    onSlotSelect,
    onSlotsChange,
    onZoomChange,
    canvasTool: canvasToolProp,
    onCanvasToolChange,
    className,
    embedded = false,
    headerLabel,
    getExternalZoom,
    renderDragOverlay = true,
    onActiveItemChange,
    onHeaderPointerDown,
    onDropInvalidChange,
    dropDisabled = false,
  },
  ref,
) {
  const { confirmState, confirm, cancel } = useConfirm();

  // ── Catégories → couleurs ─────────────────────────────────────────────────
  const catColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const parent of categories ?? []) {
      for (const child of parent.children ?? []) {
        m[child.name] = parent.color;
      }
      m[parent.name] = parent.color;
    }
    return m;
  }, [categories]);

  // ── Sync slots (SSE + initial merge) ──────────────────────────────────────
  const { slots, setSlots, addSlot, registerChildId } = useRackSync(
    initialRack.id,
    initialSlots,
  );

  // Notifie le parent à chaque changement de slots → permet à la sidebar
  // BOM de recalculer `remaining` (instances draggables) en live.
  const onSlotsChangeRef = useRef(onSlotsChange);
  onSlotsChangeRef.current = onSlotsChange;
  useEffect(() => {
    onSlotsChangeRef.current?.(slots);
  }, [slots]);

  // ── State drag & drop ─────────────────────────────────────────────────────
  const [active, setActive] = useState<ActiveItem | null>(null);
  /**
   * Contenant d'origine de l'élément draggé (affichage multi-contenants).
   * Règle métier : un équipement appartient à son contenant — un dépôt dans un
   * AUTRE contenant est refusé, ghost invalide + infobulle explicite.
   */
  const [dragOrigin, setDragOrigin] = useState<{
    rackId: string;
    rackName: string | null;
  } | null>(null);
  const [hoverU, setHoverU] = useState<number | null>(null);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const [hoverView, setHoverView] = useState<ViewId | null>(null);
  /** Étagère de CE contenant actuellement survolée pendant un drag. */
  const [hoverShelfId, setHoverShelfId] = useState<string | null>(null);
  const grabOffsetRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });

  // Publie l'élément draggé au conteneur (ghost rendu hors du transform).
  const onActiveItemChangeRef = useRef(onActiveItemChange);
  onActiveItemChangeRef.current = onActiveItemChange;
  useEffect(() => {
    onActiveItemChangeRef.current?.(active);
  }, [active]);

  // Track pointer during drag (for shelf insert calculation)
  //
  // On en profite pour savoir si le curseur est AU-DESSUS de ce contenant :
  // combiné à l'absence de cellule survolée, c'est le signal « ici, le dépôt
  // échouera » (rails, traverses, inter-colonnes, zone sans cellule) qui
  // alimente l'infobulle d'interdiction.
  const [pointerOverContent, setPointerOverContent] = useState(false);
  useEffect(() => {
    if (!active) {
      setPointerOverContent(false);
      return;
    }
    const handler = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const el = contentRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const inside =
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom;
      setPointerOverContent((prev) => (prev === inside ? prev : inside));
    };
    window.addEventListener("pointermove", handler);
    return () => window.removeEventListener("pointermove", handler);
  }, [active]);
  // Miroir en ref : `handleDragEnd` (mémoïsé) a besoin de la valeur courante
  // pour ne pas notifier un refus depuis un contenant que le curseur a quitté.
  const pointerOverContentRef = useRef(pointerOverContent);
  pointerOverContentRef.current = pointerOverContent;

  // ── Toasts ────────────────────────────────────────────────────────────────
  const { toasts, addToast, removeToast } = useToasts();

  // ── Sélection slot ────────────────────────────────────────────────────────
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(new Set());
  const selectedSlotIdsRef = useRef(selectedSlotIds);
  selectedSlotIdsRef.current = selectedSlotIds;
  const selectedSlotId =
    selectedSlotIds.size === 1 ? [...selectedSlotIds][0] : null;
  const setSelectedSlotId = useCallback(
    (id: string | null) => {
      setSelectedSlotIds(id ? new Set([id]) : new Set());
    },
    [],
  );

  // Notifie le parent quand la sélection change (pour le right panel).
  //
  // ⚠️ Mode embarqué : N canvases partagent LE MÊME `onSlotSelect`. Un canvas
  // qui n'a rien de sélectionné ne doit JAMAIS publier `null` — sinon il écrase
  // la sélection faite dans une autre colonne dès que son propre effet se
  // rejoue (nouvelle identité de `slots` après un refetch SSE, re-render du
  // parent…). On ne publie donc `null` que si CE canvas avait publié une
  // sélection. En mono-rack (CONT), comportement inchangé : le `null` est émis
  // d'office, ce qui purge la sélection au changement de contenant.
  const publishedSelectionRef = useRef(false);
  useEffect(() => {
    if (!onSlotSelect) return;
    if (selectedSlotId) {
      const slot =
        slots.find((s) => s.id === selectedSlotId) ??
        slots.flatMap((s) => s.children ?? []).find((c) => c.id === selectedSlotId) ??
        null;
      publishedSelectionRef.current = true;
      onSlotSelect(slot);
    } else if (!embedded || publishedSelectionRef.current) {
      publishedSelectionRef.current = false;
      onSlotSelect(null);
    }
  }, [selectedSlotId, slots, onSlotSelect, embedded]);

  /**
   * Désélection silencieuse — utilisée par le conteneur multi-rack pour rendre
   * la sélection exclusive entre colonnes. Ne republie PAS `null` (sinon on
   * écraserait la sélection que l'autre colonne vient de poser).
   */
  const clearSelection = useCallback(() => {
    publishedSelectionRef.current = false;
    setSelectedSlotIds(new Set());
  }, []);


  // ── Curseurs live + sélections distantes (Phase 3b) ────────────────────────
  // Salle = "rack:{rackId}", LA MÊME que l'éditeur rack du rig
  // (rack-editor.tsx) : le repère MONDE est identique (même wrapper
  // `translate(pan) scale(zoom)` origine 0,0, même contenu `flex items-start
  // gap-6` avec les mêmes vues) → un participant sur l'éditeur du rig et un
  // participant sur cet onglet projet se voient à travers les deux vues. Le
  // serveur préfixe le tenant ; tout est silencieux si le service WS est absent.
  const {
    peers: livePeers,
    sendCursor: sendLiveCursor,
    sendSelection: sendLiveSelection,
    // Mode embarqué : N canvases sont montés simultanément — on n'ouvre pas N
    // salles de curseurs (`null` désactive le hook).
  } = useLiveCursors(embedded ? null : `rack:${initialRack.id}`);
  const sendLiveCursorRef = useRef(sendLiveCursor);
  sendLiveCursorRef.current = sendLiveCursor;

  // Diffuse la sélection locale (ids de slots) — mêmes ids DB que l'éditeur du
  // rig, donc ses halos de sélection distante (RemoteSelectionHalos) reflètent
  // aussi les sélections faites depuis cet onglet.
  useEffect(() => {
    sendLiveSelection([...selectedSlotIds]);
  }, [selectedSlotIds, sendLiveSelection]);

  // ── Tap-place (sélection sidebar → tap U sur canvas) ──────────────────────
  // L'équipement sélectionné est local au canvas pour ce nouveau flow projet.
  // Pourrait être remonté plus tard à un context si la sidebar a besoin d'y
  // accéder pour highlight l'item sélectionné.
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(
    null,
  );

  // ── Outils canvas (select / move) ─────────────────────────────────────────
  // Controlled si la prop est fournie ; sinon state local.
  const [canvasToolLocal, setCanvasToolLocal] = useState<"select" | "move">(
    "select",
  );
  const canvasTool = canvasToolProp ?? canvasToolLocal;
  const setCanvasTool = (t: "select" | "move") => {
    if (canvasToolProp === undefined) setCanvasToolLocal(t);
    onCanvasToolChange?.(t);
  };

  // ── Vues visibles (alimentées par le parent) ──────────────────────────────
  const visibleViews = useMemo(
    () => new Set<ViewId>(visibleViewsProp),
    [visibleViewsProp],
  );

  // ── Pan + zoom ────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState<number>(1);
  const zoomRef = useRef(1);
  // Zoom minimum dynamique = zoom calculé par `fitAll` à la taille viewport
  // courante. zoomOut ne peut pas descendre en dessous (le rack serait alors
  // plus petit que "ajusté", ce qui n'a pas de sens UX).
  const fitZoomRef = useRef<number>(0.2);
  const [panOffset, setPanOffset] = useState({ x: 60, y: 60 });
  const panRef = useRef({ active: false, x: 0, y: 0, ox: 60, oy: 60 });
  const [panActive, setPanActive] = useState(false);
  const prefsRestoredRef = useRef(false);

  // Notifie le parent à chaque changement de zoom (wheel, pinch, fitAll,
  // zoomIn/zoomOut). La toolbar projet utilise cette prop pour afficher le
  // pourcentage live.
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  useEffect(() => {
    onZoomChangeRef.current?.(zoom);
  }, [zoom]);

  // Rubber band selection
  const [rubberBand, setRubberBand] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const rubberBandRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
  }>({ startX: 0, startY: 0, active: false });

  // Refs DOM
  const rackContainerRef = useRef<HTMLDivElement>(null);

  // ── Persistance localStorage : `project-rack-prefs-${rackId}` ────────────
  // Clé séparée du rack-editor classique (`rack-prefs-${id}`) pour éviter de
  // mélanger les préférences entre les deux contextes.
  const storageKey = `project-rack-prefs-${initialRack.id}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const prefs = JSON.parse(raw) as {
        zoom?: number;
        pan?: { x: number; y: number };
      };
      if (prefs.zoom != null && isFinite(prefs.zoom)) {
        setZoom(prefs.zoom);
        zoomRef.current = prefs.zoom;
        prefsRestoredRef.current = true;
      }
      if (prefs.pan && isFinite(prefs.pan.x) && isFinite(prefs.pan.y)) {
        setPanOffset(prefs.pan);
        panRef.current.ox = prefs.pan.x;
        panRef.current.oy = prefs.pan.y;
        prefsRestoredRef.current = true;
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistance auto (debounce 150ms)
  useEffect(() => {
    if (embedded) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ zoom, pan: panOffset }),
        );
      } catch {
        /* ignore */
      }
    }, 150);
    return () => clearTimeout(t);
  }, [storageKey, zoom, panOffset, embedded]);

  // ── Pan + zoom canvas infini ──────────────────────────────────────────────
  // En mode embarqué, le viewport (donc pan/zoom/rubber-band) appartient au
  // conteneur parent : aucun listener ici.
  useEffect(() => {
    if (embedded) return;
    const el = rackContainerRef.current;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-slot]")) return;
      if (canvasTool === "move") {
        setSelectedSlotIds(new Set());
        panRef.current = {
          active: true,
          x: e.clientX,
          y: e.clientY,
          ox: panRef.current.ox,
          oy: panRef.current.oy,
        };
        setPanActive(true);
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else {
        // Select tool — start rubber band
        const rect = el.getBoundingClientRect();
        rubberBandRef.current = {
          startX: e.clientX - rect.left,
          startY: e.clientY - rect.top,
          active: true,
        };
        setRubberBand({
          x1: e.clientX - rect.left,
          y1: e.clientY - rect.top,
          x2: e.clientX - rect.left,
          y2: e.clientY - rect.top,
        });
      }
    };

    const onMove = (e: PointerEvent) => {
      if (panRef.current.active) {
        const nx = panRef.current.ox + (e.clientX - panRef.current.x);
        const ny = panRef.current.oy + (e.clientY - panRef.current.y);
        panRef.current.ox = nx;
        panRef.current.oy = ny;
        panRef.current.x = e.clientX;
        panRef.current.y = e.clientY;
        setPanOffset({ x: nx, y: ny });
      } else if (rubberBandRef.current.active) {
        const rect = el.getBoundingClientRect();
        setRubberBand((rb) =>
          rb
            ? { ...rb, x2: e.clientX - rect.left, y2: e.clientY - rect.top }
            : null,
        );
      }
    };

    const onUp = (e: PointerEvent) => {
      if (panRef.current.active) {
        panRef.current.active = false;
        setPanActive(false);
      } else if (rubberBandRef.current.active) {
        rubberBandRef.current.active = false;
        const rect = el.getBoundingClientRect();
        const { startX, startY } = rubberBandRef.current;
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;
        const selL = Math.min(startX, endX);
        const selR = Math.max(startX, endX);
        const selT = Math.min(startY, endY);
        const selB = Math.max(startY, endY);
        if (selR - selL > 4 || selB - selT > 4) {
          const newSel = new Set<string>();
          el.querySelectorAll("[data-slot-id]").forEach((slotEl) => {
            const r = slotEl.getBoundingClientRect();
            const eL = r.left - rect.left;
            const eR = r.right - rect.left;
            const eT = r.top - rect.top;
            const eB = r.bottom - rect.top;
            if (eR > selL && eL < selR && eB > selT && eT < selB) {
              const id = (slotEl as HTMLElement).dataset.slotId;
              if (id) newSel.add(id);
            }
          });
          setSelectedSlotIds(newSel);
        } else {
          setSelectedSlotIds(new Set());
        }
        setRubberBand(null);
      }
    };

    // Zoom centré sur le curseur. Bornes alignées sur les boutons toolbar :
    // max 2 (200 %), min = `fitZoomRef.current` (zoom de fitAll à la taille
    // viewport courante). Empêche un zoom out plus petit que l'ajustement.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const z = zoomRef.current;
      const px = panRef.current.ox;
      const py = panRef.current.oy;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newZ = Math.min(2, Math.max(fitZoomRef.current, z * factor));
      if (newZ === z) return;
      const ratio = newZ / z;
      const nx = mx - (mx - px) * ratio;
      const ny = my - (my - py) * ratio;
      panRef.current.ox = nx;
      panRef.current.oy = ny;
      zoomRef.current = newZ;
      setZoom(newZ);
      setPanOffset({ x: nx, y: ny });
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", () => {
      panRef.current.active = false;
      rubberBandRef.current.active = false;
      setPanActive(false);
      setRubberBand(null);
    });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasTool, embedded]);

  // ── Diffusion curseur live (coords MONDE) ─────────────────────────────────
  // Même transformation que le drag : world = (screen - rect - pan) / zoom.
  // Le repère est identique à celui de l'éditeur rack du rig (salle partagée).
  // Throttle 33 Hz intégré au hook.
  useEffect(() => {
    if (embedded) return;
    const el = rackContainerRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const z = zoomRef.current || 1;
      const wx = (e.clientX - rect.left - panRef.current.ox) / z;
      const wy = (e.clientY - rect.top - panRef.current.oy) / z;
      sendLiveCursorRef.current(wx, wy);
    };
    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, [embedded]);

  // Pinch touch zoom
  useEffect(() => {
    if (embedded) return;
    const el = rackContainerRef.current;
    if (!el) return;
    let initDist = 0;
    let initZoom = 1;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initDist = Math.hypot(dx, dy);
        initZoom = zoom;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / initDist;
        // Bornes alignées sur la molette + boutons : max 2, min = fitZoom.
        const next = Math.min(
          2,
          Math.max(fitZoomRef.current, initZoom * ratio),
        );
        zoomRef.current = next;
        setZoom(next);
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [zoom, embedded]);

  // ── Raccourcis clavier locaux : S/H/Esc/Delete ────────────────────────────
  // (Le raccourcis "tools" globaux du shell ne s'appliquent pas ici — on
  // garde un set minimal directement utile au canvas.)
  useEffect(() => {
    // En mode embarqué, N canvases sont montés : le parent porte les
    // raccourcis (sinon N dialogs de suppression pour une seule touche).
    if (embedded) return;
    const onKey = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      )
        return;
      if (e.key === "s" || e.key === "S") setCanvasTool("select");
      if (e.key === "h" || e.key === "H") setCanvasTool("move");
      if (e.key === " ") {
        e.preventDefault();
        setCanvasTool("move");
      }
      if (e.key === "Escape") {
        setSelectedSlotIds(new Set());
        setSelectedEquipment(null);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const ids = [...selectedSlotIdsRef.current];
        if (ids.length === 0) return;
        e.preventDefault();
        const ok = await confirm({
          title: "Retirer de la baie ?",
          message:
            ids.length > 1
              ? `Confirmer la suppression de ${ids.length} éléments sélectionnés.`
              : "Confirmer la suppression de cet élément.",
          confirmLabel: "Retirer",
          variant: "danger",
        });
        if (!ok) return;
        await Promise.all(
          ids.map((id) =>
            apiFetch(`/api/racks/${initialRack.id}/slots/${id}`, {
              method: "DELETE",
            }),
          ),
        );
        setSelectedSlotIds(new Set());
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setCanvasTool("select");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm, initialRack.id, embedded]);

  // ── Dimensions calculées ──────────────────────────────────────────────────
  // Largeur vue de côté = depthMm × (FRONT_OUTER_W / RACK_WIDTH_MM) × SIDE_VIEW_SCALE.
  // La vue côté reste proportionnelle à la réalité (même échelle px/mm que la
  // vue avant) mais réduite d'un facteur SIDE_VIEW_SCALE pour ne pas dominer
  // l'écran : la vue avant porte l'information principale (slots U), la vue
  // côté est un complément visuel pour la profondeur. Plancher à 60 px.
  const SIDE_VIEW_SCALE = 0.55;
  const sideInnerW = Math.max(
    60,
    Math.round(
      (initialRack.depthMm ?? RACK_DEPTH_DEFAULT) * PX_PER_MM * SIDE_VIEW_SCALE,
    ),
  );
  const sideTotalW = SIDE_PANEL_W * 2 + sideInnerW;

  // Ref sur le wrapper de contenu pour mesurer la taille réelle après render.
  // Plus précis que le calcul manuel (qui sous-estimait à cause des marges
  // de SIDE et autres paddings).
  const contentRef = useRef<HTMLDivElement>(null);

  const computeContentDims = useCallback(() => {
    // Mesure DOM réelle (scrollWidth/Height = taille intrinsèque sans scale).
    const el = contentRef.current;
    if (el) {
      return { cw: el.scrollWidth, ch: el.scrollHeight };
    }
    // Fallback estimation si pas encore monté (premier render).
    const fc = [...visibleViews].filter((v) => v !== "SIDE").length;
    const hasSide = visibleViews.has("SIDE");
    const depthMm = initialRack.depthMm ?? RACK_DEPTH_DEFAULT;
    const sideInner = Math.max(
      60,
      Math.round(depthMm * PX_PER_MM * SIDE_VIEW_SCALE),
    );
    const sideTot = SIDE_PANEL_W * 2 + sideInner;
    const fcGap = 24;
    const sideGap = hasSide && fc > 0 ? 32 : 0;
    const cw =
      fc * RACK_BODY_W +
      Math.max(0, fc - 1) * fcGap +
      (hasSide ? sideTot : 0) +
      sideGap;
    // + traverses haut/bas du châssis (cf. rackBodyHeight) + entête de vue.
    const ch = rackBodyHeight(initialRack.totalU) + 80;
    return { cw, ch };
  }, [visibleViews, initialRack.depthMm, initialRack.totalU]);

  const getAvailableSize = useCallback(() => {
    const el = rackContainerRef.current;
    const w = el?.clientWidth ?? window.innerWidth;
    const h = el?.clientHeight ?? window.innerHeight;
    return { w, h };
  }, []);

  const fitAll = useCallback(() => {
    const { cw, ch } = computeContentDims();
    const { w, h } = getAvailableSize();
    const padding = 48;
    const z = Math.min(
      2,
      Math.max(0.2, Math.min((w - padding) / cw, (h - padding) / ch)),
    );
    const zp = parseFloat(z.toFixed(3));
    const nx = (w - cw * zp) / 2;
    const ny = (h - ch * zp) / 2;
    fitZoomRef.current = zp; // borne inférieure pour zoomOut
    zoomRef.current = zp;
    setZoom(zp);
    panRef.current.ox = nx;
    panRef.current.oy = ny;
    setPanOffset({ x: nx, y: ny });
  }, [computeContentDims, getAvailableSize]);

  // ── Zoom imperatif (boutons toolbar) ──────────────────────────────────────
  // Step de 10 %. Max = 2 (200 %). Min = `fitZoomRef.current` (zoom de fitAll
  // à la taille viewport courante) — empêche un zoom out plus petit que
  // l'ajustement, ce qui serait visuellement confusant.
  // Quand un slot est sélectionné, le zoom in re-centre doucement le viewport
  // sur ce slot via une transition CSS (cf. `animatingZoom` state).
  const ZOOM_STEP = 0.1;
  const [animatingZoom, setAnimatingZoom] = useState(false);
  const animatingTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const triggerAnimatedTransition = useCallback(() => {
    setAnimatingZoom(true);
    if (animatingTimerRef.current) clearTimeout(animatingTimerRef.current);
    animatingTimerRef.current = setTimeout(() => setAnimatingZoom(false), 280);
  }, []);

  useEffect(
    () => () => {
      if (animatingTimerRef.current) clearTimeout(animatingTimerRef.current);
    },
    [],
  );

  const zoomIn = useCallback(() => {
    const next = Math.min(
      2,
      parseFloat((zoomRef.current + ZOOM_STEP).toFixed(3)),
    );
    if (next === zoomRef.current) return;

    // Re-centrage doucement sur le slot sélectionné si exactement un slot
    // l'est. La transition CSS sur le wrapper transform donne l'effet
    // "doucement" demandé. Sinon : zoom standard depuis le coin top-left.
    const selectedIds = selectedSlotIdsRef.current;
    const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : null;
    const containerEl = rackContainerRef.current;
    if (selectedId && containerEl) {
      const slotEl = containerEl.querySelector(
        `[data-slot-id="${selectedId}"]`,
      ) as HTMLElement | null;
      if (slotEl) {
        const slotRect = slotEl.getBoundingClientRect();
        const containerRect = containerEl.getBoundingClientRect();
        // Centre du slot dans le viewport (px écran).
        const mx = slotRect.left + slotRect.width / 2 - containerRect.left;
        const my = slotRect.top + slotRect.height / 2 - containerRect.top;
        const z = zoomRef.current;
        const px = panRef.current.ox;
        const py = panRef.current.oy;
        // Coordonnées du centre du slot en repère content (avant zoom).
        const cx = (mx - px) / z;
        const cy = (my - py) / z;
        // Nouveau pan : ramène le slot au centre du viewport au nouveau zoom.
        const nx = containerEl.clientWidth / 2 - cx * next;
        const ny = containerEl.clientHeight / 2 - cy * next;
        panRef.current.ox = nx;
        panRef.current.oy = ny;
        zoomRef.current = next;
        triggerAnimatedTransition();
        setZoom(next);
        setPanOffset({ x: nx, y: ny });
        return;
      }
    }

    zoomRef.current = next;
    setZoom(next);
  }, [triggerAnimatedTransition]);
  const zoomOut = useCallback(() => {
    const minZ = fitZoomRef.current;
    const next = Math.max(
      minZ,
      parseFloat((zoomRef.current - ZOOM_STEP).toFixed(3)),
    );
    if (next === zoomRef.current) return;
    zoomRef.current = next;
    setZoom(next);
  }, []);

  const centerContent = useCallback(() => {
    const { cw, ch } = computeContentDims();
    const { w, h } = getAvailableSize();
    const nx = (w - cw * zoom) / 2;
    const ny = (h - ch * zoom) / 2;
    panRef.current.ox = nx;
    panRef.current.oy = ny;
    setPanOffset({ x: nx, y: ny });
  }, [computeContentDims, getAvailableSize, zoom]);

  // fitAll au mount (sauf si prefs restaurées)
  const fitAllRef = useRef(fitAll);
  fitAllRef.current = fitAll;
  useEffect(() => {
    if (embedded) return; // le viewport (et son fit) appartient au parent
    if (!prefsRestoredRef.current) {
      requestAnimationFrame(() => fitAllRef.current());
    }
    prefsRestoredRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-fit chaque fois que la composition de vues change (toggle FRONT /
  // REAR / REAR_INTERIOR / SIDE). Permet de reorganiser le canvas
  // automatiquement quand l'utilisateur active/désactive une vue.
  const visibleViewsKey = useMemo(
    () => [...visibleViews].sort().join("|"),
    [visibleViews],
  );
  const isInitialMountRef = useRef(true);
  useEffect(() => {
    if (embedded) return;
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return; // au premier render, le fitAll au mount ci-dessus s'en occupe.
    }
    requestAnimationFrame(() => fitAllRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleViewsKey, embedded]);

  // ── Logique placement (depuis rack-editor.tsx ~1183-1965) ────────────────

  const findFreeColumn = useCallback(
    (
      startU: number,
      heightU: number,
      wf: WidthFraction,
      view: ViewId,
      excludeSlotId?: string,
    ): number | null => {
      const viewSlots = slots.filter((s) => s.view === view);
      return findFreeColForWf(startU, heightU, wf, viewSlots, excludeSlotId);
    },
    [slots],
  );

  const placeEquipment = useCallback(
    async (
      equipment: Equipment,
      uIndex: number,
      wf: WidthFraction,
      targetView: ViewId,
      explicitCol?: number,
    ) => {
      const heightU = equipment.heightU ?? 1;
      if (uIndex + heightU - 1 > initialRack.totalU) {
        addToast(`"${equipment.name}" (${heightU}U) dépasse la taille du rack.`);
        return;
      }
      const column =
        explicitCol ?? findFreeColumn(uIndex, heightU, wf, targetView);
      if (column === null) {
        addToast(`Position U${uIndex} déjà occupée pour ce format.`);
        return;
      }
      const res = await apiFetch(`/api/racks/${initialRack.id}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipmentId: equipment.id,
          view: targetView,
          startU: uIndex,
          heightU,
          widthFraction: wf,
          column,
        }),
      });
      if (!res.ok) {
        addToast("Erreur lors du placement.");
        return;
      }
      const slot = (await res.json()) as Slot;
      addSlot(slot);
      setSelectedEquipment(null);
    },
    [
      initialRack.id,
      initialRack.totalU,
      addToast,
      addSlot,
      findFreeColumn,
    ],
  );

  const moveSlot = useCallback(
    async (
      slot: Slot,
      uIndex: number,
      targetView: ViewId,
      explicitCol?: number,
    ) => {
      const slotHeightU = slot.heightU ?? 1;
      if (uIndex + slotHeightU - 1 > initialRack.totalU) {
        const slotName = slot.panel?.name ?? slot.equipment?.name ?? "Ce slot";
        addToast(
          `"${slotName}" dépasse la taille du rack à cette position.`,
        );
        return;
      }
      const column =
        explicitCol ??
        findFreeColumn(
          uIndex,
          slotHeightU,
          slot.widthFraction,
          targetView,
          slot.id,
        );
      if (column === null) {
        addToast(`Position U${uIndex} déjà occupée.`);
        return;
      }
      // Update optimiste : déplace le slot visuellement immédiatement, sans
      // attendre le retour du PATCH ni le SSE. En cas d'erreur serveur on
      // revient à l'état d'origine. Sans cet optimisme, le slot semble rester
      // figé jusqu'à ce que `useRackSync` reçoive `slot_updated` (latence
      // perceptible côté UX, surtout si le SSE est ralenti).
      const previousSnapshot = {
        startU: slot.startU,
        view: slot.view,
        column: slot.column,
      };
      setSlots((prev) =>
        prev.map((s) =>
          s.id === slot.id
            ? { ...s, startU: uIndex, view: targetView, column }
            : s,
        ),
      );
      try {
        const res = await fetch(
          `/api/racks/${initialRack.id}/slots/${slot.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              startU: uIndex,
              column,
              view: targetView,
            }),
          },
        );
        if (!res.ok) {
          // Rollback : restore la position d'origine et notifie l'utilisateur.
          setSlots((prev) =>
            prev.map((s) =>
              s.id === slot.id ? { ...s, ...previousSnapshot } : s,
            ),
          );
          addToast("Erreur lors du déplacement.");
        }
      } catch {
        setSlots((prev) =>
          prev.map((s) =>
            s.id === slot.id ? { ...s, ...previousSnapshot } : s,
          ),
        );
        addToast("Erreur réseau lors du déplacement.");
      }
    },
    [initialRack.id, initialRack.totalU, addToast, findFreeColumn, setSlots],
  );

  const handleRemoveSlot = useCallback(
    async (slotId: string) => {
      const slot =
        slots.find((s) => s.id === slotId) ??
        slots.flatMap((s) => s.children ?? []).find((c) => c.id === slotId);
      const slotName =
        slot?.label ??
        slot?.equipment?.name ??
        (slot?.panel as { name?: string } | null)?.name ??
        "cet élément";

      const ok = await confirm({
        title: `Retirer ${slotName}`,
        message: `Retirer « ${slotName} » de la baie ?`,
        confirmLabel: "Retirer",
        variant: "danger",
      });
      if (!ok) return;

      await apiFetch(`/api/racks/${initialRack.id}/slots/${slotId}`, {
        method: "DELETE",
      });
      if (selectedSlotId === slotId) setSelectedSlotId(null);
    },
    [slots, confirm, initialRack.id, selectedSlotId, setSelectedSlotId],
  );

  // ── Étagères : pose / réorganisation / suppression enfant ─────────────────
  const SHELF_MAX_CHILDREN = 10;

  const calculateShelfInsertIndex = useCallback(
    (shelfId: string): number => {
      const shelfEl = document.querySelector(`[data-shelf-id="${shelfId}"]`);
      if (!shelfEl) return 0;
      const rect = shelfEl.getBoundingClientRect();
      const relX = pointerRef.current.x - rect.left;
      const parentSlot = slots.find((s) => s.id === shelfId);
      const sorted = sortByChildOrder(
        parentSlot?.children ?? [],
        parentSlot?.notes ?? null,
      );
      if (sorted.length === 0) return 0;
      const childWidth = rect.width / sorted.length;
      return Math.max(
        0,
        Math.min(sorted.length, Math.round(relX / childWidth)),
      );
    },
    [slots],
  );

  const updateChildOrder = useCallback(
    async (parentSlotId: string, newOrder: string[]) => {
      const parentSlot = slots.find((s) => s.id === parentSlotId);
      let parentNotes: Record<string, unknown> = {};
      try {
        parentNotes = JSON.parse(parentSlot?.notes ?? "{}");
      } catch {
        /* */
      }
      parentNotes.childOrder = newOrder;
      const newNotes = JSON.stringify(parentNotes);
      await apiFetch(`/api/racks/${initialRack.id}/slots/${parentSlotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: newNotes }),
      });
      setSlots((prev) =>
        prev.map((s) => (s.id === parentSlotId ? { ...s, notes: newNotes } : s)),
      );
    },
    [slots, initialRack.id, setSlots],
  );

  const placeOnShelf = useCallback(
    async (
      equipment: Equipment,
      parentSlotId: string,
      insertIndex?: number,
    ) => {
      const parentSlot = slots.find((s) => s.id === parentSlotId);
      if (!parentSlot) {
        addToast("Étagère introuvable.");
        return;
      }
      if ((parentSlot.children ?? []).length >= SHELF_MAX_CHILDREN) {
        addToast(
          `Maximum ${SHELF_MAX_CHILDREN} équipements par étagère.`,
          "warning",
        );
        return;
      }
      const res = await apiFetch(`/api/racks/${initialRack.id}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipmentId: equipment.id,
          parentSlotId,
          view: parentSlot.view,
          startU: parentSlot.startU,
          heightU: parentSlot.heightU,
          widthFraction: "FULL",
          column: 0,
        }),
      });
      if (!res.ok) {
        addToast("Erreur lors du placement sur l'étagère.");
        return;
      }
      const childSlot = (await res.json()) as Slot;
      registerChildId(childSlot.id);

      const sorted = sortByChildOrder(
        parentSlot.children ?? [],
        parentSlot.notes,
      );
      const currentOrder = sorted.map((c) => c.id);
      const idx =
        insertIndex !== undefined
          ? Math.max(0, Math.min(currentOrder.length, insertIndex))
          : currentOrder.length;
      const newOrder = [...currentOrder];
      newOrder.splice(idx, 0, childSlot.id);

      setSlots((prev) =>
        prev.map((s) =>
          s.id === parentSlotId
            ? {
                ...s,
                children: (s.children ?? []).some((c) => c.id === childSlot.id)
                  ? s.children!
                  : [...(s.children ?? []), childSlot],
              }
            : s,
        ),
      );

      await updateChildOrder(parentSlotId, newOrder);
      addToast(`"${equipment.name}" posé sur l'étagère.`, "info");
    },
    [slots, initialRack.id, addToast, registerChildId, setSlots, updateChildOrder],
  );

  const reorderShelfChild = useCallback(
    async (
      fromShelfId: string,
      childId: string,
      toShelfId: string,
      insertIndex: number,
    ) => {
      if (fromShelfId === toShelfId) {
        const parentSlot = slots.find((s) => s.id === fromShelfId);
        const sorted = sortByChildOrder(
          parentSlot?.children ?? [],
          parentSlot?.notes ?? null,
        );
        const currentOrder = sorted.map((c) => c.id);
        const fromIdx = currentOrder.indexOf(childId);
        if (fromIdx === -1) return;
        currentOrder.splice(fromIdx, 1);
        const targetIdx = Math.min(
          insertIndex > fromIdx ? insertIndex - 1 : insertIndex,
          currentOrder.length,
        );
        currentOrder.splice(targetIdx, 0, childId);
        await updateChildOrder(fromShelfId, currentOrder);
      } else {
        const targetSlot = slots.find((s) => s.id === toShelfId);
        if ((targetSlot?.children ?? []).length >= SHELF_MAX_CHILDREN) {
          addToast(
            `Maximum ${SHELF_MAX_CHILDREN} équipements par étagère.`,
            "warning",
          );
          return;
        }
        await apiFetch(`/api/racks/${initialRack.id}/slots/${childId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentSlotId: toShelfId,
            startU: targetSlot!.startU,
            view: targetSlot!.view,
          }),
        });
        let movedChild: Slot | undefined;
        setSlots((prev) =>
          prev.map((s) => {
            if (s.id === fromShelfId) {
              movedChild = (s.children ?? []).find((c) => c.id === childId);
              return {
                ...s,
                children: (s.children ?? []).filter((c) => c.id !== childId),
              };
            }
            if (s.id === toShelfId && movedChild) {
              return {
                ...s,
                children: [
                  ...(s.children ?? []),
                  { ...movedChild, parentSlotId: toShelfId },
                ],
              };
            }
            return s;
          }),
        );
        const fromParent = slots.find((s) => s.id === fromShelfId);
        const fromSorted = sortByChildOrder(
          fromParent?.children ?? [],
          fromParent?.notes ?? null,
        );
        await updateChildOrder(
          fromShelfId,
          fromSorted.map((c) => c.id).filter((id) => id !== childId),
        );
        const toParent = slots.find((s) => s.id === toShelfId);
        const toSorted = sortByChildOrder(
          toParent?.children ?? [],
          toParent?.notes ?? null,
        );
        const toOrder = toSorted.map((c) => c.id);
        toOrder.splice(Math.min(insertIndex, toOrder.length), 0, childId);
        await updateChildOrder(toShelfId, toOrder);
      }
    },
    [slots, initialRack.id, setSlots, addToast, updateChildOrder],
  );

  // ── Placement accessoire (depuis ~1917) ───────────────────────────────────
  // Plus de `pendingDepthPrompt` : la profondeur des étagères / tiroirs vient
  // du contenant (rack.depthMm) ou de l'inventaire (drag data).

  const placeAccessory = useCallback(
    async (
      accessoryType: AccessoryType,
      aHeightU: number,
      style: string | undefined,
      depthMm: number | undefined,
      targetView: ViewId,
      uIndex: number,
    ) => {
      const labelMap: Record<AccessoryType, string> = {
        plaque: "Plaque",
        etagere: "Étagère",
        tiroir: "Tiroir",
      };
      const styleLabel = style
        ? ` ${PLAQUE_STYLES.find((s) => s.id === style)?.label ?? style}`
        : "";
      const depthLabel = depthMm ? ` ${depthMm}mm` : "";
      const label = `${labelMap[accessoryType]}${styleLabel}${depthLabel} ${aHeightU}U`;
      const notes = JSON.stringify({
        accessoryType,
        ...(style ? { style } : {}),
        ...(depthMm ? { depthMm } : {}),
      });
      const res = await apiFetch(`/api/racks/${initialRack.id}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          notes,
          view: targetView,
          startU: uIndex,
          heightU: aHeightU,
          widthFraction: "FULL",
          column: 0,
        }),
      });
      if (!res.ok) {
        addToast("Erreur lors du placement de l'accessoire.");
        return;
      }
      const slot = (await res.json()) as Slot;
      addSlot(slot);
    },
    [initialRack.id, addToast, addSlot],
  );

  // ── Drag handlers (signature exposée au DndContext parent) ────────────────

  // Zoom effectif : celui du viewport parent en mode embarqué.
  const getExternalZoomRef = useRef(getExternalZoom);
  getExternalZoomRef.current = getExternalZoom;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    const originId = data?.sourceRackId as string | undefined;
    setDragOrigin(
      originId
        ? {
            rackId: originId,
            rackName: (data?.sourceRackName as string | undefined) ?? null,
          }
        : null,
    );
    if (data?.type === "slot") {
      const initialRect = event.active.rect.current.initial;
      const pointerY = (event.activatorEvent as PointerEvent).clientY;
      if (initialRect) {
        const activeZoom =
          getExternalZoomRef.current?.() ?? zoomRef.current;
        grabOffsetRef.current = Math.floor(
          (pointerY - initialRect.top) / (U_HEIGHT_PX * activeZoom),
        );
      } else {
        grabOffsetRef.current = 0;
      }
      setActive({ kind: "slot", slot: data.slot as Slot });
    } else {
      grabOffsetRef.current = 0;
      if (data?.type === "equipment") {
        setActive({
          kind: "equipment",
          equipment: data.equipment as Equipment,
          wf: data.widthFraction as WidthFraction,
        });
        setSelectedEquipment(null);
      } else if (data?.type === "panel") {
        setActive({ kind: "panel", panel: data.panel as PanelItem });
        setSelectedEquipment(null);
      } else if (data?.type === "shelf-equipment") {
        setActive({
          kind: "shelf-equipment",
          equipment: data.equipment as Equipment,
        });
        setSelectedEquipment(null);
      } else if (data?.type === "shelf-child") {
        setActive({
          kind: "shelf-child",
          slot: data.slot as Slot,
          parentSlotId: data.parentSlotId as string,
        });
      } else if (data?.type === "configured-accessory") {
        setActive({
          kind: "configured-accessory",
          accessoryType: data.accessoryType as AccessoryType,
          heightU: data.heightU as number,
          style: data.style as string | undefined,
          depthMm: data.depthMm as number | undefined,
        });
        setSelectedEquipment(null);
      }
    }
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      // Contenant non éligible : rien à survoler, rien à prévisualiser.
      if (dropDisabled) {
        setHoverU(null);
        setHoverCol(null);
        setHoverView(null);
        setHoverShelfId(null);
        return;
      }
      const data = event.over?.data.current;
      // Étagère survolée — seule cible valide d'un équipement non rackable.
      // On ne retient QUE les étagères de ce contenant : en affichage
      // multi-contenants l'événement est diffusé à tous les canvases.
      const overShelfId = data?.shelfSlotId as string | undefined;
      setHoverShelfId(
        overShelfId && slots.some((s) => s.id === overShelfId)
          ? overShelfId
          : null,
      );
      // Affichage multi-rack : l'événement est diffusé à tous les canvases.
      // Chacun ne rend le preview que pour SES propres cellules.
      if (embedded && data?.rackId != null && data.rackId !== initialRack.id) {
        setHoverU(null);
        setHoverCol(null);
        setHoverView(null);
        return;
      }
      if (data?.uIndex != null) {
        const rawU: number = data.uIndex;
        const adjustedU = Math.max(1, rawU - grabOffsetRef.current);
        const col: number = data.col ?? 0;
        const targetView: ViewId = (data.view as ViewId) ?? "FRONT";

        // Aimantation au plus proche slot libre — si la position curseur
        // collide pour un équipement multi-U, snap vers la position la plus
        // proche dans une fenêtre `±(heightU - 1)`. Le ghost suit la position
        // aimantée → l'utilisateur voit où le drop atterrira réellement.
        let effectiveU = adjustedU;
        if (active) {
          const heightU =
            active.kind === "equipment"
              ? (active.equipment.heightU ?? 1)
              : active.kind === "slot"
                ? (active.slot.heightU ?? 1)
                : active.kind === "panel"
                  ? active.panel.heightU
                  : active.kind === "configured-accessory"
                    ? active.heightU
                    : 1;
          if (heightU > 1) {
            const wf: WidthFraction =
              active.kind === "slot" ? active.slot.widthFraction : "FULL";
            const excludeId =
              active.kind === "slot" ? active.slot.id : undefined;
            const validU = findValidStartUNear(
              adjustedU,
              heightU,
              col,
              wf,
              targetView,
              slots,
              excludeId,
              initialRack.totalU,
            );
            if (validU != null) effectiveU = validU;
          }
        }

        setHoverU(effectiveU);
        setHoverCol(col);
        setHoverView(targetView);
      } else {
        setHoverU(null);
        setHoverCol(null);
        setHoverView(null);
      }
    },
    [active, slots, initialRack.totalU, embedded, initialRack.id, dropDisabled],
  );

  /**
   * Drag d'un élément qui ne se pose QUE sur une étagère : équipement non
   * rackable venant de la liste, ou enfant d'étagère déplacé.
   */
  const isShelfOnlyDrag =
    active?.kind === "shelf-equipment" || active?.kind === "shelf-child";

  /**
   * `true` si l'élément draggé appartient à un AUTRE contenant : le dépôt sera
   * refusé (règle métier — un équipement appartient à son contenant).
   */
  const isForeignDrag =
    embedded && !!dragOrigin && dragOrigin.rackId !== initialRack.id;
  const foreignReason = dragOrigin?.rackName
    ? `Appartient à ${dragOrigin.rackName}`
    : "Appartient à un autre contenant";

  /** Abandon silencieux — canvases non ciblés d'un affichage multi-rack. */
  const cancelDrag = useCallback(() => {
    setActive(null);
    setDragOrigin(null);
    setHoverU(null);
    setHoverCol(null);
    setHoverView(null);
    setHoverShelfId(null);
  }, []);

  /**
   * Dépôt raté d'un « étagère seulement » sans contenant ciblé : seul le
   * contenant SOUS le curseur parle, d'où le booléen de retour (cf.
   * `RackPlacementCanvasHandle`). Appelé juste après `cancelDrag`, donc avant
   * tout re-render : la ref porte encore la valeur du drag.
   *
   * Le message reste le même au-dessus d'un contenant éteint : c'est bien la
   * raison la plus utile (« ça se pose sur une étagère »), l'appartenance à un
   * autre contenant étant déjà dite par l'extinction de la colonne.
   */
  const notifyShelfOnlyMiss = useCallback(() => {
    if (!pointerOverContentRef.current) return false;
    addToast(SHELF_ONLY_MISS_MESSAGE, "warning");
    return true;
  }, [addToast]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const prev = active;
      const origin = dragOrigin;
      setActive(null);
      setDragOrigin(null);
      setHoverU(null);
      setHoverCol(null);
      setHoverView(null);
      setHoverShelfId(null);
      const { over } = event;

      // Règle métier : un équipement appartient à son contenant. Un dépôt
      // venant d'un autre contenant est refusé — aucun placement, aucun
      // transfert d'inventaire.
      if (embedded && over && origin && origin.rackId !== initialRack.id) {
        addToast(foreignToastMessage(origin.rackName), "warning");
        return;
      }

      if (!over && prev?.kind === "slot") return;
      if (!over && prev?.kind === "shelf-child") return;

      // shelf-child onto a shelf → reorder/move
      if (prev?.kind === "shelf-child" && over) {
        const shelfId = over.data.current?.shelfSlotId as string | undefined;
        if (shelfId) {
          const insertIdx = calculateShelfInsertIndex(shelfId);
          await reorderShelfChild(
            prev.parentSlotId,
            prev.slot.id,
            shelfId,
            insertIdx,
          );
        }
        return;
      }

      // Équipement non rackable → étagère. Toute autre cible (cellule U, rails,
      // vide) est refusée explicitement : sans ce retour, le drop serait un
      // no-op silencieux.
      if (prev?.kind === "shelf-equipment") {
        const shelfId = over?.data.current?.shelfSlotId as string | undefined;
        if (shelfId) {
          const insertIdx = calculateShelfInsertIndex(shelfId);
          await placeOnShelf(prev.equipment, shelfId, insertIdx);
        } else if (pointerOverContentRef.current) {
          addToast(SHELF_ONLY_MISS_MESSAGE, "warning");
        }
        return;
      }

      if (!over?.data.current?.uIndex) return;
      // Affichage multi-rack : ne traiter que les cellules de CE contenant.
      if (
        embedded &&
        over.data.current.rackId != null &&
        over.data.current.rackId !== initialRack.id
      )
        return;
      const rawUIndex: number = over.data.current.uIndex;
      // `uIndex` est mutable : un clamp peut s'appliquer plus bas dès qu'on
      // connaît `heightU` (si le curseur dépasse en haut du rack), et un
      // auto-snap au slot libre le plus proche pour les multi-U.
      let uIndex: number = Math.max(1, rawUIndex - grabOffsetRef.current);
      const col: number = over.data.current.col ?? 0;
      const targetView: ViewId =
        (over.data.current.view as ViewId) ?? "FRONT";

      // Aimantation préalable (cf. handleDragOver) : pour un équipement
      // multi-U, on cherche la position libre la plus proche dans la fenêtre
      // `±(heightU - 1)` autour du curseur. Sans cette aimantation, on
      // refuserait le drop alors qu'une position libre voisine existe.
      if (prev) {
        const dragHeightU =
          prev.kind === "equipment"
            ? (prev.equipment.heightU ?? 1)
            : prev.kind === "slot"
              ? (prev.slot.heightU ?? 1)
              : prev.kind === "panel"
                ? prev.panel.heightU
                : prev.kind === "configured-accessory"
                  ? prev.heightU
                  : 1;
        if (dragHeightU > 1) {
          const wfDrag: WidthFraction =
            prev.kind === "slot" ? prev.slot.widthFraction : "FULL";
          const excludeIdDrag =
            prev.kind === "slot" ? prev.slot.id : undefined;
          const validU = findValidStartUNear(
            uIndex,
            dragHeightU,
            col,
            wfDrag,
            targetView,
            slots,
            excludeIdDrag,
            initialRack.totalU,
          );
          if (validU != null) uIndex = validU;
        }
      }

      // Validation drop
      if (prev) {
        const heightU =
          prev.kind === "equipment"
            ? (prev.equipment.heightU ?? 1)
            : prev.kind === "slot"
              ? (prev.slot.heightU ?? 1)
              : prev.kind === "panel"
                ? prev.panel.heightU
                : 1;
        const wf: WidthFraction =
          prev.kind === "slot" ? prev.slot.widthFraction : "FULL";
        const excludeId = prev.kind === "slot" ? prev.slot.id : undefined;
        const itemName =
          prev.kind === "equipment"
            ? prev.equipment.name
            : prev.kind === "slot"
              ? (prev.slot.panel?.name ??
                prev.slot.equipment?.name ??
                "Cet élément")
              : prev.kind === "panel"
                ? prev.panel.name
                : "Cet accessoire";

        // Clip startU vers le bas si le curseur est près du haut du rack :
        // pour un item de heightU dans un rack totalU, le startU max vaut
        // (totalU - heightU + 1). Ex : item 4U dans baie 24U → startU max
        // = 21. Si l'utilisateur cible U22+, on ramène à U21 (placement
        // U21 → U24) au lieu de refuser.
        if (heightU > initialRack.totalU) {
          addToast(
            `"${itemName}" (${heightU}U) dépasse la taille du rack.`,
            "warning",
          );
          return;
        }
        const maxStartU = Math.max(1, initialRack.totalU - heightU + 1);
        uIndex = Math.min(uIndex, maxStartU);
        if (uIndex < 1) {
          addToast(
            `"${itemName}" dépasse les limites du rack à cette position.`,
            "warning",
          );
          return;
        }
        if (prev.kind === "equipment") {
          const eqDepth = (prev.equipment as { depthMm?: number | null })
            .depthMm;
          // Profondeur disponible = profondeur du rack − marge de sécurité
          // câbles. Alerte non-bloquante : on PRÉVIENT mais on autorise le
          // placement. L'utilisateur voit ensuite l'indicateur visuel sur le
          // slot + le bloc d'avertissement dans le panneau de propriété.
          const rackDepth = initialRack.depthMm ?? RACK_DEPTH_DEFAULT;
          const usableDepth = Math.max(0, rackDepth - cableSafetyDepthMm);
          if (eqDepth && eqDepth > usableDepth) {
            const totalMm = eqDepth + cableSafetyDepthMm;
            addToast(
              `⚠️ "${prev.equipment.name}" (${eqDepth} mm + ${cableSafetyDepthMm} mm câbles = ${totalMm} mm) dépasse la profondeur utile (${usableDepth} mm). Placement autorisé.`,
              "warning",
            );
            // Pas de `return` : on continue le placement.
          }
        }
        for (const s of slots) {
          if (s.id === excludeId) continue;
          if (s.parentSlotId) continue;
          if (s.view !== targetView) continue;
          if (s.startU == null || s.heightU == null) continue; // phantom slot — not placed
          if (uIndex < s.startU + s.heightU && uIndex + heightU > s.startU) {
            if (colsCollide(col, wf, s.column, s.widthFraction)) {
              const occupant =
                s.panel?.name ?? s.equipment?.name ?? "un autre équipement";
              addToast(`Position occupée par "${occupant}".`, "warning");
              return;
            }
          }
        }
      }

      if (prev?.kind === "equipment") {
        await placeEquipment(prev.equipment, uIndex, prev.wf, targetView, col);
      } else if (prev?.kind === "slot") {
        await moveSlot(prev.slot, uIndex, targetView, col);
      } else if (prev?.kind === "panel") {
        const res = await apiFetch(`/api/racks/${initialRack.id}/slots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            panelId: prev.panel.id,
            view: targetView,
            startU: uIndex,
            widthFraction: "FULL",
            column: 0,
          }),
        });
        if (!res.ok) {
          addToast("Erreur lors du placement du panel.");
          return;
        }
        const slot = (await res.json()) as Slot;
        addSlot(slot);
      } else if (prev?.kind === "configured-accessory") {
        const { accessoryType, heightU: aHeightU, style, depthMm } = prev;
        // Plaque : pas de profondeur (par nature). Pour étagère/tiroir, on
        // privilégie depthMm du BOM (drag data inventaire) ; à défaut on
        // tombe sur rack.depthMm. Cela permet la dissociation BOM ↔ slot
        // par profondeur sans polluer les plaques avec un faux depthMm.
        const finalDepth =
          accessoryType === "plaque"
            ? undefined
            : (depthMm ?? initialRack.depthMm ?? RACK_DEPTH_DEFAULT);
        await placeAccessory(
          accessoryType,
          aHeightU,
          style,
          finalDepth,
          targetView,
          uIndex,
        );
      }
    },
    [
      active,
      slots,
      initialRack.id,
      initialRack.totalU,
      initialRack.depthMm,
      addToast,
      addSlot,
      placeEquipment,
      moveSlot,
      placeOnShelf,
      reorderShelfChild,
      calculateShelfInsertIndex,
      placeAccessory,
      embedded,
      dragOrigin,
    ],
  );

  // Tap-place : sélection sidebar → tap U sur canvas
  const handleTapPlace = useCallback(
    async (uIndex: number, view: ViewId) => {
      if (!selectedEquipment) return;
      const wf =
        (selectedEquipment.widthFraction as WidthFraction | null) ?? "FULL";
      await placeEquipment(selectedEquipment, uIndex, wf, view);
    },
    [selectedEquipment, placeEquipment],
  );

  // ── Validity drop target (pour feedback visuel) ───────────────────────────
  // Renvoie AUSSI la raison du refus : elle alimente l'infobulle « Interdit »
  // collée au ghost de drag. `valid: null` = aucune cible survolée.
  const dropCheck = useMemo<{ valid: boolean | null; reason: string | null }>(() => {
    if (!active) return { valid: null, reason: null };
    // Équipement non rackable (ou enfant d'étagère déplacé) : la seule cible
    // valide est une étagère. Partout ailleurs sur le contenant, refus explicite
    // — les cellules U ne sont même pas droppables pendant ce drag.
    if (isShelfOnlyDrag) {
      if (isForeignDrag) return { valid: false, reason: foreignReason };
      if (hoverShelfId) return { valid: true, reason: null };
      return pointerOverContent
        ? { valid: false, reason: "Se pose sur une étagère" }
        : { valid: null, reason: null };
    }
    if (hoverU === null || hoverView === null)
      return { valid: null, reason: null };
    // Élément d'un autre contenant : refus, quel que soit l'espace libre.
    if (isForeignDrag) return { valid: false, reason: foreignReason };
    const heightU =
      active.kind === "equipment"
        ? (active.equipment.heightU ?? 1)
        : active.kind === "slot"
          ? (active.slot.heightU ?? 1)
          : active.kind === "panel"
            ? active.panel.heightU
            : active.kind === "configured-accessory"
              ? active.heightU
              : 1;
    const wf: WidthFraction =
      active.kind === "slot" ? active.slot.widthFraction : "FULL";
    const col = hoverCol ?? 0;
    const excludeId = active.kind === "slot" ? active.slot.id : undefined;
    if (heightU > initialRack.totalU)
      return { valid: false, reason: "Dépasse la hauteur de la baie" };
    // Clamp le preview vers le bas si le curseur dépasse en haut.
    const maxStartU = Math.max(1, initialRack.totalU - heightU + 1);
    const u = Math.min(hoverU, maxStartU);
    if (u < 1) return { valid: false, reason: "Hors de la baie" };
    // Note : pas de check profondeur ici — la profondeur est non-bloquante
    // (cf. handleDragEnd qui se contente d'un toast warning). Le ghost reste
    // valide même si l'équipement dépasse, pour que l'utilisateur puisse
    // placer en connaissance de cause.
    for (const s of slots) {
      if (s.id === excludeId) continue;
      if (s.parentSlotId) continue;
      if (s.view !== hoverView) continue;
      if (s.startU == null || s.heightU == null) continue; // phantom slot — not placed
      if (u < s.startU + s.heightU && u + heightU > s.startU) {
        if (colsCollide(col, wf, s.column, s.widthFraction))
          return { valid: false, reason: "Emplacement occupé" };
      }
    }
    return { valid: true, reason: null };
  }, [
    active,
    hoverU,
    hoverCol,
    hoverView,
    slots,
    initialRack.totalU,
    isForeignDrag,
    foreignReason,
    isShelfOnlyDrag,
    hoverShelfId,
    pointerOverContent,
  ]);
  const dropValid = dropCheck.valid;

  /**
   * Raison affichée dans l'infobulle d'interdiction.
   *
   * Deux sources, pour que l'utilisateur ait TOUJOURS un retour quand le dépôt
   * échouerait :
   *  1. une cellule est survolée mais le placement est refusé (collision,
   *     hauteur, hors limites) → raison précise ;
   *  2. le curseur est sur ce contenant SANS cellule sous lui (rangée pleine
   *     donc non survolable, rails, traverses, zone hors U) → « Emplacement
   *     occupé ». Sans ce cas, l'infobulle ne serait jamais visible là où le
   *     besoin est le plus fort.
   */
  const dropInvalidReason: string | null =
    dropCheck.reason ??
    // Cible explicitement valide (ex. étagère survolée) : pas d'infobulle.
    (dropCheck.valid === true
      ? null
      : active && pointerOverContent
      ? // Survol de CE contenant : soit l'élément vient d'ailleurs (refus
        // explicite), soit aucune cellule n'est atteignable sous le curseur.
        isForeignDrag
        ? foreignReason
        : hoverU === null
          ? "Emplacement occupé"
          : null
      : null);

  // Publie la raison du refus au conteneur (affichage multi-contenants) :
  // c'est lui qui rend le ghost, donc l'infobulle qui l'accompagne.
  const onDropInvalidChangeRef = useRef(onDropInvalidChange);
  onDropInvalidChangeRef.current = onDropInvalidChange;
  useEffect(() => {
    onDropInvalidChangeRef.current?.(dropInvalidReason);
  }, [dropInvalidReason]);

  // ── Expose imperative handle ──────────────────────────────────────────────
  const slotsForOwnershipRef = useRef(slots);
  slotsForOwnershipRef.current = slots;
  const ownsSlot = useCallback((slotId: string) => {
    const walk = (list: Slot[]): boolean =>
      list.some((s) => s.id === slotId || walk(s.children ?? []));
    return walk(slotsForOwnershipRef.current);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      rackId: initialRack.id,
      ownsSlot,
      handleDragStart,
      handleDragOver,
      handleDragEnd,
      cancelDrag,
      notifyShelfOnlyMiss,
      clearSelection,
      fitAll,
      centerContent,
      zoomIn,
      zoomOut,
    }),
    [
      initialRack.id,
      ownsSlot,
      handleDragStart,
      handleDragOver,
      handleDragEnd,
      cancelDrag,
      notifyShelfOnlyMiss,
      clearSelection,
      fitAll,
      centerContent,
      zoomIn,
      zoomOut,
    ],
  );

  // ── Context menu ──────────────────────────────────────────────────────────
  const designCanvasMenu: CanvasMenuItem[] = [
    {
      id: "select-tool",
      label: "Outil sélection",
      shortcut: "S",
      onSelect: () => setCanvasTool("select"),
    },
    {
      id: "move-tool",
      label: "Outil déplacer",
      shortcut: "H",
      onSelect: () => setCanvasTool("move"),
    },
    {
      id: "fit-all",
      label: "Ajuster à l'écran",
      onSelect: () => fitAll(),
      separatorAfter: true,
    },
    {
      id: "center",
      label: "Centrer le rack",
      onSelect: () => centerContent(),
    },
  ];

  // ── viewMode → showInfo pour RackVisual ───────────────────────────────────
  const showInfo = viewMode === "schema";
  const rack = initialRack;

  // Hauteur courante de l'item en cours de drag — utilisé pour clamper le
  // preview de hover (le placement réel est clampé dans handleDragEnd).
  const dragHeightU =
    active?.kind === "equipment"
      ? (active.equipment.heightU ?? 1)
      : active?.kind === "slot"
        ? active.slot.heightU
        : active?.kind === "panel"
          ? active.panel.heightU
          : active?.kind === "configured-accessory"
            ? active.heightU
            : undefined;
  // Si le curseur dépasse en haut du rack, on ramène le preview à
  // (totalU - heightU + 1). Le drop respectera la même logique.
  const clampedHoverU =
    hoverU != null && dragHeightU != null
      ? Math.min(hoverU, Math.max(1, initialRack.totalU - dragHeightU + 1))
      : hoverU;


  // En mode embarqué, les trois conteneurs ci-dessous restent en place (même
  // arbre DOM) mais deviennent neutres : c'est le parent qui porte le viewport,
  // le menu contextuel, la légende et les curseurs distants.
  return (
    <CategoryColorCtx.Provider value={catColorMap}>
      <CanvasContextMenu items={designCanvasMenu} disabled={embedded}>
        <div
          className={cn(
            embedded
              ? "relative"
              : "relative h-full w-full overflow-hidden bg-[var(--background)]",
            className,
          )}
        >
          {!embedded && <ToastStack toasts={toasts} onRemove={removeToast} />}

          {/* Légende des catégories/fonctions — overlay flottant
              (déplaçable + dimensionnable, position persistée). Pattern
              calqué sur la légende du drawing-editor (`DrawingLegendSvg`)
              mais en HTML pour s'intégrer au canvas DnD.
              N'affiche QUE les catégories réellement présentes dans le rack
              courant (slots placés, parents + children), pas toute la liste
              tenant — pour rester pertinent et compact. */}
          {!embedded && (
            <CategoryLegend
              categories={(() => {
                const present = new Set<string>();
                const collect = (slot: Slot) => {
                  if (slot.startU == null) return;
                  const cat = slot.equipment?.category ?? null;
                  if (cat) present.add(cat);
                };
                for (const s of slots) {
                  collect(s);
                  for (const child of s.children ?? []) collect(child);
                }
                return (categories ?? [])
                  .filter((c) => present.has(c.name))
                  .map((c) => ({ id: c.id, name: c.name, color: c.color }));
              })()}
            />
          )}

          {/* Canvas pan + zoom */}
          <div
            ref={rackContainerRef}
            className={
              embedded ? "relative" : "absolute inset-0 overflow-hidden"
            }
            style={
              embedded
                ? undefined
                : {
                    cursor: panActive
                      ? "grabbing"
                      : canvasTool === "move"
                        ? "grab"
                        : rubberBand
                          ? "crosshair"
                          : "default",
                  }
            }
          >
            {/* Rubber band selection */}
            {!embedded && rubberBand && (
              <div
                className="pointer-events-none absolute z-50 border border-[var(--accent)] bg-[var(--accent)]/10"
                style={{
                  left: Math.min(rubberBand.x1, rubberBand.x2),
                  top: Math.min(rubberBand.y1, rubberBand.y2),
                  width: Math.abs(rubberBand.x2 - rubberBand.x1),
                  height: Math.abs(rubberBand.y2 - rubberBand.y1),
                }}
              />
            )}

            {/* Contenu transformé pan + scale (neutre en mode embarqué : le
                parent applique un seul transform pour toutes les colonnes). */}
            <div
              style={
                embedded
                  ? undefined
                  : {
                      position: "absolute",
                      top: 0,
                      left: 0,
                      transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                      transformOrigin: "0 0",
                      // Transition active uniquement pendant ~280ms après un
                      // zoom in re-centré sur un slot sélectionné. Hors
                      // animation : pas de transition pour préserver la
                      // réactivité du pan/wheel.
                      transition: animatingZoom
                        ? "transform 280ms cubic-bezier(0.4, 0, 0.2, 1)"
                        : undefined,
                    }
              }
            >
              {/* data-rack-capture : nœud plein-contenu, posé hors du wrapper
                  pan/zoom — html-to-image clone ce nœud sans les transforms
                  ancêtres, la capture est donc indépendante du viewport.
                  L'export du Rack ne s'en sert PLUS (il compose sa propre page
                  dans `rack-export-composer`) ; l'ancrage reste en place comme
                  cible stable pour une capture du canvas. */}
              <div
                ref={contentRef}
                // En mode embarqué, la cible de capture est le conteneur
                // parent (une seule pour toutes les colonnes).
                data-rack-capture={embedded ? undefined : ""}
                className="flex items-start gap-6 p-0"
              >
                {VIEWS.filter(
                  (v) =>
                    !v.auto &&
                    visibleViews.has(v.id) &&
                    (v.id !== "REAR_INTERIOR" ||
                      rack.rearInteriorGapMm != null),
                ).map((v) => (
                  <div
                    key={v.id}
                    data-view-id={v.id}
                    className="shrink-0"
                    style={{ width: RACK_BODY_W }}
                  >
                    <div
                      className={cn(
                        "mb-3 flex gap-2",
                        // Alignement centré dès qu'une poignée est présente
                        // (une icône ne s'aligne pas sur une baseline).
                        onHeaderPointerDown
                          ? "cursor-grab touch-none items-center select-none active:cursor-grabbing"
                          : "items-baseline",
                      )}
                      onPointerDown={onHeaderPointerDown}
                      title={
                        onHeaderPointerDown
                          ? "Glisser pour réordonner les contenants"
                          : undefined
                      }
                    >
                      {/* Poignée de réordonnancement — même grammaire que les
                          items du panneau latéral. C'est l'activateur explicite
                          du drag (l'entête entier reste saisissable). */}
                      {onHeaderPointerDown && (
                        <GripVertical
                          className="text-muted-foreground h-3.5 w-3.5 shrink-0 cursor-grab active:cursor-grabbing"
                          aria-hidden
                        />
                      )}
                      {/* Mode embarqué : l'entête porte le nom du contenant
                          (une colonne = un contenant), sinon le nom de la vue. */}
                      <p
                        className={cn(
                          "truncate text-xs font-semibold tracking-wider uppercase",
                          embedded
                            ? "text-[var(--foreground)]"
                            : "text-[var(--muted-foreground)]",
                        )}
                      >
                        {embedded ? (headerLabel ?? rack.name) : v.label}
                      </p>
                      {embedded && (
                        <span
                          className="text-muted-foreground shrink-0 text-[10px]"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {rack.totalU}U
                        </span>
                      )}
                    </div>
                    <RackVisual
                      rack={rack}
                      slots={slots}
                      view={v.id}
                      showInfo={showInfo}
                      renderMode={renderMode}
                      dropDisabled={dropDisabled}
                      onRemoveSlot={handleRemoveSlot}
                      selectedEquipment={selectedEquipment}
                      onTapPlace={handleTapPlace}
                      onSelectSlot={setSelectedSlotId}
                      selectedSlotId={selectedSlotId}
                      selectedSlotIds={selectedSlotIds}
                      onShowProperties={(id) => setSelectedSlotId(id)}
                      draggingSlotId={
                        active?.kind === "slot" ? active.slot.id : null
                      }
                      isDragging={
                        !!active &&
                        // Contenant non éligible : aucune cellule droppable ne
                        // doit être montée. `pointer-events` ne suffirait pas —
                        // dnd-kit résout la cible sur les RECTS mesurés, pas par
                        // hit-test DOM.
                        !dropDisabled &&
                        active.kind !== "shelf-equipment" &&
                        active.kind !== "shelf-child"
                      }
                      isHoveredView={hoverView === v.id}
                      hoverU={hoverView === v.id ? clampedHoverU : null}
                      hoverCol={hoverView === v.id ? hoverCol : null}
                      dragHeightU={
                        active?.kind === "equipment"
                          ? (active.equipment.heightU ?? 1)
                          : active?.kind === "slot"
                            ? (active.slot.heightU ?? 1)
                            : active?.kind === "panel"
                              ? active.panel.heightU
                              : active?.kind === "configured-accessory"
                                ? active.heightU
                                : undefined
                      }
                      dragWidthFraction={
                        active?.kind === "equipment"
                          ? active.wf
                          : active?.kind === "slot"
                            ? active.slot.widthFraction
                            : "FULL"
                      }
                      dragCategory={
                        active?.kind === "equipment"
                          ? active.equipment.category
                          : active?.kind === "slot"
                            ? active.slot.panel
                              ? "Panels de patch"
                              : active.slot.equipment?.category
                            : active?.kind === "panel"
                              ? "Panels de patch"
                              : active?.kind === "configured-accessory"
                                ? "Accessoire rack"
                                : undefined
                      }
                      dropValid={hoverView === v.id ? dropValid : null}
                    />
                  </div>
                ))}

                {/* Side view — visible uniquement si toggle "SIDE" actif */}
                {visibleViews.has("SIDE") && (
                <div
                  data-view-id="SIDE"
                  className="ml-2 shrink-0 border-l pl-6"
                  // arkyo-server: habillage Strata (séparateur de la vue de côté : indigo d'arkyo → accent du thème)
                  style={{ borderColor: "color-mix(in srgb, var(--accent) 25%, transparent)" }}
                >
                  <div
                    className={cn(
                      "mb-3 flex items-center gap-2",
                      onHeaderPointerDown &&
                        "cursor-grab touch-none select-none active:cursor-grabbing",
                    )}
                    onPointerDown={onHeaderPointerDown}
                    title={
                      onHeaderPointerDown
                        ? "Glisser pour réordonner les contenants"
                        : undefined
                    }
                  >
                    {onHeaderPointerDown && (
                      <GripVertical
                        className="text-muted-foreground h-3.5 w-3.5 shrink-0 cursor-grab active:cursor-grabbing"
                        aria-hidden
                      />
                    )}
                    <p
                      className="truncate text-xs font-semibold tracking-wider uppercase"
                      style={{
                        color: embedded ? "var(--foreground)" : "var(--accent)",
                      }}
                    >
                      {embedded ? (headerLabel ?? rack.name) : "Vue côté"}
                    </p>
                    <span
                      className="rounded border px-1.5 py-0.5 text-[9px] font-medium"
                      style={{
                        // arkyo-server: habillage Strata (texte d'accent sur teinte d'accent : --accent-strong)
                        color: "var(--accent-strong)",
                        borderColor:
                          "color-mix(in srgb, var(--accent) 40%, transparent)",
                        background:
                          "color-mix(in srgb, var(--accent) 10%, transparent)",
                      }}
                    >
                      Profondeur {rack.depthMm ?? 600} mm
                    </span>
                  </div>
                  <SideRackVisual
                    rack={rack}
                    slots={slots}
                    innerW={sideInnerW}
                    patchPanelDepthMm={patchPanelDepthMm}
                    cableSafetyDepthMm={cableSafetyDepthMm}
                  />
                </div>
                )}
              </div>
              {/* Curseurs distants — dans le repère MONDE (suivent zoom/pan
                  local, contre-échelle 1/zoom appliquée par l'overlay). Monté
                  dans le wrapper transformé, exactement comme rack-editor. */}
              {!embedded && <RemoteCursorsOverlay peers={livePeers} zoom={zoom} />}
            </div>
          </div>
        </div>
      </CanvasContextMenu>

      {/* DragOverlay : preview suit le curseur. Le DndContext est fourni par
       * le parent ; le DragOverlay doit aussi vivre dans ce DndContext mais
       * dnd-kit accepte qu'il soit rendu n'importe où dans l'arbre, on le
       * place ici pour la cohérence visuelle. */}
      {embedded && <ToastStack toasts={toasts} onRemove={removeToast} />}
      {renderDragOverlay && (
        <DragOverlay dropAnimation={null}>
          <RackDragOverlayContent
            active={active}
            invalidReason={dropInvalidReason}
          />
        </DragOverlay>
      )}

      {/* Confirm dialog (utilisé par delete) */}
      <RackEditorConfirmDialog
        {...confirmState}
        onCancel={cancel}
        confirmVariant={confirmState.variant}
      />

      {/* DepthPromptDialog retiré : la profondeur vient du contenant (rack.depthMm)
          ou du drag data (BOM inventaire). */}
    </CategoryColorCtx.Provider>
  );
});

