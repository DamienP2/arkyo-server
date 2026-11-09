"use client";

/**
 * Mode tableau des pages Gérer (interface Strata v2, spec v2 §4.2, maquette
 * `.grid` / `.gbar`) : saisie en série, cellule par cellule, comme un
 * tableur.
 *   - une cellule active, une plage dans sa colonne (⇧ clic, ⇧ flèches) ;
 *   - édition : Entrée, F2, double clic ou frappe d'un caractère ; Entrée
 *     valide et descend, Tab valide et passe à droite, Échap annule ;
 *   - « Remplir vers le bas » (⌘D / Ctrl D) recopie la première cellule de la
 *     plage sur les suivantes ; Suppr vide la plage ;
 *   - les saisies restent des brouillons (`drafts`) jusqu'à l'enregistrement,
 *     confié à la page (une requête par ligne modifiée).
 *
 * Une ligne que l'utilisateur ne peut pas modifier (droits) reste en lecture.
 */

import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { SMALL_BTN } from "./manage-ui";

export type TableColumn<R> = {
  key: string;
  title: string;
  /** Largeur CSS (`96px`, `30%`) ; à défaut, le reste. */
  width?: string;
  mono?: boolean;
  get: (row: R) => string;
  editable?: boolean;
  /** Rendu hors édition (pastille de couleur…). */
  render?: (value: string, row: R) => ReactNode;
  /** Erreur de la saisie, `null` si elle est valable. */
  validate?: (value: string, row: R) => string | null;
};

/** Brouillons : clé de ligne → clé de colonne → valeur saisie. */
export type Drafts = Record<string, Record<string, string>>;

/** Remplissage vers le bas : la première valeur recopiée telle quelle. */
export function fillDown(values: readonly string[]): string[] {
  return values.map(() => values[0] ?? "");
}

/** Lettre de colonne du repère de cellule (A, B, …). */
const colLetter = (c: number) => String.fromCharCode(65 + c);

type Cursor = { r: number; c: number; r1: number };
/** Cellule en cours d'édition, par clé de ligne : une relecture qui réordonne les lignes ne la déplace pas. */
type Editing = { key: string; c: number; value: string };

export function TableEditor<R>({
  label,
  rows,
  rowKey,
  columns,
  canEdit,
  drafts,
  onDraftsChange,
  firstIndex = 0,
  toolbar,
}: {
  label: string;
  rows: readonly R[];
  rowKey: (row: R) => string;
  columns: readonly TableColumn<R>[];
  /** Ligne modifiable (droits de l'utilisateur sur cette ligne). */
  canEdit: (row: R) => boolean;
  drafts: Drafts;
  onDraftsChange: (next: Drafts) => void;
  /** Numéro de la première ligne affichée, moins un (pagination). */
  firstIndex?: number;
  /** Actions de la page (Enregistrer, Annuler), à droite de la barre. */
  toolbar?: ReactNode;
}) {
  const firstEditable = Math.max(0, columns.findIndex((c) => c.editable));
  const [cur, setCur] = useState<Cursor>({ r: 0, c: firstEditable, r1: 0 });
  const [editing, setEditingState] = useState<Editing | null>(null);
  // Miroir de l'édition : le `blur` qui suit Entrée ou Échap ne réécrit rien.
  const editingRef = useRef<Editing | null>(null);
  const setEditing = (next: Editing | null) => {
    editingRef.current = next;
    setEditingState(next);
  };
  const gridRef = useRef<HTMLTableElement>(null);

  const last = rows.length - 1;
  const r = Math.min(cur.r, Math.max(0, last));
  const r1 = Math.min(cur.r1, Math.max(0, last));
  const lo = Math.min(r, r1);
  const hi = Math.max(r, r1);
  const col = columns[cur.c] ?? columns[0];

  const valueOf = useCallback(
    (row: R, c: TableColumn<R>) => drafts[rowKey(row)]?.[c.key] ?? c.get(row),
    [drafts, rowKey],
  );
  const editableCell = (row: R | undefined, c: TableColumn<R> | undefined) => !!row && !!c?.editable && canEdit(row);

  /** Écrit des valeurs ; une valeur revenue à l'origine retire son brouillon. */
  const write = (cells: { row: R; c: TableColumn<R>; value: string }[]) => {
    const next: Drafts = { ...drafts };
    for (const { row, c, value } of cells) {
      if (!editableCell(row, c)) continue;
      const key = rowKey(row);
      const d = { ...(next[key] ?? {}) };
      if (value === c.get(row)) delete d[c.key];
      else d[c.key] = value;
      if (Object.keys(d).length) next[key] = d;
      else delete next[key];
    }
    onDraftsChange(next);
  };

  const focusGrid = () => setTimeout(() => gridRef.current?.focus(), 0);

  const move = (dr: number, dc: number, extend = false) => {
    if (rows.length === 0) return;
    setCur((p) => {
      if (extend) return { ...p, r1: Math.max(0, Math.min(last, p.r1 + dr)) };
      const nr = Math.max(0, Math.min(last, p.r + dr));
      return { r: nr, c: Math.max(0, Math.min(columns.length - 1, p.c + dc)), r1: nr };
    });
  };

  const startEdit = (initial?: string) => {
    const row = rows[r];
    if (!editableCell(row, col)) return;
    setEditing({ key: rowKey(row), c: cur.c, value: initial ?? valueOf(row, col) });
  };

  const commit = (value: string) => {
    const current = editingRef.current;
    if (!current) return;
    const row = rows.find((x) => rowKey(x) === current.key);
    const c = columns[current.c];
    setEditing(null);
    if (row && c) write([{ row, c, value }]);
  };

  const fill = () => {
    if (hi === lo || !col?.editable) return;
    const range = rows.slice(lo, hi + 1);
    const values = fillDown(range.map((row) => valueOf(row, col)));
    write(range.slice(1).map((row, i) => ({ row, c: col, value: values[i + 1] })));
  };

  const clear = () => {
    if (!col?.editable) return;
    write(rows.slice(lo, hi + 1).map((row) => ({ row, c: col, value: "" })));
  };

  const onGridKey = (e: KeyboardEvent<HTMLTableElement>) => {
    if (editing || e.target !== e.currentTarget) return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "d") {
      e.preventDefault();
      fill();
      return;
    }
    if (meta || e.altKey) return;
    const arrows: Record<string, [number, number]> = {
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const a = arrows[e.key];
    if (a) {
      e.preventDefault();
      move(a[0], a[1], e.shiftKey && a[0] !== 0);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      clear();
    } else if (e.key.length === 1) {
      e.preventDefault();
      startEdit(e.key);
    }
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commit(e.currentTarget.value);
      if (e.key === "Enter") move(e.shiftKey ? -1 : 1, 0);
      else move(0, e.shiftKey ? -1 : 1);
      focusGrid();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setEditing(null);
      focusGrid();
    }
  };

  const n = hi - lo + 1;
  const ref = `${colLetter(cur.c)}${firstIndex + lo + 1}${n > 1 ? `:${colLetter(cur.c)}${firstIndex + hi + 1}` : ""}`;
  const readOnlyCol = !col?.editable;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="rounded-[5px] border border-[var(--border)] bg-[var(--muted)] px-[7px] py-[3px] font-mono text-[11.5px] font-semibold text-[var(--muted-foreground)]">
          {ref}
        </span>
        <span className="text-[var(--foreground)]">
          {col?.title}
          {readOnlyCol && <span className="text-[var(--muted-foreground)]"> · lecture seule</span>}
        </span>
        {n > 1 && <span className="text-[var(--muted-foreground)]">{`${n} cellules`}</span>}
        <span className="flex-1" />
        <button type="button" onClick={fill} disabled={n < 2 || readOnlyCol} className={SMALL_BTN} aria-keyshortcuts="Meta+D Control+D">
          <ArrowDown className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          Remplir vers le bas
        </button>
        {toolbar}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <table
          ref={gridRef}
          role="grid"
          aria-label={label}
          aria-multiselectable="true"
          tabIndex={0}
          onKeyDown={onGridKey}
          className="w-full table-fixed border-separate border-spacing-0 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-inset"
        >
          <colgroup>
            <col className="w-[46px]" />
            {columns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky top-0 z-[2] border-r border-b border-[var(--border)] bg-[var(--muted)]" />
              {columns.map((c, ci) => (
                <th
                  key={c.key}
                  scope="col"
                  className="sticky top-0 z-[2] truncate border-r border-b border-[var(--border)] bg-[var(--muted)] px-2 py-1.5 text-left text-[11px] font-semibold tracking-[0.03em] whitespace-nowrap text-[var(--text-tertiary)] uppercase"
                >
                  {`${colLetter(ci)} · ${c.title}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const key = rowKey(row);
              const dirty = !!drafts[key];
              return (
                <tr key={key}>
                  <td
                    role="rowheader"
                    className="border-r border-b border-[var(--border)] bg-[var(--muted)] pr-1.5 text-right font-mono text-[11px] text-[var(--text-tertiary)]"
                  >
                    {dirty && (
                      <span role="img" aria-label="Modifiée" className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--warning)] align-middle" />
                    )}
                    {firstIndex + ri + 1}
                  </td>
                  {columns.map((c, ci) => {
                    const value = valueOf(row, c);
                    const edit = editableCell(row, c);
                    const inRange = ci === cur.c && ri >= lo && ri <= hi;
                    const active = ci === cur.c && ri === r;
                    const isEditing = editing?.key === key && editing.c === ci;
                    const changed = drafts[key]?.[c.key] !== undefined;
                    const error = changed ? (c.validate?.(value, row) ?? null) : null;
                    return (
                      <td
                        key={c.key}
                        role="gridcell"
                        aria-selected={inRange}
                        aria-readonly={!edit || undefined}
                        aria-invalid={error ? true : undefined}
                        title={error ?? undefined}
                        data-modified={changed || undefined}
                        onMouseDown={(e) => {
                          if (isEditing) return;
                          e.preventDefault();
                          if (editing) commit(editing.value);
                          if (e.shiftKey && ci === cur.c) setCur((p) => ({ ...p, r1: ri }));
                          else setCur({ r: ri, c: ci, r1: ri });
                          gridRef.current?.focus();
                        }}
                        onDoubleClick={() => {
                          if (edit) setEditing({ key, c: ci, value });
                        }}
                        className={cn(
                          "h-[29px] overflow-hidden border-r border-b border-[var(--border)] px-2 text-ellipsis whitespace-nowrap select-none",
                          edit ? "cursor-cell text-[var(--foreground)]" : "cursor-default text-[var(--muted-foreground)]",
                          c.mono && "font-mono text-[11.5px]",
                          changed && "bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]",
                          error && "text-[var(--danger-text)]",
                          inRange && "bg-[var(--accent-soft)] shadow-[inset_0_0_0_1px_var(--accent)]",
                          active && "shadow-[inset_0_0_0_2px_var(--accent)]",
                          isEditing && "p-0",
                        )}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            aria-label={c.title}
                            value={editing.value}
                            spellCheck={false}
                            autoComplete="off"
                            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                            onKeyDown={onInputKey}
                            onBlur={(e) => commit(e.currentTarget.value)}
                            className={cn(
                              "h-[28px] w-full border-0 bg-[var(--card)] px-2 text-[var(--foreground)] outline-none",
                              c.mono && "font-mono text-[11.5px]",
                            )}
                          />
                        ) : c.render ? (
                          c.render(value, row)
                        ) : (
                          value
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
