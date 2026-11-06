/**
 * `lib/client-id.ts` (copie d'arkyo) : un identifiant par onglet
 * (`sessionStorage["arkyo.clientId"]`), envoyé en `X-Client-Id` par
 * `apiFetch` pour que l'onglet ignore l'écho de ses propres évènements
 * (`clientId` des évènements temps réel, lu par `http/client_id.rs`).
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { apiFetch, getClientId, readClientIdFromRequest } from "@/lib/client-id";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("client-id", () => {
  test("client_id_header_sent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await apiFetch("/api/racks/r1/slots/s1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const id = getClientId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Stable dans l'onglet.
    expect(window.sessionStorage.getItem("arkyo.clientId")).toBe(id);
    expect(getClientId()).toBe(id);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/racks/r1/slots/s1");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Client-Id")).toBe(id);
    // Les autres options sont conservées.
    expect(init?.method).toBe("PATCH");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init?.body).toBe("{}");

    // Un en-tête déjà posé par l'appelant n'est pas écrasé.
    await apiFetch("/api/x", { headers: { "X-Client-Id": "autre" } });
    expect(new Headers(fetchSpy.mock.calls[1][1]?.headers).get("X-Client-Id")).toBe("autre");

    // Lecture côté serveur d'arkyo (gardée pour la parité du module).
    expect(readClientIdFromRequest({ headers: new Headers({ "x-client-id": id }) })).toBe(id);
    expect(readClientIdFromRequest({ headers: new Headers() })).toBeUndefined();
  });
});
