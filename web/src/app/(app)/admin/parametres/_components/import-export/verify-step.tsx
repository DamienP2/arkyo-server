"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { RefreshCw, Upload } from "@/components/ui/icons";
import { coerceField } from "@/lib/services/import/coerce";
import type { TargetField } from "@/lib/services/import/detect-columns";

import type { ImportWizard } from "./use-import-wizard";
import { Stat } from "./report-step";
import {
  FIELD_LABEL,
  REQUIRED_FIELDS,
  type DedupPolicy,
  type ExistingRef,
  type RefDecision,
  type RowPreview,
} from "./types";

type ProblemFilter = "all" | "dup" | "err";

function cellError(field: TargetField, value: string): string | null {
  const { error } = coerceField(field, value);
  if (error) return error;
  if (REQUIRED_FIELDS.includes(field) && value.trim() === "") return "Requis";
  return null;
}

/** Étape Vérification : preview, résolution des réfs, corrections par ligne. */
export function VerifyStep({ w }: { w: ImportWizard }) {
  const { preview, analysis, busy, rows, columns, dedupPolicy, perRowOverrides } = w;
  const [filter, setFilter] = useState<ProblemFilter>("all");

  const nameColIndex = useMemo(
    () => columns.find((c) => c.field === "name")?.index ?? null,
    [columns],
  );
  const colByField = useMemo(() => {
    const m = new Map<TargetField, number>();
    for (const c of columns) m.set(c.field, c.index);
    return m;
  }, [columns]);

  const rowName = (r: RowPreview): string => {
    if (nameColIndex == null) return "";
    return (rows[r.row]?.[nameColIndex] ?? "").trim() || "(sans nom)";
  };

  const problemRows = useMemo(
    () =>
      (preview?.rows ?? []).filter(
        (r) => r.status !== "new" || r.cellIssues.length > 0,
      ),
    [preview],
  );

  const dupRows = useMemo(
    () => problemRows.filter((r) => r.status === "duplicate"),
    [problemRows],
  );
  const errRows = useMemo(
    () => problemRows.filter((r) => r.status === "invalid" || r.cellIssues.length > 0),
    [problemRows],
  );

  const filteredRows =
    filter === "dup" ? dupRows : filter === "err" ? errRows : problemRows;

  // Décompte final client (statut + politique globale + overrides).
  const counts = useMemo(() => {
    let created = 0;
    let updated = 0;
    let excluded = 0;
    let errored = 0;
    for (const r of preview?.rows ?? []) {
      const ov = perRowOverrides[r.row];
      if (ov?.skip) {
        excluded += 1;
        continue;
      }
      if (r.status === "invalid") {
        errored += 1;
        continue;
      }
      if (r.status === "new") {
        created += 1;
        continue;
      }
      const pol = ov?.dedup ?? dedupPolicy;
      if (pol === "skip") excluded += 1;
      else if (pol === "update") updated += 1;
      else created += 1;
    }
    return { created, updated, excluded, errored };
  }, [preview, perRowOverrides, dedupPolicy]);

  if (busy && !preview) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-xs text-[var(--muted-foreground)]">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Vérification des lignes…
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="py-16 text-center text-xs text-[var(--muted-foreground)]">
        Aucune donnée à vérifier.
      </div>
    );
  }

  const summary = preview.summary;

  return (
    <div className="space-y-5">
      {/* Tuiles stats */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Nouvelles" value={summary.new} tone="accent" />
        <Stat label="Doublons" value={summary.duplicate} />
        <Stat label="Erreurs" value={summary.invalid} tone={summary.invalid > 0 ? "destructive" : undefined} />
      </div>

      {/* Résolution des références */}
      {analysis &&
        (analysis.refValues.brands.length > 0 || analysis.refValues.categories.length > 0) && (
          <div className="grid gap-4 lg:grid-cols-2">
            {analysis.refValues.brands.length > 0 && (
              <RefResolver
                title="Fabricants"
                values={analysis.refValues.brands}
                existing={analysis.existing.brands}
                decisions={w.refDecisions.brands}
                onChange={(value, decision) =>
                  w.setRefDecisions((prev) => ({
                    ...prev,
                    brands: { ...prev.brands, [value]: decision },
                  }))
                }
              />
            )}
            {analysis.refValues.categories.length > 0 && (
              <RefResolver
                title="Classifications"
                values={analysis.refValues.categories}
                existing={analysis.existing.categories}
                decisions={w.refDecisions.categories}
                onChange={(value, decision) =>
                  w.setRefDecisions((prev) => ({
                    ...prev,
                    categories: { ...prev.categories, [value]: decision },
                  }))
                }
              />
            )}
          </div>
        )}

      {/* Politique de doublon globale */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          En cas de doublon
        </h3>
        <div className="flex gap-1.5">
          {(
            [
              ["skip", "Ignorer"],
              ["update", "Mettre à jour"],
              ["duplicate", "Créer un doublon"],
            ] as [DedupPolicy, string][]
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => w.setDedupPolicy(val)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                dedupPolicy === val
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tableau des lignes à problème */}
      {problemRows.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex gap-1.5">
              {(
                [
                  ["all", `Tous (${problemRows.length})`],
                  ["dup", `Doublons (${dupRows.length})`],
                  ["err", `Erreurs (${errRows.length})`],
                ] as [ProblemFilter, string][]
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setFilter(val)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    filter === val
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {w.previewDirty && (
              <button
                type="button"
                onClick={() => w.runPreview()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--secondary)] disabled:opacity-60"
              >
                <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} />
                Revérifier
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {filteredRows.map((r) => (
              <ProblemRow
                key={r.row}
                r={r}
                name={rowName(r)}
                cellValueOf={(field) => {
                  const idx = colByField.get(field);
                  return idx == null ? "" : rows[r.row]?.[idx] ?? "";
                }}
                onEditCell={(field, value) => {
                  const idx = colByField.get(field);
                  if (idx != null) w.updateCell(r.row, idx, value);
                }}
                canEditName={nameColIndex != null}
                override={perRowOverrides[r.row]}
                onOverride={(patch) => w.setRowOverride(r.row, patch)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Footer sticky */}
      <div className="sticky bottom-0 -mx-8 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--background)] px-8 py-3">
        <div className="text-[11px] text-[var(--muted-foreground)]">
          {counts.created} seront créées, {counts.updated} mises à jour, {counts.excluded} exclues
          {counts.errored > 0 && (
            // arkyo-server: habillage Strata
            <span className="text-[var(--danger-text)]"> · {counts.errored} en erreur</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => w.goToStep("map")}
            disabled={busy}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
          >
            Retour
          </button>
          <button
            type="button"
            onClick={() => w.runCommit()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-[var(--accent-foreground)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {busy ? "Import…" : "Importer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Ligne à problème ──────────────────────────────────────────────────────────

function ProblemRow({
  r,
  name,
  cellValueOf,
  onEditCell,
  canEditName,
  override,
  onOverride,
}: {
  r: RowPreview;
  name: string;
  cellValueOf: (field: TargetField) => string;
  onEditCell: (field: TargetField, value: string) => void;
  canEditName: boolean;
  override: { dedup?: DedupPolicy; skip?: boolean } | undefined;
  onOverride: (patch: { dedup?: DedupPolicy; skip?: boolean }) => void;
}) {
  const skipped = !!override?.skip;

  // Cellules éditables : issues déclarées, ou nom pour une ligne invalide sans issue.
  const editableFields: { field: TargetField; message: string }[] =
    r.cellIssues.length > 0
      ? r.cellIssues.map((i) => ({ field: i.field, message: i.message }))
      : r.status === "invalid" && canEditName
        ? [{ field: "name", message: r.reason ?? "Valeur invalide" }]
        : [];

  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2",
        skipped && "opacity-50",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-[var(--muted-foreground)]">
          L{r.row + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
        <StatusBadge r={r} />

        {/* Politique par ligne (doublon uniquement) */}
        {r.status === "duplicate" && (
          <select
            value={override?.dedup ?? ""}
            onChange={(e) =>
              onOverride({ dedup: e.target.value === "" ? undefined : (e.target.value as DedupPolicy) })
            }
            className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[11px]"
          >
            <option value="">Suivre le réglage global</option>
            <option value="skip">Ignorer</option>
            <option value="update">Mettre à jour</option>
            <option value="duplicate">Dupliquer</option>
          </select>
        )}

        {/* Exclure */}
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <input
            type="checkbox"
            checked={skipped}
            onChange={(e) => onOverride({ skip: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-[var(--border)]"
          />
          Exclure
        </label>
      </div>

      {/* Mention du doublon */}
      {r.status === "duplicate" && (
        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
          {r.matchRow != null
            ? `Doublon de la ligne ${r.matchRow + 1} du fichier`
            : r.match
              ? `Existe déjà : ${r.match.name}${r.match.reference ? ` (${r.match.reference})` : ""}`
              : "Doublon détecté"}
        </p>
      )}

      {/* Cellules fautives éditables */}
      {editableFields.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {editableFields.map(({ field, message }) => {
            const value = cellValueOf(field);
            const err = cellError(field, value);
            return (
              <label key={field} className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  {FIELD_LABEL[field]}
                </span>
                <input
                  value={value}
                  onChange={(e) => onEditCell(field, e.target.value)}
                  className={cn(
                    "w-40 rounded-md border bg-[var(--background)] px-2 py-1 text-[11px]",
                    err
                      ? "border-[var(--destructive)]"
                      : "border-[var(--border)]",
                  )}
                />
                <span
                  className={cn(
                    "text-[10px]",
                    err ? "text-[var(--danger-text)]" : "text-[var(--muted-foreground)]/70", // arkyo-server: habillage Strata
                  )}
                >
                  {err ?? message}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ r }: { r: RowPreview }) {
  const label =
    r.status === "invalid" ? "Erreur" : r.status === "duplicate" ? "Doublon" : "À corriger";
  const tone =
    r.status === "invalid"
      ? "border-[var(--destructive)]/30 bg-[var(--destructive)]/10 text-[var(--danger-text)]" // arkyo-server: habillage Strata
      : r.status === "duplicate"
        // arkyo-server: habillage Strata
        ? "border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning-text)]"
        : "border-[var(--border)] bg-[var(--secondary)] text-[var(--muted-foreground)]";
  return (
    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium", tone)}>
      {label}
    </span>
  );
}

// ── Résolution d'une famille de références (fabricants / classifications) ──────

function RefResolver({
  title,
  values,
  existing,
  decisions,
  onChange,
}: {
  title: string;
  values: string[];
  existing: ExistingRef[];
  decisions: Record<string, RefDecision>;
  onChange: (value: string, decision: RefDecision) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title}
      </h3>
      <div className="space-y-1.5">
        {values.map((value) => {
          const decision = decisions[value] ?? { action: "create" as const };
          const selectValue = decision.action === "link" ? `link:${decision.id}` : "create";
          return (
            <div
              key={value}
              className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{value}</span>
              <select
                value={selectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "create") onChange(value, { action: "create" });
                  else onChange(value, { action: "link", id: v.slice("link:".length) });
                }}
                className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
              >
                <option value="create">Créer « {value} »</option>
                {existing.map((e) => (
                  <option key={e.id} value={`link:${e.id}`}>
                    Rattacher à {e.name} ({e.source === "arkyo" ? "Arkyo" : "Espace"})
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
