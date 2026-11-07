/**
 * arkyo-server: phase 4c (Task 11) : vue synoptique (copie d'arkyo).
 *
 * Données « réelles » d'un rack : les lignes que renvoient les routes Rust
 * (colonnes de `RackSlot`, `RackConnection`, `RackZone`, `RackLabel` de la
 * migration 0004, `equipment` enrichi comme `synoptic/focus_payload.rs`).
 *
 * - `synoptic_view_mounts_without_console_error` : montage sans erreur en
 *   console, nœuds et décor affichés, flux SSE du rack ouvert, faisceaux lus
 *   par `GET /api/racks/:id/bundles` (rack_objects.rs).
 * - `draw_cable_posts_connection` : outil câble (touche C), clic sur deux
 *   ports → `POST /api/racks/:id/connections` ; le corps est dans le schéma
 *   `CREATE` de rack_connections.rs.
 * - `rack_stream_updates_view` : évènements du flux `GET /api/racks/:id/events`
 *   (rack_events.rs) tels que les publie `rack_payload` (rack_objects.rs) :
 *   `connection_added {connection}`, `zone_updated {zone}`,
 *   `label_removed {labelId}`.
 * - `zone_and_label_patch_bodies_match_rust_schemas` : renommage depuis le
 *   panneau des calques (poignée du shell) → `PATCH /api/racks/:id/zones/:id`
 *   et `PATCH /api/racks/:id/labels/:id`, corps comparés à `ZONE_UPDATE` et
 *   `LABEL_UPDATE` (rack_objects.rs).
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import type {
  ConnectorTypeInfo,
  DbLabel,
  DbZone,
  RackConnection,
  RackSlotWithEquipment,
} from "@/components/synoptique/types/synoptic";
import { SynopticView } from "./synoptic-view";

// ── Harnais : fetch et EventSource ──────────────────────────────────────────

type Call = { url: string; method: string; body: unknown; headers: Headers };
let calls: Call[];
let routes: Record<string, (body: unknown) => unknown>;
let consoleError: ReturnType<typeof vi.spyOn>;

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

class FakeEventSource {
  static all: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  close() {
    this.closed = true;
  }
  /** Une trame `data: <payload>` du flux par rack. */
  emit(data: unknown) {
    act(() => {
      this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
    });
  }
}

beforeEach(() => {
  calls = [];
  routes = {};
  FakeEventSource.all = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body, headers: new Headers(init?.headers) });
      const handler = routes[`${method} ${url}`];
      if (handler) return json(handler(body));
      if (method === "GET") return json([]);
      return json({ ok: true });
    }),
  );
  consoleError = vi.spyOn(console, "error");
  try {
    localStorage.clear();
  } catch {}
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Données d'un rack, telles que le serveur les renvoie ────────────────────

const RACK = "ck_rack_regie";
const NOW = "2026-11-07T10:00:00.000Z";

/** `RackSlot` (colonnes SLOT_COLS d'enrich.rs) + `equipment` / `components` / `panel` enrichis. */
function slotRow(
  id: string,
  startU: number,
  synopticX: number,
  synopticY: number,
  equipment: RackSlotWithEquipment["equipment"],
): RackSlotWithEquipment {
  return {
    id,
    rackId: RACK,
    catalogEquipmentId: equipment?.id ?? null,
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
    synopticX,
    synopticY,
    createdAt: NOW,
    updatedAt: NOW,
    equipmentId: equipment?.id ?? null,
    equipment,
    components: [],
    panel: null,
    attachedAdapters: [],
  } as RackSlotWithEquipment;
}

function equipmentRow(id: string, name: string, connectors: unknown[]) {
  return {
    id,
    name,
    reference: null,
    category: "Vidéo",
    heightU: 1,
    weight: null,
    powerW: null,
    depthMm: null,
    imageUrl: null,
    connectors,
    brand: { id: "ck_brand_bm", name: "Blackmagic" },
  };
}

const connectorTypes: ConnectorTypeInfo[] = [
  { id: "ck_ct_bnc", name: "BNC", version: null, iconId: "bnc", color: "#0ea5e9", category: "Vidéo" },
];
const signals = [{ name: "SDI", color: "#22c55e", cablePrefix: "V", cableSuffix: null, category: "Vidéo" }];

const slots: RackSlotWithEquipment[] = [
  slotRow(
    "ck_slot_cam",
    1,
    40,
    40,
    equipmentRow("ck_eq_cam", "Convertisseur", [
      { connectorTypeId: "ck_ct_bnc", quantity: 1, direction: "OUT", signalName: "SDI", label: "SORTIE PGM" },
      { connectorTypeId: "ck_ct_bnc", quantity: 1, direction: "OUT", signalName: "SDI", label: "SORTIE PVW" },
    ]),
  ),
  slotRow(
    "ck_slot_mix",
    2,
    520,
    40,
    equipmentRow("ck_eq_mix", "Mélangeur", [
      { connectorTypeId: "ck_ct_bnc", quantity: 1, direction: "IN", signalName: "SDI", label: "ENTRÉE 1" },
      { connectorTypeId: "ck_ct_bnc", quantity: 1, direction: "IN", signalName: "SDI", label: "ENTRÉE 2" },
    ]),
  ),
];

/** `RackConnection` (migration 0004), tel que `GET /api/racks/:id/connections` le renvoie. */
function connectionRow(id: string, from: number, to: number, label: string | null) {
  return {
    id,
    rackId: RACK,
    fromSlotId: "ck_slot_cam",
    fromConnectorIndex: from,
    fromAdapterId: null,
    fromAdapterSide: null,
    fromAdapterPortIndex: null,
    fromComponentItemId: null,
    toSlotId: "ck_slot_mix",
    toConnectorIndex: to,
    toAdapterId: null,
    toAdapterSide: null,
    toAdapterPortIndex: null,
    toComponentItemId: null,
    label,
    color: "#22c55e",
    waypoints: null,
    cableStyle: "rounded",
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

const zone: DbZone = {
  id: "ck_zone_1",
  rackId: RACK,
  label: "Régie vidéo",
  labelPosition: "top-left",
  color: "#6366f1",
  x: 10,
  y: 10,
  w: 900,
  h: 300,
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
} as DbZone;

const label: DbLabel = {
  id: "ck_label_1",
  rackId: RACK,
  text: "PLATEAU A",
  x: 60,
  y: 360,
  fontSize: 14,
  width: null,
  color: "#111827",
  fontWeight: "normal",
  fontFamily: null,
  fontStyle: "normal",
  textDecoration: "none",
  pill: false,
  pillBg: null,
  pillRadius: 12,
  createdAt: NOW,
  updatedAt: NOW,
} as DbLabel;

function mountView(extra: Partial<React.ComponentProps<typeof SynopticView>> = {}) {
  return render(
    <div style={{ width: 1280, height: 800 }}>
      <SynopticView
        rackId={RACK}
        rackName="Régie"
        slots={slots}
        connectorTypes={connectorTypes}
        initialConnections={[connectionRow("ck_conn_1", 0, 0, "V-001") as RackConnection]}
        initialZones={[zone]}
        initialLabels={[label]}
        initialPanelRows={[]}
        initialAdapters={[]}
        initialExternalPorts={[]}
        signals={signals}
        {...extra}
      />
    </div>,
  );
}

// ── Schémas Rust (rack_connections.rs, rack_objects.rs) ─────────────────────

/** `CREATE` de rack_connections.rs (createSchema de connections/route.ts). */
const CONNECTION_CREATE_KEYS = [
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

/** `ZONE_UPDATE` de rack_objects.rs : clé → contrôle de type. */
const isInt = (v: unknown) => Number.isInteger(v);
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown) => typeof v === "string";
const ZONE_UPDATE: Record<string, (v: unknown) => boolean> = {
  label: isStr,
  labelPosition: isStr,
  color: isStr,
  x: isNum,
  y: isNum,
  w: isNum,
  h: isNum,
  borderRadius: (v) => isInt(v) && (v as number) >= 0 && (v as number) <= 24,
  borderWidth: (v) => isInt(v) && (v as number) >= 0 && (v as number) <= 6,
  borderStyle: (v) => v === "solid" || v === "dashed" || v === "dotted",
  opacity: (v) => isNum(v) && (v as number) >= 0 && (v as number) <= 1,
  labelFontSize: isInt,
  labelFontWeight: isStr,
  labelFontStyle: isStr,
  labelTextDecoration: isStr,
  labelFontFamily: (v) => v === null || isStr(v),
};

/** `LABEL_UPDATE` de rack_objects.rs. */
const LABEL_UPDATE: Record<string, (v: unknown) => boolean> = {
  text: isStr,
  x: isNum,
  y: isNum,
  fontSize: isInt,
  width: (v) => v === null || isNum(v),
  color: isStr,
  fontWeight: isStr,
  fontFamily: (v) => v === null || isStr(v),
  fontStyle: (v) => v === "normal" || v === "italic",
  textDecoration: (v) => v === "none" || v === "underline" || v === "line-through",
  pill: (v) => typeof v === "boolean",
  pillBg: (v) => v === null || isStr(v),
  pillRadius: (v) => isInt(v) && (v as number) >= 0 && (v as number) <= 64,
};

function expectInSchema(body: Record<string, unknown>, schema: Record<string, (v: unknown) => boolean>) {
  for (const [k, v] of Object.entries(body)) {
    expect(Object.keys(schema), `clé ${k} hors schéma`).toContain(k);
    expect(schema[k](v), `${k} = ${JSON.stringify(v)}`).toBe(true);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("synoptic_view_mounts_without_console_error", async () => {
  routes[`GET /api/racks/${RACK}/bundles`] = () => [
    { id: "ck_bundle_1", rackId: RACK, name: "Faisceau PGM", color: "#f59e0b", cableIds: ["ck_conn_1"], createdAt: NOW, updatedAt: NOW },
  ];
  mountView();

  // Nœuds (équipements et leurs ports), décor (zone, label) et numéro de câble.
  expect(await screen.findByText("Convertisseur")).toBeInTheDocument();
  expect(screen.getByText("Mélangeur")).toBeInTheDocument();
  expect(screen.getByText("SORTIE PGM")).toBeInTheDocument();
  expect(screen.getByText("ENTRÉE 2")).toBeInTheDocument();
  // Le nom de zone est rendu en capitales.
  expect(screen.getAllByText(/^régie vidéo$/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText("PLATEAU A").length).toBeGreaterThan(0);

  // Flux SSE du rack (routes Rust) et faisceaux lus au montage.
  expect(FakeEventSource.all.map((e) => e.url)).toEqual([`/api/racks/${RACK}/events`]);
  await waitFor(() => expect(calls.some((c) => c.url === `/api/racks/${RACK}/bundles`)).toBe(true));
  await waitFor(() => expect(useTopbarActions.getState().synopticBundles?.length ?? 0).toBe(1));

  // Seules des routes portées par le serveur Rust sont appelées.
  for (const c of calls) expect(c.url).toMatch(new RegExp(`^/api/racks/${RACK}/(bundles|zones|labels|external-ports|adapters|panel-rows|connections)`));
  expect(consoleError).not.toHaveBeenCalled();
});

test("draw_cable_posts_connection", async () => {
  routes[`POST /api/racks/${RACK}/connections`] = (body) => ({
    ...connectionRow("ck_conn_new", 1, 1, null),
    ...(body as Record<string, unknown>),
    id: "ck_conn_new",
  });
  const onConnectionsChange = vi.fn();
  mountView({ onConnectionsChange });
  await screen.findByText("SORTIE PVW");

  // Outil câble (raccourci C), puis clic source → clic destination.
  act(() => {
    fireEvent.keyDown(window, { key: "c" });
  });
  fireEvent.click(screen.getByText("SORTIE PVW"));
  fireEvent.click(screen.getByText("ENTRÉE 2"));

  await waitFor(() =>
    expect(calls.some((c) => c.method === "POST" && c.url === `/api/racks/${RACK}/connections`)).toBe(true),
  );
  const post = calls.find((c) => c.method === "POST" && c.url === `/api/racks/${RACK}/connections`)!;
  // Extrémités dévirtualisées (`devirtualizeEndpoint`) : port d'équipement,
  // champs d'adaptateur et de composant à null ; couleur du signal SDI.
  expect(post.body).toEqual({
    fromSlotId: "ck_slot_cam",
    fromConnectorIndex: 1,
    fromAdapterId: null,
    fromAdapterSide: null,
    fromAdapterPortIndex: null,
    fromComponentItemId: null,
    toSlotId: "ck_slot_mix",
    toConnectorIndex: 1,
    toAdapterId: null,
    toAdapterSide: null,
    toAdapterPortIndex: null,
    toComponentItemId: null,
    color: "#22c55e",
    cableStyle: "ortho",
    waypoints: null,
  });
  for (const k of Object.keys(post.body as object)) expect(CONNECTION_CREATE_KEYS).toContain(k);
  expect(post.headers.get("X-Client-Id")).toBeTruthy();

  // Le câble créé rejoint l'état de la vue.
  await waitFor(() =>
    expect(
      onConnectionsChange.mock.calls.some(([list]) => (list as RackConnection[]).some((c) => c.id === "ck_conn_new")),
    ).toBe(true),
  );
  expect(consoleError).not.toHaveBeenCalled();
});

test("rack_stream_updates_view", async () => {
  const onConnectionsChange = vi.fn();
  mountView({ onConnectionsChange });
  await screen.findByText("Convertisseur");
  const es = FakeEventSource.all[0];
  expect(es.url).toBe(`/api/racks/${RACK}/events`);

  // connection_added { connection } (rack_connections.rs, `rack_payload`).
  es.emit({ type: "connection_added", connection: connectionRow("ck_conn_remote", 1, 1, "V-002") });
  await waitFor(() =>
    expect(
      onConnectionsChange.mock.calls.some(([list]) =>
        (list as RackConnection[]).some((c) => c.id === "ck_conn_remote" && c.label === "V-002"),
      ),
    ).toBe(true),
  );

  // zone_updated { zone } : le nouveau nom s'affiche.
  es.emit({ type: "zone_updated", zone: { ...zone, label: "Régie son" } });
  expect((await screen.findAllByText(/^régie son$/i)).length).toBeGreaterThan(0);
  expect(screen.queryByText(/^régie vidéo$/i)).toBeNull();

  // label_removed { labelId } : le label quitte le canvas (le `<span>` caché
  // de mesure du texte, posé sur `body`, n'est pas le label).
  const labelNode = () => document.querySelector(`[data-canvas-label][data-label-id="${label.id}"]`);
  expect(labelNode()).not.toBeNull();
  es.emit({ type: "label_removed", labelId: label.id });
  await waitFor(() => expect(labelNode()).toBeNull());

  // Démontage : le flux est fermé.
  cleanup();
  expect(es.closed).toBe(true);
  expect(consoleError).not.toHaveBeenCalled();
});

test("zone_and_label_patch_bodies_match_rust_schemas", async () => {
  mountView();
  await screen.findByText("Convertisseur");
  const rename = useTopbarActions.getState().onRenameLayerItem;
  expect(rename).toBeTypeOf("function");

  act(() => rename!(zone.id, "zone", "Régie son"));
  act(() => rename!(label.id, "label", "PLATEAU B"));

  await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2));
  const zonePatch = calls.find((c) => c.method === "PATCH" && c.url === `/api/racks/${RACK}/zones/${zone.id}`)!;
  const labelPatch = calls.find((c) => c.method === "PATCH" && c.url === `/api/racks/${RACK}/labels/${label.id}`)!;

  // Zone : l'objet entier (sans id, rackId ni dates), dans ZONE_UPDATE.
  expect(zonePatch.body).toEqual({
    label: "Régie son",
    labelPosition: "top-left",
    color: "#6366f1",
    x: 10,
    y: 10,
    w: 900,
    h: 300,
    borderRadius: 8,
    borderWidth: 2,
    borderStyle: "solid",
    opacity: 0.12,
    labelFontSize: 12,
    labelFontWeight: "normal",
    labelFontStyle: "normal",
    labelTextDecoration: "none",
    labelFontFamily: null,
  });
  expectInSchema(zonePatch.body as Record<string, unknown>, ZONE_UPDATE);

  // Label : tous les champs sauf `width`, dans LABEL_UPDATE.
  expect(labelPatch.body).toEqual({
    text: "PLATEAU B",
    x: 60,
    y: 360,
    fontSize: 14,
    color: "#111827",
    fontWeight: "normal",
    fontFamily: null,
    fontStyle: "normal",
    textDecoration: "none",
    pill: false,
    pillBg: null,
    pillRadius: 12,
  });
  expectInSchema(labelPatch.body as Record<string, unknown>, LABEL_UPDATE);

  for (const c of [zonePatch, labelPatch]) expect(c.headers.get("X-Client-Id")).toBeTruthy();
  expect(consoleError).not.toHaveBeenCalled();
});
