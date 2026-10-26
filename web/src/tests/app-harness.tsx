/**
 * Banc de test de la SPA : routeur en mémoire sur l'arbre réel (`routes`),
 * `fetch` simulé par une table « MÉTHODE /chemin » → réponse, et `EventSource`
 * factice (happy-dom n'en fournit pas).
 */

import { vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "@/router";

export type Reply = { status?: number; body: unknown };
export type Handler = (init: RequestInit | undefined) => Reply;
export type Api = Record<string, Reply | Handler>;

export const OWNER_SESSION = {
  user: {
    id: "u1",
    email: "admin@regie.fr",
    name: "Admin",
    role: "OWNER",
    collaboratorRole: null,
  },
  expires: "2099-01-01T00:00:00.000Z",
};

export const OWNER_PERMS = {
  isOwner: true,
  roleKey: "owner",
  permissions: {
    projects: "admin",
    design: "admin",
    catalog: "admin",
    members: "admin",
    settings: "admin",
  },
};

export const TECH_PERMS = {
  isOwner: false,
  roleKey: "technicien",
  permissions: {
    projects: "write",
    design: "read",
    catalog: "read",
    members: "none",
    settings: "none",
  },
};

/** API d'un utilisateur connecté, sur un site nommé `siteName`. */
export function signedInApi(perms: unknown = OWNER_PERMS, siteName = "Régie A"): Api {
  return {
    "GET /api/auth/session": { body: OWNER_SESSION },
    "GET /api/tenant/me/permissions": { body: perms },
    "GET /api/site": { body: { name: siteName } },
    "GET /api/notifications/count": { body: { count: 0 } },
    "GET /api/presence": { body: { members: [] } },
    "POST /api/presence": { body: { ok: true } },
  };
}

class FakeEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {}
  close() {}
}

/** Installe le `fetch` simulé ; renvoie l'espion pour inspecter les appels. */
export function mockApi(api: Api) {
  vi.stubGlobal("EventSource", FakeEventSource);
  // happy-dom envoie vraiment les beacons (départ de salle de la présence).
  vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    const entry = api[`${method} ${path}`];
    const reply: Reply = entry
      ? typeof entry === "function"
        ? entry(init)
        : entry
      : { status: 404, body: { error: "Not found" } };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

/**
 * Démonte l'application PUIS retire les simulations (le démontage appelle
 * encore `fetch` / `sendBeacon`). À appeler dans `afterEach`.
 */
export function resetApp() {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

/** Rend l'application à `url` avec l'API simulée `api`. */
export function renderApp(url: string, api: Api) {
  const fetchSpy = mockApi(api);
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const utils = render(<RouterProvider router={router} />);
  return { router, fetchSpy, ...utils };
}

/** Corps JSON envoyé par le dernier appel `METHOD path`. */
export function sentBody(fetchSpy: ReturnType<typeof mockApi>, method: string, path: string) {
  const call = [...fetchSpy.mock.calls]
    .reverse()
    .find(
      ([input, init]) =>
        String(input).split("?")[0] === path && (init?.method ?? "GET").toUpperCase() === method,
    );
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
}
