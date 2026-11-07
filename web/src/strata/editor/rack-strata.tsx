"use client";

/**
 * Onglet Rack de l'éditeur projet en interface Strata (spec §6.2, lot 3),
 * branché par `withStrataRack` dans `getEditorSlots` (project-editor.tsx) :
 *   - dock gauche : onglets « Outils » et « Bibliothèque » (`withLibraryDock`) ;
 *   - inspecteur : face de l'équipement sélectionné au-dessus du panneau
 *     existant ;
 *   - dock bas : Contrôles, Câbles, Bilan du ou des contenants affichés ;
 *   - lentille Connectique (`?lens=connectique`) : `ConnectiqueView` à la
 *     place du canevas.
 *
 * En Classique, rien ne change : `EditorShell` ignore le champ `strata`, et
 * `StrataInspector` / `StrataRackCanvas` rendent le slot existant tel quel.
 */

import { useMemo, type ReactNode } from "react";
import type { EditorShellSlots } from "@/components/editor-shell/editor-shell";
import type { Slot } from "@/components/synoptique/lib/types";
import { useInterface } from "../interface-context";
import { withLibraryDock, type LibraryDockSource } from "../library/library-dock";
import { RackBottomDock } from "../bottom/rack-bottom-dock";
import type { RackSource } from "../bottom/rack-model";
import { useRacksLive } from "../bottom/use-rack-live";
import { EquipmentFaceCard } from "../inspector/equipment-face-card";
import { ConnectiqueView } from "../lenses/connectique-view";
import { useStrataLens } from "../lenses/strata-lens";

/** État de l'onglet Rack (celui de `ProjectEditor`) lu par l'interface Strata. */
export type StrataRackState = LibraryDockSource & {
  projectId: string;
  /** Contenants du lieu affiché (portée lieu), dans l'ordre du canevas. */
  locationRackIds: readonly string[];
  selectedSlot: Slot | null;
  onSlotSelect: (slot: Slot | null) => void;
};

/**
 * Contenants affichés, avec leurs câbles. Le canevas tient d'ordinaire le
 * `canvas-data` et les slots à jour ; dans la vue Connectique, où il n'est
 * pas monté, les données sont relues et suivies ici. `null` : chargement.
 */
export function useRackSources(state: StrataRackState): RackSource[] | null {
  const connectique = useStrataLens() === "connectique";
  const key =
    state.scope === "location" ? state.locationRackIds.join(",") : (state.selectedRackId ?? "");
  const ids = useMemo(() => (key ? key.split(",") : []), [key]);
  const live = useRacksLive(ids, connectique ? state.projectId : null);
  return useMemo(() => {
    const out: RackSource[] = [];
    for (const id of ids) {
      const editorData =
        state.scope === "location"
          ? (state.locationData?.racks.find((d) => d.rack.id === id) ?? null)
          : state.canvasData?.rack.id === id
            ? state.canvasData
            : null;
      const editorSlots = state.scope === "location" ? state.locationLiveSlots[id] : state.liveSlots;
      const fresh = connectique ? live[id]?.canvas : null;
      const data = fresh ?? editorData;
      if (!data) return null;
      out.push({
        data,
        slots: fresh ? fresh.rack.slots : (editorSlots ?? data.rack.slots),
        connections: live[id]?.connections ?? null,
      });
    }
    return out;
  }, [ids, live, connectique, state.scope, state.locationData, state.canvasData, state.locationLiveSlots, state.liveSlots]);
}

/** Inspecteur : `top` au-dessus du panneau existant (Strata seulement). */
export function StrataInspector({ top, children }: { top: ReactNode; children: ReactNode }) {
  if (useInterface() !== "strata") return <>{children}</>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="max-h-[60%] flex-none overflow-y-auto border-b border-[var(--border)] empty:hidden">{top}</div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

/** Canevas de l'onglet Rack, ou la vue Connectique quand cette lentille est ouverte (Strata). */
export function StrataRackCanvas({ connectique, children }: { connectique: ReactNode; children: ReactNode }) {
  const ui = useInterface();
  const lens = useStrataLens();
  return <>{ui === "strata" && lens === "connectique" ? connectique : children}</>;
}

/** Contenant (et ses slots) d'un slot sélectionné. */
function ownerOf(sources: readonly RackSource[] | null, slot: Slot | null): RackSource | null {
  if (!sources || !slot) return null;
  const owns = (list: readonly Slot[]): boolean => list.some((s) => s.id === slot.id || owns(s.children ?? []));
  return sources.find((s) => owns(s.slots)) ?? null;
}

function RackFaceCard({ state }: { state: StrataRackState }) {
  const sources = useRackSources(state);
  const owner = ownerOf(sources, state.selectedSlot);
  if (!owner) return null;
  return (
    <EquipmentFaceCard
      slot={state.selectedSlot}
      canvasData={owner.data}
      connections={owner.connections}
      slots={owner.slots}
      rackName={owner.data.rack.name}
    />
  );
}

function RackDock({ state }: { state: StrataRackState }) {
  const sources = useRackSources(state);
  if (!sources || sources.length === 0) return null;
  return <RackBottomDock sources={sources} onSelectSlot={state.onSlotSelect} />;
}

function ConnectiqueLens({ state }: { state: StrataRackState }) {
  const sources = useRackSources(state);
  return (
    <ConnectiqueView
      sources={sources}
      selectedSlotId={state.selectedSlot?.id ?? null}
      onSelectSlot={state.onSlotSelect}
    />
  );
}

/**
 * Slots de l'onglet Rack en interface Strata : bibliothèque, face dans
 * l'inspecteur, dock bas, lentille Connectique. Sans effet en Classique.
 */
export function withStrataRack(slots: EditorShellSlots, state: StrataRackState): EditorShellSlots {
  const withLibrary = withLibraryDock(slots, state);
  return {
    ...withLibrary,
    canvas: <StrataRackCanvas connectique={<ConnectiqueLens state={state} />}>{slots.canvas}</StrataRackCanvas>,
    rightPanel: <StrataInspector top={<RackFaceCard state={state} />}>{slots.rightPanel}</StrataInspector>,
    strata: { ...withLibrary.strata, bottomDock: <RackDock state={state} /> },
  };
}
