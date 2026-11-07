/**
 * arkyo-server: phase 4c (Task 10) : composants du synoptique 2/2.
 *
 * - `renumber_dialog_posts_and_shows_result` : le dialogue de numérotation
 *   d'arkyo ne fait pas la requête lui-même ; il remet la convention et la
 *   direction à `onConfirm` (et l'override perso à `onSaveOverride`).
 *   `synoptic-view` (Task 11) les passe à `cabling.renumber`
 *   (`POST /api/racks/:id/renumber`) et à `cabling.patchRackConfig`
 *   (`PATCH /api/racks/:id { numberingOverride }`), puis affiche le nombre de
 *   câbles numérotés. Le harnais reproduit ce branchement avec la vraie
 *   poignée (`defaultRackCablingAdapter`) ; les corps restent dans les
 *   schémas Rust (rack_renumber.rs `parse_auto` / `parse_override`,
 *   racks.rs `numberingOverride`).
 * - `audit_panel_lists_entries` : `GET /api/racks/:id/audit?limit=150` et
 *   `GET /api/tenant/projects/:id/audit?limit=150` (audit_read.rs), lignes
 *   brutes d'`AuditLog` comme le serveur les renvoie.
 * - `cable_model_picker_uses_cable_models` : dialogue et picker lisent
 *   `GET /api/tenant/parametres/cable-models` (parametres/cabling.rs) et
 *   rendent un `TenantCableModel.id` (4c, décision 2).
 * Plus le rendu des autres composants copiés : calques, mini-map, règles,
 * picker d'adaptateur de port, faisceaux et rapport de validation.
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import type { AdapterOption, SynopticLayerItem } from "@/components/editor-shell/topbar-actions-context";
import { defaultRackCablingAdapter } from "@/components/synoptique/lib/cabling-api";
import type { CableNumberingConfig } from "@/lib/services/cable-numbering";
import { validateRack } from "@/lib/services/rack-validation";
import { SynopticRenumberDialog } from "./synoptic-renumber-dialog";
import type { NumberingDirection } from "./synoptic-renumber-dialog";
import { AuditPanelContent } from "./audit-panel";
import { SynopticCableModelDialog } from "./synoptic-cable-model-dialog";
import { SynopticCableModelPicker } from "./synoptic-cable-model-picker";
import { SynopticLayersPanel } from "./synoptic-layers-panel";
import { SynopticMiniMap } from "./synoptic-mini-map";
import { SynopticRulers } from "./synoptic-rulers";
import { PortAdapterPicker } from "./port-adapter-picker";
import { SynopticBundlesSection } from "./synoptic-bundles-section";
import { ValidationPanelContent } from "./validation-panel";

type Call = { url: string; method: string; body: unknown; headers: Headers };
let calls: Call[];
let routes: Record<string, unknown>;
let consoleError: ReturnType<typeof vi.spyOn>;

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        headers: new Headers(init?.headers),
      });
      const key = `${method} ${url}`;
      if (key in routes) return json(routes[key]);
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

function expectNoConsoleError() {
  expect(consoleError).not.toHaveBeenCalled();
}

// ── renumber_dialog_posts_and_shows_result ──────────────────────────────────

/** Défauts admin tels que `synoptique-tab-client` les tire d'AppConfig. */
const ADMIN: CableNumberingConfig = {
  pad: 5,
  sep1: "-",
  sep2: "",
  includeRack: true,
  template: "",
  templateEnabled: false,
};

/** Clés acceptées par `parse_override` (rack_renumber.rs) : le reste est retiré. */
const OVERRIDE_KEYS = [
  "includeRack",
  "pad",
  "sep1",
  "sep2",
  "template",
  "templateEnabled",
  "includeZone",
  "separator",
  "suffixSeparator",
];

function expectOverrideInRustSchema(o: Record<string, unknown>) {
  for (const k of Object.keys(o)) expect(OVERRIDE_KEYS).toContain(k);
  expect(Number.isInteger(o.pad)).toBe(true);
  expect(o.pad as number).toBeGreaterThanOrEqual(1);
  expect(o.pad as number).toBeLessThanOrEqual(10);
  for (const k of ["sep1", "sep2"]) {
    if (k in o) expect(typeof o[k] === "string" && (o[k] as string).length <= 5).toBe(true);
  }
  for (const k of ["includeRack", "templateEnabled"]) {
    if (k in o) expect(typeof o[k]).toBe("boolean");
  }
}

/**
 * Branchement de `synoptic-view` (arkyo:synoptic-view.tsx, `confirmRenumber`
 * et `handleSaveOverride`) réduit à l'essentiel : ordre et côtés déjà
 * calculés, toast remplacé par une ligne de statut.
 */
function RenumberHarness(props: { scope?: "all" | "selection"; selected?: string[] }) {
  const cabling = defaultRackCablingAdapter("rack-1");
  const [only, setOnly] = useState(true);
  const [override, setOverride] = useState<Partial<CableNumberingConfig> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dir, setDir] = useState<NumberingDirection | null>(null);
  const isSelection = props.scope === "selection";
  return (
    <>
      <SynopticRenumberDialog
        rackId="rack-1"
        rackCableCode="RK01"
        rackOverride={override}
        adminDefaults={ADMIN}
        scope={props.scope}
        selectedCount={props.selected?.length}
        examples={[]}
        equipOrder={[]}
        onEquipOrderChange={() => {}}
        onlyUnlabelled={only}
        onOnlyUnlabelledChange={setOnly}
        onCancel={() => setStatus("annulé")}
        onConfirm={async (cfg, direction) => {
          setDir(direction ?? null);
          const ids = props.selected ?? ["conn-1", "conn-2"];
          const updated = await cabling.renumber({
            orderedIds: ids,
            sideMap: Object.fromEntries(ids.map((id, i) => [id, i % 2 ? "right" : "left"])),
            onlyUnlabelled: isSelection ? false : only,
            ...(isSelection ? { partial: true } : {}),
            ...(cfg ? { override: cfg } : {}),
          });
          const labelled = updated.filter((c) => (c as { label?: string | null }).label).length;
          setStatus(`${labelled} câble${labelled > 1 ? "s" : ""} numéroté${labelled > 1 ? "s" : ""}`);
        }}
        onSaveAndConfirm={() => {}}
        onSaveOverride={async (o) => {
          await cabling.patchRackConfig({ numberingOverride: o });
          setOverride(o);
        }}
        onResetToAdmin={() => {}}
      />
      {status && <p role="status">{status}</p>}
      {dir && <p data-testid="dir">{`${dir.horizontal}/${dir.vertical}`}</p>}
    </>
  );
}

describe("renumber_dialog_posts_and_shows_result", () => {
  beforeEach(() => {
    routes["POST /api/racks/rack-1/renumber"] = [
      { id: "conn-1", rackId: "rack-1", label: "RK01-V10001" },
      { id: "conn-2", rackId: "rack-1", label: "RK01-V20001" },
      { id: "conn-3", rackId: "rack-1", label: null },
    ];
  });

  test("convention admin : aperçu, POST /renumber dans le schéma Rust, résultat affiché", async () => {
    render(<RenumberHarness />);
    // Aperçu de la convention admin : rack, sép. 1, préfixe, direction + séquence, suffixe.
    expect(screen.getByText("RK01").closest("code")?.textContent).toBe("RK01-V10001HD");
    // Les défauts sont fournis : le dialogue ne relit pas /api/admin/config.
    expect(calls).toEqual([]);

    // Ordre de numérotation (droite → gauche), mémorisé par rack.
    const horizontal = screen.getByText("Horizontal").parentElement!;
    fireEvent.click(within(horizontal).getAllByRole("button")[1]);
    expect(JSON.parse(localStorage.getItem("numbering-dir-rack-1")!)).toEqual({
      horizontal: "rtl",
      vertical: "ttb",
    });
    // Tous les câbles, pas seulement les non numérotés.
    fireEvent.click(screen.getByText("Seulement les câbles non numérotés"));

    fireEvent.click(screen.getByRole("button", { name: /^Numéroter$/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("2 câbles numérotés");
    expect(screen.getByTestId("dir")).toHaveTextContent("rtl/ttb");

    // Pas de convention perso : pas de PATCH du rack, un seul POST.
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/racks/rack-1/renumber"]);
    const post = calls[0];
    expect(post.headers.get("X-Client-Id")).toBeTruthy();
    expect(post.body).toEqual({
      orderedIds: ["conn-1", "conn-2"],
      sideMap: { "conn-1": "left", "conn-2": "right" },
      onlyUnlabelled: false,
      override: ADMIN,
    });
    expectOverrideInRustSchema((post.body as { override: Record<string, unknown> }).override);
    expectNoConsoleError();
  });

  test("convention locale : PATCH du rack { numberingOverride } puis POST avec le gabarit", async () => {
    render(<RenumberHarness />);
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("Ce synoptique uniquement")).toBeInTheDocument();
    // Séparateur 1 → « . »
    const sep1 = screen.getByText(/Séparateur 1/).parentElement!;
    fireEvent.click(within(sep1).getByRole("button", { name: "." }));

    fireEvent.click(screen.getByRole("button", { name: /^Numéroter$/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("2 câbles numérotés");

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "PATCH /api/racks/rack-1",
      "POST /api/racks/rack-1/renumber",
    ]);
    const template = "{rack}{sep1}{prefix}{dir}{seq}{sep2}{suffix}";
    const saved = (calls[0].body as { numberingOverride: Record<string, unknown> }).numberingOverride;
    expect(saved).toEqual({ ...ADMIN, sep1: ".", template, templateEnabled: true, includeRack: true });
    expectOverrideInRustSchema(saved);
    const override = (calls[1].body as { override: Record<string, unknown> }).override;
    expect(override).toEqual(saved);
    expect((calls[1].body as { onlyUnlabelled: boolean }).onlyUnlabelled).toBe(true);
    expectNoConsoleError();
  });

  test("sélection : compte, ni ordre ni filtre, POST partiel sur les câbles choisis", async () => {
    routes["POST /api/racks/rack-1/renumber"] = [{ id: "conn-9", label: "RK01-V10001" }];
    render(<RenumberHarness scope="selection" selected={["conn-9"]} />);
    expect(screen.getByText(/1 câble sélectionné/)).toBeInTheDocument();
    expect(screen.queryByText("Ordre de numérotation")).toBeNull();
    expect(screen.queryByText("Seulement les câbles non numérotés")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Numéroter \(1\)/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("1 câble numéroté");
    expect(calls[0].body).toEqual({
      orderedIds: ["conn-9"],
      sideMap: { "conn-9": "left" },
      onlyUnlabelled: false,
      partial: true,
      override: ADMIN,
    });
  });

  test("Annuler n'envoie rien", () => {
    render(<RenumberHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByRole("status")).toHaveTextContent("annulé");
    expect(calls).toEqual([]);
  });
});

// ── audit_panel_lists_entries ───────────────────────────────────────────────

/** Lignes brutes d'`AuditLog` (audit_read.rs : `AUDIT_COLS`, `before` / `after` en JSON). */
function auditRow(id: string, action: string, entityType: string, createdAt: string) {
  return {
    id,
    userId: "user-1",
    action,
    entityType,
    entityId: "rack-1",
    projectId: null,
    before: null,
    after: { label: "RK01-V10001" },
    createdAt,
  };
}

describe("audit_panel_lists_entries", () => {
  test("rack : GET /api/racks/:id/audit?limit=150, entrées groupées par jour", async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 60_000);
    routes["GET /api/racks/rack-1/audit?limit=150"] = [
      auditRow("a1", "rackConnection.renumber", "Rack", now.toISOString()),
      auditRow("a2", "rackConnection.create", "RackConnection", earlier.toISOString()),
    ];
    render(<AuditPanelContent rackId="rack-1" />);
    expect(await screen.findByText("Renumérotation auto")).toBeInTheDocument();
    expect(screen.getByText("Création d'un câble")).toBeInTheDocument();
    expect(screen.getByText("2 entrées")).toBeInTheDocument();
    expect(screen.getByText("Aujourd'hui")).toBeInTheDocument();
    // Le serveur, comme arkyo, n'inclut pas l'auteur (`user`) dans la ligne.
    expect(screen.getAllByText(/^Utilisateur inconnu · /)).toHaveLength(2);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/racks/rack-1/audit?limit=150"]);

    // Rafraîchir relit la même route.
    fireEvent.click(screen.getByTitle("Rafraîchir"));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].url).toBe("/api/racks/rack-1/audit?limit=150");
    expectNoConsoleError();
  });

  test("projet : GET /api/tenant/projects/:id/audit?limit=150", async () => {
    routes["GET /api/tenant/projects/proj-1/audit?limit=150"] = [
      auditRow("p1", "rack.update", "Rack", new Date().toISOString()),
    ];
    render(<AuditPanelContent projectId="proj-1" />);
    expect(await screen.findByText("Modification du rack")).toBeInTheDocument();
    expect(screen.getByText("1 entrée")).toBeInTheDocument();
    expect(calls[0].url).toBe("/api/tenant/projects/proj-1/audit?limit=150");
  });

  test("liste vide", async () => {
    routes["GET /api/racks/rack-2/audit?limit=150"] = [];
    render(<AuditPanelContent rackId="rack-2" />);
    expect(await screen.findByText("Aucune entrée.")).toBeInTheDocument();
    expect(screen.getByText("0 entrée")).toBeInTheDocument();
  });
});

// ── cable_model_picker_uses_cable_models ────────────────────────────────────

/** Réponse de `cable_models` (parametres/cabling.rs) : modèles `TenantCableModel`. */
const CABLE_MODELS = {
  models: [
    {
      id: "tcm-1",
      name: "1694A",
      reference: "1694A",
      impedance: 75,
      bandwidthMHz: 4500,
      diameterMm: 6.9,
      conductor: null,
      shielding: null,
      jacketMaterial: null,
      fireRating: null,
      imageUrl: null,
      pinned: false,
      sortOrder: 0,
      function: { id: "f-video", label: "Vidéo", color: "#2563eb" },
      brand: { id: "b-belden", name: "Belden", logoUrl: null },
      compatibility: "match",
    },
    {
      id: "tcm-2",
      name: "RG59",
      reference: null,
      impedance: 75,
      bandwidthMHz: 1000,
      diameterMm: null,
      conductor: null,
      shielding: null,
      jacketMaterial: null,
      fireRating: null,
      imageUrl: null,
      pinned: false,
      sortOrder: 1,
      function: { id: "f-video", label: "Vidéo", color: "#2563eb" },
      brand: null,
      compatibility: "warn",
    },
  ],
  leftConnector: { name: "BNC", iconId: "bnc", color: "#64748b" },
  rightConnector: { name: "BNC", iconId: "bnc", color: "#64748b" },
  signal: {
    name: "3G-SDI",
    color: "#2563eb",
    requiredImpedance: 75,
    minBandwidthMHz: 3000,
    function: { id: "f-video", label: "Vidéo", color: "#2563eb" },
  },
};

describe("cable_model_picker_uses_cable_models", () => {
  test("dialogue : GET filtré par signal et connecteurs, groupes de compatibilité, Valider rend le TenantCableModel.id", async () => {
    const url =
      "/api/tenant/parametres/cable-models?signalName=3G-SDI&leftConnector=BNC&rightConnector=BNC";
    routes[`GET ${url}`] = CABLE_MODELS;
    const onConfirm = vi.fn();
    const onSkip = vi.fn();
    render(
      <SynopticCableModelDialog
        open
        signalName="3G-SDI"
        fromConnectorName="BNC"
        toConnectorName="BNC"
        fromGender="MALE"
        toGender="FEMALE"
        onConfirm={onConfirm}
        onSkip={onSkip}
      />,
    );
    expect(await screen.findByText("Belden / 1694A")).toBeInTheDocument();
    // (ConnectorIcon lit aussi /api/symbol-overrides.)
    const models = calls.filter((c) => c.url.startsWith("/api/tenant/parametres/cable-models"));
    expect(models.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${url}`]);
    expect(screen.getByText("Compatible")).toBeInTheDocument();
    expect(screen.getByText("Bande passante limite")).toBeInTheDocument();
    expect(screen.getByText("75 Ω · ≥ 3000 MHz")).toBeInTheDocument();
    expect(screen.getAllByText("BNC")).toHaveLength(2);
    // Genre écrit M / F, jamais de symbole.
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText("F")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Sélectionnez un câblage" })).toBeDisabled();
    fireEvent.click(screen.getByText("RG59"));
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    expect(onConfirm).toHaveBeenCalledWith("tcm-2");

    fireEvent.click(screen.getByRole("button", { name: "Plus tard" }));
    expect(onSkip).toHaveBeenCalled();
    expectNoConsoleError();
  });

  test("dialogue sans signal : liste complète groupée par marque, dernier choix présélectionné", async () => {
    routes["GET /api/tenant/parametres/cable-models"] = { ...CABLE_MODELS, signal: null };
    const onConfirm = vi.fn();
    render(
      <SynopticCableModelDialog
        open
        signalName={null}
        defaultModelId="tcm-1"
        onConfirm={onConfirm}
        onSkip={() => {}}
      />,
    );
    expect(await screen.findByText("Belden")).toBeInTheDocument();
    expect(screen.getByText("Sans marque")).toBeInTheDocument();
    expect(screen.getByText("Dernier")).toBeInTheDocument();
    expect(calls[0].url).toBe("/api/tenant/parametres/cable-models");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledWith("tcm-1");
  });

  test("picker du panneau câble : même route, rend le TenantCableModel.id", async () => {
    routes["GET /api/tenant/parametres/cable-models?signalName=3G-SDI"] = CABLE_MODELS;
    const onChange = vi.fn();
    render(<SynopticCableModelPicker value={null} onChange={onChange} signalName="3G-SDI" />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(await screen.findByText(/1694A/, { selector: "span" }));
    expect(onChange).toHaveBeenCalledWith("tcm-1");
    expect(calls[0].url).toBe("/api/tenant/parametres/cable-models?signalName=3G-SDI");
  });
});

// ── Autres composants copiés ────────────────────────────────────────────────

const LAYERS: SynopticLayerItem[] = [
  { id: "slot-1", kind: "equipment", name: "MIX-1", equipmentCategory: "Mélangeur" },
  { id: "slot-2", kind: "panel", name: "PNL-A" },
  { id: "conn-1", kind: "cable", name: "RK01-V10001", color: "#2563eb", signalName: "3G-SDI" },
  { id: "zone-1", kind: "zone", name: "Plateau", color: "#10b981" },
];

describe("autres composants", () => {
  test("calques : groupes par type, masquer, verrouiller, sélectionner", () => {
    const requestLayerSelection = vi.fn();
    act(() =>
      useTopbarActions.setState({
        synopticLayerItems: LAYERS,
        layerGroupMode: "type",
        hiddenLayerIds: new Set(),
        lockedLayerIds: new Set(["zone-1"]),
        selectedSynopticIds: new Set(),
        layerMultiSelectIds: new Set(),
        requestLayerSelection,
      }),
    );
    render(<SynopticLayersPanel categoryColors={{ "Mélangeur": "#f59e0b" }} />);
    for (const g of ["Équipements", "Panels", "Câbles", "Zones"]) expect(screen.getByText(g)).toBeInTheDocument();
    expect(screen.getByText("4 éléments")).toBeInTheDocument();
    fireEvent.click(screen.getByText("MIX-1"));
    expect(requestLayerSelection).toHaveBeenCalledWith("slot-1", "equipment");
    fireEvent.click(screen.getAllByTitle("Masquer")[0]);
    expect(useTopbarActions.getState().hiddenLayerIds.has("slot-1")).toBe(true);
    expect(screen.getByTitle("Déverrouiller")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Signal"));
    expect(screen.getByText("3G-SDI")).toBeInTheDocument();
    expectNoConsoleError();
  });

  test("calques vides", () => {
    act(() => useTopbarActions.setState({ synopticLayerItems: [] }));
    render(<SynopticLayersPanel />);
    expect(screen.getByText("Aucun élément dans le synoptique.")).toBeInTheDocument();
  });

  test("faisceaux : renommer, couleur, supprimer", () => {
    const onBundleAction = vi.fn();
    act(() =>
      useTopbarActions.setState({
        synopticBundles: [{ id: "b1", name: "Faisceau A", color: "#6366f1", count: 3 }],
        onBundleAction,
      }),
    );
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<SynopticBundlesSection />);
    expect(screen.getByText("Faisceau A")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Couleur #ef4444"));
    expect(onBundleAction).toHaveBeenCalledWith("color", "b1", "#ef4444");
    fireEvent.click(screen.getByLabelText("Renommer"));
    const input = screen.getByDisplayValue("Faisceau A");
    fireEvent.change(input, { target: { value: "Faisceau B" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onBundleAction).toHaveBeenCalledWith("rename", "b1", "Faisceau B");
    fireEvent.click(screen.getByLabelText("Supprimer le faisceau"));
    expect(onBundleAction).toHaveBeenCalledWith("delete", "b1");
  });

  test("picker d'adaptateur de port : filtre connecteur et genre opposé", () => {
    const adapters: AdapterOption[] = [
      {
        id: "ad-1",
        name: "BNC F → HDMI",
        reference: "AD-1",
        imageUrl: null,
        inputs: [{ connectorTypeId: "ct-bnc", gender: "FEMALE", quantity: 1 }],
        outputs: [{ connectorTypeId: "ct-hdmi", gender: "FEMALE", quantity: 1 }],
      },
      {
        id: "ad-2",
        name: "BNC M → XLR",
        reference: null,
        imageUrl: null,
        inputs: [{ connectorTypeId: "ct-bnc", gender: "MALE", quantity: 1 }],
        outputs: [],
      },
    ];
    act(() => useTopbarActions.setState({ availableAdapters: adapters }));
    const onPick = vi.fn();
    render(
      <PortAdapterPicker
        x={400}
        y={300}
        portConnectorTypeId="ct-bnc"
        portGender="MALE"
        portSide="right"
        ctMap={{ "ct-bnc": { name: "BNC", color: "#64748b" } }}
        onPick={onPick}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("1 compatible")).toBeInTheDocument();
    fireEvent.click(screen.getByText("BNC F → HDMI"));
    expect(onPick).toHaveBeenCalledWith(adapters[0]);
    expect(screen.queryByText("BNC M → XLR")).toBeNull();
  });

  test("mini-map et règles", () => {
    const onClose = vi.fn();
    const { container } = render(
      <div>
        <SynopticMiniMap
          nodes={[{ id: "n1", x: 0, y: 0, w: 200, h: 80, color: "#2563eb" }]}
          zones={[{ id: "z1", x: -50, y: -50, w: 400, h: 300, color: "#10b981" }]}
          canvasW={1200}
          canvasH={800}
          pan={{ x: 0, y: 0 }}
          zoom={1}
          onPanChange={() => {}}
          onClose={onClose}
        />
        <SynopticRulers
          pan={{ x: 0, y: 0 }}
          zoom={1}
          step={20}
          width={800}
          height={600}
          cursor={{ x: 100, y: 100 }}
        />
      </div>,
    );
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Fermer la mini-map"));
    expect(onClose).toHaveBeenCalled();
    expect(container.querySelector("[data-synoptic-rulers]")).not.toBeNull();
    expect(screen.getAllByText("80").length).toBeGreaterThan(0);
    expectNoConsoleError();
  });

  test("rapport de validation : contrôles réels de rack-validation, filtres par sévérité", () => {
    const report = validateRack({
      slots: [],
      connections: [
        {
          id: "conn-1",
          fromSlotId: "ghost-a",
          fromConnectorIndex: 0,
          toSlotId: "ghost-b",
          toConnectorIndex: 0,
          label: null,
        },
      ],
      adapters: [],
      zones: [{ id: "zone-1", name: "", x: 0, y: 0, w: 100, h: 100 }],
    } as unknown as Parameters<typeof validateRack>[0]);
    expect(report.issues.length).toBeGreaterThan(0);
    const onSelectIssue = vi.fn();
    render(<ValidationPanelContent report={report} onSelectIssue={onSelectIssue} />);
    expect(screen.getByText("Slot manquant")).toBeInTheDocument();
    const firstIssue = report.issues.find((i) => i.kind === "missing_slot")!;
    fireEvent.click(screen.getAllByText(firstIssue.message)[0]);
    expect(onSelectIssue).toHaveBeenCalledWith(firstIssue);
    fireEvent.click(screen.getByText("Infos"));
    fireEvent.click(screen.getByText("Tous"));
    expectNoConsoleError();
  });

  test("rapport de validation propre", () => {
    render(<ValidationPanelContent report={{ issues: [], counts: { error: 0, warning: 0, info: 0 } }} />);
    expect(screen.getByText("Aucun problème détecté.")).toBeInTheDocument();
  });
});
