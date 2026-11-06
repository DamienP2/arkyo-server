"use client";

import React from "react";
import { cn } from "@/lib/utils";

// ── RackEditorConfirmDialog ────────────────────────────────────────────────
// Composant présentationnel contrôlé : affiche un dialog de confirmation
// générique. Aucun state interne, aucun fetch — le parent gère tout via les
// callbacks `onConfirm` / `onCancel`.

export type RackEditorConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  confirmVariant?: "danger" | "default";
};

export function RackEditorConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirmer",
  confirmVariant = "default",
}: RackEditorConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="border-border bg-background flex w-[360px] max-w-[90vw] flex-col gap-4 rounded-lg border p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-foreground text-base font-semibold">{title}</p>
        <p className="text-muted-foreground text-[12px] leading-relaxed">{message}</p>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="border-border bg-background hover:bg-muted h-8 rounded-md border px-3 text-[12px] transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              // arkyo-server: habillage Strata (texte du bouton : --accent-foreground / --destructive-foreground, cf. `color`)
              "h-8 rounded-md px-3 text-[12px] font-medium transition-opacity hover:opacity-90",
            )}
            style={{
              background: confirmVariant === "danger" ? "var(--destructive)" : "var(--accent)",
              // arkyo-server: habillage Strata (blanc illisible sur l'accent sombre)
              color: confirmVariant === "danger" ? "var(--destructive-foreground)" : "var(--accent-foreground)",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
