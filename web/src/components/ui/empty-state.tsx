"use client";

/**
 * EmptyState — état vide standardisé pour toutes les listes / tables de l'app.
 *
 * Design de référence : capture `CAPTURES/page_vide.png` (Admin > Équipements > Liste,
 * bibliothèque vide). Toute liste qui peut se retrouver sans éléments doit utiliser
 * ce composant pour garder un rendu cohérent.
 *
 * Exemple :
 *   <EmptyState
 *     icon={<Package />}
 *     title="Aucun équipement"
 *     description="Ajoutez vos équipements ici…"
 *     action={<button onClick={openCreate}>+ Ajouter un équipement</button>}
 *   />
 */

import * as React from "react";
import { Inbox } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  /** Icône affichée au-dessus du titre. Par défaut : `Inbox` (lucide). */
  icon?: React.ReactNode;
  /** Titre principal, ex. "Aucun équipement". */
  title: string;
  /** Sous-titre en texte muted. Optionnel. */
  description?: React.ReactNode;
  /** Action CTA (bouton, lien…). Optionnel. */
  action?: React.ReactNode;
  /** Classes supplémentaires pour ajuster le padding vertical si besoin. */
  className?: string;
};

/**
 * Reproduit l'empty state de `equipment-list-tab.tsx` :
 * - wrapper flex column centré, `py-20`
 * - icône `w-10 h-10 opacity-30`
 * - titre `text-sm font-medium`
 * - description `text-xs max-w-xs opacity-60`
 * - action `mt-2`
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 py-20 text-center text-[var(--muted-foreground)]",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center opacity-30 [&>svg]:h-10 [&>svg]:w-10">
        {icon ?? <Inbox strokeWidth={1.5} />}
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-xs text-xs opacity-60">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Bouton "action" par défaut utilisé dans EmptyState — garde le look dashed
 * de la capture. Facultatif : on peut passer son propre bouton.
 */
export function EmptyStateAction({
  onClick,
  children,
  className,
  type = "button",
}: {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
        className,
      )}
    >
      {children}
    </button>
  );
}
