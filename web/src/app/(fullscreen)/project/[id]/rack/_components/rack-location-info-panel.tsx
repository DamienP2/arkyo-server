"use client";

/**
 * RackLocationInfoPanel — panneau d'INFOS en lecture seule de l'emplacement
 * affiché dans l'onglet Rack (portée « par emplacement »), quand aucun slot
 * n'est sélectionné.
 *
 * Même grammaire que `RackInfoPanel` (contenant) et que le panneau
 * d'emplacement de l'Inventaire : en-tête + `InfoCard`. Aucune édition ici —
 * le renommage, le code câbles et la suppression restent dans l'Inventaire.
 */

import { Boxes, MapPin, Server, Weight, Zap } from "@/components/ui/icons";

import {
  InfoCard,
  SectionTitle,
} from "@/components/synoptique/components/property-patterns";

import type {
  InventaireLocation,
  InventaireRack,
} from "../../inventaire/inventaire-client";
import {
  computeRackTotals,
  formatNum,
} from "../../inventaire/_components/rack-card-canvas";

export function RackLocationInfoPanel({
  location,
  racks,
}: {
  location: InventaireLocation;
  /** TOUS les contenants du projet, rack virtuel du lieu inclus. */
  racks: InventaireRack[];
}) {
  const containers = racks.filter(
    (r) => !r.isVirtual && r.locationId === location.id,
  );
  const rackableCount = containers.filter((r) => r.isRackable).length;
  const virtualRack = location.virtualRackId
    ? (racks.find((r) => r.id === location.virtualRackId) ?? null)
    : null;
  const freeItems = (virtualRack?.bom ?? []).filter(
    (it) => it.hostItemId == null,
  );

  // Totaux du lieu : contenants + équipements libres (rack virtuel).
  let powerW = 0;
  let weightKg = 0;
  for (const rack of virtualRack ? [...containers, virtualRack] : containers) {
    const t = computeRackTotals(rack);
    powerW += t.powerW;
    weightKg += t.weightKg;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-4 overflow-auto p-3 text-xs">
        <div>
          <SectionTitle>Emplacement</SectionTitle>
          <div className="text-foreground text-sm font-semibold uppercase">
            {location.name}
          </div>
          {location.cableCode ? (
            <span
              className="text-muted-foreground border-border/60 mt-1.5 inline-block rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {location.cableCode}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <InfoCard
            icon={<Server className="h-3.5 w-3.5" />}
            label="Contenants rackables"
            value={`${rackableCount} / ${containers.length}`}
          />
          <InfoCard
            icon={<Boxes className="h-3.5 w-3.5" />}
            label="Équipements libres"
            value={String(freeItems.length)}
          />
          <InfoCard
            icon={<Weight className="h-3.5 w-3.5" />}
            label="Poids estimé"
            value={weightKg > 0 ? `${formatNum(weightKg)} kg` : "—"}
          />
          <InfoCard
            icon={<Zap className="h-3.5 w-3.5" />}
            label="Conso totale"
            value={powerW > 0 ? `${formatNum(powerW)} W` : "—"}
          />
        </div>

        <div className="border-border border-t pt-3">
          <SectionTitle>Contenants</SectionTitle>
          {containers.length === 0 ? (
            <p className="text-muted-foreground text-[11px]">
              Aucun contenant rattaché à cet emplacement.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {containers.map((r) => (
                <div
                  key={r.id}
                  className="border-border/60 flex items-center gap-2 rounded-md border px-2 py-1.5"
                >
                  <MapPin
                    className="text-muted-foreground h-3 w-3 shrink-0"
                    strokeWidth={1.75}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase">
                    {r.name}
                  </span>
                  <span
                    className="text-muted-foreground shrink-0 text-[10px]"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {r.isRackable ? `${r.totalU}U` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
