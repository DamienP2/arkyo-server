"use client";

/**
 * Rapport de validation par projet (interface Strata v2).
 *
 * Le synoptique d'arkyo publie son rapport dans le store GLOBAL du shell
 * (`useTopbarActions().validationReport`), sans dire de quel projet ni de
 * quelle vue il vient, et ne l'efface pas en quittant le projet. Gérer ne le
 * lit donc pas directement : `ValidationRecorder`, monté avec le tiroir du
 * synoptique (Concevoir), note chaque rapport publié pendant que CE projet est
 * ouvert, avec la vue qu'il couvre (`project-<id>-synoptique-rack`, clé de
 * stockage de l'onglet : `loc:<id>` ou `__general__`). Gérer lit le rapport
 * de son projet seulement.
 *
 * Seules les publications faites après le montage sont notées : un rapport
 * resté dans le store depuis un autre projet n'est jamais attribué à celui-ci.
 */

import { useEffect } from "react";
import { create } from "zustand";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import type { ValidationReport } from "@/lib/services/rack-validation";

export type ValidationRecord = {
  projectId: string;
  /** Vue du synoptique couverte (`loc:<id>`, `__general__`, ou `null` inconnue). */
  viewId: string | null;
  /** `null` : le synoptique a retiré son rapport (vue Générale). */
  report: ValidationReport | null;
};

type State = {
  byProject: Record<string, ValidationRecord>;
  record: (r: ValidationRecord) => void;
};

export const useValidationRecordStore = create<State>((set) => ({
  byProject: {},
  record: (r) => set((s) => ({ byProject: { ...s.byProject, [r.projectId]: r } })),
}));

/** Vue courante du synoptique du projet, telle que l'onglet la mémorise. */
function currentView(projectId: string): string | null {
  try {
    return window.localStorage.getItem(`project-${projectId}-synoptique-rack`);
  } catch {
    return null;
  }
}

/** Note les rapports publiés par le synoptique de `projectId` (rien à l'écran). */
export function ValidationRecorder({ projectId }: { projectId: string }) {
  useEffect(
    () =>
      useTopbarActions.subscribe((state, prev) => {
        if (state.validationReport === prev.validationReport) return;
        useValidationRecordStore
          .getState()
          .record({ projectId, viewId: currentView(projectId), report: state.validationReport });
      }),
    [projectId],
  );
  return null;
}

/** Rapport noté pour `projectId` (`null` : aucun). */
export function useProjectValidation(projectId: string): ValidationRecord | null {
  return useValidationRecordStore((s) => s.byProject[projectId] ?? null);
}
