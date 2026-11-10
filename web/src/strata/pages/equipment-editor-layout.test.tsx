/**
 * Éditeur d'équipement pleine page (interface Strata v2, spec v2 §4.3,
 * maquette `#catalogue-editer-<ref>` / `#catalogue-nouveau`) : bandeau des
 * faces, colonne principale (formulaire d'arkyo, ses onglets), colonne
 * d'aperçu (schéma de principe, ports par famille, totaux, « Utilisé dans »)
 * et barre d'actions branchée sur l'autosave et l'historique d'arkyo. En
 * Classique, l'éditeur d'arkyo est rendu à l'identique (DOM exact).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initialForm, type FormData } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { TenantPermissionsProvider } from "@/components/tenant-permissions-context";
import type { TenantPermissions } from "@/lib/tenant-permissions";
import {
  mockApi,
  OWNER_PERMS,
  renderApp,
  resetApp,
  sentBody,
  signedInApi,
  TECH_PERMS,
  type Api,
} from "@/tests/app-harness";
import { EquipmentEditorLayout } from "./equipment-editor-layout";

// ── Données ─────────────────────────────────────────────────────────────────

const ITEM = {
  source: "PERSONAL",
  isAccessible: true,
  id: "e1",
  name: "HDC-5500",
  reference: "HDC5500",
  category: null,
  categoryId: null,
  brandId: null,
  isRackable: true,
  heightU: 1,
  depthMm: null,
  rearCableDepthMm: null,
  widthFraction: "FULL",
  dimLmm: null,
  dimWmm: null,
  dimHmm: null,
  weight: 7.5,
  powerW: 180,
  heatBtuH: null,
  hasDualPsu: false,
  is2110: false,
  ip2110Mode: null,
  connectors: [
    {
      id: "p1",
      face: "REAR",
      connectorTypeId: "c1",
      signalName: "12G-SDI",
      quantity: 2,
      label: "SDI OUT",
      direction: "OUT",
      gender: "FEMALE",
    },
  ],
  signalCapacities: [],
  imageUrl: null,
  notes: null,
  tags: null,
  isActive: true,
  typeId: null,
  functionIds: [],
  phaseIds: [],
  sourceType: "TENANT",
  functions: [],
  phases: [],
};

const DETAIL = { source: "PERSONAL", isAccessible: true, item: ITEM };

/** Régies (`GET /api/rigs`) : celle du projet p1 (deux exemplaires) et un modèle (un exemplaire). */
const RIGS = [
  {
    id: "g1",
    name: "Régie principale",
    projectId: "p1",
    isTemplate: false,
    rigRacks: [
      {
        id: "rr1",
        rigConfigId: "g1",
        rackId: "r1",
        position: 0,
        rack: {
          id: "r1",
          name: "Baie 1",
          slots: [
            { id: "s1", rackId: "r1", catalogEquipmentId: "e1", startU: 1 },
            { id: "s2", rackId: "r1", catalogEquipmentId: "e1", startU: null },
            { id: "s3", rackId: "r1", catalogEquipmentId: "x9", startU: 3 },
          ],
        },
      },
    ],
  },
  {
    id: "g2",
    name: "Car HD-7",
    projectId: null,
    isTemplate: true,
    rigRacks: [
      {
        id: "rr2",
        rigConfigId: "g2",
        rackId: "r2",
        position: 0,
        rack: { id: "r2", name: "Baie A", slots: [{ id: "s4", rackId: "r2", catalogEquipmentId: "e1", startU: 4 }] },
      },
    ],
  },
];

const PROJECTS = { projects: [{ id: "p1", name: "Ligue 1" }] };

function editorApi(iface: "strata" | "classique", extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A", iface),
    "GET /api/tenant/catalogue/lookup": {
      body: {
        categories: [],
        brands: [],
        connectorTypes: [{ id: "c1", name: "BNC", iconId: "bnc", versions: [], color: "#3b82f6", isActive: true }],
        signals: [{ id: "s1", name: "12G-SDI", color: "#3654ff", functionId: "f1", connectorIds: [], isActive: true }],
        functions: [{ id: "f1", key: "VIDEO", label: "Vidéo", color: "#3b82f6", sortOrder: 1, isActive: true }],
        phases: [],
        types: [],
        cableModels: [],
      },
    },
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
    "GET /api/tenant/catalogue/equipment/e1": { body: DETAIL },
    "PATCH /api/tenant/catalogue/equipment/e1": (init) => ({
      body: { ...ITEM, ...JSON.parse(String(init?.body)) },
    }),
    "GET /api/rigs": { body: RIGS },
    "GET /api/tenant/projects": { body: PROJECTS },
    ...extra,
  };
}

async function openEditor(url = "/admin/catalogue/equipment/e1", api: Api = editorApi("strata")) {
  const app = renderApp(url, api);
  await screen.findByPlaceholderText("BRC-X400", {}, { timeout: 15000 });
  return app;
}

const bar = () => screen.getByRole("toolbar", { name: "Barre d'actions" });
const aside = () => screen.getByRole("complementary", { name: "Aperçu" });
const strip = () => screen.getByRole("region", { name: "Faces" });
const formColumn = () => screen.getByRole("region", { name: "Formulaire" });

// ── Dans l'application ──────────────────────────────────────────────────────

describe("éditeur d'équipement pleine page", () => {
  beforeAll(async () => {
    await import("@/app/(app)/admin/catalogue/equipment/[id]/page");
    await import("@/app/(app)/admin/catalogue/equipment/new/page");
  }, 60000);
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    resetApp();
    delete document.documentElement.dataset.interface;
  });

  test("faces et aperçu suivent form.connectorEntries", async () => {
    await openEditor();

    // Bandeau des faces au-dessus, formulaire d'arkyo au centre, aperçu à droite.
    const rear = () => within(strip()).getByRole("img", { name: "Face arrière HDC-5500" });
    expect(rear().querySelectorAll("[data-port]")).toHaveLength(2);
    expect(within(strip()).getByRole("img", { name: "Face avant HDC-5500" })).toBeInTheDocument();
    expect(within(formColumn()).getByRole("button", { name: /Généralités/ })).toBeInTheDocument();
    expect(within(formColumn()).getByRole("button", { name: /Connectique/ })).toBeInTheDocument();

    const schema = () => within(aside()).getByRole("img", { name: "Schéma de principe HDC-5500" });
    const families = () =>
      within(within(aside()).getByRole("list", { name: "Ports par famille" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent);
    expect(schema().querySelectorAll("[data-entry]")).toHaveLength(1);
    expect(families()).toEqual(["Vidéo2"]);
    const totals = within(aside()).getByRole("group", { name: "Totaux" });
    expect(totals).toHaveTextContent("Ports2");
    expect(totals).toHaveTextContent("Hauteur1 U");
    expect(totals).toHaveTextContent("Puissance180 W");
    expect(totals).toHaveTextContent("Poids7,5 kg");

    // La connectique change dans le formulaire : faces, schéma et familles suivent.
    fireEvent.click(within(formColumn()).getByRole("button", { name: /Connectique/ }));
    await waitFor(() => expect(within(formColumn()).getAllByText("SDI OUT").length).toBeGreaterThan(0));
    fireEvent.click(within(formColumn()).getByTitle("Dupliquer"));
    await waitFor(() => expect(rear().querySelectorAll("[data-port]")).toHaveLength(4));
    expect(schema().querySelectorAll("[data-entry]")).toHaveLength(2);
    expect(families()).toEqual(["Vidéo4"]);
    expect(within(aside()).getByRole("group", { name: "Totaux" })).toHaveTextContent("Ports4");

    // Le formulaire n'est pas découpé : aucune section « Avancé » ici.
    expect(screen.queryByRole("button", { name: /Avancé/ })).toBeNull();
  });

  test("aperçu : « Utilisé dans », par projet et par modèle de régie", async () => {
    await openEditor();
    const used = await within(aside()).findByRole("list", { name: "Utilisé dans" });
    expect(
      within(used)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Ligue 12", "Car HD-7Modèle de régie1"]);
    expect(within(aside()).getByText("3 exemplaires")).toBeInTheDocument();
  });

  test("barre : état d'enregistrement de useEditorAutosave, Annuler/Rétablir, ⌘S → forceSave", async () => {
    const { fetchSpy } = await openEditor();
    const b = within(bar());
    expect(b.getByRole("link", { name: "Catalogue" })).toHaveAttribute("href", "/admin/catalogue?tab=equipment&id=e1");
    expect(b.getByRole("heading", { name: "HDC-5500" })).toBeInTheDocument();
    expect(b.getByRole("button", { name: "Annuler" })).toBeDisabled();
    expect(b.getByRole("button", { name: "Rétablir" })).toBeDisabled();
    // L'en-tête d'arkyo est remplacé par la barre (pas de « Fermer » en double).
    expect(screen.queryByRole("button", { name: "Fermer" })).toBeNull();

    // Saisie dans le champ (focus) : modification en attente, pas de PATCH.
    const name = screen.getByPlaceholderText("BRC-X400") as HTMLInputElement;
    act(() => name.focus());
    fireEvent.change(name, { target: { value: "HDC-5500 B" } });
    await waitFor(() => expect(b.getByRole("status")).toHaveTextContent("Modifications non enregistrées"));
    const patches = () => fetchSpy.mock.calls.filter(([, init]) => init?.method === "PATCH").length;
    expect(patches()).toBe(0);

    // ⌘S → forceSave : PATCH immédiat, puis « Enregistré ».
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(patches()).toBe(1));
    expect(sentBody(fetchSpy, "PATCH", "/api/tenant/catalogue/equipment/e1")).toMatchObject({ name: "HDC-5500 B" });
    await waitFor(() => expect(b.getByRole("status")).toHaveTextContent("Enregistré"));

    // Annuler / Rétablir : l'historique d'arkyo.
    act(() => name.blur());
    await waitFor(() => expect(b.getByRole("button", { name: "Annuler" })).toBeEnabled());
    fireEvent.click(b.getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(name.value).toBe("HDC-5500"));
    expect(b.getByRole("button", { name: "Rétablir" })).toBeEnabled();
    fireEvent.click(b.getByRole("button", { name: "Rétablir" }));
    await waitFor(() => expect(name.value).toBe("HDC-5500 B"));
  });

  test("barre : Dupliquer ouvre l'éditeur de la copie", async () => {
    const posted: string[] = [];
    const { router } = await openEditor(
      "/admin/catalogue/equipment/e1",
      editorApi("strata", {
        "POST /api/tenant/catalogue/equipment/e1/duplicate": () => {
          posted.push("e1");
          return { status: 201, body: { id: "e2" } };
        },
        "GET /api/tenant/catalogue/equipment/e2": { body: { ...DETAIL, item: { ...ITEM, id: "e2" } } },
      }),
    );
    fireEvent.click(within(bar()).getByRole("button", { name: "Dupliquer" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/catalogue/equipment/e2"));
    expect(posted).toEqual(["e1"]);
    expect(await screen.findByText("Équipement dupliqué.")).toBeInTheDocument();
  });

  test("barre : Supprimer confirme, refuse un équipement utilisé (409) puis revient au catalogue", async () => {
    let inUse = true;
    const { router } = await openEditor(
      "/admin/catalogue/equipment/e1",
      editorApi("strata", {
        "DELETE /api/tenant/catalogue/equipment/e1": () =>
          inUse
            ? { status: 409, body: { error: "Utilisé dans 3 projet(s) — suppression impossible", usageCount: 3 } }
            : { body: { success: true } },
      }),
    );

    fireEvent.click(within(bar()).getByRole("button", { name: "Supprimer" }));
    let confirm = await screen.findByRole("dialog", { name: "Supprimer l'équipement" });
    expect(confirm).toHaveTextContent("HDC-5500 sera supprimé définitivement.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Supprimer" }));
    expect(await screen.findByText("Utilisé dans 3 projet(s) — suppression impossible")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/admin/catalogue/equipment/e1");

    inUse = false;
    fireEvent.click(within(bar()).getByRole("button", { name: "Supprimer" }));
    confirm = await screen.findByRole("dialog", { name: "Supprimer l'équipement" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/catalogue"));
    expect(router.state.location.search).toBe("?tab=equipment");
  });

  test("création : même mise en page, sans Dupliquer ni Supprimer", async () => {
    await openEditor("/admin/catalogue/equipment/new", editorApi("strata"));
    const b = within(bar());
    expect(b.getByRole("heading", { name: "Nouvel équipement" })).toBeInTheDocument();
    expect(b.getByRole("link", { name: "Catalogue" })).toHaveAttribute("href", "/admin/catalogue?tab=equipment");
    expect(b.queryByRole("button", { name: "Dupliquer" })).toBeNull();
    expect(b.queryByRole("button", { name: "Supprimer" })).toBeNull();
    expect(b.queryByRole("button", { name: "Rétablir" })).toBeNull();
    expect(b.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(strip()).toBeInTheDocument();
    expect(within(aside()).queryByRole("list", { name: "Utilisé dans" })).toBeNull();
  });

  test("classique : éditeur inchangé (DOM exact)", async () => {
    await openEditor("/admin/catalogue/equipment/e1", editorApi("classique"));
    const main = document.getElementById("main-content")!;
    await settle();
    expect(html(main)).toMatchSnapshot("fiche, Généralités");
    fireEvent.click(screen.getByRole("button", { name: /Connectique/ }));
    await waitFor(() => expect(screen.getAllByText("SDI OUT").length).toBeGreaterThan(0));
    await settle();
    expect(html(main)).toMatchSnapshot("fiche, Connectique");
    expect(screen.queryByRole("toolbar", { name: "Barre d'actions" })).toBeNull();
    resetApp();

    await openEditor("/admin/catalogue/equipment/new", editorApi("classique"));
    await settle();
    expect(html(document.getElementById("main-content")!)).toMatchSnapshot("création");
  });
});

/**
 * DOM de la page ; les identifiants de dnd-kit viennent d'un compteur global
 * (ordre des tests), ils sont neutralisés.
 */
function html(el: HTMLElement): string {
  return el.innerHTML.replace(/(DndDescribedBy|DndLiveRegion)-\d+/g, "$1-N");
}

/** Laisse passer les chargements asynchrones (icônes de connecteurs). */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

// ── Lecture seule (Review Focus 5) ──────────────────────────────────────────

function baseForm(): FormData {
  return { ...initialForm(null), name: "HDC-5500", connectorEntries: [ITEM.connectors[0] as FormData["connectorEntries"][number]] };
}

describe("EquipmentEditorLayout", () => {
  afterEach(resetApp);

  test("lecture seule : barre sans édition", async () => {
    mockApi({ ...editorApi("strata"), "GET /api/tenant/me/permissions": { body: TECH_PERMS } });
    const noop = () => {};
    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: (
            <ThemeProvider>
              <TenantPermissionsProvider initialPermissions={TECH_PERMS as TenantPermissions}>
                <EquipmentEditorLayout
                  enabled
                  equipmentId="e1"
                  form={baseForm()}
                  lookup={{ connectorTypes: [], signals: [], functions: [], brands: [] }}
                  autosave={{ status: "idle", lastSavedAt: null, forceSave: async () => {} }}
                  history={{ canUndo: true, canRedo: true, undo: noop, redo: noop }}
                  create={{ onSave: noop, saving: false }}
                  readOnly={false}
                >
                  <div>formulaire</div>
                </EquipmentEditorLayout>
              </TenantPermissionsProvider>
            </ThemeProvider>
          ),
        },
      ],
      { initialEntries: ["/admin/catalogue/equipment/e1"] },
    );
    render(<RouterProvider router={router} />);

    const b = within(await screen.findByRole("toolbar", { name: "Barre d'actions" }));
    expect(b.getByRole("link", { name: "Catalogue" })).toBeInTheDocument();
    expect(b.getByText("Lecture seule")).toBeInTheDocument();
    for (const name of ["Annuler", "Rétablir", "Dupliquer", "Supprimer", "Enregistrer"]) {
      expect(b.queryByRole("button", { name })).toBeNull();
    }
    // Comme le mode consultation d'arkyo : le formulaire ne reçoit plus la saisie.
    expect(formColumn().querySelector("[inert]")).not.toBeNull();
    // Le dessin reste consultable.
    expect(within(strip()).getByRole("img", { name: "Face arrière HDC-5500" })).toBeInTheDocument();
  });
});
