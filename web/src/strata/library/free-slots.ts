/**
 * U libres d'un rack pour la bibliothèque Strata (onglet Rack, spec §6.2).
 *
 * Mêmes règles d'occupation que le canvas de placement (`startUIsFree` de
 * `components/synoptique/lib/collision.ts`) : seuls les slots de premier
 * niveau, posés (`startU` et `heightU` renseignés), de la face visée, comptent.
 * La bibliothèque pose en pleine largeur : une rangée partiellement occupée
 * n'est pas libre.
 */

import { colsCollide, findValidStartUNear } from "@/components/synoptique/lib/collision";
import type { Slot } from "@/components/synoptique/lib/types";

/** Départs possibles (croissants) d'un équipement de `heightU` U sur la face `view`. */
export function freeStartUs(slots: readonly Slot[], units: number, heightU: number, view: string): number[] {
  const h = Math.max(1, heightU);
  const busy = new Set<number>();
  for (const s of slots) {
    if (s.parentSlotId || s.view !== view || s.startU == null || s.heightU == null) continue;
    for (let u = s.startU; u < s.startU + s.heightU; u++) busy.add(u);
  }
  const out: number[] = [];
  for (let start = 1; start + h - 1 <= units; start++) {
    let free = true;
    for (let u = start; u < start + h; u++) {
      if (busy.has(u)) {
        free = false;
        break;
      }
    }
    if (free) out.push(start);
  }
  return out;
}

/** Cellule droppable survolée (`data` de `rack-visual.tsx`). */
export type DropCell = { uIndex: number; col: number; view: string };

/**
 * `true` si le canvas refusera ce dépôt faute de place, avec la séquence de
 * son `handleDragEnd` pour un équipement : aimantation dans la fenêtre
 * `±(heightU - 1)`, ramené sous le haut du rack, puis contrôle des collisions.
 */
export function dropRefused(cell: DropCell, heightU: number, slots: readonly Slot[], totalU: number): boolean {
  const h = Math.max(1, heightU);
  if (h > totalU) return true;
  let u = Math.max(1, cell.uIndex);
  if (h > 1) {
    const snapped = findValidStartUNear(u, h, cell.col, "FULL", cell.view, [...slots], undefined, totalU);
    if (snapped != null) u = snapped;
  }
  u = Math.min(u, Math.max(1, totalU - h + 1));
  // Boucle de collision copiée de `handleDragEnd` (`rack-placement-canvas.tsx`,
  // bloc « Validation drop ») : slots de premier niveau, posés, de la face visée.
  return slots.some(
    (s) =>
      !s.parentSlotId &&
      s.view === cell.view &&
      s.startU != null &&
      s.heightU != null &&
      u < s.startU + s.heightU &&
      u + h > s.startU &&
      colsCollide(cell.col, "FULL", s.column, s.widthFraction),
  );
}
