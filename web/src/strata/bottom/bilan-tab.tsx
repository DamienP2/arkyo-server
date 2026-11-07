"use client";

/**
 * Onglet « Bilan » du dock bas Strata : par contenant affiché, U occupés,
 * puissance des équipements face à la capacité électrique du contenant
 * (`Rack.maxPowerW` : le catalogue ne porte pas de capacité de PDU), poids et
 * dissipation, ports par famille de signal.
 *
 * Portée de la maquette (`renderBottom`, `.bilan`) : jauges U et W, barre des
 * familles (couleurs des fonctions, métier).
 */

import { fmtNumber } from "../catalogue-model";
import { Gauge } from "../drawings/gauge";
import { FamilyBar } from "../pages/strata-catalogue-grid";
import { canvasLookup, rackBilan, type RackSource } from "./rack-model";

export function BilanTab({ sources }: { sources: readonly RackSource[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-6 gap-y-4 px-3.5 py-3">
      {sources.map((src) => {
        const b = rackBilan(src.data, src.slots);
        const muted = "text-xs text-[var(--muted-foreground)]";
        return (
          <div
            key={src.data.rack.id}
            role="group"
            aria-label={src.data.rack.name}
            className="flex min-w-0 flex-col gap-1.5"
          >
            <strong className="truncate text-[13px] font-semibold text-[var(--foreground)]">{src.data.rack.name}</strong>
            <Gauge value={b.usedU} max={b.totalU} unit="U" format={fmtNumber} />
            {b.capacityW != null ? (
              <Gauge value={b.powerW} max={b.capacityW} unit="W" format={fmtNumber} />
            ) : (
              <span className={muted}>{fmtNumber(b.powerW)} W · capacité non renseignée</span>
            )}
            <span className={muted}>
              {fmtNumber(b.weightKg)} kg · {fmtNumber(b.btu)} BTU/h
            </span>
            {b.ports > 0 && (
              <>
                <FamilyBar connectors={b.connectors} lookup={canvasLookup(src.data)} />
                <span className={muted}>
                  {[`${fmtNumber(b.ports)} port${b.ports > 1 ? "s" : ""}`, ...b.families.map((f) => `${f.label} ${f.count}`)].join(
                    " · ",
                  )}
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
