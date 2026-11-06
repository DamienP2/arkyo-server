"use client";

/**
 * ContainerSheetCard — carte de contenant PLEINE LARGEUR de la fiche de lieu.
 *
 *  - En-tête repliable : chevron + nom + badge type/U/profondeur + totaux mono
 *    (W · kg · U utilisés/total). Clic sur l'en-tête → sélectionne le contenant
 *    (panneau propriétés à droite).
 *  - Corps : `BomList` (rows éditables inline) avec réglette de slots pour les
 *    châssis modulaires. L'ajout de matériel passe par le drag depuis le
 *    catalogue (pas de bouton d'ajout dans la carte).
 *  - Cible de drop catalogue via `data-rack-id` (hit-test du scope).
 *  - Affectation : menu « Affecter à un emplacement » (vue « À affecter »,
 *    bouton dashed) ou « Déplacer vers… » (vue lieu, icône au hover).
 */

import { ChevronDown, ChevronRight, MapPin, Trash2 } from "@/components/ui/icons";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { cn } from "@/lib/utils";

import {
  BomList,
  RACK_TYPE_COLOR,
  RACK_TYPE_LABEL,
  computeRackTotals,
  formatNum,
  type RackCardData,
} from "./rack-card-canvas";
import type { InventaireLocation } from "../inventaire-client";

export function ContainerSheetCard({
  rack,
  collapsed,
  onToggleCollapsed,
  selected,
  isOver,
  flash,
  onSelect,
  onDelete,
  assignableLocations,
  onAssign,
  assignVariant = "assign",
}: {
  rack: RackCardData;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Contenant sélectionné (panneau propriétés ouvert). */
  selected?: boolean;
  /** Survolé par un drag d'item catalogue. */
  isOver?: boolean;
  /** Surbrillance temporaire après un focus depuis le panneau latéral. */
  flash?: boolean;
  onSelect?: () => void;
  onDelete?: () => void;
  /** Lieux proposés dans le menu d'affectation / de déplacement. */
  assignableLocations?: InventaireLocation[];
  onAssign?: (locationId: string) => void;
  /**
   * `assign` : bouton dashed « Affecter à un emplacement » (vue « À
   * affecter »). `move` : icône compacte « Déplacer vers… » au hover.
   */
  assignVariant?: "assign" | "move";
}) {
  const color = RACK_TYPE_COLOR[rack.rackType];
  const totals = computeRackTotals(rack);
  const typeParts = [
    RACK_TYPE_LABEL[rack.rackType],
    rack.isRackable ? `${rack.totalU}U` : null,
    rack.depthMm > 0 ? `${rack.depthMm}mm` : null,
  ].filter(Boolean);

  return (
    <div
      data-rack-id={rack.id}
      className={cn(
        "overflow-hidden rounded-xl border transition-colors",
        isOver
          ? "border-[var(--accent)]/60"
          : selected
            ? "border-[var(--accent)]/40"
            : "border-[var(--border)]",
        flash && "ring-2 ring-[var(--accent)]",
      )}
      style={{
        borderLeftWidth: 3,
        borderLeftColor: color,
        background: isOver
          ? `color-mix(in srgb, ${color} 8%, var(--card))`
          : "var(--card)",
      }}
    >
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, a, input")) return;
          onSelect?.();
        }}
        className={cn(
          "flex cursor-pointer items-center gap-2.5 px-3 py-2 select-none",
          "bg-[var(--secondary)]/30",
          !collapsed && "border-b border-[var(--border)]/50",
        )}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapsed();
          }}
          title={collapsed ? "Déplier" : "Replier"}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        <span
          className={cn(
            "truncate text-[13px] font-bold uppercase",
            // arkyo-server: habillage Strata (nom sélectionné sur l'en-tête teinté : --accent-strong)
            selected ? "text-[var(--accent-strong)]" : "text-[var(--foreground)]",
          )}
        >
          {rack.name}
        </span>

        <span className="shrink-0 rounded border border-[var(--border)] bg-[var(--secondary)]/60 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold tracking-wide text-[var(--muted-foreground)] uppercase">
          {typeParts.join(" · ")}
        </span>

        <span className="ml-auto shrink-0 font-mono text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)]">
          {formatNum(totals.powerW)} W · {formatNum(totals.weightKg)} kg
          {rack.isRackable
            ? ` · ${Math.round(totals.usedU * 10) / 10}/${rack.totalU}U`
            : ""}
        </span>

        {assignableLocations && assignableLocations.length > 0 && onAssign && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              {assignVariant === "assign" ? (
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  // arkyo-server: habillage Strata (texte au survol sur l'en-tête teinté : --accent-strong)
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-[var(--border)] px-2 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  Affecter à un emplacement
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  title="Déplacer vers un autre emplacement"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--accent)]"
                >
                  <MapPin className="h-3.5 w-3.5" />
                </button>
              )}
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="border-border bg-card z-50 max-h-[50vh] min-w-[220px] overflow-auto rounded-lg border p-1 shadow-md"
              >
                {assignVariant === "move" && (
                  <div className="px-2 pt-1 pb-1.5 text-[9.5px] font-semibold tracking-wider text-[var(--muted-foreground)] uppercase">
                    Déplacer vers…
                  </div>
                )}
                {assignableLocations.map((loc) => (
                  <DropdownMenu.Item
                    key={loc.id}
                    onSelect={() => onAssign(loc.id)}
                    className="data-[highlighted]:bg-secondary/60 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[11px] outline-none"
                  >
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate font-medium uppercase">
                      {loc.name}
                    </span>
                    {loc.cableCode && (
                      <span className="text-muted-foreground ml-auto font-mono text-[10px]">
                        {loc.cableCode}
                      </span>
                    )}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}

        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Supprimer"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="px-2 pt-1 pb-3">
          <BomList
            rackId={rack.id}
            bom={rack.bom ?? []}
            slotVariant="ruler"
            emptyLabel="Aucun équipement — glissez-en depuis le catalogue."
          />
        </div>
      )}
    </div>
  );
}
