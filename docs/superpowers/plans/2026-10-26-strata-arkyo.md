# Habillage Strata Arkyo — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Habiller arkyo-server aux couleurs, à la police, aux contrôles et à la marque de Strata Graphics, sous le nom affiché « Strata Arkyo », sans rien changer à l'ergonomie d'Arkyo, en clair comme en sombre.

**Architecture :** L'habillage passe d'abord par les variables CSS de `web/src/app/globals.css` (`:root` clair, `.dark` sombre), qui alimentent déjà ~9 000 usages. Ensuite viennent la police Inter auto-hébergée, quelques réglages de taille et de rayon dans les composants de base, un composant de marque porté de Strata, un balayage des couleurs d'interface codées en dur dans les 17 fichiers déjà copiés, et enfin les noms affichés et les icônes côté natif (tray, packaging).

**Tech Stack :** Tailwind CSS v4 (variables CSS), React 19, Vitest, Rust (`tools/make-icons` avec resvg/usvg/fontdb, `crates/arkyo-tray`), WiX 5, pkgbuild.

**Spec :** [`docs/superpowers/specs/2026-10-26-strata-arkyo-design.md`](../specs/2026-10-26-strata-arkyo-design.md). §9 « Décisions du concepteur » fait autorité sur les §3 à §8 en cas d'écart.

## Global Constraints

- **Ergonomie inchangée.** Aucune modification de structure, d'ordre des éléments, de navigation ou de comportement. On ne change que couleurs, police, tailles et rayons des contrôles, et textes de marque.
- **Valeurs exactes.** Toutes les couleurs viennent des tableaux §3.1 (sombre) et §3.2 (clair) de la spec, avec les ajustements de contraste du §9.4 : tertiaire clair `#5f6584`, succès texte clair `#15803d`, alerte texte clair `#b45309`.
- **Couleurs métier inchangées** : `--arkyo-signal-*`, `--role-*`, palette d'avatars de présence, couleurs de connecteurs et câbles, couleurs choisies par l'utilisateur.
- **Contraste.** Texte d'interface ≥ 4,5:1, grands textes et icônes ≥ 3:1, dans les deux thèmes.
- **Fichiers copiés d'arkyo.** Ils peuvent désormais être modifiés pour l'habillage. Chaque modification est commentée `// arkyo-server: habillage Strata` (ou `/* … */` en CSS). Ne jamais reformater un fichier copié.
- **Nom affiché : « Strata Arkyo ».** Ne renommer ni binaire, ni service, ni dossier de données, ni identifiant de bundle, ni `UpgradeCode`, ni noms de fichiers des paquets (`Arkyo-<version>-…`), ni fichiers d'icônes (`assets/icons/arkyo.*` gardent leurs noms).
- **Référence Strata** : `.ref/cg` au commit `8ad8b56` (`cg:<chemin>`), en particulier `cg:web/src/styles.css`, `cg:web/src/ui/Brand.tsx`, `cg:web/src/fonts/`, `cg:assets/fonts/`.
- **Sans push ni tag.** Le contrôle CI et Release se fait sur accord de Damien.

## Review Focus

1. **Bascule clair/sombre à chaud.** Chaque surface (topbar, rail, panneaux, popovers, dialogues, toasts) change de palette sans résidu. → test Task 1 sur les deux blocs de variables, vérification visuelle Task 7.
2. **Texte tertiaire sur panneau 3 en clair** (cas d'échec signalé par la relecture). Il doit dépasser 4,5:1. → test de contraste Task 1.
3. **Résidu de marque.** Aucune occurrence affichée de « arkyo.io », de DM Sans ou de l'ancien monogramme. → test Task 3.
4. **Mise à jour d'une v0.1.0 installée sur macOS.** Le `.pkg` doit remplacer `/Applications/Arkyo.app` par `/Applications/Strata Arkyo.app` sans laisser l'ancienne app, ni un tray en double au démarrage. → Task 6.
5. **Couleurs métier modifiées par erreur pendant le balayage.** → liste d'exceptions et test Task 4.

---

## Structure des fichiers

```
web/src/app/globals.css                 variables :root (clair) et .dark (sombre) → palette Strata
web/src/fonts.css                       Inter auto-hébergée (remplace DM Sans), mono Strata
web/src/fonts/inter-{400,500,600,700,800}.woff2   copiés de cg:web/src/fonts/
web/src/theme.test.ts                   valeurs des variables + contrastes
web/src/components/brand/strata-brand.tsx   lockup « Strata Arkyo » (port de cg:web/src/ui/Brand.tsx sans signature)
web/src/components/brand/strata-brand.css   styles .brand* portés de cg:web/src/styles.css
web/src/components/ui/{button,input,badge,dialog,sheet,toast,…}.tsx  tailles, rayons, couleurs
web/src/components/layout/{topbar,sidebar}.tsx   lockup et couleurs
web/src/app/auth/auth-shell.tsx         lockup empilé
web/index.html, web/src/lib/hooks/use-page-title.ts   titre « Strata Arkyo »
web/public/favicon.svg                  icône SA (tracés, générée)
tools/make-icons/{src/main.rs,sa.svg,fonts/Inter-ExtraBold.otf,fonts/OFL.txt}
assets/icons/*                          régénérés
crates/arkyo-tray/src/app.rs            libellés « Strata Arkyo »
packaging/macos/**, packaging/windows/msi/arkyo.wxs   noms affichés, ancienne app retirée
README.md, docs/*.md, CLAUDE.md         nom et règle d'habillage
```

---

### Task 1 : Palette et police

**Files :**
- Modify : `web/src/app/globals.css` (blocs `:root` et `.dark` des variables d'interface, variables `--arkyo-blue*`, `body`)
- Modify : `web/src/fonts.css`
- Create : `web/src/fonts/inter-{400,500,600,700,800}.woff2` (copie de `cg:web/src/fonts/`, avec le `@font-face` et l'`unicode-range` de `cg:web/src/styles.css` lignes 1-77)
- Modify : `web/package.json` (retirer `@fontsource-variable/dm-sans`)
- Test : `web/src/theme.test.ts`

**Interfaces :**
- Produces : les variables du tableau §3.3 de la spec, avec les valeurs §3.1/§3.2 et les ajustements §9.4. `--font-sans: Inter, system-ui, sans-serif`. `--font-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace`. `--font-serif` inchangé. `body { font-size: 13px; line-height: 1.4 }`. Les tasks suivantes peuvent utiliser `var(--accent)`, `var(--accent-foreground)`, `var(--surface)`, `var(--surface-raised)`, `var(--muted)`, `var(--muted-foreground)`, `var(--border)`, `var(--destructive)`.
- Nouvelles variables, utilisées par les Tasks 2 et 4 :

  | Variable | Clair | Sombre |
  | --- | --- | --- |
  | `--text-tertiary` | `#5f6584` | `#8a90ad` |
  | `--border-strong` | `#cdd2e1` | `#323750` |
  | `--accent-soft` | `rgba(79,99,230,.10)` | `rgba(143,163,255,.16)` |
  | `--accent-strong` | `#3346c9` | `#bfcaff` |
  | `--success` | `#16a34a` | `#22c55e` |
  | `--success-text` | `#15803d` | `#22c55e` |
  | `--warning` | `#d97706` | `#f5a524` |
  | `--warning-text` | `#b45309` | `#f5a524` |
  | `--danger` | `#e11d48` | `#ff3b5c` |

- [ ] **Step 1 : Écrire les tests**

```ts
// web/src/theme.test.ts — lit globals.css (fs) et extrait les blocs :root (variables d'interface) et .dark
test("sombre = palette Strata exacte", () => { expect(dark["--background"]).toBe("#0b0c12"); expect(dark["--surface"]).toBe("#12141d"); expect(dark["--surface-raised"]).toBe("#181b26"); expect(dark["--muted"]).toBe("#1f2331"); expect(dark["--border"]).toBe("#262a3a"); expect(dark["--foreground"]).toBe("#e6e8f2"); expect(dark["--muted-foreground"]).toBe("#a3a8bf"); expect(dark["--accent"]).toBe("#8fa3ff"); expect(dark["--accent-foreground"]).toBe("#0b1236"); expect(dark["--rail-bg"]).toBe("#0b0c12"); });
test("clair = palette dérivée (Clair A)", () => { expect(light["--background"]).toBe("#f4f5f9"); expect(light["--surface"]).toBe("#ffffff"); expect(light["--muted"]).toBe("#eef0f6"); expect(light["--border"]).toBe("#e1e4ee"); expect(light["--foreground"]).toBe("#141726"); expect(light["--accent"]).toBe("#4f63e6"); expect(light["--accent-foreground"]).toBe("#ffffff"); expect(light["--rail-bg"]).toBe("#ffffff"); expect(light["--text-tertiary"]).toBe("#5f6584"); });
test("contrastes ≥ 4,5:1 pour tout texte d'interface, dans les deux thèmes", () => {
  for (const t of [light, dark]) for (const [fg, bg] of [["--foreground","--background"],["--foreground","--muted"],["--muted-foreground","--muted"],["--text-tertiary","--muted"],["--text-tertiary","--surface"],["--accent","--surface"],["--accent-foreground","--accent"],["--success-text","--surface"],["--warning-text","--surface"],["--destructive-foreground","--destructive"]]) expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
});
test("couleurs métier inchangées", () => { expect(root["--arkyo-signal-video"]).toBe("#3654ff"); expect(root["--arkyo-signal-audio"]).toBe("#7c3aed"); expect(root["--role-owner"]).toBe("#10b981"); });
test("Inter remplace DM Sans", () => { expect(fontsCss).toContain("font-family: 'Inter'"); expect(fontsCss).not.toMatch(/dm-sans/i); expect(root["--font-sans"]).toMatch(/^Inter/); });
```

`contrast(a, b)` est la formule WCAG de luminance relative. Les `rgba` sont composées sur `--surface` avant le calcul.

- [ ] **Step 2 : Lancer les tests.** Run : `cd web && npx vitest run src/theme.test.ts` → FAIL.
- [ ] **Step 3 : Implémenter.**
  - Redéfinir les variables selon le tableau §3.3 de la spec.
  - Mettre `--arkyo-blue`, `--arkyo-blue-light` et `--arkyo-blue-soft` sur l'accent du thème : ce sont des accents de marque, pas des couleurs métier.
  - Garder `--arkyo-signal-video` à `#3654ff`.
  - Remplacer les polices dans `fonts.css`.
  - Commenter chaque bloc modifié `/* arkyo-server: habillage Strata */`.
- [ ] **Step 4 : Lancer les tests et le build.** Run : `cd web && npm test && npx tsc --noEmit && npm run build` → PASS.
- [ ] **Step 5 : Commit**

```bash
git add -A web && git commit -m "feat: palette Strata (clair et sombre) et police Inter"
```

---

### Task 2 : Contrôles au style Strata

**Files :**
- Modify : `web/src/components/ui/button.tsx`, `input.tsx`, `dialog.tsx`, `sheet.tsx`, `toast.tsx`, `badge.tsx`, `form-field.tsx`, `label.tsx`, `card.tsx`, `empty-state.tsx`, `confirm-dialog.tsx`, `form-dialog.tsx`, `progress.tsx`, `skeleton.tsx`, `web/src/app/(app)/admin/_components/admin-tab-layout.tsx` (onglets)
- Test : `web/src/components/ui/strata-controls.test.tsx`

**Interfaces :**
- Consumes : variables de la Task 1.
- Produces : contrôles dont les tailles, rayons et états suivent `cg:web/src/styles.css`. Les sélecteurs de référence sont :
  - `.btn`, `.btn.primary`, `.btn.small` (l. 259-290, 1699-1710) ;
  - champs (l. ~150-175) ;
  - `.tabs` (l. 438-470) et `.segmented`/`.seg` (l. 339-360, 2158-2185) ;
  - `.badge` (l. 362-375) ;
  - `.toast` (l. 517-530) ;
  - `.menu` (l. 1846-1870, 2366-2380) ;
  - `.modal` (l. 2652-2695).

  Les valeurs à appliquer :

  | Contrôle | Règle |
  | --- | --- |
  | Bouton | hauteur 32 px (`h-8`, taille `default`) ; `sm` 28 px ; `lg` reste ; rayon 8 px ; police 13 px, graisse 500 |
  | `default` (primaire) | fond `--accent`, texte `--accent-foreground` |
  | `secondary` / `outline` | fond `--surface-raised`, bordure `--border-strong` |
  | `destructive` | fond `#e11d48`, texte blanc |
  | Champs | hauteur 32 px, rayon 6 px, fond `--muted`, bordure `--border`, focus = bordure `--accent` sans halo épais |
  | Dialogues | rayon et en-tête/pied du `.modal` de Strata, fond `--surface` |
  | Badges | fond doux et texte coloré (accent, succès, alerte, danger) |

- La disposition interne des composants ne change pas : mêmes enfants, même ordre, mêmes props.

- [ ] **Step 1 : Écrire les tests**

```tsx
test("bouton par défaut : primaire accent, 32 px, rayon 8 px", () => { render(<Button>OK</Button>); const b = screen.getByRole("button"); expect(b.className).toMatch(/\bh-8\b/); expect(b.className).toContain("bg-[var(--accent)]"); expect(b.className).toMatch(/\brounded-lg\b/); });
test("bouton destructive : rouge Strata", …)
test("champ : 32 px, rayon 6 px, fond --muted, focus bordure accent", …)
test("badge variantes success/warning : fond doux + texte -text", …)
test("aucune classe ne fixe une couleur Tailwind d'interface dans ces composants", () => { for (const f of FILES) expect(read(f)).not.toMatch(/\b(bg|text|border|ring)-(zinc|gray|slate|neutral|blue|indigo)-\d{2,3}\b/); });
```

- [ ] **Step 2 : Lancer les tests.** Run : `cd web && npx vitest run src/components/ui/strata-controls.test.tsx` → FAIL.
- [ ] **Step 3 : Implémenter.** Modifier les classes uniquement, avec un commentaire `// arkyo-server: habillage Strata` par composant modifié.
- [ ] **Step 4 : Lancer les tests.** Run : `cd web && npm test && npx tsc --noEmit` → PASS. Les tests copiés d'arkyo (`badge.test.tsx`, `range-input.test.tsx`) passent encore, ou sont adaptés sur les seules classes de couleur, avec un commentaire.
- [ ] **Step 5 : Commit**

```bash
git add -A web && git commit -m "feat: contrôles au style Strata"
```

---

### Task 3 : Marque « Strata Arkyo »

**Files :**
- Create : `web/src/components/brand/strata-brand.tsx`, `web/src/components/brand/strata-brand.css`
- Modify : `web/src/components/layout/topbar.tsx` (lockup), `web/src/app/auth/auth-shell.tsx` (lockup empilé), `web/index.html` (`<title>`), `web/src/lib/hooks/use-page-title.ts`
- Test : `web/src/components/brand/strata-brand.test.tsx`, ajouts dans `web/src/app/auth/*.test.tsx` et `web/src/router.test.tsx`

**Interfaces :**
- Produces :
  - `export const MODULE = "Arkyo"` ;
  - `export function StrataBrand({ stacked }: { stacked?: boolean })` : rend `<div class="brand [stacked]" aria-label="Strata Arkyo"><span class="brand-lockup"><span class="brand-name">Strata</span><span class="brand-module">Arkyo</span></span></div>`, sans signature ;
  - styles `.brand*` de `cg:web/src/styles.css` (l. 390-437, 1972-1985), avec `.brand-name` en couleur `var(--foreground)` (au lieu de `#fff`) pour le thème clair ;
  - `usePageTitle(title?)` → `document.title = title ? "Strata Arkyo | " + title : "Strata Arkyo"`.
- La topbar garde le même emplacement, le séparateur et le nom du site `/api/site`. Seuls le monogramme et le texte « arkyo.io » sont remplacés par `<StrataBrand />`.

- [ ] **Step 1 : Écrire les tests**

```tsx
test("lockup : Strata puis Arkyo, aria-label, pas de signature", () => { render(<StrataBrand />); expect(screen.getByLabelText("Strata Arkyo")).toBeInTheDocument(); expect(screen.getByText("Strata")).toHaveClass("brand-name"); expect(screen.getByText("Arkyo")).toHaveClass("brand-module"); expect(document.querySelector(".brand-sign")).toBeNull(); });
test("topbar affiche le lockup et le nom du site", …)
test("pages /auth* affichent le lockup empilé", …)
test("titre d'onglet : « Strata Arkyo | Système »", …)
test("aucune mention affichée de arkyo.io dans web/src ni web/index.html", () => { expect(grepTree("web/src", /arkyo\.io/, { excludeComments: true })).toEqual([]); expect(read("web/index.html")).not.toContain("arkyo.io"); });
```

- [ ] **Step 2 : Lancer les tests.** Run : `cd web && npm test` → FAIL.
- [ ] **Step 3 : Implémenter.** Les fichiers copiés modifiés portent le commentaire d'habillage. Retirer le monogramme SVG de la topbar et de l'auth-shell.
- [ ] **Step 4 : Lancer les tests et le build.** Run : `cd web && npm test && npx tsc --noEmit && npm run build` → PASS.
- [ ] **Step 5 : Commit**

```bash
git add -A web && git commit -m "feat: lockup Strata Arkyo et titres"
```

---

### Task 4 : Balayage des couleurs codées en dur (fichiers déjà copiés)

**Files :**
- Modify, avec le nombre d'occurrences mesuré :

  | Fichier | Occurrences |
  | --- | --- |
  | `components/layout/topbar.tsx` | 19 |
  | `components/ui/badge.tsx` | 16 |
  | `app/auth/auth-shell.tsx` | 12 |
  | `components/ui/image-crop-upload.tsx` | 11 + 1 hex |
  | `components/ui/image-upload.tsx` | 8 |
  | `lib/unsaved-changes.tsx` | 3 |
  | `components/ui/file-upload.tsx` | 3 |
  | `components/notifications-panel.tsx` | 3 |
  | `components/ui/toast.tsx` | 2 |
  | `components/ui/equipment-icon-picker.tsx` | 2 |
  | `components/presence/presence-avatars.tsx` | 2 |
  | `components/ui/sheet.tsx` | 1 |
  | `components/ui/dialog.tsx` | 1 |
  | `components/ui/date-range-picker.tsx` | 1 |
  | `components/ui/catalog-badges.tsx` | 1 |
  | `components/synoptique/components/property-patterns.tsx` | 1 |
  | `components/presence/field-presence-ring.tsx` | 1 |
  | `components/ui/connector-icon.tsx` | hex |

  (Tous sous `web/src/`. Les Tasks 2 et 3 en auront déjà traité une partie.)
- Test : `web/src/theme-sweep.test.ts`

**Interfaces :**
- Règle (spec §7 et §9.3) :
  - **Couleur d'interface → variable** : fonds, textes, bordures, survols, focus, sélection, liens, types de notification (info → `--accent`, succès → `--success`/`--success-text`, alerte → `--warning`/`--warning-text`, erreur → `--danger`).
  - **Couleur métier → inchangée** : couleurs de connecteurs dans `connector-icon.tsx`, palette d'avatars de présence, couleurs de rôles.
  - `text-white` ou `bg-black/…` restent quand ils servent à un overlay ou à du texte sur photo.

- [ ] **Step 1 : Écrire le test**

```ts
const INTERFACE = /\b(bg|text|border|ring|outline|divide|from|to)-(zinc|gray|slate|neutral|stone|blue|indigo|sky)-\d{2,3}\b/;
const ALLOW = { "components/presence/presence-avatars.tsx": [/* couleurs d'avatars : métier */], "components/ui/connector-icon.tsx": [/* couleurs de connecteurs : métier */] };
test("aucune couleur d'interface Tailwind codée en dur dans les fichiers copiés (hors exceptions métier)", () => { for (const f of COPIED_FILES) expect(offending(f, INTERFACE, ALLOW[f])).toEqual([]); });
```

`COPIED_FILES` est la liste ci-dessus. Les exceptions sont listées avec leur raison dans le test lui-même.

- [ ] **Step 2 : Lancer le test.** Run : `cd web && npx vitest run src/theme-sweep.test.ts` → FAIL.
- [ ] **Step 3 : Remplacer, fichier par fichier, selon la règle.** Chaque ligne modifiée porte le commentaire d'habillage.
- [ ] **Step 4 : Lancer les tests.** Run : `cd web && npm test && npx tsc --noEmit` → PASS.
- [ ] **Step 5 : Commit**

```bash
git add -A web && git commit -m "feat: couleurs d'interface des fichiers copiés aux variables Strata"
```

---

### Task 5 : Icônes « SA »

**Files :**
- Create : `tools/make-icons/sa.svg` (source : tuile sombre arrondie `#141724`, texte « S » blanc et « A » `#8fa3ff`, Inter 800, interlettrage −0,06 em, comme la maquette `strata-icon-login.html` variante A), `tools/make-icons/fonts/Inter-ExtraBold.otf` et `tools/make-icons/fonts/OFL.txt` (copiés de `cg:assets/fonts/`)
- Modify : `tools/make-icons/src/main.rs`, `scripts/make-icons.sh`
- Regenerate : `assets/icons/{arkyo.ico,arkyo.icns,arkyo-1024.png,arkyo-macos-1024.png,uninstall-macos-1024.png,installer-background.png,tray-template-44.rgba,tray-color-64.rgba}`, `web/public/favicon.svg`

**Interfaces :**
- Produces :
  - `make-icons <sa.svg> <font.otf> <out-dir> <favicon-out>` charge la police dans la `fontdb` de usvg et rend les mêmes fichiers que la version actuelle, avec les mêmes noms et tailles.
  - Le favicon est écrit **avec le texte converti en tracés** (`usvg::Tree` → `to_string`), pour s'afficher sans la police.
  - `tray-template-44.rgba` contient « SA » en noir opaque sur transparent, sans tuile.
  - `tray-color-64.rgba` contient la tuile complète.
  - `uninstall-macos-1024.png` reprend le badge de désinstallation actuel, posé sans chevaucher les lettres (point différé de la phase 1).
  - `installer-background.png` (620×418) : fond clair Strata `#f4f5f9`, petite tuile SA.

- [ ] **Step 1 : Écrire le test** dans `tools/make-icons` (`cargo test` du crate) : `renders_all_outputs_with_expected_sizes`. Génère dans un dossier temporaire et vérifie que :
  - les PNG font 1024×1024 et 620×418 ;
  - l'ICO contient 7 tailles ;
  - `tray-template-44.rgba` fait 44×44×4 octets, et tous ses pixels non transparents sont noirs ;
  - `favicon.svg` ne contient pas de `<text`.
- [ ] **Step 2 : Lancer le test.** Run : `cd tools/make-icons && cargo test` → FAIL.
- [ ] **Step 3 : Implémenter, puis régénérer.** Run : `bash scripts/make-icons.sh`.
- [ ] **Step 4 : Vérifier.** Run : `cd tools/make-icons && cargo test` → PASS. Ouvrir chaque PNG (outil Read) et décoder les `.rgba` en PNG temporaires pour les regarder : « SA » lisible, A pervenche, rien de coupé.
- [ ] **Step 5 : Commit**

```bash
git add -A tools/make-icons scripts/make-icons.sh assets/icons web/public/favicon.svg && git commit -m "feat: icônes SA Strata Arkyo"
```

---

### Task 6 : Nom affiché côté natif

**Files :**
- Modify : `crates/arkyo-tray/src/app.rs` (constantes `TITLE`, `OPEN`, alertes, tests `status_label`)
- Modify : `packaging/macos/pkg/app/Info.plist` (`CFBundleName` et `CFBundleDisplayName` = « Strata Arkyo » ; `CFBundleIdentifier` inchangé), `packaging/macos/pkg/Distribution.xml` (titre), `packaging/macos/pkg/build.sh` (nom de l'app installée `Strata Arkyo.app`, désinstalleur `Désinstaller Strata Arkyo.app`), `packaging/macos/pkg/scripts/preinstall`, `packaging/macos/uninstall.sh`, `packaging/macos/pkg/uninstaller/*`, `packaging/macos/pkg/resources/*.lproj/*.html`
- Modify : `packaging/windows/msi/arkyo.wxs` (`Package Name="Strata Arkyo"`, `Manufacturer="Strata"`, description « Strata Arkyo, conception, câblage et recette d'installations broadcast », raccourcis « Strata Arkyo », « Strata Arkyo (navigateur) », « Désinstaller Strata Arkyo » ; `UpgradeCode`, `INSTALLFOLDER` `Arkyo` et nom du service inchangés)
- Test : tests du tray ; vérifications packaging

**Interfaces :**
- `status_label(true)` → `"Strata Arkyo — En marche"`, `status_label(false)` → `"Strata Arkyo — Arrêté"`, menu « Ouvrir Strata Arkyo ».
- macOS :
  - `preinstall` quitte le tray s'il tourne (`pkill -x arkyo-tray`, sans erreur sinon).
  - Il supprime `/Applications/Arkyo.app` et `/Applications/Uninstall Arkyo.app` s'ils existent.
  - Le LaunchAgent du tray (`com.arkyo.tray`) pointe vers la nouvelle app.
  - Le désinstalleur retire les deux noms, ancien et nouveau.

- [ ] **Step 1 : Mettre à jour les tests du tray et vérifier qu'ils échouent.** Run : `cargo test -p arkyo-tray` → FAIL.
- [ ] **Step 2 : Implémenter** les libellés du tray et le packaging.
- [ ] **Step 3 : Vérifier.**
  - Run : `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings` → PASS.
  - Run : `bash -n` sur chaque script modifié, et `xmllint --noout` sur `Info.plist`, `Distribution.xml` et `arkyo.wxs`.
  - Construire localement le `.pkg` non signé, comme en phase 1 (binaires release universels, `packaging/macos/pkg/build.sh`).
  - `pkgutil --payload-files` doit contenir `./Applications/Strata Arkyo.app/…` et aucun `Arkyo.app`. `grep -c "Arkyo.app" packaging/macos/pkg/scripts/preinstall` ≥ 1.
- [ ] **Step 4 : Commit**

```bash
git add -A crates/arkyo-tray packaging && git commit -m "feat: nom affiché Strata Arkyo (tray, installateurs)"
```

---

### Task 7 : Documentation, règle d'habillage et vérification visuelle

**Files :**
- Modify : `README.md`, `docs/INSTALL.md`, `docs/ARCHITECTURE.md` (titres et noms affichés ; commandes inchangées), `CLAUDE.md`.
- Dans `CLAUDE.md` :
  - remplacer la règle « copier à l'identique » par « copier, puis retirer le SaaS et appliquer l'habillage Strata, chaque modification commentée » ;
  - ajouter un résumé de la palette et des règles métier.
- Modify : `docs/superpowers/plans/2026-10-26-phase-1-suivi.md`, pour retirer le point « badge de l'icône de désinstallation » s'il est traité.

- [ ] **Step 1 : Rédiger.** Chaque nom de commande, de chemin ou de paquet reste celui du code (`arkyo-server`, `Arkyo-<version>-…`).
- [ ] **Step 2 : Vérifier.** Run : `grep -rn "arkyo\.io" README.md docs CLAUDE.md web/index.html` → aucune occurrence affichée. Run : `cd web && npm test && npx tsc --noEmit && npm run build && cd .. && cargo test --workspace` → PASS.
- [ ] **Step 3 : Commit**

```bash
git add -A README.md docs CLAUDE.md && git commit -m "docs: Strata Arkyo et règle d'habillage"
```

**Vérification visuelle (contrôleur, hors sous-agent).** Le contrôleur fait les captures, avec le binaire construit et une base neuve, dans le navigateur intégré :
- **Avant** : sur `eda897e`, avant la Task 1.
- **Après** : sur le résultat.
- **Écrans** : connexion, premier lancement, changement de mot de passe, coquille, notifications, sélecteur de langue, page Système, en clair et en sombre.
- **Comparaisons** : avec la maquette validée et `cg:docs/screenshots/home.png`.

Toute différence de disposition entre avant et après est un défaut.

## Fin de chantier

- `cd web && npm test && npx tsc --noEmit && npm run build`, `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings` passent.
- Captures avant/après jointes au rapport.
- Push, CI, Release de test, puis éventuel tag `v0.2.0` : uniquement sur accord de Damien.
