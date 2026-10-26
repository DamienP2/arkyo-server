/**
 * Tests unitaires — lib/api-client.ts
 *
 * Stratégie : mock de globalThis.fetch via vi.spyOn.
 * Toutes les réponses sont construites avec `new Response(body, { status, headers })`.
 * Pattern AAA. Déterministe, pas de réseau réel.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError } from "./api-client";

// ── Helpers pour fabriquer des réponses ───────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

function contentLengthZeroResponse(status = 200): Response {
  return new Response("", {
    status,
    headers: { "content-length": "0" },
  });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// api.get
// ─────────────────────────────────────────────────────────────────────────────

describe("api.get", () => {
  it("retourne le JSON parsé pour une réponse 200", async () => {
    // Arrange
    const payload = { id: "rig-1", name: "Régie A" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(payload));

    // Act
    const result = await api.get<typeof payload>("/api/rigs/rig-1");

    // Assert
    expect(result).toEqual(payload);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/rigs/rig-1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("inclut credentials: include par défaut", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    await api.get("/api/rigs");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/rigs",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// api.post — objet JSON
// ─────────────────────────────────────────────────────────────────────────────

describe("api.post avec objet JSON", () => {
  it("envoie Content-Type: application/json et body JSON-stringifié", async () => {
    // Arrange
    const requestBody = { name: "Régie B", type: "FLIGHT_CASE" };
    const responsePayload = { id: "rig-2", ...requestBody };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(responsePayload, 201));

    // Act
    const result = await api.post<typeof responsePayload>("/api/rigs", requestBody);

    // Assert
    expect(result).toEqual(responsePayload);

    const [_url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(requestBody));

    // Vérification du header Content-Type
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("content-type")).toBe("application/json");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// api.post — FormData
// ─────────────────────────────────────────────────────────────────────────────

describe("api.post avec FormData", () => {
  it("ne set pas Content-Type et transmet le FormData tel quel", async () => {
    // Arrange
    const formData = new FormData();
    formData.append("file", new Blob(["content"]), "test.jpg");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ url: "/uploads/test.jpg" }));

    // Act
    await api.post("/api/upload", formData);

    // Assert
    const [_url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(formData);

    // Content-Type ne doit PAS être forcé (le browser le fait avec boundary)
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("content-type")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// api.post — Blob
// ─────────────────────────────────────────────────────────────────────────────

describe("api.post avec Blob", () => {
  it("ne set pas Content-Type et transmet le Blob tel quel", async () => {
    // Arrange
    const blob = new Blob(["binary data"], { type: "image/png" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    // Act
    await api.post("/api/upload/image", blob);

    // Assert
    const [_url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(blob);

    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("content-type")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 204 No Content
// ─────────────────────────────────────────────────────────────────────────────

describe("204 No Content", () => {
  it("retourne undefined", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(emptyResponse(204));

    const result = await api.delete("/api/rigs/rig-1");

    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Réponse vide — content-length: 0
// ─────────────────────────────────────────────────────────────────────────────

describe("Réponse avec content-length: 0", () => {
  it("retourne undefined", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(contentLengthZeroResponse(200));

    const result = await api.get("/api/rigs");

    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Erreurs 4xx/5xx
// ─────────────────────────────────────────────────────────────────────────────

describe("Réponses d'erreur — ApiError", () => {
  it("4xx avec body JSON → throw ApiError avec status et body parsé", async () => {
    // Arrange
    const errorBody = { error: "Unauthorized" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(errorBody, 401));

    // Act & Assert
    await expect(api.get("/api/projects")).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof ApiError)) return false;
      expect(err.status).toBe(401);
      expect(err.body).toEqual(errorBody);
      return true;
    });
  });

  it("400 avec body JSON → throw ApiError avec status=400 et body parsé", async () => {
    const errorBody = { error: { fieldErrors: { name: ["Required"] } } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(errorBody, 400));

    let caught: ApiError | undefined;
    try {
      await api.post("/api/projects", {});
    } catch (e) {
      caught = e as ApiError;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(400);
    expect(caught?.body).toEqual(errorBody);
  });

  it("500 avec body JSON → throw ApiError avec status=500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "Internal Server Error" }, 500),
    );

    let caught: ApiError | undefined;
    try {
      await api.get("/api/rigs");
    } catch (e) {
      caught = e as ApiError;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(500);
  });

  it("4xx avec body texte non-JSON → throw ApiError, body = string", async () => {
    // Arrange
    vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("Not Found", 404));

    // Act
    let caught: ApiError | undefined;
    try {
      await api.get("/api/rigs/inexistant");
    } catch (e) {
      caught = e as ApiError;
    }

    // Assert
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(404);
    expect(typeof caught?.body).toBe("string");
    expect(caught?.body).toBe("Not Found");
  });

  it("ApiError.name est 'ApiError'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "Unauthorized" }, 401));

    let caught: ApiError | undefined;
    try {
      await api.get("/api/rigs");
    } catch (e) {
      caught = e as ApiError;
    }

    expect(caught?.name).toBe("ApiError");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Headers custom
// ─────────────────────────────────────────────────────────────────────────────

describe("Headers custom", () => {
  it("les headers passés par le caller sont préservés ET mergés avec Content-Type: application/json", async () => {
    // Arrange
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    // Act — passer un header custom X-Request-Id
    await api.post("/api/rigs", { name: "Test" }, { headers: { "X-Request-Id": "req-123" } });

    // Assert
    const [_url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);

    // Le header custom est présent
    expect(headers.get("x-request-id")).toBe("req-123");
    // Le Content-Type est aussi présent (fusionné)
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("le header passé par le caller écrase Content-Type si fourni explicitement", async () => {
    // Arrange
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    // Act — caller force un Content-Type différent
    await api.post(
      "/api/rigs",
      { name: "Test" },
      { headers: { "Content-Type": "application/json; charset=utf-8" } },
    );

    // Assert
    const [_url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// credentials: include
// ─────────────────────────────────────────────────────────────────────────────

describe("credentials: include", () => {
  it("api.get set credentials: include", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));

    await api.get("/api/projects");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("api.post set credentials: include", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    await api.post("/api/projects", { name: "Test" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("api.patch set credentials: include", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    await api.patch("/api/projects/p1", { name: "Updated" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects/p1",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// api.delete
// ─────────────────────────────────────────────────────────────────────────────

describe("api.delete", () => {
  it("utilise la méthode DELETE", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(emptyResponse(204));

    await api.delete("/api/rigs/rig-1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/rigs/rig-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("n'envoie pas de body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(emptyResponse(204));

    await api.delete("/api/rigs/rig-1");

    const [_url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// api.patch et api.put
// ─────────────────────────────────────────────────────────────────────────────

describe("api.patch", () => {
  it("utilise la méthode PATCH avec body JSON", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ id: "e-1", name: "Updated" }));

    await api.patch("/api/equipment/e-1", { name: "Updated" });

    const [_url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ name: "Updated" }));
  });
});

describe("api.put", () => {
  it("utilise la méthode PUT avec body JSON", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    await api.put("/api/config", { key: "theme", value: "dark" });

    const [_url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(typeof init.body).toBe("string");
  });
});
