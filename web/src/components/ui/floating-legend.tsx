"use client";

/**
 * FloatingLegend — panneau de légende statique pour les canvas.
 *
 * Design strictement aligné sur `CartoLegend` (cartographie) :
 *   - bg-card/90 + backdrop-blur-sm + border-border + rounded-md
 *   - Header : "LÉGENDE" en text-[9px] tracking-[0.12em] uppercase
 *   - Padding px-3 py-1.5
 *
 * Comportement : statique en bas-gauche du parent, taille auto (fit-content),
 * pas de drag, pas de resize. Prend juste la place du contenu — quand il y
 * a peu d'items, la box est petite ; quand il y en a beaucoup, elle grandit
 * naturellement avec `max-h` qui borne et active le scroll.
 *
 * Utilisé par :
 *   - Rack (CategoryLegend)
 *   - Synoptique (SignalLegend)
 */

import { X } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

export function FloatingLegend({
  title = "Légende",
  onClose,
  children,
  className,
  offsetRight = 12,
  offsetBottom = 12,
}: {
  /** Label affiché dans le header. Default : "Légende". */
  title?: string;
  /** Bouton croix dans le header pour fermer. Si absent → pas de croix. */
  onClose?: () => void;
  /** Contenu de la légende (liste d'entries). */
  children: React.ReactNode;
  className?: string;
  /** Décalage horizontal depuis le bord droit du parent. Default 12.
   *  Position alignée sur CartoLegend (cartographie). */
  offsetRight?: number;
  /** Décalage vertical depuis le bord bas du parent. Default 12. */
  offsetBottom?: number;
}) {
  return (
    <div
      className={cn(
        // Design carto-legend : bg-card/90 + backdrop-blur-sm + border-border
        // + rounded-md. Position bas-droite du parent (le parent doit être
        // `relative`). Aligné sur CartoLegend (cartographie). Taille auto —
        // max-h pour borner si beaucoup d'items.
        "border-border bg-card/90 absolute z-30 flex max-h-[60vh] max-w-[280px] flex-col overflow-hidden rounded-md border backdrop-blur-sm",
        className,
      )}
      style={{ right: offsetRight, bottom: offsetBottom }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header — label uppercase aligné carto-legend. */}
      <div className="flex flex-none items-center justify-between gap-2 px-3 py-1">
        <span className="text-muted-foreground text-[9px] font-semibold tracking-[0.12em] uppercase">
          {title}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la légende"
            className="text-muted-foreground hover:text-foreground shrink-0 transition-colors focus:outline-none"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Corps — fit-content (pas de flex-1), scroll si max-h atteinte. */}
      <div className="overflow-auto px-3 pb-1.5">{children}</div>
    </div>
  );
}
