import { describe, expect, test } from "vitest";
import { projectIdOf } from "./tab-nav";

describe("projectIdOf", () => {
  test("projet de l'URL de l'éditeur, décodé ; rien ailleurs", () => {
    expect(projectIdOf("/project/p1")).toBe("p1");
    expect(projectIdOf("/project/p%201/cartographie")).toBe("p 1");
    expect(projectIdOf("/rigs/p1")).toBeNull();
    expect(projectIdOf(null)).toBeNull();
  });

  test("séquence % invalide : le segment tel quel, sans exception", () => {
    expect(projectIdOf("/project/p%E0%A4%A")).toBe("p%E0%A4%A");
  });
});
