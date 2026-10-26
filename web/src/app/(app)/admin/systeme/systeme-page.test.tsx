import { afterEach, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp, resetApp, signedInApi } from "@/tests/app-harness";

afterEach(resetApp);

function update(over: Record<string, unknown> = {}) {
  return {
    current: "0.1.0",
    repo: "DamienP2/arkyo-server",
    autoCheck: true,
    previous: null,
    status: {
      phase: "idle",
      progress: 0,
      message: "",
      latest: {
        version: "0.2.0",
        name: "Arkyo 0.2.0",
        notes: "Nouveautés de la 0.2.0",
        publishedAt: "2026-10-26T10:00:00Z",
      },
    },
    ...over,
  };
}

function api(extra = {}) {
  return {
    ...signedInApi(),
    "GET /api/system": {
      body: {
        version: "0.1.0",
        dataDir: "/var/lib/arkyo",
        urls: ["http://192.168.1.10:8090"],
      },
    },
    "GET /api/system/update": { body: update() },
    ...extra,
  };
}

describe("/admin/systeme", () => {
  test("affiche la version et les adresses, et demande confirmation avant Installer", async () => {
    let installed = false;
    const { fetchSpy } = renderApp(
      "/admin/systeme",
      api({
        "POST /api/system/update/install": () => {
          installed = true;
          return { status: 202, body: null };
        },
      }),
    );
    expect(await screen.findByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("/var/lib/arkyo")).toBeInTheDocument();
    expect(screen.getByText("http://192.168.1.10:8090")).toBeInTheDocument();
    expect(screen.getByText("Version 0.2.0 disponible")).toBeInTheDocument();
    expect(screen.getByText("Nouveautés de la 0.2.0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Installer" }));
    const dialog = await screen.findByRole("dialog");
    expect(installed).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Installer" }));
    await waitFor(() => expect(installed).toBe(true));
    expect(
      fetchSpy.mock.calls.some(
        ([u]) => String(u) === "/api/system/update/install?version=0.2.0",
      ),
    ).toBe(true);
  });

  test("annuler la confirmation n'installe rien", async () => {
    let installed = false;
    renderApp(
      "/admin/systeme",
      api({
        "POST /api/system/update/install": () => {
          installed = true;
          return { status: 202, body: null };
        },
      }),
    );
    await screen.findByText("Version 0.2.0 disponible");
    fireEvent.click(screen.getByRole("button", { name: "Installer" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(installed).toBe(false);
  });

  test("pas de version proposée quand elle n'est pas plus récente ; retour arrière seulement s'il existe", async () => {
    renderApp(
      "/admin/systeme",
      api({
        "GET /api/system/update": {
          body: update({
            status: { phase: "idle", progress: 0, message: "", latest: null },
            previous: "0.0.9",
          }),
        },
      }),
    );
    await screen.findByText("Mises à jour");
    expect(screen.queryByText(/disponible/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Revenir à la version précédente" }),
    ).toBeTruthy();
  });
});
