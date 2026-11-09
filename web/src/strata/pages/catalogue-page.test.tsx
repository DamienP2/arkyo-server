/**
 * Catalogue de l'interface Strata v2 (`/admin/catalogue` en Strata ; spec v2
 * §4.3, maquette `#catalogue`) : onglets Équipements · Câbles · Adaptateurs ·
 * Modèles, liste filtrable et détail en lecture (faces, schéma de principe,
 * ports, essentiel et « Avancé »). Les listes sont celles des panneaux d'arkyo
 * (`GET /api/tenant/catalogue/{equipment,cables,adapters}`). En Classique,
 * `/admin/catalogue` reste la page d'arkyo (`catalogue-page.test.tsx`).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, renderApp, resetApp, signedInApi, TECH_PERMS, type Api } from "@/tests/app-harness";

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
  brands: [
    { id: "b1", name: "Blackmagic Design", logoUrl: null, isActive: true },
    { id: "b2", name: "Sony", logoUrl: null, isActive: true },
  ],
  connectorTypes: [BNC, XLR, IEC],
  signals: [SDI, SECTEUR],
  functions: [VIDEO, ENERGIE],
  phases: [
    { id: "p1", key: "TOURNAGE", label: "Tournage", isActive: true },
    { id: "p2", key: "MONTAGE", label: "Montage", isActive: true },
  ],
  types: [
    { id: "t1", name: "Grille SDI", functionId: "f1", parentId: null, source: "PERSONAL" },
    { id: "t2", name: "Caméra", functionId: "f1", parentId: null, source: "PERSONAL" },
  ],
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
  depthMm: 300,
  dimLmm: null,
  dimWmm: null,
  dimHmm: null,
  weight: 4.2,
  powerW: 120,
  heatBtuH: 410,
  hasDualPsu: true,
  is2110: true,
  ip2110Mode: "OOB",
  isLightingFixture: false,
  imageUrl: null,
  category: null,
  equipmentCategory: { id: "k1", name: "Grilles", color: null },
  type: { id: "t1", name: "Grille SDI" },
  typeId: "t1",
  functions: [{ id: "f1", label: "Vidéo", color: "#3b82f6", sortOrder: 1, functionId: "f1" }],
  functionIds: ["f1"],
  phaseIds: ["p1"],
  tags: ["régie"],
  customFields: [{ id: "cf1", label: "Firmware", type: "text", value: "8.4" }],
  documents: [{ id: "d1", title: "Manuel", url: "https://example.com/manuel.pdf" }],
  notes: null,
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
  type: { id: "t2", name: "Caméra" },
  typeId: "t2",
  functions: [{ id: "f1", label: "Vidéo", color: "#3b82f6", sortOrder: 1, functionId: "f1" }],
  functionIds: ["f1"],
  phaseIds: ["p2"],
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

const XLR_CABLE = {
  ...CABLE_ITEM,
  id: "k2",
  name: "XLR3 M ↔ XLR3 F",
  reference: "CB-XLR",
  leftConnector: { id: "c2", name: "XLR3", color: "#3b82f6" },
  leftConnectorId: "c2",
  leftGender: "MALE",
  rightConnector: { id: "c2", name: "XLR3", color: "#3b82f6" },
  rightConnectorId: "c2",
  rightGender: "FEMALE",
  cableModelId: null,
  useCases: ["INSTALLATION"],
  availableLengths: [],
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
  notes: "Passif",
  imageUrl: null,
  isActive: true,
};

function catalogueApi(iface: "strata" | "classique" = "strata", extra: Api = {}, perms: unknown = OWNER_PERMS): Api {
  return {
    ...signedInApi(perms, "Régie A", iface),
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
    "GET /api/tenant/catalogue/cables": { body: { arkyo: [], personal: [CABLE_ITEM, XLR_CABLE] } },
    "GET /api/tenant/catalogue/adapters": { body: { arkyo: [], personal: [ADAPTER_ITEM] } },
    "GET /api/tenant/catalogue/equipment/e1": {
      body: { source: "PERSONAL", isAccessible: true, item: { ...ROUTER_ITEM, functions: [{ functionId: "f1" }], phases: [] } },
    },
    "GET /api/racks": { body: [] },
    "GET /api/panels": { body: [] },
    ...extra,
  };
}

/** Liste du catalogue (onglet courant). */
async function catalogueList(label: string) {
  return screen.findByRole("list", { name: label }, { timeout: 15000 });
}

/** Ligne de la liste (bouton) par son nom. */
function row(list: HTMLElement, name: string) {
  return within(list).getByText(name).closest("button") as HTMLElement;
}

const detail = () => screen.getByRole("region", { name: "Fiche" });

beforeAll(async () => {
  await Promise.all([
    import("@/strata/pages/catalogue-page"),
    import("@/app/(app)/admin/catalogue/page"),
    import("@/app/(app)/admin/catalogue/equipment/[id]/page"),
    import("@/app/(app)/templates/page"),
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

describe("catalogue Strata v2 : équipements", () => {
  test("liste + détail, filtres, recherche", async () => {
    const { router } = renderApp("/admin/catalogue", catalogueApi());
    const list = await catalogueList("Équipements");

    // Liste triée par nom ; la première fiche est montrée sans sélection.
    const names = within(list)
      .getAllByRole("button")
      .map((b) => b.querySelector("strong")?.textContent);
    expect(names).toEqual(["HDC-5500", "Videohub 40×40 12G"]);
    expect(within(detail()).getByRole("heading", { level: 2, name: "HDC-5500" })).toBeInTheDocument();
    // Ligne : marque, fonction, hauteur, consommation.
    expect(within(row(list, "Videohub 40×40 12G")).getByText("Blackmagic Design · Vidéo")).toBeInTheDocument();
    expect(within(row(list, "Videohub 40×40 12G")).getByText("2 U")).toBeInTheDocument();
    expect(within(row(list, "HDC-5500")).getByText("libre")).toBeInTheDocument();

    // Sélection : détail et URL.
    fireEvent.click(row(list, "Videohub 40×40 12G"));
    await waitFor(() => expect(router.state.location.search).toBe("?id=e1"));
    expect(row(list, "Videohub 40×40 12G")).toHaveAttribute("aria-current", "true");
    const d = within(detail());
    expect(d.getByRole("heading", { level: 2, name: "Videohub 40×40 12G" })).toBeInTheDocument();
    expect(d.getByText("Blackmagic Design · VHUB-40")).toBeInTheDocument();

    // Faces : la plus garnie (arrière), puis avant.
    const rear = d.getByRole("img", { name: "Face arrière Videohub 40×40 12G" });
    expect(rear.querySelectorAll("[data-port]")).toHaveLength(4 + 4 + 1);
    fireEvent.click(d.getByRole("button", { name: "Avant" }));
    expect(d.getByRole("img", { name: "Face avant Videohub 40×40 12G" })).toBeInTheDocument();

    // Schéma de principe.
    expect(d.getByRole("img", { name: "Schéma de principe Videohub 40×40 12G" })).toBeInTheDocument();

    // Ports : libellé, signal, connecteur et genre M / F / N, sens, quantité.
    const ports = d.getByRole("table", { name: "Ports" });
    const lines = within(ports)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(lines).toEqual([
      ["SDI IN", "arrière", "12G-SDI", "BNC F", "Entrée", "4"],
      ["SDI OUT", "arrière", "12G-SDI", "BNC F", "Sortie", "4"],
      ["LAN", "avant", "12G-SDI", "BNC F", "E/S", "1"],
      ["AC", "arrière", "Secteur 230 V", "IEC C14 M", "Entrée", "1"],
    ]);
    expect(ports.textContent).not.toMatch(/[♂♀]/);

    // Essentiel.
    const essentials = d.getByRole("group", { name: "Essentiel" });
    expect(within(essentials).getByText("2 U")).toBeInTheDocument();
    expect(within(essentials).getByText("120 W")).toBeInTheDocument();
    expect(within(essentials).getByText("Grille SDI")).toBeInTheDocument();

    // Avancé : replié, puis les champs rares.
    const adv = d.getByRole("button", { name: /Avancé/ });
    expect(adv).toHaveAttribute("aria-expanded", "false");
    expect(d.queryByText("410 BTU/h")).toBeNull();
    fireEvent.click(adv);
    expect(adv).toHaveAttribute("aria-expanded", "true");
    expect(d.getByText("300 mm")).toBeInTheDocument();
    expect(d.getByText("4,2 kg")).toBeInTheDocument();
    expect(d.getByText("410 BTU/h")).toBeInTheDocument();
    expect(d.getByText("Oui, hors bande (OOB)")).toBeInTheDocument();
    expect(d.getByText("Tournage")).toBeInTheDocument();
    expect(d.getByText("Firmware")).toBeInTheDocument();
    expect(d.getByText("8.4")).toBeInTheDocument();
    expect(d.getByRole("link", { name: "Manuel" })).toHaveAttribute("href", "https://example.com/manuel.pdf");
    // Ouverture mémorisée par type d'écran.
    expect(window.localStorage.getItem("strata-advanced-catalogue-equipment")).toBe("1");

    // Recherche.
    const search = screen.getByRole("searchbox", { name: "Rechercher dans les équipements" });
    fireEvent.change(search, { target: { value: "sony" } });
    await waitFor(() => expect(within(list).queryByText("Videohub 40×40 12G")).toBeNull());
    expect(within(list).getByText("HDC-5500")).toBeInTheDocument();
    expect(screen.getByText("1 fiche sur 2")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(2));

    // Fabricant : le picker modal d'arkyo.
    fireEvent.click(screen.getByRole("button", { name: "Fabricant" }));
    const brandDialog = await screen.findByRole("dialog", { name: "Choisir une marque" });
    fireEvent.click(within(brandDialog).getByRole("button", { name: /Sony/ }));
    await waitFor(() => expect(within(list).queryByText("Videohub 40×40 12G")).toBeNull());
    expect(screen.getByRole("button", { name: "Fabricant : Sony" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retirer le filtre Fabricant" }));
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(2));

    // Type : le picker modal d'arkyo.
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    const typeDialog = await screen.findByRole("dialog");
    fireEvent.click(within(typeDialog).getByRole("button", { name: /Grille SDI/ }));
    await waitFor(() => expect(within(list).queryByText("HDC-5500")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Retirer le filtre Type" }));
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(2));

    // Phase : le picker modal d'arkyo (multi-sélection confirmée).
    fireEvent.click(screen.getByRole("button", { name: "Phase" }));
    const phaseDialog = await screen.findByRole("dialog");
    fireEvent.click(within(phaseDialog).getByRole("button", { name: /Montage/ }));
    fireEvent.click(within(phaseDialog).getByRole("button", { name: /Confirmer/ }));
    await waitFor(() => expect(within(list).queryByText("Videohub 40×40 12G")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Retirer le filtre Phase" }));
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(2));

    // Options d'arkyo : ST 2110, format.
    fireEvent.click(screen.getByRole("button", { name: "ST 2110" }));
    await waitFor(() => expect(within(list).queryByText("HDC-5500")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "ST 2110" }));
    fireEvent.click(screen.getByRole("button", { name: "Pose libre" }));
    await waitFor(() => expect(within(list).queryByText("Videohub 40×40 12G")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Tous les formats" }));
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(2));

    // Aucun `<select>` : filtres par pickers modaux et boutons.
    expect(document.querySelector("main select")).toBeNull();
  });

  test("Modifier → /admin/catalogue/equipment/:id", async () => {
    const { router } = renderApp("/admin/catalogue?id=e1", catalogueApi());
    await catalogueList("Équipements");
    const edit = within(detail()).getByRole("link", { name: "Modifier" });
    expect(edit).toHaveAttribute("href", "/admin/catalogue/equipment/e1");
    fireEvent.click(edit);
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/catalogue/equipment/e1"));
    expect(await screen.findByPlaceholderText("BRC-X400", {}, { timeout: 15000 })).toHaveValue("Videohub 40×40 12G");
  });

  test("Nouveau → assistant existant", async () => {
    const { router } = renderApp("/admin/catalogue", catalogueApi());
    await catalogueList("Équipements");
    const add = screen.getByRole("button", { name: "Nouvel équipement" });
    // « Ajouter » / « Nouveau » : toujours en pointillés.
    expect(add.className).toMatch(/border-dashed/);
    fireEvent.click(add);
    expect(await screen.findByRole("dialog", { name: "Nouvel équipement" })).toBeInTheDocument();

    // Câbles : l'assistant de cordon d'arkyo.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nouvel équipement" })).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: /Câbles/ }));
    await waitFor(() => expect(router.state.location.search).toBe("?tab=cables"));
    await catalogueList("Câbles");
    fireEvent.click(screen.getByRole("button", { name: "Nouveau câble" }));
    expect(await screen.findByRole("dialog", { name: "Nouveau cordon" })).toBeInTheDocument();
  });

  test("Classique : /admin/catalogue reste la page d'arkyo", async () => {
    renderApp("/admin/catalogue", catalogueApi("classique"));
    expect(await screen.findByText("HDC-5500", {}, { timeout: 15000 })).toBeInTheDocument();
    // Onglets d'arkyo dans la topbar, carte « Nouvel équipement » d'arkyo.
    expect(screen.getByRole("button", { name: "Cordons" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Fiche" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Équipements" })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Modèles/ })).toBeNull();
  });

  test("sans catalog:admin, renvoi au tableau de bord comme arkyo", async () => {
    const { router } = renderApp("/admin/catalogue", catalogueApi("strata", {}, TECH_PERMS));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"), { timeout: 15000 });
  });

  test("grand catalogue : 300 lignes, puis la suite à la demande", async () => {
    const many = Array.from({ length: 420 }, (_, i) => ({
      ...CAMERA_ITEM,
      id: `x${i}`,
      name: `Caméra ${String(i).padStart(3, "0")}`,
    }));
    renderApp(
      "/admin/catalogue",
      catalogueApi("strata", { "GET /api/tenant/catalogue/equipment": { body: { arkyo: [], personal: many } } }),
    );
    const list = await catalogueList("Équipements");
    expect(within(list).getAllByRole("button")).toHaveLength(300);
    fireEvent.click(screen.getByRole("button", { name: "Afficher les 120 suivantes" }));
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(420));
    expect(screen.queryByRole("button", { name: /suivantes/ })).toBeNull();
  });

  test("liste vide : EmptyState partagé", async () => {
    renderApp(
      "/admin/catalogue",
      catalogueApi("strata", { "GET /api/tenant/catalogue/equipment": { body: { arkyo: [], personal: [] } } }),
    );
    expect(await screen.findByText("Aucun équipement", {}, { timeout: 15000 })).toBeInTheDocument();
  });
});

describe("catalogue Strata v2 : câbles, adaptateurs, modèles", () => {
  test("câbles : liste + détail (dessin, modèle, Avancé), filtres", async () => {
    renderApp("/admin/catalogue?tab=cordons", catalogueApi());
    const list = await catalogueList("Câbles");
    expect(within(row(list, "BNC M ↔ BNC M 12G")).getByText("BNC M / BNC M")).toBeInTheDocument();
    fireEvent.click(row(list, "BNC M ↔ BNC M 12G"));
    const d = within(detail());
    const drawing = d.getByRole("img", { name: "BNC M ↔ BNC M 12G" });
    expect(within(drawing).getAllByText("BNC M")).toHaveLength(2);
    expect(d.getByText("Prestation, Installation")).toBeInTheDocument();
    expect(d.getByText("5 m · 10 m")).toBeInTheDocument();
    expect(d.getByText("0,5 à 100 m")).toBeInTheDocument();
    expect(d.getByRole("link", { name: "Modifier" })).toHaveAttribute("href", "/admin/catalogue/cables/k1");

    // Avancé : le modèle de câble.
    fireEvent.click(d.getByRole("button", { name: /Avancé/ }));
    expect(d.getByText("Belden 1694A")).toBeInTheDocument();
    expect(d.getByText("75 Ω")).toBeInTheDocument();
    expect(d.getByText("4 500 MHz")).toBeInTheDocument();
    expect(d.getByText("Cuivre nu")).toBeInTheDocument();

    // Filtre d'arkyo : cas d'usage.
    fireEvent.click(screen.getByRole("button", { name: "Prestation" }));
    await waitFor(() => expect(within(list).queryByText("XLR3 M ↔ XLR3 F")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Prestation" }));
    // Connecteur gauche : le picker modal d'arkyo.
    fireEvent.click(screen.getByRole("button", { name: "Connecteur gauche" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /XLR3/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirmer/ }));
    await waitFor(() => expect(within(list).queryByText("BNC M ↔ BNC M 12G")).toBeNull());
    expect(within(list).getByText("XLR3 M ↔ XLR3 F")).toBeInTheDocument();
  });

  test("adaptateurs : liste + détail", async () => {
    renderApp("/admin/catalogue?tab=adaptateurs", catalogueApi());
    const list = await catalogueList("Adaptateurs");
    expect(within(row(list, "XLR3 → 2× BNC")).getByText("Vidéo · 1 entrée · 2 sorties")).toBeInTheDocument();
    const d = within(detail());
    const drawing = d.getByRole("img", { name: "XLR3 → 2× BNC" });
    await within(drawing).findByText("XLR3 F");
    expect(within(drawing).getByText("BNC M ×2")).toBeInTheDocument();
    const essentials = within(d.getByRole("group", { name: "Essentiel" }));
    expect(essentials.getByText("XLR3 F")).toBeInTheDocument();
    expect(essentials.getByText("BNC M ×2")).toBeInTheDocument();
    expect(d.getByRole("link", { name: "Modifier" })).toHaveAttribute("href", "/admin/catalogue/adapters/a1");
    fireEvent.click(d.getByRole("button", { name: /Avancé/ }));
    expect(d.getByText("Passif")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nouvel adaptateur" }).className).toMatch(/border-dashed/);
  });

  test("Modèles : contenants, panels, dossiers atteignables", async () => {
    const { router } = renderApp("/admin/catalogue", catalogueApi());
    await catalogueList("Équipements");
    fireEvent.click(screen.getByRole("tab", { name: /Modèles/ }));
    await waitFor(() => expect(router.state.location.search).toBe("?tab=modeles"));
    const models = await screen.findByRole("list", { name: "Modèles" });
    expect(
      within(models)
        .getAllByRole("link")
        .map((a) => [a.querySelector("strong")?.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["Contenants", "/templates?tab=racks"],
      ["Panels", "/templates?tab=panels"],
      ["Dossiers", "/templates?tab=dossiers"],
    ]);

    // Dossiers : la page existante (bouchon de la phase 6, comme en Classique).
    fireEvent.click(within(models).getByText("Dossiers").closest("a")!);
    await waitFor(() => expect(router.state.location.search).toBe("?tab=dossiers"));
    expect(router.state.location.pathname).toBe("/templates");
    // Sur les modèles, la topbar garde la navigation des modèles (la page n'a pas d'onglets).
    const nav = await screen.findByRole("navigation", { name: "Modèles" });
    expect(within(nav).getByRole("link", { name: "Dossiers" })).toHaveAttribute("aria-current", "page");
  });
});
