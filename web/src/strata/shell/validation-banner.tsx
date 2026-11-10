"use client";

/**
 * Bandeau de validation de la coquille « Concevoir » (spec v2 §4.1, maquette
 * `.valbar`) : sous la barre d'outils flottante, les compteurs d'erreurs et
 * d'avertissements du rapport que le synoptique publie
 * (`useTopbarActions().validationReport`). « Voir les contrôles » ouvre la
 * liste du synoptique arkyo (`ValidationPanelContent`, groupée par contrôle)
 * dans un volet flottant à gauche ; un clic sur un problème appelle
 * `onSelectValidationIssue` (la sélection et le cerclage sur le canevas sont
 * ceux du synoptique).
 *
 * Rien hors du synoptique, ni tant qu'aucun rapport n'est publié.
 *
 * « Valider » de la palette ⌘K (`useValidationRequest`) : la liste s'ouvre
 * dès que le synoptique du projet publie son rapport. Sur la vue Générale,
 * qui n'en publie pas (arkyo valide par lieu), c'est l'action « Valider »
 * d'arkyo (`onValidateRack`) qui répond, avec son volet.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  GENERAL_VIEW_ID,
  parseLocationViewId,
} from "@/app/(fullscreen)/project/[id]/synoptique/_components/synoptique-rack-selector";
import { ShieldCheck, X } from "@/components/ui/icons";
import { useWorkspace } from "@/components/editor-shell/hooks/use-workspace";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import { ValidationPanelContent } from "@/components/synoptique/components/validation-panel";
import type { IssueSeverity } from "@/lib/services/rack-validation";
import { cn } from "@/lib/utils";
import { useValidationRequest } from "./project-requests";
import { projectIdOf } from "./tab-nav";

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const DOT: Record<IssueSeverity | "ok", string> = {
  error: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--text-tertiary)",
  ok: "var(--success)",
};

function Dot({ tone }: { tone: keyof typeof DOT }) {
  return <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[tone] }} />;
}

const SMALL_BTN =
  "inline-flex h-7 items-center rounded-md border border-[var(--border)] px-2.5 text-[12px] font-medium text-[var(--foreground)] transition-colors outline-none hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** Vue du synoptique retenue par l'onglet : un lieu (`loc:<id>`), sinon la Générale (comme `loadStoredRackId`). */
function storedView(projectId: string): string {
  try {
    const v = window.localStorage.getItem(`project-${projectId}-synoptique-rack`);
    return parseLocationViewId(v) ? v! : GENERAL_VIEW_ID;
  } catch {
    return GENERAL_VIEW_ID;
  }
}

export function ValidationBanner() {
  const workspace = useWorkspace((s) => s.workspace);
  const report = useTopbarActions((s) => s.validationReport);
  const onSelect = useTopbarActions((s) => s.onSelectValidationIssue);
  const onValidate = useTopbarActions((s) => s.onValidateRack);
  const [listOpen, setListOpen] = useState(false);
  const projectId = projectIdOf(usePathname());
  const requested = useValidationRequest((s) => !!projectId && s.projectId === projectId);

  // Demande de la palette : servie une fois le synoptique prêt.
  useEffect(() => {
    if (!requested || !projectId || workspace !== "synoptic") return;
    if (report) {
      if (useValidationRequest.getState().take(projectId)) setListOpen(true);
    } else if (onValidate && storedView(projectId) === GENERAL_VIEW_ID) {
      if (useValidationRequest.getState().take(projectId)) onValidate();
    }
  }, [requested, projectId, workspace, report, onValidate]);

  if (workspace !== "synoptic" || !report) return null;
  const { error, warning } = report.counts;

  return (
    <>
      <section
        aria-label="Validation"
        data-zone="validation"
        className="absolute top-[60px] z-20 flex -translate-x-1/2 items-center gap-1 rounded-[10px] border border-[var(--border)] bg-[var(--card)] py-[3px] pr-1 pl-2.5 text-[12.5px] whitespace-nowrap shadow-lg"
        style={{ left: "calc((100% - var(--dwo, 0px)) / 2)" }}
      >
        <span className="inline-flex items-center gap-1.5 pr-1.5 text-[var(--muted-foreground)]">
          <ShieldCheck className="h-3.5 w-3.5" />
          <strong className="font-semibold text-[var(--foreground)]">Validation</strong>
        </span>
        {error + warning === 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[var(--foreground)]">
            <Dot tone="ok" />
            Conforme
          </span>
        ) : (
          <>
            {error > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[var(--foreground)] tabular-nums">
                <Dot tone="error" />
                {plural(error, "erreur", "erreurs")}
              </span>
            )}
            <span className={cn("inline-flex items-center gap-1.5 text-[var(--foreground)] tabular-nums", error > 0 && "ml-2")}>
              <Dot tone="warning" />
              {plural(warning, "avertissement", "avertissements")}
            </span>
          </>
        )}
        <span aria-hidden className="mx-1.5 h-[18px] w-px bg-[var(--border)]" />
        <button
          type="button"
          aria-expanded={listOpen}
          onClick={() => setListOpen((o) => !o)}
          className={cn(SMALL_BTN, listOpen && "border-[var(--accent)] bg-[var(--accent-soft)]")}
        >
          {listOpen ? "Masquer les contrôles" : "Voir les contrôles"}
        </button>
      </section>

      {listOpen && (
        <section
          aria-label="Contrôles"
          className="absolute top-[104px] bottom-3 left-3 z-20 flex w-[320px] flex-col overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--card)] shadow-lg"
        >
          <div className="flex h-10 flex-none items-center gap-2 border-b border-[var(--border)] pr-1.5 pl-3">
            <span className="flex-1 text-[13px] font-semibold text-[var(--foreground)]">Contrôles</span>
            <button
              type="button"
              onClick={() => setListOpen(false)}
              aria-label="Fermer les contrôles"
              title="Fermer"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ValidationPanelContent report={report} onSelectIssue={onSelect} />
          </div>
        </section>
      )}
    </>
  );
}
