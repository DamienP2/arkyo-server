"use client";

import type { MutableRefObject } from "react";
import type { CanvasLabel } from "@/components/synoptique/types/synoptic";

type SynopticLabelInputProps = {
  labelEditing: { mode: "create"; draft: CanvasLabel } | { mode: "edit"; labelId: string } | null;
  canvasLabels: CanvasLabel[];
  viewRef: MutableRefObject<{ pan: { x: number; y: number }; zoom: number }>;
  onConfirm: (labelId: string | null, text: string) => void;
  onCancel: () => void;
};

export function SynopticLabelInput({
  labelEditing,
  canvasLabels,
  viewRef,
  onConfirm,
  onCancel,
}: SynopticLabelInputProps) {
  if (!labelEditing) return null;

  const lbl =
    labelEditing.mode === "create"
      ? labelEditing.draft
      : canvasLabels.find((l) => l.id === labelEditing.labelId);
  if (!lbl) return null;

  const { pan, zoom } = viewRef.current;
  // Position the input at the label's canvas position, converted to screen space
  const screenX = lbl.x * zoom + pan.x;
  const screenY = (lbl.y - lbl.fontSize) * zoom + pan.y;
  const inputW =
    Math.max((lbl.width ?? Math.max(lbl.text.length * lbl.fontSize * 0.62, 40)) + 8, 80) * zoom;
  const inputH = (lbl.fontSize + 8) * zoom;

  const handleConfirm = (text: string) => {
    const labelId = labelEditing.mode === "edit" ? lbl.id : null;
    onConfirm(labelId, text);
  };

  return (
    <input
      key={lbl.id}
      autoFocus
      defaultValue={lbl.text}
      placeholder="Libell\u00e9\u2026"
      onBlur={(e) => handleConfirm(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleConfirm((e.target as HTMLInputElement).value);
        }
        if (e.key === "Escape") {
          onCancel();
        }
      }}
      style={{
        position: "absolute",
        left: screenX - 4,
        top: screenY - 2,
        width: inputW + 8,
        height: inputH,
        fontSize: lbl.fontSize * zoom,
        fontFamily: "system-ui",
        fontWeight: lbl.fontWeight,
        color: lbl.color,
        background: "color-mix(in srgb, var(--surface) 92%, transparent)",
        border: "1.5px solid var(--accent)",
        borderRadius: 4,
        outline: "none",
        padding: "0 4px",
        zIndex: 200,
        lineHeight: 1,
        boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
      }}
    />
  );
}
