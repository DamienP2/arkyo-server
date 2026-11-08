import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, resetApp, sentBody, signedInApi } from "@/tests/app-harness";
import { ApiError, getApiErrorMessage } from "@/lib/api-client";
import { backupsApi } from "./api";

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
afterEach(() => {
  vi.useRealTimers();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  resetApp();
});

const objects = {
  projects: [{ id: "p1", name: "Finale", updatedAt: "2026-11-07T10:00:00.000Z" }],
  racks: [{ id: "r1", name: "Flight 1", updatedAt: "2026-11-07T10:00:00.000Z" }],
  rigs: [],
  panels: [{ id: "n1", name: "Panel A", updatedAt: "2026-11-07T10:00:00.000Z" }],
};

function api(extra = {}) {
  return {
    ...signedInApi(),
    "GET /api/system": { body: { version: "0.1.0", dataDir: "/d", urls: [] } },
    "GET /api/system/update": {
      body: { current: "0.1.0", repo: "r", autoCheck: true, previous: null, status: { phase: "idle", progress: 0, message: "", latest: null } },
    },
    "GET /api/system/backups/projects": { body: [] },
    "GET /api/system/backups/settings/projects": { body: { enabled: true, intervalHours: 1, keep: 48 } },
    "GET /api/system/transfer/objects": { body: objects },
    ...extra,
  };
}

const preview = {
  token: "tok",
  preview: {
    manifest: { format: "arkyo", version: 1, appVersion: "0.1.0", createdAt: "2026-11-07T10:00:00.000Z", roots: [], counts: {} },
    roots: [
      { kind: "project", id: "p1", name: "Finale", exists: true, counts: { Rack: 3, RackSlot: 12 } },
      { kind: "panel", id: "n9", name: "Nouveau", exists: false, counts: { Panel: 1 } },
    ],
  },
};

function pickFile() {
  const input = screen.getByLabelText("Fichier .arkyo à importer") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "a.arkyo")] } });
}

describe("Système › exporter / importer", () => {
  test("onglets, sélection et export", async () => {
    const { fetchSpy } = renderApp(
      "/admin/systeme",
      api({ "POST /api/system/transfer/export": { body: "zip" } }),
    );
    const exportBtn = await screen.findByRole("button", { name: "Exporter (0)" });
    expect(exportBtn).toBeDisabled();
    expect(screen.getByText("Finale")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Panels" }));
    expect(screen.getByText("Panel A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Régies" }));
    expect(screen.getByText("Aucun objet dans « Régies »")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Projets" }));
    fireEvent.click(screen.getByLabelText(/Finale/));
    const created = vi.fn(() => "blob:x");
    URL.createObjectURL = created;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Exporter (1)" }));
    await waitFor(() =>
      expect(sentBody(fetchSpy, "POST", "/api/system/transfer/export")).toEqual({
        roots: [{ kind: "project", id: "p1" }],
      }),
    );
    await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  });

  test("import : aperçu, défaut Copie, choix Remplacer, rapport", async () => {
    const { fetchSpy } = renderApp(
      "/admin/systeme",
      api({
        "POST /api/system/transfer/inspect": { body: preview },
        "POST /api/system/transfer/import": {
          body: {
            roots: [{ kind: "project", id: "p1", name: "Finale", mode: "replace", inserted: { Rack: 3 } }],
            catalogueAdded: { TenantBrand: 2 },
            uploadsCopied: 4,
            warnings: ["Fichier manquant"],
          },
        },
      }),
    );
    await screen.findByRole("button", { name: "Exporter (0)" });
    pickFile();
    expect(await screen.findByText("Existe déjà ici")).toBeInTheDocument();
    expect(screen.getByText("Contenants 3 · Emplacements 12")).toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "Mode d'import de Finale" });
    const [replace, copy] = within(group).getAllByRole("radio") as HTMLInputElement[];
    expect(copy.checked).toBe(true);
    expect(replace.checked).toBe(false);
    expect(screen.queryByRole("radiogroup", { name: /Nouveau/ })).toBeNull();
    fireEvent.click(replace);
    fireEvent.click(screen.getByRole("button", { name: "Importer" }));
    await screen.findByText("Import terminé");
    expect(sentBody(fetchSpy, "POST", "/api/system/transfer/import")).toEqual({
      token: "tok",
      modes: { p1: "replace" },
    });
    expect(screen.getByText(/Finale » · Remplacé/)).toBeInTheDocument();
    expect(screen.getByText(/Marques 2/)).toBeInTheDocument();
    expect(screen.getByText("Fichiers copiés : 4")).toBeInTheDocument();
    expect(screen.getByText("Fichier manquant")).toBeInTheDocument();
  });

  test("fichier refusé : message du serveur en toast", async () => {
    renderApp(
      "/admin/systeme",
      api({ "POST /api/system/transfer/inspect": { status: 400, body: { error: "Fichier illisible." } } }),
    );
    await screen.findByRole("button", { name: "Exporter (0)" });
    pickFile();
    expect(await screen.findByText("Fichier illisible.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Importer" })).toBeNull();
  });
});

describe("import à rejouer", () => {
  test("jeton refusé (400) : aperçu retiré, fichier à choisir à nouveau", async () => {
    renderApp(
      "/admin/systeme",
      api({
        "POST /api/system/transfer/inspect": { body: preview },
        "POST /api/system/transfer/import": {
          status: 400,
          body: { error: "Fichier introuvable : choisissez-le à nouveau." },
        },
      }),
    );
    await screen.findByRole("button", { name: "Exporter (0)" });
    pickFile();
    fireEvent.click(await screen.findByRole("button", { name: "Importer" }));
    expect(
      await screen.findByText("Fichier introuvable : choisissez-le à nouveau."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Importer" })).toBeNull();
    expect((screen.getByLabelText("Fichier .arkyo à importer") as HTMLInputElement).value).toBe("");
  });

  test("erreur serveur (500) : l'aperçu reste pour réessayer", async () => {
    renderApp(
      "/admin/systeme",
      api({
        "POST /api/system/transfer/inspect": { body: preview },
        "POST /api/system/transfer/import": { status: 500, body: { error: "Erreur interne." } },
      }),
    );
    await screen.findByRole("button", { name: "Exporter (0)" });
    pickFile();
    fireEvent.click(await screen.findByRole("button", { name: "Importer" }));
    await screen.findByText("Erreur interne.");
    expect(screen.getByRole("button", { name: "Importer" })).toBeInTheDocument();
  });

  test("après un import réussi, les listes d'export sont rechargées", async () => {
    let loads = 0;
    renderApp(
      "/admin/systeme",
      api({
        "GET /api/system/transfer/objects": () => {
          loads++;
          return { body: objects };
        },
        "POST /api/system/transfer/inspect": { body: preview },
        "POST /api/system/transfer/import": {
          body: { roots: [], catalogueAdded: {}, uploadsCopied: 0, warnings: [] },
        },
      }),
    );
    await screen.findByRole("button", { name: "Exporter (0)" });
    const before = loads;
    pickFile();
    fireEvent.click(await screen.findByRole("button", { name: "Importer" }));
    await screen.findByText("Import terminé");
    await waitFor(() => expect(loads).toBeGreaterThan(before));
  });
});

describe("downloadFile", () => {
  test("nom du Content-Disposition, URL révoquée après un délai", async () => {
    vi.useFakeTimers();
    const created = vi.fn(() => "blob:x");
    const revoked = vi.fn();
    URL.createObjectURL = created;
    URL.revokeObjectURL = revoked;
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("zip", { headers: { "Content-Disposition": 'attachment; filename="Mon-export.arkyo"' } }),
    );
    await backupsApi.exportObjects([{ kind: "project", id: "p1" }]);
    expect(names).toEqual(["Mon-export.arkyo"]);
    expect(revoked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoked).toHaveBeenCalledWith("blob:x");
    vi.useRealTimers();
  });

  test("réponse d'erreur : ApiError avec le message du serveur", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Aucun objet." }), { status: 400 }),
    );
    const err = await backupsApi.exportObjects([]).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(getApiErrorMessage(err)).toBe("Aucun objet.");
  });
});
