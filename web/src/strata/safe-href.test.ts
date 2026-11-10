import { describe, expect, test } from "vitest";
import { safeDocumentHref } from "./safe-href";

describe("safeDocumentHref", () => {
  test("http(s), mailto et chemins du site : liens", () => {
    expect(safeDocumentHref(" https://example.com/a.pdf ")).toBe("https://example.com/a.pdf");
    expect(safeDocumentHref("HTTP://example.com")).toBe("HTTP://example.com");
    expect(safeDocumentHref("mailto:support@example.com")).toBe("mailto:support@example.com");
    expect(safeDocumentHref("/uploads/d1.pdf")).toBe("/uploads/d1.pdf");
  });

  test("toute autre adresse reste du texte", () => {
    for (const url of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "java\tscript:alert(1)", "ftp://x", "notice.pdf", "", null, undefined])
      expect(safeDocumentHref(url), String(url)).toBeNull();
  });
});
