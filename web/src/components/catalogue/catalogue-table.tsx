"use client";

/**
 * CatalogueTable — tableau partagé (équipements / cordons / adaptateurs).
 *
 * Présentation pure, générique sur le type de ligne `T`. Densité compacte,
 * en-tête sticky triable, liseré gauche couleur fonction, multi-sélection via
 * `useRowSelection` (coches + glisser + Shift/Cmd), et barre d'action groupée
 * (Supprimer) quand une sélection existe.
 *
 * Sobriété DA arkyo : pas de zébrage, pas d'ombres portées sur les lignes.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ChevronDown, ChevronUp } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

import { SelectionActionBar } from "./selection-action-bar";
import type { RowSelection } from "./use-row-selection";

// ── Types publics ─────────────────────────────────────────────────────────────

export type CatalogueColumn<T> = {
  key: string;
  label: string;
  /** Rendu de cellule. */
  cell: (item: T) => ReactNode;
  /** Valeur de tri ; colonne non triable si absent. */
  sortValue?: (item: T) => string | number | null;
  align?: "left" | "right";
  /** Classes de largeur (ex. "w-32", "min-w-[200px]"). */
  className?: string;
};

export type CatalogueTableProps<T> = {
  items: T[];
  columns: CatalogueColumn<T>[];
  getRowId: (item: T) => string;
  /** Liseré gauche (couleur fonction). */
  getRowColor?: (item: T) => string;
  /** Ligne grisée non interactive (hors plan) — rend l'overlay badge plan. */
  isRowLocked?: (item: T) => boolean;
  getRowOverlay?: (item: T) => ReactNode;
  /** Ligne sélectionnable (= supprimable). Pas de coche sinon. */
  isRowSelectable: (item: T) => boolean;
  onRowClick?: (item: T) => void;
  /** Zone actions unitaires (dernière colonne), reprise des panneaux. */
  rowActions?: (item: T) => ReactNode;
  selection: RowSelection;
  /** Tri par défaut. */
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** Suppression groupée — affiche la barre d'action si fourni. */
  onBulkDelete?: () => void;
  /**
   * Notifie l'ordre affiché des ids sélectionnables (après tri) pour que le
   * hook de sélection calcule des plages Shift/glisser cohérentes.
   */
  onVisibleOrderChange?: (orderedSelectableIds: string[]) => void;
};

// ── Comparateur de tri ─────────────────────────────────────────────────────────

function compareValues(
  a: string | number | null,
  b: string | number | null,
  dir: "asc" | "desc",
): number {
  // null toujours en dernier, quelle que soit la direction.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  let cmp: number;
  if (typeof a === "number" && typeof b === "number") cmp = a - b;
  else cmp = String(a).localeCompare(String(b), "fr", { sensitivity: "base" });
  return dir === "desc" ? -cmp : cmp;
}

// ── Coches ─────────────────────────────────────────────────────────────────────

function SelectAllCheckbox({
  checked,
  indeterminate,
  onToggle,
}: {
  checked: boolean;
  indeterminate: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onToggle}
      onClick={(e) => e.stopPropagation()}
      className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
      aria-label="Tout sélectionner"
    />
  );
}

function RowCheckbox({
  id,
  checked,
  onSelect,
  onDragStart,
}: {
  id: string;
  checked: boolean;
  onSelect: (
    id: string,
    ev: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => void;
  onDragStart: (id: string) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      onClick={(e) => {
        e.stopPropagation();
        onSelect(id, {
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
        });
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onDragStart(id);
      }}
      className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
      aria-label="Sélectionner la ligne"
    />
  );
}

// ── Composant ──────────────────────────────────────────────────────────────────

export function CatalogueTable<T>({
  items,
  columns,
  getRowId,
  getRowColor,
  isRowLocked,
  getRowOverlay,
  isRowSelectable,
  onRowClick,
  rowActions,
  selection,
  defaultSort,
  onBulkDelete,
  onVisibleOrderChange,
}: CatalogueTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>(
    () => defaultSort ?? { key: columns[0]?.key ?? "", dir: "asc" },
  );

  const columnByKey = useMemo(() => {
    const m = new Map<string, CatalogueColumn<T>>();
    for (const c of columns) m.set(c.key, c);
    return m;
  }, [columns]);

  const sortedItems = useMemo(() => {
    const col = columnByKey.get(sort.key);
    if (!col?.sortValue) return items;
    const sv = col.sortValue;
    return [...items].sort((a, b) => compareValues(sv(a), sv(b), sort.dir));
  }, [items, sort, columnByKey]);

  // Remonte l'ordre affiché des ids sélectionnables (pour Shift/glisser).
  const lastOrderRef = useRef<string>("");
  useEffect(() => {
    if (!onVisibleOrderChange) return;
    const ids = sortedItems.filter(isRowSelectable).map(getRowId);
    const key = ids.join("|");
    if (key !== lastOrderRef.current) {
      lastOrderRef.current = key;
      onVisibleOrderChange(ids);
    }
  }, [sortedItems, isRowSelectable, getRowId, onVisibleOrderChange]);

  const toggleSort = (key: string) => {
    const col = columnByKey.get(key);
    if (!col?.sortValue) return;
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  };

  // Portée du « tout » : lignes sélectionnables visibles.
  const selectableVisibleIds = useMemo(
    () => sortedItems.filter(isRowSelectable).map(getRowId),
    [sortedItems, isRowSelectable, getRowId],
  );
  const selectedCount = selection.selected.size;
  const allSelected =
    selectableVisibleIds.length > 0 &&
    selectableVisibleIds.every((id) => selection.selected.has(id));
  const someSelected = selectableVisibleIds.some((id) =>
    selection.selected.has(id),
  );
  const hasSelection = selectedCount > 0;

  const showChecks = Boolean(onBulkDelete) || selectableVisibleIds.length > 0;

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              {showChecks && (
                <th className="w-9 border-b border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left">
                  <SelectAllCheckbox
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onToggle={() =>
                      allSelected ? selection.clear() : selection.selectAll()
                    }
                  />
                </th>
              )}
              {columns.map((col) => {
                const sortable = Boolean(col.sortValue);
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "border-b border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[10px] font-semibold tracking-wide text-[var(--muted-foreground)] uppercase",
                      col.align === "right" ? "text-right" : "text-left",
                      col.className,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          "inline-flex items-center gap-1 transition-colors hover:text-[var(--foreground)]",
                          col.align === "right" && "flex-row-reverse",
                          active && "text-[var(--foreground)]",
                        )}
                      >
                        {col.label}
                        {active &&
                          (sort.dir === "asc" ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          ))}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
              {rowActions && (
                <th className="w-px border-b border-[var(--border)] bg-[var(--card)] px-3 py-2" />
              )}
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item) => {
              const id = getRowId(item);
              const locked = isRowLocked?.(item) ?? false;
              const selectable = !locked && isRowSelectable(item);
              const isSel = selection.selected.has(id);
              const color = getRowColor?.(item);

              return (
                <tr
                  key={id}
                  onClick={
                    locked ? undefined : () => onRowClick?.(item)
                  }
                  onPointerEnter={() => selection.onDragEnter(id)}
                  className={cn(
                    "group border-b border-[var(--border)]/60 transition-colors",
                    locked
                      ? "opacity-40"
                      : "cursor-pointer hover:bg-[var(--secondary)]",
                    isSel && "bg-[var(--accent)]/[0.06]",
                  )}
                >
                  {showChecks && (
                    <td
                      className="px-3 py-2 align-middle"
                      style={
                        color
                          ? { boxShadow: `inset 3px 0 0 ${color}` }
                          : undefined
                      }
                      onClick={(e) => e.stopPropagation()}
                    >
                      {selectable && (
                        <RowCheckbox
                          id={id}
                          checked={isSel}
                          onSelect={selection.onCheckboxClick}
                          onDragStart={selection.onDragStart}
                        />
                      )}
                    </td>
                  )}
                  {columns.map((col, ci) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-3 py-2 align-middle",
                        col.align === "right" && "text-right",
                        col.className,
                      )}
                      style={
                        !showChecks && ci === 0 && color
                          ? { boxShadow: `inset 3px 0 0 ${color}` }
                          : undefined
                      }
                    >
                      {col.cell(item)}
                    </td>
                  ))}
                  {rowActions && (
                    <td
                      className="px-3 py-2 text-right align-middle whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {locked
                        ? getRowOverlay?.(item)
                        : rowActions(item)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {onBulkDelete && hasSelection && (
        <SelectionActionBar
          count={selectedCount}
          onDelete={onBulkDelete}
          onClear={selection.clear}
        />
      )}
    </>
  );
}
