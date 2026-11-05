"use client";

/**
 * EquipmentCard — carte équipement partagée par supervisor (CRUD/DnD) et
 * tenant (read-only).
 *
 * Design extrait de :
 *   app/(app)/admin/_components/equipment-list-tab.tsx (DraggableEquipment).
 *
 * Présentation pure — pas de DnD ici (le supervisor enveloppe la card dans
 * son propre wrapper draggable). Pas de navigation, pas de mutation.
 *
 * Deux modes :
 *  - `view="grid"` (défaut) : carte 260px+ avec image marque + caractéristiques.
 *  - `view="list"` : ligne compacte.
 *
 * Icône : si pas de logo marque, on rend l'icône équipement (override ou
 * hérité catégorie) via `<EquipmentIcon>` — fallback Package lucide.
 */

import type { ReactNode } from "react";

import { EquipmentIcon } from "@/components/ui/equipment-icon";

import type { EquipmentCardItem } from "./types";

type Props = {
  item: EquipmentCardItem;
  /** Couleur de la card (border-left + bandeau). Hérite de la fonction. */
  color: string;
  view?: "grid" | "list";
  /** Click sur la card (édition côté supervisor). Read-only si omis. */
  onClick?: () => void;
  /** Boutons d'action supervisor (archive, delete, dup, propose…). */
  actions?: ReactNode;
  /** Badge optionnel à côté du nom (ex: ArkyoBadge + dot "update available"). */
  nameBadge?: ReactNode;
};

export function EquipmentCard({
  item,
  color,
  view = "grid",
  onClick,
  actions,
  nameBadge,
}: Props) {
  const interactive = Boolean(onClick);

  if (view === "list") {
    return (
      <div
        onClick={onClick}
        className={`group flex items-center gap-2.5 rounded-lg border bg-[var(--card)] px-3 py-2 transition-colors ${
          interactive ? "cursor-pointer hover:bg-[var(--secondary)]" : ""
        }`}
        style={{
          borderTopColor: `${color}20`,
          borderRightColor: `${color}20`,
          borderBottomColor: `${color}20`,
          borderLeftColor: color,
          borderLeftWidth: 3,
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{item.name}</p>
            {item.category && (
              <p className="truncate text-[9px] text-[var(--muted-foreground)]">
                {item.category}
              </p>
            )}
          </div>
          {nameBadge}
        </div>
        {item.brand?.name && (
          <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">
            {item.brand.name}
          </span>
        )}
        {item.reference && (
          <span className="shrink-0 font-mono text-[9px] text-[var(--muted-foreground)]">
            {item.reference}
          </span>
        )}
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold"
          style={{ background: `${color}20`, color }}
        >
          {item.isRackable ? (item.heightU ? `${item.heightU}U` : "Rack") : "Libre"}
        </span>
        {item.powerW != null && (
          <span className="shrink-0 font-mono text-[10px] text-[var(--muted-foreground)]">
            {item.powerW}W
          </span>
        )}
        {item.is2110 && (
          <span className="shrink-0 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-medium text-sky-600 dark:text-sky-400">
            2110
          </span>
        )}
        {actions}
      </div>
    );
  }

  // GRID view (défaut)
  return (
    <div
      onClick={onClick}
      className={`relative flex h-full flex-col overflow-hidden rounded-xl border bg-[var(--card)] transition-colors ${
        interactive ? "cursor-pointer hover:bg-[var(--secondary)]" : ""
      }`}
      style={{
        borderTopColor: `${color}15`,
        borderRightColor: `${color}15`,
        borderBottomColor: `${color}15`,
        borderLeftColor: color,
        borderLeftWidth: 3,
      }}
    >
      <div
        className="flex items-start justify-between gap-2 px-3 pt-3 pb-2"
        style={{ background: `${color}08` }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {item.brand?.logoUrl ? (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-white dark:bg-white/10">
              <img
                src={item.brand.logoUrl}
                alt=""
                className="h-full w-full object-contain p-0.5"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          ) : (
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ background: `${color}20` }}
            >
              <EquipmentIcon
                iconUrl={item.iconUrl}
                categoryIconId={item.categoryIconId}
                size={14}
                color={color}
              />
            </div>
          )}
          <div className="min-w-0">
            {item.brand?.name && (
              <p className="truncate text-[10px] leading-none text-[var(--muted-foreground)]">
                {item.brand.name}
              </p>
            )}
            {item.reference && (
              <p
                className="mt-0.5 truncate font-mono text-[10px] leading-none font-bold"
                style={{ color }}
              >
                {item.reference}
              </p>
            )}
          </div>
        </div>
        {actions}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3 pb-3">
        <div className="flex items-start gap-1">
          <p className="line-clamp-2 flex-1 text-sm leading-tight font-semibold">{item.name}</p>
          {nameBadge}
        </div>
        {item.category && (
          <p className="-mt-1 truncate text-[10px] text-[var(--muted-foreground)]">
            {item.category}
          </p>
        )}
        <div className="mt-auto flex flex-wrap gap-1">
          <span
            className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
            style={{ background: `${color}18`, color }}
          >
            {item.isRackable ? (item.heightU ? `${item.heightU}U` : "Rack") : "Libre"}
          </span>
          {item.isRackable && item.widthFraction && item.widthFraction !== "FULL" && (
            <span className="rounded-md bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
              {item.widthFraction === "HALF"
                ? "1/2"
                : item.widthFraction === "THIRD"
                  ? "1/3"
                  : "1/4"}
            </span>
          )}
          {item.powerW != null && (
            <span className="rounded-md bg-[var(--secondary)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--muted-foreground)]">
              {item.powerW}W
            </span>
          )}
          {item.weight != null && (
            <span className="rounded-md bg-[var(--secondary)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--muted-foreground)]">
              {item.weight}kg
            </span>
          )}
          {item.is2110 && (
            <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
              2110
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
