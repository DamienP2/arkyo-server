"use client";

/**
 * Gérer › Matériel, onglet Nomenclature : la table d'arkyo (`buildBomTable`,
 * source unique des exports de l'Inventaire), avec les réglages de contenu
 * mémorisés par l'export de l'onglet Inventaire.
 */

import { useMemo } from "react";
import {
  DEFAULT_BOM_TABLE_OPTIONS,
  buildBomTable,
  sanitizeBomTableOptions,
  type BomTable,
} from "@/app/(fullscreen)/project/[id]/inventaire/_lib/bom-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Box as BoxIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { ManageState } from "./use-manage";

/** Lecture des réglages de contenu de l'export Inventaire (mêmes défauts qu'arkyo). */
function bomOptions(projectId: string) {
  let stored = DEFAULT_BOM_TABLE_OPTIONS;
  try {
    const raw = window.localStorage.getItem(`export:inventaire:${projectId}:table`);
    if (raw) stored = { ...DEFAULT_BOM_TABLE_OPTIONS, ...JSON.parse(raw) };
  } catch {
    /* réglage illisible → défauts */
  }
  return sanitizeBomTableOptions(stored);
}

export function Nomenclature({ data }: { data: ManageState }) {
  const table: BomTable = useMemo(
    () => buildBomTable(data.racks, data.locations, bomOptions(data.projectId)),
    [data.racks, data.locations, data.projectId],
  );
  return (
    <div className="min-h-0 overflow-auto px-6 pt-3.5 pb-24">
      {table.itemCount === 0 ? (
        <EmptyState icon={<BoxIcon strokeWidth={1.5} />} title="Aucun équipement" />
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--card)]">
          <table aria-label="Nomenclature" className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn(
                      "bg-[var(--muted)] px-3.5 py-2 text-left text-[11px] font-semibold tracking-[0.04em] text-[var(--muted-foreground)] uppercase",
                      c.numeric && "text-right",
                    )}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => {
                if (r.kind === "group-location" || r.kind === "group-container") {
                  return (
                    <tr key={i}>
                      <th
                        scope="rowgroup"
                        colSpan={table.columns.length}
                        className={cn(
                          "border-t border-[var(--border)] px-3.5 py-2 text-left",
                          r.kind === "group-location"
                            ? "text-[11px] font-bold tracking-[0.06em] text-[var(--foreground)]"
                            : "font-semibold text-[var(--foreground)]",
                          r.kind === "group-container" && r.free && "italic",
                        )}
                      >
                        {r.label}
                        {r.kind === "group-container" && r.meta && (
                          <span className="ml-2 font-normal text-[var(--text-tertiary)]">{r.meta}</span>
                        )}
                      </th>
                    </tr>
                  );
                }
                const strong = r.kind === "subtotal" || r.kind === "total";
                return (
                  <tr key={i} className={cn(r.kind === "total" && "bg-[var(--muted)]")}>
                    {r.cells.map((cell, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          "border-t border-[var(--border)] px-3.5 py-[7px] text-[var(--foreground)]",
                          table.columns[ci]?.numeric && "text-right font-mono tabular-nums",
                          strong && "font-semibold",
                          r.kind === "subtotal" && "text-[var(--muted-foreground)]",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
