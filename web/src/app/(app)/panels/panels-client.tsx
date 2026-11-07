"use client";

/**
 * PanelsClient — design aligné sur users-list-tab.
 *
 * Toolbar (search + filter catégorie signal + compteur) → Cards groupées par
 * hauteur (1U / 2U / 3U…) avec bordure gauche accent, actions au hover.
 * Création/édition conservées dans une modale locale (CreatePanelForm) car
 * le formulaire est trop riche pour FormDialog (sliders, presets).
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, LayoutPanelTop, Search, Trash2, ChevronRight } from "@/components/ui/icons";

// arkyo-server: getApiErrorMessage et useToast pour le refus de suppression (409).
import { api, ApiError, getApiErrorMessage } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { broadcastCatalogUpdated } from "@/lib/catalog-broadcast";
import { cn } from "@/lib/utils";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState, EmptyStateAction } from "@/components/ui/empty-state";
import { IfTenantPerm } from "@/components/ui/tenant-perm-button";
import { NewPanelWizard } from "@/components/panels/new-panel-wizard";
import {
  AdminListToolbar,
  type ChipFilter,
} from "@/app/(app)/admin/_components/admin-list-toolbar";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";

// ─────────────────────────────────────────────────────────────────────────────
// Types + constantes

type PanelSlot = {
  id: string;
  position: number;
  connectorTypeId: string | null;
  connectorType: {
    id: string;
    name: string;
    version: string | null;
    color: string;
    category: string;
  } | null;
};

type Panel = {
  id: string;
  name: string;
  heightU: number;
  slotsPerU: number;
  notes: string | null;
  slots: PanelSlot[];
  createdBy: { name: string | null };
};

const CATEGORY_COLORS: Record<string, string> = {
  AUDIO: "#3b82f6",
  VIDEO: "#ec4899",
  DATA: "#84cc16",
  NETWORK: "#22c55e",
  POWER: "#ef4444",
  FIBER: "#06b6d4",
  LIGHT: "#f59e0b",
};
const CATEGORY_LABELS: Record<string, string> = {
  AUDIO: "Audio",
  VIDEO: "Vidéo",
  DATA: "Data",
  NETWORK: "Réseau",
  POWER: "Alim.",
  FIBER: "Fibre",
  LIGHT: "Lumière",
};

// arkyo-server: habillage Strata (couleur d'interface : l'accent du thème au lieu de l'indigo d'arkyo ; texte des en-têtes 4,5:1 sur --background en clair)
const CARD_ACCENT = "var(--accent)"; // couleur neutre des bordures de cards

// ─────────────────────────────────────────────────────────────────────────────
// Visual — dots grille

function PanelDots({
  panel,
  slotMap,
  compact = false,
}: {
  panel: Panel;
  slotMap: Record<number, PanelSlot>;
  compact?: boolean;
}) {
  const size = compact ? 5 : 7;
  const gap = compact ? 2 : 3;
  return (
    <div className="flex flex-col" style={{ gap }}>
      {Array.from({ length: panel.heightU }, (_, u) => (
        <div key={u} className="flex" style={{ gap }}>
          {Array.from({ length: panel.slotsPerU }, (_, s) => {
            const pos = u * panel.slotsPerU + s + 1;
            const slot = slotMap[pos];
            const cat = slot?.connectorType?.category;
            const color = cat ? (CATEGORY_COLORS[cat] ?? "#888") : undefined;
            return (
              <div
                key={s}
                style={{
                  width: size,
                  height: size,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: color ?? "rgba(128,128,128,0.18)",
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main

type FilterCategory = string | "all";

export function PanelsClient({ initialPanels }: { initialPanels: Panel[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  // arkyo-server: message d'erreur de la suppression (panel encore posé).
  const toast = useToast();

  const [panels, setPanels] = useState(initialPanels);
  useEffect(() => setPanels(initialPanels), [initialPanels]);

  const [createOpen, setCreateOpen] = useState(false);
  const [uHeights, setUHeights] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8]);

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");
  const [sortKey, setSortKey] = useState<"recent" | "name">("recent");
  // Vue grid / list — persistée localStorage (aligné sur la liste Projets).
  const [view, setView] = useLocalStorageState<"grid" | "list">("panels:view", "grid", {
    isValid: (v): v is "grid" | "list" => v === "grid" || v === "list",
  });

  useEffect(() => {
    api
      .get<Record<string, string>>("/api/admin/config")
      .then((cfg) => {
        try {
          const h = JSON.parse(cfg.u_heights ?? "null");
          if (Array.isArray(h)) setUHeights(h);
        } catch {}
      })
      .catch(() => {});
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleCreate = async (data: {
    name: string;
    heightU: number;
    slotsPerU: number;
    rearCableDepthMm: number;
    notes?: string;
  }) => {
    try {
      const created = await api.post<Panel>("/api/panels", data);
      // Notifie les onglets inventaire ouverts pour qu'ils refetchent.
      broadcastCatalogUpdated();
      router.push(`/panels/${created.id}`);
    } catch (e) {
      if (e instanceof ApiError) return;
      throw e;
    }
  };

  const handleDelete = async (panel: Panel) => {
    const occupied = panel.slots.filter((s) => s.connectorTypeId).length;
    const ok = await confirm({
      title: "Supprimer ce panel ?",
      description: (
        <>
          <strong>{panel.name}</strong>
          {occupied > 0 && (
            <>
              {" "}
              et ses {occupied} connecteur{occupied !== 1 ? "s" : ""}
            </>
          )}{" "}
          seront supprimés.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/panels/${panel.id}`);
      setPanels((prev) => prev.filter((p) => p.id !== panel.id));
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      // arkyo-server: le serveur refuse la suppression d'un panel encore posé (409) ; on affiche son message.
      toast.error(getApiErrorMessage(e, "Échec de la suppression."));
    }
  };

  // ── Filtrage + tri + groupement par hauteur ─────────────────────────────
  const filtered = useMemo(() => {
    const list = panels.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterCategory !== "all") {
        const cats = new Set(p.slots.map((s) => s.connectorType?.category).filter(Boolean));
        if (!cats.has(filterCategory)) return false;
      }
      return true;
    });
    // "recent" conserve l'ordre serveur (createdAt desc) ; "name" trie A→Z.
    if (sortKey === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    }
    return list;
  }, [panels, search, filterCategory, sortKey]);

  const grouped = useMemo(() => {
    const m: Record<number, Panel[]> = {};
    for (const p of filtered) (m[p.heightU] ??= []).push(p);
    return m;
  }, [filtered]);

  const orderedHeights = Object.keys(grouped)
    .map(Number)
    .sort((a, b) => a - b);

  // Toutes catégories utilisées dans les panels existants (pour le filter)
  const allCategories = useMemo(
    () =>
      [
        ...new Set(
          panels.flatMap(
            (p) => p.slots.map((s) => s.connectorType?.category).filter(Boolean) as string[],
          ),
        ),
      ].sort(),
    [panels],
  );

  const activeFilters = (search ? 1 : 0) + (filterCategory !== "all" ? 1 : 0);
  const resetFilters = () => {
    setSearch("");
    setFilterCategory("all");
  };

  // Chips de filtre par catégorie de signal (Tous + catégories présentes).
  const categoryChips: ChipFilter[] = useMemo(() => {
    const chips: ChipFilter[] = [
      {
        id: "all",
        label: "Tous",
        active: filterCategory === "all",
        onClick: () => setFilterCategory("all"),
        count: panels.length,
      },
    ];
    for (const cat of allCategories) {
      const c = panels.filter((p) =>
        p.slots.some((s) => s.connectorType?.category === cat),
      ).length;
      chips.push({
        id: cat,
        label: CATEGORY_LABELS[cat] ?? cat,
        active: filterCategory === cat,
        onClick: () => setFilterCategory(filterCategory === cat ? "all" : cat),
        count: c,
      });
    }
    return chips;
  }, [panels, allCategories, filterCategory]);

  // ─── Rendu ──────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className={cn(
          "flex-1 overflow-y-auto px-8",
          // Empty state plein écran centré verticalement (pattern liste Projets).
          panels.length === 0
            ? "flex items-center justify-center py-8"
            : "space-y-5 py-5",
        )}
      >
        {/* Empty state — aucun panel */}
        {panels.length === 0 && (
          <EmptyState
            icon={<LayoutPanelTop strokeWidth={1.5} />}
            title="Aucun panel de patch"
            description="Créez votre premier panel de patch pour organiser vos connecteurs."
            action={
              <IfTenantPerm domain="design" level="write">
                <EmptyStateAction onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Nouveau panel
                </EmptyStateAction>
              </IfTenantPerm>
            }
          />
        )}

        {/* Toolbar filtres — pattern aligné sur la liste Projets */}
        {panels.length > 0 && (
          <AdminListToolbar
            search={search}
            onSearchChange={setSearch}
            placeholder="Nom…"
            count={filtered.length}
            total={panels.length}
            onSort={() => setSortKey(sortKey === "recent" ? "name" : "recent")}
            sortDir={sortKey === "recent" ? "desc" : "asc"}
            chips={allCategories.length > 0 ? categoryChips : undefined}
            view={view}
            onViewChange={setView}
            filterCount={activeFilters}
            onClearFilters={resetFilters}
          />
        )}

        {/* Aucun résultat après filtres */}
        {panels.length > 0 && filtered.length === 0 && (
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="Aucun panel pour ces filtres"
            description="Essayez d'élargir votre recherche ou de réinitialiser les filtres."
            action={
              <button
                onClick={resetFilters}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                Réinitialiser les filtres
              </button>
            }
            className="py-16"
          />
        )}

        {panels.length > 0 && filtered.length > 0 && (
          <div className="space-y-7">
            {/* Inline add — réservé à design:write */}
            <IfTenantPerm domain="design" level="write">
              {view === "grid" ? (
                <button
                  onClick={() => setCreateOpen(true)}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
                  style={{ minHeight: 72 }}
                >
                  <Plus className="h-5 w-5" />
                  <span className="text-xs font-medium">Nouveau panel</span>
                </button>
              ) : (
                <button
                  onClick={() => setCreateOpen(true)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Nouveau panel</span>
                </button>
              )}
            </IfTenantPerm>

            {orderedHeights.map((h) => {
              const items = grouped[h] ?? [];
              const color = CARD_ACCENT;
              return (
                <div key={h}>
                  {/* Header groupe hauteur */}
                  <div className="mb-3 flex items-center gap-2.5">
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <h3 className="text-xs font-bold tracking-widest uppercase" style={{ color }}>
                      {h}U
                    </h3>
                    {/* arkyo-server: habillage Strata (`${color}30` : suffixe alpha impossible sur une variable, color-mix à 19 %) */}
                    <div className="h-px flex-1" style={{ backgroundColor: `color-mix(in srgb, ${color} 19%, transparent)` }} />
                    <span className="text-xs text-[var(--muted-foreground)]">{items.length}</span>
                  </div>

                  {view === "grid" ? (
                    <div
                      className="grid gap-3"
                      style={{
                        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                      }}
                    >
                      {items.map((panel) => {
                        const slotMap: Record<number, PanelSlot> = {};
                        for (const s of panel.slots) slotMap[s.position] = s;
                        const total = panel.heightU * panel.slotsPerU;
                        const occupied = panel.slots.filter((s) => s.connectorTypeId).length;
                        const cats = [
                          ...new Set(
                            panel.slots
                              .map((s) => s.connectorType?.category)
                              .filter(Boolean) as string[],
                          ),
                        ];
                        return (
                          <div
                            key={panel.id}
                            onClick={() => router.push(`/panels/${panel.id}`)}
                            className="group relative flex cursor-pointer items-center gap-3 rounded-xl border bg-[var(--card)] p-3 transition-colors hover:bg-[var(--secondary)]"
                            style={{
                              // arkyo-server: habillage Strata (`${color}15` : color-mix à 8 %)
                              borderTopColor: `color-mix(in srgb, ${color} 8%, transparent)`,
                              borderRightColor: `color-mix(in srgb, ${color} 8%, transparent)`,
                              borderBottomColor: `color-mix(in srgb, ${color} 8%, transparent)`,
                              borderLeftColor: color,
                              borderLeftWidth: 3,
                            }}
                          >
                            <div className="flex shrink-0 items-center justify-center rounded-lg bg-[var(--secondary)] p-1.5">
                              <PanelDots panel={panel} slotMap={slotMap} compact />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">{panel.name}</p>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                                <span className="tabular-nums">
                                  {occupied}/{total}
                                </span>
                                <span>·</span>
                                <span>{panel.slotsPerU}/U</span>
                                {cats.length > 0 && (
                                  <>
                                    <span>·</span>
                                    <div className="flex items-center gap-0.5">
                                      {cats.slice(0, 5).map((c) => (
                                        <span
                                          key={c}
                                          className="h-1.5 w-1.5 rounded-full"
                                          style={{
                                            background: CATEGORY_COLORS[c] ?? "#888",
                                          }}
                                        />
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <IfTenantPerm domain="design" level="admin">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDelete(panel);
                                  }}
                                  // arkyo-server: habillage Strata
                                  className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </IfTenantPerm>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {items.map((panel) => {
                        const slotMap: Record<number, PanelSlot> = {};
                        for (const s of panel.slots) slotMap[s.position] = s;
                        const total = panel.heightU * panel.slotsPerU;
                        const occupied = panel.slots.filter((s) => s.connectorTypeId).length;
                        const cats = [
                          ...new Set(
                            panel.slots
                              .map((s) => s.connectorType?.category)
                              .filter(Boolean) as string[],
                          ),
                        ];
                        return (
                          <div
                            key={panel.id}
                            onClick={() => router.push(`/panels/${panel.id}`)}
                            className="group flex cursor-pointer items-center gap-2.5 rounded-lg border bg-[var(--card)] px-3 py-2 transition-colors hover:bg-[var(--secondary)]"
                            style={{
                              // arkyo-server: habillage Strata (`${color}20` : color-mix à 13 %)
                              borderTopColor: `color-mix(in srgb, ${color} 13%, transparent)`,
                              borderRightColor: `color-mix(in srgb, ${color} 13%, transparent)`,
                              borderBottomColor: `color-mix(in srgb, ${color} 13%, transparent)`,
                              borderLeftColor: color,
                              borderLeftWidth: 3,
                            }}
                          >
                            <div className="flex shrink-0 items-center justify-center rounded bg-[var(--secondary)] p-1">
                              <PanelDots panel={panel} slotMap={slotMap} compact />
                            </div>
                            <p className="flex-1 truncate text-xs font-semibold">{panel.name}</p>
                            <span className="shrink-0 text-[10px] text-[var(--muted-foreground)] tabular-nums">
                              {occupied}/{total}
                            </span>
                            <span className="hidden shrink-0 text-[10px] text-[var(--muted-foreground)] sm:block">
                              {panel.slotsPerU}/U
                            </span>
                            {cats.length > 0 && (
                              <div className="flex shrink-0 items-center gap-0.5">
                                {cats.slice(0, 5).map((c) => (
                                  <span
                                    key={c}
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{
                                      background: CATEGORY_COLORS[c] ?? "#888",
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                            <ChevronRight className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
                            <IfTenantPerm domain="design" level="admin">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDelete(panel);
                                }}
                                // arkyo-server: habillage Strata
                                className="rounded-lg p-1 text-[var(--muted-foreground)] opacity-0 transition-colors group-hover:opacity-100 hover:bg-[var(--danger)]/10 hover:text-[var(--danger-text)]"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </IfTenantPerm>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Wizard création — pattern multi-étapes */}
      <NewPanelWizard
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        uHeights={uHeights}
      />
    </>
  );
}
