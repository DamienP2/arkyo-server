"use client";

import React, { useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Zap } from "@/components/ui/icons";
import type { Equipment } from "@/components/synoptique/lib/types";

import { cn } from "@/lib/utils";
import { PLAQUE_STYLES, WIDTH_CONFIG } from "@/components/synoptique/lib/constants";
import { hexDarken, hexTint, useCategoryColor } from "@/components/synoptique/lib/colors";
import {
  AccessoryFace,
  previewFaceHeight,
} from "@/components/synoptique/components/accessory-face";
import type { AccessoryType, PanelItem, WidthFraction } from "@/components/synoptique/lib/types";

// ── Draggable equipment card ───────────────────────────────────────────────

export function DraggableEquipment({
  equipment,
  selectedId,
  onSelect,
}: {
  equipment: Equipment;
  selectedId: string | null;
  onSelect: (eq: Equipment) => void;
}) {
  const wf = (equipment.widthFraction as WidthFraction | null) ?? "FULL";
  const isSelected = selectedId === equipment.id;
  const dragData = useMemo(
    () => ({ type: "equipment", equipment, widthFraction: wf }),
    [equipment, wf],
  );
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `eq-${equipment.id}`,
    data: dragData,
  });
  const hex = useCategoryColor(equipment.category);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      onClick={() => onSelect(equipment)}
      className={cn(
        "flex items-center gap-2 rounded-md border transition-all select-none",
        isDragging && "opacity-40",
        isSelected
          ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/40"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5",
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="flex w-7 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded-l-xl transition-colors hover:bg-[var(--border)] active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs leading-tight font-medium">{equipment.name}</p>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--foreground)]">{equipment.heightU}U</span>
            {/* arkyo-server: habillage Strata (texte d'accent sur la teinte : --accent-strong) */}
            <span className="font-medium text-[var(--accent-strong)]">{WIDTH_CONFIG[wf].label}</span>
            {equipment.powerW && (
              <span className="flex items-center gap-0.5">
                <Zap className="h-2.5 w-2.5" />
                {equipment.powerW}W
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Draggable non-rackable equipment (for shelves) ────────────────────

export function DraggableShelfEquipment({
  equipment,
  onSelect,
  isSelected,
}: {
  equipment: Equipment;
  onSelect: (eq: Equipment) => void;
  isSelected?: boolean;
}) {
  const dragData = useMemo(() => ({ type: "shelf-equipment", equipment }), [equipment]);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `shelf-eq-${equipment.id}`,
    data: dragData,
  });
  const hex = useCategoryColor(equipment.category);
  const dims = [
    equipment.dimLmm && `${equipment.dimLmm}`,
    equipment.dimWmm && `${equipment.dimWmm}`,
    equipment.dimHmm && `${equipment.dimHmm}`,
  ]
    .filter(Boolean)
    .join("×");

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      onClick={() => onSelect(equipment)}
      className={cn(
        "flex items-center gap-2 rounded-md border transition-all select-none",
        isDragging && "opacity-40",
        isSelected
          ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/40"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5",
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="flex w-7 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded-l-xl transition-colors hover:bg-[var(--border)] active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs leading-tight font-medium">{equipment.name}</p>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
            <span className="font-semibold text-amber-600 dark:text-amber-400">Libre</span>
            {dims && <span className="font-mono">{dims}mm</span>}
            {equipment.powerW ? (
              <span className="flex items-center gap-0.5">
                <Zap className="h-2.5 w-2.5" />
                {equipment.powerW}W
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Draggable panel card ───────────────────────────────────────────────────

export function DraggablePanel({ panel }: { panel: PanelItem }) {
  const dragData = useMemo(() => ({ type: "panel", panel }), [panel]);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `panel-${panel.id}`,
    data: dragData,
  });
  const hex = useCategoryColor("Panels de patch");
  const totalSlots = panel.heightU * panel.slotsPerU;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "flex items-center gap-2 rounded-md border transition-all select-none",
        isDragging && "opacity-40",
        "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5",
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="flex w-7 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded-l-xl transition-colors hover:bg-[var(--border)] active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs leading-tight font-medium">{panel.name}</p>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--foreground)]">{panel.heightU}U</span>
            <span>{panel.slotsPerU} slots/U</span>
          </div>
          {/* Mini connector dots */}
          {totalSlots <= 32 && (
            <div className="mt-1 flex flex-wrap gap-0.5">
              {Array.from({ length: totalSlots }).map((_, i) => {
                const ps = panel.slots[i];
                const dotColor = ps?.connectorType?.color ?? "#555";
                return (
                  <span
                    key={i}
                    className="inline-block h-2 w-2 rounded-full border border-black/20"
                    style={{ background: dotColor }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Draggable configured accessory preview ─────────────────────────────────

export function DraggableAccessoryPreview({
  accessoryType,
  heightU,
  style,
  depthMm,
}: {
  accessoryType: AccessoryType;
  heightU: number;
  style?: string;
  depthMm?: number;
}) {
  const labelMap: Record<AccessoryType, string> = {
    plaque: "Plaque",
    etagere: "Étagère",
    tiroir: "Tiroir",
  };
  const styleLabel = style ? ` · ${PLAQUE_STYLES.find((s) => s.id === style)?.label ?? style}` : "";
  const depthLabel = depthMm ? ` · ${depthMm}mm` : "";
  const dragData = useMemo(
    () => ({ type: "configured-accessory", accessoryType, heightU, style, depthMm }),
    [accessoryType, heightU, style, depthMm],
  );
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: "accessory-preview",
    data: dragData,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("transition-opacity select-none", isDragging && "opacity-40")}
    >
      <div
        {...attributes}
        {...listeners}
        className="mt-2 flex cursor-grab touch-none flex-col gap-2 rounded-md border border-dashed border-[var(--accent)]/50 bg-[var(--accent)]/5 px-3 pt-2.5 pb-3 active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          <div className="min-w-0 flex-1">
            {/* arkyo-server: habillage Strata (texte d'accent sur la teinte : --accent-strong) */}
            <p className="truncate text-xs font-bold text-[var(--accent-strong)]">
              {labelMap[accessoryType]} {heightU}U{styleLabel}
              {depthLabel}
            </p>
            <p className="text-[10px] text-[var(--muted-foreground)]">Glisser dans la baie</p>
          </div>
        </div>
        <div className="flex justify-center">
          <AccessoryFace
            type={accessoryType}
            variant={style}
            height={previewFaceHeight(heightU)}
            style={{ maxWidth: 160 }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Drag overlay — shelf equipment ────────────────────────────────────────

export function DragOverlayShelfItem({ equipment }: { equipment: Equipment }) {
  const hex = useCategoryColor(equipment.category);
  const dims = [
    equipment.dimLmm && `${equipment.dimLmm}`,
    equipment.dimWmm && `${equipment.dimWmm}`,
    equipment.dimHmm && `${equipment.dimHmm}`,
  ]
    .filter(Boolean)
    .join("×");

  return (
    <div
      className="flex items-center gap-2 rounded-md border px-3 py-2 opacity-90 shadow-2xl"
      style={{ background: hexTint(hex, 0.18), borderColor: hex, minWidth: 160 }}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: hex }} />
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold" style={{ color: hexDarken(hex, 0.7) }}>
          {equipment.name}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-400">
          <span className="font-semibold text-amber-600">Libre</span>
          {dims && <span className="font-mono">{dims}mm</span>}
        </div>
      </div>
    </div>
  );
}

// ── Drag overlay — card compacte qui suit le curseur ─────────────────────
// La taille est fixe (~40px de haut, ~240px de large) quelque soit le heightU
// de l'équipement : on laisse le ghost dans le rack jouer le rôle de preview
// dimensionnel. Le nombre de U réel est rappelé dans le sous-titre.

export function DragOverlaySlot({
  label,
  heightU,
  widthFraction,
  category,
}: {
  label: string;
  heightU: number;
  widthFraction: WidthFraction;
  category?: string | null;
}) {
  const hex = useCategoryColor(category);

  return (
    <div
      className="relative flex items-center overflow-hidden rounded-md border px-2 py-2 opacity-90 shadow-2xl"
      style={{
        width: 240,
        background: hexTint(hex, 0.18),
        borderColor: hex,
      }}
    >
      <span className="absolute top-0 bottom-0 left-0 w-1 rounded-l" style={{ background: hex }} />
      <div className="min-w-0 pl-3">
        <p className="truncate text-xs font-semibold" style={{ color: hexDarken(hex, 0.7) }}>
          {label}
        </p>
        <p className="mt-0.5 text-[10px] text-zinc-400">
          {heightU}U · {WIDTH_CONFIG[widthFraction].label}
        </p>
      </div>
    </div>
  );
}
