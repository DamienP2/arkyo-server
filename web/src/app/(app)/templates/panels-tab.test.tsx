/**
 * `/templates?tab=panels` : onglet Panels (arkyo:app/(app)/panels/panels-client.tsx
 * et arkyo:components/panels/new-panel-wizard.tsx). Données de
 * `GET /api/panels` (slots enrichis de `connectorType`), hauteurs proposées
 * par `u_heights` de `GET /api/admin/config`, création `design:write`
 * (`POST /api/panels` puis l'éditeur `/panels/:id`), suppression
 * `design:admin`.
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

function connector(id: string, category: string) {
  return { id, name: `Conn ${id}`, version: null, color: "#3b82f6", category };
}

function slot(panelId: string, position: number, conn: ReturnType<typeof connector> | null) {
  return {
    id: `${panelId}-s${position}`,
    panelId,
    position,
    sizeSlots: 1,
    label: null,
    notes: null,
    connectorTypeId: conn?.id ?? null,
    connectorType: conn,
    mountD: false,
    familyLabel: null,
  };
}

function panel(id: string, name: string, heightU: number, slotsPerU: number, slots: unknown[] = []) {
  return {
    id,
    name,
    panelType: "PATCH",
    accessoryType: null,
    plateType: null,
    heightU,
    slotsPerU,
    depthMm: 50,
    rearCableDepthMm: 80,
    notes: null,
    private: false,
    createdById: "u1",
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    slots,
  };
}

const PANELS = [
  panel("pn1", "Patch XLR A", 1, 8, [
    slot("pn1", 1, connector("xlr", "AUDIO")),
    slot("pn1", 2, connector("xlr", "AUDIO")),
    slot("pn1", 3, null),
  ]),
  panel("pn2", "Patch BNC", 2, 12, [slot("pn2", 1, connector("bnc", "VIDEO"))]),
  panel("pn3", "Patch RJ45", 1, 24),
];

const DESIGN_WRITE = { ...TECH_PERMS, permissions: { ...TECH_PERMS.permissions, design: "write" } };

function panelsApi(perms: unknown = OWNER_PERMS, extra: Api = {}): Api {
  return {
    ...signedInApi(perms),
    "GET /api/racks?templates=true": { body: [] },
    "GET /api/panels": { body: PANELS },
    "GET /api/admin/config": { body: { u_heights: "[1,2,3,6]" } },
    ...extra,
  };
}

/** Carte (vue grille) d'un panel, par son nom. */
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

describe("/templates?tab=panels", () => {
  test("panels_tab_lists_and_creates", async () => {
    const { fetchSpy, router } = renderApp(
      "/templates?tab=panels",
      panelsApi(DESIGN_WRITE, {
        "POST /api/panels": { status: 201, body: panel("new1", "Patch Fibre", 2, 12) },
      }),
    );

    // Liste : groupes par hauteur (1U, 2U), occupation, densité.
    expect(await screen.findByText("Patch XLR A", {}, { timeout: 5000 })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["1U", "2U"]);
    expect(within(card("Patch XLR A")).getByText("2/8")).toBeInTheDocument();
    expect(within(card("Patch XLR A")).getByText("8/U")).toBeInTheDocument();
    expect(within(card("Patch BNC")).getByText("1/24")).toBeInTheDocument();
    // Filtres par catégorie de signal présente.
    expect(screen.getByRole("button", { name: /Audio/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vidéo/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Vidéo/ }));
    expect(screen.queryByText("Patch XLR A")).toBeNull();
    expect(screen.getByText("Patch BNC")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Vidéo/ }));

    // « Nouveau panel » en pointillés (design:write), pas de suppression (design:admin).
    const add = screen.getByRole("button", { name: /Nouveau panel/ });
    expect(add.className).toContain("border-dashed");
    expect(within(card("Patch XLR A")).queryAllByRole("button")).toHaveLength(0);

    // Assistant : nom, hauteur (u_heights), slots / U, câblage, notes, récapitulatif.
    fireEvent.click(add);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("modèle de panel")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Commencer/ }));
    fireEvent.change(await within(dialog).findByPlaceholderText("Ex. Panneau XLR — Audio"), {
      target: { value: "  Patch Fibre " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));
    await within(dialog).findByText("Quelle hauteur ?");
    expect(within(dialog).queryByRole("button", { name: "4U" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "2U" }));
    await within(dialog).findByText("Combien de slots par U ?", {}, { timeout: 2000 });
    fireEvent.click(within(dialog).getByRole("button", { name: /^12/ }));
    await within(dialog).findByText("Profondeur de câblage arrière", {}, { timeout: 2000 });
    fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));
    await within(dialog).findByText("Notes techniques");
    fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));
    await within(dialog).findByText("Vérifiez et créez votre panel");
    expect(within(dialog).getByText("Patch Fibre")).toBeInTheDocument();
    expect(within(dialog).getByText("80 mm")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Créer le panel/ }));

    // POST /api/panels avec le corps d'arkyo, puis l'éditeur du panel créé.
    await waitFor(() => expect(router.state.location.pathname).toBe("/panels/new1"), { timeout: 5000 });
    expect(sentBody(fetchSpy, "POST", "/api/panels")).toEqual({
      name: "Patch Fibre",
      heightU: 2,
      slotsPerU: 12,
      rearCableDepthMm: 80,
    });
    expect(
      fetchSpy.mock.calls.filter(([u, init]) => String(u) === "/api/panels" && init?.method === "POST"),
    ).toHaveLength(1);
  });

  test("panels_tab_guards_and_deletes", async () => {
    // design:read : ni création, ni suppression ; un clic ouvre le panel.
    const read = renderApp("/templates?tab=panels", panelsApi(TECH_PERMS));
    await screen.findByText("Patch XLR A", {}, { timeout: 5000 });
    expect(screen.queryByRole("button", { name: /Nouveau panel/ })).toBeNull();
    fireEvent.click(card("Patch RJ45"));
    await waitFor(() => expect(read.router.state.location.pathname).toBe("/panels/pn3"));
    resetApp();

    // Liste vide : EmptyState avec « Nouveau panel ».
    renderApp("/templates?tab=panels", panelsApi(OWNER_PERMS, { "GET /api/panels": { body: [] } }));
    expect(await screen.findByText("Aucun panel de patch", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nouveau panel/ })).toBeInTheDocument();
    resetApp();

    // design:admin : confirmation (connecteurs comptés), puis DELETE /api/panels/:id.
    const { fetchSpy } = renderApp(
      "/templates?tab=panels",
      panelsApi(OWNER_PERMS, { "DELETE /api/panels/pn1": { body: { ok: true } } }),
    );
    await screen.findByText("Patch XLR A", {}, { timeout: 5000 });
    fireEvent.click(within(card("Patch XLR A")).getByRole("button"));
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByText("Supprimer ce panel ?")).toBeInTheDocument();
    expect(confirm.textContent).toContain("et ses 2 connecteurs");
    fireEvent.click(within(confirm).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(screen.queryByText("Patch XLR A")).toBeNull());
    expect(
      fetchSpy.mock.calls.some(([u, init]) => String(u) === "/api/panels/pn1" && init?.method === "DELETE"),
    ).toBe(true);
    expect(screen.getByText("Patch BNC")).toBeInTheDocument();
  });
});
