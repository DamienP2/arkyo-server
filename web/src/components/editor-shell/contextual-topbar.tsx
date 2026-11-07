"use client";
import type { ReactNode } from "react";
import { useWorkspace } from "./hooks/use-workspace";
import { resolveTool, type ToolRegistry } from "./tool-registry";

export function ContextualTopbar({
  registry,
  leftSlot,
}: {
  registry: ToolRegistry;
  /** Contenu additionnel rendu à droite du nom de l'outil (ex. sélecteur de contenant). */
  leftSlot?: ReactNode;
}) {
  const toolId = useWorkspace((s) => s.activeToolId);
  const variantId = useWorkspace((s) => s.activeVariantId);
  const tool = resolveTool(registry, toolId);
  return (
    <div className="relative flex h-full items-center gap-3 px-4 text-xs">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[color-mix(in_srgb,var(--accent)_28%,transparent)]"
      />
      {tool ? (
        <div key={tool.id} className="animate-fade-in flex flex-1 items-center gap-3">
          <div className="border-border flex items-center gap-2 border-r pr-3">
            <span className="text-foreground text-[13px] font-semibold">{tool.label}</span>
            {tool.shortcut && (
              <kbd
                // arkyo-server: habillage Strata (touche inversée selon le thème : fond --foreground, texte --background)
                className="inline-flex items-center rounded-md bg-[var(--foreground)] px-2 py-0.5 text-[10px] font-semibold text-[var(--background)] shadow-[0_1px_2px_rgba(0,0,0,0.15),inset_0_-1px_0_rgba(255,255,255,0.1)]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {tool.shortcut}
              </kbd>
            )}
          </div>
          {leftSlot}
          {tool.renderContextualTopbar?.(variantId) ?? null}
        </div>
      ) : (
        (leftSlot ?? null)
      )}
    </div>
  );
}
