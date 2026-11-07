/**
 * `defaultRackCablingAdapter` (arkyo:components/synoptique/lib/cabling-api.ts)
 * ne parle qu'aux routes par rack portées en 4c :
 * `crates/arkyo-server/src/http/{rack_connections,rack_renumber,racks,rack_slots}.rs`.
 * Ce test fige les chemins, méthodes et corps envoyés.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { defaultRackCablingAdapter } from "./cabling-api";

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let reply: unknown = {};

beforeEach(() => {
  calls = [];
  reply = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test("chaque méthode appelle la route par rack d'arkyo", async () => {
  const api = defaultRackCablingAdapter("r1");
  await api.createOne({ fromSlotId: "a", fromConnectorIndex: 0, toSlotId: "b", toConnectorIndex: 1 });
  reply = [];
  await api.createBatch([{ fromSlotId: "a", toSlotId: "b" }]);
  reply = {};
  await api.patchOne("c1", { label: "V-001" });
  await api.deleteOne("c1");
  await api.deleteBatch(["c1", "c2"]);
  reply = [];
  await api.renumber({ clearIds: ["c1"] });
  await api.patchRackConfig({ numberingOverride: null });
  await api.persistSlotPosition("s1", 10, 20);

  expect(calls).toEqual([
    {
      url: "/api/racks/r1/connections",
      method: "POST",
      body: { fromSlotId: "a", fromConnectorIndex: 0, toSlotId: "b", toConnectorIndex: 1 },
    },
    { url: "/api/racks/r1/connections", method: "POST", body: { connections: [{ fromSlotId: "a", toSlotId: "b" }] } },
    { url: "/api/racks/r1/connections/c1", method: "PATCH", body: { label: "V-001" } },
    { url: "/api/racks/r1/connections/c1", method: "DELETE", body: undefined },
    { url: "/api/racks/r1/connections", method: "DELETE", body: { ids: ["c1", "c2"] } },
    { url: "/api/racks/r1/renumber", method: "POST", body: { clearIds: ["c1"] } },
    { url: "/api/racks/r1", method: "PATCH", body: { numberingOverride: null } },
    { url: "/api/racks/r1/slots/s1", method: "PATCH", body: { synopticX: 10, synopticY: 20 } },
  ]);
});

test("renumber : la réponse { ok: true } d'un effacement donne une liste vide", async () => {
  reply = { ok: true };
  const api = defaultRackCablingAdapter("r1");
  await expect(api.renumber({ clearOnly: true })).resolves.toEqual([]);
});
