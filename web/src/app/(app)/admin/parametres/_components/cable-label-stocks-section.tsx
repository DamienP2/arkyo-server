"use client";

/**
 * CableLabelStocksSection — onglet « Étiquettes câbles » dans
 * `/admin/parametres > Impressions` (tenant).
 *
 * Modèle tenant-only : les planches d'étiquettes Arkyo sont copiées au
 * provisioning, puis le tenant en est totalement propriétaire (CRUD libre).
 * Plus de toggle Mes/Arkyo, plus de proposition à Arkyo, plus de badge
 * source. Un bouton « Restaurer Arkyo » permet de récupérer les défauts
 * Arkyo supprimés.
 *
 * Pas de sous-onglet interne (les autres types d'étiquettes — équipements,
 * panels — viendront en top-level si besoin, YAGNI ici).
 *
 * Données :
 *   GET /api/tenant/parametres/print/label-stocks → TenantCableLabelStock[]
 *   GET /api/tenant/catalogue/lookup              → { brands } (Arkyo brands)
 *
 * Persistance localStorage :
 *   tenant.parametres.print.labels.cables.view ← "grid" | "list"
 *   tenant.parametres.print.labels.cables.sort ← { sortBy, direction }
 *
 * SSE entity : `tenant_parametres_print_labels`.
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
  ExternalLink,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
} from "@/components/ui/icons";

import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  PAPER_SIZES_MM,
  type PaperFormat,
  type Orientation,
} from "@/lib/services/print-layout";

import { AdminListToolbar } from "../../_components/admin-list-toolbar";
import { AdminTabLayout } from "../../_components/admin-tab-layout";

import { CableLabelStockFormDialog } from "./cable-label-stock-form-dialog";
import {
  useParametresSort,
  useParametresView,
} from "./use-parametres-visibility";
import { useParametresSync } from "./use-parametres-sync";
import { LoadingState } from "@/components/ui/loading-state";

// ── Types ──────────────────────────────────────────────────────────────────

export type BrandLookupItem = {
  id: string;
  name: string;
  logoUrl: string | null;
};

export type TenantCableLabelStockItem = {
  id: string;
  name: string;
  reference: string | null;
  brandId: string | null;
  description: string | null;
  datasheetUrl: string | null;
  paperFormat: PaperFormat;
  orientation: Orientation;
  pageMarginTop: number;
  pageMarginRight: number;
  pageMarginBottom: number;
  pageMarginLeft: number;
  columns: number;
  rows: number;
  gutterX: number;
  gutterY: number;
  labelWidth: number;
  labelHeight: number;
  printableHeight: number | null;
  wrapHeight: number | null;
  printablePadding: number | null;
  printableColor: string | null;
  cableDiameterMin: number | null;
  cableDiameterMax: number | null;
  isActive?: boolean;
  sortOrder?: number;
};

type LookupResponse = {
  brands?: BrandLookupItem[];
};

const SECTION = "print.labels.cables";

// ── Composant ──────────────────────────────────────────────────────────────

export function CableLabelStocksSection({ subNav }: { subNav: ReactNode }) {
  const toast = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState<TenantCableLabelStockItem[]>([]);
  const [brands, setBrands] = useState<BrandLookupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  const [view, setView] = useParametresView(SECTION);
  const [sort, setSort] = useParametresSort(SECTION);
  const sortDir = sort.direction;

  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TenantCableLabelStockItem | null>(
    null,
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, lookup] = await Promise.all([
        api.get<TenantCableLabelStockItem[]>(
          "/api/tenant/parametres/print/label-stocks",
        ),
        api
          .get<LookupResponse>("/api/tenant/catalogue/lookup")
          .catch(() => ({}) as LookupResponse),
      ]);
      setItems(Array.isArray(data) ? data : []);
      setBrands(Array.isArray(lookup?.brands) ? lookup.brands : []);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setItems([]);
      } else {
        setError(
          getApiErrorMessage(
            e,
            "Impossible de charger les planches d'étiquettes.",
          ),
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

  useParametresSync("tenant_parametres_print_labels", () => {
    void reloadRef.current();
  });

  // ── Brand name resolver (pas de relation incluse côté API) ───────────────
  const getBrandName = (item: TenantCableLabelStockItem): string | null => {
    if (item.brandId) {
      return brands.find((b) => b.id === item.brandId)?.name ?? null;
    }
    return null;
  };

  // ── Filtrage + tri ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((s) => {
      if (!q) return true;
      const brandName = getBrandName(s) ?? "";
      return (
        s.name.toLowerCase().includes(q) ||
        (s.reference ?? "").toLowerCase().includes(q) ||
        brandName.toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "fr");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, search, sortDir, brands]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (item: TenantCableLabelStockItem) => {
    setEditing(item);
    setFormOpen(true);
  };

  const handleRestoreArkyo = async () => {
    const ok = await confirm({
      title: "Restaurer les planches Arkyo manquantes ?",
      description: (
        <>
          Les planches Arkyo supprimées seront ré-ajoutées. Les planches déjà
          présentes — modifiées ou non — ne sont pas touchées.
        </>
      ),
      confirmLabel: "Restaurer",
    });
    if (!ok) return;
    try {
      const res = await api.post<{ restored: number }>(
        "/api/tenant/parametres/print/label-stocks/restore-arkyo",
        {},
      );
      if (res.restored === 0) {
        toast.info("Toutes les planches Arkyo sont déjà présentes.");
      } else {
        toast.success(
          `${res.restored} planche${res.restored > 1 ? "s" : ""} restaurée${res.restored > 1 ? "s" : ""}.`,
        );
        void fetchAll();
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la restauration."));
    }
  };

  const handleDeleteFromCard = async (item: TenantCableLabelStockItem) => {
    const ok = await confirm({
      title: "Supprimer cette planche ?",
      description: (
        <>
          <strong>{item.name}</strong> sera supprimée définitivement.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/tenant/parametres/print/label-stocks/${item.id}`);
      toast.success("Planche supprimée.");
      void fetchAll();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Échec de la suppression."));
    }
  };

  const handleSorted = () =>
    setSort({
      sortBy: sort.sortBy,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });

  if (loading) {
    return (
      <AdminTabLayout
        toolbar={
          <div className="flex items-start justify-between gap-3">
            {subNav}
            <RestoreButton onClick={() => void handleRestoreArkyo()} />
          </div>
        }
      >
        <LoadingState className="px-1 py-10" />
      </AdminTabLayout>
    );
  }

  if (error) {
    return (
      <AdminTabLayout
        toolbar={
          <div className="flex items-start justify-between gap-3">
            {subNav}
            <RestoreButton onClick={() => void handleRestoreArkyo()} />
          </div>
        }
      >
        <EmptyState
          icon={<Tag strokeWidth={1.5} />}
          title="Erreur"
          description={error}
        />
      </AdminTabLayout>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  const isEmpty = items.length === 0;

  const renderEmpty = () => (
    <EmptyState
      icon={<Tag strokeWidth={1.5} />}
      title="Aucune planche d'étiquettes"
      description="Créez votre première planche d'étiquettes câbles, ou restaurez les planches Arkyo."
      action={
        <EmptyStateAction onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          Créer ma première planche
        </EmptyStateAction>
      }
    />
  );

  // ── Renderer card ───────────────────────────────────────────────────────

  const renderCard = (s: TenantCableLabelStockItem) => {
    if (view === "list") {
      return (
        <div
          key={s.id}
          onClick={() => openEdit(s)}
          className="group flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-3 py-2 transition-colors hover:bg-[var(--secondary)]/40"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--secondary)]/40">
            <LabelStockPreview item={s} size={36} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{s.name}</p>
            <p className="truncate text-[10px] text-[var(--muted-foreground)]">
              <StockMetaLine item={s} brandName={getBrandName(s)} />
            </p>
          </div>
          <StockBadges item={s} compact />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleDeleteFromCard(s);
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
        key={s.id}
        onClick={() => openEdit(s)}
        className="group relative flex cursor-pointer flex-col overflow-hidden border-[var(--border)]/60 transition-colors hover:bg-[var(--secondary)]/40"
      >
        <div className="flex items-center justify-center bg-[var(--secondary)]/30 px-4 pt-4 pb-3">
          <LabelStockPreview item={s} size={120} />
        </div>
        <div className="flex items-start justify-between gap-2 border-t border-[var(--border)]/60 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-tight font-semibold">
              {s.name}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">
              <StockMetaLine item={s} brandName={getBrandName(s)} />
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleDeleteFromCard(s);
            }}
            title="Supprimer"
            aria-label="Supprimer"
            // arkyo-server: habillage Strata
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          <StockBadges item={s} />
        </div>
      </Card>
    );
  };

  return (
    <>
      <AdminTabLayout
        toolbar={
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              {subNav}
              <RestoreButton onClick={() => void handleRestoreArkyo()} />
            </div>
            {!isEmpty && (
              <AdminListToolbar
                search={search}
                onSearchChange={setSearch}
                placeholder="Nom, référence, fabricant…"
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
              <span className="text-xs font-medium">Nouvelle planche</span>
            </button>
          ) : undefined
        }
      >
        {isEmpty ? (
          renderEmpty()
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucune planche correspondante"
            description="Essayez d'élargir votre recherche."
            className="py-16"
          />
        ) : view === "grid" ? (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            }}
          >
            {filtered.map((s) => renderCard(s))}
          </div>
        ) : (
          <div className="space-y-1.5">{filtered.map((s) => renderCard(s))}</div>
        )}
      </AdminTabLayout>

      <CableLabelStockFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        brands={brands}
        onSaved={() => {
          setFormOpen(false);
          void fetchAll();
        }}
        onDeleted={() => {
          void fetchAll();
        }}
      />
    </>
  );
}

// ── Sous-composants visuels ────────────────────────────────────────────────

function RestoreButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Restaurer les planches Arkyo supprimées"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
    >
      <RotateCcw className="h-3.5 w-3.5" />
      Restaurer Arkyo
    </button>
  );
}

function StockMetaLine({
  item,
  brandName,
}: {
  item: TenantCableLabelStockItem;
  brandName: string | null;
}) {
  const bits = [brandName, item.reference].filter(Boolean) as string[];
  if (bits.length === 0) {
    return <span className="italic">Sans référence</span>;
  }
  return <span className="font-mono">{bits.join(" · ")}</span>;
}

function StockBadges({
  item,
  compact = false,
}: {
  item: TenantCableLabelStockItem;
  compact?: boolean;
}) {
  const total = item.columns * item.rows;
  return (
    <>
      <Badge>{item.paperFormat}</Badge>
      <Badge>{item.orientation === "LANDSCAPE" ? "Paysage" : "Portrait"}</Badge>
      {!compact && (
        <span className="text-[10px] text-[var(--muted-foreground)]">
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {item.columns}×{item.rows}
          </span>{" "}
          · {total} étiq.
        </span>
      )}
      {!compact && (
        <span
          className="text-[10px] text-[var(--muted-foreground)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {item.labelWidth}×{item.labelHeight}mm
        </span>
      )}
      {!compact &&
        item.cableDiameterMin != null &&
        item.cableDiameterMax != null && (
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-blue-600 uppercase">
            Ø {item.cableDiameterMin}–{item.cableDiameterMax}mm
          </span>
        )}
      {!compact && item.printableHeight != null && (
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-emerald-600 uppercase">
          Self-laminating
        </span>
      )}
      {!compact && item.datasheetUrl && (
        <a
          href={item.datasheetUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
          title="Datasheet"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-[var(--secondary)]/60 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
      {children}
    </span>
  );
}

// ── Aperçu SVG miniature d'une planche ─────────────────────────────────────

export function LabelStockPreview({
  item,
  size = 120,
}: {
  item: TenantCableLabelStockItem;
  size?: number;
}) {
  const paper = PAPER_SIZES_MM[item.paperFormat];
  const w = item.orientation === "LANDSCAPE" ? paper.h : paper.w;
  const h = item.orientation === "LANDSCAPE" ? paper.w : paper.h;
  const ratio = h / w;
  const previewW = ratio > 1 ? size / ratio : size;
  const previewH = ratio > 1 ? size : size * ratio;

  const labels: { x: number; y: number; printH: number | null }[] = [];
  for (let r = 0; r < item.rows; r++) {
    for (let c = 0; c < item.columns; c++) {
      const x = item.pageMarginLeft + c * (item.labelWidth + item.gutterX);
      const y = item.pageMarginTop + r * (item.labelHeight + item.gutterY);
      labels.push({ x, y, printH: item.printableHeight });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={previewW}
      height={previewH}
      style={{ background: "#ffffff", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}
    >
      <rect
        x={item.pageMarginLeft}
        y={item.pageMarginTop}
        width={Math.max(0, w - item.pageMarginLeft - item.pageMarginRight)}
        height={Math.max(0, h - item.pageMarginTop - item.pageMarginBottom)}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={0.3}
        strokeDasharray="2 2"
      />
      {labels.map((l, i) => (
        <g key={i}>
          {l.printH != null ? (
            <>
              <rect
                x={l.x}
                y={l.y}
                width={item.labelWidth}
                height={l.printH}
                fill={item.printableColor || "#fde047"}
                stroke="#facc15"
                strokeWidth={0.2}
              />
              <rect
                x={l.x}
                y={l.y + l.printH}
                width={item.labelWidth}
                height={item.labelHeight - l.printH}
                fill="#dbeafe"
                stroke="#93c5fd"
                strokeWidth={0.2}
                opacity={0.5}
              />
            </>
          ) : (
            <rect
              x={l.x}
              y={l.y}
              width={item.labelWidth}
              height={item.labelHeight}
              fill={item.printableColor || "#fde047"}
              stroke="#facc15"
              strokeWidth={0.2}
            />
          )}
        </g>
      ))}
    </svg>
  );
}
