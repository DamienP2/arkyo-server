"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AdapterOption } from "@/components/editor-shell/topbar-actions-context";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";

type CtMap = Record<string, { name?: string; color?: string | null }>;

export interface PortAdapterPickerProps {
  x: number;
  y: number;
  portConnectorTypeId: string | null;
  portGender: string | null; // MALE | FEMALE | NEUTRAL | null
  portSide: "left" | "right";
  ctMap: CtMap;
  onPick: (adapter: AdapterOption) => void;
  onClose: () => void;
}

function opposite(gender: string | null | undefined): string[] {
  const g = (gender ?? "").toUpperCase();
  if (g === "MALE") return ["FEMALE"];
  if (g === "FEMALE") return ["MALE"];
  return ["MALE", "FEMALE"];
}

// Mini aperçu graphique de l'adaptateur tel qu'il sera rendu sur le synoptique.
function AdapterThumb({ adapter, ctMap }: { adapter: AdapterOption; ctMap: CtMap }) {
  const inPorts = (adapter.inputs ?? []).flatMap((p) => {
    const qty = p.quantity ?? 1;
    return Array.from({ length: qty }, () => ({ ctId: p.connectorTypeId ?? null }));
  });
  const outPorts = (adapter.outputs ?? []).flatMap((p) => {
    const qty = p.quantity ?? 1;
    return Array.from({ length: qty }, () => ({ ctId: p.connectorTypeId ?? null }));
  });
  const W = 130;
  const PORT_H = 14;
  const TITLE_H = 12;
  const PAD_TOP = 4;
  const rows = Math.max(inPorts.length, outPorts.length, 1);
  const H = TITLE_H + PAD_TOP + rows * PORT_H + 4;
  const anchorY = inPorts.length > 0 ? TITLE_H + PAD_TOP + 0 * PORT_H + PORT_H / 2 : null;
  const ACCENT = "var(--accent)";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        fill="color-mix(in srgb, var(--foreground) 3%, transparent)"
        stroke="var(--border)"
        strokeWidth={0.8}
        rx={3}
      />
      {/* Routage interne : fan depuis anchor (1er port gauche) vers chaque port droite */}
      {anchorY != null &&
        outPorts.map((_, i) => {
          const targetY = TITLE_H + PAD_TOP + i * PORT_H + PORT_H / 2;
          const startX = 0;
          const endX = W;
          const cx1 = startX + (endX - startX) * 0.45;
          const cx2 = startX + (endX - startX) * 0.55;
          const d =
            Math.abs(targetY - anchorY) < 1
              ? `M ${startX},${anchorY} L ${endX},${targetY}`
              : `M ${startX},${anchorY} C ${cx1},${anchorY} ${cx2},${targetY} ${endX},${targetY}`;
          return (
            <path
              key={`fan-${i}`}
              d={d}
              fill="none"
              stroke={ACCENT}
              strokeWidth={1.2}
              strokeLinecap="round"
              opacity={0.35}
            />
          );
        })}
      {/* Ports gauche (inputs) */}
      {inPorts.map((p, i) => {
        const cy = TITLE_H + PAD_TOP + i * PORT_H + PORT_H / 2;
        const color = (p.ctId && ctMap[p.ctId]?.color) || "#9ca3af";
        return (
          <circle
            key={`l-${i}`}
            cx={0}
            cy={cy}
            r={3}
            fill={color}
            stroke="var(--background)"
            strokeWidth={1}
          />
        );
      })}
      {/* Ports droite (outputs) */}
      {outPorts.map((p, i) => {
        const cy = TITLE_H + PAD_TOP + i * PORT_H + PORT_H / 2;
        const color = (p.ctId && ctMap[p.ctId]?.color) || "#9ca3af";
        return (
          <circle
            key={`r-${i}`}
            cx={W}
            cy={cy}
            r={3}
            fill={color}
            stroke="var(--background)"
            strokeWidth={1}
          />
        );
      })}
    </svg>
  );
}

export function PortAdapterPicker({
  x,
  y,
  portConnectorTypeId,
  portGender,
  portSide,
  ctMap,
  onPick,
  onClose,
}: PortAdapterPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => document.addEventListener("mousedown", onClickOutside), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [onClose]);

  const available = useTopbarActions((s) => s.availableAdapters);
  // L'adaptateur est compatible ssi son connecteur de DÉPART (premier input)
  // a le même connectorTypeId que le port cliqué ET un genre opposé.
  const acceptedGenders = opposite(portGender);
  const compat = available.filter((a) => {
    const starting = (a.inputs ?? [])[0];
    if (!starting) return false;
    if (portConnectorTypeId && starting.connectorTypeId !== portConnectorTypeId) return false;
    const g = (starting.gender ?? "").toUpperCase();
    if (!g) return true; // si le genre n'est pas renseigné sur l'adaptateur, on reste permissif
    return acceptedGenders.includes(g);
  });

  // Positionnement : on essaie à droite (ou à gauche si le port est à droite du canvas),
  // puis on clamp dans le viewport pour garantir la visibilité quel que soit le point cliqué.
  const W = 280;
  const approxH = Math.min(360, Math.max(80, compat.length * 58 + 44));
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
  const GAP = 12;
  const PAD = 8;
  let placedX: number;
  if (portSide === "right") {
    placedX = x + GAP;
    if (placedX + W > vw - PAD) placedX = x - W - GAP; // bascule à gauche si ça dépasse
  } else {
    placedX = x - W - GAP;
    if (placedX < PAD) placedX = x + GAP;
  }
  placedX = Math.max(PAD, Math.min(placedX, vw - W - PAD));
  let placedY = y - approxH / 2;
  placedY = Math.max(PAD, Math.min(placedY, vh - approxH - PAD));

  if (!mounted) return null;

  const content = (
    <div
      ref={ref}
      className="border-border bg-popover text-popover-foreground fixed z-[9999] max-h-[360px] overflow-auto rounded-lg border p-1.5 text-xs shadow-lg ring-1 ring-black/5 backdrop-blur-xl"
      style={{ left: placedX, top: placedY, width: W }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="text-muted-foreground px-1.5 py-1 text-[9px] tracking-[0.14em] uppercase">
        {compat.length === 0
          ? "Aucun adaptateur compatible"
          : `${compat.length} compatible${compat.length > 1 ? "s" : ""}`}
      </div>
      <div className="flex flex-col gap-1">
        {compat.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPick(a)}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
          >
            <AdapterThumb adapter={a} ctMap={ctMap} />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[11px] font-medium">{a.name}</span>
              {a.reference && (
                <span
                  className="text-muted-foreground truncate text-[10px]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {a.reference}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
