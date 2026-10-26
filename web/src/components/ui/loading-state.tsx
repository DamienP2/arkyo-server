"use client";

/**
 * LoadingState — état de chargement standardisé pour toutes les zones en attente
 * de fetch (pages, panneaux, listes, zones de contenu).
 *
 * Même grammaire visuelle que `EmptyState`, mais pour l'attente : spinner animé
 * centré dans sa zone + libellé optionnel en dessous. Sobre : pas de card, pas de
 * bordure — juste un flex column centré avec padding vertical généreux.
 *
 * Règle : attente de zone → toujours ce composant, jamais un texte brut
 * « Chargement… » rendu seul.
 *
 * Exemple :
 *   <LoadingState label="Chargement des factures…" />
 *
 * Variante compacte : ajuster le padding via `className`, ex. `<LoadingState className="py-8" />`.
 */

import * as React from "react";
import { Loader2 } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

export type LoadingStateProps = {
  /** Libellé affiché sous le spinner. Par défaut : « Chargement… ». */
  label?: string;
  /** Classes supplémentaires pour ajuster le padding vertical si besoin. */
  className?: string;
};

export function LoadingState({ label = "Chargement…", className }: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-20 text-center text-[var(--muted-foreground)]",
        className,
      )}
    >
      <Loader2 className="h-6 w-6 animate-spin opacity-60" />
      {label && <p className="text-xs text-[var(--muted-foreground)]">{label}</p>}
    </div>
  );
}
