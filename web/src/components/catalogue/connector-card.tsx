"use client";

/**
 * ConnectorCard — carte connecteur partagée par supervisor (CRUD) et tenant
 * (read-only).
 *
 * Design extrait de :
 *   app/supervisor/catalog/_components/connectors-list-panel.tsx (ConnectorCard).
 *
 * Présentation pure — pas de fetch, pas de mutation. `onClick` ouvre l'édition
 * (supervisor) ; `actions` accueille des boutons supervisor (delete).
 * Omettre les deux → carte read-only (tenant).
 */

import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { ConnectorIcon } from "@/components/ui/connector-icon";

import type { ConnectorCardItem } from "./types";

type Props = {
  connector: ConnectorCardItem;
  /**
   * Couleur de la card. Si non fournie, on prend `connector.color` puis
   * `connector.function.color` puis un gris neutre.
   */
  color?: string;
  onClick?: () => void;
  actions?: ReactNode;
};

export function ConnectorCard({ connector, color: colorProp, onClick, actions }: Props) {
  const fn = connector.function;
  const color = colorProp ?? connector.color ?? fn?.color ?? "#a3a3a3";
  const interactive = Boolean(onClick);

  return (
    <Card
      onClick={onClick}
      className={`group flex flex-col overflow-hidden transition-colors ${
        interactive ? "cursor-pointer hover:bg-[var(--secondary)]" : ""
      }`}
      style={{
        borderLeftColor: color,
        borderLeftWidth: 3,
      }}
    >
      <div
        className="flex items-start justify-between gap-2 px-4 pt-4 pb-3"
        style={{ background: `${color}08` }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${color}20` }}
          >
            <ConnectorIcon iconId={connector.iconId} color={color} size={22} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-semibold">{connector.name}</p>
            <p className="truncate font-mono text-[10px] text-[var(--muted-foreground)]">
              {connector.iconId}
            </p>
          </div>
        </div>
        {actions}
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="w-16 shrink-0 text-[9px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
            Catégorie
          </span>
          {fn ? (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] font-medium"
              style={{ color: fn.color }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: fn.color }} />
              {fn.label}
            </span>
          ) : (
            <span className="text-[10px] text-[var(--muted-foreground)] opacity-40">—</span>
          )}
        </div>
      </div>
    </Card>
  );
}
