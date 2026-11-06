/**
 * Assistant « Nouveau projet » (arkyo:components/projects/new-project-dialog.tsx),
 * ouvert depuis `/projects` : trois appels (projet, lieu, contenant), puis
 * l'éditeur projet (`/project/:id?tab=inventaire`, `ComingSoon` jusqu'à la phase 4).
 */

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";

const EXISTING = {
  id: "p1",
  name: "Festival Alpha",
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
};

const DUPLICATE = "Un projet porte déjà ce nom dans cet espace.";

function wizardApi(extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS),
    "GET /api/tenant/projects": { body: { projects: [EXISTING] } },
    ...extra,
  };
}

type Spy = ReturnType<typeof renderApp>["fetchSpy"];

/** Appels d'écriture (POST/PATCH/DELETE) vers les routes projets, dans l'ordre. */
function writes(fetchSpy: Spy) {
  return fetchSpy.mock.calls
    .filter(([u, init]) => String(u).startsWith("/api/tenant/projects") && (init?.method ?? "GET") !== "GET")
    .map(([u, init]) => ({ url: String(u), method: init?.method, body: JSON.parse(String(init?.body)) }));
}

async function openWizard() {
  await screen.findByText("Festival Alpha", {}, { timeout: 5000 });
  fireEvent.click(screen.getByRole("button", { name: /Nouveau projet/ }));
  return screen.findByRole("dialog");
}

function next(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: /Continuer|Passer|Créer le projet/ }));
}

/** Choisit la plage du 15 au 17 du mois prochain (numéros absents des mois voisins de la grille). */
function pickDates(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "Mois suivant" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "15" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "17" }));
}

/** Parcourt l'assistant jusqu'au récapitulatif, avec le nom de projet `name`. */
async function walkToSummary(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole("button", { name: /Commencer/ }));
  fireEvent.click(await within(dialog).findByRole("button", { name: /Flight case/ }));
  fireEvent.change(await within(dialog).findByPlaceholderText(/Ex\. Match PSG-OM/), {
    target: { value: name },
  });
  next(dialog);
  await within(dialog).findByText("Pour quel client ?");
  next(dialog);
  await within(dialog).findByText("Quelle est la période de planification ?");
  pickDates(dialog);
  next(dialog);
  await within(dialog).findByText("Période de tournage");
  pickDates(dialog);
  next(dialog);
  fireEvent.change(await within(dialog).findByPlaceholderText("Adresse, salle, site…"), {
    target: { value: "Lyon" },
  });
  next(dialog);
  fireEvent.change(await within(dialog).findByPlaceholderText("Ex. Régie principale"), {
    target: { value: "Régie principale" },
  });
  next(dialog);
  fireEvent.click(await within(dialog).findByRole("button", { name: /Baie standard 19"/ }));
  fireEvent.change(await within(dialog).findByPlaceholderText("Ex. Baie A — Vidéo"), {
    target: { value: "Baie A" },
  });
  next(dialog);
  fireEvent.click(await within(dialog).findByRole("button", { name: /^Rackable/ }));
  await within(dialog).findByText("Quelles dimensions ?");
  next(dialog);
  await within(dialog).findByText("Quel est le poids à vide ?");
  next(dialog);
  await within(dialog).findByText("Y a-t-il des rails arrière internes ?");
  next(dialog);
  await within(dialog).findByText("Une description à ajouter ?");
  next(dialog); // « Passer »
  await within(dialog).findByText("Vérifiez et créez votre projet");
}

beforeAll(async () => {
  await import("@/app/(app)/projects/page");
}, 30000);
afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("assistant Nouveau projet", () => {
  test("wizard_creates_project_location_and_rack", async () => {
    const { fetchSpy, router } = renderApp(
      "/projects",
      wizardApi({
        "POST /api/tenant/projects": { status: 201, body: { id: "np1", name: "Concert Echo" } },
        "POST /api/tenant/projects/np1/locations": { status: 201, body: { id: "loc1", name: "Régie principale" } },
        "POST /api/tenant/projects/np1/racks": {
          status: 201,
          body: { created: [{ id: "r1", name: "Baie A", rackType: "STANDARD" }] },
        },
      }),
    );
    const dialog = await openWizard();
    expect(within(dialog).getByText("Nouveau projet · Prestation")).toBeInTheDocument();
    await walkToSummary(dialog, "Concert Echo");
    expect(within(dialog).getByText("Concert Echo")).toBeInTheDocument();
    expect(within(dialog).getByText('Baie A · Baie standard 19"')).toBeInTheDocument();
    next(dialog); // « Créer le projet »

    await waitFor(() => expect(router.state.location.pathname).toBe("/project/np1"), { timeout: 5000 });
    expect(router.state.location.search).toBe("?tab=inventaire");

    const calls = writes(fetchSpy);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/tenant/projects",
      "POST /api/tenant/projects/np1/locations",
      "POST /api/tenant/projects/np1/racks",
    ]);
    expect(calls[0].body).toMatchObject({
      name: "Concert Echo",
      interventionType: "PRESTATION",
      rigType: "FLIGHT_CASE",
      location: "Lyon",
    });
    expect(calls[0].body.planningStart).toMatch(/^\d{4}-\d{2}-15$/);
    expect(calls[0].body.planningEnd).toMatch(/^\d{4}-\d{2}-17$/);
    expect(calls[0].body.shootingDate).toMatch(/^\d{4}-\d{2}-15$/);
    expect(calls[0].body.shootingEndDate).toMatch(/^\d{4}-\d{2}-17$/);
    expect(calls[0].body).not.toHaveProperty("clientName");
    expect(calls[1].body).toEqual({ name: "Régie principale" });
    expect(calls[2].body).toEqual({
      racks: [
        { name: "Baie A", rackType: "STANDARD", isRackable: true, depthMm: 600, totalU: 42, locationId: "loc1" },
      ],
    });
  }, 30000);

  test("duplicate_name_shows_field_error", async () => {
    // « Festival Álpha » passe le contrôle local (casse et espaces seulement) ;
    // le serveur, qui ignore aussi les accents, répond 409 avec `issues`.
    const { fetchSpy, router } = renderApp(
      "/projects",
      wizardApi({
        "POST /api/tenant/projects": {
          status: 409,
          body: { error: "Validation invalide", issues: [{ path: ["name"], message: DUPLICATE }] },
        },
      }),
    );
    const dialog = await openWizard();
    await walkToSummary(dialog, "Festival Álpha");
    next(dialog);

    // Retour à l'étape du nom, message sous le champ.
    expect(await within(dialog).findByText(DUPLICATE, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(dialog).getByText("Comment s'appelle votre projet ?")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Festival Álpha")).toBeInTheDocument();
    expect(writes(fetchSpy).map((c) => c.url)).toEqual(["/api/tenant/projects"]);
    expect(router.state.location.pathname).toBe("/projects");
  }, 30000);

  test("cancel_mid_wizard_creates_nothing", async () => {
    const { fetchSpy, router } = renderApp("/projects", wizardApi());
    let dialog = await openWizard();
    fireEvent.click(within(dialog).getByRole("button", { name: /Commencer/ }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /Car régie/ }));
    fireEvent.change(await within(dialog).findByPlaceholderText(/Ex\. Match PSG-OM/), {
      target: { value: "Projet abandonné" },
    });
    next(dialog);
    await within(dialog).findByText("Pour quel client ?");

    fireEvent.click(within(dialog).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes(fetchSpy)).toEqual([]);
    expect(router.state.location.pathname).toBe("/projects");

    // Réouverture (après la remise à zéro différée de 150 ms) : l'assistant
    // repart de l'accueil, champs vides.
    await new Promise((r) => setTimeout(r, 200));
    dialog = await openWizard();
    fireEvent.click(await within(dialog).findByRole("button", { name: /Commencer/ }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /Flight case/ }));
    expect(await within(dialog).findByPlaceholderText(/Ex\. Match PSG-OM/)).toHaveValue("");
    expect(writes(fetchSpy)).toEqual([]);
  }, 30000);
});
