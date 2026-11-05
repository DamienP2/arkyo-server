/**
 * Référentiels des pages équipement : mêmes transformations qu'arkyo (ordre des
 * types `functionId, sortOrder, name`, signaux avec `connectors`, défaut 150 mm).
 */

import { afterEach, expect, test } from "vitest";
import { mockApi, resetApp } from "@/tests/app-harness";

import { loadEquipmentRefs } from "./load-equipment-refs";

afterEach(resetApp);

const type = (id: string, functionId: string, sortOrder: number, name: string) => ({
  id,
  name,
  functionId,
  parentId: null,
  iconId: null,
  schemaImageUrl: null,
  sortOrder,
  isActive: true,
});

test("types_order_like_arkyo", async () => {
  mockApi({
    "GET /api/tenant/catalogue/lookup": {
      body: {
        brands: [],
        connectorTypes: [],
        signals: [{ id: "s1", name: "SDI", connectorIds: ["c1"], isIp: false }],
        functions: [
          { id: "fa", label: "Audio", color: "#22c55e", sortOrder: 1 },
          { id: "fb", label: "Vidéo", color: "#3b82f6", sortOrder: 0 },
        ],
        phases: [],
      },
    },
    "GET /api/tenant/parametres/categories": {
      body: {
        types: {
          arkyo: [],
          // Ordre de la route : sortOrder, name.
          personal: [
            type("t1", "fb", 0, "Caméra"),
            type("t2", "fa", 0, "Console"),
            type("t3", "fb", 1, "Mélangeur"),
            type("t4", "fa", 1, "Enceinte"),
            type("t5", "fa", 1, "Amplificateur"),
          ],
        },
      },
    },
    "GET /api/tenant/parametres/application": { body: {} },
  });
  const refs = (await loadEquipmentRefs()) as unknown as {
    types: { id: string }[];
    signals: { connectors: unknown }[];
    cableSafetyDefaultMm: number;
  };
  expect(refs.types.map((t) => t.id)).toEqual(["t2", "t5", "t4", "t1", "t3"]);
  expect(refs.signals[0].connectors).toEqual(["c1"]);
  expect(refs.cableSafetyDefaultMm).toBe(150);
});
