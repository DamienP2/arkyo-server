"use client";

import { cn } from "@/lib/utils";
import { Trash2 } from "@/components/ui/icons";
import type { CanvasLabel } from "@/components/synoptique/types/synoptic";

const LABEL_COLORS = [
  "#111827",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#6366f1",
  "#a855f7",
  "#06b6d4",
  "#ec4899",
];

type SynopticLabelToolbarProps = {
  selectedLabelId: string | null;
  canvasLabels: CanvasLabel[];
  pan: { x: number; y: number };
  zoom: number;
  onColorChange: (labelId: string, color: string) => void;
  onBoldToggle: (labelId: string) => void;
  onEdit: (labelId: string) => void;
  onDelete: (labelId: string) => void;
};

export function SynopticLabelToolbar({
  selectedLabelId,
  canvasLabels,
  pan,
  zoom,
  onColorChange,
  onBoldToggle,
  onEdit,
  onDelete,
}: SynopticLabelToolbarProps) {
  if (!selectedLabelId) return null;
  const lbl = canvasLabels.find((l) => l.id === selectedLabelId);
  if (!lbl) return null;

  const sx = pan.x + lbl.x * zoom;
  const sy = pan.y + lbl.y * zoom + 8;

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
      className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-2.5 py-2 shadow-lg"
    >
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onColorChange(selectedLabelId, c)}
          title={`Couleur ${c}`}
          aria-label={`Appliquer la couleur ${c}`}
          className="h-4 w-4 shrink-0 rounded-full transition-transform hover:scale-110"
          style={{
            background: c,
            outline: lbl.color === c ? `2px solid var(--accent)` : `1px solid var(--border)`,
            outlineOffset: lbl.color === c ? 1 : 0,
          }}
        />
      ))}
      <div className="h-4 w-px shrink-0 bg-[var(--border)]" />
      <button
        onClick={() => onBoldToggle(selectedLabelId)}
        className={cn(
          "rounded-lg px-2 py-1 text-[11px] font-bold transition-colors",
          lbl.fontWeight === "bold"
            ? "bg-[var(--accent)] text-[var(--accent-foreground)]" // arkyo-server: habillage Strata (blanc illisible sur l'accent sombre)
            : "text-[var(--muted-foreground)] hover:bg-[var(--border)]",
        )}
      >
        B
      </button>
      <div className="h-4 w-px shrink-0 bg-[var(--border)]" />
      <button
        onClick={() => onEdit(selectedLabelId)}
        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
      >
        <span className="text-sm leading-none">{"\u270e"}</span>
        Modifier
      </button>
      <div className="h-4 w-px shrink-0 bg-[var(--border)]" />
      <button
        onClick={() => onDelete(selectedLabelId)}
        // arkyo-server: habillage Strata (action de suppression : --danger-text, fond --destructive comme le picker de zone)
        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--danger-text)] transition-colors hover:bg-destructive/10"
      >
        <Trash2 className="h-3 w-3" />
        Supprimer
      </button>
    </div>
  );
}
