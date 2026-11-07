"use client";
import { useEffect } from "react";
import { isDivider, type ToolRegistry } from "../tool-registry";
import { useWorkspaceActions } from "./use-workspace";

export function useKeyboardShortcuts(registry: ToolRegistry | null) {
  const { setTool } = useWorkspaceActions();
  useEffect(() => {
    if (!registry) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        return;
      const match = registry.tools.find(
        (t) => !isDivider(t) && t.shortcut?.toLowerCase() === e.key.toLowerCase(),
      );
      if (match && !isDivider(match)) {
        e.preventDefault();
        setTool(match.id, match.defaultVariantId ?? match.variants?.[0]?.id ?? null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [registry, setTool]);
}
