"use client";

/**
 * DimensionsPanel — onglet « Dimensions » de `/admin/parametres` (tenant).
 *
 * Modèle tenant-only : les dimensions sont copiées d'Arkyo au provisioning,
 * puis le tenant en est totalement propriétaire (CRUD libre). Pas de toggle
 * Mes/Arkyo, pas de proposition, pas de badge source.
 *
 * Sub-tabs par catégorie (RACK_U / RACK_WIDTH / …) — barre de pills à plat.
 * Pas de barre de recherche / tri / vue (liste simple, tri implicite par
 * valeur croissante). Empty state contextuel par catégorie. Cards avec
 * action Supprimer inline en hover (pattern brands/signals/cabling).
 *
 * Données :
 *   GET /api/tenant/parametres/dimensions → TenantDimensionPreset[]
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RotateCcw, Ruler, Trash2 } from "@/components/ui/icons";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatDimensionLabel } from "@/lib/services/dimensions";

import { AdminTabLayout } from "../../_components/admin-tab-layout";

import { DimensionFormDialog } from "./dimension-form-dialog";
import { useParametresSync } from "./use-parametres-sync";
import { LoadingState } from "@/components/ui/loading-state";

// ── Types ──────────────────────────────────────────────────────────────────

type Category =
  | "RACK_U"
  | "RACK_WIDTH"
  | "RACK_DEPTH"
  | "CABLE_SAFETY_DEPTH"
  | "CABLE_LENGTH"
  | "BEND_RADIUS";

type Unit = "U" | "INCH" | "MM" | "M" | "DEG";

export type TenantDimensionItem = {
  id: string;
  category: string;
  value: number;
  unit: string;
  isReel: boolean;
  isActive?: boolean;
};

const STORAGE_CAT = "tenant-dimensions-category";

const CATEGORIES: {
  key: Category;
  label: string;
  description: string;
  defaultUnit: Unit;
  emptyTitle: string;
  addLabel: string;
}[] = [
  {
    key: "RACK_U",
    label: "Hauteurs U",
    description: "Hauteurs standards des racks (1U → 47U).",
    defaultUnit: "U",
    emptyTitle: "Aucune hauteur U définie",
    addLabel: "Ajouter une hauteur U",
  },
  {
    key: "RACK_WIDTH",
    label: "Largeurs rack",
    description: "Standards 10″ / 19″ / 21″ / 23″.",
    defaultUnit: "INCH",
    emptyTitle: "Aucune largeur rack définie",
    addLabel: "Ajouter une largeur",
  },
  {
    key: "RACK_DEPTH",
    label: "Profondeurs rack",
    description: "Profondeur des racks en millimètres.",
    defaultUnit: "MM",
    emptyTitle: "Aucune profondeur rack définie",
    addLabel: "Ajouter une profondeur",
  },
  {
    key: "CABLE_SAFETY_DEPTH",
    label: "Sécurité câblage",
    description: "Profondeur de sécurité câblage en baie (mm).",
    defaultUnit: "MM",
    emptyTitle: "Aucune sécurité câblage définie",
    addLabel: "Ajouter une sécurité",
  },
  {
    key: "CABLE_LENGTH",
    label: "Longueurs câbles",
    description: "Longueurs presta standards (mètres).",
    defaultUnit: "M",
    emptyTitle: "Aucune longueur de câble définie",
    addLabel: "Ajouter une longueur",
  },
  {
    key: "BEND_RADIUS",
    label: "Rayons de courbure",
    description: "Rayons de courbure recommandés (mm).",
    defaultUnit: "MM",
    emptyTitle: "Aucun rayon de courbure défini",
    addLabel: "Ajouter un rayon",
  },
];

// ── Composant ──────────────────────────────────────────────────────────────

export function DimensionsPanel() {
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState<TenantDimensionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  const [category, setCategoryRaw] = useState<Category>(() => {
    if (typeof window === "undefined") return "RACK_U";
    const stored = window.localStorage.getItem(STORAGE_CAT) as Category | null;
    return stored && CATEGORIES.some((c) => c.key === stored) ? stored : "RACK_U";
  });
  const setCategory = (c: Category) => {
    setCategoryRaw(c);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_CAT, c);
  };

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenantDimensionItem | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<TenantDimensionItem[]>(
        "/api/tenant/parametres/dimensions",
      );
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setItems([]);
      } else {
        setError(
          getApiErrorMessage(e, "Impossible de charger les dimensions."),
        );
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadRef.current = fetchAll;
    void fetchAll();
  }, [fetchAll]);

  useParametresSync("tenant_parametres_dimensions", () => {
    void reloadRef.current();
  });

  // Liste de la catégorie courante triée par valeur croissante.
  const inCategory = useMemo(() => {
    const list = items.filter((d) => d.category === category);
    list.sort((a, b) => a.value - b.value);
    return list;
  }, [items, category]);

  const currentCategory = CATEGORIES.find((c) => c.key === category)!;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (item: TenantDimensionItem) => {
    setEditing(item);
    setFormOpen(true);
  };

  const handleRestoreArkyo = async () => {
    const ok = await confirm({
      title: "Restaurer les valeurs Arkyo manquantes ?",
      description: (
        <>
          Les valeurs Arkyo supprimées (toutes catégories confondues) seront
          ré-ajoutées. Les valeurs déjà présentes — modifiées ou non — ne sont
          pas touchées.
        </>
      ),
      confirmLabel: "Restaurer",
    });
    if (!ok) return;
    try {
      const res = await api.post<{ restored: number }>(
        "/api/tenant/parametres/dimensions/restore-arkyo",
        {},
      );
      if (res.restored === 0) {
        toast.info("Toutes les valeurs Arkyo sont déjà présentes.");
      } else {
        toast.success(
          `${res.restored} valeur${res.restored > 1 ? "s" : ""} restaurée${res.restored > 1 ? "s" : ""}.`,
        );
        void fetchAll();
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la restauration."));
    }
  };

  const handleDeleteFromCard = async (item: TenantDimensionItem) => {
    const label = formatDimensionLabel(item.value, item.unit);
    const reelSuffix = item.isReel ? " (touret)" : "";
    const ok = await confirm({
      title: `Supprimer « ${label}${reelSuffix} » ?`,
      description: <>Action irréversible.</>,
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/dimensions/${item.id}`);
      setItems((prev) => prev.filter((d) => d.id !== item.id));
      toast.success("Dimension supprimée.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | null;
        toast.error(body?.error ?? "Suppression bloquée.");
      } else {
        toast.error(getApiErrorMessage(e, "Échec de la suppression."));
      }
    }
  };

  // ── Cards ──────────────────────────────────────────────────────────────

  const renderCard = (d: TenantDimensionItem) => {
    const label = formatDimensionLabel(d.value, d.unit);

    return (
      <Card
        key={d.id}
        onClick={() => openEdit(d)}
        className="group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--secondary)]"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary)]">
          <Ruler className="h-4 w-4 text-[var(--muted-foreground)]" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <p className="truncate text-sm leading-tight font-semibold">{label}</p>
          {d.isReel && <TouretBadge />}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleDeleteFromCard(d);
          }}
          title="Supprimer"
          aria-label="Supprimer"
          // arkyo-server: habillage Strata
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </Card>
    );
  };

  // ── Empty contextuel par catégorie ─────────────────────────────────────
  const renderCategoryEmpty = () => (
    <EmptyState
      icon={<Ruler strokeWidth={1.5} />}
      title={currentCategory.emptyTitle}
      description={currentCategory.description}
      action={
        <EmptyStateAction onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          {currentCategory.addLabel}
        </EmptyStateAction>
      }
    />
  );

  if (loading) {
    return (
      <LoadingState className="px-8 pt-10" />
    );
  }
  if (error) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<Ruler strokeWidth={1.5} />}
          title="Erreur"
          description={error}
        />
      </div>
    );
  }

  const isCategoryEmpty = inCategory.length === 0;

  return (
    <>
      <AdminTabLayout
        toolbar={
          <div className="flex items-start justify-between gap-3">
            <DimensionsSubNav category={category} setCategory={setCategory} />
            <button
              type="button"
              onClick={() => void handleRestoreArkyo()}
              title="Restaurer les valeurs Arkyo supprimées"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurer Arkyo
            </button>
          </div>
        }
        addButton={
          !isCategoryEmpty ? (
            <button
              onClick={openCreate}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] p-5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
              style={{ minHeight: "72px" }}
            >
              <Plus className="h-5 w-5" />
              <span className="text-xs font-medium">{currentCategory.addLabel}</span>
            </button>
          ) : undefined
        }
      >
        {isCategoryEmpty ? (
          renderCategoryEmpty()
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
          >
            {inCategory.map((d) => renderCard(d))}
          </div>
        )}
      </AdminTabLayout>

      <DimensionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        defaultCategory={category}
        defaultUnit={currentCategory.defaultUnit}
        onSaved={() => {
          setFormOpen(false);
          void fetchAll();
        }}
      />
    </>
  );
}

// ── Badge "Touret" rendu à droite du label pour CABLE_LENGTH isReel=true ───

function TouretBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-400"
      title="Longueur vendue en touret"
    >
      Touret
    </span>
  );
}

// ── Sub-nav : pills par catégorie (à plat, plus de toggle source) ────────

function DimensionsSubNav({
  category,
  setCategory,
}: {
  category: Category;
  setCategory: (c: Category) => void;
}) {
  return (
    <div /* arkyo-server: habillage Strata */ className="inline-flex flex-wrap items-center gap-0.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface)] p-[3px]">
      {CATEGORIES.map((c) => {
        const active = c.key === category;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            className={cn(
              // arkyo-server: habillage Strata
              "rounded-[6px] px-2.5 py-[5px] text-xs font-medium whitespace-nowrap transition-all",
              active
                // arkyo-server: habillage Strata
                ? "bg-[var(--muted)] text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
