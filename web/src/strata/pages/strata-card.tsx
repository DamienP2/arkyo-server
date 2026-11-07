/**
 * Carte du catalogue Strata (maquette `viewCatalogue`, `.eq-card` /
 * `.cable-card`) : dessin en tête, sur fond de panneau, puis le corps. Toute
 * la carte ouvre l'éditeur existant (lien étiré sur le nom) ; les actions
 * existantes de la carte (dupliquer, supprimer) restent au-dessus du lien.
 */

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

/** Grille des cartes : 300 px minimum par carte (maquette : `.cat-grid`). */
export const STRATA_GRID_STYLE: CSSProperties = {
  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
};

export function StrataGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="list" aria-label={label} className="grid gap-3.5" style={STRATA_GRID_STYLE}>
      {children}
    </div>
  );
}

export function StrataCard({
  href,
  name,
  reference,
  drawing,
  actions,
  children,
}: {
  href: string;
  name: string;
  reference?: string | null;
  drawing: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article
      role="listitem"
      data-strata-card=""
      className="group relative flex min-w-0 flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] transition-colors hover:border-[var(--border-strong)]"
    >
      <div className="grid min-h-[92px] content-center gap-1 rounded-t-lg border-b border-[var(--border)] bg-[var(--canvas-bg)] p-3.5">
        {drawing}
      </div>
      <div className="grid min-w-0 gap-1.5 px-3.5 pt-2.5 pb-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <Link
            href={href}
            className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[var(--foreground)] outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-[var(--ring)] group-hover:text-[var(--accent-strong)]"
          >
            {name}
          </Link>
          {reference ? (
            <span className="shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">{reference}</span>
          ) : null}
        </div>
        {children}
      </div>
      {actions ? (
        <div className="absolute top-2 right-2 z-10 rounded-md border border-[var(--border)] bg-[var(--surface)] p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      ) : null}
    </article>
  );
}

/** Ligne secondaire d'une carte (marque · catégorie · type…). */
export function CardMeta({ children }: { children: ReactNode }) {
  return <span className="truncate text-xs text-[var(--text-tertiary)]">{children}</span>;
}
