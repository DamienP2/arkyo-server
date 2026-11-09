"use client";

/**
 * SynoptiqueTabClient — onglet synoptique du projet.
 *
 * Deux vues, toutes deux multi-contenants (phase 3 — la vue « focus par
 * contenant » a été retirée ; la route focus reste vivante et le mode `rack` de
 * SynopticView reste utilisé par l'éditeur de rack des rigs) :
 *  - **Général** (`__general__`) : blocs emplacements + contenants « À
 *    affecter », liaisons inter-lieux → `<GeneralCanvas>`.
 *  - **Emplacement** (`loc:<id>`) : agrégat des contenants d'un lieu →
 *    `<LocationCanvas>`.
 *
 * Architecture :
 *  - Wrappe la stack dans `<WorkspaceProvider workspace="synoptic">`.
 *  - Monte un `<EditorShell>` complet : globalTopbar (fourni par le parent),
 *    contextualTopbar (avec le sélecteur de vue), leftToolbar (`LeftToolbar`
 *    avec `synopticRegistry`), rightPanel (onglets Propriétés/Calques + footer
 *    `SynopticActionsBar` + overlay validation/audit/pdf/renumber), canvas.
 *  - Branche les hooks store (useTopbarActions) du workspace synoptic :
 *    workspace actif, zoom handlers, validation, audit, writers cable/label/
 *    zone, numbering handlers, erase handlers, adapter picker, etc.
 *  - Sélection de vue persistée en localStorage `project-${projectId}-
 *    synoptique-rack` (valeurs `__general__` ou `loc:<id>`).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2 } from "@/components/ui/icons";

import { EmptyState } from "@/components/ui/empty-state";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { apiFetch } from "@/lib/client-id";

// ── Shell synoptique (partagé avec rack-editor) ────────────────────────────
import { EditorShell } from "@/components/editor-shell/editor-shell";
import { LeftToolbar } from "@/components/editor-shell/left-toolbar";
import { ContextualTopbar } from "@/components/editor-shell/contextual-topbar";
import { RightPanel } from "@/components/editor-shell/right-panel";
import { SynopticActionsBar } from "@/components/editor-shell/synoptic-actions-bar";
import { SlideOverPanel, type SlideOverDef } from "@/components/editor-shell/slide-over-panel";
import { CursorHint } from "@/components/editor-shell/cursor-hint";
import {
  WorkspaceProvider,
  useWorkspaceStore,
} from "@/components/editor-shell/workspace-context";
import { useWorkspace } from "@/components/editor-shell/hooks/use-workspace";
import { useKeyboardShortcuts } from "@/components/editor-shell/hooks/use-keyboard-shortcuts";
import { synopticRegistry } from "@/components/editor-shell/tools-synoptic";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import { deriveSynopticLayers } from "@/components/editor-shell/hooks/use-layers";

// ── Synoptique runtime ──────────────────────────────────────────────────────
import type {
  SynopticViewHandle,
  CableSelectionDetails,
  AdapterSelectionDetails,
  ZoneSelectionDetails,
  LabelSelectionDetails,
  NodeSelectionDetails,
  CableSummary,
  ExternalPortSelectionDetails,
  ExternalPortSummary,
} from "@/components/synoptique/synoptic-view";
import { SynopticLayersPanel } from "@/components/synoptique/components/synoptic-layers-panel";
import { SynopticBundlesSection } from "@/components/synoptique/components/synoptic-bundles-section";
import { SynopticGeneralPanel } from "@/components/synoptique/components/synoptic-general-panel";
import { ValidationPanelContent } from "@/components/synoptique/components/validation-panel";
import { AuditPanelContent } from "@/components/synoptique/components/audit-panel";
import { SynopticCablePropertiesPanel } from "@/components/synoptique/components/synoptic-cable-properties-panel";
import { SynopticMultiCablePropertiesPanel } from "@/components/synoptique/components/synoptic-multi-cable-properties-panel";
import { SynopticMultiNodePropertiesPanel } from "@/components/synoptique/components/synoptic-multi-node-properties-panel";
import { SynopticExternalPortPropertiesPanel } from "@/components/synoptique/components/synoptic-external-properties-panel";
import { SynopticMultiExternalPropertiesPanel } from "@/components/synoptique/components/synoptic-multi-external-properties-panel";
import { SynopticAdapterPropertiesPanel } from "@/components/synoptique/components/synoptic-adapter-properties-panel";
import { SynopticZonePropertiesPanel } from "@/components/synoptique/components/synoptic-zone-properties-panel";
import { SynopticLabelPropertiesPanel } from "@/components/synoptique/components/synoptic-label-properties-panel";
import { SynopticNodePropertiesPanel } from "@/components/synoptique/components/synoptic-node-properties-panel";

// ── Types ───────────────────────────────────────────────────────────────────
import type {
  RackSlotWithEquipment,
  RackConnection as RackConnectionDTO,
} from "@/components/synoptique/types/synoptic";

// ── Projet ──────────────────────────────────────────────────────────────────
import type { InventaireLocation, InventaireRack } from "../inventaire/inventaire-client";
import {
  SynoptiqueRackSelector,
  parseLocationViewId,
  locationViewId,
} from "./_components/synoptique-rack-selector";
import {
  GeneralCanvas,
  type GeneralPayload,
} from "./_components/general-canvas";
import {
  LocationCanvas,
  type LocationPayload,
} from "./_components/location-canvas";
import {
  GeneralRackPropertiesPanel,
  GeneralConnectionPropertiesPanel,
  type GeneralRackSelection,
  type GeneralConnectionSelection,
} from "./_components/general-properties-panels";
import { GeneralInfoPanel } from "./_components/general-info-panel";
import { ProjectViewExport } from "../_components/project-view-export";
import { usePendingExport } from "../_components/pending-export-store";
import type { SaveStatus } from "../_editor/project-contextual-topbar";
import { useProjectSync } from "../_hooks/use-project-sync";
import { subscribeAppEvents } from "@/lib/app-events-client";
import { StrataSynopticDrawerTop } from "@/strata/editor/synoptic-drawer"; // arkyo-server: interface Strata

// ── Sélection : "__general__" = vue Générale (tous les emplacements),
// `loc:<id>` = vue d'un emplacement. La vue « focus par contenant » a été
// retirée en phase 3 (la route focus reste vivante ; le mode rack de
// SynopticView reste utilisé par l'éditeur de rack des rigs).
const GENERAL_VIEW_ID = "__general__";

// ── Types ────────────────────────────────────────────────────────────────────

type SignalTypeDef = {
  name: string;
  color: string;
  cablePrefix?: string | null;
  cableSuffix?: string | null;
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


// ── localStorage helper ──────────────────────────────────────────────────────

function loadStoredRackId(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(`project-${projectId}-synoptique-rack`);
    if (typeof v === "string" && v.length > 0) {
      // Migration : le sélecteur ne propose plus les contenants. Une ancienne
      // valeur `rackId` (focus) retombe sur la vue Générale.
      if (v === GENERAL_VIEW_ID || parseLocationViewId(v)) return v;
      return GENERAL_VIEW_ID;
    }
    // Aucune valeur persistée → default à la vue Générale (première arrivée).
    return GENERAL_VIEW_ID;
  } catch {
    // localStorage indisponible → on retombe quand même sur Général pour offrir
    // une vue par défaut utile (au lieu de l'EmptyState "Aucun contenant").
    return GENERAL_VIEW_ID;
  }
}

function persistRackId(projectId: string, rackId: string | null) {
  if (typeof window === "undefined") return;
  try {
    const key = `project-${projectId}-synoptique-rack`;
    if (rackId) window.localStorage.setItem(key, rackId);
    else window.localStorage.removeItem(key);
  } catch {
    /* localStorage indisponible — pas critique */
  }
}

// ── Component (entry point — fournit le WorkspaceProvider) ───────────────────

export function SynoptiqueTabClient({
  projectId,
  projectName,
  racks,
  locations = [],
  globalTopbar,
  saveStatus = "idle",
}: {
  projectId: string;
  /** Nom du projet — pour la cartouche d'export PDF. */
  projectName: string;
  /** Contenants projet — sert aux compteurs du sélecteur d'emplacement. */
  racks: InventaireRack[];
  /** Emplacements du projet — entrées du sélecteur. */
  locations?: InventaireLocation[];
  /** Topbar globale projet (rendue par parent). Identique à toutes les pages. */
  globalTopbar: ReactNode;
  /** Statut de sauvegarde courant pour la sous-topbar. */
  saveStatus?: SaveStatus;
}) {
  return (
    <WorkspaceProvider workspace="synoptic">
      <SynoptiqueTabClientInner
        projectId={projectId}
        projectName={projectName}
        racks={racks}
        locations={locations}
        globalTopbar={globalTopbar}
        saveStatus={saveStatus}
      />
    </WorkspaceProvider>
  );
}

// ── Inner — toute la logique au sein du WorkspaceProvider ────────────────────

function SynoptiqueTabClientInner({
  projectId,
  projectName,
  racks,
  locations,
  globalTopbar,
  saveStatus,
}: {
  projectId: string;
  projectName: string;
  racks: InventaireRack[];
  locations: InventaireLocation[];
  globalTopbar: ReactNode;
  saveStatus: SaveStatus;
}) {
  // ── Rack sélectionné (persisté localStorage) ─────────────────────────────
  // Initialisé à null pour matcher le rendu SSR. La valeur localStorage est
  // restaurée dans un useEffect post-mount, évitant l'hydration mismatch sur
  // l'icône du SynoptiqueRackSelector (Workflow=général vs Server=rack).
  const [selectedRackId, setSelectedRackIdState] = useState<string | null>(null);
  useEffect(() => {
    // `loadStoredRackId` retourne GENERAL_VIEW_ID en l'absence de valeur
    // persistée (première arrivée sur l'onglet) — on initialise donc toujours
    // la sélection, plus jamais à null.
    const stored = loadStoredRackId(projectId);
    if (stored) setSelectedRackIdState(stored);
  }, [projectId]);
  const setSelectedRackId = useCallback(
    (id: string | null) => {
      setSelectedRackIdState(id);
      persistRackId(projectId, id);
    },
    [projectId],
  );

  // Compteur de rafraîchissement — incrémenté par `useProjectSync` quand un
  // event SSE matche. Re-déclenche le fetch de la vue courante sans changer la
  // sélection (préserve la position dans le canvas synoptique).
  const [refreshTick, setRefreshTick] = useState(0);

  // ── Fetch general payload (mode Général multi-rack) ──────────────────────
  const [generalData, setGeneralData] = useState<GeneralPayload | null>(null);
  const [generalLoading, setGeneralLoading] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  // Idem en mode Général : loader visible seulement au tout premier fetch.
  const [generalInitialLoad, setGeneralInitialLoad] = useState(true);

  // ── Fetch location payload (vue emplacement multi-contenants) ────────────
  const [locationData, setLocationData] = useState<LocationPayload | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationInitialLoad, setLocationInitialLoad] = useState(true);

  const isGeneralMode = selectedRackId === GENERAL_VIEW_ID;
  const selectedLocationId = parseLocationViewId(selectedRackId);
  const isLocationMode = selectedLocationId !== null;

  // SSE — refetch de la vue courante quand un autre onglet modifie le projet
  // (inventaire BOM, placement de slot, connexion, adaptateur, zone, label…).
  // On accepte les events unscoped (compat ascendante avec /api/racks/[id]/…
  // qui ne publient pas projectId).
  useProjectSync({
    projectId,
    entities: [
      "rack_inventory",
      "rack",
      "rig",
      "slot",
      "rackConnection",
      // Events globaux catalogue supervisor — refetch quand l'admin modifie
      // un équipement / signal / connecteur (couleur, signalName, etc.).
      "catalog",
      "project_synoptic_connection",
      "project_synoptic_zone",
      "project_synoptic_label",
      "project_synoptic_adapter",
      "project_synoptic_bundle",
      "project_synoptic_layout",
      // Marques externes (création / suppression / typage) → rafraîchit les
      // bulles de la vue lieu et les ports des blocs en Général.
      "external_port",
      // Emplacements : création / renommage / affectation de contenant.
      "location",
    ],
    // Aucune vue n'est mono-contenant : pas de filtre rackId, on veut les
    // events de tous les contenants concernés.
    rackId: undefined,
    acceptUnscoped: true,
    onUpdate: () => setRefreshTick((t) => t + 1),
  });

  // ── Live signals / signalCategories (SSE refresh — parité rack-editor) ───
  const [liveSignals, setLiveSignals] = useState<SignalTypeDef[]>([]);
  const [liveSignalCategories, setLiveSignalCategories] = useState<SignalCategoryDef[]>([]);
  // Sync depuis le payload focus (ou l'agrégat de lieu) à chaque (re)chargement
  useEffect(() => {
    setLiveSignals(locationData?.signals ?? []);
    setLiveSignalCategories(locationData?.signalCategories ?? []);
  }, [locationData]);
  // SSE — réplique exacte de rack-editor.tsx : un EventSource /api/events qui
  // re-fetch /api/admin/signals (resp. signal-categories) sur entity=signal
  // (resp. signalCategory). Toléré si endpoint deprecated : guard isArray.
  useEffect(() => {
    return subscribeAppEvents((data) => {
      const payload = data as { entity?: string } | null;
      if (!payload) return;
      if (payload.entity === "signal") {
        fetch("/api/admin/signals")
          .then((r) => r.json())
          .then((d) => {
            if (Array.isArray(d)) setLiveSignals(d as SignalTypeDef[]);
          })
          .catch(() => {});
      }
      if (
        payload.entity === "signalCategory" ||
        payload.entity === "signal_category"
      ) {
        fetch("/api/admin/signal-categories")
          .then((r) => r.json())
          .then((d) => {
            if (Array.isArray(d)) setLiveSignalCategories(d as SignalCategoryDef[]);
          })
          .catch(() => {});
      }
    });
  }, []);

  // ── catColorMap (subcategory → hex color) — parité rack-editor.tsx L357 ──
  // Source : equipmentCategories renvoyé par la route de l'emplacement.
  // Algo identique à rack-editor : pour chaque parent, map child.name → parent.color
  // puis aussi parent.name → parent.color (fallback).
  const catColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    const cats = locationData?.equipmentCategories ?? [];
    for (const parent of cats) {
      for (const child of parent.children ?? []) {
        m[child.name] = parent.color;
      }
      m[parent.name] = parent.color;
    }
    return m;
  }, [locationData?.equipmentCategories]);

  // Reset general initial-load flag à chaque entrée dans le mode Général.
  // Le refetch SSE (refreshTick) ne reset PAS — on swap silencieusement.
  useEffect(() => {
    if (isGeneralMode) setGeneralInitialLoad(true);
  }, [isGeneralMode]);

  // ── Fetch général : déclenché en mode Général (refresh + SSE) ────────────
  useEffect(() => {
    if (!isGeneralMode) {
      setGeneralData(null);
      setGeneralError(null);
      setGeneralLoading(false);
      return;
    }
    let cancelled = false;
    setGeneralLoading(true);
    setGeneralError(null);
    // Ne pas reset `generalData` ici : on garde l'ancien canvas affiché pendant
    // un refetch SSE jusqu'au swap atomique dans .then.
    api
      .get<GeneralPayload>(`/api/tenant/projects/${projectId}/synoptic/general`)
      .then((payload) => {
        if (cancelled) return;
        setGeneralData(payload);
        setGeneralLoading(false);
        setGeneralInitialLoad(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error("[synoptique] general fetch failed:", e);
        setGeneralError(getApiErrorMessage(e));
        setGeneralLoading(false);
        setGeneralInitialLoad(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, isGeneralMode, refreshTick]);

  // Reset location initial-load flag à chaque changement d'emplacement.
  useEffect(() => {
    setLocationInitialLoad(true);
  }, [selectedLocationId]);

  // ── Fetch emplacement : agrégat multi-contenants (refresh + SSE) ─────────
  useEffect(() => {
    if (!selectedLocationId) {
      setLocationData(null);
      setLocationError(null);
      return;
    }
    let cancelled = false;
    setLocationError(null);
    // Comme pour le Général : on garde l'ancien payload affiché jusqu'au swap
    // atomique dans .then (pas de clignotement au refetch SSE).
    api
      .get<LocationPayload>(
        `/api/tenant/projects/${projectId}/synoptic/location/${selectedLocationId}`,
      )
      .then((payload) => {
        if (cancelled) return;
        setLocationData(payload);
        setLocationInitialLoad(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const apiError = e as { status?: number };
        if (apiError?.status === 404) {
          // Emplacement supprimé ou valeur localStorage périmée → Général.
          setSelectedRackId(GENERAL_VIEW_ID);
          setLocationError(null);
        } else {
          console.error(
            `[synoptique] location ${selectedLocationId} fetch failed:`,
            e,
          );
          setLocationError(getApiErrorMessage(e));
        }
        setLocationData(null);
        setLocationInitialLoad(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedLocationId, refreshTick, setSelectedRackId]);

  // ── cableNumbering depuis appConfig ──────────────────────────────────────
  // Même dérivation en vue rack focus et en vue emplacement (l'agrégat de lieu
  // renvoie le même bloc `appConfig`).
  const numberingAppConfig = locationData?.appConfig ?? null;
  const cableNumbering = useMemo(
    () =>
      numberingAppConfig
        ? {
            pad: Number(numberingAppConfig["cable_pad"] ?? 5),
            sep1:
              numberingAppConfig["cable_sep1"] ??
              numberingAppConfig["cable_separator"] ??
              "-",
            sep2:
              numberingAppConfig["cable_sep2"] ??
              numberingAppConfig["cable_suffix_separator"] ??
              "",
            includeRack: numberingAppConfig["cable_include_rack"] !== "false",
            template: numberingAppConfig["cable_template"] ?? "",
            templateEnabled: numberingAppConfig["cable_template_enabled"] === "true",
          }
        : undefined,
    [numberingAppConfig],
  );

  // ── Synoptic ref + selection state ──────────────────────────────────────
  const synopticRef = useRef<SynopticViewHandle>(null);
  // Panneau d'export unifié (slide-up in-panel), piloté par le footer.
  const [exportOpen, setExportOpen] = useState(false);
  // …ou par le modal Dossier, qui bascule sur cet onglet en demandant son
  // export. Le signal est consommé à la lecture.
  usePendingExport("synoptique", () => setExportOpen(true));
  const [synopticActivePanel, setSynopticActivePanel] = useState<
    "renumber" | "manual" | "validation" | "audit" | null
  >(null);
  const [renumberPanelNode, setRenumberPanelNode] = useState<ReactNode | null>(null);
  const [manualPanelNode, setManualPanelNode] = useState<ReactNode | null>(null);
  const [cableDetails, setCableDetails] = useState<CableSelectionDetails | null>(null);
  const [multiCableSummaries, setMultiCableSummaries] = useState<CableSummary[]>([]);
  // Multi-sélection nodes (équipements) — déclenche l'affichage du panneau
  // SynopticMultiNodePropertiesPanel quand nodeCount > 1.
  const [multiNodeSummary, setMultiNodeSummary] = useState<{
    nodeCount: number;
    rackCount: number;
  }>({ nodeCount: 0, rackCount: 0 });
  const [adapterDetails, setAdapterDetails] = useState<AdapterSelectionDetails | null>(null);
  const [zoneDetails, setZoneDetails] = useState<ZoneSelectionDetails | null>(null);
  const [labelDetails, setLabelDetails] = useState<LabelSelectionDetails | null>(null);
  const [nodeDetails, setNodeDetails] = useState<NodeSelectionDetails | null>(null);
  const [externalDetails, setExternalDetails] = useState<ExternalPortSelectionDetails | null>(
    null,
  );
  const [multiExternalSummaries, setMultiExternalSummaries] = useState<
    ExternalPortSummary[]
  >([]);
  const [liveConnections, setLiveConnections] = useState<RackConnectionDTO[]>([]);
  // ── Vue Générale : sélection rack / connexion inter-rack ────────────────
  const [generalRackDetails, setGeneralRackDetails] =
    useState<GeneralRackSelection | null>(null);
  const [generalConnectionDetails, setGeneralConnectionDetails] =
    useState<GeneralConnectionSelection | null>(null);
  // Reset sélections Général quand on sort du mode Général (sinon panneau
  // affiche encore le dernier rack/connexion sélectionné après bascule focus).
  useEffect(() => {
    if (!isGeneralMode) {
      setGeneralRackDetails(null);
      setGeneralConnectionDetails(null);
    }
  }, [isGeneralMode]);

  // ── Legend toggle handler (vue Générale) ────────────────────────────────
  // En mode Général, SynopticView n'est pas monté, donc personne ne publie
  // `onToggleSynopticLegend`. Le panneau Général affiche pourtant l'option
  // Légende (parité visuelle avec le rack focus). On publie ici un handler
  // qui flippe la valeur persistée `synopticLegendVisible` du store (même
  // valeur que celle utilisée en focus). Le rendu d'une légende visuelle
  // côté canvas Général reste à implémenter — pour l'instant le toggle
  // permet seulement de mémoriser la préférence utilisateur.
  useEffect(() => {
    if (!isGeneralMode) return;
    const { setSynopticLegendHandlers, synopticLegendVisible } = useTopbarActions.getState();
    setSynopticLegendHandlers({
      visible: synopticLegendVisible,
      onToggle: () => {
        const current = useTopbarActions.getState().synopticLegendVisible;
        useTopbarActions.getState().setSynopticLegendHandlers({
          visible: !current,
          onToggle: useTopbarActions.getState().onToggleSynopticLegend,
        });
      },
    });
    return () => {
      // Préserve la valeur persistée au démontage ; retire seulement le toggle.
      const v = useTopbarActions.getState().synopticLegendVisible;
      useTopbarActions.getState().setSynopticLegendHandlers({
        visible: v,
        onToggle: undefined,
      });
    };
  }, [isGeneralMode]);

  // ── Mini-map toggle handler (vue Générale) ──────────────────────────────
  // Même pattern que la légende : SynopticView n'est pas monté en Général,
  // donc personne ne publie le toggle mini-map du workspace synoptique.
  // On publie ici un handler qui flippe la visibilité (persistée via le store).
  // Le rendu visuel du mini-map sur le canvas Général reste à implémenter —
  // le toggle mémorise la préférence utilisateur.
  useEffect(() => {
    if (!isGeneralMode) return;
    const initial = useTopbarActions.getState().miniMapByWs.synoptic.visible;
    useTopbarActions.getState().setMiniMap("synoptic", {
      visible: initial,
      onToggle: () => {
        const current = useTopbarActions.getState().miniMapByWs.synoptic.visible;
        useTopbarActions.getState().setMiniMap("synoptic", {
          visible: !current,
          onToggle: useTopbarActions.getState().miniMapByWs.synoptic.onToggle,
        });
      },
    });
    return () => {
      const v = useTopbarActions.getState().miniMapByWs.synoptic.visible;
      useTopbarActions.getState().setMiniMap("synoptic", {
        visible: v,
        onToggle: undefined,
      });
    };
  }, [isGeneralMode]);

  // Sync liveConnections quand le payload focus (ou lieu) change
  useEffect(() => {
    setLiveConnections(locationData?.connections ?? []);
  }, [locationData]);

  // ── Workspace store + keyboard shortcuts (synopticRegistry) ────────────
  const workspace = useWorkspace((s) => s.workspace);
  const activeToolId = useWorkspace((s) => s.activeToolId);
  const activeVariantId = useWorkspace((s) => s.activeVariantId);
  const workspaceStore = useWorkspaceStore();
  // En mode Général : on retire les outils non pertinents (adapter +
  // connexions externes). Les autres (select/pan/move/cable/label/zone/erase)
  // restent disponibles. Le registry filtré est aussi passé au LeftToolbar /
  // ContextualTopbar / useKeyboardShortcuts pour cacher les boutons ET
  // désactiver les raccourcis associés.
  const effectiveRegistry = useMemo(() => {
    if (!isGeneralMode) return synopticRegistry;
    const hiddenIds = new Set(["adapter", "external"]);
    return {
      ...synopticRegistry,
      tools: synopticRegistry.tools.filter((t) => !hiddenIds.has(t.id)),
    };
  }, [isGeneralMode]);
  useKeyboardShortcuts(workspace === "synoptic" ? effectiveRegistry : null);

  // Outil par défaut : Sélection. Le store workspace démarre à `null` (aucune
  // mémoire d'outil pour le synoptique) — sans ça, l'onglet s'ouvre sans
  // outil actif dans la toolbar.
  useEffect(() => {
    if (workspaceStore.getState().activeToolId === null) {
      workspaceStore.getState().setTool("select");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Publier le workspace actif au store topbar (scope undo/redo, mini-map)
  useEffect(() => {
    if (workspace === "synoptic") {
      useTopbarActions.getState().setActiveWorkspace("synoptic");
    }
  }, [workspace]);

  // Bridge shell ↔ synoptic-view : tool actif
  useEffect(() => {
    if (workspace !== "synoptic" || !activeToolId) return;
    const current = synopticRef.current?.getActiveTool?.();
    if (current !== activeToolId) {
      synopticRef.current?.setActiveTool?.(activeToolId);
    }
  }, [activeToolId, workspace]);

  // Bridge variant zoom → synoptic-view
  useEffect(() => {
    if (workspace !== "synoptic") return;
    if (activeToolId === "zoom") {
      const v = activeVariantId === "out" ? "out" : "in";
      synopticRef.current?.setZoomVariant?.(v);
    }
  }, [activeToolId, activeVariantId, workspace]);

  // Hydrate tool from localStorage (clé scopée par workspace, partagée avec
  // rack-editor → cohérent de session à session).
  useEffect(() => {
    if (workspace !== "synoptic") return;
    try {
      const raw = localStorage.getItem(`arkyo-last-tool-${workspace}`);
      if (raw) {
        const { toolId, variantId } = JSON.parse(raw);
        if (toolId) {
          workspaceStore.getState().setTool(toolId, variantId ?? null);
        } else {
          workspaceStore.getState().setTool("select", null);
        }
      } else {
        workspaceStore.getState().setTool("select", null);
      }
    } catch {
      workspaceStore.getState().setTool("select", null);
    }
  }, [workspace, workspaceStore]);

  // Persist active tool
  useEffect(() => {
    if (!activeToolId || workspace !== "synoptic") return;
    try {
      localStorage.setItem(
        `arkyo-last-tool-${workspace}`,
        JSON.stringify({ toolId: activeToolId, variantId: activeVariantId }),
      );
    } catch {}
  }, [activeToolId, activeVariantId, workspace]);

  // Synoptic tool change callback (synoptic-view → workspace store)
  const handleSynopticToolChange = useCallback(
    (toolId: string) => {
      const state = workspaceStore.getState();
      if (state.workspace !== "synoptic") return;
      if (state.activeToolId !== toolId) {
        state.setTool(toolId, null);
      }
    },
    [workspaceStore],
  );

  // ── Zoom handlers + value bridge (topbar store) ─────────────────────────
  // En vue emplacement : on publie les handlers visant `synopticRef` (le
  // LocationCanvas nous transmet le handle du SynopticView qu'il monte).
  // En mode Général : le GeneralCanvas publie SES handlers via le même store
  // (cf. _components/general-canvas.tsx) — on gate donc cet effet pour ne pas
  // les écraser, et on republie les nôtres au retour sur un emplacement.
  const setZoomHandlersStore = useTopbarActions((s) => s.setZoomHandlers);
  const setZoomValueStore = useTopbarActions((s) => s.setZoomValue);
  const [synopticZoomValue, setSynopticZoomValue] = useState(1);
  useEffect(() => {
    if (isGeneralMode) return; // GeneralCanvas gère ses propres zoom handlers
    setZoomHandlersStore({
      onZoomIn: () => synopticRef.current?.zoomIn?.(),
      onZoomOut: () => synopticRef.current?.zoomOut?.(),
      onZoomFit: () => synopticRef.current?.zoomFit?.(),
      onZoomReset: () => synopticRef.current?.zoomReset?.(),
      onCenter: () => synopticRef.current?.zoomCenter?.(),
    });
  }, [isGeneralMode, setZoomHandlersStore]);
  useEffect(() => {
    if (isGeneralMode) return; // GeneralCanvas publie sa propre valeur de zoom
    setZoomValueStore(synopticZoomValue);
  }, [isGeneralMode, synopticZoomValue, setZoomValueStore]);

  // ── Writers cable/label/zone + numbering + adapter + erase ───────────────
  const setSynopticWritersStore = useTopbarActions((s) => s.setSynopticWriters);
  const setNumberingHandlersStore = useTopbarActions((s) => s.setNumberingHandlers);
  const setOnPickAdapterStore = useTopbarActions((s) => s.setOnPickAdapter);
  const setOnInsertAdapterAtPortStore = useTopbarActions(
    (s) => s.setOnInsertAdapterAtPort,
  );
  const setAvailableAdaptersStore = useTopbarActions((s) => s.setAvailableAdapters);
  const setPickingAdapterIdStore = useTopbarActions((s) => s.setPickingAdapterId);
  const setSynopticEraseHandlersStore = useTopbarActions(
    (s) => s.setSynopticEraseHandlers,
  );

  // Charge les adaptateurs disponibles (pour le picker contextuel d'outil)
  useEffect(() => {
    let aborted = false;
    fetch("/api/tenant/catalogue/adapters")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (aborted) return;
        // L'API renvoie `{ arkyo: T[], personal: T[] }` (catalogue tenant) —
        // on fusionne les deux. Fallback tableau simple par rétro-compat.
        const obj = data as { arkyo?: unknown; personal?: unknown };
        const raw: unknown[] = Array.isArray(data)
          ? data
          : [
              ...(Array.isArray(obj.arkyo) ? obj.arkyo : []),
              ...(Array.isArray(obj.personal) ? obj.personal : []),
            ];
        const mapPorts = (v: unknown) =>
          Array.isArray(v)
            ? (v as Array<{
                connectorTypeId?: string | null;
                quantity?: number | null;
                label?: string | null;
                gender?: string | null;
              }>)
            : null;
        const list = raw.map((x) => {
          const a = x as Record<string, unknown>;
          return {
            id: String(a.id ?? ""),
            name: String(a.name ?? ""),
            reference: (a.reference as string | null) ?? null,
            imageUrl: (a.imageUrl as string | null) ?? null,
            inputs: mapPorts(a.inputs),
            outputs: mapPorts(a.outputs),
          };
        });
        setAvailableAdaptersStore(list);
      })
      .catch(() => {
        if (!aborted) setAvailableAdaptersStore([]);
      });
    return () => {
      aborted = true;
      setAvailableAdaptersStore([]);
      setPickingAdapterIdStore(null);
    };
  }, [setAvailableAdaptersStore, setPickingAdapterIdStore]);

  useEffect(() => {
    // En mode Général : le bridge writers/handlers est publié par
    // GeneralCanvas (qui monte son propre SynopticView). On ne touche pas au
    // store ici. En vue emplacement, `synopticRef` pointe sur le handle
    // transmis par LocationCanvas.
    if (isGeneralMode) return;
    setSynopticWritersStore({
      setCableStyle: (v) => synopticRef.current?.setCableStyle?.(v),
      setCableCount: (v) => synopticRef.current?.setCableCount?.(v),
      setCableMode: (v) => synopticRef.current?.setCableMode?.(v),
      setLabelFont: (v) => synopticRef.current?.setLabelFont?.(v),
      setLabelFontSize: (v) => synopticRef.current?.setLabelFontSize?.(v),
      setLabelColor: (v) => synopticRef.current?.setLabelColor?.(v),
      setZoneColor: (v) => synopticRef.current?.setZoneColor?.(v),
    });
    setNumberingHandlersStore({
      onRenumberAuto: () => synopticRef.current?.openRenumberModal?.(),
      onManualNumber: () => synopticRef.current?.openManualNumberModal?.(),
    });
    setOnPickAdapterStore(() => () => synopticRef.current?.openAdapterPicker?.());
    setOnInsertAdapterAtPortStore((adapterId, port) => {
      void synopticRef.current?.insertAdapterAtPort?.(adapterId, port);
    });
    setSynopticEraseHandlersStore({
      onClearLabels: () => synopticRef.current?.clearAllLabels?.(),
      onDecable: () => synopticRef.current?.clearAllCables?.(),
    });
    return () => {
      setSynopticWritersStore({});
      setNumberingHandlersStore({});
      setOnPickAdapterStore(undefined);
      setOnInsertAdapterAtPortStore(undefined);
      setSynopticEraseHandlersStore({});
    };
  }, [
    isGeneralMode,
    setSynopticWritersStore,
    setNumberingHandlersStore,
    setOnPickAdapterStore,
    setOnInsertAdapterAtPortStore,
    setSynopticEraseHandlersStore,
  ]);

  // ── Togglers (validation, audit, renumber, manual) ────────────────────────
  // L'export PNG/PDF (plan A0→A4 avec cartouche paramétrable) passe par le
  // slideover unifié `ProjectViewExport` (piloté par `exportOpen`), qui délègue
  // la génération poster au canvas via `synopticRef.exportPdf` avec la spec
  // cartouche (modèle + slots) — voir prop `poster` plus bas.
  const toggleRenumberPanel = useCallback(() => {
    // Même flow en rack focus ET en mode Général : ouvre l'overlay renumber.
    // Le synopticRef (forwardé via GeneralCanvas en Général) déclenche l'ouverture
    // du modal interne de SynopticView qui publie son contenu via
    // onRenumberPanelChange.
    setSynopticActivePanel((p) => (p === "renumber" ? null : "renumber"));
  }, []);
  const toggleValidationPanel = useCallback(() => {
    setSynopticActivePanel((p) => (p === "validation" ? null : "validation"));
  }, []);
  const toggleAuditPanel = useCallback(() => {
    setSynopticActivePanel((p) => (p === "audit" ? null : "audit"));
  }, []);

  // Publier les togglers validation + audit dans le store (consommés par
  // SynopticActionsBar et raccourcis). Les boutons sont disponibles aussi en
  // mode Général : le ValidationOverlayContent affiche son fallback "pas de
  // rapport", et l'AuditPanelContent un placeholder demandant la sélection
  // d'un rack (pas d'API audit projet agrégée à ce stade).
  useEffect(() => {
    useTopbarActions.getState().setOnValidateRack(toggleValidationPanel);
    useTopbarActions.getState().setOnToggleAuditPanel(toggleAuditPanel);
    if (isGeneralMode) {
      // En mode Général : pas de rack focus → reset les compteurs/badge OK/err/warn
      // qui sont rack-specific. L'overlay s'ouvre quand même (rapport vide).
      useTopbarActions.getState().setValidationCounts(0, 0, 0);
      useTopbarActions.getState().setValidationReport(null);
    }
    return () => {
      useTopbarActions.getState().setOnValidateRack(undefined);
      useTopbarActions.getState().setOnToggleAuditPanel(undefined);
    };
  }, [isGeneralMode, toggleValidationPanel, toggleAuditPanel]);

  // Sync synoptic-view's internal modal state avec activePanel.
  useEffect(() => {
    if (synopticActivePanel === null) {
      synopticRef.current?.closePdfModal?.();
      synopticRef.current?.closeRenumberPanel?.();
      synopticRef.current?.closeManualPanel?.();
    } else if (synopticActivePanel === "renumber") {
      synopticRef.current?.closePdfModal?.();
      synopticRef.current?.closeManualPanel?.();
      synopticRef.current?.openRenumberModal?.();
    } else if (synopticActivePanel === "manual") {
      synopticRef.current?.closePdfModal?.();
      synopticRef.current?.closeRenumberPanel?.();
      synopticRef.current?.openManualNumberModal?.();
    } else {
      synopticRef.current?.closePdfModal?.();
      synopticRef.current?.closeRenumberPanel?.();
      synopticRef.current?.closeManualPanel?.();
    }
  }, [synopticActivePanel]);

  // Fermeture auto si synoptic-view relâche le renumber/manual panel
  const renumberNodeWasOpen = useRef(false);
  useEffect(() => {
    if (synopticActivePanel !== "renumber") {
      renumberNodeWasOpen.current = renumberPanelNode !== null;
      return;
    }
    if (renumberPanelNode !== null) {
      renumberNodeWasOpen.current = true;
      return;
    }
    if (renumberNodeWasOpen.current) {
      renumberNodeWasOpen.current = false;
      setSynopticActivePanel(null);
    }
  }, [renumberPanelNode, synopticActivePanel]);
  const manualNodeWasOpen = useRef(false);
  useEffect(() => {
    if (synopticActivePanel !== "manual") {
      manualNodeWasOpen.current = manualPanelNode !== null;
      return;
    }
    if (manualPanelNode !== null) {
      manualNodeWasOpen.current = true;
      return;
    }
    if (manualNodeWasOpen.current) {
      manualNodeWasOpen.current = false;
      setSynopticActivePanel(null);
    }
  }, [manualPanelNode, synopticActivePanel]);

  // ── Stats agrégées (poids + conso) pour le SynopticGeneralPanel ──────────
  const statsSlots = locationData?.slots ?? null;
  const { totalWeightKg, totalPowerW } = useMemo(() => {
    if (!statsSlots) return { totalWeightKg: 0, totalPowerW: 0 };
    let w = 0;
    let p = 0;
    for (const s of statsSlots) {
      const eq = (s as { equipment?: { weight?: number | null; powerW?: number | null } | null })
        .equipment;
      w += eq?.weight ?? 0;
      p += eq?.powerW ?? 0;
      const children = (s as { children?: typeof statsSlots }).children ?? [];
      for (const child of children) {
        const ceq = (child as { equipment?: { weight?: number | null; powerW?: number | null } | null })
          .equipment;
        w += ceq?.weight ?? 0;
        p += ceq?.powerW ?? 0;
      }
    }
    return { totalWeightKg: w, totalPowerW: p };
  }, [statsSlots]);

  // ── Layers + propriétés générales du rack ────────────────────────────────
  const synopticLayers = useMemo(() => {
    const sourceConnections = liveConnections.length
      ? liveConnections
      : (locationData?.connections ?? []);
    const cables = sourceConnections.map((c: any) => ({
      id: c.id,
      signalCategoryId: c.signalCategory ?? c.signalCategoryRef?.name ?? null,
    }));
    const categories = (liveSignalCategories ?? []).map((cat) => ({
      id: cat.name,
      name: cat.name,
      color: null,
    }));
    return deriveSynopticLayers(cables, categories);
  }, [liveConnections, locationData?.connections, liveSignalCategories]);

  // Panneau par défaut de la vue emplacement (pas de type ni de hauteur U —
  // le lieu agrège plusieurs contenants). Le renommage se fait dans
  // l'Inventaire.
  const locationPropertiesContent = locationData ? (
    <div className="flex flex-col gap-4 text-xs">
      <SynopticGeneralPanel
        rackName={locationData.location.name}
        totalWeightKg={totalWeightKg}
        totalPowerW={totalPowerW}
      />
      <SynopticBundlesSection />
      {synopticLayers.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase">
            Répartition par signal
          </div>
          <div className="flex flex-col gap-0.5">
            {synopticLayers.map((layer) => (
              <div
                key={layer.id}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px]"
              >
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ background: layer.color ?? "#888" }}
                />
                <span className="flex-1 truncate">{layer.name}</span>
                <span
                  className="text-muted-foreground"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {layer.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="border-border text-muted-foreground mt-auto border-t pt-3 text-[10px] italic">
        Cliquez un élément du synoptique pour voir ses détails.
      </div>
    </div>
  ) : null;

  // Contenant portant le slot sélectionné : en vue emplacement, le contenant
  // réel du slot (les slots agrégés portent `rackId`). Sert au PATCH du slot
  // depuis le panneau de propriétés.
  const nodeRackId = useMemo(() => {
    if (!locationData || !nodeDetails) return null;
    const find = (list: RackSlotWithEquipment[]): string | null => {
      for (const s of list) {
        if (s.id === nodeDetails.slotId) return s.rackId ?? null;
        const children = (s as { children?: RackSlotWithEquipment[] }).children;
        if (Array.isArray(children)) {
          const hit = find(children);
          if (hit) return hit;
        }
      }
      return null;
    };
    return find(locationData.slots) ?? locationData.location.virtualRackId;
  }, [locationData, nodeDetails]);

  // ── Sélection : node / adapter / zone / label / cable / multi-cable ──────
  // Versions épurées (handlers identiques à rack-editor, UI minimaliste) —
  // l'essentiel est le wiring `synopticRef.current?.*`.
  const synopticNodeDetails = nodeDetails && nodeRackId ? (
    <SynopticNodePropertiesPanel
      node={nodeDetails}
      rackId={nodeRackId}
      catColorMap={catColorMap}
      connections={
        (locationData?.connections ?? []) as ReadonlyArray<{
          id: string;
          fromSlotId?: string;
          toSlotId?: string;
        }>
      }
      onStartManualNumberForCables={(ids) =>
        synopticRef.current?.startManualNumberForCables?.(ids)
      }
      onAfterStartManualNumber={() => setSynopticActivePanel("manual")}
    />
  ) : null;

  const synopticAdapterDetails = adapterDetails ? (
    <SynopticAdapterPropertiesPanel
      adapter={adapterDetails}
      onUpdateLabel={(id, label) => synopticRef.current?.updateAdapterLabel?.(id, label)}
      onDelete={(id) => synopticRef.current?.deleteAdapter?.(id)}
    />
  ) : null;

  const synopticZoneDetails = zoneDetails ? (
    <SynopticZonePropertiesPanel
      zone={zoneDetails}
      onUpdate={(id, patch) => synopticRef.current?.updateZone?.(id, patch)}
      onDelete={(id) => synopticRef.current?.deleteZone?.(id)}
    />
  ) : null;

  const synopticLabelDetails = labelDetails ? (
    <SynopticLabelPropertiesPanel
      label={labelDetails}
      onUpdate={(id, patch) => synopticRef.current?.updateLabel?.(id, patch)}
      onDelete={(id) => synopticRef.current?.deleteLabel?.(id)}
    />
  ) : null;

  const synopticSelectionDetails = cableDetails ? (
    <SynopticCablePropertiesPanel
      cable={cableDetails}
      onSetStyle={(ids, style) => synopticRef.current?.setConnectionStyle?.(ids, style)}
      onStartManualNumber={(id) => synopticRef.current?.startManualNumberForCable?.(id)}
      onClearLabel={(id) => synopticRef.current?.clearCableLabel?.(id)}
      onDelete={(id) => synopticRef.current?.deleteCable?.(id)}
      onSetCableModel={(id, cableModelId) =>
        synopticRef.current?.setConnectionCableModel?.(id, cableModelId)
      }
    />
  ) : null;

  const synopticMultiSelection =
    multiCableSummaries.length > 1 ? (
      <SynopticMultiCablePropertiesPanel
        summaries={multiCableSummaries}
        onSetStyle={(ids, style) => synopticRef.current?.setConnectionStyle?.(ids, style)}
        onStartManualNumberForIds={(ids) =>
          synopticRef.current?.startManualNumberForCables?.(ids)
        }
        onClearLabelsForIds={(ids) => synopticRef.current?.clearCableLabelsForIds?.(ids)}
        onDeleteForIds={(ids) => synopticRef.current?.deleteCablesForIds?.(ids)}
        onSetCableModelForIds={(ids, cableModelId) => {
          for (const id of ids) {
            synopticRef.current?.setConnectionCableModel?.(id, cableModelId);
          }
        }}
      />
    ) : null;

  const synopticExternalDetails = externalDetails ? (
    <SynopticExternalPortPropertiesPanel
      external={externalDetails}
      onDelete={(id) => synopticRef.current?.deleteExternalPort?.(id)}
      onSetKind={(id, kind) => synopticRef.current?.setExternalKind?.(id, kind)}
      onSetWorldLabel={(id, label) => synopticRef.current?.setExternalLabel?.(id, label)}
    />
  ) : null;

  // Panneau multi-équipements — affiché quand >1 node sélectionné, en
  // priorité sur le single `synopticNodeDetails` (le selectedNodeId du single
  // reste celui du dernier cliqué, mais on bascule l'affichage sur le multi
  // pour cohérence UX). Compte les contenants (racks distincts) :
  // - focus rack : rackCount = 1
  // - général    : rackCount = nodeCount (1 node = 1 rack)
  const synopticMultiNode =
    multiNodeSummary.nodeCount > 1 ? (
      <SynopticMultiNodePropertiesPanel
        nodeCount={multiNodeSummary.nodeCount}
        rackCount={multiNodeSummary.rackCount}
      />
    ) : null;

  const synopticMultiExternal =
    multiExternalSummaries.length > 1 ? (
      <SynopticMultiExternalPropertiesPanel
        summaries={multiExternalSummaries}
        onClearLabelsForIds={(ids) => {
          for (const id of ids) {
            synopticRef.current?.setExternalLabel?.(id, null);
          }
        }}
        onDeleteForIds={(ids) =>
          synopticRef.current?.deleteExternalPortsForIds?.(ids)
        }
      />
    ) : null;

  // ── Vue Générale : actions sur connexion + ouverture d'un emplacement ───
  const handleDeleteGeneralConnection = useCallback(
    async (connectionId: string) => {
      try {
        await apiFetch(
          `/api/tenant/projects/${projectId}/synoptic/connections/${connectionId}`,
          { method: "DELETE" },
        );
        setGeneralConnectionDetails(null);
        setRefreshTick((t) => t + 1);
      } catch (err) {
        console.error("[synoptique] delete general connection failed:", err);
      }
    },
    [projectId],
  );
  // Seuls les blocs « emplacement » sont ouvrables : la vue focus par
  // contenant n'existe plus (phase 3).
  const handleOpenLocationFromGeneral = useCallback(
    (locationId: string) => {
      setSelectedRackId(locationViewId(locationId));
      setGeneralRackDetails(null);
      setGeneralConnectionDetails(null);
    },
    [setSelectedRackId],
  );

  // ── Panneaux de propriétés Général (bloc ou connexion) ───────────────────
  const generalRackPanelNode =
    isGeneralMode && generalRackDetails ? (
      <GeneralRackPropertiesPanel
        rack={generalRackDetails}
        onOpen={
          generalRackDetails.kind === "location"
            ? handleOpenLocationFromGeneral
            : undefined
        }
      />
    ) : null;
  const generalConnectionPanelNode =
    isGeneralMode && generalConnectionDetails ? (
      <GeneralConnectionPropertiesPanel
        connection={generalConnectionDetails}
        onSetStyle={(id, style) =>
          synopticRef.current?.setConnectionStyle?.([id], style)
        }
        onDelete={handleDeleteGeneralConnection}
      />
    ) : null;
  // Panneau Général (infos projet + options visuelles) quand rien n'est sélectionné.
  const generalEmptyPanelNode = isGeneralMode ? (
    <GeneralInfoPanel projectName={generalData?.project?.name ?? "Projet"} />
  ) : null;

  // ── Right panel — composition finale (Propriétés / Calques + footer) ────
  // Enveloppé dans un conteneur `relative` : le slideover d'export unifié
  // (`ProjectViewExport`) se superpose au panneau (au-dessus du footer, dont le
  // bouton « Exporter » le pilote), même pattern que l'Inventaire/Câblage.
  const synopticRightPanel = (
    <div className="relative flex h-full min-h-0 flex-col">
    <RightPanel
      propertiesSlot={
        isGeneralMode
          ? // En mode Général : priorité au multi (cables ≥2 puis nodes ≥2),
            // puis aux single (connection puis rack), puis au placeholder vide.
            // Le panneau multi-câbles est le MÊME que en focus rack — exposé
            // ici pour parité fonctionnelle (cf. demande user).
            (multiCableSummaries.length > 1
              ? synopticMultiSelection
              : null) ??
            generalConnectionPanelNode ??
            synopticMultiNode ??
            generalRackPanelNode ??
            generalEmptyPanelNode
          : // En vue emplacement : le multi-nodes prend la priorité sur le
            // single node (le panneau de l'équipement seul n'a pas de sens
            // quand plusieurs sont sélectionnés).
            synopticMultiNode ??
            synopticNodeDetails ??
            synopticAdapterDetails ??
            synopticZoneDetails ??
            synopticLabelDetails ??
            synopticExternalDetails ??
            synopticSelectionDetails ??
            (multiExternalSummaries.length > 1
              ? synopticMultiExternal
              : multiCableSummaries.length > 1
                ? synopticMultiSelection
                : locationPropertiesContent)
      }
      layersSlot={<SynopticLayersPanel categoryColors={catColorMap} />}
      footerSlot={
        <SynopticActionsBar
          onExportPdf={() => setExportOpen((v) => !v)}
          activePanel={exportOpen ? "pdf" : synopticActivePanel}
          onRenumber={toggleRenumberPanel}
        />
      }
      overlayPanel={
        renumberPanelNode
          ? {
              title: "Numérotation",
              onClose: () => {
                synopticRef.current?.closeRenumberPanel?.();
                setSynopticActivePanel(null);
              },
              content: renumberPanelNode,
            }
          : manualPanelNode
            ? {
                title: "Numérotation sélection",
                onClose: () => {
                  synopticRef.current?.closeManualPanel?.();
                  setSynopticActivePanel(null);
                },
                content: manualPanelNode,
              }
            : synopticActivePanel === "validation"
              ? {
                  title: "Validation synoptique",
                  onClose: () => setSynopticActivePanel(null),
                  content: <ValidationOverlayContent />,
                }
              : synopticActivePanel === "audit"
                ? {
                    title: "Historique",
                    onClose: () => setSynopticActivePanel(null),
                    // Aucune vue n'est mono-contenant : audit projet-scopé
                    // agrégé (Project + Racks + RackConnection +
                    // ProjectConnection) via /api/tenant/projects/[id]/audit.
                    content: <AuditPanelContent projectId={projectId} />,
                  }
                : null
      }
    />
      {/* Slideover d'export unifié — superposé au panneau droit (slide-up). */}
      <ProjectViewExport
        projectId={projectId}
        projectName={projectName}
        filePrefix="SYNOPTIQUE_"
        fileStem="Synoptique"
        title="Exporter le synoptique"
        viewLabel="Synoptique"
        // Cellule LIEU du cartouche intégré : l'emplacement affiché. La vue
        // Générale couvre tout le projet — elle n'a pas de lieu, la cellule
        // reste vide plutôt que de mentir.
        locationLabel={
          isGeneralMode
            ? null
            : (locations.find((l) => l.id === selectedLocationId)?.name ?? null)
        }
        captureSelector="[data-synoptic-capture]"
        captureMissingMessage="Vue synoptique introuvable."
        // Un export montre le plan, pas l'éditeur : grille, repères, règles,
        // minimap et chrome UI sont masqués pendant la capture.
        hideSelectors={[
          "[data-synoptic-grid]",
          "[data-synoptic-guides]",
          "[data-guide-hit]",
          "[data-synoptic-rulers]",
          "[data-minimap]",
          "[data-key-hints]",
        ]}
        canExport={isGeneralMode ? !!generalData : !!locationData}
        open={exportOpen}
        onOpenChange={setExportOpen}
        // Plan A0→A4 / PNG HD : délégué au canvas synoptique via la ref
        // impérative. La spec cartouche (modèle + slots) est transmise au
        // générateur poster qui l'utilise à la place de ses champs par défaut.
        poster={async (opts) => {
          const run = synopticRef.current?.exportPdf;
          if (!run) throw new Error("Vue synoptique introuvable.");
          // Générateur PUR : le blob remonte au modal, qui télécharge ou
          // enregistre selon le geste de l'utilisateur.
          return run(opts);
        }}
        // Aperçu VIVANT : la colonne du modal montre la page elle-même, avec
        // une copie inerte du canvas. Même préparation que la capture, donc le
        // document produit ne peut pas diverger de ce qui est affiché.
        buildPreviewClone={(o) =>
          synopticRef.current?.buildExportClone?.(o) ?? null
        }
      />
    </div>
  );

  // ── Tool actif synoptique (relayé au GeneralCanvas) ─────────────────────
  const generalTool: "select" | "pan" | "cable" | "erase" =
    activeToolId === "cable"
      ? "cable"
      : activeToolId === "pan"
        ? "pan"
        : activeToolId === "erase"
          ? "erase"
          : "select";

  // ── Canvas : vue emplacement, vue Générale, ou état vide — le sélecteur de
  //    vue vit dans le subheader (leftSlot du ContextualTopbar) ─────────────
  const canvasContent = !selectedRackId ? (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<Loader2 className="h-6 w-6" />}
        title="Aucune vue sélectionnée"
        description="Sélectionnez un emplacement ou la vue Générale pour afficher le synoptique."
      />
    </div>
  ) : isLocationMode ? (
    <div className="relative flex h-full w-full overflow-hidden" data-synoptic-capture>
      {locationInitialLoad && !locationData ? (
        <div className="flex h-full items-center justify-center">
          {locationError ? (
            <EmptyState
              icon={<Loader2 className="h-6 w-6" />}
              title="Erreur de chargement"
              description={locationError}
            />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          )}
        </div>
      ) : locationData ? (
        <LocationCanvas
          key={locationData.location.id}
          ref={synopticRef}
          projectId={projectId}
          payload={locationData}
          cableNumbering={cableNumbering}
          onRefresh={() => setRefreshTick((t) => t + 1)}
          onConnectionsChange={setLiveConnections}
          onCableDetailsChange={setCableDetails}
          onNodeDetailsChange={setNodeDetails}
          onAdapterDetailsChange={setAdapterDetails}
          onZoneDetailsChange={setZoneDetails}
          onLabelDetailsChange={setLabelDetails}
          onExternalDetailsChange={setExternalDetails}
          onMultiCableSelectionChange={setMultiCableSummaries}
          onMultiNodeSelectionChange={setMultiNodeSummary}
          onMultiExternalSelectionChange={setMultiExternalSummaries}
          onToolChange={handleSynopticToolChange}
          onZoomChange={setSynopticZoomValue}
          onRenumberPanelChange={setRenumberPanelNode}
          onManualPanelChange={setManualPanelNode}
        />
      ) : (
        <div className="flex h-full items-center justify-center">
          {locationError ? (
            <EmptyState
              icon={<Loader2 className="h-6 w-6" />}
              title="Erreur de chargement"
              description={locationError}
            />
          ) : null}
        </div>
      )}
    </div>
  ) : isGeneralMode ? (
    <div className="relative flex h-full w-full overflow-hidden" data-synoptic-capture>
      {/* Loader visible UNIQUEMENT au tout premier chargement (pas de payload).
          Sur un refetch SSE, `generalData` reste défini → on garde le canvas
          affiché pour éviter le clignotement entre deux versions. */}
      {generalInitialLoad && !generalData ? (
        <div className="flex h-full items-center justify-center">
          {generalError ? (
            <EmptyState
              icon={<Loader2 className="h-6 w-6" />}
              title="Erreur de chargement"
              description={generalError}
            />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          )}
        </div>
      ) : generalData ? (
        <GeneralCanvas
          ref={synopticRef}
          projectId={projectId}
          payload={generalData}
          activeTool={generalTool}
          onRefresh={() => setRefreshTick((t) => t + 1)}
          onRackDetailsChange={setGeneralRackDetails}
          onConnectionDetailsChange={setGeneralConnectionDetails}
          onMultiCableSelectionChange={setMultiCableSummaries}
          onMultiNodeSelectionChange={setMultiNodeSummary}
          onRenumberPanelChange={setRenumberPanelNode}
          onManualPanelChange={setManualPanelNode}
        />
      ) : (
        // Cas marginal : pas en initial-load mais payload null (erreur fetch).
        <div className="flex h-full items-center justify-center">
          {generalError ? (
            <EmptyState
              icon={<Loader2 className="h-6 w-6" />}
              title="Erreur de chargement"
              description={generalError}
            />
          ) : null}
        </div>
      )}
    </div>
  ) : (
    // Sélection inconnue (valeur localStorage exotique) — le sélecteur permet
    // de repartir sur Général ou un emplacement.
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<Loader2 className="h-6 w-6" />}
        title="Aucune vue sélectionnée"
        description="Sélectionnez un emplacement ou la vue Générale pour afficher le synoptique."
      />
    </div>
  );

  // Slide-over (extensions futures — vide pour l'instant, comme rack-editor)
  const slideOverRegistry: SlideOverDef[] = [];

  // ── Final render — EditorShell complet pour le tab synoptique ───────────
  return (
    <>
      <EditorShell
        globalTopbar={globalTopbar}
        globalTopbarHeight={44}
        contextualTopbar={
          <ContextualTopbar
            registry={effectiveRegistry}
            leftSlot={
              <SynoptiqueRackSelector
                locations={locations}
                racks={racks}
                selectedViewId={selectedRackId}
                onSelectView={setSelectedRackId}
              />
            }
          />
        }
        leftToolbar={<LeftToolbar registry={effectiveRegistry} />}
        rightPanel={synopticRightPanel}
        slideOver={<SlideOverPanel registry={slideOverRegistry} />}
        canvas={canvasContent}
        // arkyo-server: interface Strata — carte Faces de l'équipement sélectionné et ouverture du tiroir à la sélection, à partir des détails tenus ici (ignoré en Classique).
        strata={{ drawerTop: <StrataSynopticDrawerTop projectId={projectId} racks={racks} locations={locations} selection={{ node: nodeDetails, nodeRackId, cable: cableDetails, adapter: adapterDetails, zone: zoneDetails, label: labelDetails, external: externalDetails, multiCable: multiCableSummaries, multiNode: multiNodeSummary, multiExternal: multiExternalSummaries, generalRack: generalRackDetails, generalConnection: generalConnectionDetails }} /> }}
      />
      <CursorHint />
    </>
  );
}

// ── Validation overlay — lit le rapport depuis le store topbar ──────────────
function ValidationOverlayContent() {
  const report = useTopbarActions((s) => s.validationReport);
  const onSelect = useTopbarActions((s) => s.onSelectValidationIssue);
  return <ValidationPanelContent report={report} onSelectIssue={onSelect} />;
}
