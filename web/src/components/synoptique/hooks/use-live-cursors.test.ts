/**
 * `useLiveCursors` (arkyo:components/synoptique/hooks/use-live-cursors.ts,
 * décision 10) : copie d'arkyo dont la connexion est neutralisée jusqu'à la
 * phase 7. Ni `POST /api/realtime/ticket`, ni WebSocket, ni erreur en console,
 * même après les délais de reconnexion d'arkyo (1 s → 10 s) ; l'API du hook
 * reste utilisable (aucun pair, envois sans effet).
 */

import { afterEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLiveCursors } from "./use-live-cursors";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("live_cursors_make_no_network_call", async () => {
  vi.useFakeTimers();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ticket: "t" }), { status: 200 }),
  );
  const sockets: string[] = [];
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 0;
      constructor(url: string) {
        sockets.push(url);
      }
      send() {}
      close() {}
    },
  );
  const consoleError = vi.spyOn(console, "error");

  const { result, rerender, unmount } = renderHook(({ room }) => useLiveCursors(room), {
    initialProps: { room: "panel:pn1" as string | null },
  });
  // Délais de reconnexion d'arkyo largement dépassés.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });

  expect(result.current.peers.size).toBe(0);
  act(() => {
    result.current.sendCursor(10, 20);
    result.current.sendSelection(["s1"]);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });

  // Changement de salle puis démontage : toujours rien.
  rerender({ room: "panel:pn2" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  unmount();

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(sockets).toEqual([]);
  expect(consoleError).not.toHaveBeenCalled();
});
