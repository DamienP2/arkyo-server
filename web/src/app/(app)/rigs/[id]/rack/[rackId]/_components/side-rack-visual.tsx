"use client";

import React, { useContext } from "react";
import { AlertTriangle } from "@/components/ui/icons";

import { U_HEIGHT_PX, RACK_DEPTH_DEFAULT, SIDE_PANEL_W } from "@/components/synoptique/lib/constants";
import { CategoryColorCtx, DEFAULT_HEX, SPECIAL_HEX } from "@/components/synoptique/lib/colors";
import type { Rack, Slot } from "@/components/synoptique/lib/types";

/** Slot physiquement placé dans la baie (startU et heightU non-null). */
type PlacedSlot = Slot & { startU: number; heightU: number };

/**
 * Vue de côté (profil) du rack — montre la profondeur occupée par chaque slot
 * sur les faces FRONT, REAR et REAR_INTERIOR, ainsi que les zones de collision
 * avant/arrière et les zones de sécurité câble (hachures).
 */
export function SideRackVisual({
  rack,
  slots,
  innerW,
  patchPanelDepthMm = 5,
  cableSafetyDepthMm = 150,
}: {
  rack: Rack;
  slots: Slot[];
  innerW: number;
  patchPanelDepthMm?: number;
  cableSafetyDepthMm?: number;
}) {
  const catColorMap = useContext(CategoryColorCtx);
  const resolveHex = (category?: string | null) => {
    if (!category) return DEFAULT_HEX;
    if (SPECIAL_HEX[category]) return SPECIAL_HEX[category];
    return catColorMap[category] ?? DEFAULT_HEX;
  };
  // Exclure les slots fantômes (startU=null) — non encore placés physiquement
  const frontSlots = slots.filter((s): s is PlacedSlot => s.view === "FRONT" && !s.parentSlotId && s.startU != null);
  const rearSlots = slots.filter((s): s is PlacedSlot => s.view === "REAR" && !s.parentSlotId && s.startU != null);
  const rearIntSlots = slots.filter((s): s is PlacedSlot => s.view === "REAR_INTERIOR" && !s.parentSlotId && s.startU != null);
  const rackDepth = rack.depthMm || RACK_DEPTH_DEFAULT;
  const rearInteriorGap = rack.rearInteriorGapMm ?? 50;
  const rearIntOffsetPx = Math.min((rearInteriorGap / rackDepth) * innerW, innerW);
  const uRows = Array.from({ length: rack.totalU }, (_, i) => rack.totalU - i);

  const PANEL_W = SIDE_PANEL_W;
  const INNER_W = innerW;
  const TOTAL_W = SIDE_PANEL_W * 2 + innerW;

  return (
    <div className="flex gap-2 select-none">
      {/* Corps côté */}
      <div
        className="relative shrink-0 overflow-visible rounded-lg"
        style={{ height: rack.totalU * U_HEIGHT_PX, width: TOTAL_W }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: "transparent",
            border: "2px solid var(--border)",
            // overflow-visible : autorise les zones de débordement
            // sécurité câbles (jaune hachuré) à dépasser la paroi du rack
            // pour visualiser proportionnellement le dépassement réel.
          }}
        >
          {/* Zone interne */}
          <div className="absolute inset-0">
            {/* Panneaux côtés gauche/droite */}
            <div
              className="pointer-events-none absolute top-0 bottom-0"
              style={{
                left: 0,
                width: PANEL_W,
                background: "color-mix(in srgb, var(--foreground) 10%, var(--background))",
                borderRight:
                  "1px solid color-mix(in srgb, var(--foreground) 20%, var(--background))",
              }}
            />
            <div
              className="pointer-events-none absolute top-0 bottom-0"
              style={{
                right: 0,
                width: PANEL_W,
                background: "color-mix(in srgb, var(--foreground) 10%, var(--background))",
                borderLeft:
                  "1px solid color-mix(in srgb, var(--foreground) 20%, var(--background))",
              }}
            />

            {/* Ligne de mi-profondeur (pointillés) */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-30"
              style={{
                left: PANEL_W + Math.round(INNER_W / 2),
                width: 0,
                borderLeft:
                  "1px dashed color-mix(in srgb, var(--foreground) 15%, var(--background))",
              }}
            >
              <span
                className="absolute top-1 left-1 text-[7px] leading-none font-semibold whitespace-nowrap"
                style={{ color: "color-mix(in srgb, var(--foreground) 35%, var(--background))" }}
              >
                {Math.round(rackDepth / 2)}mm
              </span>
            </div>

            {uRows.map((_, idx) => (
              <div
                key={`sep-${idx}`}
                className="pointer-events-none absolute"
                style={{
                  top: idx * U_HEIGHT_PX,
                  left: PANEL_W,
                  right: PANEL_W,
                  height: 1,
                  background: "color-mix(in srgb, var(--foreground) 15%, var(--background))",
                }}
              />
            ))}

            {/* Équipements face AVANT */}
            {frontSlots.map((slot) => {
              const isPanel = !!slot.panel;
              const accessoryMeta = (() => {
                try {
                  return JSON.parse(slot.notes ?? "{}") as {
                    accessoryType?: string;
                    depthMm?: number;
                  };
                } catch {
                  return {};
                }
              })();
              const isPlaque =
                !isPanel && !slot.equipment && accessoryMeta.accessoryType === "plaque";
              const isAccessory = !isPanel && !slot.equipment && !!accessoryMeta.accessoryType;
              const eqDepth =
                (slot.equipment as { depthMm?: number | null } | null)?.depthMm ?? null;
              const topIdx = rack.totalU - slot.startU - (slot.heightU || 1) + 1;
              const safeRackDepth = rackDepth > 0 ? rackDepth : 600;
              // Depth: panel/plaque → patchPanelDepthMm (corps fin); accessory → from notes; equipment → depthMm; unknown → 45%
              const bodyMm =
                isPanel || isPlaque
                  ? patchPanelDepthMm
                  : isAccessory && accessoryMeta.depthMm
                    ? accessoryMeta.depthMm
                    : (eqDepth ?? null);
              const depthPx =
                bodyMm != null
                  ? Math.min((bodyMm / safeRackDepth) * INNER_W, INNER_W)
                  : INNER_W * 0.45;
              const overflows =
                !isPanel && !isAccessory && eqDepth != null && eqDepth > safeRackDepth;
              const slotCategory = isPanel
                ? "Panels de patch"
                : isAccessory
                  ? "Accessoire rack"
                  : slot.equipment?.category;
              const slotHex = resolveHex(slotCategory);
              const slotName = slot.panel?.name ?? slot.equipment?.name ?? "—";
              const slotH = (slot.heightU || 1) * U_HEIGHT_PX - 2;

              // Cable safety zone:
              // - Panels: hatched zone = rearCableDepthMm (specific to this panel, shown behind thin body)
              // - Equipment: hatched zone = override rearCableDepthMm de l'équipement,
              //   sinon global cableSafetyDepthMm, only if has rear connectors
              const panelCableDepthMm = isPanel ? (slot.panel?.rearCableDepthMm ?? 80) : 0;
              const equipCableMm = slot.equipment?.rearCableDepthMm ?? cableSafetyDepthMm;
              const hasRearConnector =
                !isPanel &&
                Array.isArray(slot.equipment?.connectors) &&
                (slot.equipment.connectors as { face?: string }[]).some((c) => c.face === "REAR");
              const hasCableSafety = isPanel || hasRearConnector;
              const cableZoneMm = isPanel ? panelCableDepthMm : equipCableMm;
              // Largeur naturelle de la zone sécurité câbles.
              const cableSafetyFullPx = hasCableSafety
                ? (cableZoneMm / safeRackDepth) * INNER_W
                : 0;
              // Espace dispo après l'équipement, dans la limite du rack.
              const availInsideRack = Math.max(0, INNER_W - depthPx);
              // Bleu : portion sécurité câbles qui RESTE dans le rack.
              const cableBluePx = Math.min(cableSafetyFullPx, availInsideRack);
              // Calcul du dépassement basé sur les mm RÉELS (et non sur les
              // px clampés) — fonctionne aussi pour les accessoires (tiroir,
              // étagère…) dont `bodyMm` peut excéder `rackDepth` sans qu'il
              // y ait de sécurité câbles à ajouter.
              const overflowMm = Math.max(
                0,
                (bodyMm ?? 0) +
                  (hasCableSafety ? cableZoneMm : 0) -
                  safeRackDepth,
              );
              const overflowPx =
                overflowMm > 0 ? overflowMm * (INNER_W / safeRackDepth) : 0;

              const wallThickPx = 2;
              const isUShape = isAccessory && accessoryMeta.accessoryType === "etagere";
              return (
                <React.Fragment key={slot.id}>
                  {isUShape ? (
                    /* ── Vue côté — Étagère/Tiroir : plancher seul (vu de côté = trait horizontal en bas) ── */
                    <div
                      className="absolute z-20"
                      style={{
                        top: topIdx * U_HEIGHT_PX + 1,
                        left: PANEL_W,
                        height: slotH,
                        width: depthPx,
                      }}
                    >
                      {/* Plancher (bas uniquement) */}
                      <div
                        className="absolute right-0 bottom-0 left-0"
                        style={{ height: wallThickPx, background: slotHex }}
                      />
                      {/* Label profondeur */}
                      {depthPx > 40 && (
                        <div className="absolute inset-x-0 bottom-2 flex justify-center">
                          <p
                            className="text-[8px] font-semibold"
                            style={{
                              color: "color-mix(in srgb, var(--foreground) 55%, var(--background))",
                            }}
                          >
                            {bodyMm}mm
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className="absolute z-20 flex flex-col justify-center overflow-hidden border-l-2"
                      style={{
                        top: topIdx * U_HEIGHT_PX + 1,
                        left: PANEL_W,
                        height: slotH,
                        width: depthPx,
                        background: overflows
                          ? "color-mix(in srgb, var(--destructive) 15%, var(--card))"
                          : "color-mix(in srgb, var(--foreground) 10%, var(--background))",
                        borderColor: overflows
                          ? "color-mix(in srgb, var(--destructive) 60%, white)"
                          : slotHex,
                      }}
                    >
                      <span
                        className="absolute top-0 bottom-0 left-0 w-1"
                        style={{
                          background: overflows
                            ? "color-mix(in srgb, var(--destructive) 60%, white)"
                            : slotHex,
                        }}
                      />
                      {depthPx > 30 && (
                        <div className="w-full min-w-0 text-center">
                          <p
                            className="truncate text-[8px] leading-tight font-semibold"
                            style={{
                              color: overflows
                                ? "var(--destructive)"
                                : "color-mix(in srgb, var(--foreground) 55%, var(--background))",
                            }}
                          >
                            {bodyMm != null ? `${bodyMm}mm` : "—"}
                            {overflows && " ⚠"}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Sécurité câbles — hachures BLEUES, uniquement dans la
                      partie qui rentre dans le rack (cableBluePx). La portion
                      qui dépasse est rendue en jaune ci-dessous (pas de
                      hachures bleues qui chevauchent → pas de mélange vert). */}
                  {cableBluePx > 0 && (
                    <div
                      className="absolute z-10"
                      style={{
                        top: topIdx * U_HEIGHT_PX + 1,
                        left: PANEL_W + depthPx,
                        height: slotH,
                        width: cableBluePx,
                        background:
                          "repeating-linear-gradient(45deg, rgba(96,165,250,0.12), rgba(96,165,250,0.12) 4px, rgba(96,165,250,0.28) 4px, rgba(96,165,250,0.28) 8px)",
                      }}
                      title={
                        isPanel
                          ? `Câbles arrière : ${panelCableDepthMm} mm`
                          : `Sécurité câbles : ${equipCableMm} mm`
                      }
                    />
                  )}
                  {/* Zone JAUNE de dépassement — démarre à la paroi arrière
                      du rack et s'étend hors du contenant (overflow-visible).
                      Couvre tout ce qui sort, équipement ou sécurité câbles. */}
                  {overflowPx > 0 && (
                    <div
                      className="absolute z-20"
                      style={{
                        top: topIdx * U_HEIGHT_PX + 1,
                        left: PANEL_W + INNER_W,
                        height: slotH,
                        width: overflowPx,
                        background:
                          "repeating-linear-gradient(45deg, rgba(234,179,8,0.10), rgba(234,179,8,0.10) 4px, rgba(234,179,8,0.25) 4px, rgba(234,179,8,0.25) 8px)",
                      }}
                      title={`Dépassement : +${overflowMm} mm`}
                    />
                  )}
                  {/* Trait bleu À LA FIN de la sécurité câbles (longueur
                      naturelle complète) — marque la borne réelle de la zone
                      sécurité, même quand elle dépasse la paroi du rack. */}
                  {cableSafetyFullPx > 0 && (
                    <div
                      className="pointer-events-none absolute z-30"
                      style={{
                        top: topIdx * U_HEIGHT_PX + 1,
                        left: PANEL_W + depthPx + cableSafetyFullPx - 2,
                        width: 2,
                        height: slotH,
                        background: "rgba(96,165,250,0.9)",
                      }}
                    />
                  )}
                  {/* Label "XXXmm" centré sur TOUTE la zone sécurité (bleue +
                      jaune), englobant la portion qui dépasse. */}
                  {cableSafetyFullPx > 28 && (
                    <span
                      className="pointer-events-none absolute z-30 flex items-center justify-center text-[8px] font-bold text-blue-400/80"
                      style={{
                        top: topIdx * U_HEIGHT_PX + 1,
                        left: PANEL_W + depthPx,
                        height: slotH,
                        width: cableSafetyFullPx,
                      }}
                    >
                      {isPanel ? panelCableDepthMm : equipCableMm}mm
                    </span>
                  )}
                  {/* Petit badge avec triangle d'avertissement et valeur du
                      dépassement, posé après la zone jaune. */}
                  {overflowPx > 0 && (
                    <div
                      className="pointer-events-none absolute z-30 flex items-center gap-0.5 rounded-sm bg-yellow-100 px-1 text-[7px] font-medium leading-tight text-yellow-900 shadow-sm dark:bg-yellow-900/40 dark:text-yellow-200"
                      style={{
                        top: topIdx * U_HEIGHT_PX + slotH / 2 - 6,
                        left: PANEL_W + INNER_W + overflowPx + 3,
                      }}
                    >
                      <span aria-hidden>⚠</span>
                      <span>+{overflowMm}mm</span>
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* Équipements face ARRIÈRE (depuis le panneau arrière) */}
            {rearSlots.map((slot) => {
              const isPanel = !!slot.panel;
              const accMeta = (() => {
                try {
                  return JSON.parse(slot.notes ?? "{}") as {
                    accessoryType?: string;
                    depthMm?: number;
                  };
                } catch {
                  return {};
                }
              })();
              const isPlaque = !isPanel && !slot.equipment && accMeta.accessoryType === "plaque";
              const isAccessory = !isPanel && !slot.equipment && !!accMeta.accessoryType;
              const eqDepth =
                (slot.equipment as { depthMm?: number | null } | null)?.depthMm ?? null;
              const topIdx = rack.totalU - slot.startU - slot.heightU + 1;
              const bodyMm =
                isPanel || isPlaque
                  ? patchPanelDepthMm
                  : isAccessory && accMeta.depthMm
                    ? accMeta.depthMm
                    : (eqDepth ?? null);
              const depthPx =
                bodyMm != null ? Math.min((bodyMm / rackDepth) * INNER_W, INNER_W) : INNER_W * 0.3;
              const overflows = !isAccessory && eqDepth != null && eqDepth > rackDepth;
              const slotHex = resolveHex(
                isPanel
                  ? "Panels de patch"
                  : isAccessory
                    ? "Accessoire rack"
                    : slot.equipment?.category,
              );
              const name = slot.panel?.name ?? slot.equipment?.name ?? "—";
              const slotH = slot.heightU * U_HEIGHT_PX - 2;
              // Panels : zone hachurée = rearCableDepthMm du panel ; équipements : override rearCableDepthMm sinon global
              const panelCableDepthMm2 = isPanel ? (slot.panel?.rearCableDepthMm ?? 80) : 0;
              const equipCableMm2 = slot.equipment?.rearCableDepthMm ?? cableSafetyDepthMm;
              const hasCableSafety = isPanel || (!isAccessory && eqDepth != null);
              const cableZoneMm2 = isPanel ? panelCableDepthMm2 : equipCableMm2;
              const cableSafetyFullPx = hasCableSafety
                ? (cableZoneMm2 / rackDepth) * INNER_W
                : 0;
              const availInsideRack = Math.max(0, INNER_W - depthPx);
              const cableBluePx = Math.min(cableSafetyFullPx, availInsideRack);
              // Dépassement en mm réels (couvre tiroir/étagère/équipement).
              const overflowMm = Math.max(
                0,
                (bodyMm ?? 0) +
                  (hasCableSafety ? cableZoneMm2 : 0) -
                  rackDepth,
              );
              const overflowPx =
                overflowMm > 0 ? overflowMm * (INNER_W / rackDepth) : 0;
              return (
                <React.Fragment key={slot.id}>
                  <div
                    className="absolute z-20 flex flex-col items-end justify-center overflow-hidden border-r-2"
                    style={{
                      top: topIdx * U_HEIGHT_PX + 1,
                      right: PANEL_W,
                      height: slotH,
                      width: depthPx,
                      background: overflows
                        ? "color-mix(in srgb, var(--destructive) 15%, var(--card))"
                        : "color-mix(in srgb, var(--foreground) 10%, var(--background))",
                      borderColor: overflows
                        ? "color-mix(in srgb, var(--destructive) 60%, white)"
                        : slotHex,
                    }}
                    title={`${name}${bodyMm ? ` — ${bodyMm}mm` : " — prof. inconnue"}`}
                  >
                    <span
                      className="absolute top-0 right-0 bottom-0 w-1"
                      style={{
                        background: overflows
                          ? "color-mix(in srgb, var(--destructive) 60%, white)"
                          : slotHex,
                      }}
                    />
                    {depthPx > 30 && (
                      <div className="w-full min-w-0 text-center">
                        <p
                          className="truncate text-[8px] leading-tight font-semibold"
                          style={{
                            color: overflows
                              ? "var(--destructive)"
                              : "color-mix(in srgb, var(--foreground) 55%, var(--background))",
                          }}
                        >
                          {bodyMm ? `${bodyMm}mm` : "?"}
                          {overflows && " ⚠"}
                        </p>
                      </div>
                    )}
                  </div>
                  {/* Sécurité câbles — hachures bleues, partie qui rentre. */}
                  {cableBluePx > 0 && (
                    <div
                      className="absolute z-10"
                      style={{
                        top: topIdx * U_HEIGHT_PX + 1,
                        right: PANEL_W + depthPx,
                        height: slotH,
                        width: cableBluePx,
                        background:
                          "repeating-linear-gradient(45deg, rgba(96,165,250,0.12), rgba(96,165,250,0.12) 4px, rgba(96,165,250,0.28) 4px, rgba(96,165,250,0.28) 8px)",
                      }}
                      title={
                        isPanel
                          ? `Câbles arrière : ${panelCableDepthMm2} mm`
                          : `Sécurité câbles : ${equipCableMm2} mm`
                      }
                    />
                  )}
                  {/* Zone JAUNE de dépassement — slot REAR. */}
                  {overflowPx > 0 && (
                    <div
                      className="absolute z-20"
                      style={{
                        top: topIdx * U_HEIGHT_PX + 1,
                        right: PANEL_W + INNER_W,
                        height: slotH,
                        width: overflowPx,
                        background:
                          "repeating-linear-gradient(45deg, rgba(234,179,8,0.10), rgba(234,179,8,0.10) 4px, rgba(234,179,8,0.25) 4px, rgba(234,179,8,0.25) 8px)",
                      }}
                      title={`Dépassement : +${overflowMm} mm`}
                    />
                  )}
                  {/* Trait bleu à la fin de la sécurité câbles. */}
                  {cableSafetyFullPx > 0 && (
                    <div
                      className="pointer-events-none absolute z-30"
                      style={{
                        top: topIdx * U_HEIGHT_PX + 1,
                        right: PANEL_W + depthPx + cableSafetyFullPx - 2,
                        width: 2,
                        height: slotH,
                        background: "rgba(96,165,250,0.9)",
                      }}
                    />
                  )}
                  {/* Label centré sur TOUTE la zone sécurité (bleue + jaune). */}
                  {cableSafetyFullPx > 28 && (
                    <span
                      className="pointer-events-none absolute z-30 flex items-center justify-center text-[8px] font-bold text-blue-400/80"
                      style={{
                        top: topIdx * U_HEIGHT_PX + 1,
                        right: PANEL_W + depthPx,
                        height: slotH,
                        width: cableSafetyFullPx,
                      }}
                    >
                      {isPanel ? panelCableDepthMm2 : equipCableMm2}mm
                    </span>
                  )}
                  {overflowPx > 0 && (
                    <div
                      className="pointer-events-none absolute z-30 flex items-center gap-0.5 rounded-sm bg-yellow-100 px-1 text-[7px] font-medium leading-tight text-yellow-900 shadow-sm dark:bg-yellow-900/40 dark:text-yellow-200"
                      style={{
                        top: topIdx * U_HEIGHT_PX + slotH / 2 - 6,
                        right: PANEL_W + INNER_W + overflowPx + 3,
                      }}
                    >
                      <span aria-hidden>⚠</span>
                      <span>+{overflowMm}mm</span>
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* Équipements face ARRIÈRE INTÉRIEURE (décalées de rearInteriorGapMm depuis l'arrière) */}
            {rearIntSlots.map((slot) => {
              const isPanel = !!slot.panel;
              const accMeta = (() => {
                try {
                  return JSON.parse(slot.notes ?? "{}") as {
                    accessoryType?: string;
                    depthMm?: number;
                  };
                } catch {
                  return {};
                }
              })();
              const isPlaque = !isPanel && !slot.equipment && accMeta.accessoryType === "plaque";
              const isAccessory = !isPanel && !slot.equipment && !!accMeta.accessoryType;
              const eqDepth =
                (slot.equipment as { depthMm?: number | null } | null)?.depthMm ?? null;
              const topIdx = rack.totalU - slot.startU - slot.heightU + 1;
              const maxDepthPx = INNER_W - rearIntOffsetPx;
              const bodyMm =
                isPanel || isPlaque
                  ? patchPanelDepthMm
                  : isAccessory && accMeta.depthMm
                    ? accMeta.depthMm
                    : (eqDepth ?? null);
              const depthPx =
                bodyMm != null
                  ? Math.min((bodyMm / rackDepth) * INNER_W, maxDepthPx)
                  : maxDepthPx * 0.5;
              const overflows =
                !isAccessory && eqDepth != null && eqDepth > rackDepth - rearInteriorGap;
              const slotHex = resolveHex(
                isPanel
                  ? "Panels de patch"
                  : isAccessory
                    ? "Accessoire rack"
                    : slot.equipment?.category,
              );
              const name = slot.panel?.name ?? slot.equipment?.name ?? "—";
              const slotH = slot.heightU * U_HEIGHT_PX - 2;
              // Panels : zone hachurée = rearCableDepthMm du panel ; équipements : override rearCableDepthMm sinon global
              const panelCableDepthMm3 = isPanel ? (slot.panel?.rearCableDepthMm ?? 80) : 0;
              const equipCableMm3 = slot.equipment?.rearCableDepthMm ?? cableSafetyDepthMm;
              const hasCableSafety = isPanel || (!isAccessory && eqDepth != null);
              const cableZoneMm3 = isPanel ? panelCableDepthMm3 : equipCableMm3;
              const cableSafetyPx = hasCableSafety
                ? Math.max(0, Math.min((cableZoneMm3 / rackDepth) * INNER_W, maxDepthPx - depthPx))
                : 0;
              return (
                <React.Fragment key={slot.id}>
                  <div
                    className="absolute z-20 flex flex-col items-end justify-center overflow-hidden border-r-2"
                    style={{
                      top: topIdx * U_HEIGHT_PX + 1,
                      right: PANEL_W + rearIntOffsetPx,
                      height: slotH,
                      width: depthPx,
                      background: overflows
                        ? "color-mix(in srgb, var(--destructive) 15%, var(--card))"
                        : "color-mix(in srgb, var(--foreground) 10%, var(--background))",
                      borderColor: overflows
                        ? "color-mix(in srgb, var(--destructive) 60%, white)"
                        : slotHex,
                    }}
                    title={`${name}${bodyMm ? ` — ${bodyMm}mm` : " — prof. inconnue"}`}
                  >
                    <span
                      className="absolute top-0 right-0 bottom-0 w-1"
                      style={{
                        background: overflows
                          ? "color-mix(in srgb, var(--destructive) 60%, white)"
                          : slotHex,
                      }}
                    />
                    {depthPx > 30 && (
                      <div className="w-full min-w-0 text-center">
                        <p
                          className="truncate text-[8px] leading-tight font-semibold"
                          style={{
                            color: overflows
                              ? "var(--destructive)"
                              : "color-mix(in srgb, var(--foreground) 55%, var(--background))",
                          }}
                        >
                          {bodyMm ? `${bodyMm}mm` : "?"}
                          {overflows && " ⚠"}
                        </p>
                      </div>
                    )}
                  </div>
                  {cableSafetyPx > 0 && (
                    <div
                      className="absolute z-10"
                      style={{
                        top: topIdx * U_HEIGHT_PX + 1,
                        right: PANEL_W + rearIntOffsetPx + depthPx,
                        height: slotH,
                        width: cableSafetyPx,
                        borderLeft: "2px solid rgba(96,165,250,0.9)",
                        background:
                          "repeating-linear-gradient(45deg, rgba(96,165,250,0.12), rgba(96,165,250,0.12) 4px, rgba(96,165,250,0.28) 4px, rgba(96,165,250,0.28) 8px)",
                      }}
                      title={
                        isPanel
                          ? `Câbles arrière : ${panelCableDepthMm3} mm`
                          : `Sécurité câbles : ${equipCableMm3} mm`
                      }
                    >
                      {cableSafetyPx > 28 && (
                        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-blue-400/80">
                          {isPanel ? panelCableDepthMm3 : equipCableMm3}mm
                        </span>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Zones de collision (hachures) — inclut la distance de sécurité câbles */}
          {(() => {
            type Col = {
              key: string;
              x: number;
              w: number;
              topIdx: number;
              hPx: number;
              overlapMm: number;
              frontName: string;
              rearName: string;
            };
            const cols: Col[] = [];
            const allRear = [...rearSlots, ...rearIntSlots];

            // Helper: effective depth (body + cable safety) in px for a front slot
            const frontEffectivePx = (slot: (typeof frontSlots)[0]) => {
              const isPanel = !!slot.panel;
              const accMeta = (() => {
                try {
                  return JSON.parse(slot.notes ?? "{}") as {
                    accessoryType?: string;
                    depthMm?: number;
                  };
                } catch {
                  return {};
                }
              })();
              const isPlaque = !isPanel && !slot.equipment && accMeta.accessoryType === "plaque";
              const isAccessory = !isPanel && !slot.equipment && !!accMeta.accessoryType;
              const eqDepth =
                (slot.equipment as { depthMm?: number | null } | null)?.depthMm ?? null;
              const bodyMm =
                isPanel || isPlaque
                  ? patchPanelDepthMm
                  : isAccessory && accMeta.depthMm
                    ? accMeta.depthMm
                    : (eqDepth ?? rackDepth * 0.45);
              // Cable safety behind the slot
              const panelCableMm = isPanel ? (slot.panel?.rearCableDepthMm ?? 80) : 0;
              const hasRearConn =
                !isPanel &&
                Array.isArray(slot.equipment?.connectors) &&
                (slot.equipment!.connectors as { face?: string }[]).some((c) => c.face === "REAR");
              const cableMm = isPanel
                ? panelCableMm
                : hasRearConn
                  ? (slot.equipment?.rearCableDepthMm ?? cableSafetyDepthMm)
                  : 0;
              const totalMm = bodyMm + cableMm;
              return Math.min((totalMm / rackDepth) * INNER_W, INNER_W);
            };

            // Helper: effective depth in px for a rear slot (cable zone extends toward front)
            const rearEffectivePx = (slot: (typeof rearSlots)[0], maxPx: number) => {
              const isPanel = !!slot.panel;
              const accMeta = (() => {
                try {
                  return JSON.parse(slot.notes ?? "{}") as {
                    accessoryType?: string;
                    depthMm?: number;
                  };
                } catch {
                  return {};
                }
              })();
              const isPlaque = !isPanel && !slot.equipment && accMeta.accessoryType === "plaque";
              const isAccessory = !isPanel && !slot.equipment && !!accMeta.accessoryType;
              const eqDepth =
                (slot.equipment as { depthMm?: number | null } | null)?.depthMm ?? null;
              const bodyMm =
                isPanel || isPlaque
                  ? patchPanelDepthMm
                  : isAccessory && accMeta.depthMm
                    ? accMeta.depthMm
                    : (eqDepth ?? rackDepth * 0.3);
              const panelCableMm = isPanel ? (slot.panel?.rearCableDepthMm ?? 80) : 0;
              const hasRearConn =
                !isPanel &&
                Array.isArray(slot.equipment?.connectors) &&
                (slot.equipment!.connectors as { face?: string }[]).some((c) => c.face === "REAR");
              const cableMm = isPanel
                ? panelCableMm
                : hasRearConn
                  ? (slot.equipment?.rearCableDepthMm ?? cableSafetyDepthMm)
                  : 0;
              const totalMm = bodyMm + cableMm;
              return Math.min((totalMm / rackDepth) * INNER_W, maxPx);
            };

            for (const front of frontSlots) {
              const fPx = frontEffectivePx(front);
              for (const rear of allRear) {
                const isRI = rear.view === "REAR_INTERIOR";
                const rMaxPx = isRI ? INNER_W - rearIntOffsetPx : INNER_W;
                const rPx = rearEffectivePx(rear, rMaxPx);
                const rStartX = rMaxPx - rPx; // left edge of rear effective zone in inner coords
                // U overlap
                const uS = Math.max(front.startU, rear.startU);
                const uE = Math.min(front.startU + front.heightU, rear.startU + rear.heightU);
                if (uS >= uE) continue;
                // Depth overlap (including cable safety zones)
                if (fPx <= rStartX) continue;
                const colStartX = rStartX;
                const colEndX = Math.min(fPx, rMaxPx);
                const colW = colEndX - colStartX;
                if (colW <= 0) continue;
                const overlapMm = Math.round((colW / INNER_W) * rackDepth);
                const topIdx = rack.totalU - uE + 1;
                const hPx = (uE - uS) * U_HEIGHT_PX;
                cols.push({
                  key: `${front.id}-${rear.id}`,
                  x: PANEL_W + colStartX,
                  w: colW,
                  topIdx,
                  hPx,
                  overlapMm,
                  frontName: front.panel?.name ?? front.equipment?.name ?? "—",
                  rearName: rear.panel?.name ?? rear.equipment?.name ?? "—",
                });
              }
            }
            return cols.map(({ key, x, w, topIdx, hPx, overlapMm, frontName, rearName }) => (
              <div
                key={key}
                className="pointer-events-auto absolute z-30 flex items-center justify-center overflow-hidden"
                style={{
                  top: topIdx * U_HEIGHT_PX + 1,
                  left: x,
                  width: w,
                  height: hPx - 2,
                  background:
                    "repeating-linear-gradient(45deg, #fecaca, #fecaca 2px, #fee2e2 2px, #fee2e2 7px)",
                  border: "1.5px solid #ef4444",
                }}
                title={`Collision : ${frontName} ↔ ${rearName} — ${overlapMm}mm`}
              >
                {hPx > 18 && w > 14 && (
                  <div className="flex flex-col items-center gap-0.5 px-0.5">
                    <AlertTriangle
                      className="shrink-0 text-red-500"
                      style={{ width: Math.min(10, w - 4), height: Math.min(10, w - 4) }}
                    />
                    {w > 32 && hPx > 32 && (
                      <span
                        className="text-center font-mono leading-none font-semibold text-red-600"
                        style={{ fontSize: 7 }}
                      >
                        {overlapMm}mm
                      </span>
                    )}
                  </div>
                )}
              </div>
            ));
          })()}

          {/* Ligne médiane */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-zinc-200/70"
            style={{ left: PANEL_W + INNER_W / 2 }}
          />

          {/* Ligne arrière intérieure — uniquement si option activée */}
          {rack.rearInteriorGapMm != null && rearIntOffsetPx > 0 && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-zinc-400/50"
              style={{ left: PANEL_W + INNER_W - rearIntOffsetPx }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
