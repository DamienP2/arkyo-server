"use client";

/**
 * useEditorAutosave — auto-save générique pour les éditeurs catalogue
 * (équipement / cordon / adaptateur).
 *
 * Comportement :
 *  - Surveille `values` via JSON.stringify (équivalent deep-equal sérialisable).
 *  - Au premier render : initialise la "dernière valeur sauvegardée" sans
 *    déclencher de save (pas de PATCH au mount).
 *  - À chaque changement : status = "dirty", démarre un timer `debounceMs`.
 *  - Au flush : status = "saving", appelle `save(values)`. Succès → "saved"
 *    pendant 2s puis "idle". Échec → "error" (pas de reset auto — attend
 *    une nouvelle modification).
 *  - `forceSave()` : flush immédiat (annule le timer, save tout de suite).
 *    Utile pour un Cmd+S explicite.
 *  - Cleanup du timer + abort de la requête au démontage / nouvelle modif.
 *
 * Édition texte différée :
 *  - Si `values` change pendant que le focus est sur un input texte (input
 *    text/email/number/url/search/tel/password, textarea, contenteditable),
 *    on n'arme PAS le timer 800ms. On marque juste l'état comme dirty.
 *  - Le timer démarre réellement au blur de l'input OU sur Enter (single-line).
 *  - `forceSave()` bypass cette logique et flush immédiatement même si le
 *    focus est encore dans l'input.
 *  - Au démontage : flush si dirty (pour ne pas perdre la modif courante).
 *
 * Limites volontaires :
 *  - Pas de gestion offline / retry exponentiel (V1).
 *  - Pas de blocage de navigation : Next.js peut interrompre un save en cours.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getFocusedTextEditable,
  isSingleLineTextInput,
  isTextEditableElement,
} from "./editor-text-field";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface UseEditorAutosaveOptions<T> {
  /** Valeurs courantes du formulaire (toute valeur sérialisable JSON). */
  values: T;
  /** Fonction de persistance — peut throw, peut accepter un AbortSignal. */
  save: (values: T, signal: AbortSignal) => Promise<void>;
  /** Désactive complètement le hook (default true). */
  enabled?: boolean;
  /** Debounce en ms avant flush (default 800). */
  debounceMs?: number;
}

export interface UseEditorAutosaveReturn {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  /** Force un save immédiat (annule le timer en cours). */
  forceSave: () => Promise<void>;
}

export function useEditorAutosave<T>({
  values,
  save,
  enabled = true,
  debounceMs = 800,
}: UseEditorAutosaveOptions<T>): UseEditorAutosaveReturn {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Référence vers la dernière payload sérialisée connue comme "à jour" côté
  // serveur. Au mount, on initialise avec la valeur courante pour éviter un
  // PATCH au premier render.
  const lastSavedJsonRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  const valuesRef = useRef(values);
  // Indique qu'un save est en attente mais a été différé parce que le focus
  // est sur un input texte. Au blur/Enter on armera le timer.
  const pendingDeferredRef = useRef(false);
  const debounceMsRef = useRef(debounceMs);
  const enabledRef = useRef(enabled);

  // Sync les refs sans déclencher d'effet.
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);
  useEffect(() => {
    debounceMsRef.current = debounceMs;
  }, [debounceMs]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearSavedTimer = useCallback(() => {
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
  }, []);

  const performSave = useCallback(async (): Promise<void> => {
    // Annule un save précédent encore en vol.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("saving");
    const snapshot = valuesRef.current;
    const snapshotJson = safeStringify(snapshot);
    try {
      await saveRef.current(snapshot, controller.signal);
      if (controller.signal.aborted) return;
      lastSavedJsonRef.current = snapshotJson;
      setLastSavedAt(new Date());
      setStatus("saved");
      clearSavedTimer();
      savedTimerRef.current = setTimeout(() => {
        setStatus("idle");
        savedTimerRef.current = null;
      }, 2000);
    } catch (e) {
      if (controller.signal.aborted) return;
      setStatus("error");
      // pas de reset auto — l'utilisateur doit reprovoquer une modification
      // ou appeler forceSave() pour réessayer.
      // (l'erreur est volontairement avalée — au caller de logger via son save())
      void e;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [clearSavedTimer]);

  const forceSave = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) return;
    clearTimer();
    // forceSave bypass la défferrence texte : on flush même si focus est encore
    // dans un input.
    pendingDeferredRef.current = false;
    await performSave();
  }, [clearTimer, performSave]);

  // Arme le timer debounce normalement (sans tenir compte du focus).
  const scheduleSave = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void performSave();
    }, debounceMsRef.current);
  }, [clearTimer, performSave]);

  // Surveillance des changements de `values`.
  useEffect(() => {
    if (!enabled) return;

    const currentJson = safeStringify(values);

    // Premier passage : on enregistre la baseline sans rien sauvegarder.
    if (lastSavedJsonRef.current === null) {
      lastSavedJsonRef.current = currentJson;
      return;
    }

    // Pas de changement réel → rien à faire.
    if (currentJson === lastSavedJsonRef.current) return;

    // Changement détecté → status dirty.
    setStatus("dirty");

    // Si on est en train de taper dans un champ texte, on diffère l'armement
    // du timer jusqu'au blur / Enter. Le valuesRef restera à jour, donc au
    // flush on persistera la version finale.
    if (getFocusedTextEditable()) {
      clearTimer();
      pendingDeferredRef.current = true;
      return;
    }

    // Commit immédiat (autre type de champ) : timer debounce normal.
    pendingDeferredRef.current = false;
    scheduleSave();

    return () => {
      // Cleanup en cas d'unmount / nouveau changement : on annule le timer
      // pour ne pas firer un save sur des valeurs périmées.
      clearTimer();
    };
    // values est volontairement la dépendance principale (via JSON.stringify
    // implicite par le hook React — on déclenche aussi sur ref-equality).
  }, [values, enabled, clearTimer, scheduleSave]);

  // Listeners globaux pour committer l'autosave différé au blur / Enter.
  useEffect(() => {
    if (!enabled) return;

    const commitIfPending = () => {
      if (!pendingDeferredRef.current) return;
      pendingDeferredRef.current = false;
      // Au moment du blur, on vérifie qu'il y a bien encore quelque chose à
      // sauvegarder (le user peut avoir tout effacé puis remis l'original).
      const currentJson = safeStringify(valuesRef.current);
      if (currentJson === lastSavedJsonRef.current) {
        // Plus rien à save : on remet idle si on était dirty.
        setStatus((s) => (s === "dirty" ? "idle" : s));
        return;
      }
      scheduleSave();
    };

    const onFocusOut = (e: FocusEvent) => {
      const target = e.target;
      if (!isTextEditableElement(target instanceof Element ? target : null)) return;
      commitIfPending();
    };

    const onKeyDownEnter = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!isSingleLineTextInput(target)) return;
      commitIfPending();
    };

    window.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("keydown", onKeyDownEnter, true);
    return () => {
      window.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("keydown", onKeyDownEnter, true);
    };
  }, [enabled, scheduleSave]);

  // Cleanup global au démontage.
  useEffect(() => {
    return () => {
      clearTimer();
      clearSavedTimer();
      // Si une modif est en attente différée (focus texte) au démontage, on
      // flush en synchrone : performSave est async mais on l'invoque sans
      // await (best effort — l'objectif est de ne pas perdre la dernière
      // modif). La requête vit jusqu'à sa résolution même après unmount.
      if (pendingDeferredRef.current) {
        pendingDeferredRef.current = false;
        const currentJson = safeStringify(valuesRef.current);
        if (currentJson !== lastSavedJsonRef.current) {
          void performSave();
        }
      }
      if (abortRef.current) abortRef.current.abort();
    };
    // performSave est stable (useCallback sans deps changeantes hors clearSavedTimer).
  }, [clearTimer, clearSavedTimer, performSave]);

  return { status, lastSavedAt, forceSave };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** JSON.stringify protégé contre les cycles — fallback sur String(value). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
