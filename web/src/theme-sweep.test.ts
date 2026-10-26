// arkyo-server: habillage Strata — balayage des couleurs codées en dur dans les
// fichiers copiés d'arkyo (spec §7 et §9.2-§9.3). Couleur d'interface → variable
// du thème ; couleur métier → inchangée, listée ci-dessous avec sa raison.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

/** Fichiers copiés d'arkyo concernés par la phase 1 (chemins sous web/src). */
const COPIED_FILES = [
  "components/layout/topbar.tsx",
  "components/layout/sidebar.tsx",
  "components/ui/badge.tsx",
  "app/auth/auth-shell.tsx",
  "components/ui/image-crop-upload.tsx",
  "components/ui/image-upload.tsx",
  "lib/unsaved-changes.tsx",
  "components/ui/file-upload.tsx",
  "components/notifications-panel.tsx",
  "components/locale-selector.tsx",
  "components/ui/toast.tsx",
  "components/ui/equipment-icon-picker.tsx",
  "components/presence/presence-avatars.tsx",
  "components/ui/sheet.tsx",
  "components/ui/dialog.tsx",
  "components/ui/date-range-picker.tsx",
  "components/ui/catalog-badges.tsx",
  "components/synoptique/components/property-patterns.tsx",
  "components/presence/field-presence-ring.tsx",
  "components/ui/connector-icon.tsx",
];

/** Fichiers posés sur la topbar ou le rail : ils suivent le thème (variante « Clair A »). */
const CHROME_FILES = [
  "components/layout/topbar.tsx",
  "components/layout/sidebar.tsx",
  "components/notifications-panel.tsx",
  "components/locale-selector.tsx",
  "components/presence/presence-avatars.tsx",
];

type Allow = { line: RegExp; reason: string };
type AllowMap = Record<string, Allow[]>;

/** Occurrences de `re` dans `file`, hors lignes couvertes par une exception. */
function offending(file: string, re: RegExp, allow: Allow[] = []): string[] {
  const g = new RegExp(re.source, "g");
  const out: string[] = [];
  read(file)
    .split("\n")
    .forEach((text, i) => {
      if (allow.some((a) => a.line.test(text))) return;
      for (const m of text.matchAll(g)) out.push(`${file}:${i + 1}: ${m[0]}`);
    });
  return out;
}

const ROLE_BADGE: Allow = {
  line: /^\s*cls: "text-(purple|indigo|emerald|slate)-\d{3} bg-\1-50 dark:text-\1-\d{3} dark:bg-\1-950\/30",/,
  reason:
    "badges de rôle (OWNER, CHEF_PROJET, TECHNICIEN, CONSULTATION) : teinte métier conservée (spec §9.3), " +
    "nuances ajustées pour >= 4,5:1 (voir le test de contraste des badges de rôle ci-dessous)",
};

// ── Neutres et bleus Tailwind (couleurs d'interface d'arkyo) ────────────────

const INTERFACE = /\b(bg|text|border|ring|outline|divide|from|to)-(zinc|gray|slate|neutral|stone|blue|indigo|sky)-\d{2,3}\b/;
const ALLOW: AllowMap = {
  "components/layout/topbar.tsx": [ROLE_BADGE],
  // Palette d'avatars (member.color, posée en style inline) : couleur métier, rien à exempter ici.
  "components/presence/presence-avatars.tsx": [],
  // Couleurs de connecteurs : couleur métier, en hexadécimal (voir HEX ci-dessous).
  "components/ui/connector-icon.tsx": [],
};

test("aucune couleur d'interface Tailwind codée en dur dans les fichiers copiés (hors exceptions métier)", () => {
  expect(COPIED_FILES.flatMap((f) => offending(f, INTERFACE, ALLOW[f]))).toEqual([]);
});

// ── Couleurs de statut Tailwind (erreur, succès, alerte) ────────────────────

const STATUS = /\b(bg|text|border|ring|outline|divide|from|to|fill|stroke)-(red|rose|emerald|green|amber|yellow|orange)-\d{2,3}\b/;
const ALLOW_STATUS: AllowMap = {
  "components/layout/topbar.tsx": [ROLE_BADGE],
  "components/ui/catalog-badges.tsx": [
    {
      line: /className="inline-flex size-1\.5 items-center rounded-full bg-amber-400"/,
      reason: "pastille « Personnalisé » du catalogue : statut métier, laissée dans le doute (spec §7)",
    },
  ],
};

test("erreurs, succès et alertes suivent --danger, --success et --warning", () => {
  expect(COPIED_FILES.flatMap((f) => offending(f, STATUS, ALLOW_STATUS[f]))).toEqual([]);
});

// ── Hexadécimal et rgb() ────────────────────────────────────────────────────

const HEX = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/;
const PHOTO = "éditeur de recadrage : fond, voile, réticule et grille posés sur la photo";
const ALLOW_HEX: AllowMap = {
  "components/ui/image-crop-upload.tsx": [
    { line: /ctx\.fillStyle = "#ffffff";/, reason: "fond blanc de l'image exportée (rendu, pas interface)" },
    { line: /bg-\[#0a0a0a\]/, reason: PHOTO },
    { line: /(fill|filter)[=:] ?"(drop-shadow\(0 1px 2px )?rgba\(0,0,0,0\.(55|6)\)\)?"/, reason: PHOTO },
    { line: /background: "(#fff|rgba\(255, 255, 255, 0\.9\))",/, reason: PHOTO },
    { line: /stroke="rgba\(255,255,255,0\.35\)"/, reason: PHOTO },
  ],
  "components/ui/connector-icon.tsx": [
    { line: /color = "#3b82f6",/, reason: "couleur par défaut d'un connecteur : couleur métier" },
  ],
};

test("aucune couleur hexadécimale ou rgb() d'interface dans les fichiers copiés (hors photo et métier)", () => {
  expect(COPIED_FILES.flatMap((f) => offending(f, HEX, ALLOW_HEX[f]))).toEqual([]);
});

// ── Texte sur accent ────────────────────────────────────────────────────────

const WHITE_ON_ACCENT = /bg-\[var\(--(accent|primary|arkyo-blue)\)\](?!\/)[^"]*\btext-white\b|\btext-white\b[^"]*bg-\[var\(--(accent|primary|arkyo-blue)\)\](?!\/)/;

test("le texte sur un fond accent plein utilise --accent-foreground (blanc illisible sur l'accent sombre)", () => {
  expect(COPIED_FILES.flatMap((f) => offending(f, WHITE_ON_ACCENT))).toEqual([]);
});

// ── Topbar et rail : ils suivent le thème ───────────────────────────────────

const DARK_CHROME = /--arkyo-(slate|ink|soft|mid|mist|cloud|deep)\b|\b(text|bg|border)-(white|black)\b/;
const ALLOW_CHROME: AllowMap = {
  "components/presence/presence-avatars.tsx": [
    {
      line: /rounded-full border-2 border-\[var\(--surface\)\] text-\[9px\] font-semibold text-white"/,
      reason: "initiales blanches sur la couleur du membre (member.color) : palette d'avatars métier",
    },
  ],
};

test("topbar, rail et leurs composants n'utilisent plus les couleurs sombres d'arkyo", () => {
  expect(CHROME_FILES.flatMap((f) => offending(f, DARK_CHROME, ALLOW_CHROME[f]))).toEqual([]);
});

test("le rail utilise les variables --rail-*", () => {
  const sidebar = read("components/layout/sidebar.tsx");
  for (const v of ["--rail-bg", "--rail-icon", "--rail-icon-active", "--rail-active-bg"]) {
    expect(sidebar).toContain(`var(${v})`);
  }
});

test("le lockup de la topbar suit le thème (plus de .brand-on-dark)", () => {
  expect(read("components/brand/strata-brand.css")).not.toContain("brand-on-dark");
  const topbar = read("components/layout/topbar.tsx");
  expect(topbar).not.toContain("brand-on-dark");
  expect(topbar).not.toMatch(/monogram|arkyo\.io/);
  expect(topbar).toContain("bg-[var(--surface)]");
});

// ── globals.css ─────────────────────────────────────────────────────────────

test("globals.css : DM Sans et IBM Plex ne sont plus annoncés, sélection sombre à l'accent", () => {
  const css = read("app/globals.css");
  // « Inter (remplace DM Sans) » reste permis ; ni les commentaires ni les variables n'annoncent DM Sans ou Plex.
  expect(css).not.toMatch(/auto-hébergées[^*]*(DM Sans|IBM Plex)/);
  expect(css).not.toMatch(/--font-\w+:[^;]*(DM Sans|IBM Plex)/);
  const selection = css.match(/\.dark ::selection \{([^}]*)\}/);
  expect(selection?.[1]).toMatch(/background: [^;]*var\(--accent/);
  expect(selection?.[1]).not.toMatch(/rgba?\(|#[0-9a-fA-F]{3,8}/);
});

test("la variante dark: suit la classe .dark du thème, pas la préférence du système", () => {
  expect(read("app/globals.css")).toContain("@custom-variant dark (&:where(.dark, .dark *));");
});

// ── Contraste des badges de rôle de la topbar ───────────────────────────────

/** Couleur Tailwind 4 (oklch de node_modules/tailwindcss/theme.css) → sRGB 0-255. */
const twTheme = readFileSync(resolve(__dirname, "../node_modules/tailwindcss/theme.css"), "utf8");
function twColor(name: string): [number, number, number] {
  const m = twTheme.match(new RegExp(`--color-${name}: oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`));
  if (!m) throw new Error(`couleur Tailwind introuvable : ${name}`);
  const [L, C, h] = [Number(m[1]) / 100, Number(m[2]), Number(m[3])];
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  return lin.map((v) => {
    const c = Math.min(1, Math.max(0, v));
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  }) as [number, number, number];
}
function hexColor(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function luminance(c: [number, number, number]): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** `--surface` d'un thème, lu dans globals.css. */
function surface(selector: ":root" | ".dark"): [number, number, number] {
  const css = read("app/globals.css");
  const blocks = [...css.matchAll(new RegExp(`^${selector.replace(".", "\\.")} \\{([\\s\\S]*?)^\\}`, "gm"))];
  const v = blocks.map((m) => m[1].match(/--surface:\s*(#[0-9a-f]{6});/i)?.[1]).filter(Boolean).pop();
  return hexColor(v!);
}
/** Couleur d'une classe `bg-hue-950/30` composée sur `base` (sRGB, comme le navigateur). */
function bgOver(cls: string, base: [number, number, number]): [number, number, number] {
  const [name, alpha] = cls.split("/");
  const c = twColor(name);
  const a = alpha ? Number(alpha) / 100 : 1;
  return c.map((v, i) => v * a + base[i] * (1 - a)) as [number, number, number];
}

test("badges de rôle de la topbar : contraste >= 4,5:1 en clair et en sombre", () => {
  const roles = [...read("components/layout/topbar.tsx").matchAll(/cls: "([^"]+)"/g)].map((m) => m[1]);
  expect(roles).toHaveLength(4);
  const ratios: Record<string, number> = {};
  for (const cls of roles) {
    const tok = cls.split(" ");
    const pick = (re: RegExp) => tok.find((t) => re.test(t))!.replace(/^(dark:)?(text|bg)-/, "");
    const hue = pick(/^text-/).split("-")[0];
    ratios[`clair ${hue}`] = ratio(twColor(pick(/^text-/)), bgOver(pick(/^bg-/), surface(":root")));
    ratios[`sombre ${hue}`] = ratio(twColor(pick(/^dark:text-/)), bgOver(pick(/^dark:bg-/), surface(".dark")));
  }
  expect(Object.keys(ratios)).toHaveLength(8);
  for (const [k, r] of Object.entries(ratios)) expect([k, r >= 4.5, r.toFixed(2)]).toEqual([k, true, r.toFixed(2)]);
});
