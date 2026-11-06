"use client";

/**
 * SelectionActionBar — barre d'action groupée des tableaux catalogue.
 *
 * Visible tant qu'une sélection existe. Sticky en bas du conteneur de liste
 * (fond `--background`, bordure haute). Une seule action métier : Supprimer
 * (destructive, rouge — jamais accent).
 */

import { Trash2 } from "@/components/ui/icons";

type Props = {
  count: number;
  onDelete: () => void;
  onClear: () => void;
};

export function SelectionActionBar({ count, onDelete, onClear }: Props) {
  const plural = count > 1 ? "s" : "";
  return (
    <div className="sticky bottom-0 z-20 mt-2 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
      <span className="text-xs font-medium text-[var(--foreground)]">
        {count} sélectionné{plural}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg px-2 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          Désélectionner
        </button>
        <button
          type="button"
          onClick={onDelete}
          // arkyo-server: habillage Strata
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--destructive)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--danger-text)] transition-colors hover:bg-[var(--destructive)]/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Supprimer
        </button>
      </div>
    </div>
  );
}
