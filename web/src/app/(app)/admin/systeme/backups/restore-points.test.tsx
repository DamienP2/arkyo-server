import { afterEach, describe, expect, test, vi } from "vitest";
import { backupsApi, type PointProject } from "./api";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, resetApp, sentBody, signedInApi } from "@/tests/app-harness";

afterEach(resetApp);

const point = (over: Record<string, unknown> = {}) => ({
  id: "20261107T100000Z-manuel",
  projectId: "p1",
  projectName: "Finale",
  kind: "manual",
  label: null,
  createdAt: "2026-11-07T10:00:00.000Z",
  author: { id: "u1", name: "Admin", email: "admin@regie.fr" },
  digest: "abc",
  size: 2048,
  ...over,
});

const projects = [
  { id: "p1", name: "Finale", deleted: false, count: 2, lastPoint: point() },
  { id: "p2", name: "Ancien", deleted: true, count: 1, lastPoint: point({ projectId: "p2", projectName: "Ancien" }) },
];

const settings = { enabled: true, intervalHours: 1, keep: 48 };

function api(extra = {}) {
  return {
    ...signedInApi(),
    "GET /api/system": { body: { version: "0.1.0", dataDir: "/d", urls: [] } },
    "GET /api/system/update": {
      body: { current: "0.1.0", repo: "r", autoCheck: true, previous: null, status: { phase: "idle", progress: 0, message: "", latest: null } },
    },
    "GET /api/system/backups/projects": { body: projects },
    "GET /api/system/backups/projects/p1/points": {
      body: [
        point(),
        point({ id: "x-auto", kind: "auto", createdAt: "2026-11-07T09:00:00.000Z", author: null, size: 3 * 1024 * 1024 }),
        point({ id: "x-avant-restauration", kind: "beforeRestore", createdAt: "2026-11-06T09:00:00.000Z" }),
      ],
    },
    "GET /api/system/backups/settings/projects": { body: settings },
    ...extra,
  };
}

async function openFinale() {
  fireEvent.click(await screen.findByRole("button", { name: /Finale/ }));
  await screen.findByRole("button", { name: "Créer un point" });
}

describe("Système › points de restauration", () => {
  test("liste les projets avec leur dernier point, un projet supprimé est marqué", async () => {
    renderApp("/admin/systeme", api());
    expect(await screen.findByText("Finale")).toBeInTheDocument();
    expect(screen.getByText("Ancien")).toBeInTheDocument();
    expect(screen.getByText("Supprimé")).toBeInTheDocument();
    expect(screen.getAllByText(/07\/11\/2026/).length).toBeGreaterThan(0);
  });

  test("ouvrir un projet montre ses points : type, auteur, taille", async () => {
    renderApp("/admin/systeme", api());
    await openFinale();
    expect(screen.getByText(/Manuel · Admin · 2,0 Ko/)).toBeInTheDocument();
    expect(screen.getByText(/Automatique · 3,0 Mo/)).toBeInTheDocument();
    expect(screen.getByText(/Avant restauration/)).toBeInTheDocument();
  });

  test("Créer un point : POST puis rafraîchissement", async () => {
    let created = 0;
    let lists = 0;
    renderApp(
      "/admin/systeme",
      api({
        "POST /api/system/backups/projects/p1/points": () => {
          created++;
          return { body: point() };
        },
        "GET /api/system/backups/projects/p1/points": () => {
          lists++;
          return { body: [point()] };
        },
      }),
    );
    await openFinale();
    const before = lists;
    fireEvent.click(screen.getByRole("button", { name: "Créer un point" }));
    await waitFor(() => expect(created).toBe(1));
    await waitFor(() => expect(lists).toBeGreaterThan(before));
  });

  test("Restaurer : confirmation puis POST puis toast", async () => {
    let restored = false;
    renderApp(
      "/admin/systeme",
      api({
        "POST /api/system/backups/projects/p1/points/20261107T100000Z-manuel/restore": () => {
          restored = true;
          return { body: { roots: [], catalogueAdded: {}, uploadsCopied: 0, warnings: [] } };
        },
      }),
    );
    await openFinale();
    fireEvent.click(screen.getAllByRole("button", { name: "Restaurer" })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Le projet sera remplacé par l'état du");
    expect(dialog.textContent).toContain("Un point de l'état actuel est créé avant.");
    expect(restored).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurer" }));
    await waitFor(() => expect(restored).toBe(true));
    expect(await screen.findByText("Projet restauré")).toBeInTheDocument();
  });

  test("Supprimer : confirmation puis DELETE", async () => {
    let deleted = false;
    renderApp(
      "/admin/systeme",
      api({
        "DELETE /api/system/backups/projects/p1/points/x-auto": () => {
          deleted = true;
          return { status: 204, body: null };
        },
      }),
    );
    await openFinale();
    fireEvent.click(screen.getAllByRole("button", { name: "Supprimer" })[1]);
    const dialog = await screen.findByRole("dialog");
    expect(deleted).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  test("aucun projet : EmptyState", async () => {
    renderApp("/admin/systeme", api({ "GET /api/system/backups/projects": { body: [] } }));
    expect(await screen.findByText("Aucun projet")).toBeInTheDocument();
  });

  test("chargement : LoadingState", async () => {
    let release: (v: PointProject[]) => void = () => {};
    vi.spyOn(backupsApi.points, "projects").mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    renderApp("/admin/systeme", api());
    const block = (await screen.findByText("Points de restauration")).parentElement!;
    expect(within(block).getByText("Chargement…")).toBeInTheDocument();
    release(projects as PointProject[]);
    expect(await screen.findByText("Finale")).toBeInTheDocument();
  });

  test("réglages : activé, intervalle, nombre gardé → PUT", async () => {
    const { fetchSpy } = renderApp(
      "/admin/systeme",
      api({ "PUT /api/system/backups/settings/projects": (init: RequestInit | undefined) => ({ body: JSON.parse(String(init?.body)) }) }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Réglages automatiques/ }));
    fireEvent.change(await screen.findByLabelText("Intervalle"), { target: { value: "6" } });
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PUT", "/api/system/backups/settings/projects")).toEqual({
        enabled: true,
        intervalHours: 6,
        keep: 48,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Points automatiques/ }));
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PUT", "/api/system/backups/settings/projects").enabled).toBe(false),
    );
    const keep = screen.getByLabelText("Points gardés");
    fireEvent.change(keep, { target: { value: "10" } });
    fireEvent.blur(keep);
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PUT", "/api/system/backups/settings/projects").keep).toBe(10),
    );
  });
});
