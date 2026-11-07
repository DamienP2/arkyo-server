"use client";

/**
 * Onglet « Contrôles » du dock bas Strata : problèmes d'un rapport
 * `validateRack()` (contenant de l'onglet Rack, ou rapport publié par le
 * synoptique), erreurs d'abord. Un clic sur un problème sélectionne l'objet
 * en cause (rappel de l'appelant).
 *
 * Portée de la maquette (`renderBottom`, `.checks`) : pastille de sévérité,
 * élément en cause, message, chevron.
 */

import type { ReactNode } from "react";
import { CheckCircle, ChevronRight } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import type { IssueSeverity, ValidationIssue, ValidationReport } from "@/lib/services/rack-validation";
import { cn } from "@/lib/utils";

const RANK: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Couleur d'état de la sévérité (variables d'interface). */
export const SEVERITY_COLOR: Record<IssueSeverity, string> = {
  error: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--text-tertiary)",
};

const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  error: "Erreur",
  warning: "Avertissement",
  info: "Information",
};

export function SeverityDot({ severity, className }: { severity: IssueSeverity; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      style={{ background: SEVERITY_COLOR[severity] }}
    />
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Compteurs de l'onglet : pastilles visibles, libellé complet pour les lecteurs d'écran. */
export function ChecksCount({ counts }: { counts: ValidationReport["counts"] }): ReactNode {
  return (
    <>
      {" "}
      <span className="sr-only">
        {plural(counts.error, "erreur", "erreurs")}, {plural(counts.warning, "avertissement", "avertissements")}
      </span>
      <span aria-hidden className="inline-flex items-center gap-1 text-[11px] tabular-nums text-[var(--muted-foreground)]">
        <SeverityDot severity="error" />
        {counts.error}
        <SeverityDot severity="warning" className="ml-1" />
        {counts.warning}
      </span>
    </>
  );
}

/** Problèmes triés par sévérité (ordre du rapport conservé à sévérité égale). */
export function sortedIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => RANK[a.issue.severity] - RANK[b.issue.severity] || a.i - b.i)
    .map((x) => x.issue);
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ");

export function ChecksTab({
  report,
  onSelectIssue,
}: {
  /** `null` pendant le chargement. */
  report: ValidationReport | null;
  onSelectIssue?: (issue: ValidationIssue) => void;
}) {
  if (!report) return <LoadingState className="py-8" />;
  if (report.issues.length === 0) {
    return <EmptyState icon={<CheckCircle strokeWidth={1.5} />} title="Aucun problème" className="py-8" />;
  }
  return (
    <ul aria-label="Contrôles" className="divide-y divide-[var(--border)]">
      {sortedIssues(report.issues).map((issue) => {
        const content = (
          <>
            <SeverityDot severity={issue.severity} />
            <span className="sr-only">{SEVERITY_LABEL[issue.severity]} :</span>
            {issue.subject && (
              <span className="max-w-[40%] shrink-0 truncate font-medium text-[var(--foreground)]">
                {oneLine(issue.subject)}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[var(--muted-foreground)]">{oneLine(issue.message)}</span>
          </>
        );
        return (
          <li key={issue.id} data-severity={issue.severity}>
            {onSelectIssue ? (
              <button
                type="button"
                onClick={() => onSelectIssue(issue)}
                title={oneLine(`${issue.subject ? `${issue.subject} — ` : ""}${issue.message}`)}
                className="flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-[12.5px] transition-colors outline-none hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)]"
              >
                {content}
                <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
              </button>
            ) : (
              <div className="flex items-center gap-2.5 px-3.5 py-1.5 text-[12.5px]">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
