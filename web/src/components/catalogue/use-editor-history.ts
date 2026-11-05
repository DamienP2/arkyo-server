"use client";

/**
 * useEditorHistory — undo / redo générique pour les éditeurs catalogue.
 *
 * Pattern : 2 stacks (past / future) — pas d'index.
 *  - Quand `values` change ET ce n'est pas une opération undo/redo, on
 *    pousse la dernière valeur connue (`baselineRef`) dans `past`, vide
 *    `future`, et met à jour la baseline.
 *  - undo()  : pop past → set values via setValues (sans push) → push
 *              l'ancienne current dans future.
 *  - redo()  : symétrique.
 *
 * Commit différé pour les champs texte :
 *  - Si `values` change pendant qu'un input texte (input text/textarea/
 *    contenteditable) a le focus, on ne push PAS la snapshot immédiatement
 *    mais on la mémorise comme "pending".
 *  - Le push réel a lieu sur blur de l'élément (`focusout` capture) OU
 *    sur Enter (input single-line). Cela évite un undo lettre par lettre.
 *  - `commitPendingTextEdit()` est aussi appelé au démontage du hook pour
 *    ne pas perdre la dernière modification.
 *
 * Limites :
 *  - `past` est borné à `max` (default 50). Au-delà, on shift la plus
 *    ancienne snapshot.
 *  - Raccourcis clavier `Cmd+Z` / `Ctrl+Z` (undo) et `Cmd+Shift+Z` /
 *    `Ctrl+Shift+Z` (redo) ignorés si focus dans input/textarea/select/
 *    contenteditable — laisse le browser gérer son propre undo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getFocusedTextEditable,
  isSingleLineTextInput,
  isTextEditableElement,
} from "./editor-text-field";

export interface UseEditorHistoryOptions<T> {
  /** Valeurs courantes du formulaire. */
  values: T;
  /** Setter pour remplacer atomiquement les valeurs. */
  setValues: (next: T) => void;
  /** Désactive complètement le hook (default true). */
  enabled?: boolean;
  /** Profondeur max du stack `past` (default 50). */
  max?: number;
}

export interface UseEditorHistoryReturn {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Flush manuellement une éventuelle édition texte en attente. */
  commitPendingTextEdit: () => void;
}

export function useEditorHistory<T>({
  values,
  setValues,
  enabled = true,
  max = 50,
}: UseEditorHistoryOptions<T>): UseEditorHistoryReturn {
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);

  // Référence vers la dernière valeur connue pour détecter les changements
  // sans ré-créer une snapshot à chaque render. Initialisée au mount à la
  // valeur courante (pas de snapshot poussée au mount).
  const baselineRef = useRef<T>(values);
  // Sérialisation JSON de la baseline — utilisée pour la comparaison deep.
  // RHF (et d'autres sources) recréent souvent l'objet sans changer le contenu :
  // on ne pousse une snapshot que si la sérialisation diffère vraiment.
  const baselineJsonRef = useRef<string>(safeStringify(values));
  // Flag : indique qu'on est en train d'appliquer un undo/redo, donc le
  // prochain change de `values` doit JUSTE mettre à jour la baseline sans
  // pousser dans `past`.
  const skipNextRef = useRef(false);
  const setValuesRef = useRef(setValues);
  useEffect(() => {
    setValuesRef.current = setValues;
  }, [setValues]);

  // ── Édition texte différée ────────────────────────────────────────────
  // Quand l'utilisateur tape dans un input texte, on ne push pas chaque
  // frappe. À la place, on garde la "baseline pré-édition" (valeur de la
  // baseline AVANT le début de la frappe), et on attend le blur/Enter pour
  // pousser cette baseline dans le past.
  const pendingPrevBaselineRef = useRef<T | null>(null);
  const hasPendingTextEditRef = useRef(false);

  const commitPendingTextEdit = useCallback(() => {
    if (!hasPendingTextEditRef.current) return;
    const prev = pendingPrevBaselineRef.current;
    hasPendingTextEditRef.current = false;
    pendingPrevBaselineRef.current = null;
    if (prev === null) return;
    // Push uniquement si la baseline actuelle diffère réellement du prev.
    const prevJson = safeStringify(prev);
    if (prevJson === baselineJsonRef.current) return;
    setPast((p) => {
      const next = [...p, prev];
      if (next.length > max) next.shift();
      return next;
    });
    setFuture([]);
  }, [max]);

  // Détection des changements de values → push dans past (ou différé).
  useEffect(() => {
    if (!enabled) return;
    const currentJson = safeStringify(values);
    // Si on vient juste d'appliquer un undo/redo, on met à jour la baseline
    // mais on ne pousse pas (sinon undo→redo enchaîné polluerait l'historique).
    if (skipNextRef.current) {
      skipNextRef.current = false;
      baselineRef.current = values;
      baselineJsonRef.current = currentJson;
      return;
    }
    // Pas de changement réel (deep equality via JSON) → rien à faire.
    if (currentJson === baselineJsonRef.current) {
      // On garde la baseline ref-equality cohérente pour que les undo/redo
      // re-publient bien un objet identique au plus proche.
      baselineRef.current = values;
      return;
    }
    // Changement détecté : déterminer si on doit différer (focus sur input texte).
    const prev = baselineRef.current;
    baselineRef.current = values;
    baselineJsonRef.current = currentJson;

    if (getFocusedTextEditable()) {
      // En cours de frappe : on mémorise la baseline pré-édition une seule
      // fois (la toute première frappe). Les frappes suivantes n'écrasent
      // pas la baseline mémorisée — on veut bien la valeur AVANT la session
      // d'édition complète.
      if (!hasPendingTextEditRef.current) {
        pendingPrevBaselineRef.current = prev;
        hasPendingTextEditRef.current = true;
      }
      // future vidé même en édition différée — sinon un redo après typing
      // ré-appliquerait une snapshot incohérente.
      setFuture([]);
      return;
    }

    // Commit immédiat (autre type de champ).
    setPast((p) => {
      const next = [...p, prev];
      if (next.length > max) next.shift();
      return next;
    });
    setFuture([]);
  }, [values, enabled, max]);

  const undo = useCallback(() => {
    if (!enabled) return;
    // Avant d'undo, on flush une éventuelle édition texte en cours.
    commitPendingTextEdit();
    setPast((p) => {
      if (p.length === 0) return p;
      const last = p[p.length - 1];
      const current = baselineRef.current;
      // Met à jour la baseline AVANT d'appeler setValues, et marque skip
      // pour que le prochain effect ne re-push pas.
      skipNextRef.current = true;
      baselineRef.current = last;
      baselineJsonRef.current = safeStringify(last);
      setValuesRef.current(last);
      setFuture((f) => [...f, current]);
      return p.slice(0, -1);
    });
  }, [enabled, commitPendingTextEdit]);

  const redo = useCallback(() => {
    if (!enabled) return;
    commitPendingTextEdit();
    setFuture((f) => {
      if (f.length === 0) return f;
      const last = f[f.length - 1];
      const current = baselineRef.current;
      skipNextRef.current = true;
      baselineRef.current = last;
      baselineJsonRef.current = safeStringify(last);
      setValuesRef.current(last);
      setPast((p) => {
        const next = [...p, current];
        if (next.length > max) next.shift();
        return next;
      });
      return f.slice(0, -1);
    });
  }, [enabled, max, commitPendingTextEdit]);

  // Raccourcis clavier globaux.
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key !== "z" && e.key !== "Z") return;
      // Si focus dans un input éditable, on laisse le browser gérer son undo.
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, undo, redo]);

  // Listeners globaux pour committer les édits texte différés.
  useEffect(() => {
    if (!enabled) return;

    // Blur capture-phase : se déclenche aussi quand le focus passe d'un input
    // texte à un autre (tab/click). On utilise focusout (bubble) en capture
    // pour intercepter de manière fiable.
    const onFocusOut = (e: FocusEvent) => {
      const target = e.target;
      if (!isTextEditableElement(target instanceof Element ? target : null)) return;
      // relatedTarget peut être null (blur vers le document). Dans tous les cas
      // on commit la pending — si l'utilisateur re-clique dans un autre input
      // texte, une nouvelle session d'édition démarrera proprement.
      commitPendingTextEdit();
    };

    // Enter sur un input single-line → commit (textarea garde le retour à la ligne).
    const onKeyDownEnter = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!isSingleLineTextInput(target)) return;
      commitPendingTextEdit();
    };

    window.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("keydown", onKeyDownEnter, true);
    return () => {
      window.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("keydown", onKeyDownEnter, true);
    };
  }, [enabled, commitPendingTextEdit]);

  // Flush au démontage : si une édition texte est en attente, on ne veut pas
  // perdre la possibilité de l'annuler. On push la baseline pré-édition dans
  // past avant cleanup.
  useEffect(() => {
    return () => {
      commitPendingTextEdit();
    };
  }, [commitPendingTextEdit]);

  return {
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undo,
    redo,
    commitPendingTextEdit,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Détecte si la cible d'un événement clavier est un champ éditable natif
 * (input texte/number/textarea/select, contenteditable). On regarde aussi
 * `document.activeElement` au cas où le target serait window.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  const el =
    (target instanceof HTMLElement && target) ||
    (typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type.toLowerCase();
    // checkbox/radio/button/file ne consomment pas Cmd+Z — on autorise l'undo global.
    const nonText = new Set([
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "file",
      "image",
      "color",
      "range",
    ]);
    return !nonText.has(type);
  }
  if (el.isContentEditable) return true;
  return false;
}
