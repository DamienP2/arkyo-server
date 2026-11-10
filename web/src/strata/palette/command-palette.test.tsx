/**
 * Palette ⌘K (spec v2 §4.4) : ouverture au clavier et par évènement,
 * filtrage, Entrée exécute et rend le focus, Échap traitée une fois, sources
 * filtrées par les permissions des pages, navigation par la garde des saisies
 * non enregistrées, fiche du catalogue (détail, « Modifier »), sources du
 * projet ouvert (équipements, câbles, actions).
 *
 * Banc léger : la palette seule sous un routeur en mémoire, sans
 * l'application (la topbar et son bouton sont testés par `topbar-v2.test.tsx`
 * et `strata-project-editor.test.tsx`). Le premier rendu de l'application
 * entière, lent sous la charge de la suite, n'entre plus dans ces tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { TenantPermissionsProvider } from "@/components/tenant-permissions-context";
import type { TenantPermissions } from "@/lib/tenant-permissions";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/lib/unsaved-changes";
import { mockApi, OWNER_PERMS, resetApp, TECH_PERMS, type Api } from "@/tests/app-harness";
import { cablesApi, normUrl } from "@/strata/manage/manage-fixtures";
import { EDITOR_TAB_KEY } from "@/strata/shell/tab-nav";
import { useAddEquipmentRequest, useValidationRequest } from "@/strata/shell/project-requests";
import { CommandPalette } from "./command-palette";
import { openStrataPalette } from "./palette-event";
import { registerPaletteSource } from "./palette-sources";

const API: Api = {
  "GET /api/tenant/projects": {
    body: { projects: [{ id: "p1", name: "Concert Zénith", clientName: "Live Nation" }, { id: "p2", name: "Plateau JT" }] },
  },
  "GET /api/tenant/catalogue/equipment": {
    body: { arkyo: [{ id: "e1", name: "Switch X9", reference: "X9-24", brand: { id: "b", name: "Netgear" } }], personal: [] },
  },
  "GET /api/tenant/catalogue/cables": { body: { arkyo: [], personal: [{ id: "k1", name: "BNC 75 Ω" }] } },
  "GET /api/tenant/catalogue/adapters": { body: { arkyo: [{ id: "a1", name: "BNC → HDMI" }], personal: [] } },
  "GET /api/tenant/members": { body: [{ id: "m1", email: "ana@regie.fr", name: "Ana Dupont" }] },
};

let dirty = false;

function Dirty() {
  useUnsavedChanges({ dirty });
  return null;
}

function Page() {
  return (
    <UnsavedChangesProvider>
      <button type="button" onClick={openStrataPalette}>
        Rechercher ou agir
      </button>
      <Dirty />
      <CommandPalette />
    </UnsavedChangesProvider>
  );
}

async function mount(url = "/dashboard", api: Api = API, perms: TenantPermissions | null = null) {
  const fetchSpy = mockApi({ "GET /api/tenant/me/permissions": { body: perms ?? OWNER_PERMS }, ...api });
  const element = perms ? (
    <TenantPermissionsProvider initialPermissions={perms}>
      <Page />
    </TenantPermissionsProvider>
  ) : (
    <Page />
  );
  const router = createMemoryRouter(
    [
      { path: "/project/:id", element },
      { path: "*", element },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "Rechercher ou agir" });
  return { router, fetchSpy };
}

const here = (router: { state: { location: { pathname: string; search: string } } }) =>
  normUrl(router.state.location.pathname + router.state.location.search);

const press = (init: KeyboardEventInit, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });

const dialog = () => screen.queryByRole("dialog", { name: "Palette de commandes" });
const input = () => screen.getByRole("combobox", { name: "Rechercher un objet ou une action" });
const group = (name: string) => screen.getByRole("group", { name });
const labels = (name: string) =>
  within(group(name))
    .getAllByRole("option")
    .map((o) => o.querySelector("b")?.textContent);

async function openFromTrigger() {
  const trigger = screen.getByRole("button", { name: "Rechercher ou agir" });
  trigger.focus();
  fireEvent.click(trigger);
  await waitFor(() => expect(document.activeElement).toBe(input()));
  return trigger;
}

beforeEach(() => {
  dirty = false;
  window.localStorage.clear();
});
afterEach(() => {
  resetApp();
  window.localStorage.clear();
  useValidationRequest.setState({ projectId: null });
  useAddEquipmentRequest.setState({ projectId: null });
});

describe("palette ⌘K", () => {
  test("ouvre au clavier (⌘K, Ctrl+K, /) et par évènement, pas de « / » dans un champ", async () => {
    await mount();
    expect(dialog()).toBeNull();
    press({ key: "k", metaKey: true });
    expect(await screen.findByRole("dialog", { name: "Palette de commandes" })).toBeTruthy();
    press({ key: "Escape" });
    await waitFor(() => expect(dialog()).toBeNull());
    press({ key: "k", ctrlKey: true });
    await screen.findByRole("dialog");
    press({ key: "Escape" });
    await waitFor(() => expect(dialog()).toBeNull());
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    press({ key: "/" }, field);
    expect(dialog()).toBeNull();
    field.remove();
    press({ key: "/" });
    await screen.findByRole("dialog");
    press({ key: "Escape" });
    await waitFor(() => expect(dialog()).toBeNull());
    act(() => openStrataPalette());
    await screen.findByRole("dialog");
  });

  test("n'appelle l'API qu'à l'ouverture, puis liste projets, fiches, utilisateurs, actions", async () => {
    const { fetchSpy } = await mount();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("catalogue/equipment"))).toBe(false);
    act(() => openStrataPalette());
    const list = await screen.findByRole("listbox");
    await screen.findByText("Concert Zénith");
    await screen.findByText("Switch X9");
    expect(list.textContent).toContain("Ana Dupont");
    expect(list.textContent).toContain("Nouveau projet");
    expect(labels("Catalogue")).toEqual(["Switch X9", "BNC 75 Ω", "BNC → HDMI"]);
    expect(input().getAttribute("aria-expanded")).toBe("true");
  });

  test("filtre sans tenir compte des accents ni de la casse ; Entrée exécute", async () => {
    const { router } = await mount();
    act(() => openStrataPalette());
    await screen.findByText("Switch X9");
    fireEvent.change(input(), { target: { value: "zenith" } });
    await waitFor(() => expect(screen.queryByText("Switch X9")).toBeNull());
    expect(screen.getByText("Concert Zénith")).toBeTruthy();
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(router.state.location.pathname).toBe("/project/p1");
  });

  test("flèches déplacent la sélection (aria-activedescendant)", async () => {
    await mount();
    act(() => openStrataPalette());
    await screen.findByText("Concert Zénith");
    const first = input().getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-activedescendant")).not.toBe(first);
    expect(document.getElementById(input().getAttribute("aria-activedescendant")!)?.getAttribute("role")).toBe("option");
  });

  test("Échap ferme et rend le focus au déclencheur ; un seul gestionnaire la traite", async () => {
    await mount();
    const trigger = await openFromTrigger();
    // Les autres écouteurs (tiroir de Concevoir…) voient la touche déjà traitée.
    const seen: boolean[] = [];
    const after = (e: KeyboardEvent) => {
      if (e.key === "Escape") seen.push(e.defaultPrevented);
    };
    document.addEventListener("keydown", after);
    try {
      fireEvent.keyDown(input(), { key: "Escape" });
    } finally {
      document.removeEventListener("keydown", after);
    }
    expect(seen).toEqual([true]);
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  test("Entrée sur une action : l'action s'exécute et le focus revient au déclencheur", async () => {
    let ran = 0;
    const off = registerPaletteSource("test-action", () => [{ group: "Test", label: "Action témoin", run: () => ran++ }]);
    try {
      await mount();
      const trigger = await openFromTrigger();
      await screen.findByText("Action témoin");
      fireEvent.change(input(), { target: { value: "témoin" } });
      await waitFor(() => expect(labels("Test")).toEqual(["Action témoin"]));
      fireEvent.keyDown(input(), { key: "Enter" });
      await waitFor(() => expect(dialog()).toBeNull());
      expect(ran).toBe(1);
      expect(document.activeElement).toBe(trigger);
    } finally {
      off();
    }
  });

  test("source asynchrone : LoadingState puis résultats ; source enfichable", async () => {
    await mount();
    let release: (v: void) => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const off = registerPaletteSource("test", async () => {
      await gate;
      return [{ group: "Test", label: "Élément lent", run: () => {} }];
    });
    act(() => openStrataPalette());
    expect(await screen.findByText("Recherche…")).toBeTruthy();
    await act(async () => release());
    await screen.findByText("Élément lent");
    off();
  });

  test("une source en échec n'empêche pas les autres", async () => {
    await mount("/dashboard", { ...API, "GET /api/tenant/members": { status: 403, body: { error: "Interdit" } } });
    act(() => openStrataPalette());
    await screen.findByText("Concert Zénith");
    expect(screen.queryByText("Ana Dupont")).toBeNull();
  });

  test("permissions : catalogue et utilisateurs masqués comme leurs pages, sans lecture", async () => {
    const { fetchSpy } = await mount("/dashboard", API, TECH_PERMS as TenantPermissions);
    act(() => openStrataPalette());
    await screen.findByText("Concert Zénith");
    expect(screen.queryByRole("group", { name: "Catalogue" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Utilisateurs" })).toBeNull();
    expect(labels("Actions")).toEqual(["Nouveau projet"]);
    const read = (path: string) => fetchSpy.mock.calls.some((c) => String(c[0]).split("?")[0] === path);
    expect(read("/api/tenant/catalogue/equipment")).toBe(false);
    expect(read("/api/tenant/members")).toBe(false);
  });

  test("fiche du catalogue : Entrée ouvre sa fiche, « Modifier » (⌘Entrée) l'éditeur pleine page", async () => {
    const { router } = await mount();
    act(() => openStrataPalette());
    await screen.findByText("Switch X9");
    fireEvent.change(input(), { target: { value: "switch" } });
    await waitFor(() => expect(labels("Catalogue")).toEqual(["Switch X9"]));
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(here(router)).toBe("/admin/catalogue?id=e1&tab=equipment"));

    act(() => openStrataPalette());
    await screen.findByText("Switch X9");
    fireEvent.change(input(), { target: { value: "switch" } });
    await waitFor(() => expect(labels("Catalogue")).toEqual(["Switch X9"]));
    fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(here(router)).toBe("/admin/catalogue/equipment/e1"));

    // Cordon : bouton « Modifier » de la ligne → l'éditeur d'arkyo (Ruling 11).
    act(() => openStrataPalette());
    await screen.findByText("BNC 75 Ω");
    fireEvent.change(input(), { target: { value: "75" } });
    await waitFor(() => expect(labels("Catalogue")).toEqual(["BNC 75 Ω"]));
    fireEvent.click(within(group("Catalogue")).getByRole("button", { name: "Modifier BNC 75 Ω" }));
    await waitFor(() => expect(here(router)).toBe("/admin/catalogue/cables/k1"));
  });

  test("saisies non enregistrées : la palette passe par la garde", async () => {
    dirty = true;
    const { router } = await mount();
    act(() => openStrataPalette());
    await screen.findByText("Plateau JT");
    fireEvent.click(screen.getByText("Plateau JT"));
    const guard = await screen.findByRole("dialog", { name: "Modifications non enregistrées" });
    expect(router.state.location.pathname).toBe("/dashboard");
    fireEvent.click(within(guard).getByRole("button", { name: "Quitter sans enregistrer" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/project/p2"));
  });
});

describe("palette : sources du projet ouvert", () => {
  const projectApi = () => ({ ...cablesApi("strata"), ...API });

  test("palette : sources du projet ouvert", async () => {
    const { router } = await mount("/project/p1?tab=synoptique", projectApi());
    act(() => openStrataPalette());
    await screen.findByText("Caméra X");
    // Groupes du projet d'abord, puis les objets du site.
    const groups = screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(groups.slice(0, 3)).toEqual(["Matériel", "Câbles", "Projet"]);
    expect(labels("Matériel")).toEqual(expect.arrayContaining(["Caméra X", "Moniteur 17", "Ordinateur", "Intercom"]));
    await waitFor(() => expect(labels("Câbles")).toContain("V-0101"));
    expect(labels("Projet")).toEqual([
      "Valider",
      "Ajouter du matériel",
      "Aller à Concevoir · Synoptique",
      "Aller à Concevoir · Racks",
      "Aller à Gérer · Vue d'ensemble",
      "Aller à Gérer · Fiche",
      "Aller à Gérer · Matériel",
      "Aller à Gérer · Câbles",
    ]);

    // Un équipement : Gérer › Matériel, sa ligne sélectionnée.
    fireEvent.click(within(group("Matériel")).getByText("Caméra X"));
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?page=materiel&sel=i1&space=gerer&tab=synoptique")));

    // Un câble : Gérer › Câbles, sa ligne sélectionnée.
    act(() => openStrataPalette());
    await waitFor(() => expect(labels("Câbles")).toContain("V-0101"));
    fireEvent.click(within(group("Câbles")).getByText("V-0101"));
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?page=cables&sel=c1&space=gerer&tab=synoptique")));

    // Concevoir › Racks : `?tab=rack`, espace retiré (le reste conservé, comme
    // les liens de Gérer vers Concevoir), onglet retenu comme arkyo.
    act(() => openStrataPalette());
    await screen.findByText("Aller à Concevoir · Racks");
    fireEvent.click(screen.getByText("Aller à Concevoir · Racks"));
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?page=cables&sel=c1&tab=rack")));
    expect(window.localStorage.getItem(EDITOR_TAB_KEY)).toBe(JSON.stringify("rack"));
  });

  test("Valider : synoptique de Concevoir, liste des contrôles demandée", async () => {
    const { router } = await mount("/project/p1?space=gerer&page=cables", projectApi());
    act(() => openStrataPalette());
    await screen.findByText("Valider");
    fireEvent.click(screen.getByText("Valider"));
    await waitFor(() => expect(here(router)).toBe("/project/p1?page=cables&tab=synoptique"));
    expect(useValidationRequest.getState().projectId).toBe("p1");
  });

  test("Ajouter du matériel : Gérer › Matériel, outil Équipements demandé", async () => {
    const { router } = await mount("/project/p1?tab=synoptique", projectApi());
    act(() => openStrataPalette());
    await screen.findByText("Ajouter du matériel");
    fireEvent.click(screen.getByText("Ajouter du matériel"));
    await waitFor(() => expect(here(router)).toBe(normUrl("/project/p1?page=materiel&space=gerer&tab=synoptique")));
    expect(useAddEquipmentRequest.getState().projectId).toBe("p1");
  });

  test("hors projet : aucune source de projet, aucune lecture de l'éditeur", async () => {
    const { fetchSpy } = await mount("/rigs/p1", projectApi());
    act(() => openStrataPalette());
    await screen.findByText("Concert Zénith");
    expect(screen.queryByRole("group", { name: "Matériel" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Projet" })).toBeNull();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/editor"))).toBe(false);
  });
});
