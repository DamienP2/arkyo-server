"use client";

/**
 * LocationPlacementCanvas — vue « par emplacement » de l'onglet Rack.
 *
 * Affiche TOUS les contenants d'un lieu côte à côte, chacun dans UNE SEULE
 * vue (celle choisie dans le bloc VUES de la toolbar), avec le placement
 * complet actif sur chaque colonne.
 *
 * Architecture : ce composant n'est qu'un **viewport partagé** (pan / zoom /
 * fit / menu contextuel). Chaque colonne est un `RackPlacementCanvas` monté en
 * mode `embedded` — donc la mécanique de placement (collisions, aimantation
 * multi-U, étagères, dialog quantité, POST /slots, `useRackSync`) est celle du
 * mode contenant, à l'identique, mais scopée à SON contenant. Aucune logique
 * de placement n'est dupliquée ici.
 *
 * Le routage du drag & drop est fait par le `RackTabDndProvider` : chaque
 * canvas embarqué s'enregistre par `rackId`, et le provider adresse le drop au
 * contenant survolé (les cellules de `RackVisual` portent déjà `rackId` dans
 * leurs data dnd-kit).
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

import { cn } from "@/lib/utils";

import { CanvasContextMenu } from "@/components/editor-shell/canvas-context-menu";
import {
  FRONT_OUTER_W,
  RACK_BODY_W,
  RACK_DEPTH_DEFAULT,
  RACK_WIDTH_MM,
  SIDE_PANEL_W,
  rackBodyHeight,
} from "@/components/synoptique/lib/constants";
import type {
  Equipment,
  PanelItem,
  Rack,
  Slot,
  ViewId,
} from "@/components/synoptique/lib/types";

import { DragOverlay } from "@dnd-kit/core";

import {
  RackDragOverlayContent,
  RackPlacementCanvas,
  type RackPlacementCanvasHandle,
} from "./rack-placement-canvas";
import { useRackDragEligibility } from "./rack-drag-eligibility";
import type { ActiveItem } from "@/components/synoptique/lib/types";

// Échelle px/mm réelle — identique à `RackPlacementCanvas`.
const PX_PER_MM = FRONT_OUTER_W / RACK_WIDTH_MM;
const SIDE_VIEW_SCALE = 0.55;
/** Espace horizontal entre deux colonnes de contenants. */
const COLUMN_GAP = 40;

type CategoryWithChildren = {
  id: string;
  name: string;
  color: string;
  children: { id: string; name: string; color: string }[];
};

/** Un contenant du lieu, avec le payload nécessaire à son rendu + placement. */
export type LocationCanvasRack = {
  rack: Rack;
  slots: Slot[];
  allEquipment: Equipment[];
  allPanels: PanelItem[];
  rackAccessories: Equipment[];
  categories: CategoryWithChildren[];
  patchPanelDepthMm: number;
  cableSafetyDepthMm: number;
};

export type LocationPlacementCanvasHandle = {
  fitAll: () => void;
  centerContent: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

export type LocationPlacementCanvasProps = {
  /** Contenants du lieu, dans l'ordre d'affichage. */
  racks: LocationCanvasRack[];
  /** Vue unique appliquée à tous les contenants. */
  view: ViewId;
  /** `schema` = affiche les infos textuelles dans les slots (idem contenant). */
  viewMode: "real" | "schema";
  renderMode?: "standard" | "graphic" | "photo";
  onSlotSelect?: (slot: Slot | null) => void;
  /** Notifié à chaque changement de slots d'un contenant (BOM sidebar). */
  onRackSlotsChange?: (rackId: string, slots: Slot[]) => void;
  onZoomChange?: (zoom: number) => void;
  canvasTool?: "select" | "move";
  onCanvasToolChange?: (tool: "select" | "move") => void;
  /** Enregistre le canvas d'un contenant auprès du provider DnD. */
  registerRackCanvas?: (
    rackId: string,
    handle: RackPlacementCanvasHandle | null,
  ) => void;
  /**
   * Réordonne les colonnes : `targetIdx` est l'index visé DANS la liste des
   * contenants du lieu, après retrait du contenant déplacé (sémantique
   * `splice`, identique à `reorderRacks` de l'inventaire).
   */
  onReorderRacks?: (rackId: string, targetIdx: number) => void;
  className?: string;
};

export const LocationPlacementCanvas = forwardRef<
  LocationPlacementCanvasHandle,
  LocationPlacementCanvasProps
>(function LocationPlacementCanvas(
  {
    racks,
    view,
    viewMode,
    renderMode,
    onSlotSelect,
    onRackSlotsChange,
    onZoomChange,
    canvasTool = "select",
    onCanvasToolChange,
    registerRackCanvas,
    onReorderRacks,
    className,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Contenant éligible au drag en cours — publié par le DndContext parent.
  const dragEligibility = useRackDragEligibility();

  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panActive, setPanActive] = useState(false);
  const zoomRef = useRef(1);
  const fitZoomRef = useRef(0.2);
  const panRef = useRef({ active: false, x: 0, y: 0, ox: 0, oy: 0 });

  // ── Vue effective par contenant ──────────────────────────────────────────
  // Un contenant sans face arrière intérieure affiche sa face ARRIÈRE quand la
  // vue « Intérieur » est demandée (spec : la colonne reste présente).
  const viewForRack = useCallback(
    (rack: Rack): ViewId =>
      view === "REAR_INTERIOR" && rack.rearInteriorGapMm == null
        ? "REAR"
        : view,
    [view],
  );

  // ── Zoom / pan ───────────────────────────────────────────────────────────
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  useEffect(() => {
    onZoomChangeRef.current?.(zoom);
  }, [zoom]);

  const computeContentDims = useCallback(() => {
    const el = contentRef.current;
    if (el) return { cw: el.scrollWidth, ch: el.scrollHeight };
    // Fallback avant montage : estimation à partir des contenants.
    const colW =
      view === "SIDE"
        ? SIDE_PANEL_W * 2 +
          Math.max(
            60,
            Math.round(RACK_DEPTH_DEFAULT * PX_PER_MM * SIDE_VIEW_SCALE),
          )
        : RACK_BODY_W;
    const n = Math.max(1, racks.length);
    const maxU = racks.reduce((max, r) => Math.max(max, r.rack.totalU), 1);
    return {
      cw: n * colW + (n - 1) * COLUMN_GAP,
      // + traverses haut/bas du châssis + entête de colonne.
      ch: rackBodyHeight(maxU) + 80,
    };
  }, [racks, view]);

  const getAvailableSize = useCallback(() => {
    const el = containerRef.current;
    return {
      w: el?.clientWidth ?? window.innerWidth,
      h: el?.clientHeight ?? window.innerHeight,
    };
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
    fitZoomRef.current = zp;
    zoomRef.current = zp;
    setZoom(zp);
    panRef.current.ox = nx;
    panRef.current.oy = ny;
    setPanOffset({ x: nx, y: ny });
  }, [computeContentDims, getAvailableSize]);

  const centerContent = useCallback(() => {
    const { cw, ch } = computeContentDims();
    const { w, h } = getAvailableSize();
    const nx = (w - cw * zoom) / 2;
    const ny = (h - ch * zoom) / 2;
    panRef.current.ox = nx;
    panRef.current.oy = ny;
    setPanOffset({ x: nx, y: ny });
  }, [computeContentDims, getAvailableSize, zoom]);

  const ZOOM_STEP = 0.1;
  const zoomIn = useCallback(() => {
    const next = Math.min(
      2,
      parseFloat((zoomRef.current + ZOOM_STEP).toFixed(3)),
    );
    if (next === zoomRef.current) return;
    zoomRef.current = next;
    setZoom(next);
  }, []);
  const zoomOut = useCallback(() => {
    const next = Math.max(
      fitZoomRef.current,
      parseFloat((zoomRef.current - ZOOM_STEP).toFixed(3)),
    );
    if (next === zoomRef.current) return;
    zoomRef.current = next;
    setZoom(next);
  }, []);

  useImperativeHandle(
    ref,
    () => ({ fitAll, centerContent, zoomIn, zoomOut }),
    [fitAll, centerContent, zoomIn, zoomOut],
  );

  // Auto-fit au montage puis à chaque changement de composition (lieu, vue).
  const fitAllRef = useRef(fitAll);
  fitAllRef.current = fitAll;
  const compositionKey = useMemo(
    () => `${view}|${racks.map((r) => r.rack.id).join(",")}`,
    [view, racks],
  );
  useEffect(() => {
    const raf = requestAnimationFrame(() => fitAllRef.current());
    return () => cancelAnimationFrame(raf);
  }, [compositionKey]);

  // Pan (outil Déplacer, clic milieu) + zoom molette — mêmes gestes et mêmes
  // bornes que le canvas par contenant.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      const isMiddle = e.button === 1;
      if (!isMiddle && canvasTool !== "move") return;
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
    };
    const onMove = (e: PointerEvent) => {
      if (!panRef.current.active) return;
      const nx = panRef.current.ox + (e.clientX - panRef.current.x);
      const ny = panRef.current.oy + (e.clientY - panRef.current.y);
      panRef.current.ox = nx;
      panRef.current.oy = ny;
      panRef.current.x = e.clientX;
      panRef.current.y = e.clientY;
      setPanOffset({ x: nx, y: ny });
    };
    const onUp = () => {
      if (!panRef.current.active) return;
      panRef.current.active = false;
      setPanActive(false);
    };
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
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [canvasTool]);

  // Raccourcis outils — portés par le viewport (les canvases embarqués les
  // désactivent pour ne pas les déclencher N fois).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      )
        return;
      if (e.key === "s" || e.key === "S") onCanvasToolChange?.("select");
      if (e.key === "h" || e.key === "H") onCanvasToolChange?.("move");
      if (e.key === " ") {
        e.preventDefault();
        onCanvasToolChange?.("move");
      }
      if (e.key === "Escape") onSlotSelect?.(null);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") onCanvasToolChange?.("select");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [onCanvasToolChange, onSlotSelect]);

  const getZoom = useCallback(() => zoomRef.current, []);

  const canvasMenu = useMemo(
    () => [
      { id: "fit", label: "Ajuster à l'écran", onSelect: () => fitAll() },
      { id: "center", label: "Centrer", onSelect: () => centerContent() },
    ],
    [fitAll, centerContent],
  );

  // Enregistrement / désenregistrement des canvases par contenant.
  // Les callbacks de ref sont mémoïsés par rackId : une nouvelle identité à
  // chaque render ferait dés-enregistrer puis ré-enregistrer chaque canvas.
  // On garde AUSSI une copie locale des handles pour rendre la sélection
  // exclusive entre colonnes.
  const registerRef = useRef(registerRackCanvas);
  registerRef.current = registerRackCanvas;
  const handlesRef = useRef(new Map<string, RackPlacementCanvasHandle>());
  const canvasRefCacheRef = useRef(
    new Map<string, (handle: RackPlacementCanvasHandle | null) => void>(),
  );
  const makeCanvasRef = useCallback((rackId: string) => {
    const cache = canvasRefCacheRef.current;
    let cb = cache.get(rackId);
    if (!cb) {
      cb = (handle: RackPlacementCanvasHandle | null) => {
        if (handle) handlesRef.current.set(rackId, handle);
        else handlesRef.current.delete(rackId);
        registerRef.current?.(rackId, handle);
      };
      cache.set(rackId, cb);
    }
    return cb;
  }, []);

  // ── Sélection exclusive entre colonnes ───────────────────────────────────
  // Chaque canvas gère sa propre sélection locale : quand l'un publie un slot,
  // on purge (silencieusement) celle des autres pour n'avoir qu'un seul anneau
  // de sélection, et un seul panneau de propriétés.
  const onSlotSelectRef = useRef(onSlotSelect);
  onSlotSelectRef.current = onSlotSelect;
  const slotSelectCacheRef = useRef(
    new Map<string, (slot: Slot | null) => void>(),
  );
  const makeSlotSelect = useCallback((rackId: string) => {
    const cache = slotSelectCacheRef.current;
    let cb = cache.get(rackId);
    if (!cb) {
      cb = (slot: Slot | null) => {
        if (slot) {
          for (const [rid, h] of handlesRef.current) {
            if (rid !== rackId) h.clearSelection();
          }
        }
        onSlotSelectRef.current?.(slot);
      };
      cache.set(rackId, cb);
    }
    return cb;
  }, []);

  // Ghost de drag — rendu ICI, hors du wrapper transformé (cf.
  // `RackDragOverlayContent`). Tous les canvases publient le même item.
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);

  // Raison d'un dépôt refusé, par contenant : au plus une colonne est survolée
  // à la fois (les autres vident leur hover), donc la première valeur non nulle
  // est celle de la colonne courante.
  const [invalidByRack, setInvalidByRack] = useState<
    Record<string, string | null>
  >({});
  const invalidReason =
    Object.values(invalidByRack).find((r) => r != null) ?? null;
  const dropInvalidCacheRef = useRef(
    new Map<string, (reason: string | null) => void>(),
  );
  const makeDropInvalid = useCallback((rackId: string) => {
    const cache = dropInvalidCacheRef.current;
    let cb = cache.get(rackId);
    if (!cb) {
      cb = (reason: string | null) =>
        setInvalidByRack((prev) =>
          prev[rackId] === reason ? prev : { ...prev, [rackId]: reason },
        );
      cache.set(rackId, cb);
    }
    return cb;
  }, []);


  // ── Réordonnancement des colonnes (drag de l'entête) ─────────────────────
  // Drag manuel (pas dnd-kit) : le DndContext du tab est déjà dédié au
  // placement, et un simple suivi de pointeur suffit pour un déplacement
  // horizontal. `barX` est en coordonnées de CONTENU (pré-transform), donc
  // l'indicateur suit naturellement le pan/zoom du viewport.
  const [headerDrag, setHeaderDrag] = useState<{
    rackId: string;
    insertIdx: number;
    barX: number;
  } | null>(null);
  const headerDragRef = useRef<typeof headerDrag>(null);
  headerDragRef.current = headerDrag;

  const onReorderRef = useRef(onReorderRacks);
  onReorderRef.current = onReorderRacks;

  const startHeaderDrag = useCallback(
    (rackId: string) => (e: React.PointerEvent) => {
      if (!onReorderRef.current) return;
      // Ne pas déclencher le pan du viewport ni une sélection.
      e.stopPropagation();
      e.preventDefault();
      const content = contentRef.current;
      if (!content) return;

      const columns = () =>
        Array.from(
          content.querySelectorAll<HTMLElement>("[data-rack-column]"),
        );

      const compute = (clientX: number) => {
        const cols = columns();
        if (cols.length === 0) return null;
        const centers = cols.map((el) => {
          const r = el.getBoundingClientRect();
          return r.left + r.width / 2;
        });
        const insertIdx = centers.filter((c) => clientX > c).length;
        // Position de la barre, en coordonnées de contenu (offsetLeft n'est pas
        // affecté par le transform CSS de l'ancêtre).
        const barX =
          insertIdx < cols.length
            ? cols[insertIdx].offsetLeft - COLUMN_GAP / 2
            : cols[cols.length - 1].offsetLeft +
              cols[cols.length - 1].offsetWidth +
              COLUMN_GAP / 2;
        return { insertIdx, barX };
      };

      const initial = compute(e.clientX);
      if (!initial) return;
      setHeaderDrag({ rackId, ...initial });

      const onMove = (ev: PointerEvent) => {
        const next = compute(ev.clientX);
        if (!next) return;
        setHeaderDrag((prev) =>
          prev &&
          prev.insertIdx === next.insertIdx &&
          prev.barX === next.barX
            ? prev
            : { rackId, ...next },
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const drag = headerDragRef.current;
        setHeaderDrag(null);
        if (!drag) return;
        const ids = columns().map((el) => el.dataset.rackId ?? "");
        const srcIdx = ids.indexOf(drag.rackId);
        if (srcIdx === -1) return;
        // `insertIdx` est un index AVANT retrait : on le ramène en index
        // d'insertion après retrait (sémantique splice).
        const targetIdx =
          drag.insertIdx > srcIdx ? drag.insertIdx - 1 : drag.insertIdx;
        if (targetIdx === srcIdx) return;
        onReorderRef.current?.(drag.rackId, targetIdx);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [],
  );

  const headerDragCacheRef = useRef(
    new Map<string, (e: React.PointerEvent) => void>(),
  );
  const makeHeaderDrag = useCallback(
    (rackId: string) => {
      const cache = headerDragCacheRef.current;
      let cb = cache.get(rackId);
      if (!cb) {
        cb = startHeaderDrag(rackId);
        cache.set(rackId, cb);
      }
      return cb;
    },
    [startHeaderDrag],
  );

  return (
    <>
    <CanvasContextMenu items={canvasMenu}>
      <div
        className={cn(
          "relative h-full w-full overflow-hidden bg-[var(--background)]",
          className,
        )}
      >
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-hidden"
          style={{
            cursor: panActive
              ? "grabbing"
              : canvasTool === "move"
                ? "grab"
                : "default",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          >
            {/* data-rack-capture : nœud plein-contenu, hors wrapper pan/zoom.
                Plus consommé par l'export du Rack (qui compose sa propre page
                via `rack-export-composer`) — conservé comme cible stable pour
                une capture du canvas. */}
            <div
              ref={contentRef}
              data-rack-capture
              className="relative flex items-start p-0"
              style={{ gap: COLUMN_GAP }}
            >
              {/* Indicateur d'insertion pendant le réordonnancement. */}
              {headerDrag && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-40 rounded-full"
                  style={{
                    left: headerDrag.barX - 1.5,
                    width: 3,
                    background: "var(--accent)",
                  }}
                />
              )}
              {racks.map((item) => {
                // Contenant qui ne peut pas accueillir l'élément draggé : on
                // l'éteint (et on le rend inerte via `dropDisabled`) plutôt que
                // de laisser l'utilisateur viser une cible qui refusera.
                const inactive =
                  dragEligibility.dragging &&
                  dragEligibility.eligibleRackId != null &&
                  dragEligibility.eligibleRackId !== item.rack.id;
                return (
                <div
                  key={item.rack.id}
                  data-rack-column
                  data-rack-id={item.rack.id}
                  className="relative shrink-0"
                  style={{
                    opacity:
                      headerDrag?.rackId === item.rack.id
                        ? 0.45
                        : inactive
                          ? 0.4
                          : 1,
                    transition: "opacity 150ms ease-out",
                  }}
                >
                <RackPlacementCanvas
                  ref={makeCanvasRef(item.rack.id)}
                  embedded
                  headerLabel={item.rack.name}
                  onHeaderPointerDown={
                    onReorderRacks ? makeHeaderDrag(item.rack.id) : undefined
                  }
                  getExternalZoom={getZoom}
                  // Le ghost est rendu par CE conteneur, hors du transform.
                  renderDragOverlay={false}
                  onActiveItemChange={setActiveItem}
                  rack={item.rack}
                  initialSlots={item.slots}
                  allEquipment={item.allEquipment}
                  allPanels={item.allPanels}
                  rackAccessories={item.rackAccessories}
                  categories={item.categories}
                  patchPanelDepthMm={item.patchPanelDepthMm}
                  cableSafetyDepthMm={item.cableSafetyDepthMm}
                  visibleViews={[viewForRack(item.rack)]}
                  viewMode={viewMode}
                  renderMode={renderMode}
                  onDropInvalidChange={makeDropInvalid(item.rack.id)}
                  onSlotSelect={makeSlotSelect(item.rack.id)}
                  onSlotsChange={(slots) =>
                    onRackSlotsChange?.(item.rack.id, slots)
                  }
                  canvasTool={canvasTool}
                  dropDisabled={inactive}
                />
                </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </CanvasContextMenu>

    {/* Ghost de drag — hors du viewport ET de son wrapper `translate/scale` :
        un DragOverlay monté sous un ancêtre transformé se positionne dans le
        repère de cet ancêtre (et se retrouve donc très loin du curseur).
        Même placement qu'en mode contenant. */}
    <DragOverlay dropAnimation={null}>
      <RackDragOverlayContent active={activeItem} invalidReason={invalidReason} />
    </DragOverlay>
    </>
  );
});
