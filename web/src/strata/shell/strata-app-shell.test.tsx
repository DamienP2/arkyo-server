/**
 * Coquille Strata (topbar à onglets segmentés et barre latérale de
 * bibliothèque) : rendue par le layout `(app)` quand `GET /api/site` renvoie
 * `interface: "strata"`. La coquille Classique reste celle d'arkyo.
 */

import { useEffect } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, renderApp, resetApp, signedInApi, TECH_PERMS, type Api } from "@/tests/app-harness";
import { isItemActive, sectionOf, STRATA_NAV } from "@/strata/shell/nav-model";
import { InterfaceProvider } from "@/strata/interface-context";

const strataApi = (perms: unknown = OWNER_PERMS, extra: Api = {}): Api => ({
  ...signedInApi(perms, "Régie A", "strata"),
  ...extra,
});

beforeAll(async () => {
  await Promise.all([
    import("@/app/(app)/dashboard/page"),
    import("@/app/(app)/admin/catalogue/page"),
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

/** Entrées du rail Classique (`components/layout/sidebar.tsx`) : href et permission. */
function railEntries(): { href: string; perm?: { domain: string; level: string } }[] {
  const src = readFileSync(resolve(__dirname, "../../components/layout/sidebar.tsx"), "utf8");
  const chunks = src.split(/\bhref:\s*"/).slice(1);
  return chunks.map((chunk) => {
    const href = chunk.slice(0, chunk.indexOf('"'));
    const perm = chunk.match(/perm:\s*\{\s*domain:\s*"(\w+)",\s*level:\s*"(\w+)"\s*\}/);
    return perm ? { href, perm: { domain: perm[1], level: perm[2] } } : { href };
  });
}

describe("modèle de navigation Strata", () => {
  test("toutes les routes du rail sont dans la navigation Strata", () => {
    const rail = railEntries();
    expect(rail.map((e) => e.href)).toEqual([
      "/dashboard",
      "/projects?tab=prestation",
      "/projects?tab=integration",
      "/templates?tab=racks",
      "/templates?tab=panels",
      "/templates?tab=dossiers",
      "/admin/espace",
      "/admin/users",
      "/admin/catalogue",
      "/admin/parametres",
      "/admin/systeme",
    ]);
    const items = STRATA_NAV.flatMap((s) => s.items);
    for (const entry of rail) {
      const item = items.find((i) => i.href === entry.href);
      expect(item, entry.href).toBeDefined();
      expect(item!.perm, entry.href).toEqual(entry.perm);
    }
  });

  test("sections dans l'ordre des onglets", () => {
    expect(STRATA_NAV.map((s) => [s.id, s.label])).toEqual([
      ["projets", "Projets"],
      ["modeles", "Modèles"],
      ["catalogue", "Catalogue"],
      ["administration", "Administration"],
    ]);
  });

  test("sectionOf rattache chaque page à son onglet", () => {
    expect(sectionOf("/dashboard")).toBe("projets");
    expect(sectionOf("/projects")).toBe("projets");
    expect(sectionOf("/profile")).toBe("projets");
    expect(sectionOf("/templates")).toBe("modeles");
    expect(sectionOf("/racks/r1")).toBe("modeles");
    expect(sectionOf("/rigs/g1/rack/r1")).toBe("modeles");
    expect(sectionOf("/panels")).toBe("modeles");
    expect(sectionOf("/admin/catalogue")).toBe("catalogue");
    expect(sectionOf("/admin/catalogue/equipment/e1")).toBe("catalogue");
    expect(sectionOf("/admin/systeme")).toBe("administration");
    expect(sectionOf("/admin/parametres")).toBe("administration");
    expect(sectionOf("/admin/users")).toBe("administration");
  });

  test("entrée active sur les sous-pages, comme le rail Classique", () => {
    const item = (href: string) => STRATA_NAV.flatMap((s) => s.items).find((i) => i.href === href)!;
    const prestation = item("/projects?tab=prestation");
    const integration = item("/projects?tab=integration");
    // Sous-page sans `?tab=` : entrée par défaut ; avec `?tab=` : celui-ci tranche.
    expect(isItemActive(prestation, "/projects/p1", null)).toBe(true);
    expect(isItemActive(integration, "/projects/p1", null)).toBe(false);
    expect(isItemActive(integration, "/projects/p1", "integration")).toBe(true);
    expect(isItemActive(item("/templates?tab=panels"), "/templates/x", "panels")).toBe(true);
    expect(isItemActive(item("/templates?tab=racks"), "/racks/r1", null)).toBe(true);
    // Une seule entrée Catalogue, active sur toutes ses pages.
    const catalogue = STRATA_NAV.find((s) => s.id === "catalogue")!.items[0];
    expect(catalogue).toMatchObject({ href: "/admin/catalogue", perm: { domain: "catalog", level: "admin" } });
    expect(isItemActive(catalogue, "/admin/catalogue", "cordons")).toBe(true);
    expect(isItemActive(catalogue, "/admin/catalogue/equipment/e1", null)).toBe(true);
    expect(isItemActive(catalogue, "/admin/parametres", null)).toBe(false);
  });
});

describe("coquille Strata", () => {
  test("coquille strata : header avec onglets Projets, Modèles, Catalogue, Administration", async () => {
    renderApp("/dashboard", strataApi());
    const header = await strataHeader();
    const nav = within(header).getByRole("navigation", { name: "Navigation principale" });
    expect(within(nav).getByRole("link", { name: "Projets" })).toHaveAttribute("href", "/dashboard");
    expect(within(nav).getByRole("link", { name: "Projets" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Modèles" })).toHaveAttribute("href", "/templates?tab=racks");
    expect(within(nav).getByRole("link", { name: "Catalogue" })).toHaveAttribute("href", "/admin/catalogue");
    expect(within(nav).getByRole("button", { name: "Administration" })).toBeInTheDocument();
    // Nom du site, badge de rôle et menus de la topbar Classique réutilisés.
    expect(within(header).getByText("Régie A")).toBeInTheDocument();
    expect(within(header).getByText("PROPRIÉTAIRE")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Langue" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Profil" })).toBeInTheDocument();

    // Barre latérale de bibliothèque : section de l'onglet actif.
    const aside = await shellPart("aside");
    expect(within(aside).getByText("Projets")).toBeInTheDocument();
    expect(within(aside).getByRole("link", { name: "Tableau de bord" })).toHaveAttribute("aria-current", "page");
    expect(within(aside).getByRole("link", { name: "Prestation" })).toHaveAttribute(
      "href",
      "/projects?tab=prestation",
    );
    expect(within(aside).getByRole("link", { name: "Intégration" })).toHaveAttribute(
      "href",
      "/projects?tab=integration",
    );
    // Version en bas, même texte que le rail Classique.
    const railVersion = readFileSync(resolve(__dirname, "../../components/layout/sidebar.tsx"), "utf8").match(
      /^\s*(v\d+\.\d+\.\d+)\s*$/m,
    )![1];
    expect(within(aside).getByText(railVersion)).toBeInTheDocument();
    // Pas de rail Classique.
    expect(within(aside).queryByText("Dashboard")).toBeNull();
    expect(document.querySelector("main#main-content")).not.toBeNull();
    expect(await screen.findByText("Tous les projets actifs", {}, { timeout: 15000 })).toBeInTheDocument();
  });

  test("le menu Administration liste Espace, Utilisateurs, Catalogue, Paramètres, Système", async () => {
    renderApp("/dashboard", strataApi());
    const header = await strataHeader();
    fireEvent.click(within(header).getByRole("button", { name: "Administration" }));
    const menu = await within(header).findByRole("menu");
    const links = within(menu).getAllByRole("menuitem");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Espace", "/admin/espace"],
      ["Utilisateurs", "/admin/users"],
      ["Catalogue", "/admin/catalogue"],
      ["Paramètres", "/admin/parametres"],
      ["Système", "/admin/systeme"],
    ]);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(within(header).queryByRole("menu")).toBeNull());
  });

  test("filtre par permission", async () => {
    renderApp("/dashboard", strataApi(TECH_PERMS));
    const header = await strataHeader();
    const nav = within(header).getByRole("navigation", { name: "Navigation principale" });
    expect(within(nav).getByRole("link", { name: "Projets" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Modèles" })).toBeInTheDocument();
    // catalog:read < admin, ni members ni settings : ni Catalogue, ni Administration.
    expect(within(nav).queryByRole("link", { name: "Catalogue" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: "Administration" })).toBeNull();
  });

  test("filtre par permission : le menu Administration ne liste que les pages permises", async () => {
    // members:admin sans settings:admin ni catalog:admin.
    renderApp(
      "/dashboard",
      strataApi({
        ...TECH_PERMS,
        permissions: { ...TECH_PERMS.permissions, members: "admin" },
      }),
    );
    const header = await strataHeader();
    fireEvent.click(within(header).getByRole("button", { name: "Administration" }));
    const menu = await within(header).findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Utilisateurs" })).toHaveAttribute("href", "/admin/users");
    expect(within(menu).queryByRole("menuitem", { name: "Système" })).toBeNull();
    expect(within(menu).getAllByRole("menuitem").map((a) => a.textContent)).toEqual(["Utilisateurs"]);
  });

  test("onglets de page rendus dans la topbar", async () => {
    renderApp(
      "/admin/catalogue",
      strataApi(OWNER_PERMS, {
        "GET /api/tenant/catalogue/lookup": {
          body: {
            categories: [],
            brands: [],
            connectorTypes: [],
            signals: [],
            functions: [],
            phases: [],
            types: [],
            cableModels: [],
          },
        },
        "GET /api/tenant/catalogue/equipment": { body: { arkyo: [], personal: [] } },
        "GET /api/tenant/catalogue/cables": { body: { arkyo: [], personal: [] } },
        "GET /api/tenant/catalogue/adapters": { body: { arkyo: [], personal: [] } },
      }),
    );
    const header = await strataHeader();
    for (const label of ["Équipements", "Cordons", "Adaptateurs"]) {
      expect(await within(header).findByRole("button", { name: label }, { timeout: 15000 })).toBeInTheDocument();
    }
    const nav = within(header).getByRole("navigation", { name: "Navigation principale" });
    expect(within(nav).getByRole("link", { name: "Catalogue" })).toHaveAttribute("aria-current", "page");

    // La barre latérale ne double pas les onglets de la page : une entrée
    // Catalogue, puis le renvoi Référentiels.
    const aside = await shellPart("aside");
    expect(within(aside).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Catalogue", "/admin/catalogue"],
      ["Référentiels", "/admin/parametres"],
    ]);
    expect(within(aside).getByRole("link", { name: "Catalogue" })).toHaveAttribute("aria-current", "page");
  });

  test("/admin/systeme s'affiche dans la coquille Strata", async () => {
    renderApp(
      "/admin/systeme",
      strataApi(OWNER_PERMS, {
        "GET /api/system": { body: { version: "0.1.0", dataDir: "/d", urls: [] } },
        "GET /api/system/update": {
          body: {
            current: "0.1.0",
            repo: "a/b",
            autoCheck: true,
            previous: null,
            status: { phase: "idle", progress: 0, message: "", latest: null },
          },
        },
      }),
    );
    const header = await strataHeader();
    expect(within(header).getByRole("button", { name: "Administration" })).toHaveAttribute("aria-current", "page");
    const aside = await shellPart("aside");
    expect(within(aside).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Espace",
      "Utilisateurs",
      "Paramètres",
      "Système",
    ]);
    expect(within(aside).getByRole("link", { name: "Système" })).toHaveAttribute("aria-current", "page");
    const main = document.querySelector("main#main-content") as HTMLElement;
    expect(await within(main).findByText("Mises à jour", {}, { timeout: 15000 })).toBeInTheDocument();
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

  test("bloc [data-interface=\"strata\"] : rail de 240 px et topbar de 46 px", () => {
    const strata = block('[data-interface="strata"]');
    expect(strata).toMatch(/--rail-width:\s*240px;/);
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
