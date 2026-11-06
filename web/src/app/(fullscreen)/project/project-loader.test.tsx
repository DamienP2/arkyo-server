/**
 * `/project/:id` : chargeur de l'éditeur projet
 * (arkyo:app/(fullscreen)/project/[id]/{layout,page}.tsx). Le layout garde
 * `projects:read` et monte `ConfirmProvider` ; la page lit
 * `GET /api/tenant/projects/:id/editor` (exactement `ProjectEditorData`) et le
 * nom du site (`/api/site`, à la place du nom du tenant), puis rend
 * `<ProjectEditor project tenantName>` dans la coquille (`EditorShell`).
 *
 * `ProjectEditor` est espionné (le vrai module est rendu) : on vérifie les
 * props qu'il reçoit et la coquille qu'il monte.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { OWNER_PERMS, TECH_PERMS, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";

const editor = vi.hoisted(() => ({ props: null as null | Record<string, unknown>, renders: 0 }));

vi.mock("@/app/(fullscreen)/project/[id]/_components/project-editor", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/app/(fullscreen)/project/[id]/_components/project-editor")>();
  return {
    ...mod,
    ProjectEditor: (props: Parameters<typeof mod.ProjectEditor>[0]) => {
      editor.props = props as unknown as Record<string, unknown>;
      editor.renders += 1;
      return <mod.ProjectEditor {...props} />;
    },
  };
});

afterEach(() => {
  resetApp();
  editor.props = null;
  editor.renders = 0;
});

const HEADER = {
  id: "p1",
  name: "Finale Coupe de France",
  status: "PREPARATION",
  interventionType: "EVENEMENT",
  rigType: "CAR_REGIE",
  clientName: "France TV",
  shootingDate: "2026-11-20T00:00:00.000Z",
  location: "Stade de France",
  prestationType: null,
};

/** `ProjectEditorData` tel que la route `editor` le renvoie (un lieu, un contenant vide). */
const EDITOR = {
  header: HEADER,
  fiche: {
    ...HEADER,
    shootingEndDate: null,
    planningStart: null,
    planningEnd: null,
    commissioningDate: null,
    description: null,
    documents: [],
    counts: { tasks: 0, messages: 0, documents: 0 },
  },
  inventaire: {
    rigConfigId: "rc1",
    racks: [
      {
        id: "r1",
        rigConfigId: "rc1",
        name: "Baie 1",
        rackType: "STANDARD",
        totalU: 42,
        depthMm: 600,
        widthMm: null,
        heightMm: null,
        hasWheels: false,
        emptyWeightKg: null,
        slotsCount: 0,
        constructionChecks: 0,
        isRackable: true,
        hasConnectors: false,
        canvasX: null,
        canvasY: null,
        locationId: "l1",
        isVirtual: false,
        slots: [],
        bom: [],
      },
    ],
    locations: [{ id: "l1", name: "Régie", cableCode: null, sortOrder: 0, virtualRackId: null }],
  },
  cartographie: { maps: [] },
};

function projectApi(perms: unknown = OWNER_PERMS, extra: Api = {}): Api {
  return {
    ...signedInApi(perms, "Régie A"),
    "GET /api/tenant/projects/p1/editor": { body: EDITOR },
    ...extra,
  };
}

const NO_PROJECTS = {
  ...TECH_PERMS,
  roleKey: "aucun",
  permissions: { ...TECH_PERMS.permissions, projects: "none" },
};

describe("/project/:id", () => {
  test("editor_loader_renders_shell", async () => {
    const { fetchSpy } = renderApp("/project/p1", projectApi());
    expect(await screen.findByText("Finale Coupe de France", {}, { timeout: 5000 })).toBeInTheDocument();

    // Props d'arkyo : `project` = la route `editor` telle quelle, nom du site
    // à la place du nom du tenant.
    expect(editor.props!.project).toEqual(EDITOR);
    expect(editor.props!.tenantName).toBe("Régie A");

    // Coquille plein écran (`EditorShell` : overlay fixe, topbar globale de 44 px),
    // sans la sidebar ni la topbar de l'application.
    const shell = document.querySelector("div.fixed.z-50") as HTMLElement;
    expect(shell).not.toBeNull();
    expect((shell.firstElementChild as HTMLElement).style.height).toBe("44px");
    expect(document.querySelector("aside")).toBeNull();
    expect(document.querySelector("header")).toBeNull();

    // Une seule lecture de la route `editor`, par son chemin d'arkyo-server.
    const editorCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes("/editor"));
    expect(editorCalls.map(([u]) => String(u))).toEqual(["/api/tenant/projects/p1/editor"]);
  });

  test("site sans nom : tenantName null, comme un tenant introuvable", async () => {
    renderApp("/project/p1", projectApi(OWNER_PERMS, { "GET /api/site": { body: { name: "" } } }));
    await screen.findByText("Finale Coupe de France", {}, { timeout: 5000 });
    expect(editor.props!.tenantName).toBeNull();
  });

  test("editor_loader_error_retry", async () => {
    let fail = true;
    renderApp(
      "/project/p1",
      projectApi(OWNER_PERMS, {
        "GET /api/tenant/projects/p1/editor": () =>
          fail ? { status: 500, body: { error: "Erreur serveur" } } : { body: EDITOR },
      }),
    );
    expect(await screen.findByText("Erreur serveur", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(editor.renders).toBe(0);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Finale Coupe de France", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(editor.props!.project).toEqual(EDITOR);
  });

  test("projet inconnu : page 404 (notFound() d'arkyo)", async () => {
    renderApp(
      "/project/p1",
      projectApi(OWNER_PERMS, { "GET /api/tenant/projects/p1/editor": { status: 404, body: { error: "Not found" } } }),
    );
    expect(await screen.findByText("This page could not be found.", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  test("sans projects:read, le layout renvoie vers /dashboard, sous-routes comprises", async () => {
    for (const url of ["/project/p1", "/project/p1/inventaire/synoptique"]) {
      const { router, fetchSpy, unmount } = renderApp(url, projectApi(NO_PROJECTS));
      await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"), { timeout: 5000 });
      expect(editor.renders).toBe(0);
      expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("/editor"))).toBe(false);
      unmount();
      vi.restoreAllMocks();
    }
  });

  test("les sous-routes pas encore portées restent « Bientôt disponible » avec « Retour »", async () => {
    for (const url of ["/project/p1/inventaire/rack/r1", "/project/p1/inventaire/synoptique", "/project/p1/cartographie"]) {
      const { router, fetchSpy, unmount } = renderApp(url, projectApi(TECH_PERMS));
      expect(await screen.findByText("Bientôt disponible", {}, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Retour" })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(url);
      expect(fetchSpy.mock.calls.some(([u]) => String(u).includes("/editor"))).toBe(false);
      unmount();
      vi.restoreAllMocks();
    }
  });
});
