// Helpers purs pour l'éditeur d'étiquettes de ports de panels.
// Ne dépendent pas de React : logique d'index de port + segmentation en barres.

import type { LabelGroup, RowLevels } from "./types";

/** Convertit une position clientX (event) en numéro de port [1..total] sur une row DOM. */
export function getPortFromX(el: HTMLElement, clientX: number, total: number): number {
  const rect = el.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.max(1, Math.min(total, Math.ceil(pct * total) || 1));
}

/**
 * Retourne l'intervalle [start,end] de ports autorisés sur `levelIdx` pour un
 * clic sur `port`. Niveau 0 = tout le panel ; niveau N>0 = enfant d'un groupe
 * existant au niveau N-1.
 */
export function levelConstraint(
  levels: RowLevels,
  levelIdx: number,
  port: number,
  total: number,
): { start: number; end: number } | null {
  if (levelIdx === 0) return { start: 1, end: total };
  const parent = levels[levelIdx - 1] ?? [];
  const pg = parent.find((g) => port >= g.start && port <= g.end);
  return pg ? { start: pg.start, end: pg.end } : null;
}

/**
 * Découpe une ligne de groupes en segments ordonnés ("group" ou "gap")
 * couvrant 1..total sans recouvrement, pour le rendu horizontal.
 */
export function computeSegments(
  groups: LabelGroup[],
  total: number,
): Array<{ type: "group"; g: LabelGroup } | { type: "gap"; start: number; end: number }> {
  const sorted = [...groups].sort((a, b) => a.start - b.start);
  const segs: Array<
    { type: "group"; g: LabelGroup } | { type: "gap"; start: number; end: number }
  > = [];
  let pos = 1;
  for (const g of sorted) {
    if (g.start > pos) segs.push({ type: "gap", start: pos, end: g.start - 1 });
    segs.push({ type: "group", g });
    pos = g.end + 1;
  }
  if (pos <= total) segs.push({ type: "gap", start: pos, end: total });
  return segs;
}
