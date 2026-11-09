/**
 * Gérer › Câbles (spec v2 §4.2) : liste agrégée, paginée au-delà de la
 * taille d'une page, relue une fois par salve d'évènements, détail avec les
 * deux extrémités ; `EmptyState` sans câbles ; lecture seule sans édition.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { EmptyState } from "@/components/ui/empty-state";
import { emitAppEvent, renderApp, resetApp, TECH_PERMS } from "@/tests/app-harness";
import { CONNECTIONS } from "../bottom/test-fixtures";
import { GENERAL_EMPTY, cablesApi, editor, normUrl } from "./manage-fixtures";

// Composant partagé espionné : la page doit rendre `<EmptyState>`, pas une variante.
vi.mock("@/components/ui/empty-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/empty-state")>();
  return { ...actual, EmptyState: vi.fn(actual.EmptyState) };
});
const emptyTitles = () => vi.mocked(EmptyState).mock.calls.map(([props]) => props.title);

const FIRST_LOAD = { timeout: 15000 };

const here = (router: { state: { location: { pathname: string; search: string } } }) =>
  normUrl(router.state.location.pathname + router.state.location.search);
const listRows = () => within(screen.getByRole("table", { name: "Câbles" })).getAllByRole("row").slice(1);

const READER_PERMS = {
  isOwner: false,
  roleKey: "lecteur",
  permissions: { projects: "read", design: "read", catalog: "read", members: "none", settings: "none" },
};

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    ...CONNECTIONS[0],
    id: `m${i}`,
    label: `V-${String(i + 1).padStart(4, "0")}`,
  }));

/** Vue Générale avec un câble entre deux lieux (Régie → Plateau). */
const GENERAL_WITH_LINK = {
  ...GENERAL_EMPTY,
  locations: [...GENERAL_EMPTY.locations, { id: "l2", name: "Plateau" }],
  connections: [
    {
      id: "pc1",
      projectId: "p1",
      fromRackId: "r1",
      fromSlotId: "s3",
      fromConnectorIndex: 0,
      toRackId: "r8",
      toSlotId: null,
      toConnectorIndex: null,
      label: "V-2001",
      color: null,
      waypoints: null,
      cableStyle: null,
      notes: null,
      tags: null,
      bundleId: null,
    },
  ],
};

const callsTo = (spy: ReturnType<typeof renderApp>["fetchSpy"], path: string) =>
  spy.mock.calls.filter(([input]) => String(input).split("?")[0] === path).length;

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(EmptyState).mockClear();
});
afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("Gérer › Câbles", () => {
  test("liste, détail avec les deux extrémités, Voir dans Concevoir", async () => {
    const { router } = renderApp("/project/p1?space=gerer&page=cables", cablesApi("strata"));
    expect(await screen.findByRole("heading", { level: 1, name: "Câbles" }, FIRST_LOAD)).toBeInTheDocument();
    await waitFor(() => expect(listRows()).toHaveLength(3));
    expect(screen.getByText("3 câbles · 1 sans numéro")).toBeInTheDocument();
    expect(listRows().map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^A-0101MON 1 · AESCAM 1 · SDI OUT 1XLR3 \/ BNCRégie/),
      expect.stringMatching(/^V-0101CAM 1 · SDI OUT 1MON 1 · SDI INBNCRégie/),
      expect.stringMatching(/^—CAM 1 · SDI OUT 2PATCH A · 1 arrièreBNCRégiesans numéro$/),
    ]);

    // Filtre.
    fireEvent.change(screen.getByRole("searchbox", { name: "Filtrer les câbles" }), { target: { value: "patch" } });
    expect(listRows()).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox", { name: "Filtrer les câbles" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Sans numéro · 1" }));
    expect(listRows()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Sans numéro · 1" }));

    // Détail : câble dessiné, extrémités A et B (face de l'équipement, port choisi), Avancé replié.
    fireEvent.click(listRows()[1]);
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?space=gerer&page=cables&sel=c1")));
    const detail = screen.getByRole("complementary", { name: "Détail" });
    expect(within(detail).getByRole("heading", { level: 2, name: "V-0101" })).toBeInTheDocument();
    expect(within(detail).getByRole("img", { name: "Câble V-0101" })).toHaveTextContent("BNC M");
    const a = within(detail).getByRole("region", { name: "Extrémité A" });
    expect(a).toHaveTextContent("CAM 1 · SDI OUT 1");
    expect(a).toHaveTextContent("Baie 1 · Régie · BNC F · face arrière");
    expect(within(a).getByRole("img", { name: "Face arrière Caméra X" })).toBeInTheDocument();
    expect(within(detail).getByRole("region", { name: "Extrémité B" })).toHaveTextContent("MON 1 · SDI IN");
    expect(detail).not.toHaveTextContent(/♂|♀/);
    expect(within(detail).getByRole("button", { name: /Avancé/ })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(detail).getByRole("button", { name: /Avancé/ }));
    expect(within(detail).getByText("Points de passage")).toBeInTheDocument();

    fireEvent.click(within(detail).getByRole("button", { name: "Voir dans Concevoir" }));
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?page=cables&sel=c1&tab=synoptique")));
  });

  test("liste virtualisée ou paginée au-delà de 500 lignes", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { fetchSpy } = renderApp("/project/p1?space=gerer&page=cables", cablesApi("strata", many(600)));
    // Lecture de la vue de lieu retenue : `<LoadingState>` pendant le chargement.
    const reply = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation(async (input, init) => {
      if (String(input).includes("/synoptic/location/")) await gate;
      return reply(input, init);
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Câbles" }, FIRST_LOAD)).toBeInTheDocument();
    expect(screen.getByText("Chargement…")).toBeInTheDocument();
    release();

    // 600 câbles : 200 lignes rendues par page.
    await waitFor(() => expect(listRows()).toHaveLength(200));
    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect(pages).toHaveTextContent("1–200 sur 600");
    expect(listRows()[0]).toHaveTextContent("V-0001");
    fireEvent.click(within(pages).getByRole("button", { name: "Page suivante" }));
    expect(pages).toHaveTextContent("201–400 sur 600");
    expect(listRows()).toHaveLength(200);
    expect(listRows()[0]).toHaveTextContent("V-0201");

    // Une salve d'évènements : une seule relecture groupée.
    const before = callsTo(fetchSpy, "/api/tenant/projects/p1/synoptic/location/l1");
    act(() => {
      for (let i = 0; i < 6; i++) emitAppEvent({ type: "update", entity: "rackConnection", action: "updated", id: `m${i}`, rackId: "r1" });
      emitAppEvent({ type: "update", entity: "rackZone", action: "updated", rackId: "r1" });
    });
    await new Promise((r) => setTimeout(r, 700));
    expect(callsTo(fetchSpy, "/api/tenant/projects/p1/synoptic/location/l1")).toBe(before + 1);
    expect(callsTo(fetchSpy, "/api/tenant/projects/p1/synoptic/general")).toBe(2);
  });

  test("EmptyState sans câbles", async () => {
    renderApp("/project/p1?space=gerer&page=cables", cablesApi("strata", []));
    expect(await screen.findByText("Aucun câble", { selector: "p" }, FIRST_LOAD)).toBeInTheDocument();
    expect(emptyTitles()).toContain("Aucun câble");
    expect(screen.queryByRole("table", { name: "Câbles" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Affichage" })).toBeNull();
    resetApp();

    // Projet sans contenant : aucune vue de lieu lue, même EmptyState.
    const { fetchSpy } = renderApp(
      "/project/p1?space=gerer&page=cables",
      cablesApi("strata", [], { "GET /api/tenant/projects/p1/editor": { body: editor([]) } }),
    );
    vi.mocked(EmptyState).mockClear();
    expect(await screen.findByText("Aucun câble", { selector: "p" }, FIRST_LOAD)).toBeInTheDocument();
    expect(emptyTitles()).toContain("Aucun câble");
    expect(callsTo(fetchSpy, "/api/tenant/projects/p1/synoptic/location/l1")).toBe(0);
  });

  test("lecture seule : pas d'édition", async () => {
    renderApp(
      "/project/p1?space=gerer&page=cables&sel=c1",
      cablesApi("strata", CONNECTIONS, { "GET /api/tenant/me/permissions": { body: READER_PERMS } }),
    );
    await waitFor(() => expect(listRows()).toHaveLength(3), FIRST_LOAD);
    // Ni mode tableau, ni champ de saisie, ni grille.
    expect(screen.queryByRole("group", { name: "Affichage" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tableau/ })).toBeNull();
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    const detail = screen.getByRole("complementary", { name: "Détail" });
    expect(within(detail).getByRole("heading", { level: 2, name: "V-0101" })).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: /Enregistrer/ })).toBeNull();
    resetApp();

    // `projects:write` sans `design:write`, et seulement des câbles de contenant : aucune ligne modifiable, pas de tableau.
    renderApp(
      "/project/p1?space=gerer&page=cables",
      cablesApi("strata", CONNECTIONS, { "GET /api/tenant/me/permissions": { body: TECH_PERMS } }),
    );
    await waitFor(() => expect(listRows()).toHaveLength(3), FIRST_LOAD);
    expect(screen.queryByRole("group", { name: "Affichage" })).toBeNull();
    resetApp();

    // Avec un câble entre lieux : tableau, câbles de contenant en lecture, câble entre lieux modifiable.
    renderApp(
      "/project/p1?space=gerer&page=cables",
      cablesApi("strata", CONNECTIONS, {
        "GET /api/tenant/me/permissions": { body: TECH_PERMS },
        "GET /api/tenant/projects/p1/synoptic/general": { body: GENERAL_WITH_LINK },
      }),
    );
    await waitFor(() => expect(listRows()).toHaveLength(4), FIRST_LOAD);
    fireEvent.click(screen.getByRole("button", { name: "Tableau" }));
    const grid = screen.getByRole("grid", { name: "Câbles" });
    // Ordre : A-0101, V-0101, V-2001 (entre lieux), sans numéro.
    const rowsOf = within(grid).getAllByRole("row").slice(1);
    const label = (i: number) => within(rowsOf[i]).getAllByRole("gridcell")[0];
    expect(label(2)).toHaveTextContent("V-2001");
    expect(label(2)).not.toHaveAttribute("aria-readonly");
    for (const i of [0, 1, 3]) expect(label(i)).toHaveAttribute("aria-readonly", "true");
    fireEvent.mouseDown(label(0));
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(within(grid).queryByRole("textbox")).toBeNull();
    fireEvent.mouseDown(label(2));
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(within(grid).getByRole("textbox", { name: "N°" })).toBeInTheDocument();
  });

  test("un même compte de câbles : Vue d'ensemble, navigation et page Câbles", async () => {
    const { fetchSpy } = renderApp(
      "/project/p1?space=gerer",
      cablesApi("strata", CONNECTIONS, { "GET /api/tenant/projects/p1/synoptic/general": { body: GENERAL_WITH_LINK } }),
    );
    const domains = await screen.findByRole("list", { name: "Le projet, domaine par domaine" }, FIRST_LOAD);
    // 3 câbles de contenant et 1 entre lieux.
    const cabling = within(domains).getAllByRole("button").find((b) => b.textContent?.includes("Câblage"))!;
    await waitFor(() => expect(cabling).toHaveTextContent("4 câbles · 1 sans numéro"));
    const navLink = within(screen.getByRole("navigation", { name: "Gérer" })).getByRole("link", { name: /Câbles/ });
    expect(navLink).toHaveTextContent(/Câbles\s*4$/);
    fireEvent.click(navLink);
    expect(await screen.findByText("4 câbles · 1 sans numéro")).toBeInTheDocument();
    expect(listRows()).toHaveLength(4);
    // Une seule lecture, partagée par les trois.
    expect(callsTo(fetchSpy, "/api/tenant/projects/p1/synoptic/general")).toBe(1);
  });

  test("Câbles en Gérer : rien de neuf en Classique (aucune lecture de la liste)", async () => {
    const { fetchSpy } = renderApp("/project/p1?tab=fiche&space=gerer&page=cables", cablesApi("classique"));
    expect((await screen.findAllByText("Finale Coupe de France", {}, FIRST_LOAD)).length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole("navigation", { name: "Gérer" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 1, name: "Câbles" })).toBeNull();
    expect(callsTo(fetchSpy, "/api/tenant/projects/p1/synoptic/location/l1")).toBe(0);
  });
});
