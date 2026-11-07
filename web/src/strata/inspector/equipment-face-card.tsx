"use client";

/**
 * Face de l'équipement sélectionné, en tête de l'inspecteur Strata (spec
 * §6.2, lot 3), au-dessus du panneau existant :
 *   - face avant ou arrière à l'échelle (`EquipmentFace`), ports reliés
 *     marqués, survol d'une entrée ;
 *   - entrées de connectique de la face : repère de famille, connecteur et
 *     genre (`M` / `F` / `N`), occupation `reliés/quantité` ;
 *   - un clic sur un port montre son câble et l'autre extrémité ;
 *   - position, énergie et poids, réseau.
 *
 * Portée de la maquette (`renderInspector`). Rien sans équipement (aucune
 * sélection, panel, accessoire).
 */

import { useMemo, useState, type ReactNode } from "react";
import type { RackCanvasData } from "@/app/(fullscreen)/project/[id]/rack/rack-tab-client";
import type { Equipment, Slot } from "@/components/synoptique/lib/types";
import { cn } from "@/lib/utils";
import { drawingConnectorTypes, drawingSignals, fmtNumber, totalPorts } from "../catalogue-model";
import { DIRECTION_LABEL, EquipmentFace, genderLetter } from "../drawings/equipment-face";
import { entryLabel, portCount, type FaceSide } from "../drawings/face-layout";
import { cardFace } from "../pages/strata-catalogue-grid";
import {
  cableAt,
  cableLabel,
  canvasLookup,
  endName,
  heatOf,
  portLabel,
  rackConnectors,
  slotLinks,
  slotsIndex,
  type RackConnectionRow,
} from "../bottom/rack-model";

const VIEW_LABEL: Record<string, string> = {
  FRONT: "avant",
  REAR: "arrière",
  REAR_INTERIOR: "arrière intérieur",
  SIDE: "côté",
};

const SECTION = "flex flex-col gap-2 border-b border-[var(--border)] px-3.5 py-3 last:border-b-0";
const LABEL = "text-[10.5px] font-bold tracking-[0.08em] text-[var(--text-tertiary)] uppercase";

function Section({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className={SECTION}>
      <div className="flex items-center gap-2">
        <span className={LABEL}>{label}</span>
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </div>
  );
}

/** Liste `terme / valeur` de l'inspecteur. */
function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[var(--muted-foreground)]">{k}</dt>
          <dd className="min-w-0 truncate text-[var(--foreground)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Contrôle segmenté Avant / Arrière. */
export function FaceToggle({ value, onChange }: { value: FaceSide; onChange: (f: FaceSide) => void }) {
  return (
    <span role="group" aria-label="Face" className="inline-flex rounded-md border border-[var(--border)] bg-[var(--muted)] p-0.5">
      {(["FRONT", "REAR"] as const).map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={value === f}
          onClick={() => onChange(f)}
          className={cn(
            "rounded px-2 py-px text-[11.5px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
            value === f
              ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
          )}
        >
          {f === "FRONT" ? "Avant" : "Arrière"}
        </button>
      ))}
    </span>
  );
}

const flag = (eq: Equipment, key: string): unknown => (eq as Record<string, unknown>)[key];

export type EquipmentFaceCardProps = {
  /** Slot sélectionné (canvas du rack) ; sans lui, `equipment` seul (élément non placé). */
  slot: Slot | null;
  /** Équipement d'un élément non placé (inventaire). */
  equipment?: Equipment | null;
  canvasData: RackCanvasData | null;
  /** Câbles du contenant (`null` : en cours de lecture). */
  connections?: readonly RackConnectionRow[] | null;
  /** Slots du contenant, pour nommer l'autre extrémité d'un câble. */
  slots?: readonly Slot[];
  rackName?: string | null;
};

export function EquipmentFaceCard(props: EquipmentFaceCardProps) {
  const eq = props.slot?.equipment ?? props.equipment ?? null;
  if (!eq || !props.canvasData) return null;
  // Une sélection neuve repart de sa face la plus garnie, sans port choisi.
  return <FaceCardBody key={props.slot?.id ?? eq.id} {...props} eq={eq} canvasData={props.canvasData} />;
}

function FaceCardBody({
  slot,
  eq,
  canvasData,
  connections = null,
  slots,
  rackName,
}: EquipmentFaceCardProps & { eq: Equipment; canvasData: RackCanvasData }) {
  const connectors = useMemo(() => rackConnectors(eq.connectors), [eq.connectors]);
  const lookup = useMemo(() => canvasLookup(canvasData), [canvasData]);
  const connectorTypes = useMemo(() => drawingConnectorTypes(lookup), [lookup]);
  const signals = useMemo(() => drawingSignals(lookup), [lookup]);
  const typeName = useMemo(() => new Map(connectorTypes.map((t) => [t.id, t.name])), [connectorTypes]);
  const colorOf = useMemo(() => new Map(canvasData.signals.map((s) => [s.name, s.color])), [canvasData.signals]);

  const [face, setFace] = useState<FaceSide>(() => cardFace(connectors));
  const [selectedPort, setSelectedPort] = useState<string | null>(null);
  const [hoverEntry, setHoverEntry] = useState<number | null>(null);

  const links = useMemo(() => (slot ? slotLinks(slot, connections) : {}), [slot, connections]);
  const slotsById = useMemo(() => slotsIndex(slots ?? (slot ? [slot] : [])), [slots, slot]);
  const faces = (["FRONT", "REAR"] as const).filter((f) => connectors.some((c) => c.face === f && portCount(c) > 0));
  const entries = connectors.map((e, i) => ({ e, i })).filter(({ e }) => e.face === face);
  const used = Object.keys(links).length;
  const total = totalPorts(connectors);

  const selected = selectedPort ? connectors[Number(selectedPort.split(":")[0])] : undefined;
  const selectedName = selectedPort ? portLabel(connectors, selectedPort) : null;
  const plugged = slot && selectedPort ? cableAt(slot, selectedPort, connections) : null;

  const startU = slot?.startU;
  const heightU = slot?.heightU ?? eq.heightU ?? 1;
  const units =
    startU != null
      ? `${heightU > 1 ? `U${startU}–U${startU + heightU - 1}` : `U${startU}`} · ${heightU} U · ${VIEW_LABEL[slot?.view ?? ""] ?? slot?.view}`
      : "Non placé";
  const btu = heatOf(eq);
  const is2110 = flag(eq, "is2110") === true || flag(eq, "is2110") === 1;
  const mode2110 = flag(eq, "ip2110Mode");
  const netPorts = connectors.filter((c) => c.networkRole).reduce((a, c) => a + portCount(c), 0);

  return (
    <section aria-label="Équipement sélectionné" className="flex flex-col">
      <Section
        label="Connectique"
        aside={faces.length > 1 ? <FaceToggle value={face} onChange={setFace} /> : null}
      >
        <div className="overflow-hidden rounded-[4px] border border-[var(--border)]">
          <EquipmentFace
            equipment={{
              name: eq.name,
              brand: eq.brand?.name ?? null,
              heightU: eq.heightU,
              isRackable: eq.isRackable !== false,
              dims: [eq.dimLmm, eq.dimWmm, eq.dimHmm],
              connectors,
            }}
            face={face}
            connectorTypes={connectorTypes}
            signals={signals}
            links={links}
            selectedPort={selectedPort}
            hoverEntry={hoverEntry}
            onPortClick={(key) => setSelectedPort((k) => (k === key ? null : key))}
            onEntryHover={setHoverEntry}
          />
        </div>
        <span className="text-xs text-[var(--muted-foreground)]">
          {used} / {total} ports reliés
        </span>
        {entries.length > 0 && (
          <ul aria-label="Entrées de connectique" className="flex flex-col">
            {entries.map(({ e, i }) => {
              const n = Object.keys(links).filter((k) => k.startsWith(`${i}:`)).length;
              return (
                <li
                  key={e.id || i}
                  onMouseEnter={() => setHoverEntry(i)}
                  onMouseLeave={() => setHoverEntry(null)}
                  className={cn(
                    "grid grid-cols-[10px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded px-1.5 py-1 text-[12px]",
                    hoverEntry === i && "bg-[var(--muted)]",
                  )}
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ background: colorOf.get(e.signalName) ?? "var(--border-strong)" }}
                  />
                  <span className="truncate text-[var(--foreground)]">
                    {entryLabel(e)}
                    {e.label?.trim() && e.signalName && (
                      <span className="ml-1.5 text-[var(--muted-foreground)]">{e.signalName}</span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--muted-foreground)]">
                    {`${typeName.get(e.connectorTypeId) ?? "?"} ${genderLetter(e.gender)}`}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{`${n}/${portCount(e)}`}</span>
                </li>
              );
            })}
          </ul>
        )}
        {selectedPort && selected && selectedName && (
          <div
            role="region"
            aria-label={`Port ${selectedName}`}
            className="flex flex-col gap-1 rounded-md border border-[var(--border-strong)] px-2.5 py-2 text-[12.5px]"
          >
            <strong className="font-semibold text-[var(--foreground)]">{selectedName}</strong>
            <span className="text-xs text-[var(--muted-foreground)]">
              {[
                `${typeName.get(selected.connectorTypeId) ?? "?"} ${genderLetter(selected.gender)}`,
                selected.signalName,
                DIRECTION_LABEL[selected.direction] ?? selected.direction,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {plugged ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="font-mono text-[var(--foreground)]">
                  {plugged.cable.label?.trim() ? cableLabel(plugged.cable) : "Sans numéro"}
                </span>
                <span className="truncate text-[var(--muted-foreground)]">
                  {`→ ${endName(plugged.cable, plugged.side === "from" ? "to" : "from", slotsById)}`}
                </span>
              </span>
            ) : (
              <span className="text-[var(--muted-foreground)]">Libre</span>
            )}
          </div>
        )}
      </Section>
      <Section label="Position">
        <Kv
          rows={[
            ["Contenant", rackName ?? "—"],
            ["Unités", units],
            ["Profondeur", eq.depthMm ? `${fmtNumber(eq.depthMm)} mm` : "—"],
          ]}
        />
      </Section>
      <Section label="Énergie et poids">
        <Kv
          rows={[
            [
              "Puissance",
              `${fmtNumber(eq.powerW ?? 0)} W${flag(eq, "hasDualPsu") === true || flag(eq, "hasDualPsu") === 1 ? " · double alimentation" : ""}`,
            ],
            ["Dissipation", `${fmtNumber(Math.round(btu))} BTU/h`],
            ["Poids", eq.weight != null ? `${fmtNumber(eq.weight)} kg` : "—"],
          ]}
        />
      </Section>
      <Section label="Réseau">
        <Kv
          rows={[
            ["Ports réseau", fmtNumber(netPorts)],
            ["ST 2110", is2110 ? (typeof mode2110 === "string" && mode2110 ? mode2110 : "oui") : "non"],
          ]}
        />
      </Section>
    </section>
  );
}
