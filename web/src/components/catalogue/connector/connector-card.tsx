"use client";

/**
 * ConnectorCard — carte CatalogConnectorType / TenantConnectorType partagée
 * par le supervisor (CRUD) et le tenant (CRUD perso + read-only Arkyo).
 *
 * Présentation pure : pas de fetch, pas de mutation.
 *
 * Rendu **monochrome** : aucune couleur n'est dérivée de `item.color` ni des
 * fonctions associées. Le champ `color` est conservé dans le type pour
 * compatibilité ascendante mais n'a aucun effet visuel.
 *
 * Props :
 *  - `item`       : forme commune (id, name, color, versions, iconId, svgUrl,
 *                   hasNeutrikD, functions résolues).
 *  - `view`       : "grid" (compact card) ou "list" (1 ligne).
 *  - `onClick?`   : édition (omettre pour read-only).
 *  - `actions?`   : zone d'actions en haut à droite (Trash, Duplicate, etc.).
 *  - `nameBadge?` : badge accolé au libellé (ex: <ArkyoSourceBadge />).
 */

import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { ConnectorIcon } from "@/components/ui/connector-icon";

export type ConnectorCardFunction = {
  id: string;
  label: string;
  color: string;
};

/**
 * Forme commune attendue par la carte — fournit déjà la liste de fonctions
 * résolues (le mapping `functionIds → CatalogFunction[]` est de la
 * responsabilité du panel appelant).
 *
 * Note : `color` est conservé pour compat ascendante mais ignoré au rendu.
 */
export type ConnectorCardItem = {
  id: string;
  name: string;
  color: string | null;
  versions: string[];
  iconId: string | null;
  svgUrl: string | null;
  /** Le connecteur existe en coque Neutrik D (dérivé du symbole). */
  hasNeutrikD: boolean;
  /** URL du SVG version D du symbole (override builtin ou custom) — null si
   *  la version D est rendue par le code (`ConnectorIcon dType`). */
  dTypeSvgUrl?: string | null;
  functions: ConnectorCardFunction[];
};

type Props = {
  item: ConnectorCardItem;
  view?: "grid" | "list";
  onClick?: () => void;
  actions?: ReactNode;
  nameBadge?: ReactNode;
};

export function ConnectorCard({
  item,
  view = "grid",
  onClick,
  actions,
  nameBadge,
}: Props) {
  const firstFn = item.functions[0] ?? null;
  const interactive = Boolean(onClick);

  if (view === "list") {
    return (
      <div
        onClick={onClick}
        className={
          "group flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 transition-colors" +
          (interactive ? " cursor-pointer hover:bg-[var(--secondary)]/40" : "")
        }
      >
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--secondary)]/60">
            <SymbolPreview iconId={item.iconId} svgUrl={item.svgUrl} size={20} />
          </div>
          {item.hasNeutrikD && (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--secondary)]/60">
              <SymbolPreview
                iconId={item.iconId}
                svgUrl={item.dTypeSvgUrl ?? null}
                dType
                size={20}
              />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <p className="truncate font-mono text-xs font-semibold">{item.name}</p>
          {nameBadge}
        </div>
        {firstFn && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium"
            style={{ color: firstFn.color }}
            title={firstFn.label}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: firstFn.color }}
            />
            {firstFn.label}
          </span>
        )}
        {item.versions.slice(0, 2).map((v) => (
          <span
            key={v}
            className="shrink-0 rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--muted-foreground)]"
          >
            {v}
          </span>
        ))}
        {actions}
      </div>
    );
  }

  const visibleVersions = item.versions.slice(0, 4);
  const extraVersions = Math.max(0, item.versions.length - visibleVersions.length);
  const visibleFns = item.functions.slice(0, 3);
  const extraFns = Math.max(0, item.functions.length - visibleFns.length);

  return (
    <Card
      onClick={onClick}
      className={
        "group flex flex-col overflow-hidden border border-[var(--border)] transition-colors" +
        (interactive ? " cursor-pointer hover:bg-[var(--secondary)]" : "")
      }
    >
      <div className="flex items-start justify-between gap-2 bg-[var(--secondary)]/40 px-4 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex shrink-0 items-center gap-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--secondary)]/80">
              <SymbolPreview iconId={item.iconId} svgUrl={item.svgUrl} size={24} />
            </div>
            {item.hasNeutrikD && (
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--secondary)]/80">
                <SymbolPreview
                  iconId={item.iconId}
                  svgUrl={item.dTypeSvgUrl ?? null}
                  dType
                  size={24}
                />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-mono text-sm leading-tight font-semibold">
                {item.name}
              </p>
              {nameBadge}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {visibleVersions.map((v) => (
                <span
                  key={v}
                  className="rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--muted-foreground)]"
                >
                  {v}
                </span>
              ))}
              {extraVersions > 0 && (
                <span className="text-[9px] font-semibold text-[var(--muted-foreground)]">
                  +{extraVersions}
                </span>
              )}
            </div>
          </div>
        </div>
        {actions}
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="w-16 shrink-0 text-[9px] font-bold tracking-wider text-[var(--muted-foreground)] uppercase">
            Catégories
          </span>
          {visibleFns.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {visibleFns.map((fn) => (
                <span
                  key={fn.id}
                  className="inline-flex items-center gap-1 text-[10px] font-medium"
                  style={{ color: fn.color }}
                  title={fn.label}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: fn.color }}
                  />
                  {fn.label}
                </span>
              ))}
              {extraFns > 0 && (
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  +{extraFns}
                </span>
              )}
            </div>
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

// ── Sub-renderers ───────────────────────────────────────────────────────────

/**
 * Aperçu visuel : SVG custom si fourni, sinon icône built-in (monochrome).
 * `dType` : version Neutrik D — `svgUrl` porte alors l'URL D (override/custom)
 * ou, à défaut, le rendu code en coque D prend le relais.
 */
function SymbolPreview({
  iconId,
  svgUrl,
  dType,
  size,
}: {
  iconId: string | null;
  svgUrl: string | null;
  dType?: boolean;
  size: number;
}) {
  if (svgUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={svgUrl}
        alt="Aperçu"
        style={{ width: size, height: size }}
        className="object-contain"
      />
    );
  }
  return (
    <span className="text-[var(--foreground)]">
      <ConnectorIcon
        iconId={iconId || "circle"}
        dType={dType}
        color="currentColor"
        size={size}
      />
    </span>
  );
}
