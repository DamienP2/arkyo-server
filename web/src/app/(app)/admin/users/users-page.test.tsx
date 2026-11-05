/**
 * `/admin/users` : page Utilisateurs reprise d'arkyo (Liste · Rôle · Permissions
 * dans la topbar), branchée sur l'API simulée aux formes de la Task 8
 * (membres = comptes locaux, invitation = compte + mot de passe provisoire).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  renderApp,
  resetApp,
  sentBody,
  signedInApi,
  TECH_PERMS,
  type Api,
} from "@/tests/app-harness";

const ALL_ADMIN = { projects: "admin", design: "admin", catalog: "admin", members: "admin", settings: "admin" };
const TECH = { projects: "write", design: "read", catalog: "read", members: "none", settings: "none" };

const role = (id: string, key: string, label: string, color: string, extra: object = {}) => ({
  id,
  key,
  label,
  color,
  isOwner: false,
  isBuiltin: true,
  permissions: TECH,
  memberCount: 0,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...extra,
});

const OWNER_ROLE = role("r0", "owner", "Propriétaire", "#8b5cf6", {
  isOwner: true,
  permissions: ALL_ADMIN,
  memberCount: 1,
});
const TECH_ROLE = role("r1", "technicien", "Technicien", "#22c55e");

/** Membre au format de `GET /api/tenant/members` (Task 8). */
const member = (id: string, email: string, name: string | null, roleKey: string) => ({
  id,
  userId: id,
  membershipId: id,
  email,
  name,
  username: null,
  user: { id, email, name, username: null, isActive: true, createdAt: "2026-11-01T10:00:00.000Z", profile: null },
  role: roleKey === "owner" ? "OWNER" : "TECHNICIEN",
  roleKey,
  tenantRole: null,
  isActive: true,
  isPending: false,
  invitedEmail: null,
  invitedAt: "2026-11-01T10:00:00.000Z",
  acceptedAt: "2026-11-01T10:00:00.000Z",
  createdAt: "2026-11-01T10:00:00.000Z",
});
const ADMIN = member("u1", "admin@regie.fr", "Admin", "owner");
const LEA = member("u2", "lea@regie.fr", "lea", "technicien");

function usersApi(extra: Api = {}): Api {
  return {
    ...signedInApi(),
    "GET /api/tenant/members": { body: [ADMIN] },
    "GET /api/tenant/roles": { body: [OWNER_ROLE, TECH_ROLE] },
    ...extra,
  };
}

async function topbarTab(label: string) {
  const header = await waitFor(() => {
    const el = document.querySelector("header");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
  return within(header).findByRole("button", { name: label }, { timeout: 5000 });
}

beforeAll(async () => {
  await import("@/app/(app)/admin/users/page");
}, 30000);
beforeEach(() => {
  window.localStorage.clear();
});
afterEach(resetApp);

describe("/admin/users", () => {
  test("onglets Liste · Rôle · Permissions dans la topbar, membres de l'API", async () => {
    renderApp("/admin/users", usersApi());
    for (const label of ["Liste", "Rôle", "Permissions"]) await topbarTab(label);
    expect(await screen.findByText("admin@regie.fr")).toBeTruthy();
  });

  test("invite_dialog_shows_temp_password_once", async () => {
    let members = [ADMIN];
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { fetchSpy } = renderApp(
      "/admin/users",
      usersApi({
        "GET /api/tenant/members": () => ({ body: members }),
        "POST /api/tenant/members": () => {
          members = [ADMIN, LEA];
          return { status: 201, body: { ...LEA, temporaryPassword: "Kp7mWq2xRt9z" } };
        },
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /Inviter un membre/ }));
    const dialog = await screen.findByRole("dialog");
    // Pas d'email d'invitation : le compte est créé avec un mot de passe provisoire.
    expect(within(dialog).queryByText(/invitation par email/)).toBeNull();
    fireEvent.change(within(dialog).getByPlaceholderText("membre@exemple.com"), {
      target: { value: "lea@regie.fr" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Inviter" }));

    // Le mot de passe provisoire s'affiche une fois, avec « Copier ».
    const shown = await screen.findByText("Kp7mWq2xRt9z");
    expect(sentBody(fetchSpy, "POST", "/api/tenant/members")).toEqual({
      email: "lea@regie.fr",
      roleKey: "technicien",
    });
    const pwDialog = shown.closest("[role=dialog]") as HTMLElement;
    fireEvent.click(within(pwDialog).getByRole("button", { name: /Copier/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Kp7mWq2xRt9z"));
    expect(await within(pwDialog).findByText("Copié")).toBeTruthy();

    // Le nouveau membre apparaît (rechargement de la liste).
    const main = document.querySelector("main") as HTMLElement;
    expect(await within(main).findByText("lea@regie.fr")).toBeTruthy();

    fireEvent.click(within(pwDialog).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByText("Kp7mWq2xRt9z")).toBeNull());

    // Rouvrir l'invitation ne le réaffiche pas.
    fireEvent.click(screen.getAllByRole("button", { name: /Inviter un membre/ })[0]);
    await screen.findByRole("dialog");
    expect(screen.queryByText("Kp7mWq2xRt9z")).toBeNull();
  });

  test("invitation : le nom facultatif est envoyé quand il est saisi", async () => {
    const { fetchSpy } = renderApp(
      "/admin/users",
      usersApi({
        "POST /api/tenant/members": {
          status: 201,
          body: { ...LEA, name: "Léa Martin", temporaryPassword: "Kp7mWq2xRt9z" },
        },
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Inviter un membre/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("membre@exemple.com"), {
      target: { value: "lea@regie.fr" },
    });
    fireEvent.change(within(dialog).getByPlaceholderText("Prénom Nom"), {
      target: { value: "Léa Martin" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Inviter" }));
    await screen.findByText("Kp7mWq2xRt9z");
    expect(sentBody(fetchSpy, "POST", "/api/tenant/members")).toEqual({
      email: "lea@regie.fr",
      name: "Léa Martin",
      roleKey: "technicien",
    });
  });

  test("invitation refusée : le message de l'API reste dans la boîte", async () => {
    renderApp(
      "/admin/users",
      usersApi({ "POST /api/tenant/members": { status: 409, body: { error: "Déjà membre ou invité" } } }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Inviter un membre/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("membre@exemple.com"), {
      target: { value: "admin@regie.fr" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Inviter" }));
    expect(await within(dialog).findByText("Déjà membre ou invité")).toBeTruthy();
  });

  test("roles_panel_crud", async () => {
    let roles = [OWNER_ROLE, TECH_ROLE];
    const CADREUR = role("r9", "custom-cadreur-x", "Cadreur", "#8b5cf6", { isBuiltin: false });
    const { fetchSpy } = renderApp(
      "/admin/users",
      usersApi({
        "GET /api/tenant/roles": () => ({ body: roles }),
        "POST /api/tenant/roles": () => {
          roles = [...roles, CADREUR];
          return { status: 201, body: CADREUR };
        },
        "PATCH /api/tenant/roles/r9": (init) => ({
          body: { ...CADREUR, ...JSON.parse(String(init?.body)) },
        }),
        "DELETE /api/tenant/roles/r9": { body: { ok: true } },
      }),
    );
    fireEvent.click(await topbarTab("Rôle"));

    // Créer
    fireEvent.click(await screen.findByRole("button", { name: /Ajouter un rôle/ }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("Cadreur, Ingénieur du son…"), {
      target: { value: "Cadreur" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sentBody(fetchSpy, "POST", "/api/tenant/roles")).toEqual({ label: "Cadreur", color: "#8b5cf6" });
    const card = (await screen.findByText("Cadreur")).closest(".group") as HTMLElement;

    // Renommer
    fireEvent.click(within(card).getByTitle("Modifier"));
    dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByPlaceholderText("Cadreur, Ingénieur du son…");
    fireEvent.change(input, { target: { value: "Cadreur HF" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Cadreur HF")).toBeTruthy();
    expect(sentBody(fetchSpy, "PATCH", "/api/tenant/roles/r9")).toEqual({ label: "Cadreur HF", color: "#8b5cf6" });

    // Supprimer
    const card2 = screen.getByText("Cadreur HF").closest(".group") as HTMLElement;
    fireEvent.click(within(card2).getByTitle("Supprimer"));
    const confirm = await screen.findByRole("dialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(screen.queryByText("Cadreur HF")).toBeNull());
    expect(
      fetchSpy.mock.calls.some(
        ([u, init]) => String(u) === "/api/tenant/roles/r9" && init?.method === "DELETE",
      ),
    ).toBe(true);
    // Les rôles intégrés ne se suppriment pas.
    const techCard = screen.getByText("Technicien").closest(".group") as HTMLElement;
    expect(within(techCard).queryByTitle("Supprimer")).toBeNull();
  });

  test("sans members:admin, renvoie vers /dashboard comme arkyo", async () => {
    const { router } = renderApp("/admin/users", usersApi(signedInApi(TECH_PERMS)));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
  });

  test("échec de chargement : erreur et « Réessayer »", async () => {
    let fail = true;
    renderApp(
      "/admin/users",
      usersApi({
        "GET /api/tenant/members": () =>
          fail ? { status: 500, body: { error: "Erreur serveur" } } : { body: [ADMIN] },
      }),
    );
    expect(await screen.findByText("Erreur serveur", {}, { timeout: 5000 })).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("admin@regie.fr")).toBeTruthy();
  });
});
