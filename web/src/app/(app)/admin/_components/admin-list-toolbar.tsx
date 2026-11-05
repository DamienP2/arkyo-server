"use client";

import { Search, X, ArrowDown, ArrowUp, SlidersHorizontal, LayoutGrid, List } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type ViewMode = "grid" | "list";

export type ChipFilter = {
  /** Identifiant unique (clé du filtre) */
  id: string;
  /** Texte affiché */
  label: string;
  /** Indique si ce chip est actif */
  active: boolean;
  /** Callback au clic (toggle ou setter) */
  onClick: () => void;
  /** Compteur optionnel affiché en suffixe */
  count?: number;
};

type Props = {
  search: string;
  onSearchChange: (v: string) => void;
  placeholder?: string;
  count: number;
  total?: number;
  /** Tri : icône seule qui toggle direction. `sortDir="desc"` ↓, `"asc"` ↑. */
  onSort?: () => void;
  sortDir?: "desc" | "asc";
  /** @deprecated — utilisez `sortDir`. Conservé pour compat avec les pages legacy. */
  sortLabel?: string;
  /** @deprecated — utilisez `sortDir`. `sortActive=true` ≡ `sortDir="asc"`. */
  sortActive?: boolean;
  /** Slot rendu juste avant le bouton Filtrer (ex. toggle « Catalogue Arkyo »). */
  beforeFilter?: React.ReactNode;
  /** Mode legacy : ouvre un Sheet drawer pour les filtres complexes. */
  onFilter?: () => void;
  filterCount?: number;
  onClearFilters?: () => void;
  /** Mode chips inline (préféré quand <= 5 options) — visible direct, pas de Sheet. */
  chips?: ChipFilter[];
  view?: ViewMode;
  onViewChange?: (v: ViewMode) => void;
  children?: React.ReactNode;
};

/**
 * Toolbar standard pour les pages liste : search + (chips filtre OR bouton Filtrer)
 * + tri icône + toggle vue + count pill.
 *
 * Style aligné sur les pages support / activité / collaborators :
 * `bg-secondary/40` + count pill `bg-card shadow-sm`.
 */
export function AdminListToolbar({
  search,
  onSearchChange,
  placeholder = "Rechercher…",
  count,
  total,
  onSort,
  sortDir,
  sortActive,
  beforeFilter,
  onFilter,
  filterCount = 0,
  onClearFilters,
  chips,
  view,
  onViewChange,
  children,
}: Props) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/40 p-1.5">
      {/* Search */}
      <div className="relative min-w-0 flex-1">
        <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="flex h-8 w-full rounded-lg bg-transparent px-3 pl-8 text-sm focus:outline-none"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 transition-colors hover:bg-[var(--border)]"
            title="Effacer"
          >
            <X className="h-3 w-3 text-[var(--muted-foreground)]" />
          </button>
        )}
      </div>

      {/* Chips inline (priorité sur le bouton Filtrer si fournis) */}
      {chips && chips.length > 0 && (
        <>
          <div className="h-5 w-px shrink-0 bg-[var(--border)]" />
          <div className="flex shrink-0 items-center gap-1">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={c.onClick}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11px] font-medium transition-all",
                  c.active
                    ? "bg-[var(--card)] text-[var(--accent)] shadow-sm"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]",
                )}
              >
                {c.label}
                {typeof c.count === "number" && (
                  <span className="text-[10px] tabular-nums opacity-60">{c.count}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Tri (icône seule, toggle direction). Support legacy : si sortDir non
          fourni mais sortActive l'est → mappé sur asc/desc. */}
      {onSort &&
        (() => {
          const dir: "desc" | "asc" = sortDir ?? (sortActive ? "asc" : "desc");
          return (
            <>
              <div className="h-5 w-px shrink-0 bg-[var(--border)]" />
              <button
                type="button"
                onClick={onSort}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--card)] hover:text-[var(--foreground)]"
                title={dir === "desc" ? "Plus récents d'abord" : "Plus anciens d'abord"}
              >
                {dir === "desc" ? (
                  <ArrowDown className="h-3.5 w-3.5" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          );
        })()}

      {/* Slot avant le bouton Filtrer */}
      {beforeFilter && (
        <>
          <div className="h-5 w-px shrink-0 bg-[var(--border)]" />
          {beforeFilter}
        </>
      )}

      {/* Filtre (Sheet drawer — fallback pour filtres complexes) */}
      {onFilter && !chips && (
        <>
          <div className="h-5 w-px shrink-0 bg-[var(--border)]" />
          <button
            type="button"
            onClick={onFilter}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-all",
              filterCount > 0
                ? "bg-[var(--card)] text-[var(--accent)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]",
            )}
          >
            <SlidersHorizontal className="h-3 w-3" />
            Filtrer
            {filterCount > 0 && ( // arkyo-server: habillage Strata
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-[var(--accent-foreground)]">
                {filterCount}
              </span>
            )}
          </button>
        </>
      )}

      {children}

      {/* Toggle vue grid/list */}
      {view && onViewChange && (
        <>
          <div className="h-5 w-px shrink-0 bg-[var(--border)]" />
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => onViewChange("grid")}
              title="Vue grille"
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                view === "grid"
                  ? "bg-[var(--card)] text-[var(--accent)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onViewChange("list")}
              title="Vue liste"
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                view === "list"
                  ? "bg-[var(--card)] text-[var(--accent)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]",
              )}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}

      {/* Count pill (style support/activity) */}
      <span className="ml-auto inline-flex h-7 shrink-0 items-center rounded-lg bg-[var(--card)] px-2.5 text-[11px] font-semibold text-[var(--foreground)] tabular-nums shadow-sm">
        {count}
        {total != null && total !== count && <span className="ml-1 opacity-50">/ {total}</span>}
      </span>

      {/* Bouton clear filters (à droite du count si filtres actifs) */}
      {filterCount > 0 && onClearFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/25"
          title="Réinitialiser les filtres"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
