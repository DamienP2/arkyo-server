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
  line: /^\s*cls: "text-(purple|indigo|emerald|slate)-500 bg-\1-50 dark:bg-\1-950\/30",$/,
  reason: "badges de rôle (OWNER, CHEF_PROJET, TECHNICIEN, CONSULTATION) : couleur métier, spec §9.3",
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
