import { afterEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp, signedInApi, TECH_PERMS, resetApp } from "@/tests/app-harness";

afterEach(resetApp);

describe("routeur et coquille", () => {
  test("une URL non portée affiche « Bientôt disponible » dans la coquille", async () => {
    renderApp("/racks/r1", signedInApi());
    expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
    // Coquille : topbar (lockup + nom du site) et sidebar.
    const header = document.querySelector("header")!;
    expect(within(header).getByText("Régie A")).toBeInTheDocument();
    expect(within(header).getByText("PROPRIÉTAIRE")).toBeInTheDocument();
    expect(document.querySelector("aside")).not.toBeNull();
    expect(document.querySelector("main#main-content")).not.toBeNull();
  });

  test("/ redirige vers /dashboard", async () => {
    const { router } = renderApp("/", signedInApi());
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
  });

  test("sans session, la coquille renvoie vers /auth", async () => {
    const { router } = renderApp("/dashboard", {
      "GET /api/auth/state": { body: { needsSetup: false, local: true } },
      "GET /api/auth/session": { body: null },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth"));
  });

  test("mustChangePassword renvoie vers /auth/password", async () => {
    const { router } = renderApp("/dashboard", {
      ...signedInApi(),
      "GET /api/tenant/me/permissions": {
        status: 403,
        body: { error: "Changement de mot de passe requis", code: "PASSWORD_CHANGE_REQUIRED" },
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/password"));
  });

  test("la sidebar n'affiche pas Support et montre Système seulement avec settings:admin", async () => {
    const owner = renderApp("/dashboard", signedInApi());
    const aside = await waitFor(() => {
      const el = document.querySelector("aside");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(aside).getByText("Dashboard")).toBeInTheDocument();
    expect(within(aside).getByText("Système").closest("a")).toHaveAttribute(
      "href",
      "/admin/systeme",
    );
    expect(within(aside).queryByText("Support")).toBeNull();
    owner.unmount();
    vi.restoreAllMocks();

    renderApp("/dashboard", signedInApi(TECH_PERMS));
    const techAside = await waitFor(() => {
      const el = document.querySelector("aside");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(techAside).getByText("Prestation")).toBeInTheDocument();
    expect(within(techAside).queryByText("Système")).toBeNull();
    expect(within(techAside).queryByText("Support")).toBeNull();
  });

  test("/admin/systeme affiche « Bientôt disponible »", async () => {
    renderApp("/admin/systeme", signedInApi());
    expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
  });

  test("le site sans nom n'affiche que le lockup arkyo.io", async () => {
    renderApp("/dashboard", signedInApi(undefined, ""));
    await screen.findByText("Bientôt disponible");
    const header = document.querySelector("header")!;
    expect(header.querySelector('a[href="/dashboard"]')!.textContent).toBe("arkyo.io");
  });

  test("les éditeurs plein écran s'affichent sans sidebar ni topbar", async () => {
    renderApp("/project/p1/cartographie", signedInApi());
    expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
    expect(document.querySelector("aside")).toBeNull();
    expect(document.querySelector("header")).toBeNull();
  });

  test("une URL inconnue affiche la page 404", async () => {
    renderApp("/support", signedInApi());
    expect(await screen.findByText("This page could not be found.")).toBeInTheDocument();
  });
});
