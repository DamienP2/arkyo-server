"use client";

/**
 * Vue Connectique (lentille propre à l'interface Strata, spec §6.2, lot 3) :
 * pour chaque contenant affiché, une ligne par équipement, du haut vers le
 * bas, avec son repère, son modèle, ses U et ses ports reliés, la face
 * choisie (arrière par défaut) dessinée à l'échelle et les câbles de cette
 * face. À gauche, l'élévation du contenant (`RackElevation`) sert de plan.
 *
 * Portée de la maquette (`renderLens`, branche « connectique »). Un clic sur
 * une ligne, un port ou un câble sélectionne l'équipement (inspecteur).
 */

import { useMemo, useState } from "react";
import { Server } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import type { Slot } from "@/components/synoptique/lib/types";
import { cn } from "@/lib/utils";
import { drawingConnectorTypes, drawingSignals, totalPorts } from "../catalogue-model";
import { EquipmentFace } from "../drawings/equipment-face";
import type { FaceSide } from "../drawings/face-layout";
import { RackElevation, type RackElevationSlot } from "../drawings/rack-elevation";
import { FaceToggle } from "../inspector/equipment-face-card";
import {
  byCableLabel,
  cableLabel,
  canvasLookup,
  endName,
  portLabel,
  rackConnectors,
  slotCablesOnFace,
  slotLinks,
  slotTitle,
  slotsIndex,
  type RackSource,
} from "../bottom/rack-model";

/** Équipements posés du contenant, du haut vers le bas. */
export function connectiqueRows(slots: readonly Slot[]): Slot[] {
  return slots
    .filter((s) => !s.parentSlotId && s.equipment && s.startU != null && s.heightU != null)
    .sort((a, b) => b.startU! + b.heightU! - (a.startU! + a.heightU!) || b.startU! - a.startU!);
}

function RackConnectique({
  src,
  face,
  selectedSlotId,
  onSelectSlot,
}: {
  src: RackSource;
  face: FaceSide;
  selectedSlotId: string | null;
  onSelectSlot: (slot: Slot) => void;
}) {
  const lookup = useMemo(() => canvasLookup(src.data), [src.data]);
  const connectorTypes = useMemo(() => drawingConnectorTypes(lookup), [lookup]);
  const signals = useMemo(() => drawingSignals(lookup), [lookup]);
  const byId = useMemo(() => slotsIndex(src.slots), [src.slots]);
  const rows = connectiqueRows(src.slots);
  const [port, setPort] = useState<{ slotId: string; key: string } | null>(null);

  const elevation: RackElevationSlot[] = rows.map((s) => ({
    id: s.id,
    startU: s.startU!,
    heightU: s.heightU!,
    label: slotTitle(s),
    name: s.equipment!.name,
    equipment: {
      name: s.equipment!.name,
      brand: s.equipment!.brand?.name ?? null,
      heightU: s.heightU,
      isRackable: true,
      connectors: rackConnectors(s.equipment!.connectors),
    },
    links: slotLinks(s, src.connections),
  }));

  return (
    <div className="flex min-w-0 gap-5">
      <div className="w-[150px] flex-none">
        <div className="sticky top-0">
          <RackElevation
            units={src.data.rack.totalU}
            slots={elevation}
            face={face}
            labels={false}
            connectorTypes={connectorTypes}
            signals={signals}
            selectedSlotId={selectedSlotId}
            onSlotClick={(id) => {
              const s = byId.get(id);
              if (s) onSelectSlot(s);
            }}
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Server strokeWidth={1.5} />} title="Aucun équipement placé" className="flex-1 py-10" />
      ) : (
        <ul aria-label={src.data.rack.name} className="flex min-w-0 flex-1 flex-col gap-2">
          {rows.map((s) => {
            const eq = s.equipment!;
            const connectors = rackConnectors(eq.connectors);
            const links = slotLinks(s, src.connections);
            const cables = slotCablesOnFace(s, face, src.connections).sort((a, b) => byCableLabel(a.cable, b.cable));
            const sel = s.id === selectedSlotId;
            const top = s.startU! + s.heightU! - 1;
            return (
              <li
                key={s.id}
                aria-current={sel ? "true" : undefined}
                className={cn(
                  "grid grid-cols-[160px_minmax(0,1fr)_minmax(200px,260px)] items-center gap-4 rounded-md border bg-[var(--card)] px-3 py-2.5",
                  sel ? "border-[var(--accent)]" : "border-[var(--border)]",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectSlot(s)}
                  className="flex min-w-0 flex-col items-start gap-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <strong className="truncate text-[13px] font-semibold text-[var(--foreground)]">{slotTitle(s)}</strong>
                  <span className="max-w-full truncate text-xs text-[var(--muted-foreground)]">
                    {`${eq.name} · U${s.startU}${top > s.startU! ? `–${top}` : ""}`}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {`${Object.keys(links).length} / ${totalPorts(connectors)} ports reliés`}
                  </span>
                </button>
                <div className="min-w-0 overflow-hidden rounded-[4px] border border-[var(--border)]">
                  <EquipmentFace
                    equipment={{
                      name: eq.name,
                      brand: eq.brand?.name ?? null,
                      heightU: s.heightU,
                      isRackable: true,
                      connectors,
                    }}
                    face={face}
                    connectorTypes={connectorTypes}
                    signals={signals}
                    links={links}
                    selectedPort={port?.slotId === s.id ? port.key : null}
                    onPortClick={(key) => {
                      setPort({ slotId: s.id, key });
                      onSelectSlot(s);
                    }}
                    maxWidth={560}
                  />
                </div>
                {cables.length === 0 ? (
                  <span className="text-xs text-[var(--text-tertiary)]">Aucun câble sur cette face</span>
                ) : (
                  <ul aria-label="Câbles" className="flex min-w-0 flex-col gap-0.5 text-[12px]">
                    {cables.map(({ cable, side, key }) => (
                      <li key={`${cable.id}-${side}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setPort({ slotId: s.id, key });
                            onSelectSlot(s);
                          }}
                          className="flex w-full min-w-0 items-baseline gap-2 rounded px-1 text-left outline-none hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                        >
                          <span className="shrink-0 font-mono text-[var(--foreground)]">{cableLabel(cable)}</span>
                          <span className="truncate text-[var(--muted-foreground)]">
                            {`${portLabel(connectors, key) ?? key} → ${endName(cable, side === "from" ? "to" : "from", byId)}`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ConnectiqueView({
  sources,
  selectedSlotId,
  onSelectSlot,
}: {
  /** Contenants affichés ; `null` pendant le chargement. */
  sources: readonly RackSource[] | null;
  selectedSlotId: string | null;
  onSelectSlot: (slot: Slot) => void;
}) {
  const [face, setFace] = useState<FaceSide>("REAR");
  if (!sources) return <LoadingState />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-2">
        <FaceToggle value={face} onChange={setFace} />
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
          port relié
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="flex flex-col gap-6">
          {sources.map((src) => (
            <section key={src.data.rack.id} aria-label={`Connectique ${src.data.rack.name}`} className="flex flex-col gap-2">
              {sources.length > 1 && (
                <h3 className="text-[13px] font-semibold text-[var(--foreground)]">{src.data.rack.name}</h3>
              )}
              <RackConnectique src={src} face={face} selectedSlotId={selectedSlotId} onSelectSlot={onSelectSlot} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
