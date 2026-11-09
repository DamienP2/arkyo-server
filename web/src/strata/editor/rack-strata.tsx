"use client";

/**
 * Onglet Rack de l'éditeur projet en interface Strata, branché par
 * `withStrataRack` dans `getEditorSlots` (project-editor.tsx).
 *
 * Strata v2, tâche 3 : la coquille v1 (dock gauche à onglets, dock bas,
 * lentille Connectique) est retirée ; `withStrataRack` est une enveloppe
 * neutre (mêmes props, slots rendus tels quels) que la tâche 4 remplace par
 * `strata.drawerTop` (carte Faces, bibliothèque dans le tiroir). La carte de
 * face de l'emplacement sélectionné (`RackFaceCard`) reste disponible.
 */

import { useMemo } from "react";
import type { EditorShellSlots } from "@/components/editor-shell/editor-shell";
import type { Slot } from "@/components/synoptique/lib/types";
import type { LibraryDockSource } from "../library/library-dock";
import type { RackSource } from "../bottom/rack-model";
import { useRacksLive } from "../bottom/use-rack-live";
import { EquipmentFaceCard } from "../inspector/equipment-face-card";

/** État de l'onglet Rack (celui de `ProjectEditor`) lu par l'interface Strata. */
export type StrataRackState = LibraryDockSource & {
  projectId: string;
  /** Contenants du lieu affiché (portée lieu), dans l'ordre du canevas. */
  locationRackIds: readonly string[];
  selectedSlot: Slot | null;
  onSlotSelect: (slot: Slot | null) => void;
};

/** Contenants affichés (données du canevas), avec leurs câbles. `null` : chargement. */
export function useRackSources(state: StrataRackState): RackSource[] | null {
  const key =
    state.scope === "location" ? state.locationRackIds.join(",") : (state.selectedRackId ?? "");
  const ids = useMemo(() => (key ? key.split(",") : []), [key]);
  const live = useRacksLive(ids);
  return useMemo(() => {
    const out: RackSource[] = [];
    for (const id of ids) {
      const data =
        state.scope === "location"
          ? (state.locationData?.racks.find((d) => d.rack.id === id) ?? null)
          : state.canvasData?.rack.id === id
            ? state.canvasData
            : null;
      const slots = state.scope === "location" ? state.locationLiveSlots[id] : state.liveSlots;
      if (!data) return null;
      out.push({ data, slots: slots ?? data.rack.slots, connections: live[id]?.connections ?? null });
    }
    return out;
  }, [ids, live, state.scope, state.locationData, state.canvasData, state.locationLiveSlots, state.liveSlots]);
}

/** Contenant (et ses slots) d'un slot sélectionné. */
function ownerOf(sources: readonly RackSource[] | null, slot: Slot | null): RackSource | null {
  if (!sources || !slot) return null;
  const owns = (list: readonly Slot[]): boolean => list.some((s) => s.id === slot.id || owns(s.children ?? []));
  return sources.find((s) => owns(s.slots)) ?? null;
}

/** Face de l'équipement de l'emplacement sélectionné (contenu « Faces » du tiroir, tâche 4). */
export function RackFaceCard({ state }: { state: StrataRackState }) {
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

/** Enveloppe neutre (tâche 3) : les slots de l'onglet Rack, inchangés. */
export function withStrataRack(slots: EditorShellSlots, _state: StrataRackState): EditorShellSlots {
  return slots;
}
