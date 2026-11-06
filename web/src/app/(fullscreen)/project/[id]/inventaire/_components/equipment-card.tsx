"use client";

/**
 * EquipmentCard — carte « un équipement » (hors contenant).
 *
 * Utilisée par :
 *   - `TemplateRackCanvas` (mode template : 1 card par item du BOM)
 *   - Les bandes d'emplacement du canvas Inventaire (équipements libres,
 *     portés par le rack virtuel du lieu)
 *
 * Purement présentationnelle : suppression et quantité sont pilotées par le
 * parent (les URLs d'API diffèrent entre mode projet et mode template).
 */

import { Loader2, Minus, Plus, Trash2 } from "@/components/ui/icons";

import { HostSlotLines } from "./rack-card-canvas";
import type { InventaireBomItem } from "../inventaire-client";

/** Couleur de catégorie — palette stable dérivée du nom de catégorie. */
export function categoryColor(category: string): string {
  const PALETTE = [
    "#3b82f6", // blue
    "#10b981", // emerald
    "#f59e0b", // amber
    "#ef4444", // red
    "#8b5cf6", // violet
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#84cc16", // lime
  ];
  let h = 0;
  for (let i = 0; i < category.length; i++) {
    h = (h * 31 + category.charCodeAt(i)) % PALETTE.length;
  }
  return PALETTE[h];
}

export function EquipmentCard({
  item,
  rackId,
  instanceBadge = null,
  installedComponents = [],
  pending,
  onDelete,
  onIncrement,
  onDecrement,
}: {
  item: InventaireBomItem;
  rackId: string;
  /** Badge « #n » quand plusieurs exemplaires du même hôte cohabitent. */
  instanceBadge?: string | null;
  /** Composants installés dans cet hôte — vide si l'item n'est pas un hôte. */
  installedComponents?: InventaireBomItem[];
  pending: boolean;
  onDelete: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const colorByCategory = item.category
    ? categoryColor(item.category)
    : "var(--border)";
  // Hôte modulaire (châssis type Ross openGear) : masque le stepper quantité
  // (1 exemplaire = 1 card, PATCH quantité interdit côté API) et affiche les
  // lignes de slot internes sous les infos.
  const isHost = item.isComponentHost === true && item.hostSlotCount != null;

  return (
    <div
      className="group relative flex flex-col gap-1.5 overflow-hidden rounded-xl border border-[var(--border)]/60 bg-[var(--card)] p-2.5 shadow-sm transition-all hover:border-[var(--border)] hover:shadow-md"
      style={{ borderLeftWidth: 3, borderLeftColor: colorByCategory }}
    >
      {/* Bouton supprimer — visible au hover */}
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        title="Retirer de l'inventaire"
        className="absolute top-1.5 right-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--card)]/90 text-[var(--muted-foreground)] opacity-0 shadow-sm backdrop-blur transition-all hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] group-hover:opacity-100 disabled:opacity-30"
        aria-label="Supprimer"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3 w-3" />
        )}
      </button>

      {/* Nom — badge « #n » discret quand plusieurs exemplaires de l'hôte.
          pr-6 réserve la place du bouton supprimer (visible au hover). */}
      <p className="flex items-center gap-1.5 pr-6 text-[12px] leading-tight font-semibold text-[var(--foreground)]">
        {instanceBadge && (
          <span className="shrink-0 rounded border border-[var(--border)] px-1 font-mono text-[9px] font-semibold tabular-nums text-[var(--muted-foreground)]">
            {instanceBadge}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
      </p>

      {/* Marque · référence — une seule ligne mono, dense (pattern BomRow). */}
      {(item.brandName || item.reference) && (
        <p className="truncate font-mono text-[10px] leading-tight text-[var(--muted-foreground)]">
          {[item.brandName, item.reference].filter(Boolean).join(" · ")}
        </p>
      )}

      {/* Badges : catégorie, hauteur U, non-rackable — regroupés sur une ligne. */}
      {(item.category || item.heightU != null || item.isRackable === false) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {item.category && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[8px] font-bold tracking-wider uppercase"
              style={{
                background: `${colorByCategory}20`,
                color: colorByCategory,
              }}
            >
              {item.category}
            </span>
          )}
          {item.heightU != null && (
            <span className="font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">
              {item.heightU}U
            </span>
          )}
          {item.isRackable === false && (
            <span className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[8px] font-semibold tracking-wider uppercase text-[var(--muted-foreground)]">
              Non rack
            </span>
          )}
        </div>
      )}

      {/* Lignes de slots de l'hôte modulaire — une ligne par slot, occupée ou
          vide (drop direct d'un composant depuis le catalogue). */}
      {isHost && (
        <HostSlotLines
          rackId={rackId}
          host={item}
          installedComponents={installedComponents}
          size="md"
        />
      )}

      {/* Stepper quantité [−][×N][+] — inline, aligné à droite en fin de card.
          Masqué pour un hôte modulaire (1 exemplaire = 1 card). */}
      {!isHost && (
        <div className="flex justify-end pt-0.5">
          <div
            className="inline-flex items-center gap-0.5 rounded-md border border-[var(--border)]/60 bg-[var(--background)]/60"
            aria-label={`Quantité ${item.quantity}`}
          >
            <button
              type="button"
              onClick={onDecrement}
              disabled={pending || item.quantity <= 1}
              title="Diminuer"
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/60 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Minus className="h-3 w-3" strokeWidth={2.5} />
            </button>
            <span className="min-w-[1.75rem] text-center font-mono text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)]">
              ×{item.quantity}
            </span>
            <button
              type="button"
              onClick={onIncrement}
              disabled={pending}
              title="Augmenter"
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]/60 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Plus className="h-3 w-3" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
