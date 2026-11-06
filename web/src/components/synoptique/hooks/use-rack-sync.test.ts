/**
 * `useRackSync` (arkyo:components/synoptique/hooks/use-rack-sync.ts) écoute le
 * flux SSE par rack `GET /api/racks/:id/events`. Les évènements et leurs
 * charges sont ceux que publient les routes de slots du serveur
 * (`crates/arkyo-server/src/http/rack_slots.rs`) : `slot_added` /
 * `slot_updated` (`slot`), `slot_removed` (`slotId`, `removedAdapterIds`),
 * `rack_cleared`.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRackSync } from "./use-rack-sync";
import type { Slot } from "../lib/types";

class FakeEventSource {
  static all: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(data: unknown) {
    act(() => {
      this.onmessage?.(new MessageEvent("message", { data: typeof data === "string" ? data : JSON.stringify(data) }));
    });
  }
}

beforeEach(() => {
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function slot(id: string, extra: Partial<Slot> = {}): Slot {
  return {
    id,
    view: "FRONT",
    equipmentId: null,
    parentSlotId: null,
    startU: 1,
    heightU: 1,
    widthFraction: "FULL",
    column: 0,
    label: null,
    notes: null,
    panelLabels: null,
    equipment: null,
    panel: null,
    synopticX: null,
    synopticY: null,
    ...extra,
  };
}

test("use_rack_sync_applies_slot_events", () => {
  const initial = [slot("a", { startU: 1 }), slot("shelf", { startU: 5, children: [] })];
  const { result, unmount } = renderHook(() => useRackSync("r1", initial));
  expect(FakeEventSource.all).toHaveLength(1);
  const es = FakeEventSource.all[0];
  expect(es.url).toBe("/api/racks/r1/events");
  const ids = () => result.current.slots.map((s) => s.id);

  // Charges non JSON et évènements étrangers aux slots : ignorés.
  es.emit("pas du JSON");
  es.emit({ type: "construction_checks_updated", checks: [] });
  expect(ids()).toEqual(["a", "shelf"]);

  // slot_added : ajout, idempotent ; un enfant d'étagère va sous son parent.
  es.emit({ type: "slot_added", slot: slot("b", { startU: 3 }) });
  es.emit({ type: "slot_added", slot: slot("b", { startU: 3 }) });
  expect(ids()).toEqual(["a", "shelf", "b"]);
  es.emit({ type: "slot_added", slot: slot("child", { parentSlotId: "shelf", startU: null, heightU: null }) });
  expect(ids()).toEqual(["a", "shelf", "b"]);
  expect(result.current.slots.find((s) => s.id === "shelf")?.children?.map((c) => c.id)).toEqual(["child"]);

  // slot_updated : remplace le slot (fantôme promu, déplacement) et ses enfants.
  es.emit({ type: "slot_updated", slot: slot("b", { startU: 8, label: "Déplacé" }) });
  expect(result.current.slots.find((s) => s.id === "b")).toMatchObject({ startU: 8, label: "Déplacé" });
  es.emit({ type: "slot_updated", slot: slot("child", { parentSlotId: "shelf", label: "Enfant" }) });
  expect(result.current.slots.find((s) => s.id === "shelf")?.children?.[0].label).toBe("Enfant");
  // L'étagère mise à jour sans enfants garde les siens.
  es.emit({ type: "slot_updated", slot: slot("shelf", { startU: 6 }) });
  expect(result.current.slots.find((s) => s.id === "shelf")).toMatchObject({ startU: 6 });
  expect(result.current.slots.find((s) => s.id === "shelf")?.children?.map((c) => c.id)).toEqual(["child"]);

  // slot_removed (charge du serveur, avec removedAdapterIds) : haut niveau puis enfant.
  es.emit({ type: "slot_removed", slotId: "a", removedAdapterIds: ["ad1"] });
  expect(ids()).toEqual(["shelf", "b"]);
  es.emit({ type: "slot_removed", slotId: "child", removedAdapterIds: [] });
  expect(result.current.slots.find((s) => s.id === "shelf")?.children).toEqual([]);

  // Un slot retiré peut revenir (knownIds oublie l'id).
  es.emit({ type: "slot_added", slot: slot("a", { startU: 2 }) });
  expect(ids()).toEqual(["shelf", "b", "a"]);

  // rack_cleared : plus aucun slot.
  es.emit({ type: "rack_cleared" });
  expect(result.current.slots).toEqual([]);

  unmount();
  expect(es.closed).toBe(true);
});
