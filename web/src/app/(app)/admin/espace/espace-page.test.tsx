/**
 * `/admin/espace` (onglet Informations seul, décision 9), `/settings` → espace,
 * et le nom et le logo du site dans la topbar.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  OWNER_PERMS,
  renderApp,
  resetApp,
  sentBody,
  signedInApi,
  TECH_PERMS,
  type Api,
} from "@/tests/app-harness";

const LOGO = "/uploads/tenant-logos/logo.png";

function espaceApi(extra: Api = {}): Api {
  let site = { id: "site", name: "Régie A", logoUrl: null as string | null };
  return {
    ...signedInApi(),
    "GET /api/site": () => ({ body: { name: site.name, logoUrl: site.logoUrl } }),
    "GET /api/tenant/espace/informations": () => ({ body: site }),
    "PATCH /api/tenant/espace/informations": (init) => {
      site = { ...site, ...JSON.parse(String(init?.body)) };
      return { body: { ...site, updatedAt: "2026-11-05T10:00:00.000Z" } };
    },
    "POST /api/upload": { body: { url: LOGO } },
    "POST /api/admin/purge": { body: { ok: true } },
    ...extra,
  };
}

function header() {
  return document.querySelector("header") as HTMLElement;
}

beforeAll(async () => {
  await import("@/app/(app)/admin/espace/page");
}, 30000);
beforeEach(() => {
  window.localStorage.clear();
});
afterEach(resetApp);

describe("/admin/espace", () => {
  test("onglet Informations seul : ni abonnement, ni factures, ni suppression de l'espace", async () => {
    renderApp("/admin/espace", espaceApi());
    expect(await screen.findByText("Informations de l'espace", {}, { timeout: 5000 })).toBeTruthy();
    const tabs = within(header());
    expect(tabs.getByRole("button", { name: /Informations/ })).toBeTruthy();
    expect(tabs.queryByRole("button", { name: /Abonnements/ })).toBeNull();
    expect(tabs.queryByRole("button", { name: /Factures/ })).toBeNull();
    expect(screen.queryByText("Supprimer mon espace")).toBeNull();
    expect(screen.queryByText(/arkyo\.app/)).toBeNull();
    expect(screen.queryByText("Plan")).toBeNull();
    // Zone dangereuse : « Vider les référentiels » reste.
    expect(screen.getByText("Vider les référentiels")).toBeTruthy();
  });

  test("espace_informations_saves_name_and_logo", async () => {
    const { fetchSpy } = renderApp("/admin/espace", espaceApi());
    const name = (await screen.findByLabelText("Nom de l'espace", {}, { timeout: 5000 })) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe("Régie A"));
    fireEvent.change(name, { target: { value: "Régie B" } });

    const file = new File(["png"], "logo.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(await screen.findByText("logo.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PATCH", "/api/tenant/espace/informations")).toEqual({
        name: "Régie B",
        logoUrl: LOGO,
      }),
    );
    expect(await screen.findByText("Informations enregistrées")).toBeTruthy();

    // La topbar relit le site (router.refresh) : nouveau nom.
    await waitFor(() => expect(within(header()).getByText("Régie B")).toBeTruthy());
  });

  test("non propriétaire avec settings:admin : lecture seule", async () => {
    renderApp(
      "/admin/espace",
      espaceApi(
        signedInApi({ ...OWNER_PERMS, isOwner: false, roleKey: "admin" }),
      ),
    );
    expect(await screen.findByText(/Lecture seule/, {}, { timeout: 5000 })).toBeTruthy();
    expect((screen.getByLabelText("Nom de l'espace") as HTMLInputElement).disabled).toBe(true);
  });

  test("sans settings:admin, renvoie vers /dashboard comme arkyo", async () => {
    const { router } = renderApp("/admin/espace", espaceApi(signedInApi(TECH_PERMS)));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
  });

  test("échec de chargement : erreur et « Réessayer »", async () => {
    let fail = true;
    renderApp(
      "/admin/espace",
      espaceApi({
        "GET /api/tenant/espace/informations": () =>
          fail ? { status: 500, body: { error: "Erreur serveur" } } : { body: { id: "site", name: "Régie A", logoUrl: null } },
      }),
    );
    expect(await screen.findByText("Erreur serveur", {}, { timeout: 5000 })).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Informations de l'espace")).toBeTruthy();
  });

  test("vider un référentiel : POST /api/admin/purge", async () => {
    const { fetchSpy } = renderApp("/admin/espace", espaceApi());
    fireEvent.click(await screen.findByRole("button", { name: /Fabricants/ }, { timeout: 5000 }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Vider" }));
    await waitFor(() => expect(sentBody(fetchSpy, "POST", "/api/admin/purge")).toEqual({ target: "brands" }));
  });
});

describe("/settings", () => {
  test("redirige vers /admin/espace comme arkyo", async () => {
    // React et react-router journalisent la redirection levée au rendu : attendu ici.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { router } = renderApp("/settings", espaceApi());
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/espace"));
    expect(await screen.findByText("Informations de l'espace", {}, { timeout: 5000 })).toBeTruthy();
  });
});

describe("topbar", () => {
  test("topbar_shows_site_name", async () => {
    renderApp("/admin/espace", espaceApi({ "GET /api/site": { body: { name: "régie a", logoUrl: LOGO } } }));
    // Lockup Strata, séparateur, puis nom du site (Title Case), comme arkyo : pas de logo.
    await waitFor(() => expect(within(header()).getByText("Régie A")).toBeTruthy());
    const link = within(header()).getByText("Régie A").closest("a") as HTMLElement;
    const sep = within(link).getByText("|");
    expect(
      sep.compareDocumentPosition(within(link).getByText("Régie A")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(link.querySelector("img")).toBeNull();
  });
});
