/**
 * `/panels/:id` : chargeur de l'éditeur de panel
 * (arkyo:app/(fullscreen)/panels/[id]/page.tsx). Il lit `GET /api/panels/:id`
 * (slots par position, enrichis de `connectorTypeId` / `connectorType`), les
 * connecteurs du catalogue avec leurs fonctions et les dérivés Neutrik D
 * (`GET /api/tenant/catalogue/connectors`), les fonctions
 * (`GET /api/tenant/parametres/categories`) et le nom du site (`/api/site`,
 * à la place du nom du tenant), puis refait `category` / `categories` et
 * `connectorCategories` comme la page serveur d'arkyo ; garde `design:write`.
 *
 * `PanelEditor` est simulé ici : on vérifie les props qu'il reçoit.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { OWNER_PERMS, TECH_PERMS, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";

const editor = vi.hoisted(() => ({ props: null as null | Record<string, unknown>, renders: 0 }));

vi.mock("@/app/(fullscreen)/panels/[id]/panel-editor", () => ({
  PanelEditor: (props: Record<string, unknown>) => {
    editor.props = props;
    editor.renders += 1;
    return <div>Éditeur de panel {(props.panel as { name: string }).name}</div>;
  },
}));

afterEach(() => {
  resetApp();
  editor.props = null;
  editor.renders = 0;
});

const XLR_LITE = { id: "c2", name: "XLR", iconId: "xlr", svgUrl: null, color: "#6b7280" };

const PANEL = {
  id: "pn1",
  name: "Patch Plateau",
  heightU: 1,
  slotsPerU: 16,
  rearCableDepthMm: null,
  notes: null,
  createdById: "u1",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  slots: [
    {
      id: "s1",
      panelId: "pn1",
      position: 1,
      sizeSlots: 1,
      label: "Micro 1",
      notes: null,
      catalogConnectorTypeId: "c2",
      mountD: true,
      familyLabel: null,
      connectorTypeId: "c2",
      connectorType: XLR_LITE,
    },
    {
      id: "s2",
      panelId: "pn1",
      position: 2,
      sizeSlots: 1,
      label: null,
      notes: null,
      catalogConnectorTypeId: null,
      mountD: false,
      familyLabel: null,
      connectorTypeId: null,
      connectorType: null,
    },
  ],
};

function fn(id: string, key: string, label: string, color: string, sortOrder: number) {
  return { id, key, label, color, sortOrder, cablePrefix: null, cableSuffix: null, isActive: true };
}
const AUDIO = fn("f1", "AUDIO", "Audio", "#22c55e", 1);
const VIDEO = fn("f2", "VIDEO", "Vidéo", "#3b82f6", 2);
const INTERCOM = fn("f3", "INTERCOM", "Intercom", "#eab308", 3);

function connector(id: string, name: string, functions: ReturnType<typeof fn>[], d: { hasNeutrikD: boolean; dTypeSvgUrl: string | null }) {
  return {
    id,
    name,
    iconId: name.toLowerCase(),
    svgUrl: null,
    color: "#6b7280",
    isActive: true,
    functionIds: functions.map((f) => f.id),
    functions: functions.map((f) => ({ functionId: f.id, function: f })),
    ...d,
  };
}

// Ordre de l'API (par nom) ; fonctions dans l'ordre de `functionIds`, pas
// forcément par `sortOrder`.
const CONNECTORS = [
  connector("c1", "BNC", [VIDEO], { hasNeutrikD: true, dTypeSvgUrl: null }),
  connector("c3", "Powercon", [], { hasNeutrikD: false, dTypeSvgUrl: null }),
  connector("c2", "XLR", [INTERCOM, AUDIO], { hasNeutrikD: true, dTypeSvgUrl: "/uploads/symbols/xlr-d.svg" }),
];

function panelApi(perms: unknown = OWNER_PERMS, extra: Api = {}): Api {
  return {
    ...signedInApi(perms, "Régie A"),
    "GET /api/panels/pn1": { body: PANEL },
    "GET /api/tenant/catalogue/connectors": { body: CONNECTORS },
    "GET /api/tenant/parametres/categories": {
      body: {
        categories: { arkyo: [], personal: [] },
        functions: { arkyo: [], personal: [AUDIO, VIDEO, INTERCOM] },
        phases: { arkyo: [], personal: [] },
        types: { arkyo: [], personal: [] },
      },
    },
    ...extra,
  };
}

describe("/panels/:id", () => {
  test("loader_builds_editor_props_like_arkyo", async () => {
    const { fetchSpy } = renderApp("/panels/pn1", panelApi());
    expect(await screen.findByText("Éditeur de panel Patch Plateau", {}, { timeout: 5000 })).toBeInTheDocument();
    const props = editor.props!;

    // `panel` : tel que l'API le renvoie (slots par position, enrichis).
    expect(props.panel).toEqual(PANEL);

    // `availableConnectors` : chaque connecteur, ses dérivés Neutrik D, et
    // `category` (première fonction par sortOrder, sinon "OTHER") /
    // `categories` (toutes les fonctions par sortOrder, sinon ["OTHER"]).
    expect(props.availableConnectors).toEqual([
      { ...CONNECTORS[0], category: "Vidéo", categories: ["Vidéo"] },
      { ...CONNECTORS[1], category: "OTHER", categories: ["OTHER"] },
      { ...CONNECTORS[2], category: "Audio", categories: ["Audio", "Intercom"] },
    ]);
    const xlr = (props.availableConnectors as { id: string; hasNeutrikD: boolean; dTypeSvgUrl: string | null }[])[2];
    expect(xlr.hasNeutrikD).toBe(true);
    expect(xlr.dTypeSvgUrl).toBe("/uploads/symbols/xlr-d.svg");

    // `connectorCategories` : les fonctions (sortOrder, label) en `{ name, color, sortOrder }`.
    expect(props.connectorCategories).toEqual([
      { name: "Audio", color: "#22c55e", sortOrder: 1 },
      { name: "Vidéo", color: "#3b82f6", sortOrder: 2 },
      { name: "Intercom", color: "#eab308", sortOrder: 3 },
    ]);

    // Nom du site à la place du nom du tenant.
    expect(props.tenantName).toBe("Régie A");

    // Pas de temps réel en phase 3 (curseurs live : phase 7).
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("/api/realtime"))).toBe(false);
  });

  test("site sans nom : tenantName null, comme un tenant introuvable", async () => {
    renderApp("/panels/pn1", panelApi(OWNER_PERMS, { "GET /api/site": { body: { name: "" } } }));
    await screen.findByText("Éditeur de panel Patch Plateau", {}, { timeout: 5000 });
    expect(editor.props!.tenantName).toBeNull();
  });

  test("loader_error_state_retry", async () => {
    let fail = true;
    renderApp(
      "/panels/pn1",
      panelApi(OWNER_PERMS, {
        "GET /api/tenant/catalogue/connectors": () =>
          fail ? { status: 500, body: { error: "Erreur serveur" } } : { body: CONNECTORS },
      }),
    );
    expect(await screen.findByText("Erreur serveur", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(editor.renders).toBe(0);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Éditeur de panel Patch Plateau", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  test("panel inconnu : page 404 (notFound() d'arkyo)", async () => {
    renderApp("/panels/pn1", panelApi(OWNER_PERMS, { "GET /api/panels/pn1": { status: 404, body: { error: "Not found" } } }));
    expect(await screen.findByText("This page could not be found.", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  test("sans design:write, renvoie vers /dashboard comme arkyo", async () => {
    const { router } = renderApp("/panels/pn1", panelApi(TECH_PERMS));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"), { timeout: 5000 });
    expect(editor.renders).toBe(0);
  });
});
