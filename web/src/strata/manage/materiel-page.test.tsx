/**
 * Gérer › Matériel (spec v2 §4.2) : équipements du projet groupés par
 * emplacement et contenant, détail (position, faces, « Avancé » replié),
 * onglet Nomenclature, « Ajouter du catalogue » vers le parcours d'ajout
 * existant de l'inventaire.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, resetApp } from "@/tests/app-harness";
import { CAISSE, LIBRE, manageApi, normUrl } from "./manage-fixtures";

const FIRST_LOAD = { timeout: 15000 };

const here = (router: { state: { location: { pathname: string; search: string } } }) =>
  normUrl(router.state.location.pathname + router.state.location.search);
const list = () => screen.getByRole("region", { name: "Inventaire du projet" });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("Gérer › Matériel", () => {
  test("Matériel : groupé par emplacement/contenant, détail avec faces et Avancé replié, Ajouter → assistant existant", async () => {
    // Outil de l'Inventaire refermé auparavant : « Ajouter du catalogue » doit le rouvrir.
    window.localStorage.setItem("inventaire-active-tool:p1", "null");
    const { router } = renderApp("/project/p1?space=gerer&page=materiel", manageApi("strata"));
    expect(await screen.findByRole("heading", { level: 1, name: "Matériel" }, FIRST_LOAD)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Inventaire/ })).toHaveAttribute("aria-selected", "true");

    // Emplacement → contenants → lignes ; équipements libres à part.
    const regie = within(list()).getByRole("group", { name: "Régie" });
    const baie = within(regie).getByRole("table", { name: "Baie 1" });
    await waitFor(() => expect(within(baie).getAllByRole("row").map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^U1Caméra X.*Sony/),
      expect.stringMatching(/^U10Moniteur 17×3TVLogic2 à placer$/),
    ]));
    // Ligne sélectionnée : `aria-current` (tableau simple, pas une grille).
    expect(within(baie).getAllByRole("row").some((r) => r.hasAttribute("aria-selected"))).toBe(false);
    expect(within(regie).getByRole("table", { name: "Caisse" })).toHaveTextContent("Intercom");
    expect(within(regie).getByRole("table", { name: "Hors contenant" })).toHaveTextContent("Ordinateur");

    // Filtre.
    fireEvent.change(within(list()).getByRole("searchbox", { name: "Filtrer le matériel" }), { target: { value: "inter" } });
    expect(within(list()).queryByRole("table", { name: "Baie 1" })).toBeNull();
    expect(within(list()).getByRole("table", { name: "Caisse" })).toBeInTheDocument();
    fireEvent.change(within(list()).getByRole("searchbox", { name: "Filtrer le matériel" }), { target: { value: "" } });

    // Détail : position, faces, Avancé replié.
    fireEvent.click(within(list()).getByRole("row", { name: /Caméra X/ }));
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?space=gerer&page=materiel&tab=inventaire&sel=i1")));
    expect(within(list()).getByRole("row", { name: /Caméra X/ })).toHaveAttribute("aria-current", "true");
    const detail = screen.getByRole("complementary", { name: "Détail" });
    expect(within(detail).getByRole("heading", { level: 2, name: "Caméra X" })).toBeInTheDocument();
    expect(within(detail).getByText("Baie 1 · U1")).toBeInTheDocument();
    expect(await within(detail).findByRole("region", { name: "Équipement sélectionné" })).toBeInTheDocument();
    expect(within(detail).getByText("Connectique")).toBeInTheDocument();
    const advanced = within(detail).getByRole("button", { name: /Avancé/ });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(advanced);
    expect(within(detail).getByText("CX-1")).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "Voir dans le rack" })).toBeEnabled();

    // Nomenclature : la table d'arkyo (`buildBomTable`, réglages de l'export Inventaire).
    fireEvent.click(screen.getByRole("tab", { name: "Nomenclature" }));
    const bom = screen.getByRole("table", { name: "Nomenclature" });
    expect(within(bom).getByText("Caméra X")).toBeInTheDocument();
    expect(within(bom).getByText("Intercom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Inventaire/ }));

    // « Ajouter du catalogue » : pointillés, ouvre le parcours d'ajout de l'inventaire (outil Équipements).
    const add = screen.getByRole("button", { name: "Ajouter du catalogue" });
    expect(add.className).toMatch(/border-dashed/);
    expect(add.className).not.toMatch(/bg-\[var\(--accent\)\]/);
    fireEvent.click(add);
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?page=materiel&tab=inventaire&sel=i1")));
    expect(window.localStorage.getItem("inventaire-active-tool:p1")).toBe('"equipment"');
    const side = await screen.findByRole("complementary", { name: "Panneau latéral" }, FIRST_LOAD);
    expect(await within(side).findByRole("heading", { name: "Équipements" }, FIRST_LOAD)).toBeInTheDocument();
  });

  test("équipement à placer : « Placer dans un rack » ; libre : pas de rack", async () => {
    renderApp("/project/p1?space=gerer&page=materiel&sel=i2", manageApi("strata"));
    const detail = await screen.findByRole("complementary", { name: "Détail" }, FIRST_LOAD);
    expect(await within(detail).findByText("Baie 1 · U10 · 2 à placer")).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "Placer dans un rack" })).toBeEnabled();
    resetApp();

    renderApp("/project/p1?space=gerer&page=materiel&sel=i5", manageApi("strata"));
    const free = await screen.findByRole("complementary", { name: "Détail" }, FIRST_LOAD);
    expect(within(free).getByText("Régie · hors contenant")).toBeInTheDocument();
    expect(within(free).queryByRole("button", { name: /rack/ })).toBeNull();
  });

  test("sans contenant rackable : la liste s'affiche, sans position en U", async () => {
    renderApp("/project/p1?space=gerer&page=materiel", manageApi("strata", [LIBRE, CAISSE]));
    await screen.findByRole("heading", { level: 1, name: "Matériel" }, FIRST_LOAD);
    const caisse = within(list()).getByRole("table", { name: "Caisse" });
    expect(within(caisse).getByRole("row")).toHaveTextContent(/^—Intercom/);
    expect(within(list()).queryByText(/à placer/)).toBeNull();
  });

  test("contenant illisible : « lecture impossible », pas de « à placer » supposé", async () => {
    renderApp(
      "/project/p1?space=gerer&page=materiel&sel=i2",
      manageApi("strata", undefined, {
        "GET /api/tenant/projects/p1/racks/r1/inventory": { status: 500, body: { error: "Erreur" } },
      }),
    );
    const detail = await screen.findByRole("complementary", { name: "Détail" }, FIRST_LOAD);
    expect(await within(detail).findByText("Baie 1 · lecture impossible")).toBeInTheDocument();
    expect(within(list()).queryByText(/à placer/)).toBeNull();
  });

  test("projet vide : l'état vide partagé", async () => {
    renderApp("/project/p1?space=gerer&page=materiel", manageApi("strata", []));
    await screen.findByRole("heading", { level: 1, name: "Matériel" }, FIRST_LOAD);
    expect(within(list()).getByText("Aucun équipement")).toBeInTheDocument();
  });
});
