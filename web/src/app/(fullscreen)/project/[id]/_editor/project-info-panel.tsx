"use client";

/**
 * ProjectInfoPanel — panel droit du shell projet.
 *
 * Toutes les infos projet (statut, intervention, nom, client, lieu,
 * description, type de construction, dates) ont été déplacées :
 *  - Statut → topbar globale (dropdown coloré)
 *  - Autres champs → onglet « Fiche » du projet
 *
 * Le panel reste monté pour conserver la structure du shell ; il accueillera
 * les futures informations contextuelles (sélection active, alertes…).
 * La signature des props est conservée pour ne pas casser les appelants.
 */

import { type ProjectStatus } from "./project-header-block";
import type { ProjectFicheData } from "../fiche/fiche-client";

export function ProjectInfoPanel({
  fiche: _fiche,
  status: _status,
  onStatusChange: _onStatusChange,
}: {
  fiche: ProjectFicheData;
  status: ProjectStatus;
  onStatusChange: (status: ProjectStatus) => void | Promise<void>;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p
          className="text-muted-foreground/60 text-center text-[11px] italic"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Aucune sélection
        </p>
      </div>
    </div>
  );
}
