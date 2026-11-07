import { afterEach, describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { emitAppEvent, renderApp, resetApp, sentBody, signedInApi } from "@/tests/app-harness";

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

describe("/admin/systeme : interface", () => {
  test("affiche le choix d'interface courant", async () => {
    renderApp("/admin/systeme", api());
    const classique = await screen.findByRole("radio", { name: /Classique \(arkyo\)/ });
    const strata = screen.getByRole("radio", { name: /Strata/ });
    expect(classique).toHaveAttribute("aria-checked", "true");
    expect(strata).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("L'interface d'arkyo, inchangée.")).toBeInTheDocument();
  });

  test("bascule vers Strata après confirmation", async () => {
    const { fetchSpy } = renderApp(
      "/admin/systeme",
      api({ "PUT /api/system/interface": { status: 204, body: null } }),
    );
    fireEvent.click(await screen.findByRole("radio", { name: /Strata/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Changer l'interface ?")).toBeInTheDocument();
    expect(
      within(dialog).getByText("L'interface change pour tous les utilisateurs connectés."),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Changer" }));
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PUT", "/api/system/interface")).toEqual({ interface: "strata" }),
    );
    expect(
      await screen.findByText("Interface Strata activée pour tous les utilisateurs"),
    ).toBeInTheDocument();
  });

  test("annuler la confirmation n'envoie rien", async () => {
    const { fetchSpy } = renderApp(
      "/admin/systeme",
      api({ "PUT /api/system/interface": { status: 204, body: null } }),
    );
    fireEvent.click(await screen.findByRole("radio", { name: /Strata/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sentBody(fetchSpy, "PUT", "/api/system/interface")).toBeUndefined();
  });

  test("bascule pendant l'édition : la coquille se relit et data-interface passe à strata", async () => {
    let iface = "classique";
    const { fetchSpy } = renderApp(
      "/admin/systeme",
      api({
        "GET /api/site": () => ({ body: { name: "Régie A", interface: iface } }),
        "PUT /api/system/interface": () => {
          iface = "strata";
          return { status: 204, body: null };
        },
      }),
    );
    await waitFor(() => expect(document.documentElement.dataset.interface).toBe("classique"));
    const siteCalls = () =>
      fetchSpy.mock.calls.filter(([u]) => String(u).split("?")[0] === "/api/site").length;
    const before = siteCalls();
    fireEvent.click(await screen.findByRole("radio", { name: /Strata/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Changer" }));
    emitAppEvent({ domain: "config", action: "updated" });
    await waitFor(() => expect(siteCalls()).toBeGreaterThan(before));
    await waitFor(() => expect(document.documentElement.dataset.interface).toBe("strata"));
  });
});
