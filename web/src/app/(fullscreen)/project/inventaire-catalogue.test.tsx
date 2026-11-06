/**
 * Onglet Inventaire de l'éditeur projet, 2/3 (arkyo:app/(fullscreen)/project/
 * [id]/inventaire/_components/catalog-panel.tsx, `add-container-wizard.tsx`,
 * `template-selector.tsx`, `component-config-modal.tsx`) : catalogue du
 * panneau latéral et glisser-déposer vers un contenant, assistant « Ajouter un
 * contenant » (modèle cloné ou contenant neuf) et configuration des composants
 * d'un châssis modulaire.
 *
 * Les copies d'arkyo sont rendues par le chargeur réel (`/project/:id`). La
 * carte de contenant (`ContainerSheetCard`, Task 12) porte `data-rack-id`,
 * cible du dépôt, et la liste des lignes.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  mockApi,
  OWNER_PERMS,
  renderApp,
  resetApp,
  sentBody,
  signedInApi,
  type Api,
} from "@/tests/app-harness";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ComponentConfigModal } from "./[id]/inventaire/_components/component-config-modal";

/**
 * Attente du premier montage : l'éditeur projet et l'inventaire (≈ 8 000 l.)
 * sont transformés à la demande par Vite ; sous charge CPU (cargo en
 * parallèle, runner de CI), cela dépasse 5 s.
 */
const FIRST_LOAD = { timeout: 15000 };

const HEADER = {
  id: "p1",
  name: "Finale Coupe de France",
  status: "EN_PREPARATION",
  interventionType: "PRESTATION",
  rigType: "CAR",
  clientName: "France TV",
  shootingDate: "2026-11-20T00:00:00.000Z",
  location: "Stade de France",
  prestationType: null,
};

/** Contenant de la route `editor` (`InventaireRack`). */
function rack(id: string, name: string, locationId: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    rigConfigId: "rc1",
    name,
    rackType: "STANDARD",
    totalU: 42,
    depthMm: 600,
    widthMm: null,
    heightMm: null,
    hasWheels: false,
    emptyWeightKg: null,
    slotsCount: 0,
    constructionChecks: 0,
    isRackable: true,
    hasConnectors: false,
    canvasX: null,
    canvasY: null,
    locationId,
    isVirtual: false,
    slots: [],
    bom: [],
    ...extra,
  };
}

/** Un lieu, la Régie, avec une baie vide. */
const EDITOR = {
  header: HEADER,
  fiche: {
    ...HEADER,
    shootingEndDate: null,
    planningStart: null,
    planningEnd: null,
    commissioningDate: null,
    description: null,
    documents: [],
    counts: { tasks: 0, messages: 0, documents: 0 },
  },
  inventaire: {
    rigConfigId: "rc1",
    racks: [rack("r1", "Baie 1", "l1"), rack("v1", "Régie", "l1", { isVirtual: true, isRackable: false, totalU: 0 })],
    locations: [{ id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: "v1" }],
  },
  cartographie: { maps: [] },
};

function equipment(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    reference: null,
    brandName: null,
    categoryName: null,
    categoryColor: null,
    imageUrl: null,
    heightU: null,
    widthFraction: "FULL",
    isRackable: false,
    powerW: null,
    depthMm: null,
    weightKg: null,
    isComponentHost: false,
    isComponent: false,
    is2110: false,
    isLightingFixture: false,
    ...extra,
  };
}

/** Catalogue de l'inventaire (`GET …/inventaire/catalog`, `CatalogResponse`). */
const CATALOG = {
  equipments: [
    equipment("eq1", "Grille vidéo", {
      reference: "SW-12",
      brandName: "Blackmagic",
      categoryName: "Vidéo",
      categoryColor: "#3b82f6",
      heightU: 1,
      isRackable: true,
      powerW: 30,
      depthMm: 300,
      weightKg: 2,
    }),
    equipment("eq2", "Interphonie", { brandName: "Riedel", categoryName: "Audio", categoryColor: "#22c55e" }),
    equipment("eq3", "Talkie", { depthMm: 120 }),
  ],
  panels: [{ id: "pa1", name: "Patch 24 BNC", reference: null, type: "PATCH", heightU: 1 }],
  adapters: [],
};

function editorApi(extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A"),
    "GET /api/tenant/projects/p1/editor": { body: EDITOR },
    "GET /api/tenant/projects/p1/inventaire/catalog": { body: CATALOG },
    ...extra,
  };
}

/** Ouvre l'onglet Inventaire et attend la fiche du lieu courant. */
async function open(extra: Api = {}) {
  const app = renderApp("/project/p1?tab=inventaire", editorApi(extra));
  await screen.findByText("Finale Coupe de France", {}, FIRST_LOAD);
  await screen.findByText("Équipements libres");
  return app;
}

/** Carte d'un contenant (`ContainerSheetCard`, cible de dépôt). */
function card(rackId: string): HTMLElement {
  return document.querySelector(`[data-rack-id="${rackId}"]`) as HTMLElement;
}

/** Laisse passer l'auto-avance (200 ms) d'une étape de l'assistant. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 250)));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("éditeur projet : inventaire 2/3", () => {
  test("catalog_panel_adds_equipment", async () => {
    const added = {
      id: "i1",
      kind: "equipment",
      refId: "eq1",
      quantity: 1,
      name: "Grille vidéo",
      reference: "SW-12",
      brandName: "Blackmagic",
      heightU: 1,
      isRackable: true,
    };
    const { fetchSpy } = await open({
      "POST /api/tenant/projects/p1/racks/r1/inventory": { status: 201, body: { item: added } },
      "GET /api/tenant/projects/p1/racks/r1/inventory": { body: { items: [added] } },
    });

    // Panneau latéral de l'outil Équipements : la liste du catalogue, groupée
    // par catégorie (« Sans catégorie » en dernier), avec ses métriques.
    const side = (await screen.findByText("Grille vidéo")).closest(".overflow-auto") as HTMLElement;
    expect(within(side).getAllByText(/^(Audio|Vidéo|Sans catégorie)$/).map((el) => el.textContent)).toEqual([
      "Audio",
      "Vidéo",
      "Sans catégorie",
    ]);
    const row = within(side).getByText("Grille vidéo").closest("div.select-none") as HTMLElement;
    expect(within(row).getByText("Blackmagic")).toBeInTheDocument();
    expect(row).toHaveTextContent('1U19"2kg30W');
    expect(within(side).getByText("Talkie").closest("div.select-none")).toHaveTextContent("12cm");

    // « Ajouter un nouvel équipement » : pointillés, explication puis nouvel onglet.
    const add = within(side).getByRole("button", { name: "Ajouter un nouvel équipement" });
    expect(add).toHaveClass("border-dashed");
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(add);
    const redirect = await screen.findByRole("dialog");
    expect(within(redirect).getByText("Créer un nouveau équipement")).toBeInTheDocument();
    fireEvent.click(within(redirect).getByRole("button", { name: /Ouvrir dans un nouvel onglet/ }));
    expect(openSpy).toHaveBeenCalledWith("/admin/catalogue/equipment/new", "_blank", "noopener,noreferrer");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Glisser la grille sur la baie : le scope repère la carte sous le curseur
    // (`document.elementsFromPoint`), puis demande la quantité.
    const target = card("r1");
    const elementsFromPoint = vi.fn(() => [target]);
    Object.defineProperty(document, "elementsFromPoint", { value: elementsFromPoint, configurable: true });
    try {
      const grip = row.querySelector("div.cursor-grab") as HTMLElement;
      fireEvent.pointerDown(grip, { clientX: 10, clientY: 10, isPrimary: true, button: 0, pointerId: 1 });
      await act(async () => {
        fireEvent.pointerMove(document, { clientX: 300, clientY: 40, isPrimary: true, pointerId: 1 });
      });
      await act(async () => {
        fireEvent.pointerMove(document, { clientX: 320, clientY: 50, isPrimary: true, pointerId: 1 });
      });
      await act(async () => {
        fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1 });
      });
      // dnd-kit bloque les clics 50 ms après un glisser (clic parasite du relâcher).
      await act(() => new Promise((r) => setTimeout(r, 60)));
    } finally {
      delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
    expect(elementsFromPoint).toHaveBeenCalledWith(320, 50);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Ajouter à l'inventaire")).toBeInTheDocument();
    expect(within(dialog).getByText("Baie 1")).toBeInTheDocument();
    // arkyo-server: quantité plafonnée à 999, comme le serveur.
    const qty = within(dialog).getByRole("spinbutton");
    expect(qty).toHaveAttribute("max", "999");
    fireEvent.change(qty, { target: { value: "5000" } });
    expect(qty).toHaveValue(999);
    expect(within(dialog).getByRole("button", { name: "Augmenter" })).toBeDisabled();
    fireEvent.change(qty, { target: { value: "1" } });
    expect(qty).toHaveValue(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Ajouter" }));
    await waitFor(() =>
      expect(sentBody(fetchSpy, "POST", "/api/tenant/projects/p1/racks/r1/inventory")).toEqual({
        equipmentId: "eq1",
        quantity: 1,
      }),
    );
    // Le BOM du contenant est relu : la ligne apparaît sur la carte.
    await waitFor(() => expect(within(card("r1")).getByText("Grille vidéo")).toBeInTheDocument());
    expect(
      fetchSpy.mock.calls.some(
        ([u, init]) => String(u) === "/api/tenant/projects/p1/racks/r1/inventory" && (init?.method ?? "GET") === "GET",
      ),
    ).toBe(true);
  });

  test("add_container_wizard_creates_rack", async () => {
    const TEMPLATES = [
      { id: "t1", name: "Flight son 6U", rackType: "FLIGHT_CASE_CLASSIC", totalU: 6, depthMm: 500, hasWheels: true, slotsCount: 3 },
      { id: "t2", name: "Pelicase HF", rackType: "PELICAN", totalU: 1, depthMm: 400, hasWheels: false, slotsCount: 2 },
    ];
    const cloned = {
      id: "r9",
      rigConfigId: "rc1",
      name: "Flight son 6U",
      rackType: "FLIGHT_CASE_CLASSIC",
      totalU: 6,
      depthMm: 500,
      widthMm: null,
      heightMm: null,
      hasWheels: true,
      emptyWeightKg: null,
      isRackable: true,
      canvasX: null,
      canvasY: null,
      slotsCount: 0,
      constructionChecks: 0,
      hasConnectors: false,
      slots: [],
      bom: [],
    };
    const { fetchSpy } = await open({
      "GET /api/tenant/racks?templates=true": { body: TEMPLATES },
      "POST /api/tenant/projects/p1/racks/clone-from-template": { status: 201, body: { rack: cloned } },
    });

    fireEvent.click(screen.getByRole("button", { name: "Contenant dans Régie" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Ajouter un contenant")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Commencer/ }));

    // Mode : les modèles sont comptés à l'ouverture.
    const pick = await within(dialog).findByRole("button", { name: /Choisir un template/ });
    await waitFor(() => expect(pick).toHaveTextContent("Partez d'un modèle"));
    fireEvent.click(pick);
    await settle();

    // Emplacement : la Régie de la fiche est présélectionnée.
    expect(within(dialog).getByText("Dans quel emplacement ?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Régie/ }));
    await settle();

    // Modèle : grille filtrable, le clic clone directement.
    expect(within(dialog).getByText("Choisissez un template")).toBeInTheDocument();
    const flight = await within(dialog).findByRole("button", { name: /Flight son 6U/ });
    expect(flight).toHaveTextContent("Flight case6U·500 mm·3 eq.");
    // Pelicase : non rackable, pas de hauteur en U.
    expect(within(dialog).getByRole("button", { name: /Pelicase HF/ })).toHaveTextContent("Pelicase400 mm·2 eq.");
    fireEvent.change(within(dialog).getByPlaceholderText("Rechercher un template…"), { target: { value: "zzz" } });
    expect(within(dialog).getByText("Aucun résultat.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByPlaceholderText("Rechercher un template…"), { target: { value: "flight" } });
    expect(within(dialog).queryByRole("button", { name: /Pelicase HF/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /Flight son 6U/ }));

    await waitFor(() =>
      expect(sentBody(fetchSpy, "POST", "/api/tenant/projects/p1/racks/clone-from-template")).toEqual({
        rackTemplateId: "t1",
        locationId: "l1",
      }),
    );
    // Le contenant cloné rejoint la fiche de la Régie, l'assistant se ferme.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(card("r9")).toHaveTextContent("Flight son 6U");
  });

  test("add_container_wizard_creates_new_rack", async () => {
    const { fetchSpy } = await open({
      "GET /api/tenant/racks?templates=true": { body: [] },
      "POST /api/tenant/projects/p1/racks": {
        status: 201,
        body: { rigConfigId: "rc1", racks: [{ id: "r8", name: "Baie vidéo", rackType: "STANDARD" }] },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Contenant dans Régie" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Commencer/ }));

    // Aucun modèle : la carte est désactivée et « Créer un nouveau » est retenu.
    const template = await within(dialog).findByRole("button", { name: /Choisir un template/ });
    await waitFor(() => expect(template).toBeDisabled());
    expect(template).toHaveTextContent("Aucun template");
    fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));

    // Type, nom (unicité dans le projet), emplacement, rackable.
    fireEvent.click(await within(dialog).findByRole("button", { name: /Baie standard 19"/ }));
    await settle();
    const name = within(dialog).getByPlaceholderText("Ex. Baie A — Vidéo");
    fireEvent.change(name, { target: { value: "baie 1 " } });
    expect(within(dialog).getByText("Un contenant porte déjà ce nom dans ce projet.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Continuer/ })).toBeDisabled();
    fireEvent.change(name, { target: { value: "Baie vidéo" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));
    fireEvent.click(await within(dialog).findByRole("button", { name: /Régie/ }));
    await settle();
    fireEvent.click(within(dialog).getByRole("button", { name: /Rackable \(19"\)/ }));
    await settle();

    // Hauteur : préréglage 12U ; profondeur, poids et rails par défaut.
    fireEvent.click(within(dialog).getByRole("button", { name: "12U" }));
    expect(within(dialog).getByRole("button", { name: "12U" })).toHaveClass("text-[var(--accent-strong)]");
    for (const title of ["Quelle profondeur ?", "Quel est le poids à vide ?", "Y a-t-il des rails arrière internes ?"]) {
      fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));
      expect(await within(dialog).findByText(title)).toBeInTheDocument();
    }
    fireEvent.click(within(dialog).getByRole("button", { name: /Continuer/ }));

    // Récapitulatif, puis création.
    expect(await within(dialog).findByText("Vérifiez et ajoutez votre contenant")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Ajouter le contenant/ }));
    await waitFor(() =>
      expect(sentBody(fetchSpy, "POST", "/api/tenant/projects/p1/racks")).toEqual({
        racks: [
          { name: "Baie vidéo", locationId: "l1", rackType: "STANDARD", isRackable: true, depthMm: 800, totalU: 12 },
        ],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(card("r8")).toHaveTextContent("Baie vidéo");
  });

  test("component_config_places_component", async () => {
    const BASE = "/api/tenant/projects/p1/racks/r1/inventory";
    const fetchSpy = mockApi({
      "GET /api/tenant/catalogue/equipment": {
        body: {
          arkyo: [],
          personal: [
            { id: "c1", name: "Carte SDI 4 voies", reference: "OG-SDI", brand: { id: "b1", name: "Ross" }, isComponent: true, componentSlotSpan: 2 },
            { id: "c2", name: "Carte fibre", reference: null, brand: null, isComponent: true, componentSlotSpan: 1 },
            { id: "e1", name: "Grille vidéo", reference: null, brand: null, isComponent: false },
          ],
        },
      },
      [`POST ${BASE}`]: { status: 201, body: { item: { id: "i9" } } },
      [`DELETE ${BASE}/i2`]: { body: { ok: true } },
    });
    const onChanged = vi.fn();
    const onClose = vi.fn();
    const host = { id: "i1", name: "Châssis openGear", reference: "OG3-FR", brandName: "Ross", hostSlotCount: 4 };
    const installed = [{ id: "i2", name: "Carte audio", reference: "OG-AUD", brandName: "Ross", hostSlotIndex: 0, componentSlotSpan: 2 }];
    render(
      <ConfirmProvider>
        <ComponentConfigModal host={host} components={installed} baseUrl={BASE} onChanged={onChanged} onClose={onClose} />
      </ConfirmProvider>,
    );

    // Vue slots : occupation (un composant sur deux slots) et slots libres en pointillés.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Châssis openGear")).toBeInTheDocument();
    expect(within(dialog).getByText("2/4 slots")).toBeInTheDocument();
    expect(within(dialog).getByText("Slot 1–2")).toBeInTheDocument();
    expect(within(dialog).getByText("Ross · OG-AUD")).toBeInTheDocument();
    const free = within(dialog).getAllByRole("button", { name: /Ajouter un composant/ });
    expect(free.map((b) => b.textContent)).toEqual(["Slot 3Ajouter un composant", "Slot 4Ajouter un composant"]);
    for (const b of free) expect(b).toHaveClass("border-2", "border-dashed");

    // Picker sur le slot 3 : seuls les équipements « composant » du catalogue.
    fireEvent.click(free[0]);
    expect(await within(dialog).findByText("Carte SDI 4 voies")).toBeInTheDocument();
    expect(within(dialog).getByText("Slot 3")).toBeInTheDocument();
    expect(within(dialog).getByText("Ross · OG-SDI · 2 slots")).toBeInTheDocument();
    expect(within(dialog).queryByText("Grille vidéo")).toBeNull();
    expect(
      fetchSpy.mock.calls.some(([u]) => String(u) === "/api/tenant/catalogue/equipment?scope=all"),
    ).toBe(true);
    fireEvent.change(within(dialog).getByPlaceholderText("Rechercher un composant…"), { target: { value: "xyz" } });
    expect(within(dialog).getByText("Aucun composant ne correspond à cette recherche.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByPlaceholderText("Rechercher un composant…"), { target: { value: "ross" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Carte SDI 4 voies/ }));

    await waitFor(() =>
      expect(sentBody(fetchSpy, "POST", BASE)).toEqual({ catalogEquipmentId: "c1", hostItemId: "i1", hostSlotIndex: 2 }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
    // Retour à la vue slots.
    expect(await within(dialog).findByText("2/4 slots")).toBeInTheDocument();

    // Retrait d'un composant : confirmation, puis DELETE.
    fireEvent.click(within(dialog).getByTitle("Retirer le composant"));
    fireEvent.click(await screen.findByRole("button", { name: "Retirer" }));
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([u, init]) => String(u) === `${BASE}/i2` && init?.method === "DELETE"),
      ).toBe(true),
    );
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
});
