"use client";

/**
 * SignalCard — carte CatalogSignalType / TenantSignalType partagée par le
 * supervisor (CRUD) et le tenant (CRUD perso + read-only Arkyo).
 *
 * Présentation pure : pas de fetch, pas de mutation.
 *
 * Le rendu hérite la couleur de la fonction parente (resolveSignalColor),
 * affiche IP/MC badges quand pertinent, et matérialise le préfixe/suffixe
 * câble effectif (italique si hérité de la fonction).
 *
 * Props :
 *  - `item`       : forme commune SignalCardItem.
 *  - `functions`  : référentiel CatalogFunction[] (pour résoudre la couleur,
 *                    le préfixe hérité, etc.).
 *  - `view`       : "grid" (compact card) ou "list" (1 ligne).
 *  - `onClick?`   : édition (omettre pour read-only).
 *  - `actions?`   : zone d'actions en haut à droite (Trash, Duplicate, etc.).
 *  - `nameBadge?` : badge accolé au libellé (ex: <ArkyoSourceBadge />).
 */

import type { ReactNode } from "react";
import { Waves } from "@/components/ui/icons";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SignalCardFunction = {
  id: string;
  label: string;
  color: string;
  cablePrefix?: string | null;
  cableSuffix?: string | null;
};

/**
 * Forme commune attendue par la carte.
 * - `color` : couleur explicite du signal (peut valoir `#6b7280` = défaut Prisma
 *   ignoré). Si null/défaut, on fallback sur la couleur de la fonction.
 * - `cablePrefix` / `cableSuffix` : valeurs explicites. Si null, hérite de la
 *   fonction (affichage italique).
 */
export type SignalCardItem = {
  id: string;
  name: string;
  color: string | null;
  functionId: string | null;
  cablePrefix: string | null;
  cableSuffix: string | null;
  bandwidth: string | null;
  isIp: boolean;
  usesMulticast: boolean;
};

type Props = {
  item: SignalCardItem;
  functions: SignalCardFunction[];
  view?: "grid" | "list";
  onClick?: () => void;
  actions?: ReactNode;
  nameBadge?: ReactNode;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const PRISMA_DEFAULT = "#6b7280";

/**
 * Couleur effective : priorité à la fonction (cohérence visuelle par
 * fonction). On n'utilise la couleur explicite du signal que si elle est
 * définie ET différente du défaut gris Prisma. Fallback final = gris.
 */
function resolveSignalColor(
  item: SignalCardItem,
  functions: SignalCardFunction[],
): string {
  const fn = item.functionId
    ? functions.find((f) => f.id === item.functionId)
    : null;
  const own =
    item.color &&
    item.color.toLowerCase() !== PRISMA_DEFAULT &&
    item.color.trim()
      ? item.color
      : null;
  return fn?.color ?? own ?? "#a3a3a3";
}

/**
 * Préfixe/suffixe câble effectif : valeur du signal si définie, sinon
 * fallback vers la fonction parente. `inherited=true` permet de styliser en
 * italique muted.
 */
function effectiveCableAffix(
  item: SignalCardItem,
  functions: SignalCardFunction[],
): {
  prefix: string | null;
  suffix: string | null;
  inherited: boolean;
} {
  const ownPrefix =
    item.cablePrefix && item.cablePrefix.length > 0 ? item.cablePrefix : null;
  const ownSuffix =
    item.cableSuffix && item.cableSuffix.length > 0 ? item.cableSuffix : null;
  if (ownPrefix !== null || ownSuffix !== null) {
    return { prefix: ownPrefix, suffix: ownSuffix, inherited: false };
  }
  const fn = item.functionId
    ? functions.find((f) => f.id === item.functionId)
    : null;
  if (fn) {
    const fnPrefix =
      fn.cablePrefix && fn.cablePrefix.length > 0 ? fn.cablePrefix : null;
    const fnSuffix =
      fn.cableSuffix && fn.cableSuffix.length > 0 ? fn.cableSuffix : null;
    if (fnPrefix !== null || fnSuffix !== null) {
      return { prefix: fnPrefix, suffix: fnSuffix, inherited: true };
    }
  }
  return { prefix: null, suffix: null, inherited: false };
}

// ── Component ────────────────────────────────────────────────────────────────

export function SignalCard({
  item,
  functions,
  view = "grid",
  onClick,
  actions,
  nameBadge,
}: Props) {
  const interactive = Boolean(onClick);
  const color = resolveSignalColor(item, functions);
  const fn = item.functionId
    ? functions.find((f) => f.id === item.functionId)
    : null;
  const cable = effectiveCableAffix(item, functions);

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
          <Waves className="h-3 w-3" style={{ color }} />
        </div>
        <p className="flex flex-1 items-center gap-1.5 truncate text-xs font-semibold">
          <span className="truncate">{item.name}</span>
          {item.isIp && <IpBadge />}
          {item.usesMulticast && <McBadge />}
        </p>
        {nameBadge}
        {fn && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium"
            style={{ color: fn.color }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: fn.color }}
            />
            {fn.label}
          </span>
        )}
        {item.bandwidth && (
          <span className="shrink-0 rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--muted-foreground)]">
            {item.bandwidth}
          </span>
        )}
        {(cable.prefix || cable.suffix) && (
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold",
              cable.inherited && "italic opacity-60",
            )}
            style={{ backgroundColor: `${color}15`, color }}
            title={cable.inherited ? "Hérité de la catégorie" : undefined}
          >
            {cable.prefix ?? ""}
            {cable.suffix ? ` … ${cable.suffix}` : ""}
          </span>
        )}
        {actions}
      </div>
    );
  }

  return (
    <Card
      onClick={onClick}
      className={cn(
        "group relative flex flex-col overflow-hidden transition-colors",
        interactive && "cursor-pointer hover:bg-[var(--secondary)]",
      )}
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
            <Waves className="h-4 w-4" style={{ color }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm leading-tight font-semibold">
                {item.name}
              </p>
              {item.isIp && <IpBadge />}
              {item.usesMulticast && <McBadge />}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              {nameBadge}
              {item.bandwidth && (
                <span className="rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--muted-foreground)]">
                  {item.bandwidth}
                </span>
              )}
            </div>
          </div>
        </div>
        {actions}
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="w-14 shrink-0 text-[9px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
            Catégorie
          </span>
          {fn ? (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] font-medium"
              style={{ color: fn.color }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: fn.color }}
              />
              {fn.label}
            </span>
          ) : (
            <span className="text-[10px] text-[var(--muted-foreground)] opacity-40">
              —
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-14 shrink-0 text-[9px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
            Câble
          </span>
          {cable.prefix || cable.suffix ? (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[10px] font-bold",
                cable.inherited && "italic opacity-60",
              )}
              style={{ backgroundColor: `${color}15`, color }}
              title={cable.inherited ? "Hérité de la catégorie" : undefined}
            >
              {cable.prefix ?? ""}
              {cable.suffix ? ` … ${cable.suffix}` : ""}
            </span>
          ) : (
            <span className="text-[10px] text-[var(--muted-foreground)] opacity-40">
              —
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Sub-badges ───────────────────────────────────────────────────────────────

/** Mini badge "IP" — discret, rappelle qu'un signal voyage sur IP. */
function IpBadge() {
  return (
    <span
      className="shrink-0 rounded px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider"
      style={{
        color: "var(--accent)",
        backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)",
      }}
      title="Signal IP"
    >
      IP
    </span>
  );
}

/** Mini badge "MC" — signal qui utilise le multicast (ST2110, AES67, Dante, NDI…). */
function McBadge() {
  return (
    <span
      className="shrink-0 rounded px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider"
      style={{
        color: "var(--accent)",
        backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)",
      }}
      title="Signal multicast"
    >
      MC
    </span>
  );
}
