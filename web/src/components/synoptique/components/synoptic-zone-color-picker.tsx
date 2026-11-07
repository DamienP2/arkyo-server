"use client";

import { Trash2 } from "@/components/ui/icons";
import type { Zone } from "@/components/synoptique/types/synoptic";
import { ZONE_COLORS } from "@/components/synoptique/types/synoptic";

type SynopticZoneColorPickerProps = {
  selectedZoneId: string | null;
  zones: Zone[];
  pan: { x: number; y: number };
  zoom: number;
  onColorChange: (zoneId: string, color: string) => void;
  onEdit: (zoneId: string) => void;
  onDelete: (zoneId: string) => void;
};

export function SynopticZoneColorPicker({
  selectedZoneId,
  zones,
  pan,
  zoom,
  onColorChange,
  onEdit,
  onDelete,
}: SynopticZoneColorPickerProps) {
  if (!selectedZoneId) return null;
  const zone = zones.find((z) => z.id === selectedZoneId);
  if (!zone) return null;

  // Position: bottom-center of the zone in screen space
  const sx = pan.x + (zone.x + zone.w / 2) * zoom;
  const sy = pan.y + (zone.y + zone.h) * zoom + 10;

  return (
    <div
      data-toolbar
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: sx,
        top: sy,
        transform: "translateX(-50%)",
        zIndex: 30,
        background: "var(--surface)",
      }}
      className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2.5 py-2 shadow-lg"
    >
      {ZONE_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onColorChange(selectedZoneId, c)}
          title={`Couleur ${c}`}
          aria-label={`Appliquer la couleur ${c}`}
          className="h-5 w-5 shrink-0 rounded-full border-2 transition-transform hover:scale-110"
          style={{
            background: c,
            borderColor: zone.color === c ? "white" : "transparent",
            boxShadow: zone.color === c ? `0 0 0 2px ${c}` : undefined,
          }}
        />
      ))}
      <div className="h-4 w-px shrink-0 bg-[var(--border)]" />
      <button
        onClick={() => onEdit(selectedZoneId)}
        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
      >
        <span className="text-sm leading-none">{"\u270e"}</span>
        Modifier
      </button>
      <div className="h-4 w-px shrink-0 bg-[var(--border)]" />
      <button
        onClick={() => onDelete(selectedZoneId)}
        // arkyo-server: habillage Strata (texte de danger : --danger-text)
        className="text-[var(--danger-text)] hover:bg-destructive/10 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors"
      >
        <Trash2 className="h-3 w-3" />
        Supprimer
      </button>
    </div>
  );
}
