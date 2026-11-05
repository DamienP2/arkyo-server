"use client";

/**
 * useShowArkyoParametres — toggle « Catalogue Arkyo » de la toolbar des
 * panneaux du tenant dans `/admin/parametres` (liste unifiée).
 *
 * ON (défaut) : les items du référentiel Arkyo sont mêlés aux items du
 * tenant. OFF : seuls les items du tenant restent visibles. Clé localStorage
 * **globale**, partagée par les 5 panels (Fabricants / Classification /
 * Connecteurs / Signaux / Câblage).
 *
 * Différence avec `useShowArkyoCatalogue` (catalogue) : **pas de gating par
 * plan d'abonnement**. Tous les tenants voient tous les items Arkyo, en
 * lecture seule, quel que soit leur plan. Il n'y a donc pas de
 * `useShowLockedItems` frère à ce hook.
 *
 * Migration : l'ancien mode exclusif "personal" / "arkyo"
 * (`tenant.parametres.{section}.mode`) a disparu avec les sous-onglets — les
 * clés legacy sont purgées silencieusement au premier mount.
 *
 * Pattern lazy `useState` initializer — pas de `useRef` (cf. mémoire projet :
 * « useState lazy initializer », les variantes à base de `useRef` causent
 * des bugs subtils sous StrictMode).
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "tenant.parametres.";

const SHOW_ARKYO_STORAGE_KEY = "arkyo:tenant-parametres:show-arkyo";

const LEGACY_MODE_SECTIONS = [
  "brands",
  "categories",
  "connectors",
  "cabling",
  "signals",
  "dimensions",
];

export function useShowArkyoParametres(): [boolean, (next: boolean) => void] {
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
      for (const section of LEGACY_MODE_SECTIONS) {
        window.localStorage.removeItem(`${STORAGE_PREFIX}${section}.mode`);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SHOW_ARKYO_STORAGE_KEY,
        showArkyo ? "true" : "false",
      );
    } catch {
      /* quota — ignore */
    }
  }, [showArkyo]);

  const setShowArkyo = useCallback((next: boolean) => {
    setShowArkyoState(next);
  }, []);

  return [showArkyo, setShowArkyo];
}

/**
 * Vue grille / liste persistée par section.
 *
 * @param section — segment de clé (ex. "brands").
 */
export function useParametresView(
  section: string,
): ["grid" | "list", (next: "grid" | "list") => void] {
  const storageKey = `${STORAGE_PREFIX}${section}.view`;

  const [view, setViewState] = useState<"grid" | "list">(() => {
    if (typeof window === "undefined") return "grid";
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw === "list" || raw === "grid" ? raw : "grid";
    } catch {
      return "grid";
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, view);
    } catch {
      /* ignore */
    }
  }, [storageKey, view]);

  const setView = useCallback((next: "grid" | "list") => {
    setViewState(next);
  }, []);

  return [view, setView];
}

/**
 * Tri (sortBy + direction) persisté par section.
 *
 * Pour les panneaux à un seul critère pertinent (nom), `sortBy` peut être
 * ignoré par l'appelant. On garde la structure ouverte pour préparer la
 * réplication sur les référentiels plus complexes (signaux, connecteurs)
 * où on pourra trier par nom / catégorie / ordre.
 */
export type ParametresSort = { sortBy: string; direction: "asc" | "desc" };

export function useParametresSort(
  section: string,
  defaultSort: ParametresSort = { sortBy: "name", direction: "asc" },
): [ParametresSort, (next: ParametresSort) => void] {
  const storageKey = `${STORAGE_PREFIX}${section}.sort`;

  const [sort, setSortState] = useState<ParametresSort>(() => {
    if (typeof window === "undefined") return defaultSort;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaultSort;
      const parsed = JSON.parse(raw) as Partial<ParametresSort>;
      if (
        typeof parsed?.sortBy === "string" &&
        (parsed?.direction === "asc" || parsed?.direction === "desc")
      ) {
        return { sortBy: parsed.sortBy, direction: parsed.direction };
      }
      return defaultSort;
    } catch {
      return defaultSort;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(sort));
    } catch {
      /* ignore */
    }
  }, [storageKey, sort]);

  const setSort = useCallback((next: ParametresSort) => {
    setSortState(next);
  }, []);

  return [sort, setSort];
}
