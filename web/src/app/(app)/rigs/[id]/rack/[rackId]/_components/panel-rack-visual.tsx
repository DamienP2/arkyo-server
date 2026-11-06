"use client";

import React from "react";
import { ConnectorIcon } from "@/components/ui/connector-icon";
import type { PanelItem, PanelSlotData } from "@/components/synoptique/lib/types";

// Mini visuel fidèle à l'éditeur de panel, rendu à l'intérieur d'un slot de
// rack (vue "réelle"). Utilisé par `DraggableSlot` quand le slot contient un
// panel de patch.

// La pose Neutrik D est un choix par slot (`mountD`), exposé par le backend et
// transporté dans les canvas-data. `PanelSlotData` ne le porte pas encore : on
// l'adapte localement (optionnel → dégrade en générique s'il manque).
type PanelSlotVisual = PanelSlotData & { mountD?: boolean };

export function PanelRackVisual({
  panel,
  slotMap,
}: {
  panel: PanelItem;
  slotMap: Record<number, PanelSlotVisual>;
}) {
  // Chaque U occupe U_HEIGHT_PX px. On réserve :
  //   - 30% pour numéros + labels (15% chacun)
  //   - 70% pour le cercle/slot
  // Slot size = min(70% de U_HEIGHT_PX, largeur d'une colonne)
  // On calcule en % pour rester purement CSS-driven.
  const iconSize = panel.slotsPerU <= 8 ? 18 : panel.slotsPerU <= 16 ? 12 : 8;

  const MountHole = () => (
    <div
      style={{
        width: 5,
        height: 5,
        borderRadius: "50%",
        border: "1.5px solid rgba(0,0,0,0.35)",
        background: "transparent",
        flexShrink: 0,
      }}
    />
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        border: "1.5px solid #aaa",
        overflow: "hidden",
        background: "transparent",
      }}
    >
      {/* Oreille gauche */}
      <div
        style={{
          width: "6%",
          minWidth: 8,
          flexShrink: 0,
          borderRight: "1px solid #bbb",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 0",
        }}
      >
        <MountHole />
        <MountHole />
      </div>

      {/* Zone connecteurs */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {Array.from({ length: panel.heightU }, (_, rowIdx) => (
          <div
            key={rowIdx}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "1px 3px",
              minHeight: 0,
            }}
          >
            {/* Numéros */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${panel.slotsPerU}, 1fr)`,
                lineHeight: 1,
              }}
            >
              {Array.from({ length: panel.slotsPerU }, (_, colIdx) => (
                <div
                  key={colIdx}
                  style={{
                    textAlign: "center",
                    fontSize: 5,
                    color: "rgba(0,0,0,0.35)",
                    fontFamily: "monospace",
                  }}
                >
                  {colIdx + 1}
                </div>
              ))}
            </div>
            {/* Slots — flex grow pour occuper l'espace central */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${panel.slotsPerU}, 1fr)`,
                alignItems: "center",
                justifyItems: "center",
                flex: 1,
                minHeight: 0,
              }}
            >
              {Array.from({ length: panel.slotsPerU }, (_, colIdx) => {
                const pos = rowIdx * panel.slotsPerU + colIdx + 1;
                const slot = slotMap[pos];
                const ct = slot?.connectorType ?? null;
                // Pose Neutrik D par slot — dégrade en générique si `mountD` absent.
                const isNeutrik = slot?.mountD === true;
                const color = "rgba(0,0,0,0.55)";
                return (
                  <div
                    key={colIdx}
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div
                      style={{
                        height: "75%",
                        aspectRatio: "1 / 1",
                        borderRadius: ct && isNeutrik ? "18%" : "50%",
                        border: `1px solid ${ct ? color : "rgba(0,0,0,0.22)"}`,
                        borderStyle: ct ? "solid" : "dashed",
                        background: "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        flexShrink: 0,
                      }}
                    >
                      {ct ? (
                        <>
                          {isNeutrik && (
                            <>
                              <div
                                style={{
                                  position: "absolute",
                                  top: 1,
                                  left: 1,
                                  width: 2,
                                  height: 2,
                                  borderRadius: "50%",
                                  border: `1px solid ${color}`,
                                }}
                              />
                              <div
                                style={{
                                  position: "absolute",
                                  bottom: 1,
                                  right: 1,
                                  width: 2,
                                  height: 2,
                                  borderRadius: "50%",
                                  border: `1px solid ${color}`,
                                }}
                              />
                            </>
                          )}
                          <ConnectorIcon iconId={ct.iconId} color={color} size={iconSize} />
                        </>
                      ) : panel.slotsPerU <= 16 ? (
                        <svg
                          viewBox="0 0 14 28"
                          style={{ width: "auto", height: "100%", flexShrink: 0 }}
                        >
                          <rect
                            x="0.75"
                            y="0.75"
                            width="12.5"
                            height="26.5"
                            rx="4"
                            ry="4"
                            stroke="rgba(0,0,0,0.45)"
                            strokeWidth="1.5"
                            fill="rgba(0,0,0,0.06)"
                          />
                          <rect
                            x="2.5"
                            y="3"
                            width="9"
                            height="20"
                            rx="2.5"
                            ry="2.5"
                            stroke="rgba(0,0,0,0.3)"
                            strokeWidth="1"
                            fill="rgba(0,0,0,0.04)"
                          />
                        </svg>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Oreille droite */}
      <div
        style={{
          width: "6%",
          minWidth: 8,
          flexShrink: 0,
          borderLeft: "1px solid #bbb",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 0",
        }}
      >
        <MountHole />
        <MountHole />
      </div>
    </div>
  );
}
