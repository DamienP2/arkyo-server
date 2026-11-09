/**
 * Coquille Strata v2 (topbar `TopbarV2`, sans barre latérale) : rendue par le
 * layout `(app)` quand `GET /api/site` renvoie `interface: "strata"`. La
 * coquille Classique reste celle d'arkyo. La navigation (onglets, menus,
 * entrées du rail Classique) est testée dans `topbar-v2.test.tsx`.
 */

import { useEffect } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { emitAppEvent, OWNER_PERMS, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";
import { InterfaceProvider } from "@/strata/interface-context";

const strataApi = (perms: unknown = OWNER_PERMS, extra: Api = {}): Api => ({
  ...signedInApi(perms, "Régie A", "strata"),
  ...extra,
});

beforeAll(async () => {
  await Promise.all([
    import("@/app/(app)/dashboard/page"),
    import("@/strata/pages/projects-page"),
    import("@/app/(app)/admin/espace/page"),
  ]);
}, 60000);

afterEach(() => {
  resetApp();
  delete document.documentElement.dataset.interface;
});

async function shellPart(selector: string): Promise<HTMLElement> {
  return waitFor(
    () => {
      const el = document.querySelector(selector);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    },
    { timeout: 15000 },
  );
}

/** Coquille Strata montée : sa navigation principale est dans le header. */
async function strataHeader(): Promise<HTMLElement> {
  const header = await shellPart("header");
  await within(header).findByRole("navigation", { name: "Navigation principale" }, { timeout: 15000 });
  return header;
}

describe("coquille Strata", () => {
  test("coquille strata v2 : topbar, aucune barre latérale, page Projets dans main", async () => {
    renderApp("/dashboard", strataApi());
    const header = await strataHeader();
    expect(within(header).getByRole("navigation", { name: "Navigation principale" })).toBeInTheDocument();
    // Pas de rail : ni Classique ni bibliothèque v1.
    expect(document.querySelector("aside")).toBeNull();
    const main = document.querySelector("main#main-content") as HTMLElement;
    expect(main).not.toBeNull();
    expect(await within(main).findByRole("heading", { level: 1, name: "Projets" }, { timeout: 15000 })).toBeInTheDocument();
  });

  test("classique inchangé : rail arkyo, aucune navigation Strata, aucun texte parasite", async () => {
    renderApp("/dashboard", signedInApi());
    await screen.findByText("Tous les projets actifs", {}, { timeout: 15000 });
    const aside = await shellPart("aside");
    expect(within(aside).getByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Navigation principale" })).toBeNull();
    expect(document.body.textContent).not.toContain("// arkyo-server");
  });
});

describe("bascule d'interface en direct", () => {
  test("la page ouverte n'est pas remontée : saisie conservée, seule la coquille change", async () => {
    let iface = "classique";
    renderApp("/admin/espace", {
      ...signedInApi(),
      "GET /api/site": () => ({ body: { name: "Régie A", logoUrl: null, interface: iface } }),
      "GET /api/tenant/espace/informations": { body: { id: "site", name: "Régie A", logoUrl: null } },
    });
    const input = (await screen.findByLabelText("Nom de l'espace", {}, { timeout: 15000 })) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("Régie A"));
    fireEvent.change(input, { target: { value: "Régie B" } });
    const main = document.querySelector("main#main-content");
    expect(await shellPart("aside")).toHaveTextContent("Dashboard");

    // Classique → Strata : la coquille Strata apparaît, la page reste montée.
    iface = "strata";
    emitAppEvent({ entity: "config", action: "updated", id: "1" });
    await waitFor(() => expect(document.documentElement.dataset.interface).toBe("strata"));
    await strataHeader();
    expect(document.querySelector("aside")).toBeNull();
    expect(document.querySelector("main#main-content")).toBe(main);
    expect(input.isConnected).toBe(true);
    expect(screen.getByLabelText("Nom de l'espace")).toBe(input);
    expect(input.value).toBe("Régie B");

    // Strata → Classique : même chose dans l'autre sens.
    iface = "classique";
    emitAppEvent({ entity: "config", action: "updated", id: "2" });
    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: "Navigation principale" })).toBeNull(),
    );
    expect(await shellPart("aside")).toHaveTextContent("Dashboard");
    expect(document.querySelector("main#main-content")).toBe(main);
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe("Régie B");
  });
});

describe("échec passager de /api/site", () => {
  test("la dernière interface connue est conservée", async () => {
    let site: () => { status?: number; body: unknown } = () => ({ body: { name: "Régie A", interface: "strata" } });
    const { fetchSpy } = renderApp("/dashboard", { ...signedInApi(), "GET /api/site": () => site() });
    await waitFor(() => expect(document.documentElement.dataset.interface).toBe("strata"));
    await strataHeader();
    const siteCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).split("?")[0] === "/api/site").length;

    // Réponse en erreur, puis panne réseau : la coquille reste Strata.
    site = () => ({ status: 500, body: { error: "Erreur serveur" } });
    let before = siteCalls();
    emitAppEvent({ entity: "config", action: "updated", id: "1" });
    await waitFor(() => expect(siteCalls()).toBeGreaterThan(before));
    site = () => {
      throw new TypeError("Failed to fetch");
    };
    before = siteCalls();
    emitAppEvent({ entity: "config", action: "updated", id: "2" });
    await waitFor(() => expect(siteCalls()).toBeGreaterThan(before));
    await new Promise((r) => setTimeout(r, 50));
    expect(document.documentElement.dataset.interface).toBe("strata");
    expect(screen.getByRole("navigation", { name: "Navigation principale" })).toBeInTheDocument();
  });
});

describe("data-interface avant la première image", () => {
  test("posé avant les effets des composants de la coquille", () => {
    let seen: string | undefined;
    function Probe() {
      useEffect(() => {
        seen = document.documentElement.dataset.interface;
      }, []);
      return null;
    }
    render(
      <InterfaceProvider value="strata">
        <Probe />
      </InterfaceProvider>,
    );
    expect(seen).toBe("strata");
  });
});

describe("globals.css", () => {
  const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (selector: string) => {
    const re = new RegExp(`^${selector.replace(/[.[\]"=]/g, "\\$&")} \\{([\\s\\S]*?)^\\}`, "gm");
    return [...css.matchAll(re)].map((m) => m[1]).join("\n");
  };

  test("bloc [data-interface=\"strata\"] : aucun rail et topbar de 46 px", () => {
    const strata = block('[data-interface="strata"]');
    expect(strata).toMatch(/--rail-width:\s*0px;/);
    expect(strata).toMatch(/--topbar-height:\s*46px;/);
  });

  test("variables --strata-face-* en clair et en sombre", () => {
    for (const selector of [":root", ".dark"]) {
      const vars = block(selector);
      for (const name of ["bg", "line", "ink", "ink-2", "ink-3"]) {
        expect(vars, `${selector} --strata-face-${name}`).toMatch(new RegExp(`--strata-face-${name}:\\s*[^;]+;`));
      }
    }
  });
});
