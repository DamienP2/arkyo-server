/**
 * `<ComingSoon />` plein écran (`/project/:id/*`, ouvert à la fin de
 * l'assistant) : sans coquille, un lien « Retour » revient à la page
 * précédente, ou au tableau de bord quand l'onglet n'a pas d'historique.
 */

import { afterEach, describe, expect, test } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderApp, resetApp, signedInApi } from "@/tests/app-harness";

afterEach(resetApp);

describe("ComingSoon plein écran", () => {
  test("Retour sans historique : tableau de bord", async () => {
    const { router } = renderApp("/project/p1?tab=fiche", signedInApi());
    expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
    expect(document.querySelector("aside")).toBeNull();
    const back = screen.getByRole("link", { name: "Retour" });
    expect(back).toHaveAttribute("href", "/dashboard");
    fireEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
  });

  test("Retour après redirection depuis un favori : tableau de bord", async () => {
    // `/projects/p1` redirige en `replace` : la clé n'est plus "default", mais
    // le routeur navigateur indique `idx: 0` (rien derrière dans l'onglet).
    const { router } = renderApp("/projects/p1", signedInApi());
    expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
    const saved = window.history.state;
    window.history.replaceState({ ...(saved ?? {}), idx: 0 }, "");
    try {
      fireEvent.click(screen.getByRole("link", { name: "Retour" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    } finally {
      window.history.replaceState(saved, "");
    }
  });

  test("Retour avec historique : page précédente", async () => {
    const { router } = renderApp("/racks/r1", signedInApi());
    expect(await screen.findByText("Bientôt disponible")).toBeInTheDocument();
    // Dans la coquille, la barre latérale suffit : pas de « Retour ».
    expect(screen.queryByRole("link", { name: "Retour" })).toBeNull();
    await act(() => router.navigate("/project/p1"));
    fireEvent.click(await screen.findByRole("link", { name: "Retour" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/racks/r1"));
  });
});
