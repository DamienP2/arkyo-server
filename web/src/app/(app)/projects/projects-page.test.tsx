/**
 * `/projects` (arkyo:app/(app)/projects/{page.tsx,projects-client.tsx}) : même
 * rendu, données lues par `GET /api/tenant/projects` (avec `description`,
 * `documentsCount` et `rigConfigsCount`), garde `projects:read`.
 */

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  OWNER_PERMS,
  TECH_PERMS,
  renderApp,
  resetApp,
  signedInApi,
  type Api,
} from "@/tests/app-harness";

function project(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    status: "EN_PREPARATION",
    interventionType: "PRESTATION",
    rigType: null,
    clientName: null,
    shootingDate: null,
    shootingEndDate: null,
    planningStart: null,
    planningEnd: null,
    commissioningDate: null,
    location: null,
    prestationType: null,
    description: null,
    updatedAt: "2026-11-01T10:00:00.000Z",
    createdAt: "2026-11-01T10:00:00.000Z",
    documentsCount: 0,
    rigConfigsCount: 0,
    ...extra,
  };
}

const PROJECTS = [
  project("p1", "Festival Alpha", {
    updatedAt: "2026-11-05T10:00:00.000Z",
    clientName: "Client A",
    location: "Lyon",
    description: "Captation multicam",
    rigType: "FLIGHT_CASE",
    shootingDate: "2026-12-01T00:00:00.000Z",
    shootingEndDate: "2026-12-03T00:00:00.000Z",
  }),
  project("p2", "Concert Bravo", {
    updatedAt: "2026-11-04T10:00:00.000Z",
    status: "PRET",
    rigType: "CAR",
  }),
  project("p3", "Arena Charlie", {
    updatedAt: "2026-11-03T10:00:00.000Z",
    status: "EN_PREPARATION",
  }),
  project("i1", "Studio Delta", {
    interventionType: "INTEGRATION",
    status: "EN_COURS",
    commissioningDate: "2027-01-15T00:00:00.000Z",
    clientName: "Chaîne D",
  }),
];

function projectsApi(perms: unknown = OWNER_PERMS, extra: Api = {}): Api {
  return {
    ...signedInApi(perms),
    "GET /api/tenant/projects": { body: { projects: PROJECTS } },
    ...extra,
  };
}

/** Carte (vue grille) d'un projet, par son nom. */
function card(name: string) {
  return screen.getByText(name).closest("div.group") as HTMLElement;
}

/** Noms des projets affichés, dans l'ordre du DOM. */
function shownNames() {
  return PROJECTS.map((p) => p.name)
    .filter((n) => screen.queryByText(n))
    .sort(
      (a, b) =>
        screen.getByText(a).compareDocumentPosition(screen.getByText(b)) &
        Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
    );
}

beforeAll(async () => {
  await import("@/app/(app)/projects/page");
}, 30000);
afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("/projects", () => {
  test("projects_tabs_prestation_integration", async () => {
    const { fetchSpy, unmount } = renderApp("/projects", projectsApi());

    // Défaut : Prestation (?tab= absent).
    expect(await screen.findByText("Festival Alpha", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === "/api/tenant/projects")).toBe(true);
    expect(screen.queryByText("Studio Delta")).toBeNull();
    // Carte : client, lieu, dates de tournage, type de régie, description (mapping de page.tsx).
    const alpha = card("Festival Alpha");
    expect(within(alpha).getByText("Client A")).toBeInTheDocument();
    expect(within(alpha).getByText("Lyon")).toBeInTheDocument();
    expect(within(alpha).getByText("1 déc. 2026 → 3 déc. 2026")).toBeInTheDocument();
    expect(within(alpha).getByText("Flight case")).toBeInTheDocument();
    expect(within(alpha).getByText("Captation multicam")).toBeInTheDocument();
    expect(within(card("Concert Bravo")).getByText("Projet interne")).toBeInTheDocument();
    // Compteur : 3 projets en prestation.
    expect(screen.getByText("3")).toBeInTheDocument();

    // « Nouveau projet » en pointillés ; il ouvre l'assistant sur l'onglet courant
    // (parcours complet : components/projects/new-project-dialog.test.tsx).
    const add = screen.getByRole("button", { name: /Nouveau projet/ });
    expect(add.className).toContain("border-dashed");
    fireEvent.click(add);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Nouveau projet · Prestation")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Commencer/ })).toBeInTheDocument();
    unmount();

    // ?tab=integration : seuls les projets d'intégration, date de mise en service.
    renderApp("/projects?tab=integration", projectsApi());
    expect(await screen.findByText("Studio Delta", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText("Festival Alpha")).toBeNull();
    expect(within(card("Studio Delta")).getByText("15 janv. 2027")).toBeInTheDocument();
    expect(screen.getByText("En cours")).toBeInTheDocument();
  });

  test("projects_empty_view_and_guard", async () => {
    // Vue vide : EmptyState plein écran, avec « Nouveau projet » (projects:write).
    renderApp(
      "/projects?tab=integration",
      projectsApi(OWNER_PERMS, {
        "GET /api/tenant/projects": { body: { projects: [PROJECTS[0]] } },
      }),
    );
    expect(
      await screen.findByText("Aucun projet en intégration", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nouveau projet/ })).toBeInTheDocument();
    resetApp();

    // Sans projects:read : redirection vers /dashboard, sans lire la liste.
    const { router, fetchSpy } = renderApp(
      "/projects",
      projectsApi({ ...TECH_PERMS, permissions: { ...TECH_PERMS.permissions, projects: "none" } }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"), { timeout: 5000 });
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === "/api/tenant/projects")).toBe(false);
  });

  test("filters_and_sort", async () => {
    renderApp("/projects", projectsApi());
    await screen.findByText("Festival Alpha", {}, { timeout: 5000 });

    // Groupes par statut (ordre des statuts), récents d'abord dans chaque groupe.
    expect(screen.getByRole("heading", { name: "En préparation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Prêt" })).toBeInTheDocument();
    expect(shownNames()).toEqual(["Festival Alpha", "Arena Charlie", "Concert Bravo"]);

    // Tri par nom (bascule), mémorisé dans localStorage.
    fireEvent.click(screen.getByTitle("Plus récents d'abord"));
    expect(shownNames()).toEqual(["Arena Charlie", "Festival Alpha", "Concert Bravo"]);
    expect(window.localStorage.getItem("projects:sort")).toBe("name");

    // Recherche : nom, client, lieu, type de prestation, description.
    const search = screen.getByPlaceholderText("Rechercher un projet, un client, un lieu…");
    fireEvent.change(search, { target: { value: "multicam" } });
    expect(shownNames()).toEqual(["Festival Alpha"]);
    fireEvent.change(search, { target: { value: "introuvable" } });
    expect(screen.getByText("Aucun résultat")).toBeInTheDocument();
    expect(
      screen.getByText("3 projets au total, mais aucun ne correspond aux filtres actifs."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Effacer les filtres/ }));
    expect(shownNames()).toEqual(["Arena Charlie", "Festival Alpha", "Concert Bravo"]);

    // Filtre de statut (tiroir) : « Prêt » seul.
    fireEvent.click(screen.getByRole("button", { name: /Filtrer/ }));
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByText("Filtrer les projets")).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "Prêt" }));
    await waitFor(() => expect(shownNames()).toEqual(["Concert Bravo"]));
    expect(window.localStorage.getItem("projects:status")).toBe("PRET");
    // Type de régie : « Flight case » exclut Bravo (car régie).
    fireEvent.click(within(drawer).getByRole("button", { name: "Prêt" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Flight case" }));
    await waitFor(() => expect(shownNames()).toEqual(["Festival Alpha"]));
    expect(window.localStorage.getItem("projects:rigtype")).toBe("FLIGHT_CASE");
  });

  test("delete_requires_projects_admin", async () => {
    // projects:write sans admin : pas de bouton de suppression.
    const tech = renderApp("/projects", projectsApi(TECH_PERMS));
    await screen.findByText("Festival Alpha", {}, { timeout: 5000 });
    expect(screen.getByRole("button", { name: /Nouveau projet/ })).toBeInTheDocument();
    expect(screen.queryByTitle("Supprimer définitivement")).toBeNull();
    tech.unmount();
    resetApp();

    // projects:admin : confirmation, puis DELETE /api/tenant/projects/:id.
    const { fetchSpy } = renderApp(
      "/projects",
      projectsApi(OWNER_PERMS, { "DELETE /api/tenant/projects/p2": { body: { ok: true } } }),
    );
    await screen.findByText("Concert Bravo", {}, { timeout: 5000 });
    fireEvent.click(within(card("Concert Bravo")).getByTitle("Supprimer définitivement"));
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByText("Supprimer « Concert Bravo » ?")).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(screen.queryByText("Concert Bravo")).toBeNull());
    expect(
      fetchSpy.mock.calls.some(
        ([u, init]) => String(u) === "/api/tenant/projects/p2" && init?.method === "DELETE",
      ),
    ).toBe(true);
    expect(screen.getByText("Festival Alpha")).toBeInTheDocument();
  });

  test("card_links_to_editor", async () => {
    const { router } = renderApp("/projects", projectsApi());
    await screen.findByText("Festival Alpha", {}, { timeout: 5000 });
    fireEvent.click(card("Festival Alpha"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/project/p1"));
    expect(router.state.location.search).toBe("?tab=fiche");

    // Vue liste : même lien.
    await act(() => router.navigate("/projects"));
    await screen.findByText("Concert Bravo", {}, { timeout: 5000 });
    fireEvent.click(screen.getByTitle("Vue liste"));
    expect(window.localStorage.getItem("projects:view")).toBe('"list"');
    fireEvent.click(screen.getByText("Concert Bravo"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/project/p2"));
    expect(router.state.location.search).toBe("?tab=fiche");
  });
});
