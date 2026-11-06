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
    // Page chargée à la demande : premier import plus long.
    expect(
      await screen.findByText("Tous les projets actifs", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  test("une redirection au rendu ne journalise rien, une vraie erreur oui", async () => {
    const spy = vi.spyOn(console, "error");
    const { router } = renderApp("/racks", {
      ...signedInApi(),
      "GET /api/racks": { body: [] },
      "GET /api/panels": { body: [] },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/templates"));
    expect(await screen.findByText("Aucun contenant")).toBeInTheDocument();
    const logged = spy.mock.calls.map((args) => args.map(String).join(" "));
    expect(logged.filter((l) => l.includes("React Router caught"))).toEqual([]);
    resetApp();

    // Une page qui lève une vraie erreur reste journalisée par le banc.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { createMemoryRouter, RouterProvider } = await import("react-router");
    const { onRouterError } = await import("next/navigation");
    const { render } = await import("@testing-library/react");
    const boom = new Error("boom");
    const Boom = () => {
      throw boom;
    };
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: "/", element: <Boom /> }])}
        onError={onRouterError}
      />,
    );
    expect(errors).toHaveBeenCalledWith("React Router caught the following error during render", boom);
  });

  test("redirects_like_arkyo", async () => {
    // arkyo:app/(app)/{projects/[id],racks,rigs,panels}/page.tsx
    for (const [from, to, shown] of [
      // Éditeur projet.
      ["/projects/p1", "/project/p1?tab=fiche", "Projet 1"],
      // `/templates` : onglet Contenants (`?tab=rigs` inconnu → Contenants, comme arkyo).
      ["/racks", "/templates?tab=racks", "Aucun contenant"],
      ["/rigs", "/templates?tab=rigs", "Aucun contenant"],
      // Onglet Panels.
      ["/panels", "/templates?tab=panels", "Aucun panel de patch"],
    ]) {
      const { router, unmount } = renderApp(from, {
        ...signedInApi(TECH_PERMS),
        "GET /api/racks": { body: [] },
        "GET /api/panels": { body: [] },
        "GET /api/tenant/projects/p1/editor": {
          body: {
            header: { id: "p1", name: "Projet 1" },
            fiche: {},
            inventaire: { rigConfigId: null, racks: [], locations: [] },
            cartographie: { maps: [] },
          },
        },
      });
      await waitFor(() =>
        expect(router.state.location.pathname + router.state.location.search).toBe(to),
      );
      expect(await screen.findByText(shown, {}, { timeout: 5000 })).toBeInTheDocument();
      unmount();
      vi.restoreAllMocks();
    }
  });

  test("les redirections gardent la garde d'arkyo (projects:read, design:read)", async () => {
    const none = {
      ...TECH_PERMS,
      roleKey: "aucun",
      permissions: { ...TECH_PERMS.permissions, projects: "none", design: "none" },
    };
    for (const from of ["/projects/p1", "/racks", "/rigs", "/panels"]) {
      const { router, unmount } = renderApp(from, signedInApi(none));
      await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
      unmount();
      vi.restoreAllMocks();
    }
  });

  test("les routes réservées et celles de la phase 4 restent « Bientôt disponible »", async () => {
    for (const url of [
      "/racks/r1",
      "/rigs/g1/rack/r1",
      "/project/p1/inventaire/synoptique",
    ]) {
      const { router, unmount } = renderApp(url, signedInApi());
      expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(url);
      unmount();
      vi.restoreAllMocks();
    }
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

  test("/admin/systeme affiche l'écran Système", async () => {
    renderApp("/admin/systeme", {
      ...signedInApi(),
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
    });
    expect(await screen.findByText("Mises à jour")).toBeInTheDocument();
  });

  test("le site sans nom n'affiche que le lockup Strata Arkyo", async () => {
    renderApp("/dashboard", signedInApi(undefined, ""));
    await screen.findByText("Tous les projets actifs", {}, { timeout: 5000 });
    const header = document.querySelector("header")!;
    expect(header.querySelector('a[href="/dashboard"]')!.textContent).toBe("StrataArkyo");
  });

  test("les éditeurs plein écran s'affichent sans sidebar ni topbar", async () => {
    renderApp("/project/p1/cartographie", signedInApi());
    expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
    expect(document.querySelector("aside")).toBeNull();
    expect(document.querySelector("header")).toBeNull();
  });

  test("/panels/:id ouvre l'éditeur de panel plein écran, sans sidebar ni topbar de l'application", async () => {
    renderApp("/panels/pn1", {
      ...signedInApi(),
      "GET /api/panels/pn1": { body: { id: "pn1", name: "Patch", heightU: 1, slotsPerU: 16, slots: [] } },
      "GET /api/tenant/catalogue/connectors": { body: [] },
      "GET /api/tenant/parametres/categories": { body: { functions: { arkyo: [], personal: [] } } },
    });
    expect(await screen.findByText("Patch", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTitle("Fermer l'édition")).toBeInTheDocument();
    expect(screen.queryByText("Bientôt disponible")).toBeNull();
    expect(document.querySelector("aside")).toBeNull();
    expect(document.querySelector("header")).toBeNull();
  }, 15000);

  test("une URL inconnue affiche la page 404", async () => {
    renderApp("/support", signedInApi());
    expect(await screen.findByText("This page could not be found.")).toBeInTheDocument();
  });
});
