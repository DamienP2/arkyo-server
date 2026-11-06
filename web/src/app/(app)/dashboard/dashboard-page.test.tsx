/**
 * `/dashboard` (arkyo:app/(app)/dashboard/page.tsx) : même rendu, données lues
 * par `GET /api/projects` et `GET /api/projects?stats=tasks`, prénom tiré de la
 * session.
 */

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  OWNER_SESSION,
  renderApp,
  resetApp,
  signedInApi,
  type Api,
} from "@/tests/app-harness";

const DAY = 86_400_000;

/** Date ISO à `days` jours d'ici (midi passé, pour éviter les bords de journée). */
function inDays(days: number) {
  return new Date(Date.now() + days * DAY + 3_600_000).toISOString();
}

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

function dashboardApi(extra: Api = {}): Api {
  return {
    ...signedInApi(),
    "GET /api/auth/session": {
      body: { ...OWNER_SESSION, user: { ...OWNER_SESSION.user, name: "Damien Perpignan" } },
    },
    ...extra,
  };
}

beforeAll(async () => {
  await import("@/app/(app)/dashboard/page");
}, 30000);
afterEach(resetApp);

describe("/dashboard", () => {
  test("dashboard_lists_projects_and_greets_user", async () => {
    // Ordre de l'API : updatedAt desc (arkyo:app/api/projects/route.ts:22).
    const projects = [
      project("pA", "Festival Alpha", {
        updatedAt: "2026-11-05T10:00:00.000Z",
        shootingDate: inDays(20),
        clientName: "Client A",
        location: "Lyon",
        technicalSheet: { completionPercent: 42.5 },
      }),
      project("pB", "Concert Bravo", {
        updatedAt: "2026-11-04T10:00:00.000Z",
        shootingDate: inDays(5),
        status: "PRET",
      }),
      project("pC", "Gala Charlie", {
        updatedAt: "2026-11-03T10:00:00.000Z",
        status: "TERMINE",
        technicalSheet: { completionPercent: 100 },
      }),
    ];
    const { fetchSpy } = renderApp(
      "/dashboard",
      dashboardApi({
        "GET /api/projects": { body: projects },
        "GET /api/projects?stats=tasks": {
          body: [
            { status: "A_FAIRE", _count: 3 },
            { status: "VALIDE", _count: 1 },
          ],
        },
      }),
    );

    // Prénom de la session (session.user.name.split(" ")[0]).
    expect(
      await screen.findByText(/^(Bonjour|Bon après-midi|Bonsoir), Damien/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([u]) => String(u) === "/api/projects?stats=tasks")).toBe(true);

    // Stats : 2 actifs sur 3, 1/4 tâches (25 %), complétion moyenne 47,5 → 48 %,
    // prochaine captation = Bravo (shootingDate asc).
    const card = (label: string) => screen.getByText(label).closest("div.rounded-2xl") as HTMLElement;
    expect(within(card("Projets actifs")).getByText("2")).toBeInTheDocument();
    expect(within(card("Projets actifs")).getByText("sur 3 au total")).toBeInTheDocument();
    expect(within(card("Tâches complétées")).getByText("1/4")).toBeInTheDocument();
    expect(within(card("Tâches complétées")).getByText("25% d'avancement")).toBeInTheDocument();
    expect(within(card("Complétion moyenne")).getByText("48%")).toBeInTheDocument();
    expect(within(card("Prochaine captation")).getByText("Concert Bravo")).toBeInTheDocument();

    // Projets à venir et projets actifs : ordre shootingDate asc, liens /projects/:id.
    const section = (title: string) =>
      screen.getByText(title).closest("div.overflow-hidden") as HTMLElement;
    const upcoming = within(section("Projets à venir — 30 jours")).getAllByRole("link");
    expect(upcoming.map((a) => a.getAttribute("href"))).toEqual([
      "/projects",
      "/projects/pB",
      "/projects/pA",
    ]);
    expect(within(upcoming[2]).getByText("Client A")).toBeInTheDocument();
    expect(within(upcoming[2]).getByText("Lyon")).toBeInTheDocument();
    expect(within(upcoming[2]).getByText("43%")).toBeInTheDocument();
    // Moins de 7 jours : alerte en --danger-text (habillage Strata).
    const bravoDays = within(upcoming[1]).getByText("restants").parentElement!;
    expect(bravoDays.className).toContain("text-[var(--danger-text)]");

    const active = within(section("Tous les projets actifs")).getAllByRole("link");
    expect(active.map((a) => a.getAttribute("href"))).toEqual(["/projects/pB", "/projects/pA"]);
    expect(within(active[0]).getByText("Prêt")).toBeInTheDocument();
    expect(within(section("Tous les projets actifs")).getByText("2 projets")).toBeInTheDocument();

    // Activité récente : les 5 derniers modifiés (updatedAt desc).
    const recent = within(section("Activité récente")).getAllByRole("link");
    expect(recent.map((a) => a.textContent?.slice(0, 12))).toEqual([
      "Festival Alp",
      "Concert Brav",
      "Gala Charlie",
    ]);

    // Accès rapide.
    const quick = within(section("Accès rapide")).getAllByRole("link");
    expect(quick.map((a) => a.getAttribute("href"))).toEqual([
      "/projects",
      "/templates?tab=rigs",
      "/templates?tab=racks",
      "/templates?tab=panels",
    ]);
  });

  test("dashboard_empty_state", async () => {
    renderApp(
      "/dashboard",
      dashboardApi({
        "GET /api/projects": { body: [] },
        "GET /api/projects?stats=tasks": { body: [] },
      }),
    );
    expect(await screen.findByText("Aucune captation planifiée", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("Aucun projet actif")).toBeInTheDocument();
    expect(screen.getByText("Aucun projet")).toBeInTheDocument();
    expect(screen.getByText("0/0")).toBeInTheDocument();
    expect(screen.getByText("Aucune planifiée")).toBeInTheDocument();
    // Bouton d'ajout en pointillés vers /projects.
    const add = screen.getAllByRole("link", { name: /Nouveau projet/ });
    expect(add).toHaveLength(2);
    for (const a of add) {
      expect(a.getAttribute("href")).toBe("/projects");
      expect(a.className).toContain("border-dashed");
    }
  });

  test("dashboard_error_state_retry", async () => {
    let fail = true;
    renderApp(
      "/dashboard",
      dashboardApi({
        "GET /api/projects": () =>
          fail ? { status: 500, body: { error: "Erreur serveur" } } : { body: [] },
        "GET /api/projects?stats=tasks": { body: [] },
      }),
    );
    expect(await screen.findByText("Erreur serveur", {}, { timeout: 5000 })).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.getByText("Aucun projet actif")).toBeInTheDocument());
  });
});
