"use client";

/**
 * EditorStatusBadge — pill colorée qui reflète l'état d'auto-save dans le
 * header des éditeurs catalogue.
 *
 * Mappings :
 *  - "saving" → gris + spinner + "Enregistrement…"
 *  - "saved"  → vert (emerald) + check + "Enregistré"
 *  - "error"  → rouge + alerte + "Erreur — réessayer"
 *  - "dirty"  → muted discret + point + "Modifications non enregistrées"
 *  - "idle"   → rien (composant retourne null)
 */

import { AlertCircle, Check, Loader2 } from "@/components/ui/icons";
import type { AutosaveStatus } from "./use-editor-autosave";
import { cn } from "@/lib/utils";

type Props = {
  status: AutosaveStatus;
  /** Date du dernier save réussi (non affichée par défaut, exposée pour tooltips). */
  lastSavedAt?: Date | null;
  className?: string;
};

export function EditorStatusBadge({ status, lastSavedAt, className }: Props) {
  if (status === "idle") return null;

  const baseClass =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium";

  if (status === "saving") {
    return (
      <span
        className={cn(
          baseClass,
          "bg-[var(--secondary)]/60 text-[var(--muted-foreground)]",
          className,
        )}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Enregistrement…
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span
        className={cn(
          baseClass,
          // arkyo-server: habillage Strata
          "bg-[var(--success)]/10 text-[var(--success-text)]",
          className,
        )}
        title={lastSavedAt ? `Dernière sauvegarde : ${lastSavedAt.toLocaleTimeString()}` : undefined}
      >
        <Check className="h-3 w-3" strokeWidth={2.5} />
        Enregistré
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        className={cn(
          baseClass,
          // arkyo-server: habillage Strata
          "bg-[var(--danger)]/10 text-[var(--danger-text)]",
          className,
        )}
      >
        <AlertCircle className="h-3 w-3" strokeWidth={2.5} />
        Erreur — réessayer
      </span>
    );
  }

  // dirty
  return (
    <span
      className={cn(
        baseClass,
        "bg-transparent text-[var(--muted-foreground)]",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted-foreground)]/60" />
      Modifications non enregistrées
    </span>
  );
}
