"use client";

/**
 * RackTabClient — composant canvas de l'onglet Rack du projet.
 *
 * Architecture :
 *  - Le state `selectedRackId | null` est piloté par le parent
 *    (project-editor) via la prop éponyme.
 *  - Le fetch de `canvasData` se fait à la demande au changement de
 *    `selectedRackId`. Le résultat est exposé au parent via la prop
 *    `onCanvasDataChange` (le side panel a besoin du même payload).
 *  - Le DndContext est fourni par `RackTabDndProvider` (rendu au niveau du
 *    project-editor), qui englobe sidebar + canvas + EditorShell entier.
 *    Le provider délègue les handlers DnD à un canvasRef partagé via le
 *    `RackTabDndContext`.
 *  - Layout : si pas de rack sélectionné → EmptyState. Sinon :
 *    <RackPlacementCanvas />.
 *
 * Le composant expose un `RackTabClientHandle` au parent (`project-editor`)
 * pour piloter zoom/fit/center depuis la toolbar gauche.
 */

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Loader2, MapPin, Server } from "@/components/ui/icons";

import { EmptyState } from "@/components/ui/empty-state";
import { api, getApiErrorMessage } from "@/lib/api-client";

import {
  RackPlacementCanvas,
  type RackPlacementCanvasHandle,
} from "./_components/rack-placement-canvas";
import {
  LocationPlacementCanvas,
  type LocationCanvasRack,
  type LocationPlacementCanvasHandle,
} from "./_components/location-placement-canvas";
import {
  IDLE_ELIGIBILITY,
  RackDragEligibilityCtx,
  type RackDragEligibility,
} from "./_components/rack-drag-eligibility";
import type {
  Equipment,
  PanelItem,
  Rack,
  Slot,
  ViewId,
} from "@/components/synoptique/lib/types";
import { useProjectSync } from "../_hooks/use-project-sync";

// ── Types ────────────────────────────────────────────────────────────────────

type CategoryWithChildren = {
  id: string;
  name: string;
  color: string;
  children: { id: string; name: string; color: string }[];
};

type ConnectorTypeDef = {
  id: string;
  name: string;
  version: string | null;
  iconId: string;
  color: string;
  category: string;
};

type SignalTypeDef = {
  name: string;
  color: string;
  cablePrefix: string | null;
  cableSuffix: string | null;
  category?: string | null;
  categoryRef?: {
    name: string;
    cablePrefix: string | null;
    cableSuffix: string | null;
  } | null;
};

type SignalCategoryDef = {
  name: string;
  cablePrefix: string | null;
  cableSuffix: string | null;
};

export type RackCanvasData = {
  rack: Rack;
  allEquipment: Equipment[];
  rackAccessories: Equipment[];
  allPanels: PanelItem[];
  categories: CategoryWithChildren[];
  connectorTypes: ConnectorTypeDef[];
  signals: SignalTypeDef[];
  signalCategories: SignalCategoryDef[];
  patchPanelDepthMm: number;
  cableSafetyDepthMm: number;
};

/**
 * Payload agrégé du mode « par emplacement » : un `canvas-data` par contenant
 * du lieu (même route que le mode contenant, appelée en parallèle).
 */
export type LocationCanvasData = {
  locationId: string;
  racks: RackCanvasData[];
};

export type RackTabClientHandle = {
  fitAll: () => void;
  centerContent: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

// ── Context partagé entre le DnD provider et le canvas ───────────────────────
//
// Permet au `<DndContext>` (rendu par RackTabDndProvider, niveau project-editor,
// englobant l'EditorShell) de déléguer onDragStart/Over/End au canvasRef
// défini par le `<RackTabClient>` (rendu dans le slot canvas du shell).

type RackTabDndCtxValue = {
  registerCanvas: (handle: RackPlacementCanvasHandle | null) => void;
  /**
   * Enregistre le canvas d'UN contenant en affichage multi-rack (par
   * emplacement). Le provider adresse alors chaque drop au contenant survolé.
   */
  registerRackCanvas: (
    rackId: string,
    handle: RackPlacementCanvasHandle | null,
  ) => void;
};

const RackTabDndCtx = createContext<RackTabDndCtxValue | null>(null);

function useRackTabDnd(): RackTabDndCtxValue {
  const ctx = useContext(RackTabDndCtx);
  if (!ctx) {
    throw new Error(
      "useRackTabDnd must be used within <RackTabDndProvider>",
    );
  }
  return ctx;
}

// ── RackTabDndProvider ───────────────────────────────────────────────────────
//
// Wrappe `<EditorShell>` au niveau du project-editor pour partager le même
// DndContext entre la sidebar (draggables) et le canvas (droppables).

export function RackTabDndProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const canvasRef = useRef<RackPlacementCanvasHandle | null>(null);
  // Affichage par emplacement : un canvas par contenant, indexé par rackId.
  const rackCanvasesRef = useRef(new Map<string, RackPlacementCanvasHandle>());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 10 },
    }),
  );

  const [eligibility, setEligibility] =
    useState<RackDragEligibility>(IDLE_ELIGIBILITY);

  // Le drag start / over est DIFFUSÉ à tous les canvases : la cible réelle
  // n'est connue qu'au survol, et chaque canvas filtre lui-même les cellules
  // qui ne lui appartiennent pas (cf. `embedded` dans RackPlacementCanvas).
  const handleDragStart = useCallback((event: DragStartEvent) => {
    canvasRef.current?.handleDragStart(event);
    for (const h of rackCanvasesRef.current.values()) h.handleDragStart(event);

    // Contenant propriétaire de l'élément draggé → seul éligible au dépôt.
    const data = event.active.data.current;
    let owner = (data?.sourceRackId as string | undefined) ?? null;
    if (!owner && typeof data?.parentSlotId === "string") {
      // Enfant d'étagère : pas de `sourceRackId` dans son payload, on remonte
      // au contenant qui porte l'étagère parente.
      for (const [rid, h] of rackCanvasesRef.current) {
        if (h.ownsSlot(data.parentSlotId as string)) {
          owner = rid;
          break;
        }
      }
    }
    setEligibility({ dragging: true, eligibleRackId: owner });
  }, []);
  const handleDragOver = useCallback((event: DragOverEvent) => {
    canvasRef.current?.handleDragOver(event);
    for (const h of rackCanvasesRef.current.values()) h.handleDragOver(event);
  }, []);
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setEligibility(IDLE_ELIGIBILITY);
    await canvasRef.current?.handleDragEnd(event);
    const canvases = rackCanvasesRef.current;
    if (canvases.size === 0) return;
    // Résolution du contenant cible :
    //  - cellule de rack : `rackId` porté par la data du droppable ;
    //  - étagère : le contenant qui possède le slot d'étagère survolé.
    const overData = event.over?.data.current as
      | { rackId?: string; shelfSlotId?: string }
      | undefined;
    let targetRackId: string | null = overData?.rackId ?? null;
    if (!targetRackId && overData?.shelfSlotId) {
      for (const [rid, h] of canvases) {
        if (h.ownsSlot(overData.shelfSlotId)) {
          targetRackId = rid;
          break;
        }
      }
    }
    for (const [rid, h] of canvases) {
      if (rid === targetRackId) await h.handleDragEnd(event);
      else h.cancelDrag();
    }
    // Équipement non rackable lâché hors d'une étagère : aucun contenant n'est
    // ciblé, donc aucun `handleDragEnd` n'a tourné et le drop serait muet. On
    // demande le message au contenant survolé — le premier qui répond `true`
    // l'a affiché, on s'arrête (un seul message, pas un par colonne).
    if (
      targetRackId === null &&
      event.active.data.current?.type === "shelf-equipment"
    ) {
      for (const h of canvases.values()) {
        if (h.notifyShelfOnlyMiss()) break;
      }
    }
  }, []);

  /**
   * Drag abandonné (Échap, perte du pointeur) : dnd-kit n'appelle PAS
   * `onDragEnd`. Sans ce handler, les canvases gardaient leur `active` et
   * l'affichage restait éteint.
   */
  const handleDragCancel = useCallback(() => {
    setEligibility(IDLE_ELIGIBILITY);
    canvasRef.current?.cancelDrag();
    for (const h of rackCanvasesRef.current.values()) h.cancelDrag();
  }, []);

  const registerCanvas = useCallback(
    (handle: RackPlacementCanvasHandle | null) => {
      canvasRef.current = handle;
    },
    [],
  );
  const registerRackCanvas = useCallback(
    (rackId: string, handle: RackPlacementCanvasHandle | null) => {
      if (handle) rackCanvasesRef.current.set(rackId, handle);
      else rackCanvasesRef.current.delete(rackId);
    },
    [],
  );

  const ctxValue = useMemo<RackTabDndCtxValue>(
    () => ({ registerCanvas, registerRackCanvas }),
    [registerCanvas, registerRackCanvas],
  );

  return (
    <RackTabDndCtx.Provider value={ctxValue}>
      <RackDragEligibilityCtx.Provider value={eligibility}>
      <DndContext
        sensors={sensors}
        // `pointerWithin` : la cible est le droppable EXACTEMENT sous le
        // curseur. Le défaut (`rectIntersection`) compare le rect de l'aperçu
        // draggé — rendu hors du wrapper transformé, donc à l'échelle 1 —
        // avec des cellules mises à l'échelle par le zoom du canvas : dès que
        // le zoom s'éloigne de 1 (systématique en affichage par emplacement,
        // où le fit réduit plusieurs contenants), l'aperçu déborde largement
        // sur les colonnes voisines et la cellule retenue n'est plus celle
        // visée — le déplacement interne d'un équipement était alors routé
        // vers la colonne d'à côté, donc refusé (élément d'un autre contenant).
        collisionDetection={pointerWithin}
        // Auto-scroll dnd-kit désactivé. Le canvas rack se navigue au pan/zoom
        // (ses viewports sont en `overflow-hidden`, donc jamais candidats) : le
        // SEUL ancêtre défilable de la chaîne de drag est la liste « Éléments à
        // placer » du panneau latéral, d'où partent les items du BOM. Dès que
        // le pointeur approchait — ou dépassait — ses bords en allant vers le
        // canvas, dnd-kit la faisait défiler en continu ; au drop, le
        // re-rendu de la liste (recalcul des `remaining`) la remettait en
        // place : c'est le « la colonne se scrolle puis revient » observé.
        // Rien ne doit bouger pendant un drag hormis l'aperçu et le ghost.
        autoScroll={false}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
      </DndContext>
      </RackDragEligibilityCtx.Provider>
    </RackTabDndCtx.Provider>
  );
}

// ── RackTabClient — canvas slot ──────────────────────────────────────────────

export const RackTabClient = forwardRef<
  RackTabClientHandle,
  {
    projectId: string;
    selectedRackId: string | null;
    visibleViews: ViewId[];
    viewMode: "real" | "schema";
    /** Mode de rendu des équipements (standard / graphic / photo). */
    renderMode?: "standard" | "graphic" | "photo";
    onSlotSelect?: (slot: Slot | null) => void;
    /**
     * Notifie le parent du payload `canvas-data` chargé. Le side panel
     * réutilise ce même payload (allEquipment / allPanels / slots) pour
     * éviter une seconde requête.
     */
    onCanvasDataChange?: (data: RackCanvasData | null) => void;
    /** Notifié à chaque changement du zoom interne du canvas. */
    onZoomChange?: (zoom: number) => void;
    /**
     * Notifie le parent à chaque changement local des slots (placement /
     * suppression / déplacement). Permet à la sidebar BOM de recalculer
     * les `remaining` pour les instances draggables.
     */
    onSlotsChange?: (slots: Slot[]) => void;
    /** Outil canvas (controlled). */
    canvasTool?: "select" | "move";
    /** Notifié quand l'outil change (raccourcis clavier). */
    onCanvasToolChange?: (tool: "select" | "move") => void;
    /**
     * Portée d'affichage. `"container"` (défaut) = comportement historique,
     * un seul contenant + drag & drop. `"location"` = tous les contenants du
     * lieu côte à côte, en lecture seule.
     */
    displayScope?: "container" | "location";
    /** Emplacement affiché en portée `location`. */
    locationId?: string | null;
    /** Contenants rackables du lieu, dans l'ordre d'affichage. */
    locationRackIds?: string[];
    /** Vue unique appliquée à tous les contenants en portée `location`. */
    locationView?: ViewId;
    /** Notifie le parent du payload agrégé du lieu (panneau droit). */
    onLocationDataChange?: (data: LocationCanvasData | null) => void;
    /**
     * Slots à jour d'un contenant du lieu (placement / retrait) — permet à la
     * sidebar de recalculer les `remaining` du BOM de ce contenant.
     */
    onLocationRackSlotsChange?: (rackId: string, slots: Slot[]) => void;
    /**
     * Réordonne les contenants du lieu (drag de l'entête de colonne).
     * `targetIdx` = index visé dans la liste des contenants du lieu.
     */
    onReorderLocationRacks?: (rackId: string, targetIdx: number) => void;
  }
>(function RackTabClient(
  {
    projectId,
    selectedRackId,
    visibleViews,
    viewMode,
    renderMode,
    onSlotSelect,
    onCanvasDataChange,
    onZoomChange,
    onSlotsChange,
    canvasTool,
    onCanvasToolChange,
    displayScope = "container",
    locationId = null,
    locationRackIds,
    locationView = "FRONT",
    onLocationDataChange,
    onLocationRackSlotsChange,
    onReorderLocationRacks,
  },
  ref,
) {
  const isLocationScope = displayScope === "location";
  const onLocationRackSlotsChangeRef = useRef(onLocationRackSlotsChange);
  onLocationRackSlotsChangeRef.current = onLocationRackSlotsChange;
  const handleLocationRackSlotsChange = useCallback(
    (rackId: string, slots: Slot[]) => {
      onLocationRackSlotsChangeRef.current?.(rackId, slots);
    },
    [],
  );
  const { registerCanvas, registerRackCanvas } = useRackTabDnd();
  const canvasRef = useRef<RackPlacementCanvasHandle | null>(null);
  const locationCanvasRef = useRef<LocationPlacementCanvasHandle | null>(null);
  const [canvasData, setCanvasData] = useState<RackCanvasData | null>(null);
  const [locationData, setLocationData] = useState<LocationCanvasData | null>(
    null,
  );
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Compteur de rafraîchissement (incrémenté par useProjectSync) — re-fetch
  // les canvas-data quand un autre client modifie un slot/BOM/rack de ce rack.
  const [refreshTick, setRefreshTick] = useState(0);

  // SSE — refetch les canvas-data sur events du projet. Couvre les modifs
  // BOM (inventory), slot placement, rack proprieties (depthMm, totalU, …).
  // Le filtre `rackId` reste optionnel : on accepte aussi les events scope
  // projet (ex. ajout BOM) sans rackId explicite — toute mutation peut
  // impacter la BOM affichée dans la sidebar du rack tab.
  useProjectSync({
    projectId,
    entities: [
      "rack_inventory",
      "rack",
      "rig",
      "slot",
      "rackConnection",
      // Catalogue supervisor : refetch sur modif équipement/signal/connecteur.
      "catalog",
    ],
    acceptUnscoped: true,
    // includeOwn: true — nos propres mutations (placement slot, édition rack)
    // déclenchent un refetch silencieux des canvas-data. Sans ça, les
    // enrichissements faits côté serveur (couleur de la fonction primaire,
    // catégorie réelle, metadata catalogue) restent absents tant que le user
    // ne recharge pas.
    includeOwn: true,
    onUpdate: () => setRefreshTick((t) => t + 1),
  });

  // ── Fetch canvas-data au changement de rack sélectionné ──────────────────
  // Fetch initial (`refreshTick === 0` après changement de rackId) : passe
  // en `loading` + reset canvasData pour afficher le loader.
  // Refetch déclenché par SSE / propre mutation (`refreshTick > 0`) : silencieux,
  // garde le canvasData courant pendant le fetch, écrase à l'arrivée. Évite
  // le flash blanc au placement (l'utilisateur voit la card en place, et les
  // métadonnées enrichies — couleur, catégorie, voisins — apparaissent dans
  // le right panel sans transition de loading).
  useEffect(() => {
    // En portée emplacement, le fetch mono-rack est inactif (l'agrégat
    // ci-dessous prend le relais).
    if (isLocationScope || !selectedRackId) {
      setCanvasData(null);
      setLoadError(null);
      onCanvasDataChange?.(null);
      return;
    }
    let cancelled = false;
    const isInitial = refreshTick === 0 || canvasData === null;
    if (isInitial) setLoading(true);
    setLoadError(null);
    api
      .get<RackCanvasData>(
        `/api/tenant/projects/${projectId}/racks/${selectedRackId}/canvas-data`,
      )
      .then((data) => {
        if (cancelled) return;
        setCanvasData(data);
        onCanvasDataChange?.(data);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(getApiErrorMessage(e));
        if (isInitial) {
          setCanvasData(null);
          onCanvasDataChange?.(null);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // onCanvasDataChange exclu pour éviter un re-fetch si le parent change
    // l'identité du callback (cas typique : closure over state).
    // canvasData exclu pour ne pas se déclencher en boucle après écrasement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedRackId, refreshTick, isLocationScope]);

  // ── Fetch agrégé du lieu : un canvas-data par contenant, en parallèle ────
  // Peu de contenants par lieu (unités), la route est déjà indexée par rack :
  // un Promise.all reste plus simple et plus sûr qu'une nouvelle route.
  const locationRackIdsKey = (locationRackIds ?? []).join(",");
  useEffect(() => {
    if (!isLocationScope || !locationId) {
      setLocationData(null);
      setLocationError(null);
      setLocationLoading(false);
      onLocationDataChange?.(null);
      return;
    }
    const ids = locationRackIdsKey ? locationRackIdsKey.split(",") : [];
    if (ids.length === 0) {
      setLocationData({ locationId, racks: [] });
      setLocationError(null);
      setLocationLoading(false);
      onLocationDataChange?.({ locationId, racks: [] });
      return;
    }
    let cancelled = false;
    // Premier chargement de ce lieu → loader ; refetch SSE → swap silencieux.
    if (!locationData || locationData.locationId !== locationId) {
      setLocationLoading(true);
    }
    setLocationError(null);
    Promise.all(
      ids.map((rid) =>
        api.get<RackCanvasData>(
          `/api/tenant/projects/${projectId}/racks/${rid}/canvas-data`,
        ),
      ),
    )
      .then((payloads) => {
        if (cancelled) return;
        const next: LocationCanvasData = { locationId, racks: payloads };
        setLocationData(next);
        onLocationDataChange?.(next);
        setLocationLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLocationError(getApiErrorMessage(e));
        setLocationLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `locationData` exclu : il est écrit par cet effet (boucle sinon).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, isLocationScope, locationId, locationRackIdsKey, refreshTick]);

  // ── Handle exposé au parent : pilote zoom/fit/center via le canvas actif ──
  useImperativeHandle(
    ref,
    () => ({
      fitAll: () =>
        isLocationScope
          ? locationCanvasRef.current?.fitAll()
          : canvasRef.current?.fitAll(),
      centerContent: () =>
        isLocationScope
          ? locationCanvasRef.current?.centerContent()
          : canvasRef.current?.centerContent(),
      zoomIn: () =>
        isLocationScope
          ? locationCanvasRef.current?.zoomIn()
          : canvasRef.current?.zoomIn(),
      zoomOut: () =>
        isLocationScope
          ? locationCanvasRef.current?.zoomOut()
          : canvasRef.current?.zoomOut(),
    }),
    [isLocationScope],
  );

  // ── Enregistre le canvasRef auprès du DndProvider à chaque montage ────────
  // Le ref callback est appelé au mount (handle disponible) et au unmount
  // (handle = null), ce qui permet de nettoyer proprement quand on change
  // de rack.
  const setCanvasNodeRef = useCallback(
    (node: RackPlacementCanvasHandle | null) => {
      canvasRef.current = node;
      registerCanvas(node);
    },
    [registerCanvas],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (isLocationScope) {
    if (!locationId) {
      return (
        <div className="flex h-full items-center justify-center px-8 py-6">
          <EmptyState
            icon={<MapPin strokeWidth={1.5} />}
            title="Sélectionnez un emplacement"
            description="Choisissez un emplacement dans la sous-barre pour afficher tous ses contenants côte à côte."
          />
        </div>
      );
    }
    if (locationLoading || !locationData) {
      return (
        <div className="flex h-full items-center justify-center">
          {locationError ? (
            <EmptyState
              icon={<MapPin strokeWidth={1.5} />}
              title="Erreur de chargement"
              description={locationError}
            />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          )}
        </div>
      );
    }
    if (locationData.racks.length === 0) {
      return (
        <div className="flex h-full items-center justify-center px-8 py-6">
          <EmptyState
            icon={<MapPin strokeWidth={1.5} />}
            title="Aucun contenant rackable"
            description="Cet emplacement n'a pas encore de contenant rackable. Ajoutez-en un depuis l'onglet Inventaire."
          />
        </div>
      );
    }
    const locationRacks: LocationCanvasRack[] = locationData.racks.map((d) => ({
      rack: d.rack,
      slots: d.rack.slots,
      allEquipment: d.allEquipment,
      allPanels: d.allPanels,
      rackAccessories: d.rackAccessories,
      categories: d.categories,
      patchPanelDepthMm: d.patchPanelDepthMm,
      cableSafetyDepthMm: d.cableSafetyDepthMm,
    }));
    return (
      <LocationPlacementCanvas
        key={locationData.locationId}
        ref={locationCanvasRef}
        racks={locationRacks}
        onReorderRacks={onReorderLocationRacks}
        view={locationView}
        viewMode={viewMode}
        renderMode={renderMode}
        onSlotSelect={onSlotSelect}
        onRackSlotsChange={handleLocationRackSlotsChange}
        onZoomChange={onZoomChange}
        canvasTool={canvasTool}
        onCanvasToolChange={onCanvasToolChange}
        registerRackCanvas={registerRackCanvas}
      />
    );
  }

  if (!selectedRackId) {
    return (
      <div className="flex h-full items-center justify-center px-8 py-6">
        <EmptyState
          icon={<Server strokeWidth={1.5} />}
          title="Sélectionnez un contenant"
          description="Choisissez un contenant dans le panneau de gauche pour commencer à placer ses équipements."
        />
      </div>
    );
  }
  if (loading || !canvasData) {
    return (
      <div className="flex h-full items-center justify-center">
        {loadError ? (
          <EmptyState
            icon={<Server strokeWidth={1.5} />}
            title="Erreur de chargement"
            description={loadError}
          />
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
        )}
      </div>
    );
  }
  return (
    <RackPlacementCanvas
      // key={rackId} : force le remount à chaque changement de rack pour
      // réinitialiser le state local (slots, pan/zoom, sélection…) — évite
      // que le merge SSE de useRackSync ne mélange des slots de racks
      // différents.
      key={canvasData.rack.id}
      ref={setCanvasNodeRef}
      rack={canvasData.rack}
      initialSlots={canvasData.rack.slots}
      allEquipment={canvasData.allEquipment}
      allPanels={canvasData.allPanels}
      rackAccessories={canvasData.rackAccessories}
      categories={canvasData.categories}
      patchPanelDepthMm={canvasData.patchPanelDepthMm}
      cableSafetyDepthMm={canvasData.cableSafetyDepthMm}
      visibleViews={visibleViews}
      viewMode={viewMode}
      renderMode={renderMode}
      onSlotSelect={onSlotSelect}
      onSlotsChange={onSlotsChange}
      onZoomChange={onZoomChange}
      canvasTool={canvasTool}
      onCanvasToolChange={onCanvasToolChange}
    />
  );
});
