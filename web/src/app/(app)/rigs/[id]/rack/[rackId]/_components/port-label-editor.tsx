"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Tag, X } from "@/components/ui/icons";

import { cn } from "@/lib/utils";
import { ConnectorIcon } from "@/components/ui/connector-icon";

import { LABEL_COLORS } from "@/components/synoptique/lib/constants";
import {
  computeSegments as _computeSegments,
  getPortFromX,
  levelConstraint as _levelConstraint,
} from "@/components/synoptique/lib/panel-labels";
import type { LabelGroup, PanelSlotData, RowLevels, Slot } from "@/components/synoptique/lib/types";

/**
 * Éditeur d'étiquetage de ports pour un slot panel.
 *
 * Structure des labels :
 * - `rowLevels[rowIdx][0]` : groupes N1 (créés par drag, avec couleur)
 * - `rowLevels[rowIdx][1]` : labels N2 (un par port, sans couleur, stockés comme
 *   `LabelGroup` avec `start === end`)
 *
 * Les labels sont persistés dans `Slot.panelLabels` (Json natif Prisma) —
 * jamais de `JSON.parse/stringify` ici.
 */
export function PortLabelEditor({
  slot,
  onClose,
  onSave,
}: {
  slot: Slot;
  onClose: () => void;
  onSave: (
    slotId: string,
    instanceName: string,
    panelLevels: Record<number, RowLevels>,
    close?: boolean,
  ) => void;
}) {
  // Silence unused import warning — helper kept exported for reuse by callers.
  void _computeSegments;
  void _levelConstraint;

  const panel = slot.panel!;
  const portsPerRow = panel.slotsPerU;
  const totalRows = panel.heightU;
  const NUM_LEVELS = 2; // Always exactly 2 label rows

  const slotMap = useMemo(() => {
    const m: Record<number, PanelSlotData> = {};
    for (const ps of panel.slots) m[ps.position] = ps;
    return m;
  }, [panel.slots]);

  const instanceName = slot.label ?? "";
  // rowLevels loaded from dedicated panelLabels field
  const [rowLevels, setRowLevels] = useState<Record<number, RowLevels>>(() => {
    return slot.panelLabels &&
      typeof slot.panelLabels === "object" &&
      !Array.isArray(slot.panelLabels)
      ? (slot.panelLabels as Record<number, RowLevels>)
      : {};
  });
  const [activeRow, setActiveRow] = useState(0);
  // drag: rowIdx, level (0 or 1), start/end ports (1-based)
  const [drag, setDrag] = useState<{
    row: number;
    level: number;
    start: number;
    end: number;
  } | null>(null);
  const [colorPicking, setColorPicking] = useState<{
    row: number;
    level: number;
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const dragRef = useRef(drag);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  // Ref for each row's measurement element (full-width, for getPortFromX)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Auto-save debounced
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onSave(slot.id, instanceName, rowLevels, false), 700);
    return () => clearTimeout(saveTimer.current);
  }, [rowLevels, instanceName]); // eslint-disable-line react-hooks/exhaustive-deps

  const getRowLevels = (row: number): RowLevels => {
    const rl = rowLevels[row] ?? [];
    // Ensure always NUM_LEVELS arrays
    const result: RowLevels = [];
    for (let i = 0; i < NUM_LEVELS; i++) result.push(rl[i] ?? []);
    return result;
  };

  const updateGroup = (row: number, li: number, id: string, patch: Partial<LabelGroup>) =>
    setRowLevels((prev) => {
      const lvs = getRowLevels(row);
      lvs[li] = lvs[li].map((g) => (g.id === id ? { ...g, ...patch } : g));
      return { ...prev, [row]: lvs };
    });

  const removeGroup = (row: number, li: number, id: string) => {
    setRowLevels((prev) => {
      const lvs = getRowLevels(row);
      lvs[li] = lvs[li].filter((g) => g.id !== id);
      return { ...prev, [row]: lvs };
    });
    if (colorPicking?.row === row && colorPicking?.level === li && colorPicking?.id === id)
      setColorPicking(null);
  };

  const finalizeGroup = (d: NonNullable<typeof drag>) => {
    const start = Math.min(d.start, d.end);
    const end = Math.max(d.start, d.end);
    setRowLevels((prev) => {
      const lvs = getRowLevels(d.row);
      // Only N1 (level 0) allows group creation
      if (d.level !== 0) return prev;
      const current = lvs[0];
      const remaining = current.filter((g) => g.end < start || g.start > end);
      const usedColors = new Set(remaining.map((g) => g.color));
      const color =
        LABEL_COLORS.find((c) => !usedColors.has(c)) ??
        LABEL_COLORS[remaining.length % LABEL_COLORS.length];
      lvs[0] = [
        ...current.filter((g) => g.end < start || g.start > end),
        { id: Math.random().toString(36).slice(2, 9), start, end, text: "", color },
      ].sort((a, b) => a.start - b.start);
      return { ...prev, [d.row]: lvs };
    });
  };

  const handleModalMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const el = rowRefs.current[`${drag.row}-${drag.level}`];
    if (!el) return;
    const port = getPortFromX(el, e.clientX, portsPerRow);
    setDrag((prev) => (prev ? { ...prev, end: port } : null));
  };

  const handleModalMouseUp = () => {
    const d = dragRef.current;
    if (d) finalizeGroup(d);
    setDrag(null);
  };

  const LEVEL_H = 36;
  const PORT_H = 68;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onMouseMove={handleModalMouseMove}
      onMouseUp={handleModalMouseUp}
    >
      <div
        className="flex flex-col rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        style={{ width: "min(1200px, 96vw)", maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-4 border-b border-[var(--border)] px-6 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]">
            <Tag className="h-4 w-4 text-[var(--accent)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base leading-tight font-bold text-[var(--foreground)]">
              {panel.name}
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="font-mono text-[11px] text-[var(--muted-foreground)]">
                {instanceName || "—"}
              </span>
              <span className="text-[10px] text-[var(--muted-foreground)]">
                · {totalRows}U · {totalRows * portsPerRow} ports · {portsPerRow}/U
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab bar — one tab per U row */}
        {totalRows > 1 && (
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border)] px-6 pt-3 pb-0">
            {Array.from({ length: totalRows }, (_, i) => (
              <button
                key={i}
                onClick={() => setActiveRow(i)}
                className={cn(
                  "rounded-t-lg border-b-2 px-3 py-1.5 text-[11px] font-bold whitespace-nowrap transition-colors",
                  activeRow === i
                    ? "border-[var(--accent)] bg-[var(--accent)]/8 text-[var(--accent-strong)]" // arkyo-server: habillage Strata
                    : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                )}
              >
                U{i + 1}
              </button>
            ))}
          </div>
        )}

        {/* Body — single active row */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {Array.from({ length: totalRows }, (_, rowIdx) => {
            if (rowIdx !== activeRow) return null;
            const levels = getRowLevels(rowIdx);

            // Vertical separators at N1 group boundaries only
            const separatorCols = new Set<number>();
            for (const g of levels[0]) {
              if (g.end < portsPerRow) separatorCols.add(g.end);
            }

            return (
              <div key={rowIdx}>
                {/* Outer container: badge column + grid */}
                <div className="flex items-stretch gap-1.5">
                  {/* Badge column */}
                  <div className="flex shrink-0 flex-col justify-start" style={{ width: 20 }}>
                    {Array.from({ length: NUM_LEVELS }, (_, li) => (
                      <div
                        key={li}
                        className="flex items-center justify-end"
                        style={{ height: LEVEL_H }}
                      >
                        <span className="text-[8px] font-bold text-[var(--muted-foreground)]">
                          N{li + 1}
                        </span>
                      </div>
                    ))}
                    <div style={{ height: PORT_H }} />
                  </div>

                  {/* Main grid: NUM_LEVELS label rows + 1 port row */}
                  <div
                    className="relative flex-1 overflow-hidden rounded-lg border border-[var(--border)]"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${portsPerRow}, 1fr)`,
                      gridTemplateRows: `${Array.from({ length: NUM_LEVELS }, () => `${LEVEL_H}px`).join(" ")} ${PORT_H}px`,
                    }}
                  >
                    {/* Vertical separators at N1 group boundaries — prominent, spanning all rows */}
                    {Array.from(separatorCols).map((col) => (
                      <div
                        key={`sep-${col}`}
                        className="pointer-events-none absolute top-0 bottom-0 z-10"
                        style={{
                          left: `calc(${(col / portsPerRow) * 100}% - 1px)`,
                          width: 1,
                          background: "var(--foreground)",
                          opacity: 0.25,
                        }}
                      />
                    ))}

                    {/* ── N1 row — drag to create groups ── */}
                    {(() => {
                      const n1Groups = levels[0];
                      const refKey = `${rowIdx}-0`;
                      const isDragging = drag?.row === rowIdx && drag?.level === 0;
                      const dStart = drag ? Math.min(drag.start, drag.end) : 0;
                      const dEnd = drag ? Math.max(drag.start, drag.end) : 0;
                      return (
                        <React.Fragment>
                          {/* Full-width ref + drag preview */}
                          <div
                            ref={(el) => {
                              rowRefs.current[refKey] = el;
                            }}
                            style={{
                              gridColumn: `1 / ${portsPerRow + 1}`,
                              gridRow: 1,
                              position: "relative",
                              pointerEvents: "none",
                              zIndex: 20,
                            }}
                          >
                            {isDragging && dEnd > dStart && (
                              <div
                                className="absolute top-0 bottom-0 border-r border-l border-[var(--accent)]/50 bg-[var(--accent)]/15"
                                style={{
                                  left: `${((dStart - 1) / portsPerRow) * 100}%`,
                                  width: `${((dEnd - dStart + 1) / portsPerRow) * 100}%`,
                                }}
                              />
                            )}
                          </div>
                          {/* Drag capture zone */}
                          <div
                            style={{
                              gridColumn: `1 / ${portsPerRow + 1}`,
                              gridRow: 1,
                              cursor: "crosshair",
                              zIndex: 1,
                              borderBottom: "1px solid var(--border)",
                            }}
                            onMouseDown={(e) => {
                              if (e.button !== 0) return;
                              e.preventDefault();
                              const el = rowRefs.current[refKey];
                              if (!el) return;
                              const port = getPortFromX(el, e.clientX, portsPerRow);
                              setColorPicking(null);
                              setDrag({ row: rowIdx, level: 0, start: port, end: port });
                            }}
                          />
                          {/* N1 group cells */}
                          {n1Groups.map((g) => (
                            <div
                              key={g.id}
                              style={{
                                gridColumn: `${g.start} / ${g.end + 1}`,
                                gridRow: 1,
                                background: g.color + "22",
                                borderTop: `2px solid ${g.color}`,
                                position: "relative",
                                zIndex: 5,
                                overflow: "hidden",
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <div className="absolute inset-0 flex items-center gap-1 overflow-hidden px-1.5">
                                <button
                                  title="Changer la couleur du groupe"
                                  aria-label="Changer la couleur du groupe"
                                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20 transition-transform hover:scale-110"
                                  style={{ background: g.color }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const r = e.currentTarget.getBoundingClientRect();
                                    setColorPicking((cp) =>
                                      cp?.id === g.id
                                        ? null
                                        : {
                                            row: rowIdx,
                                            level: 0,
                                            id: g.id,
                                            x: r.left,
                                            y: r.bottom + 6,
                                          },
                                    );
                                  }}
                                />
                                <input
                                  value={g.text}
                                  onChange={(e) =>
                                    updateGroup(rowIdx, 0, g.id, {
                                      text: e.target.value.toUpperCase(),
                                    })
                                  }
                                  placeholder="LIBELLÉ…"
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  className="min-w-0 flex-1 truncate bg-transparent text-center text-[10px] font-bold tracking-wide uppercase placeholder:opacity-30 focus:outline-none"
                                  style={{ color: g.color }}
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeGroup(rowIdx, 0, g.id);
                                  }}
                                  title="Supprimer le libellé"
                                  aria-label="Supprimer le libellé"
                                  // arkyo-server: habillage Strata (icône de suppression au survol : --destructive)
                                  className="flex h-3 w-3 shrink-0 items-center justify-center text-[var(--muted-foreground)] opacity-50 transition-all hover:text-[var(--destructive)] hover:opacity-100"
                                >
                                  <X className="h-2 w-2" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </React.Fragment>
                      );
                    })()}

                    {/* ── N2 row — auto individual-port cells only inside N1 groups ── */}
                    {(() => {
                      const n1Groups = levels[0];
                      // Build per-port N2 labels from stored rowLevels[rowIdx][1] (array of {port, text})
                      // We store N2 as LabelGroup[] with start===end (1 port each), text = user label
                      const n2Data = levels[1]; // LabelGroup[] with individual ports
                      const n2Map: Record<number, LabelGroup> = {};
                      for (const g of n2Data) n2Map[g.start] = g;

                      return (
                        <React.Fragment>
                          {/* N2 background + bottom border — always white */}
                          <div
                            style={{
                              gridColumn: `1 / ${portsPerRow + 1}`,
                              gridRow: 2,
                              borderBottom: "1px solid var(--border)",
                              zIndex: 1,
                              background: "#ffffff",
                            }}
                          />
                          {/* Individual cells inside N1 groups */}
                          {n1Groups.flatMap((g) =>
                            Array.from({ length: g.end - g.start + 1 }, (_, i) => {
                              const port = g.start + i;
                              const entry = n2Map[port];
                              const updateN2 = (text: string) =>
                                setRowLevels((prev) => {
                                  const lvs = getRowLevels(rowIdx);
                                  const existing = lvs[1].filter((x) => x.start !== port);
                                  if (text)
                                    existing.push({
                                      id: entry?.id ?? Math.random().toString(36).slice(2, 9),
                                      start: port,
                                      end: port,
                                      text,
                                      color: "",
                                    });
                                  lvs[1] = existing.sort((a, b) => a.start - b.start);
                                  return { ...prev, [rowIdx]: lvs };
                                });
                              return (
                                <div
                                  key={port}
                                  style={{
                                    gridColumn: port,
                                    gridRow: 2,
                                    borderLeft:
                                      port > g.start
                                        ? "1px solid color-mix(in srgb, var(--border) 50%, transparent)"
                                        : undefined,
                                    position: "relative",
                                    zIndex: 5,
                                    background: "#ffffff",
                                  }}
                                  className="flex items-center justify-center"
                                >
                                  <input
                                    value={entry?.text ?? ""}
                                    onChange={(e) => updateN2(e.target.value.toUpperCase())}
                                    placeholder={String(port)}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="h-full w-full bg-transparent text-center text-[9px] font-bold tracking-wide text-[#111] uppercase placeholder:opacity-25 focus:outline-none"
                                    style={{ padding: "0 2px" }}
                                  />
                                </div>
                              );
                            }),
                          )}
                        </React.Fragment>
                      );
                    })()}

                    {/* Port cells — always last row */}
                    {Array.from({ length: portsPerRow }, (_, i) => {
                      const absPos = rowIdx * portsPerRow + i + 1;
                      const ct = slotMap[absPos]?.connectorType;
                      const ctLabel = ct ? [ct.name, ct.version].filter(Boolean).join(" ") : null;
                      return (
                        <div
                          key={i}
                          style={{
                            gridColumn: i + 1,
                            gridRow: NUM_LEVELS + 1,
                            borderLeft:
                              i > 0
                                ? "1px solid color-mix(in srgb, var(--border) 50%, transparent)"
                                : undefined,
                          }}
                          className="flex flex-col items-center justify-center gap-0.5 bg-[var(--background)]"
                        >
                          <span className="text-[11px] leading-none font-bold text-[var(--foreground)] tabular-nums">
                            {i + 1}
                          </span>
                          {ct?.iconId ? (
                            <ConnectorIcon iconId={ct.iconId} color={ct.color} size={22} />
                          ) : (
                            <div
                              className="h-5 w-5 rounded-full border border-[var(--border)]"
                              style={{ background: "var(--secondary)" }}
                            />
                          )}
                          {ctLabel && (
                            <span
                              className="w-full truncate px-0.5 text-center text-[7px] leading-none font-semibold tracking-wide uppercase"
                              style={{ color: ct?.color ?? "var(--muted-foreground)" }}
                            >
                              {ctLabel}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Color picker popover */}
      {colorPicking &&
        (() => {
          const levels = getRowLevels(colorPicking.row);
          const group = levels[colorPicking.level]?.find((g) => g.id === colorPicking.id);
          if (!group) return null;
          return (
            <div
              className="fixed z-[60] space-y-2.5 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 shadow-2xl"
              style={{ left: colorPicking.x, top: colorPicking.y, minWidth: 148 }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-5 gap-1.5">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    className={cn(
                      "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
                      group.color === c
                        ? "scale-110 border-[var(--foreground)]"
                        : "border-transparent",
                    )}
                    style={{ background: c }}
                    onClick={() =>
                      updateGroup(colorPicking.row, colorPicking.level, colorPicking.id, {
                        color: c,
                      })
                    }
                  />
                ))}
              </div>
              <input
                type="color"
                value={group.color}
                onChange={(e) =>
                  updateGroup(colorPicking.row, colorPicking.level, colorPicking.id, {
                    color: e.target.value,
                  })
                }
                className="h-7 w-full cursor-pointer rounded-lg border border-[var(--border)]"
              />
              <button
                onClick={() => setColorPicking(null)}
                className="w-full text-[10px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
              >
                Fermer
              </button>
            </div>
          );
        })()}
    </div>
  );
}
