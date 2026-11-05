"use client";

/**
 * EditorUndoRedo — paire de boutons icon (Undo / Redo) pour le header des
 * éditeurs catalogue. Alignés sur le style des icon-buttons existants
 * (h-8 w-8, rounded-md, hover bg-secondary).
 */

import { Redo2, Undo2 } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type Props = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  className?: string;
};

export function EditorUndoRedo({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  className,
}: Props) {
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <IconButton
        onClick={onUndo}
        disabled={!canUndo}
        title="Annuler (⌘Z)"
        aria-label="Annuler"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        onClick={onRedo}
        disabled={!canRedo}
        title="Refaire (⌘⇧Z)"
        aria-label="Refaire"
      >
        <Redo2 className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

function IconButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors",
        "hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--muted-foreground)]",
      )}
    >
      {children}
    </button>
  );
}
