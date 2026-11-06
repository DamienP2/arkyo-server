"use client";

import { createContext, useContext } from "react";

/**
 * Map catégorie (string) → hex color. Peuplée une fois au montage du
 * `RackEditor` à partir de la hiérarchie des catégories DB et diffusée
 * à tous les sous-composants via contexte.
 */
export const CategoryColorCtx = createContext<Record<string, string>>({});

/** Couleurs fixes pour les éléments non-équipement. */
export const SPECIAL_HEX: Record<string, string> = {
  "Panels de patch": "#06b6d4",
  "Accessoire rack": "#71717a",
};

export const DEFAULT_HEX = "#71717a";

/** Retourne la couleur hex pour un nom de catégorie (contexte ou map spécial). */
export function useCategoryColor(category?: string | null): string {
  const map = useContext(CategoryColorCtx);
  if (!category) return DEFAULT_HEX;
  if (SPECIAL_HEX[category]) return SPECIAL_HEX[category];
  return map[category] ?? DEFAULT_HEX;
}

/**
 * Teinte solide : mélange une couleur avec le fond de carte via `color-mix`.
 * Fonctionne en light et dark mode.
 */
export function hexTint(hex: string, ratio = 0.15): string {
  const pct = Math.round(ratio * 100);
  return `color-mix(in srgb, ${hex} ${pct}%, var(--card))`;
}

/**
 * Couleur de texte lisible : mélange avec le foreground — sombre sur fond clair,
 * clair sur fond sombre.
 */
export function hexDarken(hex: string, _ratio = 0.6): string {
  return `color-mix(in srgb, ${hex} 75%, var(--foreground))`;
}
