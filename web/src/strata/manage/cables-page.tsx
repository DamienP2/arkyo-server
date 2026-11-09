"use client";

/**
 * Gérer › Câbles (spec v2 §4.2, §7 « Câblage, numérotation ») :
 *   - liste agrégée de tous les câbles du projet (`loadProjectCables`),
 *     filtrable, paginée (Review Focus 4 : rendu borné quel que soit le
 *     nombre de câbles) ; relue une seule fois par salve d'évènements
 *     (anti-rebond de 300 ms), l'ancienne liste restant affichée ;
 *   - détail du câble sélectionné (`?sel=`) : les deux extrémités dessinées
 *     (câble, puis face de chaque équipement avec son port), type, signal,
 *     couleur, notes, « Voir dans Concevoir », puis « Avancé » replié ;
 *   - mode tableau : numéro, couleur et notes saisis en série (édition en
 *     cellule, remplissage vers le bas), enregistrés par les routes
 *     existantes de modification d'un câble, une requête par ligne modifiée.
 *     Arkyo ne stocke pas de longueur (Ruling 9).
 *
 * Droits (Review Focus 5) : un câble de contenant se modifie avec
 * `design:write`, un câble entre lieux avec `projects:write` (gardes des
 * routes). Sans l'un ni l'autre, ni mode tableau ni édition.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { InventaireRack } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { useTenantPermissionsOptional } from "@/components/tenant-permissions-context";
import { Cable, ChevronLeft, ChevronRight, LayoutGrid, List, MousePointer2, RotateCcw, Save, Workflow } from "@/components/ui/icons";
import { api, getApiErrorMessage } from "@/lib/api-client";
import { subscribeAppEvents } from "@/lib/app-events-client";
import { cn } from "@/lib/utils";
import { AdvancedSection } from "../advanced/advanced-section";
import { rackConnectors } from "../bottom/rack-model";
import { CableDrawing, type DrawingGender } from "../drawings/cable-drawing";
import { EquipmentFace, genderLetter } from "../drawings/equipment-face";
import {
  cableCellError,
  cableValue,
  cableWrites,
  isCableEvent,
  loadProjectCables,
  type CableDraft,
  type CableEnd,
  type CableField,
  type CableRackRef,
  type CableRow,
  type CableWrite,
} from "./cables-model";
import { plural } from "./format";
import { Kv, PageHead, Pill, SECTION_LABEL, SMALL_BTN } from "./manage-ui";
import { TableEditor, type Drafts, type TableColumn } from "./table-editor";
import type { ManageNav, ManageState } from "./use-manage";

/** Lignes par page, en liste comme en tableau. */
export const CABLES_PAGE_SIZE = 200;
/** Anti-rebond des relectures sur évènement. */
const RELOAD_DEBOUNCE_MS = 300;
/** Requêtes d'enregistrement simultanées. */
const SAVE_CONCURRENCY = 4;

// ── Données ─────────────────────────────────────────────────────────────────

type CablesState = { rows: CableRow[] | null; error: string | null };

/**
 * Câbles du projet, relus quand les contenants changent et, une seule fois
 * par salve, sur les évènements qui les touchent.
 */
export function useProjectCables(projectId: string, racks: readonly CableRackRef[]) {
  const [state, setState] = useState<CablesState>({ rows: null, error: null });
  const racksRef = useRef(racks);
  racksRef.current = racks;
  const key = racks.map((r) => `${r.id}:${r.locationId ?? ""}:${r.isVirtual ? 1 : 0}`).join(",");
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    const t = ++token.current;
    loadProjectCables(projectId, racksRef.current)
      .then((rows) => {
        if (t === token.current) setState({ rows, error: null });
      })
      .catch((e: unknown) => {
        if (t === token.current) setState((s) => ({ rows: s.rows, error: getApiErrorMessage(e, "Lecture des câbles impossible.") }));
      });
  }, [projectId]);

  // Première lecture, et relecture quand la liste des contenants change.
  useEffect(() => {
    load();
  }, [load, key]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      load();
    }, RELOAD_DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribeAppEvents((data) => {
      if (isCableEvent(data, projectId, racksRef.current.map((r) => r.id))) schedule();
    });
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      // Une lecture en vol n'écrit plus rien.
      token.current += 1;
    };
  }, [projectId, schedule]);

  /** Valeurs enregistrées, appliquées sans attendre la relecture. */
  const applyLocal = useCallback((applied: Map<string, CableDraft>) => {
    setState((s) => ({
      ...s,
      rows:
        s.rows?.map((r) => {
          const d = applied.get(r.id);
          if (!d) return r;
          const next = { ...r };
          for (const f of ["label", "color", "notes"] as const) {
            if (d[f] === undefined) continue;
            const v = f === "notes" ? d[f]! : d[f]!.trim();
            next[f] = v === "" ? null : v;
          }
          return next;
        }) ?? null,
    }));
  }, []);

  return { ...state, reload: load, schedule, applyLocal };
}

// ── Page ────────────────────────────────────────────────────────────────────

type Mode = "liste" | "tableau";

const FIELD_OF: Record<string, CableField> = { label: "label", color: "color", notes: "notes" };

function racksOf(racks: readonly InventaireRack[]): CableRackRef[] {
  return racks.map((r) => ({ id: r.id, name: r.name, locationId: r.locationId ?? null, isVirtual: !!r.isVirtual }));
}

const SEARCH =
  "h-8 w-[260px] rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 text-[12.5px] text-[var(--foreground)] outline-none placeholder:text-[var(--text-tertiary)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function CablesPage({ data, nav }: { data: ManageState; nav: ManageNav }) {
  const racks = useMemo(() => racksOf(data.racks), [data.racks]);
  const cables = useProjectCables(data.projectId, racks);
  const perms = useTenantPermissionsOptional();
  // Sans contexte de droits (hors application), rien n'est masqué, comme la barre de navigation.
  const canRack = !perms || perms.has("design", "write");
  const canProject = !perms || perms.has("projects", "write");
  const canEditAny = canRack || canProject;
  const canEdit = useCallback((r: CableRow) => (r.kind === "rack" ? canRack : canProject), [canRack, canProject]);

  const [mode, setMode] = useState<Mode>("liste");
  const tableMode = mode === "tableau" && canEditAny;
  const [query, setQuery] = useState("");
  const [onlyUnlabelled, setOnlyUnlabelled] = useState(false);
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Drafts>({});

  const rows = cables.rows;
  const unlabelled = rows?.filter((r) => !r.label?.trim()).length ?? 0;
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!onlyUnlabelled || !r.label?.trim()) &&
          (!q ||
            [r.label, r.from.name, r.to.name, r.type, r.signal?.name, r.scope, r.notes]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(q)),
      ),
    [rows, q, onlyUnlabelled],
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
            {canEditAny && rows != null && rows.length > 0 && <ModeSwitch value={tableMode ? "tableau" : "liste"} onChange={setMode} />}
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
                allRows={rows}
                firstIndex={current * CABLES_PAGE_SIZE}
                projectId={data.projectId}
                canEdit={canEdit}
                drafts={drafts}
                onDraftsChange={setDrafts}
                onSaved={(applied) => {
                  cables.applyLocal(applied);
                  cables.schedule();
                }}
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

/** Pastille de la couleur métier du câble (couleur propre, sinon celle du signal). */
function Swatch({ color }: { color: string | null | undefined }) {
  if (!color) return null;
  return <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

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

// ── Détail ──────────────────────────────────────────────────────────────────

const STYLE_LABEL: Record<string, string> = { ortho: "Orthogonal", rounded: "Arrondi", arrow: "Flèches" };

/** Genre de l'extrémité du câble : celui qui s'enfiche sur le port. */
function plugGender(port: string | null): DrawingGender {
  return port === "FEMALE" ? "MALE" : port === "MALE" ? "FEMALE" : "NEUTRAL";
}

function EndBlock({ letter, end, label, row }: { letter: "A" | "B"; end: CableEnd; label: string; row: CableRow }) {
  const eq = end.equipment;
  const face = end.face === "FRONT" || end.face === "REAR" ? end.face : null;
  const connectors = useMemo(() => rackConnectors(eq?.connectors), [eq]);
  const where = [end.rackName, end.locationName].filter(Boolean).join(" · ");
  const connector = end.connectorName ? `${end.connectorName}${end.gender ? ` ${genderLetter(end.gender)}` : ""}` : null;
  return (
    <section aria-label={`Extrémité ${letter}`} className="flex flex-col gap-1.5">
      <span className={SECTION_LABEL}>{`Extrémité ${letter}`}</span>
      <div className="text-[12.5px] font-semibold text-[var(--foreground)]">{end.name}</div>
      {(where || connector) && (
        <div className="text-[12px] text-[var(--muted-foreground)]">
          {[where, connector, face ? (face === "FRONT" ? "face avant" : "face arrière") : null].filter(Boolean).join(" · ")}
        </div>
      )}
      {eq && face && end.portKey && (
        <div className="overflow-hidden rounded-[4px] border border-[var(--border)]">
          <EquipmentFace
            equipment={{
              name: eq.name,
              brand: eq.brand?.name ?? null,
              heightU: eq.heightU,
              isRackable: eq.isRackable !== false,
              dims: [
                (eq as { dimLmm?: number | null }).dimLmm,
                (eq as { dimWmm?: number | null }).dimWmm,
                (eq as { dimHmm?: number | null }).dimHmm,
              ],
              connectors,
            }}
            face={face}
            connectorTypes={row.catalog.connectorTypes}
            signals={row.catalog.signals}
            links={{ [end.portKey]: label }}
            selectedPort={end.portKey}
          />
        </div>
      )}
    </section>
  );
}

function CableDetail({ row, nav }: { row: CableRow; nav: ManageNav }) {
  const label = row.label?.trim() || "";
  const color = row.color ?? row.signal?.color ?? null;
  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-[2] flex flex-col gap-1 border-b border-[var(--border)] bg-[var(--card)] px-[18px] pt-4 pb-3">
        <span className={SECTION_LABEL}>{`Câble${row.signal ? ` · ${row.signal.name}` : ""}`}</span>
        <h2 className="m-0 font-mono text-[17px] font-bold tracking-[-0.01em] text-[var(--foreground)]">
          {label || "Sans numéro"}
        </h2>
        <span className="text-[12.5px] text-[var(--muted-foreground)]">{row.scope}</span>
      </div>
      <div className="flex flex-col gap-3.5 px-[18px] pt-3.5 pb-10">
        <div className="rounded-[4px] border border-[var(--border)] px-2 py-1.5">
          <CableDrawing
            cable={{
              name: label ? `Câble ${label}` : "Câble sans numéro",
              left: { connectorName: row.from.connectorName ?? "—", iconId: row.from.iconId, gender: plugGender(row.from.gender) },
              right: { connectorName: row.to.connectorName ?? "—", iconId: row.to.iconId, gender: plugGender(row.to.gender) },
              color,
            }}
          />
        </div>
        <EndBlock letter="A" end={row.from} label={label || "—"} row={row} />
        <EndBlock letter="B" end={row.to} label={label || "—"} row={row} />

        <Kv
          rows={[
            ["Type", row.type],
            [
              "Signal",
              row.signal ? (
                <span className="inline-flex items-center gap-1.5">
                  <Swatch color={row.signal.color} />
                  {row.signal.name}
                </span>
              ) : (
                "—"
              ),
            ],
            [
              "Couleur",
              row.color ? (
                <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px]">
                  <Swatch color={row.color} />
                  {row.color}
                </span>
              ) : (
                "Celle du signal"
              ),
            ],
            ["Notes", row.notes?.trim() || "—"],
          ]}
        />

        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => nav.goToTab("synoptique")} className={SMALL_BTN}>
            <Workflow className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            Voir dans Concevoir
          </button>
        </div>

        <AdvancedSection kind="cable" summary="Étiquettes, style, faisceau, points de passage">
          <Kv
            rows={[
              [
                "Étiquettes",
                row.tags.length ? (
                  <span className="flex flex-wrap gap-1">
                    {row.tags.map((t, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-px text-[11px]"
                      >
                        <Swatch color={t.color} />
                        {t.text}
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                ),
              ],
              ["Style", row.cableStyle ? (STYLE_LABEL[row.cableStyle] ?? row.cableStyle) : "—"],
              [
                "Faisceau",
                row.bundle ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Swatch color={row.bundle.color} />
                    {row.bundle.name ?? "Faisceau"}
                  </span>
                ) : (
                  "—"
                ),
              ],
              ["Points de passage", String(row.waypoints)],
              ["Portée", row.kind === "project" ? "Entre deux lieux" : "Dans un lieu"],
              ["Identifiant", <span className="font-mono text-[11.5px]">{row.id}</span>],
            ]}
          />
        </AdvancedSection>
      </div>
    </div>
  );
}

// ── Mode tableau ────────────────────────────────────────────────────────────

/** Exécute les écritures, `SAVE_CONCURRENCY` à la fois ; renvoie les échecs par câble. */
async function runWrites(writes: readonly CableWrite[]): Promise<Map<string, string>> {
  const failed = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < writes.length) {
      const w = writes[next++];
      try {
        if (w.method === "PATCH") await api.patch(w.url, w.body);
        else await api.post(w.url, w.body);
      } catch (e) {
        for (const id of w.ids) failed.set(id, getApiErrorMessage(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SAVE_CONCURRENCY, writes.length) }, worker));
  return failed;
}

function CablesTable({
  rows,
  allRows,
  firstIndex,
  projectId,
  canEdit,
  drafts,
  onDraftsChange,
  onSaved,
}: {
  rows: readonly CableRow[];
  allRows: readonly CableRow[];
  firstIndex: number;
  projectId: string;
  canEdit: (r: CableRow) => boolean;
  drafts: Drafts;
  onDraftsChange: (d: Drafts) => void;
  onSaved: (applied: Map<string, CableDraft>) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const byId = useMemo(() => new Map(allRows.map((r) => [r.id, r])), [allRows]);

  const columns = useMemo<TableColumn<CableRow>[]>(() => {
    const field = (f: CableField) => ({
      get: (r: CableRow) => cableValue(r, f),
      editable: true,
      validate: (v: string, r: CableRow) => cableCellError(r, f, v),
    });
    return [
      { key: "label", title: "N°", width: "120px", mono: true, ...field("label") },
      { key: "from", title: "De", get: (r) => r.from.name },
      { key: "to", title: "Vers", get: (r) => r.to.name },
      { key: "type", title: "Type", width: "14%", get: (r) => r.type },
      {
        key: "color",
        title: "Couleur",
        width: "120px",
        mono: true,
        ...field("color"),
        render: (v) =>
          v ? (
            <span className="inline-flex items-center gap-1.5">
              <Swatch color={v} />
              {v}
            </span>
          ) : (
            ""
          ),
      },
      { key: "notes", title: "Notes", width: "22%", ...field("notes") },
    ];
  }, []);

  const pending = Object.entries(drafts).filter(([id]) => byId.has(id));
  const errors = pending.filter(([id, d]) =>
    Object.entries(d).some(([k, v]) => FIELD_OF[k] && cableCellError(byId.get(id)!, FIELD_OF[k], v)),
  ).length;

  const save = async () => {
    const edits = pending
      .map(([id, d]) => ({ row: byId.get(id)!, draft: d as CableDraft }))
      .filter((e) => canEdit(e.row));
    setSaving(true);
    setFailure(null);
    const failed = await runWrites(cableWrites(edits, projectId));
    const applied = new Map<string, CableDraft>();
    const next: Drafts = { ...drafts };
    for (const e of edits) {
      if (failed.has(e.row.id)) continue;
      applied.set(e.row.id, e.draft);
      delete next[e.row.id];
    }
    onDraftsChange(next);
    onSaved(applied);
    setSaving(false);
    if (failed.size > 0) {
      const [first] = failed.values();
      setFailure(`${plural(failed.size, "ligne")} non enregistrée${failed.size > 1 ? "s" : ""} : ${first}`);
    }
  };

  return (
    <>
      {failure && (
        <p role="alert" className="m-0 mb-2 text-[12.5px] text-[var(--danger-text)]">
          {failure}
        </p>
      )}
      <TableEditor
        label="Câbles"
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        canEdit={canEdit}
        drafts={drafts}
        onDraftsChange={onDraftsChange}
        firstIndex={firstIndex}
        toolbar={
          <>
            {pending.length > 0 && (
              <span className="text-[var(--muted-foreground)]">{`${plural(pending.length, "ligne modifiée", "lignes modifiées")}`}</span>
            )}
            <button
              type="button"
              onClick={() => {
                onDraftsChange({});
                setFailure(null);
              }}
              disabled={pending.length === 0 || saving}
              className={SMALL_BTN}
            >
              <RotateCcw className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              Annuler les modifications
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={pending.length === 0 || saving || errors > 0}
              className={SMALL_BTN}
            >
              <Save className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </>
        }
      />
    </>
  );
}
