"use client";

/**
 * ExportPdfSection — sub-tab "Export PDF" de /admin/parametres > Impression.
 *
 * Remplace l'ancien `SettingsSection` (singleton Arkyo lecture seule). Liste
 * CRUD des `TenantPrintExportModel` — chaque modèle regroupe 3 pages figées
 * (couverture / intérieur / fin) en A4 portrait, éditées via l'éditeur
 * fullscreen `ExportPdfEditor`.
 *
 * Pattern strictement aligné sur `TemplatesSection` (Cartouches) :
 *   - Toolbar : subNav + bouton "Restaurer Arkyo"
 *   - AdminListToolbar (search + sort + view)
 *   - Cards grid (icône FileStack + nom + description) avec hover Trash
 *   - Bouton dashed "Nouveau modèle d'export"
 *   - EmptyState contextuel
 *   - FormDialog création basique (name + key auto + description, sans format)
 *
 * Données :
 *   GET /api/tenant/parametres/print/export-models
 *
 * SSE entity : `tenant_parametres_print` (mutualisé avec cartouches /
 * settings, recharge tout le panel quand un modèle change).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FileStack,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Trash2,
} from "@/components/ui/icons";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

import { AdminListToolbar } from "../../_components/admin-list-toolbar";
import { AdminTabLayout } from "../../_components/admin-tab-layout";

import { ExportModelFormDialog } from "./export-model-form-dialog";
// arkyo-server: éditeur visuel en phase 6 — `ExportPdfEditor` (components/print →
// drawing-editor) non porté ; son entrée rend `<ComingSoon />`.
import { ComingSoonEditor } from "@/components/coming-soon";
import {
  useParametresSort,
  useParametresView,
} from "./use-parametres-visibility";
import { useParametresSync } from "./use-parametres-sync";
import { LoadingState } from "@/components/ui/loading-state";

// ── Types ──────────────────────────────────────────────────────────────────

export type ExportPageKind = "COVER" | "INTERIOR" | "BACK";

export type ExportPage = {
  id: string;
  kind: ExportPageKind;
  layout: unknown;
};

export type ExportModel = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  pages: ExportPage[];
  isActive?: boolean;
  sortOrder?: number;
};

const SECTION = "export-pdf";
const API_BASE = "/api/tenant/parametres/print/export-models";

// ── Composant ──────────────────────────────────────────────────────────────

export function ExportPdfSection({ subNav }: { subNav: ReactNode }) {
  const toast = useToast();
  const confirm = useConfirm();

  const [view, setView] = useParametresView(SECTION);
  const [sort, setSort] = useParametresSort(SECTION);
  const sortDir = sort.direction;

  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ExportModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  // Modales / éditeur fullscreen
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExportModel | null>(null);
  const [layoutEditing, setLayoutEditing] = useState<ExportModel | null>(null);

  // Fetch initial + reload silencieux après SSE / save
  const fetchAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const data = await api.get<ExportModel[]>(API_BASE);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setItems([]);
      } else {
        setError(
          getApiErrorMessage(
            e,
            "Impossible de charger les modèles d'export.",
          ),
        );
        setItems([]);
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadRef.current = () => fetchAll({ silent: true });
    void fetchAll();
  }, [fetchAll]);

  // Mutualisé avec le sub-tab Cartouches.
  useParametresSync("tenant_parametres_print", () => {
    void reloadRef.current();
  });

  // Filtrage + tri.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((m) => {
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.key.toLowerCase().includes(q) ||
        (m.description ?? "").toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "fr");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [items, search, sortDir]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleRestoreArkyo = async () => {
    const ok = await confirm({
      title: "Restaurer les modèles Arkyo manquants ?",
      description: (
        <>
          Les modèles d'export Arkyo supprimés seront ré-ajoutés. Les modèles
          déjà présents — modifiés ou non — ne sont pas touchés.
        </>
      ),
      confirmLabel: "Restaurer",
    });
    if (!ok) return;
    try {
      const res = await api.post<{ restored: number }>(
        `${API_BASE}/restore-arkyo`,
        {},
      );
      if (res.restored === 0) {
        toast.info("Tous les modèles Arkyo sont déjà présents.");
      } else {
        toast.success(
          `${res.restored} modèle${res.restored > 1 ? "s" : ""} restauré${res.restored > 1 ? "s" : ""}.`,
        );
        void fetchAll({ silent: true });
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la restauration."));
    }
  };

  const handleDeleteFromCard = async (item: ExportModel) => {
    const ok = await confirm({
      title: "Supprimer ce modèle d'export ?",
      description: (
        <>
          <strong>{item.name}</strong> sera supprimé définitivement avec ses
          trois pages.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`${API_BASE}/${item.id}`);
      toast.success("Modèle supprimé.");
      void fetchAll({ silent: true });
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la suppression."));
    }
  };

  const handleSorted = () =>
    setSort({
      sortBy: sort.sortBy,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });

  // ── Renderer card ───────────────────────────────────────────────────────

  const renderCard = (m: ExportModel) => {
    if (view === "list") {
      return (
        <div
          key={m.id}
          onClick={() => setLayoutEditing(m)}
          className="group flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-3 py-2 transition-colors hover:bg-[var(--secondary)]/40"
        >
          <ExportModelIcon />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{m.name}</p>
            <p className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">
              {m.key}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleDeleteFromCard(m);
            }}
            title="Supprimer"
            aria-label="Supprimer"
            // arkyo-server: habillage Strata
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }

    return (
      <Card
        key={m.id}
        onClick={() => setLayoutEditing(m)}
        className="group relative flex cursor-pointer flex-col gap-2 border-[var(--border)]/60 px-4 py-3 transition-colors hover:bg-[var(--secondary)]/40"
      >
        <div className="flex items-start gap-3">
          <ExportModelIcon />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight font-semibold">
              {m.name}
            </p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted-foreground)]">
              {m.key}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleDeleteFromCard(m);
            }}
            title="Supprimer"
            aria-label="Supprimer"
            // arkyo-server: habillage Strata
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {m.description && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            {m.description}
          </p>
        )}
      </Card>
    );
  };

  // ── Empty / loading / error states ──────────────────────────────────────

  if (loading) {
    return (
      <LoadingState className="px-8 pt-10" />
    );
  }

  if (error) {
    return (
      <div className="px-8 pt-10">
        <EmptyState
          icon={<Printer strokeWidth={1.5} />}
          title="Erreur"
          description={error}
        />
      </div>
    );
  }

  const isEmpty = items.length === 0;

  const renderEmpty = () => (
    <EmptyState
      icon={<FileStack strokeWidth={1.5} />}
      title="Aucun modèle d'export"
      description="Créez votre premier modèle d'export PDF, ou restaurez les modèles Arkyo."
      action={
        <EmptyStateAction onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          Créer mon premier modèle
        </EmptyStateAction>
      }
    />
  );

  return (
    <>
      <AdminTabLayout
        toolbar={
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              {subNav}
              <button
                type="button"
                onClick={() => void handleRestoreArkyo()}
                title="Restaurer les modèles d'export Arkyo supprimés"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restaurer Arkyo
              </button>
            </div>
            {!isEmpty && (
              <AdminListToolbar
                search={search}
                onSearchChange={setSearch}
                placeholder="Nom, clé, description…"
                count={filtered.length}
                total={
                  filtered.length !== items.length ? items.length : undefined
                }
                onSort={handleSorted}
                sortDir={sortDir}
                view={view}
                onViewChange={setView}
              />
            )}
          </div>
        }
        addButton={
          !isEmpty ? (
            <button
              onClick={openCreate}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] p-5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
              style={{ minHeight: "72px" }}
            >
              <Plus className="h-5 w-5" />
              <span className="text-xs font-medium">Nouveau modèle d'export</span>
            </button>
          ) : undefined
        }
      >
        {isEmpty ? (
          renderEmpty()
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucun modèle correspondant"
            description="Essayez d'élargir votre recherche."
            className="py-16"
          />
        ) : view === "grid" ? (
          <div
            className={cn("grid gap-3")}
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            }}
          >
            {filtered.map((m) => renderCard(m))}
          </div>
        ) : (
          <div className="space-y-1.5">{filtered.map((m) => renderCard(m))}</div>
        )}
      </AdminTabLayout>

      <ExportModelFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        existingModels={items}
        apiBase={API_BASE}
        onSaved={(created) => {
          setFormOpen(false);
          void fetchAll({ silent: true });
          if (created) {
            setLayoutEditing(created);
          }
        }}
        onDeleted={() => {
          void fetchAll({ silent: true });
        }}
      />

      {layoutEditing && (
        // arkyo-server: éditeur visuel en phase 6 (ExportPdfEditor → <ComingSoon />)
        <ComingSoonEditor
          onClose={() => {
            setLayoutEditing(null);
            void fetchAll({ silent: true });
          }}
        />
      )}
    </>
  );
}

// ── Sous-composants ────────────────────────────────────────────────────────

function ExportModelIcon() {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary)]">
      <FileStack className="h-4 w-4 text-[var(--muted-foreground)]" />
    </div>
  );
}
