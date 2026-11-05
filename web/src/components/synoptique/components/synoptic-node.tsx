"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Port, ConnectorTypeInfo, RackSlotWithEquipment, PortRef } from "@/components/synoptique/types/synoptic";
import {
  NODE_W,
  PANEL_NODE_W,
  PORT_H,
  NODE_HEADER_H,
  NODE_MIN_H,
  isPanelVirtualId,
  getVirtualRowInfo,
} from "@/components/synoptique/types/synoptic";

// ─── PortDot (simple dot used in PortRow) ──────────────────────────────────

export function PortDot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <div
      className="shrink-0 rounded-full border-2"
      style={{ width: size, height: size, borderColor: color, background: `${color}33` }}
    />
  );
}

// ─── PanelDot ─────────────────────────────────────────────────────────────────

export function PanelDot({
  p: _p,
  side,
  color,
  isOccupied,
  isExternal = false,
  isSrc,
  isCompat,
  isSnap,
  drawingActive,
  incompatMsg,
  onRef,
  onClick,
  onIncompatHover,
  cableToolActive = true,
}: {
  p: Port;
  side: "left" | "right";
  color: string;
  isOccupied: boolean;
  isExternal?: boolean;
  isSrc: boolean;
  isCompat: boolean;
  isSnap: boolean;
  drawingActive: boolean;
  incompatMsg: string | null;
  onRef: (el: HTMLElement) => void;
  onClick: (e: React.MouseEvent) => void;
  onIncompatHover: (msg: string | null, x?: number, y?: number) => void;
  cableToolActive?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const compatHovered = cableToolActive && isCompat && hovered;
  const freeHovered = cableToolActive && !isOccupied && !drawingActive && hovered;
  const scale =
    isSrc || compatHovered || isSnap
      ? "scale-150"
      : cableToolActive && isCompat
        ? "scale-125"
        : freeHovered
          ? "scale-110"
          : "";
  const bg =
    isSrc || compatHovered || isSnap
      ? color
      : isOccupied || isExternal
        ? color
        : cableToolActive && isCompat
          ? `${color}99`
          : `${color}55`;
  const shadow =
    isSrc || compatHovered || isSnap
      ? `0 0 0 3px ${color}55, 0 0 12px ${color}`
      : cableToolActive && isCompat
        ? `0 0 6px ${color}88`
        : undefined;
  // Un port câblé reste cliquable (doublon autorisé, signalé par la validation).
  const cursorClass = !cableToolActive ? "cursor-default" : "cursor-crosshair";
  return (
    <>
      <div
        ref={(el) => {
          if (el) onRef(el);
        }}
        className={cn("pointer-events-none absolute rounded-full border-2 transition-all", scale)}
        style={{
          width: 12,
          height: 12,
          top: "50%",
          transform: "translateY(-50%)",
          left: side === "left" ? -6 : undefined,
          right: side === "right" ? -6 : undefined,
          borderColor: color,
          background: bg,
          boxShadow: shadow,
          zIndex: 2,
        }}
      />
      {/* Zone de clic élargie — le dot fait 12 px, intenable à faible zoom sur
          un patch 24 ports. Transparente, centrée sur le dot, hauteur de ligne. */}
      <div
        className={cn("absolute", cursorClass)}
        style={{
          width: 32,
          height: PORT_H,
          top: "50%",
          transform: "translateY(-50%)",
          left: side === "left" ? -16 : undefined,
          right: side === "right" ? -16 : undefined,
          zIndex: 3,
          // Hors outil câble : transparente aux clics (sélection node/câble).
          pointerEvents: cableToolActive ? "auto" : "none",
        }}
        onMouseEnter={(e) => {
          if (cableToolActive && (isCompat || (!isOccupied && !drawingActive))) setHovered(true);
          if (cableToolActive && incompatMsg) onIncompatHover(incompatMsg, e.clientX, e.clientY);
        }}
        onMouseMove={(e) => {
          if (cableToolActive && incompatMsg) onIncompatHover(incompatMsg, e.clientX, e.clientY);
        }}
        onMouseLeave={() => {
          setHovered(false);
          onIncompatHover(null);
        }}
        onClick={(e) => {
          if (cableToolActive) onClick(e);
        }}
      />
    </>
  );
}

// ─── incompatReason ─────────────────────────────────────────────────────────

export function incompatReason(
  src: Port | null,
  dst: Port,
  dstSlotId: string,
  panelPortDirs: Map<string, "IN" | "OUT" | "BIDIR">,
  isOccupied: boolean,
  /** Set des noms de signaux taggés IP (`CatalogSignalType.isIp = true`).
   *  Si fourni, deux ports IP voient leurs checks signal + connecteur
   *  relâchés (cas réel : switch IT entre les deux). */
  ipSignalNames?: Set<string>,
): string | null {
  if (!src) return null;
  const isBidir = (d?: string) => !d || d === "BIDIR" || d === "BOTH";
  const srcDirRaw = src.entry.direction?.toUpperCase();
  const srcDir = isBidir(srcDirRaw) ? null : srcDirRaw;
  const dstDirRaw = dst.entry.direction?.toUpperCase();
  const dstDir = isBidir(dstDirRaw)
    ? (panelPortDirs.get(`${dstSlotId}:${dst.portIndex}`) ?? null)
    : dstDirRaw;
  const reasons: string[] = [];
  // Port déjà câblé : jamais un refus — la pose demande confirmation puis
  // REMPLACE le câble en place (un port ne porte jamais deux câbles).
  const occupiedMsg = isOccupied ? "Port déjà câblé — le câble existant sera remplacé" : null;
  if (srcDir && dstDir && srcDir === dstDir)
    reasons.push(
      srcDir === "IN" ? "Sens identique : deux entrees" : "Sens identique : deux sorties",
    );
  const srcSignal = src.entry.signalName ?? null;
  const dstSignal = dst.entry.signalName ?? null;
  const srcIsIp = !!srcSignal && !!ipSignalNames?.has(srcSignal);
  const dstIsIp = !!dstSignal && !!ipSignalNames?.has(dstSignal);
  // Règles de compatibilité relâchées :
  // - Deux ports IP : on relâche signal + connecteur (switch IT implicite).
  // - Un port sans signal (switching/transit) : on relâche aussi — il
  //   transporte le signal du pair, peu importe le connecteur physique.
  const bothIp = srcIsIp && dstIsIp;
  const oneIsPassthrough = !srcSignal || !dstSignal;
  if (!bothIp && !oneIsPassthrough) {
    const srcTypeId = src.entry.connectorTypeId ?? null;
    const dstTypeId = dst.entry.connectorTypeId ?? null;
    if (srcTypeId && dstTypeId && srcTypeId !== dstTypeId)
      reasons.push("Types de connecteur differents");
    if (srcSignal && dstSignal && srcSignal !== dstSignal)
      reasons.push(`Signaux differents (${srcSignal} <-> ${dstSignal})`);
  }
  if (reasons.length === 0) return occupiedMsg;
  const msg = reasons.join(" · ") + " — connexion possible quand même";
  return occupiedMsg ? `${occupiedMsg} · ${msg}` : msg;
}

// ─── PortRow ─────────────────────────────────────────────────────────────────

export function PortRow({
  port,
  side,
  slotId: _slotId,
  sideIndex: _sideIndex,
  isDrawingTarget: _isDrawingTarget,
  isSnapTarget,
  isConnected,
  isSource,
  isCompatible,
  isMultiEligible,
  drawingActive,
  incompatMsg,
  deducedDir,
  isPanelSlot,
  onClick,
  onRef,
  onIncompatHover,
  cableToolActive = true,
  isExternal = false,
}: {
  port: Port;
  side: "left" | "right";
  slotId: string;
  sideIndex: number;
  isDrawingTarget: boolean;
  isSnapTarget: boolean;
  isConnected: boolean;
  isSource: boolean;
  isCompatible: boolean;
  isMultiEligible: boolean;
  drawingActive: boolean;
  incompatMsg: string | null;
  isPanelSlot: boolean;
  deducedDir?: "IN" | "OUT" | "BIDIR";
  onClick: () => void;
  onRef: (el: HTMLElement) => void;
  onIncompatHover: (msg: string | null, x?: number, y?: number) => void;
  cableToolActive?: boolean;
  isExternal?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const color = port.ct?.color ?? "#71717a";

  const signalType = port.ct
    ? `${port.ct.name}${port.ct.version ? ` ${port.ct.version}` : ""}`
    : null;

  const rawDir = port.entry.direction?.toUpperCase();
  const groupLabel = port.entry.label?.trim() || signalType || "\u2014";
  const portLabel = port.totalUnits > 1 ? `${groupLabel} ${port.unitIndex + 1}` : groupLabel;

  // Derive visual state of the dot
  const compatHovered = cableToolActive && isCompatible && hovered;
  const dotScale =
    isSource || compatHovered || isSnapTarget
      ? "scale-150"
      : cableToolActive && (isCompatible || isMultiEligible)
        ? "scale-125"
        : cableToolActive && !isConnected && !drawingActive
          ? "group-hover:scale-110"
          : "";
  const dotBg =
    isSource || compatHovered || isSnapTarget
      ? color
      : isConnected || isExternal
        ? color
        : cableToolActive && isCompatible
          ? `${color}99`
          : `${color}55`;
  const dotShadow =
    isSource || compatHovered || isSnapTarget
      ? `0 0 0 3px ${color}55, 0 0 12px ${color}`
      : cableToolActive && isCompatible
        ? `0 0 6px ${color}88`
        : cableToolActive && isMultiEligible
          ? `0 0 6px ${color}66`
          : undefined;
  // Toujours crosshair quand l'outil câble est actif : aucune cible n'est
  // refusée (port câblé, signal différent… = avertissement, pas blocage).
  const rowCursor = !cableToolActive ? "cursor-default" : "cursor-crosshair";

  return (
    <div
      className={cn(
        "group relative flex items-center",
        rowCursor,
        side === "right" ? "flex-row-reverse" : "",
      )}
      style={{
        height: PORT_H,
        width: NODE_W / 2,
        paddingLeft: side === "left" ? 26 : 6,
        paddingRight: side === "right" ? 26 : 6,
      }}
      onMouseMove={(e) => {
        if (cableToolActive && incompatMsg) onIncompatHover(incompatMsg, e.clientX, e.clientY);
      }}
      onMouseEnter={(e) => {
        if (cableToolActive && incompatMsg) {
          setHovered(true);
          onIncompatHover(incompatMsg, e.clientX, e.clientY);
        }
      }}
      onMouseLeave={() => {
        setHovered(false);
        onIncompatHover(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        // Un port déjà câblé reste cliquable : le doublon est autorisé et
        // signalé par la validation, jamais bloqué ici.
        if (cableToolActive) onClick();
      }}
    >
      {/* Débord de la zone de clic vers l'extérieur du node — le dot déborde de
          6 px seulement, viser à faible zoom devient impossible sinon. */}
      <div
        className="absolute"
        style={{
          width: 22,
          height: PORT_H,
          top: "50%",
          transform: "translateY(-50%)",
          left: side === "left" ? -22 : undefined,
          right: side === "right" ? -22 : undefined,
          zIndex: 1,
          // Hors outil câble, la bande ne doit pas avaler les clics destinés
          // aux câbles qui passent devant le node.
          pointerEvents: cableToolActive ? "auto" : "none",
        }}
      />
      {/* Port dot — anchored at node edge */}
      <div
        ref={(el) => {
          if (el) onRef(el);
        }}
        className={cn("absolute rounded-full border-2 transition-all", dotScale)}
        style={{
          width: 12,
          height: 12,
          top: "50%",
          transform: "translateY(-50%)",
          left: side === "left" ? -6 : undefined,
          right: side === "right" ? -6 : undefined,
          borderColor: color,
          background: dotBg,
          boxShadow: dotShadow,
          zIndex: 2,
        }}
        onMouseEnter={() => isCompatible && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {/* Direction indicator */}
      {(() => {
        const effectiveDir = isPanelSlot
          ? deducedDir
          : rawDir === "BIDIR" || rawDir === "BOTH"
            ? "BIDIR"
            : rawDir;
        if (!effectiveDir) return null;
        const offset = side === "left" ? { left: 10 } : { right: 10 };
        return (
          <div
            className="absolute"
            style={{
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 3,
              pointerEvents: "none",
              ...offset,
            }}
          >
            {effectiveDir === "IN" && side === "left" && (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <polygon points="0,0 10,5 0,10" fill="#ef4444" />
              </svg>
            )}
            {effectiveDir === "IN" && side === "right" && (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <polygon points="10,0 0,5 10,10" fill="#ef4444" />
              </svg>
            )}
            {effectiveDir === "OUT" && side === "left" && (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <polygon points="10,0 0,5 10,10" fill="#22c55e" />
              </svg>
            )}
            {effectiveDir === "OUT" && side === "right" && (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <polygon points="0,0 10,5 0,10" fill="#22c55e" />
              </svg>
            )}
            {effectiveDir === "BIDIR" && (
              <svg width="12" height="10" viewBox="0 0 12 10">
                <polygon points="6,0 0,5 6,10" fill="#ef4444" />
                <polygon points="6,0 12,5 6,10" fill="#22c55e" />
              </svg>
            )}
          </div>
        );
      })()}

      {/* Port label */}
      <div className={cn("flex min-w-0 flex-1 flex-col", side === "right" && "items-end")}>
        <span
          className="truncate text-[9px] leading-tight font-semibold text-[var(--foreground)]"
          style={{ maxWidth: 80 }}
        >
          {portLabel}
        </span>
      </div>
    </div>
  );
}

// ─── SynopticNode ─────────────────────────────────────────────────────────────

export type NodeProps = {
  panelPortDirs: Map<string, "IN" | "OUT" | "BIDIR">;
  slot: RackSlotWithEquipment;
  x: number;
  y: number;
  connectorTypes: ConnectorTypeInfo[];
  ports: Port[];
  isSelected: boolean;
  drawingFrom: { slotId: string; portIndex: number } | null;
  snapTarget: { slotId: string; portIndex: number } | null;
  connectedPortIndices: Set<number>;
  selectedSrcIndices: Set<number>;
  compatiblePortIndices: Set<number>;
  multiSnapIndices: Set<number>;
  multiSrcConfirmed: boolean;
  drawingFromPort: Port | null;
  canDrag: boolean;
  /** Sélection au click. L'event est propagé pour permettre au parent de
   *  détecter Shift / Cmd / Ctrl (multi-sélection) sans casser l'API existante
   *  (param optionnel). */
  onSelect: (e?: React.MouseEvent) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onPortClick: (slotId: string, portIndex: number) => void;
  onPortRef: (ref: PortRef) => void;
  onIncompatHover: (msg: string | null, x?: number, y?: number) => void;
  /** Extra marginBottom à ajouter sous le port d'index donné (causé par adaptateur attaché). */
  portExtras?: Map<number, number>;
  /** Extra de hauteur totale du nœud (max des deux côtés). */
  extraNodeHeight?: number;
  /** Outil "cable" actif — sinon les ports ne réagissent plus (curseur + hover). */
  cableToolActive?: boolean;
  /** Indices de ports marqués comme "Connexions externes" — le dot est rempli. */
  externalPortIndices?: Set<number>;
  /** True = le node est dans le rubber-band en cours (preview avant commit).
   *  Affiche un ring subtil pour donner un retour visuel pendant le drag,
   *  comme pour les câbles (cf. previewConnIds dans synoptic-view). */
  isPreview?: boolean;
  /** Set des noms de signaux IP. Passé à `incompatReason` pour relâcher les
   *  checks signal/connecteur quand les deux ports sont IP. */
  ipSignalNames?: Set<string>;
  /**
   * Nom du contenant portant l'équipement — affiché en pastille dans l'entête.
   * Fourni uniquement par les vues agrégeant plusieurs contenants (vue lieu).
   * `null`/absent = aucune pastille (vue rack focus, vue Générale, équipements
   * libres d'un lieu qui n'appartiennent à aucun contenant).
   */
  containerLabel?: string | null;
  /** Couleur stable du contenant (pastille teintée) — null = pastille neutre. */
  containerColor?: string | null;
};

export function SynopticNode({
  slot,
  x,
  y,
  connectorTypes: _ct,
  ports,
  isSelected,
  drawingFrom,
  snapTarget,
  connectedPortIndices,
  selectedSrcIndices,
  compatiblePortIndices,
  multiSnapIndices,
  multiSrcConfirmed,
  drawingFromPort,
  panelPortDirs,
  canDrag,
  onSelect,
  onDragStart,
  onPortClick,
  onPortRef,
  onIncompatHover,
  portExtras,
  extraNodeHeight = 0,
  cableToolActive = true,
  externalPortIndices,
  ipSignalNames,
  isPreview = false,
  containerLabel = null,
  containerColor = null,
}: NodeProps) {
  const eq = slot.equipment;
  const panel = slot.panel;
  const virtualInfo = isPanelVirtualId(slot.id) ? getVirtualRowInfo(slot.id) : null;
  const leftPorts = ports.filter((p) => p.side === "left");
  const rightPorts = ports.filter((p) => p.side === "right");
  const nodeW = panel ? PANEL_NODE_W : NODE_W;

  // ── Equipment grouping (vue Générale) ──────────────────────────────────────
  // Si au moins un port porte un `groupLabel` non nul, on insère des mini-headers
  // centrés (transverse aux deux colonnes left/right) à chaque transition de
  // groupe. Sinon (rack focus, mode historique), aucune transformation : le
  // rendu est strictement identique à avant.
  const HEADER_ROW_H = 22; // hauteur de la ligne mini-header de groupe
  const hasAnyGroup = !panel && ports.some((p) => !!p.entry.groupLabel);

  type GroupSegment = { label: string | null; ports: Port[] };
  const buildSegments = (list: Port[]): GroupSegment[] => {
    const out: GroupSegment[] = [];
    for (const p of list) {
      const label = p.entry.groupLabel ?? null;
      const last = out[out.length - 1];
      if (last && last.label === label) last.ports.push(p);
      else out.push({ label, ports: [p] });
    }
    return out;
  };
  const leftSegments = hasAnyGroup ? buildSegments(leftPorts) : [{ label: null, ports: leftPorts }];
  const rightSegments = hasAnyGroup
    ? buildSegments(rightPorts)
    : [{ label: null, ports: rightPorts }];

  // Compute aligned segments : on parcourt les labels uniques dans l'ordre du
  // tableau `ports` complet (hôte d'abord, puis composants). Pour chaque label, on alloue une
  // bande verticale dont la hauteur = max(leftCount, rightCount) * PORT_H + (label ? HEADER_ROW_H : 0).
  // Les ports left/right de ce label sont rendus dans cette bande aux sides
  // respectifs ; ports manquants d'un côté = espace vide.
  type AlignedSegment = {
    label: string | null;
    leftPorts: Port[];
    rightPorts: Port[];
    headerH: number;
    rowsH: number;
  };
  let alignedSegments: AlignedSegment[] = [];
  if (hasAnyGroup) {
    // Ordre canonique des segments = ordre du tableau `ports` complet (les
    // ports PROPRES de l'hôte y sont poussés en premier — groupLabel null —
    // puis les composants par slotIndex croissant, cf. `slotPorts`). Dériver
    // l'ordre de `[...leftSegments, ...rightSegments]` casserait cette garantie
    // dès qu'un composant (ou l'hôte) n'a de ports que d'un seul côté.
    const order: (string | null)[] = [];
    const seen = new Set<string | null>();
    for (const p of ports) {
      const label = p.entry.groupLabel ?? null;
      if (!seen.has(label)) {
        seen.add(label);
        order.push(label);
      }
    }
    for (const lbl of order) {
      const lp = leftSegments.find((s) => s.label === lbl)?.ports ?? [];
      const rp = rightSegments.find((s) => s.label === lbl)?.ports ?? [];
      const rows = Math.max(lp.length, rp.length);
      alignedSegments.push({
        label: lbl,
        leftPorts: lp,
        rightPorts: rp,
        headerH: lbl ? HEADER_ROW_H : 0,
        rowsH: rows * PORT_H,
      });
    }
  } else {
    alignedSegments = [
      {
        label: null,
        leftPorts,
        rightPorts,
        headerH: 0,
        rowsH: Math.max(leftPorts.length, rightPorts.length) * PORT_H,
      },
    ];
  }

  const totalGroupedContentH = alignedSegments.reduce((s, g) => s + g.headerH + g.rowsH, 0);

  const nodeH =
    Math.max(
      NODE_MIN_H,
      NODE_HEADER_H +
        (hasAnyGroup
          ? totalGroupedContentH + 12
          : Math.max(leftPorts.length, rightPorts.length) * PORT_H + 12),
    ) + extraNodeHeight;

  // For panels: pairs (leftPort, rightPort) sharing the same entryIndex
  const panelPairs = panel
    ? rightPorts.map((rp) => ({
        right: rp,
        left: leftPorts.find((lp) => lp.entryIndex === rp.entryIndex) ?? null,
      }))
    : [];

  return (
    <div
      className={cn(
        "absolute rounded-xl border shadow-lg transition-shadow select-none",
        "border-[var(--border)]",
        isSelected && "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--canvas-bg)]",
        !isSelected && isPreview && "ring-1 ring-[var(--accent)]/60 ring-offset-1 ring-offset-[var(--canvas-bg)]",
      )}
      style={{
        left: x,
        top: y,
        width: nodeW,
        height: nodeH,
        background: "var(--surface)",
        cursor: "default",
        overflow: "visible",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(e);
      }}
    >
      {/* Header */}
      <div
        className={cn(
          "flex flex-col justify-center gap-0.5 rounded-t-xl px-3 py-2",
          canDrag ? "cursor-move" : "cursor-default",
        )}
        style={{
          height: NODE_HEADER_H,
          background: panel
            ? "color-mix(in srgb, #6366f1 12%, var(--secondary))"
            : "var(--secondary)",
          borderBottom: "1px solid var(--border)",
        }}
        onPointerDown={canDrag ? onDragStart : undefined}
      >
        <p
          className="text-[12px] leading-tight font-bold text-[var(--foreground)]"
          style={{ wordBreak: "break-word" }}
        >
          {slot.label ?? (panel ? panel.name : (eq?.reference ?? eq?.name ?? "\u2014"))}
        </p>
        {panel && virtualInfo && (
          <p className="text-[9px] leading-tight" style={{ color: "var(--muted-foreground)" }}>
            U{virtualInfo.rowIdx + 1}
          </p>
        )}
        {!panel && (
          <>
            <p
              className="text-[9px] leading-tight"
              style={{ color: "var(--muted-foreground)", wordBreak: "break-word" }}
            >
              {[eq?.brand?.name, eq?.name].filter(Boolean).join(" \u00b7 ")}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5">
              {containerLabel && (
                <span
                  className="max-w-[110px] truncate rounded px-1.5 py-0.5 text-[7px] font-semibold tracking-[0.08em] uppercase"
                  style={{
                    border: `1px solid ${
                      containerColor
                        ? `color-mix(in srgb, ${containerColor} 45%, transparent)`
                        : "var(--border)"
                    }`,
                    background: containerColor
                      ? `color-mix(in srgb, ${containerColor} 12%, transparent)`
                      : undefined,
                    color: containerColor ?? "var(--muted-foreground)",
                    fontFamily: "var(--font-mono)",
                  }}
                  title={containerLabel}
                >
                  {containerLabel}
                </span>
              )}
              {eq?.heightU != null && eq.heightU > 0 && (
                <span
                  className="rounded px-1.5 py-0.5 text-[7px] font-semibold"
                  style={{ background: "var(--border)", color: "var(--muted-foreground)" }}
                >
                  {eq.heightU}U
                </span>
              )}
              {eq?.powerW != null && eq.powerW > 0 && (
                <span
                  className="rounded px-1.5 py-0.5 text-[7px] font-semibold"
                  style={{ background: "var(--border)", color: "var(--muted-foreground)" }}
                >
                  {eq.powerW}W
                </span>
              )}
              {eq?.weight != null && eq.weight > 0 && (
                <span
                  className="rounded px-1.5 py-0.5 text-[7px] font-semibold"
                  style={{ background: "var(--border)", color: "var(--muted-foreground)" }}
                >
                  {eq.weight}kg
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Ports area */}
      <div className="relative" style={{ height: nodeH - NODE_HEADER_H }}>
        {panel ? (
          /* Panel : one line per connector, left dot — centered label — right dot */
          <div className="flex flex-col" style={{ paddingTop: 6 }}>
            {panelPairs.map(({ right: rp, left: lp }) => {
              const color = rp.ct?.color ?? "#71717a";
              const portNum = rp.entryIndex + 1;
              const ctLabel = rp.ct
                ? `${rp.ct.name}${rp.ct.version ? ` ${rp.ct.version}` : ""}`
                : "\u2014";
              const label = `${portNum} \u00b7 ${ctLabel} \u00b7 ${portNum}`;
              // Directions deduced from wired connections
              const rightDir = panelPortDirs.get(`${slot.id}:${rp.portIndex}`);
              const leftDir = lp ? panelPortDirs.get(`${slot.id}:${lp.portIndex}`) : undefined;
              const isActive = rightDir != null || leftDir != null;
              const lineColor = isActive ? color : "#d1d5db";

              // Direction arrow IN/OUT/BIDIR identical to PortRow
              const mkArrow = (dir: "IN" | "OUT" | "BIDIR" | undefined, side: "left" | "right") => {
                if (!dir) return null;
                if (dir === "BIDIR") {
                  return (
                    <svg
                      width="10"
                      height="8"
                      viewBox="0 0 12 10"
                      style={{
                        position: "absolute",
                        top: "50%",
                        transform: "translateY(-50%)",
                        [side === "left" ? "left" : "right"]: 10,
                        zIndex: 3,
                        pointerEvents: "none",
                      }}
                    >
                      <polygon points="6,0 0,5 6,10" fill="#ef4444" />
                      <polygon points="6,0 12,5 6,10" fill="#22c55e" />
                    </svg>
                  );
                }
                const isIn = dir === "IN";
                const pointsRight = (side === "left" && isIn) || (side === "right" && !isIn);
                return (
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 10 10"
                    style={{
                      position: "absolute",
                      top: "50%",
                      transform: "translateY(-50%)",
                      [side === "left" ? "left" : "right"]: 10,
                      zIndex: 3,
                      pointerEvents: "none",
                    }}
                  >
                    {pointsRight ? (
                      <polygon points="0,0 10,5 0,10" fill={isIn ? "#ef4444" : "#22c55e"} />
                    ) : (
                      <polygon points="10,0 0,5 10,10" fill={isIn ? "#ef4444" : "#22c55e"} />
                    )}
                  </svg>
                );
              };

              const mkDot = (p: Port, side: "left" | "right") => {
                const isOccupied = connectedPortIndices.has(p.portIndex);
                const isExternal = externalPortIndices?.has(p.portIndex) ?? false;
                const isSrc =
                  drawingFrom?.slotId === slot.id && drawingFrom?.portIndex === p.portIndex;
                const isCompat = !isSrc && !isOccupied && compatiblePortIndices.has(p.portIndex);
                return (
                  <PanelDot
                    key={`${p.portIndex}-${side}`}
                    p={p}
                    side={side}
                    color={color}
                    isOccupied={isOccupied}
                    isExternal={isExternal}
                    isSrc={isSrc}
                    isCompat={isCompat}
                    isSnap={
                      (snapTarget?.slotId === slot.id && snapTarget?.portIndex === p.portIndex) ||
                      selectedSrcIndices.has(p.portIndex) ||
                      multiSnapIndices.has(p.portIndex)
                    }
                    drawingActive={drawingFrom !== null}
                    incompatMsg={
                      !isSrc && !isCompat && drawingFrom !== null
                        ? incompatReason(drawingFromPort, p, slot.id, panelPortDirs, isOccupied, ipSignalNames)
                        : null
                    }
                    onRef={(el: HTMLElement) =>
                      onPortRef({ slotId: slot.id, portIndex: p.portIndex, side, el })
                    }
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      onPortClick(slot.id, p.portIndex);
                    }}
                    onIncompatHover={onIncompatHover}
                    cableToolActive={cableToolActive}
                  />
                );
              };
              return (
                <div
                  key={rp.portIndex}
                  className="group relative flex items-center justify-center"
                  style={{ height: PORT_H, width: nodeW }}
                >
                  {lp && mkDot(lp, "left")}
                  {lp && mkArrow(leftDir, "left")}
                  {/* Curved through-line — colored if signal active */}
                  <svg
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      width: "100%",
                      height: "100%",
                      pointerEvents: "none",
                    }}
                    preserveAspectRatio="none"
                    viewBox={`0 0 ${nodeW} ${PORT_H}`}
                  >
                    <path
                      d={`M 0 ${PORT_H / 2} L ${nodeW} ${PORT_H / 2}`}
                      fill="none"
                      stroke={lineColor}
                      strokeWidth={isActive ? 2 : 1.5}
                      strokeOpacity={isActive ? 0.7 : 1}
                    />
                  </svg>
                  <span
                    className="relative truncate px-1 text-[9px] font-medium"
                    style={{
                      color: isActive ? color : "#71717a",
                      maxWidth: nodeW - 24,
                      zIndex: 1,
                      backgroundColor: "var(--surface, white)",
                      borderRadius: 2,
                      lineHeight: "1.2",
                      padding: "0 4px",
                    }}
                  >
                    {label}
                  </span>
                  {mkArrow(rightDir, "right")}
                  {mkDot(rp, "right")}
                </div>
              );
            })}
          </div>
        ) : hasAnyGroup ? (
          /* Equipment with grouping (vue Générale) : mini-header centré par
             groupe, puis ports left/right alignés en bandes verticales. */
          <div className="flex flex-col" style={{ paddingTop: 6 }}>
            {alignedSegments.map((seg, segIdx) => {
              const renderPort = (
                p: Port,
                side: "left" | "right",
                i: number,
                list: Port[],
              ) => {
                const isConn = connectedPortIndices.has(p.portIndex);
                const isExt = externalPortIndices?.has(p.portIndex) ?? false;
                const isSrc =
                  (drawingFrom?.slotId === slot.id && drawingFrom?.portIndex === p.portIndex) ||
                  (multiSrcConfirmed && selectedSrcIndices.has(p.portIndex) && !isConn);
                const isCompat = !isSrc && !isConn && compatiblePortIndices.has(p.portIndex);
                const isMultiEligible =
                  !multiSrcConfirmed && !isSrc && !isConn && selectedSrcIndices.has(p.portIndex);
                // Mini-séparateur intra-segment : même critère/style que la
                // branche non-groupée (transition d'entrée = entryIndex change).
                // Overlay absolute (bottom:0) → aucune hauteur consommée, donc
                // aucun impact sur getPortCenter. Pas de séparateur sur le
                // dernier port du segment (le gros divider inter-segments prend
                // le relais).
                const next = list[i + 1];
                const groupEnd = !!next && next.entryIndex !== p.entryIndex;
                return (
                  <div
                    key={`${side === "left" ? "L" : "R"}-${p.portIndex}`}
                    style={{ position: "relative" }}
                  >
                    {groupEnd && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: "50%",
                          transform: "translateX(-50%)",
                          width: 100,
                          height: 1,
                          background:
                            "linear-gradient(to right, transparent 0%, color-mix(in srgb, var(--foreground) 30%, transparent) 50%, transparent 100%)",
                          pointerEvents: "none",
                          zIndex: 1,
                        }}
                      />
                    )}
                    <PortRow
                      port={p}
                      side={side}
                      slotId={slot.id}
                      sideIndex={i}
                      isDrawingTarget={false}
                      isSnapTarget={
                        (snapTarget?.slotId === slot.id && snapTarget?.portIndex === p.portIndex) ||
                        multiSnapIndices.has(p.portIndex)
                      }
                      isConnected={isConn}
                      isExternal={isExt}
                      isSource={isSrc}
                      isCompatible={isCompat}
                      isMultiEligible={isMultiEligible}
                      drawingActive={drawingFrom !== null}
                      incompatMsg={
                        !isSrc && !isCompat && !isMultiEligible && drawingFrom !== null
                          ? incompatReason(drawingFromPort, p, slot.id, panelPortDirs, isConn, ipSignalNames)
                          : null
                      }
                      isPanelSlot={!!slot.panel}
                      deducedDir={panelPortDirs.get(`${slot.id}:${p.portIndex}`)}
                      onClick={() => onPortClick(slot.id, p.portIndex)}
                      onRef={(el) =>
                        onPortRef({ slotId: slot.id, portIndex: p.portIndex, side, el })
                      }
                      onIncompatHover={onIncompatHover}
                      cableToolActive={cableToolActive}
                    />
                  </div>
                );
              };

              return (
                <div key={`seg-${segIdx}`} style={{ position: "relative", width: nodeW }}>
                  {seg.label && (
                    <div
                      className="flex justify-center px-2"
                      style={{
                        height: HEADER_ROW_H,
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        fontSize: 9,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--muted-foreground)",
                        opacity: 0.75,
                        alignItems: "center",
                        textAlign: "center",
                        lineHeight: 1,
                      }}
                    >
                      <span
                        style={{
                          maxWidth: nodeW - 16,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={seg.label}
                      >
                        {seg.label}
                      </span>
                    </div>
                  )}
                  <div style={{ position: "relative", height: seg.rowsH, width: nodeW }}>
                    {/* Left column */}
                    <div className="absolute top-0 left-0 flex flex-col">
                      {seg.leftPorts.map((p, i) => renderPort(p, "left", i, seg.leftPorts))}
                    </div>
                    {/* Right column */}
                    <div className="absolute top-0 right-0 flex flex-col">
                      {seg.rightPorts.map((p, i) => renderPort(p, "right", i, seg.rightPorts))}
                    </div>
                  </div>
                  {/* Divider between groups (not after last) */}
                  {segIdx < alignedSegments.length - 1 && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: 1,
                        background:
                          "linear-gradient(to right, transparent 0%, color-mix(in srgb, var(--foreground) 22%, transparent) 50%, transparent 100%)",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {/* Left ports (IN) — dot anchored at left edge */}
            <div className="absolute top-0 left-0 flex flex-col" style={{ paddingTop: 6 }}>
              {leftPorts.map((p, i) => {
                const isConn = connectedPortIndices.has(p.portIndex);
                const isExt = externalPortIndices?.has(p.portIndex) ?? false;
                const isSrc =
                  (drawingFrom?.slotId === slot.id && drawingFrom?.portIndex === p.portIndex) ||
                  (multiSrcConfirmed && selectedSrcIndices.has(p.portIndex) && !isConn);
                const isCompat = !isSrc && !isConn && compatiblePortIndices.has(p.portIndex);
                const isMultiEligible =
                  !multiSrcConfirmed && !isSrc && !isConn && selectedSrcIndices.has(p.portIndex);
                const extraBottom = portExtras?.get(p.portIndex) ?? 0;
                const next = leftPorts[i + 1];
                const groupEnd = !!next && next.entryIndex !== p.entryIndex;
                return (
                  <div
                    key={`L-${p.portIndex}`}
                    style={{
                      position: "relative",
                      ...(extraBottom ? { marginBottom: extraBottom } : {}),
                    }}
                  >
                    {groupEnd && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: "50%",
                          transform: "translateX(-50%)",
                          width: 100,
                          height: 1,
                          background:
                            "linear-gradient(to right, transparent 0%, color-mix(in srgb, var(--foreground) 30%, transparent) 50%, transparent 100%)",
                          pointerEvents: "none",
                        }}
                      />
                    )}
                    <PortRow
                      port={p}
                      side="left"
                      slotId={slot.id}
                      sideIndex={i}
                      isDrawingTarget={false}
                      isSnapTarget={
                        (snapTarget?.slotId === slot.id && snapTarget?.portIndex === p.portIndex) ||
                        multiSnapIndices.has(p.portIndex)
                      }
                      isConnected={isConn}
                      isExternal={isExt}
                      isSource={isSrc}
                      isCompatible={isCompat}
                      isMultiEligible={isMultiEligible}
                      drawingActive={drawingFrom !== null}
                      incompatMsg={
                        !isSrc && !isCompat && !isMultiEligible && drawingFrom !== null
                          ? incompatReason(drawingFromPort, p, slot.id, panelPortDirs, isConn, ipSignalNames)
                          : null
                      }
                      isPanelSlot={!!slot.panel}
                      deducedDir={panelPortDirs.get(`${slot.id}:${p.portIndex}`)}
                      onClick={() => onPortClick(slot.id, p.portIndex)}
                      onRef={(el) =>
                        onPortRef({ slotId: slot.id, portIndex: p.portIndex, side: "left", el })
                      }
                      onIncompatHover={onIncompatHover}
                      cableToolActive={cableToolActive}
                    />
                  </div>
                );
              })}
            </div>
            {/* Right ports (OUT / BIDIR) — dot anchored at right edge */}
            <div className="absolute top-0 right-0 flex flex-col" style={{ paddingTop: 6 }}>
              {rightPorts.map((p, i) => {
                const isConn = connectedPortIndices.has(p.portIndex);
                const isExt = externalPortIndices?.has(p.portIndex) ?? false;
                const isSrc =
                  (drawingFrom?.slotId === slot.id && drawingFrom?.portIndex === p.portIndex) ||
                  (multiSrcConfirmed && selectedSrcIndices.has(p.portIndex) && !isConn);
                const isCompat = !isSrc && !isConn && compatiblePortIndices.has(p.portIndex);
                const isMultiEligible =
                  !multiSrcConfirmed && !isSrc && !isConn && selectedSrcIndices.has(p.portIndex);
                const extraBottom = portExtras?.get(p.portIndex) ?? 0;
                const next = rightPorts[i + 1];
                const groupEnd = !!next && next.entryIndex !== p.entryIndex;
                return (
                  <div
                    key={`R-${p.portIndex}`}
                    style={{
                      position: "relative",
                      ...(extraBottom ? { marginBottom: extraBottom } : {}),
                    }}
                  >
                    {groupEnd && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: "50%",
                          transform: "translateX(-50%)",
                          width: 100,
                          height: 1,
                          background:
                            "linear-gradient(to right, transparent 0%, color-mix(in srgb, var(--foreground) 30%, transparent) 50%, transparent 100%)",
                          pointerEvents: "none",
                        }}
                      />
                    )}
                    <PortRow
                      port={p}
                      side="right"
                      slotId={slot.id}
                      sideIndex={i}
                      isDrawingTarget={false}
                      isSnapTarget={
                        (snapTarget?.slotId === slot.id && snapTarget?.portIndex === p.portIndex) ||
                        multiSnapIndices.has(p.portIndex)
                      }
                      isConnected={isConn}
                      isExternal={isExt}
                      isSource={isSrc}
                      isCompatible={isCompat}
                      isMultiEligible={isMultiEligible}
                      drawingActive={drawingFrom !== null}
                      incompatMsg={
                        !isSrc && !isCompat && !isMultiEligible && drawingFrom !== null
                          ? incompatReason(drawingFromPort, p, slot.id, panelPortDirs, isConn, ipSignalNames)
                          : null
                      }
                      isPanelSlot={!!slot.panel}
                      deducedDir={panelPortDirs.get(`${slot.id}:${p.portIndex}`)}
                      onClick={() => onPortClick(slot.id, p.portIndex)}
                      onRef={(el) =>
                        onPortRef({ slotId: slot.id, portIndex: p.portIndex, side: "right", el })
                      }
                      onIncompatHover={onIncompatHover}
                      cableToolActive={cableToolActive}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
