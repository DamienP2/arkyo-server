"use client";

/**
 * TypeCard — carte CatalogType / TenantType partagée par le supervisor
 * (CRUD + DnD) et le tenant (CRUD perso + read-only Arkyo).
 *
 * Présentation pure : pas de fetch, pas de mutation. Le composant accepte
 *  - `item`     : forme commune (id, name).
 *  - `color`    : couleur de la fonction parente (border-left + bandeau).
 *  - `onClick?` : édition (omettre pour read-only).
 *  - `actions?` : zone d'actions en haut à droite.
 *  - `nameBadge?` : badge accolé au nom.
 *  - `dragHandle?` : nœud GripVertical pour le DnD supervisor.
 *
 * Design extrait des panneaux supervisor `types-panel.tsx` (vue grid) et
 * tenant `categories-panel.tsx`.
 */

import type { ReactNode } from "react";
import { ImageIcon, Shapes } from "@/components/ui/icons";

import { Card } from "@/components/ui/card";

export type TypeCardItem = {
  id: string;
  name: string;
  /** Indicateurs visuels affichés en badges (icône / schéma définis ou non). */
  iconId?: string | null;
  schemaImageUrl?: string | null;
};

type Props = {
  item: TypeCardItem;
  color: string;
  onClick?: () => void;
  actions?: ReactNode;
  nameBadge?: ReactNode;
  dragHandle?: ReactNode;
  /** Contenu discret sous l'en-tête (ex. puces de sous-types). */
  footer?: ReactNode;
  style?: React.CSSProperties;
  innerRef?: (node: HTMLElement | null) => void;
  draggable?: boolean;
};

export function TypeCard({
  item,
  color,
  onClick,
  actions,
  nameBadge,
  dragHandle,
  footer,
  style,
  innerRef,
  draggable,
}: Props) {
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
        <div className="flex min-w-0 items-center gap-2.5">
          {dragHandle}
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${color}20` }}
          >
            <Shapes className="h-4 w-4" style={{ color }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 truncate text-sm leading-tight font-semibold">{item.name}</p>
              {nameBadge}
            </div>
            {/* Badges "Icône" / "Schéma" — indique si le type a ses propres
                ressources visuelles (affichées sous le nom). */}
            {(item.iconId || item.schemaImageUrl) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {item.iconId && (
                  <span className="border-border bg-card text-muted-foreground flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em] uppercase">
                    <Shapes className="h-2.5 w-2.5" />
                    Icône
                  </span>
                )}
                {item.schemaImageUrl && (
                  <span className="border-border bg-card text-muted-foreground flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em] uppercase">
                    <ImageIcon className="h-2.5 w-2.5" />
                    Schéma
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {actions}
      </div>
      {footer && (
        <div className="border-t border-[var(--border)]/50 px-3 py-2">{footer}</div>
      )}
    </Card>
  );
}
