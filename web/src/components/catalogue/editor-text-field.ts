"use client";

/**
 * Helpers partagés entre `useEditorHistory` et `useEditorAutosave` pour
 * différer history-push et auto-save tant que l'utilisateur tape dans un
 * champ texte (input text/email/number/url/search/tel/password, textarea,
 * contenteditable).
 *
 * Le commit a lieu sur :
 *  - blur de l'élément (`focusout` capture)
 *  - Enter (input single-line, pas textarea)
 *
 * Les autres champs (select, checkbox, radio, range, color, file, etc.)
 * commitent immédiatement comme avant.
 */

/** Types d'inputs qui ne sont PAS considérés comme "texte" (commit immédiat). */
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "file",
  "image",
  "color",
  "range",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/** Renvoie l'élément éditable texte courant (focus), ou null. */
export function getFocusedTextEditable(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return null;
  return isTextEditableElement(el) ? el : null;
}

/** True si un élément DOM est un champ texte éditable (commit différé). */
export function isTextEditableElement(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type.toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  if (el.isContentEditable) return true;
  return false;
}

/** True si l'élément est un input single-line (Enter doit commit). */
export function isSingleLineTextInput(el: Element | null): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  const type = el.type.toLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(type);
}
