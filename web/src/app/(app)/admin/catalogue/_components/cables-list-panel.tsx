"use client";

/**
 * CablesListPanel — onglet "Cordons" du Catalogue tenant.
 *
 * Liste unifiée (catalogue unifié) : items Arkyo purs (pill « Vérifié »,
 * éditables via fork-on-edit) + items du tenant (persos, duplications, forks
 * éclipsants) dans une seule liste triée/filtrée/comptée ensemble.
 *
 *  - Toggle « Catalogue Arkyo » dans la toolbar (avant Filtrer) : affiche/
 *    masque les items Arkyo purs. Persisté en localStorage (global).
 *  - Toggle frère « Afficher hors plan » : révèle les items Arkyo verrouillés
 *    par le plan (grisés + badge plan).
 *  - Fork éclipsant (`shadowsArkyo`) : action « Récupérer la version Arkyo »
 *    (restore) + pas de suppression ; mention drift si la source Arkyo a
 *    évolué depuis le fork.
 *
 * Filtres du Sheet : Marque → Fonction → Connecteurs → Cas d'usage → Plan.
 * Le fetch est toujours fait en `scope=all` ; on filtre côté client.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Cable as CableIcon,
  Copy,
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
import { CableCard } from "@/components/catalogue/cable-card";
import { CatalogueSectionHeader } from "@/components/catalogue/catalogue-section-header";
import {
  CatalogueTable,
  type CatalogueColumn,
} from "@/components/catalogue/catalogue-table";
import { useRowSelection } from "@/components/catalogue/use-row-selection";
import { catalogueGridStyle } from "@/components/catalogue/types";
import type { CableCardItem, Gender } from "@/components/catalogue/types";
import { ConnectorIcon } from "@/components/ui/connector-icon";
import { NewCableWizard } from "@/components/cables/new-cable-wizard";
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

// arkyo-server: propositions à Arkyo (CatalogProposalDialog, ProposalStatusBadge),
// pastille « Vérifié » Arkyo, bascules « Catalogue Arkyo » et « hors plan »
// retirées (catalogue unique, pas de plan).
import { safeGetList } from "./safe-fetch";
import type {
  CatalogueListResponse,
  TenantCableItem,
} from "./tenant-catalogue-types";
import {
  mergeCatalogueResponse,
} from "./tenant-catalogue-types"; // arkyo-server: plus de fork éclipsant (isShadowingFork)
import {
  useShowArkyoCatalogue,
} from "./use-tenant-visibility"; // arkyo-server: useShowLockedItems retiré (pas de plan)
import { useCatalogueSync } from "./use-catalogue-sync";
// arkyo-server: useProposalSync retiré (propositions à Arkyo).
import { LoadingState } from "@/components/ui/loading-state";
import { useInterface } from "@/strata/interface-context"; // arkyo-server: interface Strata
import { StrataCablesGrid } from "@/strata/pages/strata-cables-grid"; // arkyo-server: interface Strata

// ── Constants & helpers ───────────────────────────────────────────────────────

type UseCaseFilter = "INSTALLATION" | "PRESTATION";
type SortDir = "asc" | "desc";
type ViewMode = "grid" | "list";

const FILTERS_STORAGE_KEY = "arkyo:tenant-catalogue:filters:cables";
const VIEW_STORAGE_KEY = "arkyo:tenant-catalogue:view:cables";
const GRID_STYLE = catalogueGridStyle("cable");

/** Connecteur du catalogue tenant — porte l'`iconId` requis par ConnectorIcon
 *  (absent du `ConnectorRef` minimal embarqué dans un cordon). */
type CatalogConnectorRow = {
  id: string;
  name: string;
  color: string | null;
  iconId: string;
  version: string | null;
};

// Genre connecteur — jamais ♂/♀ (cf. UI_PATTERNS). Recopié de cable-card.tsx
// (non exporté) pour rester aligné sur le rendu des extrémités.
const GENDER_LABEL: Record<Gender, string> = {
  MALE: "M",
  FEMALE: "F",
  NEUTRAL: "I/O",
};

function genderLabel(g: string | null | undefined): string {
  return GENDER_LABEL[(g ?? "NEUTRAL") as Gender] ?? "I/O";
}

// Libellé longueurs — logique recopiée de cable-card.tsx (non exportée), adaptée
// au shape `TenantCableItem`.
function cableLengthLabel(it: TenantCableItem): string {
  const parts: string[] = [];
  if (
    it.useCases?.includes("PRESTATION") &&
    (it.availableLengths?.length ?? 0) > 0
  ) {
    parts.push(`${it.availableLengths!.length} longueurs`);
  }
  if (
    it.useCases?.includes("INSTALLATION") &&
    (it.customMinLength != null || it.customMaxLength != null)
  ) {
    parts.push(`coupe ${it.customMinLength ?? 0}–${it.customMaxLength ?? "∞"} m`);
  }
  return parts.join(" · ") || "Longueurs : héritées";
}

type PersistedFilters = {
  brands: Set<string>;
  functions: Set<string>;
  useCases: Set<UseCaseFilter>;
  plans: Set<string>;
  leftConnectors: Set<string>;
  rightConnectors: Set<string>;
};

function loadInitialFilters(): PersistedFilters {
  const defaults: PersistedFilters = {
    brands: new Set(),
    functions: new Set(),
    useCases: new Set(),
    plans: new Set(),
    leftConnectors: new Set(),
    rightConnectors: new Set(),
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return defaults;
    // Le parse ignore les clés obsolètes (`mode`, etc.) : on ne lit que les
    // champs connus, un JSON legacy ne provoque donc aucun crash.
    const p = JSON.parse(raw) as {
      brands?: string[];
      functions?: string[];
      useCases?: string[];
      plans?: string[];
      leftConnectors?: string[];
      rightConnectors?: string[];
    };
    return {
      brands: new Set(Array.isArray(p.brands) ? p.brands : []),
      functions: new Set(Array.isArray(p.functions) ? p.functions : []),
      useCases: new Set(
        (Array.isArray(p.useCases) ? p.useCases : []).filter(
          (u): u is UseCaseFilter => u === "INSTALLATION" || u === "PRESTATION",
        ),
      ),
      plans: new Set(Array.isArray(p.plans) ? p.plans : []),
      leftConnectors: new Set(
        Array.isArray(p.leftConnectors) ? p.leftConnectors : [],
      ),
      rightConnectors: new Set(
        Array.isArray(p.rightConnectors) ? p.rightConnectors : [],
      ),
    };
  } catch {
    return defaults;
  }
}

function toCableCardItem(it: TenantCableItem): CableCardItem {
  return {
    id: it.id,
    name: it.name,
    reference: it.reference,
    function: it.function ?? null,
    leftConnector: it.leftConnector ?? null,
    leftGender: (it.leftGender ?? "NEUTRAL") as Gender,
    rightConnector: it.rightConnector ?? null,
    rightGender: (it.rightGender ?? "NEUTRAL") as Gender,
    brand: it.brand ?? null,
    model: it.model ?? null,
    useCases: (it.useCases ?? []).filter(
      (u): u is "INSTALLATION" | "PRESTATION" =>
        u === "INSTALLATION" || u === "PRESTATION",
    ),
    availableLengths: it.availableLengths ?? [],
    customMinLength: it.customMinLength ?? null,
    customMaxLength: it.customMaxLength ?? null,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CablesListPanel() {
  const router = useRouter();
  const isStrata = useInterface() === "strata"; // arkyo-server: interface Strata
  const confirm = useConfirm();
  const toast = useToast();
  // arkyo-server: `canAccess` (plan) retiré.

  const [items, setItems] = useState<TenantCableItem[]>([]);
  const [connectors, setConnectors] = useState<CatalogConnectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  // ── Sélection multi-lignes (mode tableau) ────────────────────────────────────
  const [orderedSelectableIds, setOrderedSelectableIds] = useState<string[]>([]);
  const selection = useRowSelection(orderedSelectableIds);

  // View / sort
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

  // ── Toggle « Catalogue Arkyo » (global) + hors plan ────────────────────────
  const [showArkyo, setShowArkyo] = useShowArkyoCatalogue();
  // arkyo-server: bascule « hors plan » retirée (pas de plan).

  // Search + filters
  const [search, setSearch] = useState("");
  const initialFilters = useMemo(() => loadInitialFilters(), []);
  const [filterBrands, setFilterBrands] = useState<Set<string>>(initialFilters.brands);
  const [filterFunctions, setFilterFunctions] = useState<Set<string>>(initialFilters.functions);
  const [filterUseCases, setFilterUseCases] = useState<Set<UseCaseFilter>>(initialFilters.useCases);
  const [filterPlans, setFilterPlans] = useState<Set<string>>(initialFilters.plans);
  const [filterLeftConnectors, setFilterLeftConnectors] = useState<Set<string>>(
    initialFilters.leftConnectors,
  );
  const [filterRightConnectors, setFilterRightConnectors] = useState<Set<string>>(
    initialFilters.rightConnectors,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        FILTERS_STORAGE_KEY,
        JSON.stringify({
          brands: Array.from(filterBrands),
          functions: Array.from(filterFunctions),
          useCases: Array.from(filterUseCases),
          plans: Array.from(filterPlans),
          leftConnectors: Array.from(filterLeftConnectors),
          rightConnectors: Array.from(filterRightConnectors),
        }),
      );
    } catch {
      /* ignore */
    }
  }, [
    filterBrands,
    filterFunctions,
    filterUseCases,
    filterPlans,
    filterLeftConnectors,
    filterRightConnectors,
  ]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Wizard "Nouveau cordon" — remplace le routage direct vers la fiche vide.
  const [wizardOpen, setWizardOpen] = useState(false);

  // arkyo-server: propositions à Arkyo retirées (statuts, dialog, sync temps réel).

  // Fetch (always scope=all → filter client-side)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [data, conns] = await Promise.all([
          api.get<CatalogueListResponse<TenantCableItem>>(
            "/api/tenant/catalogue/cables?scope=all",
          ),
          safeGetList<CatalogConnectorRow>("/api/tenant/catalogue/connectors"),
        ]);
        if (cancelled) return;
        setItems(mergeCatalogueResponse(data));
        setConnectors(conns);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          setItems([]);
          setConnectors([]);
        } else {
          setError(getApiErrorMessage(e, "Impossible de charger les cordons."));
          setItems([]);
          setConnectors([]);
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

  // Lookup connectorTypeId → { iconId, color } pour rendre ConnectorIcon dans
  // la colonne « Connectique » du tableau (le ConnectorRef embarqué dans un
  // cordon ne porte pas l'iconId).
  const connectorMap = useMemo(() => {
    const m = new Map<string, { iconId: string; color: string | null }>();
    for (const c of connectors) {
      m.set(c.id, { iconId: c.iconId, color: c.color });
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
  const brandsInList = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const it of visibleList) {
      if (it.brand && it.brand.id && !seen.has(it.brand.id)) {
        seen.set(it.brand.id, it.brand);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [visibleList]);

  const functionsInList = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; color: string; sortOrder?: number }>();
    for (const it of visibleList) {
      if (it.function && !seen.has(it.function.id)) seen.set(it.function.id, it.function);
    }
    return Array.from(seen.values()).sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
  }, [visibleList]);

  const useCasesInList = useMemo(() => {
    const present = new Set<UseCaseFilter>();
    for (const it of visibleList) {
      for (const uc of it.useCases ?? []) {
        if (uc === "INSTALLATION" || uc === "PRESTATION") present.add(uc);
      }
    }
    return Array.from(present);
  }, [visibleList]);

  // Connecteurs distincts présents en extrémité gauche / droite — sert au
  // dropdown des filtres et au rendu des pills (lookup id → ConnectorRef).
  const leftConnectorsInList = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string | null }>();
    for (const it of visibleList) {
      const c = it.leftConnector;
      if (c?.id && !seen.has(c.id)) {
        seen.set(c.id, { id: c.id, name: c.name, color: c.color });
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "fr"),
    );
  }, [visibleList]);

  const rightConnectorsInList = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string | null }>();
    for (const it of visibleList) {
      const c = it.rightConnector;
      if (c?.id && !seen.has(c.id)) {
        seen.set(c.id, { id: c.id, name: c.name, color: c.color });
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "fr"),
    );
  }, [visibleList]);

  // arkyo-server: plans présents (filtre « Visibilité plan ») retirés.

  // Filtrage + tri
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = visibleList.filter((it) => {
      if (q) {
        const hay = [
          it.name,
          it.reference ?? "",
          it.brand?.name ?? "",
          it.model ?? "",
          it.function?.label ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterBrands.size > 0) {
        if (!it.brand?.name || !filterBrands.has(it.brand.name)) return false;
      }
      if (filterFunctions.size > 0) {
        if (!it.function?.id || !filterFunctions.has(it.function.id)) return false;
      }
      if (filterUseCases.size > 0) {
        const uc = (it.useCases ?? []) as UseCaseFilter[];
        if (!uc.some((u) => filterUseCases.has(u))) return false;
      }
      // arkyo-server: filtre par plan retiré (pas de plan).
      if (filterLeftConnectors.size > 0) {
        if (
          !it.leftConnector?.id ||
          !filterLeftConnectors.has(it.leftConnector.id)
        ) {
          return false;
        }
      }
      if (filterRightConnectors.size > 0) {
        if (
          !it.rightConnector?.id ||
          !filterRightConnectors.has(it.rightConnector.id)
        ) {
          return false;
        }
      }
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
    filterUseCases,
    filterPlans,
    filterLeftConnectors,
    filterRightConnectors,
    sortDir,
  ]);

  // Group by function
  const grouped = useMemo(() => {
    const m = new Map<
      string,
      { label: string; color: string; sortOrder: number; items: TenantCableItem[] }
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

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleDuplicate = async (item: TenantCableItem) => {
    try {
      const created = await api.post<{ id: string }>(
        `/api/tenant/catalogue/cables/${item.id}/duplicate`,
        {},
      );
      toast.success("Cordon dupliqué.");
      if (created?.id) {
        router.push(`/admin/catalogue/cables/${created.id}`);
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
      router.push(`/admin/catalogue/cables/${id}`);
      return;
    }
    // mode === "close" → refresh la liste pour faire apparaître l'item créé.
    void reloadRef.current();
  };

  const handleDelete = async (item: TenantCableItem) => {
    const ok = await confirm({
      title: "Supprimer le cordon",
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
      await api.delete(`/api/tenant/catalogue/cables/${item.id}`);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast.success("Cordon supprimé.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string; code?: string } | null;
        // arkyo-server: plus de fork éclipsant (code SHADOWING_FORK).
        toast.error(body?.error ?? "Cordon utilisé — suppression impossible.");
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  // arkyo-server: « Récupérer la version Arkyo » retiré (catalogue unique).

  // Toggle helpers
  const toggleBrand = (n: string) => setFilterBrands((p) => toggleInSet(p, n));
  const toggleFunction = (id: string) => setFilterFunctions((p) => toggleInSet(p, id));
  const toggleUseCase = (u: UseCaseFilter) => setFilterUseCases((p) => toggleInSet(p, u));
  // arkyo-server: togglePlan retiré (pas de plan).
  const toggleLeftConnector = (id: string) =>
    setFilterLeftConnectors((p) => toggleInSet(p, id));
  const toggleRightConnector = (id: string) =>
    setFilterRightConnectors((p) => toggleInSet(p, id));

  const activeFilterCount =
    (filterBrands.size > 0 ? 1 : 0) +
    (filterFunctions.size > 0 ? 1 : 0) +
    (filterUseCases.size > 0 ? 1 : 0) +
    // arkyo-server: filtre plan retiré
    (filterLeftConnectors.size > 0 ? 1 : 0) +
    (filterRightConnectors.size > 0 ? 1 : 0);

  const clearAllFilters = () => {
    setFilterBrands(new Set());
    setFilterFunctions(new Set());
    setFilterUseCases(new Set());
    setFilterPlans(new Set());
    setFilterLeftConnectors(new Set());
    setFilterRightConnectors(new Set());
  };

  const activePills = useMemo<ActivePill[]>(() => {
    const fnMap = new Map(functionsInList.map((f) => [f.id, f]));
    const leftConnMap = new Map(leftConnectorsInList.map((c) => [c.id, c]));
    const rightConnMap = new Map(rightConnectorsInList.map((c) => [c.id, c]));
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
    for (const u of filterUseCases) {
      out.push({
        key: `uc:${u}`,
        label: u === "INSTALLATION" ? "Installation" : "Prestation",
        onRemove: () =>
          setFilterUseCases((p) => {
            const n = new Set(p);
            n.delete(u);
            return n;
          }),
      });
    }
    for (const id of filterLeftConnectors) {
      const c = leftConnMap.get(id);
      if (c) {
        out.push({
          key: `lconn:${id}`,
          label: `Conn. G: ${c.name}`,
          color: c.color ?? undefined,
          onRemove: () =>
            setFilterLeftConnectors((p) => {
              const n = new Set(p);
              n.delete(id);
              return n;
            }),
        });
      }
    }
    for (const id of filterRightConnectors) {
      const c = rightConnMap.get(id);
      if (c) {
        out.push({
          key: `rconn:${id}`,
          label: `Conn. D: ${c.name}`,
          color: c.color ?? undefined,
          onRemove: () =>
            setFilterRightConnectors((p) => {
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
    filterBrands,
    filterUseCases,
    filterPlans,
    filterLeftConnectors,
    filterRightConnectors,
    functionsInList,
    leftConnectorsInList,
    rightConnectorsInList,
  ]);

  // ── État d'un item (verrou plan / fork / sélectionnable) ────────────────────
  // Partagé entre carte (grille) et tableau (liste).
  const getItemFlags = (item: TenantCableItem) => {
    const isArkyo = item.source === "ARKYO";
    // arkyo-server: ni verrou de plan ni fork éclipsant (catalogue unique).
    const locked = false;
    const shadowFork = false;
    // Sélectionnable = supprimable unitairement (source ≠ Arkyo, pas fork
    // éclipsant, pas verrouillé plan) — mêmes conditions que le bouton
    // Supprimer unitaire.
    const selectable = !isArkyo && !shadowFork && !locked;
    return { isArkyo, locked, shadowFork, selectable };
  };

  const cardColor = (item: TenantCableItem) => item.function?.color ?? "#a3a3a3";

  // arkyo-server: badge de plan (items verrouillés) retiré.

  // Actions unitaires — partagées entre carte (grille) et rangée de tableau.
  // Le badge statut (quand proposé) reste toujours visible ; les boutons
  // n'apparaissent qu'au survol pour préserver l'aspect épuré (carte + ligne,
  // le `tr` du tableau étant lui aussi un `group`).
  const renderItemActions = (item: TenantCableItem) => {
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
          className="shrink-0 rounded-lg p-1 text-[var(--muted-foreground)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]"
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
          className="shrink-0 rounded-lg p-1 text-[var(--muted-foreground)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
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
      title: `Supprimer ${ids.length} cordon${ids.length > 1 ? "s" : ""} ?`,
      description: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      const res = await api.post<{
        deleted: number;
        failed: { id: string; reason: string }[];
      }>("/api/tenant/catalogue/cables/bulk-delete", { ids });
      const deleted = res?.deleted ?? 0;
      const failed = res?.failed ?? [];
      if (failed.length === 0) {
        toast.success(
          `${deleted} cordon${deleted > 1 ? "s" : ""} supprimé${deleted > 1 ? "s" : ""}.`,
        );
      } else {
        // Peu d'échecs → on cite les raisons ; sinon on se limite au nombre.
        const detail =
          failed.length <= 3
            ? ` (${failed.map((f) => f.reason).join(" · ")})`
            : "";
        toast.info(
          `${deleted} supprimé${deleted > 1 ? "s" : ""}, ${failed.length} échec${failed.length > 1 ? "s" : ""}${detail}.`,
        );
      }
      await reloadRef.current();
      selection.clear();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la suppression groupée."));
    }
  };

  // ── Colonnes du tableau ──────────────────────────────────────────────────────
  const columns = useMemo<CatalogueColumn<TenantCableItem>[]>(
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
              style={{ backgroundColor: it.function?.color ?? "#a3a3a3" }}
            />
            <span className="truncate font-medium text-[var(--foreground)]">
              {it.name}
            </span>
            {/* arkyo-server: pastille « Vérifié » Arkyo retirée (catalogue unique) */}
          </div>
        ),
      },
      {
        key: "connectors",
        label: "Connectique",
        className: "min-w-[220px]",
        cell: (it) => {
          const left = it.leftConnector;
          const right = it.rightConnector;
          const leftIcon = left?.id ? connectorMap.get(left.id)?.iconId : null;
          const rightIcon = right?.id ? connectorMap.get(right.id)?.iconId : null;
          return (
            <div className="flex items-center gap-1.5 text-[11px]">
              {leftIcon && (
                <ConnectorIcon
                  iconId={leftIcon}
                  color={left?.color ?? undefined}
                  size={16}
                />
              )}
              <span className="truncate font-mono font-medium">
                {left?.name ?? "—"}{" "}
                <span className="opacity-50">{genderLabel(it.leftGender)}</span>
              </span>
              <span className="shrink-0 opacity-40">↔</span>
              <span className="truncate font-mono font-medium">
                {right?.name ?? "—"}{" "}
                <span className="opacity-50">{genderLabel(it.rightGender)}</span>
              </span>
              {rightIcon && (
                <ConnectorIcon
                  iconId={rightIcon}
                  color={right?.color ?? undefined}
                  size={16}
                />
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
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: it.function.color }}
              />
              <span className="truncate text-[var(--muted-foreground)]">
                {it.function.label}
              </span>
            </span>
          ) : (
            <span className="text-[var(--muted-foreground)]">—</span>
          ),
      },
      {
        key: "lengths",
        label: "Longueurs",
        className: "w-48",
        cell: (it) => (
          <span className="truncate text-[var(--muted-foreground)]">
            {cableLengthLabel(it)}
          </span>
        ),
      },
    ],
    // Cellule « Connectique » dépend du lookup connecteurs ; le reste est pur.
    [connectorMap],
  );

  // ── Card (grille) ────────────────────────────────────────────────────────────
  const renderCard = (item: TenantCableItem) => {
    const { isArkyo, locked } = getItemFlags(item);
    const onClick = locked
      ? undefined
      : () => router.push(`/admin/catalogue/cables/${item.id}`);

    return (
      <div
        key={item.id}
        className={cn("relative", locked && "pointer-events-none select-none")}
      >
        <div className={locked ? "opacity-40" : ""}>
          <CableCard
            cable={toCableCardItem(item)}
            color={cardColor(item)}
            view={viewMode}
            onClick={onClick}
            actions={
              <div className="flex items-center gap-1">
                {/* arkyo-server: pastille « Vérifié » Arkyo retirée (catalogue unique) */}
                {renderItemActions(item)}
              </div>
            }
          />
        </div>
        {/* arkyo-server: badge de plan des items verrouillés retiré */}
      </div>
    );
  };

  // ── Empty state de la liste unifiée ─────────────────────────────────────────
  // 3 cas :
  //   1. catalogue entièrement vide → CTA "Créer mon premier cordon"
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
          icon={<CableIcon strokeWidth={1.5} />}
          title="Aucun cordon personnel"
          description="Créez votre premier cordon ou réactivez le catalogue Arkyo."
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
        icon={<CableIcon strokeWidth={1.5} />}
        title="Aucun cordon"
        // arkyo-server: mention du catalogue Arkyo publié retirée (catalogue unique)
        description="Ajoutez votre premier cordon personnel."
        action={
          <EmptyStateAction onClick={handleCreate}>
            <Plus className="h-3.5 w-3.5" />
            Créer mon premier cordon
          </EmptyStateAction>
        }
      />
    );
  };

  // Render
  if (loading) {
    return <LoadingState className="px-8 pt-10" />;
  }
  if (error) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<CableIcon strokeWidth={1.5} />}
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
            placeholder="Nom, référence, marque, modèle…"
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
              <span className="text-xs font-medium">Nouveau cordon</span>
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
              title="Aucun cordon pour ces filtres"
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
                router.push(`/admin/catalogue/cables/${it.id}`)
              }
              rowActions={renderItemActions}
              selection={selection}
              defaultSort={{ key: "name", dir: "asc" }}
              onBulkDelete={handleBulkDelete}
              onVisibleOrderChange={setOrderedSelectableIds}
            />
          ) : isStrata ? (
            // arkyo-server: interface Strata (grille dessinée, même liste filtrée)
            <StrataCablesGrid
              items={filtered}
              hrefOf={(it) => `/admin/catalogue/cables/${it.id}`}
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
                <SheetTitle className="text-sm">Filtrer les cordons</SheetTitle>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {activeFilterCount} filtre{activeFilterCount > 1 ? "s" : ""} actif
                  {activeFilterCount > 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </SheetHeader>

          <SheetBody>
            <div className="space-y-7">
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

              {leftConnectorsInList.length > 0 && (
                <div>
                  <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                    Connecteur gauche
                  </p>
                  <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto">
                    {leftConnectorsInList.map((c) => (
                      <Chip
                        key={c.id}
                        label={c.name}
                        active={filterLeftConnectors.has(c.id)}
                        onClick={() => toggleLeftConnector(c.id)}
                        color={c.color ?? undefined}
                      />
                    ))}
                  </div>
                </div>
              )}

              {rightConnectorsInList.length > 0 && (
                <div>
                  <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                    Connecteur droit
                  </p>
                  <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto">
                    {rightConnectorsInList.map((c) => (
                      <Chip
                        key={c.id}
                        label={c.name}
                        active={filterRightConnectors.has(c.id)}
                        onClick={() => toggleRightConnector(c.id)}
                        color={c.color ?? undefined}
                      />
                    ))}
                  </div>
                </div>
              )}

              {useCasesInList.length > 0 && (
                <div>
                  <p className="mb-3 text-[11px] font-bold tracking-widest text-[var(--muted-foreground)] uppercase">
                    Cas d&apos;usage
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {useCasesInList.map((u) => (
                      <Chip
                        key={u}
                        label={u === "INSTALLATION" ? "Installation" : "Prestation"}
                        active={filterUseCases.has(u)}
                        onClick={() => toggleUseCase(u)}
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

      {/* Wizard "Nouveau cordon" — ouvert depuis `handleCreate` */}
      <NewCableWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={handleWizardCreated}
        onSkipWizard={() => {
          setWizardOpen(false);
          router.push("/admin/catalogue/cables/new");
        }}
      />

      {/* arkyo-server: « Proposer à Arkyo » retiré (propositions et crédits SaaS) */}
    </>
  );
}
