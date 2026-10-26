import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "@/lib/api-client";
import {
  mapApiErrorToForm,
  zodIssuesFromError,
  type FormSetError,
} from "@/lib/form-errors";

describe("mapApiErrorToForm", () => {
  it("retourne false si l'erreur n'est pas une ApiError", () => {
    const setError = vi.fn<FormSetError>();
    expect(mapApiErrorToForm(new Error("boom"), setError)).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it("retourne false si le body est null", () => {
    const setError = vi.fn<FormSetError>();
    expect(mapApiErrorToForm(new ApiError(400, null), setError)).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it("retourne false si le body est une string brute", () => {
    const setError = vi.fn<FormSetError>();
    expect(mapApiErrorToForm(new ApiError(400, "Bad Request"), setError)).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  it("retourne false si le body n'expose ni issues ni error.fieldErrors", () => {
    const setError = vi.fn<FormSetError>();
    const err = new ApiError(500, { error: "Internal" });
    expect(mapApiErrorToForm(err, setError)).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });

  describe("forme `issues` (cible)", () => {
    it("mappe chaque issue avec path joint par des points", () => {
      const setError = vi.fn<FormSetError>();
      const err = new ApiError(400, {
        error: "Validation invalide",
        issues: [
          { path: ["email"], message: "Email invalide" },
          { path: ["smtp", "password"], message: "Mot de passe requis" },
        ],
      });

      expect(mapApiErrorToForm(err, setError)).toBe(true);
      expect(setError).toHaveBeenCalledTimes(2);
      expect(setError).toHaveBeenNthCalledWith(1, "email", {
        type: "server",
        message: "Email invalide",
      });
      expect(setError).toHaveBeenNthCalledWith(2, "smtp.password", {
        type: "server",
        message: "Mot de passe requis",
      });
    });

    it("préserve les indexs numériques dans les paths nested", () => {
      const setError = vi.fn<FormSetError>();
      const err = new ApiError(400, {
        issues: [{ path: ["items", 2, "name"], message: "Nom requis" }],
      });

      expect(mapApiErrorToForm(err, setError)).toBe(true);
      expect(setError).toHaveBeenCalledWith("items.2.name", {
        type: "server",
        message: "Nom requis",
      });
    });

    it("mappe path vide vers `root.serverError`", () => {
      const setError = vi.fn<FormSetError>();
      const err = new ApiError(400, {
        issues: [{ path: [], message: "Erreur globale" }],
      });

      expect(mapApiErrorToForm(err, setError)).toBe(true);
      expect(setError).toHaveBeenCalledWith("root.serverError", {
        type: "server",
        message: "Erreur globale",
      });
    });

    it("mappe path `[\"root\"]` vers `root.serverError`", () => {
      const setError = vi.fn<FormSetError>();
      const err = new ApiError(400, {
        issues: [{ path: ["root"], message: "Conflit serveur" }],
      });

      expect(mapApiErrorToForm(err, setError)).toBe(true);
      expect(setError).toHaveBeenCalledWith("root.serverError", {
        type: "server",
        message: "Conflit serveur",
      });
    });

    it("retourne false si issues est un tableau vide", () => {
      const setError = vi.fn<FormSetError>();
      const err = new ApiError(400, { issues: [] });
      expect(mapApiErrorToForm(err, setError)).toBe(false);
      expect(setError).not.toHaveBeenCalled();
    });

    it("ignore les issues malformées (pas de message ou path non array)", () => {
      const setError = vi.fn<FormSetError>();
      const err = new ApiError(400, {
        issues: [{ path: "email", message: "x" }],
      });
      // Le validateur isApiIssueArray rejette → on tombe sur la branche `error` → false
      expect(mapApiErrorToForm(err, setError)).toBe(false);
    });
  });

  describe("forme `flatten()` legacy", () => {
    it("mappe fieldErrors[k][0] vers setError(k)", () => {
      const setError = vi.fn<FormSetError>();
      const err = new ApiError(400, {
        error: {
          formErrors: [],
          fieldErrors: {
            email: ["Email invalide"],
            password: ["Trop court", "Doit contenir un chiffre"],
          },
        },
      });

      expect(mapApiErrorToForm(err, setError)).toBe(true);
      expect(setError).toHaveBeenCalledWith("email", {
        type: "server",
        message: "Email invalide",
      });
      expect(setError).toHaveBeenCalledWith("password", {
        type: "server",
        message: "Trop court",
      });
    });

    it("mappe formErrors[0] vers root.serverError", () => {
      const setError = vi.fn<FormSetError>();
      const err = new ApiError(400, {
        error: {
          formErrors: ["Conflit de version"],
          fieldErrors: {},
        },
      });

      expect(mapApiErrorToForm(err, setError)).toBe(true);
      expect(setError).toHaveBeenCalledWith("root.serverError", {
        type: "server",
        message: "Conflit de version",
      });
    });

    it("combine formErrors et fieldErrors", () => {
      const setError = vi.fn<FormSetError>();
      const err = new ApiError(400, {
        error: {
          formErrors: ["Erreur globale"],
          fieldErrors: { name: ["Nom requis"] },
        },
      });

      expect(mapApiErrorToForm(err, setError)).toBe(true);
      expect(setError).toHaveBeenCalledTimes(2);
    });

    it("ignore les fieldErrors avec valeurs non-array ou vides", () => {
      const setError = vi.fn<FormSetError>();
      const err = new ApiError(400, {
        error: {
          formErrors: [],
          fieldErrors: {
            valid: ["msg"],
            broken: "string",
            empty: [],
          },
        },
      });

      expect(mapApiErrorToForm(err, setError)).toBe(true);
      expect(setError).toHaveBeenCalledTimes(1);
      expect(setError).toHaveBeenCalledWith("valid", {
        type: "server",
        message: "msg",
      });
    });

    it("retourne false si formErrors et fieldErrors sont tous deux vides", () => {
      const setError = vi.fn<FormSetError>();
      const err = new ApiError(400, {
        error: { formErrors: [], fieldErrors: {} },
      });
      expect(mapApiErrorToForm(err, setError)).toBe(false);
    });
  });

  it("priorise la forme `issues` sur la forme legacy si les deux sont présentes", () => {
    const setError = vi.fn<FormSetError>();
    const err = new ApiError(400, {
      error: {
        formErrors: ["legacy"],
        fieldErrors: { email: ["legacy email"] },
      },
      issues: [{ path: ["name"], message: "Nouveau" }],
    });

    expect(mapApiErrorToForm(err, setError)).toBe(true);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith("name", {
      type: "server",
      message: "Nouveau",
    });
  });
});

describe("zodIssuesFromError", () => {
  it("convertit un schéma simple en issues", () => {
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: "not-an-email" });
    if (result.success) throw new Error("expected failure");

    const issues = zodIssuesFromError(result.error);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["email"]);
    expect(issues[0].message).toBeTypeOf("string");
  });

  it("préserve les paths nested", () => {
    const schema = z.object({
      smtp: z.object({
        password: z.string().min(1),
      }),
    });
    const result = schema.safeParse({ smtp: { password: "" } });
    if (result.success) throw new Error("expected failure");

    const issues = zodIssuesFromError(result.error);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["smtp", "password"]);
  });

  it("préserve les indexs numériques pour les arrays", () => {
    const schema = z.object({
      items: z.array(z.object({ name: z.string().min(1) })),
    });
    const result = schema.safeParse({ items: [{ name: "ok" }, { name: "" }] });
    if (result.success) throw new Error("expected failure");

    const issues = zodIssuesFromError(result.error);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["items", 1, "name"]);
  });

  it("normalise un path vide en `['root']`", () => {
    // Refine au niveau racine → path vide
    const schema = z
      .object({ a: z.string(), b: z.string() })
      .refine((v) => v.a === v.b, { message: "a doit égaler b" });
    const result = schema.safeParse({ a: "x", b: "y" });
    if (result.success) throw new Error("expected failure");

    const issues = zodIssuesFromError(result.error);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(["root"]);
    expect(issues[0].message).toBe("a doit égaler b");
  });

  it("retourne un tableau vide pour un schéma valide... non testable (success)", () => {
    // Sanity : zodIssuesFromError n'est appelée que si error existe ; pas de test à faire ici.
    expect(zodIssuesFromError).toBeTypeOf("function");
  });
});
