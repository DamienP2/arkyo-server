"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Persiste un state React dans `localStorage` sous la clé donnée.
 *
 * Pattern :
 *   const [view, setView] = useLocalStorageState<"grid" | "list">("tenants-view", "grid");
 *
 * Comportement :
 *  - SSR-safe : la lecture initiale est différée au mount (pas d'accès `window`
 *    pendant l'hydratation). On démarre toujours sur `defaultValue` côté serveur,
 *    puis on rebascule vers la valeur stockée au premier `useEffect`.
 *  - Clé dynamique : si `key` change (ex : clé scopée par projet lors d'une
 *    navigation client), la valeur du nouveau scope est relue — l'ancienne
 *    n'est jamais migrée sous la nouvelle clé.
 *  - L'écriture se fait dans le setter, jamais dans un effet : un effet de
 *    persistance s'exécute aussi au mount, AVANT que l'hydratation asynchrone
 *    ne soit visible, et écraserait la valeur stockée avec `defaultValue`
 *    (bug historique : toute relecture concurrente dans cette fenêtre figeait
 *    le défaut).
 *  - Validation optionnelle (`isValid`) pour ignorer une valeur stockée corrompue
 *    (ex : enum dont les valeurs ont changé) → fallback `defaultValue`.
 *  - Robuste à l'absence de `localStorage` (mode privé Safari rare, SSR) :
 *    try/catch silencieux côté lecture et écriture.
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  options?: { isValid?: (value: unknown) => value is T },
): [T, (next: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(defaultValue);
  // Refs pour garder l'effet de lecture sur [key] uniquement : defaultValue et
  // isValid sont souvent des littéraux recréés à chaque render.
  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;
  const isValidRef = useRef(options?.isValid);
  isValidRef.current = options?.isValid;

  // Lecture au mount (SSR-safe) et à chaque changement de clé.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let next = defaultRef.current;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        const isValid = isValidRef.current;
        if (!isValid || isValid(parsed)) {
          next = parsed as T;
        }
      }
    } catch {
      /* localStorage indisponible ou JSON corrompu → defaultValue */
    }
    setState(next);
  }, [key]);

  const setStateStable = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState((prev) => {
        const value =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* quota dépassé ou storage indispo : on ignore silencieusement */
        }
        return value;
      });
    },
    [key],
  );

  return [state, setStateStable];
}
