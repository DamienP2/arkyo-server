"use client";

import React from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "@/components/ui/icons";

// ── SynopticClearLabelsDialog ──────────────────────────────────────────────
// Dialog de confirmation pour supprimer la numérotation (labels) de toutes
// les connexions du rack. Composant présentationnel contrôlé.

export type SynopticClearLabelsDialogProps = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function SynopticClearLabelsDialog({
  open,
  onConfirm,
  onCancel,
}: SynopticClearLabelsDialogProps) {
  if (!open) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="border-border bg-background flex w-[360px] max-w-[90vw] flex-col gap-4 rounded-lg border p-5 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="bg-destructive/12 flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
            {/* arkyo-server: habillage Strata (icône de danger : --danger-text) */}
            <Trash2 className="text-[var(--danger-text)] h-3.5 w-3.5" />
          </div>
          <p className="text-foreground text-base font-semibold">Supprimer la numérotation</p>
        </div>
        <p className="text-muted-foreground text-[12px] leading-relaxed">
          Tous les labels de câbles de ce rack seront supprimés. Cette action est irréversible.
        </p>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="border-border bg-background hover:bg-muted h-8 rounded-md border px-3 text-[12px] transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            // arkyo-server: habillage Strata (texte du bouton de danger en variable)
            className="h-8 rounded-md px-3 text-[12px] font-medium text-[var(--destructive-foreground)] transition-opacity hover:opacity-90"
            style={{ background: "var(--destructive)" }}
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
