"use client";

import {
  Download,
  Hash,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  History,
} from "@/components/ui/icons";
import { useTopbarActions } from "./topbar-actions-context";

export interface SynopticActionsBarProps {
  onExportPdf: () => void;
  onRenumber: () => void;
  activePanel?: string | null;
}

function ActionBtn({
  title,
  icon,
  onClick,
  danger = false,
  active = false,
}: {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  const base =
    "flex h-9 w-9 items-center justify-center rounded-md transition-colors active:scale-95";
  const state = active
    ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata (accent sur l'accent à 14 % : --accent-strong)
    : danger
      ? "text-[var(--danger-text)]/70 hover:bg-[color-mix(in_srgb,var(--destructive)_14%,transparent)] hover:text-[var(--danger-text)]" // arkyo-server: habillage Strata (danger : --danger-text)
      : "text-muted-foreground hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-foreground";
  return (
    <button type="button" title={title} onClick={onClick} className={`${base} ${state}`}>
      {icon}
    </button>
  );
}

function Separator() {
  return <div className="bg-border/70 mx-1 h-5 w-px" />;
}

export function SynopticActionsBar({
  onExportPdf,
  onRenumber,
  activePanel = null,
}: SynopticActionsBarProps) {
  const onValidateRack = useTopbarActions((s) => s.onValidateRack);
  const errCount = useTopbarActions((s) => s.validationErrorCount);
  const warnCount = useTopbarActions((s) => s.validationWarningCount);
  const infoCount = useTopbarActions((s) => s.validationInfoCount);
  const onToggleAuditPanel = useTopbarActions((s) => s.onToggleAuditPanel);
  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5">
      <ActionBtn
        title="Exporter"
        // `Download` : même icône que le déclencheur d'export des autres
        // onglets (Rack, Inventaire). Un seul geste, un seul symbole.
        icon={<Download className="h-4 w-4" />}
        onClick={onExportPdf}
        active={activePanel === "pdf"}
      />
      <Separator />
      <ActionBtn
        title="Numérotation"
        icon={<Hash className="h-4 w-4" />}
        onClick={onRenumber}
        active={activePanel === "renumber"}
      />
      <ActionBtn
        title="Historique des actions"
        icon={<History className="h-4 w-4" />}
        onClick={() => onToggleAuditPanel?.()}
        active={activePanel === "audit"}
      />
      <Separator />
      <ActionBtn
        title="Validation synoptique"
        icon={<ShieldCheck className="h-4 w-4" />}
        onClick={() => onValidateRack?.()}
        active={activePanel === "validation"}
      />
      <div className="flex items-center gap-1 px-1">
        {errCount === 0 && warnCount === 0 && infoCount === 0 ? (
          <span
            title="Aucun problème détecté"
            // arkyo-server: habillage Strata (succès : --success, texte en --success-text)
            className="flex items-center gap-1 rounded-full bg-[var(--success)]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--success-text)]"
          >
            <CheckCircle2 className="h-3 w-3" />
            OK
          </span>
        ) : (
          <>
            {errCount > 0 && (
              <span
                title={`${errCount} erreur(s)`}
                // arkyo-server: habillage Strata (erreur : --danger, texte en --danger-text)
                className="bg-[var(--danger)]/15 text-[var(--danger-text)] flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
              >
                <AlertCircle className="h-3 w-3" />
                {errCount}
              </span>
            )}
            {warnCount > 0 && (
              <span
                title={`${warnCount} alerte(s)`}
                // arkyo-server: habillage Strata (alerte : --warning, texte en --warning-text)
                className="flex items-center gap-0.5 rounded-full bg-[var(--warning)]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--warning-text)]"
              >
                <AlertTriangle className="h-3 w-3" />
                {warnCount}
              </span>
            )}
            {infoCount > 0 && (
              <span
                title={`${infoCount} information(s)`}
                // arkyo-server: habillage Strata (information : accent, texte en --accent-strong)
                className="flex items-center gap-0.5 rounded-full bg-[var(--accent)]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent-strong)]"
              >
                <Info className="h-3 w-3" />
                {infoCount}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
