"use client";

/**
 * AdaptersListPanel — onglet "Adaptateurs" du Catalogue tenant.
 *
 * Liste unifiée (catalogue unifié) : items Arkyo purs (pill « Vérifié »,
 * éditables via fork-on-edit) + items du tenant (persos, duplications,
 * forks éclipsants) dans une seule liste triée/filtrée/comptée ensemble.
 *
 *  - Toggle « Catalogue Arkyo » dans la toolbar (avant Filtrer) :
 *    affiche/masque les items Arkyo purs. Persisté en localStorage (global).
 *  - Toggle frère « Afficher hors plan » : révèle les items Arkyo
 *    verrouillés par le plan (grisés + badge plan).
 *  - Fork éclipsant (`shadowsArkyo`) : action « Récupérer la version
 *    Arkyo » (restore) + pas de suppression ; mention drift si la source
 *    Arkyo a évolué depuis le fork.
 *
 * Filtres du Sheet : Fonction → Connecteur entrée → Connecteur sortie → Plan.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Cable as AdapterIcon,
  Copy,
  Plug,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "@/components/ui/icons";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
// arkyo-server: `useTenantPlan` retiré (pas de plan d'abonnement).
import { cn } from "@/lib/utils";
import { NewAdapterWizard } from "@/components/adapters/new-adapter-wizard";
import { AdapterCard } from "@/components/catalogue/adapter-card";
import {
  CatalogueTable,
  type CatalogueColumn,
} from "@/components/catalogue/catalogue-table";
import { useRowSelection } from "@/components/catalogue/use-row-selection";
import { CatalogueSectionHeader } from "@/components/catalogue/catalogue-section-header";
import { ConnectorIcon } from "@/components/ui/connector-icon";
import { catalogueGridStyle } from "@/components/catalogue/types";
import type {
  AdapterCardItem,
  AdapterPort,
  ConnectorRef,
  Gender,
} from "@/components/catalogue/types";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { AdminListToolbar } from "../../_components/admin-list-toolbar";
import { AdminTabLayout } from "../../_components/admin-tab-layout";
import {
  ActiveFilterPills,
  Chip,
  // arkyo-server: PLAN_COLORS / PLAN_LABELS / PLAN_ORDER retirés (pas de plan).
  toggleInSet,
  type ActivePill,
} from "../../_components/list-toolbar-helpers";

// arkyo-server: propositions à Arkyo (CatalogProposalDialog, ProposalStatusBadge),
// pastille « Vérifié » Arkyo, bascules « Catalogue Arkyo » et « hors plan »
// retirées (catalogue unique, pas de plan).
import { safeGetList } from "./safe-fetch";
import type {
  CatalogueListResponse,
  TenantAdapterItem,
} from "./tenant-catalogue-types";
import { mergeCatalogueResponse } from "./tenant-catalogue-types"; // arkyo-server: plus de fork éclipsant (isShadowingFork)
import {
  useShowArkyoCatalogue,
} from "./use-tenant-visibility"; // arkyo-server: useShowLockedItems retiré (pas de plan)
import { useCatalogueSync } from "./use-catalogue-sync";
// arkyo-server: useProposalSync retiré (propositions à Arkyo).
import { LoadingState } from "@/components/ui/loading-state";
import { useInterface } from "@/strata/interface-context"; // arkyo-server: interface Strata
import { StrataAdaptersGrid } from "@/strata/pages/strata-adapters-grid"; // arkyo-server: interface Strata

// ── Constants ─────────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";
type ViewMode = "grid" | "list";

const FILTERS_STORAGE_KEY = "arkyo:tenant-catalogue:filters:adapters";
const VIEW_STORAGE_KEY = "arkyo:tenant-catalogue:view:adapters";
const GRID_STYLE = catalogueGridStyle("adapter");

type CatalogConnectorRow = {
  id: string;
  name: string;
  color: string | null;
  iconId: string;
  version: string | null;
};

// ── Rendu connecteurs (tableau) ────────────────────────────────────────────────
// Genre connecteur : M / F / I/O — jamais ♂/♀ (contrainte projet).

const GENDER_LABEL: Record<Gender, string> = {
  MALE: "M",
  FEMALE: "F",
  NEUTRAL: "I/O",
};

/**
 * Eclate les `outputs` selon la `quantity` : un AdapterPort avec quantity=4
 * produit 4 entrées affichées (une par câble physique). Reprise de
 * `components/catalogue/adapter-card.tsx`.
 */
function expandOutputs(
  outputs: AdapterPort[],
): { connectorTypeId: string; gender: Gender }[] {
  const result: { connectorTypeId: string; gender: Gender }[] = [];
  for (const p of outputs) {
    const q = Math.max(1, p.quantity ?? 1);
    for (let i = 0; i < q; i++) {
      result.push({ connectorTypeId: p.connectorTypeId, gender: p.gender });
    }
  }
  return result;
}

type PersistedFilters = {
  functions: Set<string>;
  inputConnectors: Set<string>;
  outputConnectors: Set<string>;
  plans: Set<string>;
};

function loadInitialFilters(): PersistedFilters {
  const defaults: PersistedFilters = {
    functions: new Set(),
    inputConnectors: new Set(),
    outputConnectors: new Set(),
    plans: new Set(),
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as {
      functions?: string[];
      inputConnectors?: string[];
      outputConnectors?: string[];
      connectors?: string[]; // legacy
      plans?: string[];
    };
    // Migration : si une ancienne clé `connectors` existe, on la duplique
    // dans les deux nouveaux filtres (compromis raisonnable). Les clés
    // obsolètes sont ignorées sans crash (destructuring tolérant).
    const legacy = Array.isArray(p.connectors) ? p.connectors : [];
    return {
      functions: new Set(Array.isArray(p.functions) ? p.functions : []),
      inputConnectors: new Set(
        Array.isArray(p.inputConnectors) ? p.inputConnectors : legacy,
      ),
      outputConnectors: new Set(
        Array.isArray(p.outputConnectors) ? p.outputConnectors : legacy,
      ),
      plans: new Set(Array.isArray(p.plans) ? p.plans : []),
    };
  } catch {
    return defaults;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdaptersListPanel() {
  const router = useRouter();
  const isStrata = useInterface() === "strata"; // arkyo-server: interface Strata
  const confirm = useConfirm();
  const toast = useToast();
  // arkyo-server: `canAccess` (plan) retiré.

  const [items, setItems] = useState<TenantAdapterItem[]>([]);
  const [connectors, setConnectors] = useState<CatalogConnectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  const [wizardOpen, setWizardOpen] = useState(false);

  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      const v = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (v === "grid" || v === "list") return v;
    }
    return "grid";
  });
  const setViewMode = (v: ViewMode) => {
    setViewModeRaw(v);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // ── Sélection multi-lignes (mode tableau) ────────────────────────────────────
  const [orderedSelectableIds, setOrderedSelectableIds] = useState<string[]>([]);
  const selection = useRowSelection(orderedSelectableIds);

  // ── Toggle « Catalogue Arkyo » (global) + hors plan ────────────────────────
  const [showArkyo, setShowArkyo] = useShowArkyoCatalogue();
  // arkyo-server: bascule « hors plan » retirée (pas de plan).

  const [search, setSearch] = useState("");
  const initialFilters = useMemo(() => loadInitialFilters(), []);
  const [filterFunctions, setFilterFunctions] = useState<Set<string>>(initialFilters.functions);
  const [filterInputConnectors, setFilterInputConnectors] = useState<Set<string>>(
    initialFilters.inputConnectors,
  );
  const [filterOutputConnectors, setFilterOutputConnectors] = useState<Set<string>>(
    initialFilters.outputConnectors,
  );
  const [filterPlans, setFilterPlans] = useState<Set<string>>(initialFilters.plans);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        FILTERS_STORAGE_KEY,
        JSON.stringify({
          functions: Array.from(filterFunctions),
          inputConnectors: Array.from(filterInputConnectors),
          outputConnectors: Array.from(filterOutputConnectors),
          plans: Array.from(filterPlans),
        }),
      );
    } catch {
      /* ignore */
    }
  }, [filterFunctions, filterInputConnectors, filterOutputConnectors, filterPlans]);

  const [drawerOpen, setDrawerOpen] = useState(false);

  // arkyo-server: propositions à Arkyo retirées (statuts, dialog, sync temps réel).

  // Fetch
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [adaptersResp, conns] = await Promise.all([
          api.get<CatalogueListResponse<TenantAdapterItem>>(
            "/api/tenant/catalogue/adapters?scope=all",
          ),
          safeGetList<CatalogConnectorRow>("/api/tenant/catalogue/connectors"),
        ]);
        if (cancelled) return;
        setItems(mergeCatalogueResponse(adaptersResp));
        setConnectors(conns);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          setItems([]);
          setConnectors([]);
        } else {
          setError(getApiErrorMessage(e, "Impossible de charger les adaptateurs."));
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    reloadRef.current = load;
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync temps réel avec les mutations supervisor catalogue.
  useCatalogueSync(() => {
    void reloadRef.current();
  });

  const connectorMap = useMemo(() => {
    const m = new Map<string, ConnectorRef & { iconId: string; version: string | null }>();
    for (const c of connectors) {
      m.set(c.id, {
        id: c.id,
        name: c.name,
        color: c.color,
        iconId: c.iconId,
        version: c.version,
      });
    }
    return m;
  }, [connectors]);

  // ── Liste unifiée pré-filtrée par les toggles (avant les filtres du Sheet) ──
  const visibleList = useMemo(() => {
    return items.filter((it) => {
      if (it.source !== "ARKYO") return true;
      if (!showArkyo) return false;
      return it.isAccessible; // arkyo-server: pas d'items hors plan à révéler
    });
  }, [items, showArkyo]);

  // Lookups (calculés sur la visibleList)
  const functionsInList = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; color: string; sortOrder?: number }>();
    for (const it of visibleList) {
      if (it.function && !seen.has(it.function.id)) seen.set(it.function.id, it.function);
    }
    return Array.from(seen.values()).sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
  }, [visibleList]);

  const inputConnectorsInList = useMemo(() => {
    const ids = new Set<string>();
    for (const it of visibleList) {
      for (const p of it.inputs ?? []) if (p.connectorTypeId) ids.add(p.connectorTypeId);
    }
    return connectors
      .filter((c) => ids.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [visibleList, connectors]);

  const outputConnectorsInList = useMemo(() => {
    const ids = new Set<string>();
    for (const it of visibleList) {
      for (const p of it.outputs ?? []) if (p.connectorTypeId) ids.add(p.connectorTypeId);
    }
    return connectors
      .filter((c) => ids.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [visibleList, connectors]);

  // arkyo-server: plans présents (filtre « Visibilité plan ») retirés.

  // Filtrage + tri
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = visibleList.filter((it) => {
      if (q) {
        const hay = [it.name, it.reference ?? "", it.function?.label ?? ""]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterFunctions.size > 0) {
        if (!it.function?.id || !filterFunctions.has(it.function.id)) return false;
      }
      if (filterInputConnectors.size > 0) {
        const hit = (it.inputs ?? []).some(
          (p) => p.connectorTypeId && filterInputConnectors.has(p.connectorTypeId),
        );
        if (!hit) return false;
      }
      if (filterOutputConnectors.size > 0) {
        const hit = (it.outputs ?? []).some(
          (p) => p.connectorTypeId && filterOutputConnectors.has(p.connectorTypeId),
        );
        if (!hit) return false;
      }
      // arkyo-server: filtre par plan retiré (pas de plan).
      return true;
    });
    list.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "fr");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [
    visibleList,
    search,
    filterFunctions,
    filterInputConnectors,
    filterOutputConnectors,
    filterPlans,
    sortDir,
  ]);

  // Group by function
  const grouped = useMemo(() => {
    const m = new Map<
      string,
      { label: string; color: string; sortOrder: number; items: TenantAdapterItem[] }
    >();
    for (const it of filtered) {
      const key = it.function?.id ?? "_unassigned";
      const slot = m.get(key) ?? {
        label: it.function?.label ?? "Sans catégorie",
        color: it.function?.color ?? "#a3a3a3",
        sortOrder: it.function?.sortOrder ?? 9999,
        items: [],
      };
      slot.items.push(it);
      m.set(key, slot);
    }
    return Array.from(m.values()).sort((a, b) => {
      const so = a.sortOrder - b.sortOrder;
      return so !== 0 ? so : a.label.localeCompare(b.label, "fr");
    });
  }, [filtered]);

  // Actions
  const handleDuplicate = async (item: TenantAdapterItem) => {
    try {
      const created = await api.post<{ id: string }>(
        `/api/tenant/catalogue/adapters/${item.id}/duplicate`,
        {},
      );
      toast.success("Adaptateur dupliqué.");
      if (created?.id) {
        router.push(`/admin/catalogue/adapters/${created.id}`);
      } else {
        await reloadRef.current();
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la duplication."));
    }
  };

  const handleCreate = () => {
    setWizardOpen(true);
  };

  const handleWizardCreated = (id: string, mode: "close" | "complete") => {
    if (mode === "complete") {
      router.push(`/admin/catalogue/adapters/${id}`);
      return;
    }
    // mode === "close" → refresh la liste pour faire apparaître l'item créé.
    void reloadRef.current();
  };

  const handleDelete = async (item: TenantAdapterItem) => {
    const ok = await confirm({
      title: "Supprimer l'adaptateur",
      description: (
        <>
          <strong>{item.name}</strong> sera supprimé définitivement.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/catalogue/adapters/${item.id}`);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast.success("Adaptateur supprimé.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string; code?: string } | null;
        // arkyo-server: plus de fork éclipsant (code SHADOWING_FORK).
        toast.error(body?.error ?? "Adaptateur utilisé — suppression impossible.");
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  // arkyo-server: « Récupérer la version Arkyo » retiré (catalogue unique).

  const toggleFunction = (id: string) => setFilterFunctions((p) => toggleInSet(p, id));
  const toggleInputConnector = (id: string) =>
    setFilterInputConnectors((p) => toggleInSet(p, id));
  const toggleOutputConnector = (id: string) =>
    setFilterOutputConnectors((p) => toggleInSet(p, id));
  // arkyo-server: togglePlan retiré (pas de plan).

  const activeFilterCount =
    (filterFunctions.size > 0 ? 1 : 0) +
    (filterInputConnectors.size > 0 ? 1 : 0) +
    (filterOutputConnectors.size > 0 ? 1 : 0); // arkyo-server: filtre plan retiré

  const clearAllFilters = () => {
    setFilterFunctions(new Set());
    setFilterInputConnectors(new Set());
    setFilterOutputConnectors(new Set());
    setFilterPlans(new Set());
  };

  const activePills = useMemo<ActivePill[]>(() => {
    const fnMap = new Map(functionsInList.map((f) => [f.id, f]));
    const inputMap = new Map(inputConnectorsInList.map((c) => [c.id, c]));
    const outputMap = new Map(outputConnectorsInList.map((c) => [c.id, c]));
    const out: ActivePill[] = [];
    for (const id of filterFunctions) {
      const fn = fnMap.get(id);
      if (fn) {
        out.push({
          key: `fn:${id}`,
          label: fn.label,
          color: fn.color,
          onRemove: () =>
            setFilterFunctions((p) => {
              const n = new Set(p);
              n.delete(id);
              return n;
            }),
        });
      }
    }
    for (const id of filterInputConnectors) {
      const c = inputMap.get(id);
      if (c) {
        out.push({
          key: `in:${id}`,
          label: `Entrée : ${c.name}`,
          color: c.color ?? undefined,
          onRemove: () =>
            setFilterInputConnectors((p) => {
              const n = new Set(p);
              n.delete(id);
              return n;
            }),
        });
      }
    }
    for (const id of filterOutputConnectors) {
      const c = outputMap.get(id);
      if (c) {
        out.push({
          key: `out:${id}`,
          label: `Sortie : ${c.name}`,
          color: c.color ?? undefined,
          onRemove: () =>
            setFilterOutputConnectors((p) => {
              const n = new Set(p);
              n.delete(id);
              return n;
            }),
        });
      }
    }
    // arkyo-server: pastilles de plan retirées.
    return out;
  }, [
    filterFunctions,
    filterInputConnectors,
    filterOutputConnectors,
    filterPlans,
    functionsInList,
    inputConnectorsInList,
    outputConnectorsInList,
  ]);

  // ── État d'un item (verrou plan / fork / sélectionnable) ────────────────────
  // Partagé entre carte (grille) et tableau (liste).

  const getItemFlags = (item: TenantAdapterItem) => {
    const isArkyo = item.source === "ARKYO";
    // arkyo-server: ni verrou de plan ni fork éclipsant (catalogue unique).
    const locked = false;
    const shadowFork = false;
    // Sélectionnable = supprimable unitairement (source ≠ Arkyo, pas fork
    // éclipsant, pas verrouillé plan).
    const selectable = !isArkyo && !shadowFork && !locked;
    return { isArkyo, locked, shadowFork, selectable };
  };

  const cardColor = (item: TenantAdapterItem) => item.function?.color ?? "#06b6d4";

  // arkyo-server: badge de plan (items verrouillés) retiré.

  // Actions unitaires — partagées entre carte et rangée de tableau.
  const renderItemActions = (item: TenantAdapterItem) => {
    const { isArkyo, locked, shadowFork } = getItemFlags(item);
    if (locked) return null;
    // Item Arkyo pur : Modifier (implicite via onClick — le fork se crée au
    // premier enregistrement) · Dupliquer (comportement historique).
    if (isArkyo) {
      return (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              void handleDuplicate(item);
            }}
            title="Dupliquer"
            className="shrink-0 rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      );
    }
    // arkyo-server: fork éclipsant (« Récupérer la version Arkyo ») et
    // « Proposer à Arkyo » retirés (catalogue unique).
    void shadowFork;
    // Personal : Modifier (implicite via onClick) · Dupliquer · Supprimer
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            void handleDuplicate(item);
          }}
          title="Dupliquer"
          className="shrink-0 rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]"
        >
          <Copy className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            void handleDelete(item);
          }}
          title="Supprimer"
          // arkyo-server: habillage Strata
          className="shrink-0 rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    );
  };

  // ── Suppression groupée (mode tableau) ───────────────────────────────────────
  const handleBulkDelete = async () => {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Supprimer ${ids.length} élément${ids.length > 1 ? "s" : ""} ?`,
      description: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      const res = await api.post<{
        deleted: number;
        failed: { id: string; reason: string }[];
      }>("/api/tenant/catalogue/adapters/bulk-delete", { ids });
      const deleted = res?.deleted ?? 0;
      const failed = res?.failed ?? [];
      if (failed.length === 0) {
        toast.success(
          `${deleted} élément${deleted > 1 ? "s" : ""} supprimé${deleted > 1 ? "s" : ""}.`,
        );
      } else {
        toast.info(
          `${deleted} supprimé${deleted > 1 ? "s" : ""}, ${failed.length} échec${failed.length > 1 ? "s" : ""}.`,
        );
      }
      await reloadRef.current();
      selection.clear();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la suppression groupée."));
    }
  };

  // ── Colonnes du tableau ──────────────────────────────────────────────────────
  const columns = useMemo<CatalogueColumn<TenantAdapterItem>[]>(
    () => [
      {
        key: "name",
        label: "Nom",
        className: "min-w-[220px]",
        sortValue: (it) => it.name,
        cell: (it) => (
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: cardColor(it) }}
            />
            <span className="truncate font-medium text-[var(--foreground)]">
              {it.name}
            </span>
            {/* arkyo-server: pastille « Vérifié » Arkyo retirée (catalogue unique) */}
          </div>
        ),
      },
      {
        key: "io",
        label: "Entrées → Sorties",
        className: "min-w-[200px]",
        cell: (it) => {
          const src = it.inputs?.[0];
          const srcCt = src ? connectorMap.get(src.connectorTypeId) : undefined;
          const srcColor = srcCt?.color ?? "#a3a3a3";
          const srcGender = src ? GENDER_LABEL[src.gender] : "";
          const expanded = expandOutputs(it.outputs ?? []);
          return (
            <div className="flex items-center gap-1">
              {srcCt ? (
                <div
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: `${srcColor}20` }}
                >
                  {srcCt.iconId ? (
                    <ConnectorIcon iconId={srcCt.iconId} color={srcColor} size={14} />
                  ) : (
                    <Plug className="h-3 w-3" style={{ color: srcColor }} />
                  )}
                </div>
              ) : (
                <span className="text-[var(--muted-foreground)]">—</span>
              )}
              {srcGender && (
                <span className="rounded bg-[var(--secondary)] px-1 py-0 text-[8px] font-bold text-[var(--muted-foreground)]">
                  {srcGender}
                </span>
              )}
              <ArrowRight className="mx-0.5 h-3 w-3 shrink-0 text-[var(--muted-foreground)] opacity-40" />
              {expanded.slice(0, 5).map((ep, i) => {
                const ct = connectorMap.get(ep.connectorTypeId);
                const color = ct?.color ?? "#a3a3a3";
                return (
                  <div
                    key={i}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: `${color}20` }}
                  >
                    {ct?.iconId ? (
                      <ConnectorIcon iconId={ct.iconId} color={color} size={14} />
                    ) : (
                      <Plug className="h-3 w-3" style={{ color }} />
                    )}
                  </div>
                );
              })}
              {expanded.length > 5 && (
                <span className="text-[9px] text-[var(--muted-foreground)]">
                  +{expanded.length - 5}
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: "function",
        label: "Fonction",
        className: "w-40",
        sortValue: (it) => it.function?.label ?? null,
        cell: (it) =>
          it.function ? (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
              style={{
                backgroundColor: `${it.function.color}18`,
                color: it.function.color,
              }}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: it.function.color }}
              />
              {it.function.label}
            </span>
          ) : (
            <span className="text-[var(--muted-foreground)]">—</span>
          ),
      },
    ],
    [connectorMap],
  );

  // ── Card (grille) ────────────────────────────────────────────────────────────

  const renderCard = (item: TenantAdapterItem) => {
    const { isArkyo, locked } = getItemFlags(item);

    const adapterItem: AdapterCardItem = {
      id: item.id,
      name: item.name,
      reference: item.reference,
      function: item.function ?? null,
      inputs: item.inputs ?? [],
      outputs: item.outputs ?? [],
    };

    const onClick = locked
      ? undefined
      : () => router.push(`/admin/catalogue/adapters/${item.id}`);

    return (
      <div
        key={item.id}
        className={cn("relative", locked && "pointer-events-none select-none")}
      >
        <div className={locked ? "opacity-40" : ""}>
          <AdapterCard
            adapter={adapterItem}
            color={cardColor(item)}
            connectorMap={connectorMap}
            view={viewMode}
            onClick={onClick}
            // arkyo-server: pastille « Vérifié » Arkyo retirée (catalogue unique)
            actions={renderItemActions(item)}
          />
        </div>
        {/* arkyo-server: badge de plan des items verrouillés retiré */}
      </div>
    );
  };

  // ── Empty state de la liste unifiée ─────────────────────────────────────────
  //   1. catalogue entièrement vide → CTA "Créer mon premier adaptateur"
  //   2. tout est masqué par le toggle « Catalogue Arkyo » désactivé
  //   3. tout est verrouillé par le plan → suggère "Afficher hors plan"
  const isListEmpty = visibleList.length === 0;
  const hasHiddenArkyo =
    !showArkyo && items.some((it) => it.source === "ARKYO");
  // arkyo-server: cas « tout est verrouillé par le plan » retiré (pas de plan).

  const renderListEmpty = () => {
    if (hasHiddenArkyo) {
      return (
        <EmptyState
          icon={<AdapterIcon strokeWidth={1.5} />}
          title="Aucun adaptateur personnel"
          description="Créez votre premier adaptateur ou réactivez le catalogue Arkyo."
          action={
            <EmptyStateAction onClick={() => setShowArkyo(true)}>
              Afficher le catalogue Arkyo
            </EmptyStateAction>
          }
        />
      );
    }
    // arkyo-server: état vide « accessible avec votre plan » retiré.
    return (
      <EmptyState
        icon={<AdapterIcon strokeWidth={1.5} />}
        title="Aucun adaptateur"
        // arkyo-server: mention du catalogue Arkyo publié retirée (catalogue unique)
        description="Ajoutez votre premier adaptateur personnel."
        action={
          <EmptyStateAction onClick={handleCreate}>
            <Plus className="h-3.5 w-3.5" />
            Créer mon premier adaptateur
          </EmptyStateAction>
        }
      />
    );
  };

  if (loading) {
    return <LoadingState className="px-8 pt-10" />;
  }
  if (error) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<AdapterIcon strokeWidth={1.5} />}
          title="Erreur"
          description={error}
        />
      </div>
    );
  }

  return (
    <>
      <AdminTabLayout
        toolbar={
          <AdminListToolbar
            search={search}
            onSearchChange={setSearch}
            placeholder="Nom, référence, catégorie…"
            count={filtered.length}
            total={filtered.length !== visibleList.length ? visibleList.length : undefined}
            onSort={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            sortDir={sortDir}
            // arkyo-server: bascule « Catalogue Arkyo » retirée (catalogue unique)
            onFilter={() => setDrawerOpen(true)}
            filterCount={activeFilterCount}
            onClearFilters={clearAllFilters}
            view={viewMode}
            onViewChange={setViewMode}
          >
            <ActiveFilterPills pills={activePills} />
            {/* arkyo-server: bascule « Afficher hors plan » retirée (pas de plan) */}
          </AdminListToolbar>
        }
        addButton={
          // Bouton inline réservé aux cas non-vides : en empty state, le CTA
          // est déjà porté par <EmptyState>. Évite la duplication d'action.
          !isListEmpty ? (
            <button
              onClick={handleCreate}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
              style={{ minHeight: "72px" }}
            >
              <Plus className="h-5 w-5" />
              <span className="text-xs font-medium">Nouvel adaptateur</span>
            </button>
          ) : undefined
        }
      >
        <div className="space-y-5">
          {isListEmpty ? (
            renderListEmpty()
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Search strokeWidth={1.5} />}
              title="Aucun adaptateur pour ces filtres"
              description="Essayez d'élargir votre recherche ou de réinitialiser les filtres."
              action={
                activeFilterCount > 0 ? (
                  <button
                    onClick={clearAllFilters}
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    Réinitialiser les filtres
                  </button>
                ) : undefined
              }
              className="py-16"
            />
          ) : viewMode === "list" ? (
            <CatalogueTable
              items={filtered}
              columns={columns}
              getRowId={(it) => it.id}
              getRowColor={cardColor}
              isRowLocked={(it) => getItemFlags(it).locked}
              // arkyo-server: badge de plan retiré (getRowOverlay)
              isRowSelectable={(it) => getItemFlags(it).selectable}
              onRowClick={(it) =>
                router.push(`/admin/catalogue/adapters/${it.id}`)
              }
              rowActions={renderItemActions}
              selection={selection}
              defaultSort={{ key: "name", dir: "asc" }}
              onBulkDelete={handleBulkDelete}
              onVisibleOrderChange={setOrderedSelectableIds}
            />
          ) : isStrata ? (
            // arkyo-server: interface Strata (grille dessinée, même liste filtrée)
            <StrataAdaptersGrid
              items={filtered}
              hrefOf={(it) => `/admin/catalogue/adapters/${it.id}`}
              renderActions={renderItemActions}
            />
          ) : (
            <div className="space-y-7">
              {grouped.map((group) => (
                <div key={group.label}>
                  <CatalogueSectionHeader
                    label={group.label}
                    color={group.color}
                    count={group.items.length}
                  />
                  <div className="grid gap-3" style={GRID_STYLE}>
                    {group.items.map(renderCard)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminTabLayout>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-[340px]">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <SlidersHorizontal className="h-4.5 w-4.5" />
              </div>
              <div>
                <SheetTitle className="text-sm">Filtrer les adaptateurs</SheetTitle>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {activeFilterCount} filtre{activeFilterCount > 1 ? "s" : ""} actif
                  {activeFilterCount > 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </SheetHeader>

          <SheetBody>
            <div className="space-y-7">
              {functionsInList.length > 0 && (
                <div>
                  <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                    Catégorie
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {functionsInList.map((fn) => (
                      <Chip
                        key={fn.id}
                        label={fn.label}
                        active={filterFunctions.has(fn.id)}
                        onClick={() => toggleFunction(fn.id)}
                        color={fn.color}
                      />
                    ))}
                  </div>
                </div>
              )}

              {inputConnectorsInList.length > 0 && (
                <div>
                  <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                    Connecteur en entrée
                  </p>
                  <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
                    {inputConnectorsInList.map((c) => (
                      <Chip
                        key={c.id}
                        label={c.name}
                        active={filterInputConnectors.has(c.id)}
                        onClick={() => toggleInputConnector(c.id)}
                        color={c.color ?? undefined}
                      />
                    ))}
                  </div>
                </div>
              )}

              {outputConnectorsInList.length > 0 && (
                <div>
                  <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                    Connecteur en sortie
                  </p>
                  <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
                    {outputConnectorsInList.map((c) => (
                      <Chip
                        key={c.id}
                        label={c.name}
                        active={filterOutputConnectors.has(c.id)}
                        onClick={() => toggleOutputConnector(c.id)}
                        color={c.color ?? undefined}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* arkyo-server: « Visibilité plan » retirée (pas de plan) */}
            </div>
          </SheetBody>

          {activeFilterCount > 0 && (
            <SheetFooter>
              <button
                onClick={clearAllFilters}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)]/10 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"
              >
                <X className="h-3.5 w-3.5" />
                Effacer les {activeFilterCount} filtre{activeFilterCount > 1 ? "s" : ""}
              </button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      {/* Wizard "Nouvel adaptateur" — ouvert depuis `handleCreate` */}
      <NewAdapterWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={handleWizardCreated}
        onSkipWizard={() => {
          setWizardOpen(false);
          router.push("/admin/catalogue/adapters/new");
        }}
      />

      {/* arkyo-server: « Proposer à Arkyo » retiré (propositions et crédits SaaS) */}
    </>
  );
}
