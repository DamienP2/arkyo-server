/**
 * Mode tableau de Gérer › Câbles (spec v2 §4.2) : édition en cellule,
 * remplissage vers le bas, enregistrement par les routes existantes de
 * modification d'un câble, une requête par ligne modifiée. Arkyo ne stocke
 * pas de longueur (Ruling 9) : on saisit numéro, couleur et notes.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderApp, resetApp } from "@/tests/app-harness";
import { CONNECTIONS } from "../bottom/test-fixtures";
import { cablesApi } from "./manage-fixtures";
import { fillDown, TableEditor, type Drafts, type TableColumn } from "./table-editor";

const FIRST_LOAD = { timeout: 15000 };

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

const patched = (id: string) => (init: RequestInit | undefined) => ({
  body: { ...CONNECTIONS.find((c) => c.id === id), ...JSON.parse(String(init?.body ?? "{}")) },
});

/** Cellule (ligne, colonne) de la grille ; ligne 0 = premier câble. */
function cell(grid: HTMLElement, row: number, col: number) {
  const rows = within(grid).getAllByRole("row").slice(1);
  return within(rows[row]).getAllByRole("gridcell")[col];
}

describe("Gérer › Câbles, mode tableau", () => {
  test("fillDown recopie la première valeur telle quelle", () => {
    expect(fillDown(["V-0101", "x", "", "y"])).toEqual(["V-0101", "V-0101", "V-0101", "V-0101"]);
    expect(fillDown(["", "x"])).toEqual(["", ""]);
    expect(fillDown([])).toEqual([]);
  });

  test("mode tableau : édition d'un numéro, remplissage vers le bas, PATCH envoyé par ligne modifiée", async () => {
    const { fetchSpy } = renderApp(
      "/project/p1?space=gerer&page=cables",
      cablesApi("strata", CONNECTIONS, {
        "PATCH /api/racks/r1/connections/c1": patched("c1"),
        "PATCH /api/racks/r1/connections/c2": patched("c2"),
        "PATCH /api/racks/r1/connections/c3": patched("c3"),
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Tableau" }, FIRST_LOAD));
    const grid = screen.getByRole("grid", { name: "Câbles" });
    // Ordre de la liste : A-0101 (c3), V-0101 (c1), sans numéro (c2). Colonnes : N°, De, Vers, Type, Couleur, Notes.
    expect([0, 1, 2].map((r) => cell(grid, r, 0).textContent)).toEqual(["A-0101", "V-0101", ""]);
    expect(cell(grid, 0, 1)).toHaveAttribute("aria-readonly", "true");

    // Édition d'un numéro : Entrée ouvre la cellule, Entrée valide et descend.
    fireEvent.mouseDown(cell(grid, 0, 0));
    fireEvent.keyDown(grid, { key: "Enter" });
    const input = within(grid).getByRole("textbox", { name: "N°" });
    fireEvent.change(input, { target: { value: "V-0200" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(within(grid).queryByRole("textbox")).toBeNull();
    expect(cell(grid, 0, 0)).toHaveTextContent("V-0200");
    expect(cell(grid, 1, 0)).toHaveAttribute("aria-selected", "true");

    // Échap annule une saisie.
    fireEvent.keyDown(grid, { key: "x" });
    fireEvent.keyDown(within(grid).getByRole("textbox", { name: "N°" }), { key: "Escape" });
    expect(cell(grid, 1, 0)).toHaveTextContent("V-0101");

    // Plage de trois cellules (⇧ clic), puis remplissage vers le bas (⌘D).
    fireEvent.mouseDown(cell(grid, 0, 0));
    fireEvent.mouseDown(cell(grid, 2, 0), { shiftKey: true });
    expect(screen.getByText("A1:A3")).toBeInTheDocument();
    fireEvent.keyDown(grid, { key: "d", metaKey: true });
    expect([0, 1, 2].map((r) => cell(grid, r, 0).textContent)).toEqual(["V-0200", "V-0200", "V-0200"]);

    // Une note sur la première ligne : la même requête que son numéro.
    fireEvent.mouseDown(cell(grid, 0, 5));
    fireEvent.keyDown(grid, { key: "R" });
    const notes = within(grid).getByRole("textbox", { name: "Notes" });
    fireEvent.change(notes, { target: { value: "Repris" } });
    fireEvent.keyDown(notes, { key: "Enter" });
    expect(screen.getByText("3 lignes modifiées")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.queryByText(/lignes? modifiées?/)).toBeNull());
    const patches = fetchSpy.mock.calls
      .filter(([, init]) => (init?.method ?? "GET").toUpperCase() === "PATCH")
      .map(([input, init]) => [String(input), JSON.parse(String(init?.body))]);
    expect(patches).toHaveLength(3);
    expect(Object.fromEntries(patches)).toEqual({
      "/api/racks/r1/connections/c3": { label: "V-0200", notes: "Repris" },
      "/api/racks/r1/connections/c1": { label: "V-0200" },
      "/api/racks/r1/connections/c2": { label: "V-0200" },
    });
    // Valeurs enregistrées affichées sans attendre la relecture.
    expect([0, 1, 2].map((r) => cell(grid, r, 0).textContent)).toEqual(["V-0200", "V-0200", "V-0200"]);
  });

  test("couleur invalide : cellule en erreur, enregistrement bloqué", async () => {
    renderApp("/project/p1?space=gerer&page=cables", cablesApi("strata"));
    fireEvent.click(await screen.findByRole("button", { name: "Tableau" }, FIRST_LOAD));
    const grid = screen.getByRole("grid", { name: "Câbles" });
    fireEvent.mouseDown(cell(grid, 0, 4));
    fireEvent.keyDown(grid, { key: "F2" });
    const input = within(grid).getByRole("textbox", { name: "Couleur" });
    fireEvent.change(input, { target: { value: "rouge" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(cell(grid, 0, 4)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Annuler les modifications" }));
    expect(cell(grid, 0, 4)).not.toHaveAttribute("aria-invalid");
  });

  test("relecture pendant une saisie : la valeur reste sur sa ligne", () => {
    type Row = { id: string; n: string };
    const columns: TableColumn<Row>[] = [{ key: "n", title: "N°", get: (r) => r.n, editable: true }];
    let drafts: Drafts = {};
    const view = (rows: Row[]) => (
      <TableEditor
        label="Essai"
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        canEdit={() => true}
        drafts={drafts}
        onDraftsChange={(d) => (drafts = d)}
      />
    );
    const { rerender } = render(view([{ id: "a", n: "1" }, { id: "b", n: "2" }]));
    const grid = screen.getByRole("grid", { name: "Essai" });
    fireEvent.mouseDown(cell(grid, 0, 0));
    fireEvent.keyDown(grid, { key: "Enter" });
    // Une relecture réordonne les lignes pendant la saisie.
    rerender(view([{ id: "b", n: "2" }, { id: "a", n: "1" }]));
    const input = within(grid).getByRole("textbox", { name: "N°" });
    expect(input.closest("tr")).toBe(within(grid).getAllByRole("row")[2]);
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(drafts).toEqual({ a: { n: "10" } });
  });
});
