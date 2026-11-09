"use client";

/**
 * Pages de Gérer pas encore bâties ou pas encore portées (spec v2 §4.2) :
 *   - Réseau (phase 5), Livraison et Dossier (phase 6) : `ComingSoon`, la
 *     même phrase qu'en Classique (« Bientôt disponible ») ;
 *   - Câbles : la liste agrégée arrive à l'étape suivante (tâche 6) ; en
 *     attendant, le câblage et la numérotation restent dans le synoptique.
 */

import { ComingSoon } from "@/components/coming-soon";
import { EmptyState } from "@/components/ui/empty-state";
import { Cable, Workflow } from "@/components/ui/icons";
import { PageHead, SMALL_BTN } from "./manage-ui";
import type { ManageNav } from "./use-manage";

export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <PageHead title={title} />
      <div className="flex flex-1 items-center justify-center px-8">
        <ComingSoon />
      </div>
    </div>
  );
}

export function CablesStubPage({ nav }: { nav: ManageNav }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <PageHead title="Câbles" />
      <div className="flex flex-1 items-center justify-center px-8">
        <EmptyState
          icon={<Cable strokeWidth={1.5} />}
          title="Liste des câbles à venir"
          description="Le câblage et la numérotation se font dans le synoptique."
          action={
            <button type="button" onClick={() => nav.goToTab("synoptique")} className={SMALL_BTN}>
              <Workflow className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              Ouvrir le synoptique
            </button>
          }
        />
      </div>
    </div>
  );
}
