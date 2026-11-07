"use client";

import React from "react";
import { createPortal } from "react-dom";
import { Info } from "@/components/ui/icons";

// ── SynopticEmptyInfoDialog ────────────────────────────────────────────────
// Dialog informatif (pas de confirmation destructive) présentant un titre,
// un message et un bouton unique "OK". Utilisé pour signaler à l'utilisateur
// qu'une action n'a rien à traiter (ex: numérotation automatique sans câble).

export type SynopticEmptyInfoDialogProps = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
};

export function SynopticEmptyInfoDialog({
  open,
  title,
  message,
  onClose,
}: SynopticEmptyInfoDialogProps) {
  if (!open) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="border-border bg-background flex w-[360px] max-w-[90vw] flex-col gap-4 rounded-lg border p-5 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]">
            <Info className="h-3.5 w-3.5 text-[var(--accent)]" />
          </div>
          <p className="text-foreground text-base font-semibold">{title}</p>
        </div>
        <p className="text-muted-foreground text-[12px] leading-relaxed">{message}</p>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            // arkyo-server: habillage Strata (blanc illisible sur l'accent sombre : --accent-foreground)
            className="h-8 rounded-md bg-[var(--accent)] px-3 text-[12px] text-[var(--accent-foreground)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_90%,black)]"
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
