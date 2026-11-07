/**
 * Éditeur projet en docks (interface Strata) : `EditorShell` délègue sa
 * disposition à `StrataEditorShell` et `ProjectGlobalTopbar` rend
 * `StrataProjectTopbar` (mêmes slots, mêmes props). En Classique, rien ne
 * change.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";
import { EditorShell, type EditorShellSlots } from "@/components/editor-shell/editor-shell";
import { WorkspaceProvider } from "@/components/editor-shell/workspace-context";
import { InterfaceProvider, type UiInterface } from "@/strata/interface-context";
import { CONCEPTION_LENSES } from "@/strata/shell/strata-project-topbar";

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

/** `ProjectEditorData` (un lieu, une baie rackable vide), comme `project-editor.test.tsx`. */
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

function editorApi(iface: UiInterface): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A", iface),
    "GET /api/tenant/projects/p1/editor": { body: EDITOR },
  };
}

const here = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

/** Ouvre l'éditeur en Strata et attend la topbar Strata. */
async function openStrata(url: string) {
  const app = renderApp(url, editorApi("strata"));
  await screen.findByRole("navigation", { name: "Onglets du projet" }, FIRST_LOAD);
  return app;
}

const projectNav = () => screen.getByRole("navigation", { name: "Onglets du projet" });
const lensBar = () => screen.getByRole("navigation", { name: "Lentilles" });
const dock = (name: string) => document.querySelector(`[data-dock="${name}"]`) as HTMLElement | null;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  resetApp();
  window.localStorage.clear();
  delete document.documentElement.dataset.interface;
});

function Shell({ iface, ...slots }: EditorShellSlots & { iface: UiInterface }) {
  return (
    <InterfaceProvider value={iface}>
      <WorkspaceProvider workspace="design">
        <EditorShell {...slots} />
      </WorkspaceProvider>
    </InterfaceProvider>
  );
}

const slot = (label: string): ReactNode => <div>{label}</div>;

/** DOM d'`EditorShell` relevé sur `main` (avant l'accroche Strata), mêmes slots. */
const CLASSIC_DOM =
  '<div class="bg-background text-foreground fixed right-0 bottom-0 left-0 z-50 flex flex-col overflow-hidden" style="top: calc(var(--dev-banner-height) + var(--impersonation-banner-height, 0px));">' +
  '<div style="height: 44px;" class="border-border flex-none border-b"><div>topbar</div></div>' +
  '<div style="height: 44px;" class="border-border bg-card flex-none border-b"><div>contextuelle</div></div>' +
  '<div class="flex flex-1 overflow-hidden">' +
  '<div style="width: 48px;" class="border-border bg-card flex-none border-r"><div>outils</div></div>' +
  '<div style="width: 280px;" class="border-border bg-card flex-none border-r"><div>panneau</div></div>' +
  '<div class="relative flex-1 overflow-hidden"><div>canevas</div></div>' +
  '<div style="width: 300px;" class="border-border bg-background flex-none border-l"><div>inspecteur</div></div>' +
  "</div></div>";

describe("EditorShell en Classique", () => {
  test("en classique, EditorShell est inchangé", () => {
    const { container } = render(
      <Shell
        iface="classique"
        globalTopbar={slot("topbar")}
        contextualTopbar={slot("contextuelle")}
        leftToolbar={slot("outils")}
        leftSidePanel={slot("panneau")}
        canvas={slot("canevas")}
        rightPanel={slot("inspecteur")}
        slideOver={slot("volet")}
        globalTopbarHeight={44}
        strata={{ leftDockTabs: [{ id: "a", label: "A", node: slot("onglet A") }], bottomDock: slot("dock bas") }}
      />,
    );
    // DOM d'`EditorShell` sur `main` (avant l'accroche Strata) ; le champ
    // `strata` est ignoré.
    expect(container.innerHTML).toBe(CLASSIC_DOM);
  });
});

describe("StrataEditorShell", () => {
  test("rend les docks à partir des slots d'EditorShell", () => {
    render(
      <Shell
        iface="strata"
        globalTopbar={slot("topbar")}
        contextualTopbar={slot("contextuelle")}
        leftToolbar={slot("outils")}
        leftSidePanel={slot("panneau")}
        canvas={slot("canevas")}
        rightPanel={slot("inspecteur")}
        globalTopbarHeight={44}
      />,
    );
    const shell = document.querySelector("[data-strata-editor]") as HTMLElement;
    // Même boîte fixe et même décalage haut qu'`EditorShell`.
    expect(shell.className).toMatch(/\bfixed\b/);
    expect(shell.style.top).toBe("calc(var(--dev-banner-height) + var(--impersonation-banner-height, 0px))");
    expect(within(dock("topbar")!).getByText("topbar")).toBeInTheDocument();
    const left = dock("left")!;
    expect(left).toBe(screen.getByRole("complementary", { name: "Dock gauche" }));
    expect(within(left).getByText("outils")).toBeInTheDocument();
    expect(within(left).getByText("panneau")).toBeInTheDocument();
    const center = dock("center")!;
    expect(center).toBe(screen.getByRole("main"));
    // Barre contextuelle au-dessus du canevas.
    const ctx = within(center).getByText("contextuelle");
    const canvas = within(center).getByText("canevas");
    expect(ctx.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const right = dock("right")!;
    expect(right).toBe(screen.getByRole("complementary", { name: "Inspecteur" }));
    expect(right.style.width).toBe("300px");
    // Pas de dock bas sans `bottomDock`.
    expect(dock("bottom")).toBeNull();
  });

  test("un slot null ne réserve pas de largeur", () => {
    render(
      <Shell
        iface="strata"
        globalTopbar={slot("topbar")}
        contextualTopbar={null}
        leftToolbar={null}
        leftSidePanel={null}
        canvas={slot("canevas")}
        rightPanel={null}
      />,
    );
    expect(dock("left")).toBeNull();
    expect(dock("right")).toBeNull();
    expect(dock("contextual")).toBeNull();
    expect(dock("center")).not.toBeNull();
  });

  test("onglets du dock gauche et dock bas repliable (champ strata)", () => {
    render(
      <Shell
        iface="strata"
        globalTopbar={slot("topbar")}
        leftSidePanel={slot("panneau existant")}
        canvas={slot("canevas")}
        strata={{
          leftDockTabs: [
            { id: "projet", label: "Projet", node: slot("arbre") },
            { id: "bibliotheque", label: "Bibliothèque", node: slot("catalogue") },
          ],
          bottomDock: slot("contrôles"),
        }}
      />,
    );
    const left = dock("left")!;
    // Les onglets remplacent le panneau latéral.
    expect(within(left).queryByText("panneau existant")).toBeNull();
    expect(within(left).getByRole("tab", { name: "Projet" })).toHaveAttribute("aria-selected", "true");
    expect(within(left).getByText("arbre")).toBeInTheDocument();
    fireEvent.click(within(left).getByRole("tab", { name: "Bibliothèque" }));
    expect(within(left).getByText("catalogue")).toBeInTheDocument();
    expect(within(left).queryByText("arbre")).toBeNull();

    const bottom = dock("bottom")!;
    expect(within(bottom).getByText("contrôles")).toBeInTheDocument();
  });

  test("BottomDock se replie et s'en souvient", async () => {
    const { BottomDock } = await import("@/strata/shell/bottom-dock");
    const { unmount } = render(
      <BottomDock tabs={[{ id: "controles", label: "Contrôles", node: slot("liste des contrôles") }]} />,
    );
    expect(screen.getByText("liste des contrôles")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Replier le dock" }));
    expect(screen.queryByText("liste des contrôles")).toBeNull();
    unmount();
    render(<BottomDock tabs={[{ id: "controles", label: "Contrôles", node: slot("liste des contrôles") }]} />);
    expect(screen.queryByText("liste des contrôles")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Déplier le dock" }));
    expect(screen.getByText("liste des contrôles")).toBeInTheDocument();
  });
});

describe("éditeur projet en Strata", () => {
  test("en strata, l'éditeur rend topbar, dock gauche, canevas, inspecteur", async () => {
    await openStrata("/project/p1?tab=inventaire");
    const bar = dock("topbar")!;
    expect(within(bar).getByRole("banner")).toBeInTheDocument();
    expect(within(bar).getByLabelText("Strata Arkyo")).toBeInTheDocument();
    expect(within(bar).getByText("Finale Coupe de France")).toBeInTheDocument();
    // Statut : même commande que la topbar Classique.
    expect(within(bar).getByRole("button", { name: "Statut : En préparation — modifier" })).toBeInTheDocument();
    // Onglets segmentés à la place de la pill d'arkyo.
    const nav = projectNav();
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Conception",
      "Inventaire",
      "Livraison",
    ]);
    expect(within(nav).getByRole("link", { name: "Inventaire" })).toHaveAttribute("aria-current", "page");
    // Inventaire : barre d'outils et panneau à gauche, inspecteur à droite.
    expect(dock("left")).not.toBeNull();
    expect(await within(dock("left")!).findByRole("heading", { name: "Équipements" }, FIRST_LOAD)).toBeInTheDocument();
    expect(screen.getByRole("main")).toBe(dock("center"));
    expect(dock("right")).not.toBeNull();
    // Pas de barre de lentilles hors Conception.
    expect(screen.queryByRole("navigation", { name: "Lentilles" })).toBeNull();
  });

  test("Conception affiche les huit lentilles et garde ?tab=", async () => {
    expect(CONCEPTION_LENSES).toEqual(["rack", "synoptique", "schema", "cartographie", "video", "audio", "lumiere", "reseau"]);
    const { router } = await openStrata("/project/p1?tab=schema");
    expect(within(projectNav()).getByRole("link", { name: "Conception" })).toHaveAttribute("aria-current", "page");
    const lenses = await waitFor(() => lensBar());
    // Plus Connectique, lentille propre à Strata (onglet `rack`, `?lens=connectique`).
    expect(within(lenses).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Rack",
      "Connectique",
      "Synoptique",
      "Schémas",
      "Plan",
      "Vidéo",
      "Audio",
      "Lumière",
      "Réseau",
    ]);
    expect(within(lenses).getByRole("link", { name: "Schémas" })).toHaveAttribute("aria-current", "page");
    // La barre de lentilles est dans la colonne centrale.
    expect(dock("center")!.contains(lenses)).toBe(true);

    fireEvent.click(within(lenses).getByRole("link", { name: "Synoptique" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=synoptique"));
    expect(window.localStorage.getItem("project-editor-tab")).toBe('"synoptique"');

    // Sous-onglets existants de Lumière.
    fireEvent.click(within(lensBar()).getByRole("link", { name: "Lumière" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=lumiere"));
    const sub = await screen.findByRole("group", { name: "Lumière" });
    fireEvent.click(within(sub).getByRole("button", { name: "Adressage DMX" }));
    expect(window.localStorage.getItem("project-lumiere-subtab")).toBe('"dmx"');
    await waitFor(() =>
      expect(within(screen.getByRole("group", { name: "Lumière" })).getByRole("button", { name: "Adressage DMX" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );

    // Conception revient à la dernière lentille ouverte.
    fireEvent.click(within(projectNav()).getByRole("link", { name: "Inventaire" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=inventaire"));
    fireEvent.click(within(projectNav()).getByRole("link", { name: "Conception" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=lumiere"));
  });

  test("Livraison regroupe Préparation et Recette", async () => {
    const { router } = await openStrata("/project/p1?tab=inventaire");
    fireEvent.click(within(projectNav()).getByRole("link", { name: "Livraison" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=preparation"));
    expect(window.localStorage.getItem("project-editor-tab")).toBe('"preparation"');
    expect(within(projectNav()).getByRole("link", { name: "Livraison" })).toHaveAttribute("aria-current", "page");
    const bar = await waitFor(() => screen.getByRole("navigation", { name: "Livraison" }));
    expect(within(bar).getAllByRole("link").map((l) => l.textContent)).toEqual(["Préparation", "Recette"]);
    fireEvent.click(within(bar).getByRole("link", { name: "Recette" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=recette"));
    expect(within(projectNav()).getByRole("link", { name: "Livraison" })).toHaveAttribute("aria-current", "page");
  });

  test("Fiche ouvre le dialogue des caractéristiques", async () => {
    await openStrata("/project/p1?tab=inventaire");
    fireEvent.click(within(dock("topbar")!).getByRole("button", { name: "Fiche" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Modifier « Finale Coupe de France »")).toBeInTheDocument();
  });

  test("Dossier ouvre le menu d'export existant", async () => {
    await openStrata("/project/p1?tab=inventaire");
    fireEvent.click(within(dock("topbar")!).getByRole("button", { name: "Dossier" }));
    // Le dossier d'arkyo (`DossierWizard`), en bouchon jusqu'à la phase 6.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Bientôt disponible")).toBeInTheDocument();
  });

  test("Fermer l'édition revient aux projets", async () => {
    const { router } = await openStrata("/project/p1?tab=inventaire");
    fireEvent.click(within(dock("topbar")!).getByRole("button", { name: "Fermer l'édition" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
  });
});

describe("layout plein écran", () => {
  test("aucun nœud texte parasite autour du contenu", async () => {
    const { container } = renderApp("/project/p1?tab=schema", editorApi("classique"));
    await screen.findByText("Finale Coupe de France", {}, FIRST_LOAD);
    const texts = Array.from(container.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE);
    expect(texts.map((n) => JSON.stringify(n.textContent))).toEqual([]);
  });
});
