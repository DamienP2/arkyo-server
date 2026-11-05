"use client";

/**
 * useServerReconcile — réhydrate l'état d'un éditeur quand le prop source
 * (re-fetché par le Server Component après un `router.refresh()`) change,
 * SANS écraser une saisie locale non sauvegardée.
 *
 * Contexte : les pages sont des Server Components minces. `<AppSync>` appelle
 * `router.refresh()` à réception d'un événement temps réel (autre
 * collaborateur), le SC re-fetch et passe un NOUVEAU prop. Or les éditeurs
 * initialisent leur état une seule fois (`useState(() => …)` /
 * `useForm({ defaultValues })`) : sans réconciliation, l'affichage reste
 * périmé jusqu'au rechargement complet. Ce hook comble ce trou.
 *
 * Garde anti-écrasement :
 *  - On garde une ref de la « dernière valeur serveur connue » sérialisée.
 *  - À chaque nouvelle valeur serveur :
 *      • si rien n'a changé côté serveur (sérialisation identique) → no-op ;
 *      • sinon on avance TOUJOURS la baseline vers la nouvelle valeur serveur
 *        (pour ne jamais rester bloqué sur une baseline périmée), MAIS on ne
 *        remplace l'état local QUE s'il était « propre » — c.-à-d. identique à
 *        la précédente baseline serveur. Si l'utilisateur a une modification
 *        locale en cours, on ne clobbe pas sa frappe.
 *
 * `apply` doit réhydrater via `form.reset(...)` (react-hook-form) + setState,
 * jamais via `setValue` : `reset` ne marque pas le form « dirty », ce qui
 * évite de relancer l'auto-save en boucle sur une réhydratation.
 *
 * `serverValue` et le retour de `getLocalValue` doivent partager la même forme
 * sérialisable (typiquement le snapshot déjà utilisé par l'auto-save / undo).
 */

import { useEffect, useRef } from "react";

export function useServerReconcile<T>({
  serverValue,
  getLocalValue,
  apply,
  enabled = true,
}: {
  /** Valeur dérivée du prop serveur courant (même forme que l'état local). */
  serverValue: T;
  /** Lit l'état local éditable courant (même forme que `serverValue`). */
  getLocalValue: () => T;
  /** Réhydrate l'état local depuis la valeur serveur (reset + setState). */
  apply: (server: T) => void;
  /** Désactive le hook (ex. mode création / proposition). */
  enabled?: boolean;
}): void {
  const serverJson = safeStringify(serverValue);

  const lastServerJsonRef = useRef<string>(serverJson);
  const serverValueRef = useRef<T>(serverValue);
  serverValueRef.current = serverValue;
  const getLocalRef = useRef(getLocalValue);
  getLocalRef.current = getLocalValue;
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (!enabled) {
      // Reste aligné sur la dernière valeur serveur : si le hook se ré-active,
      // on ne réconciliera pas un backlog accumulé pendant la désactivation.
      lastServerJsonRef.current = serverJson;
      return;
    }
    const prevServerJson = lastServerJsonRef.current;
    // Rien de neuf côté serveur (même contenu, prop ré-identifié seulement).
    if (serverJson === prevServerJson) return;

    const localWasClean = safeStringify(getLocalRef.current()) === prevServerJson;
    // On avance toujours la baseline vers la valeur serveur la plus récente.
    lastServerJsonRef.current = serverJson;
    if (localWasClean) {
      applyRef.current(serverValueRef.current);
    }
    // Sinon : édition locale en cours → on ne clobbe pas la saisie.
  }, [serverJson, enabled]);
}

/** JSON.stringify protégé contre les cycles — fallback sur String(value). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
