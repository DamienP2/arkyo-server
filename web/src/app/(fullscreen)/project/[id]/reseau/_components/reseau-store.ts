// arkyo-server: bouchon phase 5, remplacé par la copie d'arkyo
// (arkyo:app/(fullscreen)/project/[id]/reseau/_components/reseau-store.ts).
// Sous-ensemble du store qu'utilise project-editor.tsx (:322-323) : la section
// active, pilotée par le menu « Réseau » des onglets, persistée sous la même
// clé (`reseau-store`) que le store d'arkyo, qui la relira en phase 5.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ReseauSection =
  | "devices"
  | "ipmap"
  | "addressing2110"
  | "addressingDmx"
  | "configuration";

export type ReseauStore = {
  /** Section active dans l'onglet Réseau. */
  activeSection: ReseauSection;
  setActiveSection: (s: ReseauSection) => void;
};

export const useReseauStore = create<ReseauStore>()(
  persist(
    (set) => ({
      activeSection: "ipmap",
      setActiveSection: (s) => set({ activeSection: s }),
    }),
    {
      name: "reseau-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ activeSection: state.activeSection }),
    },
  ),
);
