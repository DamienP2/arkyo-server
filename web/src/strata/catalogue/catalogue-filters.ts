"use client";

/**
 * Filtres et tri du catalogue Strata v2, mémorisés par sorte de fiche dans le
 * stockage local (`strata-catalogue-filters:<sorte>`), comme arkyo mémorise
 * les siens (`arkyo:tenant-catalogue:filters:<sorte>`) : ils survivent à un
 * changement d'onglet et à un rechargement. Clés propres à Strata (la forme
 * diffère de celle d'arkyo). Lecture paresseuse, lecture et écriture
 * protégées (stockage indisponible : filtres de la session seulement).
 */

import { useEffect, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

const filtersKey = (kind: string) => `strata-catalogue-filters:${kind}`;
export const TAB_KEY = "strata-catalogue-tab";

/** Valeur mémorisée lue champ par champ : un champ absent ou mal formé garde sa valeur par défaut. */
function merge<T extends Record<string, unknown>>(defaults: T, raw: unknown): T {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...defaults };
  for (const [k, d] of Object.entries(defaults)) {
    const v = r[k];
    if (Array.isArray(d)) {
      if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === "string");
    } else if (d && typeof d === "object") {
      out[k] = merge(d as Record<string, unknown>, v);
    } else if (typeof v === typeof d) {
      out[k] = v;
    }
  }
  return out as T;
}

export function readStored<T extends Record<string, unknown>>(kind: string, defaults: T): T {
  try {
    const raw = window.localStorage.getItem(filtersKey(kind));
    return raw ? merge(defaults, JSON.parse(raw)) : defaults;
  } catch {
    return defaults;
  }
}

/** Filtres d'une sorte de fiche, initialisés depuis le stockage et réécrits à chaque changement. */
export function useStoredFilters<T extends Record<string, unknown>>(
  kind: string,
  defaults: T,
  isValid: (v: T) => T = (v) => v,
): [T, (update: (prev: T) => T) => void] {
  const [state, setState] = useState<T>(() => isValid(readStored(kind, defaults)));
  useEffect(() => {
    try {
      window.localStorage.setItem(filtersKey(kind), JSON.stringify(state));
    } catch {
      /* stockage indisponible : filtres de la session seulement */
    }
  }, [kind, state]);
  return [state, setState];
}

export function readStoredTab(): string | null {
  try {
    return window.localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

export function writeStoredTab(tab: string) {
  try {
    window.localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* onglet de la session seulement */
  }
}

/** Ajoute ou retire une valeur d'une liste (sélection multiple). */
export function toggleIn(list: readonly string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/**
 * Tri d'arkyo (`CatalogueTable`) : valeurs absentes en dernier quel que soit
 * le sens, texte à la française, nombres dans l'ordre, puis le nom.
 */
export function sortBy<T extends { name: string }>(
  items: T[],
  value: (it: T) => string | number | null | undefined,
  dir: SortDir,
): T[] {
  const sign = dir === "desc" ? -1 : 1;
  return items.sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const na = va == null || va === "";
    const nb = vb == null || vb === "";
    if (na !== nb) return na ? 1 : -1;
    let c = 0;
    if (!na && !nb) {
      c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "fr");
    }
    return sign * (c || a.name.localeCompare(b.name, "fr"));
  });
}
