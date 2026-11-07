"use client";

import { useState, useEffect, useMemo } from "react";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import type { RackConnection } from "@/components/synoptique/types/synoptic";
import { PORT_H } from "@/components/synoptique/types/synoptic";

type GetPortCenterFn = (
  slotId: string,
  portIndex: number,
) => { x: number; y: number; side: "left" | "right" } | null | undefined;

/**
 * Calcule les offsets de lane pour les câbles parallèles entre les mêmes nodes.
 *
 * @param resolvedConnections — connexions virtualisées
 * @param getPortCenterRef    — ref vers la fonction renvoyant les coords d'un port
 * @param cableSpreadOverride — si fourni, utilisé à la place du toggle topbar
 *                              (pour les canvases isolés du shell rack-editor)
 */
export function useCableLaneOffsets(
  resolvedConnections: RackConnection[],
  getPortCenterRef: React.RefObject<GetPortCenterFn | null>,
  cableSpreadOverride?: boolean,
): Map<string, number> {
  // Lit le store en interne (rack-editor) mais on peut passer un override pour
  // les canvases qui ne dépendent pas du shell (project canvas).
  const storeValue = useTopbarActions((s) => s.cableSpreadEnabled);
  const cableSpreadEnabled =
    cableSpreadOverride !== undefined ? cableSpreadOverride : storeValue;
  const [cablesHydrated, setCablesHydrated] = useState(false);
  useEffect(() => {
    setCablesHydrated(true);
  }, []);

  return useMemo(() => {
    if (!cablesHydrated || !cableSpreadEnabled) {
      const result = new Map<string, number>();
      for (const conn of resolvedConnections) result.set(conn.id, 0);
      return result;
    }
    const groups = new Map<string, typeof resolvedConnections>();
    for (const conn of resolvedConnections) {
      const a = conn.fromSlotId;
      const b = conn.toSlotId;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const arr = groups.get(key) ?? ([] as typeof resolvedConnections);
      arr.push(conn);
      groups.set(key, arr);
    }
    const result = new Map<string, number>();
    for (const [key, group] of groups) {
      if (group.length <= 1) {
        result.set(group[0].id, 0);
        continue;
      }
      const [aId] = key.split("|");
      const portYPair = (c: (typeof group)[number]) => {
        const pa = getPortCenterRef.current?.(
          c.fromSlotId === aId ? c.fromSlotId : c.toSlotId,
          c.fromSlotId === aId ? c.fromConnectorIndex : c.toConnectorIndex,
        );
        const pb = getPortCenterRef.current?.(
          c.fromSlotId === aId ? c.toSlotId : c.fromSlotId,
          c.fromSlotId === aId ? c.toConnectorIndex : c.fromConnectorIndex,
        );
        return { ya: pa?.y ?? 0, yb: pb?.y ?? 0 };
      };
      const sorted = [...group].sort((c1, c2) => {
        const p1 = portYPair(c1);
        const p2 = portYPair(c2);
        if (p1.ya !== p2.ya) return p1.ya - p2.ya;
        return p1.yb - p2.yb;
      });
      const avgA = sorted.reduce((s, c) => s + portYPair(c).ya, 0) / sorted.length;
      const avgB = sorted.reduce((s, c) => s + portYPair(c).yb, 0) / sorted.length;
      const reverse = avgB > avgA;
      const spacing = PORT_H;
      const center = (sorted.length - 1) / 2;
      sorted.forEach((conn, i) => {
        const idx = reverse ? sorted.length - 1 - i : i;
        result.set(conn.id, (idx - center) * spacing);
      });
    }
    return result;
  }, [resolvedConnections, cableSpreadEnabled, cablesHydrated, getPortCenterRef]);
}
