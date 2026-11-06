"use client";

import * as ContextMenu from "@radix-ui/react-context-menu";
import { Eye, Trash2 } from "@/components/ui/icons";
import type { ReactNode } from "react";

export interface SlotContextMenuProps {
  children: ReactNode;
  slotId: string;
  onShowProperties: (id: string) => void;
  onDelete?: (id: string) => void;
  canDelete?: boolean;
}

export function SlotContextMenu({
  children,
  slotId,
  onShowProperties,
  onDelete,
  canDelete = true,
}: SlotContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div style={{ display: "contents" }} onContextMenu={(e) => e.stopPropagation()}>
          {children}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-[200px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--popover)] p-1.5 text-xs text-[var(--popover-foreground)] shadow-lg ring-1 ring-black/5">
          <ContextMenu.Item
            onSelect={() => onShowProperties(slotId)}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 font-medium transition-colors outline-none select-none hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-[var(--foreground)]"
          >
            <Eye className="h-3.5 w-3.5 shrink-0" />
            Voir les propriétés
          </ContextMenu.Item>
          {onDelete && canDelete && (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-[var(--border)]" />
              <ContextMenu.Item
                onSelect={() => onDelete(slotId)}
                // arkyo-server: habillage Strata (texte de danger : --danger-text)
                className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 font-medium text-[var(--danger-text)] transition-colors outline-none select-none hover:bg-[color-mix(in_srgb,var(--destructive)_14%,transparent)]"
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0" />
                Retirer de la baie
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
