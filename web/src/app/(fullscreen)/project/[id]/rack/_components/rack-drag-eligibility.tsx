"use client";

/**
 * Éligibilité au dépôt pendant un drag de l'onglet Rack.
 *
 * Règle métier unique : un élément appartient à SON contenant. En affichage
 * par emplacement (plusieurs contenants côte à côte), tous les autres doivent
 * donc être éteints et rendus inertes le temps du drag, plutôt que de laisser
 * viser une cible qui refusera.
 *
 * Le calcul se fait une seule fois, au `onDragStart` du DndContext parent
 * (`rack-tab-client.tsx`), qui est le seul à voir le payload du drag ET le
 * registre des canvases. Module dédié pour éviter un cycle d'imports entre le
 * provider et le canvas multi-contenants qui le consomme.
 */

import { createContext, useContext } from "react";

export type RackDragEligibility = {
  /** `true` tant qu'un drag est en cours. */
  dragging: boolean;
  /**
   * Seul contenant autorisé à recevoir l'élément, ou `null` si celui-ci
   * n'appartient à aucun contenant identifiable (tous restent alors actifs).
   */
  eligibleRackId: string | null;
};

export const IDLE_ELIGIBILITY: RackDragEligibility = {
  dragging: false,
  eligibleRackId: null,
};

export const RackDragEligibilityCtx =
  createContext<RackDragEligibility>(IDLE_ELIGIBILITY);

export function useRackDragEligibility(): RackDragEligibility {
  return useContext(RackDragEligibilityCtx);
}
