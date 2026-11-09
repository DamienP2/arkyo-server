/**
 * Palette ⌘K (spec v2 §4.4, lot 1) : ouverture au clavier et par évènement,
 * filtrage, Entrée exécute, Échap ferme et rend le focus, source asynchrone
 * avec `<LoadingState>`, sources enfichables.
 */

import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderApp, resetApp, signedInApi, OWNER_PERMS, type Api } from "@/tests/app-harness";
import { openStrataPalette } from "@/strata/shell/topbar-v2";
import { registerPaletteSource } from "./palette-sources";

const api = (extra: Api = {}): Api => ({
  ...signedInApi(OWNER_PERMS, "Régie A", "strata"),
  "GET /api/projects?stats=tasks": { body: [] },
  "GET /api/projects": { body: [] },
  "GET /api/racks": { body: [] },
  "GET /api/panels": { body: [] },
  "GET /api/tenant/projects": {
    body: { projects: [{ id: "p1", name: "Concert Zénith", clientName: "Live Nation" }, { id: "p2", name: "Plateau JT" }] },
  },
  "GET /api/tenant/catalogue/equipment": {
    body: { arkyo: [{ id: "e1", name: "Switch X9", reference: "X9-24", brand: { id: "b", name: "Netgear" } }], personal: [] },
  },
  "GET /api/tenant/members": { body: [{ id: "m1", email: "ana@regie.fr", name: "Ana Dupont" }] },
  ...extra,
});

beforeAll(async () => {
  await import("@/strata/pages/projects-page");
}, 60000);

afterEach(() => {
  resetApp();
  delete document.documentElement.dataset.interface;
});

async function mount(extra: Api = {}) {
  renderApp("/dashboard", api(extra));
  await screen.findByRole("button", { name: /Rechercher ou agir/ });
}

const press = (init: KeyboardEventInit, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });

describe("palette ⌘K", () => {
  test("ouvre au clavier (⌘K, Ctrl+K, /) et par évènement, pas de « / » dans un champ", async () => {
    await mount();
    expect(screen.queryByRole("dialog", { name: "Palette de commandes" })).toBeNull();
    press({ key: "k", metaKey: true });
    expect(await screen.findByRole("dialog", { name: "Palette de commandes" })).toBeTruthy();
    press({ key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Palette de commandes" })).toBeNull());
    press({ key: "k", ctrlKey: true });
    await screen.findByRole("dialog");
    press({ key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press({ key: "/" }, input);
    expect(screen.queryByRole("dialog")).toBeNull();
    input.remove();
    press({ key: "/" });
    await screen.findByRole("dialog");
    press({ key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => openStrataPalette());
    await screen.findByRole("dialog");
  });

  test("n'appelle l'API qu'à l'ouverture, puis liste projets, fiches, utilisateurs, actions", async () => {
    await mount();
    expect(
      (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.some((c) => String(c[0]).includes("catalogue/equipment")),
    ).toBe(false);
    act(() => openStrataPalette());
    const list = await screen.findByRole("listbox");
    await screen.findByText("Concert Zénith");
    expect(list.textContent).toContain("Switch X9");
    expect(list.textContent).toContain("Ana Dupont");
    expect(list.textContent).toContain("Nouveau projet");
    expect(list.textContent).toContain("Catalogue");
    const input = screen.getByRole("combobox", { name: "Rechercher un objet ou une action" });
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  test("filtre sans tenir compte des accents ni de la casse ; Entrée exécute", async () => {
    await mount();
    act(() => openStrataPalette());
    await screen.findByText("Concert Zénith");
    const input = screen.getByRole("combobox", { name: "Rechercher un objet ou une action" });
    fireEvent.change(input, { target: { value: "zenith" } });
    await waitFor(() => expect(screen.queryByText("Switch X9")).toBeNull());
    expect(screen.getByText("Concert Zénith")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("flèches déplacent la sélection (aria-activedescendant)", async () => {
    await mount();
    act(() => openStrataPalette());
    await screen.findByText("Concert Zénith");
    const input = screen.getByRole("combobox", { name: "Rechercher un objet ou une action" });
    const first = input.getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).not.toBe(first);
    expect(document.getElementById(input.getAttribute("aria-activedescendant")!)?.getAttribute("role")).toBe("option");
  });

  test("Échap ferme et rend le focus au déclencheur", async () => {
    await mount();
    const trigger = screen.getByRole("button", { name: /Rechercher ou agir/ });
    trigger.focus();
    fireEvent.click(trigger);
    const input = await screen.findByRole("combobox", { name: "Rechercher un objet ou une action" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
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
    await mount({ "GET /api/tenant/members": { status: 403, body: { error: "Interdit" } } });
    act(() => openStrataPalette());
    await screen.findByText("Concert Zénith");
    expect(screen.queryByText("Ana Dupont")).toBeNull();
  });
});
