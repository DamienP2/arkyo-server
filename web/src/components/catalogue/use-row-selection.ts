"use client";

/**
 * use-row-selection — sélection multi-lignes pour les tableaux catalogue.
 *
 * Gère : Set d'ids, ancre, Shift+clic (plage), Cmd/Ctrl+clic (bascule),
 * glisser sur les coches (le pointerdown fige le mode cocher/décocher selon
 * l'état initial de la coche ; chaque ligne traversée étend la plage
 * début→courant), Échap = clear, et purge des ids absents de
 * `orderedSelectableIds` (filtre / recherche / suppression).
 *
 * La logique de plage est extraite en helpers purs (`computeRange`,
 * `applyDragSelection`) pour testabilité.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Helpers purs (testables sans React) ────────────────────────────────────────

/**
 * Plage d'ids entre `anchorId` et `targetId` (bornes incluses), dans l'ordre
 * de `orderedIds`. Ordre indifférent (anchor peut être après target).
 *  - target introuvable → `[]`
 *  - anchor introuvable → `[target]` (repli sur la cible seule)
 */
export function computeRange(
  orderedIds: string[],
  anchorId: string | null,
  targetId: string,
): string[] {
  const idxB = orderedIds.indexOf(targetId);
  if (idxB === -1) return [];
  const idxA = anchorId === null ? -1 : orderedIds.indexOf(anchorId);
  if (idxA === -1) return [targetId];
  const lo = Math.min(idxA, idxB);
  const hi = Math.max(idxA, idxB);
  return orderedIds.slice(lo, hi + 1);
}

/**
 * Applique un mode (cocher / décocher) sur une plage, à partir d'une base.
 * Retourne un nouveau Set (jamais muté).
 */
export function applyDragSelection(
  base: Set<string>,
  range: string[],
  mode: "select" | "deselect",
): Set<string> {
  const next = new Set(base);
  for (const id of range) {
    if (mode === "select") next.add(id);
    else next.delete(id);
  }
  return next;
}

// ── Type public ─────────────────────────────────────────────────────────────

export type RowSelection = {
  selected: Set<string>;
  isSelected: (id: string) => boolean;
  /** Clic coche : gère Shift (plage depuis l'ancre) et Cmd/Ctrl (bascule). */
  onCheckboxClick: (
    id: string,
    ev: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => void;
  /** pointerdown sur une coche = début du glisser. */
  onDragStart: (id: string) => void;
  /** pointerenter sur une ligne = extension de la plage (si glisser actif). */
  onDragEnter: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useRowSelection(orderedSelectableIds: string[]): RowSelection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // Refs pour lire l'état courant dans les handlers d'événements globaux sans
  // recréer les listeners à chaque render.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const orderRef = useRef(orderedSelectableIds);
  orderRef.current = orderedSelectableIds;
  const anchorRef = useRef<string | null>(null);

  // Glisser en cours (null = inactif).
  const dragRef = useRef<{
    mode: "select" | "deselect";
    startId: string;
    base: Set<string>;
    moved: boolean;
  } | null>(null);
  // Un glisser qui a bougé doit annuler le `click` de fin (sinon double bascule).
  const suppressClickRef = useRef(false);

  // Purge des ids disparus quand la liste sélectionnable change.
  useEffect(() => {
    const allowed = new Set(orderedSelectableIds);
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (allowed.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [orderedSelectableIds]);

  // Échap = clear — listener actif uniquement quand une sélection existe.
  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        anchorRef.current = null;
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const onCheckboxClick = useCallback(
    (
      id: string,
      ev: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    ) => {
      // Un glisser vient de se terminer sur cette coche → ignorer le click.
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (ev.shiftKey && anchorRef.current) {
        const range = computeRange(orderRef.current, anchorRef.current, id);
        setSelected((prev) => applyDragSelection(prev, range, "select"));
        return;
      }
      // Simple ou Cmd/Ctrl : bascule + pose l'ancre.
      anchorRef.current = id;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  const onDragStart = useCallback((id: string) => {
    const isSel = selectedRef.current.has(id);
    dragRef.current = {
      mode: isSel ? "deselect" : "select",
      startId: id,
      base: new Set(selectedRef.current),
      moved: false,
    };
    anchorRef.current = id;

    const onUp = () => {
      const drag = dragRef.current;
      // Si le glisser a bougé, la sélection est déjà posée → neutraliser le
      // click de fin qui rebasculerait la coche de départ.
      if (drag?.moved) suppressClickRef.current = true;
      dragRef.current = null;
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointerup", onUp);
  }, []);

  const onDragEnter = useCallback((id: string) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Ligne non sélectionnable traversée → ne rien changer (conserver la plage).
    if (!orderRef.current.includes(id)) return;
    drag.moved = true;
    const range = computeRange(orderRef.current, drag.startId, id);
    setSelected(applyDragSelection(drag.base, range, drag.mode));
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(orderRef.current));
  }, []);

  const clear = useCallback(() => {
    anchorRef.current = null;
    setSelected(new Set());
  }, []);

  return {
    selected,
    isSelected,
    onCheckboxClick,
    onDragStart,
    onDragEnter,
    selectAll,
    clear,
  };
}
