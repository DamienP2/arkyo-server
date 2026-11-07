"use client";

/**
 * Élément de la bibliothèque Strata (onglet Rack) : un équipement du
 * catalogue, sa face arrière en miniature, glissable sur un U libre.
 *
 * Le glisser réutilise la charge utile des éléments de nomenclature
 * (`draggable-bom-item.tsx`, `{ type: "equipment", equipment, widthFraction }`)
 * dans le `DndContext` de `RackTabDndProvider` : le canvas affiche son aperçu
 * vert ou rouge et place l'équipement par son `handleDragEnd` habituel. Sans
 * `sourceRackId` : un équipement du catalogue n'appartient à aucun contenant.
 *
 * Le bouton « Placer » est l'alternative au clavier : il propose les premiers
 * U libres de chaque contenant affiché.
 */

import { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Equipment, WidthFraction } from "@/components/synoptique/lib/types";
import { GripVertical } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { EquipmentFace } from "../drawings/equipment-face";
import type { DrawingConnectorType, DrawingSignal } from "../drawings/face-layout";
import { parseConnectors } from "../catalogue-model";

/** Préfixe des identifiants de glisser de la bibliothèque. */
export const LIBRARY_DRAG_PREFIX = "library-";

/** Choix d'un U libre proposé par « Placer ». */
export type PlacerChoice = { rackId: string; rackName: string; startU: number };

export function LibraryItem({
  equipment,
  connectorTypes,
  signals,
  placerOpen,
  onTogglePlacer,
  choices,
  showRackNames,
  onPlace,
  busy,
}: {
  equipment: Equipment;
  connectorTypes: readonly DrawingConnectorType[];
  signals: readonly DrawingSignal[];
  placerOpen: boolean;
  onTogglePlacer: () => void;
  /** Premiers U libres, calculés à l'ouverture de « Placer ». */
  choices: PlacerChoice[];
  showRackNames: boolean;
  onPlace: (choice: PlacerChoice) => void;
  busy: boolean;
}) {
  const connectors = useMemo(() => parseConnectors(equipment.connectors), [equipment.connectors]);
  const data = useMemo(
    () => ({
      type: "equipment" as const,
      equipment,
      widthFraction: (equipment.widthFraction as WidthFraction | null) ?? "FULL",
    }),
    [equipment],
  );
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `${LIBRARY_DRAG_PREFIX}${equipment.id}`,
    data,
  });
  const meta = [equipment.brand?.name, equipment.reference].filter(Boolean).join(" · ");

  return (
    <li
      aria-label={equipment.name}
      className={cn(
        "rounded-md border border-[var(--border)] bg-[var(--card)] transition-colors hover:border-[var(--border-strong)]",
        isDragging && "opacity-40",
      )}
    >
      {/* Zone glissable (souris, toucher) ; le clavier passe par « Placer ». */}
      <div ref={setNodeRef} {...listeners} className="cursor-grab touch-none p-2 select-none active:cursor-grabbing">
        <div className="flex items-start gap-1.5">
          <GripVertical aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs leading-tight font-medium">{equipment.name}</p>
            {meta && (
              <p className="mt-0.5 truncate text-[10.5px] leading-tight text-[var(--muted-foreground)]">{meta}</p>
            )}
          </div>
          <span className="shrink-0 text-[10.5px] text-[var(--muted-foreground)] tabular-nums">
            {equipment.heightU ?? 1}U
          </span>
        </div>
        <EquipmentFace
          className="mt-1.5"
          equipment={{
            name: equipment.name,
            brand: equipment.brand?.name,
            heightU: equipment.heightU,
            isRackable: true,
            connectors,
          }}
          face="REAR"
          connectorTypes={connectorTypes}
          signals={signals}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 border-t border-[var(--border)] px-2 py-1.5">
        <button
          type="button"
          aria-expanded={placerOpen}
          onClick={onTogglePlacer}
          className="rounded-md px-2 py-0.5 text-[11.5px] font-medium text-[var(--accent-strong)] hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          Placer
        </button>
        {placerOpen &&
          (choices.length > 0 ? (
            <div role="group" aria-label={`U libres pour ${equipment.name}`} className="flex flex-wrap gap-1">
              {choices.map((c) => (
                <button
                  key={`${c.rackId}-${c.startU}`}
                  type="button"
                  disabled={busy}
                  aria-label={showRackNames ? `${c.rackName} U${c.startU}` : `U${c.startU}`}
                  onClick={() => onPlace(c)}
                  className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--foreground)] tabular-nums hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
                >
                  {showRackNames ? `${c.rackName} · U${c.startU}` : `U${c.startU}`}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-[11px] text-[var(--muted-foreground)]">Aucun U libre</span>
          ))}
      </div>
    </li>
  );
}
