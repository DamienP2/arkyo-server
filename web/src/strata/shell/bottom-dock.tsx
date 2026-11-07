"use client";

/**
 * Dock bas de l'éditeur Strata : cadre repliable à onglets (Contrôles, Câbles,
 * Bilan… fournis par les onglets de l'éditeur). Hauteur 220 px, 38 px replié ;
 * l'état replié et l'onglet actif sont mémorisés dans `localStorage`.
 *
 * Le contenu est passé au slot `strata.bottomDock` d'`EditorShell`.
 */

import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "@/components/ui/icons";
import { useLocalStorageState } from "@/lib/hooks/use-local-storage-state";
import { cn } from "@/lib/utils";
import { SEG_BAR, SEG_TAB, SEG_TAB_OFF, SEG_TAB_ON } from "./strata-editor-shell";

export const BOTTOM_DOCK_H = 220;
export const BOTTOM_DOCK_COLLAPSED_H = 38;

export type BottomDockTab = {
  id: string;
  label: string;
  /** Compteur ou pastille après le libellé. */
  extra?: ReactNode;
  node: ReactNode;
};

const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isString = (v: unknown): v is string => typeof v === "string";

export function BottomDock({
  tabs = [],
  actions,
  children,
  storageKey = "strata-bottom-dock",
}: {
  tabs?: BottomDockTab[];
  /** Actions à droite de la barre d'onglets. */
  actions?: ReactNode;
  /** Contenu quand le dock n'a pas d'onglets. */
  children?: ReactNode;
  storageKey?: string;
}) {
  const [open, setOpen] = useLocalStorageState<boolean>(`${storageKey}:open`, true, { isValid: isBoolean });
  const [activeId, setActiveId] = useLocalStorageState<string>(`${storageKey}:tab`, tabs[0]?.id ?? "", {
    isValid: isString,
  });
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  return (
    <section
      aria-label="Dock bas"
      style={{ height: open ? BOTTOM_DOCK_H : BOTTOM_DOCK_COLLAPSED_H }}
      className="flex min-h-0 flex-col border-t border-[var(--border)] bg-[var(--card)]"
    >
      <div className={cn(SEG_BAR, "px-3")}>
        <div role="tablist" aria-label="Dock bas" className="flex items-end gap-0.5">
          {tabs.map((t) => {
            const on = open && t.id === active?.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => {
                  setActiveId(t.id);
                  setOpen(true);
                }}
                className={cn(SEG_TAB, on ? SEG_TAB_ON : SEG_TAB_OFF)}
              >
                {t.label}
                {t.extra}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <div className="mb-1 flex items-center gap-1 self-center">
          {actions}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Replier le dock" : "Déplier le dock"}
            title={open ? "Replier le dock" : "Déplier le dock"}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {open && (
        <div role={active ? "tabpanel" : undefined} className="min-h-0 flex-1 overflow-auto">
          {active ? active.node : children}
        </div>
      )}
    </section>
  );
}
