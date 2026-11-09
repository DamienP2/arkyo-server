"use client";

/**
 * État d'enregistrement de l'éditeur projet dans la topbar Strata (spec v2
 * §4.1 : « état d'enregistrement » de la topbar projet).
 *
 * `getEditorSlots` (project-editor.tsx) enveloppe sa topbar globale dans
 * `withStrataSaveStatus` ; `ProjectTopbarV2` lit l'état par
 * `useStrataSaveStatus` et, pendant un état visible (pas `idle`), pose le
 * repère `data-strata-save`, qui masque le badge de la barre contextuelle
 * (`StrataCanvasShell`). En Classique, le contexte n'est lu par personne : le
 * badge reste dans la barre contextuelle.
 */

import { createContext, useContext, type ReactNode } from "react";
import { Check, Loader2, X } from "@/components/ui/icons";
import type { SaveStatus } from "@/app/(fullscreen)/project/[id]/_editor/project-contextual-topbar";

const SaveStatusContext = createContext<SaveStatus | undefined>(undefined);

export function withStrataSaveStatus(status: SaveStatus, node: ReactNode): ReactNode {
  return <SaveStatusContext.Provider value={status}>{node}</SaveStatusContext.Provider>;
}

/** État fourni par l'éditeur, `undefined` s'il n'en fournit pas. */
export function useStrataSaveStatus(): SaveStatus | undefined {
  return useContext(SaveStatusContext);
}

/** Mêmes états et mêmes textes que le badge de la barre contextuelle. */
export function StrataSaveBadge({ status }: { status: SaveStatus }) {
  const base = "inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium";
  if (status === "saving") {
    return (
      <span role="status" className={`${base} text-[var(--muted-foreground)]`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Sauvegarde…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span role="status" className={`${base} text-[var(--success-text)]`}>
        <Check className="h-3 w-3" strokeWidth={2.5} />
        Enregistré
      </span>
    );
  }
  if (status === "error") {
    return (
      <span role="status" className={`${base} text-[var(--danger-text)]`}>
        <X className="h-3 w-3" strokeWidth={2.5} />
        Échec
      </span>
    );
  }
  return null;
}
