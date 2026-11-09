/**
 * Tiroir de Concevoir (interface Strata v2, spec v2 §4.1), sur l'éditeur
 * réel (`/project/:id?tab=…`) :
 *   - synoptique : la sélection ouvre le tiroir (une seule fois par
 *     sélection : après une fermeture manuelle, la même sélection ne le
 *     rouvre pas, Review Focus 2), carte « Faces » de l'équipement et « Voir
 *     dans le rack » (mode Racks sur son contenant) ;
 *   - mode Racks : bibliothèque v1 dans le tiroir (même charge utile de
 *     glisser, même `DndContext`), face de l'emplacement sélectionné ;
 *     élévation sous la barre flottante ; sélecteur de mode ;
 *   - projet sans contenant rackable : l'`EmptyState` d'arkyo (Review Focus 3) ;
 *   - Classique : rien ne change (DOM d'`EditorShell` exact, tiroir Strata
 *     jamais monté).
 */

import { forwardRef, useImperativeHandle, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, emitAppEvent, mockApi, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";
import { EditorShell, type EditorShellSlots } from "@/components/editor-shell/editor-shell";
import { WorkspaceProvider } from "@/components/editor-shell/workspace-context";
import type { Slot } from "@/components/synoptique/lib/types";
import { usePendingExportStore } from "@/app/(fullscreen)/project/[id]/_components/pending-export-store";
import { InterfaceProvider, type UiInterface } from "@/strata/interface-context";
import type { NodeSelectionDetails } from "@/components/synoptique/synoptic-view";
import type { InventaireRack } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import { CAMERA, CONNECTIONS, RACK, SLOT, canvasData } from "../bottom/test-fixtures";
import { StrataSynopticDrawerTop, type SynopticSelection } from "./synoptic-drawer";

const FIRST_LOAD = { timeout: 15000 };

// Glisser-déposer : on capte le `DndContext` de l'onglet Rack (`RackTabDndProvider`,
// seul à couper l'auto-défilement) et la charge utile de chaque élément glissable.
const dnd = vi.hoisted(() => ({
  ctx: null as null | { onDragEnd?: (e: unknown) => unknown },
  draggables: new Map<string, unknown>(),
  drops: [] as unknown[],
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@dnd-kit/core")>();
  const { createElement } = await import("react");
  return {
    ...mod,
    DndContext: (props: Parameters<typeof mod.DndContext>[0]) => {
      if (props.autoScroll === false) dnd.ctx = props as typeof dnd.ctx;
      return createElement(mod.DndContext, props);
    },
    useDraggable: (args: Parameters<typeof mod.useDraggable>[0]) => {
      dnd.draggables.set(String(args.id), args.data);
      return mod.useDraggable(args);
    },
  };
});

// Canevas de placement simulé (Konva hors de portée de happy-dom), comme
// `rack-tab.test.tsx` : il reçoit les dépôts et sélectionne un emplacement.
vi.mock("@/app/(fullscreen)/project/[id]/rack/_components/rack-placement-canvas", () => ({
  RackDragOverlayContent: () => null,
  RackPlacementCanvas: forwardRef<
    unknown,
    { rack: { id: string }; initialSlots?: Slot[]; onSlotSelect?: (s: Slot | null) => void }
  >(function FakeCanvas(props, ref) {
    useImperativeHandle(ref, () => ({
      rackId: props.rack.id,
      ownsSlot: () => false,
      handleDragStart: () => {},
      handleDragOver: () => {},
      handleDragEnd: async (event: unknown) => {
        dnd.drops.push(event);
      },
      cancelDrag: () => {},
      notifyShelfOnlyMiss: () => false,
      clearSelection: () => {},
      fitAll: () => {},
      centerContent: () => {},
      zoomIn: () => {},
      zoomOut: () => {},
    }));
    const first = props.initialSlots?.[0] ?? null;
    return (
      <div data-testid="rack-canvas" data-rack={props.rack.id}>
        <button type="button" onClick={() => props.onSlotSelect?.(first)}>
          sélectionner {first?.label}
        </button>
      </div>
    );
  }),
}));

const NOW = "2026-11-09T10:00:00.000Z";

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
    hasConnectors: false,
    canvasX: null,
    canvasY: null,
    locationId: "l1",
    isVirtual: false,
    slots: [],
    bom: [],
    ...extra,
  };
}

const RACKS = [
  rack("r1", "Baie 1"),
  rack("r2", "Baie 2"),
  rack("v1", "Régie", { isVirtual: true, isRackable: false, totalU: 0 }),
];

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
      locations: [{ id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: "v1" }],
    },
    cartographie: { maps: [] },
  };
}

// ── Vue Lieu du synoptique (synoptic_location.rs) ───────────────────────────

const MIXER = { ...CAMERA, id: "eq7", name: "Mélangeur", reference: "MX-1", heightU: 1 };
const TRIPOD = { ...CAMERA, id: "eq9", name: "Pied caméra", reference: "PC-1", isRackable: false, heightU: null };

/** Slot du `canvas-data` d'un contenant (même forme que `SLOT`). */
const MIXER_SLOT = { ...SLOT, id: "s7", rackId: "r2", equipmentId: "eq7", catalogEquipmentId: "eq7", inventoryItemId: null, startU: 3, heightU: 1, label: null, equipment: MIXER };
const TRIPOD_SLOT = { ...SLOT, id: "s9", rackId: "v1", equipmentId: "eq9", catalogEquipmentId: "eq9", inventoryItemId: null, startU: null, heightU: null, label: null, equipment: TRIPOD };

/** `RackSlot` de la vue lieu (`synopticX/Y`, équipement enrichi). */
function locSlot(id: string, rackId: string, startU: number | null, x: number, eq: { id: string; name: string }) {
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
    heightU: startU == null ? null : 1,
    widthFraction: "FULL",
    column: 0,
    label: null,
    notes: null,
    patchNotes: null,
    panelLabels: null,
    synopticX: x,
    synopticY: 40,
    createdAt: NOW,
    updatedAt: NOW,
    equipmentId: eq.id,
    equipment: {
      id: eq.id,
      name: eq.name,
      reference: null,
      category: "Vidéo",
      heightU: 1,
      weight: 2,
      powerW: 50,
      depthMm: null,
      imageUrl: null,
      connectors: [{ connectorTypeId: "ct1", quantity: 1, direction: "OUT", signalName: "SDI", label: "SDI 1" }],
      brand: { id: "b1", name: "Sony" },
    },
    components: [],
    panel: null,
    attachedAdapters: [],
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
    locSlot("s1", "r1", 1, 40, { id: "eq1", name: "Caméra X" }),
    locSlot("s7", "r2", 3, 520, { id: "eq7", name: "Mélangeur" }),
    locSlot("s9", "v1", null, 1000, { id: "eq9", name: "Pied caméra" }),
  ],
  connections: [],
  projectConnections: [],
  zones: [],
  labels: [],
  adapters: [],
  externalPorts: [],
  panelRows: [],
  bundles: [],
  connectorTypes: [
    { id: "ct1", name: "BNC", version: null, iconId: "bnc", color: "#0ea5e9", category: "Vidéo", functions: [], functionId: null },
  ],
  signals: [{ id: "sg1", name: "SDI", color: "#22c55e", cablePrefix: "V", cableSuffix: null, category: null, categoryRef: null }],
  signalCategories: [],
  equipmentCategories: [{ id: "f1", name: "Vidéo", color: "#3b82f6", children: [] }],
  appConfig: {},
  project: { id: "p1", name: "Finale Coupe de France" },
};

function api(iface: UiInterface, racks: unknown[] = RACKS, extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A", iface),
    "GET /api/tenant/projects/p1/editor": { body: editor(racks) },
    "GET /api/tenant/catalogue/adapters": { body: { arkyo: [], personal: [] } },
    "GET /api/tenant/catalogue/lookup": { body: { connectorTypes: [], signals: [], functions: [] } },
    "GET /api/tenant/projects/p1/synoptic/location/l1": { body: LOCATION },
    "GET /api/tenant/projects/p1/racks/r1/canvas-data": { body: RACK },
    "GET /api/tenant/projects/p1/racks/r2/canvas-data": { body: canvasData("r2", "Baie 2", [MIXER_SLOT]) },
    "GET /api/tenant/projects/p1/racks/v1/canvas-data": { body: canvasData("v1", "Régie", [TRIPOD_SLOT]) },
    "GET /api/tenant/projects/p1/racks/r1/inventory": { body: { items: [] } },
    "GET /api/tenant/projects/p1/racks/r2/inventory": { body: { items: [] } },
    "GET /api/racks/r1/connections": { body: CONNECTIONS },
    "GET /api/racks/r2/connections": { body: [] },
    "GET /api/racks/v1/connections": { body: [] },
    "GET /api/tenant/espace/informations": { body: { name: "Régie A", logoUrl: null } },
    ...extra,
  };
}

const zone = (name: string) => document.querySelector(`[data-zone="${name}"]`) as HTMLElement | null;
const drawer = () => zone("drawer")!;
const here = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;
/** Nœud d'équipement du synoptique (texte rendu dans le bloc du slot). */
const node = (name: string) => screen.getAllByText(name).find((el) => el.closest("[data-slot-id]"))!;
const pause = () => act(() => new Promise((r) => setTimeout(r, 60)));

async function openSynoptique(iface: UiInterface) {
  window.localStorage.setItem("project-p1-synoptique-rack", "loc:l1");
  // Dé-collision des îlots déjà faite (location-canvas) : aucune écriture de position au montage.
  window.localStorage.setItem("synoptic-loc-decollision:l1", "1");
  const app = renderApp("/project/p1?tab=synoptique", api(iface));
  await screen.findByText("Caméra X", { selector: "[data-slot-id] *" }, FIRST_LOAD);
  return app;
}

beforeEach(() => {
  window.localStorage.clear();
  dnd.ctx = null;
  dnd.draggables.clear();
  dnd.drops.length = 0;
});
afterEach(() => {
  resetApp();
  window.localStorage.clear();
  usePendingExportStore.getState().clearExport();
  delete document.documentElement.dataset.interface;
});

describe("synoptique : tiroir à la sélection", () => {
  test("sélection d'un nœud → tiroir ouvert avec Faces", async () => {
    await openSynoptique("strata");
    expect(drawer()).not.toBeVisible();

    fireEvent.click(node("Caméra X"));
    await waitFor(() => expect(drawer()).toBeVisible());
    // Carte « Faces » au-dessus du panneau d'arkyo : face, ports reliés, position.
    const faces = await within(drawer()).findByRole("region", { name: "Faces" });
    const card = await within(faces).findByRole("region", { name: "Équipement sélectionné" });
    expect(within(card).getByText("Connectique")).toBeInTheDocument();
    expect(card).toHaveTextContent("Baie 1");
    expect(card).toHaveTextContent("U1–U2");
    expect(within(faces).getByRole("button", { name: "Voir dans le rack" })).toBeEnabled();
  });

  test("Échap ferme ; même sélection ne rouvre pas", async () => {
    await openSynoptique("strata");

    // Échap ferme le tiroir (et le synoptique désélectionne) ; rien ne le rouvre.
    fireEvent.click(node("Caméra X"));
    await waitFor(() => expect(drawer()).toBeVisible());
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(drawer()).not.toBeVisible();
    await pause();
    expect(drawer()).not.toBeVisible();

    // Après la désélection, la même sélection est une sélection nouvelle.
    fireEvent.click(node("Caméra X"));
    await waitFor(() => expect(drawer()).toBeVisible());

    // Fermeture manuelle, sélection gardée : ni un nouveau clic sur le même
    // nœud ni les détails republiés par le temps réel ne rouvrent le tiroir.
    fireEvent.click(within(drawer()).getByRole("button", { name: "Fermer l'inspecteur" }));
    expect(drawer()).not.toBeVisible();
    fireEvent.click(node("Caméra X"));
    await pause();
    expect(drawer()).not.toBeVisible();
    emitAppEvent({ type: "update", entity: "slot", rackId: "r1", projectId: "p1" });
    await pause();
    expect(drawer()).not.toBeVisible();

    // Une autre sélection l'ouvre.
    fireEvent.click(node("Mélangeur"));
    await waitFor(() => expect(drawer()).toBeVisible());
  });

  test("Voir dans le rack", async () => {
    const { router } = await openSynoptique("strata");

    // Équipement en pose libre : pas d'élévation, bouton désactivé avec sa raison.
    fireEvent.click(node("Pied caméra"));
    let faces = await within(drawer()).findByRole("region", { name: "Faces" });
    const free = await within(faces).findByRole("button", { name: "Voir dans le rack" });
    expect(free).toBeDisabled();
    expect(free).toHaveAttribute("title", "Équipement en pose libre, hors rack");

    // Équipement de la Baie 2 (pas le premier contenant) : mode Racks sur la Baie 2.
    fireEvent.click(node("Mélangeur"));
    await waitFor(() => expect(within(drawer()).getByRole("region", { name: "Équipement sélectionné" })).toHaveTextContent("Baie 2"));
    faces = within(drawer()).getByRole("region", { name: "Faces" });
    const go = within(faces).getByRole("button", { name: "Voir dans le rack" });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=rack"));
    expect(window.localStorage.getItem("project-editor-tab")).toBe('"rack"');
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    await waitFor(() => expect(screen.getByTestId("rack-canvas")).toHaveAttribute("data-rack", "r2"));
  });
});

describe("Voir dans le rack, portée par emplacement", () => {
  test("Voir dans le rack : en portée lieu, le lieu du contenant est affiché", async () => {
    // L'onglet Rack est en portée « par emplacement », sur un autre lieu (Plateau).
    window.localStorage.setItem("rack-tab:display-scope", JSON.stringify("location"));
    window.localStorage.setItem("rack-tab:location", JSON.stringify("l2"));
    window.localStorage.setItem("project-p1-synoptique-rack", "loc:l1");
    window.localStorage.setItem("synoptic-loc-decollision:l1", "1");
    const { router } = renderApp(
      "/project/p1?tab=synoptique",
      api("strata", [...RACKS, rack("r5", "Baie plateau", { locationId: "l2" })], {
        "GET /api/tenant/projects/p1/editor": {
          body: {
            ...editor([...RACKS, rack("r5", "Baie plateau", { locationId: "l2" })]),
            inventaire: {
              rigConfigId: "rc1",
              racks: [...RACKS, rack("r5", "Baie plateau", { locationId: "l2" })],
              locations: [
                { id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: "v1" },
                { id: "l2", name: "Plateau", cableCode: "PLT", sortOrder: 1, virtualRackId: null },
              ],
            },
          },
        },
        "GET /api/tenant/projects/p1/racks/r5/canvas-data": { body: canvasData("r5", "Baie plateau", []) },
        "GET /api/racks/r5/connections": { body: [] },
      }),
    );
    await screen.findByText("Mélangeur", { selector: "[data-slot-id] *" }, FIRST_LOAD);
    fireEvent.click(node("Mélangeur"));
    const faces = await within(drawer()).findByRole("region", { name: "Faces" });
    await waitFor(() => expect(within(faces).getByRole("button", { name: "Voir dans le rack" })).toBeEnabled());
    fireEvent.click(within(faces).getByRole("button", { name: "Voir dans le rack" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=rack"));
    // Portée gardée, lieu du contenant (Régie) : ses deux baies, dont la Baie 2.
    await waitFor(() => expect(window.localStorage.getItem("rack-tab:location")).toBe('"l1"'));
    expect(window.localStorage.getItem("rack-tab:display-scope")).toBe('"location"');
    await waitFor(
      () => expect(screen.getAllByTestId("rack-canvas").map((c) => c.getAttribute("data-rack")).sort()).toEqual(["r1", "r2"]),
      FIRST_LOAD,
    );
  });
});

// ── Carte Faces seule : raisons du bouton, étagère, lecture en échec ────────

const PLAIN_SELECTION: Omit<SynopticSelection, "node" | "nodeRackId"> = {
  cable: null,
  adapter: null,
  zone: null,
  label: null,
  external: null,
  multiCable: [],
  multiNode: { nodeCount: 0, rackCount: 0 },
  multiExternal: [],
  generalRack: null,
  generalConnection: null,
};

/** Carte du tiroir pour le slot `slotId` du contenant `rackId` (lu par `canvas-data`). */
function renderFaces(rackId: string, slotId: string, racks: unknown[], canvas: Api[string]) {
  mockApi({
    [`GET /api/tenant/projects/p1/racks/${rackId}/canvas-data`]: canvas,
    [`GET /api/racks/${rackId}/connections`]: { body: [] },
  });
  const selection: SynopticSelection = {
    ...PLAIN_SELECTION,
    node: { slotId, equipmentName: "Caméra X", startU: null } as NodeSelectionDetails,
    nodeRackId: rackId,
  };
  render(
    <MemoryRouter initialEntries={["/project/p1?tab=synoptique"]}>
      <Routes>
        <Route
          path="/project/:id"
          element={
            <StrataSynopticDrawerTop
              projectId="p1"
              racks={racks as InventaireRack[]}
              locations={[]}
              selection={selection}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("carte Faces", () => {
  test("Voir dans le rack : contenant non rackable", async () => {
    renderFaces("rc", "s1", [rack("rc", "Caisse", { isRackable: false })], {
      body: canvasData("rc", "Caisse", [{ ...SLOT, rackId: "rc" }]),
    });
    const go = await screen.findByRole("button", { name: "Voir dans le rack" });
    expect(go).toBeDisabled();
    expect(go).toHaveAttribute("title", "Contenant non rackable");
  });

  test("Voir dans le rack : équipement non placé en U", async () => {
    renderFaces("ru", "s1", [rack("ru", "Baie U")], {
      body: canvasData("ru", "Baie U", [{ ...SLOT, rackId: "ru", startU: null }]),
    });
    const go = await screen.findByRole("button", { name: "Voir dans le rack" });
    expect(go).toBeDisabled();
    expect(go).toHaveAttribute("title", "Équipement non placé en U");
  });

  test("Voir dans le rack : équipement sur une étagère (slot enfant), placé par son étagère", async () => {
    const shelf = { ...SLOT, id: "sh1", rackId: "rs", equipment: null, startU: 20, heightU: 2, label: "ÉTAGÈRE" };
    const child = { ...SLOT, id: "ch1", rackId: "rs", parentSlotId: "sh1", startU: null, heightU: null };
    renderFaces("rs", "ch1", [rack("rs", "Baie S")], {
      body: canvasData("rs", "Baie S", [{ ...shelf, children: [child] }]),
    });
    const go = await screen.findByRole("button", { name: "Voir dans le rack" });
    expect(go).toBeEnabled();
    expect(screen.getByRole("region", { name: "Équipement sélectionné" })).toHaveTextContent("U20–U21");
  });

  test("lecture du contenant en échec : plus d'attente, message court", async () => {
    renderFaces("rx", "s1", [rack("rx", "Baie X")], () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await screen.findByText("Faces indisponibles : le contenant n'a pas pu être lu.")).toBeInTheDocument();
    expect(screen.queryByText("Chargement…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Voir dans le rack" })).toBeNull();
  });
});

describe("mode Racks", () => {
  test("mode Racks : bibliothèque dans le tiroir, dépôt sur un U libre (charge utile v1 inchangée)", async () => {
    const { fetchSpy } = renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir l'inspecteur" }));
    expect(drawer()).toBeVisible();

    // Bibliothèque v1 dans le tiroir (onglet par défaut sans sélection).
    const tabs = within(drawer()).getByRole("tablist", { name: "Tiroir du rack" });
    expect(within(tabs).getByRole("tab", { name: "Bibliothèque" })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: "Équipement" })).toBeDisabled();
    const library = await within(drawer()).findByRole("list", { name: "Bibliothèque" }, FIRST_LOAD);
    expect(within(library).getByText("Moniteur 17")).toBeInTheDocument();

    // Charge utile de glisser inchangée (celle de la nomenclature, sans contenant source).
    const payload = dnd.draggables.get("library-eq2") as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["equipment", "type", "widthFraction"]);
    expect(payload).toEqual({ type: "equipment", equipment: expect.objectContaining({ id: "eq2" }), widthFraction: "FULL" });

    // Dépôt sur U12 (libre) : le `DndContext` du rack le remet au canevas, tel quel.
    expect(dnd.ctx?.onDragEnd).toBeTypeOf("function");
    const event = {
      active: { id: "library-eq2", data: { current: payload } },
      over: { id: "drop-r1-FRONT-12-0", data: { current: { rackId: "r1", view: "FRONT", uIndex: 12, col: 0 } } },
    };
    await act(async () => {
      await dnd.ctx!.onDragEnd!(event);
    });
    expect(dnd.drops).toEqual([event]);
    // Aucun refus de la bibliothèque, aucune requête de sa part.
    expect(within(drawer()).queryByText(/Pas assez d'U libres/)).toBeNull();
    const slotPosts = fetchSpy.mock.calls.filter(
      ([input, init]) => (init as RequestInit | undefined)?.method === "POST" && String(input).includes("/slots"),
    );
    expect(slotPosts).toEqual([]);
  });

  test("Racks : la sélection d'un emplacement ouvre le tiroir sur sa face", async () => {
    renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    expect(drawer()).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "sélectionner CAM 1" }));
    await waitFor(() => expect(drawer()).toBeVisible());
    expect(within(drawer()).getByRole("tab", { name: "Équipement" })).toHaveAttribute("aria-selected", "true");
    const card = await within(drawer()).findByRole("region", { name: "Équipement sélectionné" });
    expect(card).toHaveTextContent("U1–U2");
  });

  test("barre flottante : sélecteur de mode, élévation sous la barre", async () => {
    const { router } = renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    // L'élévation commence sous la barre flottante (elle ne la recouvre plus).
    expect(zone("canvas")!.className).toMatch(/\btop-\[60px\]/);
    expect(zone("canvas")!.className).not.toMatch(/\binset-0\b/);

    const mode = within(zone("tools")!).getByRole("button", { name: "Mode : Racks" });
    fireEvent.keyDown(mode, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Synoptique",
      "Racks",
      "Plan",
      "Lumière",
      "Schémas",
    ]);
    expect(within(menu).getByRole("menuitem", { name: "Racks" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Synoptique" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=synoptique"));
    expect(window.localStorage.getItem("project-editor-tab")).toBe('"synoptique"');
  });

  test("export demandé par le dossier : la fenêtre d'export est visible, tiroir fermé", async () => {
    usePendingExportStore.getState().requestExport("rack");
    renderApp("/project/p1?tab=rack", api("strata"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    const dialog = await screen.findByRole("dialog", {}, FIRST_LOAD);
    expect(dialog).toBeVisible();
    expect(drawer().contains(dialog)).toBe(false);
    expect(drawer()).not.toBeVisible();
  });

  test("projet sans contenant rackable : EmptyState identique", async () => {
    const empty = async (iface: UiInterface) => {
      renderApp("/project/p1?tab=rack", api(iface, [rack("r1", "Caisse", { isRackable: false })]));
      const title = await screen.findByText("Aucun contenant rackable", {}, FIRST_LOAD);
      return title.parentElement!.outerHTML;
    };
    const classique = await empty("classique");
    resetApp();
    const strata = await empty("strata");
    expect(strata).toBe(classique);
    expect(screen.getByRole("button", { name: "Aller à l'Inventaire" })).toBeInTheDocument();
    // Ni tiroir ni bibliothèque.
    expect(zone("drawer")).toBeNull();
    expect(screen.queryByRole("list", { name: "Bibliothèque" })).toBeNull();
  });
});

// ── Classique ───────────────────────────────────────────────────────────────

function Shell({ iface, ...slots }: EditorShellSlots & { iface: UiInterface }) {
  return (
    <MemoryRouter initialEntries={["/project/p1?tab=rack"]}>
      <InterfaceProvider value={iface}>
        <WorkspaceProvider workspace="design">
          <EditorShell {...slots} />
        </WorkspaceProvider>
      </InterfaceProvider>
    </MemoryRouter>
  );
}

const slot = (label: string): ReactNode => <div>{label}</div>;

describe("Classique", () => {
  test("classique : EditorShell inchangé, tiroir Strata jamais monté", () => {
    let mounted = 0;
    function DrawerTop() {
      mounted += 1;
      return <div>faces</div>;
    }
    const slots: EditorShellSlots = {
      globalTopbar: slot("topbar"),
      contextualTopbar: slot("contextuelle"),
      leftToolbar: slot("outils"),
      canvas: slot("canevas"),
      rightPanel: slot("inspecteur"),
      globalTopbarHeight: 44,
    };
    const without = render(<Shell iface="classique" {...slots} />);
    const html = without.container.innerHTML;
    without.unmount();
    const { container } = render(<Shell iface="classique" {...slots} strata={{ drawerTop: <DrawerTop /> }} />);
    expect(container.innerHTML).toBe(html);
    expect(mounted).toBe(0);
  });

  test("classique : synoptique sans carte Faces ni lecture de contenant", async () => {
    const { fetchSpy } = await openSynoptique("classique");
    fireEvent.click(node("Caméra X"));
    await pause();
    expect(document.querySelector("[data-strata-canvas-shell]")).toBeNull();
    expect(screen.queryByRole("region", { name: "Faces" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Voir dans le rack" })).toBeNull();
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("/canvas-data"))).toBe(false);
  });
});
