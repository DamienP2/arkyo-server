"use client";

import React, { useState } from "react";
import type { AdapterDTO } from "./synoptic-adapter-picker";

// Géométrie du nœud — minimaliste, dans l'esprit /admin?s=cablage/adapters
export const ADAPTER_W = 130;
export const ADAPTER_PORT_H = 28; // = PORT_H equipment (alignement vertical)
export const ADAPTER_TITLE_H = 14; // hauteur réservée au titre au-dessus
export const ADAPTER_PORT_PAD_TOP = 4; // espace entre titre et premier port

export type SynopticAdapterInstance = {
  id: string;
  rackId: string;
  /**
   * @deprecated Alias d'affichage de `catalogAdapterId` (soft-FK main DB).
   * Conservé pour limiter le diff dans synoptic-view.tsx.
   */
  adapterId: string | null;
  /** Soft-FK vers main DB CatalogAdapter.id. */
  catalogAdapterId?: string | null;
  /** Enrichi cross-DB par SSR ou `useCatalogLookup("adapter")`. */
  adapter: AdapterDTO;
  x: number;
  y: number;
  attachedSlotId: string | null;
  attachedSide: "left" | "right" | null;
  attachedPortIndex: number | null;
  label: string | null;
  notes: string | null;
};

type ConnectorTypeMap = Record<string, { name?: string; color?: string | null }>;

type ExpandedPort = { idx: number; ctId?: string; label?: string; gender?: string };

function expandPorts(entries: NonNullable<AdapterDTO["inputs"]>): ExpandedPort[] {
  const out: ExpandedPort[] = [];
  let idx = 0;
  for (const e of entries) {
    const qty = e.quantity ?? 1;
    for (let i = 0; i < qty; i++) {
      out.push({ idx, ctId: e.connectorTypeId, label: e.label, gender: e.gender });
      idx++;
    }
  }
  return out;
}

function genderBadge(g?: string | null): string {
  const u = (g ?? "").toUpperCase();
  if (u === "MALE") return "M";
  if (u === "FEMALE") return "F";
  return "";
}

// Regroupe les ports consécutifs partageant (connectorTypeId, gender).
type PortGroup = {
  firstIdx: number;
  lastIdx: number;
  count: number;
  label: string | null;
  color: string | null;
};
function groupConsecutive(
  ports: ExpandedPort[],
  ctMap: Record<string, { name?: string; color?: string | null }>,
): PortGroup[] {
  const out: PortGroup[] = [];
  let cur: PortGroup | null = null;
  let curKey = "";
  for (const p of ports) {
    const key = `${p.ctId ?? ""}|${(p.gender ?? "").toUpperCase()}`;
    if (cur && curKey === key) {
      cur.lastIdx = p.idx;
      cur.count += 1;
      continue;
    }
    const ct = p.ctId ? ctMap[p.ctId] : null;
    const name = ct?.name ?? null;
    const color = ct?.color ?? null;
    const badge = genderBadge(p.gender);
    const base = name ? (badge ? `${name}/${badge}` : name) : null;
    cur = { firstIdx: p.idx, lastIdx: p.idx, count: 1, label: base, color };
    out.push(cur);
    curKey = key;
  }
  return out;
}

export function adapterNodeHeight(a: SynopticAdapterInstance): number {
  const inCount = (a.adapter.inputs ?? []).reduce((s, i) => s + (i.quantity ?? 1), 0);
  const outCount = (a.adapter.outputs ?? []).reduce((s, o) => s + (o.quantity ?? 1), 0);
  const portRows = Math.max(inCount, outCount, 1);
  return ADAPTER_TITLE_H + ADAPTER_PORT_PAD_TOP + portRows * ADAPTER_PORT_H;
}

export function adapterPortPosition(
  a: SynopticAdapterInstance,
  side: "left" | "right",
  portIdx: number,
): { x: number; y: number } {
  const y =
    a.y + ADAPTER_TITLE_H + ADAPTER_PORT_PAD_TOP + portIdx * ADAPTER_PORT_H + ADAPTER_PORT_H / 2;
  const x = side === "left" ? a.x : a.x + ADAPTER_W;
  return { x, y };
}

export function SynopticAdapterNode({
  adapter,
  selected,
  ctMap,
  onPointerDown,
  onPortDown,
  hoveredPort,
  isAttached = false,
  flipped = false,
  drawingFromCtId = null,
  getIncompatMsg,
  multiSelectedPorts = null,
  multiCompatPorts = null,
  onIncompatHover,
  cursor = "grab",
  cableToolActive = true,
}: {
  adapter: SynopticAdapterInstance;
  selected: boolean;
  ctMap: ConnectorTypeMap;
  onPointerDown: (e: React.PointerEvent) => void;
  onPortDown?: (side: "left" | "right", portIndex: number, e: React.PointerEvent) => void;
  hoveredPort?: { side: "left" | "right"; portIndex: number } | null;
  isAttached?: boolean;
  /** Si true, on inverse : les inputs vont à droite, les outputs vont à gauche. */
  flipped?: boolean;
  /** Connector type ID du port source en cours de tracé (pour incompat tooltip). */
  drawingFromCtId?: string | null;
  /** Callback qui calcule le message d'incompat pour un port (ou null si compatible). */
  getIncompatMsg?: (side: "left" | "right", portIndex: number) => string | null;
  /** Ports multi-sélectionnés (mode multi phase 1/2) — keyed par "side:portIndex" */
  multiSelectedPorts?: Set<string> | null;
  /** Ports multi-compatibles (mode multi phase 2 preview). */
  multiCompatPorts?: Set<string> | null;
  onIncompatHover?: (msg: string | null, x?: number, y?: number) => void;
  cursor?: string;
  cableToolActive?: boolean;
}) {
  const dbInputs = expandPorts(adapter.adapter.inputs ?? []);
  const dbOutputs = expandPorts(adapter.adapter.outputs ?? []);
  // En mode flipped, on échange visuellement les côtés (inputs à droite, outputs à gauche).
  const leftPorts = flipped ? dbOutputs : dbInputs;
  const rightPorts = flipped ? dbInputs : dbOutputs;
  const leftSemantic: "input" | "output" = flipped ? "output" : "input";
  const rightSemantic: "input" | "output" = flipped ? "input" : "output";
  const totalH = adapterNodeHeight(adapter);
  const ACCENT = "var(--accent)";

  // Position Y du dot d'anchor (premier port côté gauche dans la convention non-flipped,
  // ou premier port côté droit en flipped).
  const anchorPorts = flipped ? rightPorts : leftPorts;
  const anchorY =
    anchorPorts.length > 0
      ? ADAPTER_TITLE_H +
        ADAPTER_PORT_PAD_TOP +
        anchorPorts[0].idx * ADAPTER_PORT_H +
        ADAPTER_PORT_H / 2
      : null;

  return (
    <g
      transform={`translate(${adapter.x}, ${adapter.y})`}
      style={{ cursor, userSelect: "none", WebkitUserSelect: "none" }}
      onPointerDown={onPointerDown}
    >
      {/* Hit area transparente — permet de drag depuis n'importe où entre les ports.
          Quand l'adaptateur est accroché à un port équipement, le contour de sélection
          est rétracté côté ancre pour ne pas chevaucher le dot d'équipement. */}
      {/* Halo de sélection unifié : ring accent décalé 4px. */}
      {selected && (
        <rect
          x={-4}
          y={-4}
          width={ADAPTER_W + 8}
          height={totalH + 8}
          rx={8}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeOpacity={0.9}
          pointerEvents="none"
        />
      )}
      <rect
        x={0}
        y={0}
        width={ADAPTER_W}
        height={totalH}
        fill="transparent"
        stroke="transparent"
        strokeWidth={0}
        rx={4}
        pointerEvents="all"
      />

      {/* Routage interne — fan-out depuis le côté anchor vers l'autre côté */}
      {anchorY != null &&
        (() => {
          const fanPorts = flipped ? leftPorts : rightPorts;
          const startX = flipped ? ADAPTER_W : 0;
          const endX = flipped ? 0 : ADAPTER_W;
          return fanPorts.map((p) => {
            const targetY =
              ADAPTER_TITLE_H + ADAPTER_PORT_PAD_TOP + p.idx * ADAPTER_PORT_H + ADAPTER_PORT_H / 2;
            const cx1 = startX + (endX - startX) * 0.45;
            const cx2 = startX + (endX - startX) * 0.55;
            const d =
              Math.abs(targetY - anchorY) < 1
                ? `M ${startX},${anchorY} L ${endX},${targetY}`
                : `M ${startX},${anchorY} C ${cx1},${anchorY} ${cx2},${targetY} ${endX},${targetY}`;
            return (
              <path
                key={`fan-${p.idx}`}
                d={d}
                fill="none"
                stroke={ACCENT}
                strokeWidth={1.4}
                strokeLinecap="round"
                opacity={0.4}
                style={{ pointerEvents: "none" }}
              />
            );
          });
        })()}

      {(() => {
        // Helper: rendu des groupes d'un côté.
        const renderSide = (ports: ExpandedPort[], side: "left" | "right", isAnchor: boolean) => {
          const groups = groupConsecutive(ports, ctMap);
          return groups.map((g) => {
            if (!g.label) return null;
            const firstCY =
              ADAPTER_TITLE_H +
              ADAPTER_PORT_PAD_TOP +
              g.firstIdx * ADAPTER_PORT_H +
              ADAPTER_PORT_H / 2;
            const lastCY =
              ADAPTER_TITLE_H +
              ADAPTER_PORT_PAD_TOP +
              g.lastIdx * ADAPTER_PORT_H +
              ADAPTER_PORT_H / 2;
            const text = g.count > 1 ? `${g.label} ×${g.count}` : g.label;

            if (isAnchor) {
              // Côté "connecteur de départ" : label au-dessus du 1er port, comme un câble.
              return (
                <text
                  key={`lbl-a-${side}-${g.firstIdx}`}
                  x={side === "left" ? 8 : ADAPTER_W - 8}
                  y={firstCY - 9}
                  fontSize={8}
                  fontWeight={500}
                  fill="var(--muted-foreground)"
                  textAnchor={side === "left" ? "start" : "end"}
                  fontFamily="system-ui"
                  stroke="var(--background)"
                  strokeWidth={3}
                  style={{ paintOrder: "stroke", pointerEvents: "none", userSelect: "none" }}
                  suppressHydrationWarning
                >
                  {text}
                </text>
              );
            }

            // Côté fan-out : label centré + accolade verticale pour les groupes > 1.
            const midCY = (firstCY + lastCY) / 2;
            const color = g.color ?? "var(--muted-foreground)";
            // Accolade orientée vers l'intérieur (côté label) : 2 horizontales aux extrémités,
            // une verticale, et un petit pointeur central vers le label.
            // Accolade orientée : crochets vers les ports (dots), barre verticale côté label.
            // side=left → ports à gauche → crochets vers la gauche (forme ])
            // side=right → ports à droite → crochets vers la droite (forme [)
            const HOOK = side === "left" ? 8 : ADAPTER_W - 8; // extrémité des crochets (près des dots)
            const BAR = side === "left" ? 14 : ADAPTER_W - 14; // barre verticale (côté label)
            const chevronTip = side === "left" ? 18 : ADAPTER_W - 18; // pointe du chevron central
            const topY = firstCY - 6;
            const botY = lastCY + 6;
            const bracePath =
              g.count > 1
                ? `M ${HOOK} ${topY}
                 L ${BAR} ${topY}
                 L ${BAR} ${midCY - 3}
                 L ${chevronTip} ${midCY}
                 L ${BAR} ${midCY + 3}
                 L ${BAR} ${botY}
                 L ${HOOK} ${botY}`
                : null;
            return (
              <g key={`lbl-g-${side}-${g.firstIdx}`}>
                {bracePath && (
                  <path
                    d={bracePath}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.7}
                    style={{ pointerEvents: "none" }}
                  />
                )}
                <text
                  x={
                    side === "left"
                      ? g.count > 1
                        ? 24
                        : 10
                      : g.count > 1
                        ? ADAPTER_W - 24
                        : ADAPTER_W - 10
                  }
                  y={midCY + 2.5}
                  fontSize={8}
                  fontWeight={500}
                  fill="var(--muted-foreground)"
                  textAnchor={side === "left" ? "start" : "end"}
                  fontFamily="system-ui"
                  stroke="var(--background)"
                  strokeWidth={3}
                  style={{ paintOrder: "stroke", pointerEvents: "none", userSelect: "none" }}
                  suppressHydrationWarning
                >
                  {text}
                </text>
              </g>
            );
          });
        };
        const leftIsAnchor = !flipped;
        const rightIsAnchor = flipped;
        return (
          <>
            {renderSide(leftPorts, "left", leftIsAnchor)}
            {renderSide(rightPorts, "right", rightIsAnchor)}
          </>
        );
      })()}

      {/* Ports côté GAUCHE (sémantique selon flipped) */}
      {leftPorts.map((p) => {
        const cy =
          ADAPTER_TITLE_H + ADAPTER_PORT_PAD_TOP + p.idx * ADAPTER_PORT_H + ADAPTER_PORT_H / 2;
        const ct = p.ctId ? ctMap[p.ctId] : null;
        const color = ct?.color ?? "#9ca3af";
        const isAnchorSide = (flipped ? "right" : "left") === "left";
        const isOccupied = isAttached && isAnchorSide && p.idx === 0;
        const isMultiSelected = multiSelectedPorts?.has(`left:${p.idx}`) ?? false;
        const isMultiCompat = multiCompatPorts?.has(`left:${p.idx}`) ?? false;
        return (
          <AdapterPortDot
            key={`l-${leftSemantic}-${p.idx}`}
            cx={0}
            cy={cy}
            side="left"
            color={color}
            label={null}
            occupied={isOccupied}
            externalHover={hoveredPort?.side === "left" && hoveredPort.portIndex === p.idx}
            onPortDown={(e) => onPortDown?.("left", p.idx, e)}
            incompatMsg={
              !isOccupied && drawingFromCtId ? (getIncompatMsg?.("left", p.idx) ?? null) : null
            }
            onIncompatHover={onIncompatHover}
            isMultiSelected={isMultiSelected}
            isMultiCompat={isMultiCompat}
            occupiedCursor={cursor === "move" ? "move" : undefined}
            cableToolActive={cableToolActive}
          />
        );
      })}

      {/* Ports côté DROITE (sémantique selon flipped) */}
      {rightPorts.map((p) => {
        const cy =
          ADAPTER_TITLE_H + ADAPTER_PORT_PAD_TOP + p.idx * ADAPTER_PORT_H + ADAPTER_PORT_H / 2;
        const ct = p.ctId ? ctMap[p.ctId] : null;
        const color = ct?.color ?? "#9ca3af";
        const isAnchorSide = (flipped ? "right" : "left") === "right";
        const isOccupied = isAttached && isAnchorSide && p.idx === 0;
        const isMultiSelected = multiSelectedPorts?.has(`right:${p.idx}`) ?? false;
        const isMultiCompat = multiCompatPorts?.has(`right:${p.idx}`) ?? false;
        return (
          <AdapterPortDot
            key={`r-${rightSemantic}-${p.idx}`}
            cx={ADAPTER_W}
            cy={cy}
            side="right"
            color={color}
            label={null}
            occupied={isOccupied}
            externalHover={hoveredPort?.side === "right" && hoveredPort.portIndex === p.idx}
            onPortDown={(e) => onPortDown?.("right", p.idx, e)}
            incompatMsg={
              !isOccupied && drawingFromCtId ? (getIncompatMsg?.("right", p.idx) ?? null) : null
            }
            onIncompatHover={onIncompatHover}
            isMultiSelected={isMultiSelected}
            isMultiCompat={isMultiCompat}
            occupiedCursor={cursor === "move" ? "move" : undefined}
            cableToolActive={cableToolActive}
          />
        );
      })}
    </g>
  );
}

// Sous-composant : dot d'adaptateur calé sur le style equipment (12px, hover scale,
// label connector type AU-DESSUS du dot — comme un câble classique).
function AdapterPortDot({
  cx,
  cy,
  side,
  color,
  label,
  occupied,
  externalHover,
  onPortDown,
  incompatMsg,
  onIncompatHover,
  isMultiSelected = false,
  isMultiCompat = false,
  occupiedCursor,
  cableToolActive = true,
}: {
  cx: number;
  cy: number;
  side: "left" | "right";
  color: string;
  label: string | null;
  occupied: boolean;
  externalHover: boolean;
  onPortDown: (e: React.PointerEvent) => void;
  incompatMsg?: string | null;
  onIncompatHover?: (msg: string | null, x?: number, y?: number) => void;
  isMultiSelected?: boolean;
  isMultiCompat?: boolean;
  occupiedCursor?: string;
  cableToolActive?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const isHover = cableToolActive && (hover || externalHover);
  // Style aligné sur PortDot equipment : 12px (r=6), border 2, fill = colorXX semi-transparent.
  // Occupé : fill plein. Hover libre : scale 1.10. Compatible/source : scale 1.5.
  // Multi-sélectionné / compat (phase 2) : scale 1.5 + shadow, comme PanelDot.
  const boosted = cableToolActive && (isMultiSelected || isMultiCompat);
  const r = boosted ? 9 : isHover ? 6.6 : 6;
  const fill = occupied ? color : boosted ? color : isHover ? `${color}99` : `${color}55`;
  const stroke = color;
  // Port d'ancre accroché : on ne dessine pas le cercle (le port équipement fait office de marque).
  // Le hit area reste actif pour permettre drag/rebind en mode move.
  const hideCircle = occupied;
  // Label position : AU-DESSUS du dot (comme labels de câble : y - 8)
  const labelY = cy - 9;
  const portCursor = !cableToolActive
    ? occupied
      ? (occupiedCursor ?? "default")
      : "default"
    : occupied
      ? (occupiedCursor ?? "default")
      : "crosshair";
  const sharedHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (cableToolActive && !occupied) {
        e.stopPropagation();
        onPortDown(e);
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      if (!cableToolActive) return;
      setHover(true);
      if (incompatMsg && onIncompatHover) onIncompatHover(incompatMsg, e.clientX, e.clientY);
    },
    onMouseMove: (e: React.MouseEvent) => {
      if (cableToolActive && incompatMsg && onIncompatHover)
        onIncompatHover(incompatMsg, e.clientX, e.clientY);
    },
    onMouseLeave: () => {
      setHover(false);
      if (onIncompatHover) onIncompatHover(null);
    },
    style: { cursor: portCursor } as React.CSSProperties,
  };
  return (
    <g>
      {/* visuel : circle dessous + label */}
      {!hideCircle && (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          style={{
            transition: "all 0.15s",
            pointerEvents: "none",
            filter: boosted ? `drop-shadow(0 0 6px ${color})` : undefined,
          }}
        />
      )}
      {label && (
        <text
          x={side === "left" ? cx + 8 : cx - 8}
          y={labelY}
          fontSize={8}
          fontWeight="500"
          fill="var(--muted-foreground)"
          textAnchor={side === "left" ? "start" : "end"}
          fontFamily="system-ui"
          style={{ pointerEvents: "none" }}
          suppressHydrationWarning
        >
          {label}
        </text>
      )}
      {/* hit area en DERNIER (topmost en SVG) — reçoit fiablement tous les events.
          Élargie à la hauteur de ligne : viser un dot de 12 px à faible zoom
          est la cause principale des poses ratées. */}
      <rect
        x={cx - 15}
        y={cy - ADAPTER_PORT_H / 2}
        width={30}
        height={ADAPTER_PORT_H}
        fill="transparent"
        pointerEvents="all"
        {...sharedHandlers}
      />
    </g>
  );
}
