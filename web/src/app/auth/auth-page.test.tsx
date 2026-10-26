import { afterEach, describe, expect, test } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { OWNER_SESSION, renderApp, sentBody, signedInApi, type Api, resetApp } from "@/tests/app-harness";

afterEach(resetApp);

const signedOut: Api = {
  "GET /api/auth/state": { body: { needsSetup: false, local: true } },
  "GET /api/auth/session": { body: null },
};

async function submitLogin(identifier: string, password: string) {
  fireEvent.change(await screen.findByLabelText("Identifiant"), {
    target: { value: identifier },
  });
  fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: password } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Se connecter" })));
}

describe("page de connexion", () => {
  test("sans utilisateur, /auth redirige vers /auth/setup", async () => {
    const { router } = renderApp("/auth", {
      ...signedOut,
      "GET /api/auth/state": { body: { needsSetup: true, local: true } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/setup"));
    expect(await screen.findByLabelText("Confirmation")).toBeInTheDocument();
  });

  test("affiche le lockup Strata Arkyo empilé, thème et langues", async () => {
    renderApp("/auth", signedOut);
    expect(await screen.findByLabelText("Identifiant")).toBeInTheDocument();
    expect(screen.getByLabelText("Strata Arkyo")).toHaveClass("stacked");
    expect(document.querySelector("#flow-auth")).toBeNull();
    expect(screen.getByRole("button", { name: "Mode sombre" })).toBeInTheDocument();
    for (const l of ["fr", "en", "es", "de", "it"]) {
      expect(screen.getByRole("button", { name: l })).toBeInTheDocument();
    }
    await waitFor(() => expect(document.title).toBe("Strata Arkyo | Connexion"));
  });

  test("connexion réussie mène à /dashboard ; erreur 401 affiche « Identifiant ou mot de passe incorrect »", async () => {
    let loggedIn = false;
    let attempts = 0;
    const { router, fetchSpy } = renderApp("/auth", {
      ...signedInApi(),
      "GET /api/auth/state": { body: { needsSetup: false, local: true } },
      "GET /api/auth/session": () => ({ body: loggedIn ? OWNER_SESSION : null }),
      "POST /api/auth/login": () => {
        attempts += 1;
        if (attempts === 1) {
          return { status: 401, body: { error: "Identifiant ou mot de passe incorrect" } };
        }
        loggedIn = true;
        return { body: { user: OWNER_SESSION.user, mustChangePassword: false } };
      },
    });

    await submitLogin("admin", "mauvais");
    expect(await screen.findByText("Identifiant ou mot de passe incorrect")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/auth");

    await submitLogin("admin", "bon-mot-de-passe");
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(sentBody(fetchSpy, "POST", "/api/auth/login")).toEqual({
      identifier: "admin",
      password: "bon-mot-de-passe",
    });
    expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
  });

  test("mustChangePassword renvoie vers /auth/password", async () => {
    let loggedIn = false;
    const { router } = renderApp("/auth", {
      "GET /api/auth/state": { body: { needsSetup: false, local: true } },
      "GET /api/auth/session": () => ({ body: loggedIn ? OWNER_SESSION : null }),
      "POST /api/auth/login": () => {
        loggedIn = true;
        return { body: { user: OWNER_SESSION.user, mustChangePassword: true } };
      },
    });
    await submitLogin("admin", "temporaire");
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/password"));
    expect(await screen.findByLabelText("Mot de passe actuel")).toBeInTheDocument();
  });

  test("compte désactivé : le message du serveur est affiché", async () => {
    renderApp("/auth", {
      ...signedOut,
      "POST /api/auth/login": { status: 403, body: { error: "Compte désactivé" } },
    });
    await submitLogin("admin", "x");
    expect(await screen.findByText("Compte désactivé")).toBeInTheDocument();
  });
});
