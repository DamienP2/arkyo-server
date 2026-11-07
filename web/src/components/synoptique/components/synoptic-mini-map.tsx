"use client";

import { X } from "@/components/ui/icons";
import { useRef, useCallback } from "react";

export interface MiniMapNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
}

export interface MiniMapZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface SynopticMiniMapProps {
  nodes: MiniMapNode[];
  zones: MiniMapZone[];
  canvasW: number;
  canvasH: number;
  pan: { x: number; y: number };
  zoom: number;
  onPanChange: (pan: { x: number; y: number }) => void;
  onClose: () => void;
}

function computeBounds(nodes: MiniMapNode[], zones: MiniMapZone[]) {
  if (nodes.length === 0 && zones.length === 0) {
    return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  for (const z of zones) {
    minX = Math.min(minX, z.x);
    minY = Math.min(minY, z.y);
    maxX = Math.max(maxX, z.x + z.w);
    maxY = Math.max(maxY, z.y + z.h);
  }
  const padX = Math.max(100, (maxX - minX) * 0.1);
  const padY = Math.max(100, (maxY - minY) * 0.1);
  return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY };
}

export function SynopticMiniMap({
  nodes,
  zones,
  canvasW,
  canvasH,
  pan,
  zoom,
  onPanChange,
  onClose,
}: SynopticMiniMapProps) {
  const miniW = 180;
  const miniH = 120;
  const bounds = computeBounds(nodes, zones);
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const scale = Math.min(miniW / bw, miniH / bh);
  const offsetX = (miniW - bw * scale) / 2;
  const offsetY = (miniH - bh * scale) / 2;

  const worldToMini = (x: number, y: number) => ({
    mx: (x - bounds.minX) * scale + offsetX,
    my: (y - bounds.minY) * scale + offsetY,
  });

  const vpX = -pan.x / zoom;
  const vpY = -pan.y / zoom;
  const vpW = canvasW / zoom;
  const vpH = canvasH / zoom;
  const vpTL = worldToMini(vpX, vpY);
  const vpBR = worldToMini(vpX + vpW, vpY + vpH);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);

  const centerOnPoint = useCallback(
    (miniX: number, miniY: number) => {
      const worldX = (miniX - offsetX) / scale + bounds.minX;
      const worldY = (miniY - offsetY) / scale + bounds.minY;
      const newPanX = -(worldX * zoom - canvasW / 2);
      const newPanY = -(worldY * zoom - canvasH / 2);
      onPanChange({ x: newPanX, y: newPanY });
    },
    [scale, offsetX, offsetY, bounds.minX, bounds.minY, zoom, canvasW, canvasH, onPanChange],
  );

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    draggingRef.current = true;
    svg.setPointerCapture(e.pointerId);
    centerOnPoint(e.clientX - rect.left, e.clientY - rect.top);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    centerOnPoint(e.clientX - rect.left, e.clientY - rect.top);
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    draggingRef.current = false;
    svgRef.current?.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className="border-border bg-card absolute right-4 bottom-4 z-20 overflow-hidden rounded-md border shadow-lg"
      style={{ width: miniW, height: miniH + 22 }}
      data-minimap="true"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="border-border bg-muted/60 flex items-center justify-between border-b px-2 py-1">
        <span className="text-muted-foreground text-[9px] font-medium tracking-[0.15em] uppercase">
          Navigation
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer la mini-map"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <svg
        ref={svgRef}
        width={miniW}
        height={miniH}
        viewBox={`0 0 ${miniW} ${miniH}`}
        style={{ cursor: "pointer", display: "block" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <rect x={0} y={0} width={miniW} height={miniH} fill="var(--background)" />
        {zones.map((z) => {
          const tl = worldToMini(z.x, z.y);
          const br = worldToMini(z.x + z.w, z.y + z.h);
          return (
            <rect
              key={`z-${z.id}`}
              x={tl.mx}
              y={tl.my}
              width={Math.max(1, br.mx - tl.mx)}
              height={Math.max(1, br.my - tl.my)}
              fill={z.color}
              fillOpacity={0.15}
              stroke={z.color}
              strokeWidth={0.5}
            />
          );
        })}
        {nodes.map((n) => {
          const tl = worldToMini(n.x, n.y);
          const br = worldToMini(n.x + n.w, n.y + n.h);
          return (
            <rect
              key={`n-${n.id}`}
              x={tl.mx}
              y={tl.my}
              width={Math.max(2, br.mx - tl.mx)}
              height={Math.max(2, br.my - tl.my)}
              fill={n.color ?? "var(--accent)"}
              fillOpacity={0.5}
            />
          );
        })}
        <rect
          x={vpTL.mx}
          y={vpTL.my}
          width={Math.max(4, vpBR.mx - vpTL.mx)}
          height={Math.max(4, vpBR.my - vpTL.my)}
          // arkyo-server: habillage Strata (cadre de la vue : accent à 12 %)
          fill="color-mix(in srgb, var(--accent) 12%, transparent)"
          stroke="var(--accent)"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}
