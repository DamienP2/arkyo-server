"use client";

/**
 * PhaseCard — carte CatalogPhase / TenantPhase partagée par le supervisor
 * (CRUD + DnD) et le tenant (CRUD perso + read-only Arkyo).
 *
 * Présentation pure : pas de fetch, pas de mutation. Le composant accepte
 *  - `item`     : forme commune (id, label, key).
 *  - `onClick?` : édition (omettre pour read-only).
 *  - `actions?` : zone d'actions en haut à droite.
 *  - `nameBadge?` : badge accolé au libellé.
 *  - `dragHandle?` : nœud GripVertical pour le DnD supervisor.
 *
 * Design extrait des panneaux supervisor `phases-panel.tsx` et tenant
 * `categories-panel.tsx`.
 */

import type { ReactNode } from "react";
import { Layers } from "@/components/ui/icons";

import { Card } from "@/components/ui/card";

export type PhaseCardItem = {
  id: string;
  label: string;
  key: string;
};

type Props = {
  item: PhaseCardItem;
  onClick?: () => void;
  actions?: ReactNode;
  nameBadge?: ReactNode;
  dragHandle?: ReactNode;
  style?: React.CSSProperties;
  innerRef?: (node: HTMLElement | null) => void;
  draggable?: boolean;
};

export function PhaseCard({
  item,
  onClick,
  actions,
  nameBadge,
  dragHandle,
  style,
  innerRef,
  draggable,
}: Props) {
  const interactive = Boolean(onClick);

  return (
    <Card
      ref={innerRef as never}
      onClick={onClick}
      style={style}
      className={`group flex items-center justify-between gap-2 p-4 transition-colors ${
        interactive
          ? draggable
            ? "cursor-grab touch-none hover:bg-[var(--secondary)] active:cursor-grabbing"
            : "cursor-pointer hover:bg-[var(--secondary)]"
          : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {dragHandle}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary)]">
          <Layers className="h-4 w-4 text-[var(--muted-foreground)]" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm leading-tight font-semibold">{item.label}</p>
            {nameBadge}
          </div>
          <p className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">
            {item.key}
          </p>
        </div>
      </div>
      {actions}
    </Card>
  );
}
