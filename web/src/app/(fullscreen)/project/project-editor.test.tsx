/**
 * Coquille de l'éditeur projet (arkyo:app/(fullscreen)/project/[id]/
 * _components/project-editor.tsx, `_editor/*`) : onglets (`?tab=` et
 * `localStorage`), dialogue « Caractéristiques », statut, topbar en habillage
 * Strata, et onglets des phases 5 et 6 en bouchon « Bientôt disponible »
 * (l'onglet Synoptique, 4c, est la copie d'arkyo : `synoptique-tab.test.tsx`).
 *
 * La copie d'arkyo est rendue telle quelle par le chargeur réel
 * (`/project/:id`, `GET /api/tenant/projects/:id/editor`).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, renderApp, resetApp, sentBody, signedInApi, type Api } from "@/tests/app-harness";

/**
 * Attente du premier montage : l'éditeur projet et l'inventaire (≈ 8 000 l.)
 * sont transformés à la demande par Vite ; sous charge CPU (cargo en
 * parallèle, runner de CI), cela dépasse 5 s.
 */
const FIRST_LOAD = { timeout: 15000 };

const HEADER = {
  id: "p1",
  name: "Finale Coupe de France",
  status: "EN_PREPARATION",
  interventionType: "PRESTATION",
  rigType: "CAR",
  clientName: "France TV",
  shootingDate: "2026-11-20T00:00:00.000Z",
  location: "Stade de France",
  prestationType: null,
};

/** `ProjectEditorData` tel que la route `editor` le renvoie (un lieu, une baie rackable vide). */
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

function editorApi(extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A"),
    "GET /api/tenant/projects/p1/editor": { body: EDITOR },
    ...extra,
  };
}

/** Ouvre l'éditeur à `url` et attend la coquille. */
async function open(url: string, extra: Api = {}) {
  const app = renderApp(url, editorApi(extra));
  await screen.findByText("Finale Coupe de France", {}, FIRST_LOAD);
  return app;
}

const here = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

/** Topbar globale (premier enfant de l'`EditorShell`, 44 px). */
function topbar(): HTMLElement {
  const shell = document.querySelector("div.fixed.z-50") as HTMLElement;
  return shell.firstElementChild as HTMLElement;
}

/**
 * Bouton de la topbar globale. Requête à chaque appel : changer d'onglet peut
 * remonter la coquille (Inventaire, Rack et les dessins ont chacun la leur).
 */
const topbarButton = (name: string | RegExp) => within(topbar()).getByRole("button", { name });

/** Ouvre un menu Radix (le déclencheur s'ouvre au clavier dans happy-dom). */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

/**
 * Ferme le menu Radix ouvert. Le menu de statut d'arkyo reste ouvert après un
 * choix (`e.preventDefault()` dans `onSelect`) et masque le reste de la page
 * aux technologies d'assistance tant qu'il est ouvert.
 */
function closeMenu() {
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("éditeur projet : coquille", () => {
  test("tabs_navigate_and_persist", async () => {
    const { router, unmount } = await open("/project/p1");
    // Sans `?tab=` ni stockage : onglet Inventaire, inscrit dans l'URL.
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=inventaire"));

    // Clic sur un onglet : URL (`replace`) et `localStorage["project-editor-tab"]`.
    fireEvent.click(topbarButton("Rack"));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=rack"));
    expect(window.localStorage.getItem("project-editor-tab")).toBe('"rack"');
    // Onglet Rack : premier contenant rackable sélectionné dans la sous-topbar.
    // (Le nom figure aussi dans le panneau droit, `RackInfoPanel`.)
    expect(await screen.findByRole("button", { name: /Baie 1/ })).toBeInTheDocument();

    // Groupe « Livraison » : ses items sont de vrais onglets.
    fireEvent.click(topbarButton("Livraison"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Recette" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=recette"));
    expect(window.localStorage.getItem("project-editor-tab")).toBe('"recette"');

    // Sous-onglets : Lumière (stockage propre), Réseau (store zustand persisté).
    fireEvent.click(topbarButton("Lumière"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Adressage DMX" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=lumiere"));
    expect(window.localStorage.getItem("project-lumiere-subtab")).toBe('"dmx"');
    expect(topbarButton(/Lumière · Adressage DMX/)).toBeInTheDocument();

    fireEvent.click(topbarButton(/Réseau/));
    fireEvent.click(screen.getByRole("menuitem", { name: "Adressage IP" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=reseau"));
    expect(JSON.parse(window.localStorage.getItem("reseau-store")!).state.activeSection).toBe("devices");

    // Retour à l'Inventaire : raccourci « P » → outil Panels, mémorisé par projet.
    fireEvent.click(topbarButton("Inventaire"));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=inventaire"));
    act(() => {
      fireEvent.keyDown(window, { key: "p" });
    });
    // Panneau latéral de l'outil (titre et consigne), en plus de la sous-topbar.
    expect(await screen.findByText("Glissez un panel vers un contenant.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Panels" })).toBeInTheDocument();
    expect(window.localStorage.getItem("inventaire-active-tool:p1")).toBe('"panel"');
    unmount();
    vi.restoreAllMocks();

    // `?tab=` prime sur le stockage.
    window.localStorage.setItem("project-editor-tab", '"rack"');
    const second = await open("/project/p1?tab=synoptique", {
      "GET /api/tenant/projects/p1/synoptic/general": {
        body: {
          locations: [],
          racks: [],
          connections: [],
          bundles: [],
          connectorTypes: [],
          signals: [],
          signalCategories: [],
          appConfig: {},
          project: { id: "p1", name: "Finale Coupe de France" },
        },
      },
    });
    expect(here(second.router)).toBe("/project/p1?tab=synoptique");
    // Onglet Synoptique (copie d'arkyo, 4c) : sélecteur de vue sur « Général ».
    expect(await screen.findByRole("button", { name: /Général/ })).toBeInTheDocument();
    second.unmount();
    vi.restoreAllMocks();

    // Sans `?tab=`, comme arkyo : l'effet qui inscrit l'onglet dans l'URL
    // s'exécute au montage avant la relecture du `localStorage`
    // (`useLocalStorageState` hydrate dans un effet) : l'URL prend
    // l'onglet par défaut, qui l'emporte ensuite sur le stockage.
    const third = await open("/project/p1");
    await waitFor(() => expect(here(third.router)).toBe("/project/p1?tab=inventaire"));
  });

  test("tab_fiche_maps_to_inventaire", async () => {
    for (const [from, to] of [
      // L'onglet Fiche a disparu : la fiche est le panneau droit.
      ["fiche", "inventaire"],
      // Anciens noms de l'onglet Préparation.
      ["cablage", "preparation"],
      ["construction", "preparation"],
      // Inconnu : onglet par défaut.
      ["inconnu", "inventaire"],
    ]) {
      const { router, unmount } = await open(`/project/p1?tab=${from}`);
      await waitFor(() => expect(here(router)).toBe(`/project/p1?tab=${to}`));
      unmount();
      vi.restoreAllMocks();
    }
  });

  test("fiche_dialog_patches_project", async () => {
    let editorReads = 0;
    const { fetchSpy } = await open("/project/p1?tab=inventaire", {
      "GET /api/tenant/projects/p1/editor": () => {
        editorReads += 1;
        return { body: EDITOR };
      },
      "PATCH /api/tenant/projects/p1": { body: { ...EDITOR.fiche, clientName: "TF1" } },
    });
    expect(editorReads).toBe(1);

    fireEvent.click(topbarButton("Modifier les caractéristiques du projet"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Modifier « Finale Coupe de France »")).toBeInTheDocument();
    // Prestation : dates de tournage, pas de mise en service.
    expect(within(dialog).getByText("Début de tournage")).toBeInTheDocument();
    expect(within(dialog).queryByText("Mise en service")).toBeNull();

    fireEvent.change(within(dialog).getByPlaceholderText("Nom du client"), { target: { value: "TF1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sentBody(fetchSpy, "PATCH", "/api/tenant/projects/p1")).toEqual({
      name: "Finale Coupe de France",
      prestationType: null,
      location: "Stade de France",
      clientName: "TF1",
      planningStart: null,
      planningEnd: null,
      description: null,
      shootingDate: "2026-11-20T00:00:00.000Z",
      shootingEndDate: null,
    });
    // Badge de la sous-topbar, puis `router.refresh()` : la route `editor` est relue.
    expect(await screen.findByText("Enregistré")).toBeInTheDocument();
    await waitFor(() => expect(editorReads).toBe(2));
  });

  test("status_change_patches", async () => {
    let fail = false;
    // happy-dom n'a pas de `window.alert` (arkyo l'appelle en cas d'échec).
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    const { fetchSpy } = await open("/project/p1?tab=inventaire", {
      "PATCH /api/tenant/projects/p1": () =>
        fail ? { status: 500, body: { error: "Erreur serveur" } } : { body: { ...EDITOR.fiche, status: "PRET" } },
    });

    openMenu(topbarButton("Statut : En préparation — modifier"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Prêt" }));
    closeMenu();
    expect(await within(topbar()).findByRole("button", { name: "Statut : Prêt — modifier" })).toBeInTheDocument();
    expect(sentBody(fetchSpy, "PATCH", "/api/tenant/projects/p1")).toEqual({ status: "PRET" });
    expect(await screen.findByText("Enregistré")).toBeInTheDocument();

    // Statut courant : pas de requête.
    const calls = () => fetchSpy.mock.calls.filter(([, init]) => init?.method === "PATCH").length;
    openMenu(topbarButton("Statut : Prêt — modifier"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Prêt" }));
    expect(calls()).toBe(1);
    closeMenu();

    // Échec : retour au statut précédent, alerte avec le message de l'API, badge « Échec ».
    fail = true;
    openMenu(topbarButton("Statut : Prêt — modifier"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Annulé" }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Erreur serveur"));
    closeMenu();
    expect(topbarButton("Statut : Prêt — modifier")).toBeInTheDocument();
    expect(await screen.findByText("Échec")).toBeInTheDocument();
    expect(calls()).toBe(2);
  });

  test("phase5_6_tabs_show_coming_soon", async () => {
    // Phases 5-6 aux chemins d'arkyo. Les onglets Rack (4b) et Synoptique
    // (4c) sont les copies d'arkyo (`rack-tab.test.tsx`, `synoptique-tab.test.tsx`).
    for (const tab of [
      "schema",
      "video",
      "audio",
      "lumiere",
      "cartographie",
      "reseau",
      "preparation",
      "recette",
    ]) {
      const { router, fetchSpy, unmount } = await open(`/project/p1?tab=${tab}`);
      expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
      expect(here(router)).toBe(`/project/p1?tab=${tab}`);
      // La coquille reste celle d'arkyo : topbar globale et onglets.
      expect(topbarButton("Inventaire")).toBeInTheDocument();
      // Aucun appel aux routes des phases suivantes.
      const paths = fetchSpy.mock.calls.map(([u]) => String(u));
      expect(
        paths.filter((u) => /drawings|carto|reseau|network|recette|cabling|canvas-data|synoptic|dmx/.test(u)),
      ).toEqual([]);
      unmount();
      vi.restoreAllMocks();
    }
  });

  test("le bouton « Exporter un dossier » ouvre le bouchon du dossier (phase 6)", async () => {
    await open("/project/p1?tab=inventaire");
    fireEvent.click(topbarButton(/Exporter un dossier/));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Bientôt disponible")).toBeInTheDocument();
  });

  test("topbar en habillage Strata : StrataBrand suivi du nom du site", async () => {
    const { router } = await open("/project/p1?tab=inventaire");
    const bar = topbar();
    const lockup = within(bar).getByRole("link");
    expect(lockup).toHaveAttribute("href", "/dashboard");
    expect(lockup).toHaveAttribute("title", "Espace Régie A");
    expect(within(lockup).getByLabelText("Strata Arkyo")).toBeInTheDocument();
    expect(within(lockup).getByText("Régie A")).toBeInTheDocument();
    expect(bar.textContent).not.toMatch(/arkyo\.io/);
    expect(bar.querySelector("svg[viewBox='0 0 100 100']")).toBeNull();

    // Croix : retour à la liste des projets.
    fireEvent.click(topbarButton("Fermer l'édition"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
  });
});
