"use client";

/**
 * Lentilles propres à l'interface Strata, portées par l'URL de l'éditeur
 * projet sans nouvel identifiant d'onglet (`ProjectTabId` est celui d'arkyo) :
 * la vue Connectique est l'onglet `rack` avec `?lens=connectique`.
 */

import { useSearchParams } from "next/navigation";

export const LENS_PARAM = "lens";
export type StrataLens = "connectique";

/** Onglet d'arkyo qui porte chaque lentille Strata. */
export const LENS_TAB: Record<StrataLens, "rack"> = { connectique: "rack" };

export function lensOf(params: { get(name: string): string | null } | null | undefined): StrataLens | null {
  return params?.get(LENS_PARAM) === "connectique" ? "connectique" : null;
}

/** Lentille Strata active sur l'onglet qui la porte (`null` : la lentille de l'onglet lui-même). */
export function useStrataLens(): StrataLens | null {
  const params = useSearchParams();
  const lens = lensOf(params);
  return lens && params?.get("tab") === LENS_TAB[lens] ? lens : null;
}
