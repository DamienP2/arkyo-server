"use client";

/**
 * Disposition en docks de l'éditeur (interface Strata), avec les mêmes slots
 * qu'`EditorShell` :
 *   - topbar (46 px) ;
 *   - dock gauche : barre d'outils (48 px) puis onglets `leftDockTabs` ou
 *     panneau latéral existant (280 px) ;
 *   - colonne centrale : barre de lentilles (portail de la topbar projet),
 *     barre contextuelle existante, canevas, dock bas ;
 *   - inspecteur : le `rightPanel`, à la largeur du store ;
 *   - volet (`slideOver`) quand le store l'ouvre.
 *
 * Même boîte `fixed` et même décalage haut qu'`EditorShell`. Un slot absent ou
 * `null` ne réserve aucune largeur.
 */

import { createContext, useContext, useState, type ReactNode } from "react";
import type { EditorShellSlots } from "@/components/editor-shell/editor-shell";
import { useWorkspace } from "@/components/editor-shell/hooks/use-workspace";
import {
  SHELL_LEFT_SIDE_PANEL_W,
  SHELL_LEFT_TOOLBAR_W,
  SHELL_SLIDEOVER_W,
  SHELL_TOPBAR_CTX_H,
} from "@/components/synoptique/lib/constants";
import { cn } from "@/lib/utils";

/** Hauteur de la topbar Strata (`--topbar-height` de `[data-interface="strata"]`). */
export const STRATA_TOPBAR_H = 46;

export type StrataDockTab = { id: string; label: string; node: ReactNode };

export type StrataEditorShellProps = EditorShellSlots & {
  bottomDock?: ReactNode;
  leftDockTabs?: StrataDockTab[];
};

/**
 * Emplacement de la barre de lentilles, en tête de la colonne centrale : la
 * topbar projet (rendue dans le slot `globalTopbar`) y place ses lentilles.
 */
const LensSlotContext = createContext<HTMLElement | null>(null);

export function useStrataLensSlot(): HTMLElement | null {
  return useContext(LensSlotContext);
}

/** Onglets segmentés soulignés (`.seg-tabs` de la maquette). */
export const SEG_TAB =
  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[12.5px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
export const SEG_TAB_ON = "border-[var(--accent)] text-[var(--foreground)]";
export const SEG_TAB_OFF = "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]";
export const SEG_BAR =
  "flex min-h-[38px] flex-none items-end gap-0.5 overflow-x-auto border-b border-[var(--border)] [scrollbar-width:none]";

function LeftDockTabs({ tabs }: { tabs: StrataDockTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0].id);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Onglets du dock gauche" className={cn(SEG_BAR, "px-2")}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active.id}
            onClick={() => setActiveId(t.id)}
            className={cn(SEG_TAB, t.id === active.id ? SEG_TAB_ON : SEG_TAB_OFF)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={active.label} className="min-h-0 flex-1 overflow-hidden">
        {active.node}
      </div>
    </div>
  );
}

export function StrataEditorShell(props: StrataEditorShellProps) {
  const rightW = useWorkspace((s) => s.rightPanelWidth);
  const slideOverOpen = useWorkspace((s) => s.slideOver);
  const [lensSlot, setLensSlot] = useState<HTMLElement | null>(null);

  const leftDockTabs = props.leftDockTabs ?? props.strata?.leftDockTabs;
  const bottomDock = props.bottomDock ?? props.strata?.bottomDock;
  const hasTabs = !!leftDockTabs && leftDockTabs.length > 0;
  const hasPanel = hasTabs || !!props.leftSidePanel;
  const hasLeft = !!props.leftToolbar || hasPanel;

  return (
    <LensSlotContext.Provider value={lensSlot}>
      <div
        data-strata-editor=""
        className="fixed right-0 bottom-0 left-0 z-50 flex flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]"
        style={{ top: "calc(var(--dev-banner-height) + var(--impersonation-banner-height, 0px))" }}
      >
        <div data-dock="topbar" style={{ height: STRATA_TOPBAR_H }} className="flex-none border-b border-[var(--border)]">
          {props.globalTopbar}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {hasLeft && (
            <aside
              data-dock="left"
              aria-label="Dock gauche"
              className="flex flex-none border-r border-[var(--border)] bg-[var(--card)]"
            >
              {props.leftToolbar && (
                <div
                  style={{ width: SHELL_LEFT_TOOLBAR_W }}
                  className={cn("h-full flex-none", hasPanel && "border-r border-[var(--border)]")}
                >
                  {props.leftToolbar}
                </div>
              )}
              {hasPanel && (
                <div style={{ width: SHELL_LEFT_SIDE_PANEL_W }} className="h-full min-h-0 flex-none overflow-hidden">
                  {hasTabs ? <LeftDockTabs tabs={leftDockTabs} /> : props.leftSidePanel}
                </div>
              )}
            </aside>
          )}

          <main data-dock="center" className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Barre de lentilles : remplie par la topbar projet (portail). */}
            <div ref={setLensSlot} data-dock="lenses" className="flex-none bg-[var(--card)] empty:hidden" />
            {props.contextualTopbar && (
              <div
                data-dock="contextual"
                style={{ height: SHELL_TOPBAR_CTX_H }}
                className="flex-none border-b border-[var(--border)] bg-[var(--card)]"
              >
                {props.contextualTopbar}
              </div>
            )}
            <div data-dock="canvas" className="relative min-h-0 flex-1 overflow-hidden">
              {props.canvas}
            </div>
            {bottomDock && (
              <div data-dock="bottom" className="flex-none">
                {bottomDock}
              </div>
            )}
          </main>

          {props.rightPanel && (
            <aside
              data-dock="right"
              aria-label="Inspecteur"
              style={{ width: rightW }}
              className="flex-none overflow-hidden border-l border-[var(--border)] bg-[var(--card)]"
            >
              {props.rightPanel}
            </aside>
          )}

          {slideOverOpen && props.slideOver && (
            <div
              data-dock="slideover"
              style={{ width: SHELL_SLIDEOVER_W }}
              className="flex-none border-l border-[var(--border)] bg-[var(--card)] shadow-xl"
            >
              {props.slideOver}
            </div>
          )}
        </div>
      </div>
    </LensSlotContext.Provider>
  );
}
