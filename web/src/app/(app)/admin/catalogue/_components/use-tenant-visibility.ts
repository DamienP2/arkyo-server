"use client";

/**
 * Hooks de visibilité pour les panels du catalogue tenant.
 *
 * `useShowArkyoCatalogue` — toggle « Catalogue Arkyo » de la toolbar (liste
 * unifiée). ON (défaut) : les items Arkyo purs sont mêlés aux items du
 * tenant. OFF : seuls les items du tenant (persos, duplications, forks)
 * restent visibles. Clé localStorage **globale**, partagée par les 3
 * familles (Équipements / Cordons / Adaptateurs).
 *
 * `useShowLockedItems` — booléen pour le toggle "Afficher hors plan".
 * Quand activé, les items Arkyo dont `isAccessible === false` sont affichés
 * avec un overlay lock + opacity 40 au lieu d'être filtrés.
 *
 * Migration : l'ancien mode exclusif "personal" / "arkyo"
 * (`arkyo:tenant-catalogue:mode:*`) a disparu avec les sous-onglets — les
 * clés legacy sont purgées silencieusement au premier mount.
 */

import { useCallback, useEffect, useState } from "react";

/** @deprecated Conservé pour `visibility-toggle.tsx` (dernier consommateur — `CatalogueSubTabs` supprimé). */
export type TenantCatalogueMode = "personal" | "arkyo";

const SHOW_ARKYO_STORAGE_KEY = "arkyo:tenant-catalogue:show-arkyo";
const LEGACY_MODE_STORAGE_PREFIX = "arkyo:tenant-catalogue:mode:";
// arkyo-server: clé `show-locked` retirée avec `useShowLockedItems` (pas de plan).

/**
 * Toggle global « Catalogue Arkyo » — affiche/masque les items Arkyo purs
 * dans la liste unifiée. Actif par défaut.
 *
 * @returns [showArkyo, setShowArkyo]
 */
export function useShowArkyoCatalogue(): [boolean, (next: boolean) => void] {
  const [showArkyo, setShowArkyoState] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(SHOW_ARKYO_STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  });

  // Purge des clés du mode exclusif legacy (sous-onglets supprimés).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      for (const section of ["equipment", "cables", "adapters"]) {
        window.localStorage.removeItem(`${LEGACY_MODE_STORAGE_PREFIX}${section}`);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SHOW_ARKYO_STORAGE_KEY, showArkyo ? "true" : "false");
    } catch {
      /* quota — ignore */
    }
  }, [showArkyo]);

  const setShowArkyo = useCallback((next: boolean) => {
    setShowArkyoState(next);
  }, []);

  return [showArkyo, setShowArkyo];
}

// arkyo-server: `useShowLockedItems` (bascule « Afficher hors plan ») retiré :
// pas de plan d'abonnement, aucun item n'est verrouillé.
