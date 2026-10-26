import { afterEach, describe, expect, test } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { OWNER_PERMS, renderApp, sentBody, signedInApi, resetApp } from "@/tests/app-harness";

afterEach(resetApp);

const REQUIRED = {
  status: 403,
  body: { error: "Changement de mot de passe requis", code: "PASSWORD_CHANGE_REQUIRED" },
};

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("Mot de passe actuel"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Confirmation"), { target: { value: confirm } });
}

describe("changement de mot de passe", () => {
  test("change le mot de passe puis ouvre /dashboard", async () => {
    let changed = false;
    const { router, fetchSpy } = renderApp("/auth/password", {
      ...signedInApi(),
      "GET /api/tenant/me/permissions": () => (changed ? { body: OWNER_PERMS } : REQUIRED),
      "POST /api/auth/password": () => {
        changed = true;
        return { body: { ok: true } };
      },
    });
    await screen.findByLabelText("Mot de passe actuel");
    fill("temporaire", "nouveau-mdp", "nouveau-mdp");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" })),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(sentBody(fetchSpy, "POST", "/api/auth/password")).toEqual({
      currentPassword: "temporaire",
      newPassword: "nouveau-mdp",
    });
  });

  test("affiche l'erreur du serveur", async () => {
    renderApp("/auth/password", {
      ...signedInApi(),
      "POST /api/auth/password": {
        status: 400,
        body: { error: "Mot de passe actuel incorrect" },
      },
    });
    await screen.findByLabelText("Mot de passe actuel");
    fill("faux", "nouveau-mdp", "nouveau-mdp");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" })),
    );
    expect(await screen.findByText("Mot de passe actuel incorrect")).toBeInTheDocument();
  });

  test("confirmation différente : erreur, aucun appel", async () => {
    const { fetchSpy } = renderApp("/auth/password", signedInApi());
    await screen.findByLabelText("Mot de passe actuel");
    fill("temporaire", "nouveau-mdp", "autre");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" })),
    );
    expect(await screen.findByText("Les mots de passe ne correspondent pas")).toBeInTheDocument();
    expect(sentBody(fetchSpy, "POST", "/api/auth/password")).toBeUndefined();
  });

  test("sans session, /auth/password renvoie vers /auth", async () => {
    const { router } = renderApp("/auth/password", {
      "GET /api/auth/state": { body: { needsSetup: false, local: true } },
      "GET /api/auth/session": { body: null },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth"));
  });
});
