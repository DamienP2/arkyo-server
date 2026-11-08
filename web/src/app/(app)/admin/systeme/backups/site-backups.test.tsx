import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, resetApp, sentBody, signedInApi } from "@/tests/app-harness";

afterEach(() => {
  vi.useRealTimers();
  resetApp();
});

const settings = { enabled: true, hour: 3, dir: null, keep: 7 };
const backups = [
  { name: "Arkyo-site-2026-11-07T03-00-00.zip", size: 2048, createdAt: "2026-11-07T03:00:00.000Z" },
  { name: "Arkyo-site-2026-11-06T03-00-00.zip", size: 1024, createdAt: "2026-11-06T03:00:00.000Z" },
];

function api(extra = {}, list: Record<string, unknown> = {}) {
  return {
    ...signedInApi(),
    "GET /api/system": { body: { version: "0.1.0", dataDir: "/d", urls: [] } },
    "GET /api/system/update": {
      body: { current: "0.1.0", repo: "r", autoCheck: true, previous: null, status: { phase: "idle", progress: 0, message: "", latest: null } },
    },
    "GET /api/system/backups/projects": { body: [] },
    "GET /api/system/transfer/objects": { body: { projects: [], racks: [], rigs: [], panels: [] } },
    "GET /api/system/backups/site": {
      body: { settings, backups, dir: "/d/backups/site", lastRestore: null, ...list },
    },
    ...extra,
  };
}

describe("Système › sauvegarde du site", () => {
  test("dernière sauvegarde et liste", async () => {
    renderApp("/admin/systeme", api());
    expect(await screen.findByText(/Dernière sauvegarde :/)).toBeInTheDocument();
    expect(screen.getByText("Arkyo-site-2026-11-07T03-00-00.zip")).toBeInTheDocument();
    expect(screen.getByText(/2,0 Ko/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Télécharger Arkyo-site-2026-11-06T03-00-00.zip" })).toBeInTheDocument();
  });

  test("Sauvegarder maintenant : POST, bouton désactivé pendant l'attente", async () => {
    const post = vi.fn(() => ({ status: 200, body: backups[0] }));
    const { fetchSpy } = renderApp("/admin/systeme", api({ "POST /api/system/backups/site": post }));
    const btn = await screen.findByRole("button", { name: "Sauvegarder maintenant" });
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Sauvegarde en cours…" })).toBeDisabled();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sauvegarder maintenant" })).toBeEnabled(),
    );
    expect(fetchSpy).toHaveBeenCalled();
  });

  test("Supprimer : confirmation puis DELETE", async () => {
    const del = vi.fn(() => ({ status: 200, body: {} }));
    renderApp(
      "/admin/systeme",
      api({ [`DELETE /api/system/backups/site/${encodeURIComponent(backups[1].name)}`]: del }),
    );
    fireEvent.click(await screen.findByRole("button", { name: `Supprimer ${backups[1].name}` }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
  });

  test("réglages : enregistrement et erreur Dossier inaccessible", async () => {
    let fail = true;
    const put = vi.fn((init?: RequestInit) => {
      void init;
      return fail
        ? { status: 400, body: { error: "Dossier inaccessible" } }
        : { status: 200, body: { ...settings, dir: "/mnt/nas", hour: 5 } };
    });
    const { fetchSpy } = renderApp("/admin/systeme", api({ "PUT /api/system/backups/settings/site": put }));
    const dir = await screen.findByLabelText("Dossier");
    fireEvent.change(dir, { target: { value: "/nope" } });
    fireEvent.blur(dir);
    expect(await screen.findByText("Dossier inaccessible")).toBeInTheDocument();
    expect(sentBody(fetchSpy, "PUT", "/api/system/backups/settings/site")).toEqual({ ...settings, dir: "/nope" });
    fail = false;
    fireEvent.change(screen.getByLabelText("Heure"), { target: { value: "5" } });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(sentBody(fetchSpy, "PUT", "/api/system/backups/settings/site")).toEqual({ ...settings, hour: 5 });
    await waitFor(() => expect(screen.queryByText("Dossier inaccessible")).toBeNull());
  });

  test("dernière restauration : échec en rouge, succès en date", async () => {
    const { unmount } = renderApp(
      "/admin/systeme",
      api({}, { lastRestore: { ok: false, at: "2026-11-08T10:00:00.000Z", archive: "a.zip", error: "Base illisible" } }),
    );
    const err = await screen.findByText("Base illisible");
    expect(err.className).toContain("--danger-text");
    unmount();
    resetApp();
    renderApp(
      "/admin/systeme",
      api({}, { lastRestore: { ok: true, at: "2026-11-08T10:00:00.000Z", archive: "a.zip" } }),
    );
    expect(await screen.findByText(/Dernière restauration :/)).toBeInTheDocument();
  });

  test("restaurer : confirmation avant l'envoi, attente puis rechargement", async () => {
    let systemCalls = 0;
    const restore = vi.fn(() => ({ status: 200, body: { restarting: true, warning: "Version plus récente" } }));
    const reload = vi.fn();
    const realLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, reload } });
    try {
      renderApp(
        "/admin/systeme",
        api({
          "POST /api/system/backups/site/restore": restore,
          "GET /api/system": () => {
            systemCalls++;
            // Le premier sondage échoue (serveur coupé), les suivants répondent.
            if (systemCalls === 2) throw new TypeError("network");
            return { body: { version: "0.1.0", dataDir: "/d", urls: [] } };
          },
        }),
      );
      const input = await screen.findByLabelText("Archive du site à restaurer");
      fireEvent.change(input, { target: { files: [new File(["z"], "site.zip")] } });
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByText(
          "Toutes les données actuelles seront remplacées. Elles sont mises de côté dans le dossier de données. Le serveur redémarre.",
        ),
      ).toBeInTheDocument();
      expect(restore).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: "Restaurer" }));
      await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
      expect(await screen.findByText("Version plus récente")).toBeInTheDocument();
      expect(screen.getByText(/le serveur redémarre/)).toBeInTheDocument();
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 8000 });
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    }
  }, 15000);

  for (const [status, reloads] of [[401, true], [503, false]] as const) {
    test(`attente : après coupure, un ${status} ${reloads ? "recharge" : "ne recharge pas"}`, async () => {
      let calls = 0;
      const reload = vi.fn();
      const realLocation = window.location;
      Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, reload } });
      try {
        renderApp(
          "/admin/systeme",
          api({
            "POST /api/system/backups/site/restore": { body: { restarting: true } },
            "GET /api/system": () => {
              calls++;
              if (calls === 2) throw new TypeError("network");
              if (calls > 2) return { status, body: { error: "x" } };
              return { body: { version: "0.1.0", dataDir: "/d", urls: [] } };
            },
          }),
        );
        const input = await screen.findByLabelText("Archive du site à restaurer");
        fireEvent.change(input, { target: { files: [new File(["z"], "site.zip")] } });
        const dialog = await screen.findByRole("dialog");
        fireEvent.click(within(dialog).getByRole("button", { name: "Restaurer" }));
        if (reloads) {
          await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 8000 });
        } else {
          await waitFor(() => expect(calls).toBeGreaterThan(3), { timeout: 8000 });
          expect(reload).not.toHaveBeenCalled();
        }
      } finally {
        Object.defineProperty(window, "location", { configurable: true, value: realLocation });
      }
    }, 15000);
  }

  test("restaurer : refus de la confirmation, rien n'est envoyé", async () => {
    const restore = vi.fn(() => ({ status: 200, body: { restarting: true } }));
    renderApp("/admin/systeme", api({ "POST /api/system/backups/site/restore": restore }));
    const input = await screen.findByLabelText("Archive du site à restaurer");
    fireEvent.change(input, { target: { files: [new File(["z"], "site.zip")] } });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(restore).not.toHaveBeenCalled();
  });
});
