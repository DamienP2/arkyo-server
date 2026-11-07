/**
 * Onglet Synoptique de l'éditeur projet (arkyo:app/(fullscreen)/project/[id]/
 * synoptique/{synoptique-tab-client, _components/{general-canvas,
 * location-canvas, general-info-panel, general-properties-panels,
 * synoptique-rack-selector}}.tsx), monté par l'éditeur réel
 * (`/project/:id?tab=synoptique`) sur la vraie `SynopticView`.
 *
 * Les réponses simulées ont la forme des routes Rust :
 * - `GET /api/tenant/projects/:id/synoptic/general` (synoptic_general.rs) ;
 * - `GET /api/tenant/projects/:id/synoptic/location/:locationId`
 *   (synoptic_location.rs, lignes `RackSlot` / `RackConnection` /
 *   `ProjectConnection` / `RackZone` / `RackLabel` / `SynopticAdapter` /
 *   `RackExternalPort` de la migration 0004).
 *
 * Les corps envoyés sont comparés aux schémas Rust :
 * - `ENDPOINT` / `CREATE` / `PATCH` de projects/synoptic_connections.rs ;
 * - `CREATE` / `PATCH` de rack_connections.rs ;
 * - `ADAPTER_UPDATE` de rack_objects2.rs, `ZONE_UPDATE` de rack_objects.rs.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import {
  OWNER_PERMS,
  emitAppEvent,
  renderApp,
  resetApp,
  signedInApi,
  type Api,
  type Reply,
} from "@/tests/app-harness";

/** Premier montage : l'éditeur et la vue synoptique (≈ 14 000 l.) sont transformés à la demande. */
const FIRST_LOAD = { timeout: 15000 };

const NOW = "2026-11-07T10:00:00.000Z";

const HEADER = {
  id: "p1",
  name: "Finale Coupe de France",
  status: "EN_PREPARATION",
  interventionType: "PRESTATION",
  rigType: "CAR",
  clientName: "France TV",
  shootingDate: "2026-11-20T00:00:00.000Z",
  location: "Stade de France",
  prestationType: null,
};

/** Contenant de la route `editor` (`InventaireRack`). */
function rack(id: string, name: string, locationId: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    rigConfigId: "rc1",
    name,
    rackType: "STANDARD",
    totalU: 42,
    depthMm: 600,
    widthMm: null,
    heightMm: null,
    hasWheels: false,
    emptyWeightKg: null,
    slotsCount: 0,
    constructionChecks: 0,
    isRackable: true,
    hasConnectors: false,
    canvasX: null,
    canvasY: null,
    locationId,
    isVirtual: false,
    slots: [],
    bom: [],
    ...extra,
  };
}

const EDITOR = {
  header: HEADER,
  fiche: {
    ...HEADER,
    shootingEndDate: null,
    planningStart: null,
    planningEnd: null,
    commissioningDate: null,
    description: null,
    documents: [],
    counts: { tasks: 0, messages: 0, documents: 0 },
  },
  inventaire: {
    rigConfigId: "rc1",
    racks: [
      rack("r1", "Baie 1", "l1"),
      rack("r2", "Baie 2", "l1"),
      rack("v1", "Régie", "l1", { isVirtual: true, isRackable: false, totalU: 0 }),
      rack("r3", "Baie 3", "l2"),
      rack("v2", "Plateau", "l2", { isVirtual: true, isRackable: false, totalU: 0 }),
      rack("r9", "Flight 1", null, { rackType: "FLIGHT_CASE_CLASSIC", totalU: 6 }),
    ],
    locations: [
      { id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: "v1" },
      { id: "l2", name: "Plateau", cableCode: "PLT", sortOrder: 1, virtualRackId: "v2" },
    ],
  },
  cartographie: { maps: [] },
};

// ── Catalogue (build_catalog_lookups de focus_payload.rs) ───────────────────

const CONNECTOR_TYPES = [
  {
    id: "ct1",
    name: "BNC",
    version: null,
    iconId: "bnc",
    color: "#0ea5e9",
    category: "Vidéo",
    functions: [],
    functionId: null,
  },
];
const SIGNALS = [
  { id: "sg1", name: "SDI", color: "#22c55e", cablePrefix: "V", cableSuffix: null, category: null, categoryRef: null },
];

// ── Vue Générale (synoptic_general.rs) ─────────────────────────────────────

/** Port externe d'un bloc (`ports_of` + `rackId` / `rackName` sur un lieu). */
function extConnector(
  externalId: string,
  slotId: string,
  portIndex: number,
  label: string,
  direction: "IN" | "OUT",
  rackId: string,
  rackName: string,
  equipmentName: string,
) {
  return {
    externalId,
    slotId,
    portIndex,
    label,
    direction,
    signalName: "SDI",
    connectorTypeId: "ct1",
    side: direction === "IN" ? "left" : "right",
    equipmentId: `eq-${slotId}`,
    equipmentName,
    rackId,
    rackName,
  };
}

/** Ligne `ProjectConnection` (PROJECT_CONNECTION_COLS). */
function projectConnection(
  id: string,
  from: [string, string, number],
  to: [string, string, number],
  label: string | null,
) {
  return {
    id,
    projectId: "p1",
    fromRackId: from[0],
    fromSlotId: from[1],
    fromConnectorIndex: from[2],
    fromAdapterId: null,
    fromAdapterPortIndex: null,
    fromAdapterSide: null,
    toRackId: to[0],
    toSlotId: to[1],
    toConnectorIndex: to[2],
    toAdapterId: null,
    toAdapterPortIndex: null,
    toAdapterSide: null,
    label,
    color: "#22c55e",
    waypoints: null,
    cableStyle: null,
    notes: null,
    tags: null,
    catalogCableModelId: null,
    wired: false,
    wiredAt: null,
    wiredNotes: null,
    bundleId: null,
    createdAt: NOW,
  };
}

const GENERAL = {
  locations: [
    {
      id: "l1",
      name: "Régie",
      cableCode: "REG",
      canvasX: 40,
      canvasY: 40,
      externalConnectors: [
        extConnector("e1", "s1", 1, "SORTIE PGM", "OUT", "r1", "Baie 1", "Caméra X"),
        extConnector("e2", "s1", 2, "SORTIE PVW", "OUT", "r1", "Baie 1", "Caméra X"),
      ],
    },
    {
      id: "l2",
      name: "Plateau",
      cableCode: "PLT",
      canvasX: 700,
      canvasY: 40,
      externalConnectors: [
        extConnector("e3", "s7", 0, "RETOUR 1", "IN", "r3", "Baie 3", "Moniteur plateau"),
        extConnector("e4", "s7", 1, "RETOUR 2", "IN", "r3", "Baie 3", "Moniteur plateau"),
      ],
    },
  ],
  racks: [
    {
      id: "r9",
      name: "Flight 1",
      rackType: "FLIGHT_CASE_CLASSIC",
      totalU: 6,
      canvasX: 40,
      canvasY: 500,
      externalConnectors: [],
    },
  ],
  connections: [projectConnection("pcg1", ["r1", "s1", 1], ["r3", "s7", 0], "V-100")],
  bundles: [],
  connectorTypes: CONNECTOR_TYPES,
  signals: SIGNALS,
  signalCategories: [],
  appConfig: {},
  project: { id: "p1", name: "Finale Coupe de France" },
  stats: { rackCount: 4, totalWeightKg: 0, totalPowerW: 0 },
};

// ── Vue Lieu (synoptic_location.rs) ─────────────────────────────────────────

function equipment(id: string, name: string, connectors: unknown[]) {
  return {
    id,
    name,
    reference: null,
    category: "Vidéo",
    heightU: 1,
    weight: 2,
    powerW: 50,
    depthMm: null,
    imageUrl: null,
    connectors,
    brand: { id: "b1", name: "Sony" },
  };
}
const out = (label: string) => ({ connectorTypeId: "ct1", quantity: 1, direction: "OUT", signalName: "SDI", label });
const inp = (label: string) => ({ connectorTypeId: "ct1", quantity: 1, direction: "IN", signalName: "SDI", label });

/** `RackSlot` (SLOT_COLS) + `equipment` / `components` / `panel` / `attachedAdapters` enrichis. */
function slotRow(id: string, rackId: string, startU: number, x: number, y: number, eq: ReturnType<typeof equipment>) {
  return {
    id,
    rackId,
    catalogEquipmentId: eq.id,
    snapshotId: null,
    panelId: null,
    parentSlotId: null,
    inventoryItemId: null,
    view: "FRONT",
    startU,
    heightU: 1,
    widthFraction: "FULL",
    column: 0,
    label: null,
    notes: null,
    patchNotes: null,
    panelLabels: null,
    synopticX: x,
    synopticY: y,
    createdAt: NOW,
    updatedAt: NOW,
    equipmentId: eq.id,
    equipment: eq,
    components: [],
    panel: null,
    attachedAdapters: [],
  };
}

/** Ligne `RackConnection` (migration 0004). */
function rackConnection(id: string, rackId: string, from: [string, number], to: [string, number], label: string | null) {
  return {
    id,
    rackId,
    fromSlotId: from[0],
    fromConnectorIndex: from[1],
    fromAdapterId: null,
    fromAdapterSide: null,
    fromAdapterPortIndex: null,
    fromComponentItemId: null,
    toSlotId: to[0],
    toConnectorIndex: to[1],
    toAdapterId: null,
    toAdapterSide: null,
    toAdapterPortIndex: null,
    toComponentItemId: null,
    label,
    color: "#22c55e",
    waypoints: null,
    cableStyle: null,
    notes: null,
    tags: null,
    catalogCableModelId: null,
    snapshotId: null,
    wired: false,
    wiredAt: null,
    wiredNotes: null,
    bundleId: null,
    createdAt: NOW,
  };
}

const LOCATION = {
  location: { id: "l1", name: "Régie", cableCode: "REG", virtualRackId: "v1" },
  racks: [
    { id: "r1", name: "Baie 1", cableCode: null, cableId: 1, numberingOverride: null, isVirtual: false, totalU: 42, rackType: "STANDARD" },
    { id: "r2", name: "Baie 2", cableCode: null, cableId: 2, numberingOverride: null, isVirtual: false, totalU: 42, rackType: "STANDARD" },
    { id: "v1", name: "Régie", cableCode: null, cableId: 3, numberingOverride: null, isVirtual: true, totalU: 0, rackType: "STANDARD" },
  ],
  slots: [
    slotRow("s1", "r1", 1, 40, 40, equipment("eq1", "Caméra X", [out("SDI 1"), out("SDI 2"), out("SDI 3"), out("SDI 4")])),
    slotRow("s2", "r1", 2, 520, 40, equipment("eq2", "Moniteur", [inp("MON 1"), inp("MON 2")])),
    slotRow("s3", "r2", 1, 1000, 40, equipment("eq3", "Mélangeur", [inp("ENTRÉE 1"), inp("ENTRÉE 2")])),
  ],
  connections: [rackConnection("rc1", "r1", ["s1", 0], ["s2", 0], null)],
  projectConnections: [projectConnection("pc1", ["r1", "s1", 1], ["r2", "s3", 0], "V-001")],
  zones: [
    {
      id: "z1",
      rackId: "v1",
      label: "Régie vidéo",
      labelPosition: "top-left",
      color: "#6366f1",
      x: 10,
      y: 10,
      w: 400,
      h: 200,
      borderRadius: 8,
      borderWidth: 2,
      borderStyle: "solid",
      opacity: 0.12,
      labelFontSize: 12,
      labelFontWeight: "normal",
      labelFontStyle: "normal",
      labelTextDecoration: "none",
      labelFontFamily: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  labels: [],
  adapters: [
    {
      id: "ad1",
      rackId: "r2",
      catalogAdapterId: "tad1",
      adapterId: "tad1",
      x: 1000,
      y: 500,
      attachedSlotId: null,
      attachedSide: null,
      attachedPortIndex: null,
      label: null,
      notes: null,
      snapshotId: null,
      createdAt: NOW,
      updatedAt: NOW,
      adapter: {
        id: "tad1",
        name: "Convertisseur BNC",
        reference: "CV-1",
        imageUrl: null,
        inputs: [{ connectorTypeId: "ct1", quantity: 1, label: null, gender: "F" }],
        outputs: [{ connectorTypeId: "ct1", quantity: 1, label: null, gender: "F" }],
      },
    },
  ],
  externalPorts: [],
  panelRows: [],
  bundles: [],
  connectorTypes: CONNECTOR_TYPES,
  signals: SIGNALS,
  signalCategories: [],
  equipmentCategories: [{ id: "f1", name: "Vidéo", color: "#3b82f6", children: [] }],
  appConfig: {},
  project: { id: "p1", name: "Finale Coupe de France" },
};

// ── Schémas Rust ────────────────────────────────────────────────────────────

const isInt = (v: unknown) => Number.isInteger(v);
const isStr = (v: unknown) => typeof v === "string";
const STYLE = (v: unknown) => v === "ortho" || v === "rounded" || v === "arrow";

/** `ENDPOINT` de synoptic_connections.rs. */
const ENDPOINT: Record<string, (v: unknown) => boolean> = {
  rackId: (v) => isStr(v) && (v as string).length > 0,
  slotId: isStr,
  connectorIndex: isInt,
  adapterId: isStr,
  adapterPortIndex: isInt,
  adapterSide: (v) => v === "left" || v === "right",
};
/** `CREATE` de synoptic_connections.rs (avec `from` / `to`). */
const PC_CREATE: Record<string, (v: unknown) => boolean> = {
  from: (v) => typeof v === "object" && v !== null,
  to: (v) => typeof v === "object" && v !== null,
  label: isStr,
  color: isStr,
  waypoints: () => true,
  cableStyle: STYLE,
  notes: isStr,
  tags: () => true,
  bundleId: isStr,
};
/** `PATCH` de synoptic_connections.rs. */
const PC_PATCH: Record<string, (v: unknown) => boolean> = {
  label: (v) => v === null || isStr(v),
  color: (v) => v === null || isStr(v),
  waypoints: () => true,
  cableStyle: (v) => v === null || STYLE(v),
  notes: (v) => v === null || isStr(v),
  tags: () => true,
  bundleId: (v) => v === null || isStr(v),
  catalogCableModelId: (v) => v === null || isStr(v),
};
/** `CREATE` de rack_connections.rs. */
const RC_CREATE_KEYS = [
  "id",
  "fromSlotId",
  "fromConnectorIndex",
  "fromAdapterId",
  "fromAdapterSide",
  "fromAdapterPortIndex",
  "fromComponentItemId",
  "toSlotId",
  "toConnectorIndex",
  "toAdapterId",
  "toAdapterSide",
  "toAdapterPortIndex",
  "toComponentItemId",
  "label",
  "color",
  "waypoints",
  "cableStyle",
];
/** `ADAPTER_UPDATE` de rack_objects2.rs. */
const ADAPTER_UPDATE: Record<string, (v: unknown) => boolean> = {
  x: (v) => typeof v === "number",
  y: (v) => typeof v === "number",
  attachedSlotId: (v) => v === null || isStr(v),
  attachedSide: (v) => v === null || v === "left" || v === "right",
  attachedPortIndex: (v) => v === null || isInt(v),
  label: (v) => v === null || isStr(v),
  notes: (v) => v === null || isStr(v),
};

function expectInSchema(body: Record<string, unknown>, schema: Record<string, (v: unknown) => boolean>) {
  for (const [k, v] of Object.entries(body)) {
    expect(Object.keys(schema), `clé ${k} hors schéma`).toContain(k);
    expect(schema[k](v), `${k} = ${JSON.stringify(v)}`).toBe(true);
  }
}

// ── Harnais ─────────────────────────────────────────────────────────────────

type Call = { method: string; path: string; body: unknown };

type FetchSpy = ReturnType<typeof renderApp>["fetchSpy"];
type FetchCall = FetchSpy["mock"]["calls"][number];

function calls(list: FetchCall[]): Call[] {
  return list.map(([input, init]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const raw = typeof init?.body === "string" ? init.body : undefined;
    return {
      method: (init?.method ?? "GET").toUpperCase(),
      path: decodeURIComponent(new URL(url, "http://localhost").pathname),
      body: raw ? JSON.parse(raw) : undefined,
    };
  });
}

/** Appels du synoptique (hors coquille : session, présence, éditeur…). */
function synopticCalls(fetchSpy: FetchSpy, from = 0) {
  return calls(fetchSpy.mock.calls.slice(from)).filter((c) => /synoptic|^\/api\/racks|^\/api\/admin|catalogue\/adapters/.test(c.path));
}

function synoptiqueApi(extra: Api = {}): Api {
  const echo =
    (base: Record<string, unknown>) =>
    (init: RequestInit | undefined): Reply => ({
      body: { ...base, ...(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>) },
    });
  return {
    ...signedInApi(OWNER_PERMS, "Régie A"),
    "GET /api/tenant/projects/p1/editor": { body: EDITOR },
    "GET /api/tenant/catalogue/adapters": { body: { arkyo: [], personal: [] } },
    // Dialogue « type de câble » ouvert au second clic de pose (parametres/cabling.rs).
    "GET /api/tenant/parametres/cable-models": { body: { models: [] } },
    "GET /api/tenant/projects/p1/synoptic/general": { body: GENERAL },
    "GET /api/tenant/projects/p1/synoptic/location/l1": { body: LOCATION },
    "PATCH /api/tenant/projects/p1/synoptic/connections/pc1": echo(LOCATION.projectConnections[0]),
    "PATCH /api/racks/r1/connections/rc1": echo(LOCATION.connections[0]),
    "PATCH /api/racks/r2/adapters/ad1": echo(LOCATION.adapters[0]),
    "PATCH /api/racks/v1/zones/z1": echo(LOCATION.zones[0]),
    "DELETE /api/tenant/projects/p1/synoptic/connections/pcg1": { body: { ok: true } },
    ...extra,
  };
}

async function openTab(view: "general" | "l1", extra: Api = {}) {
  window.localStorage.setItem("project-p1-synoptique-rack", view === "general" ? "__general__" : "loc:l1");
  // Dé-collision des îlots déjà faite (location-canvas) : aucune écriture de position au montage.
  window.localStorage.setItem("synoptic-loc-decollision:l1", "1");
  const app = renderApp("/project/p1?tab=synoptique", synoptiqueApi(extra));
  await screen.findByText(view === "general" ? "SORTIE PGM" : "Caméra X", {}, FIRST_LOAD);
  return app;
}

/** Panneau droit de l'`EditorShell` (colonne à droite du canvas). */
function rightPanel(): HTMLElement {
  return document.querySelector("div.flex-none.border-l.bg-background") as HTMLElement;
}

/** Trace cliquable d'un câble (zone de clic transparente), dans l'ordre des connexions. */
function cablePaths(): SVGPathElement[] {
  return [...document.querySelectorAll<SVGPathElement>('path[data-cable="true"][stroke="rgba(0,0,0,0)"]')];
}

/** Ferme le dialogue « type de câble » qui suit la pose d'un câble (« Plus tard »). */
async function skipCableModel() {
  fireEvent.click(await screen.findByRole("button", { name: /Plus tard/ }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /Plus tard/ })).toBeNull());
}

/** Ouvre un menu Radix (le déclencheur s'ouvre au clavier dans happy-dom). */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.localStorage.clear();
  consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("onglet Synoptique", () => {
  test("general_view_lists_locations_and_racks", async () => {
    const { fetchSpy } = await openTab("general", {
      "POST /api/tenant/projects/p1/synoptic/connections": (init) => {
        const b = JSON.parse(String(init?.body)) as {
          from: { rackId: string; slotId: string; connectorIndex: number };
          to: { rackId: string; slotId: string; connectorIndex: number };
        };
        return {
          body: projectConnection(
            "pcg2",
            [b.from.rackId, b.from.slotId, b.from.connectorIndex],
            [b.to.rackId, b.to.slotId, b.to.connectorIndex],
            null,
          ),
        };
      },
    });

    // Blocs : les emplacements (ports externes de tous leurs contenants), puis
    // le contenant « À affecter » sans port.
    expect(screen.getAllByText("Régie").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Plateau").length).toBeGreaterThan(0);
    expect(screen.getByText("Flight 1")).toBeInTheDocument();
    expect(screen.getByText("Contenant · 6U")).toBeInTheDocument();
    expect(screen.getByText("RETOUR 2")).toBeInTheDocument();
    // Mini-en-tête de groupe « CONTENANT · Équipement » d'un bloc emplacement.
    expect(screen.getAllByText(/Baie 1 · Caméra X/i).length).toBeGreaterThan(0);

    // Panneau droit sans sélection : infos du projet (vue Générale).
    const right = within(rightPanel());
    expect(right.getByText("Vue Générale")).toBeInTheDocument();
    expect(right.getByText("Finale Coupe de France")).toBeInTheDocument();

    // Sélecteur de vue : « Général », puis les emplacements avec leurs contenants.
    const selector = screen.getByRole("button", { name: /Général/ });
    openMenu(selector);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("REG · 2 contenants")).toBeInTheDocument();
    expect(within(menu).getByText("PLT · 1 contenant")).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: "Escape" });

    // Câble entre deux emplacements : outil câble (C), port source → port cible.
    act(() => {
      fireEvent.keyDown(window, { key: "c" });
    });
    fireEvent.click(screen.getByText("SORTIE PVW"));
    fireEvent.click(screen.getByText("RETOUR 2"));
    await waitFor(() =>
      expect(
        synopticCalls(fetchSpy).some((c) => c.method === "POST" && c.path === "/api/tenant/projects/p1/synoptic/connections"),
      ).toBe(true),
    );
    const post = synopticCalls(fetchSpy).find(
      (c) => c.method === "POST" && c.path === "/api/tenant/projects/p1/synoptic/connections",
    )!;
    // Indices synthétiques dévirtualisés vers les ports réels (contenant, slot, index).
    expect(post.body).toEqual({
      from: { rackId: "r1", slotId: "s1", connectorIndex: 2 },
      to: { rackId: "r3", slotId: "s7", connectorIndex: 1 },
      color: "#22c55e",
      cableStyle: "ortho",
    });
    expectInSchema(post.body as Record<string, unknown>, PC_CREATE);
    for (const side of ["from", "to"] as const) {
      expectInSchema((post.body as Record<string, Record<string, unknown>>)[side], ENDPOINT);
    }
    await skipCableModel();
    // Retour à la sélection par la barre d'outils (le raccourci V : voir le dernier test).
    fireEvent.click(screen.getByTitle("Sélection (V)"));

    // Sélection d'un bloc emplacement → panneau « Emplacement » → ouvrir la vue du lieu.
    fireEvent.click(screen.getAllByText("Régie").find((el) => el.closest("[data-slot-id]"))!);
    expect(await within(rightPanel()).findByText("Emplacement")).toBeInTheDocument();
    expect(rightPanel()).toHaveTextContent("Marques externes2 ports");
    fireEvent.click(within(rightPanel()).getByRole("button", { name: /Ouvrir cet emplacement/ }));
    expect(await screen.findByText("Caméra X", {}, FIRST_LOAD)).toBeInTheDocument();
    expect(window.localStorage.getItem("project-p1-synoptique-rack")).toBe("loc:l1");

    const paths = synopticCalls(fetchSpy).map((c) => `${c.method} ${c.path}`);
    expect(paths.filter((p) => p === "GET /api/tenant/projects/p1/synoptic/general")).toHaveLength(1);
    expect(paths).toContain("GET /api/tenant/projects/p1/synoptic/location/l1");
    // Ni catalogue central, ni route morte du synoptique projet (décisions 1 et 5).
    expect(paths.filter((p) => /\/api\/admin\//.test(p))).toEqual([]);
    expect(
      paths.filter((p) => /synoptic\/(zones|labels|adapters|bundles|layout|canvas-data|focus)/.test(p)),
    ).toEqual([]);
    // En vue Générale, la vue ne lit le décor que sous son identifiant logique
    // `general:<projet>` (parité arkyo : 404 toléré, aucun rack réel visé).
    for (const p of paths.filter((p) => p.includes("/api/racks/general"))) {
      expect(p).toMatch(/^GET \/api\/racks\/general:p1\/(labels|zones|external-ports)$/);
    }
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("location_view_uses_per_rack_routes", async () => {
    const echoPost =
      (base: Record<string, unknown>, id: string) =>
      (init: RequestInit | undefined): Reply => ({
        body: { ...base, ...(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>), id },
      });
    const { fetchSpy } = await openTab("l1", {
      "POST /api/racks/r1/connections": echoPost(LOCATION.connections[0], "rc2"),
      "POST /api/racks/v1/connections": echoPost({ ...LOCATION.connections[0], rackId: "v1" }, "rc3"),
    });

    // Nœuds : les vrais slots des contenants du lieu, pastille du contenant.
    expect(screen.getByText("Moniteur")).toBeInTheDocument();
    expect(screen.getByText("Mélangeur")).toBeInTheDocument();
    expect(screen.getAllByText(/^régie vidéo$/i).length).toBeGreaterThan(0);

    // Flux SSE : un par contenant du lieu (rack_events.rs), jamais le flux d'un lieu.
    const streams = await vi.waitFor(() => {
      const urls = [...(globalThis.EventSource as unknown as { open: Set<{ url: string }> }).open].map((e) => e.url);
      expect(urls).toEqual(expect.arrayContaining(["/api/racks/r1/events", "/api/racks/r2/events", "/api/racks/v1/events"]));
      return urls;
    });
    expect(streams.filter((u) => u.startsWith("/api/racks/")).every((u) => /^\/api\/racks\/(r1|r2|v1)\/events$/.test(u))).toBe(true);

    // Câble intra-contenant → `POST /api/racks/r1/connections` (schéma CREATE).
    act(() => {
      fireEvent.keyDown(window, { key: "c" });
    });
    fireEvent.click(screen.getByText("SDI 3"));
    fireEvent.click(screen.getByText("MON 2"));
    await waitFor(() =>
      expect(synopticCalls(fetchSpy).some((c) => c.method === "POST" && c.path === "/api/racks/r1/connections")).toBe(true),
    );
    const intra = synopticCalls(fetchSpy).find((c) => c.method === "POST" && c.path === "/api/racks/r1/connections")!;
    expect(intra.body).toEqual({
      fromSlotId: "s1",
      fromConnectorIndex: 2,
      fromAdapterId: null,
      fromAdapterSide: null,
      fromAdapterPortIndex: null,
      fromComponentItemId: null,
      toSlotId: "s2",
      toConnectorIndex: 1,
      toAdapterId: null,
      toAdapterSide: null,
      toAdapterPortIndex: null,
      toComponentItemId: null,
      color: "#22c55e",
      cableStyle: "ortho",
      waypoints: null,
    });
    for (const k of Object.keys(intra.body as object)) expect(RC_CREATE_KEYS).toContain(k);
    await skipCableModel();

    // Câble entre deux contenants du lieu → RackConnection du contenant
    // virtuel du lieu (pivot `v1`). arkyo-server : correction d'un défaut
    // d'arkyo, la route projet refuse deux contenants d'un même lieu (400).
    fireEvent.click(screen.getByText("SDI 4"));
    fireEvent.click(screen.getByText("ENTRÉE 2"));
    await waitFor(() =>
      expect(synopticCalls(fetchSpy).some((c) => c.method === "POST" && c.path === "/api/racks/v1/connections")).toBe(true),
    );
    const cross = synopticCalls(fetchSpy).find((c) => c.method === "POST" && c.path === "/api/racks/v1/connections")!;
    expect(cross.body).toEqual({
      fromSlotId: "s1",
      fromConnectorIndex: 3,
      fromAdapterId: null,
      fromAdapterSide: null,
      fromAdapterPortIndex: null,
      fromComponentItemId: null,
      toSlotId: "s3",
      toConnectorIndex: 1,
      toAdapterId: null,
      toAdapterSide: null,
      toAdapterPortIndex: null,
      toComponentItemId: null,
      color: "#22c55e",
      cableStyle: "ortho",
      waypoints: null,
    });
    for (const k of Object.keys(cross.body as object)) expect(RC_CREATE_KEYS).toContain(k);
    expect(
      synopticCalls(fetchSpy).some((c) => c.method === "POST" && c.path === "/api/tenant/projects/p1/synoptic/connections"),
    ).toBe(false);
    await skipCableModel();
    // Retour à la sélection par la barre d'outils (le raccourci V : voir le dernier test).
    fireEvent.click(screen.getByTitle("Sélection (V)"));

    // Style de tracé depuis le panneau du câble : la liaison inter-contenants
    // part sur la route projet, le câble interne sur la route de SON contenant.
    fireEvent.click(cablePaths()[1]);
    expect(await within(rightPanel()).findByText("V-001")).toBeInTheDocument();
    fireEvent.click(within(rightPanel()).getByRole("button", { name: "Arrondi" }));
    await waitFor(() =>
      expect(
        synopticCalls(fetchSpy).some((c) => c.method === "PATCH" && c.path === "/api/tenant/projects/p1/synoptic/connections/pc1"),
      ).toBe(true),
    );
    const pcPatch = synopticCalls(fetchSpy).find(
      (c) => c.method === "PATCH" && c.path === "/api/tenant/projects/p1/synoptic/connections/pc1",
    )!;
    expect(pcPatch.body).toEqual({ cableStyle: "rounded" });
    expectInSchema(pcPatch.body as Record<string, unknown>, PC_PATCH);

    fireEvent.click(cablePaths()[0]);
    await waitFor(() => expect(within(rightPanel()).queryByText("V-001")).toBeNull());
    fireEvent.click(within(rightPanel()).getByRole("button", { name: "Flèches" }));
    await waitFor(() =>
      expect(synopticCalls(fetchSpy).some((c) => c.method === "PATCH" && c.path === "/api/racks/r1/connections/rc1")).toBe(true),
    );
    const rcPatch = synopticCalls(fetchSpy).find((c) => c.method === "PATCH" && c.path === "/api/racks/r1/connections/rc1")!;
    expect(rcPatch.body).toEqual({ cableStyle: "arrow" });

    // Adaptateur : libellé depuis son panneau → `PATCH` sur le contenant de l'adaptateur (r2).
    // Sélection au pointeur (outil Sélection) : `pointerdown` sur le nœud, puis `pointerup`.
    const adapter = document.querySelector<SVGGElement>('g[data-adapter="true"] > g')!;
    fireEvent.pointerDown(adapter, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window);
    const input = await within(rightPanel()).findByPlaceholderText("Convertisseur BNC");
    fireEvent.change(input, { target: { value: "conv 1" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(synopticCalls(fetchSpy).some((c) => c.method === "PATCH" && c.path === "/api/racks/r2/adapters/ad1")).toBe(true),
    );
    const adPatch = synopticCalls(fetchSpy).find((c) => c.method === "PATCH" && c.path === "/api/racks/r2/adapters/ad1")!;
    // Le champ du panneau met le libellé en capitales.
    expect(adPatch.body).toEqual({ label: "CONV 1" });
    expectInSchema(adPatch.body as Record<string, unknown>, ADAPTER_UPDATE);

    // Décor (zones, libellés) : porté par le contenant virtuel du lieu (pivot).
    act(() => {
      useTopbarActions.getState().onRenameLayerItem?.("z1", "zone", "Régie son");
    });
    await waitFor(() =>
      expect(synopticCalls(fetchSpy).some((c) => c.method === "PATCH" && c.path === "/api/racks/v1/zones/z1")).toBe(true),
    );
    expect(
      (synopticCalls(fetchSpy).find((c) => c.method === "PATCH" && c.path === "/api/racks/v1/zones/z1")!.body as {
        label: string;
      }).label,
    ).toBe("Régie son");

    // Toutes les routes visées existent côté Rust, sur un contenant réel du lieu.
    for (const c of synopticCalls(fetchSpy)) {
      expect(`${c.method} ${c.path}`).toMatch(
        /^(GET \/api\/tenant\/catalogue\/adapters|GET \/api\/tenant\/projects\/p1\/synoptic\/location\/l1|(POST|PATCH|DELETE) \/api\/tenant\/projects\/p1\/synoptic\/connections(\/pc\d)?|(GET|POST|PATCH|DELETE) \/api\/racks\/(r1|r2|v1)\/(connections|zones|labels|external-ports|adapters|bundles|panel-rows)(\/[a-z0-9]+)?)$/,
      );
    }
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("multi_select_and_undo_redo", async () => {
    const { fetchSpy } = await openTab("l1");

    // Multi-sélection d'équipements (Maj+clic) : deux contenants distincts.
    fireEvent.click(screen.getByText("Caméra X"));
    fireEvent.click(screen.getByText("Mélangeur"), { shiftKey: true });
    const right = within(rightPanel());
    expect(await right.findByText("2 équipements")).toBeInTheDocument();
    // Compteurs « Équipements » et « Contenants » (Caméra X dans r1, Mélangeur dans r2).
    expect(rightPanel()).toHaveTextContent("Équipements2Contenants2");

    // Multi-sélection de câbles (Maj+clic) : un câble de contenant, une liaison projet.
    fireEvent.click(cablePaths()[0]);
    fireEvent.click(cablePaths()[1], { shiftKey: true });
    expect(await right.findByText(/2 câbles/)).toBeInTheDocument();
    fireEvent.click(right.getByRole("button", { name: "Arrondi" }));
    await waitFor(() => {
      const patches = synopticCalls(fetchSpy).filter((c) => c.method === "PATCH");
      expect(patches.map((c) => c.path).sort()).toEqual([
        "/api/racks/r1/connections/rc1",
        "/api/tenant/projects/p1/synoptic/connections/pc1",
      ]);
      for (const p of patches) expect(p.body).toEqual({ cableStyle: "rounded" });
    });
    expect(useTopbarActions.getState().historyByWs.synoptic.canUndo).toBe(true);

    // Annuler / rétablir (Ctrl+Z, Ctrl+Maj+Z) : la vue lieu agrège plusieurs
    // contenants, l'historique y reste local (parité arkyo) : aucune requête.
    const before = fetchSpy.mock.calls.length;
    act(() => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    });
    await waitFor(() => expect(useTopbarActions.getState().historyByWs.synoptic.canRedo).toBe(true));
    act(() => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    });
    await waitFor(() => expect(useTopbarActions.getState().historyByWs.synoptic.canRedo).toBe(false));
    expect(useTopbarActions.getState().historyByWs.synoptic.canUndo).toBe(true);
    expect(synopticCalls(fetchSpy, before)).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("validation_panel_shows_checks", async () => {
    await openTab("l1");

    // Barre d'actions : compteurs du rapport (rack-validation, 11 contrôles).
    await waitFor(() => expect(useTopbarActions.getState().validationReport).not.toBeNull());
    const report = useTopbarActions.getState().validationReport!;
    expect(report.issues.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTitle("Validation synoptique"));
    const right = within(rightPanel());
    // Câble interne sans numéro, adaptateur posé sans câble.
    expect(
      await right.findByText("Ce câble n'a pas de label. Lancer la renumérotation ou saisir un label manuel."),
    ).toBeInTheDocument();
    expect(right.getByText("Un adaptateur est posé mais n'est connecté à aucun câble.")).toBeInTheDocument();
    expect(right.getByRole("button", { name: /Tous/ })).toHaveTextContent(String(report.issues.length));

    // « Exporter » (pied du panneau) : modal d'export partagé (Task 13, détail
    // dans synoptique-export.test.tsx).
    fireEvent.click(screen.getByTitle("Exporter"));
    const exportDialog = await screen.findByRole("dialog");
    expect(within(exportDialog).getByText("Exporter le synoptique")).toBeInTheDocument();
    fireEvent.click(within(exportDialog).getAllByRole("button", { name: "Fermer" })[0]);
    await waitFor(() => expect(screen.queryByText("Exporter le synoptique")).toBeNull());

    // Retour à la vue Générale : le rapport du lieu disparaît, remplacé par
    // celui de la vue Générale (ses blocs et liaisons inter-emplacements).
    openMenu(screen.getByRole("button", { name: /Régie/ }));
    fireEvent.click(within(await screen.findByRole("menu")).getByText("Général"));
    await screen.findByText("SORTIE PGM", {}, FIRST_LOAD);
    await waitFor(() =>
      expect(
        useTopbarActions.getState().validationReport?.issues.some((i) => i.message.includes("adaptateur")) ?? false,
      ).toBe(false),
    );
    expect(right.queryByText("Un adaptateur est posé mais n'est connecté à aucun câble.")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  // arkyo-server : correction d'un défaut d'arkyo. En vue lieu, la touche V
  // valait « Sélection » pour la barre d'outils du shell et « Déplacer » pour
  // la `SynopticView` ; avec `onToolChange` branché, le pont d'outil du
  // tab-client et la vue se renvoyaient l'outil sans fin (« Maximum update
  // depth exceeded »). La vue suit désormais le shell quand le parent pilote
  // l'outil. La vue Générale ne passe pas `onToolChange` et n'est pas touchée.
  test("v_shortcut_in_location_view_settles_on_select", async () => {
    await openTab("l1");
    act(() => {
      fireEvent.keyDown(window, { key: "c" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "v" });
    });
    await waitFor(() => expect(screen.getByTitle("Sélection (V)")).toBeInTheDocument());
    // L'outil retenu par le shell est bien « Sélection ».
    await waitFor(() => expect(screen.getByTitle("Sélection (V)").className).toContain("text-[var(--accent-strong)]"));
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("project_sync_refetches_on_server_events_only", async () => {
    const { fetchSpy } = await openTab("l1");
    const reads = () =>
      synopticCalls(fetchSpy).filter((c) => c.path === "/api/tenant/projects/p1/synoptic/location/l1").length;
    expect(reads()).toBe(1);

    // Entités publiées par le serveur Rust pour ce projet → relecture du lieu.
    emitAppEvent({ type: "update", entity: "rackConnection", action: "created", id: "rcx", projectId: "p1", rackId: "r1" });
    await waitFor(() => expect(reads()).toBe(2));
    emitAppEvent({ type: "update", entity: "project_synoptic_connection", action: "deleted", id: "pcx", projectId: "p1" });
    await waitFor(() => expect(reads()).toBe(3));

    // Catalogue local et signaux (décision 5) : pas dans les filtres d'arkyo,
    // aucune relecture, et jamais `/api/admin/signals*`.
    emitAppEvent({ type: "update", entity: "tenant_catalogue", action: "updated", id: "eq1" });
    emitAppEvent({ type: "update", entity: "tenant_parametres_signals", action: "updated", id: "sg1" });
    emitAppEvent({ type: "update", entity: "rackConnection", action: "created", id: "x", projectId: "autre" });
    await new Promise((r) => setTimeout(r, 300));
    expect(reads()).toBe(3);
    expect(synopticCalls(fetchSpy).filter((c) => c.path.startsWith("/api/admin/"))).toEqual([]);
  });
});

// ── Côté serveur : les entités du catalogue central ne sont jamais émises ──

function rustSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return rustSources(p);
    return p.endsWith(".rs") ? [p] : [];
  });
}

test("admin_signal_fetches_stay_unreachable", () => {
  // `synoptique-tab-client.tsx` (copie d'arkyo) relit `/api/admin/signals` et
  // `/api/admin/signal-categories` sur les entités `signal` / `signal_category`
  // / `signalCategory`, et se rafraîchit sur `catalog` : le serveur Rust ne
  // publie aucune de ces entités (décision 5 de la 4c).
  const src = resolve(__dirname, "../../../../../crates/arkyo-server/src");
  const files = rustSources(src);
  expect(files.length).toBeGreaterThan(20);
  const entity = /"(signal|signal_category|signalCategory|catalog)"/;
  const publish = new RegExp(`publish(_meta)?\\(\\s*${entity.source}`);
  const constant = new RegExp(`:\\s*&str\\s*=\\s*${entity.source}`);
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    expect(publish.test(text), f).toBe(false);
    expect(constant.test(text), f).toBe(false);
  }
});
