// arkyo-server: habillage Strata — balayage des couleurs codées en dur dans les
// fichiers copiés d'arkyo (spec §7 et §9.2-§9.3). Couleur d'interface → variable
// du thème ; couleur métier → inchangée, listée ci-dessous avec sa raison.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

/** Fichiers copiés d'arkyo concernés par le balayage (phase 1, puis phase 2 ; chemins sous web/src). */
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
  // Phase 2 (Task 9) : fondations partagées du catalogue.
  "app/(app)/admin/_components/admin-list-toolbar.tsx",
  "app/(app)/admin/_components/list-toolbar-helpers.tsx",
  "app/(app)/admin/_components/numbering-tab.tsx",
  "app/(app)/admin/_components/types.ts",
  "app/(app)/admin/_components/users-list-tab.tsx",
  "components/adapters/new-adapter-wizard.tsx",
  "components/cables/new-cable-wizard.tsx",
  "components/catalogue/adapter-card.tsx",
  "components/catalogue/adapter-editor-dialog.tsx",
  "components/catalogue/brand-picker-modal.tsx",
  "components/catalogue/brand/brand-card.tsx",
  "components/catalogue/brand/brand-form-dialog.tsx",
  "components/catalogue/brand/index.ts",
  "components/catalogue/cable-card.tsx",
  "components/catalogue/cable-editor-dialog.tsx",
  "components/catalogue/cabling/cabling-card.tsx",
  "components/catalogue/cabling/cabling-form-dialog.tsx",
  "components/catalogue/cabling/index.ts",
  "components/catalogue/catalogue-section-header.tsx",
  "components/catalogue/catalogue-table.tsx",
  "components/catalogue/category-picker-modal.tsx",
  "components/catalogue/category-tree/function-card.tsx",
  "components/catalogue/category-tree/function-form-dialog.tsx",
  "components/catalogue/category-tree/index.ts",
  "components/catalogue/category-tree/phase-card.tsx",
  "components/catalogue/category-tree/phase-form-dialog.tsx",
  "components/catalogue/category-tree/type-card.tsx",
  "components/catalogue/category-tree/type-form-dialog.tsx",
  "components/catalogue/connector-card.tsx",
  "components/catalogue/connector-icon-picker-modal.tsx",
  "components/catalogue/connector-multi-picker-modal.tsx",
  "components/catalogue/connector-picker-modal.tsx",
  "components/catalogue/connector/connector-card.tsx",
  "components/catalogue/connector/connector-form-dialog.tsx",
  "components/catalogue/connector/index.ts",
  "components/catalogue/editor-status-badge.tsx",
  "components/catalogue/editor-text-field.ts",
  "components/catalogue/editor-undo-redo.tsx",
  "components/catalogue/equipment-card.tsx",
  "components/catalogue/function-multi-picker-modal.tsx",
  "components/catalogue/function-picker-modal.tsx",
  "components/catalogue/inline-type-creator.tsx",
  "components/catalogue/phase-picker-modal.tsx",
  "components/catalogue/selection-action-bar.tsx",
  "components/catalogue/signal/index.ts",
  "components/catalogue/signal/signal-card.tsx",
  "components/catalogue/signal/signal-form-dialog.tsx",
  "components/catalogue/type-picker-modal.tsx",
  "components/catalogue/types.ts",
  "components/catalogue/use-editor-autosave.ts",
  "components/catalogue/use-editor-history.ts",
  "components/catalogue/use-row-selection.ts",
  "components/catalogue/use-server-reconcile.ts",
  "components/equipment/EquipmentModal.tsx",
  "components/equipment/format-block.tsx",
  "components/equipment/new-equipment-wizard.tsx",
  "components/synoptique/components/synoptic-node.tsx",
  "components/synoptique/types/synoptic.ts",
  "components/wizard/wizard-backdrop.tsx",
  "lib/catalog-broadcast.ts",
  "lib/export/catalogue-export.ts",
  "lib/export/table-xlsx.ts",
  "lib/hooks/use-local-storage-state.ts",
  "lib/services/cable-numbering.ts",
  "lib/services/dimensions.ts",
  "lib/services/import/detect-columns.ts",
  "lib/services/print-layout.ts",
  "lib/services/text-bbox.ts",
  "lib/services/username.ts",
  "lib/type-icons.ts",
  "lib/types/catalog.ts",
  // Phase 2 (Task 10) : page Paramètres.
  "app/(app)/admin/parametres/page.tsx",
  "app/(app)/admin/parametres/_components/brand-form-dialog.tsx",
  "app/(app)/admin/parametres/_components/brands-panel.tsx",
  "app/(app)/admin/parametres/_components/cable-label-stock-form-dialog.tsx",
  "app/(app)/admin/parametres/_components/cable-label-stocks-section.tsx",
  "app/(app)/admin/parametres/_components/cabling-form-dialog.tsx",
  "app/(app)/admin/parametres/_components/cabling-panel.tsx",
  "app/(app)/admin/parametres/_components/categories-panel.tsx",
  "app/(app)/admin/parametres/_components/connector-form-dialog.tsx",
  "app/(app)/admin/parametres/_components/connectors-panel.tsx",
  "app/(app)/admin/parametres/_components/dimension-form-dialog.tsx",
  "app/(app)/admin/parametres/_components/dimensions-panel.tsx",
  "app/(app)/admin/parametres/_components/export-model-form-dialog.tsx",
  "app/(app)/admin/parametres/_components/export-pdf-section.tsx",
  "app/(app)/admin/parametres/_components/function-form-dialog.tsx",
  "app/(app)/admin/parametres/_components/import-export-panel.tsx",
  "app/(app)/admin/parametres/_components/import-export/backup-card.tsx",
  "app/(app)/admin/parametres/_components/import-export/export-card.tsx",
  "app/(app)/admin/parametres/_components/import-export/hub.tsx",
  "app/(app)/admin/parametres/_components/import-export/map-step.tsx",
  "app/(app)/admin/parametres/_components/import-export/report-step.tsx",
  "app/(app)/admin/parametres/_components/import-export/restore-card.tsx",
  "app/(app)/admin/parametres/_components/import-export/restore-report.tsx",
  "app/(app)/admin/parametres/_components/import-export/restore-verify.tsx",
  "app/(app)/admin/parametres/_components/import-export/stepper.tsx",
  "app/(app)/admin/parametres/_components/import-export/types.ts",
  "app/(app)/admin/parametres/_components/import-export/use-import-wizard.ts",
  "app/(app)/admin/parametres/_components/import-export/use-restore-flow.ts",
  "app/(app)/admin/parametres/_components/import-export/verify-step.tsx",
  "app/(app)/admin/parametres/_components/numbering-panel.tsx",
  "app/(app)/admin/parametres/_components/phase-form-dialog.tsx",
  "app/(app)/admin/parametres/_components/print-panel.tsx",
  "app/(app)/admin/parametres/_components/print-template-form-dialog.tsx",
  "app/(app)/admin/parametres/_components/signal-form-dialog.tsx",
  "app/(app)/admin/parametres/_components/signals-panel.tsx",
  "app/(app)/admin/parametres/_components/type-form-dialog.tsx",
  "app/(app)/admin/parametres/_components/use-parametres-sync.ts",
  "app/(app)/admin/parametres/_components/use-parametres-visibility.ts",
  "app/(app)/admin/parametres/parametres-client.tsx",
  "lib/services/backup.ts",
  "lib/services/import/coerce.ts",
  "lib/services/import/parse-tabular.ts",
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

// ── Phase 2 : couleurs métier ou laissées dans le doute (spec §7) ────────────

const DOUBT = "laissée dans le doute (spec §7 : une couleur métier modifiée à tort est pire qu'un bleu Arkyo résiduel)";
const CONN = "couleur d'un connecteur et son repli : couleur métier";
const TAG_2110: Allow = {
  line: /className="[^"]*rounded-md bg-sky-500\/10 [^"]*text-sky-600 dark:text-sky-400">$/,
  reason: "étiquette « 2110 » (SMPTE ST 2110) d'un équipement : marqueur métier, " + DOUBT,
};
const STOCK_DIAMETER: Allow = {
  line: /<span className="rounded bg-blue-500\/10 px-1\.5 py-0\.5 text-\[9px\] font-bold tracking-wider text-blue-600 uppercase">$/,
  reason: "étiquette « Ø min–max » d'une planche d'étiquettes câbles : marqueur produit, comme « 2110 », " + DOUBT,
};
const STOCK_LAMINATING: Allow = {
  line: /<span className="rounded bg-emerald-500\/10 px-1\.5 py-0\.5 text-\[9px\] font-bold tracking-wider text-emerald-600 uppercase">$/,
  reason: "étiquette « Self-laminating » d'une planche d'étiquettes câbles : marqueur produit, comme « 2110 », " + DOUBT,
};
const TOURET_BADGE: Allow = {
  line: /className="inline-flex shrink-0 items-center rounded bg-amber-500\/10 px-1\.5 py-0\.5 text-\[9px\] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-400"$/,
  reason: "étiquette « Touret » d'une longueur de câble : marqueur produit, comme « 2110 », " + DOUBT,
};
const PENDING_BADGE: Allow = {
  line: /className="shrink-0 rounded-md bg-amber-500\/15 px-1\.5 py-0\.5 text-\[9px\] font-bold text-amber-600">$/,
  reason: "statut « EN ATTENTE » d'un membre : statut métier, comme la pastille « Personnalisé » de la phase 1",
};
const WIZARD_ART: Allow[] = [
  {
    line: /\b(fill|stroke)="rgb\(\d+ \d+ \d+ \/ [\d.]+\)"/,
    reason: "illustrations des assistants (connecteurs XLR/BNC/RJ45, câbles, baies dessinés) : couleurs métier des connecteurs et signaux",
  },
  {
    line: /<span className="h-1 w-1 rounded-full bg-(emerald|amber)-500" \/>/,
    reason: "voyants des équipements dessinés dans les illustrations des assistants : couleur métier",
  },
  {
    line: /linear-gradient\(135deg, (rgba\(139, 92, 246, 0\.08\)|#8b5cf6 0%)/,
    reason: "dégradé tricolore décoratif de l'écran d'accueil des assistants (violet, bleu, émeraude) : " + DOUBT,
  },
  {
    line: /^\s*color="#[0-9a-f]{6}"$/,
    reason: "teinte de l'icône de chaque section ou étape (Identité, Connecteurs…) : " + DOUBT,
  },
  { line: /backgroundColor: fn\.color \|\| "#6b7280"/, reason: "couleur de la fonction (catalogue) et son défaut Prisma : couleur métier" },
];

// ── Neutres et bleus Tailwind (couleurs d'interface d'arkyo) ────────────────

const INTERFACE = /\b(bg|text|border|ring|outline|divide|from|to)-(zinc|gray|slate|neutral|stone|blue|indigo|sky)-\d{2,3}\b/;
const ALLOW: AllowMap = {
  "components/layout/topbar.tsx": [ROLE_BADGE],
  // Palette d'avatars (member.color, posée en style inline) : couleur métier, rien à exempter ici.
  "components/presence/presence-avatars.tsx": [],
  // Couleurs de connecteurs : couleur métier, en hexadécimal (voir HEX ci-dessous).
  "components/ui/connector-icon.tsx": [],
  "components/catalogue/equipment-card.tsx": [TAG_2110],
  // Phase 2 (Task 10) : page Paramètres.
  "app/(app)/admin/parametres/_components/cable-label-stocks-section.tsx": [STOCK_DIAMETER],
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
  "app/(app)/admin/_components/users-list-tab.tsx": [PENDING_BADGE],
  "components/adapters/new-adapter-wizard.tsx": WIZARD_ART,
  "components/cables/new-cable-wizard.tsx": WIZARD_ART,
  "components/equipment/new-equipment-wizard.tsx": WIZARD_ART,
  // Phase 2 (Task 10) : page Paramètres.
  "app/(app)/admin/parametres/_components/cable-label-stocks-section.tsx": [STOCK_LAMINATING],
  "app/(app)/admin/parametres/_components/dimensions-panel.tsx": [TOURET_BADGE],
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
  // Phase 2 (Task 9) : fondations partagées du catalogue.
  "app/(app)/admin/_components/list-toolbar-helpers.tsx": [
    {
      line: /^\s*(FREE|STARTER|PRO|ENTERPRISE): "#[0-9a-f]{6}", \/\/ \w+$/,
      reason: "couleurs des plans (PLAN_COLORS) : reliquat SaaS, à retirer (plus consommé par les Paramètres ; reste exporté pour les onglets du catalogue)",
    },
    { line: /boxShadow: "0 1px 2px 0 rgb\(0 0 0 \/ 0\.05\)",/, reason: "ombre (équivalent de shadow-sm) : pas une couleur d'interface" },
  ],
  "app/(app)/admin/_components/numbering-tab.tsx": [
    {
      line: /^const COLOR_(CONTAINER|SUFFIX) = "var\(--arkyo-blue(-light)?, #[0-9a-f]{6}\)";$/,
      reason: "--arkyo-blue(-light) est déjà remappée sur la palette Strata (globals.css, clair et sombre) : le repli n'est jamais utilisé",
    },
  ],
  "app/(app)/admin/_components/users-list-tab.tsx": [
    { line: /color: r\?\.color \?\? "#94a3b8" \};/, reason: "couleur du rôle (repli = --role-consultation) : couleur métier" },
  ],
  "components/adapters/new-adapter-wizard.tsx": WIZARD_ART,
  "components/cables/new-cable-wizard.tsx": WIZARD_ART,
  "components/equipment/new-equipment-wizard.tsx": [
    ...WIZARD_ART,
    {
      line: /style=\{\{ backgroundColor: "#(f59e0b|ef4444)14", color: "#\1" \}\}/,
      reason: "icônes des étapes Poids (ambre) et Chaleur (rouge) : " + DOUBT,
    },
  ],
  "components/wizard/wizard-backdrop.tsx": [
    {
      line: /radial-gradient\(circle, rgb\((139 92 246|59 130 246|16 185 129) \/ \$\{op\d\}\), transparent 70%\)/,
      reason: "halos décoratifs tricolores du fond des assistants : " + DOUBT,
    },
    { line: /"radial-gradient\(circle, rgb\(0 0 0 \/ 0\.08\) 1px, transparent 1px\)",/, reason: "trame de points du fond des assistants : texture, " + DOUBT },
  ],
  "components/catalogue/adapter-card.tsx": [
    { line: /^const ACCENT = "#06b6d4";$/, reason: "couleur par défaut d'un adaptateur (dessin SVG et carte) : couleur métier" },
    { line: /(srcCt|ct)\?\.color \?\? "#a3a3a3";/, reason: CONN },
  ],
  "components/catalogue/adapter-editor-dialog.tsx": [{ line: /color=\{ct\.color \?\? "#3b82f6"\}/, reason: CONN }],
  "components/catalogue/cable-editor-dialog.tsx": [
    { line: /^\s*color="#[0-9a-f]{6}"$/, reason: "teinte de l'icône de chaque section de l'éditeur de cordon : " + DOUBT },
  ],
  "components/catalogue/cabling/cabling-card.tsx": [{ line: /^const FALLBACK_COLOR = "#a3a3a3";$/, reason: CONN }],
  "components/catalogue/connector-card.tsx": [{ line: /fn\?\.color \?\? "#a3a3a3";/, reason: CONN }],
  "components/catalogue/connector/connector-form-dialog.tsx": [{ line: /^const DEFAULT_CONNECTOR_COLOR = "#a3a3a3";$/, reason: CONN }],
  "components/catalogue/category-tree/function-card.tsx": [
    { line: /item\.color \?\? "#6b7280";/, reason: "couleur de la fonction et son défaut Prisma : couleur métier" },
  ],
  "components/catalogue/category-tree/function-form-dialog.tsx": [
    {
      line: /(color: initial\?\.color \?\? |placeholder=)"#3b82f6"/,
      reason: "couleur choisie par l'utilisateur pour une fonction (défaut et exemple de saisie) : couleur métier",
    },
  ],
  "components/catalogue/signal/signal-card.tsx": [
    { line: /#6b7280|"#a3a3a3"/, reason: "couleur du signal, défaut Prisma et repli : couleur métier" },
  ],
  "components/equipment/EquipmentModal.tsx": [
    { line: /^const FACE_COLORS = \{ FRONT: "#3b82f6", REAR: "#8b5cf6" \};$/, reason: "couleurs des faces avant/arrière : couleur métier" },
    {
      line: /\{ value: "(IN|OUT|BOTH)", label: "[^"]+", short: "[^"]+", color: "#[0-9a-f]{6}" \},/,
      reason: "couleurs des directions de port (entrée, sortie, bidirectionnel) : couleur métier",
    },
    {
      line: /(background: cat\.color, color: "#fff"|sigCatFilter === cat\.name \? "#fff" : cat\.color)/,
      reason: "pastilles de catégorie de signal sur leur propre couleur : couleur métier",
    },
    { line: /^\s*return "#6366f1";$/, reason: "couleur de catégorie d'équipement par défaut : couleur métier" },
    {
      line: /(fill|stroke)=(\{i === 0 \? )?"#(1c1c1e|2a2a2e|2c2c30|3a3a3e|3b82f6)"/,
      reason: "aperçu dessiné de l'équipement en baie (façade, oreilles, ports) : rendu, pas interface",
    },
  ],
  "components/synoptique/components/synoptic-node.tsx": [
    {
      line: /\?\? "#71717a";|isActive \? color : "#(71717a|d1d5db)"/,
      reason: "couleur du connecteur dans le nœud du synoptique et son repli : rendu des plans",
    },
    { line: /fill=(\{isIn \? )?"#(ef4444|22c55e)"/, reason: "flèches d'entrée (rouge) et de sortie (vert) des ports du synoptique : rendu des plans" },
    { line: /color-mix\(in srgb, #6366f1 12%, var\(--secondary\)\)/, reason: "en-tête des nœuds « panneau » du synoptique : rendu des plans" },
  ],
  "components/synoptique/types/synoptic.ts": [
    { line: /^\s*"#[0-9a-f]{6}",$/, reason: "palette de couleurs du synoptique : couleur métier" },
  ],
  "lib/services/print-layout.ts": [
    {
      line: /#0f172a|#cbd5e1|#6b7280|"#000000"/,
      reason: "gabarits d'impression (texte, cadre, catégorie, quadrillage) : rendu des étiquettes imprimées",
    },
  ],
  // Phase 2 (Task 10) : page Paramètres.
  "app/(app)/admin/parametres/_components/cable-label-stock-form-dialog.tsx": [
    { line: /value=\{w\.printableColor \|\| "#fde047"\}/, reason: "couleur de la zone imprimable d'une planche (choisie par l'utilisateur) et son défaut : rendu des étiquettes imprimées" },
  ],
  "app/(app)/admin/parametres/_components/cable-label-stocks-section.tsx": [
    {
      line: /(background: "#ffffff", boxShadow: "0 1px 4px rgba\(0,0,0,0\.08\)"|stroke="#(e2e8f0|facc15|93c5fd)"|fill="#dbeafe"|fill=\{item\.printableColor \|\| "#fde047"\})/,
      reason: "aperçu dessiné d'une planche d'étiquettes (papier, étiquette, zone imprimable, câble) : rendu des étiquettes imprimées",
    },
  ],
  "app/(app)/admin/parametres/_components/cabling-panel.tsx": [{ line: /const headerColor = fn\?\.color \?\? "#a3a3a3";/, reason: "couleur de la fonction (en-tête de groupe) et son repli : couleur métier" }],
  "app/(app)/admin/parametres/_components/signals-panel.tsx": [{ line: /const headerColor = fn\?\.color \?\? "#a3a3a3";/, reason: "couleur de la fonction (en-tête de groupe) et son repli : couleur métier" }],
  "app/(app)/admin/parametres/_components/categories-panel.tsx": [
    {
      line: /const headerColor = fn\?\.color \?\? "#a3a3a3";|color: f\.color \?\? "#6b7280" \}\);/,
      reason: "couleur de la fonction, son défaut Prisma et son repli : couleur métier",
    },
  ],
  "app/(app)/admin/parametres/_components/type-form-dialog.tsx": [
    { line: /color: f\.color \?\? "#6b7280",/, reason: "couleur de la fonction et son défaut Prisma : couleur métier" },
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
