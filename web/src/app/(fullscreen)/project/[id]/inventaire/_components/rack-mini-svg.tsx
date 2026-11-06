"use client";

/**
 * RackMiniSvg — vue 19" miniature pour les cards rackables du canvas Inventaire.
 *
 * Reproduction simplifiée de la face avant : caisson + slots colorés par
 * catégorie. Pas de connecteurs, pas de noms — juste des blocs.
 *
 * Échelle : largeur fixe (60px par défaut), hauteur = `totalU * uHeight`.
 * Largeur fractionnelle des slots (FULL/HALF/THIRD/QUARTER + column) supportée.
 */

import { useMemo } from "react";

// ── Types (slot minimal préchargé côté server) ──────────────────────────────

type WidthFraction = "FULL" | "HALF" | "THIRD" | "QUARTER";

export type RackMiniSlot = {
  id: string;
  startU: number;
  heightU: number;
  /** Vue d'attache du slot — on ne rend que `FRONT`. */
  view?: "FRONT" | "REAR" | "REAR_INTERIOR" | "SIDE" | null;
  widthFraction?: WidthFraction | null;
  /** 0..n-1 selon `widthFraction`. */
  column?: number | null;
  /** Nom de catégorie (clé pour le mapping couleur). */
  category?: string | null;
};

// ── Couleurs des fonctions (fallback hardcodé — pas de dépendance contexte) ─
// "Catégorie" = "Fonction" dans le vocabulaire métier (CatalogFunction).
// Mapping synchronisé avec le seed `database/main/seed.ts`. Sert de fallback
// statique quand l'API inventory ne renvoie pas `categoryColor` et que le
// scope n'a pas encore chargé `catalogOptions.categories`.

const CATEGORY_COLOR: Record<string, string> = {
  "Vidéo": "#3b82f6",
  Audio: "#f59e0b",
  "Lumières": "#facc15",
  "Contrôle": "#a855f7",
  "Énergie": "#ef4444",
  "Data (IT)": "#06b6d4",
  Synchronisation: "#10b981",
  "RF / Sans-fil": "#ec4899",
  Intercom: "#8b5cf6",
  Autres: "#71717a",
  // Catégories internes (panels / accessoires) — pas de CatalogFunction associée.
  "Panels de patch": "#06b6d4",
  "Accessoire rack": "#71717a",
};
const DEFAULT_COLOR = "#71717a";

export function categoryColor(category?: string | null): string {
  if (!category) return DEFAULT_COLOR;
  return CATEGORY_COLOR[category] ?? DEFAULT_COLOR;
}

// ── Helpers largeur ──────────────────────────────────────────────────────────

function fractionDivider(f: WidthFraction | null | undefined): number {
  switch (f) {
    case "HALF":
      return 2;
    case "THIRD":
      return 3;
    case "QUARTER":
      return 4;
    case "FULL":
    default:
      return 1;
  }
}

// ── Composant ────────────────────────────────────────────────────────────────

export function RackMiniSvg({
  slots,
  totalU,
  width = 60,
  uHeight = 4,
  className,
}: {
  slots: RackMiniSlot[];
  totalU: number;
  /** Largeur du caisson en px. */
  width?: number;
  /** Hauteur d'un U en px (défaut 4 → 42U = 168px). */
  uHeight?: number;
  className?: string;
}) {
  // Filtrage : on ne rend que la vue FRONT (les slots rear sont invisibles).
  const frontSlots = useMemo(
    () =>
      slots.filter((s) => {
        if (!s.view) return true; // tolérant : si non typé, on assume FRONT
        return s.view === "FRONT";
      }),
    [slots],
  );

  const innerPad = 2;
  const innerW = width - innerPad * 2;
  const height = Math.max(totalU * uHeight + innerPad * 2, 16);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      {/* Caisson (outer) */}
      <rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        rx={2}
        fill="var(--card)"
        stroke="var(--border)"
        strokeWidth={1}
      />

      {/* Slots colorés */}
      {frontSlots.map((slot) => {
        const div = fractionDivider(slot.widthFraction);
        const col = Math.max(0, Math.min(div - 1, slot.column ?? 0));
        const slotW = innerW / div;
        const x = innerPad + col * slotW;
        // Convention rack : startU = 1 en bas. On rend en partant du haut donc
        // y = (totalU - startU - heightU + 1) * uHeight.
        const yU = totalU - slot.startU - slot.heightU + 1;
        const y = innerPad + yU * uHeight;
        const h = slot.heightU * uHeight;
        const color = categoryColor(slot.category);
        return (
          <rect
            key={slot.id}
            x={x}
            y={y}
            width={slotW}
            height={h}
            fill={color}
            opacity={0.75}
            stroke={color}
            strokeWidth={0.5}
          />
        );
      })}
    </svg>
  );
}
