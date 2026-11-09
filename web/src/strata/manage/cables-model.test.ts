/**
 * Gérer › Câbles, modèle (interface Strata v2, spec v2 §4.2) : liste agrégée
 * des câbles du projet par lecture des routes existantes, sans doublon,
 * extrémités nommées ; écritures du mode tableau.
 */

import { describe, expect, test } from "vitest";
import { CONNECTIONS, MONITOR_SLOT, PANEL_SLOT, SLOT, canvasData } from "../bottom/test-fixtures";
import {
  aggregateCables,
  cableWrites,
  isCableEvent,
  type CableSources,
  type LocationPayloadLite,
} from "./cables-model";

const RACKS = [
  { id: "r1", name: "Baie 1", locationId: "l1", isVirtual: false },
  { id: "v1", name: "", locationId: "l1", isVirtual: true },
  { id: "r9", name: "Valise", locationId: null, isVirtual: false },
];

const CT = [
  { id: "ct-bnc", name: "BNC", iconId: "bnc", color: "#64748b", category: "Vidéo" },
  { id: "ct-xlr", name: "XLR3", iconId: "xlr3", color: "#64748b", category: "Audio" },
];
const SIGNALS = [
  { name: "12G-SDI", color: "#3654ff" },
  { name: "AES3", color: "#f59e0b" },
];

const PROJECT_CABLE = {
  id: "pc1",
  projectId: "p1",
  fromRackId: "r1",
  fromSlotId: "s3",
  fromConnectorIndex: 0,
  fromAdapterId: null,
  fromAdapterSide: null,
  fromAdapterPortIndex: null,
  toRackId: "r9",
  toSlotId: "s9",
  toConnectorIndex: 0,
  toAdapterId: null,
  toAdapterSide: null,
  toAdapterPortIndex: null,
  label: "V-2001",
  color: null,
  waypoints: null,
  cableStyle: null,
  notes: "Liaison valise",
  tags: null,
  bundleId: "pb1",
  catalogCableModelId: "cm1",
};

function location(extra: Partial<LocationPayloadLite> = {}): LocationPayloadLite {
  return {
    location: { id: "l1", name: "Régie", cableCode: "REG", virtualRackId: "v1" },
    racks: [
      { id: "r1", name: "Baie 1", isVirtual: false },
      { id: "v1", name: "", isVirtual: true },
    ],
    slots: [SLOT, PANEL_SLOT, MONITOR_SLOT].map((s) => ({ ...s, rackId: "r1" })),
    connections: CONNECTIONS.map((c) => ({ ...c, notes: null, tags: null, cableStyle: null, waypoints: null, bundleId: null })),
    // Le même câble projet, vu aussi depuis la vue de lieu.
    projectConnections: [PROJECT_CABLE],
    adapters: [],
    connectorTypes: CT,
    signals: SIGNALS,
    ...extra,
  };
}

const VALISE_SLOT = { ...SLOT, id: "s9", rackId: "r9", label: "ENC 1" };

function sources(extra: Partial<CableSources> = {}): CableSources {
  return {
    racks: RACKS,
    general: {
      locations: [{ id: "l1", name: "Régie" }],
      connections: [PROJECT_CABLE],
      bundles: [{ id: "pb1", name: "Liaisons", color: "#6366f1" }],
      connectorTypes: CT,
      signals: SIGNALS,
    },
    locations: [location()],
    orphans: [
      {
        rackId: "r9",
        // c1 est aussi lu dans la vue de lieu : une seule ligne.
        connections: [{ ...CONNECTIONS[0] }, { ...CONNECTIONS[0], id: "c9", rackId: "r9", label: "V-0901", fromSlotId: "s9", toSlotId: "s9", toConnectorIndex: 2 }],
        canvas: canvasData("r9", "Valise", [VALISE_SLOT]),
      },
    ],
    cableModels: [{ id: "cm1", name: "Belden 1694A" }],
    ...extra,
  };
}

describe("Gérer › Câbles, modèle", () => {
  test("agrégation sans doublons", () => {
    const rows = aggregateCables(sources());
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(["c1", "c2", "c3", "c9", "pc1"]);

    // Ordre : numéros en ordre naturel, câbles sans numéro en dernier.
    expect(rows.map((r) => r.label)).toEqual(["A-0101", "V-0101", "V-0901", "V-2001", null]);

    // Extrémités nommées : repère du slot, puis port (connectique à plat).
    const c1 = rows.find((r) => r.id === "c1")!;
    expect(c1.kind).toBe("rack");
    expect(c1.rackId).toBe("r1");
    expect(c1.from.name).toBe("CAM 1 · SDI OUT 1");
    expect(c1.to.name).toBe("MON 1 · SDI IN");
    expect(c1.from.connectorName).toBe("BNC");
    expect(c1.from.gender).toBe("FEMALE");
    expect(c1.from.face).toBe("REAR");
    expect(c1.signal).toEqual({ name: "12G-SDI", color: "#3654ff" });
    expect(c1.type).toBe("BNC");
    expect(c1.scope).toBe("Régie");

    // Panel : emplacement et côté (arrière, avant).
    const c2 = rows.find((r) => r.id === "c2")!;
    expect(c2.to.name).toBe("PATCH A · 1 arrière");
    expect(c2.to.connectorName).toBe("BNC");

    // Câble entre deux lieux : route du projet, extrémités dans deux sources.
    const pc1 = rows.find((r) => r.id === "pc1")!;
    expect(pc1.kind).toBe("project");
    expect(pc1.from.name).toBe("MON 1 · SDI IN");
    expect(pc1.to.name).toBe("ENC 1 · SDI OUT 1");
    expect(pc1.scope).toBe("Régie → À affecter");
    expect(pc1.type).toBe("Belden 1694A");
    expect(pc1.bundle).toEqual({ id: "pb1", name: "Liaisons", color: "#6366f1" });
    expect(pc1.notes).toBe("Liaison valise");

    // Contenant sans emplacement : ses câbles et ses slots (canvas-data).
    const c9 = rows.find((r) => r.id === "c9")!;
    expect(c9.rackId).toBe("r9");
    expect(c9.to.name).toBe("ENC 1 · REF");
    expect(c9.scope).toBe("À affecter");
  });

  test("extrémité inconnue ou sur un adaptateur", () => {
    const loc = location({
      connections: [
        { ...CONNECTIONS[0], id: "x1", toSlotId: "absent" },
        { ...CONNECTIONS[0], id: "x2", toSlotId: null, toConnectorIndex: null, toAdapterId: "a1", toAdapterSide: "left", toAdapterPortIndex: 1 },
      ],
      projectConnections: [],
      adapters: [{ id: "a1", rackId: "v1", label: null, adapter: { id: "ad1", name: "HDMI → SDI" } }],
    });
    const rows = aggregateCables(sources({ locations: [loc], orphans: [], general: null }));
    expect(rows.find((r) => r.id === "x1")!.to.name).toBe("Hors contenant");
    expect(rows.find((r) => r.id === "x2")!.to.name).toBe("HDMI → SDI · 2");
  });

  test("1 200 câbles : agrégation mesurée", () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({
      ...CONNECTIONS[0],
      id: `m${i}`,
      label: i % 10 === 0 ? null : `V-${String(i).padStart(4, "0")}`,
      notes: null,
      tags: null,
      cableStyle: null,
      waypoints: null,
      bundleId: null,
    }));
    const src = sources({ locations: [location({ connections: many, projectConnections: [] })], orphans: [], general: null });
    const t0 = performance.now();
    const rows = aggregateCables(src);
    const ms = performance.now() - t0;
    expect(rows).toHaveLength(1200);
    // Garde large (machine de CI chargée) ; la mesure réelle est au rapport.
    expect(ms).toBeLessThan(1000);
  });

  test("écritures : une requête par ligne modifiée, route du câble", () => {
    const rows = aggregateCables(sources());
    const byId = new Map(rows.map((r) => [r.id, r]));
    const writes = cableWrites(
      [
        { row: byId.get("c1")!, draft: { label: "V-0102", notes: "repris" } },
        { row: byId.get("c3")!, draft: { label: "" } },
        { row: byId.get("pc1")!, draft: { label: "", color: "#ff0000" } },
        // Inchangé : rien n'est envoyé.
        { row: byId.get("c9")!, draft: { label: "V-0901" } },
      ],
      "p1",
    );
    expect(writes).toEqual([
      { method: "PATCH", url: "/api/racks/r1/connections/c1", body: { label: "V-0102", notes: "repris" }, ids: ["c1"] },
      // Un numéro effacé passe par la route d'effacement d'arkyo (le PATCH ne sait pas effacer).
      { method: "POST", url: "/api/racks/r1/renumber", body: { clearIds: ["c3"] }, ids: ["c3"] },
      {
        method: "PATCH",
        url: "/api/tenant/projects/p1/synoptic/connections/pc1",
        body: { label: null, color: "#ff0000" },
        ids: ["pc1"],
      },
    ]);
  });

  test("évènements des câbles du projet", () => {
    const racks = ["r1", "v1"];
    expect(isCableEvent({ type: "update", entity: "rackConnection", rackId: "r1" }, "p1", racks)).toBe(true);
    expect(isCableEvent({ type: "update", entity: "rackConnection", rackId: "rx" }, "p1", racks)).toBe(false);
    expect(isCableEvent({ type: "update", entity: "project_synoptic_connection", projectId: "p1" }, "p1", racks)).toBe(true);
    expect(isCableEvent({ type: "update", entity: "project_synoptic_connection", projectId: "p2" }, "p1", racks)).toBe(false);
    expect(isCableEvent({ type: "update", entity: "slot", rackId: "v1" }, "p1", racks)).toBe(true);
    expect(isCableEvent({ type: "update", entity: "rackZone", rackId: "r1" }, "p1", racks)).toBe(false);
  });
});
