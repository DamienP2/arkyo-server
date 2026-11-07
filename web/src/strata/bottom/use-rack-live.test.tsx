/**
 * `useRacksLive` : une lecture par contenant, partagée par les abonnés
 * (inspecteur, dock bas, vue Connectique) ; un évènement du flux applicatif
 * qui porte le `rackId` relance les lectures. Aucun flux par contenant.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { emitAppEvent, mockApi, resetApp } from "@/tests/app-harness";
import { useRacksLive } from "./use-rack-live";
import { CONNECTIONS, RACK } from "./test-fixtures";

afterEach(() => resetApp());

const calls = (spy: ReturnType<typeof mockApi>, path: string) =>
  spy.mock.calls.filter(([input]) => String(input).split("?")[0] === path).length;

describe("useRacksLive", () => {
  test("abonnés partagés, relecture sur évènement applicatif du contenant, aucun flux par contenant", async () => {
    let rows = CONNECTIONS.slice(0, 1);
    const spy = mockApi({
      "GET /api/racks/r1/connections": () => ({ body: rows }),
      "GET /api/tenant/projects/p1/racks/r1/canvas-data": { body: RACK },
    });
    const a = renderHook(() => useRacksLive(["r1"]));
    const b = renderHook(() => useRacksLive(["r1"], "p1"));
    await waitFor(() => expect(b.result.current.r1.canvas?.rack.id).toBe("r1"));
    expect(a.result.current.r1.connections).toHaveLength(1);
    expect(calls(spy, "/api/racks/r1/connections")).toBe(1);
    expect(calls(spy, "/api/tenant/projects/p1/racks/r1/canvas-data")).toBe(1);

    // Un seul flux : celui de l'application, partagé.
    const es = (globalThis.EventSource as unknown as { open: Set<{ url: string }> }).open;
    expect([...es].map((e) => e.url)).toEqual(["/api/events"]);

    // Un évènement d'un autre contenant : rien n'est relu.
    rows = CONNECTIONS;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => emitAppEvent({ type: "update", entity: "rackConnection", action: "created", id: "r9", rackId: "r9" }));
    act(() => void vi.advanceTimersByTime(200));
    expect(calls(spy, "/api/racks/r1/connections")).toBe(1);
    // Un câble ajouté ailleurs sur ce contenant : les lectures sont relancées.
    act(() => emitAppEvent({ type: "update", entity: "rackConnection", action: "created", id: "r1", rackId: "r1" }));
    act(() => void vi.advanceTimersByTime(200));
    vi.useRealTimers();
    await waitFor(() => expect(a.result.current.r1.connections).toHaveLength(3));
    expect(calls(spy, "/api/tenant/projects/p1/racks/r1/canvas-data")).toBe(2);

    a.unmount();
    b.unmount();
    await waitFor(() => expect(es.size).toBe(0));
  });
});
