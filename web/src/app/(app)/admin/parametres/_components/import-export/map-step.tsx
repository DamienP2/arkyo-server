"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { Check, ChevronRight, FileSpreadsheet } from "@/components/ui/icons";
import {
  ALL_TARGET_FIELDS,
  type TargetField,
} from "@/lib/services/import/detect-columns";

import type { ImportWizard } from "./use-import-wizard";
import {
  FIELD_GROUPS,
  FIELD_LABEL,
  IGNORE,
  type FieldChoice,
} from "./types";

/** Étape Colonnes : mapping colonne → champ, aperçu, récap des champs pourvus. */
export function MapStep({ w }: { w: ImportWizard }) {
  const {
    analysis,
    fileName,
    headers,
    rows,
    columnField,
    setColumnField,
    hasName,
    hasMultipleSheets,
    handleSheet,
  } = w;

  const takenFields = useMemo(() => {
    const set = new Set<TargetField>();
    for (const f of Object.values(columnField)) if (f !== IGNORE) set.add(f);
    return set;
  }, [columnField]);

  if (!analysis) return null;

  const mappedCount = takenFields.size;
  const ignoredCount = headers.length - mappedCount;
  const previewRows = analysis.sampleRows.slice(0, 6);

  return (
    <div className="space-y-5">
      {/* Barre fichier + statut */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <FileSpreadsheet className="h-4 w-4 text-[var(--muted-foreground)]" />
          <span className="font-medium">{fileName}</span>
          <span className="text-[var(--muted-foreground)]">
            · {rows.length} ligne(s) · {mappedCount} colonne(s) associée(s)
            {ignoredCount > 0 && `, ${ignoredCount} ignorée(s)`}
          </span>
        </div>
        {hasMultipleSheets && analysis.sheetNames && (
          <select
            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
            onChange={(e) => handleSheet(e.target.value)}
            defaultValue={analysis.sheetNames[0]}
          >
            {analysis.sheetNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        {/* Grille de mapping */}
        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Associez vos colonnes
          </h3>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {headers.map((header, index) => {
                    const m = analysis.mapping.find((x) => x.index === index);
                    const choice = columnField[index] ?? IGNORE;
                    const ignored = choice === IGNORE;
                    const conf = confidence(
                      m?.suggestedField ? m.score : 0,
                      choice,
                      m?.suggestedField ?? null,
                    );
                    return (
                      <th
                        key={index}
                        className={cn(
                          "min-w-[180px] border-b border-l border-[var(--border)] p-2 align-top first:border-l-0",
                          ignored ? "bg-[var(--secondary)]/40" : "bg-[var(--card)]",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <ConfidenceDot level={conf} />
                          <span
                            className={cn(
                              "truncate text-left font-medium",
                              ignored && "text-[var(--muted-foreground)]",
                            )}
                            title={header}
                          >
                            {header || `Colonne ${index + 1}`}
                          </span>
                        </div>
                        <select
                          value={choice}
                          onChange={(e) =>
                            setColumnField((prev) => ({
                              ...prev,
                              [index]: e.target.value as FieldChoice,
                            }))
                          }
                          className={cn(
                            "mt-1.5 w-full rounded-md border px-2 py-1 text-xs",
                            ignored
                              ? "border-[var(--border)] bg-transparent text-[var(--muted-foreground)]"
                              : "border-[var(--accent)]/40 bg-[var(--background)] font-medium",
                          )}
                        >
                          <option value={IGNORE}>Ignorer cette colonne</option>
                          {ALL_TARGET_FIELDS.map((f) => (
                            <option key={f} value={f} disabled={takenFields.has(f) && choice !== f}>
                              {FIELD_LABEL[f]}
                              {takenFields.has(f) && choice !== f ? " (déjà associé)" : ""}
                            </option>
                          ))}
                        </select>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, r) => (
                  <tr key={r} className="odd:bg-[var(--secondary)]/20">
                    {headers.map((_, index) => {
                      const ignored = (columnField[index] ?? IGNORE) === IGNORE;
                      const val = row[index] ?? "";
                      return (
                        <td
                          key={index}
                          className={cn(
                            "max-w-[280px] truncate border-l border-[var(--border)] px-2 py-1.5 first:border-l-0",
                            ignored ? "text-[var(--muted-foreground)]/50" : "text-[var(--foreground)]",
                          )}
                          title={val}
                        >
                          {val || <span className="text-[var(--muted-foreground)]/40">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!hasName && (
            <p className="mt-2 text-[11px] text-[var(--destructive)]">
              Associez une colonne au champ « Nom » pour pouvoir continuer.
            </p>
          )}
        </div>

        {/* Récap des champs par groupe */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Champs cibles
          </h3>
          <div className="space-y-3">
            {FIELD_GROUPS.map((group) => (
              <div key={group.title}>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]/70">
                  {group.title}
                </p>
                <ul className="space-y-0.5">
                  {group.fields.map((field) => {
                    const provided = takenFields.has(field);
                    return (
                      <li
                        key={field}
                        className={cn(
                          "flex items-center gap-1.5 text-[11px]",
                          provided ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]/60",
                        )}
                      >
                        {provided ? (
                          <Check className="h-3 w-3 text-[var(--accent)]" />
                        ) : (
                          <span className="h-1 w-1 rounded-full bg-[var(--border)]" />
                        )}
                        {FIELD_LABEL[field]}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer sticky */}
      <div className="sticky bottom-0 -mx-8 flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--background)] px-8 py-3">
        <div className="text-[11px] text-[var(--muted-foreground)]">
          {rows.length} ligne(s) · {mappedCount} colonne(s) associée(s)
          {ignoredCount > 0 && `, ${ignoredCount} ignorée(s)`}
        </div>
        <button
          type="button"
          onClick={() => w.goToStep("verify")}
          disabled={w.busy || !hasName}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continuer
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Indicateur de confiance de la détection auto ──────────────────────────────

type Confidence = "high" | "medium" | "none";

function confidence(
  score: number,
  choice: FieldChoice,
  suggested: TargetField | null,
): Confidence {
  if (choice === IGNORE || suggested == null || choice !== suggested) return "none";
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "medium";
  return "none";
}

function ConfidenceDot({ level }: { level: Confidence }) {
  if (level === "none") {
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--border)]" />;
  }
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        // arkyo-server: habillage Strata
        level === "high" ? "bg-[var(--accent)]" : "bg-[var(--warning)]",
      )}
      title={level === "high" ? "Détecté automatiquement" : "Détecté (à vérifier)"}
    />
  );
}
