"use client";

import React from "react";
import { AlertTriangle, X } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { Toast } from "@/components/synoptique/hooks/use-toasts";

/** Pile de toasts affichée en haut-gauche de la zone de visualisation du rack. */
export function ToastStack({
  toasts,
  onRemove,
}: {
  toasts: Toast[];
  onRemove: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-[100] flex flex-col items-start gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "animate-in slide-in-from-right-4 fade-in pointer-events-auto flex max-w-[360px] items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-xl duration-200",
            // arkyo-server: habillage Strata (erreur : --danger-text ; alerte : --warning,
            // --warning-text ; info : texte d'accent sur la teinte en --accent-strong)
            t.type === "error" && "bg-destructive/10 border-destructive/30 text-[var(--danger-text)]",
            t.type === "warning" && "border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning-text)]",
            t.type === "info" &&
              "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent-strong)]",
            !t.type && "bg-destructive/10 border-destructive/30 text-[var(--danger-text)]",
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1 text-[13px] leading-snug">{t.message}</span>
          <button
            onClick={() => onRemove(t.id)}
            className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
