"use client";

/**
 * InventaireScope — context partagé entre tous les panneaux de l'onglet Inventaire.
 *
 *  - State `racks` (canvas + ContainerPanel doivent rester synchronisés)
 *  - `setRacks` exposé pour add/delete/update position
 *  - DndContext global (side panel = source, canvas cards = drop targets)
 *  - DragOverlay (preview suivant le curseur)
 *  - AddQuantityDialog (modal saisie quantité au drop d'un item catalogue)
 *
 * Le scope englobe l'`EditorShell` (cf. project-editor.tsx) afin que tous
 * les descendants — leftSidePanel ET canvas — partagent le même contexte.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, Loader2, Minus, Plus } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { cn } from "@/lib/utils";

import {
  CatalogDragPreview,
  type CatalogDragData,
} from "./catalog-panel";
import type {
  InventaireBomItem,
  InventaireLocation,
  InventaireRack,
} from "../inventaire-client";
import type { SaveStatus } from "../../_editor/project-contextual-topbar";
import { useProjectSync } from "../../_hooks/use-project-sync";
// arkyo-server: `use-catalogue-drift` retiré (dérive des snapshots du catalogue
// Arkyo, SaaS ; catalogue unique). `getDrift` renvoie toujours `null` et
// `refreshDrift` ne fait rien ; le type `DriftItem` est recopié
// d'arkyo:…/use-catalogue-drift.ts:27-39 pour les panneaux qui le lisent.
type DriftItem = {
  snapshotId: string;
  itemType: "EQUIPMENT" | "CABLE" | "ADAPTER";
  arkyoSourceId: string;
  name: string;
  hasDrift: boolean;
  snapshotVersion: string;
  currentVersion: string | null;
  sourceDeleted: boolean;
};

// ── Mapping API → scope BOM item ─────────────────────────────────────────────

type BomItemDto = {
  id: string;
  kind: "equipment" | "panel" | "adapter" | "accessory";
  /** Identité catalogue de la row (renvoyée par le GET inventory). */
  refId?: string;
  quantity: number;
  name: string;
  reference: string | null;
  brandName: string | null;
  heightU?: number | null;
  depthMm?: number | null;
  weightKg?: number | null;
  powerW?: number | null;
  isRackable?: boolean;
  category?: string | null;
  categoryColor?: string | null;
  snapshotId?: string | null;
  // Composants modulaires (châssis type Ross openGear).
  hostItemId?: string | null;
  hostSlotIndex?: number | null;
  isComponentHost?: boolean;
  hostSlotCount?: number | null;
  isComponent?: boolean;
  componentSlotSpan?: number;
};

function toScopeBomItem(it: BomItemDto): InventaireBomItem {
  return {
    id: it.id,
    kind: it.kind,
    refId: it.refId ?? undefined,
    quantity: it.quantity,
    name: it.name,
    reference: it.reference,
    brandName: it.brandName,
    category: it.category ?? null,
    categoryColor: it.categoryColor ?? null,
    isRackable: it.isRackable ?? (it.kind !== "adapter"),
    heightU: it.heightU ?? null,
    depthMm: it.depthMm ?? null,
    weightKg: it.weightKg ?? null,
    powerW: it.powerW ?? null,
    snapshotId: it.snapshotId ?? null,
    hostItemId: it.hostItemId ?? null,
    hostSlotIndex: it.hostSlotIndex ?? null,
    isComponentHost: it.isComponentHost ?? false,
    hostSlotCount: it.hostSlotCount ?? null,
    isComponent: it.isComponent ?? false,
    componentSlotSpan: it.componentSlotSpan ?? 1,
  };
}

// ── Context ──────────────────────────────────────────────────────────────────

/**
 * Valeur sentinelle de `selectedLocationId` pour la vue « À affecter » —
 * les contenants hérités de la migration, sans emplacement.
 */
export const UNASSIGNED_LOCATION_ID = "__unassigned__";

/**
 * Options techniques filtrables de l'onglet Équipements. Multi-sélection en
 * union (un équipement matche s'il possède AU MOINS une des options cochées).
 */
export type TechOption = "host" | "component" | "2110" | "lighting";

export type CatalogFilters = {
  /** Recherche libre — appliquée à tous les onglets catalogue. */
  search: string;
  /** Onglet équipements — catégories sélectionnées (multi). */
  categoryNames: string[];
  /** Onglet équipements — options techniques sélectionnées (multi, union). */
  techOptions: TechOption[];
  /** Onglet adaptateurs — catégories (= fonctions) sélectionnées (multi). */
  adapterCategoryNames: string[];
  /** Onglet équipements — marque sélectionnée (mono). */
  brandName: string | null;
  /**
   * Onglet équipements — filtre rackable.
   *  - `null` : tous
   *  - `true` : rackable uniquement
   *  - `false` : non rackable uniquement
   */
  rackable: boolean | null;
  /** Onglet équipements — tri courant. */
  sortBy: "name-asc" | "name-desc";
};

export type AccessoryFilters = {
  /** Sous-type d'accessoire actif (segment). */
  accType: "plaque" | "etagere" | "tiroir";
  /** Hauteur U sélectionnée (chips 1U → 8U). */
  heightU: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** Style plaque sélectionné — uniquement quand `accType === "plaque"`. */
  plaqueStyle: "plein" | "pass-cable" | "aere";
  /**
   * Profondeur en mm — uniquement pour étagère/tiroir. Valeur LIBRE : l'étagère
   * se règle au curseur (200 → 1200, pas de 10), le tiroir garde ses paliers.
   * Ne pas re-typer en union : ça re-figerait la liste côté UI.
   */
  depthMm: number;
};

/** Bornes du curseur de profondeur (étagère). */
export const ACCESSORY_DEPTH_MIN_MM = 200;
export const ACCESSORY_DEPTH_MAX_MM = 1200;

export const DEFAULT_CATALOG_FILTERS: CatalogFilters = {
  search: "",
  categoryNames: [],
  techOptions: [],
  adapterCategoryNames: [],
  brandName: null,
  rackable: null,
  sortBy: "name-asc",
};

const VALID_TECH_OPTIONS: TechOption[] = ["host", "component", "2110", "lighting"];

export const DEFAULT_ACCESSORY_FILTERS: AccessoryFilters = {
  accType: "plaque",
  heightU: 1,
  plaqueStyle: "plein",
  depthMm: 300,
};

// ── Validateurs pour la persistance localStorage ─────────────────────────────
// Rejette les valeurs corrompues (ancien shape, enum renommé…) — sans ça, un
// changement de type breaking pourrait faire planter l'UI au mount.

function isCatalogFilters(v: unknown): v is CatalogFilters {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.search === "string" &&
    Array.isArray(r.categoryNames) &&
    r.categoryNames.every((x) => typeof x === "string") &&
    Array.isArray(r.techOptions) &&
    r.techOptions.every((x) => VALID_TECH_OPTIONS.includes(x as TechOption)) &&
    Array.isArray(r.adapterCategoryNames) &&
    r.adapterCategoryNames.every((x) => typeof x === "string") &&
    (r.brandName === null || typeof r.brandName === "string") &&
    (r.rackable === null || typeof r.rackable === "boolean") &&
    (r.sortBy === "name-asc" || r.sortBy === "name-desc")
  );
}

function isAccessoryFilters(v: unknown): v is AccessoryFilters {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const validAccType = ["plaque", "etagere", "tiroir"];
  const validPlaqueStyle = ["plein", "pass-cable", "aere"];
  const heightU = r.heightU;
  const depthMm = r.depthMm;
  return (
    validAccType.includes(r.accType as string) &&
    typeof heightU === "number" &&
    Number.isInteger(heightU) &&
    heightU >= 1 &&
    heightU <= 8 &&
    validPlaqueStyle.includes(r.plaqueStyle as string) &&
    typeof depthMm === "number" &&
    Number.isFinite(depthMm) &&
    depthMm >= ACCESSORY_DEPTH_MIN_MM &&
    depthMm <= ACCESSORY_DEPTH_MAX_MM
  );
}

/** Catégorie avec sa couleur (publiée par CatalogPanel pour la dropdown topbar). */
export type CategoryOption = { name: string; color: string | null };

/** Options du catalogue (publiées par CatalogPanel après fetch, lues par la sous-topbar). */
export type CatalogOptions = {
  categoryNames: string[];
  adapterCategoryNames: string[];
  brandNames: string[];
  /** Catégories équipements avec couleur (issu de catalogEquipment.categoryColor). */
  categories: CategoryOption[];
  /** Catégories adaptateurs avec couleur (issu de catalogAdapter.categoryColor). */
  adapterCategories: CategoryOption[];
};

export const EMPTY_CATALOG_OPTIONS: CatalogOptions = {
  categoryNames: [],
  adapterCategoryNames: [],
  brandNames: [],
  categories: [],
  adapterCategories: [],
};

type InventaireScopeValue = {
  /**
   * ID du projet courant — `null` quand le scope est utilisé en mode
   * "rack template" (standalone, sans projet). Toutes les URLs API du
   * scope et de ses enfants doivent passer par `getInventoryUrl()` /
   * `getCatalogUrl()` pour s'aiguiller correctement.
   */
  projectId: string | null;
  /** Aiguille vers la bonne URL inventory selon le mode (projet vs template). */
  getInventoryUrl: (rackId: string) => string;
  /** Aiguille vers la bonne URL catalogue selon le mode. */
  getCatalogUrl: () => string;
  racks: InventaireRack[];
  setRacks: Dispatch<SetStateAction<InventaireRack[]>>;
  /** Emplacements du projet (vide en mode template). */
  locations: InventaireLocation[];
  setLocations: Dispatch<SetStateAction<InventaireLocation[]>>;
  /**
   * Lieu affiché par la fiche (et sélectionné dans le panneau propriétés).
   * Vaut `UNASSIGNED_LOCATION_ID` pour la vue « À affecter », `null` tant
   * qu'aucun lieu n'existe. Persisté par projet.
   */
  selectedLocationId: string | null;
  setSelectedLocationId: (next: string | null) => void;
  /** Crée un lieu (+ son rack virtuel côté serveur). */
  createLocation: (name: string) => Promise<InventaireLocation | null>;
  /** Renomme / met à jour le code d'un lieu. */
  updateLocation: (
    locationId: string,
    data: { name?: string; cableCode?: string | null },
  ) => Promise<void>;
  /** Supprime un lieu — renvoie false si l'API refuse (409). */
  deleteLocation: (locationId: string) => Promise<boolean>;
  /** Affecte un contenant à un lieu (drag d'une bande à l'autre). */
  assignRackToLocation: (rackId: string, locationId: string) => Promise<void>;
  catalogFilters: CatalogFilters;
  setCatalogFilters: Dispatch<SetStateAction<CatalogFilters>>;
  accessoryFilters: AccessoryFilters;
  setAccessoryFilters: Dispatch<SetStateAction<AccessoryFilters>>;
  catalogOptions: CatalogOptions;
  setCatalogOptions: Dispatch<SetStateAction<CatalogOptions>>;
  /**
   * Card actuellement mise en surbrillance (suite click side panel).
   * Indépendant de l'affichage du contenu — la liste BOM est toujours
   * visible dans toutes les cards.
   */
  expandedRackId: string | null;
  setExpandedRackId: Dispatch<SetStateAction<string | null>>;
  /**
   * Ligne d'item sélectionnée dans une carte contenant (ou dans la section des
   * équipements libres). Exclusif avec `expandedRackId` : sélectionner un item
   * désélectionne le contenant, et inversement — cf. `selectItem` /
   * `selectRack`, à préférer aux setters bruts.
   */
  selectedItem: { rackId: string; itemId: string } | null;
  selectItem: (sel: { rackId: string; itemId: string } | null) => void;
  /** Sélectionne un contenant (et efface la sélection d'item). */
  selectRack: (rackId: string | null) => void;
  /**
   * Re-fetch le BOM d'un rack et met à jour `racks[].bom`. Utilisé par
   * l'édition inline (PATCH quantity / DELETE item).
   */
  refreshRackBom: (rackId: string) => Promise<void>;
  /**
   * Notifie un état de sauvegarde au project-editor (badge sous-topbar).
   * Le badge auto-hide via useEffect côté project-editor.
   */
  notifySave: (status: SaveStatus) => void;
  /**
   * Réorganise un rack : déplace `rackId` à l'index `targetIdx`. Update
   * optimiste local + POST /reorder côté server. Utilisé par le canvas
   * (drag card) et le side panel (drag liste).
   */
  reorderRacks: (rackId: string, targetIdx: number) => Promise<void>;
  /**
   * Card actuellement survolée par un drag d'item catalog (drag depuis side
   * panel). Permet d'afficher le ring bleu sur la bonne card.
   */
  hoveredRackId: string | null;
  /**
   * Bande de lieu survolée par un drag d'item catalog (drop sur le FOND de la
   * bande → équipement libre dans le rack virtuel du lieu).
   */
  hoveredLocationId: string | null;
  /**
   * Renvoie l'éventuel DriftItem associé à un snapshotId (drift Arkyo).
   * null si pas de snapshot, pas de drift, ou source supprimée.
   */
  getDrift: (snapshotId: string | null | undefined) => DriftItem | null;
  /** Refetch manuel du drift après acceptation d'une mise à jour. */
  refreshDrift: () => Promise<void>;
};

const InventaireScopeContext = createContext<InventaireScopeValue | null>(null);

export function useInventaireScope(): InventaireScopeValue {
  const ctx = useContext(InventaireScopeContext);
  if (!ctx) {
    throw new Error("useInventaireScope must be used within <InventaireScope>");
  }
  return ctx;
}

/** Variante non-throwing pour les composants utilisables hors scope (BomDetailView). */
export function useInventaireScopeOptional(): InventaireScopeValue | null {
  return useContext(InventaireScopeContext);
}

// ── Pending drop : payload + métadonnées ─────────────────────────────────────

type PendingDrop = {
  rackId: string;
  data: CatalogDragData;
};

/**
 * Drag INTERNE : déplacement d'un composant déjà installé vers une autre case
 * de la réglette de SON châssis (SlotRuler). Ne cible jamais les cartes ni les
 * bandes — uniquement les droppables `hostslot-*` du même hôte.
 */
export type ComponentMoveDragData = {
  kind: "component-move";
  itemId: string;
  rackId: string;
  hostItemId: string;
  name: string;
};

/**
 * Drag INTERNE : déplacement d'une ligne d'inventaire d'un contenant vers un
 * autre contenant du lieu (ou vers/depuis les équipements libres, portés par
 * le rack virtuel — un rack comme un autre côté API).
 *
 * Les composants imbriqués (`hostItemId != null`) ne sont jamais draggables :
 * ils suivent leur châssis, que la route de transfert emmène avec lui.
 */
export type ItemMoveDragData = {
  kind: "item-move";
  itemId: string;
  /** Contenant d'origine — jamais une cible valide. */
  rackId: string;
  name: string;
  /** Quantité de la ligne — détermine transfert partiel ou ligne entière. */
  quantity: number;
  /** Type de la ligne et identité catalogue, pour le transfert partiel. */
  itemKind: "equipment" | "panel" | "adapter" | "accessory";
  refId?: string;
};

type ScopeDragData = CatalogDragData | ComponentMoveDragData | ItemMoveDragData;

/**
 * Flux « nouvel exemplaire » — déclenché au drop d'un équipement hôte sur une
 * carte qui contient déjà ≥ 1 exemplaire du même équipement. On ne fusionne
 * jamais les quantités : chaque validation crée un nouvel exemplaire, avec une
 * copie optionnelle des composants d'un exemplaire existant.
 */
type HostInstancePending = {
  rackId: string;
  refId: string;
  name: string;
  /** Exemplaires existants du même équipement (ordre des rows du BOM). */
  instances: { id: string; index: number; componentCount: number }[];
};

// ── Provider ─────────────────────────────────────────────────────────────────

export function InventaireScope({
  projectId,
  initialRacks,
  initialLocations,
  notifySave,
  children,
}: {
  /** `null` en mode rack template (standalone). */
  projectId: string | null;
  initialRacks: InventaireRack[];
  /** Emplacements du projet — omis en mode template. */
  initialLocations?: InventaireLocation[];
  /**
   * Callback pour notifier le parent (project-editor) d'un changement de
   * statut de sauvegarde — déclenche l'affichage du badge coloré.
   */
  notifySave?: (status: SaveStatus) => void;
  children: React.ReactNode;
}) {
  const toast = useToast();

  // Helpers URL — aiguillent entre les routes projet et template.
  const getInventoryUrl = useCallback(
    (rackId: string) =>
      projectId
        ? `/api/tenant/projects/${projectId}/racks/${rackId}/inventory`
        : `/api/racks/${rackId}/inventory`,
    [projectId],
  );
  const getCatalogUrl = useCallback(
    () =>
      projectId
        ? `/api/tenant/projects/${projectId}/inventaire/catalog`
        : `/api/tenant/inventaire/catalog`,
    [projectId],
  );
  const [racks, setRacks] = useState<InventaireRack[]>(initialRacks);
  // Sync prop → state quand le snapshot SSR change (router.refresh() déclenché
  // par useProjectSync / AppSync). Permet aux autres onglets / autres clients
  // de propager leurs modifications en temps réel à l'onglet Inventaire ouvert.
  useEffect(() => {
    setRacks(initialRacks);
  }, [initialRacks]);

  const [locations, setLocations] = useState<InventaireLocation[]>(
    initialLocations ?? [],
  );
  useEffect(() => {
    if (!initialLocations) return;
    setLocations(initialLocations);
  }, [initialLocations]);

  // Lieu affiché — persisté par projet (convention : pages = localStorage).
  const [selectedLocationId, setSelectedLocationId] = useLocalStorageState<
    string | null
  >(`inventaire-location-${projectId ?? "template"}`, null, {
    isValid: (v): v is string | null => v === null || typeof v === "string",
  });

  // Résolution du lieu affiché : la valeur persistée doit toujours pointer un
  // lieu existant, sinon on retombe sur le premier lieu (ou sur la vue
  // « À affecter » s'il reste des contenants hérités).
  const hasUnassigned = racks.some((r) => !r.isVirtual && !r.locationId);
  useEffect(() => {
    const valid =
      (selectedLocationId === UNASSIGNED_LOCATION_ID && hasUnassigned) ||
      (selectedLocationId !== null &&
        locations.some((l) => l.id === selectedLocationId));
    if (valid) return;
    const next =
      locations[0]?.id ?? (hasUnassigned ? UNASSIGNED_LOCATION_ID : null);
    if (next !== selectedLocationId) setSelectedLocationId(next);
  }, [locations, hasUnassigned, selectedLocationId, setSelectedLocationId]);

  // SSE — déclenche un router.refresh() ciblé sur les events de ce projet.
  // Couvre : ajouts/suppressions de contenants, modifications de BOM, déplacements
  // de cards, suppressions de slots, modifications de propriétés rack, etc.
  // acceptUnscoped: true → les routes globales (`/api/racks/[id]/...`) qui ne
  // publient pas encore projectId continuent de déclencher un refresh (compat
  // ascendante).
  const router = useRouter();
  useProjectSync({
    // En mode template (projectId = null), on passe une string vide — le hook
    // gère ce cas via `acceptUnscoped: true` (tous les events `rack_inventory`
    // déclenchent un refresh).
    projectId: projectId ?? "",
    entities: [
      "rack_inventory",
      "rack",
      "rig",
      "project",
      "project_equipment",
      "slot",
      "rackConnection",
      // Emplacements (lieux) — création/renommage/suppression depuis un autre
      // onglet ou un autre client.
      "location",
      // Catalogue supervisor : refetch quand l'admin modifie un équipement
      // (nom, dimensions, connecteurs, signaux…) ou un signal/connecteur.
      "catalog",
    ],
    acceptUnscoped: true,
    onUpdate: () => router.refresh(),
  });

  // Drift catalogue Arkyo — fetch + refetch SSE + map snapshotId → DriftItem
  // Désactivé en mode template (pas de snapshot à drifter).
  // arkyo-server: dérive du catalogue Arkyo retirée (SaaS) : jamais de dérive,
  // aucun appel à `/api/tenant/projects/:id/catalogue-drift`.
  const getDrift = useCallback(
    (_snapshotId: string | null | undefined): DriftItem | null => null,
    [],
  );
  const refreshDrift = useCallback(async () => {}, []);

  // Filtres persistés en localStorage — globaux (pas scopés au projet) :
  // l'utilisateur retrouve sa dernière sélection d'un projet à l'autre.
  // Pertinent surtout pour brandName / rackable / sortBy / accType qui
  // reflètent une préférence de travail. La recherche libre persiste aussi
  // (vidable en un clic via la croix de la searchbox).
  const [catalogFilters, setCatalogFilters] = useLocalStorageState<CatalogFilters>(
    "inventaire:catalog-filters",
    DEFAULT_CATALOG_FILTERS,
    { isValid: isCatalogFilters },
  );
  const [accessoryFilters, setAccessoryFilters] = useLocalStorageState<AccessoryFilters>(
    "inventaire:accessory-filters",
    DEFAULT_ACCESSORY_FILTERS,
    { isValid: isAccessoryFilters },
  );
  const [catalogOptions, setCatalogOptions] = useState<CatalogOptions>(
    EMPTY_CATALOG_OPTIONS,
  );

  // Pré-charge les options catalogue (catégories + couleurs) dès le mount
  // du scope, sans attendre que `catalog-panel` soit ouvert. Sans ça, les
  // points colorés des items BOM dans les cards de contenant sont gris tant
  // que l'utilisateur n'a pas ouvert l'outil "Équipements" — typique au
  // reload de la page sur un projet existant.
  useEffect(() => {
    let cancelled = false;
    type CatalogRespLite = {
      equipments: Array<{ categoryName: string | null; categoryColor: string | null }>;
      adapters: Array<{ categoryName: string | null; categoryColor: string | null }>;
    };
    const url = projectId
      ? `/api/tenant/projects/${projectId}/inventaire/catalog`
      : `/api/tenant/inventaire/catalog`;
    (async () => {
      try {
        const res = await api.get<CatalogRespLite>(url);
        if (cancelled) return;
        const eqMap = new Map<string, string | null>();
        for (const e of res.equipments) {
          if (!e.categoryName) continue;
          const cur = eqMap.get(e.categoryName);
          if (cur === undefined || (cur === null && e.categoryColor)) {
            eqMap.set(e.categoryName, e.categoryColor);
          }
        }
        const adMap = new Map<string, string | null>();
        for (const a of res.adapters) {
          if (!a.categoryName) continue;
          const cur = adMap.get(a.categoryName);
          if (cur === undefined || (cur === null && a.categoryColor)) {
            adMap.set(a.categoryName, a.categoryColor);
          }
        }
        const eqList = Array.from(eqMap.entries())
          .map(([name, color]) => ({ name, color }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const adList = Array.from(adMap.entries())
          .map(([name, color]) => ({ name, color }))
          .sort((a, b) => a.name.localeCompare(b.name));
        // Merge : ne pas écraser si `catalog-panel` a déjà publié des
        // brandNames plus complets — on ne touche qu'aux 4 champs catégories.
        setCatalogOptions((prev) => ({
          ...prev,
          categoryNames: eqList.map((c) => c.name),
          adapterCategoryNames: adList.map((c) => c.name),
          categories: eqList,
          adapterCategories: adList,
        }));
      } catch {
        /* silencieux — le scope reste sur EMPTY_CATALOG_OPTIONS, et
           `catalog-panel` finira par publier ses propres options quand il
           sera monté. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const [expandedRackId, setExpandedRackId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<{
    rackId: string;
    itemId: string;
  } | null>(null);

  // Sélections exclusives : un item OU un contenant, jamais les deux.
  const selectItem = useCallback(
    (sel: { rackId: string; itemId: string } | null) => {
      setSelectedItem(sel);
      if (sel) setExpandedRackId(null);
    },
    [],
  );
  const selectRack = useCallback((rackId: string | null) => {
    setExpandedRackId(rackId);
    if (rackId) setSelectedItem(null);
  }, []);

  // L'item sélectionné a disparu (suppression, transfert vers un autre
  // contenant, refresh SSE) → on retombe sur son contenant.
  useEffect(() => {
    if (!selectedItem) return;
    const rack = racks.find((r) => r.id === selectedItem.rackId);
    if (!rack) {
      setSelectedItem(null);
      return;
    }
    if (!rack.bom.some((it) => it.id === selectedItem.itemId)) {
      setSelectedItem(null);
      setExpandedRackId(rack.isVirtual ? null : rack.id);
    }
  }, [racks, selectedItem]);

  const [activeDrag, setActiveDrag] = useState<ScopeDragData | null>(null);
  const [hoveredRackId, setHoveredRackId] = useState<string | null>(null);
  const [hoveredLocationId, setHoveredLocationId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDrop | null>(null);
  const [hostPending, setHostPending] = useState<HostInstancePending | null>(null);

  // Référence stockée pour lire la valeur courante dans handleDragEnd
  // (sans stale closure du `activeDrag` ou `hoveredRackId`).
  const hoveredRackIdRef = useRef<string | null>(null);
  hoveredRackIdRef.current = hoveredRackId;
  const hoveredLocationIdRef = useRef<string | null>(null);
  hoveredLocationIdRef.current = hoveredLocationId;
  const activeDragRef = useRef<ScopeDragData | null>(null);
  activeDragRef.current = activeDrag;
  const locationsRef = useRef<InventaireLocation[]>(locations);
  locationsRef.current = locations;

  /**
   * Résout la cible sous le curseur : une carte de contenant (`data-rack-id`)
   * en priorité, sinon le fond d'une bande de lieu (`data-location-id`).
   * Les cartes sont rendues DANS les bandes → le premier ancêtre matché par
   * `closest` en partant de l'élément le plus haut donne la bonne priorité.
   */
  const hitTestDropTarget = (
    x: number,
    y: number,
  ): { rackId: string | null; locationId: string | null } => {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      const hit = (el as Element).closest("[data-rack-id],[data-location-id]");
      if (!hit) continue;
      const rackId = hit.getAttribute("data-rack-id");
      if (rackId) return { rackId, locationId: null };
      return { rackId: null, locationId: hit.getAttribute("data-location-id") };
    }
    return { rackId: null, locationId: null };
  };

  /**
   * Filtre la cible survolée selon le drag en cours. Un déplacement d'item ne
   * peut pas atterrir dans son propre contenant : on éteint le survol plutôt
   * que d'allumer une carte qui refuserait le dépôt.
   */
  const dropTargetFor = (hit: {
    rackId: string | null;
    locationId: string | null;
  }): { rackId: string | null; locationId: string | null } => {
    const drag = activeDragRef.current;
    if (drag?.kind !== "item-move") return hit;
    if (hit.rackId && hit.rackId === drag.rackId) {
      return { rackId: null, locationId: null };
    }
    return hit;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as ScopeDragData | undefined;
    if (data) setActiveDrag(data);
  };

  // Hit-test via @dnd-kit `onDragMove` — appelé à chaque update du sensor.
  // Double-canal avec le mousemove listener pour fiabilité maximale.
  const handleDragMove = (event: DragMoveEvent) => {
    // Déplacement de composant : les seules cibles sont les cases de slot
    // (droppables dnd-kit) — pas de survol carte/bande.
    if (activeDragRef.current?.kind === "component-move") return;
    const startEv = event.activatorEvent as
      | (Event & { clientX?: number; clientY?: number })
      | undefined;
    if (!startEv) return;
    const sx = startEv.clientX;
    const sy = startEv.clientY;
    if (typeof sx !== "number" || typeof sy !== "number") return;
    const x = sx + event.delta.x;
    const y = sy + event.delta.y;
    const hit = dropTargetFor(hitTestDropTarget(x, y));
    setHoveredRackId((cur) => (cur === hit.rackId ? cur : hit.rackId));
    setHoveredLocationId((cur) =>
      cur === hit.locationId ? cur : hit.locationId,
    );
  };

  // Hit-test natif pendant le drag : on parcourt TOUS les éléments à la
  // position du curseur via `document.elementsFromPoint` (pluriel) et on
  // prend le premier qui a un ancêtre `[data-rack-id]`. Cela contourne le
  // cas où l'overlay du drag passerait par-dessus la card (même avec
  // `pointer-events: none`, certains navigateurs/situations bugguent).
  useEffect(() => {
    if (!activeDrag || activeDrag.kind === "component-move") return;
    let lastRackId: string | null = null;
    let lastLocationId: string | null = null;
    const onMove = (e: MouseEvent) => {
      const hit = dropTargetFor(hitTestDropTarget(e.clientX, e.clientY));
      if (hit.rackId !== lastRackId) {
        lastRackId = hit.rackId;
        setHoveredRackId(hit.rackId);
      }
      if (hit.locationId !== lastLocationId) {
        lastLocationId = hit.locationId;
        setHoveredLocationId(hit.locationId);
      }
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrag]);

  const handleDragEnd = (event: DragEndEvent) => {
    const data = activeDragRef.current;
    // Drop sur une carte de contenant, sinon sur le fond d'une bande de lieu
    // → l'item devient un équipement libre porté par le rack virtuel du lieu.
    const hoveredLocation = hoveredLocationIdRef.current
      ? (locationsRef.current.find(
          (l) => l.id === hoveredLocationIdRef.current,
        ) ?? null)
      : null;
    const rackId = hoveredRackIdRef.current ?? hoveredLocation?.virtualRackId ?? null;
    const over = event.over;
    setActiveDrag(null);
    setHoveredRackId(null);
    setHoveredLocationId(null);
    if (!data) return;

    // Priorité : drop sur une ligne de slot d'hôte (droppable dédié, résolu par
    // `pointerWithin` → le slot exactement sous le curseur). On ajoute alors le
    // composant directement (quantité 1) sans passer par le dialog quantité.
    // Le drop sur la carte (hors ligne de slot) conserve son comportement : la
    // détection carte se fait par hit-test manuel (`hoveredRackIdRef`), donc un
    // drop sur un slot ne déclenche jamais AUSSI le drop carte.
    const overData = over?.data.current as
      | { hostItemId?: string; slotIndex?: number; rackId?: string }
      | undefined;

    // Déplacement d'une ligne d'inventaire vers un AUTRE contenant. Jamais de
    // retombée sur les autres flux : ni dialog quantité, ni slot d'hôte.
    if (data.kind === "item-move") {
      if (rackId && rackId !== data.rackId) {
        void handleTransferItem(data, rackId);
      }
      return;
    }

    // Déplacement d'un composant entre slots de SON châssis (drag interne
    // depuis la réglette). Jamais de retombée sur le drop carte/bande.
    if (data.kind === "component-move") {
      if (
        over &&
        typeof over.id === "string" &&
        over.id.startsWith("hostslot-") &&
        overData?.hostItemId === data.hostItemId &&
        overData.slotIndex != null &&
        overData.rackId != null
      ) {
        void handleMoveComponent(overData.rackId, data.itemId, overData.slotIndex);
      }
      return;
    }

    if (
      over &&
      typeof over.id === "string" &&
      over.id.startsWith("hostslot-") &&
      overData?.hostItemId != null &&
      overData.slotIndex != null &&
      overData.rackId != null &&
      data.kind === "equipment" &&
      // Seuls les équipements « composant » s'installent dans un slot d'hôte.
      // Un équipement classique lâché sur une ligne de slot retombe sur le
      // drop carte standard (dialog quantité) ci-dessous.
      data.isComponent === true
    ) {
      void handleDropInHostSlot(
        overData.rackId,
        overData.hostItemId,
        overData.slotIndex,
        data.refId,
      );
      return;
    }

    // Sinon : drop sur la carte.
    if (!rackId) return;

    // Équipement HÔTE (châssis modulaire) → flux « nouvel exemplaire » : pas de
    // dialog quantité, jamais de fusion. Un POST = un exemplaire.
    if (data.kind === "equipment" && data.isComponentHost === true) {
      void handleHostDrop(rackId, data.refId, data.name);
      return;
    }

    // Cas standard → dialog quantité (comportement inchangé).
    setPending({ rackId, data });
  };

  /**
   * Transfert d'une ligne d'inventaire vers un autre contenant.
   *
   * Deux chemins, selon ce que la ligne représente :
   *  - LIGNE ENTIÈRE (`POST …/inventory/[itemId]/transfer`) quand il n'y a
   *    qu'un exemplaire : atomique, emmène les composants imbriqués, purge les
   *    RackSlot et refuse (409) si l'équipement est câblé.
   *  - UN EXEMPLAIRE quand la ligne en compte plusieurs : POST d'un exemplaire
   *    sur la cible, puis PATCH de la quantité d'origine. Le serveur réconcilie
   *    les slots à chaque étape (`syncInventorySlots`, qui supprime en priorité
   *    un slot fantôme non câblé). Ordre choisi : on crée AVANT de décrémenter,
   *    pour qu'un échec en cours de route laisse un exemplaire en trop plutôt
   *    qu'un exemplaire perdu.
   *
   * Exception : un ACCESSOIRE à plusieurs exemplaires part en ligne entière —
   * son identité (type/hauteur/variante/profondeur) n'est pas portée par le BOM
   * côté client, on ne peut donc pas la reposter. À unifier le jour où la route
   * de transfert acceptera une quantité.
   */
  const handleTransferItem = async (
    data: ItemMoveDragData,
    targetRackId: string,
  ) => {
    const partial =
      data.quantity > 1 && data.itemKind !== "accessory" && !!data.refId;
    notifySave?.("saving");
    try {
      if (partial) {
        const refBody =
          data.itemKind === "panel"
            ? { panelId: data.refId }
            : data.itemKind === "adapter"
              ? { catalogAdapterId: data.refId }
              : { catalogEquipmentId: data.refId };
        await api.post(getInventoryUrl(targetRackId), {
          ...refBody,
          quantity: 1,
        });
        await api.patch(`${getInventoryUrl(data.rackId)}/${data.itemId}`, {
          quantity: data.quantity - 1,
        });
      } else {
        await api.post(
          `${getInventoryUrl(data.rackId)}/${data.itemId}/transfer`,
          { targetRackId },
        );
      }
      await Promise.all([
        refreshRackBom(data.rackId),
        refreshRackBom(targetRackId),
      ]);
      notifySave?.("saved");
      const target = racks.find((r) => r.id === targetRackId);
      const where = !target
        ? null
        : target.isVirtual
          ? "les équipements libres"
          : target.name;
      toast.info(
        where
          ? `« ${data.name} » déplacé vers ${where}.`
          : `« ${data.name} » déplacé.`,
      );
    } catch (e) {
      notifySave?.("error");
      toast.error(getApiErrorMessage(e));
    }
  };

  /**
   * Drop d'un équipement hôte sur une carte. S'il n'existe aucun exemplaire du
   * même équipement dans le contenant → POST direct (1 exemplaire). Sinon →
   * ouvre `HostInstanceDialog` pour choisir « configuration vide » ou copier
   * les composants d'un exemplaire existant.
   */
  const handleHostDrop = async (rackId: string, refId: string, name: string) => {
    const rack = racks.find((r) => r.id === rackId);
    const instances = rack
      ? rack.bom.filter(
          (it) =>
            it.kind === "equipment" && it.hostItemId == null && it.refId === refId,
        )
      : [];

    if (instances.length === 0) {
      notifySave?.("saving");
      try {
        await api.post(getInventoryUrl(rackId), { catalogEquipmentId: refId });
        await refreshRackBom(rackId);
        notifySave?.("saved");
      } catch (e) {
        notifySave?.("error");
        toast.error(getApiErrorMessage(e));
      }
      return;
    }

    const bom = rack!.bom;
    setHostPending({
      rackId,
      refId,
      name,
      instances: instances.map((inst, idx) => ({
        id: inst.id,
        index: idx + 1,
        componentCount: bom.filter((c) => c.hostItemId === inst.id).length,
      })),
    });
  };

  const handleConfirmHost = async (cloneComponentsFromItemId: string | null) => {
    if (!hostPending) return;
    const { rackId, refId } = hostPending;
    setHostPending(null);
    notifySave?.("saving");
    try {
      await api.post(getInventoryUrl(rackId), {
        catalogEquipmentId: refId,
        ...(cloneComponentsFromItemId ? { cloneComponentsFromItemId } : {}),
      });
      await refreshRackBom(rackId);
      notifySave?.("saved");
    } catch (e) {
      notifySave?.("error");
      toast.error(getApiErrorMessage(e));
    }
  };

  /**
   * Ajout direct d'un composant dans un slot d'hôte (drop sur une ligne de
   * slot vide). Quantité fixe 1, aucun dialog. Les erreurs 400/409 (slot
   * occupé, span qui dépasse…) remontent via le message d'erreur du scope.
   */
  const handleDropInHostSlot = async (
    rackId: string,
    hostItemId: string,
    hostSlotIndex: number,
    catalogEquipmentId: string,
  ) => {
    notifySave?.("saving");
    try {
      await api.post(getInventoryUrl(rackId), {
        catalogEquipmentId,
        hostItemId,
        hostSlotIndex,
      });
      await refreshRackBom(rackId);
      notifySave?.("saved");
    } catch (e) {
      notifySave?.("error");
      toast.error(getApiErrorMessage(e));
    }
  };

  const handleDragCancel = () => {
    setActiveDrag(null);
    setHoveredRackId(null);
    setHoveredLocationId(null);
  };

  /**
   * Déplace un composant installé vers un autre slot de son châssis.
   * Les erreurs 400/409 (slot occupé, span hors limites) remontent en toast.
   */
  const handleMoveComponent = async (
    rackId: string,
    itemId: string,
    hostSlotIndex: number,
  ) => {
    notifySave?.("saving");
    try {
      await api.patch(`${getInventoryUrl(rackId)}/${itemId}`, { hostSlotIndex });
      await refreshRackBom(rackId);
      notifySave?.("saved");
    } catch (e) {
      notifySave?.("error");
      toast.error(getApiErrorMessage(e));
    }
  };

  const handleConfirmAdd = async (qty: number) => {
    if (!pending) return;
    const { rackId, data } = pending;
    setPending(null);
    const body =
      data.kind === "accessory"
        ? {
            accessoryType: data.accessoryType,
            accessoryHeightU: data.accessoryHeightU,
            accessoryVariant: data.accessoryVariant,
            accessoryDepthMm: data.accessoryDepthMm,
            quantity: qty,
          }
        : {
            equipmentId: data.kind === "equipment" ? data.refId : undefined,
            panelId: data.kind === "panel" ? data.refId : undefined,
            adapterId: data.kind === "adapter" ? data.refId : undefined,
            quantity: qty,
          };
    notifySave?.("saving");
    try {
      await api.post(getInventoryUrl(rackId), body);
      await refreshRackBom(rackId);
      notifySave?.("saved");
    } catch (e) {
      notifySave?.("error");
      toast.error(getApiErrorMessage(e));
    }
  };

  /**
   * Réorganise un rack à l'index cible. `targetIdx` s'exprime dans la liste
   * des CONTENANTS (racks virtuels exclus) — c'est ce que manipulent le canvas
   * et le panneau latéral. Update optimiste local + POST.
   * Désactivé en mode template (un seul rack — pas de réorganisation possible).
   */
  const reorderRacks = async (rackId: string, targetIdx: number) => {
    if (!projectId) return; // mode template : pas de réorganisation
    let nextOrder: InventaireRack[] = [];
    setRacks((prev) => {
      const containers = prev.filter((r) => !r.isVirtual);
      const virtual = prev.filter((r) => r.isVirtual);
      const srcIdx = containers.findIndex((r) => r.id === rackId);
      if (srcIdx === -1 || srcIdx === targetIdx) {
        nextOrder = [];
        return prev;
      }
      const next = [...containers];
      const [item] = next.splice(srcIdx, 1);
      next.splice(targetIdx, 0, item);
      nextOrder = [...next, ...virtual];
      return nextOrder;
    });
    if (nextOrder.length === 0) return;
    notifySave?.("saving");
    try {
      await api.post(`/api/tenant/projects/${projectId}/racks/reorder`, {
        rackIds: nextOrder.map((r) => r.id),
      });
      notifySave?.("saved");
    } catch (e) {
      notifySave?.("error");
      toast.error(getApiErrorMessage(e));
    }
  };

  // ── Emplacements (lieux) ─────────────────────────────────────────────────
  // Toutes les actions sont no-op en mode template (`projectId === null`).

  const createLocation = async (
    name: string,
  ): Promise<InventaireLocation | null> => {
    if (!projectId) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    notifySave?.("saving");
    try {
      const created = await api.post<InventaireLocation>(
        `/api/tenant/projects/${projectId}/locations`,
        { name: trimmed },
      );
      setLocations((prev) => [...prev, created]);
      setSelectedLocationId(created.id);
      notifySave?.("saved");
      return created;
    } catch (e) {
      notifySave?.("error");
      toast.error(getApiErrorMessage(e));
      return null;
    }
  };

  const updateLocation = async (
    locationId: string,
    data: { name?: string; cableCode?: string | null },
  ) => {
    if (!projectId) return;
    const previous = locations;
    setLocations((prev) =>
      prev.map((l) => (l.id === locationId ? { ...l, ...data } : l)),
    );
    notifySave?.("saving");
    try {
      await api.patch(
        `/api/tenant/projects/${projectId}/locations/${locationId}`,
        data,
      );
      notifySave?.("saved");
    } catch (e) {
      setLocations(previous);
      notifySave?.("error");
      toast.error(getApiErrorMessage(e));
    }
  };

  const deleteLocation = async (locationId: string): Promise<boolean> => {
    if (!projectId) return false;
    notifySave?.("saving");
    try {
      await api.delete(
        `/api/tenant/projects/${projectId}/locations/${locationId}`,
      );
      const removed = locations.find((l) => l.id === locationId) ?? null;
      setLocations((prev) => prev.filter((l) => l.id !== locationId));
      // Le rack virtuel est supprimé côté serveur avec le lieu.
      if (removed?.virtualRackId) {
        setRacks((prev) => prev.filter((r) => r.id !== removed.virtualRackId));
      }
      setSelectedLocationId((cur) => (cur === locationId ? null : cur));
      notifySave?.("saved");
      return true;
    } catch (e) {
      notifySave?.("error");
      toast.error(getApiErrorMessage(e));
      return false;
    }
  };

  const assignRackToLocation = async (rackId: string, locationId: string) => {
    if (!projectId) return;
    const previous = racks.find((r) => r.id === rackId)?.locationId ?? null;
    if (previous === locationId) return;
    setRacks((prev) =>
      prev.map((r) => (r.id === rackId ? { ...r, locationId } : r)),
    );
    notifySave?.("saving");
    try {
      await api.patch(`/api/tenant/projects/${projectId}/racks/${rackId}`, {
        locationId,
      });
      notifySave?.("saved");
    } catch (e) {
      setRacks((prev) =>
        prev.map((r) => (r.id === rackId ? { ...r, locationId: previous } : r)),
      );
      notifySave?.("error");
      toast.error(getApiErrorMessage(e));
    }
  };

  /**
   * Re-fetch le BOM d'un rack et met à jour le state racks. Utilisé après
   * tout changement (ajout drag&drop, suppression, etc.).
   */
  const refreshRackBom = async (rackId: string) => {
    try {
      const res = await api.get<{ items: BomItemDto[] }>(getInventoryUrl(rackId));
      const bom = res.items.map(toScopeBomItem);
      setRacks((prev) =>
        prev.map((r) => (r.id === rackId ? { ...r, bom } : r)),
      );
    } catch (e) {
      // Échec silencieux : le BOM sera re-fetché au prochain mount.
      console.warn("[inventaire] BOM refresh failed:", e);
    }
  };

  return (
    <InventaireScopeContext.Provider
      value={{
        projectId,
        getInventoryUrl,
        getCatalogUrl,
        racks,
        setRacks,
        locations,
        setLocations,
        selectedLocationId,
        setSelectedLocationId,
        createLocation,
        updateLocation,
        deleteLocation,
        assignRackToLocation,
        catalogFilters,
        setCatalogFilters,
        accessoryFilters,
        setAccessoryFilters,
        catalogOptions,
        setCatalogOptions,
        expandedRackId,
        setExpandedRackId,
        selectedItem,
        selectItem,
        selectRack,
        refreshRackBom,
        notifySave: (status) => notifySave?.(status),
        reorderRacks,
        hoveredRackId,
        hoveredLocationId,
        getDrift,
        refreshDrift,
      }}
    >
      <DndContext
        // id stable : sans lui, dnd-kit numérote son élément d'accessibilité
        // (`DndDescribedBy-N`) différemment entre SSR et client dès que des
        // draggables sont rendus côté serveur (cases de la réglette) →
        // hydration mismatch.
        id="inventaire-dnd"
        sensors={sensors}
        // `pointerWithin` : la détection de collision dnd-kit ne cible que le
        // droppable exactement sous le curseur — utilisé pour les lignes de
        // slot d'hôte (drop direct). La détection de la carte reste manuelle
        // (hit-test `data-rack-id`), donc les deux mécanismes ne se marchent
        // pas dessus : `over` ne vaut un slot que si le curseur est dessus.
        collisionDetection={pointerWithin}
        // Hit-test custom : @dnd-kit `onDragMove` (canal principal) + listener
        // `mousemove` document (canal secondaire) → robuste face aux quirks
        // de pointer capture / setPointerCapture. Utilise
        // `document.elementsFromPoint` (pluriel) pour ignorer un éventuel
        // overlay qui passerait au-dessus.
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            activeDrag.kind === "component-move" ||
            activeDrag.kind === "item-move" ? (
              <div className="border-border bg-card pointer-events-none inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold shadow-md">
                {activeDrag.name}
              </div>
            ) : (
              <CatalogDragPreview data={activeDrag} />
            )
          ) : null}
        </DragOverlay>
        <AddQuantityDialog
          pending={pending}
          rack={pending ? racks.find((r) => r.id === pending.rackId) ?? null : null}
          onCancel={() => setPending(null)}
          onConfirm={(qty) => void handleConfirmAdd(qty)}
        />
        <HostInstanceDialog
          pending={hostPending}
          onCancel={() => setHostPending(null)}
          onConfirm={(cloneId) => void handleConfirmHost(cloneId)}
        />
      </DndContext>
    </InventaireScopeContext.Provider>
  );
}

// ── AddQuantityDialog — sub-modal saisie quantité au drop ────────────────────

// Marge de sécurité câbles + rayon de courbure (mm) — défini en supervisor.
// TODO : lire depuis AppConfig/tenant settings. Valeur par défaut robuste.
const CABLE_SAFETY_MM = 80;

function CheckBadge({
  ok,
  icon,
  label,
  detail,
}: {
  ok: boolean;
  icon: string;
  label: string;
  detail: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-2",
        // arkyo-server: habillage Strata (succès / alerte : --success, --warning)
        ok
          ? "border-[var(--success)]/30 bg-[var(--success)]/10"
          : "border-[var(--warning)]/40 bg-[var(--warning)]/10",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          // arkyo-server: habillage Strata (pictogramme d'alerte en --card sur
          // --warning : >= 3:1 dans les deux thèmes, le blanc tombe à 2:1 en sombre)
          ok
            ? "bg-[var(--success)]/20 text-[var(--success-text)] text-base"
            : "bg-[var(--warning)] text-[var(--card)]",
        )}
        aria-hidden
      >
        {ok ? icon : <AlertTriangle className="h-5 w-5" strokeWidth={2.75} />}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[11px] font-bold uppercase tracking-wider leading-tight",
            // arkyo-server: habillage Strata
            ok
              ? "text-[var(--success-text)]"
              : "text-[var(--warning-text)]",
          )}
        >
          {label}
        </p>
        <p
          className={cn(
            "mt-0.5 text-[10px] leading-tight",
            // arkyo-server: habillage Strata (sans l'opacité 80 % d'arkyo, qui
            // ferait passer le texte sous 4,5:1 sur la teinte)
            ok
              ? "text-[var(--success-text)]"
              : "text-[var(--warning-text)]",
          )}
        >
          {detail}
        </p>
      </div>
    </div>
  );
}

function AddQuantityDialog({
  pending,
  rack,
  onCancel,
  onConfirm,
}: {
  pending: PendingDrop | null;
  rack: InventaireRack | null;
  onCancel: () => void;
  onConfirm: (quantity: number) => void | Promise<void>;
}) {
  const [qty, setQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const lastIdRef = useRef<string | null>(null);
  const pendingId = pending
    ? pending.data.kind === "accessory"
      ? `accessory::${pending.data.accessoryType}-${pending.data.accessoryHeightU}U${
          pending.data.accessoryVariant ? `-${pending.data.accessoryVariant}` : ""
        }`
      : `${pending.data.kind}::${pending.data.refId}`
    : null;
  if (pendingId && pendingId !== lastIdRef.current) {
    lastIdRef.current = pendingId;
    if (qty !== 1) setQty(1);
  }

  // ── Checks rackable ─────────────────────────────────────────────────────
  // Item peut être rackable (equipment.isRackable, panel ou accessory) → on
  // vérifie U dispo + profondeur compatible avec contenant + marge câbles.
  const itemIsRackable =
    pending?.data && "isRackable" in pending.data && pending.data.isRackable === true;
  const itemHeightU =
    pending?.data && "heightU" in pending.data && typeof pending.data.heightU === "number"
      ? pending.data.heightU
      : null;
  const itemDepthMm =
    pending?.data && "depthMm" in pending.data && typeof pending.data.depthMm === "number"
      ? pending.data.depthMm
      : null;

  let usedU = 0;
  if (rack) {
    for (const it of rack.bom) {
      // Les composants occupent des slots internes de leur châssis, pas des U.
      if (it.hostItemId == null && it.isRackable && typeof it.heightU === "number") {
        usedU += it.heightU * it.quantity;
      }
    }
  }
  const totalU = rack?.isRackable ? rack.totalU : null;
  const availableU = totalU !== null ? Math.max(0, totalU - usedU) : null;
  const requestedU = itemHeightU !== null ? itemHeightU * qty : 0;

  // Check 1 — U dispo (rack rackable + item rackable + heightU connu).
  // Un rack virtuel (équipements libres d'un lieu) n'a pas de contrainte
  // physique : aucun check.
  const heightCheckEnabled =
    rack?.isRackable === true &&
    rack?.isVirtual !== true &&
    itemIsRackable &&
    itemHeightU !== null;
  const heightOk =
    !heightCheckEnabled || (availableU !== null && requestedU <= availableU);

  // Check 2 — profondeur compatible (rack rackable + item profondeur connue).
  const maxItemDepthMm = rack ? rack.depthMm - CABLE_SAFETY_MM : null;
  const depthCheckEnabled =
    rack?.isRackable === true &&
    rack?.isVirtual !== true &&
    itemDepthMm !== null &&
    maxItemDepthMm !== null;
  const depthOk =
    !depthCheckEnabled || (maxItemDepthMm !== null && itemDepthMm! <= maxItemDepthMm);

  // Les checks sont informatifs (non bloquants) — l'utilisateur peut quand
  // même valider, le placement physique se fera plus tard dans le mode design.
  const submit = async () => {
    if (!pending || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(qty);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !submitting) onCancel();
      }}
    >
      <DialogContent className="max-w-md p-0">
        <div className="flex items-start gap-4 border-b border-[var(--border)] px-6 py-5 pr-14">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <Plus className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold leading-tight">
              Ajouter à l&apos;inventaire
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-sm text-[var(--muted-foreground)]">
              {rack ? (
                <>
                  {rack.isVirtual ? "Vers l'emplacement " : "Vers le contenant "}
                  <span className="font-semibold uppercase text-[var(--foreground)]">
                    {rack.name}
                  </span>
                </>
              ) : (
                "Combien d'unités ajouter au contenant ?"
              )}
            </DialogDescription>
          </div>
        </div>

        {pending && (
          <div className="space-y-4 px-6 py-5">
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 px-3 py-2.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: pending.data.dotHex }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold leading-tight">
                  {pending.data.name}
                </p>
                <p className="mt-0.5 truncate font-mono text-[10px] leading-tight text-[var(--muted-foreground)]">
                  {pending.data.metaSummary}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
                Quantité
              </p>
              <div className="grid grid-cols-10 gap-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                  const active = qty === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setQty(n)}
                      className={cn(
                        "flex h-8 items-center justify-center rounded-md border font-mono text-[11px] font-semibold tabular-nums transition-all active:scale-95",
                        active
                          ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/40 hover:text-[var(--foreground)]",
                      )}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-center gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)] disabled:opacity-40"
                  aria-label="Diminuer"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  className={cn(
                    "h-9 w-24 text-center font-mono text-base font-semibold tabular-nums",
                    // Masque les flèches natives haut/bas du input number.
                    "[-moz-appearance:textfield]",
                    "[&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none",
                    "[&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none",
                  )}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setQty((q) => q + 1)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40 hover:text-[var(--foreground)]"
                  aria-label="Augmenter"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Checks rackable : badges design pour U dispo + profondeur compatible */}
        {pending && (heightCheckEnabled || depthCheckEnabled) && (
          <div className="space-y-2 border-t border-[var(--border)] px-6 py-3">
            {heightCheckEnabled && (
              <CheckBadge
                ok={heightOk}
                icon="⇕"
                label={heightOk ? "Capacité OK" : "Capacité limite"}
                detail={
                  heightOk
                    ? `${requestedU}U / ${availableU}U disponible(s) sur ${totalU}U`
                    : `${requestedU}U demandé · ${availableU}U disponible(s) sur ${totalU}U`
                }
              />
            )}
            {depthCheckEnabled && (
              <CheckBadge
                ok={depthOk}
                icon="↔"
                label={depthOk ? "Profondeur OK" : "Profondeur limite"}
                detail={
                  depthOk
                    ? `${itemDepthMm}mm / ${maxItemDepthMm}mm dispo · marge câbles ${CABLE_SAFETY_MM}mm`
                    : `${itemDepthMm}mm > ${maxItemDepthMm}mm dispo (contenant ${rack?.depthMm}mm − ${CABLE_SAFETY_MM}mm)`
                }
              />
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 border-t border-[var(--border)] px-6 py-4">
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Annuler
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Ajout…
              </>
            ) : (
              "Ajouter"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── HostInstanceDialog — choix « nouvel exemplaire » d'un châssis hôte ───────

const EMPTY_CHOICE = "__empty__";

function HostInstanceDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: HostInstancePending | null;
  onCancel: () => void;
  onConfirm: (cloneComponentsFromItemId: string | null) => void | Promise<void>;
}) {
  const [choice, setChoice] = useState<string>(EMPTY_CHOICE);
  const [submitting, setSubmitting] = useState(false);

  // Réinitialise le choix sur « configuration vide » à chaque nouveau drop.
  const lastKeyRef = useRef<string | null>(null);
  const pendingKey = pending
    ? `${pending.rackId}::${pending.refId}::${pending.instances.length}`
    : null;
  if (pendingKey && pendingKey !== lastKeyRef.current) {
    lastKeyRef.current = pendingKey;
    if (choice !== EMPTY_CHOICE) setChoice(EMPTY_CHOICE);
  }

  const submit = async () => {
    if (!pending || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(choice === EMPTY_CHOICE ? null : choice);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !submitting) onCancel();
      }}
    >
      <DialogContent className="max-w-md p-0">
        <div className="flex items-start gap-4 border-b border-[var(--border)] px-6 py-5 pr-14">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <Plus className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold leading-tight">
              Nouvel exemplaire
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-sm text-[var(--muted-foreground)]">
              <span className="font-semibold text-[var(--foreground)]">
                {pending?.name}
              </span>{" "}
              est déjà présent dans ce contenant.
            </DialogDescription>
          </div>
        </div>

        {pending && (
          <div className="space-y-1.5 px-6 py-5">
            <HostChoiceCard
              active={choice === EMPTY_CHOICE}
              onClick={() => setChoice(EMPTY_CHOICE)}
              title="Configuration vide"
              subtitle="Aucun composant"
            />
            {pending.instances.map((inst) => (
              <HostChoiceCard
                key={inst.id}
                active={choice === inst.id}
                onClick={() => setChoice(inst.id)}
                badge={`#${inst.index}`}
                title={`Copier l'exemplaire #${inst.index}`}
                subtitle={
                  inst.componentCount === 0
                    ? "vide"
                    : `${inst.componentCount} composant${inst.componentCount > 1 ? "s" : ""}`
                }
              />
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 border-t border-[var(--border)] px-6 py-4">
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Annuler
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Ajout…
              </>
            ) : (
              "Ajouter"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HostChoiceCard({
  active,
  onClick,
  badge,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  badge?: string;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all",
        active
          ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
          : "border-[var(--border)] hover:border-[var(--accent)]/40 hover:bg-[var(--secondary)]/40",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          active ? "border-[var(--accent)]" : "border-[var(--border)]",
        )}
        aria-hidden
      >
        {active && <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />}
      </span>
      {badge && (
        <span className="inline-flex h-5 shrink-0 items-center rounded border border-[var(--border)] px-1.5 font-mono text-[10px] font-semibold tabular-nums text-[var(--muted-foreground)]">
          {badge}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium leading-tight">{title}</p>
        <p className="mt-0.5 truncate text-[10px] leading-tight text-[var(--muted-foreground)]">
          {subtitle}
        </p>
      </div>
    </button>
  );
}
