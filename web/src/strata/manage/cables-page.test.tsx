/**
 * Gérer › Câbles (spec v2 §4.2) : liste agrégée, paginée au-delà de la
 * taille d'une page, relue une fois par salve d'évènements, détail avec les
 * deux extrémités ; `EmptyState` sans câbles ; lecture seule sans édition.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { emitAppEvent, renderApp, resetApp, TECH_PERMS } from "@/tests/app-harness";
import { CONNECTIONS } from "../bottom/test-fixtures";
import { cablesApi, editor, normUrl } from "./manage-fixtures";

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

const callsTo = (spy: ReturnType<typeof renderApp>["fetchSpy"], path: string) =>
  spy.mock.calls.filter(([input]) => String(input).split("?")[0] === path).length;

beforeEach(() => window.localStorage.clear());
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
    expect(screen.queryByRole("table", { name: "Câbles" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Affichage" })).toBeNull();
    resetApp();

    // Projet sans contenant : aucune vue de lieu lue, même EmptyState.
    const { fetchSpy } = renderApp(
      "/project/p1?space=gerer&page=cables",
      cablesApi("strata", [], { "GET /api/tenant/projects/p1/editor": { body: editor([]) } }),
    );
    expect(await screen.findByText("Aucun câble", { selector: "p" }, FIRST_LOAD)).toBeInTheDocument();
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

    // `projects:write` sans `design:write` : les câbles de contenant restent en lecture dans le tableau.
    renderApp(
      "/project/p1?space=gerer&page=cables",
      cablesApi("strata", CONNECTIONS, { "GET /api/tenant/me/permissions": { body: TECH_PERMS } }),
    );
    await waitFor(() => expect(listRows()).toHaveLength(3), FIRST_LOAD);
    fireEvent.click(screen.getByRole("button", { name: "Tableau" }));
    const grid = screen.getByRole("grid", { name: "Câbles" });
    const cells = within(grid).getAllByRole("gridcell");
    expect(cells.every((c) => c.getAttribute("aria-readonly") === "true")).toBe(true);
    fireEvent.mouseDown(cells[0]);
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(within(grid).queryByRole("textbox")).toBeNull();
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
