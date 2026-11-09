/**
 * Éditeur projet en interface Strata v2 (spec v2 §4.1) : topbar projet v2
 * (Concevoir · Gérer, menu Vues, ⌘K, état d'enregistrement), coquille
 * « Concevoir » (canevas plein) pour chaque onglet, bascule Classique ↔
 * Strata en direct sans remonter le canevas. En Classique, rien ne change
 * (tests existants de l'éditeur inchangés).
 */

import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, emitAppEvent, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";
import type { Slot } from "@/components/synoptique/lib/types";
import type { UiInterface } from "@/strata/interface-context";
import { CONNECTIONS, RACK, canvasData } from "../bottom/test-fixtures";

const FIRST_LOAD = { timeout: 15000 };

// Canevas de placement simulé, comme `rack-tab.test.tsx` (Konva hors de portée de happy-dom).
// Il ouvre, comme le vrai, le flux temps réel de son contenant (`useRackSync`).
vi.mock("@/app/(fullscreen)/project/[id]/rack/_components/rack-placement-canvas", async () => {
  const { useRackSync } = await import("@/components/synoptique/hooks/use-rack-sync");
  return {
  RackDragOverlayContent: () => null,
  RackPlacementCanvas: forwardRef<unknown, { rack: { id: string }; initialSlots?: Slot[] }>(function FakeCanvas(props, ref) {
    useRackSync(props.rack.id, props.initialSlots ?? NO_SLOTS);
    useImperativeHandle(ref, () => ({
      rackId: props.rack.id,
      ownsSlot: () => false,
      handleDragStart: () => {},
      handleDragOver: () => {},
      handleDragEnd: async () => {},
      cancelDrag: () => {},
      notifyShelfOnlyMiss: () => false,
      clearSelection: () => {},
      fitAll: () => {},
      centerContent: () => {},
      zoomIn: () => {},
      zoomOut: () => {},
    }));
    return <div data-testid="rack-canvas" data-rack={props.rack.id} />;
  }),
  };
});

const NO_SLOTS: Slot[] = [];

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

/** Ligne d'inventaire de la caméra (`InventaireBomItem`), portée par le slot `s1` de `RACK`. */
const CAMERA_BOM = {
  id: "i1",
  kind: "equipment",
  refId: "eq1",
  quantity: 1,
  name: "Caméra X",
  reference: "CX-1",
  brandName: "Sony",
  category: "Vidéo",
  categoryColor: "#3b82f6",
  isRackable: true,
  heightU: 2,
  depthMm: 300,
  weightKg: 5,
  powerW: 100,
  snapshotId: null,
};

function rack(id: string, name: string, extra: Record<string, unknown> = {}) {
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
    hasConnectors: true,
    canvasX: null,
    canvasY: null,
    locationId: "l1",
    isVirtual: false,
    slots: [],
    bom: [],
    ...extra,
  };
}

function editor(racks: unknown[]) {
  return {
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
      racks,
      locations: [{ id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: null }],
    },
    cartographie: { maps: [] },
  };
}

const RACKABLE = [rack("r1", "Baie 1", { bom: [CAMERA_BOM] })];

function api(iface: UiInterface, racks: unknown[] = RACKABLE, extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A", iface),
    "GET /api/tenant/projects/p1/editor": { body: editor(racks) },
    "GET /api/tenant/projects/p1/racks/r1/canvas-data": { body: RACK },
    "GET /api/tenant/projects/p1/racks/r1/inventory": { body: { items: [CAMERA_BOM] } },
    "GET /api/racks/r1/connections": { body: CONNECTIONS },
    "GET /api/tenant/projects/p1/inventaire/catalog": { body: { equipments: [], panels: [], adapters: [] } },
    "GET /api/tenant/espace/informations": { body: { name: "Régie A", logoUrl: null } },
    "PATCH /api/tenant/projects/p1": { body: { ok: true } },
    ...extra,
  };
}

const zone = (name: string) => document.querySelector(`[data-zone="${name}"]`) as HTMLElement | null;
const here = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  resetApp();
  window.localStorage.clear();
  delete document.documentElement.dataset.interface;
});

/** Empty state plein canevas de l'onglet Rack (sans contenant rackable). */
async function rackEmptyState(iface: UiInterface, url = "/project/p1?tab=rack"): Promise<string> {
  renderApp(url, api(iface, [rack("r1", "Caisse", { isRackable: false })]));
  const title = await screen.findByText("Aucun contenant rackable", {}, FIRST_LOAD);
  return title.parentElement!.outerHTML;
}

const shell = () => document.querySelector("[data-strata-canvas-shell]") as HTMLElement | null;
const topbar = () => zone("topbar")!;
const spaceNav = () => within(topbar()).getByRole("navigation", { name: "Espace du projet" });

/** Ouvre un menu Radix (le déclencheur s'ouvre au clavier dans happy-dom). */
async function openMenu(name: string): Promise<HTMLElement> {
  fireEvent.keyDown(within(topbar()).getByRole("button", { name }), { key: "Enter" });
  return screen.findByRole("menu");
}

describe("topbar projet v2", () => {
  test("lockup, projet, statut, Concevoir · Gérer, Vues, ⌘K, Fermer ; canevas plein", async () => {
    renderApp("/project/p1?tab=rack", api("strata"));
    const canvas = await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    const bar = topbar();
    expect(within(bar).getByRole("banner")).toBeInTheDocument();
    expect(within(bar).getByLabelText("Strata Arkyo")).toBeInTheDocument();
    expect(within(bar).getByText("Finale Coupe de France")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Statut : En préparation — modifier" })).toBeInTheDocument();
    expect(within(spaceNav()).getAllByRole("link").map((l) => l.textContent)).toEqual(["Concevoir", "Gérer"]);
    expect(within(spaceNav()).getByRole("link", { name: "Concevoir" })).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("button", { name: "Vues" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Rechercher ou agir (⌘K)" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Fermer l'édition" })).toBeInTheDocument();
    // Plus d'onglets Conception · Inventaire · Livraison ni de pill d'arkyo.
    expect(screen.queryByRole("navigation", { name: "Onglets du projet" })).toBeNull();
    // Coquille « Concevoir » : canevas plein, outils flottants, tiroir fermé.
    expect(shell()).not.toBeNull();
    expect(zone("canvas")!.contains(canvas)).toBe(true);
    expect(within(zone("tools")!).getByRole("toolbar", { name: "Outils" })).toBeInTheDocument();
    expect(zone("drawer")).not.toBeVisible();
    expect(document.querySelector("[data-dock]")).toBeNull();
  });

  test("Gérer → ?space=gerer (pages Gérer), Concevoir y revient", async () => {
    const { router } = renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    expect(within(spaceNav()).getByRole("link", { name: "Gérer" })).toHaveAttribute("href", "/project/p1?tab=rack&space=gerer");
    fireEvent.click(within(spaceNav()).getByRole("link", { name: "Gérer" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=rack&space=gerer"));
    expect(await screen.findByRole("navigation", { name: "Gérer" })).toBeInTheDocument();
    expect(within(spaceNav()).getByRole("link", { name: "Gérer" })).toHaveAttribute("aria-current", "page");
    expect(zone("canvas")).toBeNull();
    // Le canevas de Concevoir n'est pas monté dans Gérer.
    expect(screen.queryByTestId("rack-canvas")).toBeNull();

    fireEvent.click(within(spaceNav()).getByRole("link", { name: "Concevoir" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=rack"));
    expect(zone("canvas")!.contains(await screen.findByTestId("rack-canvas"))).toBe(true);
  });

  test("Vues : chaque onglet d'arkyo reste atteignable, et y mène dans Concevoir", async () => {
    const { router } = renderApp("/project/p1?tab=rack&space=gerer", api("strata"));
    await screen.findByRole("navigation", { name: "Gérer" }, FIRST_LOAD);
    let menu = await openMenu("Vues");
    const items = within(menu).getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toEqual([
      "Synoptique",
      "Rack",
      "Schémas",
      "Plan",
      "Vidéo",
      "Audio",
      "Plan de feu",
      "Adressage DMX",
      "Inventaire",
      "Map",
      "Adressage IP",
      "Adressage 2110",
      "Configuration",
      "Préparation",
      "Recette",
      "Caractéristiques du projet",
      "Exporter un dossier",
    ]);
    expect(within(menu).getByRole("menuitem", { name: "Rack" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Recette" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=recette"));
    expect(window.localStorage.getItem("project-editor-tab")).toBe('"recette"');
    expect(within(spaceNav()).getByRole("link", { name: "Concevoir" })).toHaveAttribute("aria-current", "page");

    // Sous-onglets de Lumière (même stockage que la pill d'arkyo).
    menu = await openMenu("Vues");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Adressage DMX" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=lumiere"));
    expect(window.localStorage.getItem("project-lumiere-subtab")).toBe('"dmx"');
    menu = await openMenu("Vues");
    expect(within(menu).getByRole("menuitem", { name: "Adressage DMX" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("menuitem", { name: "Plan de feu" })).not.toHaveAttribute("aria-current");
    fireEvent.keyDown(menu, { key: "Escape" });
  });

  test("Vues › Caractéristiques et Exporter un dossier : dialogues existants", async () => {
    renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    fireEvent.click(within(await openMenu("Vues")).getByRole("menuitem", { name: "Caractéristiques du projet" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Modifier « Finale Coupe de France »")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(within(await openMenu("Vues")).getByRole("menuitem", { name: "Exporter un dossier" }));
    // Le dossier d'arkyo (`DossierWizard`), en bouchon jusqu'à la phase 6.
    expect(within(await screen.findByRole("dialog")).getByText("Bientôt disponible")).toBeInTheDocument();
  });

  test("⌘K : la palette est montée dans l'éditeur plein écran", async () => {
    renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    fireEvent.click(within(topbar()).getByRole("button", { name: "Rechercher ou agir (⌘K)" }));
    expect(await screen.findByRole("dialog", { name: "Palette de commandes" })).toBeInTheDocument();
  });

  test("Fermer l'édition revient aux projets", async () => {
    const { router } = renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    fireEvent.click(within(topbar()).getByRole("button", { name: "Fermer l'édition" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
  });

  test("en Strata, l'état d'enregistrement est dans la topbar", async () => {
    renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    const bar = topbar();
    const trigger = within(bar).getByRole("button", { name: "Statut : En préparation — modifier" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Prêt" }));
    const saved = await within(bar).findByText("Enregistré");
    expect(saved.closest("[data-strata-save]")).not.toBeNull();
  });
});

describe("onglets dans la coquille Concevoir", () => {
  test("projet sans contenant rackable → EmptyState identique, sans tiroir", async () => {
    const classique = await rackEmptyState("classique");
    resetApp();
    const strata = await rackEmptyState("strata");
    expect(strata).toBe(classique);
    expect(screen.getByRole("button", { name: "Aller à l'Inventaire" })).toBeInTheDocument();
    expect(zone("drawer")).toBeNull();
  });

  test("Inventaire : page, outils en bande, panneau latéral en colonne", async () => {
    renderApp("/project/p1?tab=inventaire", api("strata"));
    const side = await screen.findByRole("complementary", { name: "Panneau latéral" }, FIRST_LOAD);
    expect(await within(side).findByRole("heading", { name: "Équipements" }, FIRST_LOAD)).toBeInTheDocument();
    const tools = zone("tools")!;
    expect(tools.className).not.toMatch(/\babsolute\b/);
    expect(within(tools).getByRole("toolbar", { name: "Outils" })).toBeInTheDocument();
    // Le panneau droit existant (fiche, export) est dans le tiroir, fermé.
    expect(zone("drawer")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir l'inspecteur" }));
    expect(zone("drawer")).toBeVisible();
  });

  test("en Classique : aucune coquille ni topbar Strata", async () => {
    renderApp("/project/p1?tab=rack", api("classique"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    expect(shell()).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Espace du projet" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Vues" })).toBeNull();
  });
});

/** Trois baies du même lieu, affichées en portée « par emplacement ». */
const LOCATION_RACKS = ["r1", "r2", "r3"].map((id, i) => rack(id, `Baie ${i + 1}`));

function locationApi(iface: UiInterface): Api {
  const extra: Api = {};
  for (const [i, id] of ["r1", "r2", "r3"].entries()) {
    extra[`GET /api/tenant/projects/p1/racks/${id}/canvas-data`] = {
      body: id === "r1" ? RACK : canvasData(id, `Baie ${i + 1}`, []),
    };
    extra[`GET /api/tenant/projects/p1/racks/${id}/inventory`] = { body: { items: [] } };
    extra[`GET /api/racks/${id}/connections`] = { body: id === "r1" ? CONNECTIONS : [] };
  }
  return api(iface, LOCATION_RACKS, extra);
}

/** Flux temps réel ouverts (`EventSource` simulé du harnais), par URL. */
function streams(): string[] {
  const open = (globalThis.EventSource as unknown as { open: Set<{ url: string }> }).open;
  return [...open].map((e) => e.url).sort();
}

async function openLocation(iface: UiInterface, url = "/project/p1?tab=rack") {
  window.localStorage.setItem("rack-tab:display-scope", JSON.stringify("location"));
  window.localStorage.setItem("rack-tab:location", JSON.stringify("l1"));
  const app = renderApp(url, locationApi(iface));
  await screen.findByText("Finale Coupe de France", {}, FIRST_LOAD);
  return app;
}

describe("flux temps réel en portée lieu (HTTP/1.1 : 6 connexions par origine)", () => {
  test("vue Rack : les flux des canevas et le flux applicatif seulement, comme en Classique", async () => {
    await openLocation("classique");
    await waitFor(() => expect(screen.getAllByTestId("rack-canvas")).toHaveLength(3), FIRST_LOAD);
    await waitFor(() =>
      expect(streams()).toEqual(["/api/events", "/api/racks/r1/events", "/api/racks/r2/events", "/api/racks/r3/events"]),
    );
    const classique = streams();
    resetApp();

    await openLocation("strata");
    await waitFor(() => expect(screen.getAllByTestId("rack-canvas")).toHaveLength(3), FIRST_LOAD);
    expect(streams()).toEqual(classique);
  });
});

// ── Bascule Classique ↔ Strata en direct (Review Focus 1) ───────────────────

/** Vue Générale minimale du synoptique (synoptic_general.rs) : un contenant sans port. */
const GENERAL = {
  locations: [],
  racks: [{ id: "r9", name: "Flight 1", rackType: "FLIGHT_CASE_CLASSIC", totalU: 6, canvasX: 40, canvasY: 40, externalConnectors: [] }],
  connections: [],
  bundles: [],
  connectorTypes: [],
  signals: [],
  signalCategories: [],
  appConfig: {},
  project: { id: "p1", name: "Finale Coupe de France" },
  stats: { rackCount: 1, totalWeightKg: 0, totalPowerW: 0 },
};

describe("bascule d'interface en direct", () => {
  test("synoptique : ni le canevas ni ses données ne sont relus, seule la coquille change", async () => {
    let iface: UiInterface = "classique";
    window.localStorage.setItem("project-p1-synoptique-rack", "__general__");
    const { fetchSpy } = renderApp(
      "/project/p1?tab=synoptique",
      api("classique", [rack("r9", "Flight 1", { rackType: "FLIGHT_CASE_CLASSIC", totalU: 6, locationId: null })], {
        "GET /api/site": () => ({ body: { name: "Régie A", logoUrl: null, interface: iface } }),
        "GET /api/tenant/catalogue/adapters": { body: { arkyo: [], personal: [] } },
        "GET /api/tenant/projects/p1/synoptic/general": { body: GENERAL },
      }),
    );
    const block = await screen.findByText("Flight 1", { selector: "[data-slot-id] *" }, FIRST_LOAD);
    const general = () =>
      fetchSpy.mock.calls.filter(([input]) => String(input).split("?")[0] === "/api/tenant/projects/p1/synoptic/general").length;
    expect(general()).toBe(1);
    expect(shell()).toBeNull();

    // Classique → Strata : coquille « Concevoir », même canevas.
    iface = "strata";
    emitAppEvent({ entity: "config", action: "updated", id: "1" });
    await waitFor(() => expect(shell()).not.toBeNull());
    expect(block.isConnected).toBe(true);
    expect(zone("canvas")!.contains(block)).toBe(true);
    expect(within(topbar()).getByRole("navigation", { name: "Espace du projet" })).toBeInTheDocument();

    // Strata → Classique : idem.
    iface = "classique";
    emitAppEvent({ entity: "config", action: "updated", id: "2" });
    await waitFor(() => expect(shell()).toBeNull());
    expect(block.isConnected).toBe(true);
    expect(general()).toBe(1);
  });
});
