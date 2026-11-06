"use client";

import React, { useContext, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Equipment } from "@/components/synoptique/lib/types";

import { cn } from "@/lib/utils";
import {
  RACK_CROSSBAR_H,
  RAIL_W,
  U_HEIGHT_PX,
  WIDTH_CONFIG,
  rackBodyHeight,
} from "@/components/synoptique/lib/constants";
import { CategoryColorCtx, DEFAULT_HEX, SPECIAL_HEX } from "@/components/synoptique/lib/colors";
import { colToPct, isRowFullyCovered, pctOverlap } from "@/components/synoptique/lib/collision";
import type { Rack, Slot, ViewId, WidthFraction } from "@/components/synoptique/lib/types";
import { DraggableSlot } from "./draggable-slot";
import { ProjectedSlot, rearImageForMode } from "./projected-slot";
import { SlotContextMenu } from "../_shell/slot-context-menu";

// ── Droppable column cell ──────────────────────────────────────────────────

function DroppableCell({
  rackId,
  view,
  uIndex,
  col,
  colsTotal,
  isOccupied,
  disabled,
}: {
  rackId: string;
  view: ViewId;
  uIndex: number;
  col: number;
  colsTotal: number;
  isOccupied: boolean;
  isEven: boolean;
  /**
   * Rangée intégralement occupée → la cellule sort des candidats de la
   * détection de collision. Sans ça, en `pointerWithin`, une cellule
   * inatteignable (déjà `pointer-events-none`) resterait la cible retenue et
   * volerait le drop d'une étagère située au même endroit.
   */
  disabled?: boolean;
}) {
  const data = useMemo(() => ({ rackId, view, uIndex, col }), [rackId, view, uIndex, col]);
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${rackId}-${view}-${uIndex}-${col}`,
    data,
    disabled,
  });
  const pct = 100 / colsTotal;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute top-0 h-full transition-colors",
        isOver && !isOccupied && "bg-[var(--accent)]/20",
        isOccupied && "pointer-events-none",
        col > 0 && "border-l border-[var(--border)]",
      )}
      style={{ left: `${col * pct}%`, width: `${pct}%`, height: U_HEIGHT_PX }}
    />
  );
}

// ── Single view rack visual ────────────────────────────────────────────────

export function RackVisual({
  rack,
  slots,
  view,
  showInfo,
  onRemoveSlot,
  onShowProperties,
  selectedEquipment,
  onTapPlace,
  draggingSlotId,
  isDragging,
  isHoveredView,
  hoverU,
  hoverCol,
  dragHeightU,
  dragWidthFraction,
  dragCategory,
  dropValid,
  onSelectSlot,
  selectedSlotId,
  selectedSlotIds,
  renderMode = "standard",
  dropDisabled = false,
}: {
  rack: Rack;
  slots: Slot[];
  view: ViewId;
  showInfo: boolean;
  onRemoveSlot: (id: string) => void;
  onShowProperties?: (id: string) => void;
  selectedEquipment: Equipment | null;
  onTapPlace: (uIndex: number, view: ViewId) => void;
  onSelectSlot?: (slotId: string) => void;
  selectedSlotId?: string | null;
  selectedSlotIds?: Set<string>;
  draggingSlotId?: string | null;
  isDragging?: boolean;
  isHoveredView?: boolean;
  hoverU?: number | null;
  hoverCol?: number | null;
  dragHeightU?: number;
  dragWidthFraction?: WidthFraction;
  dragCategory?: string | null;
  dropValid?: boolean | null;
  /** Mode de rendu des équipements — cf. DraggableSlot (défaut "standard"). */
  renderMode?: "standard" | "graphic" | "photo";
  /**
   * Contenant inerte pour le drag en cours (affichage par emplacement :
   * l'élément appartient à un autre contenant). Désactive les zones de dépôt
   * des étagères — les cellules U, elles, ne sont simplement pas montées
   * puisque l'appelant passe `isDragging={false}`.
   */
  dropDisabled?: boolean;
}) {
  const catColorMap = useContext(CategoryColorCtx);
  const resolveHex = (category?: string | null) => {
    if (!category) return DEFAULT_HEX;
    if (SPECIAL_HEX[category]) return SPECIAL_HEX[category];
    return catColorMap[category] ?? DEFAULT_HEX;
  };

  // Exclure les slots fantômes (startU=null) — non encore placés physiquement
  // Le type guard garantit que startU/heightU sont non-null dans viewSlots.
  type PlacedSlot = Slot & { startU: number; heightU: number };
  const viewSlots = slots.filter(
    (s): s is PlacedSlot => s.view === view && !s.parentSlotId && s.startU != null,
  );

  // ── Projections « dos » (mode image, vues AVANT ↔ ARRIÈRE) ─────────────────
  // En mode image, on projette le DOS des équipements montés sur la face
  // OPPOSÉE à la vue affichée, à leur position U/colonne, avec l'image arrière :
  //   • vue REAR  → dos des équipements montés à l'AVANT  (view === "FRONT")
  //   • vue FRONT → dos des équipements montés à l'ARRIÈRE (view === "REAR")
  // Symétrique : on voit toujours la FACE d'un équipement dans sa vue de montage
  // (rendu DraggableSlot) et son DOS estompé dans la vue opposée. Purement
  // visuel, non-interactif (cf. ProjectedSlot). Repli : on ne garde que les
  // slots qui possèdent une image de dos pour le mode courant.
  const projectionSourceView: ViewId | null =
    renderMode === "standard" ? null : view === "REAR" ? "FRONT" : view === "FRONT" ? "REAR" : null;
  const projectionSlots = projectionSourceView
    ? slots.filter(
        (s): s is PlacedSlot =>
          s.view === projectionSourceView &&
          !s.parentSlotId &&
          s.startU != null &&
          s.heightU != null &&
          rearImageForMode(s.equipment, renderMode) != null,
      )
    : [];
  const slotsForOccupancy = draggingSlotId
    ? viewSlots.filter((s) => s.id !== draggingSlotId)
    : viewSlots;

  const isColOccupiedForDrag = (col: number): boolean => {
    if (!hoverU || !dragHeightU || !dragWidthFraction) return false;
    const dragRange = colToPct(col, dragWidthFraction);
    for (const s of slotsForOccupancy) {
      if (s.startU >= hoverU + dragHeightU || s.startU + s.heightU <= hoverU) continue;
      if (pctOverlap(dragRange, colToPct(s.column, s.widthFraction))) return true;
    }
    return false;
  };

  const isUFullyOccupied = (u: number) => isRowFullyCovered(u, slotsForOccupancy);

  const dropCols = dragWidthFraction ? WIDTH_CONFIG[dragWidthFraction].cols : 1;
  const uRows = Array.from({ length: rack.totalU }, (_, i) => rack.totalU - i);

  return (
    <div className="flex w-full gap-0 select-none">
      {/* Corps du rack */}
      <div
        className="relative flex-1 overflow-hidden"
        style={{
          // +4 : box-sizing border-box — les 2 bordures de 2px sont comprises
          // dans la hauteur ; sans compensation la zone intérieure ferait
          // totalU×44 − 4 et le bas de U1 serait rogné de 4px.
          // + 2×RACK_CROSSBAR_H : traverses haute et basse du châssis.
          height: rackBodyHeight(rack.totalU),
          background: "transparent",
          border: "2px solid var(--border)",
        }}
      >
        {/* Traverses haute et basse — ferment le châssis. Pleine largeur (elles
            passent AU-DESSUS des rails) pour des coins nets, sans label. */}
        {(["top", "bottom"] as const).map((edge) => (
          <div
            key={edge}
            className="pointer-events-none absolute inset-x-0 z-20"
            style={{
              ...(edge === "top" ? { top: 0 } : { bottom: 0 }),
              height: RACK_CROSSBAR_H,
              background: "color-mix(in srgb, var(--foreground) 8%, var(--background))",
              borderBottom: edge === "top" ? "1px solid var(--border)" : undefined,
              borderTop: edge === "bottom" ? "1px solid var(--border)" : undefined,
            }}
          />
        ))}

        {/* Rails latéraux avec numéros U — insérés ENTRE les deux traverses. */}
        {(["left-0", "right-0"] as const).map((side) => (
          <div
            key={side}
            className={cn("absolute z-10", side)}
            style={{
              top: RACK_CROSSBAR_H,
              bottom: RACK_CROSSBAR_H,
              width: RAIL_W,
              background: "color-mix(in srgb, var(--foreground) 8%, var(--background))",
              borderLeft: side === "right-0" ? "1px solid var(--border)" : undefined,
              borderRight: side === "left-0" ? "1px solid var(--border)" : undefined,
            }}
          >
            {uRows.map((u) => (
              <div
                key={u}
                className="flex items-center justify-center"
                style={{ height: U_HEIGHT_PX }}
              >
                <span
                  style={{
                    fontSize: 7,
                    fontFamily: "monospace",
                    color: "color-mix(in srgb, var(--foreground) 55%, var(--background))",
                    lineHeight: 1,
                    userSelect: "none",
                  }}
                >
                  U{u}
                </span>
              </div>
            ))}
          </div>
        ))}

        {/* Zone centrale — insérée entre les 2 rails de labels. Sa largeur
            (FRONT_OUTER_W) est au ratio hors-tout du 19", identique au ratio
            de crop des visuels GFX/PIC : les images remplissent leur boîte
            bord à bord (côtés visibles) sans jamais recouvrir les rails. */}
        <div
          className="absolute"
          style={{
            left: RAIL_W,
            right: RAIL_W,
            // Décalé des traverses — le repère U interne (séparateurs, cellules
            // de drop, slots, visuels GFX/PIC) est inchangé, juste translaté.
            top: RACK_CROSSBAR_H,
            bottom: RACK_CROSSBAR_H,
          }}
        >
          {/* Zones droppables — présentes dès qu'un drag est en cours */}
          {(isDragging || selectedEquipment) &&
            uRows.map((u, idx) => {
              const isOccupied = isUFullyOccupied(u);
              return (
                <div
                  key={u}
                  className="absolute inset-x-0 z-30"
                  style={{ top: idx * U_HEIGHT_PX, height: U_HEIGHT_PX }}
                >
                  {Array.from({ length: dropCols }, (_, col) => (
                    <DroppableCell
                      key={col}
                      rackId={rack.id}
                      view={view}
                      uIndex={u}
                      col={col}
                      colsTotal={dropCols}
                      isOccupied={isUFullyOccupied(u) || isColOccupiedForDrag(col)}
                      // `disabled` ne dépend QUE de l'occupation de la rangée
                      // (stable pendant le drag) : `isColOccupiedForDrag`
                      // dépend du survol courant, l'inclure ferait osciller la
                      // liste des candidats.
                      disabled={isOccupied}
                      isEven={idx % 2 === 0}
                    />
                  ))}
                  {selectedEquipment && !isOccupied && (
                    <div
                      className="absolute inset-0 z-10 cursor-pointer border border-dashed border-[var(--accent)]/40 bg-[var(--accent)]/10 transition-colors hover:bg-[var(--accent)]/20"
                      onClick={() => onTapPlace(u, view)}
                    />
                  )}
                </div>
              );
            })}

          {/* Ghost preview — uniquement sur la vue survolée */}
          {isHoveredView &&
            hoverU != null &&
            hoverCol != null &&
            dragHeightU &&
            dragWidthFraction &&
            (() => {
              const topIdx = rack.totalU - hoverU - dragHeightU + 1;
              const outOfBounds = topIdx < 0 || hoverU + dragHeightU - 1 > rack.totalU;
              const invalid = dropValid === false || outOfBounds;
              if (outOfBounds && dropValid !== false) return null;
              const dragHex = resolveHex(dragCategory);
              const pct = WIDTH_CONFIG[dragWidthFraction].pct;
              const leftPct = hoverCol * pct;
              const clampedTop = Math.max(0, topIdx) * U_HEIGHT_PX + 1;
              return (
                <div
                  className="pointer-events-none absolute z-25 border-2 opacity-75"
                  style={{
                    top: clampedTop,
                    height: dragHeightU * U_HEIGHT_PX - 2,
                    left: `${leftPct}%`,
                    width: `${pct}%`,
                    ...(invalid
                      ? {
                          borderColor: "var(--destructive)",
                          background: "color-mix(in srgb, var(--destructive) 25%, transparent)",
                        }
                      : { borderColor: dragHex, background: `${dragHex}22` }),
                  }}
                />
              );
            })()}

          {/* Séparateurs */}
          {uRows.map((_, idx) => (
            <div
              key={`sep-${idx}`}
              className="pointer-events-none absolute inset-x-0"
              style={{
                top: idx * U_HEIGHT_PX,
                height: 1,
                background: "color-mix(in srgb, var(--foreground) 15%, var(--background))",
              }}
            />
          ))}

          {/* Projections « dos » — rendues SOUS les vrais slots arrière (z-[15]
              < z-20) et non-interactives (pointer-events-none). N'existent qu'en
              mode image + vue REAR (projectionSlots vide sinon). */}
          {projectionSlots.map((slot) => {
            // heightU exact (pas de floor) : un slot fractionnaire (0.5U…)
            // doit garder son bas calé sur le bas de startU — même formule
            // que SideRackVisual et le ghost de drag.
            const topIdx = rack.totalU - slot.startU - slot.heightU + 1;
            const topPx = topIdx * U_HEIGHT_PX;
            const widthPct = WIDTH_CONFIG[slot.widthFraction].pct;
            const leftPct = slot.column * WIDTH_CONFIG[slot.widthFraction].pct;
            return (
              <div
                key={`proj-${slot.id}`}
                className="pointer-events-none absolute z-[15]"
                style={{
                  top: topPx + 1,
                  height: slot.heightU * U_HEIGHT_PX - 2,
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
              >
                <ProjectedSlot slot={slot} renderMode={renderMode} />
              </div>
            );
          })}

          {/* Slots placés */}
          {viewSlots.map((slot) => {
            // heightU exact (pas de floor) — cf. commentaire des projections.
            const topIdx = rack.totalU - slot.startU - slot.heightU + 1;
            const topPx = topIdx * U_HEIGHT_PX;
            const widthPct = WIDTH_CONFIG[slot.widthFraction].pct;
            const leftPct = slot.column * WIDTH_CONFIG[slot.widthFraction].pct;
            return (
              <div
                key={slot.id}
                className="absolute z-20"
                style={{
                  top: topPx + 1,
                  height: slot.heightU * U_HEIGHT_PX - 2,
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
              >
                <SlotContextMenu
                  slotId={slot.id}
                  onShowProperties={(id) => onShowProperties?.(id)}
                  onDelete={(id) => onRemoveSlot(id)}
                >
                  <DraggableSlot
                    slot={slot}
                    rackId={rack.id}
                    rackName={rack.name}
                    onRemove={onRemoveSlot}
                    showInfo={showInfo}
                    renderMode={renderMode}
                    dropDisabled={dropDisabled}
                    onSelect={() => onSelectSlot?.(slot.id)}
                    onSelectChild={(childId) => onSelectSlot?.(childId)}
                    isSelected={
                      selectedSlotIds ? selectedSlotIds.has(slot.id) : selectedSlotId === slot.id
                    }
                    selectedChildId={selectedSlotId}
                  />
                </SlotContextMenu>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
