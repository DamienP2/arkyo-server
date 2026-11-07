/**
 * `StrataProjectTopbar` : repli quand `tabs` n'est pas la `ProjectTabsPill`
 * de l'éditeur (navigation par `?tab=`, sans les sous-onglets propres à la
 * pill), lentille Connectique et état d'enregistrement.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { EditorShell } from "@/components/editor-shell/editor-shell";
import { WorkspaceProvider } from "@/components/editor-shell/workspace-context";
import { mockApi, resetApp, signedInApi } from "@/tests/app-harness";
import { InterfaceProvider } from "../interface-context";
import { withStrataSaveStatus } from "./save-status";
import { StrataProjectTopbar } from "./strata-project-topbar";

const STATUS_META = {
  EN_PREPARATION: { label: "En préparation", color: "#64748b" },
  PRET: { label: "Prêt", color: "#0ea5e9" },
  EN_COURS: { label: "En cours", color: "#f59e0b" },
  TERMINE: { label: "Terminé", color: "#10b981" },
  ANNULE: { label: "Annulé", color: "#ef4444" },
};

function renderTopbar(url: string, wrap: (n: React.ReactNode) => React.ReactNode = (n) => n) {
  mockApi(signedInApi());
  const topbar = (
    <StrataProjectTopbar
      projectName="Finale"
      tenantName={null}
      tabs={<span>pill maison</span>}
      onClose={() => {}}
      statusMeta={STATUS_META}
    />
  );
  const router = createMemoryRouter(
    [
      {
        path: "/project/:id",
        element: (
          <InterfaceProvider value="strata">
            <WorkspaceProvider workspace="design">
              <EditorShell globalTopbar={wrap(topbar)} canvas={<div>canevas</div>} />
            </WorkspaceProvider>
          </InterfaceProvider>
        ),
      },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const here = (router: ReturnType<typeof renderTopbar>) => router.state.location.pathname + router.state.location.search;
const lensBar = () => screen.getByRole("navigation", { name: "Lentilles" });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("StrataProjectTopbar", () => {
  test("repli sans la pill de l'éditeur : navigation par ?tab=, pas de sous-onglets", async () => {
    const router = renderTopbar("/project/p1?tab=lumiere");
    const lenses = await waitFor(() => lensBar());
    expect(within(lenses).getByRole("link", { name: "Lumière" })).toHaveAttribute("aria-current", "page");
    expect(within(lenses).getByRole("link", { name: "Synoptique" })).toHaveAttribute("href", "?tab=synoptique");
    // Les sous-onglets (Plan de feu, Adressage DMX…) appartiennent à la pill : pas proposés en repli.
    expect(screen.queryByRole("group", { name: "Lumière" })).toBeNull();
    // L'élément reçu en `tabs` n'est pas rendu.
    expect(screen.queryByText("pill maison")).toBeNull();

    fireEvent.click(within(lenses).getByRole("link", { name: "Synoptique" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=synoptique"));
    expect(window.localStorage.getItem("project-editor-tab")).toBe('"synoptique"');
  });

  test("Connectique : onglet rack avec ?lens=connectique ; changer d'onglet retire la lentille", async () => {
    const router = renderTopbar("/project/p1?tab=rack");
    fireEvent.click(within(await waitFor(() => lensBar())).getByRole("link", { name: "Connectique" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=rack&lens=connectique"));
    expect(window.localStorage.getItem("project-editor-tab")).toBe('"rack"');
    // Conception, onglet courant : la lentille reste.
    fireEvent.click(within(screen.getByRole("navigation", { name: "Onglets du projet" })).getByRole("link", { name: "Conception" }));
    expect(here(router)).toBe("/project/p1?tab=rack&lens=connectique");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Onglets du projet" })).getByRole("link", { name: "Inventaire" }));
    await waitFor(() => expect(here(router)).toBe("/project/p1?tab=inventaire"));
  });

  test("état d'enregistrement : affiché quand l'éditeur le fournit", async () => {
    renderTopbar("/project/p1?tab=rack", (n) => withStrataSaveStatus("saved", n));
    const saved = await screen.findByText("Enregistré");
    expect(saved.closest("[data-strata-save]")).not.toBeNull();
  });

  test("sans état fourni, ou au repos : pas de repère, le badge de la barre contextuelle reste", async () => {
    renderTopbar("/project/p1?tab=rack");
    await waitFor(() => lensBar());
    expect(document.querySelector("[data-strata-save]")).toBeNull();
    resetApp();
    renderTopbar("/project/p1?tab=rack", (n) => withStrataSaveStatus("idle", n));
    await waitFor(() => lensBar());
    expect(document.querySelector("[data-strata-save]")).toBeNull();
  });

  test("règle de masquage limitée au badge à pictogramme de la barre contextuelle", async () => {
    renderTopbar("/project/p1?tab=rack", (n) => withStrataSaveStatus("saving", n));
    await waitFor(() => lensBar());
    const css = document.querySelector("[data-strata-editor] style")!.textContent!;
    expect(css).toContain("[data-strata-editor]:has([data-strata-save])");
    expect(css).toContain('[data-dock="contextual"] > div > span:last-child:has(> svg)');
  });
});
