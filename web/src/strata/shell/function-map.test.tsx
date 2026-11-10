/**
 * « Où vit chaque fonction » (spec v2 §7) : pour chaque ligne de la table,
 * l'application est rendue en interface Strata à la route où la fonction
 * vit, et un repère de cette fonction y est cherché ; les bouchons des
 * phases 5 et 6 rendent `ComingSoon` (« Bientôt disponible »).
 *
 * La table est relue dans la spec : une ligne de §7 sans vérification ici
 * fait échouer la suite (et une vérification sans ligne aussi).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import { renderApp, resetApp, type Api } from "@/tests/app-harness";
import { manageApi } from "@/strata/manage/manage-fixtures";
import { useValidationRecordStore } from "@/strata/manage/validation-record";

// Canevas de placement simulé (Konva hors de portée de happy-dom), comme les tests de l'éditeur projet.
vi.mock("@/app/(fullscreen)/project/[id]/rack/_components/rack-placement-canvas", () => ({
  RackDragOverlayContent: () => null,
  RackPlacementCanvas: forwardRef<unknown, { rack: { id: string } }>(function FakeCanvas(props, ref) {
    useImperativeHandle(ref, () => ({
      rackId: props.rack.id,
      ownsSlot: () => false,
      handleDragStart: () => {},
      handleDragOver: () => {},
      handleDragEnd: async () => {},
      cancelDrag: () => {},
      notifyShelfOnlyMiss: () => false,
      clearSelection: () => {},
      fitAll: () => {},
      centerContent: () => {},
      zoomIn: () => {},
      zoomOut: () => {},
    }));
    return <div data-testid="rack-canvas" data-rack={props.rack.id} />;
  }),
}));

const WAIT = { timeout: 15000 };

// ── Données ─────────────────────────────────────────────────────────────────

const LOOKUP = {
  categories: [],
  brands: [],
  connectorTypes: [{ id: "c1", name: "BNC", iconId: "bnc", versions: [], color: "#3b82f6", isActive: true }],
  signals: [{ id: "s1", name: "12G-SDI", color: "#3654ff", functionId: "f1", connectorIds: [], isActive: true }],
  functions: [{ id: "f1", key: "VIDEO", label: "Vidéo", color: "#3b82f6", sortOrder: 1, isActive: true }],
  phases: [],
  types: [],
  cableModels: [],
};

const PERSONAL = { source: "PERSONAL", isAccessible: true, clonedFromArkyoId: null, shadowsArkyo: false };

const EQUIPMENT = {
  ...PERSONAL,
  id: "e1",
  name: "HDC-5500",
  reference: "HDC5500",
  brand: null,
  isRackable: true,
  heightU: 1,
  widthFraction: "FULL",
  weight: 7.5,
  powerW: 180,
  is2110: false,
  connectors: [
    { id: "p1", face: "REAR", connectorTypeId: "c1", signalName: "12G-SDI", quantity: 2, label: "SDI OUT", direction: "OUT", gender: "FEMALE" },
  ],
  functions: [],
  phases: [],
  functionIds: [],
  phaseIds: [],
  isActive: true,
};

const CABLE = {
  ...PERSONAL,
  id: "k1",
  name: "BNC M ↔ BNC M 12G",
  reference: "CB-12G",
  function: { id: "f1", label: "Vidéo", color: "#3b82f6", sortOrder: 1 },
  functionId: "f1",
  leftConnector: { id: "c1", name: "BNC", color: "#3b82f6" },
  leftConnectorId: "c1",
  leftGender: "MALE",
  rightConnector: { id: "c1", name: "BNC", color: "#3b82f6" },
  rightConnectorId: "c1",
  rightGender: "MALE",
  brand: null,
  brandId: null,
  model: null,
  cableModelId: null,
  useCases: ["PRESTATION"],
  availableLengths: [5],
  customMinLength: null,
  customMaxLength: null,
  notes: null,
  imageUrl: null,
  isActive: true,
};

const ADAPTER = {
  ...PERSONAL,
  id: "a1",
  name: "BNC → HDMI",
  reference: "AD-1",
  function: { id: "f1", label: "Vidéo", color: "#3b82f6", sortOrder: 1 },
  functionId: "f1",
  inputs: [{ connectorTypeId: "c1", gender: "FEMALE", quantity: 1, label: "IN" }],
  outputs: [{ connectorTypeId: "c1", gender: "MALE", quantity: 1, label: "OUT" }],
  notes: null,
  imageUrl: null,
  isActive: true,
};

/** Une API pour tout le site : projet p1 (fixtures de Gérer), catalogue, administration. */
const API: Api = {
  ...manageApi("strata"),
  "GET /api/presence": { body: { members: [{ userId: "u2", name: "Léa Martin", color: "#7c3aed", editingField: null }] } },
  // Projets.
  "GET /api/projects": { body: [] },
  "GET /api/projects?stats=tasks": { body: [] },
  "GET /api/tenant/projects": { body: { projects: [] } },
  "GET /api/tenant/members?inactive=1": { body: [] },
  "GET /api/notifications?limit=15": { body: { items: [], count: 0, total: 0, page: 1, pages: 1 } },
  // Catalogue et modèles.
  "GET /api/tenant/catalogue/lookup": { body: LOOKUP },
  "GET /api/tenant/parametres/categories": {
    body: {
      categories: { arkyo: [], personal: [] },
      functions: { arkyo: [], personal: [] },
      phases: { arkyo: [], personal: [] },
      types: { arkyo: [], personal: [] },
    },
  },
  "GET /api/tenant/parametres/application": { body: { cable_safety_depth_mm: "120" } },
  "GET /api/tenant/parametres/dimensions": { body: [] },
  "GET /api/tenant/parametres/brands": { body: { arkyo: [], personal: [] } },
  "GET /api/tenant/catalogue/equipment": { body: { arkyo: [], personal: [EQUIPMENT] } },
  "GET /api/tenant/catalogue/cables": { body: { arkyo: [], personal: [CABLE] } },
  "GET /api/tenant/catalogue/adapters": { body: { arkyo: [], personal: [ADAPTER] } },
  "GET /api/tenant/catalogue/equipment/e1": { body: { source: "PERSONAL", isAccessible: true, item: EQUIPMENT } },
  "GET /api/tenant/catalogue/cables/k1": { body: { source: "PERSONAL", isAccessible: true, item: CABLE } },
  "GET /api/tenant/catalogue/adapters/a1": { body: { source: "PERSONAL", isAccessible: true, item: ADAPTER } },
  "GET /api/rigs": { body: [] },
  "GET /api/racks": { body: [] },
  "GET /api/racks?unassigned=true": { body: [] },
  "GET /api/panels": { body: [] },
  // Administration.
  "GET /api/tenant/roles": { body: [] },
  "GET /api/system": { body: { version: "0.1.0", dataDir: "/var/lib/arkyo", urls: [] } },
  "GET /api/system/update": {
    body: {
      current: "0.1.0",
      repo: "DamienP2/arkyo-server",
      autoCheck: true,
      previous: null,
      status: { phase: "idle", progress: 0, message: "", latest: null },
    },
  },
  "GET /api/tenant/espace/informations": { body: { id: "site", name: "Régie A", logoUrl: null } },
};

// ── Repères ─────────────────────────────────────────────────────────────────

const zone = (name: string) => document.querySelector(`[data-zone="${name}"]`) as HTMLElement | null;
const main = () => document.querySelector("main#main-content") as HTMLElement;
const header = () => document.querySelector("header") as HTMLElement;

/** Topbar v2 du site montée (interface Strata). */
async function strataTopbar() {
  return within(await waitFor(() => header() ?? Promise.reject(new Error("pas de header")), WAIT)).findByRole(
    "navigation",
    { name: "Navigation principale" },
    WAIT,
  );
}

/** Coquille Concevoir : mode courant du sélecteur. */
async function concevoirMode(label: string) {
  expect(await screen.findByRole("button", { name: `Mode : ${label}` }, WAIT)).toBeInTheDocument();
}

/** Page de Gérer : navigation fine et titre. */
async function gererPage(title: string) {
  const nav = await screen.findByRole("navigation", { name: "Gérer" }, WAIT);
  expect(within(nav).getByRole("link", { name: new RegExp(title) })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByRole("heading", { level: 1, name: title }, WAIT)).toBeInTheDocument();
}

async function comingSoon() {
  expect(await screen.findByText("Bientôt disponible", {}, WAIT)).toBeInTheDocument();
}

/** Menu « Vues » de la topbar projet (Radix : ouvert au clavier dans happy-dom). */
async function viewsMenu(): Promise<HTMLElement> {
  const bar = await waitFor(() => zone("topbar") ?? Promise.reject(new Error("pas de topbar")), WAIT);
  fireEvent.keyDown(await within(bar).findByRole("button", { name: "Vues" }, WAIT), { key: "Enter" });
  return screen.findByRole("menu", {}, WAIT);
}

type Check = { url: string; what: string; landmark: () => Promise<void> };

/** Une ligne de §7 (colonne « Fonction », mot pour mot) et ses vérifications. */
const MAP: Record<string, Check[]> = {
  "Tableau de bord": [
    {
      url: "/dashboard",
      what: "page Projets, filtres Prestation / Intégration",
      landmark: async () => {
        await strataTopbar();
        expect(await within(main()).findByRole("heading", { level: 1, name: "Projets" }, WAIT)).toBeInTheDocument();
        const filters = await screen.findByRole("group", { name: "Type d'intervention" }, WAIT);
        expect(within(filters).getByRole("button", { name: "Prestation" })).toBeInTheDocument();
        expect(within(filters).getByRole("button", { name: "Intégration" })).toBeInTheDocument();
      },
    },
  ],
  "Création de projet": [
    {
      url: "/dashboard",
      what: "Projets › Nouveau projet (assistant existant)",
      landmark: async () => {
        await strataTopbar();
        const [add] = await screen.findAllByRole("button", { name: /Nouveau projet/ }, WAIT);
        fireEvent.click(add);
        expect(await screen.findByRole("button", { name: /Commencer/ }, WAIT)).toBeInTheDocument();
      },
    },
  ],
  "Fiche, caractéristiques": [
    {
      url: "/project/p1?space=gerer&page=fiche",
      what: "Gérer › Fiche et dialogue des caractéristiques",
      landmark: async () => {
        await gererPage("Fiche");
        fireEvent.click(screen.getByRole("button", { name: "Modifier les caractéristiques" }));
        expect(await screen.findByRole("dialog", {}, WAIT)).toBeInTheDocument();
      },
    },
    {
      url: "/project/p1?tab=rack",
      what: "menu Vues › Caractéristiques du projet",
      landmark: async () => {
        const menu = await viewsMenu();
        expect(within(menu).getByRole("menuitem", { name: "Caractéristiques du projet" })).toBeInTheDocument();
      },
    },
  ],
  "Inventaire, nomenclature": [
    {
      url: "/project/p1?space=gerer&page=materiel",
      what: "Gérer › Matériel, onglet Nomenclature, Ajouter du catalogue",
      landmark: async () => {
        await gererPage("Matériel");
        expect(screen.getByRole("tab", { name: /Nomenclature/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Ajouter du catalogue" })).toBeInTheDocument();
      },
    },
    {
      url: "/project/p1?tab=inventaire",
      what: "Inventaire d'arkyo, outil Équipements",
      landmark: async () => {
        const side = await screen.findByRole("complementary", { name: "Panneau latéral" }, WAIT);
        expect(await within(side).findByRole("heading", { name: "Équipements" }, WAIT)).toBeInTheDocument();
      },
    },
  ],
  "Rack (4 faces, placement)": [
    {
      url: "/project/p1?tab=rack",
      what: "Concevoir › Racks, tiroir Bibliothèque / Équipement",
      landmark: async () => {
        await concevoirMode("Racks");
        expect(await screen.findByTestId("rack-canvas", {}, WAIT)).toBeInTheDocument();
        fireEvent.click(await screen.findByRole("button", { name: "Ouvrir l'inspecteur" }, WAIT));
        const drawer = await screen.findByRole("tablist", { name: "Tiroir du rack" }, WAIT);
        expect(within(drawer).getByRole("tab", { name: /Bibliothèque/ })).toBeInTheDocument();
      },
    },
  ],
  "Synoptique, validation 11 contrôles": [
    {
      url: "/project/p1?tab=synoptique",
      what: "Concevoir › Synoptique, bandeau de validation, « Validation synoptique » dans le tiroir",
      landmark: async () => {
        await concevoirMode("Synoptique");
        const drawer = await waitFor(() => zone("drawer") ?? Promise.reject(new Error("pas de tiroir")), WAIT);
        expect(await within(drawer).findByTitle("Validation synoptique", {}, WAIT)).toBeInTheDocument();
        act(() => useTopbarActions.getState().setValidationReport({ issues: [], counts: { error: 0, warning: 0, info: 0 } }));
        const banner = await screen.findByRole("region", { name: "Validation" }, WAIT);
        expect(within(banner).getByRole("button", { name: "Voir les contrôles" })).toBeInTheDocument();
      },
    },
  ],
  "Câblage, numérotation": [
    {
      url: "/project/p1?space=gerer&page=cables",
      what: "Gérer › Câbles, mode tableau",
      landmark: async () => {
        await gererPage("Câbles");
        const view = await screen.findByRole("group", { name: "Affichage" }, WAIT);
        expect(within(view).getByRole("button", { name: /Tableau/ })).toBeInTheDocument();
      },
    },
  ],
  "Plan, Lumière, Schémas": [
    { url: "/project/p1?tab=cartographie", what: "Concevoir › Plan (bouchon phase 5)", landmark: async () => (await concevoirMode("Plan"), comingSoon()) },
    { url: "/project/p1?tab=lumiere", what: "Concevoir › Lumière (bouchon phase 5)", landmark: async () => (await concevoirMode("Lumière"), comingSoon()) },
    { url: "/project/p1?tab=schema", what: "Concevoir › Schémas (bouchon phase 5)", landmark: async () => (await concevoirMode("Schémas"), comingSoon()) },
  ],
  "Vidéo, Audio": [
    {
      url: "/project/p1?tab=video",
      what: "menu Vues › Vidéo et Audio (bouchons phase 5)",
      landmark: async () => {
        await comingSoon();
        const menu = await viewsMenu();
        expect(within(menu).getByRole("menuitem", { name: "Vidéo" })).toHaveAttribute("aria-current", "page");
        expect(within(menu).getByRole("menuitem", { name: "Audio" })).toBeInTheDocument();
      },
    },
    { url: "/project/p1?tab=audio", what: "Audio (bouchon phase 5)", landmark: comingSoon },
  ],
  Réseau: [
    {
      url: "/project/p1?space=gerer&page=reseau",
      what: "Gérer › Réseau (bouchon phase 5)",
      landmark: async () => (await gererPage("Réseau"), comingSoon()),
    },
  ],
  "Préparation, Recette, Dossier": [
    {
      url: "/project/p1?space=gerer&page=livraison",
      what: "Gérer › Livraison (bouchon phase 6)",
      landmark: async () => (await gererPage("Livraison"), comingSoon()),
    },
    {
      url: "/project/p1?space=gerer&page=dossier",
      what: "Gérer › Dossier (bouchon phase 6), menu Vues › Exporter un dossier",
      landmark: async () => {
        await gererPage("Dossier");
        await comingSoon();
        const menu = await viewsMenu();
        expect(within(menu).getByRole("menuitem", { name: "Exporter un dossier" })).toBeInTheDocument();
      },
    },
  ],
  "Exports par vue": [
    {
      url: "/project/p1?tab=synoptique",
      what: "tiroir du synoptique : Exporter",
      landmark: async () => {
        const drawer = await waitFor(() => zone("drawer") ?? Promise.reject(new Error("pas de tiroir")), WAIT);
        expect(await within(drawer).findByTitle("Exporter", {}, WAIT)).toBeInTheDocument();
      },
    },
  ],
  "Modèles (contenants, régies, panels, éditeur de panel)": [
    {
      url: "/admin/catalogue?tab=modeles",
      what: "Catalogue › Modèles",
      landmark: async () => {
        const models = await screen.findByRole("list", { name: "Modèles" }, WAIT);
        expect(within(models).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
          "/templates?tab=racks",
          "/templates?tab=panels",
          "/templates?tab=dossiers",
        ]);
      },
    },
    {
      url: "/templates?tab=racks",
      what: "Contenants (et régies), navigation des modèles",
      landmark: async () => {
        await strataTopbar();
        const nav = await within(header()).findByRole("navigation", { name: "Modèles" }, WAIT);
        expect(within(nav).getByRole("link", { name: "Contenants" })).toHaveAttribute("aria-current", "page");
      },
    },
    {
      url: "/templates?tab=panels",
      what: "Panels (éditeur de panel)",
      landmark: async () => {
        await strataTopbar();
        const nav = await within(header()).findByRole("navigation", { name: "Modèles" }, WAIT);
        expect(within(nav).getByRole("link", { name: "Panels" })).toHaveAttribute("aria-current", "page");
      },
    },
    { url: "/templates?tab=dossiers", what: "Dossiers (bouchon phase 6)", landmark: comingSoon },
  ],
  "Catalogue (équipements, cordons, adaptateurs)": [
    {
      url: "/admin/catalogue?tab=equipment",
      what: "équipements : liste + détail, sélection multiple",
      landmark: async () => {
        const list = await screen.findByRole("list", { name: "Équipements" }, WAIT);
        expect(within(list).getAllByText("HDC-5500").length).toBeGreaterThan(0);
        expect(within(screen.getByRole("region", { name: "Fiche" })).getByRole("heading", { level: 2, name: "HDC-5500" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("checkbox", { name: "Sélectionner HDC-5500" }));
        const bar = screen.getByRole("toolbar", { name: "Sélection" });
        expect(within(bar).getByRole("button", { name: "Supprimer la sélection" })).toBeInTheDocument();
      },
    },
    {
      url: "/admin/catalogue?tab=cables&id=k1",
      what: "cordons : liste + détail",
      landmark: async () => {
        await screen.findByRole("list", { name: "Cordons" }, WAIT);
        const fiche = screen.getByRole("region", { name: "Fiche" });
        expect(within(fiche).getByRole("heading", { level: 2, name: "BNC M ↔ BNC M 12G" })).toBeInTheDocument();
      },
    },
    {
      url: "/admin/catalogue?tab=adapters&id=a1",
      what: "adaptateurs : liste + détail",
      landmark: async () => {
        await screen.findByRole("list", { name: "Adaptateurs" }, WAIT);
        const fiche = screen.getByRole("region", { name: "Fiche" });
        expect(within(fiche).getByRole("heading", { level: 2, name: "BNC → HDMI" })).toBeInTheDocument();
      },
    },
  ],
  "Éditeurs du catalogue": [
    {
      url: "/admin/catalogue/equipment/e1",
      what: "équipement : éditeur pleine page",
      landmark: async () => {
        expect(await screen.findByRole("toolbar", { name: "Barre d'actions" }, WAIT)).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Faces" })).toBeInTheDocument();
        expect(screen.getByRole("complementary", { name: "Aperçu" })).toBeInTheDocument();
      },
    },
    {
      url: "/admin/catalogue/cables/k1",
      what: "cordon : page d'arkyo dans la coquille Strata (Ruling 11)",
      landmark: async () => {
        await strataTopbar();
        expect(await within(main()).findByDisplayValue("BNC M ↔ BNC M 12G", {}, WAIT)).toBeInTheDocument();
      },
    },
    {
      url: "/admin/catalogue/adapters/a1",
      what: "adaptateur : page d'arkyo dans la coquille Strata (Ruling 11)",
      landmark: async () => {
        await strataTopbar();
        expect(await within(main()).findByDisplayValue("BNC → HDMI", {}, WAIT)).toBeInTheDocument();
      },
    },
  ],
  "Paramètres, Utilisateurs, Espace, Système (dont Sauvegardes, Interface)": [
    {
      url: "/admin/parametres",
      what: "Paramètres",
      landmark: async () => {
        await strataTopbar();
        expect(await screen.findByRole("button", { name: "Types" }, WAIT)).toBeInTheDocument();
      },
    },
    {
      url: "/admin/users",
      what: "Utilisateurs",
      landmark: async () => {
        await strataTopbar();
        for (const tab of ["Liste", "Rôle", "Permissions"])
          expect(await within(header()).findByRole("button", { name: tab }, WAIT)).toBeInTheDocument();
      },
    },
    {
      url: "/admin/espace",
      what: "Espace",
      landmark: async () => {
        await strataTopbar();
        expect(await within(header()).findByRole("button", { name: "Informations" }, WAIT)).toBeInTheDocument();
      },
    },
    {
      url: "/admin/systeme",
      what: "Système : mises à jour, interface, sauvegardes",
      landmark: async () => {
        await strataTopbar();
        expect(await within(main()).findByText("Mises à jour", {}, WAIT)).toBeInTheDocument();
        expect(await within(main()).findByRole("radio", { name: /Classique \(arkyo\)/ }, WAIT)).toBeInTheDocument();
        expect(await within(main()).findByText("Sauvegarde du site", {}, WAIT)).toBeInTheDocument();
      },
    },
  ],
  "Profil, notifications, langue, thème, présence": [
    {
      url: "/dashboard",
      what: "topbar",
      landmark: async () => {
        await strataTopbar();
        for (const name of ["Notifications", "Langue", "Thème", "Profil"])
          expect(within(header()).getByRole("button", { name })).toBeInTheDocument();
        expect(await within(header()).findByTitle("Léa Martin", {}, WAIT)).toBeInTheDocument();
      },
    },
  ],
  "Recherche et actions": [
    {
      url: "/dashboard",
      what: "palette ⌘K du site",
      landmark: async () => {
        await strataTopbar();
        fireEvent.click(within(header()).getByRole("button", { name: "Rechercher ou agir (⌘K)" }));
        expect(await screen.findByRole("dialog", { name: "Palette de commandes" }, WAIT)).toBeInTheDocument();
      },
    },
    {
      url: "/project/p1?space=gerer",
      what: "palette ⌘K du projet ouvert",
      landmark: async () => {
        const bar = await waitFor(() => zone("topbar") ?? Promise.reject(new Error("pas de topbar")), WAIT);
        fireEvent.click(await within(bar).findByRole("button", { name: "Rechercher ou agir (⌘K)" }, WAIT));
        expect(await screen.findByRole("group", { name: "Projet" }, WAIT)).toHaveTextContent("Valider");
      },
    },
  ],
};

/** Colonne « Fonction » de la table du §7 de la spec v2. */
function specRows(): string[] {
  const spec = readFileSync(
    resolve(__dirname, "../../../../docs/superpowers/specs/2026-11-09-interface-strata-v2-design.md"),
    "utf8",
  );
  const section = spec.slice(spec.indexOf("## 7."), spec.indexOf("## 8."));
  return section
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.startsWith("| Fonction") && !l.startsWith("| ---"))
    .map((l) => l.split("|")[1].trim());
}

const CASES = Object.entries(MAP).flatMap(([fonction, checks]) =>
  checks.map((c) => ({ fonction, ...c })),
);

beforeAll(async () => {
  await Promise.all([
    import("@/strata/pages/projects-page"),
    import("@/strata/pages/catalogue-page"),
    import("@/app/(app)/templates/page"),
    import("@/app/(app)/admin/espace/page"),
    import("@/app/(app)/admin/catalogue/equipment/[id]/page"),
  ]);
}, 60000);
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  resetApp();
  window.localStorage.clear();
  useTopbarActions.getState().setValidationReport(null);
  useValidationRecordStore.setState({ byProject: {} });
  delete document.documentElement.dataset.interface;
});

describe("spec v2 §7 : où vit chaque fonction", () => {
  test("chaque ligne de la table a sa vérification, et réciproquement", () => {
    const rows = specRows();
    expect(rows.length).toBeGreaterThan(10);
    expect(Object.keys(MAP)).toEqual(rows);
  });

  test.each(CASES)("$fonction — $url ($what)", async ({ url, landmark }) => {
    renderApp(url, API);
    await landmark();
  }, 30000);
});
