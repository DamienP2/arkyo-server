"use client";

/**
 * SynoptiqueRackSelector — dropdown rendu dans le subheader (leftSlot du
 * ContextualTopbar). Permet de basculer entre :
 *  - « Général » : tous les emplacements et leurs liaisons → `__general__`
 *  - Un emplacement : vue multi-contenants du lieu → `loc:<locationId>`
 *
 * La vue focus par contenant a disparu du sélecteur (le lieu la remplace) ;
 * le mode focus reste vivant côté route et rendu.
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, MapPin, Workflow } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

import type { InventaireLocation, InventaireRack } from "../../inventaire/inventaire-client";

/** ID spécial qui sélectionne la vue Générale (tous les emplacements). */
export const GENERAL_VIEW_ID = "__general__";

/** Préfixe des valeurs de sélection pointant un emplacement. */
export const LOCATION_VIEW_PREFIX = "loc:";

export function locationViewId(locationId: string): string {
  return `${LOCATION_VIEW_PREFIX}${locationId}`;
}

/** Renvoie l'id d'emplacement d'une valeur de sélection, sinon null. */
export function parseLocationViewId(value: string | null): string | null {
  if (!value || !value.startsWith(LOCATION_VIEW_PREFIX)) return null;
  const id = value.slice(LOCATION_VIEW_PREFIX.length);
  return id.length > 0 ? id : null;
}

export function SynoptiqueRackSelector({
  locations,
  racks,
  selectedViewId,
  onSelectView,
}: {
  locations: InventaireLocation[];
  /** Contenants du projet — sert à compter ceux rattachés à chaque lieu. */
  racks: InventaireRack[];
  /** `__general__` = vue Générale ; `loc:<id>` = emplacement ; null = aucune. */
  selectedViewId: string | null;
  onSelectView: (id: string) => void;
}) {
  const isGeneral = selectedViewId === GENERAL_VIEW_ID;
  const selectedLocationId = parseLocationViewId(selectedViewId);
  const selected = locations.find((l) => l.id === selectedLocationId) ?? null;

  const containerCount = (locationId: string) =>
    racks.filter((r) => r.locationId === locationId && !r.isVirtual).length;

  const countLabel = (n: number) => `${n} contenant${n > 1 ? "s" : ""}`;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "border-border bg-card hover:bg-secondary/40 inline-flex h-7 max-w-[280px] items-center gap-2 rounded-md border px-2.5 text-[11px] font-medium shadow-sm transition-colors",
            "focus:outline-none focus:ring-1 focus:ring-[var(--accent)]",
          )}
        >
          {isGeneral ? (
            <>
              <Workflow className="text-muted-foreground h-3 w-3 shrink-0" strokeWidth={1.75} />
              <span className="truncate uppercase">Général</span>
            </>
          ) : selected ? (
            <>
              <MapPin className="text-muted-foreground h-3 w-3 shrink-0" strokeWidth={1.75} />
              <span className="truncate uppercase">{selected.name}</span>
              {selected.cableCode ? (
                <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                  {selected.cableCode}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <MapPin className="text-muted-foreground h-3 w-3 shrink-0" strokeWidth={1.75} />
              <span className="text-muted-foreground">Sélectionner un emplacement…</span>
            </>
          )}
          <ChevronDown className="text-muted-foreground ml-1 h-3 w-3 shrink-0" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="border-border bg-card z-50 max-h-[60vh] min-w-[260px] overflow-auto rounded-lg border p-1 shadow-md"
        >
          <DropdownMenu.Item
            onSelect={() => onSelectView(GENERAL_VIEW_ID)}
            className={cn(
              "cursor-pointer rounded-md px-2 py-1.5 text-[11px] outline-none transition-colors",
              isGeneral
                ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata (accent sur l'accent à 10 % : --accent-strong)
                : "data-[highlighted]:bg-secondary/60 text-foreground",
            )}
          >
            <div className="flex items-center gap-2">
              <Workflow className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium uppercase">Général</p>
                <p className="text-muted-foreground mt-0.5 truncate font-mono text-[10px]">
                  Emplacements du projet
                </p>
              </div>
            </div>
          </DropdownMenu.Item>
          {locations.length > 0 && (
            <DropdownMenu.Separator className="bg-border/60 my-1 h-px" />
          )}
          {locations.length === 0 ? (
            <div className="text-muted-foreground px-3 py-2 text-[11px]">
              Aucun emplacement dans ce projet
            </div>
          ) : (
            locations.map((loc) => {
              const active = loc.id === selectedLocationId;
              const count = containerCount(loc.id);
              return (
                <DropdownMenu.Item
                  key={loc.id}
                  onSelect={() => onSelectView(locationViewId(loc.id))}
                  className={cn(
                    "cursor-pointer rounded-md px-2 py-1.5 text-[11px] outline-none transition-colors",
                    active
                      ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent-strong)]" // arkyo-server: habillage Strata (accent sur l'accent à 10 % : --accent-strong)
                      : "data-[highlighted]:bg-secondary/60 text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium uppercase">{loc.name}</p>
                      <p className="text-muted-foreground mt-0.5 truncate font-mono text-[10px]">
                        {loc.cableCode ? `${loc.cableCode} · ` : ""}
                        {countLabel(count)}
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
