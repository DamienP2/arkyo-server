/**
 * `/panels/:id` : éditeur de panel (arkyo:app/(fullscreen)/panels/[id]/panel-editor.tsx),
 * chargé par le vrai chargeur de la Task 11.
 *
 * Le glisser-déposer de `@dnd-kit/core` ne se rejoue pas dans happy-dom
 * (positions nulles) : on garde le vrai `DndContext` et on appelle ses
 * `onDragStart` / `onDragEnd` comme le ferait dnd-kit, avec les mêmes
 * données (`connector-<famille>-<id>` déposé sur `slot-<position>`).
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  OWNER_PERMS,
  emitAppEvent,
  renderApp,
  resetApp,
  sentBody,
  signedInApi,
  type Api,
} from "@/tests/app-harness";

const dnd = vi.hoisted(() => ({ props: null as null | Record<string, (e: unknown) => unknown> }));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...mod,
    DndContext: (props: Parameters<typeof mod.DndContext>[0]) => {
      dnd.props = props as unknown as Record<string, (e: unknown) => unknown>;
      return <mod.DndContext {...props} />;
    },
  };
});

afterEach(() => {
  resetApp();
  dnd.props = null;
});

// `connectorType` d'un slot : `CatalogConnectorTypeLite` (enrich::connector_type_map).
const XLR_LITE = {
  id: "c2",
  name: "XLR",
  versions: [],
  iconId: "xlr",
  color: "#6b7280",
  category: null,
  hasNeutrikD: true,
  dTypeSvgUrl: null,
};

function slot(id: string, position: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    panelId: "pn1",
    position,
    sizeSlots: 1,
    label: null,
    notes: null,
    catalogConnectorTypeId: "c2",
    mountD: false,
    familyLabel: "Audio",
    connectorTypeId: "c2",
    connectorType: XLR_LITE,
    ...extra,
  };
}

const PANEL = {
  id: "pn1",
  name: "PATCH PLATEAU",
  panelType: "PATCH",
  heightU: 1,
  slotsPerU: 16,
  rearCableDepthMm: 80,
  notes: null,
  private: false,
  createdById: "u1",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  slots: [slot("s1", 1)],
};

const AUDIO = { id: "f1", key: "AUDIO", label: "Audio", color: "#22c55e", sortOrder: 1, isActive: true };

const CONNECTORS = [
  {
    id: "c2",
    name: "XLR",
    iconId: "xlr",
    svgUrl: null,
    color: "#6b7280",
    isActive: true,
    functionIds: ["f1"],
    functions: [{ functionId: "f1", function: AUDIO }],
    hasNeutrikD: true,
    dTypeSvgUrl: null,
  },
];

function editorApi(extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A"),
    "GET /api/panels/pn1": { body: PANEL },
    "GET /api/tenant/catalogue/connectors": { body: CONNECTORS },
    "GET /api/tenant/parametres/categories": {
      body: { functions: { arkyo: [], personal: [AUDIO] } },
    },
    ...extra,
  };
}

async function openEditor(extra: Api = {}) {
  const r = renderApp("/panels/pn1", editorApi(extra));
  // Nom du panel dans la topbar (et dans le champ du panneau de propriétés).
  expect(await screen.findByText("PATCH PLATEAU", {}, { timeout: 5000 })).toBeInTheDocument();
  return r;
}

const DRAG_XLR = {
  id: "connector-Audio-c2",
  data: { current: { type: "connector", connectorId: "c2", familyLabel: "Audio" } },
};

/** Glisse le XLR de la palette (groupe Audio) sur le slot `position`. */
async function dropXlrOn(position: number) {
  await act(async () => {
    dnd.props!.onDragStart({ active: DRAG_XLR });
  });
  await act(async () => {
    await dnd.props!.onDragEnd({ active: DRAG_XLR, over: { id: `slot-${position}` } });
  });
  expect(await screen.findByText(`Depuis le slot ${position}`)).toBeInTheDocument();
}

const calls = (spy: ReturnType<typeof renderApp>["fetchSpy"], method: string, path: string) =>
  spy.mock.calls.filter(
    ([u, init]) => String(u).split("?")[0] === path && (init?.method ?? "GET").toUpperCase() === method,
  ).length;

// Premier rendu de l'éditeur (2 970 lignes, dnd-kit) : plus long que les 5 s par défaut.
describe("/panels/:id : éditeur de panel", { timeout: 20000 }, () => {
  test("topbar : lockup Strata Arkyo puis le nom du site, lien vers /dashboard", async () => {
    await openEditor();
    const lockup = document.querySelector('a[href="/dashboard"]')!;
    expect(lockup.textContent).toBe("StrataArkyo|Régie A");
    expect(lockup.getAttribute("title")).toBe("Espace Régie A");
    expect(document.body.textContent).not.toMatch(/arkyo\.io/);
    // Disposition d'arkyo : occupation, puis outils et palette.
    expect(screen.getByText("1 / 16")).toBeInTheDocument();
    expect(screen.getByText("XLR", { selector: "p" })).toBeInTheDocument();
  });

  test("place_connector_posts_slot", async () => {
    const { fetchSpy } = await openEditor({
      "POST /api/panels/pn1/slots": { status: 201, body: slot("s3", 3) },
    });
    await dropXlrOn(3);
    fireEvent.click(screen.getByRole("button", { name: "Placer le connecteur" }));

    await waitFor(() => expect(screen.getByText("2 / 16")).toBeInTheDocument());
    expect(sentBody(fetchSpy, "POST", "/api/panels/pn1/slots")).toEqual({
      position: 3,
      connectorTypeId: "c2",
      sizeSlots: 1,
      mountD: false,
      familyLabel: "Audio",
    });
    expect(screen.getByText("Enregistré")).toBeInTheDocument();
    expect(screen.queryByText("Depuis le slot 3")).toBeNull();
  });

  test("rename_panel_patches", async () => {
    const { fetchSpy } = await openEditor({
      "PATCH /api/panels/pn1": { body: { ...PANEL, name: "PATCH SCÈNE" } },
    });
    const input = screen.getByDisplayValue("PATCH PLATEAU");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "patch scène" } });
    fireEvent.blur(input);

    await waitFor(() => expect(sentBody(fetchSpy, "PATCH", "/api/panels/pn1")).toEqual({ name: "PATCH SCÈNE" }));
    // Topbar mise à jour ; le seul nom ne vide pas le panel.
    expect(await screen.findByText("PATCH SCÈNE")).toBeInTheDocument();
    expect(screen.getByText("1 / 16")).toBeInTheDocument();
  });

  test("resize_warns_and_clears_slots", async () => {
    const { fetchSpy } = await openEditor({
      "PATCH /api/panels/pn1": { body: { ...PANEL, heightU: 2, slots: [] } },
    });
    // Accordéon « Hauteur » puis le préréglage 2U.
    fireEvent.click(screen.getByText("Hauteur"));
    fireEvent.click(screen.getByRole("button", { name: "2U" }));

    // Comme arkyo : pas de confirmation bloquante (panel-editor.tsx:857-859),
    // un PATCH après la temporisation de 400 ms, puis le panel est vidé.
    expect(screen.queryByText("Le panneau sera vidé")).toBeNull();
    await waitFor(() => expect(sentBody(fetchSpy, "PATCH", "/api/panels/pn1")).toEqual({ heightU: 2 }), {
      timeout: 2000,
    });
    expect(await screen.findByText("0 / 32")).toBeInTheDocument();
    expect(screen.getByText("Enregistré")).toBeInTheDocument();
    expect(calls(fetchSpy, "PATCH", "/api/panels/pn1")).toBe(1);
  });

  test("neutrik_d_error_is_shown", async () => {
    const msg = "Ce connecteur n'existe pas en version Neutrik D.";
    const { fetchSpy } = await openEditor({
      "POST /api/panels/pn1/slots": { status: 400, body: { error: msg } },
      "PATCH /api/panels/pn1/slots/s1": { status: 400, body: { error: msg } },
    });

    // Pose en coque D refusée par le serveur : badge « Échec », rien n'est posé.
    await dropXlrOn(2);
    fireEvent.click(screen.getByRole("button", { name: "Neutrik D" }));
    fireEvent.click(screen.getByRole("button", { name: "Placer le connecteur" }));
    expect(await screen.findByText("Échec")).toBeInTheDocument();
    expect(sentBody(fetchSpy, "POST", "/api/panels/pn1/slots")).toMatchObject({ position: 2, mountD: true });
    expect(screen.getByText("1 / 16")).toBeInTheDocument();

    // Bascule D d'un slot posé refusée : retour arrière optimiste et « Échec ».
    fireEvent.click(document.querySelector(".group.cursor-grab")!);
    const toggle = screen.getByText("Pose en Neutrik D");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PATCH", "/api/panels/pn1/slots/s1")).toEqual({ mountD: true }),
    );
    await waitFor(() => expect(screen.getByText("Échec")).toBeInTheDocument());
    // Slot revenu en générique : contour circulaire.
    await waitFor(() =>
      expect((document.querySelector(".group.cursor-grab") as HTMLElement).style.borderRadius).toBe("50%"),
    );
  });

  test("sse_update_refreshes", async () => {
    let current = PANEL;
    const { fetchSpy } = await openEditor({ "GET /api/panels/pn1": () => ({ body: current }) });
    const before = calls(fetchSpy, "GET", "/api/panels/pn1");

    // ping / connected : ignorés.
    act(() => {
      emitAppEvent({ type: "ping" });
      emitAppEvent({ type: "connected" });
    });
    expect(calls(fetchSpy, "GET", "/api/panels/pn1")).toBe(before);

    // Un autre poste pose un connecteur : `panel_slot create <panelId>`.
    current = { ...PANEL, slots: [slot("s1", 1), slot("s5", 5)] };
    act(() => emitAppEvent({ type: "update", entity: "panel_slot", action: "create", id: "pn1" }));
    expect(await screen.findByText("2 / 16")).toBeInTheDocument();
    // Deux lectures, comme arkyo : celle de l'éditeur, et celle de la page
    // (`<AppSync>` → `router.refresh()`, rechargement silencieux de `ClientPage`).
    await waitFor(() => expect(calls(fetchSpy, "GET", "/api/panels/pn1")).toBe(before + 2));
  });
});
