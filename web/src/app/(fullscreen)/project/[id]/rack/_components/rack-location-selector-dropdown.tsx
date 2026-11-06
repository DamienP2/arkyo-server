"use client";

/**
 * RackLocationSelectorDropdown — sélecteur d'emplacement de la sous-barre de
 * l'onglet Rack, affiché à la place du sélecteur de contenant quand la portée
 * d'affichage est « par emplacement ».
 *
 * Même grammaire que le sélecteur de contenant voisin (hauteur 7, bordure,
 * nom uppercase + méta mono) et que le sélecteur d'emplacements du synoptique.
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, MapPin } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

import type {
  InventaireLocation,
  InventaireRack,
} from "../../inventaire/inventaire-client";

export function RackLocationSelectorDropdown({
  locations,
  racks,
  selectedLocationId,
  onSelectLocation,
}: {
  locations: InventaireLocation[];
  /** Contenants du projet — pour compter les contenants rackables par lieu. */
  racks: InventaireRack[];
  selectedLocationId: string | null;
  onSelectLocation: (id: string) => void;
}) {
  const selected = locations.find((l) => l.id === selectedLocationId) ?? null;

  const rackableCount = (locationId: string) =>
    racks.filter(
      (r) => r.locationId === locationId && r.isRackable && !r.isVirtual,
    ).length;

  const meta = (loc: InventaireLocation) => {
    const n = rackableCount(loc.id);
    return [loc.cableCode?.trim() || null, `${n} contenant${n > 1 ? "s" : ""}`]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="border-border bg-card hover:bg-secondary/40 inline-flex h-7 max-w-[280px] items-center gap-2 rounded-md border px-2.5 text-[11px] font-medium transition-colors"
        >
          <MapPin
            className="text-muted-foreground h-3 w-3 shrink-0"
            strokeWidth={1.75}
          />
          {selected ? (
            <>
              <span className="truncate uppercase">{selected.name}</span>
              <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                {meta(selected)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Sélectionner un emplacement…
            </span>
          )}
          <ChevronDown className="text-muted-foreground ml-1 h-3 w-3 shrink-0" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="border-border bg-card z-50 max-h-[60vh] min-w-[240px] overflow-auto rounded-lg border p-1 shadow-md"
        >
          {locations.length === 0 ? (
            <div className="text-muted-foreground px-3 py-2 text-[11px]">
              Aucun emplacement dans ce projet
            </div>
          ) : (
            locations.map((loc) => {
              const active = loc.id === selectedLocationId;
              return (
                <DropdownMenu.Item
                  key={loc.id}
                  onSelect={() => onSelectLocation(loc.id)}
                  className={cn(
                    "cursor-pointer rounded-md px-2 py-1.5 text-[11px] outline-none transition-colors",
                    active
                      ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata
                      : "data-[highlighted]:bg-secondary/60 text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium uppercase">
                        {loc.name}
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate font-mono text-[10px]">
                        {meta(loc)}
                      </p>
                    </div>
                  </div>
                </DropdownMenu.Item>
              );
            })
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
