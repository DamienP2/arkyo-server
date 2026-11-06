"use client";

/**
 * CatalogPanel — panneau gauche du mode détail Inventaire (split layout 40%).
 *
 * Affiche le catalogue tenant (équipements / panels / adaptateurs) avec :
 *  - tabs sticky en haut
 *  - recherche (debounced visuellement, filtré client-side)
 *  - chips catégorie pour l'onglet Équipements
 *  - liste scrollable d'items, chaque item étant draggable via @dnd-kit/core
 *
 * L'onglet « Accessoires » fait exception : les accessoires n'ont pas de
 * référence catalogue, donc pas de liste. C'est un CONFIGURATEUR (type →
 * hauteur → style ou profondeur) dont l'aperçu dessiné de la face avant est
 * lui-même le draggable — cf. `AccessoryConfigurator`.
 *
 * Source : `GET /api/tenant/projects/[id]/inventaire/catalog` au montage.
 *
 * Spec : 6.1.b (gauche) — `2026-05-08-inventaire-bom-templates-design.md`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Box,
  Cable,
  ExternalLink,
  GripVertical,
  Layers,
  Plus,
  Ruler,
  Search,
  Server,
  Weight,
  X,
  Zap,
} from "@/components/ui/icons";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { api, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import {
  useInventaireScopeOptional,
  ACCESSORY_DEPTH_MAX_MM,
  ACCESSORY_DEPTH_MIN_MM,
  type CatalogFilters,
  type AccessoryFilters,
} from "./inventaire-scope";
import { LoadingState } from "@/components/ui/loading-state";
import { RangeInput } from "@/components/wizard/range-input";
import {
  AccessoryFace,
  previewFaceHeight,
} from "@/components/synoptique/components/accessory-face";

// ── Types ────────────────────────────────────────────────────────────────────

type WidthFraction = "FULL" | "HALF" | "THIRD" | "QUARTER";
type PanelType = "PATCH" | "ACCESSORY";

const WIDTH_LABEL: Record<WidthFraction, string> = {
  FULL: "19\"",
  HALF: "1/2",
  THIRD: "1/3",
  QUARTER: "1/4",
};

// Couleurs fixes alignées sur le rack-editor (`_lib/colors.ts:SPECIAL_HEX`).
const PANEL_DOT_HEX = "#06b6d4"; // cyan — Panels de patch
const ADAPTER_DOT_HEX = "#a855f7"; // violet — Adaptateurs
const DEFAULT_CATEGORY_HEX = "#71717a"; // slate-500 — défaut équipement sans catégorie
const ACCESSORY_DOT_HEX = "#71717a"; // slate — accessoires (cohérent avec rack-editor SPECIAL_HEX["Accessoire rack"])

export type CatalogEquipment = {
  id: string;
  name: string;
  reference: string | null;
  brandName: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  imageUrl: string | null;
  heightU: number | null;
  widthFraction: WidthFraction;
  isRackable: boolean;
  powerW: number | null;
  depthMm: number | null;
  weightKg: number | null;
  /** Options techniques (filtres) — retournées par le GET catalogue. */
  isComponentHost?: boolean;
  isComponent?: boolean;
  is2110?: boolean;
  isLightingFixture?: boolean;
};

export type CatalogPanelItem = {
  id: string;
  name: string;
  reference: string | null;
  type: PanelType;
  heightU: number;
};

export type CatalogAdapter = {
  id: string;
  name: string;
  reference: string | null;
  imageUrl: string | null;
  /** Catégorie (= label de CatalogFunction côté schéma main). */
  categoryName: string | null;
  /** Couleur associée à la catégorie (hex). Fallback ADAPTER_DOT_HEX si absent. */
  categoryColor: string | null;
};

export type CatalogResponse = {
  equipments: CatalogEquipment[];
  panels: CatalogPanelItem[];
  adapters: CatalogAdapter[];
};

export type CatalogKind = "equipment" | "panel" | "adapter" | "accessory";

type Tab = "equipment" | "panel" | "adapter" | "accessory";

export type AccessoryType = "plaque" | "etagere" | "tiroir";
export type AccessoryHeightU = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type AccessoryVariant = "plein" | "pass-cable" | "aere";

/**
 * Payload sérialisable transporté via `active.data.current` lors d'un drag.
 * Inclut les infos minimales pour rendre une preview dans le DragOverlay du
 * BomDetailView, sans avoir à re-fetcher.
 *
 * Pour les accessoires, on ne porte pas un `refId` (pas d'entité catalogue
 * dédiée) mais directement les attributs accessoire.
 */
export type CatalogDragData =
  | {
      kind: "equipment" | "panel" | "adapter";
      refId: string;
      name: string;
      dotHex: string;
      metaSummary: string; // short text shown in DragOverlay preview
      /** Attributs physiques pour les checks (rackable, U dispo, profondeur). */
      isRackable?: boolean;
      heightU?: number | null;
      depthMm?: number | null;
      weightKg?: number | null;
      powerW?: number | null;
      /** Équipement « composant » — seul type installable dans un slot d'hôte. */
      isComponent?: boolean;
      /** Équipement « hôte » (châssis modulaire) — déclenche le flux « nouvel exemplaire ». */
      isComponentHost?: boolean;
    }
  | {
      kind: "accessory";
      accessoryType: AccessoryType;
      accessoryHeightU: AccessoryHeightU;
      accessoryVariant?: AccessoryVariant;
      /** Profondeur en mm — étagère/tiroir uniquement. */
      accessoryDepthMm?: number;
      name: string;
      dotHex: string;
      metaSummary: string;
      /** Pour cohérence avec equipment, accessoires sont rackable, sans poids. */
      isRackable?: boolean;
      heightU?: number | null;
      depthMm?: number | null;
      weightKg?: number | null;
      powerW?: number | null;
    };

// ── Drag id helpers ──────────────────────────────────────────────────────────

/** Format unique pour le drag id "catalogue → BOM" : "catalog::{kind}::{refId}". */
export function makeCatalogDragId(
  kind: "equipment" | "panel" | "adapter",
  refId: string,
): string {
  return `catalog::${kind}::${refId}`;
}

// ── Accessoires : configurateur (type × hauteur × style|profondeur) ─────────
//
// Il n'y a plus de bibliothèque de presets : l'outil Accessoires est un
// configurateur unique dont l'APERÇU est le draggable. Les accessoires n'ont
// pas de référence catalogue — leur identité tient entièrement dans ces trois
// champs, qui sont aussi le payload de drag.

/** Configuration courante de l'accessoire à poser. */
export type AccessoryConfig = {
  type: AccessoryType;
  heightU: AccessoryHeightU;
  /** Plaque uniquement. */
  variant?: AccessoryVariant;
  /** Étagère / tiroir uniquement. */
  depthMm?: number;
};

/**
 * Format de drag id pour les accessoires (pas de refId catalogue) :
 *   "catalog::accessory::{type}-{heightU}U[-{variant}][-{depth}mm]"
 * Exemple : "catalog::accessory::plaque-2U-aere".
 * La profondeur en fait partie : une étagère 300 et une 450 restent deux
 * draggables distincts pour dnd-kit.
 */
export function makeAccessoryDragId(config: AccessoryConfig): string {
  return `catalog::accessory::${config.type}-${config.heightU}U${
    config.variant ? `-${config.variant}` : ""
  }${config.depthMm ? `-${config.depthMm}mm` : ""}`;
}

const ACCESSORY_TYPE_OPTIONS: ReadonlyArray<{
  id: AccessoryType;
  label: string;
}> = [
  { id: "plaque", label: "Plaque" },
  { id: "etagere", label: "Étagère" },
  { id: "tiroir", label: "Tiroir" },
];

/**
 * Hauteurs proposées, 1U → 8U. La borne haute est partagée avec le serveur :
 * `accessoryHeightU` (Zod des routes inventory) et `ACCESSORY_HEIGHTS_U`
 * (`lib/services/rack-inventory.ts`) acceptent la même plage.
 */
const ACCESSORY_HEIGHT_OPTIONS: ReadonlyArray<AccessoryHeightU> = [
  1, 2, 3, 4, 5, 6, 7, 8,
];

const PLAQUE_STYLE_OPTIONS: ReadonlyArray<{
  id: AccessoryVariant;
  label: string;
}> = [
  { id: "plein", label: "Pleine" },
  { id: "pass-cable", label: "Pass-câble" },
  { id: "aere", label: "Aérée" },
];

/**
 * Paliers de profondeur du TIROIR (chips). L'étagère, elle, se règle au
 * curseur libre (200 → 1200 mm, pas de 10) — cf. `RangeInput` plus bas.
 */
const TIROIR_DEPTH_OPTIONS: ReadonlyArray<number> = [
  200, 250, 300, 350, 400, 450, 500,
];

/** Ramène une profondeur libre au palier tiroir le plus proche. */
function nearestTiroirDepth(depthMm: number): number {
  return TIROIR_DEPTH_OPTIONS.reduce((best, d) =>
    Math.abs(d - depthMm) < Math.abs(best - depthMm) ? d : best,
  );
}

/** Libellé du style de plaque, décliné au féminin (« Plaque pleine »). */
const PLAQUE_STYLE_NAME: Record<AccessoryVariant, string> = {
  plein: "pleine",
  "pass-cable": "pass-câble",
  aere: "aérée",
};

const ACCESSORY_TYPE_NAME: Record<AccessoryType, string> = {
  plaque: "Plaque",
  etagere: "Étagère",
  tiroir: "Tiroir",
};

/** Nom lisible de l'accessoire configuré — repris tel quel dans le BOM. */
function accessoryName(config: AccessoryConfig): string {
  if (config.type === "plaque") {
    const style = config.variant ? PLAQUE_STYLE_NAME[config.variant] : "";
    return `Plaque ${style} ${config.heightU}U`.replace(/\s+/g, " ").trim();
  }
  return `${ACCESSORY_TYPE_NAME[config.type]} ${config.heightU}U`;
}

/** Résumé métadonnées : « 2U · aérée » ou « 2U · 300mm ». */
function accessoryMeta(config: AccessoryConfig): string {
  if (config.type === "plaque") {
    return `${config.heightU}U${
      config.variant ? ` · ${PLAQUE_STYLE_NAME[config.variant]}` : ""
    }`;
  }
  return `${config.heightU}U${config.depthMm ? ` · ${config.depthMm}mm` : ""}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function CatalogPanel({
  projectId,
  forceTab,
}: {
  /** `null` en mode rack template (catalogue récupéré depuis l'URL tenant globale). */
  projectId: string | null;
  /**
   * Forçage de l'onglet visible (cas du side panel canvas Inventaire :
   * un seul kind à la fois, choisi par le tool actif). Si fourni :
   *  - les TabButton ne sont pas rendus
   *  - le state `tab` est aligné sur la prop (synchronisé via effect)
   */
  forceTab?: Tab;
}) {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(forceTab ?? "equipment");

  // Dialog redirection : explique que l'ajout d'un nouvel élément ouvre
  // la page de création dans un nouvel onglet (pour ne pas quitter l'inventaire).
  const [newItemDialog, setNewItemDialog] = useState<{
    kind: "équipement" | "panel" | "adaptateur";
    url: string;
  } | null>(null);

  // En mode `forceTab` (side panel canvas Inventaire), les filtres sont
  // pilotés par la sous-topbar contextuelle via `InventaireScope`. Sinon
  // (mode standalone — BomDetailView), state local fallback.
  const scope = useInventaireScopeOptional();
  const useScope = !!forceTab && !!scope;
  const [localCatalogFilters, setLocalCatalogFilters] = useState<CatalogFilters>({
    search: "",
    categoryNames: [],
    techOptions: [],
    adapterCategoryNames: [],
    brandName: null,
    rackable: null,
    sortBy: "name-asc",
  });
  const [localAccessoryFilters, setLocalAccessoryFilters] = useState<AccessoryFilters>({
    accType: "plaque",
    heightU: 1,
    plaqueStyle: "plein",
    depthMm: 300,
  });
  const filters = useScope ? scope!.catalogFilters : localCatalogFilters;
  const accessory = useScope ? scope!.accessoryFilters : localAccessoryFilters;
  const setFiltersDispatch = useScope ? scope!.setCatalogFilters : setLocalCatalogFilters;
  // Le configurateur d'accessoires écrit sa config ici : persistée en
  // localStorage via le scope (mode projet ET mode template), state local en
  // fallback pour un CatalogPanel monté hors scope.
  const setAccessoryDispatch = useScope
    ? scope!.setAccessoryFilters
    : setLocalAccessoryFilters;
  const search = filters.search;
  const setSearch = (s: string) =>
    setFiltersDispatch((prev) => ({ ...prev, search: s }));
  const activeCategory = filters.categoryNames[0] ?? null;
  const setActiveCategory = (cat: string | null) =>
    setFiltersDispatch((prev) => ({
      ...prev,
      categoryNames: cat ? [cat] : [],
    }));

  // Synchronise le state interne `tab` avec la prop `forceTab` pour les
  // consommateurs qui contrôlent l'onglet depuis l'extérieur (canvas inventaire).
  useEffect(() => {
    if (forceTab && forceTab !== tab) setTab(forceTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceTab]);

  // Fetch catalog stable (extrait pour ré-utilisation au mount, au retour
  // sur l'onglet, et sur BroadcastChannel cross-tab).
  const fetchCatalog = useCallback(async () => {
    try {
      const catalogUrl = projectId
        ? `/api/tenant/projects/${projectId}/inventaire/catalog`
        : `/api/tenant/inventaire/catalog`;
      const res = await api.get<CatalogResponse>(catalogUrl);
      setData(res);
      setError(null);
    } catch (e) {
      setError(getApiErrorMessage(e));
      setData({ equipments: [], panels: [], adapters: [] });
    }
  }, [projectId]);

  // Mount initial.
  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  // Sync temps réel #1 : quand l'utilisateur revient sur cet onglet
  // (après création d'un équipement/panel/adapter dans un autre onglet),
  // on refetch silencieusement le catalogue.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchCatalog();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [fetchCatalog]);

  // Sync temps réel #2 : BroadcastChannel cross-tab. Si une autre page
  // (équipement/panel/adapter create) publie "updated" sur le canal
  // `arkyo-catalog`, on refetch immédiatement même si l'onglet inventaire
  // reste visible côte à côte.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel("arkyo-catalog");
    bc.onmessage = (e) => {
      if (e.data === "updated") void fetchCatalog();
    };
    return () => bc.close();
  }, [fetchCatalog]);

  // Catégories équipements (avec couleur) — pour la dropdown topbar.
  const categoriesWithColor = useMemo(() => {
    if (!data) return [] as { name: string; color: string | null }[];
    const map = new Map<string, string | null>();
    for (const e of data.equipments) {
      if (!e.categoryName) continue;
      // Conserve la première couleur non-null rencontrée.
      const current = map.get(e.categoryName);
      if (current === undefined || (current === null && e.categoryColor)) {
        map.set(e.categoryName, e.categoryColor);
      }
    }
    return Array.from(map.entries())
      .map(([name, color]) => ({ name, color }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const categories = useMemo(
    () => categoriesWithColor.map((c) => c.name),
    [categoriesWithColor],
  );

  // Marques distinctes (pour le select dans la sous-topbar).
  const brands = useMemo(() => {
    if (!data) return [] as string[];
    const set = new Set<string>();
    for (const e of data.equipments) {
      if (e.brandName) set.add(e.brandName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data]);

  // Catégories adaptateurs (avec couleur) — pour la dropdown topbar.
  const adapterCategoriesWithColor = useMemo(() => {
    if (!data) return [] as { name: string; color: string | null }[];
    const map = new Map<string, string | null>();
    for (const a of data.adapters) {
      if (!a.categoryName) continue;
      const current = map.get(a.categoryName);
      if (current === undefined || (current === null && a.categoryColor)) {
        map.set(a.categoryName, a.categoryColor);
      }
    }
    return Array.from(map.entries())
      .map(([name, color]) => ({ name, color }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const adapterCategories = useMemo(
    () => adapterCategoriesWithColor.map((c) => c.name),
    [adapterCategoriesWithColor],
  );

  // Publie les options vers le scope inventaire (lu par la sous-topbar).
  useEffect(() => {
    if (!useScope) return;
    scope!.setCatalogOptions({
      categoryNames: categories,
      adapterCategoryNames: adapterCategories,
      brandNames: brands,
      categories: categoriesWithColor,
      adapterCategories: adapterCategoriesWithColor,
    });
  }, [
    useScope,
    categories,
    adapterCategories,
    brands,
    categoriesWithColor,
    adapterCategoriesWithColor,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtrage par tab + recherche + catégorie + marque + rackable + tri.
  const filteredEquipments = useMemo(() => {
    if (!data) return [] as CatalogEquipment[];
    const q = search.trim().toLowerCase();
    const cats = filters.categoryNames;
    const list = data.equipments.filter((e) => {
      if (cats.length > 0) {
        if (!e.categoryName || !cats.includes(e.categoryName)) return false;
      }
      if (filters.brandName && e.brandName !== filters.brandName) return false;
      if (filters.rackable !== null && e.isRackable !== filters.rackable) return false;
      // Options techniques : union — l'équipement matche s'il possède au moins
      // une des options cochées.
      if (filters.techOptions.length > 0) {
        const techMatch = filters.techOptions.some((opt) =>
          opt === "host"
            ? e.isComponentHost === true
            : opt === "component"
              ? e.isComponent === true
              : opt === "2110"
                ? e.is2110 === true
                : opt === "lighting"
                  ? e.isLightingFixture === true
                  : false,
        );
        if (!techMatch) return false;
      }
      if (q.length === 0) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.reference?.toLowerCase().includes(q) ?? false) ||
        (e.brandName?.toLowerCase().includes(q) ?? false)
      );
    });
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return filters.sortBy === "name-desc" ? sorted.reverse() : sorted;
  }, [
    data,
    search,
    filters.categoryNames,
    filters.techOptions,
    filters.brandName,
    filters.rackable,
    filters.sortBy,
  ]);

  const filteredPanels = useMemo(() => {
    if (!data) return [] as CatalogPanelItem[];
    const q = search.trim().toLowerCase();
    if (q.length === 0) return data.panels;
    return data.panels.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || (p.reference?.toLowerCase().includes(q) ?? false),
    );
  }, [data, search]);

  const filteredAdapters = useMemo(() => {
    if (!data) return [] as CatalogAdapter[];
    const q = search.trim().toLowerCase();
    const cats = filters.adapterCategoryNames;
    return data.adapters.filter((a) => {
      if (cats.length > 0) {
        if (!a.categoryName || !cats.includes(a.categoryName)) return false;
      }
      if (q.length === 0) return true;
      return (
        a.name.toLowerCase().includes(q) || (a.reference?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [data, search, filters.adapterCategoryNames]);

  if (data === null) {
    const loaderCls = forceTab
      ? "flex h-full items-center justify-center text-[var(--muted-foreground)]"
      : "flex h-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]";
    return (
      <div className={loaderCls}>
        <LoadingState label="Chargement du catalogue…" className="py-0" />
      </div>
    );
  }

  // En mode `forceTab` (side panel canvas), le panel hôte fournit déjà le
  // fond `bg-card` + bordures du shell : pas de contour propre pour éviter
  // le double-contour. En mode standalone (BomDetailView), on conserve le
  // chrome classique `rounded-xl border bg-card`.
  const containerCls = forceTab
    ? "flex h-full min-h-0 flex-col overflow-hidden"
    : "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]";

  return (
    <div className={containerCls}>
      {/* Tabs — masqués si l'onglet est forcé depuis l'extérieur */}
      {!forceTab && (
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--secondary)]/30 px-2 py-1.5">
          <TabButton
            active={tab === "equipment"}
            icon={<Server className="h-3.5 w-3.5" />}
            label="Équipements"
            count={data.equipments.length}
            onClick={() => setTab("equipment")}
          />
          <TabButton
            active={tab === "panel"}
            icon={<Layers className="h-3.5 w-3.5" />}
            label="Panels"
            count={data.panels.length}
            onClick={() => setTab("panel")}
          />
          <TabButton
            active={tab === "adapter"}
            icon={<Cable className="h-3.5 w-3.5" />}
            label="Adaptateurs"
            count={data.adapters.length}
            onClick={() => setTab("adapter")}
          />
          <TabButton
            active={tab === "accessory"}
            icon={<Box className="h-3.5 w-3.5" />}
            label="Accessoires"
            onClick={() => setTab("accessory")}
          />
        </div>
      )}

      {/* Search + chips — masqués en mode `forceTab` (filtres dans la
          sous-topbar) et sur l'onglet Accessoires (configurateur, pas de liste
          à filtrer). */}
      {!forceTab && tab !== "accessory" && (
        <div className="shrink-0 border-b border-[var(--border)] p-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher dans le catalogue…"
              className="flex h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 pl-8 text-sm focus:border-[var(--accent)] focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 transition-colors hover:bg-[var(--border)]"
                title="Effacer"
              >
                <X className="h-3 w-3 text-[var(--muted-foreground)]" />
              </button>
            )}
          </div>

          {tab === "equipment" && categories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <CategoryChip
                label="Toutes"
                active={activeCategory === null}
                onClick={() => setActiveCategory(null)}
              />
              {categories.map((c) => (
                <CategoryChip
                  key={c}
                  label={c}
                  active={activeCategory === c}
                  onClick={() => setActiveCategory(activeCategory === c ? null : c)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && (
          <p
            role="alert"
            className="mb-2 rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-2 py-1.5 text-xs text-[var(--destructive)]"
          >
            {error}
          </p>
        )}

        {tab === "equipment" && (
          <>
            <AddNewItemButton
              label="Ajouter un nouvel équipement"
              onClick={() =>
                setNewItemDialog({
                  kind: "équipement",
                  url: "/admin/catalogue/equipment/new",
                })
              }
            />
            <GroupedListSection
              empty="Aucun équipement"
              items={filteredEquipments}
              getCategory={(e) => e.categoryName}
              renderItem={(e) => <EquipmentDraggable key={e.id} equipment={e} />}
            />
          </>
        )}
        {tab === "panel" && (
          <>
            <AddNewItemButton
              label="Ajouter un nouveau panel"
              onClick={() =>
                setNewItemDialog({ kind: "panel", url: "/panels" })
              }
            />
            <ListSection
              empty="Aucun panel"
              items={filteredPanels}
              renderItem={(p) => <PanelDraggable key={p.id} panel={p} />}
            />
          </>
        )}
        {tab === "adapter" && (
          <>
            <AddNewItemButton
              label="Ajouter un nouvel adaptateur"
              onClick={() =>
                setNewItemDialog({
                  kind: "adaptateur",
                  url: "/admin/catalogue/adapters/new",
                })
              }
            />
            <GroupedListSection
              empty="Aucun adaptateur"
              items={filteredAdapters}
              getCategory={(a) => a.categoryName}
              renderItem={(a) => <AdapterDraggable key={a.id} adapter={a} />}
            />
          </>
        )}
        {tab === "accessory" && (
          <AccessoryConfigurator
            config={accessory}
            onChange={setAccessoryDispatch}
          />
        )}
      </div>

      <NewItemRedirectDialog
        item={newItemDialog}
        onClose={() => setNewItemDialog(null)}
      />
    </div>
  );
}

// ── AddNewItemButton : bouton dashed inline en tête de chaque tab ──────────

function AddNewItemButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // arkyo-server: habillage Strata (texte d'accent sur l'accent à 8 % : --accent-strong)
      className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border)] bg-[var(--secondary)]/20 px-3 py-2 text-[11px] font-medium text-[var(--muted-foreground)] transition-all hover:border-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] hover:text-[var(--accent-strong)] active:scale-[0.98]"
    >
      <Plus className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

// ── NewItemRedirectDialog : modal d'explication + ouverture nouvel onglet ──

function NewItemRedirectDialog({
  item,
  onClose,
}: {
  item: { kind: "équipement" | "panel" | "adaptateur"; url: string } | null;
  onClose: () => void;
}) {
  const isOpen = item !== null;

  const handleConfirm = () => {
    if (item) {
      window.open(item.url, "_blank", "noopener,noreferrer");
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
              <ExternalLink className="h-4 w-4" />
            </div>
            <DialogTitle>
              Créer un nouveau {item?.kind ?? ""}
            </DialogTitle>
          </div>
          <DialogDescription className="mt-3 leading-relaxed">
            Vous allez être redirigé vers la page de création dans un{" "}
            <strong className="text-[var(--foreground)]">nouvel onglet</strong>.
            Une fois le {item?.kind ?? "nouvel élément"} créé, revenez à cet
            inventaire pour le voir apparaître dans la liste.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            <ExternalLink className="h-3.5 w-3.5" />
            Ouvrir dans un nouvel onglet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function TabButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  /** Omis pour un onglet sans liste (configurateur d'accessoires). */
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-all",
        active
          ? "bg-[var(--card)] text-[var(--accent)] shadow-sm"
          : "text-[var(--muted-foreground)] hover:bg-[var(--card)]/60 hover:text-[var(--foreground)]",
      )}
    >
      {icon}
      {label}
      {count != null && (
        <span className="text-[10px] tabular-nums opacity-60">{count}</span>
      )}
    </button>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-medium transition-colors",
        active
          ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
          : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/70",
      )}
    >
      {label}
    </button>
  );
}

function ListSection<T>({
  items,
  renderItem,
  empty,
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-[var(--muted-foreground)]">{empty}</p>
    );
  }
  return <div className="flex flex-col gap-1.5">{items.map((it) => renderItem(it))}</div>;
}

/**
 * Liste groupée par catégorie. Header simple uppercase, items en dessous.
 * Items sans catégorie regroupés en fin de liste sous « Sans catégorie ».
 */
function GroupedListSection<T>({
  items,
  getCategory,
  renderItem,
  empty,
}: {
  items: T[];
  getCategory: (item: T) => string | null;
  renderItem: (item: T) => React.ReactNode;
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-[var(--muted-foreground)]">{empty}</p>
    );
  }

  const groups = new Map<string, T[]>();
  const NO_CATEGORY = "__none__";
  for (const it of items) {
    const cat = getCategory(it) ?? NO_CATEGORY;
    const bucket = groups.get(cat);
    if (bucket) bucket.push(it);
    else groups.set(cat, [it]);
  }

  const orderedKeys = Array.from(groups.keys())
    .filter((k) => k !== NO_CATEGORY)
    .sort((a, b) => a.localeCompare(b));
  if (groups.has(NO_CATEGORY)) orderedKeys.push(NO_CATEGORY);

  return (
    <div className="flex flex-col gap-3">
      {orderedKeys.map((key) => {
        const bucket = groups.get(key) ?? [];
        const label = key === NO_CATEGORY ? "Sans catégorie" : key;
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1 pt-1 pb-0.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
                {label}
              </p>
              <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]/60">
                {bucket.length}
              </span>
              <div className="ml-1 h-px flex-1 bg-[var(--border)]/60" />
            </div>
            <div className="flex flex-col gap-1.5">
              {bucket.map((it) => renderItem(it))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Draggable items ──────────────────────────────────────────────────────────

/**
 * Card draggable — pattern aligné sur `DraggableEquipment` du rack-editor
 * (`app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-items.tsx:16`).
 *
 * Layout : grip à gauche · pastille couleur · nom + meta sur 1 ligne. Pas
 * d'image, pas d'icône kind — la pastille porte la sémantique visuelle.
 */
function CardDraggable({
  dragId,
  dragData,
  dotHex,
  name,
  brand,
  meta,
}: {
  dragId: string;
  dragData: CatalogDragData;
  dotHex: string;
  name: string;
  /** Marque optionnelle — affichée en sous-titre discret. */
  brand?: string | null;
  meta: React.ReactNode;
}) {
  // Pas de `transform` sur la source — c'est le `<DragOverlay>` du parent
  // (BomDetailView) qui rend une preview suivant la souris. La source reste
  // en place avec une opacité réduite (pattern aligné rack-editor).
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: dragData,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] transition-all select-none",
        "hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5",
        isDragging && "opacity-40",
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="flex w-7 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded-l-md transition-colors hover:bg-[var(--border)] active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotHex }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs leading-tight font-medium">{name}</p>
          {brand && (
            <p className="mt-0.5 truncate text-[10px] leading-tight text-[var(--muted-foreground)]">
              {brand}
            </p>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
            {meta}
          </div>
        </div>
      </div>
    </div>
  );
}

function EquipmentDraggable({ equipment }: { equipment: CatalogEquipment }) {
  const dotHex = equipment.categoryColor ?? DEFAULT_CATEGORY_HEX;
  // Format racké : 19" / 1/2 / 1/3 / 1/4 (= "longueur" au sens broadcast,
  // pas une valeur précise). Pour les non-rackable on tombe sur depthMm en cm.
  const rackFormatLabel: string | null = equipment.isRackable
    ? WIDTH_LABEL[equipment.widthFraction]
    : null;
  const depthCmLabel: string | null =
    !equipment.isRackable && equipment.depthMm != null
      ? `${Math.round((equipment.depthMm / 10) * 10) / 10}cm`
      : null;
  const metaSummary = useMemo(() => {
    const parts: string[] = [];
    if (equipment.isRackable && equipment.heightU != null) parts.push(`${equipment.heightU}U`);
    if (rackFormatLabel) parts.push(rackFormatLabel);
    if (depthCmLabel) parts.push(depthCmLabel);
    if (equipment.weightKg != null) parts.push(`${equipment.weightKg}kg`);
    if (equipment.powerW != null) parts.push(`${equipment.powerW}W`);
    return parts.join(" · ");
  }, [
    equipment.isRackable,
    equipment.heightU,
    rackFormatLabel,
    depthCmLabel,
    equipment.weightKg,
    equipment.powerW,
  ]);
  const dragData: CatalogDragData = useMemo(
    () => ({
      kind: "equipment",
      refId: equipment.id,
      name: equipment.name,
      dotHex,
      metaSummary,
      isRackable: equipment.isRackable,
      heightU: equipment.heightU,
      depthMm: equipment.depthMm,
      weightKg: equipment.weightKg,
      powerW: equipment.powerW,
      isComponent: equipment.isComponent ?? false,
      isComponentHost: equipment.isComponentHost ?? false,
    }),
    [
      equipment.id,
      equipment.name,
      dotHex,
      metaSummary,
      equipment.isRackable,
      equipment.heightU,
      equipment.depthMm,
      equipment.weightKg,
      equipment.isComponent,
      equipment.isComponentHost,
      equipment.powerW,
    ],
  );
  return (
    <CardDraggable
      dragId={makeCatalogDragId("equipment", equipment.id)}
      dragData={dragData}
      dotHex={dotHex}
      name={equipment.name}
      brand={equipment.brandName}
      meta={
        <MetaList
          items={[
            equipment.isRackable && equipment.heightU != null ? (
              <span>{equipment.heightU}U</span>
            ) : null,
            rackFormatLabel ? (
              <span className="flex items-center gap-0.5">
                <Ruler className="h-2.5 w-2.5" />
                {rackFormatLabel}
              </span>
            ) : null,
            depthCmLabel ? (
              <span className="flex items-center gap-0.5">
                <Ruler className="h-2.5 w-2.5" />
                {depthCmLabel}
              </span>
            ) : null,
            equipment.weightKg != null ? (
              <span className="flex items-center gap-0.5">
                <Weight className="h-2.5 w-2.5" />
                {equipment.weightKg}kg
              </span>
            ) : null,
            equipment.powerW != null ? (
              <span className="flex items-center gap-0.5">
                <Zap className="h-2.5 w-2.5" />
                {equipment.powerW}W
              </span>
            ) : null,
          ]}
        />
      }
    />
  );
}

/**
 * Liste de métriques séparées par de petits traits verticaux (h-2.5 w-px).
 * Filtre les `null/false` avant insertion — pas de séparateur avant le 1er
 * item rendu.
 */
function MetaList({ items }: { items: Array<React.ReactNode | null | false> }) {
  const valid = items.filter(
    (c): c is React.ReactNode => c != null && c !== false,
  );
  return (
    <>
      {valid.map((node, idx) => (
        <span key={idx} className="flex items-center gap-1.5">
          {idx > 0 && <span aria-hidden className="h-2.5 w-px bg-[var(--border)]" />}
          {node}
        </span>
      ))}
    </>
  );
}

function PanelDraggable({ panel }: { panel: CatalogPanelItem }) {
  const metaSummary = `${panel.heightU}U · ${panel.type}`;
  const dragData: CatalogDragData = useMemo(
    () => ({
      kind: "panel",
      refId: panel.id,
      name: panel.name,
      dotHex: PANEL_DOT_HEX,
      metaSummary,
      isRackable: true,
      heightU: panel.heightU,
    }),
    [panel.id, panel.name, panel.heightU, metaSummary],
  );
  return (
    <CardDraggable
      dragId={makeCatalogDragId("panel", panel.id)}
      dragData={dragData}
      dotHex={PANEL_DOT_HEX}
      name={panel.name}
      meta={
        <MetaList
          items={[
            <span>{panel.heightU}U</span>,
            <span>{panel.type}</span>,
          ]}
        />
      }
    />
  );
}

function AdapterDraggable({ adapter }: { adapter: CatalogAdapter }) {
  const metaSummary = adapter.reference ?? "—";
  const dotHex = adapter.categoryColor ?? ADAPTER_DOT_HEX;
  const dragData: CatalogDragData = useMemo(
    () => ({
      kind: "adapter",
      refId: adapter.id,
      name: adapter.name,
      dotHex,
      metaSummary,
    }),
    [adapter.id, adapter.name, dotHex, metaSummary],
  );
  return (
    <CardDraggable
      dragId={makeCatalogDragId("adapter", adapter.id)}
      dragData={dragData}
      dotHex={dotHex}
      name={adapter.name}
      meta={
        <MetaList
          items={[adapter.reference ? <span>{adapter.reference}</span> : null]}
        />
      }
    />
  );
}

// ── Configurateur d'accessoires ──────────────────────────────────────────────

/**
 * Panneau « Accessoires » : un configurateur unique (type → hauteur → style ou
 * profondeur) surmonté d'un aperçu dessiné de la FACE AVANT, mis à jour en
 * direct. C'est l'aperçu lui-même qu'on saisit pour le glisser dans un
 * contenant : on voit exactement la pièce qu'on pose.
 *
 * La config est persistée (localStorage via `InventaireScope`) et conserve
 * séparément le style de plaque et la profondeur étagère/tiroir : changer de
 * type restitue le dernier réglage de ce type.
 */
function AccessoryConfigurator({
  config,
  onChange,
}: {
  config: AccessoryFilters;
  onChange: Dispatch<SetStateAction<AccessoryFilters>>;
}) {
  const set = (patch: Partial<AccessoryFilters>) =>
    onChange((prev) => ({ ...prev, ...patch }));

  /**
   * Le tiroir n'expose que des paliers : si on arrive d'une étagère réglée au
   * curseur (ex. 640), on recale sur le palier le plus proche pour qu'une chip
   * soit toujours active.
   */
  const setType = (accType: AccessoryFilters["accType"]) =>
    onChange((prev) => ({
      ...prev,
      accType,
      depthMm:
        accType === "tiroir" ? nearestTiroirDepth(prev.depthMm) : prev.depthMm,
    }));

  const isPlaque = config.accType === "plaque";
  const isEtagere = config.accType === "etagere";
  const current: AccessoryConfig = {
    type: config.accType,
    heightU: config.heightU,
    variant: isPlaque ? config.plaqueStyle : undefined,
    depthMm: isPlaque ? undefined : config.depthMm,
  };

  return (
    <div className="flex flex-col gap-3.5 p-1">
      <Field label="Type">
        <div className="border-border bg-card flex items-center gap-0.5 rounded-md border p-0.5">
          {ACCESSORY_TYPE_OPTIONS.map((t) => (
            <SegButton
              key={t.id}
              active={config.accType === t.id}
              onClick={() => setType(t.id)}
            >
              {t.label}
            </SegButton>
          ))}
        </div>
      </Field>

      <Field label="Hauteur">
        <div className="flex flex-wrap gap-1.5">
          {ACCESSORY_HEIGHT_OPTIONS.map((u) => (
            <Chip
              key={u}
              active={config.heightU === u}
              onClick={() => set({ heightU: u })}
              mono
            >
              {u}U
            </Chip>
          ))}
        </div>
      </Field>

      {/* Troisième réglage — dépend du type : style (plaque), curseur libre
          (étagère) ou paliers (tiroir). */}
      {isPlaque && (
        <Field label="Style">
          <div className="flex flex-wrap gap-1.5">
            {PLAQUE_STYLE_OPTIONS.map((s) => (
              <Chip
                key={s.id}
                active={config.plaqueStyle === s.id}
                onClick={() => set({ plaqueStyle: s.id })}
              >
                {s.label}
              </Chip>
            ))}
          </div>
        </Field>
      )}

      {isEtagere && (
        <Field
          label="Profondeur"
          right={
            <span
              className="text-[11px] font-semibold tabular-nums text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {config.depthMm} mm
            </span>
          }
        >
          <RangeInput
            min={ACCESSORY_DEPTH_MIN_MM}
            max={ACCESSORY_DEPTH_MAX_MM}
            step={10}
            value={config.depthMm}
            onChange={(v) => set({ depthMm: v })}
          />
        </Field>
      )}

      {!isPlaque && !isEtagere && (
        <Field label="Profondeur (mm)">
          <div className="flex flex-wrap gap-1.5">
            {TIROIR_DEPTH_OPTIONS.map((d) => (
              <Chip
                key={d}
                active={config.depthMm === d}
                onClick={() => set({ depthMm: d })}
                mono
              >
                {d}
              </Chip>
            ))}
          </div>
        </Field>
      )}

      <Field label="Aperçu — glisser pour placer">
        <AccessoryPreviewDraggable config={current} />
      </Field>
    </div>
  );
}

function Field({
  label,
  right,
  children,
}: {
  label: string;
  /** Valeur courante affichée en bout de ligne de label (curseurs). */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-[var(--muted-foreground)] uppercase">
          {label}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded px-2 py-1 text-[11px] font-medium transition-all active:scale-95",
        active
          // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
          ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]"
          : "text-[var(--muted-foreground)] hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] hover:text-[var(--foreground)]",
      )}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  mono,
  children,
}: {
  active: boolean;
  onClick: () => void;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={mono ? { fontFamily: "var(--font-mono)" } : undefined}
      className={cn(
        "rounded-md border px-2 py-1 text-[10px] font-semibold transition-all active:scale-95",
        active
          // arkyo-server: habillage Strata (texte d'accent sur l'accent à 10 % : --accent-strong)
          ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]"
          : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] hover:text-[var(--foreground)]",
      )}
    >
      {children}
    </button>
  );
}

/**
 * L'aperçu EST le draggable : mêmes `dragData` que l'ancienne carte de preset,
 * donc le flux de drop (dialog de quantité, POST BOM) est inchangé.
 */
function AccessoryPreviewDraggable({ config }: { config: AccessoryConfig }) {
  const name = accessoryName(config);
  const metaSummary = accessoryMeta(config);
  const dragData: CatalogDragData = useMemo(
    () => ({
      kind: "accessory",
      accessoryType: config.type,
      accessoryHeightU: config.heightU,
      accessoryVariant: config.variant,
      accessoryDepthMm: config.depthMm,
      name,
      dotHex: ACCESSORY_DOT_HEX,
      metaSummary,
      isRackable: true,
      heightU: config.heightU,
    }),
    [config, name, metaSummary],
  );
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: makeAccessoryDragId(config),
    data: dragData,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title="Glisser vers un contenant"
      className={cn(
        "border-border/60 flex min-h-[92px] cursor-grab touch-none items-center justify-center rounded-md border bg-[var(--secondary)]/20 p-3 transition-colors select-none active:cursor-grabbing",
        "hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)]",
        isDragging && "opacity-40",
      )}
    >
      <AccessoryFace
        type={config.type}
        variant={config.variant}
        height={previewFaceHeight(config.heightU)}
        aria-label={`${name} · ${metaSummary}`}
      />
    </div>
  );
}

// ── Preview pour le DragOverlay ──────────────────────────────────────────────

/**
 * Preview rendu dans le `<DragOverlay>` du parent — visuellement aligné sur
 * la `CardDraggable` mais sans handlers DnD (statique, suit le curseur).
 */
export function CatalogDragPreview({ data }: { data: CatalogDragData }) {
  return (
    <div className="pointer-events-none flex w-72 items-center gap-2 rounded-md border border-[var(--accent)]/50 bg-[var(--card)] shadow-lg ring-2 ring-[var(--accent)]/30 select-none">
      <div className="flex w-7 shrink-0 items-center justify-center self-stretch rounded-l-md">
        <GripVertical className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: data.dotHex }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs leading-tight font-medium">{data.name}</p>
          <p className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">
            {data.metaSummary}
          </p>
        </div>
      </div>
    </div>
  );
}

