"use client";

/**
 * FunctionCard — carte CatalogFunction / TenantFunction partagée par le
 * supervisor (CRUD + DnD) et le tenant (CRUD perso + read-only Arkyo).
 *
 * Présentation pure : pas de fetch, pas de mutation. Le composant accepte
 *  - `item`     : forme commune (id, label, key, color, cable*)
 *  - `onClick?` : édition (omettre pour read-only).
 *  - `actions?` : zone d'actions en haut à droite (Trash, Duplicate, etc.).
 *  - `nameBadge?` : badge accolé au libellé (ex: <ArkyoSourceBadge />).
 *  - `dragHandle?` : nœud rendu à gauche du contenu (GripVertical) — utilisé
 *                    par le supervisor pour le DnD.
 *  - `showCable` : afficher le bandeau « Câble : préfixe … suffixe » (rendu
 *                  uniquement quand l'item porte un préfixe ou un suffixe).
 *
 * Design extrait des panneaux supervisor `functions-panel.tsx` et tenant
 * `categories-panel.tsx`. Toute modification visuelle ici se répercute
 * partout.
 */

import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

export type FunctionCardItem = {
  id: string;
  label: string;
  key: string;
  color: string | null;
  cablePrefix?: string | null;
  cableSuffix?: string | null;
};

type Props = {
  item: FunctionCardItem;
  onClick?: () => void;
  actions?: ReactNode;
  nameBadge?: ReactNode;
  dragHandle?: ReactNode;
  /** Affiche le bandeau « Câble » sous le header si préfixe/suffixe présents. */
  showCable?: boolean;
  /** Style override (pour le DnD : transform/transition/opacity). */
  style?: React.CSSProperties;
  /** Ref + props supplémentaires (DnD attributes + listeners). */
  innerRef?: (node: HTMLElement | null) => void;
  draggable?: boolean;
};

export function FunctionCard({
  item,
  onClick,
  actions,
  nameBadge,
  dragHandle,
  showCable,
  style,
  innerRef,
  draggable,
}: Props) {
  const color = item.color ?? "#6b7280";
  const interactive = Boolean(onClick);

  return (
    <Card
      ref={innerRef as never}
      onClick={onClick}
      style={{
        borderLeftColor: color,
        borderLeftWidth: 3,
        ...style,
      }}
      className={`group flex flex-col overflow-hidden transition-colors ${
        interactive
          ? draggable
            ? "cursor-grab touch-none hover:bg-[var(--secondary)] active:cursor-grabbing"
            : "cursor-pointer hover:bg-[var(--secondary)]"
          : ""
      }`}
    >
      <div
        className="flex items-start justify-between gap-2 px-4 pt-4 pb-3"
        style={{ background: `${color}08` }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {dragHandle}
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${color}20` }}
          >
            <div className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color }} />
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
      </div>
      {showCable && (
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="w-14 shrink-0 text-[9px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
              Câble
            </span>
            {item.cablePrefix || item.cableSuffix ? (
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
                style={{ backgroundColor: `${color}15`, color }}
              >
                {item.cablePrefix ?? ""}
                {item.cableSuffix ? ` … ${item.cableSuffix}` : ""}
              </span>
            ) : (
              <span className="text-[10px] text-[var(--muted-foreground)] opacity-40">—</span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
