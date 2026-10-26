import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const UI = resolve(__dirname);
const FILES = [
  "button", "input", "dialog", "sheet", "toast", "badge", "form-field", "label", "card",
  "empty-state", "confirm-dialog", "form-dialog", "progress", "skeleton",
].map((f) => resolve(UI, `${f}.tsx`));

describe("contrôles au style Strata", () => {
  it("bouton par défaut : primaire accent, 32 px, rayon 8 px", () => {
    render(<Button>OK</Button>);
    const b = screen.getByRole("button");
    expect(b.className).toMatch(/\bh-8\b/);
    expect(b.className).toContain("bg-[var(--accent)]");
    expect(b.className).toMatch(/\brounded-lg\b/);
  });

  it("bouton sm : 28 px", () => {
    render(<Button size="sm">OK</Button>);
    expect(screen.getByRole("button").className).toMatch(/\bh-7\b/);
  });

  it("bouton secondary : surface relevée et bordure forte", () => {
    render(<Button variant="secondary">OK</Button>);
    const c = screen.getByRole("button").className;
    expect(c).toContain("bg-[var(--surface-raised)]");
    expect(c).toContain("border-[var(--border-strong)]");
  });

  it("bouton destructive : rouge Strata", () => {
    render(<Button variant="destructive">X</Button>);
    const c = screen.getByRole("button").className;
    expect(c).toContain("bg-[#e11d48]");
    expect(c).toContain("text-white");
  });

  it("champ : 32 px, rayon 6 px, fond --muted, focus bordure accent", () => {
    render(<Input aria-label="champ" />);
    const c = screen.getByLabelText("champ").className;
    expect(c).toMatch(/\bh-8\b/);
    expect(c).toMatch(/\brounded-md\b/);
    expect(c).toContain("bg-[var(--muted)]");
    expect(c).toContain("border-[var(--border)]");
    expect(c).toContain("focus-visible:border-[var(--accent)]");
    expect(c).not.toContain("focus-visible:ring-2");
  });

  it("badge variantes success/warning : fond doux + texte -text", () => {
    render(
      <>
        <Badge variant="success">ok</Badge>
        <Badge variant="warning">att</Badge>
      </>,
    );
    expect(screen.getByText("ok").className).toContain("text-[var(--success-text)]");
    expect(screen.getByText("ok").className).toContain("bg-[var(--success)]/15");
    expect(screen.getByText("att").className).toContain("text-[var(--warning-text)]");
    expect(screen.getByText("att").className).toContain("bg-[var(--warning)]/15");
  });

  it("aucune classe ne fixe une couleur Tailwind d'interface dans ces composants", () => {
    for (const f of FILES) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(
        /\b(bg|text|border|ring)-(zinc|gray|slate|neutral|blue|indigo|red|green|amber|emerald)-\d{2,3}\b/,
      );
    }
  });

  it("chaque composant habillé porte le commentaire de marque", () => {
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      // fichiers sans classe à changer exemptés : label, card, form-field, empty-state, progress, skeleton
      if (/(button|input|dialog|sheet|toast|badge)\.tsx$/.test(f) && !/confirm-dialog|form-dialog/.test(f))
        expect(src, f).toContain("arkyo-server: habillage Strata");
    }
  });
});
