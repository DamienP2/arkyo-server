"use client";

/**
 * Onglet Inventaire de l'éditeur projet en interface Strata : face de
 * l'élément d'inventaire sélectionné (`selectedItem` de l'`InventaireScope`),
 * `InventaireFaceCard`. `withStrataInventaireFace` (branché dans
 * `getEditorSlots`) est, depuis la tâche 3 de Strata v2, une enveloppe
 * neutre : la carte rejoindra le tiroir ou Gérer › Matériel (tâches 4 et 5).
 *
 * L'équipement, ses ports reliés et sa position viennent du `canvas-data` et
 * des câbles de son contenant (le slot qui porte l'élément, par
 * `inventoryItemId`) ; un élément pas encore placé montre sa face seule.
 * Rien pour un panel, un adaptateur ou un accessoire.
 */

import type { ReactNode } from "react";
import { useInventaireScopeOptional } from "@/app/(fullscreen)/project/[id]/inventaire/_components/inventaire-scope";
import type { Slot } from "@/components/synoptique/lib/types";
import { flattenSlots } from "../bottom/rack-model";
import { useRacksLive } from "../bottom/use-rack-live";
import { EquipmentFaceCard } from "../inspector/equipment-face-card";

const NONE: string[] = [];

export function InventaireFaceCard() {
  const scope = useInventaireScopeOptional();
  const sel = scope?.selectedItem ?? null;
  const rack = sel ? scope?.racks.find((r) => r.id === sel.rackId) : undefined;
  const item = sel ? rack?.bom.find((i) => i.id === sel.itemId) : undefined;
  const wanted = rack && item?.kind === "equipment" && item.refId ? rack.id : null;
  const live = useRacksLive(wanted ? [wanted] : NONE, scope?.projectId ?? null);
  const data = wanted ? live[wanted]?.canvas : null;
  if (!scope || !rack || !item || !data || data.rack.id !== rack.id) return null;

  const slots = data.rack.slots;
  const slot =
    flattenSlots(slots).find((s) => (s as Slot & { inventoryItemId?: string | null }).inventoryItemId === item.id) ?? null;
  const equipment = slot?.equipment ?? data.allEquipment.find((e) => e.id === item.refId) ?? null;
  const location = rack.isVirtual ? scope.locations.find((l) => l.virtualRackId === rack.id) : undefined;
  return (
    <EquipmentFaceCard
      slot={slot}
      equipment={equipment}
      canvasData={data}
      connections={live[rack.id]?.connections ?? null}
      slots={slots}
      rackName={rack.isVirtual ? `Pose libre${location ? ` · ${location.name}` : ""}` : rack.name}
    />
  );
}

/** Enveloppe neutre (tâche 3) : le panneau droit de l'Inventaire, inchangé. */
export function withStrataInventaireFace(panel: ReactNode): ReactNode {
  return panel;
}
