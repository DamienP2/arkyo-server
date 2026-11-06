// arkyo-server: habillage Strata — balayage des couleurs codées en dur dans les
// fichiers copiés d'arkyo (spec §7 et §9.2-§9.3). Couleur d'interface → variable
// du thème ; couleur métier → inchangée, listée ci-dessous avec sa raison.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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
  // Phase 2 (Task 11) : catalogue et éditeurs.
  "app/(app)/admin/catalogue/_components/adapters-list-panel.tsx",
  "app/(app)/admin/catalogue/_components/cables-list-panel.tsx",
  "app/(app)/admin/catalogue/_components/equipment-list-panel.tsx",
  "app/(app)/admin/catalogue/_components/safe-fetch.ts",
  "app/(app)/admin/catalogue/_components/tenant-catalogue-types.ts",
  "app/(app)/admin/catalogue/_components/use-catalogue-sync.ts",
  "app/(app)/admin/catalogue/_components/use-tenant-visibility.ts",
  "app/(app)/admin/catalogue/_lib/use-deleted-item-redirect.ts",
  "app/(app)/admin/catalogue/adapters/[id]/_client.tsx",
  "app/(app)/admin/catalogue/adapters/[id]/adapter-editor.tsx",
  "app/(app)/admin/catalogue/adapters/[id]/page.tsx",
  "app/(app)/admin/catalogue/adapters/new/_client.tsx",
  "app/(app)/admin/catalogue/adapters/new/page.tsx",
  "app/(app)/admin/catalogue/cables/[id]/_client.tsx",
  "app/(app)/admin/catalogue/cables/[id]/cable-editor.tsx",
  "app/(app)/admin/catalogue/cables/[id]/page.tsx",
  "app/(app)/admin/catalogue/cables/new/_client.tsx",
  "app/(app)/admin/catalogue/cables/new/page.tsx",
  "app/(app)/admin/catalogue/catalogue-client.tsx",
  "app/(app)/admin/catalogue/equipment/[id]/_client.tsx",
  "app/(app)/admin/catalogue/equipment/[id]/page.tsx",
  "app/(app)/admin/catalogue/equipment/_lib/merge-catalog-types.ts",
  "app/(app)/admin/catalogue/equipment/_lib/merge-personal-refs.ts",
  "app/(app)/admin/catalogue/equipment/new/_client.tsx",
  "app/(app)/admin/catalogue/equipment/new/page.tsx",
  "app/(app)/admin/catalogue/page.tsx",
  "app/(app)/admin/equipment/[id]/_editor/capacity-ip-tab.tsx",
  "app/(app)/admin/equipment/[id]/_editor/connectivity-tab.tsx",
  "app/(app)/admin/equipment/[id]/_editor/custom-fields.tsx",
  "app/(app)/admin/equipment/[id]/_editor/distribution-tab.tsx",
  "app/(app)/admin/equipment/[id]/_editor/general-tab.tsx",
  "app/(app)/admin/equipment/[id]/_editor/physical-tab.tsx",
  "app/(app)/admin/equipment/[id]/_editor/shared.tsx",
  "app/(app)/admin/equipment/[id]/_editor/sub-tab-bar.tsx",
  "app/(app)/admin/equipment/[id]/_editor/tab-bar.tsx",
  "app/(app)/admin/equipment/[id]/_editor/types.ts",
  "app/(app)/admin/equipment/[id]/equipment-editor.tsx",
  // Phase 2 (Task 12) : utilisateurs, espace et profil.
  "app/(app)/admin/users/page.tsx",
  "app/(app)/admin/users/users-client.tsx",
  "app/(app)/admin/users/_components/permissions-panel.tsx",
  "app/(app)/admin/users/_components/roles-panel.tsx",
  "app/(app)/admin/users/_components/users-list-panel.tsx",
  "app/(app)/admin/espace/page.tsx",
  "app/(app)/admin/espace/espace-client.tsx",
  "app/(app)/admin/espace/_components/informations-tab.tsx",
  "app/(app)/profile/page.tsx",
  "app/(app)/profile/profile-client.tsx",
  "app/(app)/profile/_components/identity-tab.tsx",
  "app/(app)/profile/_components/notifications-tab.tsx",
  "app/(app)/settings/page.tsx",
  "app/supervisor/users/[id]/_editor/avatar-upload-shared.tsx",
  "app/supervisor/users/[id]/_editor/types.ts",
  "app/supervisor/users/[id]/_editor/ui.tsx",
  "lib/tenant-membership-context.tsx",
  // Phase 3 (Task 6) : tableau de bord et redirections.
  "app/(app)/dashboard/page.tsx",
  "app/(app)/projects/[id]/page.tsx",
  "app/(app)/racks/page.tsx",
  "app/(app)/rigs/page.tsx",
  "app/(app)/panels/page.tsx",
  // Phase 3 (Task 7) : liste des projets.
  "app/(app)/projects/page.tsx",
  "app/(app)/projects/projects-client.tsx",
  // Phase 3 (Task 8) : assistant « Nouveau projet ».
  "components/projects/new-project-dialog.tsx",
  "components/racks/rack-wizard-steps.tsx",
  // Phase 3 (Task 9) : `/templates`, onglet Contenants.
  "app/(app)/templates/page.tsx",
  "app/(app)/templates/templates-client.tsx",
  "app/(app)/racks/racks-client.tsx",
  "components/racks/new-rack-wizard.tsx",
  // Phase 3 (Task 10) : onglet Panels et détail de régie.
  "app/(app)/panels/panels-client.tsx",
  "components/panels/new-panel-wizard.tsx",
  "app/(app)/rigs/[id]/page.tsx",
  "app/(app)/rigs/[id]/rig-detail-client.tsx",
  // Phase 3 (Task 11) : dépendances de l'éditeur de panel.
  "app/(fullscreen)/panels/[id]/page.tsx",
  "components/editor-shell/topbar-actions-context.tsx",
  "components/synoptique/components/synoptic-general-panel.tsx",
  "components/synoptique/components/synoptic-help-modal.tsx",
  "components/synoptique/components/synoptic-shortcuts-modal.tsx",
  "components/synoptique/components/remote-cursors-overlay.tsx",
  "components/synoptique/hooks/use-live-cursors.ts",
  "lib/services/rack-validation.ts",
  // Phase 3 (Task 12) : éditeur de panel.
  "app/(fullscreen)/panels/[id]/panel-editor.tsx",
  // Phase 4a (Task 8) : socle de l'éditeur projet. Le bouchon
  // `project/[id]/_components/project-editor.tsx` n'est pas une copie (décision 1).
  "app/(fullscreen)/project/[id]/layout.tsx",
  "app/(fullscreen)/project/[id]/page.tsx",
  "components/editor-shell/editor-shell.tsx",
  "components/editor-shell/hooks/use-workspace.ts",
  "components/editor-shell/tool-registry.ts",
  "components/editor-shell/tool-topbar-ui.tsx",
  "components/editor-shell/workspace-context.tsx",
  "components/editor-shell/workspace-store.ts",
  "components/synoptique/lib/colors.ts",
  "components/synoptique/lib/constants.ts",
  "components/synoptique/lib/types.ts",
  "lib/client-id.ts",
  "lib/export/synoptic-capture.ts",
  "lib/pdf/load-jspdf.ts",
  "lib/pdf/synoptic-vector.ts",
  // Phase 4a (Task 9) : coquille de l'éditeur projet. Les bouchons des phases
  // 4a (inventaire), 4b (Rack), 4c (Synoptique), 5 et 6 ne sont pas des copies
  // (décision 1).
  "app/(fullscreen)/project/[id]/_components/project-editor.tsx",
  "app/(fullscreen)/project/[id]/_components/pending-export-store.ts",
  "app/(fullscreen)/project/[id]/_editor/project-characteristics-dialog.tsx",
  "app/(fullscreen)/project/[id]/_editor/project-contextual-topbar.tsx",
  "app/(fullscreen)/project/[id]/_editor/project-global-topbar.tsx",
  "app/(fullscreen)/project/[id]/_editor/project-header-block.tsx",
  "app/(fullscreen)/project/[id]/_editor/project-info-panel.tsx",
  "app/(fullscreen)/project/[id]/_editor/project-tabs-pill.tsx",
  "app/(fullscreen)/project/[id]/_editor/tab-bar.tsx",
  "app/(fullscreen)/project/[id]/_editor/ui.tsx",
  "app/(fullscreen)/project/[id]/fiche/fiche-client.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_lib/bom-table.ts",
  // Phase 4a (Task 10) : inventaire 1/3. Les bouchons des Tasks 11 et 12
  // (`catalog-panel`, `add-container-wizard`, `rack-card-canvas`,
  // `container-sheet-card`, panneaux de contenant et d'item, export) ne sont
  // pas des copies (décision 1).
  "app/(fullscreen)/project/[id]/_hooks/use-project-sync.ts",
  "app/(fullscreen)/project/[id]/inventaire/inventaire-client.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/inventaire-contextual-topbar.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/inventaire-help-modal.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/inventaire-info-panel.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/inventaire-left-toolbar.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/inventaire-scope.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/inventaire-shortcuts-modal.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/inventaire-side-panel.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/location-properties-panel.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/location-selector-dropdown.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/location-sheet.tsx",
  // Phase 4a (Task 11) : inventaire 2/3.
  "app/(fullscreen)/project/[id]/inventaire/_components/add-container-wizard.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/catalog-panel.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/component-config-modal.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/template-selector.tsx",
  "components/synoptique/components/accessory-face.tsx",
  // Phase 4a (Task 12) : inventaire 3/3 et exports. Il ne reste aucun bouchon
  // de l'inventaire.
  "app/(fullscreen)/project/[id]/_components/export-menu.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/container-properties-panel.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/container-sheet-card.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/equipment-card.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/inventaire-export.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/item-properties-panel.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/rack-card-canvas.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/rack-mini-svg.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_components/slot-ruler.tsx",
  "app/(fullscreen)/project/[id]/inventaire/_lib/bom-pdf.ts",
  "app/(fullscreen)/project/[id]/reseau/_components/shared/export-capture.ts",
  "app/(fullscreen)/project/[id]/reseau/_components/shared/export-pdf.ts",
  "lib/export/download-blob.ts",
  "lib/export/technical-table-pdf.ts",
  "lib/print/technical-frame.ts",
  "lib/services/export/csv.ts",
  // Phase 4b (Task 3) : composants rack partagés. Les bouchons 4b restants
  // (`rack/**`, `rack-placement-canvas`) ne sont pas des copies (décision 1).
  "app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-bom-item.tsx",
  "app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-items.tsx",
  "app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-slot.tsx",
  "app/(app)/rigs/[id]/rack/[rackId]/_components/panel-rack-visual.tsx",
  "app/(app)/rigs/[id]/rack/[rackId]/_components/port-label-editor.tsx",
  "app/(app)/rigs/[id]/rack/[rackId]/_components/projected-slot.tsx",
  "app/(app)/rigs/[id]/rack/[rackId]/_components/rack-visual.tsx",
  "app/(app)/rigs/[id]/rack/[rackId]/_components/side-rack-visual.tsx",
  "app/(app)/rigs/[id]/rack/[rackId]/_components/toast-stack.tsx",
  "app/(app)/rigs/[id]/rack/[rackId]/_hooks/use-rack-bom.ts",
  "app/(app)/rigs/[id]/rack/[rackId]/_shell/slot-context-menu.tsx",
  "components/synoptique/components/slot-properties-panel.tsx",
  "components/synoptique/hooks/use-confirm.ts",
  "components/synoptique/hooks/use-rack-sync.ts",
  "components/synoptique/hooks/use-toasts.ts",
  "components/synoptique/lib/collision.ts",
  "components/synoptique/lib/panel-labels.ts",
  "lib/hooks/use-catalog-lookup.ts",
  "lib/services/rack-inventory.ts",
  // Phase 4b (Task 4) : onglet Rack. Restent des bouchons (décision 1) :
  // `rack-placement-canvas` (Task 5), `location-placement-canvas` (Task 6)
  // et `rack-export` (Task 7).
  "app/(fullscreen)/project/[id]/rack/rack-tab-client.tsx",
  "app/(fullscreen)/project/[id]/rack/_components/category-legend.tsx",
  "app/(fullscreen)/project/[id]/rack/_components/rack-drag-eligibility.tsx",
  "app/(fullscreen)/project/[id]/rack/_components/rack-info-panel.tsx",
  "app/(fullscreen)/project/[id]/rack/_components/rack-location-info-panel.tsx",
  "app/(fullscreen)/project/[id]/rack/_components/rack-location-selector-dropdown.tsx",
  "app/(fullscreen)/project/[id]/rack/_components/rack-tab-left-toolbar.tsx",
  "app/(fullscreen)/project/[id]/rack/_components/rack-tab-side-panel.tsx",
];

/** Fichiers posés sur la topbar ou le rail : ils suivent le thème (variante « Clair A »). */
const CHROME_FILES = [
  "components/layout/topbar.tsx",
  "components/layout/sidebar.tsx",
  "components/notifications-panel.tsx",
  "components/locale-selector.tsx",
  "components/presence/presence-avatars.tsx",
  // Phase 4a (Task 9) : topbar globale de l'éditeur projet et ses onglets.
  "app/(fullscreen)/project/[id]/_editor/project-global-topbar.tsx",
  "app/(fullscreen)/project/[id]/_editor/project-tabs-pill.tsx",
  "app/(fullscreen)/project/[id]/_editor/project-contextual-topbar.tsx",
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

/** Mêmes badges de rôle dans le bandeau du profil (OWNER et TECHNICIEN sur une ligne, comme arkyo). */
const PROFILE_ROLE_BADGE: Allow = {
  line: /cls: "text-(purple|indigo|emerald|slate)-\d{3} bg-\1-50 dark:text-\1-\d{3} dark:bg-\1-950\/30"/,
  reason: ROLE_BADGE.reason,
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

/** Phase 3 (Task 8) : baie dessinée de l'écran d'accueil de l'assistant « Nouveau projet ». */
const RACK_MOCKUP: Allow = {
  line: /className="[^"]*\b(bg|border)-(zinc|blue|emerald|amber)-[4-7]00\/(15|30|40|60)\b[^"]*"/,
  reason:
    "baie dessinée de l'écran d'accueil de l'assistant projet (équipements colorés, U noir, U vide en pointillés) : " +
    "rendu des plans, comme les illustrations des autres assistants, " + DOUBT,
};
const RACK_MOCKUP_2110: Allow = {
  line: /<span className="rounded bg-emerald-500\/20 px-1 py-0\.5 text-\[7px\] font-bold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">$/,
  reason: "étiquette « 2110 » (SMPTE ST 2110) du réseau dessiné de l'écran d'accueil : marqueur métier, comme TAG_2110, " + DOUBT,
};

/** Phase 3 (Task 9) : contenants dessinés de l'écran d'accueil de l'assistant « Nouveau contenant ». */
const CONTAINER_MOCKUP: Allow = {
  line: /^\s*(border|bg|text|dot): "(border|bg|text)-(blue|amber|cyan|violet)-[4-6]00\/\d+( dark:text-\3-400\/\d+)?",$/,
  reason:
    "teintes des quatre contenants dessinés de l'écran d'accueil de l'assistant contenant (baie, flight case, Pelicase, rack) : " +
    "rendu des plans, comme RACK_MOCKUP, " + DOUBT,
};
/** Couleurs des types de contenant (`RACK_TYPE_COLOR` des étapes, `RACK_TYPE_COLORS` de la liste). */
const RACK_TYPE_COLORS: Allow = {
  line: /^\s*(STANDARD|FLIGHT_CASE_CLASSIC|FLIGHT_CASE_SKB|PELICAN|CAP): "#[0-9a-f]{6}",$/,
  reason: "couleurs des types de contenant (baie, flight case, SKB, Pelicase, mobilier) : couleur métier",
};

/** Phase 3 (Task 10) : panels dessinés de l'écran d'accueil de l'assistant « Nouveau panel ». */
const PANEL_MOCKUP: Allow = {
  line: /^\s*(border|bg|text|dot): "(border|bg|text)-(blue|pink|emerald|cyan)-[4-6]00\/\d+( dark:text-\3-400\/\d+)?",$/,
  reason:
    "teintes des quatre panels dessinés de l'écran d'accueil de l'assistant panel (XLR, BNC, RJ45, fibre) : " +
    "couleurs des connecteurs, comme les SVG de WIZARD_ART, " + DOUBT,
};
/** Couleurs des catégories de signal des panels (`CATEGORY_COLORS`) et leur repli. */
const PANEL_SIGNAL_COLORS: Allow[] = [
  {
    line: /^\s*(AUDIO|VIDEO|DATA|NETWORK|POWER|FIBER|LIGHT): "#[0-9a-f]{6}",$/,
    reason: "couleurs des catégories de signal (pastilles des slots, filtres) : couleur métier",
  },
  { line: /CATEGORY_COLORS\[(cat|c)\] \?\? "#888"/, reason: CONN },
  {
    line: /^\s*background: color \?\? "rgba\(128,128,128,0\.18\)",$/,
    reason: "slot vide de la grille dessinée d'un panel (rendu du plan) : " + DOUBT,
  },
];

/** Phase 4a (Task 9) : statuts de projet de l'éditeur (badge et menu de la topbar, en-tête). */
const PROJECT_STATUS_BADGE: Allow = {
  line: /^\s*(EN_PREPARATION|PRET|EN_COURS|TERMINE|ANNULE): \{ label: "[^"]+", cls: "text-(amber|emerald|indigo|slate|red)-[56]00 bg-\2-500\/10" \},$/,
  reason: "badges des statuts de projet (`STATUS_BADGE` de l'en-tête, non rendu par l'éditeur) : statut métier",
};
const PROJECT_STATUS_HEX: Allow = {
  line: /^\s*(EN_PREPARATION|PRET|EN_COURS|TERMINE|ANNULE): (\{ label: "[^"]+", color: )?"#[0-9a-f]{6}"( \})?,$/,
  reason: "couleurs des statuts de projet (badge plein et pastilles du menu de statut de la topbar, en-tête) : statut métier",
};

/** Phase 4a (Task 10) : section « Équipements libres » de la fiche de lieu (liseré vert). */
const FREE_EQUIPMENT_GREEN: Allow = {
  line: /^\s*(\? "border-emerald-500\/60 bg-emerald-500\/5"|<Boxes className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" \/>|style=\{\{ borderLeftWidth: 3, borderLeftColor: "#2f9e44" \}\})$/,
  reason:
    "vert d'identité des équipements libres d'un lieu (liseré, pictogramme et survol de dépôt), " +
    "pendant de la couleur du type de contenant sur les cartes (RACK_TYPE_COLOR) : couleur métier, " + DOUBT,
};
/** Phase 4a (Task 10) : point de catégorie sans couleur des filtres du catalogue. */
const CATEGORY_DOT_FALLBACK: Allow = {
  line: /^const CATEGORY_DOT_FALLBACK = "#94a3b8"; \/\/ slate-400$/,
  reason: "repli de la couleur d'une catégorie d'équipement (point coloré des filtres) : couleur métier",
};

/** Phase 4a (Task 11) : pastilles des cartes du catalogue de l'inventaire (panneau latéral). */
const CATALOG_DOT_HEX: Allow = {
  line: /^const (PANEL_DOT|ADAPTER_DOT|DEFAULT_CATEGORY|ACCESSORY_DOT)_HEX = "#[0-9a-f]{6}"; \/\/ /,
  reason:
    "pastilles des cartes du catalogue (panels cyan, adaptateurs violet, catégorie absente et accessoires gris), " +
    "alignées sur les couleurs spéciales des baies (`SPECIAL_HEX`) : couleur métier",
};
/** Phase 4a (Task 11) : icônes des cartes « Choisir un template » / « Créer un nouveau » et « Rackable ». */
const CONTAINER_WIZARD_CARD_COLORS: Allow = {
  line: /^\s*color: "#(10b981|8b5cf6|3b82f6|06b6d4)",$/,
  reason: "teinte de l'icône des cartes de choix (modèle, nouveau, rackable, non rackable) de l'assistant contenant : " + DOUBT,
};

/** Phase 4a (Task 12) : couleurs de catégorie de repli des lignes d'inventaire (palettes statiques d'arkyo). */
const CATEGORY_FALLBACK_PALETTE: Allow[] = [
  {
    line: /^\s*"#[0-9a-f]{6}", \/\/ (blue|emerald|amber|red|violet|pink|cyan|lime)$/,
    reason: "palette stable des catégories d'équipement (`categoryColor` de la carte d'équipement) : couleur métier",
  },
  {
    line: /^\s*("[^"]+"|\w+): "#[0-9a-f]{6}",$|^const DEFAULT_COLOR = "#71717a";$/,
    reason: "couleurs de repli des catégories d'équipement, panels et accessoires (`CATEGORY_COLOR` du mini-rack) : couleur métier",
  },
];
/** Phase 4a (Task 12) : rendu des captures et des PDF d'export (fond de page, encre, monogramme). */
const EXPORT_RENDER_HEX: Allow[] = [
  {
    line: /^\s*(color: string = "#14181E",|background(: string)? = "#ffffff",)$/,
    reason: "couleur du monogramme rastérisé et fond blanc des captures exportées (PNG, JPG, PDF) : rendu des exports",
  },
  {
    line: /arkyoLogoPngDataUrl\("#5a74ff", 192\)/,
    reason: "monogramme de l'en-tête des PDF de capture (bande sombre du cartouche) : rendu des PDF",
  },
  {
    line: /^export const (INK|MUTED|WHITE)_HEX = "#[0-9a-f]{6}";$/,
    reason: "encre, gris et blanc du cartouche technique imprimé (« grille allégée ») : rendu des PDF",
  },
];

/** Phase 4b (Task 3) : composants rack partagés (élévations, vue de côté, panels, étiquettes). */
const RACK_DRAWING = "rendu des plans (élévation et vue de côté du contenant)";
const SIDE_VIEW_DRAWING: Allow[] = [
  {
    line: /rgba\(96,165,250,0\.(12|28|9)\)|text-blue-400\/80/,
    reason: "zone de sécurité câbles hachurée bleue, sa borne et sa cote (vue de côté) : " + RACK_DRAWING,
  },
  {
    line: /rgba\(234,179,8,0\.(10|25)\)|bg-yellow-100 px-1 text-\[7px\] font-medium leading-tight text-yellow-900 shadow-sm dark:bg-yellow-900\/40 dark:text-yellow-200/,
    reason: "zone de dépassement hachurée jaune hors du contenant et son badge ⚠ (vue de côté) : " + RACK_DRAWING,
  },
  {
    line: /#fecaca, #fecaca 2px, #fee2e2 2px, #fee2e2 7px|border: "1\.5px solid #ef4444",|className="shrink-0 text-red-500"|font-mono leading-none font-semibold text-red-600"/,
    reason: "collision avant/arrière hachurée rouge, son pictogramme et sa cote (vue de côté) : " + RACK_DRAWING,
  },
  {
    line: /border-l border-dashed border-zinc-(200\/70|400\/50)"$/,
    reason: "ligne médiane et ligne arrière intérieure en pointillés (vue de côté) : " + RACK_DRAWING,
  },
];
const PANEL_FACEPLATE: Allow[] = [
  {
    line: /rgba\(0,0,0,0\.(35|55|22|45|06|3|04)\)|solid #(aaa|bbb)"/,
    reason: "façade d'un panel de patch dessinée sur fond blanc (vis, trous, connecteurs) : " + RACK_DRAWING,
  },
];
const PANEL_FACEPLATE_WHITE: Allow = {
  line: /<div className="h-full w-full" style=\{\{ background: "#fff" \}\}>$/,
  reason: "fond blanc de la façade d'un panel en vue réelle (`PanelRackVisual`) : " + RACK_DRAWING,
};
const PORT_LABEL_STRIP: Allow = {
  line: /^\s*background: "#ffffff",$|text-\[9px\] font-bold tracking-wide text-\[#111\] uppercase/,
  reason: "bandeau d'étiquettes N2 d'un panel, toujours blanc à encre noire comme l'étiquette imprimée : rendu des étiquettes",
};
const FREE_STANDING_TAG: Allow = {
  line: /<span className="font-semibold text-amber-600( dark:text-amber-400)?">Libre<\/span>$/,
  reason: "étiquette « Libre » d'un équipement non rackable (posé sur étagère) : marqueur métier, comme « Lum », " + DOUBT,
};
const DRAG_OVERLAY_ON_CATEGORY: Allow = {
  line: /^\s*<(div|p) className="mt-0\.5 (flex items-center gap-2 )?text-\[10px\] text-zinc-400">$/,
  reason:
    "sous-titre de l'aperçu de glisser, posé sur la teinte claire fixe de la couleur de catégorie (`hexTint`) : " +
    "rendu de l'équipement dans sa couleur métier",
};

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
  // Phase 2 (Task 11) : catalogue et éditeurs.
  "app/(app)/admin/catalogue/_components/equipment-list-panel.tsx": [TAG_2110],
  // Phase 2 (Task 12) : utilisateurs, espace et profil.
  "app/(app)/profile/profile-client.tsx": [PROFILE_ROLE_BADGE],
  // Phase 3 (Task 8) : assistant « Nouveau projet ».
  "components/projects/new-project-dialog.tsx": [RACK_MOCKUP],
  // Phase 3 (Task 9) : assistant « Nouveau contenant ».
  "components/racks/new-rack-wizard.tsx": [RACK_MOCKUP, CONTAINER_MOCKUP],
  // Phase 3 (Task 10) : assistant « Nouveau panel ».
  "components/panels/new-panel-wizard.tsx": [PANEL_MOCKUP],
  // Phase 4a (Task 9) : coquille de l'éditeur projet.
  "app/(fullscreen)/project/[id]/_editor/project-header-block.tsx": [PROJECT_STATUS_BADGE],
  // Phase 4a (Task 11) : assistant « Ajouter un contenant » (mêmes contenants dessinés que l'assistant contenant).
  "app/(fullscreen)/project/[id]/inventaire/_components/add-container-wizard.tsx": [RACK_MOCKUP, CONTAINER_MOCKUP],
  // Phase 4b (Task 3) : composants rack partagés.
  "app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-items.tsx": [DRAG_OVERLAY_ON_CATEGORY],
  "app/(app)/rigs/[id]/rack/[rackId]/_components/side-rack-visual.tsx": SIDE_VIEW_DRAWING,
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
  // Phase 2 (Task 12) : utilisateurs, espace et profil.
  "app/(app)/profile/profile-client.tsx": [PROFILE_ROLE_BADGE],
  "components/adapters/new-adapter-wizard.tsx": WIZARD_ART,
  "components/cables/new-cable-wizard.tsx": WIZARD_ART,
  "components/equipment/new-equipment-wizard.tsx": WIZARD_ART,
  // Phase 2 (Task 10) : page Paramètres.
  "app/(app)/admin/parametres/_components/cable-label-stocks-section.tsx": [STOCK_LAMINATING],
  "app/(app)/admin/parametres/_components/dimensions-panel.tsx": [TOURET_BADGE],
  // Phase 2 (Task 11) : catalogue et éditeurs.
  "app/(app)/admin/catalogue/_components/equipment-list-panel.tsx": [
    {
      line: /<span className="inline-flex items-center gap-0\.5 rounded-md bg-amber-500\/10 px-1\.5 py-0\.5 text-\[9px\] font-medium text-amber-600 dark:text-amber-400">$/,
      reason: "étiquette « Lum » (projecteur lumière) d'un équipement : marqueur métier, comme « 2110 », " + DOUBT,
    },
  ],
  // Phase 3 (Task 8) : assistant « Nouveau projet ».
  "components/projects/new-project-dialog.tsx": [...WIZARD_ART, RACK_MOCKUP, RACK_MOCKUP_2110],
  // Phase 3 (Task 9) : assistant « Nouveau contenant ».
  "components/racks/new-rack-wizard.tsx": [...WIZARD_ART, RACK_MOCKUP, CONTAINER_MOCKUP],
  // Phase 3 (Task 10) : assistant « Nouveau panel ».
  "components/panels/new-panel-wizard.tsx": [...WIZARD_ART, PANEL_MOCKUP],
  // Phase 4a (Task 9) : coquille de l'éditeur projet.
  "app/(fullscreen)/project/[id]/_editor/project-header-block.tsx": [PROJECT_STATUS_BADGE],
  // Phase 4a (Task 10) : inventaire 1/3.
  "app/(fullscreen)/project/[id]/inventaire/_components/location-sheet.tsx": [FREE_EQUIPMENT_GREEN],
  // Phase 4a (Task 11) : inventaire 2/3.
  "app/(fullscreen)/project/[id]/inventaire/_components/add-container-wizard.tsx": [...WIZARD_ART, RACK_MOCKUP, CONTAINER_MOCKUP],
  // Phase 4b (Task 3) : composants rack partagés.
  "app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-items.tsx": [FREE_STANDING_TAG],
  "app/(app)/rigs/[id]/rack/[rackId]/_components/side-rack-visual.tsx": SIDE_VIEW_DRAWING,
};

test("erreurs, succès et alertes suivent --danger, --success et --warning", () => {
  expect(COPIED_FILES.flatMap((f) => offending(f, STATUS, ALLOW_STATUS[f]))).toEqual([]);
});

// Texte d'erreur : `--destructive` (#e11d48) est un fond plein (boutons de
// danger, blanc dessus) ; en texte il descend sous 4,5:1 (3,3 à 4,3 selon le
// fond). Le texte passe par `--danger-text`. Seules les icônes au survol
// (`hover:` / `group-hover:`, 3:1 suffit) gardent `--destructive`.
const DESTRUCTIVE_TEXT = /(?<=^|[\s"'`{(])((?:[\w\-[\]&=.]+:)*)text-(?:destructive|\[var\(--destructive\)\])(?![\w-])/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

test("le texte d'erreur utilise --danger-text, jamais --destructive (hors icônes au survol)", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(__dirname)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((text, i) => {
        for (const m of text.matchAll(DESTRUCTIVE_TEXT)) {
          if (!/(^|-)hover:$/.test(m[1])) offenders.push(`${relative(__dirname, file)}:${i + 1}: ${m[0]}`);
        }
      });
  }
  expect(offenders).toEqual([]);
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
  // Phase 2 (Task 11) : catalogue et éditeurs.
  "app/(app)/admin/catalogue/_components/equipment-list-panel.tsx": [
    {
      line: /color: fn\?\.color \?\? "#a3a3a3",|item\.functions\?\.\[0\]\?\.color \?\? item\.equipmentCategory\?\.color \?\? "#a3a3a3";/,
      reason: "couleur de la fonction (groupe, carte) et son repli : couleur métier",
    },
  ],
  "app/(app)/admin/catalogue/_components/cables-list-panel.tsx": [
    { line: /it(em)?\.function\?\.color \?\? "#a3a3a3"/, reason: "couleur de la fonction (groupe, carte, ligne) et son repli : couleur métier" },
  ],
  "app/(app)/admin/catalogue/_components/adapters-list-panel.tsx": [
    { line: /it\.function\?\.color \?\? "#a3a3a3",/, reason: "couleur de la fonction (groupe) et son repli : couleur métier" },
    { line: /item\.function\?\.color \?\? "#06b6d4";/, reason: "couleur par défaut d'un adaptateur (comme adapter-card) : couleur métier" },
    { line: /(srcCt|ct)\?\.color \?\? "#a3a3a3";/, reason: CONN },
  ],
  "app/(app)/admin/catalogue/equipment/_lib/merge-catalog-types.ts": [
    { line: /^const DEFAULT_COLOR = "#6366f1";$/, reason: "couleur par défaut d'une fonction (types de classification) : couleur métier" },
  ],
  "app/(app)/admin/catalogue/equipment/_lib/merge-personal-refs.ts": [
    { line: /color: s\.color \?\? "#6b7280",/, reason: "couleur du signal et son défaut Prisma : couleur métier" },
  ],
  "app/(app)/admin/equipment/[id]/equipment-editor.tsx": [
    { line: /color: fn\?\.color \?\? "#6366f1" \},/, reason: "couleur de la fonction d'un type créé à la volée (même défaut que mergeCatalogTypes) : couleur métier" },
  ],
  "app/(app)/admin/equipment/[id]/_editor/connectivity-tab.tsx": [
    { line: /"#94a3b8"/, reason: "couleur du signal ou de sa fonction et son repli : couleur métier" },
    { line: /const directionColor = dirOpt\?\.color \?\? "#6366f1";/, reason: "couleur de direction d'un port (repli = bidirectionnel) : couleur métier" },
  ],
  "app/(app)/admin/equipment/[id]/_editor/shared.tsx": [
    { line: /\{ background: cat\.color, color: "#fff", borderColor: "transparent" \}/, reason: "pastille de catégorie de signal sur sa propre couleur : couleur métier" },
    {
      line: /^\s*(color: "#8b5cf6",|backgroundColor: "color-mix\(in srgb, #8b5cf6 14%, transparent\)",)$/,
      reason: "marqueur protocole « MC » (redondance ST 2022-7) d'un signal : marqueur métier, comme « 2110 », " + DOUBT,
    },
  ],
  "app/(app)/admin/equipment/[id]/_editor/types.ts": [
    { line: /^\s*(FRONT|REAR|LEFT|RIGHT|TOP|BOTTOM): "#[0-9a-f]{6}",$/, reason: "couleurs des faces d'un équipement : couleur métier" },
    {
      line: /\{ value: "(IN|OUT|BOTH)", label: "[^"]+", short: "[^"]+", color: "#[0-9a-f]{6}" \},/,
      reason: "couleurs des directions de port (entrée, sortie, bidirectionnel) : couleur métier",
    },
  ],
  // Phase 2 (Task 12) : utilisateurs, espace et profil.
  "app/(app)/admin/users/_components/roles-panel.tsx": [
    {
      line: /^\s*"#[0-9a-f]{6}",$|value=\{color \?\? "#6b7280"\}/,
      reason: "pastilles proposées pour la couleur d'un rôle (choisie par l'utilisateur) et son repli : couleur métier (--role-*)",
    },
  ],
  "app/(app)/admin/users/_components/permissions-panel.tsx": [
    {
      line: /^\s*(read|write|admin): \{ bg: "#[0-9a-f]{8}", color: "#[0-9a-f]{6}", label: "[^"]+" \},$/,
      reason: "niveaux de permission (Lecture gris, Écriture vert, Admin rouge) : statut métier, " + DOUBT,
    },
  ],
  // Phase 3 (Task 6) : tableau de bord.
  "app/(app)/dashboard/page.tsx": [
    {
      line: /^\s*(EN_PREPARATION|PRET|EN_COURS|TERMINE|ANNULE): "#[0-9a-f]{6}",$/,
      reason: "couleurs des statuts de projet (pastilles, badges, répartition) : statut métier",
    },
    {
      line: /^\s*color="#(3b82f6|10b981|8b5cf6|f59e0b)"$|^\s*(\{ href: "\/projects", label: "Projets", icon: FolderOpen, )?color: "#(3b82f6|10b981|8b5cf6|f59e0b)"( \})?,$/,
      reason: "teinte de l'icône de chaque carte de statistiques et de chaque accès rapide : " + DOUBT,
    },
  ],
  // Phase 3 (Task 7) : liste des projets.
  "app/(app)/projects/projects-client.tsx": [
    {
      line: /^\s*(EN_PREPARATION|PRET|EN_COURS|TERMINE|ANNULE): "#[0-9a-f]{6}", \/\/ /,
      reason: "couleurs des statuts de projet (bordure et en-tête des cartes, groupes, filtres) : statut métier",
    },
  ],
  "app/(app)/admin/equipment/[id]/_editor/distribution-tab.tsx": [
    {
      line: /^\s*color: "#(71717a|10b981|6366f1|8b5cf6)",$/,
      reason: "couleurs des plans de l'onglet Distribution (supervisor) : jamais rendu, l'éditeur tenant passe showDistribution={false}",
    },
  ],
  // Phase 3 (Task 8) : assistant « Nouveau projet » et étapes de contenant.
  "components/projects/new-project-dialog.tsx": WIZARD_ART,
  "components/racks/rack-wizard-steps.tsx": [
    RACK_TYPE_COLORS,
    {
      line: /^\s*color: "#(3b82f6|06b6d4)",$/,
      reason: "teinte de l'icône des cartes « Rackable » / « Non rackable » : " + DOUBT,
    },
  ],
  // Phase 3 (Task 9) : `/templates`, onglet Contenants.
  "app/(app)/racks/racks-client.tsx": [RACK_TYPE_COLORS],
  "components/racks/new-rack-wizard.tsx": WIZARD_ART,
  // Phase 3 (Task 10) : onglet Panels.
  "app/(app)/panels/panels-client.tsx": PANEL_SIGNAL_COLORS,
  "components/panels/new-panel-wizard.tsx": WIZARD_ART,
  // Phase 3 (Task 11) : dépendances de l'éditeur de panel.
  "components/editor-shell/topbar-actions-context.tsx": [
    {
      line: /^\s*(color|synopticLabelColor|synopticLabelPillBg|zoneColor|designGridColor|gridColor|rulerColor): "#[0-9a-f]{6}",$/,
      reason:
        "couleurs par défaut des étiquettes, zones, grilles et règles dessinées sur le plan (modifiables par l'utilisateur) : " +
        "rendu des plans, couleur métier",
    },
  ],
  "components/synoptique/components/synoptic-general-panel.tsx": [
    {
      line: /^\s*"#[0-9a-f]{6}",$|value=\{value \?\? "#6366f1"\}|setGridColor\(c \?\? "#808080"\)/,
      reason:
        "pastilles proposées pour la couleur de la grille et des zones (choisie par l'utilisateur), sélecteur libre et repli : " +
        "couleur métier",
    },
  ],
  "components/synoptique/components/remote-cursors-overlay.tsx": [
    { line: /^\s*stroke="#ffffff"$/, reason: "contour de la flèche d'un curseur distant (couleur du pair) : avatar de présence" },
  ],
  "components/synoptique/hooks/use-live-cursors.ts": [
    { line: /color: m(sg)?\.color \?\? "#64748b",$/, reason: "couleur de repli d'un pair (curseur, avatar) : avatar de présence" },
  ],
  // Phase 3 (Task 12) : éditeur de panel.
  "app/(fullscreen)/panels/[id]/panel-editor.tsx": [
    {
      line: /^const NEUTRAL_COLOR = "#888";$|^\s*color: catColorMap\[cat\] \?\? "#888",$/,
      reason: "teinte de repli d'un connecteur ou d'une famille sans fonction : " + CONN,
    },
    {
      line: /^\s*: "1px dashed rgba\(0,0,0,0\.22\)";$|^\s*border: "(1\.5px solid rgba\(0,0,0,0\.35\)|2px solid #aaa)",$|^\s*border(Right|Left): "1px solid #bbb",$|^\s*color: "rgba\(0,0,0,0\.35\)",$/,
      reason:
        "face du panel dessinée à l'échelle (contour, oreilles et trous de fixation, découpes vides, numéros des slots) : " +
        "rendu des plans, couleur métier",
    },
    {
      line: /^\s*<(circle|rect) [^>]*fill="#52525b" ?\/?>?$|^\s*stroke="#E8E8E8"$/,
      reason:
        "pictogrammes Neutrik D / générique des densités du composant `PanelConfigInline` d'arkyo (jamais rendu) : " +
        "symboles de connecteurs, couleur métier",
    },
    {
      line: /^\s*color: "#(3b82f6|22c55e|ef4444|f59e0b|8b5cf6|64748b)",$/,
      reason: "teinte de l'icône de chaque section du guide de l'éditeur : " + DOUBT,
    },
  ],
  // Phase 4a (Task 8) : socle de l'éditeur projet.
  "components/synoptique/lib/colors.ts": [
    {
      line: /^\s*"(Panels de patch|Accessoire rack)": "#[0-9a-f]{6}",$|^export const DEFAULT_HEX = "#71717a";$/,
      reason:
        "couleurs des catégories « Panels de patch » / « Accessoire rack » et repli d'une catégorie sans couleur " +
        "(pastilles et teintes des équipements dans les baies et le synoptique) : couleur métier",
    },
  ],
  "components/synoptique/lib/constants.ts": [
    {
      line: /^\s*"#[0-9a-f]{6}",$/,
      reason: "palette proposée pour les groupes d'étiquettes des ports d'un panel (`LABEL_COLORS`, choisie par l'utilisateur) : couleur métier",
    },
  ],
  // Phase 4a (Task 9) : coquille de l'éditeur projet.
  "app/(fullscreen)/project/[id]/_editor/project-global-topbar.tsx": [PROJECT_STATUS_HEX],
  "app/(fullscreen)/project/[id]/_editor/project-header-block.tsx": [PROJECT_STATUS_HEX],
  // Phase 4a (Task 10) : inventaire 1/3.
  "app/(fullscreen)/project/[id]/inventaire/_components/inventaire-contextual-topbar.tsx": [CATEGORY_DOT_FALLBACK],
  "app/(fullscreen)/project/[id]/inventaire/_components/location-sheet.tsx": [FREE_EQUIPMENT_GREEN],
  // Phase 4a (Task 11) : inventaire 2/3.
  "app/(fullscreen)/project/[id]/inventaire/_components/add-container-wizard.tsx": [
    ...WIZARD_ART,
    RACK_TYPE_COLORS,
    CONTAINER_WIZARD_CARD_COLORS,
  ],
  "app/(fullscreen)/project/[id]/inventaire/_components/catalog-panel.tsx": [CATALOG_DOT_HEX],
  // Phase 4a (Task 12) : inventaire 3/3 et exports.
  "app/(fullscreen)/project/[id]/inventaire/_components/equipment-card.tsx": CATEGORY_FALLBACK_PALETTE,
  "app/(fullscreen)/project/[id]/inventaire/_components/rack-card-canvas.tsx": [RACK_TYPE_COLORS],
  "app/(fullscreen)/project/[id]/inventaire/_components/rack-mini-svg.tsx": CATEGORY_FALLBACK_PALETTE,
  "app/(fullscreen)/project/[id]/reseau/_components/shared/export-capture.ts": EXPORT_RENDER_HEX,
  "lib/print/technical-frame.ts": EXPORT_RENDER_HEX,
  // Phase 4b (Task 3) : composants rack partagés.
  "app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-bom-item.tsx": [
    {
      line: /^\s*\? "#71717a"$/,
      reason: "couleur des accessoires de rack (plaque, étagère, tiroir) dans la liste d'inventaire : couleur métier",
    },
  ],
  "app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-items.tsx": [{ line: /ps\?\.connectorType\?\.color \?\? "#555";/, reason: CONN }],
  "app/(app)/rigs/[id]/rack/[rackId]/_components/draggable-slot.tsx": [PANEL_FACEPLATE_WHITE],
  "app/(app)/rigs/[id]/rack/[rackId]/_components/panel-rack-visual.tsx": PANEL_FACEPLATE,
  "app/(app)/rigs/[id]/rack/[rackId]/_components/port-label-editor.tsx": [PORT_LABEL_STRIP],
  "app/(app)/rigs/[id]/rack/[rackId]/_components/side-rack-visual.tsx": SIDE_VIEW_DRAWING,
  "components/synoptique/components/slot-properties-panel.tsx": [
    { line: /const color = ct\?\.color \?\? "#71717a";/, reason: CONN },
  ],
  // Phase 4b (Task 4) : onglet Rack (pastille et badge du type de contenant).
  "app/(fullscreen)/project/[id]/rack/_components/rack-info-panel.tsx": [RACK_TYPE_COLORS],
  "app/(fullscreen)/project/[id]/rack/_components/rack-tab-side-panel.tsx": [RACK_TYPE_COLORS],
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
  "app/(fullscreen)/project/[id]/_editor/project-global-topbar.tsx": [
    {
      line: /className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-0\.5 text-\[10px\] font-bold tracking-wider uppercase text-white /,
      reason: "badge de statut : texte blanc sur la couleur du statut (STATUS_META), statut métier",
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

test.each(["components/layout/topbar.tsx", "app/(app)/profile/profile-client.tsx"])("badges de rôle (%s) : contraste >= 4,5:1 en clair et en sombre", (file) => {
  const roles = [...read(file).matchAll(/cls: "([^"]+)"/g)].map((m) => m[1]);
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
