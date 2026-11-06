"use client";

/**
 * ImportExportPanel — onglet « Importer / Exporter » des Paramètres tenant.
 *
 * Orchestrateur mince : hub d'accueil (Importer / Exporter) puis wizard
 * Fichier → Colonnes → Vérification → Rapport. Toute la logique de parcours
 * vit dans `import-export/use-import-wizard.ts` ; chaque écran est un composant
 * dédié dans `import-export/`.
 */

import { AdminTabLayout } from "../../_components/admin-tab-layout";
import { ArrowDownUp, X } from "@/components/ui/icons";

import { Hub } from "./import-export/hub";
import { MapStep } from "./import-export/map-step";
import { ReportStep } from "./import-export/report-step";
import { Stepper } from "./import-export/stepper";
import { VerifyStep } from "./import-export/verify-step";
import { useImportWizard } from "./import-export/use-import-wizard";
import type { StepperKey } from "./import-export/types";

const STEPPER_KEY: Record<"map" | "verify" | "done", StepperKey> = {
  map: "map",
  verify: "verify",
  done: "done",
};

export function ImportExportPanel() {
  const w = useImportWizard();

  return (
    <AdminTabLayout>
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--secondary)]">
              <ArrowDownUp className="h-4 w-4 text-[var(--foreground)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Importer / Exporter</h2>
              <p className="text-xs text-[var(--muted-foreground)]">
                Sauvegardez votre catalogue ou échangez-le avec un tableur.
              </p>
            </div>
          </div>
          {w.step !== "hub" && (
            <Stepper
              current={STEPPER_KEY[w.step]}
              onStepClick={(key) => w.goToStep(key)}
              disabled={w.busy}
            />
          )}
        </div>

        {w.error && (
          // arkyo-server: habillage Strata
          <div className="flex items-start gap-2 rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-3 py-2 text-xs text-[var(--danger-text)]">
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{w.error}</span>
          </div>
        )}

        {w.step === "hub" && <Hub busy={w.busy} onFile={w.handleFile} />}
        {w.step === "map" && <MapStep w={w} />}
        {w.step === "verify" && <VerifyStep w={w} />}
        {w.step === "done" && w.report && (
          <ReportStep report={w.report} onRestart={w.reset} />
        )}
      </div>
    </AdminTabLayout>
  );
}
