"use client";

/**
 * PrintPanel — onglet « Impression » de `/admin/parametres` (tenant).
 *
 * Modèle tenant-only : les cartouches et planches d'étiquettes Arkyo sont
 * copiés au provisioning, puis le tenant en est totalement propriétaire
 * (CRUD libre). Plus de toggle Mes/Arkyo, plus de proposition à Arkyo, plus
 * de badge source. Un bouton « Restaurer Arkyo » par section permet de
 * récupérer les défauts Arkyo supprimés.
 *
 * Sub-tabs (3 onglets à plat dans l'ordre) :
 *   - Export PDF (singleton Arkyo en lecture seule — refonte ultérieure)
 *   - Cartouches (CRUD tenant)
 *   - Étiquettes câbles (CRUD tenant)
 *
 * Données :
 *   GET /api/tenant/parametres/print → { templates: TenantPrintTemplate[], settings }
 *
 * SSE entity : `tenant_parametres_print` (cartouches + settings).
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
  FileText,
  Layers,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Tag,
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

import { PrintTemplateFormDialog } from "./print-template-form-dialog";
// arkyo-server: éditeur visuel en phase 6 — `PrintLayoutEditor` (components/print →
// drawing-editor) non porté ; son entrée rend `<ComingSoon />`.
import { ComingSoonEditor } from "@/components/coming-soon";
import { CableLabelStocksSection } from "./cable-label-stocks-section";
import { ExportPdfSection } from "./export-pdf-section";
import {
  useParametresSort,
  useParametresView,
} from "./use-parametres-visibility";
import { useParametresSync } from "./use-parametres-sync";
import { LoadingState } from "@/components/ui/loading-state";

// ── Types ──────────────────────────────────────────────────────────────────

export type PrintTemplateSlot = {
  key: string;
  label: string;
  type: "TEXT" | "VARIABLE" | "LOGO";
  defaultValue?: string;
  sample?: string;
};

export type TenantPrintTemplateItem = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  paperFormat: string;
  orientation: string;
  slots: PrintTemplateSlot[];
  layout: unknown;
  isActive?: boolean;
  sortOrder?: number;
};

type PrintResponse = {
  templates?: TenantPrintTemplateItem[];
};

type SubSection = "settings" | "templates" | "labels";

const STORAGE_SUB = "tenant.parametres.print.subtab";
const SECTION = "print";

const SUB_TABS: {
  key: SubSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "settings", label: "Export PDF", icon: SettingsIcon },
  { key: "templates", label: "Cartouches", icon: Layers },
  { key: "labels", label: "Étiquettes câbles", icon: Tag },
];

function isSub(v: unknown): v is SubSection {
  return v === "settings" || v === "templates" || v === "labels";
}

// ── Orchestrateur ──────────────────────────────────────────────────────────

export function PrintPanel(_props: { initialAppConfig: Record<string, string> }) {
  // Lazy initializer — pattern aligné sur les autres panels parametres.
  const [section, setSection] = useState<SubSection>(() => {
    if (typeof window === "undefined") return "settings";
    try {
      const raw = window.localStorage.getItem(STORAGE_SUB);
      return isSub(raw) ? raw : "settings";
    } catch {
      return "settings";
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_SUB, section);
    } catch {
      /* quota — ignore */
    }
  }, [section]);

  // Données partagées entre les sub-tabs : on fetch une fois ici puis on
  // distribue. Évite des requêtes redondantes lors du switch entre onglets.
  // (Les modèles d'export PDF et les étiquettes câbles ont leur propre fetch
  // dans leur section dédiée — pas mutualisé ici pour rester simple.)
  const [templates, setTemplates] = useState<TenantPrintTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  // `loading=true` UNIQUEMENT au premier fetch initial. Les reloads silencieux
  // (SSE, après save / restore) ne déclenchent pas l'écran "Chargement…" qui
  // unmonterait les sous-composants (notamment TemplatesSection) et fermerait
  // l'éditeur fullscreen en cours d'auto-save.
  const fetchAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const data = await api.get<PrintResponse>("/api/tenant/parametres/print");
      setTemplates(Array.isArray(data?.templates) ? data.templates : []);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setTemplates([]);
      } else {
        setError(
          getApiErrorMessage(
            e,
            "Impossible de charger les paramètres d'impression.",
          ),
        );
        setTemplates([]);
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadRef.current = () => fetchAll({ silent: true });
    void fetchAll();
  }, [fetchAll]);

  useParametresSync("tenant_parametres_print", () => {
    void reloadRef.current();
  });

  // Sub-nav à plat (3 pills).
  const subNav: ReactNode = (
    <div /* arkyo-server: habillage Strata */ className="inline-flex items-center gap-0.5 self-start rounded-[9px] border border-[var(--border)] bg-[var(--surface)] p-[3px]">
      {SUB_TABS.map((t) => {
        const Icon = t.icon;
        const active = t.key === section;
        return (
          <button
            key={t.key}
            onClick={() => setSection(t.key)}
            className={cn(
              // arkyo-server: habillage Strata
              "inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-[5px] text-xs font-medium whitespace-nowrap transition-all",
              active
                // arkyo-server: habillage Strata
                ? "bg-[var(--muted)] text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            <Icon className="h-3 w-3" />
            {t.label}
          </button>
        );
      })}
    </div>
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
          icon={<Printer strokeWidth={1.5} />}
          title="Erreur"
          description={error}
        />
      </div>
    );
  }

  if (section === "settings") {
    return <ExportPdfSection subNav={subNav} />;
  }

  if (section === "templates") {
    return (
      <TemplatesSection
        subNav={subNav}
        templates={templates}
        reload={() => fetchAll({ silent: true })}
      />
    );
  }

  return <CableLabelStocksSection subNav={subNav} />;
}

// ════════════════════════════════════════════════════════════════════════════
// Sub-tab Cartouches
// ════════════════════════════════════════════════════════════════════════════

function TemplatesSection({
  subNav,
  templates,
  reload,
}: {
  subNav: ReactNode;
  templates: TenantPrintTemplateItem[];
  reload: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [view, setView] = useParametresView(SECTION);
  const [sort, setSort] = useParametresSort(SECTION);
  const sortDir = sort.direction;

  const [search, setSearch] = useState("");

  // Modales / éditeur fullscreen
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenantPrintTemplateItem | null>(null);
  const [layoutEditing, setLayoutEditing] =
    useState<TenantPrintTemplateItem | null>(null);

  // Filtrage + tri.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = templates.filter((t) => {
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.key.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "fr");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [templates, search, sortDir]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openLayoutEdit = (item: TenantPrintTemplateItem) => {
    setLayoutEditing(item);
  };

  const handleRestoreArkyo = async () => {
    const ok = await confirm({
      title: "Restaurer les cartouches Arkyo manquants ?",
      description: (
        <>
          Les cartouches Arkyo supprimés seront ré-ajoutés. Les cartouches déjà
          présents — modifiés ou non — ne sont pas touchés.
        </>
      ),
      confirmLabel: "Restaurer",
    });
    if (!ok) return;
    try {
      const res = await api.post<{ restored: number }>(
        "/api/tenant/parametres/print/templates/restore-arkyo",
        {},
      );
      if (res.restored === 0) {
        toast.info("Tous les cartouches Arkyo sont déjà présents.");
      } else {
        toast.success(
          `${res.restored} cartouche${res.restored > 1 ? "s" : ""} restauré${res.restored > 1 ? "s" : ""}.`,
        );
        void reload();
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la restauration."));
    }
  };

  const handleDeleteFromCard = async (item: TenantPrintTemplateItem) => {
    const ok = await confirm({
      title: "Supprimer ce cartouche ?",
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
      await api.delete(`/api/tenant/parametres/print/templates/${item.id}`);
      toast.success("Cartouche supprimé.");
      void reload();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la suppression."));
    }
  };

  const handleSorted = () =>
    setSort({
      sortBy: sort.sortBy,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });

  // ── Renderer ────────────────────────────────────────────────────────────

  const renderCard = (t: TenantPrintTemplateItem) => {
    if (view === "list") {
      return (
        <div
          key={t.id}
          onClick={() => openLayoutEdit(t)}
          className="group flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-3 py-2 transition-colors hover:bg-[var(--secondary)]/40"
        >
          <TemplateIcon />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{t.name}</p>
            <p className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">
              {t.key}
            </p>
          </div>
          <TemplateBadges template={t} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleDeleteFromCard(t);
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
        key={t.id}
        onClick={() => openLayoutEdit(t)}
        className="group relative flex cursor-pointer flex-col gap-2 border-[var(--border)]/60 px-4 py-3 transition-colors hover:bg-[var(--secondary)]/40"
      >
        <div className="flex items-start gap-3">
          <TemplateIcon />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight font-semibold">
              {t.name}
            </p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted-foreground)]">
              {t.key}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleDeleteFromCard(t);
            }}
            title="Supprimer"
            aria-label="Supprimer"
            // arkyo-server: habillage Strata
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {t.description && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            {t.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <TemplateBadges template={t} />
        </div>
      </Card>
    );
  };

  // ── Empty states ────────────────────────────────────────────────────────
  const isEmpty = templates.length === 0;

  const renderEmpty = () => (
    <EmptyState
      icon={<FileText strokeWidth={1.5} />}
      title="Aucun cartouche"
      description="Créez votre premier cartouche d'impression, ou restaurez les cartouches Arkyo."
      action={
        <EmptyStateAction onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          Créer mon premier cartouche
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
                title="Restaurer les cartouches Arkyo supprimés"
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
                  filtered.length !== templates.length
                    ? templates.length
                    : undefined
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
              <span className="text-xs font-medium">Nouveau cartouche</span>
            </button>
          ) : undefined
        }
      >
        {isEmpty ? (
          renderEmpty()
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucun cartouche correspondant"
            description="Essayez d'élargir votre recherche."
            className="py-16"
          />
        ) : view === "grid" ? (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
          >
            {filtered.map((t) => renderCard(t))}
          </div>
        ) : (
          <div className="space-y-1.5">{filtered.map((t) => renderCard(t))}</div>
        )}
      </AdminTabLayout>

      <PrintTemplateFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        existingTemplates={templates}
        onSaved={(created) => {
          setFormOpen(false);
          void reload();
          // Création → bascule directement dans l'éditeur fullscreen sur le
          // template fraîchement créé. Édition basique → simple reload.
          if (created) {
            setLayoutEditing(created);
          }
        }}
        onDeleted={() => {
          void reload();
        }}
      />

      {layoutEditing && (
        // arkyo-server: éditeur visuel en phase 6 (PrintLayoutEditor → <ComingSoon />)
        <ComingSoonEditor
          onClose={() => {
            setLayoutEditing(null);
            void reload();
          }}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sous-composants
// ════════════════════════════════════════════════════════════════════════════

function TemplateIcon() {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary)]">
      <FileText className="h-4 w-4 text-[var(--muted-foreground)]" />
    </div>
  );
}

function TemplateBadges({ template }: { template: TenantPrintTemplateItem }) {
  return (
    <>
      <span className="rounded bg-[var(--secondary)]/60 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
        {template.paperFormat}
      </span>
      <span className="rounded bg-[var(--secondary)]/60 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
        {template.orientation === "LANDSCAPE" ? "Paysage" : "Portrait"}
      </span>
    </>
  );
}
