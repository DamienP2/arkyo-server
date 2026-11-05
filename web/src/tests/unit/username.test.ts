import { describe, it, expect } from "vitest";
import { slugifyUsername, USERNAME_REGEX } from "@/lib/services/username";

describe("slugifyUsername", () => {
  it("génère prenom.nom en lowercase", () => {
    expect(slugifyUsername("Jean", "Dupont")).toBe("jean.dupont");
  });
  it("retire les accents", () => {
    expect(slugifyUsername("Hélène", "Müller")).toBe("helene.muller");
  });
  it("remplace les espaces par .", () => {
    expect(slugifyUsername("Marie Anne", "De La Tour")).toBe("marie.anne.de.la.tour");
  });
  it("retire les caractères non alphanumériques", () => {
    expect(slugifyUsername("Jean-Pierre", "O'Connor")).toBe("jean-pierre.oconnor");
  });
  it("retourne une chaîne vide si entrées vides", () => {
    expect(slugifyUsername("", "")).toBe("");
  });
  it("clamp à 30 caractères max", () => {
    const long = "a".repeat(40);
    expect(slugifyUsername(long, "x").length).toBeLessThanOrEqual(30);
  });
});

describe("USERNAME_REGEX", () => {
  it("accepte alphanum + ._- (3-30 chars)", () => {
    expect(USERNAME_REGEX.test("jean.dupont")).toBe(true);
    expect(USERNAME_REGEX.test("user_42")).toBe(true);
    expect(USERNAME_REGEX.test("a-b")).toBe(true);
  });
  it("refuse moins de 3 chars", () => {
    expect(USERNAME_REGEX.test("ab")).toBe(false);
  });
  it("refuse plus de 30 chars", () => {
    expect(USERNAME_REGEX.test("a".repeat(31))).toBe(false);
  });
  it("refuse les majuscules", () => {
    expect(USERNAME_REGEX.test("JeanDupont")).toBe(false);
  });
  it("refuse les caractères spéciaux", () => {
    expect(USERNAME_REGEX.test("jean@dupont")).toBe(false);
    expect(USERNAME_REGEX.test("jean dupont")).toBe(false);
  });
});
