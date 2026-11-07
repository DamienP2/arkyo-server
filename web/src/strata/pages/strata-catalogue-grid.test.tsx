/**
 * Catalogue Strata (`/admin/catalogue` en interface Strata, vue grille) :
 * cartes dessinées des équipements, cordons et adaptateurs, alimentées par les
 * listes et les filtres existants des panneaux. La vue liste (`CatalogueTable`)
 * et l'interface Classique restent celles d'arkyo (`catalogue-page.test.tsx`).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";

// ── Référentiels ────────────────────────────────────────────────────────────

const VIDEO = { id: "f1", key: "VIDEO", label: "Vidéo", color: "#3b82f6", sortOrder: 1, isActive: true };
const ENERGIE = { id: "f5", key: "ENERGIE", label: "Énergie", color: "#ef4444", sortOrder: 5, isActive: true };

const connector = (id: string, name: string, iconId: string) => ({
  id,
  name,
  versions: [],
  iconId,
  svgUrl: null,
  color: "#3b82f6",
  functionIds: ["f1"],
  functions: [{ functionId: "f1" }],
  source: "PERSONAL",
  isActive: true,
});
const BNC = connector("c1", "BNC", "bnc");
const XLR = connector("c2", "XLR3", "xlr3");
const IEC = connector("c3", "IEC C14", "iec13");

const signal = (id: string, name: string, functionId: string, color: string) => ({
  id,
  name,
  color,
  functionId,
  connectorIds: [],
  isIp: false,
  supportsRedundancy: false,
  sortOrder: 0,
  isActive: true,
});
const SDI = signal("s1", "12G-SDI", "f1", "#3654ff");
const SECTEUR = signal("s2", "Secteur 230 V", "f5", "#6b7280");

const BELDEN = {
  id: "m1",
  name: "1694A",
  reference: "1694A",
  source: "PERSONAL",
  brandName: "Belden",
  functionId: "f1",
  brandId: null,
  impedance: 75,
  bandwidthMHz: 4500,
  diameterMm: 6.9,
  conductor: "BARE_COPPER",
  shielding: "DOUBLE",
  jacketMaterial: "PVC",
  fireRating: "CMR",
  imageUrl: null,
};

const LOOKUP = {
  categories: [],
  brands: [{ id: "b1", name: "Blackmagic Design", logoUrl: null, isActive: true }],
  connectorTypes: [BNC, XLR, IEC],
  signals: [SDI, SECTEUR],
  functions: [VIDEO, ENERGIE],
  phases: [],
  types: [],
  cableModels: [BELDEN],
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

const port = (p: Record<string, unknown>) => ({
  id: String(p.label),
  face: "REAR",
  connectorTypeId: "c1",
  signalName: "12G-SDI",
  quantity: 1,
  direction: "IN",
  gender: "FEMALE",
  ...p,
});

const ROUTER_ITEM = {
  ...PERSONAL,
  id: "e1",
  name: "Videohub 40×40 12G",
  reference: "VHUB-40",
  brand: { id: "b1", name: "Blackmagic Design", logoUrl: null },
  brandId: "b1",
  heightU: 2,
  isRackable: true,
  weight: 4.2,
  powerW: 120,
  hasDualPsu: true,
  is2110: true,
  imageUrl: null,
  category: null,
  equipmentCategory: { id: "k1", name: "Grilles", color: null },
  type: { id: "t1", name: "Grille SDI" },
  typeId: "t1",
  functions: [{ id: "f1", label: "Vidéo", color: "#3b82f6", sortOrder: 1, functionId: "f1" }],
  connectors: [
    port({ label: "SDI IN", quantity: 4 }),
    port({ label: "SDI OUT", quantity: 4, direction: "OUT" }),
    port({ label: "LAN", face: "FRONT", connectorTypeId: "c1", direction: "BOTH" }),
    port({ label: "AC", connectorTypeId: "c3", signalName: "Secteur 230 V", gender: "MALE" }),
  ],
};

const CAMERA_ITEM = {
  ...PERSONAL,
  id: "e2",
  name: "HDC-5500",
  reference: "HDC5500",
  brand: { id: "b2", name: "Sony", logoUrl: null },
  brandId: "b2",
  heightU: null,
  isRackable: false,
  weight: null,
  powerW: 60,
  hasDualPsu: false,
  is2110: false,
  imageUrl: null,
  category: null,
  equipmentCategory: null,
  typeId: null,
  functions: [{ id: "f1", label: "Vidéo", color: "#3b82f6", sortOrder: 1, functionId: "f1" }],
  connectors: [port({ label: "SDI OUT", direction: "OUT", quantity: 2 })],
};

const CABLE_ITEM = {
  ...PERSONAL,
  id: "k1",
  name: "BNC M ↔ BNC M 12G",
  reference: "CB-12G",
  function: { id: "f1", label: "Vidéo", color: "#3b82f6", sortOrder: 1 },
  functionId: "f1",
  leftConnector: { id: "c1", name: "BNC", color: "#3b82f6" },
  leftConnectorId: "c1",
  leftGender: "MALE",
  rightConnector: { id: "c1", name: "BNC", color: "#3b82f6" },
  rightConnectorId: "c1",
  rightGender: "MALE",
  brand: null,
  brandId: null,
  model: null,
  cableModelId: "m1",
  useCases: ["PRESTATION", "INSTALLATION"],
  availableLengths: [5, 10],
  customMinLength: 0.5,
  customMaxLength: 100,
  notes: null,
  imageUrl: null,
  isActive: true,
};

const ADAPTER_ITEM = {
  ...PERSONAL,
  id: "a1",
  name: "XLR3 → 2× BNC",
  reference: "AD-1",
  function: { id: "f1", label: "Vidéo", color: "#3b82f6", sortOrder: 1 },
  functionId: "f1",
  inputs: [{ connectorTypeId: "c2", gender: "FEMALE", quantity: 1, label: "IN" }],
  outputs: [{ connectorTypeId: "c1", gender: "MALE", quantity: 2, label: "OUT" }],
  notes: null,
  imageUrl: null,
  isActive: true,
};

function catalogueApi(iface: "strata" | "classique" = "strata", extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A", iface),
    "GET /api/tenant/catalogue/lookup": { body: LOOKUP },
    "GET /api/tenant/parametres/categories": {
      body: {
        categories: { arkyo: [], personal: [] },
        functions: { arkyo: [], personal: [VIDEO, ENERGIE] },
        phases: { arkyo: [], personal: [] },
        types: { arkyo: [], personal: [] },
      },
    },
    "GET /api/tenant/parametres/application": { body: { cable_safety_depth_mm: "120" } },
    "GET /api/tenant/parametres/dimensions": { body: [] },
    "GET /api/tenant/catalogue/connectors": { body: [BNC, XLR, IEC] },
    "GET /api/tenant/catalogue/equipment": { body: { arkyo: [], personal: [ROUTER_ITEM, CAMERA_ITEM] } },
    "GET /api/tenant/catalogue/cables": { body: { arkyo: [], personal: [CABLE_ITEM] } },
    "GET /api/tenant/catalogue/adapters": { body: { arkyo: [], personal: [ADAPTER_ITEM] } },
    "GET /api/tenant/catalogue/equipment/e1": {
      body: { source: "PERSONAL", isAccessible: true, item: { ...ROUTER_ITEM, functions: [{ functionId: "f1" }], phases: [] } },
    },
    ...extra,
  };
}

/** Carte Strata d'un élément du catalogue (par son nom). */
async function strataCard(name: string) {
  const link = await screen.findByRole("link", { name }, { timeout: 15000 });
  const card = link.closest("[data-strata-card]");
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

beforeAll(async () => {
  await Promise.all([
    import("@/app/(app)/admin/catalogue/page"),
    import("@/app/(app)/admin/catalogue/equipment/[id]/page"),
  ]);
}, 60000);
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  resetApp();
  delete document.documentElement.dataset.interface;
});

describe("catalogue Strata : équipements", () => {
  test("carte équipement : face dessinée, U, poids, puissance, ports, double alim., ST 2110", async () => {
    renderApp("/admin/catalogue", catalogueApi());
    const card = await strataCard("Videohub 40×40 12G");
    const c = within(card);

    // Face dessinée depuis la connectique : la face la plus garnie (arrière).
    const face = await c.findByRole("img", { name: "Face arrière Videohub 40×40 12G" });
    expect(face.querySelectorAll("[data-port]")).toHaveLength(4 + 4 + 1);

    // Référence, marque · catégorie · type.
    expect(c.getByText("VHUB-40")).toBeInTheDocument();
    expect(c.getByText("Blackmagic Design · Grilles · Grille SDI")).toBeInTheDocument();

    // Caractéristiques.
    const specs = c.getByRole("list", { name: "Caractéristiques" });
    const items = within(specs)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual(["2 U", "4,2 kg", "120 W", "10 ports", "Double alim.", "ST 2110"]);

    // Barre des ports par famille de signal (fonction du signal) : la couleur
    // métier de la fonction, la part de chaque famille.
    await waitFor(() => expect(card.querySelectorAll("[data-family]")).toHaveLength(2));
    const video = card.querySelector('[data-family="f1"]') as HTMLElement;
    const power = card.querySelector('[data-family="f5"]') as HTMLElement;
    expect(video).toHaveAttribute("title", "Vidéo · 9 ports");
    expect(power).toHaveAttribute("title", "Énergie · 1 port");
    expect(video.style.width).toBe("90%");
    expect(video.style.background).toMatch(/#3b82f6|rgb\(59, 130, 246\)/);

    // Équipement posé, sans poids : « Pose libre », poids inconnu, ni double alim. ni 2110.
    const cam = await strataCard("HDC-5500");
    const camSpecs = within(within(cam).getByRole("list", { name: "Caractéristiques" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(camSpecs).toEqual(["Pose libre", "— kg", "60 W", "2 ports"]);
    expect(within(cam).getByRole("img", { name: "Face arrière HDC-5500" })).toBeInTheDocument();
  });

  test("clic sur la carte ouvre l'éditeur existant", async () => {
    const { router } = renderApp("/admin/catalogue", catalogueApi());
    const link = (await strataCard("Videohub 40×40 12G")).querySelector("a")!;
    expect(link).toHaveAttribute("href", "/admin/catalogue/equipment/e1");
    fireEvent.click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/catalogue/equipment/e1"));
    expect(await screen.findByPlaceholderText("BRC-X400", {}, { timeout: 15000 })).toHaveValue(
      "Videohub 40×40 12G",
    );
  });

  test("les actions existantes (dupliquer, supprimer) restent sur la carte", async () => {
    renderApp("/admin/catalogue", catalogueApi());
    const card = await strataCard("HDC-5500");
    expect(within(card).getByTitle("Dupliquer")).toBeInTheDocument();
    expect(within(card).getByTitle("Supprimer")).toBeInTheDocument();
  });

  test("la recherche et les filtres existants s'appliquent à la grille Strata", async () => {
    renderApp("/admin/catalogue", catalogueApi());
    await strataCard("Videohub 40×40 12G");
    await strataCard("HDC-5500");

    // Recherche de la barre d'outils existante.
    fireEvent.change(screen.getByPlaceholderText("Nom, référence, marque, catégorie…"), {
      target: { value: "sony" },
    });
    await waitFor(() => expect(screen.queryByRole("link", { name: "Videohub 40×40 12G" })).toBeNull());
    expect(screen.getByRole("link", { name: "HDC-5500" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-strata-card]")).toHaveLength(1);
  });

  test("filtre existant (ST 2110, mémorisé) appliqué à la grille Strata", async () => {
    window.localStorage.setItem(
      "arkyo:tenant-catalogue:filters:equipment",
      JSON.stringify({ is2110: true }),
    );
    renderApp("/admin/catalogue", catalogueApi());
    await strataCard("Videohub 40×40 12G");
    expect(screen.queryByRole("link", { name: "HDC-5500" })).toBeNull();
    expect(document.querySelectorAll("[data-strata-card]")).toHaveLength(1);
  });

  test("vue liste : tableau existant, sans cartes Strata", async () => {
    window.localStorage.setItem("arkyo:tenant-catalogue:view:equipment", "list");
    renderApp("/admin/catalogue", catalogueApi());
    expect(await screen.findByText("HDC-5500", {}, { timeout: 15000 })).toBeInTheDocument();
    expect(document.querySelector("table")).not.toBeNull();
    expect(document.querySelectorAll("[data-strata-card]")).toHaveLength(0);
  });

  test("Classique : grille d'arkyo, sans cartes Strata", async () => {
    renderApp("/admin/catalogue", catalogueApi("classique"));
    expect(await screen.findByText("HDC-5500", {}, { timeout: 15000 })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-strata-card]")).toHaveLength(0);
    expect(screen.queryByRole("img", { name: /^Face / })).toBeNull();
  });
});

describe("catalogue Strata : cordons et adaptateurs", () => {
  test("câble : dessin et modèle", async () => {
    renderApp("/admin/catalogue?tab=cordons", catalogueApi());
    const card = await strataCard("BNC M ↔ BNC M 12G");
    const c = within(card);

    // Dessin : deux extrémités BNC mâles.
    const drawing = c.getByRole("img", { name: "BNC M ↔ BNC M 12G" });
    expect(within(drawing).getAllByText("BNC M")).toHaveLength(2);

    // Données du modèle de câble (lookup `cableModels`).
    await c.findByText("Belden 1694A");
    expect(c.getByText("75 Ω · 4 500 MHz")).toBeInTheDocument();
    expect(c.getByText("Cuivre nu · Double")).toBeInTheDocument();
    expect(c.getByText("PVC · Ø 6,9 mm · CMR")).toBeInTheDocument();
    expect(c.getByText("Prestation, Installation")).toBeInTheDocument();
    // Longueurs.
    const lengths = within(c.getByRole("list", { name: "Longueurs" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(lengths).toEqual(["5 m", "10 m"]);
    expect(c.getByText("Sur mesure 0,5 à 100 m")).toBeInTheDocument();

    expect(card.querySelector("a")).toHaveAttribute("href", "/admin/catalogue/cables/k1");
  });

  test("adaptateur : entrées et sorties", async () => {
    renderApp("/admin/catalogue?tab=adaptateurs", catalogueApi());
    const card = await strataCard("XLR3 → 2× BNC");
    const drawing = within(card).getByRole("img", { name: "XLR3 → 2× BNC" });
    await within(drawing).findByText("XLR3 F");
    expect(within(drawing).getByText("BNC M ×2")).toBeInTheDocument();
    expect(within(card).getByText("Vidéo · 1 entrée · 2 sorties")).toBeInTheDocument();
    expect(card.querySelector("a")).toHaveAttribute("href", "/admin/catalogue/adapters/a1");
  });
});
