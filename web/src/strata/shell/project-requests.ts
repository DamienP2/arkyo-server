/**
 * Demandes adressées à l'éditeur projet depuis la palette ⌘K (interface
 * Strata v2). La palette vit dans la topbar : elle n'a ni l'état de
 * l'éditeur, ni le bandeau de validation. Elle pose une demande pour un
 * projet puis navigue ; le composant qui sait la servir la consomme une fois
 * monté :
 *   - « Valider » : le bandeau de validation de Concevoir (`validation-banner`)
 *     ouvre sa liste des contrôles dès que le synoptique a publié son rapport ;
 *   - « Ajouter du matériel » : l'espace Gérer (`ManageShell`), qui tient le
 *     rappel de l'éditeur (`onOpenCatalogue`), ouvre l'outil Équipements de
 *     l'Inventaire, comme « Ajouter du catalogue » de Gérer › Matériel.
 */

import { create } from "zustand";

type ProjectRequest = {
  /** Projet visé (`null` : aucune demande en attente). */
  projectId: string | null;
  request: (projectId: string) => void;
  /** Consomme la demande de `projectId` ; `true` si elle était en attente. */
  take: (projectId: string) => boolean;
};

function requestStore() {
  return create<ProjectRequest>((set, get) => ({
    projectId: null,
    request: (projectId) => set({ projectId }),
    take: (projectId) => {
      if (get().projectId !== projectId) return false;
      set({ projectId: null });
      return true;
    },
  }));
}

/** « Valider » : ouvrir la liste des contrôles du synoptique. */
export const useValidationRequest = requestStore();

/** « Ajouter du matériel » : ouvrir l'outil Équipements de l'Inventaire. */
export const useAddEquipmentRequest = requestStore();
