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
    expect(c).toContain("bg-[var(--destructive)]");
    expect(c).toContain("text-[var(--destructive-foreground)]");
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
    expect(screen.getByText("ok").className).toContain("bg-[var(--success)]/8");
    expect(screen.getByText("att").className).toContain("text-[var(--warning-text)]");
    expect(screen.getByText("att").className).toContain("bg-[var(--warning)]/8");
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

  // Contraste du texte des badges, teinte composée sur --surface (spec §9.4 : >= 4,5:1).
  describe("contraste des badges", () => {
    const css = readFileSync(resolve(UI, "../../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const block = (sel: string) => {
      const out: Record<string, string> = {};
      for (const b of css.matchAll(new RegExp(`^${sel} \\{([\\s\\S]*?)^\\}`, "gm")))
        for (const m of b[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
      return out;
    };
    const light = block(":root");
    const dark = { ...light, ...block("\\.dark") };
    const parse = (c: string): [number, number, number, number] => {
      const m = c.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
      if (m) return [+m[1], +m[2], +m[3], +m[4]];
      const h = c.replace("#", "");
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as [number, number, number, number];
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const over = (t: number[], a: number, s: number[]) => [0, 1, 2].map((i) => t[i] * a + s[i] * (1 - a));
    const badgeSrc = readFileSync(resolve(UI, "badge.tsx"), "utf8");

    // variante -> [couleur de teinte, couleur de texte] (variables)
    const variants: Record<string, [string, string]> = {
      success: ["--success", "--success-text"],
      warning: ["--warning", "--warning-text"],
      destructive: ["--danger", "--danger-text"],
    };
    for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
      for (const [v, [tint, text]] of Object.entries(variants)) {
        it(`badge ${v} (${name}) >= 4,5:1`, () => {
          const m = badgeSrc.match(new RegExp(`${v}: "bg-\\[var\\(${tint}\\)\\]/(\\d+) text-\\[var\\(${text}\\)\\]"`));
          expect(m, `classe de ${v} dans badge.tsx`).not.toBeNull();
          const bg = over(parse(theme[tint]), Number(m![1]) / 100, parse(theme["--surface"]));
          expect(ratio(parse(theme[text]), bg)).toBeGreaterThanOrEqual(4.5);
        });
      }
      it(`badge accent (${name}) >= 4,5:1`, () => {
        expect(badgeSrc).toContain("bg-[var(--accent-soft)] text-[var(--accent-strong)]");
        const soft = parse(theme["--accent-soft"]);
        const bg = over(soft, soft[3], parse(theme["--surface"]));
        expect(ratio(parse(theme["--accent-strong"]), bg)).toBeGreaterThanOrEqual(4.5);
      });
      it(`badge default (${name}) >= 4,5:1`, () => {
        expect(badgeSrc).toContain("bg-[var(--muted)] text-[var(--text-tertiary)]");
        expect(ratio(parse(theme["--text-tertiary"]), parse(theme["--muted"]))).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
});
