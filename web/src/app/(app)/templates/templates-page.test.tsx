/**
 * `/templates` (arkyo:app/(app)/templates/{page.tsx,templates-client.tsx}),
 * onglet Contenants (arkyo:app/(app)/racks/racks-client.tsx et
 * arkyo:components/racks/new-rack-wizard.tsx) : données lues par
 * `GET /api/racks?templates=true` (slots enrichis par l'API) et
 * `GET /api/panels`, garde `design:read`, création `design:write`,
 * suppression `design:admin`. L'onglet Dossiers reste `ComingSoon` (phase 6).
 */

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
    category: null,
    brand: null,
    source: "PERSONAL",
  };
}

function slot(id: string, heightU: number, eq: ReturnType<typeof equipment> | null, view = "FRONT") {
  return {
    id,
    rackId: "r1",
    view,
    startU: 1,
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
    totalU: 42,
    depthMm: 600,
    maxWeightKg: null,
    maxPowerW: null,
    emptyWeightKg: null,
    rearInteriorGapMm: null,
    notes: null,
    rackType: "STANDARD",
    hasWheels: false,
    isRackable: true,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    slots: [],
    rigs: [],
    ...extra,
  };
}

const RACKS = [
  rack("r1", "Baie Vidéo", {
    updatedAt: "2026-11-05T10:00:00.000Z",
    emptyWeightKg: 20,
    slots: [slot("s1", 2, equipment("e1", 5.5, 150)), slot("s2", 1, equipment("e2", 2, 50))],
    rigs: [{ id: "rr1", rigConfigId: "g1", rackId: "r1", position: 0, rigConfig: { id: "g1", name: "Régie Nord" } }],
  }),
  rack("r2", "Pelicase HF", {
    updatedAt: "2026-11-04T10:00:00.000Z",
    rackType: "PELICAN",
    totalU: 1,
    depthMm: 450,
    isRackable: false,
  }),
  rack("r3", "Flight Son", {
    updatedAt: "2026-11-03T10:00:00.000Z",
    rackType: "FLIGHT_CASE_CLASSIC",
    totalU: 12,
    hasWheels: true,
  }),
];

const DESIGN_WRITE = { ...TECH_PERMS, permissions: { ...TECH_PERMS.permissions, design: "write" } };

function templatesApi(perms: unknown = OWNER_PERMS, extra: Api = {}): Api {
  return {
    ...signedInApi(perms),
    "GET /api/racks?templates=true": { body: RACKS },
    "GET /api/panels": { body: [] },
    "GET /api/admin/config": { body: { u_heights: "[6,12,24,42]" } },
    ...extra,
  };
}

/** Carte (vue grille) d'un contenant, par son nom. */
function card(name: string) {
  return screen.getByText(name).closest("div.group") as HTMLElement;
}

beforeAll(async () => {
  await import("@/app/(app)/templates/page");
}, 30000);
afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("/templates", () => {
  test("containers_tab_lists_template_racks", async () => {
    const { fetchSpy, router } = renderApp("/templates", templatesApi());

    // Défaut : onglet Contenants (?tab= absent), données de la page serveur d'arkyo.
    expect(await screen.findByText("Baie Vidéo", {}, { timeout: 5000 })).toBeInTheDocument();
    const urls = fetchSpy.mock.calls.map(([u]) => String(u));
    expect(urls).toContain("/api/racks?templates=true");
    expect(urls).toContain("/api/panels");

    // Groupes par type, dans l'ordre d'arkyo (Baies, Flight case, …, Pelicase).
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Baies", "Flight case", "Pelicase"]);

    // Carte : dimensions, régie, occupation, poids (vide + équipements), puissance.
    const baie = card("Baie Vidéo");
    expect(within(baie).getByText("42U · 600mm")).toBeInTheDocument();
    expect(within(baie).getByText("Régie Nord")).toBeInTheDocument();
    expect(within(baie).getByText("3/42U")).toBeInTheDocument();
    expect(within(baie).getByText("27.5kg")).toBeInTheDocument();
    expect(within(baie).getByText("200W")).toBeInTheDocument();
    expect(within(card("Pelicase HF")).getByText("1U · 450mm")).toBeInTheDocument();

    // « Nouveau contenant » en pointillés (design:write).
    const add = screen.getByRole("button", { name: /Nouveau contenant/ });
    expect(add.className).toContain("border-dashed");

    // Recherche par nom.
    fireEvent.change(screen.getByPlaceholderText("Nom…"), { target: { value: "flight" } });
    expect(screen.queryByText("Baie Vidéo")).toBeNull();
    expect(screen.getByText("Flight Son")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Nom…"), { target: { value: "" } });

    // Ouvrir un contenant : éditeur de rack (`/racks/:id`, ComingSoon jusqu'à la phase 4).
    fireEvent.click(card("Baie Vidéo"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/racks/r1"));
    expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
    resetApp();

    // ?tab=rigs (redirection de /rigs) : onglet inconnu → Contenants, comme arkyo.
    renderApp("/templates?tab=rigs", templatesApi());
    expect(await screen.findByText("Pelicase HF", {}, { timeout: 5000 })).toBeInTheDocument();
    resetApp();

    // Liste vide : EmptyState avec « Nouveau contenant ».
    renderApp("/templates", templatesApi(OWNER_PERMS, { "GET /api/racks?templates=true": { body: [] } }));
    expect(await screen.findByText("Aucun contenant", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nouveau contenant/ })).toBeInTheDocument();
    resetApp();

    // Sans design:read : redirection vers /dashboard, sans lire les contenants.
    const denied = renderApp(
      "/templates",
      templatesApi({ ...TECH_PERMS, permissions: { ...TECH_PERMS.permissions, design: "none" } }),
    );
    await waitFor(() => expect(denied.router.state.location.pathname).toBe("/dashboard"), {
      timeout: 5000,
    });
    expect(denied.fetchSpy.mock.calls.some(([u]) => String(u).startsWith("/api/racks"))).toBe(false);
  });

  test("new_container_wizard_posts_rack", async () => {
    const { fetchSpy, router } = renderApp(
      "/templates?tab=racks",
      templatesApi(DESIGN_WRITE, {
        "POST /api/racks": { status: 201, body: rack("new1", "FC Audio", { rackType: "FLIGHT_CASE_CLASSIC" }) },
      }),
    );
    await screen.findByText("Baie Vidéo", {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: /Nouveau contenant/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("modèle de contenant")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /Commencer/ }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /Flight case/ }));
    fireEvent.change(await within(dialog).findByPlaceholderText("Ex. Flight case audio"), {
      target: { value: "  FC Audio " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /^Rackable/ }));
    await within(dialog).findByText("Quelles dimensions ?");
    // Hauteurs proposées : `u_heights` de /api/admin/config.
    expect(within(dialog).queryByRole("button", { name: "9U" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "12U" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));
    await within(dialog).findByText("Le contenant est-il sur roulettes ?");
    fireEvent.click(within(dialog).getByRole("button", { name: /Oui/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));
    await within(dialog).findByText("Quel est le poids à vide ?");
    fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));
    await within(dialog).findByText("Y a-t-il des rails arrière internes ?");
    fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));
    await within(dialog).findByText("Vérifiez et créez votre contenant");
    expect(within(dialog).getByText("FC Audio")).toBeInTheDocument();
    expect(within(dialog).getByText("12U · 600 mm")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Créer le contenant/ }));

    // POST /api/racks avec le corps d'arkyo, puis l'éditeur du contenant créé.
    await waitFor(() => expect(router.state.location.pathname).toBe("/racks/new1"), { timeout: 5000 });
    expect(sentBody(fetchSpy, "POST", "/api/racks")).toEqual({
      name: "FC Audio",
      rackType: "FLIGHT_CASE_CLASSIC",
      isRackable: true,
      totalU: 12,
      depthMm: 600,
      hasWheels: true,
    });
    expect(
      fetchSpy.mock.calls.filter(([u, init]) => String(u) === "/api/racks" && init?.method === "POST"),
    ).toHaveLength(1);
  });

  test("delete_container_requires_design_admin", async () => {
    // design:read : ni création, ni configuration, ni suppression.
    renderApp("/templates", templatesApi(TECH_PERMS));
    await screen.findByText("Baie Vidéo", {}, { timeout: 5000 });
    expect(screen.queryByRole("button", { name: /Nouveau contenant/ })).toBeNull();
    expect(within(card("Baie Vidéo")).queryAllByRole("button")).toHaveLength(0);
    resetApp();

    // design:write : création et configuration, pas de suppression.
    renderApp("/templates", templatesApi(DESIGN_WRITE));
    await screen.findByText("Baie Vidéo", {}, { timeout: 5000 });
    expect(screen.getByRole("button", { name: /Nouveau contenant/ })).toBeInTheDocument();
    const writeButtons = within(card("Baie Vidéo")).getAllByRole("button");
    expect(writeButtons.map((b) => b.title)).toEqual(["Configurer"]);
    resetApp();

    // design:admin : confirmation, puis DELETE /api/racks/:id.
    const { fetchSpy } = renderApp(
      "/templates",
      templatesApi(OWNER_PERMS, { "DELETE /api/racks/r2": { body: { ok: true } } }),
    );
    await screen.findByText("Pelicase HF", {}, { timeout: 5000 });
    const remove = within(card("Pelicase HF"))
      .getAllByRole("button")
      .find((b) => b.title !== "Configurer")!;
    fireEvent.click(remove);
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByText("Supprimer ce rack ?")).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(screen.queryByText("Pelicase HF")).toBeNull());
    expect(
      fetchSpy.mock.calls.some(([u, init]) => String(u) === "/api/racks/r2" && init?.method === "DELETE"),
    ).toBe(true);
    expect(screen.getByText("Baie Vidéo")).toBeInTheDocument();
  });

  test("dossiers_tab_is_coming_soon", async () => {
    renderApp("/templates?tab=dossiers", templatesApi());
    expect(await screen.findByText("Bientôt disponible", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText("Baie Vidéo")).toBeNull();
    expect(screen.queryByRole("button", { name: /Nouveau contenant/ })).toBeNull();
  });
});
