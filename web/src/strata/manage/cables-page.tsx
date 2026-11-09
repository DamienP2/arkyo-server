"use client";

/**
 * Gérer › Câbles (spec v2 §4.2, §7 « Câblage, numérotation ») :
 *   - liste agrégée de tous les câbles du projet (`useProjectCables`, lue
 *     une fois par `ManageShell` pour tout Gérer), filtrable, paginée
 *     (Review Focus 4 : rendu borné quel que soit le nombre de câbles) ;
 *   - détail du câble sélectionné (`?sel=`) : les deux extrémités dessinées
 *     (câble, puis face de chaque équipement avec son port), type, signal,
 *     couleur, notes, « Voir dans Concevoir », puis « Avancé » replié ;
 *   - mode tableau : numéro, couleur et notes saisis en série (édition en
 *     cellule, remplissage vers le bas), enregistrés par les routes
 *     existantes de modification d'un câble, une requête par ligne modifiée
 *     (`cables-table.tsx`) ; ordre des lignes figé pendant la saisie, et
 *     confirmation avant de quitter la page avec des saisies non
 *     enregistrées. Arkyo ne stocke pas de longueur (Ruling 9).
 *
 * Droits (Review Focus 5) : un câble de contenant se modifie avec
 * `design:write`, un câble entre lieux avec `projects:write` (gardes des
 * routes). Sans droit sur aucune ligne, ni mode tableau ni édition.
 */

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { useTenantPermissionsOptional } from "@/components/tenant-permissions-context";
import { Cable, ChevronLeft, ChevronRight, LayoutGrid, List, MousePointer2, Workflow } from "@/components/ui/icons";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import { cn } from "@/lib/utils";
import { CableDetail, Swatch } from "./cable-detail";
import type { CableRow } from "./cables-model";
import { CablesTable, useCablesSave } from "./cables-table";
import { plural } from "./format";
import { PageHead, Pill, SMALL_BTN } from "./manage-ui";
import type { Drafts } from "./table-editor";
import type { ManageNav, ManageState } from "./use-manage";
import type { ProjectCables } from "./use-project-cables";

/** Lignes par page, en liste comme en tableau. */
export const CABLES_PAGE_SIZE = 200;

// ── Page ────────────────────────────────────────────────────────────────────

type Mode = "liste" | "tableau";

const SEARCH =
  "h-8 w-[260px] rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 text-[12.5px] text-[var(--foreground)] outline-none placeholder:text-[var(--text-tertiary)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function CablesPage({ data, nav, cables }: { data: ManageState; nav: ManageNav; cables: ProjectCables }) {
  const perms = useTenantPermissionsOptional();
  // Sans contexte de droits (hors application), rien n'est masqué, comme la barre de navigation.
  const canRack = !perms || perms.has("design", "write");
  const canProject = !perms || perms.has("projects", "write");
  const canEdit = useCallback((r: CableRow) => (r.kind === "rack" ? canRack : canProject), [canRack, canProject]);
  const rows = cables.rows;
  // Mode tableau seulement si l'utilisateur peut modifier au moins une ligne.
  const editableAny = useMemo(() => !!rows?.some(canEdit), [rows, canEdit]);

  const [mode, setMode] = useState<Mode>("liste");
  const tableMode = mode === "tableau" && editableAny;
  // Ordre figé à l'entrée du mode tableau : une relecture (numéros changés, autre
  // utilisateur) ne déplace ni la plage ni la cellule active sur d'autres câbles.
  const [order, setOrder] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [onlyUnlabelled, setOnlyUnlabelled] = useState(false);
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Drafts>({});

  const switchMode = (m: Mode) => {
    setMode(m);
    setOrder(m === "tableau" && rows ? rows.map((r) => r.id) : null);
  };

  const ordered = useMemo(() => {
    if (!rows || !tableMode || !order) return rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const known = new Set(order);
    return [
      ...order.map((id) => byId.get(id)).filter((r): r is CableRow => !!r),
      // Câbles apparus depuis : à la fin.
      ...rows.filter((r) => !known.has(r.id)),
    ];
  }, [rows, tableMode, order]);

  const saver = useCablesSave({
    rows,
    projectId: data.projectId,
    canEdit,
    drafts,
    setDrafts,
    onSaved: (applied) => {
      cables.applyLocal(applied);
      cables.schedule();
    },
  });
  // Saisie non enregistrée : quitter la page (navigation de Gérer, Concevoir, fermeture) demande confirmation.
  useUnsavedChanges({ dirty: saver.pending > 0, onSave: saver.save, isSaving: saver.saving });

  const unlabelled = rows?.filter((r) => !r.label?.trim()).length ?? 0;
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (ordered ?? []).filter(
        (r) =>
          (!onlyUnlabelled || !r.label?.trim()) &&
          (!q ||
            [r.label, r.from.name, r.to.name, r.type, r.signal?.name, r.scope, r.notes]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q)),
      ),
    [ordered, q, onlyUnlabelled],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / CABLES_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * CABLES_PAGE_SIZE, (current + 1) * CABLES_PAGE_SIZE);
  const selected = rows?.find((r) => r.id === nav.sel) ?? null;

  // Un filtre neuf repart de la première page.
  useEffect(() => setPage(0), [q, onlyUnlabelled]);

  const subtitle =
    rows == null || rows.length === 0
      ? undefined
      : [plural(rows.length, "câble"), unlabelled > 0 ? `${unlabelled} sans numéro` : "tous numérotés"].join(" · ");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title="Câbles"
        subtitle={subtitle}
        actions={
          <>
            <button type="button" onClick={() => nav.goToTab("synoptique")} className={SMALL_BTN}>
              <Workflow className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              Ouvrir le synoptique
            </button>
            {editableAny && <ModeSwitch value={tableMode ? "tableau" : "liste"} onChange={switchMode} />}
          </>
        }
      />

      {cables.error && (
        <div role="alert" className="mx-6 mt-3 flex items-center gap-2 rounded-md border border-[var(--danger)] px-3 py-2 text-[12.5px] text-[var(--danger-text)]">
          <span className="flex-1">{rows ? `Liste non actualisée : ${cables.error}` : cables.error}</span>
          <button type="button" onClick={cables.reload} className={SMALL_BTN}>
            Réessayer
          </button>
        </div>
      )}

      {rows == null ? (
        cables.error ? null : <LoadingState className="flex-1" />
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8">
          <EmptyState icon={<Cable strokeWidth={1.5} />} title="Aucun câble" />
        </div>
      ) : (
        <>
          <div className="flex flex-none flex-wrap items-center gap-2 px-6 pt-3.5 pb-2.5">
            <input
              type="search"
              aria-label="Filtrer les câbles"
              placeholder="Filtrer les câbles"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              className={SEARCH}
            />
            <button
              type="button"
              aria-pressed={onlyUnlabelled}
              onClick={() => setOnlyUnlabelled((v) => !v)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                onlyUnlabelled
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
              )}
            >
              {`Sans numéro · ${unlabelled}`}
            </button>
            <span className="flex-1" />
            <Pager page={current} pages={pages} total={filtered.length} onPage={setPage} />
          </div>

          {tableMode ? (
            <section aria-label="Saisie des câbles" className="flex min-h-0 flex-1 flex-col px-6 pb-6">
              <CablesTable
                rows={shown}
                firstIndex={current * CABLES_PAGE_SIZE}
                canEdit={canEdit}
                drafts={drafts}
                onDraftsChange={setDrafts}
                saver={saver}
              />
            </section>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_clamp(340px,32vw,420px)]">
              <section aria-label="Liste des câbles" className="min-w-0 overflow-auto px-6 pb-24">
                {filtered.length === 0 ? (
                  <EmptyState icon={<Cable strokeWidth={1.5} />} title="Aucun câble ne correspond au filtre" />
                ) : (
                  <CableList rows={shown} nav={nav} />
                )}
              </section>
              <aside aria-label="Détail" className="min-w-0 overflow-auto border-l border-[var(--border)] bg-[var(--card)]">
                {selected ? (
                  <CableDetail key={selected.id} row={selected} nav={nav} />
                ) : (
                  <EmptyState icon={<MousePointer2 strokeWidth={1.5} />} title="Aucune sélection" />
                )}
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ModeSwitch({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const items: { id: Mode; label: string; icon: ReactNode }[] = [
    { id: "liste", label: "Liste", icon: <List /> },
    { id: "tableau", label: "Tableau", icon: <LayoutGrid /> },
  ];
  return (
    <span role="group" aria-label="Affichage" className="inline-flex rounded-md border border-[var(--border)] bg-[var(--muted)] p-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={value === it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-[3px] text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [&_svg]:h-3.5 [&_svg]:w-3.5",
            value === it.id
              ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </span>
  );
}

function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  const from = total === 0 ? 0 : page * CABLES_PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * CABLES_PAGE_SIZE);
  const fmt = (n: number) => n.toLocaleString("fr-FR");
  return (
    <nav aria-label="Pages" className="flex items-center gap-1.5 text-[12px] text-[var(--muted-foreground)]">
      <span>{pages > 1 ? `${fmt(from)}–${fmt(to)} sur ${fmt(total)}` : `${fmt(total)} affichés`}</span>
      {pages > 1 && (
        <>
          <button
            type="button"
            aria-label="Page précédente"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
            className={cn(SMALL_BTN, "px-1.5")}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Page suivante"
            disabled={page >= pages - 1}
            onClick={() => onPage(page + 1)}
            className={cn(SMALL_BTN, "px-1.5")}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </nav>
  );
}

// ── Liste ───────────────────────────────────────────────────────────────────

const CELL = "overflow-hidden border-t border-[var(--border)] px-3 py-[7px] text-ellipsis whitespace-nowrap";
const HEAD = "px-3 py-2 text-left text-[11px] font-semibold tracking-[0.03em] text-[var(--text-tertiary)] uppercase";


function CableList({ rows, nav }: { rows: readonly CableRow[]; nav: ManageNav }) {
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--card)]">
      <table aria-label="Câbles" className="w-full table-fixed border-collapse text-[12.5px]">
        <colgroup>
          <col className="w-[110px]" />
          <col />
          <col />
          <col className="w-[18%]" />
          <col className="w-[16%]" />
          <col className="w-[104px]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>N°</th>
            <th scope="col" className={HEAD}>De</th>
            <th scope="col" className={HEAD}>Vers</th>
            <th scope="col" className={HEAD}>Type</th>
            <th scope="col" className={HEAD}>Lieu</th>
            <th scope="col" className={HEAD}>
              <span className="sr-only">État</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const on = r.id === nav.sel;
            const open = () => nav.select(r.id);
            return (
              <tr
                key={r.id}
                tabIndex={0}
                aria-current={on ? "true" : undefined}
                onClick={open}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open();
                  }
                }}
                className={cn(
                  "cursor-pointer outline-none hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)]",
                  on && "bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)]",
                )}
              >
                <td className={cn(CELL, "font-mono text-[11.5px]")}>
                  <span className="inline-flex items-center gap-1.5">
                    <Swatch color={r.color ?? r.signal?.color} />
                    {r.label?.trim() ? (
                      <strong className="font-semibold text-[var(--foreground)]">{r.label}</strong>
                    ) : (
                      <span className="text-[var(--text-tertiary)]">—</span>
                    )}
                  </span>
                </td>
                <td className={CELL}>{r.from.name}</td>
                <td className={CELL}>{r.to.name}</td>
                <td className={cn(CELL, "text-[var(--muted-foreground)]")}>{r.type}</td>
                <td className={cn(CELL, "text-[var(--muted-foreground)]")}>{r.scope}</td>
                <td className={cn(CELL, "text-right")}>{!r.label?.trim() && <Pill tone="warn">sans numéro</Pill>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
