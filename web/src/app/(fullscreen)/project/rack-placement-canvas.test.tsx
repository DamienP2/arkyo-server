/**
 * Canvas de placement de l'onglet Rack
 * (arkyo:app/(fullscreen)/project/[id]/rack/_components/rack-placement-canvas.tsx),
 * monté pour de vrai dans l'onglet avec une réponse `canvas-data` complète.
 *
 * Les dépôts passent par le vrai `DndContext` de l'onglet (`pointerWithin`) :
 * un glisser au pointeur depuis la liste « Éléments à placer » vers une
 * cellule U de la face avant. happy-dom ne calcule aucune géométrie ; comme
 * le `document.elementsFromPoint` simulé de la 4a, on donne aux seules
 * cellules droppables un rectangle (`getBoundingClientRect`) calculé à partir
 * de leur rangée, de leur colonne et de leur vue.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  OWNER_PERMS,
  emitAppEvent,
  renderApp,
  resetApp,
  sentBody,
  signedInApi,
  type Api,
} from "@/tests/app-harness";
import { U_HEIGHT_PX } from "@/components/synoptique/lib/constants";

/** Premier montage de l'éditeur projet, transformé à la demande par Vite. */
const FIRST_LOAD = { timeout: 15000 };

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

const CAMERA_BOM = {
  id: "i1",
  kind: "equipment",
  refId: "eq1",
  quantity: 3,
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
      {
        id: "r1",
        rigConfigId: "rc1",
        name: "Baie 1",
        rackType: "STANDARD",
        totalU: 42,
        depthMm: 600,
        widthMm: null,
        heightMm: null,
        hasWheels: false,
        emptyWeightKg: 30,
        slotsCount: 0,
        constructionChecks: 0,
        isRackable: true,
        hasConnectors: false,
        canvasX: null,
        canvasY: null,
        locationId: "l1",
        isVirtual: false,
        slots: [],
        bom: [CAMERA_BOM],
      },
    ],
    locations: [{ id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: null }],
  },
  cartographie: { maps: [] },
};

/** Équipement de la palette (`allEquipment`), tel que `canvas-data` le renvoie. */
const CAMERA = {
  id: "eq1",
  name: "Caméra X",
  reference: "CX-1",
  heightU: 2,
  widthFraction: "FULL",
  depthMm: 300,
  rearCableDepthMm: null,
  isRackable: true,
  connectors: [],
  category: "Vidéo",
  brand: { id: "b1", name: "Sony" },
  functions: [],
};

/** Slot posé en U1-U2 de la face avant (`rack.slots[]` de `canvas-data`). */
const SLOT = {
  id: "s1",
  rackId: "r1",
  catalogEquipmentId: "eq1",
  snapshotId: null,
  panelId: null,
  parentSlotId: null,
  inventoryItemId: "i1",
  view: "FRONT",
  startU: 1,
  heightU: 2,
  widthFraction: "FULL",
  column: 0,
  label: "CAM 1",
  notes: null,
  patchNotes: null,
  panelLabels: null,
  synopticX: null,
  synopticY: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  equipment: CAMERA,
  components: [],
  panel: null,
  children: [],
};

/** Slot fantôme de l'inventaire (`startU` / `heightU` nuls), non dessiné. */
const GHOST = {
  ...SLOT,
  id: "g1",
  startU: null,
  heightU: null,
  label: null,
  createdAt: "2026-11-01T10:01:00.000Z",
  updatedAt: "2026-11-01T10:01:00.000Z",
};

/** Réponse de `GET /api/tenant/projects/p1/racks/r1/canvas-data` (forme du serveur). */
function canvasData(slots: unknown[]) {
  return {
    rack: {
      id: "r1",
      rigConfigId: "rc1",
      name: "Baie 1",
      rackType: "STANDARD",
      totalU: 42,
      depthMm: 600,
      widthMm: null,
      heightMm: null,
      maxWeightKg: null,
      maxPowerW: null,
      emptyWeightKg: 30,
      rearInteriorGapMm: null,
      cableCode: null,
      numberingOverride: null,
      isRackable: true,
      locationId: "l1",
      rigs: [],
      slots,
    },
    allEquipment: [CAMERA],
    rackAccessories: [],
    allPanels: [],
    connectorTypes: [],
    signals: [],
    signalCategories: [],
    categories: [{ id: "f1", name: "Vidéo", color: "#3b82f6", children: [] }],
    patchPanelDepthMm: 5,
    cableSafetyDepthMm: 150,
  };
}

function rackApi(slots: unknown[], extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A"),
    "GET /api/tenant/projects/p1/editor": { body: EDITOR },
    "GET /api/tenant/projects/p1/racks/r1/canvas-data": { body: canvasData(slots) },
    "GET /api/tenant/projects/p1/racks/r1/inventory": {
      body: {
        items: [{ ...CAMERA_BOM, imageUrl: null, widthFraction: "FULL", panelType: null, hostItemId: null }],
      },
    },
    ...extra,
  };
}

/** Ouvre l'onglet Rack et attend la face avant du vrai canvas. */
async function openRack(slots: unknown[], extra: Api = {}) {
  const app = renderApp("/project/p1?tab=rack", rackApi(slots, extra));
  await screen.findByText("Face avant", {}, FIRST_LOAD);
  return app;
}

function slotNode(id: string): HTMLElement | null {
  return document.querySelector(`[data-slot-id="${id}"]`);
}

// ── Géométrie simulée des cellules droppables ──────────────────────────────

/** Abscisse de chaque vue (les autres éléments gardent un rectangle nul en 0,0). */
const VIEW_X: Record<string, number> = { FRONT: 1000, REAR_INTERIOR: 2000, REAR: 3000 };
const CELL_W = 400;
const CELL_H = 20;
const TOTAL_U = 42;

/**
 * Rectangle d'une cellule droppable de `RackVisual` : une rangée
 * `absolute inset-x-0 z-30` à `top = idx × U_HEIGHT_PX` (idx 0 = U le plus
 * haut), découpée en colonnes. Les autres éléments gardent la géométrie nulle
 * de happy-dom.
 */
function mockCellRects() {
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const row = this.parentElement;
    const view = this.closest("[data-view-id]")?.getAttribute("data-view-id");
    if (
      row &&
      view &&
      VIEW_X[view] != null &&
      row.classList.contains("inset-x-0") &&
      row.classList.contains("z-30") &&
      this.classList.contains("top-0")
    ) {
      const idx = Math.round(parseFloat(row.style.top) / U_HEIGHT_PX);
      const style = (this as HTMLElement).style;
      const w = parseFloat(style.width);
      const col = Math.round(parseFloat(style.left) / w);
      const width = (CELL_W * w) / 100;
      return new DOMRect(VIEW_X[view] + col * width, 100 + idx * CELL_H, width, CELL_H);
    }
    return original.call(this);
  });
}

/** Centre écran de la cellule `u` (colonne 0) d'une vue. */
function cellCenter(view: string, u: number) {
  return { x: VIEW_X[view] + 10, y: 100 + (TOTAL_U - u) * CELL_H + CELL_H / 2 };
}

/** Glisse la poignée `grip` jusqu'au point `to`, au pointeur (`PointerSensor`, seuil 8 px). */
async function dragTo(grip: HTMLElement, to: { x: number; y: number }) {
  fireEvent.pointerDown(grip, { clientX: 10, clientY: 10, isPrimary: true, button: 0, pointerId: 1 });
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: 40, clientY: 40, isPrimary: true, pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: to.x - 2, clientY: to.y - 2, isPrimary: true, pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: to.x, clientY: to.y, isPrimary: true, pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerUp(document, { clientX: to.x, clientY: to.y, isPrimary: true, pointerId: 1 });
  });
  // dnd-kit bloque les clics 50 ms après un glisser (clic parasite du relâcher).
  await act(() => new Promise((r) => setTimeout(r, 60)));
}

/** Poignée de la carte « Caméra X » de la liste « Éléments à placer ». */
async function cameraGrip(): Promise<HTMLElement> {
  const name = await screen.findByText("Caméra X", { selector: "p" });
  const card = name.closest("div.rounded-md.border") as HTMLElement;
  return card.querySelector("div.cursor-grab") as HTMLElement;
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

describe("canvas de placement du rack", () => {
  test("placement_canvas_mounts_with_real_data", async () => {
    await openRack([SLOT, GHOST]);

    // Vues par défaut : face avant, arrière intérieur absent (pas de
    // `rearInteriorGapMm`), face arrière et vue de côté.
    expect(screen.getByText("Face avant")).toBeInTheDocument();
    expect(screen.getByText("Face arrière")).toBeInTheDocument();
    expect(screen.queryByText("Arrière intérieur")).toBeNull();
    expect(screen.getByText("Vue côté")).toBeInTheDocument();
    expect(document.querySelector('[data-view-id="REAR_INTERIOR"]')).toBeNull();

    // Le slot posé est dessiné sur la face avant ; le fantôme ne l'est pas.
    const front = document.querySelector('[data-view-id="FRONT"]') as HTMLElement;
    expect(within(front).getAllByText("CAM 1").length).toBeGreaterThan(0);
    expect(slotNode("s1")).not.toBeNull();
    expect(slotNode("g1")).toBeNull();

    // Légende : seulement les catégories présentes dans la baie.
    expect(screen.getAllByText("Vidéo").length).toBeGreaterThan(0);

    // arkyo-server: habillage Strata : badge de profondeur en --accent-strong
    // (happy-dom ignore les `color-mix()` de sa bordure et de son fond).
    const depth = screen.getByText("Profondeur 600 mm");
    expect(depth.getAttribute("style")).toContain("var(--accent-strong)");

    // Préférences de vue du canvas mémorisées par contenant.
    await waitFor(() => expect(window.localStorage.getItem("project-rack-prefs-r1")).not.toBeNull());
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("drop_equipment_posts_slot", async () => {
    const created = { ...SLOT, id: "s9", startU: 10, label: null, inventoryItemId: "i1" };
    const { fetchSpy } = await openRack([SLOT], {
      "POST /api/racks/r1/slots": { status: 201, body: created },
    });
    mockCellRects();

    expect(await screen.findByTitle("2 à placer sur 3")).toHaveTextContent("×2");
    await dragTo(await cameraGrip(), cellCenter("FRONT", 10));

    // Chemin d'arkyo (`placeEquipment`) : POST /api/racks/:id/slots.
    await waitFor(() =>
      expect(sentBody(fetchSpy, "POST", "/api/racks/r1/slots")).toEqual({
        equipmentId: "eq1",
        view: "FRONT",
        startU: 10,
        heightU: 2,
        widthFraction: "FULL",
        column: 0,
      }),
    );
    // Le slot renvoyé est ajouté localement (`addSlot`), sans attendre le flux.
    await waitFor(() => expect(slotNode("s9")).not.toBeNull());
    expect(slotNode("s9")).toHaveTextContent("Sony Caméra X");

    // Un dépôt sur des U occupés (U2, pris par CAM 1) est refusé côté client :
    // la rangée pleine n'a pas de cellule droppable, aucun POST n'est envoyé.
    const posts = () =>
      fetchSpy.mock.calls.filter(
        ([u, init]) => String(u) === "/api/racks/r1/slots" && init?.method === "POST",
      ).length;
    expect(posts()).toBe(1);
    await dragTo(await cameraGrip(), cellCenter("FRONT", 2));
    expect(posts()).toBe(1);

    // Un dépôt près du haut est ramené à la dernière position possible
    // (2U dans 42U : U41), comme `handleDragEnd` d'arkyo.
    await dragTo(await cameraGrip(), cellCenter("FRONT", 42));
    await waitFor(() => expect(posts()).toBe(2));
    expect(sentBody(fetchSpy, "POST", "/api/racks/r1/slots")).toMatchObject({ startU: 41, heightU: 2 });
  });

  test("location_scope_shows_all_racks_of_location", async () => {
    // Vue « par emplacement » (arkyo:…/rack/_components/location-placement-canvas.tsx) :
    // les deux baies de la Régie côte à côte, chacune dans un vrai
    // `RackPlacementCanvas` embarqué, avec UNE seule vue (celle du bloc VUES).
    const r2 = {
      ...canvasData([]),
      rack: { ...canvasData([]).rack, id: "r2", name: "Baie 2", totalU: 12, rearInteriorGapMm: 80 },
    };
    const editor = {
      ...EDITOR,
      inventaire: {
        ...EDITOR.inventaire,
        racks: [
          ...EDITOR.inventaire.racks,
          { ...EDITOR.inventaire.racks[0], id: "r2", name: "Baie 2", totalU: 12, bom: [] },
        ],
      },
    };
    await openRack([SLOT, GHOST], {
      "GET /api/tenant/projects/p1/editor": { body: editor },
      "GET /api/tenant/projects/p1/racks/r2/canvas-data": { body: r2 },
      "GET /api/tenant/projects/p1/racks/r2/inventory": { body: { items: [] } },
    });

    fireEvent.click(screen.getByTitle("Par emplacement"));
    const columns = () => Array.from(document.querySelectorAll<HTMLElement>("[data-rack-column]"));
    await waitFor(() => expect(columns().map((c) => c.dataset.rackId)).toEqual(["r1", "r2"]));
    const views = () => columns().map((c) => Array.from(c.querySelectorAll("[data-view-id]")).map((v) => v.getAttribute("data-view-id")));

    // Vue par défaut du mode emplacement : la face avant, seule, sur chaque colonne.
    await waitFor(() => expect(views()).toEqual([["FRONT"], ["FRONT"]]));
    // Entête de colonne = nom du contenant (au lieu du nom de la vue).
    const [c1, c2] = columns();
    expect(within(c1).getByText("Baie 1")).toBeInTheDocument();
    expect(within(c2).getByText("Baie 2")).toBeInTheDocument();
    expect(screen.queryByText("Face avant")).toBeNull();
    // Le slot posé est dans la colonne de sa baie ; le fantôme n'est pas dessiné.
    expect(c1.contains(slotNode("s1"))).toBe(true);
    expect(slotNode("g1")).toBeNull();

    // Changement de vue : appliqué à toutes les colonnes.
    fireEvent.click(screen.getByTitle("Arrière"));
    await waitFor(() => expect(views()).toEqual([["REAR"], ["REAR"]]));

    // « Intérieur » (proposé car Baie 2 a une face arrière intérieure) :
    // Baie 1, sans face intérieure, garde sa colonne en face arrière.
    fireEvent.click(screen.getByTitle("Intérieur"));
    await waitFor(() => expect(views()).toEqual([["REAR"], ["REAR_INTERIOR"]]));
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("ghost_slot_drag_to_unit", async () => {
    // Le serveur réclame le fantôme g1 (même id) au lieu de créer un slot.
    const claimed = { ...GHOST, startU: 20, heightU: 2, view: "FRONT", column: 0 };
    const { fetchSpy } = await openRack([SLOT, GHOST], {
      "POST /api/racks/r1/slots": { status: 201, body: claimed },
    });
    expect(slotNode("g1")).toBeNull();
    mockCellRects();

    await dragTo(await cameraGrip(), cellCenter("FRONT", 20));

    await waitFor(() =>
      expect(sentBody(fetchSpy, "POST", "/api/racks/r1/slots")).toMatchObject({
        equipmentId: "eq1",
        view: "FRONT",
        startU: 20,
        heightU: 2,
      }),
    );
    // `addSlot` ignore un id déjà connu : le fantôme reste non dessiné tant que
    // le flux du rack n'a pas publié `slot_updated` (route.ts:288-298, comme
    // le serveur pour un fantôme réclamé).
    expect(slotNode("g1")).toBeNull();
    await act(async () => {
      emitAppEvent({ type: "slot_updated", slot: claimed });
    });
    await waitFor(() => expect(slotNode("g1")).not.toBeNull());
    const front = document.querySelector('[data-view-id="FRONT"]') as HTMLElement;
    expect(front.contains(slotNode("g1"))).toBe(true);
  });
});
