/**
 * `/admin/catalogue` et ses éditeurs (équipement, cordon, adaptateur) repris
 * d'arkyo, branchés sur l'API simulée aux formes des Tasks 4 et 5 (catalogue
 * unique : listes `{arkyo: [], personal}`, détail `{source, isAccessible, item}`).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  renderApp,
  resetApp,
  sentBody,
  signedInApi,
  TECH_PERMS,
  type Api,
} from "@/tests/app-harness";

// ── Référentiels ────────────────────────────────────────────────────────────

const VIDEO = {
  id: "f1",
  key: "video",
  label: "Vidéo",
  color: "#3b82f6",
  sortOrder: 0,
  isActive: true,
};
const SONY = { id: "b1", name: "Sony", website: null, logoUrl: null, isActive: true };
const connector = (id: string, name: string) => ({
  id,
  name,
  versions: [],
  iconId: null,
  svgUrl: null,
  color: "#3b82f6",
  functionIds: ["f1"],
  functions: [{ functionId: "f1" }],
  source: "PERSONAL",
  isActive: true,
  hasNeutrikD: false,
  dTypeSvgUrl: null,
});
const BNC = connector("c1", "BNC");
const XLR = connector("c2", "XLR3");
const SDI = {
  id: "s1",
  name: "SDI",
  color: "#6b7280",
  functionId: "f1",
  connectorIds: [],
  isIp: false,
  supportsRedundancy: false,
  sortOrder: 0,
  isActive: true,
};
const CAMERA = {
  id: "t1",
  name: "Caméra",
  functionId: "f1",
  parentId: null,
  iconId: null,
  schemaImageUrl: null,
  sortOrder: 0,
  isActive: true,
};

const LOOKUP = {
  categories: [],
  brands: [SONY],
  connectorTypes: [BNC, XLR],
  signals: [SDI],
  functions: [VIDEO],
  phases: [],
  types: [{ id: "t1", name: "Caméra", functionId: "f1", parentId: null, source: "PERSONAL" }],
  cableModels: [],
};
const CATEGORIES = {
  categories: { arkyo: [], personal: [] },
  functions: { arkyo: [], personal: [VIDEO] },
  phases: { arkyo: [], personal: [] },
  types: { arkyo: [], personal: [CAMERA] },
};

// ── Items ───────────────────────────────────────────────────────────────────

const PERSONAL = {
  source: "PERSONAL",
  isAccessible: true,
  clonedFromArkyoId: null,
  shadowsArkyo: false,
  arkyoDrift: false,
  arkyoSourceGone: false,
};

const CAMERA_ITEM = {
  ...PERSONAL,
  id: "e1",
  name: "HDC-5500",
  reference: "HDC5500",
  brand: { id: "b1", name: "Sony" },
  brandId: "b1",
  heightU: null,
  imageUrl: null,
  category: null,
  equipmentCategory: null,
  isRackable: false,
  functions: [{ id: "f1", label: "Vidéo", color: "#3b82f6", sortOrder: 0, functionId: "f1" }],
  typeId: "t1",
};

/** Détail `GET /equipment/e1` : `item` = payload de l'éditeur d'arkyo. */
const CAMERA_DETAIL = {
  source: "PERSONAL",
  isAccessible: true,
  item: {
    ...PERSONAL,
    id: "e1",
    name: "HDC-5500",
    reference: "HDC5500",
    category: null,
    categoryId: null,
    brandId: "b1",
    isRackable: false,
    heightU: null,
    depthMm: null,
    rearCableDepthMm: null,
    widthFraction: "FULL",
    dimLmm: 300,
    dimWmm: 200,
    dimHmm: 250,
    weight: 6,
    powerW: 60,
    heatBtuH: null,
    hasDualPsu: false,
    is2110: false,
    ip2110Mode: null,
    connectors: [
      {
        id: "p1",
        face: "REAR",
        connectorTypeId: "c1",
        signalName: "SDI",
        quantity: 2,
        label: "SDI OUT",
        direction: "OUT",
        gender: "FEMALE",
      },
      {
        id: "p2",
        face: "REAR",
        connectorTypeId: "c2",
        signalName: "",
        quantity: 1,
        label: "MIC",
        direction: "IN",
        gender: "FEMALE",
      },
    ],
    signalCapacities: [],
    imageUrl: null,
    notes: null,
    tags: null,
    isActive: true,
    typeId: "t1",
    functionIds: ["f1"],
    phaseIds: [],
    sourceType: "TENANT",
    functions: [{ functionId: "f1" }],
    phases: [],
  },
};

const CABLE_ITEM = {
  ...PERSONAL,
  id: "k1",
  name: "BNC M ↔ XLR3 F",
  reference: null,
  function: { id: "f1", label: "Vidéo", color: "#3b82f6", sortOrder: 0 },
  functionId: "f1",
  leftConnector: { id: "c1", name: "BNC", color: "#3b82f6", iconId: null },
  leftConnectorId: "c1",
  leftGender: "MALE",
  rightConnector: { id: "c2", name: "XLR3", color: "#3b82f6", iconId: null },
  rightConnectorId: "c2",
  rightGender: "FEMALE",
  brand: null,
  brandId: null,
  model: null,
  useCases: [],
  availableLengths: [5],
  customMinLength: null,
  customMaxLength: null,
  notes: null,
  imageUrl: null,
  isActive: true,
};

const ADAPTER_ITEM = {
  ...PERSONAL,
  id: "a1",
  name: "XLR3 → 2× BNC",
  reference: null,
  function: { id: "f1", label: "Vidéo", color: "#3b82f6", sortOrder: 0 },
  functionId: "f1",
  inputs: [{ connectorTypeId: "c2", gender: "FEMALE", quantity: 1, label: "IN" }],
  outputs: [{ connectorTypeId: "c1", gender: "MALE", quantity: 2, label: "OUT" }],
  notes: null,
  imageUrl: null,
  isActive: true,
};

function catalogueApi(extra: Api = {}): Api {
  return {
    ...signedInApi(),
    "GET /api/tenant/catalogue/lookup": { body: LOOKUP },
    "GET /api/tenant/parametres/categories": { body: CATEGORIES },
    "GET /api/tenant/parametres/application": { body: { cable_safety_depth_mm: "120" } },
    "GET /api/tenant/parametres/dimensions": { body: [] },
    "GET /api/tenant/catalogue/connectors": { body: [BNC, XLR] },
    "GET /api/tenant/catalogue/equipment": { body: { arkyo: [], personal: [CAMERA_ITEM] } },
    "GET /api/tenant/catalogue/cables": { body: { arkyo: [], personal: [CABLE_ITEM] } },
    "GET /api/tenant/catalogue/adapters": { body: { arkyo: [], personal: [ADAPTER_ITEM] } },
    "GET /api/tenant/catalogue/equipment/e1": { body: CAMERA_DETAIL },
    "GET /api/tenant/catalogue/cables/k1": {
      body: { source: "PERSONAL", isAccessible: true, item: CABLE_ITEM },
    },
    "GET /api/tenant/catalogue/adapters/a1": {
      body: { source: "PERSONAL", isAccessible: true, item: ADAPTER_ITEM },
    },
    ...extra,
  };
}

/** Bouton d'onglet de la topbar. */
async function topbarTab(label: string) {
  const header = await waitFor(() => {
    const el = document.querySelector("header");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
  return within(header).findByRole("button", { name: label }, { timeout: 5000 });
}

// Charge une fois les modules des pages (`lazy()` du routeur).
beforeAll(async () => {
  await Promise.all([
    import("@/app/(app)/admin/catalogue/page"),
    import("@/app/(app)/admin/catalogue/equipment/[id]/page"),
    import("@/app/(app)/admin/catalogue/equipment/new/page"),
    import("@/app/(app)/admin/catalogue/cables/[id]/page"),
    import("@/app/(app)/admin/catalogue/cables/new/page"),
    import("@/app/(app)/admin/catalogue/adapters/[id]/page"),
    import("@/app/(app)/admin/catalogue/adapters/new/page"),
  ]);
}, 60000);
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(resetApp);

describe("/admin/catalogue", () => {
  test("catalogue_tabs_equipment_cables_adapters", async () => {
    renderApp("/admin/catalogue", catalogueApi());
    const labels = ["Équipements", "Cordons", "Adaptateurs"];
    for (const label of labels) expect(await topbarTab(label)).toBeInTheDocument();
    const header = document.querySelector("header")!;
    const tabs = within(header)
      .getAllByRole("button")
      .filter((b) => labels.includes(b.textContent ?? ""));
    expect(tabs.map((b) => b.textContent)).toEqual(labels);

    // Onglet par défaut : Équipements.
    expect(await screen.findByText("HDC-5500", {}, { timeout: 5000 })).toBeInTheDocument();

    fireEvent.click(await topbarTab("Cordons"));
    expect(await screen.findByText("BNC M ↔ XLR3 F")).toBeInTheDocument();
    expect(window.localStorage.getItem("tenant-admin-catalogue-tab")).toBe('"cables"');

    fireEvent.click(await topbarTab("Adaptateurs"));
    expect(await screen.findByText("XLR3 → 2× BNC")).toBeInTheDocument();

    // Catalogue unique : ni bascule « Catalogue Arkyo », ni « hors plan », ni proposition.
    expect(screen.queryByLabelText(/Catalogue Arkyo/i)).toBeNull();
    expect(screen.queryByLabelText(/hors plan/i)).toBeNull();
    expect(screen.queryByTitle("Proposer à Arkyo")).toBeNull();
  });

  test("?tab=cordons ouvre l'onglet Cordons", async () => {
    renderApp("/admin/catalogue?tab=cordons", catalogueApi());
    expect(await screen.findByText("BNC M ↔ XLR3 F", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  test("sans catalog:admin, renvoie vers /dashboard comme arkyo", async () => {
    const { router } = renderApp("/admin/catalogue", {
      ...catalogueApi(),
      ...signedInApi(TECH_PERMS),
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
  });

  test("equipment_list_empty_state", async () => {
    renderApp(
      "/admin/catalogue",
      catalogueApi({
        "GET /api/tenant/catalogue/equipment": { body: { arkyo: [], personal: [] } },
      }),
    );
    expect(await screen.findByText("Aucun équipement", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Créer mon premier équipement/ })).toBeInTheDocument();
    // Pas d'invitation à réactiver le catalogue Arkyo ni à afficher le hors-plan.
    expect(screen.queryByText(/catalogue Arkyo/i)).toBeNull();
    expect(screen.queryByText(/hors plan/i)).toBeNull();
  });

  test("equipment_list_from_api", async () => {
    const { router, fetchSpy } = renderApp("/admin/catalogue", catalogueApi());
    const card = await screen.findByText("HDC-5500", {}, { timeout: 5000 });
    // Groupé par fonction, comme arkyo.
    expect(screen.getByText("Vidéo")).toBeInTheDocument();
    // Ni pastille « Vérifié » Arkyo ni badge de plan.
    expect(screen.queryByText("Vérifié")).toBeNull();
    expect(screen.queryByText(/^(Free|Pro|Enterprise|Starter)$/i)).toBeNull();
    // Le chargement passe par `scope=all` comme arkyo.
    expect(
      fetchSpy.mock.calls.some(([u]) => String(u) === "/api/tenant/catalogue/equipment?scope=all"),
    ).toBe(true);

    fireEvent.click(card);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/admin/catalogue/equipment/e1"),
    );
  });

  test("new_equipment_wizard_creates", async () => {
    const created = { ...CAMERA_DETAIL.item, id: "e2", name: "RCP-3500" };
    const { router, fetchSpy } = renderApp(
      "/admin/catalogue",
      catalogueApi({
        "POST /api/tenant/catalogue/equipment": { status: 201, body: created },
        "GET /api/tenant/catalogue/equipment/e2": {
          body: { source: "PERSONAL", isAccessible: true, item: created },
        },
      }),
    );
    await screen.findByText("HDC-5500", {}, { timeout: 5000 });

    // « Nouvel équipement » ouvre l'assistant d'arkyo…
    fireEvent.click(screen.getByRole("button", { name: /Nouvel équipement/ }));
    expect(await screen.findByText(/à votre catalogue/)).toBeInTheDocument();
    // … dont la saisie rapide ouvre la fiche vierge.
    fireEvent.click(screen.getByRole("button", { name: "Saisie rapide (sans assistant)" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/admin/catalogue/equipment/new"),
    );

    const name = await screen.findByPlaceholderText("BRC-X400", {}, { timeout: 5000 });
    fireEvent.change(name, { target: { value: "RCP-3500" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/admin/catalogue/equipment/e2"),
    );
    const body = sentBody(fetchSpy, "POST", "/api/tenant/catalogue/equipment");
    expect(body).toMatchObject({
      name: "RCP-3500",
      isRackable: true,
      heightU: 1,
      connectors: [],
      typeId: null,
      functionIds: [],
    });
    // Distribution masquée (côté tenant) : aucun champ de diffusion envoyé.
    expect(body).not.toHaveProperty("visibleFromPlan");
  });
});

describe("éditeur d'équipement", () => {
  test("equipment_editor_autosave_patch", async () => {
    const { fetchSpy } = renderApp(
      "/admin/catalogue/equipment/e1",
      catalogueApi({
        "PATCH /api/tenant/catalogue/equipment/e1": (init) => ({
          body: { ...CAMERA_DETAIL.item, ...JSON.parse(String(init?.body)) },
        }),
      }),
    );
    const name = await screen.findByPlaceholderText("BRC-X400", {}, { timeout: 5000 });
    expect(name).toHaveValue("HDC-5500");
    // Onglets du tenant : pas de Distribution.
    expect(screen.getByRole("button", { name: /Généralités/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connectique/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Distribution/ })).toBeNull();
    // Ni « Récupérer la version Arkyo » ni « Signaler une erreur ».
    expect(screen.queryByText("Récupérer la version Arkyo")).toBeNull();
    expect(screen.queryByText("Signaler une erreur")).toBeNull();

    // Champ texte (autofocus) : l'autosave d'arkyo s'arme à la sortie du champ.
    fireEvent.change(name, { target: { value: "HDC-5500 V2" } });
    act(() => name.blur());
    await waitFor(
      () =>
        expect(sentBody(fetchSpy, "PATCH", "/api/tenant/catalogue/equipment/e1")).toMatchObject({
          name: "HDC-5500 V2",
          typeId: "t1",
          functionIds: ["f1"],
          isRackable: false,
          dimLmm: 300,
          connectors: [
            expect.objectContaining({ connectorTypeId: "c1", quantity: 2, label: "SDI OUT" }),
            expect.objectContaining({ connectorTypeId: "c2", label: "MIC" }),
          ],
        }),
      { timeout: 4000 },
    );
    expect(await screen.findByText(/Enregistré/)).toBeInTheDocument();
  });

  test("détail introuvable : page 404 comme notFound()", async () => {
    renderApp(
      "/admin/catalogue/equipment/zz",
      catalogueApi({
        "GET /api/tenant/catalogue/equipment/zz": {
          status: 404,
          body: { error: "Équipement introuvable" },
        },
      }),
    );
    expect(
      await screen.findByText("This page could not be found.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  test("échec de chargement : erreur et « Réessayer »", async () => {
    let fail = true;
    renderApp(
      "/admin/catalogue/equipment/e1",
      catalogueApi({
        "GET /api/tenant/catalogue/lookup": () =>
          fail ? { status: 500, body: { error: "Erreur serveur" } } : { body: LOOKUP },
      }),
    );
    expect(await screen.findByText("Erreur serveur", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("BRC-X400")).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByPlaceholderText("BRC-X400", {}, { timeout: 5000 })).toHaveValue(
      "HDC-5500",
    );
  });
});

describe("éditeurs de cordon et d'adaptateur", () => {
  test("cable_editor_connectors", async () => {
    const { fetchSpy } = renderApp(
      "/admin/catalogue/cables/k1",
      catalogueApi({
        "PATCH /api/tenant/catalogue/cables/k1": (init) => ({
          body: { ...CABLE_ITEM, ...JSON.parse(String(init?.body)) },
        }),
      }),
    );
    // Extrémités : connecteur choisi et genre, comme arkyo.
    expect(await screen.findByText("Extrémité gauche", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("Extrémité droite")).toBeInTheDocument();
    expect(screen.getAllByText("BNC").length).toBeGreaterThan(0);
    expect(screen.getAllByText("XLR3").length).toBeGreaterThan(0);
    expect(screen.queryByText("Récupérer la version Arkyo")).toBeNull();

    // « ← Identique » recopie la gauche (BNC mâle) sur la droite → autosave.
    fireEvent.click(screen.getByRole("button", { name: "← Identique" }));
    await waitFor(
      () =>
        expect(sentBody(fetchSpy, "PATCH", "/api/tenant/catalogue/cables/k1")).toMatchObject({
          name: "BNC M ↔ XLR3 F",
          leftConnectorId: "c1",
          leftGender: "MALE",
          rightConnectorId: "c1",
          rightGender: "MALE",
          functionId: "f1",
          availableLengths: [5],
        }),
      { timeout: 4000 },
    );
  });

  test("nouveau cordon : POST puis passage en édition", async () => {
    const { router, fetchSpy } = renderApp(
      "/admin/catalogue/cables/new",
      catalogueApi({
        "POST /api/tenant/catalogue/cables": { status: 201, body: { ...CABLE_ITEM, id: "k2" } },
        "GET /api/tenant/catalogue/cables/k2": {
          body: { source: "PERSONAL", isAccessible: true, item: { ...CABLE_ITEM, id: "k2" } },
        },
      }),
    );
    expect(await screen.findByText("Nouveau", {}, { timeout: 5000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Créer/ }));
    // Validation d'arkyo : nom et connecteurs requis.
    expect(await screen.findByText("3 erreurs à corriger")).toBeInTheDocument();
    expect(sentBody(fetchSpy, "POST", "/api/tenant/catalogue/cables")).toBeUndefined();
    expect(router.state.location.pathname).toBe("/admin/catalogue/cables/new");
  });

  test("adapter_editor_inputs_outputs", async () => {
    const { fetchSpy } = renderApp(
      "/admin/catalogue/adapters/a1",
      catalogueApi({
        "PATCH /api/tenant/catalogue/adapters/a1": (init) => ({
          body: { ...ADAPTER_ITEM, ...JSON.parse(String(init?.body)) },
        }),
      }),
    );
    expect(await screen.findByText("Connecteur d'entrée", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("Groupes de connecteurs en sortie")).toBeInTheDocument();
    expect(screen.getByText(/1 groupe défini/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("IN")).toBeInTheDocument();
    const outLabel = screen.getByDisplayValue("OUT");

    // Bouton « Ajouter » en pointillés (règle d'interface d'arkyo).
    const add = screen.getByRole("button", { name: /Ajouter un groupe/ });
    expect(add.className).toContain("border-dashed");

    fireEvent.change(outLabel, { target: { value: "OUT 1-2" } });
    await waitFor(
      () =>
        expect(sentBody(fetchSpy, "PATCH", "/api/tenant/catalogue/adapters/a1")).toMatchObject({
          name: "XLR3 → 2× BNC",
          functionId: "f1",
          inputs: [{ connectorTypeId: "c2", gender: "FEMALE", quantity: 1, label: "IN" }],
          outputs: [{ connectorTypeId: "c1", gender: "MALE", quantity: 2, label: "OUT 1-2" }],
        }),
      { timeout: 4000 },
    );

    fireEvent.click(add);
    expect(screen.getAllByText("Groupe")).toHaveLength(2);
  });
});
