/**
 * Onglet Rack de l'éditeur projet (arkyo:app/(fullscreen)/project/[id]/rack/
 * {rack-tab-client, _components/{rack-tab-left-toolbar,
 * rack-location-selector-dropdown, rack-location-info-panel,
 * rack-tab-side-panel, rack-info-panel, category-legend,
 * rack-drag-eligibility}}.tsx) : chargement de `canvas-data`, changement de
 * contenant, de vue et de portée, éléments à placer, panneau de propriétés du
 * slot (`RackTabRightPanel` / `RackTabSlotPropertiesWrapper` de
 * `project-editor.tsx`) et rafraîchissement par `useProjectSync`.
 *
 * Le canvas de placement (`rack-placement-canvas`, Task 5) est remplacé ici
 * par un faux qui expose ses props et sélectionne un slot au clic : ces tests
 * portent sur le câblage de l'onglet, pas sur le canvas.
 */

import { forwardRef, useImperativeHandle } from "react";
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

/**
 * Attente du premier montage : l'éditeur projet (≈ 8 000 l. avec
 * l'inventaire) est transformé à la demande par Vite ; sous charge CPU, cela
 * dépasse 5 s.
 */
const FIRST_LOAD = { timeout: 15000 };

type FakeCanvasProps = {
  rack: { id: string; name: string };
  initialSlots: { id: string; label: string | null }[];
  visibleViews: string[];
  renderMode?: string;
  onSlotSelect?: (slot: unknown) => void;
};

vi.mock("@/app/(fullscreen)/project/[id]/rack/_components/rack-placement-canvas", () => ({
  RackDragOverlayContent: () => null,
  RackPlacementCanvas: forwardRef<unknown, FakeCanvasProps>(function FakeCanvas(props, ref) {
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
    return (
      <div
        data-testid="rack-canvas"
        data-rack={props.rack.id}
        data-views={props.visibleViews.join(",")}
        data-render={props.renderMode}
      >
        {props.initialSlots.map((s) => (
          <button key={s.id} type="button" onClick={() => props.onSlotSelect?.(s)}>
            slot {s.label}
          </button>
        ))}
      </div>
    );
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
      rack("r1", "Baie 1", { emptyWeightKg: 30, bom: [CAMERA_BOM] }),
      rack("r2", "Baie 2", { totalU: 12, depthMm: 450 }),
      rack("v1", "Régie", { isVirtual: true, isRackable: false, totalU: 0 }),
    ],
    locations: [{ id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: "v1" }],
  },
  cartographie: { maps: [] },
};

const CAMERA = {
  id: "eq1",
  name: "Caméra X",
  reference: "CX-1",
  heightU: 2,
  widthFraction: "FULL",
  depthMm: 300,
  isRackable: true,
  connectors: [],
  category: "Vidéo",
  brand: { id: "b1", name: "Sony" },
  functions: [],
};

/** Slot posé (réponse `canvas-data`, `rack.slots[]`). */
const SLOT = {
  id: "s1",
  rackId: "r1",
  catalogEquipmentId: "eq1",
  equipmentId: "eq1",
  inventoryItemId: "i1",
  startU: 1,
  heightU: 2,
  view: "FRONT",
  widthFraction: "FULL",
  column: 0,
  label: "CAM 1",
  notes: null,
  panelId: null,
  panel: null,
  equipment: CAMERA,
  components: [],
  children: [],
};

/** Panel de patch posé, avec un libellé N1 sur les ports 1 à 4. */
const PANEL_SLOT = {
  ...SLOT,
  id: "s2",
  catalogEquipmentId: null,
  equipmentId: null,
  inventoryItemId: null,
  startU: 5,
  heightU: 1,
  label: "PATCH A",
  equipment: null,
  panelId: "pn1",
  panel: {
    id: "pn1",
    name: "Patch BNC 8",
    heightU: 1,
    slotsPerU: 8,
    rearCableDepthMm: null,
    slots: [],
  },
  panelLabels: { 0: [[{ id: "g1", start: 1, end: 4, text: "CAM", color: "#ef4444" }], []] },
};

/** Réponse de `GET /api/tenant/projects/p1/racks/:rackId/canvas-data`. */
function canvasData(id: string, name: string, slots: unknown[] = []) {
  return {
    rack: {
      id,
      name,
      totalU: id === "r2" ? 12 : 42,
      depthMm: 600,
      rackType: "STANDARD",
      rearInteriorGapMm: null,
      rigs: [],
      slots,
    },
    allEquipment: [CAMERA],
    rackAccessories: [],
    allPanels: [],
    categories: [{ id: "f1", name: "Vidéo", color: "#3b82f6", children: [] }],
    connectorTypes: [],
    signals: [],
    signalCategories: [],
    patchPanelDepthMm: 100,
    cableSafetyDepthMm: 100,
  };
}

function inventory(items: unknown[]) {
  return { items };
}

/** Compteur des lectures `canvas-data` par contenant. */
function counters() {
  const reads: Record<string, number> = { r1: 0, r2: 0 };
  const api: Api = {
    "GET /api/tenant/projects/p1/racks/r1/canvas-data": () => {
      reads.r1 += 1;
      return { body: canvasData("r1", "Baie 1", [SLOT, PANEL_SLOT]) };
    },
    "GET /api/tenant/projects/p1/racks/r2/canvas-data": () => {
      reads.r2 += 1;
      return { body: canvasData("r2", "Baie 2") };
    },
  };
  return { reads, api };
}

function rackApi(extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A"),
    "GET /api/tenant/projects/p1/editor": { body: EDITOR },
    "GET /api/tenant/projects/p1/racks/r1/inventory": {
      body: inventory([{ ...CAMERA_BOM, imageUrl: null, widthFraction: "FULL", panelType: null, hostItemId: null }]),
    },
    "GET /api/tenant/projects/p1/racks/r2/inventory": { body: inventory([]) },
    ...extra,
  };
}

/** Ouvre l'onglet Rack et attend le canvas du premier contenant. */
async function openRack(extra: Api = {}) {
  const app = renderApp("/project/p1?tab=rack", rackApi(extra));
  await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
  return app;
}

/** Topbar contextuelle (deuxième enfant de l'`EditorShell`). */
function shell(): HTMLElement {
  return document.querySelector("div.fixed.z-50") as HTMLElement;
}

/** Panneau droit (`RackTabRightPanel`). */
function rightPanel(): HTMLElement {
  return document.querySelector("aside") as HTMLElement;
}

/** Ouvre un menu Radix (le déclencheur s'ouvre au clavier dans happy-dom). */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("onglet Rack", () => {
  test("rack_tab_lists_racks_and_switches_view", async () => {
    const { reads, api } = counters();
    const { fetchSpy } = await openRack(api);

    // Premier contenant rackable : `canvas-data` de Baie 1, vues par défaut.
    const canvas = screen.getByTestId("rack-canvas");
    expect(canvas).toHaveAttribute("data-rack", "r1");
    expect(canvas).toHaveAttribute("data-views", "FRONT,REAR,REAR_INTERIOR,SIDE");
    expect(reads.r1).toBe(1);
    expect(reads.r2).toBe(0);

    // Panneau gauche : éléments à placer du BOM (3 caméras, une posée).
    expect(screen.getByText("Éléments à placer")).toBeInTheDocument();
    expect(await screen.findByTitle("2 à placer sur 3")).toHaveTextContent("×2");
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === "/api/tenant/projects/p1/racks/r1/inventory")).toBe(true);

    // Panneau droit : infos du contenant (lecture seule) et totaux du BOM.
    const right = within(rightPanel());
    expect(right.getByText("Contenant")).toBeInTheDocument();
    expect(right.getByText("42 U")).toBeInTheDocument();
    expect(right.getByText("45 kg")).toBeInTheDocument();
    expect(right.getByText("300 W")).toBeInTheDocument();
    expect(right.getByRole("button", { name: /Vider la baie/ })).toBeInTheDocument();

    // Barre gauche : preset « Arrière » (vue de côté toujours incluse), mémorisé.
    fireEvent.click(screen.getByTitle("Arrière"));
    await waitFor(() => expect(screen.getByTestId("rack-canvas")).toHaveAttribute("data-views", "REAR,SIDE"));
    expect(JSON.parse(window.localStorage.getItem("rack-tab:visible-views")!)).toEqual(["REAR", "SIDE"]);
    // Pas de face arrière intérieure : pas de preset « Intérieur ».
    expect(screen.queryByTitle("Intérieur")).toBeNull();
    // Mode de rendu.
    fireEvent.click(screen.getByTitle("Photo"));
    await waitFor(() => expect(screen.getByTestId("rack-canvas")).toHaveAttribute("data-render", "photo"));

    // Sous-topbar : changement de contenant → `canvas-data` de Baie 2.
    openMenu(within(shell()).getByRole("button", { name: /Baie 1/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Baie 2/ }));
    await waitFor(() => expect(screen.getByTestId("rack-canvas")).toHaveAttribute("data-rack", "r2"));
    expect(reads.r2).toBe(1);
    expect(await screen.findByText("Aucun élément à placer dans ce contenant")).toBeInTheDocument();
    expect(within(rightPanel()).getByText("12 U")).toBeInTheDocument();

    // Portée « par emplacement » : le lieu, ses contenants et leur `canvas-data`.
    const r1Before = reads.r1;
    const r2Before = reads.r2;
    fireEvent.click(screen.getByTitle("Par emplacement"));
    // Aucun lieu mémorisé : celui du contenant courant, dans la sous-topbar.
    const locationButton = await within(shell()).findByRole("button", { name: /Régie.*REG · 2 contenants/ });
    await waitFor(() => {
      expect(reads.r1).toBe(r1Before + 1);
      expect(reads.r2).toBe(r2Before + 1);
    });
    // Panneau droit : infos de l'emplacement (2 contenants rackables sur 2).
    expect(await within(rightPanel()).findByText("Emplacement")).toBeInTheDocument();
    expect(within(rightPanel()).getByText("2 / 2")).toBeInTheDocument();
    // Vues du mode emplacement : une seule à la fois.
    expect(screen.getByTitle("Vue côté")).toBeInTheDocument();
    expect(screen.queryByTitle("Avant + Arrière")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("rack-tab:location")!)).toBe("l1");
    openMenu(locationButton);
    expect(await screen.findByRole("menuitem", { name: /Régie/ })).toBeInTheDocument();
    // Panneau gauche : une section par contenant du lieu.
    expect(screen.getByText("Glissez un élément vers la colonne de son contenant.")).toBeInTheDocument();
  });

  test("slot_properties_patch_and_delete", async () => {
    const { api } = counters();
    const { fetchSpy } = await openRack({
      ...api,
      "PATCH /api/racks/r1/slots/s1": { body: { ...SLOT, label: "CAM 2" } },
      "DELETE /api/racks/r1/slots/s1": { body: { ok: true } },
    });

    // Sélection d'un slot dans le canvas → panneau de propriétés du slot.
    fireEvent.click(screen.getByRole("button", { name: "slot CAM 1" }));
    const name = await screen.findByDisplayValue("CAM 1");
    // Couleur de la catégorie (`CategoryColorCtx` du wrapper) sur le badge.
    expect(within(rightPanel()).getByText("Vidéo")).toHaveStyle({ color: "#3b82f6" });

    // Renommage : PATCH { label } au blur.
    fireEvent.change(name, { target: { value: "cam 2" } });
    fireEvent.blur(name);
    await waitFor(() => expect(sentBody(fetchSpy, "PATCH", "/api/racks/r1/slots/s1")).toEqual({ label: "CAM 2" }));

    // Retrait : confirmation, puis DELETE et retour aux infos du contenant.
    fireEvent.click(screen.getByRole("button", { name: /Retirer de la baie/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Retirer « CAM 1 » de la baie ?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer" }));
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([u, init]) => String(u) === "/api/racks/r1/slots/s1" && init?.method === "DELETE",
        ),
      ).toBe(true),
    );
    expect(await within(rightPanel()).findByRole("button", { name: /Vider la baie/ })).toBeInTheDocument();
  });

  test("port_labels_patch_panel_labels", async () => {
    // Appelant de `PortLabelEditor.onSave` : `savePanelLabels` de
    // `RackTabSlotPropertiesWrapper` (`project-editor.tsx`), qui envoie
    // `PATCH /api/racks/:id/slots/:slotId { label, panelLabels }` comme arkyo
    // (route acceptée par `rack_slots.rs`, champ `panelLabels`).
    const { api } = counters();
    const { fetchSpy } = await openRack({
      ...api,
      "PATCH /api/racks/r1/slots/s2": { body: PANEL_SLOT },
    });

    fireEvent.click(screen.getByRole("button", { name: "slot PATCH A" }));
    fireEvent.click(await screen.findByRole("button", { name: /Étiquetage des ports/ }));
    const group = await screen.findByDisplayValue("CAM");
    fireEvent.change(group, { target: { value: "vtr" } });
    // Sauvegarde automatique (700 ms), sans fermer l'éditeur.
    await waitFor(
      () =>
        expect(sentBody(fetchSpy, "PATCH", "/api/racks/r1/slots/s2")).toEqual({
          label: "PATCH A",
          panelLabels: { 0: [[{ id: "g1", start: 1, end: 4, text: "VTR", color: "#ef4444" }], []] },
        }),
      { timeout: 3000 },
    );
    expect(screen.getByDisplayValue("VTR")).toBeInTheDocument();
  });

  test("project_sync_refreshes_on_slot_event", async () => {
    const { reads, api } = counters();
    await openRack(api);
    expect(reads.r1).toBe(1);

    // Évènement app de la route slots (`publish_meta("slot", …)`, sans projectId).
    act(() => {
      emitAppEvent({ type: "update", entity: "slot", action: "updated", id: "s1", rackId: "r1", itemId: "s1" });
    });
    await waitFor(() => expect(reads.r1).toBe(2));

    // Inventaire du contenant, puis propriétés du contenant (déplacement sur le plan).
    act(() => {
      emitAppEvent({ type: "update", entity: "rack_inventory", action: "updated", id: "r1", rackId: "r1" });
    });
    await waitFor(() => expect(reads.r1).toBe(3));
    act(() => {
      emitAppEvent({ type: "update", entity: "rack", action: "updated", id: "r1", rackId: "r1", itemId: "r1" });
    });
    await waitFor(() => expect(reads.r1).toBe(4));

    // Nos propres mutations aussi (`includeOwn`), mais pas les autres projets
    // ni les entités hors liste.
    act(() => {
      emitAppEvent({ type: "update", entity: "slot", action: "created", id: "s2", projectId: "p2" });
      emitAppEvent({ type: "update", entity: "panel", action: "updated", id: "pn1" });
      emitAppEvent({ type: "ping" });
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(reads.r1).toBe(4);
    // Refetch silencieux : le canvas reste monté.
    expect(screen.getByTestId("rack-canvas")).toBeInTheDocument();
  });
});
