// Helpers de collision locaux au rack-editor. La logique pure canonique vit
// dans `lib/services/rack-geometry.ts` (détection `detectCollision`). Ici on
// garde les helpers spécifiques au rendu (pct d'une colonne, détection ligne
// entièrement couverte) dont l'éditeur a besoin pour le drag visuel.

import { WIDTH_CONFIG } from "./constants";
import type { Slot, WidthFraction } from "./types";

/**
 * Convertit (column, widthFraction) en intervalle horizontal [left%, right%].
 * `column` est relatif à la widthFraction : 0..cols(wf)-1.
 */
export function colToPct(col: number, wf: WidthFraction): [number, number] {
  const pct = WIDTH_CONFIG[wf].pct;
  return [col * pct, (col + 1) * pct];
}

/** Vrai si deux intervalles [a1, a2) et [b1, b2) se chevauchent strictement. */
export function pctOverlap([a1, a2]: [number, number], [b1, b2]: [number, number]): boolean {
  return a1 < b2 && a2 > b1;
}

/**
 * Vrai si deux colonnes (avec widthFraction propre chacune) entrent en
 * collision horizontale. Utilisé pour le drag preview visuel.
 */
export function colsCollide(
  col1: number,
  wf1: WidthFraction,
  col2: number,
  wf2: WidthFraction,
): boolean {
  return pctOverlap(colToPct(col1, wf1), colToPct(col2, wf2));
}

/** Vrai si la ligne U est couverte à 100% par les slots existants. */
export function isRowFullyCovered(u: number, slots: Slot[]): boolean {
  // Les slots fantômes (startU=null) n'occupent aucune ligne physique
  const ranges = slots
    .filter((s) => s.startU != null && s.heightU != null && s.startU <= u && u < s.startU + s.heightU!)
    .map((s) => colToPct(s.column, s.widthFraction));
  ranges.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [l, r] of ranges) {
    if (l > covered + 0.01) return false;
    covered = Math.max(covered, r);
  }
  return covered >= 99.9;
}

/**
 * Trouve la première colonne libre (relative à wf) pour un slot candidat sur
 * les lignes [startU, startU+heightU). Retourne `null` si aucune place libre.
 */
export function findFreeColForWf(
  startU: number,
  heightU: number,
  wf: WidthFraction,
  slots: Slot[],
  excludeId?: string,
): number | null {
  const maxCol = WIDTH_CONFIG[wf].cols;
  for (let c = 0; c < maxCol; c++) {
    const range = colToPct(c, wf);
    let free = true;
    for (const s of slots) {
      if (s.id === excludeId) continue;
      // Ignorer les slots fantômes (startU=null)
      if (s.startU == null || s.heightU == null) continue;
      if (s.startU >= startU + heightU || s.startU + s.heightU <= startU) continue;
      if (pctOverlap(range, colToPct(s.column, s.widthFraction))) {
        free = false;
        break;
      }
    }
    if (free) return c;
  }
  return null;
}

/**
 * Vérifie si un `startU` est libre pour un équipement de hauteur `heightU`
 * dans la `view` donnée, sans collider avec les `slots` existants.
 */
function startUIsFree(
  startU: number,
  heightU: number,
  col: number,
  wf: WidthFraction,
  view: string,
  slots: Slot[],
  excludeId: string | undefined,
  totalU: number,
): boolean {
  if (startU < 1) return false;
  if (startU + heightU - 1 > totalU) return false;
  for (const s of slots) {
    if (s.id === excludeId) continue;
    if (s.parentSlotId) continue;
    if (s.view !== view) continue;
    // Ignorer les slots fantômes (startU=null)
    if (s.startU == null || s.heightU == null) continue;
    if (startU < s.startU + s.heightU && startU + heightU > s.startU) {
      if (colsCollide(col, wf, s.column, s.widthFraction)) return false;
    }
  }
  return true;
}

/**
 * Aimante un `startU` valide vers `targetU` pour un équipement multi-U.
 *
 * Quand le curseur survole une position où le placement standard collide
 * (par ex. le HAUT de l'équipement chevauche un slot au-dessus), on cherche
 * la 1re position libre dans une fenêtre `[targetU - heightU + 1, targetU
 * + heightU - 1]` autour du curseur. La recherche alterne `targetU + d` puis
 * `targetU - d` (`d` croissant) pour préférer la position la PLUS proche.
 *
 * Retourne `targetU` si déjà libre, sinon le startU valide le plus proche, ou
 * `null` si aucune position dans la fenêtre n'est libre.
 *
 * @param targetU      Position naturelle (curseur ancré bas)
 * @param heightU      Hauteur U de l'équipement à placer
 * @param col          Colonne (relative à wf) du candidat
 * @param wf           Width fraction du candidat
 * @param view         Face concernée (FRONT/REAR/...) — filtre les slots
 * @param slots        Slots existants (top-level uniquement)
 * @param excludeId    Slot ID à ignorer (pour les déplacements)
 * @param totalU       Hauteur totale du rack (borne supérieure)
 * @param maxSearch    Distance max d'aimantation (par défaut `heightU - 1` —
 *                      le curseur reste dans la silhouette de l'équipement)
 */
export function findValidStartUNear(
  targetU: number,
  heightU: number,
  col: number,
  wf: WidthFraction,
  view: string,
  slots: Slot[],
  excludeId: string | undefined,
  totalU: number,
  maxSearch?: number,
): number | null {
  // 1U n'a pas de logique d'aimantation — la position curseur est canonique.
  if (heightU <= 1) {
    return startUIsFree(targetU, heightU, col, wf, view, slots, excludeId, totalU)
      ? targetU
      : null;
  }
  const maxOffset = maxSearch ?? Math.max(0, heightU - 1);
  // Position naturelle d'abord.
  if (startUIsFree(targetU, heightU, col, wf, view, slots, excludeId, totalU)) {
    return targetU;
  }
  // Recherche alternée bas/haut, distance croissante.
  for (let d = 1; d <= maxOffset; d++) {
    const candidates = [targetU - d, targetU + d];
    for (const candidate of candidates) {
      if (startUIsFree(candidate, heightU, col, wf, view, slots, excludeId, totalU)) {
        return candidate;
      }
    }
  }
  return null;
}
