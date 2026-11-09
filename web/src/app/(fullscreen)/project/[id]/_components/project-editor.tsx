"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Cable, Download, Server, X } from "@/components/ui/icons";

import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { cn } from "@/lib/utils";

import {
  EditorShell,
  type EditorShellSlots,
} from "@/components/editor-shell/editor-shell";
import type { SaveStatus } from "../_editor/project-contextual-topbar";
import { WorkspaceProvider } from "@/components/editor-shell/workspace-context";
import { Group } from "@/components/editor-shell/tool-topbar-ui";

import type { ProjectTabId, TabDescriptor } from "../_editor/tab-bar";
import {
  type ProjectHeaderData,
  type ProjectStatus,
} from "../_editor/project-header-block";
import { ProjectGlobalTopbar } from "../_editor/project-global-topbar";
import { DossierWizard } from "./dossier-wizard/dossier-wizard";
import {
  buildDossierDataGenerators,
  buildDossierDataSources,
} from "./dossier-generators";
import {
  usePendingExport,
  usePendingExportStore,
} from "./pending-export-store";
import { ProjectCharacteristicsDialog } from "../_editor/project-characteristics-dialog";
import { DrawingTabClient, type DrawingKind } from "./drawing-tab-client";
import { LumiereTabClient, type LumiereSubTab } from "./lumiere-tab-client";
import { ProjectContextualTopbar } from "../_editor/project-contextual-topbar";
import { ProjectTabsPill } from "../_editor/project-tabs-pill";
import { ProjectInfoPanel } from "../_editor/project-info-panel";
import { type ProjectFicheData } from "../fiche/fiche-client";
import {
  InventaireClient,
  type InventaireClientHandle,
  type InventaireLocation,
  type InventaireRack,
} from "../inventaire/inventaire-client";
import { ContainerPropertiesPanel } from "../inventaire/_components/container-properties-panel";
import { LocationPropertiesPanel } from "../inventaire/_components/location-properties-panel";
import { ItemPropertiesPanel } from "../inventaire/_components/item-properties-panel";
import { InventaireInfoPanel } from "../inventaire/_components/inventaire-info-panel";
import { InventaireExport } from "../inventaire/_components/inventaire-export";
import { RackInfoPanel } from "../rack/_components/rack-info-panel";
import { RackExport } from "../rack/_components/rack-export";
import { InventaireContextualTopbar } from "../inventaire/_components/inventaire-contextual-topbar";
import {
  InventaireScope,
  UNASSIGNED_LOCATION_ID,
  useInventaireScope,
} from "../inventaire/_components/inventaire-scope";
import {
  INVENTAIRE_TOOL_DEFS,
  InventaireLeftToolbar,
  isInventaireToolId,
  type InventaireToolId,
} from "../inventaire/_components/inventaire-left-toolbar";
import { InventaireSidePanel } from "../inventaire/_components/inventaire-side-panel";
import {
  RackTabClient,
  RackTabDndProvider,
  type RackTabClientHandle,
  type RackCanvasData,
  type LocationCanvasData,
} from "../rack/rack-tab-client";
import { StrataRackDrawerTop } from "@/strata/editor/rack-strata"; // arkyo-server: interface Strata
import { withStrataSaveStatus } from "@/strata/shell/save-status"; // arkyo-server: interface Strata
import { ManageShell, useStrataManageSpace } from "@/strata/manage/manage-shell"; // arkyo-server: interface Strata
import {
  RackTabLeftToolbar,
  type RackRenderMode,
  type RackDisplayScope,
} from "../rack/_components/rack-tab-left-toolbar";
import { RackLocationSelectorDropdown } from "../rack/_components/rack-location-selector-dropdown";
import { RackLocationInfoPanel } from "../rack/_components/rack-location-info-panel";
import { ChevronDown, Server as ServerIcon } from "@/components/ui/icons";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  RackTabSidePanel,
  RackTabLocationSidePanel,
} from "../rack/_components/rack-tab-side-panel";
import type {
  Equipment,
  PanelItem,
  RowLevels,
  Slot,
  ViewId,
} from "@/components/synoptique/lib/types";
import { SlotPropertiesPanel } from "@/components/synoptique/components/slot-properties-panel";
import { PortLabelEditor } from "@/app/(app)/rigs/[id]/rack/[rackId]/_components/port-label-editor";
import { CategoryColorCtx } from "@/components/synoptique/lib/colors";
import { SynoptiqueTabClient } from "../synoptique/synoptique-tab-client";
import {
  CartographieScope,
  useCartographieScope,
  type CartoMap,
} from "../cartographie/_components/cartographie-scope";
import { CartographieLeftToolbar } from "../cartographie/_components/cartographie-left-toolbar";
import { CartographieTopbarHost } from "../cartographie/_components/cartographie-topbar-host";
import { CartographieRightPanel } from "../cartographie/_components/cartographie-right-panel";
import { CartographieSidePanelPlace } from "../cartographie/_components/cartographie-side-panel-place";
import {
  CartographieClient,
  type CartographieClientHandle,
} from "../cartographie/cartographie-tab-client";
import { CablageTabClient } from "../cablage/_components/cablage-tab-client";
import { CablageTopbarHost } from "../cablage/_components/cablage-topbar-host";
import { RecetteTabClient } from "../recette/_components/recette-tab-client";
import { RecetteTopbarHost } from "../recette/_components/recette-topbar-host";
import { ReseauTabClient } from "../reseau/_components/reseau-tab-client";
import { ReseauTopbarHost } from "../reseau/_components/reseau-topbar-host";
import {
  useReseauStore,
  type ReseauSection,
} from "../reseau/_components/reseau-store";

const STORAGE_KEY = "project-editor-tab";

const TABS: TabDescriptor[] = [
  { id: "inventaire", label: "Inventaire" },
  { id: "rack", label: "Rack" },
  { id: "synoptique", label: "Synoptique" },
  { id: "schema", label: "Schémas" },
  { id: "cartographie", label: "Plan" },
  { id: "video", label: "Vidéo" },
  { id: "audio", label: "Audio" },
  {
    id: "lumiere",
    label: "Lumière",
    subTabs: [
      { id: "plan", label: "Plan de feu" },
      { id: "dmx", label: "Adressage DMX" },
    ],
  },
  {
    id: "reseau",
    label: "Réseau",
    subTabs: [
      { id: "ipmap", label: "Map" },
      { id: "devices", label: "Adressage IP" },
      { id: "addressing2110", label: "Adressage 2110" },
      { id: "configuration", label: "Configuration" },
    ],
  },
  // Groupe « Livraison » — dropdown dont les items sont de VRAIS onglets
  // (Préparation / Recette). `id` = simple clé d'affichage (le 1er membre).
  {
    id: "preparation",
    label: "Livraison",
    navGroup: true,
    subTabs: [
      { id: "preparation", label: "Préparation" },
      { id: "recette", label: "Recette" },
    ],
  },
];

// Tous les ids d'onglets RÉELS (navigables) — sert à valider ?tab= et le
// localStorage, indépendamment du layout de la pill (qui regroupe certains
// onglets sous des dropdowns).
const ALL_TAB_IDS: ProjectTabId[] = [
  "inventaire",
  "rack",
  "schema",
  "synoptique",
  "cartographie",
  "video",
  "audio",
  "lumiere",
  "reseau",
  "preparation",
  "recette",
];

// Onglets adossés directement à l'éditeur de plans (ProjectDrawing), un type
// par onglet. L'onglet "lumiere" n'est PAS ici : il a 2 sous-onglets (Plan de
// feu + Adressage DMX) gérés par `LumiereTabClient`.
const DRAWING_KIND_BY_TAB: Partial<Record<ProjectTabId, DrawingKind>> = {
  schema: "SCHEMA",
  video: "CAMERAS",
  audio: "AUDIO",
};

const isTabId = (v: unknown): v is ProjectTabId =>
  typeof v === "string" && ALL_TAB_IDS.includes(v as ProjectTabId);

/**
 * Migration : les anciennes URL `?tab=construction` puis `?tab=cablage`
 * (l'onglet a été renommé en `preparation`), et `?tab=fiche` (l'onglet a
 * été supprimé — la fiche est désormais dans le panel droit) sont
 * remappées proprement.
 */
const normalizeTabId = (v: string | null | undefined): ProjectTabId | null => {
  if (!v) return null;
  if (v === "construction" || v === "cablage") return "preparation";
  if (v === "fiche") return "inventaire";
  return isTabId(v) ? v : null;
};

export type ProjectEditorData = {
  header: ProjectHeaderData;
  fiche: ProjectFicheData;
  inventaire: {
    rigConfigId: string | null;
    /**
     * TOUS les racks du projet, y compris les racks virtuels des lieux
     * (`isVirtual`). Les consommateurs qui LISTENT des contenants doivent
     * filtrer `!r.isVirtual` (cf. `nonVirtualRacks`) ; ceux qui agrègent le
     * BOM les gardent.
     */
    racks: InventaireRack[];
    locations: InventaireLocation[];
  };
  cartographie: {
    maps: CartoMap[];
  };
};

/**
 * Éditeur projet plein écran (`EditorShell` partagé avec le rack-editor).
 *
 * Architecture :
 *  - Topbar globale = `ProjectGlobalTopbar` (logo + breadcrumb + statut + onglets pill)
 *  - Slots du shell composés par onglet via `getEditorSlots(activeTab)`.
 *  - L'onglet Inventaire active une toolbar verticale + un side panel
 *    dynamique (selon `activeTool`). Les autres onglets restent en
 *    placeholder pour MVP — pas de toolbar/sidepanel.
 */
export function ProjectEditor({
  project,
  tenantName,
}: {
  project: ProjectEditorData;
  tenantName: string | null;
}) {
  return (
    <WorkspaceProvider workspace="design">
      <ProjectEditorInner project={project} tenantName={tenantName} />
    </WorkspaceProvider>
  );
}

function ProjectEditorInner({
  project,
  tenantName,
}: {
  project: ProjectEditorData;
  tenantName: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryTab = searchParams?.get("tab");

  // Liste des CONTENANTS réels : les racks virtuels des lieux (porteurs des
  // équipements libres) ne sont jamais listés comme contenants — dropdown
  // Rack, synoptique, documents, plan… Leurs items restent visibles via le
  // scope inventaire (BOM, exports).
  const nonVirtualRacks = useMemo(
    () => project.inventaire.racks.filter((r) => !r.isVirtual),
    [project.inventaire.racks],
  );

  // ── Statut courant (optimistic update via badge interactif de la topbar) ──
  const [status, setStatus] = useState<ProjectStatus>(project.header.status);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  // Modal d'édition des caractéristiques (icône ⚙ dans la topbar).
  const [characteristicsOpen, setCharacteristicsOpen] = useState(false);
  const openCharacteristics = useCallback(() => setCharacteristicsOpen(true), []);
  // Auto-hide du badge "Enregistré" / "Échec" après quelques secondes.
  useEffect(() => {
    if (saveStatus !== "saved" && saveStatus !== "error") return;
    const ms = saveStatus === "saved" ? 2200 : 4000;
    const t = setTimeout(() => setSaveStatus("idle"), ms);
    return () => clearTimeout(t);
  }, [saveStatus]);

  const handleStatusChange = async (next: ProjectStatus) => {
    if (next === status) return;
    const previous = status;
    setStatus(next);
    setSaveStatus("saving");
    try {
      await api.patch(`/api/tenant/projects/${project.header.id}`, { status: next });
      setSaveStatus("saved");
    } catch (e) {
      setStatus(previous);
      setSaveStatus("error");
      window.alert(getApiErrorMessage(e));
    }
  };

  // ── Active tab : URL ?tab= prend le pas, sinon localStorage, sinon "inventaire" ─
  const [storedTab, setStoredTab] = useLocalStorageState<ProjectTabId>(
    STORAGE_KEY,
    "inventaire",
    { isValid: isTabId },
  );

  const activeTab: ProjectTabId = useMemo(() => {
    const normalized = normalizeTabId(queryTab);
    if (normalized) return normalized;
    return storedTab;
  }, [queryTab, storedTab]);
  const strataManage = useStrataManageSpace(); // arkyo-server: interface Strata — espace Gérer (`?space=gerer`, Strata seulement) ; toujours faux en Classique.

  // Sous-onglet de l'onglet Lumière (Plan de feu / Adressage DMX), piloté par
  // le dropdown de la pill, persisté.
  const [lumiereSubTab, setLumiereSubTab] = useLocalStorageState<LumiereSubTab>(
    "project-lumiere-subtab",
    "plan",
    { isValid: (v): v is LumiereSubTab => v === "plan" || v === "dmx" },
  );

  // Section active de l'onglet Réseau — pilotée par le dropdown de la pill.
  // La source de vérité reste le store réseau (persisté).
  const reseauSection = useReseauStore((s) => s.activeSection);
  const setReseauSection = useReseauStore((s) => s.setActiveSection);

  useEffect(() => {
    if (!queryTab || !isTabId(queryTab)) {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("tab", activeTab);
      router.replace(`/project/${project.header.id}?${params.toString()}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryTab]);

  const handleTabChange = (id: ProjectTabId) => {
    setStoredTab(id);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", id);
    router.replace(`/project/${project.header.id}?${params.toString()}`, { scroll: false });
  };

  /**
   * Bascule sur un onglet EN LUI DEMANDANT d'ouvrir son export.
   *
   * L'ordre compte : le signal est posé AVANT la navigation, pour être déjà là
   * quand l'onglet se monte. L'inverse laisserait passer les onglets qui
   * lisent le signal à leur premier rendu.
   */
  const requestExport = usePendingExportStore((s) => s.requestExport);
  const goToTabExport = useCallback(
    (id: ProjectTabId) => {
      requestExport(id);
      handleTabChange(id);
    },
    // `handleTabChange` est recréé à chaque rendu ; le figer ici capturerait
    // des `searchParams` périmés. La dépendance est volontairement omise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestExport, searchParams, project.header.id],
  );

  const tabsNode = (
    <ProjectTabsPill
      tabs={TABS}
      active={activeTab}
      onChange={handleTabChange}
      subValue={
        activeTab === "lumiere"
          ? lumiereSubTab
          : activeTab === "reseau"
            ? reseauSection
            : undefined
      }
      onSubChange={(tabId, subId) => {
        if (tabId === "lumiere") setLumiereSubTab(subId as LumiereSubTab);
        else if (tabId === "reseau") setReseauSection(subId as ReseauSection);
      }}
    />
  );

  // ── État Inventaire : remonté ici pour piloter toolbar + side panel + canvas ──
  // L'outil actif est persisté en localStorage. `null` = side panel fermé.
  // L'utilisateur retrouve sa sélection (y compris la fermeture) au reload
  // de la page et au retour depuis un autre onglet.
  //
  // Source unique : `persistedTool` ; `activeTool` est dérivé pour exposer
  // `null` quand on n'est pas sur l'onglet inventaire. Pas de useState
  // intermédiaire — sinon l'hydratation post-mount de useLocalStorageState
  // ne se propage pas (bug "reload retombe sur container").
  // Clé SCOPÉE AU PROJET : la préférence d'outil ne « fuit » pas d'un projet
  // à l'autre (le hook relit le stockage quand la clé change). Défaut :
  // l'outil Équipements.
  const inventaireToolKey = `inventaire-active-tool:${project.header.id}`;
  const isInventaireToolOrNull = (v: unknown): v is InventaireToolId | null =>
    v === null || isInventaireToolId(v);
  const [persistedTool, setPersistedTool] = useLocalStorageState<
    InventaireToolId | null
  >(inventaireToolKey, "equipment", { isValid: isInventaireToolOrNull });
  const activeTool: InventaireToolId | null =
    activeTab === "inventaire" ? persistedTool : null;
  const setActiveTool = (t: InventaireToolId | null) => {
    setPersistedTool(t);
  };
  const [addOpen, setAddOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const inventaireRef = useRef<InventaireClientHandle | null>(null);

  // ── Raccourcis clavier outils Inventaire (E / A / P / X) ─────────────────
  // Toggle si l'outil est déjà actif (cohérent avec le clic sur le bouton).
  // Ignoré quand l'utilisateur tape dans un input / textarea / contenteditable
  // ou avec un modificateur (Cmd/Ctrl/Alt/Meta) pour ne pas voler les
  // raccourcis système et copier/coller.
  useEffect(() => {
    if (activeTab !== "inventaire") return;
    if (strataManage) return; // arkyo-server: interface Strata — dans Gérer, l'Inventaire n'est pas affiché : pas de raccourcis.
    const SHORTCUT_TO_TOOL: Record<string, InventaireToolId> = {
      e: "equipment",
      a: "adapter",
      p: "panel",
      x: "accessory",
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      const tool = SHORTCUT_TO_TOOL[key];
      if (tool) {
        e.preventDefault();
        setActiveTool(activeTool === tool ? null : tool);
        return;
      }
      if (e.key === "Escape" && activeTool !== null) {
        e.preventDefault();
        setActiveTool(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeTool, strataManage]); // arkyo-server: interface Strata (`strataManage`)

  // ── État onglet Rack : rack sélectionné + vues + viewMode ──
  const [rackSelectedRackId, setRackSelectedRackId] = useState<string | null>(
    null,
  );
  // Vues visibles du rack — persistées en localStorage sous forme d'array
  // (Set n'est pas JSON-sérialisable). L'utilisateur retrouve son preset
  // (Avant / Arrière / Intérieur / Avant + Arrière / Tous) au reload.
  // REAR_INTERIOR est ignoré côté canvas si le contenant n'a pas de face
  // arrière intérieure.
  const ALL_VIEWS: ViewId[] = ["FRONT", "REAR", "REAR_INTERIOR", "SIDE"];
  const isViewIdArray = (v: unknown): v is ViewId[] =>
    Array.isArray(v) &&
    v.every(
      (x): x is ViewId =>
        x === "FRONT" || x === "REAR" || x === "REAR_INTERIOR" || x === "SIDE",
    );
  const [rackVisibleViewsArr, setRackVisibleViewsArr] = useLocalStorageState<
    ViewId[]
  >("rack-tab:visible-views", ALL_VIEWS, { isValid: isViewIdArray });
  const rackVisibleViews = useMemo(
    () => new Set<ViewId>(rackVisibleViewsArr),
    [rackVisibleViewsArr],
  );
  const setRackVisibleViews = useCallback(
    (
      next: Set<ViewId> | ((prev: Set<ViewId>) => Set<ViewId>),
    ) => {
      setRackVisibleViewsArr((prev) => {
        const prevSet = new Set<ViewId>(prev);
        const resolved = typeof next === "function" ? next(prevSet) : next;
        return Array.from(resolved);
      });
    },
    [setRackVisibleViewsArr],
  );
  const [rackViewMode] = useState<"real" | "schema">("schema");
  // ── Portée d'affichage du canvas rack : contenant (défaut) ou emplacement ──
  const isDisplayScope = (v: unknown): v is RackDisplayScope =>
    v === "container" || v === "location";
  const [rackDisplayScope, setRackDisplayScope] =
    useLocalStorageState<RackDisplayScope>(
      "rack-tab:display-scope",
      "container",
      { isValid: isDisplayScope },
    );
  const [rackSelectedLocationId, setRackSelectedLocationId] =
    useLocalStorageState<string | null>("rack-tab:location", null, {
      isValid: (v): v is string | null => v === null || typeof v === "string",
    });
  const isViewId = (v: unknown): v is ViewId =>
    v === "FRONT" || v === "REAR" || v === "REAR_INTERIOR" || v === "SIDE";
  const [rackLocationView, setRackLocationView] = useLocalStorageState<ViewId>(
    "rack-tab:location-view",
    "FRONT",
    { isValid: isViewId },
  );
  // Outil canvas rack — persisté en localStorage (select / move).
  const isCanvasTool = (v: unknown): v is "select" | "move" =>
    v === "select" || v === "move";
  const [rackCanvasTool, setRackCanvasTool] = useLocalStorageState<
    "select" | "move"
  >("rack-tab:canvas-tool", "select", { isValid: isCanvasTool });
  // Mode de rendu des équipements rackés — persisté (repris à l'ouverture de
  // n'importe quel rack). Défaut "standard" (rendu box couleur + nom).
  const isRenderMode = (v: unknown): v is RackRenderMode =>
    v === "standard" || v === "graphic" || v === "photo";
  const [rackRenderMode, setRackRenderMode] =
    useLocalStorageState<RackRenderMode>("rack-render-mode", "standard", {
      isValid: isRenderMode,
    });
  const [rackSelectedSlot, setRackSelectedSlot] = useState<Slot | null>(null);
  const [rackCanvasData, setRackCanvasData] = useState<RackCanvasData | null>(
    null,
  );
  // Payload agrégé du lieu (portée « par emplacement ») — alimente le panneau
  // droit et la disponibilité de la vue « Intérieur ».
  const [rackLocationData, setRackLocationData] =
    useState<LocationCanvasData | null>(null);
  // Slots live par contenant du lieu (placement en direct) — la sidebar
  // recalcule les `remaining` du BOM de chaque contenant.
  const [rackLocationLiveSlots, setRackLocationLiveSlots] = useState<
    Record<string, Slot[]>
  >({});
  const handleLocationRackSlotsChange = useCallback(
    (rackId: string, slots: Slot[]) => {
      setRackLocationLiveSlots((prev) =>
        prev[rackId] === slots ? prev : { ...prev, [rackId]: slots },
      );
    },
    [],
  );

  // State mutable des racks pour permettre l'édition (ContainerPropertiesPanel)
  // depuis l'onglet Rack — qui n'a pas d'`InventaireScope` au-dessus. Init
  // avec le snapshot SSR ; muté localement après PATCH pour l'update optimiste.
  const [rackLiveRacks, setRackLiveRacks] = useState<InventaireRack[]>(
    nonVirtualRacks,
  );
  // Sync prop → state quand le snapshot serveur change (déclenché par
  // `AppSync` → `router.refresh()` sur events SSE rack / rig / project /
  // rack_inventory). Cela propage en temps réel les modifications faites
  // dans l'onglet Inventaire (depthMm, name, totalU, type, …) au dropdown
  // contenant et au canvas du tab Rack.
  useEffect(() => {
    setRackLiveRacks(nonVirtualRacks);
  }, [nonVirtualRacks]);

  // Réordonnancement des colonnes du lieu (drag de l'entête). L'ordre est
  // GLOBAL côté serveur : on ne permute que les contenants du lieu, en place,
  // sans toucher aux positions des autres contenants, puis on renvoie la liste
  // complète (virtuels en fin), comme `reorderRacks` de l'inventaire.
  const handleReorderLocationRacks = useCallback(
    async (rackId: string, targetIdx: number) => {
      const all = project.inventaire.racks;
      const containers = rackLiveRacks;
      const rack = containers.find((r) => r.id === rackId);
      if (!rack) return;
      const locationId = rack.locationId ?? null;
      // Positions (dans la liste globale des contenants) occupées par les
      // colonnes du lieu — elles restent les mêmes, seul leur contenu permute.
      const slotIdx: number[] = [];
      const group: InventaireRack[] = [];
      containers.forEach((r, i) => {
        if (r.isRackable && !r.isVirtual && (r.locationId ?? null) === locationId) {
          slotIdx.push(i);
          group.push(r);
        }
      });
      const src = group.findIndex((r) => r.id === rackId);
      if (src === -1 || targetIdx < 0 || targetIdx >= group.length || src === targetIdx)
        return;
      const reordered = [...group];
      const [moved] = reordered.splice(src, 1);
      reordered.splice(targetIdx, 0, moved);
      const next = [...containers];
      slotIdx.forEach((pos, i) => {
        next[pos] = reordered[i];
      });
      setRackLiveRacks(next);
      const virtualIds = all.filter((r) => r.isVirtual).map((r) => r.id);
      setSaveStatus("saving");
      try {
        await api.post(
          `/api/tenant/projects/${project.header.id}/racks/reorder`,
          { rackIds: [...next.map((r) => r.id), ...virtualIds] },
        );
        setSaveStatus("saved");
      } catch (e) {
        setSaveStatus("error");
        window.alert(getApiErrorMessage(e));
      }
    },
    [project.inventaire.racks, project.header.id, rackLiveRacks],
  );
  // `liveSlots` : slots à jour depuis le canvas (mis à jour en live au
  // placement). Surcharge `canvasData.rack.slots` (figé au fetch) pour que
  // la sidebar BOM recalcule `remaining` correctement → les instances
  // draggables disparaissent dès qu'elles sont placées.
  const [rackLiveSlots, setRackLiveSlots] = useState<Slot[] | null>(null);
  // Reset `liveSlots` quand on change de rack (le canvas est remount, le
  // useEffect dans le canvas re-publiera ses slots initiaux).
  useEffect(() => {
    setRackLiveSlots(null);
  }, [rackSelectedRackId]);
  // La sélection de slot n'a pas de sens d'une portée/lieu à l'autre.
  useEffect(() => {
    setRackSelectedSlot(null);
    setRackLocationLiveSlots({});
  }, [rackDisplayScope, rackSelectedLocationId]);

  // Auto-sélection du premier rack rackable à l'arrivée sur l'onglet Rack.
  useEffect(() => {
    if (activeTab !== "rack") return;
    if (rackSelectedRackId !== null) return;
    const firstRackable = rackLiveRacks.find((r) => r.isRackable);
    if (firstRackable) setRackSelectedRackId(firstRackable.id);
  }, [activeTab, rackSelectedRackId, rackLiveRacks]);

  // Idem pour l'emplacement en portée « par emplacement » : on retombe sur le
  // premier lieu (ou sur celui du contenant courant s'il en a un) si la valeur
  // persistée n'existe plus.
  const projectLocations = project.inventaire.locations;

  // ── Export du projet (dossier composé / unitaire) ─────────────────────────
  // Le modal est global : il vit au-dessus des onglets, et n'a donc accès
  // qu'aux documents AUTONOMES — ceux dont le générateur ne connaît que des
  // données. Les documents adossés à un canvas (élévations, synoptique, plans)
  // ne peuvent pas être produits d'ici : l'éditeur ne monte qu'un onglet à la
  // fois, leur DOM n'existe pas. Ils se signalent indisponibles plutôt que de
  // sortir vides. Voir `dossier-registry.ts`.
  const [dossierOpen, setDossierOpen] = useState(false);
  const openDossier = useCallback(() => setDossierOpen(true), []);
  const dossierStamp = useMemo(() => new Date().toISOString().slice(0, 10), []);
  /**
   * Sources de données du dossier — ce que l'aperçu HTML affiche. L'espace
   * n'est pas nécessaire ici : une table ne porte pas de cartouche, c'est la
   * feuille qui l'habille.
   */
  const dossierSources = useMemo(
    () => ({
      ...buildDossierDataSources({
        projectId: project.header.id,
        fiche: project.fiche,
        stamp: dossierStamp,
      }),
      // L'inventaire vit ICI, comme son générateur : il consomme l'état de
      // contenants que l'éditeur tient à jour, et ses lignes sont TYPÉES —
      // l'aperçu en préserve la hiérarchie plutôt que de l'aplatir.
      inventaire: async () => {
        const { buildBomTable, sanitizeBomTableOptions, DEFAULT_BOM_TABLE_OPTIONS } =
          await import("../inventaire/_lib/bom-table");
        let stored = DEFAULT_BOM_TABLE_OPTIONS;
        try {
          const raw = localStorage.getItem(
            `export:inventaire:${project.header.id}:table`,
          );
          if (raw) stored = { ...DEFAULT_BOM_TABLE_OPTIONS, ...JSON.parse(raw) };
        } catch {
          /* réglage illisible → défauts */
        }
        const table = buildBomTable(
          rackLiveRacks,
          projectLocations,
          sanitizeBomTableOptions(stored),
        );
        if (table.itemCount === 0) throw new Error("Aucune donnée à exporter.");
        return { kind: "bom" as const, title: "Inventaire", table };
      },
    }),
    [
      project.header.id,
      project.fiche,
      dossierStamp,
      rackLiveRacks,
      projectLocations,
    ],
  );
  /**
   * Contenants et emplacements pour la planche d'élévations du dossier. Mêmes
   * règles que l'onglet Rack : seuls les contenants RACKABLES et non virtuels
   * ont des élévations, et un lieu sans contenant n'a rien à montrer.
   */
  const dossierRack = useMemo(() => {
    const racks = rackLiveRacks.filter((r) => r.isRackable && !r.isVirtual);
    if (racks.length === 0) return null;
    return {
      containers: racks.map((r) => ({ id: r.id, name: r.name })),
      locations: projectLocations
        .map((l) => ({
          id: l.id,
          name: l.name,
          rackIds: racks.filter((r) => r.locationId === l.id).map((r) => r.id),
        }))
        .filter((l) => l.rackIds.length > 0),
    };
  }, [rackLiveRacks, projectLocations]);

  /**
   * Emplacements offerts au sélecteur de vue du synoptique. La vue Générale est
   * toujours proposée, elle ne dépend d'aucun emplacement — la feuille est donc
   * cadrable même sur un projet qui n'en a encore aucun.
   */
  const dossierSynoptic = useMemo(
    () => ({
      locations: projectLocations.map((l) => ({ id: l.id, name: l.name })),
    }),
    [projectLocations],
  );

  const dossierGenerators = useCallback(
    (
      opts: {
        formats: Parameters<typeof buildDossierDataGenerators>[0]["formats"];
        columns: Parameters<typeof buildDossierDataGenerators>[0]["columns"];
        meta: NonNullable<
          Parameters<typeof buildDossierDataGenerators>[0]["meta"]
        >;
        titles: NonNullable<
          Parameters<typeof buildDossierDataGenerators>[0]["titles"]
        >;
      },
      // L'espace est RÉSOLU par le modal (nom + logo) : il est le seul à
      // l'avoir chargé, l'éditeur ne connaît que le nom du tenant.
      espace: { name?: string | null; logoUrl?: string | null },
    ) => ({
      // Listes tabulaires et fiche : chargeurs autonomes, mutualisés.
      ...buildDossierDataGenerators({
        projectId: project.header.id,
        fiche: project.fiche,
        stamp: dossierStamp,
        espace: { name: espace.name ?? tenantName, logoUrl: espace.logoUrl },
        formats: opts.formats,
        columns: opts.columns,
        meta: opts.meta,
        titles: opts.titles,
      }),
      // L'inventaire fait exception : il ne se recharge pas, il consomme le
      // MÊME état de contenants que l'onglet — celui que l'éditeur tient à
      // jour en direct. Le refetcher ferait diverger le dossier de ce que
      // l'utilisateur vient de composer.
      inventaire: async () => {
        const [{ buildBomTable, sanitizeBomTableOptions, DEFAULT_BOM_TABLE_OPTIONS }, { buildBomPdf }] =
          await Promise.all([
            import("../inventaire/_lib/bom-table"),
            import("../inventaire/_lib/bom-pdf"),
          ]);
        // Les options de contenu sont celles de l'onglet Inventaire, telles
        // qu'il les a mémorisées — le dossier ne repropose aucun réglage.
        let stored = DEFAULT_BOM_TABLE_OPTIONS;
        try {
          const raw = localStorage.getItem(
            `export:inventaire:${project.header.id}:table`,
          );
          if (raw) stored = { ...DEFAULT_BOM_TABLE_OPTIONS, ...JSON.parse(raw) };
        } catch {
          /* réglage illisible → défauts */
        }
        const table = buildBomTable(
          rackLiveRacks,
          projectLocations,
          sanitizeBomTableOptions(stored),
        );
        const { blob } = await buildBomPdf({
          table,
          // Le cartouche de la GARDE prime — comme sur toutes les feuilles.
          meta: opts.meta,
          title: opts.titles.inventaire,
          format: opts.formats?.inventaire,
        });
        return blob;
      },
    }),
    [
      project.header.id,
      project.header.name,
      project.fiche,
      dossierStamp,
      tenantName,
      rackLiveRacks,
      projectLocations,
    ],
  );
  const dossierModal = (
    <DossierWizard
      projectId={project.header.id}
      projectName={project.header.name}
      espaceName={tenantName}
      locationLabel={null}
      generators={dossierGenerators}
      sources={dossierSources}
      rack={dossierRack}
      synoptic={dossierSynoptic}
      carto={{ maps: project.cartographie.maps, racks: nonVirtualRacks }}
      onGoToTabExport={goToTabExport}
      open={dossierOpen}
      onOpenChange={setDossierOpen}
    />
  );

  useEffect(() => {
    if (activeTab !== "rack" || rackDisplayScope !== "location") return;
    if (
      rackSelectedLocationId &&
      projectLocations.some((l) => l.id === rackSelectedLocationId)
    )
      return;
    const fromCurrentRack = rackSelectedRackId
      ? (rackLiveRacks.find((r) => r.id === rackSelectedRackId)?.locationId ??
        null)
      : null;
    const next =
      (fromCurrentRack &&
        projectLocations.find((l) => l.id === fromCurrentRack)?.id) ||
      projectLocations[0]?.id ||
      null;
    if (next !== rackSelectedLocationId) setRackSelectedLocationId(next);
  }, [
    activeTab,
    rackDisplayScope,
    rackSelectedLocationId,
    setRackSelectedLocationId,
    projectLocations,
    rackSelectedRackId,
    rackLiveRacks,
  ]);
  const rackTabRef = useRef<RackTabClientHandle | null>(null);

  // ── Onglet Cartographie : zoom + ref canvas ───────────────────────────────
  const cartographieRef = useRef<CartographieClientHandle | null>(null);
  const [cartoZoom, setCartoZoom] = useState(1);

  // ── Onglet Synoptique : tout l'état est isolé dans `SynoptiqueTabClient` ──
  // Vague 2A — la stack synoptique (sélection rack, fetch focus, panneaux,
  // dialogs) est désormais 100% gérée par le client tab qui monte directement
  // `<SynopticView>` (composant partagé avec la page rack). Aucune state ni
  // wiring shell ne reste ici.

  // Sélection d'un preset de vues (radio-style) — remplace l'ancien toggle
  // multi-vue. Le preset détermine entièrement le `visibleViews` Set.
  const selectRackViewPreset = (preset: import("../rack/_components/rack-tab-left-toolbar").RackViewPreset) => {
    const PRESET_VIEWS: Record<typeof preset, ViewId[]> = {
      front: ["FRONT", "SIDE"],
      rear: ["REAR", "SIDE"],
      interior: ["REAR_INTERIOR", "SIDE"],
      "front-rear": ["FRONT", "REAR", "SIDE"],
      all: ["FRONT", "REAR", "REAR_INTERIOR", "SIDE"],
    };
    setRackVisibleViews(new Set(PRESET_VIEWS[preset]));
  };

  // arkyo-server: interface Strata — espace Gérer (`?space=gerer`, Strata seulement) : pages Gérer sous la topbar projet, aucun onglet monté ; faux en Classique.
  if (strataManage) {
    return (
      <>
        <ManageShell
          project={project}
          topbar={withStrataSaveStatus(saveStatus, <ProjectGlobalTopbar projectName={project.header.name} tenantName={tenantName} status={status} onStatusChange={handleStatusChange} onEditCharacteristics={openCharacteristics} onExport={openDossier} tabs={tabsNode} onClose={() => router.push("/projects")} />)}
          onEditCharacteristics={openCharacteristics}
          onOpenCatalogue={() => setPersistedTool("equipment")}
        />
        <ProjectCharacteristicsDialog open={characteristicsOpen} onOpenChange={setCharacteristicsOpen} fiche={project.fiche} onSaveStatus={setSaveStatus} />
        {dossierModal}
      </>
    );
  }

  // ── Drawings (multi-pages) — UN type par onglet projet ───────────────────
  // Le même éditeur de plans (model ProjectDrawing) est filtré par type :
  //   Schémas → SCHEMA · Vidéo → CAMERAS · Audio → AUDIO · Lumière → LIGHTING.
  // Plus de sélecteur de type : chaque onglet ne gère que ses pages (liste +
  // navigation conservées). `key={kind}` force le remount au changement d'onglet.
  const drawingKind = DRAWING_KIND_BY_TAB[activeTab];
  if (drawingKind) {
    return (
      <>
        <DrawingTabClient
          key={drawingKind}
          projectId={project.header.id}
          projectName={project.header.name}
          kind={drawingKind}
          globalTopbar={
            <ProjectGlobalTopbar
              projectName={project.header.name}
              tenantName={tenantName}
              status={status}
              onStatusChange={handleStatusChange}
              onEditCharacteristics={openCharacteristics}
              onExport={openDossier}
              tabs={tabsNode}
              onClose={() => router.push("/projects")}
            />
          }
        />
        <ProjectCharacteristicsDialog
          open={characteristicsOpen}
          onOpenChange={setCharacteristicsOpen}
          fiche={project.fiche}
          onSaveStatus={setSaveStatus}
        />
        {dossierModal}
      </>
    );
  }

  // ── Lumière : 2 sous-onglets (Plan de feu + Adressage DMX) — shell propre. ─
  if (activeTab === "lumiere") {
    return (
      <>
        <LumiereTabClient
          projectId={project.header.id}
          fiche={project.fiche}
          subTab={lumiereSubTab}
          globalTopbar={
            <ProjectGlobalTopbar
              projectName={project.header.name}
              tenantName={tenantName}
              status={status}
              onStatusChange={handleStatusChange}
              onEditCharacteristics={openCharacteristics}
              onExport={openDossier}
              tabs={tabsNode}
              onClose={() => router.push("/projects")}
            />
          }
        />
        <ProjectCharacteristicsDialog
          open={characteristicsOpen}
          onOpenChange={setCharacteristicsOpen}
          fiche={project.fiche}
          onSaveStatus={setSaveStatus}
        />
        {dossierModal}
      </>
    );
  }

  // ── Synoptique : le tab client détient son propre EditorShell ─────────────
  // (parité 1:1 avec rack-editor.tsx workspace="synoptic"). On lui passe la
  // globalTopbar projet pour conserver le breadcrumb + onglets, et le
  // saveStatus pour la sous-topbar.
  if (activeTab === "synoptique") {
    return (
      <>
        <SynoptiqueTabClient
          projectId={project.header.id}
          projectName={project.header.name}
          racks={rackLiveRacks}
          locations={project.inventaire.locations}
          globalTopbar={
            <ProjectGlobalTopbar
              projectName={project.header.name}
              tenantName={tenantName}
              status={status}
              onStatusChange={handleStatusChange}
              onEditCharacteristics={openCharacteristics}
              onExport={openDossier}
              tabs={tabsNode}
              onClose={() => router.push("/projects")}
            />
          }
          saveStatus={saveStatus}
        />
        <ProjectCharacteristicsDialog
          open={characteristicsOpen}
          onOpenChange={setCharacteristicsOpen}
          fiche={project.fiche}
          onSaveStatus={setSaveStatus}
        />
        {dossierModal}
      </>
    );
  }

  const slots = getEditorSlots({
    activeTab,
    onTabChange: handleTabChange,
    project,
    tenantName,
    tabsNode,
    saveStatus,
    status,
    onStatusChange: handleStatusChange,
    onEditCharacteristics: openCharacteristics,
    onExport: openDossier,
    onClose: () => router.push("/projects"),
    activeTool,
    setActiveTool,
    addOpen,
    setAddOpen,
    inventaireRef,
    zoom,
    onZoomChange: setZoom,
    cartographieRef,
    cartoZoom,
    onCartoZoomChange: setCartoZoom,
    rackSelectedRackId,
    setRackSelectedRackId,
    rackVisibleViews,
    onSelectRackViewPreset: selectRackViewPreset,
    rackViewMode,
    rackTabRef,
    rackSelectedSlot,
    onRackSlotSelect: setRackSelectedSlot,
    rackCanvasData,
    onRackCanvasDataChange: setRackCanvasData,
    rackLiveSlots,
    onRackLiveSlotsChange: setRackLiveSlots,
    rackLiveRacks,
    setRackLiveRacks,
    setSaveStatus,
    rackCanvasTool,
    setRackCanvasTool,
    rackRenderMode,
    setRackRenderMode,
    rackDisplayScope,
    setRackDisplayScope,
    rackSelectedLocationId,
    setRackSelectedLocationId,
    rackLocationView,
    setRackLocationView,
    rackLocationData,
    onRackLocationDataChange: setRackLocationData,
    rackLocationLiveSlots,
    onRackLocationSlotsChange: handleLocationRackSlotsChange,
    onReorderLocationRacks: handleReorderLocationRacks,
    rackAllRacks: project.inventaire.racks,
    rackLocations: project.inventaire.locations,
  });

  // Dialog d'édition des caractéristiques — monté au-dessus de tous les modes
  // de shell pour rester accessible depuis n'importe quel onglet.
  const characteristicsDialog = (
    <>
      <ProjectCharacteristicsDialog
        open={characteristicsOpen}
        onOpenChange={setCharacteristicsOpen}
        fiche={project.fiche}
        onSaveStatus={setSaveStatus}
      />
      {dossierModal}
    </>
  );

  // L'`InventaireScope` doit englober le shell entier (side panel ET canvas)
  // pour partager l'état racks + DndContext + DragOverlay + AddQuantityDialog.
  if (activeTab === "inventaire") {
    return (
      <InventaireScope
        projectId={project.header.id}
        initialRacks={project.inventaire.racks}
        initialLocations={project.inventaire.locations}
        notifySave={setSaveStatus}
      >
        <EditorShell {...slots} globalTopbarHeight={44} />
        {characteristicsDialog}
      </InventaireScope>
    );
  }

  // L'onglet Cartographie nécessite le `CartographieScope` autour du shell
  // pour que les panels (gauche/droit/toolbar) et le canvas partagent l'état
  // (maps, étage actif, sélection, outil actif, etc.).
  // CartographieShellGate lit le scope et masque les slots (contextualTopbar
  // + leftToolbar + rightPanel) si aucun plan n'est créé → canvas full-width
  // avec son empty state.
  if (activeTab === "cartographie") {
    return (
      <CartographieScope
        projectId={project.header.id}
        initialMaps={project.cartographie.maps}
        racks={nonVirtualRacks}
        notifySave={setSaveStatus}
      >
        <CartographieShellGate slots={slots} />
        {characteristicsDialog}
      </CartographieScope>
    );
  }

  // L'onglet Rack ne mounte PAS `InventaireScope` : son DndContext interne
  // (CatalogDragPreview, AddQuantityDialog) entrerait en conflit avec le
  // DndContext local du rack tab. À la place, on wrap dans
  // `RackTabDndProvider` qui partage UN SEUL DndContext entre la sidebar
  // (draggables BOM) et le canvas (droppables slots).
  if (activeTab === "rack") {
    return (
      <RackTabDndProvider>
        <EditorShell {...slots} globalTopbarHeight={44} />
        {characteristicsDialog}
      </RackTabDndProvider>
    );
  }

  return (
    <>
      <EditorShell {...slots} globalTopbarHeight={44} />
      {characteristicsDialog}
    </>
  );
}

// ── Slots composer ──────────────────────────────────────────────────────────

function getEditorSlots(args: {
  activeTab: ProjectTabId;
  /** Navigation entre onglets — utilisée par les empty states qui redirigent. */
  onTabChange: (id: ProjectTabId) => void;
  project: ProjectEditorData;
  tenantName: string | null;
  tabsNode: React.ReactNode;
  saveStatus: SaveStatus;
  status: ProjectStatus;
  onStatusChange: (next: ProjectStatus) => Promise<void> | void;
  onEditCharacteristics: () => void;
  /** Ouvre le modal d'export du projet. */
  onExport: () => void;
  onClose: () => void;
  activeTool: InventaireToolId | null;
  setActiveTool: (t: InventaireToolId | null) => void;
  addOpen: boolean;
  setAddOpen: (o: boolean) => void;
  inventaireRef: React.RefObject<InventaireClientHandle | null>;
  zoom: number;
  onZoomChange: (z: number) => void;
  // Cartographie tab
  cartographieRef: React.RefObject<CartographieClientHandle | null>;
  cartoZoom: number;
  onCartoZoomChange: (z: number) => void;
  // Rack tab
  rackSelectedRackId: string | null;
  setRackSelectedRackId: (id: string | null) => void;
  rackVisibleViews: Set<ViewId>;
  onSelectRackViewPreset: (
    preset: import("../rack/_components/rack-tab-left-toolbar").RackViewPreset,
  ) => void;
  rackViewMode: "real" | "schema";
  rackTabRef: React.RefObject<RackTabClientHandle | null>;
  rackSelectedSlot: Slot | null;
  onRackSlotSelect: (slot: Slot | null) => void;
  rackCanvasData: RackCanvasData | null;
  onRackCanvasDataChange: (data: RackCanvasData | null) => void;
  rackLiveSlots: Slot[] | null;
  onRackLiveSlotsChange: (slots: Slot[]) => void;
  rackLiveRacks: InventaireRack[];
  setRackLiveRacks: React.Dispatch<React.SetStateAction<InventaireRack[]>>;
  setSaveStatus: (status: SaveStatus) => void;
  rackCanvasTool: "select" | "move";
  setRackCanvasTool: (tool: "select" | "move") => void;
  rackRenderMode: RackRenderMode;
  setRackRenderMode: (mode: RackRenderMode) => void;
  rackDisplayScope: RackDisplayScope;
  setRackDisplayScope: (scope: RackDisplayScope) => void;
  rackSelectedLocationId: string | null;
  setRackSelectedLocationId: (id: string | null) => void;
  rackLocationView: ViewId;
  setRackLocationView: (view: ViewId) => void;
  rackLocationData: LocationCanvasData | null;
  onRackLocationDataChange: (data: LocationCanvasData | null) => void;
  rackLocationLiveSlots: Record<string, Slot[]>;
  onRackLocationSlotsChange: (rackId: string, slots: Slot[]) => void;
  onReorderLocationRacks: (rackId: string, targetIdx: number) => void;
  /** TOUS les contenants du projet (racks virtuels inclus) — totaux du lieu. */
  rackAllRacks: InventaireRack[];
  rackLocations: InventaireLocation[];
}): EditorShellSlots {
  const {
    activeTab,
    onTabChange,
    project,
    tenantName,
    tabsNode,
    saveStatus,
    status,
    onStatusChange,
    onEditCharacteristics,
    onExport,
    onClose,
    activeTool,
    setActiveTool,
    addOpen,
    setAddOpen,
    inventaireRef,
    zoom,
    onZoomChange,
    cartographieRef,
    cartoZoom,
    onCartoZoomChange,
    rackSelectedRackId,
    setRackSelectedRackId,
    rackVisibleViews,
    onSelectRackViewPreset,
    rackViewMode,
    rackTabRef,
    rackSelectedSlot,
    onRackSlotSelect,
    rackCanvasData,
    onRackCanvasDataChange,
    rackLiveSlots,
    onRackLiveSlotsChange,
    rackLiveRacks,
    setRackLiveRacks,
    setSaveStatus,
    rackCanvasTool,
    setRackCanvasTool,
    rackRenderMode,
    setRackRenderMode,
    rackDisplayScope,
    setRackDisplayScope,
    rackSelectedLocationId,
    setRackSelectedLocationId,
    rackLocationView,
    setRackLocationView,
    rackLocationData,
    onRackLocationDataChange,
    rackLocationLiveSlots,
    onRackLocationSlotsChange,
    onReorderLocationRacks,
    rackAllRacks,
    rackLocations,
  } = args;

  const globalTopbar = withStrataSaveStatus(saveStatus, ( // arkyo-server: interface Strata — état d'enregistrement lu par la topbar Strata (contexte, sans effet en Classique).
    <ProjectGlobalTopbar
      projectName={project.header.name}
      tenantName={tenantName}
      status={status}
      onStatusChange={onStatusChange}
      onEditCharacteristics={onEditCharacteristics}
      onExport={onExport}
      tabs={tabsNode}
      onClose={onClose}
    />
  )); // arkyo-server: interface Strata
  const rightPanel = (
    <ProjectInfoPanel
      fiche={project.fiche}
      status={status}
      onStatusChange={onStatusChange}
    />
  );

  // ── Inventaire : leftToolbar + leftSidePanel + canvas ─────────────────────
  if (activeTab === "inventaire") {
    const activeToolDef =
      INVENTAIRE_TOOL_DEFS.find((t) => t.id === activeTool) ?? null;
    const inventaireContextualTopbar = (
      <ProjectContextualTopbar
        saveStatus={saveStatus}
        // Un label est toujours fourni : sans lui, `ProjectContextualTopbar`
        // n'affiche pas le `leftSlot` — or le sélecteur d'emplacement doit
        // rester visible même sans outil actif.
        toolLabel={activeToolDef?.label ?? "Inventaire"}
        toolShortcut={activeToolDef?.shortcut}
        leftSlot={<InventaireContextualTopbar activeTool={activeTool} />}
      />
    );
    return {
      globalTopbar,
      contextualTopbar: inventaireContextualTopbar,
      leftToolbar: (
        // Inventaire = page à sections scrollable : plus de zoom ni de
        // recadrage à piloter depuis la barre d'outils.
        <InventaireLeftToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          hideZoom
        />
      ),
      leftSidePanel: activeTool ? (
        <InventaireSidePanel
          activeTool={activeTool}
          projectId={project.header.id}
        />
      ) : null,
      canvas: (
        <InventaireClient
          ref={inventaireRef}
          rigConfigId={project.inventaire.rigConfigId}
          addOpen={addOpen}
          onAddOpenChange={setAddOpen}
          onRequestCatalog={() => setActiveTool("equipment")}
        />
      ),
      rightPanel: (
        <InventaireRightPanel
          fiche={project.fiche}
          status={status}
          onStatusChange={onStatusChange}
        />
      ),
      strata: { mode: "page" }, // arkyo-server: interface Strata — page défilante : outils en bande, rien sur le contenu (ignoré en Classique).
    };
  }

  // ── Rack : leftToolbar + leftSidePanel + canvas (placement physique) ─────
  if (activeTab === "rack") {
    // Aucun contenant rackable dans le projet → on n'a rien à éditer en U.
    // Empty state plein écran (les toolbars + side panel n'ont aucun sens
    // sans rack rackable) qui redirige vers l'onglet Inventaire pour
    // ajouter un contenant.
    const hasRackable = rackLiveRacks.some((r) => r.isRackable);
    if (!hasRackable) {
      const rackEmptyCanvas = (
        <div className="flex h-full items-center justify-center px-8">
          <EmptyState
            icon={<Server strokeWidth={1.5} />}
            title="Aucun contenant rackable"
            description="Le placement physique en U n'est disponible que pour les baies 19″ et flight-cases. Ajoutez un contenant rackable depuis l'onglet Inventaire."
            action={
              <EmptyStateAction onClick={() => onTabChange("inventaire")}>
                Aller à l&apos;Inventaire
              </EmptyStateAction>
            }
          />
        </div>
      );
      return {
        globalTopbar,
        contextualTopbar: (
          <ProjectContextualTopbar
            saveStatus={saveStatus}
            toolLabel={rackCanvasTool === "move" ? "Déplacer" : "Sélection"}
            toolShortcut={rackCanvasTool === "move" ? "H" : "S"}
          />
        ),
        canvas: rackEmptyCanvas,
      };
    }

    const isLocationScope = rackDisplayScope === "location";
    // Contenants rackables du lieu affiché — ordre de l'inventaire.
    const locationRackIds = isLocationScope
      ? rackLiveRacks
          .filter(
            (r) =>
              r.isRackable &&
              !r.isVirtual &&
              r.locationId === rackSelectedLocationId,
          )
          .map((r) => r.id)
      : [];
    // La vue « Intérieur » est proposée dès qu'UN contenant de la portée
    // courante a une face arrière intérieure.
    const hasRearInterior = isLocationScope
      ? (rackLocationData?.racks ?? []).some(
          (d) => d.rack.rearInteriorGapMm != null,
        )
      : rackCanvasData?.rack.rearInteriorGapMm != null;
    // La préférence « Intérieur » est conservée, mais on affiche l'arrière si
    // le lieu courant n'a aucun contenant à face intérieure (bouton masqué).
    const effectiveLocationView: ViewId =
      isLocationScope &&
      rackLocationData != null &&
      rackLocationView === "REAR_INTERIOR" &&
      !hasRearInterior
        ? "REAR"
        : rackLocationView;

    const rackContextualTopbar = (
      <ProjectContextualTopbar
        saveStatus={saveStatus}
        // Le label suit l'outil canvas actif (Sélection / Déplacer), comme
        // les autres onglets — la portée est portée par le dropdown.
        toolLabel={rackCanvasTool === "move" ? "Déplacer" : "Sélection"}
        toolShortcut={rackCanvasTool === "move" ? "H" : "S"}
        leftSlot={
          isLocationScope ? (
            <Group label="Emplacement">
              <RackLocationSelectorDropdown
                locations={rackLocations}
                racks={rackLiveRacks}
                selectedLocationId={rackSelectedLocationId}
                onSelectLocation={setRackSelectedLocationId}
              />
            </Group>
          ) : (
            <Group label="Contenant">
              <RackSelectorDropdown
                racks={rackLiveRacks.filter((r) => r.isRackable)}
                selectedRackId={rackSelectedRackId}
                onSelectRack={setRackSelectedRackId}
              />
            </Group>
          )
        }
      />
    );
    return {
      globalTopbar,
      contextualTopbar: rackContextualTopbar,
      leftToolbar: (
        <RackTabLeftToolbar
          canvasTool={rackCanvasTool}
          onCanvasToolChange={setRackCanvasTool}
          visibleViews={rackVisibleViews}
          onSelectViewPreset={onSelectRackViewPreset}
          zoom={zoom}
          // Zoom in/out passe par les méthodes impératives du canvas pour
          // que le clamp (max 2 / min = fitAll zoom) soit cohérent et que
          // le `zoom` state du canvas soit la source de vérité (le toolbar
          // se sync via `onZoomChange`).
          onZoomIn={() => rackTabRef.current?.zoomIn()}
          onZoomOut={() => rackTabRef.current?.zoomOut()}
          onFitAll={() => rackTabRef.current?.fitAll()}
          onCenter={() => rackTabRef.current?.centerContent()}
          hasRearInterior={hasRearInterior}
          renderMode={rackRenderMode}
          onRenderModeChange={setRackRenderMode}
          displayScope={rackDisplayScope}
          onDisplayScopeChange={setRackDisplayScope}
          locationView={effectiveLocationView}
          onLocationViewChange={setRackLocationView}
        />
      ),
      leftSidePanel: isLocationScope ? (
        // Mêmes listes qu'en portée contenant, une section par contenant du
        // lieu (le BOM « à placer » est rack-scopé).
        <RackLocationSidePanelWrapper
          projectId={project.header.id}
          locationData={rackLocationData}
          liveSlots={rackLocationLiveSlots}
        />
      ) : (
        <RackTabSidePanelWrapper
          projectId={project.header.id}
          selectedRackId={rackSelectedRackId}
          canvasData={rackCanvasData}
          liveSlots={rackLiveSlots}
        />
      ),
      canvas: (
        <RackTabClient
          ref={rackTabRef}
          projectId={project.header.id}
          selectedRackId={rackSelectedRackId}
          visibleViews={Array.from(rackVisibleViews)}
          viewMode={rackViewMode}
          renderMode={rackRenderMode}
          onSlotSelect={onRackSlotSelect}
          onCanvasDataChange={onRackCanvasDataChange}
          onSlotsChange={onRackLiveSlotsChange}
          onZoomChange={onZoomChange}
          canvasTool={rackCanvasTool}
          onCanvasToolChange={setRackCanvasTool}
          displayScope={rackDisplayScope}
          locationId={rackSelectedLocationId}
          locationRackIds={locationRackIds}
          locationView={effectiveLocationView}
          onLocationDataChange={onRackLocationDataChange}
          onLocationRackSlotsChange={onRackLocationSlotsChange}
          onReorderLocationRacks={onReorderLocationRacks}
        />
      ),
      rightPanel: (
        <RackTabRightPanel
          fiche={project.fiche}
          status={status}
          onStatusChange={onStatusChange}
          renderMode={rackRenderMode}
          viewMode={rackViewMode}
          selectedSlot={rackSelectedSlot}
          onCloseSlotPanel={() => onRackSlotSelect(null)}
          canvasData={rackCanvasData}
          liveSlots={rackLiveSlots}
          selectedRackId={rackSelectedRackId}
          onCloseContainerPanel={() => setRackSelectedRackId(null)}
          racks={rackLiveRacks}
          projectId={project.header.id}
          locationScope={isLocationScope}
          location={
            rackLocations.find((l) => l.id === rackSelectedLocationId) ?? null
          }
          locations={rackLocations}
          currentViews={
            isLocationScope
              ? [effectiveLocationView]
              : Array.from(rackVisibleViews)
          }
          allRacks={rackAllRacks}
          locationData={rackLocationData}
          locationLiveSlots={rackLocationLiveSlots}
          onRackPatch={async (rackId, data) => {
            // Update optimiste local + PATCH server.
            setSaveStatus("saving");
            setRackLiveRacks((prev) =>
              prev.map((r) => (r.id === rackId ? { ...r, ...data } : r)),
            );
            try {
              await api.patch(
                `/api/tenant/projects/${project.header.id}/racks/${rackId}`,
                data,
              );
              setSaveStatus("saved");
            } catch (e) {
              setSaveStatus("error");
              window.alert(getApiErrorMessage(e));
            }
          }}
        />
      ),
      // arkyo-server: interface Strata — tiroir du mode Racks (bibliothèque, face de l'emplacement sélectionné), ignoré en Classique.
      strata: { drawerTop: <StrataRackDrawerTop state={{ scope: isLocationScope ? "location" : "container", selectedRackId: rackSelectedRackId, canvasData: rackCanvasData, liveSlots: rackLiveSlots, locationData: rackLocationData, locationLiveSlots: rackLocationLiveSlots, visibleViews: rackVisibleViews, locationView: effectiveLocationView, projectId: project.header.id, locationRackIds, selectedSlot: rackSelectedSlot, racks: rackLiveRacks, selectedLocationId: rackSelectedLocationId, onSelectRack: setRackSelectedRackId, onSelectLocation: setRackSelectedLocationId, onDisplayScopeChange: setRackDisplayScope }} /> },
    };
  }

  // Note : l'onglet "synoptique" est traité hors de `getEditorSlots` car il
  // détient son propre `EditorShell` (cf. early-return dans ProjectEditorInner).

  const contextualTopbar = <ProjectContextualTopbar saveStatus={saveStatus} />;

  // ── Cartographie : leftToolbar + leftSidePanel + canvas + rightPanel ─────
  if (activeTab === "cartographie") {
    // Le host lit `activeTool` du scope pour dynamiquement afficher le label
    // et le raccourci de l'outil actif (pattern synoptique).
    const cartoContextualTopbar = (
      <CartographieTopbarHost saveStatus={saveStatus} />
    );
    return {
      globalTopbar,
      contextualTopbar: cartoContextualTopbar,
      leftToolbar: (
        <CartographieToolbarBridge
          cartographieRef={cartographieRef}
          zoom={cartoZoom}
        />
      ),
      // Side panel : uniquement pour l'outil "place" (P). Le câblage (C) se
      // fait entièrement sur le canvas — plus de side panel câble.
      leftSidePanel: <CartographieSidePanelPlace />,
      canvas: (
        <CartographieClient
          ref={cartographieRef}
          onZoomChange={onCartoZoomChange}
        />
      ),
      rightPanel: <CartographieRightPanel projectName={project.fiche.name} />,
    };
  }

  let canvas: React.ReactNode = null;
  let resolvedContextualTopbar: React.ReactNode = contextualTopbar;
  if (activeTab === "preparation") {
    canvas = (
      <CablageTabClient projectId={project.header.id} fiche={project.fiche} />
    );
    resolvedContextualTopbar = <CablageTopbarHost saveStatus={saveStatus} />;
  } else if (activeTab === "reseau") {
    canvas = (
      <ReseauTabClient
        projectId={project.header.id}
        fiche={project.fiche}
        status={status}
        onStatusChange={onStatusChange}
      />
    );
    resolvedContextualTopbar = (
      <ReseauTopbarHost saveStatus={saveStatus} projectId={project.header.id} />
    );
  } else if (activeTab === "recette") {
    canvas = (
      <RecetteTabClient
        projectId={project.header.id}
        projectName={project.fiche.name}
        location={project.fiche.location ?? null}
      />
    );
    resolvedContextualTopbar = <RecetteTopbarHost saveStatus={saveStatus} />;
  }
  // schema / video / audio / lumiere → DrawingTabClient (early-return amont, filtré par type).

  // Les onglets Préparation, Réseau et Recette n'ont pas de panneau
  // propriétés (vue inventaire / table pleine largeur). Les autres onglets
  // affichent le panel défini en amont.
  const resolvedRightPanel =
    activeTab === "preparation" ||
    activeTab === "reseau" ||
    activeTab === "recette"
      ? null
      : rightPanel;

  return {
    globalTopbar,
    contextualTopbar: resolvedContextualTopbar,
    canvas,
    rightPanel: resolvedRightPanel,
    strata: { mode: "page" }, // arkyo-server: interface Strata — Préparation, Réseau, Recette : pages (ignoré en Classique).
  };
}

/**
 * Wrapper context-aware du rightPanel pour l'onglet Inventaire :
 *  - `selectedItem !== null`   → propriétés de la ligne d'inventaire
 *  - `expandedRackId !== null` → propriétés du contenant sélectionné
 *  - lieu sélectionné → propriétés du lieu
 *  - sinon → infos projet (par défaut)
 *
 * Les deux premières sélections sont exclusives (cf. `selectItem`/`selectRack`
 * dans le scope) : l'ordre ci-dessus n'est qu'une sécurité.
 *
 * Le déclencheur d'export vit ICI, pas dans l'un des trois corps : il doit
 * rester atteignable quel que soit le contenu affiché — comme dans les autres
 * onglets, où il occupe le footer du panneau droit.
 *
 * Doit être rendu dans le scope `<InventaireScope>` (slot rightPanel du shell).
 */
function InventaireRightPanel({
  fiche,
  status: _status,
  onStatusChange: _onStatusChange,
}: {
  fiche: ProjectFicheData;
  status: ProjectStatus;
  onStatusChange: (next: ProjectStatus) => Promise<void> | void;
}) {
  const {
    expandedRackId,
    setExpandedRackId,
    selectedItem,
    selectItem,
    selectedLocationId,
    racks,
    projectId,
  } = useInventaireScope();
  const [exportOpen, setExportOpen] = React.useState(false);
  // …ou depuis le modal Dossier, qui bascule ici en demandant l'export.
  usePendingExport("inventaire", () => setExportOpen(true));
  // Les racks virtuels (équipements libres d'un lieu) ne sont pas des
  // contenants exportables.
  const canExport = racks.some((r) => !r.isVirtual);

  const body = selectedItem ? (
    <ItemPropertiesPanel
      rackId={selectedItem.rackId}
      itemId={selectedItem.itemId}
      onClose={() => selectItem(null)}
    />
  ) : expandedRackId ? (
    <ContainerPropertiesPanel
      rackId={expandedRackId}
      onClose={() => setExpandedRackId(null)}
      onDeleted={() => setExpandedRackId(null)}
    />
  ) : selectedLocationId && selectedLocationId !== UNASSIGNED_LOCATION_ID ? (
    // Le lieu affiché est aussi le lieu « sélectionné » : ses propriétés sont
    // le contenu par défaut du panneau droit (sauf vue « À affecter »).
    <LocationPropertiesPanel
      locationId={selectedLocationId}
      onClose={() => setExpandedRackId(null)}
    />
  ) : (
    <InventaireInfoPanel />
  );

  return (
    <aside className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>

      <div className="border-border flex flex-none items-center gap-0.5 border-t px-2 py-1.5">
        <button
          type="button"
          title="Exporter"
          disabled={!canExport || !projectId}
          onClick={() => setExportOpen(true)}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md transition-colors active:scale-95",
            "disabled:cursor-not-allowed disabled:opacity-50",
            exportOpen
              ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]"
              : "text-muted-foreground hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-foreground",
          )}
        >
          <Download className="h-4 w-4" />
        </button>
      </div>

      {projectId && (
        <InventaireExport
          projectId={projectId}
          racks={racks}
          fiche={fiche}
          open={exportOpen}
          onOpenChange={setExportOpen}
        />
      )}
    </aside>
  );
}

// ── Dropdown sélecteur de rack (sous-topbar onglet Rack) ─────────────────────

const RACK_TYPE_LABEL_DD: Record<InventaireRack["rackType"], string> = {
  STANDARD: 'Baie 19"',
  FLIGHT_CASE_CLASSIC: "Flight case",
  FLIGHT_CASE_SKB: "SKB",
  PELICAN: "Pelicase",
  CAP: "Mobilier",
};

function RackSelectorDropdown({
  racks,
  selectedRackId,
  onSelectRack,
}: {
  racks: InventaireRack[];
  selectedRackId: string | null;
  onSelectRack: (id: string) => void;
}) {
  const selected = racks.find((r) => r.id === selectedRackId) ?? null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="border-border bg-card hover:bg-secondary/40 inline-flex h-7 max-w-[280px] items-center gap-2 rounded-md border px-2.5 text-[11px] font-medium transition-colors"
        >
          <ServerIcon
            className="text-muted-foreground h-3 w-3 shrink-0"
            strokeWidth={1.75}
          />
          {selected ? (
            <>
              <span className="truncate uppercase">{selected.name}</span>
              <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                {RACK_TYPE_LABEL_DD[selected.rackType]} ·{" "}
                {selected.totalU}U
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Sélectionner un contenant…
            </span>
          )}
          <ChevronDown className="text-muted-foreground ml-1 h-3 w-3 shrink-0" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="border-border bg-card z-50 max-h-[60vh] min-w-[240px] overflow-auto rounded-lg border p-1 shadow-md"
        >
          {racks.length === 0 ? (
            <div className="text-muted-foreground px-3 py-2 text-[11px]">
              Aucun contenant rackable
            </div>
          ) : (
            racks.map((r) => {
              const active = r.id === selectedRackId;
              return (
                <DropdownMenu.Item
                  key={r.id}
                  onSelect={() => onSelectRack(r.id)}
                  className={cn(
                    "cursor-pointer rounded-md px-2 py-1.5 text-[11px] outline-none transition-colors",
                    active
                      // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
                      ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]"
                      : "data-[highlighted]:bg-secondary/60 text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <ServerIcon
                      className="h-3 w-3 shrink-0"
                      strokeWidth={1.75}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium uppercase">{r.name}</p>
                      <p className="text-muted-foreground mt-0.5 truncate font-mono text-[10px]">
                        {RACK_TYPE_LABEL_DD[r.rackType]} · {r.totalU}U
                      </p>
                    </div>
                  </div>
                </DropdownMenu.Item>
              );
            })
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ── Wrappers onglet Rack ─────────────────────────────────────────────────────

/**
 * Wrapper de la sidebar Rack — passe le payload `canvasData` et la liste
 * racks (issue du SSR) au `RackTabSidePanel`.
 *
 * On NE mounte PAS `InventaireScope` autour de l'onglet Rack pour éviter le
 * conflit entre son DndContext (catalog drag → cards) et le DndContext local
 * du `RackTabClient` (BOM drag → slots). La liste racks est donc statique
 * (snapshot SSR) — la sidebar ne réagit pas aux ajouts/suppressions de
 * contenants effectués depuis l'onglet Inventaire pendant la session, mais
 * un re-tab (sortir puis revenir) la rafraîchit via `router.refresh()`
 * implicite côté shell.
 */
function RackTabSidePanelWrapper({
  projectId,
  selectedRackId,
  canvasData,
  liveSlots,
}: {
  projectId: string;
  selectedRackId: string | null;
  canvasData: RackCanvasData | null;
  /** Slots à jour depuis le canvas (live). */
  liveSlots: Slot[] | null;
}) {
  const equipmentMap = React.useMemo(() => {
    // Palette Arkyo (allEquipment) + fallback : les équipements PERSO du tenant
    // ne sont pas dans la palette Arkyo, mais leurs données sont déjà résolues
    // par le serveur dans `slot.equipment` (fallback tenant côté canvas-data).
    // Sans cet ajout, un item perso est absent de la Map → filtré de la liste
    // « à placer » (rack-tab-side-panel) et invisible dans le rack.
    const m = new Map<string, Equipment>(
      (canvasData?.allEquipment ?? []).map((e) => [e.id, e]),
    );
    for (const s of canvasData?.rack.slots ?? []) {
      if (s.catalogEquipmentId && s.equipment && !m.has(s.catalogEquipmentId)) {
        m.set(s.catalogEquipmentId, s.equipment as Equipment);
      }
      for (const c of s.children ?? []) {
        if (c.catalogEquipmentId && c.equipment && !m.has(c.catalogEquipmentId)) {
          m.set(c.catalogEquipmentId, c.equipment as Equipment);
        }
      }
    }
    return m;
  }, [canvasData]);
  const panelMap = React.useMemo(
    () => new Map((canvasData?.allPanels ?? []).map((p) => [p.id, p])),
    [canvasData],
  );
  const slotsForBom = liveSlots ?? canvasData?.rack.slots ?? [];

  return (
    <RackTabSidePanel
      projectId={projectId}
      selectedRackId={selectedRackId}
      selectedRackSlots={slotsForBom}
      equipmentMap={equipmentMap}
      panelMap={panelMap}
    />
  );
}

/**
 * Panneau gauche de l'onglet Rack en portée « par emplacement » — une section
 * d'éléments à placer par contenant du lieu (le BOM est rack-scopé). Les maps
 * catalogue sont fusionnées sur l'ensemble des contenants.
 */
function RackLocationSidePanelWrapper({
  projectId,
  locationData,
  liveSlots,
}: {
  projectId: string;
  locationData: LocationCanvasData | null;
  /** Slots live par rackId, publiés par les canvases embarqués. */
  liveSlots: Record<string, Slot[]>;
}) {
  const payloads = React.useMemo(
    () => locationData?.racks ?? [],
    [locationData],
  );
  const equipmentMap = React.useMemo(() => {
    const m = new Map<string, Equipment>();
    for (const d of payloads) {
      for (const e of d.allEquipment ?? []) if (!m.has(e.id)) m.set(e.id, e);
      // Fallback tenant : les items perso ne sont pas dans la palette Arkyo
      // mais sont déjà résolus dans `slot.equipment` côté serveur.
      const collect = (s: Slot) => {
        if (s.catalogEquipmentId && s.equipment && !m.has(s.catalogEquipmentId))
          m.set(s.catalogEquipmentId, s.equipment as Equipment);
        for (const c of s.children ?? []) collect(c);
      };
      for (const s of d.rack.slots) collect(s);
    }
    return m;
  }, [payloads]);
  const panelMap = React.useMemo(() => {
    const m = new Map<string, PanelItem>();
    for (const d of payloads) {
      for (const p of d.allPanels ?? []) if (!m.has(p.id)) m.set(p.id, p);
    }
    return m;
  }, [payloads]);

  const racks = payloads.map((d) => ({
    id: d.rack.id,
    name: d.rack.name,
    slots: liveSlots[d.rack.id] ?? d.rack.slots,
  }));

  return (
    <RackTabLocationSidePanel
      projectId={projectId}
      racks={racks}
      equipmentMap={equipmentMap}
      panelMap={panelMap}
    />
  );
}

/**
 * Right panel onglet Rack :
 *  - Slot sélectionné : affiche le panneau de propriétés du slot
 *  - sinon : infos projet par défaut
 */
function RackTabRightPanel({
  fiche,
  status,
  onStatusChange,
  selectedSlot,
  onCloseSlotPanel,
  canvasData,
  liveSlots,
  selectedRackId,
  onCloseContainerPanel,
  racks,
  projectId,
  onRackPatch,
  locationScope,
  location,
  allRacks,
  locationData,
  locationLiveSlots,
  locations,
  currentViews,
  renderMode,
  viewMode,
}: {
  fiche: ProjectFicheData;
  status: ProjectStatus;
  onStatusChange: (next: ProjectStatus) => Promise<void> | void;
  /** Mode de rendu des équipements du canvas — repris tel quel à l'export. */
  renderMode: RackRenderMode;
  /** Mode d'affichage du canvas — repris tel quel à l'export. */
  viewMode: "real" | "schema";
  selectedSlot: Slot | null;
  onCloseSlotPanel: () => void;
  canvasData: RackCanvasData | null;
  /**
   * Slots live propagés par le canvas (state local mutable) — utilisés pour
   * `allSlots` à la place du snapshot `canvasData.rack.slots` figé au fetch.
   * Évite un refetch global du `canvas-data` à chaque placement (la
   * profondeur effective et la sécurité câbles ne changent pas, mais les
   * positions/heightU des slots oui).
   */
  liveSlots: Slot[] | null;
  selectedRackId: string | null;
  onCloseContainerPanel: () => void;
  racks: InventaireRack[];
  projectId: string;
  onRackPatch: (rackId: string, data: Record<string, unknown>) => Promise<void>;
  /** Portée « par emplacement » active. */
  locationScope?: boolean;
  /** Emplacement affiché (portée lieu). */
  location?: InventaireLocation | null;
  /** Tous les emplacements du projet — objets « lieu » de l'export. */
  locations: InventaireLocation[];
  /** Vues affichées dans le canvas — composition de départ de l'export. */
  currentViews: ViewId[];
  /** TOUS les contenants du projet (racks virtuels inclus) — totaux du lieu. */
  allRacks?: InventaireRack[];
  /** Payload agrégé du lieu — sert à retrouver le contenant d'un slot. */
  locationData?: LocationCanvasData | null;
  /** Slots live par contenant (placement en cours, avant refetch). */
  locationLiveSlots?: Record<string, Slot[]>;
}) {
  // Panneau d'export (slide-up in-panel) — piloté par le footer sticky…
  const [exportOpen, setExportOpen] = useState(false);
  // …ou depuis le modal Dossier, qui bascule ici en demandant l'export.
  usePendingExport("rack", () => setExportOpen(true));
  const selectedRack = selectedRackId
    ? (racks.find((r) => r.id === selectedRackId) ?? null)
    : null;
  /**
   * Contenants proposables à l'export : ceux qui ont une élévation, quel que
   * soit le contenant affiché dans le canvas. L'export n'est plus une capture
   * de la vue courante mais une composition libre — il ne dépend donc plus de
   * la sélection ni du chargement du canvas.
   */
  const exportRacks = React.useMemo(
    () => racks.filter((r) => !r.isVirtual && r.isRackable),
    [racks],
  );
  const exportContainers = React.useMemo(
    () => exportRacks.map((r) => ({ id: r.id, name: r.name })),
    [exportRacks],
  );
  /**
   * Emplacements posables en un bloc : ordre des contenants IDENTIQUE à celui
   * du canvas par lieu (ordre de l'inventaire filtré par emplacement), pour que
   * la planche exportée corresponde à ce qui est affiché à l'écran.
   */
  const exportLocations = React.useMemo(
    () =>
      locations
        .map((l) => ({
          id: l.id,
          name: l.name,
          rackIds: exportRacks
            .filter((r) => r.locationId === l.id)
            .map((r) => r.id),
        }))
        .filter((l) => l.rackIds.length > 0),
    [locations, exportRacks],
  );
  const canExport = exportContainers.length > 0;

  // En portée lieu, le slot sélectionné appartient à l'un des contenants du
  // lieu : on retrouve son payload pour alimenter le panneau de propriétés.
  // On cherche d'abord dans les slots LIVE du contenant (un élément qui vient
  // d'être placé n'est pas encore dans le payload agrégé), puis dans le
  // payload.
  const locationSlotOwner = React.useMemo(() => {
    if (!locationScope || !selectedSlot || !locationData) return null;
    const owns = (list: Slot[]): boolean =>
      list.some((s) => s.id === selectedSlot.id || owns(s.children ?? []));
    return (
      locationData.racks.find((d) =>
        owns(locationLiveSlots?.[d.rack.id] ?? d.rack.slots),
      ) ??
      locationData.racks.find((d) => owns(d.rack.slots)) ??
      null
    );
  }, [locationScope, selectedSlot, locationData, locationLiveSlots]);

  // Contenu du panneau selon le contexte de sélection.
  let content: React.ReactNode;
  // Priorité 1 : un slot est sélectionné → ses propriétés (interaction
  // dans le canvas).
  if (locationScope && selectedSlot && locationSlotOwner) {
    content = (
      <RackTabSlotPropertiesWrapper
        slot={selectedSlot}
        rackId={locationSlotOwner.rack.id}
        allSlots={
          locationLiveSlots?.[locationSlotOwner.rack.id] ??
          locationSlotOwner.rack.slots
        }
        connectorTypes={locationSlotOwner.connectorTypes}
        categories={locationSlotOwner.categories}
        rackDepthMm={locationSlotOwner.rack.depthMm}
        cableSafetyDepthMm={locationSlotOwner.cableSafetyDepthMm}
        onClose={onCloseSlotPanel}
      />
    );
  } else if (locationScope) {
    // Portée lieu, rien de sélectionné → propriétés de l'emplacement.
    content = location ? (
      <RackLocationInfoPanel location={location} racks={allRacks ?? racks} />
    ) : (
      <ProjectInfoPanel
        fiche={fiche}
        status={status}
        onStatusChange={onStatusChange}
      />
    );
  } else if (selectedSlot && canvasData) {
    content = (
      <RackTabSlotPropertiesWrapper
        slot={selectedSlot}
        rackId={canvasData.rack.id}
        allSlots={liveSlots ?? canvasData.rack.slots}
        connectorTypes={canvasData.connectorTypes}
        categories={canvasData.categories}
        rackDepthMm={canvasData.rack.depthMm}
        cableSafetyDepthMm={canvasData.cableSafetyDepthMm}
        onClose={onCloseSlotPanel}
      />
    );
  } else if (selectedRack) {
    // Priorité 2 : un contenant est sélectionné → infos contenant en lecture
    // seule. La modification des propriétés se fait depuis l'onglet Inventaire.
    content = (
      <RackInfoPanel rack={selectedRack} onClose={onCloseContainerPanel} />
    );
  } else {
    // Défaut : infos projet.
    content = (
      <ProjectInfoPanel
        fiche={fiche}
        status={status}
        onStatusChange={onStatusChange}
      />
    );
  }

  return (
    <aside className="flex h-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">{content}</div>

        {/* Modal d'export — rendu en portal. La composition ne dépend pas du
            contenant affiché : l'éditeur de mise en page va chercher lui-même
            les données de chaque contenant posé sur la page. */}
        <RackExport
          projectId={projectId}
          projectName={fiche.name}
          containers={exportContainers}
          locations={exportLocations}
          current={
            locationScope
              ? location
                ? { kind: "location", locationId: location.id }
                : null
              : selectedRack
                ? { kind: "rack", rackId: selectedRack.id }
                : null
          }
          currentViews={currentViews}
          renderMode={renderMode}
          viewMode={viewMode}
          open={exportOpen}
          onOpenChange={setExportOpen}
        />
      </div>

      {/* Footer — déclencheur d'export (ouvre le modal ci-dessus). */}
      <div className="border-border flex flex-none items-center gap-0.5 border-t px-2 py-1.5">
        <button
          type="button"
          title="Exporter"
          disabled={!canExport}
          onClick={() => setExportOpen((v) => !v)}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md transition-colors active:scale-95",
            "disabled:cursor-not-allowed disabled:opacity-50",
            exportOpen
              ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]"
              : "text-muted-foreground hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-foreground",
          )}
        >
          <Download className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

/**
 * Wrapper léger autour du `SlotPropertiesPanel` du rack-editor classique.
 * Les handlers `onRemove`/`onUpdate` font directement le PATCH/DELETE et
 * laissent ensuite le SSE `useRackSync` répliquer les changements côté
 * canvas.
 */
function RackTabSlotPropertiesWrapper({
  slot,
  rackId,
  allSlots,
  connectorTypes,
  categories,
  rackDepthMm,
  cableSafetyDepthMm,
  onClose,
}: {
  slot: Slot;
  rackId: string;
  allSlots: Slot[];
  connectorTypes: RackCanvasData["connectorTypes"];
  categories: RackCanvasData["categories"];
  rackDepthMm?: number | null;
  cableSafetyDepthMm?: number;
  onClose: () => void;
}) {
  const confirm = useConfirm();

  // Étiquetage des ports (panels de patch) — overlay fixe autonome. On rejoue
  // le PATCH { label, panelLabels } puis le SSE useRackSync réplique côté
  // canvas (même contrat que le rig-editor).
  const [labelling, setLabelling] = useState(false);
  const savePanelLabels = async (
    slotId: string,
    instanceName: string,
    panelLevels: Record<number, RowLevels>,
    close = true,
  ) => {
    await api.patch(`/api/racks/${rackId}/slots/${slotId}`, {
      label: instanceName,
      panelLabels: panelLevels,
    });
    if (close) setLabelling(false);
  };

  // Reproduit la map catégorie → hex utilisée par CategoryColorCtx (cf.
  // RackEditor / RackPlacementCanvas). Permet à SlotPropertiesPanel
  // (`useCategoryColor`) de retrouver la couleur du slot affiché.
  const catColorMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const parent of categories ?? []) {
      for (const child of parent.children ?? []) {
        m[child.name] = parent.color;
      }
      m[parent.name] = parent.color;
    }
    return m;
  }, [categories]);

  return (
    <CategoryColorCtx.Provider value={catColorMap}>
      <div className="flex h-full flex-col overflow-y-auto p-4">
        <SlotPropertiesPanel
          slot={slot}
          rackId={rackId}
          allSlots={allSlots}
          connectorTypes={connectorTypes}
          rackDepthMm={rackDepthMm}
          cableSafetyDepthMm={cableSafetyDepthMm}
          onClose={onClose}
          onUpdate={() => {
            // Le SSE useRackSync répliquera la mise à jour côté canvas.
          }}
          onOpenLabelling={slot.panel ? () => setLabelling(true) : undefined}
          onRemove={async () => {
            const slotName =
              slot.label ??
              slot.equipment?.name ??
              (slot.panel as { name?: string } | null)?.name ??
              "cet élément";
            const ok = await confirm({
              title: `Retirer ${slotName}`,
              description: `Retirer « ${slotName} » de la baie ?`,
              confirmLabel: "Retirer",
              variant: "destructive",
            });
            if (!ok) return;
            // DELETE — le SSE useRackSync retire le slot du canvas.
            await api.delete(`/api/racks/${rackId}/slots/${slot.id}`);
            onClose();
          }}
        />
      </div>
      {labelling && slot.panel && (
        <PortLabelEditor
          slot={slot}
          onClose={() => setLabelling(false)}
          onSave={savePanelLabels}
        />
      )}
    </CategoryColorCtx.Provider>
  );
}

// ── Shell gate cartographie (empty state) ───────────────────────────────────
// Lit le scope pour déterminer si un plan existe. Si non, on rend l'EditorShell
// SANS les slots contextualTopbar / leftToolbar / rightPanel — le canvas
// (avec son propre empty state) occupe alors toute la largeur, sans réserve
// d'espace vide ailleurs dans l'UI.
function CartographieShellGate({ slots }: { slots: EditorShellSlots }) {
  const { maps, activeTool } = useCartographieScope();
  const empty = maps.length === 0;
  // Side panel : visible uniquement pour l'outil "place" (point de connexion).
  // Le câblage (C) se fait entièrement sur le canvas (clic sur un point de
  // connexion → menu contextuel) — pas de side panel. Sans cette gate, le
  // wrapper du shell réserverait toujours la largeur SHELL_LEFT_SIDE_PANEL_W
  // (un null à l'intérieur ne suffit pas).
  const showPlacePanel = activeTool === "place" && !empty;
  return (
    <EditorShell
      {...slots}
      contextualTopbar={empty ? undefined : slots.contextualTopbar}
      leftToolbar={empty ? undefined : slots.leftToolbar}
      leftSidePanel={showPlacePanel ? slots.leftSidePanel : undefined}
      rightPanel={empty ? undefined : slots.rightPanel}
      globalTopbarHeight={44}
    />
  );
}

// ── Bridge toolbar cartographie ─────────────────────────────────────────────
// Lit `activeTool` + zoom courant + handlers exposés par le canvas via scope.
// La ref `cartographieRef` n'est plus utilisée (legacy noop) — le canvas
// enregistre ses handlers directement dans le scope via setZoomHandlers.
function CartographieToolbarBridge({
  cartographieRef: _cartographieRef,
}: {
  cartographieRef: React.RefObject<CartographieClientHandle | null>;
  zoom?: number;
}) {
  const { activeTool, setActiveTool, zoom, zoomHandlers, isSpaceHeld } =
    useCartographieScope();
  return (
    <CartographieLeftToolbar
      activeTool={activeTool}
      onToolChange={setActiveTool}
      isSpaceHeld={isSpaceHeld}
      zoom={zoom}
      onZoomIn={zoomHandlers.zoomIn}
      onZoomOut={zoomHandlers.zoomOut}
      onFitAll={zoomHandlers.fitAll}
      onCenter={zoomHandlers.center}
    />
  );
}

