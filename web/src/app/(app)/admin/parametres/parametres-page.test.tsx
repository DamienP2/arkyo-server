/**
 * `/admin/parametres` : page Paramètres reprise d'arkyo (9 onglets dans la
 * topbar), branchée sur l'API simulée aux formes des Tasks 3 et 6.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  renderApp,
  resetApp,
  sentBody,
  signedInApi,
  TECH_PERMS,
  type Api,
} from "@/tests/app-harness";

const TAB_LABELS = [
  "Classification",
  "Fabricants",
  "Connecteurs",
  "Signaux",
  "Câblage",
  "Dimensions",
  "Impression",
  "Numérotation",
  "Importer / Exporter",
];

const CONFIG = { cable_pad: "5", cable_sep1: "-", cable_sep2: "", cable_include_rack: "true" };

const EMPTY_CATEGORIES = {
  categories: { arkyo: [], personal: [] },
  functions: { arkyo: [], personal: [] },
  phases: { arkyo: [], personal: [] },
  types: { arkyo: [], personal: [] },
};

const SONY = {
  id: "b1",
  name: "Sony",
  website: "https://sony.com",
  logoUrl: null,
  isActive: true,
};

function parametresApi(extra: Api = {}): Api {
  return {
    ...signedInApi(),
    "GET /api/tenant/parametres/application": { body: CONFIG },
    "GET /api/tenant/parametres/categories": { body: EMPTY_CATEGORIES },
    "GET /api/tenant/parametres/brands": { body: { arkyo: [], personal: [SONY] } },
    ...extra,
  };
}

/** Bouton d'onglet de la topbar. */
async function topbarTab(label: string) {
  const header = await waitFor(() => {
    const el = document.querySelector("header");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
  // Premier rendu : le chunk `lazy()` de la page peut prendre plus d'une seconde
  // quand toute la suite tourne en parallèle.
  return within(header).findByRole("button", { name: label }, { timeout: 5000 });
}

// Charge une fois le module de la page (`lazy()` du routeur) : les tests ne
// dépendent plus du temps de transformation quand toute la suite tourne.
beforeAll(async () => {
  await import("@/app/(app)/admin/parametres/page");
}, 30000);
beforeEach(() => {
  window.localStorage.clear();
});
afterEach(resetApp);

describe("/admin/parametres", () => {
  test("parametres_renders_9_tabs", async () => {
    renderApp("/admin/parametres", parametresApi());
    for (const label of TAB_LABELS) {
      expect(await topbarTab(label)).toBeInTheDocument();
    }
    const header = document.querySelector("header")!;
    const tabs = within(header)
      .getAllByRole("button")
      .filter((b) => TAB_LABELS.includes(b.textContent ?? ""));
    expect(tabs.map((b) => b.textContent)).toEqual(TAB_LABELS);
    // Onglet par défaut : Classification (sous-onglets Catégories / Types).
    expect(await screen.findByRole("button", { name: "Types" })).toBeInTheDocument();
  });

  test("onglet persistant : ?tab= puis localStorage", async () => {
    const first = renderApp("/admin/parametres?tab=fabricants", parametresApi());
    expect(await screen.findByText("Sony")).toBeInTheDocument();
    expect(window.localStorage.getItem("tenant-admin-parametres-tab")).toBe('"brands"');
    first.unmount();
    resetApp();

    renderApp("/admin/parametres", parametresApi());
    expect(await screen.findByText("Sony")).toBeInTheDocument();
  });

  test("sans settings:admin, renvoie vers /dashboard comme arkyo", async () => {
    const { router } = renderApp("/admin/parametres", {
      ...parametresApi(),
      ...signedInApi(TECH_PERMS),
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
  });

  test("brands_tab_lists_and_creates", async () => {
    const created = { ...SONY, id: "b2", name: "Riedel", website: null };
    let brands: Record<string, unknown>[] = [SONY];
    const { fetchSpy } = renderApp(
      "/admin/parametres?tab=fabricants",
      parametresApi({
        "GET /api/tenant/parametres/brands": () => ({
          body: { arkyo: [], personal: brands },
        }),
        "POST /api/tenant/parametres/brands": () => {
          brands = [...brands, created];
          return { status: 201, body: created };
        },
      }),
    );
    expect(await screen.findByText("Sony")).toBeInTheDocument();
    // Aucun badge ni bascule « Catalogue Arkyo » (catalogue unique).
    expect(screen.queryByText("Catalogue Arkyo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Nouveau fabricant/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("Sony, Blackmagic, Riedel…"), {
      target: { value: "Riedel" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer le fabricant" }));

    await waitFor(() =>
      expect(sentBody(fetchSpy, "POST", "/api/tenant/parametres/brands")).toEqual({
        name: "Riedel",
        website: null,
        logoUrl: null,
      }),
    );
    expect(await screen.findByText("Riedel")).toBeInTheDocument();
  });

  test("delete_in_use_shows_arkyo_message", async () => {
    const message =
      "Ce fabricant est utilisé par 2 item(s) du catalogue personnel et ne peut pas être supprimé.";
    renderApp(
      "/admin/parametres?tab=fabricants",
      parametresApi({
        "DELETE /api/tenant/parametres/brands/b1": { status: 409, body: { error: message } },
      }),
    );
    await screen.findByText("Sony");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    const confirm = await screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog"));
    fireEvent.click(within(confirm).getByRole("button", { name: "Supprimer" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText("Sony")).toBeInTheDocument();
  });

  test("numbering_preview_updates", async () => {
    const { fetchSpy } = renderApp(
      "/admin/parametres?tab=numerotation",
      parametresApi({ "PATCH /api/admin/config": { body: { ok: true } } }),
    );
    const preview = await waitFor(() => {
      const code = document.querySelector("main code");
      expect(code).not.toBeNull();
      return code as HTMLElement;
    });
    expect(preview.textContent).toBe("RGA-V10001HD");

    // Séparateur 1 : « Point ».
    fireEvent.click(screen.getAllByTitle("Point")[0]);
    await waitFor(() => expect(document.querySelector("main code")!.textContent).toBe("RGA.V10001HD"));
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PATCH", "/api/admin/config")).toEqual({ cable_sep1: "." }),
    );
  });

  test("print_editor_entry_shows_coming_soon", async () => {
    window.localStorage.setItem("tenant.parametres.print.subtab", "templates");
    renderApp(
      "/admin/parametres?tab=impression",
      parametresApi({
        "GET /api/tenant/parametres/print": {
          body: {
            templates: [
              {
                id: "t1",
                key: "CARTOUCHE_A4",
                name: "Cartouche A4",
                description: null,
                paperFormat: "A4",
                orientation: "LANDSCAPE",
                slots: [],
                layout: null,
                isActive: true,
                sortOrder: 0,
              },
            ],
            settings: null,
          },
        },
      }),
    );
    fireEvent.click(await screen.findByText("Cartouche A4"));
    expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
    // L'entrée se referme et rend la liste.
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByText("Bientôt disponible")).toBeNull());
    expect(screen.getByText("Cartouche A4")).toBeInTheDocument();
  });
});
