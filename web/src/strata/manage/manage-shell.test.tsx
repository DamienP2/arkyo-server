/**
 * Espace Gérer de l'éditeur projet en interface Strata v2 (spec v2 §4.2) :
 * navigation fine, Vue d'ensemble (domaines et « Ce qu'il reste à faire »),
 * Fiche, bouchons. Monté sous la topbar projet v2 quel que soit `?tab=`, sans
 * canevas ; en Classique, `?space=gerer` ne change rien.
 */

import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, resetApp } from "@/tests/app-harness";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import type { ValidationReport } from "@/lib/services/rack-validation";
import { useRackFocusStore } from "../editor/rack-focus";
import { useValidationRecordStore } from "./validation-record";
import { BAIE, CAISSE, editor, LIBRE, manageApi, normUrl } from "./manage-fixtures";

const FIRST_LOAD = { timeout: 15000 };

// Canevas de placement simulé (Konva hors de portée de happy-dom), comme `strata-project-editor.test.tsx`.
vi.mock("@/app/(fullscreen)/project/[id]/rack/_components/rack-placement-canvas", () => ({
  RackDragOverlayContent: () => null,
  RackPlacementCanvas: forwardRef<unknown, { rack: { id: string } }>(function FakeCanvas(props, ref) {
    useImperativeHandle(ref, () => ({
      rackId: props.rack.id,
      ownsSlot: () => false,
      handleDragStart: () => {},
      handleDragOver: () => {},
      handleDragEnd: async () => {},
      cancelDrag: () => {},
      notifyShelfOnlyMiss: () => false,
      clearSelection: () => {},
      fitAll: () => {},
      centerContent: () => {},
      zoomIn: () => {},
      zoomOut: () => {},
    }));
    return <div data-testid="rack-canvas" data-rack={props.rack.id} />;
  }),
}));

const here = (router: { state: { location: { pathname: string; search: string } } }) =>
  normUrl(router.state.location.pathname + router.state.location.search);
const nav = () => screen.getByRole("navigation", { name: "Gérer" });
const domains = () => screen.getByRole("list", { name: "Le projet, domaine par domaine" });
const todo = () => screen.getByRole("list", { name: "Ce qu'il reste à faire" });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  resetApp();
  window.localStorage.clear();
  useRackFocusStore.getState().clear();
  useValidationRecordStore.setState({ byProject: {} });
  useTopbarActions.getState().setValidationReport(null);
  delete document.documentElement.dataset.interface;
});

describe("Gérer › navigation", () => {
  test("monté sous la topbar projet, sans canevas, quel que soit l'onglet", async () => {
    renderApp("/project/p1?tab=rack&space=gerer", manageApi("strata"));
    await screen.findByRole("navigation", { name: "Gérer" }, FIRST_LOAD);
    const links = within(nav()).getAllByRole("link").map((l) => l.textContent?.replace(/\d+$/, ""));
    expect(links).toEqual([
      "Vue d'ensemble",
      "Fiche",
      "Matériel",
      "Câbles",
      "Réseau",
      "Livraison",
      "Dossier",
      "Synoptique",
      "Racks",
    ]);
    expect(within(nav()).getByRole("link", { name: /Vue d'ensemble/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Espace du projet" })).toBeInTheDocument();
    expect(screen.queryByTestId("rack-canvas")).toBeNull();
    expect(document.querySelector('[data-zone="canvas"]')).toBeNull();
    expect(screen.getByRole("switch", { name: "Toujours afficher les sections avancées" })).toBeInTheDocument();
  });

  test("Réseau, Livraison, Dossier : « Bientôt disponible » comme en Classique ; Câbles : lien vers le synoptique", async () => {
    const { router } = renderApp(
      "/project/p1?space=gerer&page=reseau",
      manageApi("strata", undefined, {
        "GET /api/tenant/catalogue/adapters": { body: { arkyo: [], personal: [] } },
        "GET /api/tenant/projects/p1/synoptic/general": { status: 500, body: { error: "Erreur" } },
      }),
    );
    expect(await screen.findByRole("heading", { name: "Réseau" }, FIRST_LOAD)).toBeInTheDocument();
    expect(screen.getByText("Bientôt disponible")).toBeInTheDocument();
    fireEvent.click(within(nav()).getByRole("link", { name: /Livraison/ }));
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?space=gerer&page=livraison")));
    expect(screen.getByRole("heading", { name: "Livraison" })).toBeInTheDocument();
    expect(screen.getByText("Bientôt disponible")).toBeInTheDocument();
    fireEvent.click(within(nav()).getByRole("link", { name: /Dossier/ }));
    expect(await screen.findByRole("heading", { name: "Dossier" })).toBeInTheDocument();
    expect(screen.getByText("Bientôt disponible")).toBeInTheDocument();
    fireEvent.click(within(nav()).getByRole("link", { name: /Câbles/ }));
    expect(await screen.findByRole("heading", { name: "Câbles" })).toBeInTheDocument();
    // Liste illisible (vue Générale en erreur) : le synoptique reste accessible.
    expect(await screen.findByRole("alert")).toHaveTextContent("Réessayer");
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir le synoptique" }));
    // Le dernier écran de Gérer reste dans l'URL (retour par le sélecteur d'espace).
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?page=cables&tab=synoptique")));
    expect(screen.queryByRole("navigation", { name: "Gérer" })).toBeNull();
  });

  test("dans Gérer, les raccourcis de l'Inventaire (E, A, P, X, Échap) n'agissent pas", async () => {
    renderApp("/project/p1?tab=inventaire&space=gerer", manageApi("strata"));
    await screen.findByRole("navigation", { name: "Gérer" }, FIRST_LOAD);
    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(window.localStorage.getItem("inventaire-active-tool:p1")).toBeNull();
  });

  test("en Classique : ?space=gerer ne change rien", async () => {
    renderApp("/project/p1?tab=rack&space=gerer", manageApi("classique"));
    await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
    expect(screen.queryByRole("navigation", { name: "Gérer" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Espace du projet" })).toBeNull();
  });
});

describe("Gérer › Vue d'ensemble", () => {
  test("Vue d'ensemble : une ligne par domaine, clic → cible", async () => {
    const { router } = renderApp("/project/p1?tab=rack&space=gerer", manageApi("strata"));
    await screen.findByRole("list", { name: "Le projet, domaine par domaine" }, FIRST_LOAD);
    expect(screen.getByRole("heading", { level: 1, name: "Finale Coupe de France" })).toBeInTheDocument();
    const rows = within(domains()).getAllByRole("button");
    expect(rows.map((r) => r.querySelector("strong")?.textContent)).toEqual([
      "Fiche",
      "Matériel",
      "Racks",
      "Câblage",
      "Validation",
      "Réseau",
      "Livraison",
      "Dossier",
    ]);
    await waitFor(() =>
      expect(within(domains()).getByRole("button", { name: /^Matériel/ })).toHaveTextContent(
        "8 équipements · 1 emplacement · 2 contenants · 2 à placer",
      ),
    );

    // Gérer › Matériel.
    fireEvent.click(within(domains()).getByRole("button", { name: /^Matériel/ }));
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?tab=rack&space=gerer&page=materiel")));
    expect(await screen.findByRole("heading", { level: 1, name: "Matériel" })).toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: /Matériel/ })).toHaveAttribute("aria-current", "page");

    // Concevoir › Racks.
    fireEvent.click(within(nav()).getByRole("link", { name: /Vue d'ensemble/ }));
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?tab=rack&space=gerer")));
    fireEvent.click(within(domains()).getByRole("button", { name: /^Racks/ }));
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?tab=rack")));
    expect(await screen.findByTestId("rack-canvas")).toBeInTheDocument();
  });

  test("« Ce qu'il reste à faire » : équipement à placer → mode Racks sur son contenant ; fiche → Gérer › Fiche", async () => {
    const request = vi.spyOn(useRackFocusStore.getState(), "request");
    const { router } = renderApp("/project/p1?space=gerer", manageApi("strata"));
    const item = await within(await screen.findByRole("list", { name: "Ce qu'il reste à faire" }, FIRST_LOAD)).findByRole(
      "button",
      { name: /Placer Moniteur 17 en rack/ },
      FIRST_LOAD,
    );
    expect(item).toHaveTextContent("Baie 1 · 2 à placer");
    fireEvent.click(item);
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?tab=rack")));
    expect(request).toHaveBeenCalledWith({ projectId: "p1", rackId: "r1" });
    expect(window.localStorage.getItem("project-editor-tab")).toBe('"rack"');
    expect(await screen.findByTestId("rack-canvas")).toHaveAttribute("data-rack", "r1");
  });

  test("fiche incomplète → Gérer › Fiche", async () => {
    const api = manageApi("strata");
    const base = (api["GET /api/tenant/projects/p1/editor"] as { body: { fiche: Record<string, unknown> } }).body;
    const { router } = renderApp("/project/p1?space=gerer", {
      ...api,
      "GET /api/tenant/projects/p1/editor": { body: { ...base, fiche: { ...base.fiche, clientName: null } } },
    });
    const row = await within(await screen.findByRole("list", { name: "Ce qu'il reste à faire" }, FIRST_LOAD)).findByRole(
      "button",
      { name: /Compléter la fiche/ },
      FIRST_LOAD,
    );
    expect(row).toHaveTextContent("Client");
    fireEvent.click(row);
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?space=gerer&tab=inventaire&page=fiche")));
    expect(await screen.findByRole("heading", { level: 1, name: "Fiche" })).toBeInTheDocument();
  });

  test("sans contenant rackable : aucune ligne « à placer », Racks sans bilan", async () => {
    renderApp("/project/p1?space=gerer", manageApi("strata", [LIBRE, CAISSE]));
    await screen.findByRole("list", { name: "Le projet, domaine par domaine" }, FIRST_LOAD);
    expect(within(domains()).getByRole("button", { name: /^Racks/ })).toHaveTextContent("Aucun contenant rackable");
    expect(within(domains()).getByRole("button", { name: /^Matériel/ })).toHaveTextContent(
      "4 équipements · 1 emplacement · 1 contenant",
    );
    // Rien à faire : l'état vide partagé.
    expect(within(todo()).getByText("Tout est fait")).toBeInTheDocument();
  });
});

const REPORT: ValidationReport = {
  issues: [{ id: "iss-1", severity: "error", kind: "duplicate_label", subject: "V-0101", message: "Label utilisé deux fois", refs: {} }],
  counts: { error: 1, warning: 0, info: 0 },
};

describe("Gérer › rapport de validation", () => {
  test("le rapport d'un autre projet n'est pas montré", async () => {
    // Le synoptique du projet A a publié un rapport ; le store du shell le garde.
    useValidationRecordStore.getState().record({ projectId: "pA", viewId: "loc:l1", report: REPORT });
    useTopbarActions.getState().setValidationReport(REPORT);
    renderApp("/project/p1?space=gerer", manageApi("strata"));
    await screen.findByRole("list", { name: "Le projet, domaine par domaine" }, FIRST_LOAD);
    const row = within(domains()).getByRole("button", { name: /^Validation/ });
    expect(row).toHaveTextContent("Aucun rapport");
    expect(row).toHaveTextContent("Concevoir");
    await waitFor(() => expect(within(todo()).queryByRole("button", { name: /Label en doublon/ })).toBeNull());
  });

  test("le rapport noté pour ce projet : sa vue, ses compteurs, ses contrôles", async () => {
    useValidationRecordStore.getState().record({ projectId: "p1", viewId: "loc:l1", report: REPORT });
    renderApp("/project/p1?space=gerer", manageApi("strata"));
    await screen.findByRole("list", { name: "Le projet, domaine par domaine" }, FIRST_LOAD);
    expect(within(domains()).getByRole("button", { name: /^Validation · Régie/ })).toHaveTextContent("1 erreur");
    expect(await within(todo()).findByRole("button", { name: /Label en doublon \(1\)/ }, FIRST_LOAD)).toBeInTheDocument();
  });
});

describe("Gérer › lecture en échec", () => {
  test("canvas-data illisible : une ligne « lecture impossible », pas « Tout est fait »", async () => {
    renderApp(
      "/project/p1?space=gerer",
      manageApi("strata", undefined, {
        "GET /api/tenant/projects/p1/racks/r1/canvas-data": { status: 500, body: { error: "Erreur" } },
      }),
    );
    expect(
      await within(await screen.findByRole("list", { name: "Ce qu'il reste à faire" }, FIRST_LOAD)).findByRole(
        "button",
        { name: /Baie 1 : lecture impossible/ },
        FIRST_LOAD,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Tout est fait")).toBeNull();
  });
});

describe("Gérer › Fiche", () => {
  test("informations, caractéristiques (dialogue existant), équipe, tâches, documents, journal", async () => {
    renderApp("/project/p1?space=gerer&page=fiche", manageApi("strata"));
    expect(await screen.findByRole("heading", { level: 1, name: "Fiche" }, FIRST_LOAD)).toBeInTheDocument();
    const info = screen.getByRole("tabpanel");
    expect(within(info).getByText("France TV")).toBeInTheDocument();
    expect(within(info).getByText("Stade de France")).toBeInTheDocument();
    fireEvent.click(within(info).getByRole("button", { name: "Modifier les caractéristiques" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Modifier « Finale Coupe de France »")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("tab", { name: /Équipe/ }));
    expect(await within(screen.getByRole("tabpanel")).findByText("Admin")).toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getByText("Créateur du projet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Tâches/ }));
    expect(within(screen.getByRole("tabpanel")).getByText("2 tâches")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Documents/ }));
    expect(within(screen.getByRole("tabpanel")).getByRole("link", { name: /Plan de feu\.pdf/ })).toHaveAttribute(
      "href",
      "/uploads/d1.pdf",
    );

    fireEvent.click(screen.getByRole("tab", { name: /Journal/ }));
    expect(await within(screen.getByRole("tabpanel")).findByText("0 entrée")).toBeInTheDocument();
  });
});

describe("Gérer › Fiche, documents", () => {
  test("lien d'un document : adresses sûres seulement, sinon le nom en texte", async () => {
    const doc = (id: string, name: string, url: string) => ({
      id,
      name,
      url,
      mimeType: "application/pdf",
      sizeBytes: 1024,
      uploadedAt: "2026-11-01T10:00:00.000Z",
    });
    renderApp(
      "/project/p1?space=gerer&page=fiche",
      manageApi("strata", undefined, {
        "GET /api/tenant/projects/p1/editor": {
          body: editor([BAIE, LIBRE, CAISSE], {
            documents: [doc("d1", "Plan.pdf", "/uploads/d1.pdf"), doc("d2", "Piège", "javascript:alert(1)"), doc("d3", "Notice", "https://example.com/n.pdf")],
          }),
        },
      }),
    );
    fireEvent.click(await screen.findByRole("tab", { name: /Documents/ }, FIRST_LOAD));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("link", { name: "Plan.pdf" })).toHaveAttribute("href", "/uploads/d1.pdf");
    expect(within(panel).getByRole("link", { name: "Notice" })).toHaveAttribute("href", "https://example.com/n.pdf");
    expect(within(panel).queryByRole("link", { name: "Piège" })).toBeNull();
    expect(within(panel).getByText("Piège")).toBeInTheDocument();
  });
});
