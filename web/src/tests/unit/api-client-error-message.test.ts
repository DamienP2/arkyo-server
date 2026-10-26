import { describe, it, expect } from "vitest";
import { ApiError, getApiErrorMessage } from "@/lib/api-client";

/**
 * Les routes API renvoient les échecs Zod sous forme
 * `{ error: parsed.error.flatten() }` — un objet, pas une string.
 * `getApiErrorMessage` doit produire un message lisible (champ + raison)
 * au lieu du "API error 400" opaque.
 */
describe("getApiErrorMessage — erreurs de validation Zod (flatten)", () => {
  it("formate les fieldErrors en message lisible", () => {
    const err = new ApiError(400, {
      error: {
        formErrors: [],
        fieldErrors: {
          depthMm: ["Expected int, received float"],
          powerW: ["Expected int, received float"],
        },
      },
    });
    const msg = getApiErrorMessage(err);
    expect(msg).toContain("depthMm");
    expect(msg).toContain("powerW");
    expect(msg).not.toBe("API error 400");
  });

  it("formate les formErrors globales quand il n'y a pas de fieldErrors", () => {
    const err = new ApiError(400, {
      error: { formErrors: ["Payload invalide"], fieldErrors: {} },
    });
    expect(getApiErrorMessage(err)).toContain("Payload invalide");
  });

  it("conserve le comportement existant pour un body.error string", () => {
    const err = new ApiError(400, { error: "Contexte tenant manquant" });
    expect(getApiErrorMessage(err)).toBe("Contexte tenant manquant");
  });

  it("retombe sur un message adossé au statut pour un objet error inconnu", () => {
    const err = new ApiError(400, { error: { foo: "bar" } });
    expect(getApiErrorMessage(err)).toBe("Requête refusée (400).");
  });

  it("garde le message posé par l'appelant", () => {
    const err = new ApiError(400, null, "Fichier trop lourd");
    expect(getApiErrorMessage(err)).toBe("Fichier trop lourd");
  });

  it("n'affiche jamais un corps HTML — page d'erreur d'un proxy", () => {
    const err = new ApiError(
      404,
      "<!DOCTYPE html><html><body><h1>404 — This page could not be found</h1></body></html>",
    );
    expect(getApiErrorMessage(err)).toBe("Ressource introuvable.");
  });

  it("écarte un corps texte trop long pour être un message", () => {
    const err = new ApiError(500, "x".repeat(500));
    expect(getApiErrorMessage(err)).toBe("Erreur du serveur (500).");
  });

  it("conserve un corps texte court", () => {
    const err = new ApiError(409, "Emplacement déjà utilisé");
    expect(getApiErrorMessage(err)).toBe("Emplacement déjà utilisé");
  });
});
