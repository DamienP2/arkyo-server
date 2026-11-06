/**
 * `/rigs/:id` : détail d'une régie (arkyo:app/(app)/rigs/[id]/{page.tsx,
 * rig-detail-client.tsx}). Chargeur : `GET /api/rigs/:id` (rigRacks par
 * position, slots par startU enrichis d'`equipment`, `project`),
 * `GET /api/racks?unassigned=true&rigConfigId=:id` (racks disponibles) et le
 * catalogue d'équipements actifs ; garde `design:read`.
 *
 * Glisser un rack disponible sur la zone de dépôt le lie
 * (`POST /api/rigs/:id/racks { rackId }`, position = dernière + 1 côté
 * serveur), la corbeille d'une carte le retire
 * (`DELETE /api/rigs/:id/racks/:rackId`).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  OWNER_PERMS,
  TECH_PERMS,
  renderApp,
  resetApp,
  sentBody,
  signedInApi,
  type Api,
} from "@/tests/app-harness";

function equipment(id: string, weight: number | null, powerW: number | null) {
  return {
    id,
    name: `Équipement ${id}`,
    reference: null,
    weight,
    powerW,
    heightU: 1,
    widthFraction: "FULL",
  };
}

function slot(rackId: string, id: string, startU: number, heightU: number, eq: ReturnType<typeof equipment> | null) {
  return {
    id,
    rackId,
    view: "FRONT",
    startU,
    heightU,
    label: null,
    notes: null,
    catalogEquipmentId: eq?.id ?? null,
    equipment: eq,
  };
}

function rack(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    totalU: 12,
    depthMm: 600,
    maxWeightKg: null,
    maxPowerW: null,
    emptyWeightKg: null,
    notes: null,
    rackType: "STANDARD",
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    slots: [],
    ...extra,
  };
}

const RACKS: Record<string, ReturnType<typeof rack>> = {
  r1: rack("r1", "Baie Vidéo", {
    emptyWeightKg: 20,
    slots: [slot("r1", "s1", 1, 2, equipment("e1", 5.5, 150)), slot("r1", "s2", 3, 1, equipment("e2", 2, 50))],
  }),
  r2: rack("r2", "Flight Son", { totalU: 6, depthMm: 450 }),
  r3: rack("r3", "Rack Lumière", { totalU: 8 }),
  r4: rack("r4", "Pelicase HF", { totalU: 4, depthMm: 400 }),
};

/**
 * Serveur simulé, avec état : les liens de la régie g1 (`RigRack`) changent
 * aux POST / DELETE, et les GET suivants (rechargement de `router.refresh()`)
 * les relisent, comme l'API.
 */
function rigServer(perms: unknown = OWNER_PERMS, linked: string[] = ["r1", "r3"]) {
  const links = linked.map((rackId, position) => ({ id: `rr-${rackId}`, rigConfigId: "g1", rackId, position }));
  const api: Api = {
    ...signedInApi(perms),
    "GET /api/rigs/g1": () => ({
      body: {
        id: "g1",
        name: "Régie Nord",
        type: "CAR",
        prestationType: "Captation",
        isTemplate: false,
        notes: null,
        projectId: "p1",
        createdById: "u1",
        createdAt: "2026-11-01T10:00:00.000Z",
        updatedAt: "2026-11-01T10:00:00.000Z",
        rigRacks: [...links]
          .sort((a, b) => a.position - b.position)
          .map((l) => ({ ...l, rack: RACKS[l.rackId] })),
        project: { id: "p1", name: "Festival" },
      },
    }),
    "GET /api/racks?unassigned=true&rigConfigId=g1": () => ({
      body: Object.values(RACKS).filter((r) => !links.some((l) => l.rackId === r.id)),
    }),
    "GET /api/tenant/catalogue/equipment": {
      body: { arkyo: [], personal: [equipment("e2", 2, 50), equipment("e1", 5.5, 150)] },
    },
    "POST /api/rigs/g1/racks": (init) => {
      const { rackId } = JSON.parse(String(init?.body));
      const position = Math.max(-1, ...links.map((l) => l.position)) + 1;
      const link = { id: `rr-${rackId}`, rigConfigId: "g1", rackId, position };
      links.push(link);
      return { status: 201, body: { ...link, rack: RACKS[rackId] } };
    },
  };
  for (const id of Object.keys(RACKS)) {
    api[`DELETE /api/rigs/g1/racks/${id}`] = () => {
      const i = links.findIndex((l) => l.rackId === id);
      if (i < 0) return { status: 404, body: { error: "Link not found" } };
      links.splice(i, 1);
      return { body: { ok: true } };
    };
  }
  return { api, links };
}

/** Panneau « Racks disponibles ». */
function sidebar() {
  return screen.getByText("Racks disponibles").parentElement!.parentElement as HTMLElement;
}

/** Noms des cartes de la régie, dans l'ordre affiché. */
function cardNames() {
  return Array.from(document.querySelectorAll("p.truncate.text-\\[13px\\].font-semibold")).map(
    (p) => p.textContent,
  );
}

/**
 * Glisse le rack disponible `name` du panneau gauche et le relâche sur la
 * zone de dépôt (`drop`) ou loin d'elle. happy-dom ne mesure rien : toutes
 * les boîtes valent 0,0-200×100, donc le rack déplacé de 35 px recoupe la
 * zone, et plus du tout à 5 000 px.
 */
async function dragRack(name: string, drop: boolean) {
  const handle = within(sidebar()).getByText(name).closest("div.cursor-grab") as HTMLElement;
  fireEvent.pointerDown(handle, { clientX: 10, clientY: 10, isPrimary: true, button: 0, pointerId: 1 });
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: 40, clientY: 40, isPrimary: true, pointerId: 1 });
  });
  expect(await screen.findByText(/Déposer un rack ici|Relâcher pour ajouter/)).toBeInTheDocument();
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: 45, clientY: 45, isPrimary: true, pointerId: 1 });
  });
  if (drop) {
    expect(await screen.findByText("Relâcher pour ajouter")).toBeInTheDocument();
  } else {
    // Relâché hors de la zone : l'élément glissé ne la recoupe plus.
    await act(async () => {
      fireEvent.pointerMove(document, { clientX: 5000, clientY: 5000, isPrimary: true, pointerId: 1 });
    });
    expect(await screen.findByText("Déposer un rack ici")).toBeInTheDocument();
  }
  await act(async () => {
    fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1 });
  });
  // dnd-kit bloque les clics 50 ms après un glisser (clic parasite du relâcher).
  await act(() => new Promise((r) => setTimeout(r, 60)));
}

const BOX = { x: 0, y: 0, top: 0, left: 0, width: 200, height: 100, right: 200, bottom: 100 };

beforeAll(async () => {
  await import("@/app/(app)/rigs/[id]/page");
}, 30000);
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ ...BOX, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  resetApp();
});

describe("/rigs/:id", () => {
  test("rig_detail_links_and_unlinks_rack", async () => {
    const { api, links } = rigServer();
    const { fetchSpy, router } = renderApp("/rigs/g1", api);

    // En-tête, projet, statistiques globales, cartes par position.
    expect(await screen.findByRole("heading", { level: 1, name: "Régie Nord" }, { timeout: 5000 })).toBeInTheDocument();
    const urls = fetchSpy.mock.calls.map(([u]) => String(u));
    expect(urls).toContain("/api/rigs/g1");
    expect(urls).toContain("/api/racks?unassigned=true&rigConfigId=g1");
    expect(urls).toContain("/api/tenant/catalogue/equipment");
    expect(screen.getByText("Car régie")).toBeInTheDocument();
    expect(screen.getByText("Captation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Festival" })).toHaveAttribute("href", "/projects/p1");
    // Statistiques globales (cartes) : occupation, poids (vide + équipements), puissance.
    expect(screen.getByText("3U / 20U", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("27.5 kg", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("200 W", { selector: "p" })).toBeInTheDocument();
    expect(cardNames()).toEqual(["Baie Vidéo", "Rack Lumière"]);
    // Éditeur de rack de la régie : phase 4 (ComingSoon), lien d'arkyo conservé.
    expect(screen.getAllByTitle("Ouvrir l'éditeur")[0]).toHaveAttribute("href", "/rigs/g1/rack/r1");
    // Racks disponibles : ceux qui ne sont pas liés à cette régie.
    expect(within(sidebar()).getByText("Flight Son")).toBeInTheDocument();
    expect(within(sidebar()).getByText("4 U · 400 mm")).toBeInTheDocument();
    expect(within(sidebar()).queryByText("Baie Vidéo")).toBeNull();

    // Lier : glisser « Flight Son » sur la zone de dépôt.
    await dragRack("Flight Son", true);
    await waitFor(() => expect(cardNames()).toEqual(["Baie Vidéo", "Rack Lumière", "Flight Son"]));
    expect(sentBody(fetchSpy, "POST", "/api/rigs/g1/racks")).toEqual({ rackId: "r2" });
    expect(within(sidebar()).queryByText("Flight Son")).toBeNull();
    expect(links.map((l) => l.rackId)).toEqual(["r1", "r3", "r2"]);

    // Retirer : confirmation, DELETE, le rack revient dans le panneau gauche.
    const baie = screen.getAllByTitle("Retirer de la régie")[0];
    fireEvent.click(baie);
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByText('Retirer "Baie Vidéo" de cette régie ?')).toBeInTheDocument();
    expect(within(confirm).getByText("Le rack ne sera pas supprimé.")).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(cardNames()).toEqual(["Rack Lumière", "Flight Son"]));
    expect(
      fetchSpy.mock.calls.some(
        ([u, init]) => String(u) === "/api/rigs/g1/racks/r1" && init?.method === "DELETE",
      ),
    ).toBe(true);
    expect(await within(sidebar()).findByText("Baie Vidéo")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/rigs/g1");
  });

  test("rig_detail_reorders_by_drag", async () => {
    // arkyo ne réordonne pas les racks d'une régie : la position d'un lien est
    // fixée par le serveur (dernière + 1) quand on glisse un rack sur la zone,
    // et le client n'envoie que `{ rackId }`. Les cartes suivent `position`.
    const { api, links } = rigServer(OWNER_PERMS, ["r3", "r1"]);
    const { fetchSpy } = renderApp("/rigs/g1", api);
    await screen.findByRole("heading", { level: 1, name: "Régie Nord" }, { timeout: 5000 });
    expect(cardNames()).toEqual(["Rack Lumière", "Baie Vidéo"]);

    // Relâché hors de la zone : rien n'est envoyé.
    await dragRack("Pelicase HF", false);
    expect(fetchSpy.mock.calls.some(([u, init]) => String(u) === "/api/rigs/g1/racks" && init?.method === "POST")).toBe(false);
    expect(within(sidebar()).getByText("Pelicase HF")).toBeInTheDocument();

    // Deux dépôts successifs : chacun prend la position suivante.
    await dragRack("Pelicase HF", true);
    await waitFor(() => expect(cardNames()).toEqual(["Rack Lumière", "Baie Vidéo", "Pelicase HF"]));
    await dragRack("Flight Son", true);
    await waitFor(() =>
      expect(cardNames()).toEqual(["Rack Lumière", "Baie Vidéo", "Pelicase HF", "Flight Son"]),
    );
    const posts = fetchSpy.mock.calls
      .filter(([u, init]) => String(u) === "/api/rigs/g1/racks" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(posts).toEqual([{ rackId: "r4" }, { rackId: "r2" }]);
    expect(links.map((l) => [l.rackId, l.position])).toEqual([
      ["r3", 0],
      ["r1", 1],
      ["r4", 2],
      ["r2", 3],
    ]);
    // Après rechargement (router.refresh), l'ordre reste celui des positions.
    await waitFor(() => expect(within(sidebar()).getByText("Tous les racks sont assignés")).toBeInTheDocument());
  });

  test("rig_detail_requires_design_read", async () => {
    const none = { ...TECH_PERMS, permissions: { ...TECH_PERMS.permissions, design: "none" } };
    const { api } = rigServer(none);
    const { router, fetchSpy } = renderApp("/rigs/g1", api);
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"), { timeout: 5000 });
    expect(fetchSpy.mock.calls.some(([u]) => String(u).startsWith("/api/rigs"))).toBe(false);
    resetApp();

    // Régie inconnue : page 404 (`notFound()` d'arkyo).
    renderApp("/rigs/zz", rigServer().api);
    expect(await screen.findByText("This page could not be found.", {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
