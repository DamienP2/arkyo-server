"use client";
import { X } from "@/components/ui/icons";
import type { ReactNode } from "react";
import { useWorkspace, useWorkspaceActions } from "./hooks/use-workspace";

export interface SlideOverDef {
  id: string;
  title: string;
  render: (payload: unknown) => ReactNode;
}

export function SlideOverPanel({ registry }: { registry: SlideOverDef[] }) {
  const current = useWorkspace((s) => s.slideOver);
  const { closeSlideOver } = useWorkspaceActions();
  if (!current) return null;
  const def = registry.find((d) => d.id === current.id);
  if (!def) return null;
  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex flex-none items-center justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">{def.title}</h3>
        <button
          type="button"
          onClick={closeSlideOver}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto">{def.render(current.payload)}</div>
    </div>
  );
}
