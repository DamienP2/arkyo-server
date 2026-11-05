"use client";

/**
 * CategoriesPanel — onglet « Classification » de `/admin/parametres` (tenant).
 *
 *   ┌─ Sub-nav (pill) ────────────────────────────────────────┐
 *   │  Catégories  |  Types                                    │
 *   └──────────────────────────────────────────────────────────┘
 *   ┌─ Sub-tab actif ─────────────────────────────────────────┐
 *   │  Toolbar inline + grille (liste unifiée)                 │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Chaque sous-liste est **unifiée** (items Arkyo + items du tenant) — pas de
 * fork-on-edit : les items Arkyo restent en lecture seule (badge monogramme,
 * aucune action) ; les items tenant gardent le CRUD complet. Toggle
 * « Catalogue Arkyo » dans chaque toolbar (`useShowArkyoParametres`, global
 * aux 5 panels paramètres).
 *
 * Sous-onglet actif persisté en localStorage (clé `tenant.parametres.
 * categories.subtab`). Valeur par défaut = `functions`.
 *
 * Note migration : si la valeur localStorage = `categories` est encore
 * présente chez certains users (ancien sub-tab), elle est ignorée et l'on
 * retombe sur la valeur par défaut `functions`.
 *
 * Données : un seul GET /api/tenant/parametres/categories qui retourne les
 * 4 sous-référentiels groupés (le champ `categories` reste exposé par
 * l'API mais n'est plus consommé ici). SSE : `tenant_parametres_categories`.
 *
 * Cards : les composants `<FunctionCard>` / `<PhaseCard>` / `<TypeCard>` sont
 * partagés avec le supervisor (cf. `components/catalogue/category-tree/`).
 * Seules les zones « actions » et « nameBadge » diffèrent selon la source
 * (tenant vs Arkyo).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Info,
  Layers,
  Plus,
  Search,
  Shapes,
  Tag,
  Trash2,
  X,
} from "@/components/ui/icons";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  FunctionCard,
  PhaseCard,
  TypeCard,
} from "@/components/catalogue/category-tree";

import { AdminListToolbar } from "../../_components/admin-list-toolbar";

// arkyo-server: badge de source Arkyo et bascule « Catalogue Arkyo » retirés
// (catalogue unique : l'API ne renvoie jamais d'items Arkyo).

import {
  useParametresSort,
  useShowArkyoParametres,
} from "./use-parametres-visibility";
import { useParametresSync } from "./use-parametres-sync";

import { FunctionFormDialog } from "./function-form-dialog";
import { PhaseFormDialog } from "./phase-form-dialog";
import { TypeFormDialog } from "./type-form-dialog";
import { LoadingState } from "@/components/ui/loading-state";

// ── Types publics ──────────────────────────────────────────────────────────

export type ArkyoCategoryItem = {
  id: string;
  name: string;
  color: string;
  iconId: string | null;
  parentId: string | null;
  children?: ArkyoCategoryItem[];
};

export type TenantCategoryItem = {
  id: string;
  name: string;
  color: string | null;
  iconId: string | null;
  parentId: string | null;
  sortOrder?: number;
  isActive?: boolean;
  children?: TenantCategoryItem[];
};

export type ArkyoFunctionItem = {
  id: string;
  key: string;
  label: string;
  color: string;
  cablePrefix: string | null;
  cableSuffix: string | null;
  sortOrder: number;
};

export type TenantFunctionItem = {
  id: string;
  key: string;
  label: string;
  color: string | null;
  sortOrder: number;
  isActive?: boolean;
};

export type ArkyoPhaseItem = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
};

export type TenantPhaseItem = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  isActive?: boolean;
};

export type ArkyoTypeItem = {
  id: string;
  name: string;
  functionId: string;
  parentId: string | null;
  iconId: string | null;
  sortOrder: number;
};

export type TenantTypeItem = {
  id: string;
  name: string;
  functionId: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive?: boolean;
};

type CategoriesPayload = {
  categories: { arkyo: ArkyoCategoryItem[]; personal: TenantCategoryItem[] };
  functions: { arkyo: ArkyoFunctionItem[]; personal: TenantFunctionItem[] };
  phases: { arkyo: ArkyoPhaseItem[]; personal: TenantPhaseItem[] };
  types: { arkyo: ArkyoTypeItem[]; personal: TenantTypeItem[] };
};

// ── Sub-tabs (Catégories / Types) ────────────────────────────────────────────
//
// La sous-section « Phases » est masquée (référentiel non consommé) :
// `PhasesSection` reste en code mais n'est plus montée.

type SubTab = "functions" | "types";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "functions", label: "Catégories" },
  { key: "types", label: "Types" },
];

const STORAGE_SUBTAB = "tenant.parametres.categories.subtab";

function isSubTab(v: unknown): v is SubTab {
  return v === "functions" || v === "types";
}

// ── Composant principal ────────────────────────────────────────────────────

export function CategoriesPanel() {
  // Toggle « Catalogue Arkyo » partagé entre les 3 sous-sections (et global
  // aux 5 panels paramètres).
  const [showArkyo, setShowArkyo] = useShowArkyoParametres();

  // Sub-tab actif persisté. Si la valeur stockée est l'ancien sub-tab
  // `categories` (ou toute autre valeur invalide), on retombe sur `functions`.
  const [subTab, setSubTabState] = useState<SubTab>(() => {
    if (typeof window === "undefined") return "functions";
    try {
      const raw = window.localStorage.getItem(STORAGE_SUBTAB);
      return isSubTab(raw) ? raw : "functions";
    } catch {
      return "functions";
    }
  });
  const setSubTab = useCallback((next: SubTab) => {
    setSubTabState(next);
    try {
      window.localStorage.setItem(STORAGE_SUBTAB, next);
    } catch {
      /* ignore */
    }
  }, []);

  // Data — un seul fetch groupé
  const [data, setData] = useState<CategoriesPayload>({
    categories: { arkyo: [], personal: [] },
    functions: { arkyo: [], personal: [] },
    phases: { arkyo: [], personal: [] },
    types: { arkyo: [], personal: [] },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.get<CategoriesPayload>(
        "/api/tenant/parametres/categories",
      );
      setData({
        categories: {
          arkyo: Array.isArray(payload?.categories?.arkyo)
            ? payload.categories.arkyo
            : [],
          personal: Array.isArray(payload?.categories?.personal)
            ? payload.categories.personal
            : [],
        },
        functions: {
          arkyo: Array.isArray(payload?.functions?.arkyo)
            ? payload.functions.arkyo
            : [],
          personal: Array.isArray(payload?.functions?.personal)
            ? payload.functions.personal
            : [],
        },
        phases: {
          arkyo: Array.isArray(payload?.phases?.arkyo) ? payload.phases.arkyo : [],
          personal: Array.isArray(payload?.phases?.personal)
            ? payload.phases.personal
            : [],
        },
        types: {
          arkyo: Array.isArray(payload?.types?.arkyo) ? payload.types.arkyo : [],
          personal: Array.isArray(payload?.types?.personal)
            ? payload.types.personal
            : [],
        },
      });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        // ignore — vue vide
      } else {
        setError(getApiErrorMessage(e, "Impossible de charger les catégories."));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadRef.current = fetchAll;
    void fetchAll();
  }, [fetchAll]);

  useParametresSync("tenant_parametres_categories", () => {
    void reloadRef.current();
  });

  if (loading) {
    return (
      <LoadingState className="px-8 pt-10" />
    );
  }
  if (error) {
    return (
      <div className="px-8 pt-10">
        <EmptyState icon={<Tag strokeWidth={1.5} />} title="Erreur" description={error} />
      </div>
    );
  }

  return (
    <div
      // Layout inline : on mime les paddings du AdminTabLayout (top 40px +
      // overhang topbar 40px = 80px ; sides 32px ; bottom 32px) pour rester
      // visuellement cohérent avec les autres panels.
      className="space-y-5 px-8 pb-8"
      style={{ paddingTop: "calc(2.5rem + 40px)" }}
    >
      {/* Sub-nav Catégories / Types / Phases */}
      <div /* arkyo-server: habillage Strata */ className="inline-flex items-center gap-0.5 self-start rounded-[9px] border border-[var(--border)] bg-[var(--surface)] p-[3px]">
        {SUB_TABS.map((t) => {
          const active = t.key === subTab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              className={cn(
                // arkyo-server: habillage Strata
                "rounded-[6px] px-2.5 py-[5px] text-xs font-medium whitespace-nowrap transition-all",
                active
                  // arkyo-server: habillage Strata
                  ? "bg-[var(--muted)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === "functions" && (
        <FunctionsSection
          showArkyo={showArkyo}
          setShowArkyo={setShowArkyo}
          arkyo={data.functions.arkyo}
          personal={data.functions.personal}
          onReload={() => void fetchAll()}
        />
      )}
      {subTab === "types" && (
        <TypesSection
          showArkyo={showArkyo}
          setShowArkyo={setShowArkyo}
          arkyoTypes={data.types.arkyo}
          personalTypes={data.types.personal}
          arkyoFunctions={data.functions.arkyo}
          personalFunctions={data.functions.personal}
          onReload={() => void fetchAll()}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Actions inline réutilisées par chaque section perso
//
//  Pattern aligné sur `equipment-list-panel.tsx` : suite de boutons icônes
//  visibles en hover (`opacity-0 group-hover:opacity-100`) accolés en haut à
//  droite de la card. Aucune dropdown — meilleure découvrabilité et plus
//  cohérent avec le supervisor (Trash inline).
// ─────────────────────────────────────────────────────────────────────────

function PersonalCardActions({
  onDuplicate,
  onDelete,
}: {
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
        title="Dupliquer"
        aria-label="Dupliquer"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Supprimer"
        aria-label="Supprimer"
        // arkyo-server: habillage Strata
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Section : FONCTIONS (sub-tab — flat cards)
// ─────────────────────────────────────────────────────────────────────────

const SECTION_FUNCTIONS = "categories.functions";

/** Entrée de la liste unifiée — la source pilote badge + actions. */
type FunctionEntry =
  | { kind: "tenant"; item: TenantFunctionItem }
  | { kind: "arkyo"; item: ArkyoFunctionItem };

function FunctionsSection({
  showArkyo,
  setShowArkyo,
  arkyo,
  personal,
  onReload,
}: {
  showArkyo: boolean;
  setShowArkyo: (next: boolean) => void;
  arkyo: ArkyoFunctionItem[];
  personal: TenantFunctionItem[];
  onReload: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [sort, setSort] = useParametresSort(SECTION_FUNCTIONS);
  const sortDir = sort.direction;
  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenantFunctionItem | null>(null);

  const visibleList = useMemo<FunctionEntry[]>(() => {
    const entries: FunctionEntry[] = personal.map((item) => ({
      kind: "tenant" as const,
      item,
    }));
    if (showArkyo) {
      entries.push(...arkyo.map((item) => ({ kind: "arkyo" as const, item })));
    }
    return entries;
  }, [personal, arkyo, showArkyo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = visibleList.filter(({ item: f }) => {
      if (!q) return true;
      return (
        f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => {
      const aSort = a.item.sortOrder ?? 0;
      const bSort = b.item.sortOrder ?? 0;
      const cmp =
        aSort !== bSort
          ? aSort - bSort
          : a.item.label.localeCompare(b.item.label, "fr");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [visibleList, search, sortDir]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (item: TenantFunctionItem) => {
    setEditing(item);
    setFormOpen(true);
  };

  const handleDuplicate = async (item: TenantFunctionItem) => {
    try {
      await api.post("/api/tenant/parametres/categories/function", {
        label: `${item.label} (copie)`,
        key: `${item.key}_COPIE`,
        color: item.color,
      });
      toast.success("Catégorie dupliquée.");
      onReload();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la duplication."));
    }
  };

  const handleDeleteFromCard = async (item: TenantFunctionItem) => {
    const ok = await confirm({
      title: "Supprimer cette catégorie ?",
      description: (
        <>
          <strong>{item.label}</strong> sera supprimée définitivement. La
          suppression est bloquée si la catégorie est utilisée par d&apos;autres
          items personnels.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/categories/function/${item.id}`);
      toast.success("Catégorie supprimée.");
      onReload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(
          body?.error ?? "Cette catégorie est référencée par d'autres items.",
        );
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  const handleSorted = () =>
    setSort({
      sortBy: sort.sortBy,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });

  const isListEmpty = visibleList.length === 0;
  const hasHiddenArkyo = !showArkyo && arkyo.length > 0;

  const renderListEmpty = () => {
    if (hasHiddenArkyo) {
      return (
        <EmptyState
          icon={<Tag strokeWidth={1.5} />}
          title="Aucune catégorie personnelle"
          description="Créez votre première catégorie ou réactivez le catalogue Arkyo."
          action={
            <EmptyStateAction onClick={() => setShowArkyo(true)}>
              Afficher le catalogue Arkyo
            </EmptyStateAction>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={<Tag strokeWidth={1.5} />}
        title="Aucune catégorie"
        // arkyo-server: mention du référentiel Arkyo publié retirée (catalogue unique)
        description="Créez vos catégories métier (Vidéo, Audio, Réseau…)."
        action={
          <EmptyStateAction onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            Ajouter une catégorie
          </EmptyStateAction>
        }
      />
    );
  };

  return (
    <>
      <div className="space-y-5">
        <AdminListToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Libellé, clé…"
          count={filtered.length}
          total={filtered.length !== visibleList.length ? visibleList.length : undefined}
          onSort={handleSorted}
          sortDir={sortDir}
          // arkyo-server: bascule « Catalogue Arkyo » retirée (catalogue unique)
        />

        {!isListEmpty ? (
          <button
            onClick={openCreate}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
            style={{ minHeight: "72px" }}
          >
            <Plus className="h-5 w-5" />
            <span className="text-xs font-medium">Nouvelle catégorie</span>
          </button>
        ) : null}

        {isListEmpty ? (
          renderListEmpty()
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucune catégorie correspondante"
            description="Essayez d'élargir votre recherche."
            className="py-16"
          />
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
          >
            {filtered.map((entry) =>
              entry.kind === "tenant" ? (
                <FunctionCard
                  key={entry.item.id}
                  item={entry.item}
                  onClick={() => openEdit(entry.item)}
                  actions={
                    <PersonalCardActions
                      onDuplicate={() => void handleDuplicate(entry.item)}
                      onDelete={() => void handleDeleteFromCard(entry.item)}
                    />
                  }
                />
              ) : (
                <FunctionCard
                  key={entry.item.id}
                  item={entry.item}
                  // arkyo-server: badge monogramme Arkyo retiré (catalogue unique)
                />
              ),
            )}
          </div>
        )}
      </div>

      <FunctionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        // arkyo-server: catalogue unique — liste Arkyo vide (contrôle de doublon Arkyo muet)
        arkyoFunctions={[]}
        onSaved={() => {
          setFormOpen(false);
          onReload();
        }}
        onDeleted={() => onReload()}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Section : PHASES (sub-tab — flat cards)
// ─────────────────────────────────────────────────────────────────────────

const SECTION_PHASES = "categories.phases";

/** Entrée de la liste unifiée — la source pilote badge + actions. */
type PhaseEntry =
  | { kind: "tenant"; item: TenantPhaseItem }
  | { kind: "arkyo"; item: ArkyoPhaseItem };

function PhasesSection({
  showArkyo,
  setShowArkyo,
  arkyo,
  personal,
  onReload,
}: {
  showArkyo: boolean;
  setShowArkyo: (next: boolean) => void;
  arkyo: ArkyoPhaseItem[];
  personal: TenantPhaseItem[];
  onReload: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [sort, setSort] = useParametresSort(SECTION_PHASES);
  const sortDir = sort.direction;
  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenantPhaseItem | null>(null);

  const visibleList = useMemo<PhaseEntry[]>(() => {
    const entries: PhaseEntry[] = personal.map((item) => ({
      kind: "tenant" as const,
      item,
    }));
    if (showArkyo) {
      entries.push(...arkyo.map((item) => ({ kind: "arkyo" as const, item })));
    }
    return entries;
  }, [personal, arkyo, showArkyo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = visibleList.filter(({ item: p }) => {
      if (!q) return true;
      return (
        p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => {
      const aSort = a.item.sortOrder ?? 0;
      const bSort = b.item.sortOrder ?? 0;
      const cmp =
        aSort !== bSort
          ? aSort - bSort
          : a.item.label.localeCompare(b.item.label, "fr");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [visibleList, search, sortDir]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (item: TenantPhaseItem) => {
    setEditing(item);
    setFormOpen(true);
  };

  const handleDuplicate = async (item: TenantPhaseItem) => {
    try {
      await api.post("/api/tenant/parametres/categories/phase", {
        label: `${item.label} (copie)`,
        key: `${item.key}_COPIE`,
      });
      toast.success("Phase dupliquée.");
      onReload();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la duplication."));
    }
  };

  const handleDeleteFromCard = async (item: TenantPhaseItem) => {
    const ok = await confirm({
      title: "Supprimer cette phase ?",
      description: (
        <>
          <strong>{item.label}</strong> sera supprimée définitivement. La
          suppression est bloquée si la phase est utilisée par d&apos;autres
          items personnels.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/categories/phase/${item.id}`);
      toast.success("Phase supprimée.");
      onReload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(
          body?.error ?? "Cette phase est référencée par d'autres items.",
        );
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  const handleSorted = () =>
    setSort({
      sortBy: sort.sortBy,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });

  const isListEmpty = visibleList.length === 0;
  const hasHiddenArkyo = !showArkyo && arkyo.length > 0;

  const renderListEmpty = () => {
    if (hasHiddenArkyo) {
      return (
        <EmptyState
          icon={<Layers strokeWidth={1.5} />}
          title="Aucune phase personnelle"
          description="Créez votre première phase ou réactivez le catalogue Arkyo."
          action={
            <EmptyStateAction onClick={() => setShowArkyo(true)}>
              Afficher le catalogue Arkyo
            </EmptyStateAction>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={<Layers strokeWidth={1.5} />}
        title="Aucune phase"
        description="Créez les phases de votre chaîne de production (acquisition, production, distribution…)."
        action={
          <EmptyStateAction onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            Ajouter une phase
          </EmptyStateAction>
        }
      />
    );
  };

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-start gap-2 rounded-lg border border-[var(--border)]/40 bg-[var(--secondary)]/30 px-3 py-2">
          <Info className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            Une <strong className="font-semibold text-[var(--foreground)]">phase</strong>{" "}
            désigne une étape du workflow broadcast (acquisition, production,
            contribution, distribution). Elle permet de classer un équipement
            selon son rôle dans la chaîne du signal.
          </p>
        </div>
        <AdminListToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Libellé, clé…"
          count={filtered.length}
          total={
            filtered.length !== visibleList.length ? visibleList.length : undefined
          }
          onSort={handleSorted}
          sortDir={sortDir}
          // arkyo-server: bascule « Catalogue Arkyo » retirée (catalogue unique)
        />

        {!isListEmpty ? (
          <button
            onClick={openCreate}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
            style={{ minHeight: "72px" }}
          >
            <Plus className="h-5 w-5" />
            <span className="text-xs font-medium">Nouvelle phase</span>
          </button>
        ) : null}

        {isListEmpty ? (
          renderListEmpty()
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucune phase correspondante"
            description="Essayez d'élargir votre recherche."
            className="py-16"
          />
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
          >
            {filtered.map((entry) =>
              entry.kind === "tenant" ? (
                <PhaseCard
                  key={entry.item.id}
                  item={entry.item}
                  onClick={() => openEdit(entry.item)}
                  actions={
                    <PersonalCardActions
                      onDuplicate={() => void handleDuplicate(entry.item)}
                      onDelete={() => void handleDeleteFromCard(entry.item)}
                    />
                  }
                />
              ) : (
                <PhaseCard
                  key={entry.item.id}
                  item={entry.item}
                  // arkyo-server: badge monogramme Arkyo retiré (catalogue unique)
                />
              ),
            )}
          </div>
        )}
      </div>

      <PhaseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        // arkyo-server: catalogue unique — liste Arkyo vide (contrôle de doublon Arkyo muet)
        arkyoPhases={[]}
        onSaved={() => {
          setFormOpen(false);
          onReload();
        }}
        onDeleted={() => onReload()}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Section : TYPES (sub-tab — groupés par fonction)
// ─────────────────────────────────────────────────────────────────────────

const SECTION_TYPES = "categories.types";

/** Entrée de la liste unifiée — la source pilote badge + actions. */
type TypeEntry =
  | { kind: "tenant"; item: TenantTypeItem }
  | { kind: "arkyo"; item: ArkyoTypeItem };

function TypesSection({
  showArkyo,
  setShowArkyo,
  arkyoTypes,
  personalTypes,
  arkyoFunctions,
  personalFunctions,
  onReload,
}: {
  showArkyo: boolean;
  setShowArkyo: (next: boolean) => void;
  arkyoTypes: ArkyoTypeItem[];
  personalTypes: TenantTypeItem[];
  arkyoFunctions: ArkyoFunctionItem[];
  personalFunctions: TenantFunctionItem[];
  onReload: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [sort, setSort] = useParametresSort(SECTION_TYPES);
  const sortDir = sort.direction;
  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenantTypeItem | null>(null);

  // Pour les types perso, on doit pouvoir résoudre functionId vers Arkyo OU
  // Perso. On fusionne les 2 dans une lookup map.
  const functionsLookup = useMemo(() => {
    const map = new Map<string, { label: string; color: string }>();
    for (const f of arkyoFunctions) {
      map.set(f.id, { label: f.label, color: f.color });
    }
    for (const f of personalFunctions) {
      map.set(f.id, { label: f.label, color: f.color ?? "#6b7280" });
    }
    return map;
  }, [arkyoFunctions, personalFunctions]);

  const visibleList = useMemo<TypeEntry[]>(() => {
    const entries: TypeEntry[] = personalTypes.map((item) => ({
      kind: "tenant" as const,
      item,
    }));
    if (showArkyo) {
      entries.push(
        ...arkyoTypes.map((item) => ({ kind: "arkyo" as const, item })),
      );
    }
    return entries;
  }, [personalTypes, arkyoTypes, showArkyo]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = visibleList.filter(({ item: t }) => {
      if (!q) return true;
      const fn = t.functionId ? functionsLookup.get(t.functionId) : null;
      return (
        t.name.toLowerCase().includes(q) ||
        (fn?.label ?? "").toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => {
      const aSort = a.item.sortOrder ?? 0;
      const bSort = b.item.sortOrder ?? 0;
      const cmp =
        aSort !== bSort
          ? aSort - bSort
          : a.item.name.localeCompare(b.item.name, "fr");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [visibleList, search, sortDir, functionsLookup]);

  // Regroupement 2 niveaux par fonction (aligné sur types-panel.tsx du
  // supervisor). Chaque racine (parentId == null) porte ses sous-types en
  // puces ; le regroupement des enfants est indépendant du kind — une racine
  // peut cumuler des sous-types Arkyo et perso. La recherche conserve une
  // racine si son nom, sa catégorie, ou l'un de ses sous-types correspond.
  const { groups: rootsByFunction, childrenByParent } = useMemo(() => {
    const visibleIds = new Set(visibleList.map((e) => e.item.id));
    const childrenByParent = new Map<string, TypeEntry[]>();
    const roots: TypeEntry[] = [];
    for (const entry of visibleList) {
      const parentId = entry.item.parentId;
      // Enfant uniquement si son parent est visible ; sinon on le promeut en
      // racine (ex. sous-type perso rattaché à une racine Arkyo masquée).
      if (parentId != null && visibleIds.has(parentId)) {
        const arr = childrenByParent.get(parentId) ?? [];
        arr.push(entry);
        childrenByParent.set(parentId, arr);
      } else {
        roots.push(entry);
      }
    }

    const cmp = (a: TypeEntry, b: TypeEntry) => {
      const aSort = a.item.sortOrder ?? 0;
      const bSort = b.item.sortOrder ?? 0;
      const c =
        aSort !== bSort
          ? aSort - bSort
          : a.item.name.localeCompare(b.item.name, "fr");
      return sortDir === "desc" ? -c : c;
    };
    for (const arr of childrenByParent.values()) arr.sort(cmp);
    roots.sort(cmp);

    const q = search.trim().toLowerCase();
    const groups: Record<string, TypeEntry[]> = {};
    for (const root of roots) {
      if (q) {
        const fn = root.item.functionId
          ? functionsLookup.get(root.item.functionId)
          : null;
        const fnMatch = (fn?.label ?? "").toLowerCase().includes(q);
        const nameMatch = root.item.name.toLowerCase().includes(q);
        const childMatch = (childrenByParent.get(root.item.id) ?? []).some((c) =>
          c.item.name.toLowerCase().includes(q),
        );
        if (!fnMatch && !nameMatch && !childMatch) continue;
      }
      const key = root.item.functionId ?? "_unassigned";
      if (!groups[key]) groups[key] = [];
      groups[key].push(root);
    }
    return { groups, childrenByParent };
  }, [visibleList, search, sortDir, functionsLookup]);

  // Ordre des groupes : fonctions Arkyo puis perso puis "Sans catégorie".
  const orderedFunctionKeys = useMemo(() => {
    const keys: string[] = [];
    for (const f of arkyoFunctions) {
      if (rootsByFunction[f.id]?.length) keys.push(f.id);
    }
    for (const f of personalFunctions) {
      if (rootsByFunction[f.id]?.length) keys.push(f.id);
    }
    if (rootsByFunction._unassigned?.length) keys.push("_unassigned");
    return keys;
  }, [arkyoFunctions, personalFunctions, rootsByFunction]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (item: TenantTypeItem) => {
    setEditing(item);
    setFormOpen(true);
  };

  const handleDuplicate = async (item: TenantTypeItem) => {
    try {
      await api.post("/api/tenant/parametres/categories/type", {
        name: `${item.name} (copie)`,
        functionId: item.functionId,
      });
      toast.success("Type dupliqué.");
      onReload();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la duplication."));
    }
  };

  const handleDeleteFromCard = async (item: TenantTypeItem) => {
    const ok = await confirm({
      title: "Supprimer ce type ?",
      description: (
        <>
          <strong>{item.name}</strong> sera supprimé définitivement. La
          suppression est bloquée si le type est utilisé par des équipements
          personnels.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/categories/type/${item.id}`);
      toast.success("Type supprimé.");
      onReload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(
          body?.error ?? "Ce type est référencé par d'autres items.",
        );
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  const handleSorted = () =>
    setSort({
      sortBy: sort.sortBy,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });

  // Puces de sous-types rendues sous l'en-tête d'une racine (footer TypeCard).
  // Conscient du kind : un sous-type perso est cliquable (édition) + supprimable
  // au survol ; un sous-type Arkyo est en lecture seule (point + nom, sans
  // action, légèrement atténué — le tenant ne modifie pas l'Arkyo).
  const renderSubChips = (subs: TypeEntry[], color: string) => (
    <div className="flex flex-wrap items-center gap-1">
      {subs.map((sub) =>
        sub.kind === "tenant" ? (
          <div
            key={sub.item.id}
            onClick={(e) => {
              e.stopPropagation();
              openEdit(sub.item);
            }}
            title={sub.item.name}
            className="group/sub inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border)]/60 py-0.5 pr-1 pl-2 text-[11px] text-[var(--muted-foreground)] transition-colors hover:border-[var(--border)] hover:text-[var(--foreground)]"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="truncate">{sub.item.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleDeleteFromCard(sub.item);
              }}
              title="Supprimer"
              aria-label="Supprimer"
              // arkyo-server: habillage Strata
              className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] opacity-0 transition-opacity group-hover/sub:opacity-100 hover:text-[var(--danger-text)]"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div
            key={sub.item.id}
            title={sub.item.name}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--border)]/60 px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="truncate">{sub.item.name}</span>
            {/* Sous-type Arkyo → monogramme vérifié (comme les types racine).
                Un sous-type perso n'affiche aucun badge. */}
            {/* arkyo-server: monogramme Arkyo retiré (catalogue unique) */}
          </div>
        ),
      )}
    </div>
  );

  const isListEmpty = visibleList.length === 0;
  const hasHiddenArkyo = !showArkyo && arkyoTypes.length > 0;
  const hasAnyFunction =
    arkyoFunctions.length > 0 || personalFunctions.length > 0;

  const renderListEmpty = () => {
    if (hasHiddenArkyo) {
      return (
        <EmptyState
          icon={<Shapes strokeWidth={1.5} />}
          title="Aucun type personnel"
          description="Créez votre premier type ou réactivez le catalogue Arkyo."
          action={
            <EmptyStateAction onClick={() => setShowArkyo(true)}>
              Afficher le catalogue Arkyo
            </EmptyStateAction>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={<Shapes strokeWidth={1.5} />}
        title="Aucun type"
        description={
          hasAnyFunction
            ? "Créez vos types d'équipement rattachés à une catégorie (Caméra, Mixeur audio…)."
            : "Créez d'abord au moins une catégorie dans l'onglet Catégories."
        }
        action={
          hasAnyFunction ? (
            <EmptyStateAction onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              Ajouter un type
            </EmptyStateAction>
          ) : undefined
        }
      />
    );
  };

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-start gap-2 rounded-lg border border-[var(--border)]/40 bg-[var(--secondary)]/30 px-3 py-2">
          <Info className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            Un <strong className="font-semibold text-[var(--foreground)]">type</strong>{" "}
            est une sous-classification d&apos;une catégorie. Par exemple, la
            catégorie «&nbsp;Caméra&nbsp;» regroupe les types ENG, Studio,
            Cinéma.
          </p>
        </div>
        <AdminListToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Nom, catégorie…"
          count={filtered.length}
          total={
            filtered.length !== visibleList.length ? visibleList.length : undefined
          }
          onSort={handleSorted}
          sortDir={sortDir}
          // arkyo-server: bascule « Catalogue Arkyo » retirée (catalogue unique)
        />

        {hasAnyFunction && !isListEmpty ? (
          <button
            onClick={openCreate}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
            style={{ minHeight: "72px" }}
          >
            <Plus className="h-5 w-5" />
            <span className="text-xs font-medium">Nouveau type</span>
          </button>
        ) : null}

        {isListEmpty ? (
          renderListEmpty()
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucun type correspondant"
            description="Essayez d'élargir votre recherche."
            className="py-16"
          />
        ) : (
          <div className="space-y-7">
            {orderedFunctionKeys.map((fnKey) => {
              const roots = rootsByFunction[fnKey] ?? [];
              if (roots.length === 0) return null;
              const fn = fnKey === "_unassigned" ? null : functionsLookup.get(fnKey);
              const headerColor = fn?.color ?? "#a3a3a3";
              const headerLabel = fn?.label ?? "Sans catégorie";
              const count = roots.reduce(
                (n, r) => n + 1 + (childrenByParent.get(r.item.id)?.length ?? 0),
                0,
              );
              return (
                <div key={fnKey}>
                  <div className="mb-3 flex items-center gap-2.5">
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: headerColor }}
                    />
                    <h3
                      className="text-xs font-bold tracking-widest uppercase"
                      style={{ color: headerColor }}
                    >
                      {headerLabel}
                    </h3>
                    <div
                      className="h-px flex-1"
                      style={{ backgroundColor: `${headerColor}30` }}
                    />
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {count}
                    </span>
                  </div>
                  <div
                    className="grid gap-3"
                    style={{
                      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    }}
                  >
                    {roots.map((entry) => {
                      const subs = childrenByParent.get(entry.item.id) ?? [];
                      const footer =
                        subs.length > 0
                          ? renderSubChips(subs, headerColor)
                          : undefined;
                      return entry.kind === "tenant" ? (
                        <TypeCard
                          key={entry.item.id}
                          item={entry.item}
                          color={headerColor}
                          onClick={() => openEdit(entry.item)}
                          actions={
                            <PersonalCardActions
                              onDuplicate={() =>
                                void handleDuplicate(entry.item)
                              }
                              onDelete={() =>
                                void handleDeleteFromCard(entry.item)
                              }
                            />
                          }
                          footer={footer}
                        />
                      ) : (
                        <TypeCard
                          key={entry.item.id}
                          item={entry.item}
                          color={headerColor}
                          // arkyo-server: badge monogramme Arkyo retiré (catalogue unique)
                          footer={footer}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <TypeFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        // arkyo-server: catalogue unique — liste Arkyo vide (contrôle de doublon Arkyo muet)
        arkyoFunctions={[]}
        personalFunctions={personalFunctions}
        // arkyo-server: catalogue unique — liste Arkyo vide (contrôle de doublon Arkyo muet)
        arkyoTypes={[]}
        personalTypes={personalTypes}
        onSaved={() => {
          setFormOpen(false);
          onReload();
        }}
        onDeleted={() => onReload()}
      />
    </>
  );
}
