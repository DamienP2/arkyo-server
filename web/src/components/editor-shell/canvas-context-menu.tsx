"use client";

import * as ContextMenu from "@radix-ui/react-context-menu";
import type { ReactNode } from "react";

export interface CanvasMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  shortcut?: string;
  danger?: boolean;
  separatorAfter?: boolean;
}

export interface CanvasContextMenuProps {
  items: CanvasMenuItem[];
  children: ReactNode;
  disabled?: boolean;
}

export function CanvasContextMenu({ items, children, disabled }: CanvasContextMenuProps) {
  if (disabled || items.length === 0) return <>{children}</>;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="border-border bg-popover text-popover-foreground z-50 min-w-[240px] overflow-hidden rounded-lg border p-1.5 text-xs shadow-lg ring-1 ring-black/5 backdrop-blur-xl">
          {items.map((item, idx) => (
            <div key={item.id}>
              <ContextMenu.Item
                disabled={item.disabled}
                onSelect={item.onSelect}
                // arkyo-server: habillage Strata (texte de danger : --danger-text)
                className={`group hover:text-foreground flex cursor-pointer items-center justify-between gap-4 rounded-md px-2.5 py-1.5 transition-colors outline-none select-none hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 ${item.danger ? "text-[var(--danger-text)] hover:!text-[var(--danger-text)] hover:!bg-[color-mix(in_srgb,var(--destructive)_14%,transparent)]" : ""}`}
              >
                <span className="font-medium">{item.label}</span>
                {item.shortcut && (
                  <span
                    className="border-border bg-muted text-muted-foreground rounded border px-1.5 py-0.5 text-[9px] font-medium"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {item.shortcut}
                  </span>
                )}
              </ContextMenu.Item>
              {item.separatorAfter && idx < items.length - 1 && (
                <ContextMenu.Separator className="bg-border my-1 h-px" />
              )}
            </div>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
