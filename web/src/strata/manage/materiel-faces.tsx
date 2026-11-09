"use client";

/**
 * Gérer › Matériel, détail : faces et connectique de l'équipement
 * (`EquipmentFaceCard`), lues dans le `canvas-data` et les câbles de son
 * contenant (`useRacksLive`).
 */

import type { InventaireBomItem, InventaireRack } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import type { Slot } from "@/components/synoptique/lib/types";
import { LoadingState } from "@/components/ui/loading-state";
import { flattenSlots } from "../bottom/rack-model";
import { useRacksLive } from "../bottom/use-rack-live";
import { EquipmentFaceCard } from "../inspector/equipment-face-card";
import type { ManageState } from "./use-manage";

const NONE: string[] = [];

/** Faces et connectique de l'équipement (`canvas-data` et câbles de son contenant). */
export function MaterielFaces({
  item,
  rack,
  placed,
  data,
  locationName,
}: {
  item: InventaireBomItem;
  rack: InventaireRack;
  /** Slots posés de la ligne (`placementOf`). */
  placed: readonly Slot[];
  data: ManageState;
  locationName: string | null;
}) {
  // Les contenants rackables sont déjà lus ; les autres (libres, non
  // rackables) le sont ici, le temps du détail.
  const live = useRacksLive(item.refId ? [rack.id] : NONE, data.projectId)[rack.id];
  const canvas = live?.canvas ?? null;
  if (!item.refId) return null;
  if (!canvas || canvas.rack.id !== rack.id) {
    if (live?.canvasError)
      return (
        <p role="status" className="m-0 text-[12px] text-[var(--muted-foreground)]">
          Faces indisponibles : le contenant n'a pas pu être lu.
        </p>
      );
    return <LoadingState className="py-8" />;
  }
  const slots = canvas.rack.slots as Slot[];
  const mine = flattenSlots(slots).filter(
    (s) => (s as Slot & { inventoryItemId?: string | null }).inventoryItemId === item.id,
  );
  // Un exemplaire posé d'abord ; à défaut un slot fantôme (câblable sur le synoptique).
  const slot = placed[0] ?? mine[0] ?? null;
  const parent = slot?.parentSlotId ? flattenSlots(slots).find((s) => s.id === slot.parentSlotId) : undefined;
  const equipment = slot?.equipment ?? canvas.allEquipment.find((e) => e.id === item.refId) ?? null;
  if (!equipment) return null;
  return (
    <div className="-mx-[18px] border-y border-[var(--border)]">
      <EquipmentFaceCard
        slot={slot && slot.startU == null && parent ? { ...slot, startU: parent.startU, heightU: parent.heightU } : slot}
        equipment={equipment}
        canvasData={canvas}
        connections={live?.connections ?? null}
        slots={slots}
        rackName={rack.isVirtual ? `Pose libre${locationName ? ` · ${locationName}` : ""}` : rack.name}
      />
    </div>
  );
}
