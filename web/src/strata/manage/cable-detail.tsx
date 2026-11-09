"use client";

/**
 * Gérer › Câbles, détail du câble sélectionné (spec v2 §4.2) : le câble et les
 * faces des deux extrémités dessinés, type, signal, couleur, notes, « Voir
 * dans Concevoir », puis « Avancé » replié (étiquettes, style, faisceau,
 * points de passage).
 */

import { useMemo } from "react";
import { AdvancedSection } from "../advanced/advanced-section";
import { rackConnectors } from "../bottom/rack-model";
import { CableDrawing, type DrawingGender } from "../drawings/cable-drawing";
import { EquipmentFace, genderLetter } from "../drawings/equipment-face";
import { Workflow } from "@/components/ui/icons";
import type { CableEnd, CableRow } from "./cables-model";
import { Kv, SECTION_LABEL, SMALL_BTN } from "./manage-ui";
import type { ManageNav } from "./use-manage";

/** Pastille de la couleur métier du câble (couleur propre, sinon celle du signal). */
export function Swatch({ color }: { color: string | null | undefined }) {
  if (!color) return null;
  return <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

const STYLE_LABEL: Record<string, string> = { ortho: "Orthogonal", rounded: "Arrondi", arrow: "Flèches" };

/** Genre de l'extrémité du câble : celui qui s'enfiche sur le port. */
function plugGender(port: string | null): DrawingGender {
  return port === "FEMALE" ? "MALE" : port === "MALE" ? "FEMALE" : "NEUTRAL";
}

function EndBlock({ letter, end, label, row }: { letter: "A" | "B"; end: CableEnd; label: string; row: CableRow }) {
  const eq = end.equipment;
  const face = end.face === "FRONT" || end.face === "REAR" ? end.face : null;
  const connectors = useMemo(() => rackConnectors(eq?.connectors), [eq]);
  const where = [end.rackName, end.locationName].filter(Boolean).join(" · ");
  const connector = end.connectorName ? `${end.connectorName}${end.gender ? ` ${genderLetter(end.gender)}` : ""}` : null;
  return (
    <section aria-label={`Extrémité ${letter}`} className="flex flex-col gap-1.5">
      <span className={SECTION_LABEL}>{`Extrémité ${letter}`}</span>
      <div className="text-[12.5px] font-semibold text-[var(--foreground)]">{end.name}</div>
      {(where || connector) && (
        <div className="text-[12px] text-[var(--muted-foreground)]">
          {[where, connector, face ? (face === "FRONT" ? "face avant" : "face arrière") : null].filter(Boolean).join(" · ")}
        </div>
      )}
      {eq && face && end.portKey && (
        <div className="overflow-hidden rounded-[4px] border border-[var(--border)]">
          <EquipmentFace
            equipment={{
              name: eq.name,
              brand: eq.brand?.name ?? null,
              heightU: eq.heightU,
              isRackable: eq.isRackable !== false,
              dims: [
                (eq as { dimLmm?: number | null }).dimLmm,
                (eq as { dimWmm?: number | null }).dimWmm,
                (eq as { dimHmm?: number | null }).dimHmm,
              ],
              connectors,
            }}
            face={face}
            connectorTypes={row.catalog.connectorTypes}
            signals={row.catalog.signals}
            links={{ [end.portKey]: label }}
            selectedPort={end.portKey}
          />
        </div>
      )}
    </section>
  );
}

export function CableDetail({ row, nav }: { row: CableRow; nav: ManageNav }) {
  const label = row.label?.trim() || "";
  const color = row.color ?? row.signal?.color ?? null;
  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-[2] flex flex-col gap-1 border-b border-[var(--border)] bg-[var(--card)] px-[18px] pt-4 pb-3">
        <span className={SECTION_LABEL}>{`Câble${row.signal ? ` · ${row.signal.name}` : ""}`}</span>
        <h2 className="m-0 font-mono text-[17px] font-bold tracking-[-0.01em] text-[var(--foreground)]">
          {label || "Sans numéro"}
        </h2>
        <span className="text-[12.5px] text-[var(--muted-foreground)]">{row.scope}</span>
      </div>
      <div className="flex flex-col gap-3.5 px-[18px] pt-3.5 pb-10">
        <div className="rounded-[4px] border border-[var(--border)] px-2 py-1.5">
          <CableDrawing
            cable={{
              name: label ? `Câble ${label}` : "Câble sans numéro",
              left: { connectorName: row.from.connectorName ?? "—", iconId: row.from.iconId, gender: plugGender(row.from.gender) },
              right: { connectorName: row.to.connectorName ?? "—", iconId: row.to.iconId, gender: plugGender(row.to.gender) },
              color,
            }}
          />
        </div>
        <EndBlock letter="A" end={row.from} label={label || "—"} row={row} />
        <EndBlock letter="B" end={row.to} label={label || "—"} row={row} />

        <Kv
          rows={[
            ["Type", row.type],
            [
              "Signal",
              row.signal ? (
                <span className="inline-flex items-center gap-1.5">
                  <Swatch color={row.signal.color} />
                  {row.signal.name}
                </span>
              ) : (
                "—"
              ),
            ],
            [
              "Couleur",
              row.color ? (
                <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px]">
                  <Swatch color={row.color} />
                  {row.color}
                </span>
              ) : (
                "Celle du signal"
              ),
            ],
            ["Notes", row.notes?.trim() || "—"],
          ]}
        />

        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => nav.goToTab("synoptique")} className={SMALL_BTN}>
            <Workflow className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            Voir dans Concevoir
          </button>
        </div>

        <AdvancedSection kind="cable" summary="Étiquettes, style, faisceau, points de passage">
          <Kv
            rows={[
              [
                "Étiquettes",
                row.tags.length ? (
                  <span className="flex flex-wrap gap-1">
                    {row.tags.map((t, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-px text-[11px]"
                      >
                        <Swatch color={t.color} />
                        {t.text}
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                ),
              ],
              ["Style", row.cableStyle ? (STYLE_LABEL[row.cableStyle] ?? row.cableStyle) : "—"],
              [
                "Faisceau",
                row.bundle ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Swatch color={row.bundle.color} />
                    {row.bundle.name ?? "Faisceau"}
                  </span>
                ) : (
                  "—"
                ),
              ],
              ["Points de passage", String(row.waypoints)],
              ["Portée", row.kind === "project" ? "Entre deux lieux" : "Dans un lieu"],
              ["Identifiant", <span className="font-mono text-[11.5px]">{row.id}</span>],
            ]}
          />
        </AdvancedSection>
      </div>
    </div>
  );
}
