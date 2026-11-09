"use client";

/**
 * « Voir dans le rack » (carte Faces du tiroir, interface Strata) : passe en
 * mode Racks sur le contenant de l'équipement.
 *
 * L'onglet Rack de l'éditeur ne lit son contenant que dans son propre état
 * (`rackSelectedRackId` de `ProjectEditor`, pas d'URL). Le synoptique pose ici
 * le contenant voulu puis bascule sur l'onglet (`useGoToProjectTab`, même
 * logique que `handleTabChange`) ; le tiroir du mode Racks
 * (`StrataRackDrawerTop`) le consomme à son montage, comme le signal
 * d'export (`pending-export-store.ts`) : un signal en mémoire, effacé une fois
 * honoré.
 */

import { create } from "zustand";

export type RackFocus = { projectId: string; rackId: string };

type RackFocusState = {
  focus: RackFocus | null;
  request: (focus: RackFocus) => void;
  clear: () => void;
};

export const useRackFocusStore = create<RackFocusState>((set) => ({
  focus: null,
  request: (focus) => set({ focus }),
  clear: () => set({ focus: null }),
}));
