"use client";

import { useState } from "react";
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  Cable,
  Plug,
  Square,
  Tag,
  SquareStack,
  Layers,
  Type,
  Link2,
  LinkIcon,
  Box,
} from "@/components/ui/icons";
import type { ValidationIssue, ValidationReport } from "@/lib/services/rack-validation";
import { cn } from "@/lib/utils";

type Props = {
  report: ValidationReport | null;
  onSelectIssue?: (issue: ValidationIssue) => void;
};

/** Contenu du rapport de validation — rendu dans l'overlayPanel du RightPanel
 * (plus de portal/drag standalone : l'overlay gère title + close + animation). */
export function ValidationPanelContent({ report, onSelectIssue }: Props) {
  const [filter, setFilter] = useState<"all" | "error" | "warning" | "info">("all");
  const allIssues = report?.issues ?? [];
  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warning");
  const infos = allIssues.filter((i) => i.severity === "info");
  const clean = allIssues.length === 0;
  const issues = filter === "all" ? allIssues : allIssues.filter((i) => i.severity === filter);

  return (
    <div className="flex h-full flex-col">
      {/* Filtre par sévérité */}
      <div className="flex items-center gap-1 border-b border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2">
        <FilterTab
          label="Tous"
          count={allIssues.length}
          active={filter === "all"}
          onClick={() => setFilter("all")}
          tone="muted"
        />
        <FilterTab
          label="Erreurs"
          count={errors.length}
          active={filter === "error"}
          onClick={() => setFilter("error")}
          tone="error"
        />
        <FilterTab
          label="Alertes"
          count={warnings.length}
          active={filter === "warning"}
          onClick={() => setFilter("warning")}
          tone="warning"
        />
        <FilterTab
          label="Infos"
          count={infos.length}
          active={filter === "info"}
          onClick={() => setFilter("info")}
          tone="info"
        />
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {clean && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--success)]/10 px-3 py-3 text-[var(--success-text)]">
            {/* arkyo-server: habillage Strata (succès : --success, texte en --success-text) */}
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <span className="text-sm">Aucun problème détecté.</span>
          </div>
        )}

        {Array.from(groupByKind(issues).entries()).map(([kind, group]) => (
          <IssueGroup key={kind} kind={kind} issues={group} onSelect={onSelectIssue} />
        ))}
      </div>
    </div>
  );
}

function FilterTab({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone: "muted" | "error" | "warning" | "info";
}) {
  const tones = {
    muted: "text-muted-foreground",
    // arkyo-server: habillage Strata (erreur, alerte, info : --danger-text, --warning-text, --accent-strong)
    error: "text-[var(--danger-text)]",
    warning: "text-[var(--warning-text)]",
    info: "text-[var(--accent-strong)]",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-background shadow-sm" : "hover:bg-[var(--muted)]/40",
        tones[tone],
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 font-mono text-[10px]",
          active ? "bg-[var(--muted)]" : "bg-[var(--muted)]/50",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function groupByKind(issues: ValidationIssue[]): Map<ValidationIssue["kind"], ValidationIssue[]> {
  const order: ValidationIssue["kind"][] = [
    "missing_slot",
    "missing_port",
    "duplicate_label",
    "port_overused",
    "signal_mismatch",
    "panel_partial",
    "orphan_adapter",
    "unlabelled_cable",
    "panel_unused",
    "empty_slot",
    "equipment_unused",
    "empty_zone",
    "unnamed_zone",
  ];
  const map = new Map<ValidationIssue["kind"], ValidationIssue[]>();
  for (const k of order) map.set(k, []);
  for (const i of issues) map.get(i.kind)?.push(i);
  for (const [k, arr] of map) if (arr.length === 0) map.delete(k);
  return map;
}

function IssueGroup({
  kind,
  issues,
  onSelect,
}: {
  kind: ValidationIssue["kind"];
  issues: ValidationIssue[];
  onSelect?: (i: ValidationIssue) => void;
}) {
  const sev = issues[0]?.severity ?? "warning";
  const Icon = iconForKind(kind);
  // arkyo-server: habillage Strata (erreur, alerte, info : --danger, --warning, --accent ; textes en
  // --danger-text, --warning-text, --accent-strong)
  const styles =
    sev === "error"
      ? {
          accent: "text-[var(--danger-text)]",
          bg: "bg-destructive/5",
          bar: "bg-destructive",
          badgeBg: "bg-destructive/20",
        }
      : sev === "warning"
        ? {
            accent: "text-[var(--warning-text)]",
            bg: "bg-[var(--warning)]/5",
            bar: "bg-[var(--warning)]",
            badgeBg: "bg-[var(--warning)]/20",
          }
        : {
            accent: "text-[var(--accent-strong)]",
            bg: "bg-[var(--accent)]/5",
            bar: "bg-[var(--accent)]",
            badgeBg: "bg-[var(--accent)]/20",
          };
  return (
    <div className={cn("overflow-hidden rounded-xl border border-[var(--border)]", styles.bg)}>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className={cn("h-5 w-1 rounded-full", styles.bar)} />
        <Icon className={cn("h-4 w-4", styles.accent)} />
        <span className="flex-1 text-sm font-semibold">{labelForKind(kind)}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-mono text-[11px]",
            styles.badgeBg,
            styles.accent,
          )}
        >
          {issues.length}
        </span>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {issues.map((i) => (
          <IssueRow key={i.id} issue={i} onClick={() => onSelect?.(i)} />
        ))}
      </div>
    </div>
  );
}

function iconForKind(k: ValidationIssue["kind"]) {
  switch (k) {
    case "missing_slot":
      return SquareStack;
    case "missing_port":
      return Plug;
    case "duplicate_label":
      return Tag;
    case "port_overused":
      return LinkIcon;
    case "signal_mismatch":
      return Cable;
    case "unlabelled_cable":
      return Tag;
    case "empty_slot":
      return Square;
    case "orphan_adapter":
      return Plug;
    case "unnamed_zone":
      return Type;
    case "panel_unused":
      return Layers;
    case "panel_partial":
      return Link2;
    case "equipment_unused":
      return Box;
    case "empty_zone":
      return Square;
  }
}

function IssueRow({ issue, onClick }: { issue: ValidationIssue; onClick?: () => void }) {
  const Icon =
    issue.severity === "error" ? AlertCircle : issue.severity === "warning" ? AlertTriangle : Info;
  // arkyo-server: habillage Strata (erreur, alerte, info : --danger-text, --warning-text, --accent-strong)
  const color =
    issue.severity === "error"
      ? "text-[var(--danger-text)]"
      : issue.severity === "warning"
        ? "text-[var(--warning-text)]"
        : "text-[var(--accent-strong)]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]/40",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", color)} />
      <div className="min-w-0 flex-1">
        {issue.subject && (
          <div className="text-muted-foreground text-[11px] whitespace-pre-line">
            {issue.subject}
          </div>
        )}
        <div className="text-foreground text-sm leading-snug whitespace-pre-line">
          {issue.message}
        </div>
      </div>
    </button>
  );
}

function labelForKind(k: ValidationIssue["kind"]): string {
  switch (k) {
    case "missing_slot":
      return "Slot manquant";
    case "missing_port":
      return "Port manquant";
    case "duplicate_label":
      return "Label en doublon";
    case "port_overused":
      return "Port sur-utilisé";
    case "signal_mismatch":
      return "Signal incompatible";
    case "unlabelled_cable":
      return "Câble sans label";
    case "empty_slot":
      return "Slot vide";
    case "orphan_adapter":
      return "Adaptateur non câblé";
    case "unnamed_zone":
      return "Zone sans nom";
    case "panel_unused":
      return "Panel non utilisé";
    case "panel_partial":
      return "Panel partiellement câblé";
    case "equipment_unused":
      return "Équipement non câblé";
    case "empty_zone":
      return "Zone vide";
  }
}
