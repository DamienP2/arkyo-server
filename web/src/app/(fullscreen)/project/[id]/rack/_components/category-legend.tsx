"use client";

/**
 * CategoryLegend — overlay HTML flottant pour le canvas rack tab.
 *
 * Wrapper léger autour du `FloatingLegend` partagé. Affiche la liste des
 * catégories/fonctions présentes dans le rack courant avec leur couleur.
 *
 * Design = cartographie (cf. `CartoLegend`).
 * Comportement = déplaçable + redimensionnable, position persistée.
 */

import { FloatingLegend } from "@/components/ui/floating-legend";

type CategoryEntry = {
  id: string;
  name: string;
  color: string;
};

export function CategoryLegend({
  categories,
}: {
  /** Catégories à afficher — issu de `canvasData.categories` (CatalogFunction). */
  categories: CategoryEntry[];
}) {
  if (categories.length === 0) return null;
  return (
    <FloatingLegend>
      <ul className="flex flex-col gap-1 py-0.5">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
              style={{ backgroundColor: c.color }}
            />
            <span className="text-foreground truncate text-[11px]">
              {c.name}
            </span>
          </li>
        ))}
      </ul>
    </FloatingLegend>
  );
}
