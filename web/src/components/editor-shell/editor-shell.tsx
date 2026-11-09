"use client";
import type { ReactNode } from "react";
import { useWorkspace } from "./hooks/use-workspace";
import {
  SHELL_LEFT_TOOLBAR_W,
  SHELL_LEFT_SIDE_PANEL_W,
  SHELL_TOPBAR_GLOBAL_H,
  SHELL_TOPBAR_CTX_H,
  SHELL_SLIDEOVER_W,
} from "@/components/synoptique/lib/constants";
import { useInterface } from "@/strata/interface-context"; // arkyo-server: interface Strata
import { StrataCanvasShell, useCanvasStage } from "@/strata/shell/canvas-shell"; // arkyo-server: interface Strata

export interface EditorShellSlots {
  globalTopbar: ReactNode;
  contextualTopbar?: ReactNode;
  leftToolbar?: ReactNode;
  leftSidePanel?: ReactNode;
  canvas: ReactNode;
  rightPanel?: ReactNode;
  slideOver?: ReactNode;
  /**
   * Hauteur de la topbar globale (px). Défaut = `SHELL_TOPBAR_GLOBAL_H` (52,
   * rack-editor). Le project-editor passe 44 pour aligner avec la topbar
   * standard de l'app (`--topbar-height`).
   */
  globalTopbarHeight?: number;
  // arkyo-server: interface Strata — contenu au-dessus du tiroir et disposition (canevas ou page), ignorés en Classique.
  strata?: { drawerTop?: ReactNode; mode?: "canvas" | "page" };
}

export function EditorShell(slots: EditorShellSlots) {
  const rightW = useWorkspace((s) => s.rightPanelWidth);
  const slideOver = useWorkspace((s) => s.slideOver);
  const topbarH = slots.globalTopbarHeight ?? SHELL_TOPBAR_GLOBAL_H;
  // arkyo-server: interface Strata — disposition canevas plein, mêmes slots ; le canevas est rendu une seule fois
  // (portail dans un hôte stable, voir `useCanvasStage`) : une bascule Classique ↔ Strata ne le remonte pas.
  const ui = useInterface();
  const stage = useCanvasStage(slots, ui);
  if (ui === "strata") return stage.wrap(<StrataCanvasShell {...slots} />);
  return stage.wrap( // arkyo-server: interface Strata
    <div
      className="bg-background text-foreground fixed right-0 bottom-0 left-0 z-50 flex flex-col overflow-hidden"
      style={{ top: "calc(var(--dev-banner-height) + var(--impersonation-banner-height, 0px))" }}
    >
      <div style={{ height: topbarH }} className="border-border flex-none border-b">
        {slots.globalTopbar}
      </div>
      {slots.contextualTopbar && (
        <div
          style={{ height: SHELL_TOPBAR_CTX_H }}
          className="border-border bg-card flex-none border-b"
        >
          {slots.contextualTopbar}
        </div>
      )}
      <div className="flex flex-1 overflow-hidden" ref={stage.classicRow /* arkyo-server: interface Strata */}>
        {slots.leftToolbar && (
          <div
            style={{ width: SHELL_LEFT_TOOLBAR_W }}
            className="border-border bg-card flex-none border-r"
          >
            {slots.leftToolbar}
          </div>
        )}
        {slots.leftSidePanel && (
          <div
            style={{ width: SHELL_LEFT_SIDE_PANEL_W }}
            className="border-border bg-card flex-none border-r"
          >
            {slots.leftSidePanel}
          </div>
        )}
        {/* arkyo-server: interface Strata — l'hôte du canevas (`useCanvasStage`) prend ici la place de
            <div className="relative flex-1 overflow-hidden">{slots.canvas}</div>, même classe, même rang. */}
        {slots.rightPanel && (
          <div style={{ width: rightW }} className="border-border bg-background flex-none border-l">
            {slots.rightPanel}
          </div>
        )}
        {slideOver && slots.slideOver && (
          <div
            style={{ width: SHELL_SLIDEOVER_W }}
            className="border-border bg-card flex-none border-l shadow-xl"
          >
            {slots.slideOver}
          </div>
        )}
      </div>
    </div>
  );
}
