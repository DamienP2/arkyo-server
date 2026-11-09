"use client";

/**
 * Tiroir du mode Racks de Concevoir (interface Strata v2, spec v2 §4.1),
 * branché par `getEditorSlots` (project-editor.tsx) dans `strata.drawerTop`,
 * au-dessus du panneau droit d'arkyo (propriétés de l'emplacement, export) :
 *   - « Bibliothèque » : le catalogue glissable sur un U libre
 *     (`LibraryDock`, même charge utile et même `DndContext` que la v1) ;
 *   - « Équipement » : la face de l'équipement de l'emplacement sélectionné
 *     (`EquipmentFaceCard`), montrée d'office à chaque sélection.
 * Une sélection d'emplacement nouvelle ouvre le tiroir (`requestOpen`).
 *
 * « Voir dans le rack » (carte Faces du synoptique) arrive ici : le contenant
 * demandé (`useRackFocusStore`) devient celui de l'onglet.
 *
 * Monté par le tiroir de la coquille Strata seulement : sans effet en
 * Classique (le champ `strata` y est ignoré).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { InventaireRack } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import type { RackDisplayScope } from "@/app/(fullscreen)/project/[id]/rack/_components/rack-tab-left-toolbar";
import type { Slot } from "@/components/synoptique/lib/types";
import { cn } from "@/lib/utils";
import { LibraryDock, libraryDockProps, type LibraryDockSource } from "../library/library-dock";
import type { RackSource } from "../bottom/rack-model";
import { useRacksLive } from "../bottom/use-rack-live";
import { EquipmentFaceCard } from "../inspector/equipment-face-card";
import { useStrataDrawer } from "../shell/canvas-shell";
import { useRackFocusStore } from "./rack-focus";

/** État de l'onglet Rack (celui de `ProjectEditor`) lu par l'interface Strata. */
export type StrataRackState = LibraryDockSource & {
  projectId: string;
  /** Contenants du lieu affiché (portée lieu), dans l'ordre du canevas. */
  locationRackIds: readonly string[];
  selectedSlot: Slot | null;
  /** Contenants du projet (hors racks virtuels). */
  racks: readonly InventaireRack[];
  selectedLocationId: string | null;
  onSelectRack: (id: string) => void;
  onSelectLocation: (id: string) => void;
  onDisplayScopeChange: (scope: RackDisplayScope) => void;
};

/** Contenants affichés (données du canvas), avec leurs câbles. `null` : chargement. */
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

/** Face de l'équipement de l'emplacement sélectionné. */
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

/** Tentatives au-delà desquelles un contenant demandé est abandonné (aucune boucle possible). */
const FOCUS_TRIES = 6;

/** Contenant demandé par « Voir dans le rack » : il devient celui de l'onglet, puis le signal est effacé. */
function useRackFocus(state: StrataRackState) {
  const focus = useRackFocusStore((s) => s.focus);
  const clear = useRackFocusStore((s) => s.clear);
  const tries = useRef(0);
  const { projectId, racks, scope, selectedLocationId, selectedRackId, onSelectRack, onSelectLocation, onDisplayScopeChange } = state;
  useEffect(() => {
    if (!focus) {
      tries.current = 0;
      return;
    }
    const rack = focus.projectId === projectId ? racks.find((r) => r.id === focus.rackId && r.isRackable) : undefined;
    if (!rack || ++tries.current > FOCUS_TRIES) {
      clear();
      return;
    }
    if (scope === "location" && !rack.locationId) {
      // Portée lieu : on montre le lieu du contenant ; sans lieu, le contenant seul.
      onDisplayScopeChange("container");
    } else if (scope === "location" && selectedLocationId !== rack.locationId) {
      onSelectLocation(rack.locationId!);
    } else if (selectedRackId !== rack.id) {
      onSelectRack(rack.id);
    } else {
      clear();
    }
  }, [focus, clear, projectId, racks, scope, selectedLocationId, selectedRackId, onSelectRack, onSelectLocation, onDisplayScopeChange]);
}

type DrawerTab = "library" | "equipment";

const TAB =
  "flex-1 rounded px-2 py-1 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50";

export function StrataRackDrawerTop({ state }: { state: StrataRackState }) {
  const { requestOpen } = useStrataDrawer();
  const slotId = state.selectedSlot?.id ?? null;
  useEffect(() => {
    requestOpen(slotId ? `slot:${slotId}` : null);
  }, [slotId, requestOpen]);
  useRackFocus(state);

  // Une sélection nouvelle montre sa face ; sans sélection, la bibliothèque.
  const hasFace = !!state.selectedSlot?.equipment;
  const [tab, setTab] = useState<DrawerTab>(hasFace ? "equipment" : "library");
  const [shownSlot, setShownSlot] = useState(slotId);
  if (shownSlot !== slotId) {
    setShownSlot(slotId);
    setTab(hasFace ? "equipment" : "library");
  }
  const current: DrawerTab = hasFace ? tab : "library";

  const tabs: { id: DrawerTab; label: string; disabled: boolean }[] = [
    { id: "library", label: "Bibliothèque", disabled: false },
    { id: "equipment", label: "Équipement", disabled: !hasFace },
  ];

  return (
    <div className="flex flex-col">
      <div className="border-b border-[var(--border)] px-3 py-2">
        <div
          role="tablist"
          aria-label="Tiroir du rack"
          className="flex rounded-md border border-[var(--border)] bg-[var(--muted)] p-0.5"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`strata-rack-tab-${t.id}`}
              aria-selected={current === t.id}
              aria-controls={`strata-rack-panel-${t.id}`}
              disabled={t.disabled}
              title={t.disabled ? "Aucun équipement sélectionné" : undefined}
              onClick={() => setTab(t.id)}
              className={cn(
                TAB,
                current === t.id
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div
        role="tabpanel"
        id="strata-rack-panel-library"
        aria-labelledby="strata-rack-tab-library"
        hidden={current !== "library"}
      >
        <LibraryDock {...libraryDockProps(state)} />
      </div>
      <div
        role="tabpanel"
        id="strata-rack-panel-equipment"
        aria-labelledby="strata-rack-tab-equipment"
        hidden={current !== "equipment"}
      >
        {hasFace && <RackFaceCard state={state} />}
      </div>
    </div>
  );
}
