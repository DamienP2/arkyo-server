import { afterEach, describe, expect, test } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { OWNER_SESSION, renderApp, sentBody, signedInApi, resetApp } from "@/tests/app-harness";

afterEach(resetApp);

describe("premier lancement", () => {
  test("setup à distance affiche la consigne au lieu du formulaire", async () => {
    renderApp("/auth/setup", {
      "GET /api/auth/state": { body: { needsSetup: true, local: false } },
      "GET /api/auth/session": { body: null },
    });
    // Texte du brief ; les `…` y marquent du code, rendu en police mono.
    const consigne =
      "Créez le premier compte depuis le serveur : ouvrez http://localhost:8090 sur la machine, ou lancez arkyo-server user add.";
    expect(
      await screen.findByText((_, el) => el?.tagName === "P" && el.textContent === consigne),
    ).toBeInTheDocument();
    expect(screen.getByText("arkyo-server user add").style.fontFamily).toBe("var(--font-mono)");
    expect(screen.queryByLabelText("Mot de passe")).toBeNull();
    expect(screen.queryByRole("button", { name: "Créer le compte" })).toBeNull();
  });

  test("en local, crée le compte propriétaire puis ouvre /dashboard", async () => {
    let created = false;
    const { router, fetchSpy } = renderApp("/auth/setup", {
      ...signedInApi(),
      "GET /api/auth/state": { body: { needsSetup: true, local: true } },
      "GET /api/auth/session": () => ({ body: created ? OWNER_SESSION : null }),
      "POST /api/auth/setup": () => {
        created = true;
        return { body: { user: OWNER_SESSION.user } };
      },
    });
    fireEvent.change(await screen.findByLabelText("Nom"), { target: { value: "Admin" } });
    fireEvent.change(screen.getByLabelText("Adresse email"), {
      target: { value: "admin@regie.fr" },
    });
    fireEvent.change(screen.getByLabelText("Identifiant"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "motdepasse1" } });
    fireEvent.change(screen.getByLabelText("Confirmation"), { target: { value: "motdepasse1" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Créer le compte" })));

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(sentBody(fetchSpy, "POST", "/api/auth/setup")).toEqual({
      name: "Admin",
      email: "admin@regie.fr",
      username: "admin",
      password: "motdepasse1",
    });
  });

  test("confirmation différente : erreur, aucun appel", async () => {
    const { fetchSpy } = renderApp("/auth/setup", {
      "GET /api/auth/state": { body: { needsSetup: true, local: true } },
      "GET /api/auth/session": { body: null },
    });
    fireEvent.change(await screen.findByLabelText("Nom"), { target: { value: "Admin" } });
    fireEvent.change(screen.getByLabelText("Adresse email"), {
      target: { value: "admin@regie.fr" },
    });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "motdepasse1" } });
    fireEvent.change(screen.getByLabelText("Confirmation"), { target: { value: "autre" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Créer le compte" })));
    expect(
      await screen.findByText("Les mots de passe ne correspondent pas"),
    ).toBeInTheDocument();
    expect(sentBody(fetchSpy, "POST", "/api/auth/setup")).toBeUndefined();
  });

  test("déjà configuré : /auth/setup renvoie vers /auth", async () => {
    const { router } = renderApp("/auth/setup", {
      "GET /api/auth/state": { body: { needsSetup: false, local: true } },
      "GET /api/auth/session": { body: null },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth"));
  });
});
