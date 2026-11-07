"use client";

/**
 * Onglet « Câbles » du dock bas Strata : liste numérotée des câbles du ou des
 * contenants affichés (repère, départ, arrivée, signal). Un clic sur une
 * ligne sélectionne l'équipement de départ.
 *
 * Portée de la maquette (`renderBottom`, tableau des câbles). La couleur du
 * signal est une couleur métier (référentiel), en simple repère.
 */

import { Cable } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import type { Slot } from "@/components/synoptique/lib/types";
import { cn } from "@/lib/utils";
import {
  byCableLabel,
  cableLabel,
  endName,
  portKeyOfIndex,
  slotConnectors,
  slotsIndex,
  type RackConnectionRow,
  type RackSource,
} from "./rack-model";

/** Signal d'un câble : celui du port de départ, à défaut celui d'arrivée. */
function cableSignal(c: RackConnectionRow, slotsById: ReadonlyMap<string, Slot>): string | null {
  for (const [slotId, index, comp] of [
    [c.fromSlotId, c.fromConnectorIndex, c.fromComponentItemId],
    [c.toSlotId, c.toConnectorIndex, c.toComponentItemId],
  ] as const) {
    const slot = slotId ? slotsById.get(slotId) : undefined;
    if (!slot || comp) continue;
    const key = portKeyOfIndex(slotConnectors(slot), index);
    const entry = key ? slotConnectors(slot)[Number(key.split(":")[0])] : undefined;
    if (entry?.signalName) return entry.signalName;
  }
  return null;
}

export type CableRow = {
  cable: RackConnectionRow;
  from: string;
  to: string;
  signal: string | null;
  color: string | null;
  fromSlot: Slot | null;
};

/** Lignes du tableau, tous contenants confondus, par repère (sans numéro en dernier). */
export function cableRows(sources: readonly RackSource[]): CableRow[] {
  return sources
    .flatMap((src) => {
      const byId = slotsIndex(src.slots);
      const colors = new Map(src.data.signals.map((s) => [s.name, s.color]));
      return (src.connections ?? []).map((cable) => {
        const signal = cableSignal(cable, byId);
        return {
          cable,
          from: endName(cable, "from", byId),
          to: endName(cable, "to", byId),
          signal,
          color: signal ? (colors.get(signal) ?? null) : null,
          fromSlot: (cable.fromSlotId && byId.get(cable.fromSlotId)) || null,
        };
      });
    })
    .sort((a, b) => byCableLabel(a.cable, b.cable));
}

export function CablesTab({
  sources,
  onSelectSlot,
}: {
  sources: readonly RackSource[];
  onSelectSlot?: (slot: Slot) => void;
}) {
  if (sources.some((s) => s.connections === null)) return <LoadingState className="py-8" />;
  const rows = cableRows(sources);
  if (rows.length === 0) return <EmptyState icon={<Cable strokeWidth={1.5} />} title="Aucun câble" className="py-8" />;
  const th = "px-3 py-1.5 text-left text-[11px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase";
  const td = "px-3 py-1.5";
  return (
    <table aria-label="Câbles" className="w-full border-collapse text-[12.5px]">
      <thead className="sticky top-0 bg-[var(--card)]">
        <tr className="border-b border-[var(--border)]">
          <th scope="col" className={th}>
            N°
          </th>
          <th scope="col" className={th}>
            Départ
          </th>
          <th scope="col" className={th}>
            Arrivée
          </th>
          <th scope="col" className={th}>
            Signal
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const select = r.fromSlot && onSelectSlot ? () => onSelectSlot(r.fromSlot!) : undefined;
          return (
            <tr
              key={r.cable.id}
              onClick={select}
              onKeyDown={select ? (e) => e.key === "Enter" && select() : undefined}
              tabIndex={select ? 0 : undefined}
              className={cn(
                "border-b border-[var(--border)] transition-colors outline-none last:border-b-0 hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)]",
                select && "cursor-pointer",
              )}
            >
              <td className={`${td} font-mono whitespace-nowrap text-[var(--foreground)]`}>{cableLabel(r.cable)}</td>
              <td className={`${td} text-[var(--foreground)]`}>{r.from}</td>
              <td className={`${td} text-[var(--foreground)]`}>{r.to}</td>
              <td className={`${td} whitespace-nowrap text-[var(--muted-foreground)]`}>
                {r.signal && (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: r.color ?? "var(--border-strong)" }} />
                    {r.signal}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
