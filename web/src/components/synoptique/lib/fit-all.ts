/**
 * Calcul du fit-all : bounding box de la scène + zoom/pan pour tout englober.
 * Fonctions pures, aucune dépendance React.
 */

import { NODE_W, PANEL_NODE_W, PORT_H, NODE_HEADER_H, NODE_MIN_H } from "@/components/synoptique/types/synoptic";
import type { RackSlotWithEquipment, Zone, CanvasLabel, Port } from "@/components/synoptique/types/synoptic";
import {
  ADAPTER_W as ADAPTER_NODE_W,
  ADAPTER_TITLE_H as ADAPTER_NODE_TITLE_H,
  ADAPTER_PORT_PAD_TOP as ADAPTER_NODE_PAD_TOP,
  ADAPTER_PORT_H as ADAPTER_NODE_PORT_H,
  adapterNodeHeight,
} from "@/components/synoptique/components/synoptic-adapter-node";
import type { SynopticAdapterInstance } from "@/components/synoptique/components/synoptic-adapter-node";

export type SceneBounds = { minX: number; minY: number; maxX: number; maxY: number };
export type FitAllResult = { pan: { x: number; y: number }; zoom: number; bounds: SceneBounds };

type GetPortCenterFn = (
  slotId: string,
  portIndex: number,
) => { x: number; y: number; side: "left" | "right" } | null | undefined;

export function computeSceneBounds(
  expandedSlots: RackSlotWithEquipment[],
  positions: Map<string, { x: number; y: number }>,
  slotPorts: Map<string, Port[]>,
  zones: Zone[],
  canvasLabels: CanvasLabel[],
  adapters: SynopticAdapterInstance[],
  getPortCenter?: GetPortCenterFn | null,
): SceneBounds | null {
  if (
    expandedSlots.length === 0 &&
    zones.length === 0 &&
    canvasLabels.length === 0 &&
    adapters.length === 0
  )
    return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const expand = (x: number, y: number) => {
    if (!isFinite(x) || !isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const slot of expandedSlots) {
    const pos = positions.get(slot.id);
    if (!pos) continue;
    const ports = slotPorts.get(slot.id) ?? [];
    const leftCount = ports.filter((p) => p.side === "left").length;
    const rightCount = ports.filter((p) => p.side === "right").length;
    const nodeW = slot.panel ? PANEL_NODE_W : NODE_W;
    const h = Math.max(NODE_MIN_H, NODE_HEADER_H + Math.max(leftCount, rightCount) * PORT_H + 12);
    expand(pos.x, pos.y);
    expand(pos.x + nodeW, pos.y + h);
  }

  for (const ad of adapters) {
    let adX = ad.x,
      adY = ad.y;
    if (ad.attachedSlotId && ad.attachedPortIndex != null) {
      const anchorCenter = getPortCenter?.(ad.attachedSlotId, ad.attachedPortIndex);
      if (anchorCenter) {
        const FIRST_PORT_Y = ADAPTER_NODE_TITLE_H + ADAPTER_NODE_PAD_TOP + ADAPTER_NODE_PORT_H / 2;
        adX = ad.attachedSide === "right" ? anchorCenter.x : anchorCenter.x - ADAPTER_NODE_W;
        adY = anchorCenter.y - FIRST_PORT_Y;
      }
    }
    const adH = adapterNodeHeight(ad);
    expand(adX, adY);
    expand(adX + ADAPTER_NODE_W, adY + adH);
  }

  for (const zone of zones) {
    expand(zone.x, zone.y);
    expand(zone.x + zone.w, zone.y + zone.h);
  }

  for (const lbl of canvasLabels) {
    const approxW = lbl.text.length * lbl.fontSize * 0.6;
    expand(lbl.x, lbl.y - lbl.fontSize);
    expand(lbl.x + approxW, lbl.y);
  }

  if (!isFinite(minX) || !isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

export function computeFitAllViewport(
  bounds: SceneBounds,
  viewportW: number,
  viewportH: number,
  padding = 48,
  /**
   * Agrandissement maximal. 1 à l'écran : grossir un petit plan au-delà de sa
   * taille naturelle donne une impression de flou et déroute. Sur une feuille
   * d'export en revanche, la contrainte n'a pas lieu d'être — un plan doit
   * remplir sa zone de composition, quelle que soit sa taille d'origine.
   */
  maxZoom = 1,
): FitAllResult | null {
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  if (contentW <= 0 || contentH <= 0) return null;

  const safeW = Math.max(50, viewportW - padding * 2);
  const safeH = Math.max(50, viewportH - padding * 2);
  const zW = safeW / contentW;
  const zH = safeH / contentH;
  const z = Math.min(maxZoom, zW, zH);
  if (!isFinite(z) || z <= 0) return null;

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const newPan = { x: viewportW / 2 - cx * z, y: viewportH / 2 - cy * z };
  if (!isFinite(newPan.x) || !isFinite(newPan.y)) return null;

  return { pan: newPan, zoom: z, bounds };
}
