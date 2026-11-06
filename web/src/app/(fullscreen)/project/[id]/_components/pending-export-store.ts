"use client";

/**
 * Signal « ouvre ton modal d'export » — d'un onglet à l'autre.
 *
 * ── Le besoin ─────────────────────────────────────────────────────────────
 * Depuis le modal Dossier, cliquer l'intitulé d'un document doit conduire à
 * l'export de l'ONGLET correspondant, avec tous ses réglages — et non à un
 * téléchargement direct qui les ignorerait. Or l'éditeur ne monte qu'un onglet
 * à la fois, et chaque onglet possède l'état de son propre modal, en local.
 * Basculer d'onglet ne suffit donc pas : il faut lui dire, à son montage,
 * qu'on l'attend ouvert.
 *
 * ── Pourquoi un store et pas un paramètre d'URL ───────────────────────────
 * L'URL porte déjà `?tab=`. Y ajouter `&export=1` obligerait à le nettoyer
 * après usage, sous peine qu'un rechargement ou un retour arrière rouvre le
 * modal sans qu'on l'ait demandé. Un signal en mémoire se consomme une fois et
 * disparaît — ce qui est exactement sa nature.
 *
 * ── Contrat ───────────────────────────────────────────────────────────────
 * Le poseur bascule l'onglet PUIS pose le signal. Le destinataire le consomme
 * à son montage ou à son changement, et l'efface aussitôt : un signal qui
 * traîne rouvrirait le modal au prochain passage sur l'onglet.
 */

import { useEffect } from "react";
import { create } from "zustand";

import type { ProjectTabId } from "../_editor/tab-bar";

type PendingExportState = {
  /** Onglet dont on attend l'ouverture du modal d'export. */
  pendingExport: ProjectTabId | null;
  requestExport: (tab: ProjectTabId) => void;
  clearExport: () => void;
};

export const usePendingExportStore = create<PendingExportState>((set) => ({
  pendingExport: null,
  requestExport: (tab) => set({ pendingExport: tab }),
  clearExport: () => set({ pendingExport: null }),
}));

/**
 * Côté DESTINATAIRE : ouvre le modal quand le signal désigne cet onglet.
 *
 * À appeler en une ligne depuis le composant qui détient l'état du modal :
 *
 *     usePendingExport("synoptique", () => setExportOpen(true));
 *
 * Le signal est consommé — effacé — au moment où il est honoré.
 */
export function usePendingExport(tab: ProjectTabId, open: () => void): void {
  const pending = usePendingExportStore((s) => s.pendingExport);
  const clear = usePendingExportStore((s) => s.clearExport);
  useEffect(() => {
    if (pending !== tab) return;
    clear();
    open();
    // `open` est une lambda recréée à chaque rendu chez la plupart des
    // appelants : la mettre en dépendance rejouerait l'effet en boucle. C'est
    // le SIGNAL qui déclenche, pas l'identité du callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, tab, clear]);
}
