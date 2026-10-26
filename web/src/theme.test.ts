// arkyo-server: habillage Strata — vérifie les variables de thème de globals.css et fonts.css.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const globalsCss = read("app/globals.css");
const fontsCss = read("fonts.css");

/** Fusionne les déclarations de tous les blocs de premier niveau dont le sélecteur est exactement `selector`. */
function vars(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`^${selector.replace(".", "\\.")} \\{([\\s\\S]*?)^\\}`, "gm");
  for (const m of css.matchAll(re)) {
    for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim().replace(/\s+/g, " ");
  }
  return out;
}

const light = vars(globalsCss, ":root");
const dark = { ...light, ...vars(globalsCss, ".dark") };
const root = { ...light, ...vars(fontsCss, ":root") };

function rgb(c: string, over?: [number, number, number]): [number, number, number] {
  const rgba = c.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (rgba) {
    const a = parseFloat(rgba[4]);
    const f = over ?? [255, 255, 255];
    return [0, 1, 2].map((i) => Number(rgba[i + 1]) * a + f[i] * (1 - a)) as [number, number, number];
  }
  const h = c.replace("#", "");
  const n = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
}
const lum = ([r, g, b]: [number, number, number]) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
/** Rapport de contraste WCAG ; les rgba sont composées sur `--surface` du thème. */
function contrast(a: string, b: string, surface: string): number {
  const base = rgb(surface);
  const l1 = lum(rgb(a, base));
  const l2 = lum(rgb(b, base));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test("sombre = palette Strata exacte", () => {
  expect(dark["--background"]).toBe("#0b0c12");
  expect(dark["--surface"]).toBe("#12141d");
  expect(dark["--surface-raised"]).toBe("#181b26");
  expect(dark["--muted"]).toBe("#1f2331");
  expect(dark["--border"]).toBe("#262a3a");
  expect(dark["--foreground"]).toBe("#e6e8f2");
  expect(dark["--muted-foreground"]).toBe("#a3a8bf");
  expect(dark["--accent"]).toBe("#8fa3ff");
  expect(dark["--accent-foreground"]).toBe("#0b1236");
  expect(dark["--rail-bg"]).toBe("#0b0c12");
});

test("clair = palette dérivée (Clair A)", () => {
  expect(light["--background"]).toBe("#f4f5f9");
  expect(light["--surface"]).toBe("#ffffff");
  expect(light["--muted"]).toBe("#eef0f6");
  expect(light["--border"]).toBe("#e1e4ee");
  expect(light["--foreground"]).toBe("#141726");
  expect(light["--accent"]).toBe("#4f63e6");
  expect(light["--accent-foreground"]).toBe("#ffffff");
  expect(light["--rail-bg"]).toBe("#ffffff");
  expect(light["--text-tertiary"]).toBe("#5f6584");
});

test("contrastes ≥ 4,5:1 pour tout texte d'interface, dans les deux thèmes", () => {
  for (const t of [light, dark]) {
    for (const [fg, bg] of [
      ["--foreground", "--background"],
      ["--foreground", "--muted"],
      ["--muted-foreground", "--muted"],
      ["--text-tertiary", "--muted"],
      ["--text-tertiary", "--surface"],
      ["--accent", "--surface"],
      ["--accent-strong", "--muted"],
      ["--accent-foreground", "--accent"],
      ["--success-text", "--surface"],
      ["--warning-text", "--surface"],
      ["--destructive-foreground", "--destructive"],
    ]) {
      expect(t[fg], fg).toBeDefined();
      expect(t[bg], bg).toBeDefined();
      expect(contrast(t[fg], t[bg], t["--surface"]), `${fg} sur ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("couleurs métier inchangées", () => {
  expect(root["--arkyo-signal-video"]).toBe("#3654ff");
  expect(root["--arkyo-signal-audio"]).toBe("#7c3aed");
  expect(root["--role-owner"]).toBe("#10b981");
});

test("Inter remplace DM Sans", () => {
  expect(fontsCss).toContain("font-family: 'Inter'");
  expect(fontsCss).not.toMatch(/dm-sans/i);
  expect(root["--font-sans"]).toMatch(/^Inter/);
});
