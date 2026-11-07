"use client";

/**
 * EquipmentListPanel — onglet "Équipements" du Catalogue tenant.
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
 * Filtres du Sheet alignés sur le supervisor :
 *   Marque → Fonction → Type d'équipement → Format → Options → Plan
 *
 * Le fetch est toujours fait en `scope=all` ; on filtre côté client.
 *
 * Les référentiels `types` (CatalogType) sont récupérés via
 * `/api/tenant/catalogue/lookup` au mount — utilisés uniquement pour le
 * filtre "Type d'équipement" (hiérarchie : Fonction → Type).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Lightbulb,
  Network,
  Package,
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
import { CatalogueSectionHeader } from "@/components/catalogue/catalogue-section-header";
import { EquipmentCard } from "@/components/catalogue/equipment-card";
import {
  CatalogueTable,
  type CatalogueColumn,
} from "@/components/catalogue/catalogue-table";
import { useRowSelection } from "@/components/catalogue/use-row-selection";
import { catalogueGridStyle } from "@/components/catalogue/types";
import type { EquipmentCardItem } from "@/components/catalogue/types";
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
  BrandMultiSelect,
  Chip,
  // arkyo-server: PLAN_COLORS / PLAN_LABELS / PLAN_ORDER retirés (pas de plan).
  toggleInSet,
  type ActivePill,
} from "../../_components/list-toolbar-helpers";

import { NewEquipmentWizard } from "@/components/equipment/new-equipment-wizard";

// arkyo-server: propositions à Arkyo (CatalogProposalDialog, ProposalStatusBadge),
// pastille « Vérifié » Arkyo, bascules « Catalogue Arkyo » et « hors plan »
// retirées (catalogue unique, pas de plan).
import type {
  CatalogueListResponse,
  TenantEquipmentItem,
} from "./tenant-catalogue-types";
import { mergeCatalogueResponse } from "./tenant-catalogue-types"; // arkyo-server: plus de fork éclipsant (isShadowingFork)
import {
  useShowArkyoCatalogue,
} from "./use-tenant-visibility"; // arkyo-server: useShowLockedItems retiré (pas de plan)
import { useCatalogueSync } from "./use-catalogue-sync";
// arkyo-server: useProposalSync retiré (propositions à Arkyo).
import { LoadingState } from "@/components/ui/loading-state";
import { useInterface } from "@/strata/interface-context"; // arkyo-server: interface Strata
import { StrataCatalogueGrid } from "@/strata/pages/strata-catalogue-grid"; // arkyo-server: interface Strata

// ── Types locaux ──────────────────────────────────────────────────────────────

type BrandRef = { id: string; name: string };
type SortDir = "asc" | "desc";
type ViewMode = "grid" | "list";
type FormatFilter = "all" | "rack" | "libre";

type CatalogTypeRef = {
  id: string;
  name: string;
  functionId: string | null;
};

type LookupResponse = {
  types?: CatalogTypeRef[];
};

const FILTERS_STORAGE_KEY = "arkyo:tenant-catalogue:filters:equipment";
const VIEW_STORAGE_KEY = "arkyo:tenant-catalogue:view:equipment";
const GRID_STYLE = catalogueGridStyle("equipment");

// ── Loader localStorage filtres (lazy init) ───────────────────────────────────

type PersistedFilters = {
  brands: Set<string>;
  functions: Set<string>;
  types: Set<string>;
  format: FormatFilter;
  is2110: boolean;
  isLighting: boolean;
  plans: Set<string>;
};

function loadInitialFilters(): PersistedFilters {
  const defaults: PersistedFilters = {
    brands: new Set(),
    functions: new Set(),
    types: new Set(),
    format: "all",
    is2110: false,
    isLighting: false,
    plans: new Set(),
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as {
      brands?: string[];
      functions?: string[];
      types?: string[];
      format?: FormatFilter;
      is2110?: boolean;
      isLighting?: boolean;
      plans?: string[];
    };
    return {
      brands: new Set(Array.isArray(p.brands) ? p.brands : []),
      functions: new Set(Array.isArray(p.functions) ? p.functions : []),
      types: new Set(Array.isArray(p.types) ? p.types : []),
      format:
        p.format === "all" || p.format === "rack" || p.format === "libre"
          ? p.format
          : "all",
      is2110: typeof p.is2110 === "boolean" ? p.is2110 : false,
      isLighting: typeof p.isLighting === "boolean" ? p.isLighting : false,
      plans: new Set(Array.isArray(p.plans) ? p.plans : []),
    };
  } catch {
    return defaults;
  }
}

// ── Toggle (boolean filter) — calque de l'implémentation supervisor ──────────

function Toggle({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/8 text-[var(--accent)]"
          : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--foreground)]/20 hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EquipmentListPanel() {
  const router = useRouter();
  const isStrata = useInterface() === "strata"; // arkyo-server: interface Strata
  const confirm = useConfirm();
  const toast = useToast();
  // arkyo-server: `canAccess` (plan) retiré.

  // ── Fetch & state ───────────────────────────────────────────────────────────
  const [items, setItems] = useState<TenantEquipmentItem[]>([]);
  const [types, setTypes] = useState<CatalogTypeRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  // ── View / sort ─────────────────────────────────────────────────────────────
  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      const v = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (v === "grid" || v === "list") return v;
    }
    return "grid";
  });
  const setViewMode = (v: ViewMode) => {
    setViewModeRaw(v);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(VIEW_STORAGE_KEY, v);
      } catch {
        /* ignore */
      }
    }
  };
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // ── Sélection multi-lignes (mode tableau) ────────────────────────────────────
  const [orderedSelectableIds, setOrderedSelectableIds] = useState<string[]>([]);
  const selection = useRowSelection(orderedSelectableIds);

  // ── Toggle « Catalogue Arkyo » (global) + hors plan ────────────────────────
  const [showArkyo, setShowArkyo] = useShowArkyoCatalogue();
  // arkyo-server: bascule « hors plan » retirée (pas de plan).

  // ── Search + filters ────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const initialFilters = useMemo(() => loadInitialFilters(), []);
  const [filterBrands, setFilterBrands] = useState<Set<string>>(initialFilters.brands);
  const [filterFunctions, setFilterFunctions] = useState<Set<string>>(initialFilters.functions);
  const [filterTypes, setFilterTypes] = useState<Set<string>>(initialFilters.types);
  const [filterFormat, setFilterFormat] = useState<FormatFilter>(initialFilters.format);
  const [filter2110, setFilter2110] = useState<boolean>(initialFilters.is2110);
  const [filterLighting, setFilterLighting] = useState<boolean>(initialFilters.isLighting);
  const [filterPlans, setFilterPlans] = useState<Set<string>>(initialFilters.plans);

  // Persist
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        FILTERS_STORAGE_KEY,
        JSON.stringify({
          brands: Array.from(filterBrands),
          functions: Array.from(filterFunctions),
          types: Array.from(filterTypes),
          format: filterFormat,
          is2110: filter2110,
          isLighting: filterLighting,
          plans: Array.from(filterPlans),
        }),
      );
    } catch {
      /* quota — ignore */
    }
  }, [
    filterBrands,
    filterFunctions,
    filterTypes,
    filterFormat,
    filter2110,
    filterLighting,
    filterPlans,
  ]);

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Wizard "Nouvel équipement" — remplace le routage direct vers la fiche vide.
  const [wizardOpen, setWizardOpen] = useState(false);

  // arkyo-server: propositions à Arkyo retirées (statuts, dialog, sync temps réel).

  // ── Fetch (toujours en scope=all pour pouvoir filtrer côté client) ──────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [data, lookup] = await Promise.all([
          api.get<CatalogueListResponse<TenantEquipmentItem>>(
            "/api/tenant/catalogue/equipment?scope=all",
          ),
          api
            .get<LookupResponse>("/api/tenant/catalogue/lookup")
            .catch(() => ({ types: [] }) as LookupResponse),
        ]);
        if (cancelled) return;
        setItems(mergeCatalogueResponse(data));
        setTypes(Array.isArray(lookup?.types) ? lookup.types : []);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          setItems([]);
          setTypes([]);
        } else {
          setError(getApiErrorMessage(e, "Impossible de charger le catalogue."));
          setItems([]);
          setTypes([]);
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

  // Sync temps réel : re-fetch dès que le supervisor publie une mutation
  // catalogue (create/update/delete sur équipements/cordons/adaptateurs).
  useCatalogueSync(() => {
    void reloadRef.current();
  });

  // ── Liste unifiée pré-filtrée par les toggles (avant les filtres du Sheet) ──
  // C'est cette liste qui sert de base aux lookups (marques / fonctions / plans
  // présents) pour que le Sheet n'affiche que les filtres pertinents.
  const visibleList = useMemo(() => {
    return items.filter((it) => {
      if (it.source !== "ARKYO") return true;
      if (!showArkyo) return false;
      return it.isAccessible; // arkyo-server: pas d'items hors plan à révéler
    });
  }, [items, showArkyo]);

  // ── Lookups (calculés sur la visibleList pour éviter de proposer des filtres
  // inutiles) ─────────────────────────────────────────────────────────────────

  const brandsInList = useMemo<BrandRef[]>(() => {
    const seen = new Map<string, BrandRef>();
    for (const it of visibleList) {
      if (it.brand && it.brand.id && it.brand.name && !seen.has(it.brand.id)) {
        seen.set(it.brand.id, { id: it.brand.id, name: it.brand.name });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [visibleList]);

  const functionsInList = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; color: string; sortOrder?: number }>();
    for (const it of visibleList) {
      for (const fn of it.functions ?? []) {
        if (!seen.has(fn.id)) seen.set(fn.id, fn);
      }
    }
    return Array.from(seen.values()).sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
  }, [visibleList]);

  // Types présents dans la visibleList, filtrés hiérarchiquement par fonction
  // sélectionnée (cohérent avec le supervisor : Fonction → Type).
  const typesInList = useMemo(() => {
    if (types.length === 0) return [];
    const ids = new Set<string>();
    for (const it of visibleList) if (it.typeId) ids.add(it.typeId);
    let pool = types.filter((t) => ids.has(t.id));
    if (filterFunctions.size > 0) {
      pool = pool.filter((t) => t.functionId && filterFunctions.has(t.functionId));
    }
    return pool.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [visibleList, types, filterFunctions]);

  // Nettoie filterTypes si une sélection devient invisible après changement
  // de fonction (sinon on conserverait des IDs orphelins).
  useEffect(() => {
    if (filterTypes.size === 0) return;
    const availableIds = new Set(typesInList.map((t) => t.id));
    const next = new Set<string>();
    for (const id of filterTypes) if (availableIds.has(id)) next.add(id);
    if (next.size !== filterTypes.size) setFilterTypes(next);
  }, [typesInList, filterTypes]);

  // arkyo-server: plans présents (filtre « Visibilité plan ») retirés.

  // ── Filtrage + tri ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = visibleList.filter((it) => {
      // Recherche
      if (q) {
        const haystack = [
          it.name,
          it.reference ?? "",
          it.brand?.name ?? "",
          it.category ?? "",
          ...((it.functions ?? []).map((f) => f.label) ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      // Marque (par nom)
      if (filterBrands.size > 0) {
        if (!it.brand?.name || !filterBrands.has(it.brand.name)) return false;
      }
      // Fonction (multi-select sur id) — match si AU MOINS une fonction matche
      if (filterFunctions.size > 0) {
        const fnIds = (it.functions ?? []).map((f) => f.id);
        if (!fnIds.some((id) => filterFunctions.has(id))) return false;
      }
      // Type d'équipement (multi-select sur typeId)
      if (filterTypes.size > 0) {
        if (!it.typeId || !filterTypes.has(it.typeId)) return false;
      }
      // Format (mono-select sur isRackable)
      if (filterFormat === "rack" && !it.isRackable) return false;
      if (filterFormat === "libre" && it.isRackable) return false;
      // Options
      if (filter2110 && !it.is2110) return false;
      if (filterLighting && it.isLightingFixture !== true) return false;
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
    filterBrands,
    filterFunctions,
    filterTypes,
    filterFormat,
    filter2110,
    filterLighting,
    filterPlans,
    sortDir,
  ]);

  // ── Group by function (cohérent avec supervisor `groupBy="function"`) ───────

  const grouped = useMemo(() => {
    const m = new Map<
      string,
      {
        label: string;
        color: string;
        sortOrder: number;
        items: TenantEquipmentItem[];
      }
    >();
    for (const it of filtered) {
      const fn = it.functions?.[0];
      const key = fn?.id ?? "_unassigned";
      const slot = m.get(key) ?? {
        label: fn?.label ?? "Sans catégorie",
        color: fn?.color ?? "#a3a3a3",
        sortOrder: fn?.sortOrder ?? 9999,
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

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleDuplicate = async (item: TenantEquipmentItem) => {
    try {
      const created = await api.post<{ id: string }>(
        `/api/tenant/catalogue/equipment/${item.id}/duplicate`,
        {},
      );
      toast.success("Équipement dupliqué.");
      if (created?.id) {
        router.push(`/admin/catalogue/equipment/${created.id}`);
      } else {
        await reloadRef.current();
      }
      return created;
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la duplication."));
      return null;
    }
  };

  const handleCreate = () => {
    setWizardOpen(true);
  };

  const handleWizardCreated = (id: string, mode: "close" | "complete") => {
    if (mode === "complete") {
      router.push(`/admin/catalogue/equipment/${id}`);
      return;
    }
    // mode === "close" → refresh la liste pour faire apparaître l'item créé.
    void reloadRef.current();
  };

  const handleDelete = async (item: TenantEquipmentItem) => {
    const ok = await confirm({
      title: "Supprimer l'équipement",
      description: (
        <>
          <strong>{item.name}</strong> sera supprimé définitivement. Cette action
          est bloquée si l&apos;équipement est utilisé dans un projet.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/catalogue/equipment/${item.id}`);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast.success("Équipement supprimé.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as {
          error?: string;
          code?: string;
          usageCount?: number;
        } | null;
        // arkyo-server: plus de fork éclipsant (code SHADOWING_FORK).
        toast.error(body?.error ?? "Équipement utilisé — suppression impossible.");
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  // arkyo-server: « Récupérer la version Arkyo » retiré (catalogue unique).

  // ── Toggle helpers ──────────────────────────────────────────────────────────
  const toggleBrand = (n: string) => setFilterBrands((prev) => toggleInSet(prev, n));
  const toggleFunction = (id: string) => setFilterFunctions((prev) => toggleInSet(prev, id));
  const toggleType = (id: string) => setFilterTypes((prev) => toggleInSet(prev, id));
  // arkyo-server: togglePlan retiré (pas de plan).

  // ── Active pills ────────────────────────────────────────────────────────────
  const activeFilterCount =
    (filterBrands.size > 0 ? 1 : 0) +
    (filterFunctions.size > 0 ? 1 : 0) +
    (filterTypes.size > 0 ? 1 : 0) +
    (filterFormat !== "all" ? 1 : 0) +
    (filter2110 ? 1 : 0) +
    (filterLighting ? 1 : 0); // arkyo-server: filtre plan retiré

  const clearAllFilters = () => {
    setFilterBrands(new Set());
    setFilterFunctions(new Set());
    setFilterTypes(new Set());
    setFilterFormat("all");
    setFilter2110(false);
    setFilterLighting(false);
    setFilterPlans(new Set());
  };

  const activePills = useMemo<ActivePill[]>(() => {
    const fnMap = new Map(functionsInList.map((f) => [f.id, f]));
    const typeMap = new Map(types.map((t) => [t.id, t]));
    const out: ActivePill[] = [];
    if (filterFormat === "rack")
      out.push({ key: "fmt", label: "Rackable", onRemove: () => setFilterFormat("all") });
    if (filterFormat === "libre")
      out.push({ key: "fmt", label: "Pose libre", onRemove: () => setFilterFormat("all") });
    if (filter2110)
      out.push({ key: "2110", label: "SMPTE 2110", onRemove: () => setFilter2110(false) });
    if (filterLighting)
      out.push({ key: "light", label: "Lumière", onRemove: () => setFilterLighting(false) });
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
    for (const id of filterTypes) {
      const t = typeMap.get(id);
      if (t) {
        out.push({
          key: `type:${id}`,
          label: t.name,
          onRemove: () =>
            setFilterTypes((p) => {
              const n = new Set(p);
              n.delete(id);
              return n;
            }),
        });
      }
    }
    for (const name of filterBrands) {
      out.push({
        key: `brand:${name}`,
        label: name,
        onRemove: () =>
          setFilterBrands((p) => {
            const n = new Set(p);
            n.delete(name);
            return n;
          }),
      });
    }
    // arkyo-server: pastilles de plan retirées.
    return out;
  }, [
    filterFormat,
    filter2110,
    filterLighting,
    filterFunctions,
    filterTypes,
    filterBrands,
    filterPlans,
    functionsInList,
    types,
  ]);

  // ── État d'un item (verrou plan / fork / sélectionnable) ────────────────────
  // Partagé entre carte (grille) et tableau (liste).

  const getItemFlags = (item: TenantEquipmentItem) => {
    const isArkyo = item.source === "ARKYO";
    // arkyo-server: ni verrou de plan ni fork éclipsant (catalogue unique).
    const locked = false;
    const shadowFork = false;
    // Sélectionnable = supprimable unitairement (source ≠ Arkyo, pas fork
    // éclipsant, pas verrouillé plan).
    const selectable = !isArkyo && !shadowFork && !locked;
    return { isArkyo, locked, shadowFork, selectable };
  };

  const cardColor = (item: TenantEquipmentItem) =>
    item.functions?.[0]?.color ?? item.equipmentCategory?.color ?? "#a3a3a3";

  // arkyo-server: badge de plan (items verrouillés) retiré.

  // Actions unitaires — partagées entre carte et rangée de tableau.
  const renderItemActions = (item: TenantEquipmentItem) => {
    const { isArkyo, locked, shadowFork } = getItemFlags(item);
    if (locked) return null;
    // Item Arkyo pur : Modifier (implicite via onClick — le fork se crée au
    // premier enregistrement) · Dupliquer (variante, comportement historique).
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
      }>("/api/tenant/catalogue/equipment/bulk-delete", { ids });
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
  const columns = useMemo<CatalogueColumn<TenantEquipmentItem>[]>(
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
        key: "brand",
        label: "Marque",
        className: "w-40",
        sortValue: (it) => it.brand?.name ?? null,
        cell: (it) =>
          it.brand?.name ?? <span className="text-[var(--muted-foreground)]">—</span>,
      },
      {
        key: "reference",
        label: "Référence",
        className: "w-36",
        sortValue: (it) => it.reference ?? null,
        cell: (it) =>
          it.reference ? (
            <span className="font-mono text-[var(--muted-foreground)]">
              {it.reference}
            </span>
          ) : (
            <span className="text-[var(--muted-foreground)]">—</span>
          ),
      },
      {
        key: "category",
        label: "Classification",
        className: "w-40",
        sortValue: (it) => it.category ?? null,
        cell: (it) =>
          it.category ? (
            <span className="truncate text-[var(--muted-foreground)]">
              {it.category}
            </span>
          ) : (
            <span className="text-[var(--muted-foreground)]">—</span>
          ),
      },
      {
        key: "format",
        label: "Format",
        className: "w-24",
        sortValue: (it) => (it.isRackable ? (it.heightU ?? 0) : null),
        cell: (it) => {
          if (!it.isRackable)
            return <span className="text-[var(--muted-foreground)]">Libre</span>;
          const fraction =
            it.widthFraction && it.widthFraction !== "FULL"
              ? it.widthFraction === "HALF"
                ? "1/2"
                : it.widthFraction === "THIRD"
                  ? "1/3"
                  : "1/4"
              : null;
          return (
            <span className="text-[var(--foreground)]">
              {it.heightU ? `${it.heightU}U` : "Rack"}
              {fraction ? ` · ${fraction}` : ""}
            </span>
          );
        },
      },
      {
        key: "power",
        label: "Puissance",
        align: "right",
        className: "w-24",
        sortValue: (it) => it.powerW ?? null,
        cell: (it) =>
          it.powerW != null ? (
            <span className="font-mono text-[var(--muted-foreground)]">
              {it.powerW}W
            </span>
          ) : (
            <span className="text-[var(--muted-foreground)]">—</span>
          ),
      },
      {
        key: "indicators",
        label: "Options",
        className: "w-24",
        cell: (it) => (
          <div className="flex items-center gap-1">
            {it.is2110 && (
              <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-medium text-sky-600 dark:text-sky-400">
                2110
              </span>
            )}
            {it.isLightingFixture && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400">
                <Lightbulb className="h-2.5 w-2.5" />
                Lum
              </span>
            )}
          </div>
        ),
      },
    ],
    // Cellules pures (aucune dépendance réactive capturée).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Card (grille) ────────────────────────────────────────────────────────────

  const renderCard = (item: TenantEquipmentItem) => {
    const { isArkyo, locked } = getItemFlags(item);
    const cardItem: EquipmentCardItem = item;
    const nameBadge = null; // arkyo-server: pastille « Vérifié » Arkyo retirée (catalogue unique)
    const onClick = locked
      ? undefined
      : () => router.push(`/admin/catalogue/equipment/${item.id}`);

    return (
      <div
        key={item.id}
        className={cn("relative", locked && "pointer-events-none select-none")}
      >
        <div className={locked ? "opacity-40" : ""}>
          <EquipmentCard
            item={cardItem}
            color={cardColor(item)}
            view={viewMode}
            onClick={onClick}
            nameBadge={nameBadge}
            actions={renderItemActions(item)}
          />
        </div>
        {/* arkyo-server: badge de plan des items verrouillés retiré */}
      </div>
    );
  };

  // ── Empty state de la liste unifiée ─────────────────────────────────────────
  // 3 cas :
  //   1. catalogue entièrement vide → CTA "Créer mon premier équipement"
  //   2. tout est masqué par le toggle « Catalogue Arkyo » désactivé
  //      → suggère de le réactiver
  //   3. tout est verrouillé par le plan → suggère "Afficher hors plan"
  const isListEmpty = visibleList.length === 0;
  const hasHiddenArkyo =
    !showArkyo && items.some((it) => it.source === "ARKYO");
  // arkyo-server: cas « tout est verrouillé par le plan » retiré (pas de plan).

  const renderListEmpty = () => {
    if (hasHiddenArkyo) {
      return (
        <EmptyState
          icon={<Package strokeWidth={1.5} />}
          title="Aucun équipement personnel"
          description="Créez votre premier équipement ou réactivez le catalogue Arkyo."
          action={
            <EmptyStateAction onClick={() => setShowArkyo(true)}>
              Afficher le catalogue Arkyo
            </EmptyStateAction>
          }
        />
      );
    }
    // arkyo-server: état vide « Aucun équipement accessible avec votre plan » retiré.
    return (
      <EmptyState
        icon={<Package strokeWidth={1.5} />}
        title="Aucun équipement"
        // arkyo-server: mention du catalogue Arkyo publié retirée (catalogue unique)
        description="Ajoutez votre premier équipement personnel."
        action={
          <EmptyStateAction onClick={handleCreate}>
            <Plus className="h-3.5 w-3.5" />
            Créer mon premier équipement
          </EmptyStateAction>
        }
      />
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return <LoadingState className="px-8 pt-10" />;
  }
  if (error) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<Package strokeWidth={1.5} />}
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
            placeholder="Nom, référence, marque, catégorie…"
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
              <span className="text-xs font-medium">Nouvel équipement</span>
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
              title="Aucun équipement pour ces filtres"
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
                router.push(`/admin/catalogue/equipment/${it.id}`)
              }
              rowActions={renderItemActions}
              selection={selection}
              defaultSort={{ key: "name", dir: "asc" }}
              onBulkDelete={handleBulkDelete}
              onVisibleOrderChange={setOrderedSelectableIds}
            />
          ) : isStrata ? (
            // arkyo-server: interface Strata (grille dessinée, même liste filtrée)
            <StrataCatalogueGrid
              items={filtered}
              hrefOf={(it) => `/admin/catalogue/equipment/${it.id}`}
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

      {/* ── Drawer filtres ────────────────────────────────────────────── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-[340px]">
          <SheetHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <SlidersHorizontal className="h-4.5 w-4.5" />
              </div>
              <div>
                <SheetTitle className="text-sm">Filtrer les équipements</SheetTitle>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {activeFilterCount} filtre{activeFilterCount > 1 ? "s" : ""} actif
                  {activeFilterCount > 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </SheetHeader>

          <SheetBody>
            <div className="space-y-7">
              {/* 1. Marque */}
              {brandsInList.length > 0 && (
                <div>
                  <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                    Marque
                  </p>
                  <BrandMultiSelect
                    brands={brandsInList}
                    selected={filterBrands}
                    onToggle={toggleBrand}
                    onClear={() => setFilterBrands(new Set())}
                  />
                </div>
              )}

              {/* 2. Fonction */}
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

              {/* 3. Type d'équipement — filtré par fonction (hiérarchie métier) */}
              {typesInList.length > 0 && (
                <div>
                  <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                    Type d&apos;équipement
                    {filterFunctions.size > 0 && (
                      <span className="ml-2 normal-case tracking-normal text-[10px] font-normal text-[var(--muted-foreground)]/70">
                        (filtré par catégorie)
                      </span>
                    )}
                  </p>
                  <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto">
                    {typesInList.map((t) => (
                      <Chip
                        key={t.id}
                        label={t.name}
                        active={filterTypes.has(t.id)}
                        onClick={() => toggleType(t.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Format — Rackable / Pose libre */}
              <div>
                <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                  Format
                </p>
                <div className="flex flex-wrap gap-2">
                  <Chip
                    label="Tous"
                    active={filterFormat === "all"}
                    onClick={() => setFilterFormat("all")}
                  />
                  <Chip
                    label="Rackable"
                    active={filterFormat === "rack"}
                    onClick={() => setFilterFormat(filterFormat === "rack" ? "all" : "rack")}
                  />
                  <Chip
                    label="Pose libre"
                    active={filterFormat === "libre"}
                    onClick={() =>
                      setFilterFormat(filterFormat === "libre" ? "all" : "libre")
                    }
                  />
                </div>
              </div>

              {/* 5. Options — SMPTE 2110 + Lumière */}
              <div>
                <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                  Options
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <Toggle
                    icon={Network}
                    label="SMPTE 2110"
                    active={filter2110}
                    onClick={() => setFilter2110((v) => !v)}
                  />
                  <Toggle
                    icon={Lightbulb}
                    label="Lumière"
                    active={filterLighting}
                    onClick={() => setFilterLighting((v) => !v)}
                  />
                </div>
              </div>

              {/* arkyo-server: 6. Visibilité plan retirée (pas de plan) */}
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

      {/* Wizard "Nouvel équipement" — ouvert depuis `handleCreate` */}
      <NewEquipmentWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={handleWizardCreated}
        onSkipWizard={() => {
          setWizardOpen(false);
          router.push("/admin/catalogue/equipment/new");
        }}
      />

      {/* arkyo-server: « Proposer à Arkyo » retiré (propositions et crédits SaaS) */}
    </>
  );
}
