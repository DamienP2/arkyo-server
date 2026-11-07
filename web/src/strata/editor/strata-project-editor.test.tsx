/**
 * Éditeur projet en interface Strata, lot 3 (spec §6.2) : inspecteur avec la
 * face de l'équipement sélectionné, dock bas (Contrôles, Câbles, Bilan),
 * lentille Connectique, état d'enregistrement dans la topbar. En Classique,
 * rien de tout cela (tests existants de l'onglet Rack inchangés).
 */

import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";
import type { UiInterface } from "@/strata/interface-context";
import { CONNECTIONS, RACK } from "../bottom/test-fixtures";

const FIRST_LOAD = { timeout: 15000 };

// Canevas de placement simulé, comme `rack-tab.test.tsx` (Konva hors de portée de happy-dom).
vi.mock("@/app/(fullscreen)/project/[id]/rack/_components/rack-placement-canvas", () => ({
  RackDragOverlayContent: () => null,
  RackPlacementCanvas: forwardRef<unknown, { rack: { id: string } }>(function FakeCanvas(props, ref) {
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
}));

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

const dock = (name: string) => document.querySelector(`[data-dock="${name}"]`) as HTMLElement | null;
const here = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  resetApp();
  window.localStorage.clear();
  delete document.documentElement.dataset.interface;
});

/** Empty state plein canevas de l'onglet Rack (sans contenant rackable). */
async function rackEmptyState(iface: UiInterface): Promise<string> {
  renderApp("/project/p1?tab=rack", api(iface, [rack("r1", "Caisse", { isRackable: false })]));
  const title = await screen.findByText("Aucun contenant rackable", {}, FIRST_LOAD);
  return title.parentElement!.outerHTML;
}

describe("onglet Rack en Strata", () => {
  test("projet sans contenant rackable → EmptyState identique, dock vide", async () => {
    const classique = await rackEmptyState("classique");
    resetApp();
    const strata = await rackEmptyState("strata");
    expect(strata).toBe(classique);
    expect(screen.getByRole("button", { name: "Aller à l'Inventaire" })).toBeInTheDocument();
    expect(dock("bottom")).toBeNull();
    expect(dock("right")).toBeNull();
  });

  test("dock bas : un clic sur un contrôle sélectionne l'équipement, dont l'inspecteur montre la face", async () => {
    renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    const bottom = await waitFor(() => dock("bottom")!);
    const controls = await within(bottom).findByRole("tab", { name: "Contrôles 2 erreurs, 2 avertissements" });
    expect(controls).toHaveAttribute("aria-selected", "true");
    // Rien de sélectionné : pas de face dans l'inspecteur.
    expect(within(dock("right")!).queryByRole("region", { name: "Équipement sélectionné" })).toBeNull();

    fireEvent.click(within(bottom).getByRole("button", { name: /CAM 1 - Caméra X.*connecté 2 fois/ }));
    const right = dock("right")!;
    const card = await within(right).findByRole("region", { name: "Équipement sélectionné" });
    expect(within(card).getByRole("img", { name: "Face arrière Caméra X" })).toBeInTheDocument();
    expect(within(card).getByText("2 / 3 ports reliés")).toBeInTheDocument();
    // Le panneau existant reste dessous.
    expect(right.querySelector("aside")).not.toBeNull();
  });

  test("lentille Connectique : ?lens=connectique sur l'onglet rack, canevas remplacé, retour au Rack", async () => {
    const { router } = renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    const lenses = screen.getByRole("navigation", { name: "Lentilles" });
    expect(within(lenses).getByRole("link", { name: "Connectique" })).toHaveAttribute(
      "href",
      "?tab=rack&lens=connectique",
    );
    fireEvent.click(within(lenses).getByRole("link", { name: "Connectique" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=rack&lens=connectique"));
    expect(within(lenses).getByRole("link", { name: "Connectique" })).toHaveAttribute("aria-current", "page");
    expect(within(lenses).getByRole("link", { name: "Rack" })).not.toHaveAttribute("aria-current");

    const list = await screen.findByRole("list", { name: "Baie 1" });
    expect(Array.from(list.children).map((li) => li.querySelector("strong")?.textContent)).toEqual([
      "ALIM",
      "MON 1",
      "CAM 1",
    ]);
    expect(screen.queryByTestId("rack-canvas")).toBeNull();
    // Le dock bas reste là.
    expect(within(dock("bottom")!).getByRole("tab", { name: /Contrôles/ })).toBeInTheDocument();

    // Une ligne sélectionne l'équipement (inspecteur).
    fireEvent.click(within(list.children[1] as HTMLElement).getByText("MON 1"));
    expect(
      await within(dock("right")!).findByRole("img", { name: "Face arrière Moniteur 17" }),
    ).toBeInTheDocument();

    // Rack quitte la lentille.
    fireEvent.click(within(lenses).getByRole("link", { name: "Rack" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=rack"));
    expect(await screen.findByTestId("rack-canvas")).toBeInTheDocument();
    // Une autre lentille aussi.
    fireEvent.click(within(lenses).getByRole("link", { name: "Connectique" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=rack&lens=connectique"));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Lentilles" })).getByRole("link", { name: "Schémas" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=schema"));
  });

  test("en Classique : ni dock bas, ni face dans l'inspecteur, ni lentille", async () => {
    renderApp("/project/p1?tab=rack&lens=connectique", api("classique"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    expect(document.querySelector("[data-strata-editor]")).toBeNull();
    expect(screen.queryByRole("tab", { name: /Contrôles/ })).toBeNull();
    expect(screen.queryByRole("list", { name: "Baie 1" })).toBeNull();
  });
});

describe("inspecteur de l'Inventaire en Strata", () => {
  test("la face de l'élément sélectionné s'affiche au-dessus du panneau existant", async () => {
    renderApp("/project/p1?tab=inventaire", api("strata"));
    await waitFor(() => expect(document.querySelector('[data-rack-id="r1"]')).not.toBeNull(), FIRST_LOAD);
    const row = (
      await within(document.querySelector('[data-rack-id="r1"]') as HTMLElement).findByText("Caméra X")
    ).closest(".group\\/row") as HTMLElement;
    fireEvent.click(row);
    const right = dock("right")!;
    const card = await within(right).findByRole("region", { name: "Équipement sélectionné" });
    expect(within(card).getByRole("img", { name: "Face arrière Caméra X" })).toBeInTheDocument();
    // Placée en U1–U2 de la Baie 1, avec ses câbles.
    expect(within(card).getByText("U1–U2 · 2 U · avant")).toBeInTheDocument();
    expect(within(card).getByText("2 / 3 ports reliés")).toBeInTheDocument();
  });
});

describe("état d'enregistrement", () => {
  test("en Strata, l'état d'enregistrement est dans la topbar", async () => {
    renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    const bar = dock("topbar")!;
    const trigger = within(bar).getByRole("button", { name: "Statut : En préparation — modifier" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Prêt" }));
    const saved = await within(bar).findByText("Enregistré");
    expect(saved.closest("[data-strata-save]")).not.toBeNull();
  });
});
