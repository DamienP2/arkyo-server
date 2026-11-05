/**
 * `/profile` : profil repris d'arkyo (Identité · Notifications), branché sur
 * `GET/PATCH /api/tenant/profile` (Task 8). Comptes locaux : email modifié
 * directement (décision 8) et carte « Mot de passe » (`POST /api/auth/password`).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, resetApp, sentBody, signedInApi, type Api } from "@/tests/app-harness";

const PROFILE = {
  id: "u1",
  email: "admin@regie.fr",
  username: "admin",
  name: "Jean Dupont",
  locale: "fr",
  memberRole: "OWNER",
  roleKey: "owner",
  createdAt: "2026-11-01T10:00:00.000Z",
  lastLogin: null,
  profile: {
    firstName: "Jean",
    lastName: "Dupont",
    phone: null,
    company: null,
    jobTitle: null,
    avatarUrl: null,
  },
  tenant: { id: "site", slug: "site", name: "Régie A" },
};

function profileApi(extra: Api = {}): Api {
  return {
    ...signedInApi(),
    "GET /api/tenant/profile": { body: PROFILE },
    "PATCH /api/tenant/profile": { body: { ok: true } },
    "GET /api/notifications": { body: { items: [], count: 0, total: 0, page: 1, pages: 1 } },
    ...extra,
  };
}

/** Carte « Mot de passe » de l'onglet Identité. */
async function passwordCard() {
  const title = await screen.findByText("Mot de passe", {}, { timeout: 5000 });
  return title.closest(".rounded-xl") as HTMLElement;
}

beforeAll(async () => {
  await import("@/app/(app)/profile/page");
}, 30000);
beforeEach(() => {
  window.localStorage.clear();
});
afterEach(resetApp);

describe("/profile", () => {
  test("bandeau et onglet Identité aux valeurs de l'API", async () => {
    renderApp("/profile", profileApi());
    expect(await screen.findByText("Jean Dupont", {}, { timeout: 5000 })).toBeTruthy();
    const main = document.querySelector("main") as HTMLElement;
    expect(within(main).getByText("PROPRIÉTAIRE")).toBeTruthy();
    expect(within(main).getByText("Régie A")).toBeTruthy();
    expect((screen.getByPlaceholderText("Jean") as HTMLInputElement).value).toBe("Jean");
    const header = document.querySelector("header") as HTMLElement;
    expect(within(header).getByRole("button", { name: /Identité/ })).toBeTruthy();
    // Onglet de la topbar (en plus de la cloche « Notifications »).
    expect(within(header).getAllByRole("button", { name: /Notifications/ })).toHaveLength(2);
  });

  test("profile_password_card_changes_password", async () => {
    const { fetchSpy } = renderApp("/profile", profileApi({ "POST /api/auth/password": { body: { ok: true } } }));
    const card = await passwordCard();
    fireEvent.change(within(card).getByLabelText("Mot de passe actuel"), { target: { value: "ancien-mdp" } });
    fireEvent.change(within(card).getByLabelText("Nouveau mot de passe"), { target: { value: "nouveau-mdp-1" } });
    fireEvent.change(within(card).getByLabelText("Confirmation"), { target: { value: "nouveau-mdp-1" } });
    fireEvent.click(within(card).getByRole("button", { name: /Changer le mot de passe/ }));
    expect(await within(card).findByText("Mot de passe modifié.")).toBeTruthy();
    expect(sentBody(fetchSpy, "POST", "/api/auth/password")).toEqual({
      currentPassword: "ancien-mdp",
      newPassword: "nouveau-mdp-1",
    });
    expect((within(card).getByLabelText("Mot de passe actuel") as HTMLInputElement).value).toBe("");
  });

  test("mot de passe : confirmation différente, pas d'envoi", async () => {
    const { fetchSpy } = renderApp("/profile", profileApi());
    const card = await passwordCard();
    fireEvent.change(within(card).getByLabelText("Mot de passe actuel"), { target: { value: "ancien-mdp" } });
    fireEvent.change(within(card).getByLabelText("Nouveau mot de passe"), { target: { value: "nouveau-mdp-1" } });
    fireEvent.change(within(card).getByLabelText("Confirmation"), { target: { value: "autre" } });
    fireEvent.click(within(card).getByRole("button", { name: /Changer le mot de passe/ }));
    expect(await within(card).findByText("Les mots de passe ne correspondent pas.")).toBeTruthy();
    expect(sentBody(fetchSpy, "POST", "/api/auth/password")).toBeUndefined();
  });

  test("mot de passe : erreur de l'API affichée", async () => {
    renderApp(
      "/profile",
      profileApi({ "POST /api/auth/password": { status: 400, body: { error: "Mot de passe actuel incorrect" } } }),
    );
    const card = await passwordCard();
    fireEvent.change(within(card).getByLabelText("Mot de passe actuel"), { target: { value: "faux" } });
    fireEvent.change(within(card).getByLabelText("Nouveau mot de passe"), { target: { value: "nouveau-mdp-1" } });
    fireEvent.change(within(card).getByLabelText("Confirmation"), { target: { value: "nouveau-mdp-1" } });
    fireEvent.click(within(card).getByRole("button", { name: /Changer le mot de passe/ }));
    expect(await within(card).findByText("Mot de passe actuel incorrect")).toBeTruthy();
  });

  test("email modifié directement, sans code (décision 8)", async () => {
    const { fetchSpy } = renderApp("/profile", profileApi());
    await screen.findByText("Jean Dupont", {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: /Modifier/ }));
    fireEvent.change(screen.getByPlaceholderText("nouvelle.adresse@exemple.com"), {
      target: { value: "jean@regie.fr" },
    });
    expect(screen.queryByText(/code de vérification/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer l'email/ }));
    expect(await screen.findByText("Email mis à jour avec succès.")).toBeTruthy();
    expect(sentBody(fetchSpy, "PATCH", "/api/tenant/profile")).toEqual({ email: "jean@regie.fr" });
  });

  test("email déjà utilisé : message de l'API", async () => {
    renderApp(
      "/profile",
      profileApi({ "PATCH /api/tenant/profile": { status: 409, body: { error: "Cet email est déjà utilisé" } } }),
    );
    await screen.findByText("Jean Dupont", {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: /Modifier/ }));
    fireEvent.change(screen.getByPlaceholderText("nouvelle.adresse@exemple.com"), {
      target: { value: "autre@regie.fr" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer l'email/ }));
    expect(await screen.findByText("Cet email est déjà utilisé")).toBeTruthy();
  });

  test("enregistrer l'identité : PATCH /api/tenant/profile d'arkyo", async () => {
    const { fetchSpy } = renderApp("/profile", profileApi());
    const first = (await screen.findByPlaceholderText("Jean", {}, { timeout: 5000 })) as HTMLInputElement;
    fireEvent.change(first, { target: { value: "Jeanne" } });
    fireEvent.click(await screen.findByRole("button", { name: /1 modification non enregistrée/ }));
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PATCH", "/api/tenant/profile")).toEqual({
        firstName: "Jeanne",
        lastName: "Dupont",
        username: "admin",
        phone: null,
        jobTitle: null,
        locale: "fr",
        avatarUrl: null,
      }),
    );
  });

  test("échec de chargement : erreur et « Réessayer »", async () => {
    let fail = true;
    renderApp(
      "/profile",
      profileApi({
        "GET /api/tenant/profile": () => (fail ? { status: 500, body: { error: "Erreur serveur" } } : { body: PROFILE }),
      }),
    );
    expect(await screen.findByText("Erreur serveur", {}, { timeout: 5000 })).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Jean Dupont")).toBeTruthy();
  });
});
