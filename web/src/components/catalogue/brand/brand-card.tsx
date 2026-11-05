"use client";

/**
 * BrandCard — carte CatalogBrand / TenantBrand partagée par le
 * supervisor (CRUD) et le tenant (CRUD perso + read-only Arkyo).
 *
 * Présentation pure : pas de fetch, pas de mutation. Le composant accepte
 *  - `item`      : forme commune (id, name, website, logoUrl).
 *  - `view`      : "grid" (compact) ou "list" (1 ligne).
 *  - `onClick?`  : édition (omettre pour read-only).
 *  - `actions?`  : zone d'actions en haut à droite (Trash, Duplicate, etc.).
 *  - `nameBadge?`: badge accolé au libellé (ex: <ArkyoSourceBadge />).
 *
 * Le design est extrait du panel tenant `brands-panel.tsx` (rendu Arkyo) et
 * sert désormais de référence visuelle unique pour tenant + supervisor.
 */

import type { ReactNode } from "react";
import Image from "next/image";
import { Building2, ExternalLink } from "@/components/ui/icons";

export type BrandCardItem = {
  id: string;
  name: string;
  website: string | null;
  logoUrl: string | null;
};

type Props = {
  item: BrandCardItem;
  view?: "grid" | "list";
  onClick?: () => void;
  actions?: ReactNode;
  nameBadge?: ReactNode;
  /** Affiche un lien externe vers `website` à droite (ouvre dans un nouvel onglet). */
  showWebsiteLink?: boolean;
};

export function BrandCard({
  item,
  view = "grid",
  onClick,
  actions,
  nameBadge,
  showWebsiteLink,
}: Props) {
  const interactive = Boolean(onClick);

  if (view === "list") {
    return (
      <div
        onClick={onClick}
        className={
          "group flex items-center gap-3 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] px-3 py-2" +
          (interactive
            ? " cursor-pointer transition-colors hover:bg-[var(--secondary)]/40"
            : "")
        }
      >
        <BrandLogo brand={item} size={28} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <p className="truncate text-xs font-semibold">{item.name}</p>
          {nameBadge}
        </div>
        {item.website && (
          <p className="hidden max-w-[40%] shrink-0 items-center gap-1 truncate text-[10px] text-[var(--muted-foreground)] sm:flex">
            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">
              {item.website.replace(/^https?:\/\//, "")}
            </span>
          </p>
        )}
        {showWebsiteLink && item.website && (
          <a
            href={item.website}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            title="Site web"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {actions}
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={
        "group relative flex items-center gap-3 rounded-xl border border-[var(--border)]/60 bg-[var(--card)] px-4 py-3" +
        (interactive
          ? " cursor-pointer transition-colors hover:bg-[var(--secondary)]/40"
          : "")
      }
    >
      <BrandLogo brand={item} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm leading-tight font-semibold">{item.name}</p>
          {nameBadge}
        </div>
        {item.website && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-[var(--muted-foreground)]">
            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">
              {item.website.replace(/^https?:\/\//, "")}
            </span>
          </p>
        )}
      </div>
      {showWebsiteLink && item.website && (
        <a
          href={item.website}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          title="Site web"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      {actions}
    </div>
  );
}

// ── Logo (placeholder Building2 quand absent) ───────────────────────────────

function BrandLogo({
  brand,
  size,
}: {
  brand: BrandCardItem;
  size: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--secondary)]/60"
      style={{ width: size, height: size }}
    >
      {brand.logoUrl ? (
        <Image
          src={brand.logoUrl}
          alt={brand.name}
          width={size}
          height={size}
          className="h-full w-full object-contain"
          unoptimized
        />
      ) : (
        <Building2
          className="text-[var(--muted-foreground)]"
          style={{ width: size * 0.45, height: size * 0.45 }}
        />
      )}
    </div>
  );
}
