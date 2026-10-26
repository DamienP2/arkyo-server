import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { SessionProvider, signOut, useSession } from "next-auth/react";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function SessionProbe() {
  const { data, status } = useSession();
  return (
    <span data-testid="s">
      {status}|{data?.user?.email ?? "-"}|{data?.user?.role ?? "-"}
    </span>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("shim next-auth/react", () => {
  it("useSession renvoie unauthenticated quand /api/auth/session répond null", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(null));
    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );
    expect(screen.getByTestId("s").textContent).toBe("loading|-|-");
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe("unauthenticated|-|-"));
    expect(fetchSpy).toHaveBeenCalledWith("/api/auth/session", expect.anything());
  });

  it("useSession renvoie authenticated avec l'utilisateur de la session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        user: {
          id: "u1",
          email: "a@b.c",
          name: "A",
          role: "OWNER",
          collaboratorRole: null,
        },
        expires: "2026-11-26T10:00:00.000Z",
      }),
    );
    render(
      <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
        <SessionProbe />
      </SessionProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("s").textContent).toBe("authenticated|a@b.c|OWNER"),
    );
  });

  it("une erreur réseau donne unauthenticated", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe("unauthenticated|-|-"));
  });

  it("arkyo:refresh recharge la session", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "u1", email: "a@b.c", name: "A", role: "OWNER", collaboratorRole: null },
          expires: "2026-11-26T10:00:00.000Z",
        }),
      );
    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe("unauthenticated|-|-"));
    await act(async () => {
      window.dispatchEvent(new Event("arkyo:refresh"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("s").textContent).toBe("authenticated|a@b.c|OWNER"),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("signOut poste /api/auth/logout puis redirige vers callbackUrl", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      href: "http://localhost:3000/dashboard",
      assign,
    } as unknown as Location);
    await signOut({ callbackUrl: "/auth" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(assign).toHaveBeenCalledWith("/auth");
  });

  it("signOut({ redirect: false }) ne redirige pas", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      assign,
    } as unknown as Location);
    await signOut({ redirect: false });
    expect(assign).not.toHaveBeenCalled();
  });
});
