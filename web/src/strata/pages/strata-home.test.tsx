/**
 * Accueil Strata (`/dashboard` en interface Strata) : bandeau (compteurs du
 * tableau de bord Classique, captations à venir, à traiter, activité) et
 * grille de projets avec « Concevoir » et « Livrer ». En Classique, la page
 * reste le tableau de bord d'arkyo (`dashboard-page.test.tsx`).
 */

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";

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
    technicalSheet: { completionPercent: 42.5 },
    _count: { tasks: 3 },
  }),
  project("pB", "Concert Bravo", {
    updatedAt: "2026-11-04T10:00:00.000Z",
    shootingDate: inDays(5),
    status: "PRET",
    interventionType: "INTEGRATION",
    commissioningDate: inDays(5),
  }),
  project("pC", "Gala Charlie", {
    updatedAt: "2026-11-03T10:00:00.000Z",
    status: "TERMINE",
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

const NOTIFICATIONS = {
  items: [
    {
      id: "n1",
      type: "INFO",
      title: "Projet modifié",
      message: "Festival Alpha : fiche mise à jour",
      data: null,
      readAt: null,
      createdAt: "2026-11-06T09:30:00.000Z",
    },
  ],
  count: 1,
  total: 1,
  page: 1,
  pages: 1,
};

function homeApi(iface: "classique" | "strata", extra: Api = {}): Api {
  return {
    ...signedInApi(undefined, "Régie A", iface),
    "GET /api/projects": { body: PROJECTS },
    "GET /api/projects?stats=tasks": { body: TASK_STATS },
    "GET /api/tenant/projects": { body: { projects: TENANT_PROJECTS } },
    "GET /api/notifications?limit=15": { body: NOTIFICATIONS },
    ...extra,
  };
}

beforeAll(async () => {
  await Promise.all([import("@/app/(app)/dashboard/page"), import("@/strata/pages/strata-home")]);
}, 60000);

afterEach(() => {
  resetApp();
  delete document.documentElement.dataset.interface;
});

const LABELS = ["Projets actifs", "Tâches complétées", "Complétion moyenne", "Prochaine captation"];

describe("accueil Strata", () => {
  test("bandeau : projets actifs, tâches complétées, complétion moyenne, prochaine captation", async () => {
    // Valeurs du tableau de bord Classique pour ce jeu de données.
    renderApp("/dashboard", homeApi("classique"));
    await screen.findByText("Tous les projets actifs", {}, { timeout: 15000 });
    const classique = new Map<string, string[]>();
    for (const label of LABELS) {
      const card = screen.getByText(label).closest("div.rounded-2xl") as HTMLElement;
      const texts = [...card.querySelectorAll("p")]
        .map((p) => p.textContent ?? "")
        .filter((t) => t !== label);
      classique.set(label, texts);
    }
    // Garde-fou : le jeu de données donne bien des valeurs non triviales.
    expect(classique.get("Projets actifs")).toEqual(["2", "sur 3 au total"]);
    expect(classique.get("Tâches complétées")).toEqual(["1/4", "25% d'avancement"]);
    expect(classique.get("Complétion moyenne")).toEqual(["48%", "fiches techniques"]);
    expect(classique.get("Prochaine captation")?.[1]).toBe("Concert Bravo");
    resetApp();

    // Mêmes valeurs dans le bandeau Strata.
    renderApp("/dashboard", homeApi("strata"));
    const band = await screen.findByRole("region", { name: "Bandeau" }, { timeout: 15000 });
    for (const label of LABELS) {
      const counter = within(band).getByRole("group", { name: label });
      for (const text of classique.get(label)!) {
        expect(within(counter).getByText(text)).toBeInTheDocument();
      }
    }
    // Les trois cartes du bandeau.
    for (const title of ["Captations à venir", "À traiter", "Activité"]) {
      expect(within(band).getByRole("heading", { name: title })).toBeInTheDocument();
    }
    // Captations à venir : les deux projets datés dans les 30 jours, le plus proche d'abord.
    const upcoming = within(band).getByRole("region", { name: "Captations à venir" });
    const names = within(upcoming)
      .getAllByRole("link")
      .map((a) => a.textContent ?? "");
    expect(names[0]).toContain("Concert Bravo");
    expect(names[1]).toContain("Festival Alpha");
    // Activité : notifications de l'utilisateur.
    const activity = within(band).getByRole("region", { name: "Activité" });
    expect(within(activity).getByText("Projet modifié")).toBeInTheDocument();
  });

  test("grille de projets avec Concevoir et Livrer", async () => {
    renderApp("/dashboard", homeApi("strata"));
    const grid = await screen.findByRole("region", { name: "Tous les projets actifs" }, { timeout: 15000 });
    const cards = within(grid).getAllByRole("article");
    // Projets actifs seulement (Gala Charlie est terminé).
    expect(cards.map((c) => within(c).getByRole("heading").textContent)).toEqual(
      expect.arrayContaining(["Festival Alpha", "Concert Bravo"]),
    );
    expect(cards).toHaveLength(2);
    expect(within(grid).queryByText("Gala Charlie")).toBeNull();

    const alpha = cards.find((c) => within(c).queryByText("Festival Alpha"))!;
    expect(within(alpha).getByRole("link", { name: /Concevoir/ })).toHaveAttribute(
      "href",
      "/project/pA?tab=rack",
    );
    expect(within(alpha).getByRole("link", { name: /Livrer/ })).toHaveAttribute(
      "href",
      "/project/pA?tab=preparation",
    );
    // Type d'intervention, statut, client, compteurs de la liste des projets, fiche.
    expect(within(alpha).getByText("Prestation")).toBeInTheDocument();
    expect(within(alpha).getByText("En préparation")).toBeInTheDocument();
    expect(within(alpha).getByText("Client A")).toBeInTheDocument();
    expect(within(alpha).getByRole("group", { name: "Régies" })).toHaveTextContent("2");
    expect(within(alpha).getByRole("group", { name: "Documents" })).toHaveTextContent("4");
    expect(within(alpha).getByRole("group", { name: "Tâches" })).toHaveTextContent("3");
    expect(within(alpha).getByRole("meter", { name: "Fiche technique" })).toHaveAttribute(
      "aria-valuenow",
      "43",
    );

    const bravo = cards.find((c) => within(c).queryByText("Concert Bravo"))!;
    expect(within(bravo).getByText("Intégration")).toBeInTheDocument();
    expect(within(bravo).getByRole("link", { name: /Concevoir/ })).toHaveAttribute(
      "href",
      "/project/pB?tab=rack",
    );
    expect(within(bravo).getByRole("link", { name: /Livrer/ })).toHaveAttribute(
      "href",
      "/project/pB?tab=preparation",
    );

    // Recherche.
    fireEvent.change(within(grid).getByRole("searchbox", { name: "Rechercher des projets" }), {
      target: { value: "lyon" },
    });
    await waitFor(() => expect(within(grid).getAllByRole("article")).toHaveLength(1));
    expect(within(grid).getByText("Festival Alpha")).toBeInTheDocument();

    // Tri par nom.
    fireEvent.change(within(grid).getByRole("searchbox", { name: "Rechercher des projets" }), {
      target: { value: "" },
    });
    fireEvent.click(within(grid).getByRole("button", { name: "Nom" }));
    await waitFor(() =>
      expect(
        within(grid)
          .getAllByRole("article")
          .map((c) => within(c).getByRole("heading").textContent),
      ).toEqual(["Concert Bravo", "Festival Alpha"]),
    );
  });

  test("aucun projet → EmptyState", async () => {
    renderApp(
      "/dashboard",
      homeApi("strata", {
        "GET /api/projects": { body: [] },
        "GET /api/projects?stats=tasks": { body: [] },
        "GET /api/tenant/projects": { body: { projects: [] } },
        "GET /api/notifications?limit=15": { body: { ...NOTIFICATIONS, items: [], count: 0, total: 0 } },
      }),
    );
    const grid = await screen.findByRole("region", { name: "Tous les projets actifs" }, { timeout: 15000 });
    expect(within(grid).getByText("Aucun projet actif")).toBeInTheDocument();
    expect(within(grid).queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText("Aucune captation planifiée")).toBeInTheDocument();
    expect(screen.getByText("Rien à traiter")).toBeInTheDocument();
    expect(screen.getByText("Aucune activité")).toBeInTheDocument();
    // « Nouveau projet » : en pointillés (règle arkyo), ouvre l'assistant existant.
    const adds = screen.getAllByRole("button", { name: /Nouveau projet/ });
    for (const add of adds) expect(add.className).toContain("border-dashed");
    fireEvent.click(adds[0]);
    expect(await screen.findByRole("button", { name: /Commencer/ }, { timeout: 5000 })).toBeInTheDocument();
  });

  test("heading « Tous les projets actifs » conservé", async () => {
    renderApp("/dashboard", homeApi("strata"));
    expect(
      await screen.findByRole("heading", { name: "Tous les projets actifs" }, { timeout: 15000 }),
    ).toBeInTheDocument();
    // Pas de tableau de bord Classique en Strata.
    expect(screen.queryByText("Accès rapide")).toBeNull();
  });

  test("liste des projets ou activité indisponibles : l'accueil reste affiché", async () => {
    renderApp(
      "/dashboard",
      homeApi("strata", {
        "GET /api/tenant/projects": { status: 500, body: { error: "Erreur serveur" } },
        "GET /api/notifications?limit=15": { status: 500, body: { error: "Erreur serveur" } },
      }),
    );
    const grid = await screen.findByRole("region", { name: "Tous les projets actifs" }, { timeout: 15000 });
    const alpha = within(grid)
      .getAllByRole("article")
      .find((c) => within(c).queryByText("Festival Alpha"))!;
    // Compteurs de la liste inconnus : « — », jamais 0.
    expect(within(alpha).getByRole("group", { name: "Documents" })).toHaveTextContent("—");
    expect(within(alpha).getByRole("group", { name: "Tâches" })).toHaveTextContent("3");
    expect(screen.getByText("Impossible de charger l'activité.")).toBeInTheDocument();
  });
});
