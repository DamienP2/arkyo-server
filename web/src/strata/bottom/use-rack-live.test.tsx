/**
 * `useRacksLive` : une lecture et un flux temps réel par contenant, partagés
 * par les abonnés (inspecteur, dock bas, vue Connectique) ; un évènement du
 * contenant relance les lectures.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { mockApi, resetApp } from "@/tests/app-harness";
import { useRacksLive } from "./use-rack-live";
import { CONNECTIONS, RACK } from "./test-fixtures";

afterEach(() => resetApp());

const calls = (spy: ReturnType<typeof mockApi>, path: string) =>
  spy.mock.calls.filter(([input]) => String(input).split("?")[0] === path).length;

describe("useRacksLive", () => {
  test("abonnés partagés, relecture sur évènement du contenant, fermeture au dernier départ", async () => {
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

    // Un câble ajouté ailleurs : le flux du contenant relance les lectures.
    const es = (globalThis.EventSource as unknown as { open: Set<{ url: string; onmessage?: (e: MessageEvent) => void }> })
      .open;
    const stream = [...es].find((e) => e.url === "/api/racks/r1/events")!;
    expect([...es].filter((e) => e.url === "/api/racks/r1/events")).toHaveLength(1);
    rows = CONNECTIONS;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => stream.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "connection_added" }) })));
    act(() => void vi.advanceTimersByTime(200));
    vi.useRealTimers();
    await waitFor(() => expect(a.result.current.r1.connections).toHaveLength(3));
    expect(calls(spy, "/api/tenant/projects/p1/racks/r1/canvas-data")).toBe(2);

    a.unmount();
    b.unmount();
    await waitFor(() => expect([...es].some((e) => e.url === "/api/racks/r1/events")).toBe(false));
  });
});
