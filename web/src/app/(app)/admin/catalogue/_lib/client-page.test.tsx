/**
 * `CatalogAdminPage` : rechargements sur `router.refresh()` — seule la réponse
 * du dernier chargement lancé est appliquée.
 */

import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { REFRESH_EVENT } from "next/navigation";

import { TenantPermissionsProvider } from "@/components/tenant-permissions-context";
import type { TenantPermissions } from "@/lib/tenant-permissions";
import { OWNER_PERMS } from "@/tests/app-harness";

import { CatalogAdminPage } from "./client-page";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test("refresh_out_of_order_keeps_latest", async () => {
  // Resync du provider : on lui répond les mêmes permissions.
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(OWNER_PERMS), { headers: { "Content-Type": "application/json" } }),
  );
  const first = deferred<string>();
  const slow = deferred<string>();
  const fast = deferred<string>();
  const queue = [first, slow, fast];
  const load = vi.fn(() => queue.shift()!.promise);

  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <TenantPermissionsProvider initialPermissions={OWNER_PERMS as TenantPermissions}>
            <CatalogAdminPage load={load}>{(v) => <p>valeur : {v}</p>}</CatalogAdminPage>
          </TenantPermissionsProvider>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);

  await act(async () => first.resolve("v1"));
  expect(await screen.findByText("valeur : v1")).toBeInTheDocument();

  // Deux refresh rapprochés : le premier répond après le second.
  act(() => {
    window.dispatchEvent(new Event(REFRESH_EVENT));
    window.dispatchEvent(new Event(REFRESH_EVENT));
  });
  expect(load).toHaveBeenCalledTimes(3);
  await act(async () => fast.resolve("v3 (récente)"));
  expect(await screen.findByText("valeur : v3 (récente)")).toBeInTheDocument();
  await act(async () => slow.resolve("v2 (périmée)"));
  expect(screen.getByText("valeur : v3 (récente)")).toBeInTheDocument();
  expect(screen.queryByText("valeur : v2 (périmée)")).toBeNull();
});
