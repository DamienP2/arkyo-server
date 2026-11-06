/**
 * Onglet Inventaire de l'éditeur projet, 1/3 (arkyo:app/(fullscreen)/project/
 * [id]/inventaire/inventaire-client.tsx, `_components/inventaire-scope.tsx`,
 * `location-*`, `inventaire-*`, `_hooks/use-project-sync.ts`) : fiche du lieu
 * courant, sélecteur d'emplacement, création, renommage et suppression d'un
 * lieu, et rafraîchissement temps réel.
 *
 * La copie d'arkyo est rendue par le chargeur réel (`/project/:id`,
 * `GET /api/tenant/projects/:id/editor`). Le catalogue, l'assistant de
 * contenant (Task 11) et les cartes de contenant (Task 12) sont des bouchons.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import {
  emitAppEvent,
  mockApi,
  OWNER_PERMS,
  renderApp,
  resetApp,
  sentBody,
  signedInApi,
  type Api,
} from "@/tests/app-harness";
import { REFRESH_EVENT } from "next/navigation";
import { useProjectSync, type ProjectSyncEvent } from "./[id]/_hooks/use-project-sync";

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
function rack(id: string, name: string, locationId: string | null, extra: Record<string, unknown> = {}) {
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
    locationId,
    isVirtual: false,
    slots: [],
    bom: [],
    ...extra,
  };
}

const MONITOR = {
  id: "i1",
  kind: "equipment",
  refId: "eq1",
  quantity: 1,
  name: "Moniteur 17",
  reference: "LVM-170",
  brandName: "Sony",
  category: "Vidéo",
  categoryColor: "#3b82f6",
  isRackable: false,
  heightU: null,
  depthMm: null,
  weightKg: 4,
  powerW: 45,
  snapshotId: null,
};

/**
 * Deux lieux : la Régie (une baie et un moniteur en équipement libre) et le
 * Plateau (un flight case), plus un contenant hérité sans lieu.
 */
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
      rack("r1", "Baie 1", "l1"),
      rack("r2", "Flight 1", "l2", { rackType: "FLIGHT_CASE_CLASSIC", totalU: 6 }),
      rack("r3", "Ancien rack", null),
      rack("v1", "Régie", "l1", { isVirtual: true, isRackable: false, totalU: 0, bom: [MONITOR] }),
      rack("v2", "Plateau", "l2", { isVirtual: true, isRackable: false, totalU: 0 }),
    ],
    locations: [
      { id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: "v1" },
      { id: "l2", name: "Plateau", cableCode: null, sortOrder: 1, virtualRackId: "v2" },
    ],
  },
  cartographie: { maps: [] },
};

/** Catalogue de l'inventaire (`GET …/inventaire/catalog`), lu au montage pour les couleurs. */
const CATALOG = { equipments: [], panels: [], adapters: [] };

function editorApi(extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A"),
    "GET /api/tenant/projects/p1/editor": { body: EDITOR },
    "GET /api/tenant/projects/p1/inventaire/catalog": { body: CATALOG },
    ...extra,
  };
}

/** Ouvre l'onglet Inventaire et attend la fiche du lieu courant. */
async function open(extra: Api = {}) {
  const app = renderApp("/project/p1?tab=inventaire", editorApi(extra));
  await screen.findByText("Finale Coupe de France", {}, { timeout: 5000 });
  await screen.findByText("Équipements libres");
  return app;
}

/** Déclencheur du sélecteur d'emplacement (sous-topbar). */
function locationTrigger(): HTMLElement {
  const label = screen.getAllByText("Emplacement").find((el) => el.tagName === "SPAN")!;
  return label.parentElement!.querySelector("button")!;
}

/** Ouvre un menu Radix (le déclencheur s'ouvre au clavier dans happy-dom). */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

/** Panneau droit (`InventaireRightPanel`, seule `aside` de la coquille). */
function rightPanel(): HTMLElement {
  return document.querySelector("aside") as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("éditeur projet : inventaire 1/3", () => {
  test("inventory_lists_locations_and_racks", async () => {
    const { fetchSpy } = await open();

    // Lieu courant = premier lieu, mémorisé par projet.
    await waitFor(() => expect(window.localStorage.getItem("inventaire-location-p1")).toBe('"l1"'));
    const trigger = locationTrigger();
    expect(trigger).toHaveTextContent("Régie");
    expect(trigger).toHaveTextContent("REG · 1 cont. · 1 libre");

    // Fiche de la Régie : sa baie et son équipement libre, pas les autres contenants.
    expect(screen.getByText("Baie 1")).toBeInTheDocument();
    expect(screen.getByText("Moniteur 17")).toBeInTheDocument();
    expect(screen.getByText("45 W · 4 kg")).toBeInTheDocument();
    expect(screen.queryByText("Flight 1")).toBeNull();
    expect(screen.queryByText("Ancien rack")).toBeNull();
    // Ajout d'un contenant dans le lieu : bouton en pointillés.
    expect(screen.getByRole("button", { name: "Contenant dans Régie" })).toHaveClass("border-dashed");

    // Panneau droit : propriétés du lieu affiché.
    const panel = rightPanel();
    expect(within(panel).getByDisplayValue("Régie")).toBeInTheDocument();
    const card = (label: string) => within(panel).getByText(label).nextElementSibling;
    expect(card("Contenants")).toHaveTextContent("1");
    expect(card("Équip. libres")).toHaveTextContent("1");
    expect(card("Conso totale")).toHaveTextContent("45 W");
    expect(card("Poids estimé")).toHaveTextContent("4 kg");

    // Couleurs des catégories : le catalogue de l'inventaire est lu au montage.
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === "/api/tenant/projects/p1/inventaire/catalog")).toBe(true);

    // Sélecteur : les lieux, puis « À affecter » (un contenant sans lieu).
    openMenu(trigger);
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "RégieREG · 1 contenant · 1 équipement libre",
      "Plateau1 contenant · 0 équipement libre",
      "À affecter (1)",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Plateau/ }));
    expect(await screen.findByText("Flight 1")).toBeInTheDocument();
    expect(screen.queryByText("Baie 1")).toBeNull();
    expect(window.localStorage.getItem("inventaire-location-p1")).toBe('"l2"');

    // Vue « À affecter » : les contenants hérités, sans section d'équipements libres.
    openMenu(locationTrigger());
    fireEvent.click(await screen.findByRole("menuitem", { name: "À affecter (1)" }));
    expect(await screen.findByText("Ancien rack")).toBeInTheDocument();
    expect(screen.getByText("Ces contenants ne sont rattachés à aucun emplacement.")).toBeInTheDocument();
    expect(screen.queryByText("Équipements libres")).toBeNull();
  });

  test("add_location", async () => {
    const created = { id: "l3", name: "Nodal", cableCode: null, sortOrder: 2, virtualRackId: "v3", containerCount: 0 };
    const { fetchSpy } = await open({
      "POST /api/tenant/projects/p1/locations": { status: 201, body: created },
      "PATCH /api/tenant/projects/p1/locations/l3": { body: { ...created, cableCode: "NOD" } },
    });

    const add = screen.getByRole("button", { name: "Nouvel emplacement" });
    // Bouton « Ajouter » : toujours en pointillés.
    expect(add).toHaveClass("border-2", "border-dashed");
    fireEvent.click(add);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Régie, nodal, plateau, car…")).toBeInTheDocument();

    // Nom requis : rien n'est envoyé.
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer" }));
    expect(await within(dialog).findByText("Nom requis")).toBeInTheDocument();
    expect(sentBody(fetchSpy, "POST", "/api/tenant/projects/p1/locations")).toBeUndefined();

    fireEvent.change(within(dialog).getByPlaceholderText("Ex. Régie principale"), { target: { value: "Nodal" } });
    fireEvent.change(within(dialog).getByPlaceholderText("REG"), { target: { value: "nod" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Le POST ne porte que le nom ; le code part ensuite par PATCH, comme arkyo.
    expect(sentBody(fetchSpy, "POST", "/api/tenant/projects/p1/locations")).toEqual({ name: "Nodal" });
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PATCH", "/api/tenant/projects/p1/locations/l3")).toEqual({ cableCode: "nod" }),
    );
    // Le nouveau lieu devient le lieu affiché.
    await waitFor(() => expect(window.localStorage.getItem("inventaire-location-p1")).toBe('"l3"'));
    expect(locationTrigger()).toHaveTextContent("Nodal");
    expect(await screen.findByText("Enregistré")).toBeInTheDocument();
  });

  test("rename_and_delete_location", async () => {
    let refuse = true;
    const { fetchSpy } = await open({
      "PATCH /api/tenant/projects/p1/locations/l1": { body: { id: "l1" } },
      "DELETE /api/tenant/projects/p1/locations/l1": () =>
        refuse
          ? {
              status: 409,
              body: { error: "Ce lieu contient des contenants — déplacez-les avant suppression" },
            }
          : { body: { ok: true } },
    });

    // Renommage dans le panneau droit : saisie en capitales, envoyée au blur.
    const name = within(rightPanel()).getByDisplayValue("Régie");
    fireEvent.change(name, { target: { value: "Régie finale" } });
    fireEvent.blur(name);
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PATCH", "/api/tenant/projects/p1/locations/l1")).toEqual({ name: "RÉGIE FINALE" }),
    );
    expect(locationTrigger()).toHaveTextContent("RÉGIE FINALE");

    // Code câbles (option repliable) : normalisé, envoyé au blur.
    fireEvent.click(within(rightPanel()).getByText("Code câbles"));
    const code = within(rightPanel()).getByDisplayValue("REG");
    fireEvent.change(code, { target: { value: "rg-1" } });
    fireEvent.blur(code);
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PATCH", "/api/tenant/projects/p1/locations/l1")).toEqual({ cableCode: "RG1" }),
    );

    // Suppression refusée (409) : message de l'API, le lieu reste affiché.
    fireEvent.click(within(rightPanel()).getByText("Supprimer cet emplacement"));
    fireEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
    expect(
      await screen.findByText("Ce lieu contient des contenants — déplacez-les avant suppression"),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("inventaire-location-p1")).toBe('"l1"');
    expect(locationTrigger()).toHaveTextContent("RÉGIE FINALE");

    // Suppression acceptée : la fiche passe au lieu suivant.
    refuse = false;
    fireEvent.click(within(rightPanel()).getByText("Supprimer cet emplacement"));
    fireEvent.click(await screen.findByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(window.localStorage.getItem("inventaire-location-p1")).toBe('"l2"'));
    expect(locationTrigger()).toHaveTextContent("Plateau");
    expect(await screen.findByText("Flight 1")).toBeInTheDocument();
    openMenu(locationTrigger());
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual([
      "Plateau1 contenant · 0 équipement libre",
      "À affecter (1)",
    ]);
    const deletes = fetchSpy.mock.calls.filter(
      ([u, init]) => String(u) === "/api/tenant/projects/p1/locations/l1" && init?.method === "DELETE",
    );
    expect(deletes).toHaveLength(2);
  });

  test("project_sync_refreshes_on_rack_inventory_event", async () => {
    let editorReads = 0;
    await open({
      "GET /api/tenant/projects/p1/editor": () => {
        editorReads += 1;
        return { body: EDITOR };
      },
    });
    expect(editorReads).toBe(1);

    // `router.refresh()` émis : `AppSync` du layout (tout évènement, immédiat)
    // et `useProjectSync` de l'inventaire (filtré, après 150 ms).
    let refreshes = 0;
    const onRefresh = () => {
      refreshes += 1;
    };
    window.addEventListener(REFRESH_EVENT, onRefresh);
    try {
      // Évènement d'un autre projet : seul `AppSync` réagit.
      act(() => {
        emitAppEvent({ type: "update", entity: "rack_inventory", action: "updated", id: "x9", projectId: "p2", rackId: "x9", itemId: "i9" });
      });
      await new Promise((r) => setTimeout(r, 250));
      expect(refreshes).toBe(1);

      // Inventaire du projet (forme publiée par le serveur) : les deux réagissent,
      // puis la route `editor` est relue.
      refreshes = 0;
      act(() => {
        emitAppEvent({ type: "update", entity: "rack_inventory", action: "updated", id: "r1", projectId: "p1", rackId: "r1", itemId: "i1" });
      });
      await waitFor(() => expect(refreshes).toBe(2));
      await waitFor(() => expect(editorReads).toBeGreaterThan(1));

      // Lieu et contenant : entités suivies par l'inventaire.
      for (const [entity, id] of [
        ["location", "l1"],
        ["rack", "r1"],
      ]) {
        refreshes = 0;
        act(() => {
          emitAppEvent({ type: "update", entity, action: "updated", id, projectId: "p1" });
        });
        await waitFor(() => expect(refreshes).toBe(2));
      }
    } finally {
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    }
  });
});

describe("useProjectSync", () => {
  function setup(opts: Partial<Parameters<typeof useProjectSync>[0]> = {}) {
    mockApi({});
    const onUpdate = vi.fn<(e: ProjectSyncEvent) => void>();
    renderHook(() =>
      useProjectSync({
        projectId: "p1",
        entities: ["rack_inventory", "rack", "location"],
        debounceMs: 10,
        onUpdate,
        ...opts,
      }),
    );
    return onUpdate;
  }

  const settle = () => act(() => new Promise((r) => setTimeout(r, 30)));

  test("filtre projet, entité, rack et émetteur, puis regroupe les rafales", async () => {
    const onUpdate = setup({ rackId: "r1" });
    const own = window.sessionStorage.getItem("arkyo.clientId");
    act(() => {
      emitAppEvent({ type: "ping" });
      emitAppEvent({ type: "update", entity: "rack_inventory", action: "updated", projectId: "p2", rackId: "r1" });
      emitAppEvent({ type: "update", entity: "tenant_catalogue", action: "updated", projectId: "p1" });
      emitAppEvent({ type: "update", entity: "rack_inventory", action: "updated", projectId: "p1", rackId: "r2" });
      emitAppEvent({ type: "update", entity: "rack_inventory", action: "updated", projectId: "p1", rackId: "r1", clientId: own });
      // Sans `projectId` : ignoré par défaut.
      emitAppEvent({ type: "update", entity: "rack", action: "updated", id: "r1" });
    });
    await settle();
    expect(onUpdate).not.toHaveBeenCalled();

    act(() => {
      emitAppEvent({ type: "update", entity: "location", action: "created", id: "l9", projectId: "p1" });
      emitAppEvent({ type: "update", entity: "rack_inventory", action: "updated", id: "r1", projectId: "p1", rackId: "r1", itemId: "i1" });
    });
    await settle();
    // Rafale : un seul appel, avec le dernier évènement.
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({
      entity: "rack_inventory",
      action: "updated",
      id: "r1",
      projectId: "p1",
      rackId: "r1",
      itemId: "i1",
    });
  });

  test("acceptUnscoped et includeOwn", async () => {
    const onUpdate = setup({ acceptUnscoped: true, includeOwn: true });
    const own = window.sessionStorage.getItem("arkyo.clientId");
    act(() => {
      emitAppEvent({ type: "update", entity: "rack", action: "deleted", id: "r1" });
    });
    await settle();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    act(() => {
      emitAppEvent({ type: "update", entity: "rack", action: "updated", id: "r1", projectId: "p1", clientId: own });
    });
    await settle();
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });
});
