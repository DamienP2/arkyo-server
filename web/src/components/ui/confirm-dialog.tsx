"use client";

/**
 * ConfirmDialog — dialog de confirmation avec pattern imperative-promise.
 *
 * Layout issu des captures `CAPTURES/modal_confirm.png` :
 *  - Compact (max-w-md), pas de bouton X
 *  - Badge icône coloré à gauche (accent en default, destructive en rouge)
 *  - Titre bold + description mutée
 *  - Footer en grid 2 colonnes (Annuler / action)
 *
 * Usage :
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: "Supprimer cette marque ?",
 *     description: <><strong>Angénieux</strong> sera définitivement supprimée.</>,
 *     variant: "destructive",
 *     confirmLabel: "Supprimer",
 *   });
 *   if (ok) { ... }
 */

import * as React from "react";
import { AlertTriangle, Trash2 } from "@/components/ui/icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// ── Types ────────────────────────────────────────────────────────────────────

type ConfirmVariant = "default" | "destructive";

export type ConfirmOptions = {
  title: string;
  /** Description — accepte du JSX pour highlight inline (ex. <strong>nom</strong>). */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  /** Icône custom dans le badge. Défaut : Trash2 (destructive) ou AlertTriangle. */
  icon?: React.ReactNode;
};

type ConfirmState = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

type ConfirmContextValue = (options: ConfirmOptions) => Promise<boolean>;

// ── Context ──────────────────────────────────────────────────────────────────

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null);

// ── Default icons ────────────────────────────────────────────────────────────

function DefaultIcon({ variant }: { variant: ConfirmVariant }) {
  if (variant === "destructive") return <Trash2 className="h-5 w-5" />;
  return <AlertTriangle className="h-5 w-5" />;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ConfirmState | null>(null);

  const confirm = React.useCallback<ConfirmContextValue>((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  const handleResolve = React.useCallback(
    (value: boolean) => {
      if (state) {
        state.resolve(value);
        setState(null);
      }
    },
    [state],
  );

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) handleResolve(false);
    },
    [handleResolve],
  );

  const variant = state?.variant ?? "default";
  const confirmLabel = state?.confirmLabel ?? "Confirmer";
  const cancelLabel = state?.cancelLabel ?? "Annuler";
  const iconNode = state?.icon ?? <DefaultIcon variant={variant} />;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={state !== null} onOpenChange={handleOpenChange}>
        <DialogContent
          showClose={false}
          className="max-w-md p-0"
          onKeyDown={(e) => {
            // Validation par ENTRÉE (sauf si focus dans un champ de saisie).
            if (e.key !== "Enter") return;
            const t = e.target as HTMLElement | null;
            if (
              t &&
              (t.tagName === "INPUT" ||
                t.tagName === "TEXTAREA" ||
                t.isContentEditable)
            )
              return;
            e.preventDefault();
            handleResolve(true);
          }}
        >
          {/* Body */}
          <div className="flex items-start gap-4 p-5">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                variant === "destructive"
                  ? "bg-[var(--destructive)]/10 text-[var(--destructive)]"
                  : "bg-[var(--accent)]/10 text-[var(--accent)]",
              )}
            >
              {iconNode}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <DialogTitle className="text-sm leading-tight font-semibold">
                {state?.title ?? ""}
              </DialogTitle>
              {state?.description ? (
                <DialogDescription className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {state.description}
                </DialogDescription>
              ) : null}
            </div>
          </div>

          {/* Footer */}
          <div className="grid grid-cols-2 gap-3 px-5 pb-5">
            <Button type="button" variant="outline" onClick={() => handleResolve(false)}>
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={variant === "destructive" ? "destructive" : "accent"}
              onClick={() => handleResolve(true)}
              autoFocus
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useConfirm(): ConfirmContextValue {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within a <ConfirmProvider>");
  }
  return ctx;
}
