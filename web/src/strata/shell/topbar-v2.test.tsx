/**
 * Topbar Strata v2 (spec v2 §4.3) : onglets `Projets` · `Catalogue` ·
 * `Administration ▾`, emplacement ⌘K, présence, notifications, langue, thème,
 * badge de rôle et profil (menus de la topbar Classique). Pas de barre
 * latérale : chaque entrée du rail Classique est atteignable par la topbar ou
 * par les filtres de la page Projets.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, renderApp, resetApp, signedInApi, TECH_PERMS, type Api } from "@/tests/app-harness";
import { isItemActive, sectionOf, STRATA_NAV } from "@/strata/shell/nav-model";
import { STRATA_PALETTE_EVENT } from "@/strata/shell/topbar-v2";

const CATALOGUE_API: Api = {
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
};

const strataApi = (perms: unknown = OWNER_PERMS, extra: Api = {}): Api => ({
  ...signedInApi(perms, "Régie A", "strata"),
  "GET /api/projects?stats=tasks": { body: [] },
  "GET /api/racks": { body: [] },
  "GET /api/panels": { body: [] },
  ...CATALOGUE_API,
  ...extra,
});

beforeAll(async () => {
  await Promise.all([
    import("@/strata/pages/projects-page"),
    import("@/app/(app)/templates/page"),
    import("@/strata/pages/catalogue-page"),
    import("@/app/(app)/admin/espace/page"),
  ]);
}, 60000);

afterEach(() => {
  resetApp();
  delete document.documentElement.dataset.interface;
});

/** Topbar v2 montée : sa navigation principale est dans le header. */
async function strataHeader(): Promise<HTMLElement> {
  const header = await waitFor(
    () => {
      const el = document.querySelector("header");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    },
    { timeout: 15000 },
  );
  await within(header).findByRole("navigation", { name: "Navigation principale" }, { timeout: 15000 });
  return header;
}

const mainNav = (header: HTMLElement) => within(header).getByRole("navigation", { name: "Navigation principale" });

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

const allItems = () => STRATA_NAV.flatMap((s) => s.items);

describe("modèle de navigation Strata v2", () => {
  test("sections dans l'ordre des onglets", () => {
    expect(STRATA_NAV.map((s) => [s.id, s.label])).toEqual([
      ["projets", "Projets"],
      ["catalogue", "Catalogue"],
      ["administration", "Administration"],
    ]);
  });

  test("chaque entrée du rail Classique a sa place, avec la même permission", () => {
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
    for (const entry of rail) {
      const item = allItems().find((i) => i.href === entry.href);
      expect(item, entry.href).toBeDefined();
      expect(item!.perm, entry.href).toEqual(entry.perm);
    }
  });

  test("sectionOf rattache chaque page à son onglet", () => {
    expect(sectionOf("/dashboard")).toBe("projets");
    expect(sectionOf("/projects")).toBe("projets");
    expect(sectionOf("/templates")).toBe("catalogue");
    expect(sectionOf("/racks/r1")).toBe("catalogue");
    expect(sectionOf("/rigs/g1/rack/r1")).toBe("catalogue");
    expect(sectionOf("/panels")).toBe("catalogue");
    expect(sectionOf("/admin/catalogue")).toBe("catalogue");
    expect(sectionOf("/admin/catalogue/equipment/e1")).toBe("catalogue");
    expect(sectionOf("/admin/systeme")).toBe("administration");
    expect(sectionOf("/admin/users")).toBe("administration");
    expect(sectionOf("/profile")).toBeNull();
  });

  test("entrée active sur les sous-pages, comme le rail Classique", () => {
    const item = (href: string) => allItems().find((i) => i.href === href)!;
    expect(isItemActive(item("/templates?tab=panels"), "/templates", "panels")).toBe(true);
    expect(isItemActive(item("/templates?tab=racks"), "/templates", null)).toBe(true);
    expect(isItemActive(item("/templates?tab=racks"), "/racks/r1", null)).toBe(true);
    expect(isItemActive(item("/templates?tab=panels"), "/panels/p1", null)).toBe(true);
    expect(isItemActive(item("/admin/catalogue"), "/admin/catalogue/equipment/e1", null)).toBe(true);
    expect(isItemActive(item("/admin/catalogue"), "/admin/parametres", null)).toBe(false);
  });
});

describe("topbar v2", () => {
  test("onglets Projets, Catalogue, Administration et menus de la topbar Classique", async () => {
    const onPalette = vi.fn();
    window.addEventListener(STRATA_PALETTE_EVENT, onPalette);
    try {
      renderApp("/dashboard", strataApi());
      const header = await strataHeader();
      const nav = mainNav(header);
      expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
        ["Projets", "/dashboard"],
        ["Catalogue", "/admin/catalogue"],
      ]);
      expect(within(nav).getByRole("link", { name: "Projets" })).toHaveAttribute("aria-current", "page");
      expect(within(nav).getByRole("button", { name: "Administration" })).toHaveAttribute("aria-haspopup", "menu");
      // Plus d'onglet Modèles : les modèles vivent dans Catalogue.
      expect(within(nav).queryByRole("link", { name: "Modèles" })).toBeNull();

      // Nom du site, badge de rôle et menus de la topbar Classique.
      expect(within(header).getByText("Régie A")).toBeInTheDocument();
      expect(within(header).getByText("PROPRIÉTAIRE")).toBeInTheDocument();
      for (const name of ["Notifications", "Langue", "Profil", "Thème"]) {
        expect(within(header).getByRole("button", { name })).toBeInTheDocument();
      }

      // Emplacement ⌘K : ouvre la palette (évènement écouté par la palette).
      fireEvent.click(within(header).getByRole("button", { name: "Rechercher ou agir (⌘K)" }));
      expect(onPalette).toHaveBeenCalledTimes(1);

      // Aucune barre latérale en Strata v2 ; le contenu reste dans `main`.
      expect(document.querySelector("aside")).toBeNull();
      expect(document.querySelector("main#main-content")).not.toBeNull();
    } finally {
      window.removeEventListener(STRATA_PALETTE_EVENT, onPalette);
    }
  });

  test("le menu Administration liste Espace, Utilisateurs, Catalogue, Paramètres, Système", async () => {
    renderApp("/dashboard", strataApi());
    const header = await strataHeader();
    fireEvent.click(within(header).getByRole("button", { name: "Administration" }));
    const menu = await within(header).findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Espace", "/admin/espace"],
      ["Utilisateurs", "/admin/users"],
      ["Catalogue", "/admin/catalogue"],
      ["Paramètres", "/admin/parametres"],
      ["Système", "/admin/systeme"],
    ]);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(within(header).queryByRole("menu")).toBeNull());
  });

  test("topbar v2 : onglets et menus filtrés par permission", async () => {
    // Technicien : catalog:read < admin, design:read, ni members ni settings.
    renderApp("/dashboard", strataApi(TECH_PERMS));
    let header = await strataHeader();
    let nav = mainNav(header);
    expect(within(nav).getByRole("link", { name: "Projets" })).toHaveAttribute("href", "/dashboard");
    // Catalogue mène aux modèles, seule partie permise.
    expect(within(nav).getByRole("link", { name: "Catalogue" })).toHaveAttribute("href", "/templates?tab=racks");
    expect(within(nav).queryByRole("button", { name: "Administration" })).toBeNull();
    resetApp();

    // members:admin seul : le menu ne liste qu'Utilisateurs ; design:none et
    // catalog:read : pas d'onglet Catalogue.
    renderApp(
      "/dashboard",
      strataApi({
        ...TECH_PERMS,
        permissions: { ...TECH_PERMS.permissions, design: "none", members: "admin" },
      }),
    );
    header = await strataHeader();
    nav = mainNav(header);
    expect(within(nav).queryByRole("link", { name: "Catalogue" })).toBeNull();
    fireEvent.click(within(nav).getByRole("button", { name: "Administration" }));
    const menu = await within(header).findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((a) => a.textContent)).toEqual(["Utilisateurs"]);
  });

  test("Modèles : navigation Contenants · Panels · Dossiers sur leurs pages", async () => {
    renderApp("/templates?tab=panels", strataApi());
    const header = await strataHeader();
    expect(within(mainNav(header)).getByRole("link", { name: "Catalogue" })).toHaveAttribute("aria-current", "page");
    // Plus de navigation `Catalogue` · `Modèles` : les onglets de la page Catalogue la remplacent.
    expect(within(header).queryByRole("navigation", { name: "Catalogue" })).toBeNull();
    const modeles = within(header).getByRole("navigation", { name: "Modèles" });
    expect(within(modeles).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Contenants", "/templates?tab=racks"],
      ["Panels", "/templates?tab=panels"],
      ["Dossiers", "/templates?tab=dossiers"],
    ]);
    expect(within(modeles).getByRole("link", { name: "Panels" })).toHaveAttribute("aria-current", "page");
  });

  test("/admin/catalogue : onglets de la page, sans navigation de section", async () => {
    renderApp("/admin/catalogue", strataApi());
    const header = await strataHeader();
    const tabs = await screen.findByRole("tablist", { name: "Catalogue" }, { timeout: 15000 });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent?.replace(/\d+$/, ""))).toEqual([
      "Équipements",
      "Câbles",
      "Adaptateurs",
      "Modèles",
    ]);
    expect(within(mainNav(header)).getByRole("link", { name: "Catalogue" })).toHaveAttribute("aria-current", "page");
    expect(within(header).queryByRole("navigation", { name: "Catalogue" })).toBeNull();
    expect(within(header).queryByRole("navigation", { name: "Modèles" })).toBeNull();
  });

  test("onglets de page rendus dans la topbar", async () => {
    renderApp(
      "/admin/espace",
      strataApi(OWNER_PERMS, {
        "GET /api/tenant/espace/informations": { body: { id: "site", name: "Régie A", logoUrl: null } },
      }),
    );
    const header = await strataHeader();
    expect(await within(header).findByRole("button", { name: "Informations" }, { timeout: 15000 })).toBeInTheDocument();
  });

  test("/admin/systeme s'affiche dans la coquille Strata, Administration actif", async () => {
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
    const admin = within(mainNav(header)).getByRole("button", { name: "Administration" });
    expect(admin).toHaveAttribute("aria-current", "page");
    fireEvent.click(admin);
    const menu = await within(header).findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Système" })).toHaveAttribute("aria-current", "page");
    const main = document.querySelector("main#main-content") as HTMLElement;
    expect(await within(main).findByText("Mises à jour", {}, { timeout: 15000 })).toBeInTheDocument();
  });
});

describe("toutes les entrées du rail Classique atteignables", () => {
  /**
   * Pour chaque entrée du rail visible avec ces permissions : la page s'ouvre
   * en Strata et sa place dans la navigation Strata la désigne (lien de la
   * topbar ou du menu Administration, ou filtre de la page Projets).
   */
  async function checkRail(perms: typeof OWNER_PERMS) {
    const order = ["none", "read", "write", "admin"];
    const has = (domain: string, level: string) =>
      perms.isOwner ||
      order.indexOf((perms.permissions as Record<string, string>)[domain]) >= order.indexOf(level);
    // Entrées que le rail Classique montre avec ces permissions.
    const visible = railEntries().filter((e) => !e.perm || has(e.perm.domain, e.perm.level));
    expect(visible.length).toBeGreaterThan(0);
    for (const entry of visible) {
      const item = allItems().find((i) => i.href === entry.href)!;
      renderApp(entry.href, strataApi(perms));
      const header = await strataHeader();
      if (item.filter) {
        const filters = await screen.findByRole("group", { name: "Type d'intervention" }, { timeout: 15000 });
        expect(within(filters).getByRole("button", { name: item.label }), entry.href).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(within(mainNav(header)).getByRole("link", { name: "Projets" })).toHaveAttribute("aria-current", "page");
      } else {
        const admin = within(mainNav(header)).queryByRole("button", { name: "Administration" });
        if (admin) fireEvent.click(admin);
        const links = [...within(header).queryAllByRole("link"), ...within(header).queryAllByRole("menuitem")].filter(
          (a) => a.getAttribute("href") === entry.href,
        );
        expect(links.length, entry.href).toBeGreaterThan(0);
      }
      resetApp();
    }
  }

  test("propriétaire", async () => {
    await checkRail(OWNER_PERMS);
  }, 60000);

  test("technicien", async () => {
    await checkRail(TECH_PERMS);
  }, 60000);
});
