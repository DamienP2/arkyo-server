"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Slot } from "@/components/synoptique/lib/types";

/**
 * Synchronise la liste des slots d'un rack avec les événements SSE du serveur
 * (`/api/racks/:id/events`). Fusionne avec la valeur `initial` qui peut changer
 * après un `router.refresh()` déclenché par le SSE global.
 *
 * Garantit l'absence de doublons de clés React grâce à un dédup final.
 */
export function useRackSync(rackId: string, initial: Slot[]) {
  const [slots, setSlots] = useState<Slot[]>(initial);
  const [, setConnected] = useState(false);
  const knownIds = useRef<Set<string>>(
    new Set([
      ...initial.map((s) => s.id),
      ...initial.flatMap((s) => (s.children ?? []).map((c) => c.id)),
    ]),
  );

  // Sync quand une autre session modifie et router.refresh() est déclenché par SSE global
  useEffect(() => {
    setSlots((prev) => {
      // Merge: server state wins for existing slots, keep any optimistic-only additions
      // Preserve local children that might not yet be in server data
      const prevMap = new Map(prev.map((s) => [s.id, s]));
      const serverMap = new Map(initial.map((s) => [s.id, s]));
      const merged = [
        ...initial.map((s) => {
          const local = prevMap.get(s.id);
          // Merge children: prefer server if populated, else keep local
          const children =
            s.children && s.children.length > 0
              ? s.children
              : (local?.children ?? s.children ?? []);
          return { ...s, children };
        }),
        ...prev.filter((s) => !serverMap.has(s.id)),
      ];
      // Final dedup safety net
      const seen = new Set<string>();
      return merged.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
    });
    knownIds.current = new Set([
      ...initial.map((s) => s.id),
      ...initial.flatMap((s) => (s.children ?? []).map((c) => c.id)),
    ]);
  }, [initial]);

  useEffect(() => {
    const es = new EventSource(`/api/racks/${rackId}/events`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as { type: string; slot?: Slot; slotId?: string };
        if (payload.type === "connected") {
          setConnected(true);
          return;
        }
        if (payload.type === "ping") return;
        if (payload.type === "slot_added" && payload.slot) {
          if (knownIds.current.has(payload.slot.id)) return;
          knownIds.current.add(payload.slot.id);
          const newSlot = payload.slot!;
          if (newSlot.parentSlotId) {
            // Child slot → nest under parent shelf (idempotent)
            setSlots((prev) =>
              prev.map((s) =>
                s.id === newSlot.parentSlotId
                  ? {
                      ...s,
                      children: (s.children ?? []).some((c) => c.id === newSlot.id)
                        ? s.children!
                        : [...(s.children ?? []), newSlot],
                    }
                  : s,
              ),
            );
          } else {
            setSlots((prev) => (prev.some((s) => s.id === newSlot.id) ? prev : [...prev, newSlot]));
          }
        }
        if (payload.type === "slot_updated" && payload.slot) {
          const updated = payload.slot!;
          setSlots((prev) => {
            // Check if it's a top-level slot
            if (prev.some((s) => s.id === updated.id)) {
              return prev.map((s) => {
                if (s.id !== updated.id) return s;
                return {
                  ...updated,
                  children:
                    updated.children && updated.children.length > 0
                      ? updated.children
                      : (s.children ?? []),
                };
              });
            }
            // Otherwise update child inside its parent
            return prev.map((s) => {
              if (!s.children?.some((c) => c.id === updated.id)) return s;
              return { ...s, children: s.children.map((c) => (c.id === updated.id ? updated : c)) };
            });
          });
        }
        if (payload.type === "slot_removed" && payload.slotId) {
          knownIds.current.delete(payload.slotId);
          // Remove from top-level or from parent's children
          setSlots((prev) => {
            const inTop = prev.some((s) => s.id === payload.slotId);
            if (inTop) return prev.filter((s) => s.id !== payload.slotId);
            return prev.map((s) => ({
              ...s,
              children: (s.children ?? []).filter((c) => c.id !== payload.slotId),
            }));
          });
        }
        if (payload.type === "rack_cleared") {
          knownIds.current.clear();
          setSlots([]);
        }
      } catch {
        // ignore malformed SSE payloads
      }
    };
    return () => es.close();
  }, [rackId]);

  const addSlot = useCallback((slot: Slot) => {
    knownIds.current.add(slot.id); // prevent SSE from adding it again
    setSlots((prev) => {
      if (prev.some((s) => s.id === slot.id)) return prev;
      return [...prev, slot];
    });
  }, []);

  // Dedup safeguard: prevent duplicate-key React errors regardless of race conditions
  const safeSlots = useMemo(() => {
    const seen = new Set<string>();
    return slots.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }, [slots]);

  const registerChildId = useCallback((childId: string) => {
    knownIds.current.add(childId);
  }, []);

  return { slots: safeSlots, setSlots, addSlot, registerChildId };
}
