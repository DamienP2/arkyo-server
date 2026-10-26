import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrataBrand, MODULE } from "@/components/brand/strata-brand";
import { pageTitle } from "@/lib/hooks/use-page-title";

describe("StrataBrand", () => {
  test("lockup : Strata puis Arkyo, aria-label, pas de signature", () => {
    render(<StrataBrand />);
    expect(MODULE).toBe("Arkyo");
    expect(screen.getByLabelText("Strata Arkyo")).toBeInTheDocument();
    expect(screen.getByText("Strata")).toHaveClass("brand-name");
    expect(screen.getByText("Arkyo")).toHaveClass("brand-module");
    expect(document.querySelector(".brand-sign")).toBeNull();
  });

  test("variante empilée", () => {
    render(<StrataBrand stacked />);
    expect(screen.getByLabelText("Strata Arkyo")).toHaveClass("brand", "stacked");
  });

  test("titre d'onglet : « Strata Arkyo | Système »", () => {
    expect(pageTitle("Système")).toBe("Strata Arkyo | Système");
    expect(pageTitle()).toBe("Strata Arkyo");
  });

  test("index.html et styles du lockup", () => {
    const root = resolve(__dirname, "../../..");
    expect(readFileSync(resolve(root, "index.html"), "utf8")).toContain("<title>Strata Arkyo</title>");
    const css = readFileSync(resolve(__dirname, "strata-brand.css"), "utf8");
    expect(css).toMatch(/\.brand-name[\s\S]*var\(--foreground\)/);
    expect(css).toContain("var(--accent)");
    expect(css).not.toContain("brand-sign");
  });
});
