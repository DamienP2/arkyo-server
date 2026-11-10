/**
 * Page Projets de l'interface Strata v2 (`/dashboard` et `/projects` en
 * Strata ; spec v2 §4.3) : compteurs du tableau de bord Classique, liste
 * (avancement, date, statut, équipe ; filtres Prestation / Intégration,
 * recherche, tri) et détail (résumé, compteurs, « Ouvrir dans Concevoir »,
 * « Ouvrir dans Gérer »), « Nouveau projet » (assistant existant). En
 * Classique, ces URL restent le tableau de bord et la liste d'arkyo.
 */

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, resetApp, signedInApi, TECH_PERMS, type Api } from "@/tests/app-harness";

const DAY = 86_400_000;

/** Date ISO à `days` jours d'ici (une heure de marge, pour éviter les bords de journée). */
function inDays(days: number) {
  return new Date(Date.now() + days * DAY + 3_600_000).toISOString();
}

/** Projet de `GET /api/projects` (forme `DashboardProject`, colonnes du projet comprises). */
function project(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    clientName: null,
    shootingDate: null,
    shootingEndDate: null,
    planningStart: null,
    planningEnd: null,
    commissioningDate: null,
    location: null,
    description: null,
    status: "EN_PREPARATION",
    prestationType: null,
    interventionType: "PRESTATION",
    rigType: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    createdById: "u1",
    ipMapPositions: null,
    technicalSheet: { completionPercent: 0 },
    _count: { tasks: 0 },
    ...extra,
  };
}

// Ordre de l'API : updatedAt desc.
const PROJECTS = [
  project("pA", "Festival Alpha", {
    updatedAt: "2026-11-05T10:00:00.000Z",
    shootingDate: inDays(20),
    clientName: "Client A",
    location: "Lyon",
    rigType: "FLIGHT_CASE",
    description: "Captation multicam",
    technicalSheet: { completionPercent: 42.5 },
    _count: { tasks: 3 },
  }),
  project("pB", "Concert Bravo", {
    updatedAt: "2026-11-04T10:00:00.000Z",
    shootingDate: inDays(5),
    status: "PRET",
    interventionType: "INTEGRATION",
    commissioningDate: inDays(5),
    technicalSheet: { completionPercent: 80 },
  }),
  project("pC", "Gala Charlie", {
    updatedAt: "2026-11-03T10:00:00.000Z",
    status: "TERMINE",
    createdById: "u2",
    technicalSheet: { completionPercent: 100 },
  }),
];

const TASK_STATS = [
  { status: "A_FAIRE", _count: 3 },
  { status: "VALIDE", _count: 1 },
];

/** `GET /api/tenant/projects` : mêmes projets, avec les compteurs de la liste. */
const TENANT_PROJECTS = PROJECTS.map((p) => ({
  ...p,
  documentsCount: p.id === "pA" ? 4 : 0,
  rigConfigsCount: p.id === "pA" ? 2 : 0,
}));

/** `GET /api/tenant/members?inactive=1` (forme réduite) : u2 est désactivée,
 *  absente de la liste des seuls membres actifs. */
const MEMBERS = [
  { id: "u1", userId: "u1", name: "Damien Perpignan", email: "damien@example.com", isActive: true },
  { id: "u2", userId: "u2", name: null, email: "lea@example.com", isActive: false },
];

function projectsApi(iface: "classique" | "strata", extra: Api = {}, perms?: unknown): Api {
  return {
    ...signedInApi(perms, "Régie A", iface),
    "GET /api/projects": { body: PROJECTS },
    "GET /api/projects?stats=tasks": { body: TASK_STATS },
    "GET /api/tenant/projects": { body: { projects: TENANT_PROJECTS } },
    "GET /api/tenant/members?inactive=1": { body: MEMBERS },
    "GET /api/tenant/members": { body: MEMBERS.filter((m) => m.isActive) },
    "GET /api/notifications?limit=15": { body: { items: [], count: 0, total: 0, page: 1, pages: 1 } },
    ...extra,
  };
}

beforeAll(async () => {
  await Promise.all([
    import("@/app/(app)/dashboard/page"),
    import("@/app/(app)/projects/page"),
    import("@/strata/pages/projects-page"),
  ]);
}, 60000);

afterEach(() => {
  resetApp();
  delete document.documentElement.dataset.interface;
});

const LABELS = ["Projets actifs", "Tâches complétées", "Complétion moyenne", "Prochaine captation"];

async function projectList(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "Tous les projets" }, { timeout: 15000 });
}

/** Noms des projets listés, dans l'ordre. */
function rowNames(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].querySelector("button")?.textContent ?? "");
}

describe("page Projets (Strata v2)", () => {
  test("compteurs identiques au tableau de bord Classique", async () => {
    // Valeurs du tableau de bord Classique pour ce jeu de données.
    renderApp("/dashboard", projectsApi("classique"));
    await screen.findByText("Tous les projets actifs", {}, { timeout: 15000 });
    const classique = new Map<string, string[]>();
    for (const label of LABELS) {
      const card = screen.getByText(label).closest("div.rounded-2xl") as HTMLElement;
      const texts = [...card.querySelectorAll("p")].map((p) => p.textContent ?? "").filter((t) => t !== label);
      classique.set(label, texts);
    }
    // Garde-fou : le jeu de données donne bien des valeurs non triviales.
    expect(classique.get("Projets actifs")).toEqual(["2", "sur 3 au total"]);
    expect(classique.get("Tâches complétées")).toEqual(["1/4", "25% d'avancement"]);
    expect(classique.get("Complétion moyenne")).toEqual(["74%", "fiches techniques"]);
    expect(classique.get("Prochaine captation")?.[1]).toBe("Concert Bravo");
    resetApp();

    // Mêmes valeurs dans la page Projets, sur `/dashboard` comme sur `/projects`.
    for (const url of ["/dashboard", "/projects"]) {
      renderApp(url, projectsApi("strata"));
      const counters = await screen.findByRole("region", { name: "Compteurs" }, { timeout: 15000 });
      for (const label of LABELS) {
        const counter = within(counters).getByRole("group", { name: label });
        for (const text of classique.get(label)!) {
          expect(within(counter).getByText(text), `${url} ${label}`).toBeInTheDocument();
        }
      }
      expect(screen.getByRole("heading", { level: 1, name: "Projets" })).toBeInTheDocument();
      // Pas de tableau de bord ni de liste Classique en Strata.
      expect(screen.queryByText("Accès rapide")).toBeNull();
      resetApp();
    }
  });

  test("liste : avancement, date, statut, équipe", async () => {
    renderApp("/dashboard", projectsApi("strata"));
    const list = await projectList();
    // Tous les projets, tri par date clé par défaut (sans date en dernier).
    expect(rowNames(list)).toEqual(["Concert Bravo", "Festival Alpha", "Gala Charlie"]);
    const alpha = within(list).getByRole("row", { name: /Festival Alpha/ });
    expect(within(alpha).getByText("Client A · Prestation")).toBeInTheDocument();
    expect(within(alpha).getByRole("meter", { name: "Avancement" })).toHaveAttribute("aria-valuenow", "43");
    expect(within(alpha).getByText("En préparation")).toBeInTheDocument();
    // Équipe : le créateur du projet (membres de l'espace).
    expect(within(alpha).getByRole("img", { name: "Créé par Damien Perpignan" })).toHaveTextContent("DP");
    const charlie = within(list).getByRole("row", { name: /Gala Charlie/ });
    expect(within(charlie).getByText("Terminé")).toBeInTheDocument();
    // Créatrice désactivée : toujours nommée (`?inactive=1`).
    expect(within(charlie).getByRole("img", { name: "Créé par lea@example.com" })).toHaveTextContent("L");
    const bravo = within(list).getByRole("row", { name: /Concert Bravo/ });
    expect(within(bravo).getByText("Projet interne · Intégration")).toBeInTheDocument();
  });

  test("Projets : filtre Prestation/Intégration, ouverture Concevoir et Gérer", async () => {
    const { router } = renderApp("/dashboard", projectsApi("strata"));
    const list = await projectList();
    const filters = screen.getByRole("group", { name: "Type d'intervention" });
    expect(within(filters).getByRole("button", { name: "Tous" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(filters).getByRole("button", { name: "Intégration" }));
    await waitFor(() => expect(rowNames(list)).toEqual(["Concert Bravo"]));
    expect(within(filters).getByRole("button", { name: "Intégration" })).toHaveAttribute("aria-pressed", "true");
    // Sur `/dashboard`, le filtre ne change pas d'URL (la page n'est pas remontée).
    expect(router.state.location.pathname).toBe("/dashboard");

    fireEvent.click(within(filters).getByRole("button", { name: "Prestation" }));
    await waitFor(() => expect(rowNames(list)).toEqual(["Festival Alpha", "Gala Charlie"]));

    // Détail : résumé, compteurs, ouverture dans Concevoir et dans Gérer.
    fireEvent.click(within(list).getByRole("button", { name: "Festival Alpha" }));
    const detail = await screen.findByRole("region", { name: "Détail du projet" });
    expect(within(detail).getByRole("heading", { name: "Festival Alpha" })).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: /Ouvrir dans Concevoir/ })).toHaveAttribute(
      "href",
      "/project/pA?tab=synoptique",
    );
    expect(within(detail).getByRole("link", { name: /Ouvrir dans Gérer/ })).toHaveAttribute(
      "href",
      "/project/pA?space=gerer",
    );
    expect(within(detail).getByText("Lyon")).toBeInTheDocument();
    expect(within(detail).getByText("Flight case")).toBeInTheDocument();
    expect(within(detail).getByText("Captation multicam")).toBeInTheDocument();
    expect(within(detail).getByText("Damien Perpignan")).toBeInTheDocument();
    expect(within(detail).getByRole("group", { name: "Régies" })).toHaveTextContent("2");
    expect(within(detail).getByRole("group", { name: "Documents" })).toHaveTextContent("4");
    expect(within(detail).getByRole("group", { name: "Tâches" })).toHaveTextContent("3");
    expect(within(detail).getByRole("group", { name: "Fiche technique" })).toHaveTextContent("43 %");
    // Alertes connues : fiche incomplète.
    expect(within(detail).getByText("Fiche technique à 43 %")).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Festival Alpha" })).toHaveAttribute("aria-current", "true");
    expect(within(list).getByRole("button", { name: "Gala Charlie" })).not.toHaveAttribute("aria-current");

    // Fermer le détail.
    fireEvent.click(within(detail).getByRole("button", { name: "Fermer le détail" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Détail du projet" })).toBeNull());
  });

  test("/projects?tab=… : le filtre suit l'URL", async () => {
    const { router } = renderApp("/projects?tab=integration", projectsApi("strata"));
    const list = await projectList();
    const filters = screen.getByRole("group", { name: "Type d'intervention" });
    expect(within(filters).getByRole("button", { name: "Intégration" })).toHaveAttribute("aria-pressed", "true");
    expect(rowNames(list)).toEqual(["Concert Bravo"]);

    fireEvent.click(within(filters).getByRole("button", { name: "Prestation" }));
    await waitFor(() => expect(router.state.location.search).toBe("?tab=prestation"));
    await waitFor(() => expect(rowNames(list)).toEqual(["Festival Alpha", "Gala Charlie"]));
    // Même liste (pas de rechargement) : la région n'a pas été remontée.
    expect(list.isConnected).toBe(true);

    fireEvent.click(within(filters).getByRole("button", { name: "Tous" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(rowNames(list)).toHaveLength(3);
  });

  test("recherche, statut et tri", async () => {
    renderApp("/dashboard", projectsApi("strata"));
    const list = await projectList();
    const search = within(list).getByRole("searchbox", { name: "Rechercher des projets" });
    fireEvent.change(search, { target: { value: "lyon" } });
    await waitFor(() => expect(rowNames(list)).toEqual(["Festival Alpha"]));
    fireEvent.change(search, { target: { value: "" } });

    fireEvent.change(within(list).getByRole("combobox", { name: "Statut" }), { target: { value: "TERMINE" } });
    await waitFor(() => expect(rowNames(list)).toEqual(["Gala Charlie"]));
    fireEvent.change(within(list).getByRole("combobox", { name: "Statut" }), { target: { value: "" } });

    const sort = within(list).getByRole("group", { name: "Tri" });
    fireEvent.click(within(sort).getByRole("button", { name: "Nom" }));
    await waitFor(() => expect(rowNames(list)).toEqual(["Concert Bravo", "Festival Alpha", "Gala Charlie"]));
    fireEvent.click(within(sort).getByRole("button", { name: "Avancement" }));
    await waitFor(() => expect(rowNames(list)).toEqual(["Gala Charlie", "Concert Bravo", "Festival Alpha"]));

    fireEvent.change(search, { target: { value: "zzz" } });
    await waitFor(() => expect(within(list).getByText("Aucun résultat")).toBeInTheDocument());
  });

  test("aucun projet : EmptyState ; « Nouveau projet » en pointillés ouvre l'assistant", async () => {
    renderApp(
      "/dashboard",
      projectsApi("strata", {
        "GET /api/projects": { body: [] },
        "GET /api/projects?stats=tasks": { body: [] },
        "GET /api/tenant/projects": { body: { projects: [] } },
      }),
    );
    const list = await projectList();
    expect(within(list).getByText("Aucun projet")).toBeInTheDocument();
    expect(screen.getByText("Aucune captation planifiée")).toBeInTheDocument();
    const adds = screen.getAllByRole("button", { name: /Nouveau projet/ });
    for (const add of adds) expect(add.className).toContain("border-dashed");
    fireEvent.click(adds[0]);
    expect(await screen.findByRole("button", { name: /Commencer/ }, { timeout: 5000 })).toBeInTheDocument();
  });

  test("sans projects:write, pas de « Nouveau projet »", async () => {
    renderApp(
      "/dashboard",
      projectsApi("strata", {}, { ...TECH_PERMS, permissions: { ...TECH_PERMS.permissions, projects: "read" } }),
    );
    await projectList();
    expect(screen.queryByRole("button", { name: /Nouveau projet/ })).toBeNull();
  });

  test("compléments indisponibles : « — », jamais 0", async () => {
    renderApp(
      "/dashboard",
      projectsApi("strata", {
        "GET /api/tenant/projects": { status: 500, body: { error: "Erreur serveur" } },
        "GET /api/tenant/members?inactive=1": { status: 500, body: { error: "Erreur serveur" } },
      }),
    );
    const list = await projectList();
    fireEvent.click(within(list).getByRole("button", { name: "Festival Alpha" }));
    const detail = await screen.findByRole("region", { name: "Détail du projet" });
    expect(within(detail).getByRole("group", { name: "Documents" })).toHaveTextContent("—");
    expect(within(detail).getByRole("group", { name: "Tâches" })).toHaveTextContent("3");
  });

  test("suppression (projects:admin) : confirmation puis DELETE, compteurs à jour", async () => {
    const { fetchSpy } = renderApp(
      "/dashboard",
      projectsApi("strata", { "DELETE /api/tenant/projects/pB": { body: { ok: true } } }),
    );
    const list = await projectList();
    const counters = screen.getByRole("region", { name: "Compteurs" });
    const counter = (label: string) => within(counters).getByRole("group", { name: label });
    expect(counter("Projets actifs")).toHaveTextContent("2Projets actifssur 3 au total");
    expect(counter("Prochaine captation")).toHaveTextContent("Concert Bravo");

    fireEvent.click(within(list).getByRole("button", { name: "Concert Bravo" }));
    const detail = await screen.findByRole("region", { name: "Détail du projet" });
    fireEvent.click(within(detail).getByRole("button", { name: "Supprimer le projet" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Supprimer « Concert Bravo » ?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(rowNames(list)).toEqual(["Festival Alpha", "Gala Charlie"]));
    expect(
      fetchSpy.mock.calls.some(([u, init]) => String(u) === "/api/tenant/projects/pB" && init?.method === "DELETE"),
    ).toBe(true);
    expect(screen.queryByRole("region", { name: "Détail du projet" })).toBeNull();

    // Le projet supprimé ne compte plus : (42,5 + 100) / 2 = 71 %, prochaine
    // captation Festival Alpha, plus de Concert Bravo dans les captations à venir.
    expect(counter("Projets actifs")).toHaveTextContent("1Projets actifssur 2 au total");
    expect(counter("Complétion moyenne")).toHaveTextContent("71%");
    expect(counter("Prochaine captation")).toHaveTextContent("Festival Alpha");
    const upcoming = screen.getByRole("region", { name: "Captations à venir" });
    expect(within(upcoming).queryByText("Concert Bravo")).toBeNull();
    expect(within(upcoming).getByText("Festival Alpha")).toBeInTheDocument();
  });

  test("sans projects:admin, pas de suppression", async () => {
    renderApp("/dashboard", projectsApi("strata", {}, TECH_PERMS));
    const list = await projectList();
    fireEvent.click(within(list).getByRole("button", { name: "Gala Charlie" }));
    const detail = await screen.findByRole("region", { name: "Détail du projet" });
    expect(within(detail).queryByRole("button", { name: "Supprimer le projet" })).toBeNull();
  });

  test("Classique inchangé : /projects reste la liste d'arkyo", async () => {
    renderApp("/projects", projectsApi("classique"));
    await screen.findByText("Festival Alpha", {}, { timeout: 15000 });
    expect(screen.queryByRole("region", { name: "Tous les projets" })).toBeNull();
  });
});
