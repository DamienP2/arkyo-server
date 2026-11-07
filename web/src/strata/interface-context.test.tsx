import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";
import { OWNER_PERMS, renderApp, resetApp, signedInApi } from "@/tests/app-harness";
import { InterfaceProvider, useInterface } from "@/strata/interface-context";

beforeAll(async () => {
  await import("@/app/(app)/dashboard/page");
}, 60000);

afterEach(() => {
  resetApp();
  delete document.documentElement.dataset.interface;
});

describe("contexte d'interface", () => {
  test("useInterface vaut classique hors provider", () => {
    const { result } = renderHook(() => useInterface());
    expect(result.current).toBe("classique");
  });

  test("pose data-interface sur html", () => {
    render(
      <InterfaceProvider value="strata">
        <span />
      </InterfaceProvider>,
    );
    expect(document.documentElement.dataset.interface).toBe("strata");
  });

  test("la coquille lit interface dans /api/site", async () => {
    renderApp("/dashboard", signedInApi(OWNER_PERMS, "Régie A", "strata"));
    await waitFor(() => expect(document.documentElement.dataset.interface).toBe("strata"), { timeout: 15000 });
  });
});
