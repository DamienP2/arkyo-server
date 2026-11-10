/**
 * Ouverture de la palette ⌘K par évènement (bouton ⌘K des topbars Strata).
 * Module feuille : la palette et les topbars l'importent sans s'importer
 * l'une l'autre.
 */

/** Évènement `window` qui ouvre la palette ⌘K (écouté par la palette). */
export const STRATA_PALETTE_EVENT = "strata:palette";

export function openStrataPalette() {
  window.dispatchEvent(new CustomEvent(STRATA_PALETTE_EVENT));
}
