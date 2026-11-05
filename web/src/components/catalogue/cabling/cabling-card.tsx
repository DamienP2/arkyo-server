"use client";

/**
 * CablingCard — carte CableModel (supervisor) / TenantCableModel (tenant)
 * partagée par le supervisor (CRUD) et le tenant (CRUD perso + read-only
 * Arkyo).
 *
 * Présentation pure : pas de fetch, pas de mutation.
 *
 * La couleur de bordure / fond / chips est dérivée de la fonction
 * (catégorie) parente — résolue côté appelant via la prop `functions`.
 * Caractéristiques techniques rendues en chips compactes.
 *
 * Props :
 *  - `item`       : forme commune CablingCardItem (id, name, reference,
 *                   functionId, brandName, impedance, diameterMm, conductor,
 *                   shielding, jacketMaterial, fireRating, notes).
 *  - `functions`  : référentiel CablingCardFunction[] (pour résoudre la
 *                   couleur et le libellé de section).
 *  - `view`       : "grid" (carte compacte) — la card cabling n'a pas
 *                   actuellement de variante list car le rendu est groupé
 *                   par fonction (rangement vertical).
 *  - `onClick?`   : édition (omettre pour read-only).
 *  - `actions?`   : zone d'actions en haut à droite (Trash, Duplicate, etc.).
 *  - `nameBadge?` : badge accolé au libellé (ex: <ArkyoSourceBadge />).
 */

import type { ReactNode } from "react";
import { Cable as CableIcon } from "@/components/ui/icons";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Référentiels d'affichage (énumérations Settings) ────────────────────────

export const CONDUCTOR_LABEL: Record<string, string> = {
  BARE_COPPER: "Cuivre nu",
  TINNED_COPPER: "Cuivre étamé",
  SILVER_PLATED: "Cuivre argenté",
  FIBER: "Fibre optique",
};

export const SHIELDING_LABEL: Record<string, string> = {
  NONE: "Aucun",
  BRAID: "Tresse",
  FOIL: "Aluminium",
  DOUBLE: "Double",
  QUAD: "Quad",
};

export const JACKET_LABEL: Record<string, string> = {
  PVC: "PVC",
  LSZH: "LSZH",
  TPE: "TPE",
  TPU: "TPU",
  CORDURA: "Cordura",
  RUBBER: "Caoutchouc",
};

// ── Types publics ───────────────────────────────────────────────────────────

export type CablingCardFunction = {
  id: string;
  label: string;
  color: string;
};

/**
 * Forme commune attendue par la carte. `brandName` est déjà résolu côté
 * appelant (pas de fetch).
 */
export type CablingCardItem = {
  id: string;
  name: string;
  reference: string | null;
  functionId: string | null;
  brandName: string | null;
  impedance: number | null;
  diameterMm: number | null;
  conductor: string | null;
  shielding: string | null;
  jacketMaterial: string | null;
  fireRating: string | null;
  notes: string | null;
};

type Props = {
  item: CablingCardItem;
  functions: CablingCardFunction[];
  /**
   * `color` explicite (en général la couleur de section déjà calculée par
   * l'appelant). Si absent, la couleur est résolue depuis `functions`.
   */
  color?: string;
  view?: "grid" | "list";
  onClick?: () => void;
  actions?: ReactNode;
  nameBadge?: ReactNode;
};

// ── Component ───────────────────────────────────────────────────────────────

const FALLBACK_COLOR = "#a3a3a3";

function resolveColor(
  item: CablingCardItem,
  functions: CablingCardFunction[],
  override?: string,
): string {
  if (override) return override;
  if (!item.functionId) return FALLBACK_COLOR;
  return (
    functions.find((f) => f.id === item.functionId)?.color ?? FALLBACK_COLOR
  );
}

export function CablingCard({
  item,
  functions,
  color: colorOverride,
  view = "grid",
  onClick,
  actions,
  nameBadge,
}: Props) {
  const interactive = Boolean(onClick);
  const color = resolveColor(item, functions, colorOverride);

  if (view === "list") {
    return (
      <div
        onClick={onClick}
        className={cn(
          "group flex items-center gap-3 rounded-lg border bg-[var(--card)] px-3 py-2 transition-colors",
          interactive && "cursor-pointer hover:bg-[var(--secondary)]/40",
        )}
        style={{
          borderTopColor: `${color}20`,
          borderRightColor: `${color}20`,
          borderBottomColor: `${color}20`,
          borderLeftColor: color,
          borderLeftWidth: 3,
        }}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}20` }}
        >
          <CableIcon className="h-3 w-3" style={{ color }} />
        </div>
        <p className="flex flex-1 items-center gap-1.5 truncate text-xs font-semibold">
          {item.brandName && (
            <span className="text-[10px] opacity-60">{item.brandName}</span>
          )}
          <span className="truncate">{item.name}</span>
          {nameBadge}
        </p>
        {item.reference && (
          <span
            className="shrink-0 font-mono text-[10px] font-bold"
            style={{ color }}
          >
            {item.reference}
          </span>
        )}
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {item.impedance != null && <Chip color={color}>{item.impedance} Ω</Chip>}
          {item.diameterMm != null && (
            <Chip color={color}>⌀ {item.diameterMm} mm</Chip>
          )}
        </div>
        {actions}
      </div>
    );
  }

  return (
    <Card
      onClick={onClick}
      className={cn(
        "group flex flex-col overflow-hidden transition-colors",
        interactive && "cursor-pointer hover:bg-[var(--secondary)]",
      )}
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
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
            <CableIcon className="h-4 w-4" style={{ color }} />
          </div>
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-1.5 truncate text-sm leading-tight font-semibold">
              {item.brandName && (
                <span className="text-[10px] opacity-60">{item.brandName}</span>
              )}
              <span className="truncate">{item.name}</span>
              {nameBadge}
            </p>
            {item.reference && (
              <p
                className="mt-0.5 truncate font-mono text-[10px] font-bold"
                style={{ color }}
              >
                {item.reference}
              </p>
            )}
          </div>
        </div>
        {actions}
      </div>

      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          {item.impedance != null && (
            <Chip color={color}>{item.impedance} Ω</Chip>
          )}
          {item.diameterMm != null && (
            <Chip color={color}>⌀ {item.diameterMm} mm</Chip>
          )}
          {item.conductor && (
            <Chip color={color}>
              {CONDUCTOR_LABEL[item.conductor] ?? item.conductor}
            </Chip>
          )}
          {item.shielding && item.shielding !== "NONE" && (
            <Chip color={color}>
              {SHIELDING_LABEL[item.shielding] ?? item.shielding}
            </Chip>
          )}
          {item.jacketMaterial && (
            <Chip color={color}>
              {JACKET_LABEL[item.jacketMaterial] ?? item.jacketMaterial}
            </Chip>
          )}
          {item.fireRating && <Chip color={color}>{item.fireRating}</Chip>}
        </div>
        {item.notes && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            {item.notes}
          </p>
        )}
      </div>
    </Card>
  );
}

// ── Chip ────────────────────────────────────────────────────────────────────

function Chip({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}) {
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[9px] font-medium"
      style={{ backgroundColor: `${color}15`, color }}
    >
      {children}
    </span>
  );
}
