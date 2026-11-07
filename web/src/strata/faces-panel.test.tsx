/**
 * Panneau « Faces et schéma » (fiche équipement, onglet Connectique, interface
 * Strata) : faces avant et arrière et schéma de principe dessinés depuis le
 * formulaire en cours de saisie.
 */

import { useState } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ConnectorEntry, FormData } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { initialForm } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { OWNER_PERMS, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";
import { FacesPanel, type FacesLookup } from "./faces-panel";

const LOOKUP: FacesLookup = {
  brands: [{ id: "b1", name: "Blackmagic Design" }],
  connectorTypes: [
    { id: "c1", name: "BNC", iconId: "bnc" },
    { id: "c3", name: "IEC C14", iconId: "iec13" },
  ],
  signals: [
    { name: "12G-SDI", color: "#3654ff", functionId: "f1" },
    { name: "Secteur 230 V", color: "#6b7280", functionId: "f5" },
  ],
  functions: [
    { id: "f1", key: "VIDEO", label: "Vidéo", color: "#3b82f6" },
    { id: "f5", key: "ENERGIE", label: "Énergie", color: "#ef4444" },
  ],
};

function entry(p: Partial<ConnectorEntry>): ConnectorEntry {
  return {
    id: String(p.label),
    face: "REAR",
    connectorTypeId: "c1",
    signalName: "12G-SDI",
    quantity: 1,
    label: "SDI IN",
    direction: "IN",
    gender: "FEMALE",
    ...p,
  };
}

function baseForm(): FormData {
  return {
    ...initialForm(null),
    name: "Videohub 40×40 12G",
    brandId: "b1",
    heightU: 2,
    is2110: true,
    connectorEntries: [
      entry({ label: "SDI IN", quantity: 4 }),
      entry({ label: "AC", connectorTypeId: "c3", signalName: "Secteur 230 V", gender: "MALE" }),
    ],
  };
}

/** Formulaire vivant : un bouton ajoute une entrée de connectique, comme l'éditeur. */
function Harness() {
  const [form, setForm] = useState<FormData>(baseForm);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          setForm((f) => ({
            ...f,
            connectorEntries: [...f.connectorEntries, entry({ label: "SDI OUT", quantity: 2, direction: "OUT" })],
          }))
        }
      >
        ajouter
      </button>
      <FacesPanel form={form} lookup={LOOKUP} />
    </>
  );
}

describe("FacesPanel", () => {
  // `ConnectorIcon` charge les surcharges de symboles une fois : réponse vide.
  beforeAll(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  test("FacesPanel se met à jour pendant la saisie", () => {
    render(<Harness />);
    const panel = screen.getByRole("region", { name: "Faces et schéma" });
    const rear = () => within(panel).getByRole("img", { name: "Face arrière Videohub 40×40 12G" });
    const front = () => within(panel).getByRole("img", { name: "Face avant Videohub 40×40 12G" });
    const schema = () => within(panel).getByRole("img", { name: "Schéma de principe Videohub 40×40 12G" });

    expect(rear().querySelectorAll("[data-entry]")).toHaveLength(2);
    expect(front().querySelectorAll("[data-port]")).toHaveLength(0);
    expect(schema().querySelectorAll("[data-entry]")).toHaveLength(2);
    // L'énergie (signal de la fonction ENERGIE) passe au-dessus du schéma.
    expect(schema().querySelector('[data-side="power"]')).not.toBeNull();
    expect(within(panel).getByText("5 ports · 2 U · 482,6 mm")).toBeInTheDocument();
    expect(within(panel).getByText("Avant · sans connectique")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ajouter" }));

    expect(rear().querySelectorAll("[data-entry]")).toHaveLength(3);
    expect(rear().querySelectorAll("[data-port]")).toHaveLength(4 + 1 + 2);
    expect(schema().querySelectorAll("[data-entry]")).toHaveLength(3);
    expect(schema().querySelectorAll('[data-side="out"]')).toHaveLength(1);
    expect(within(panel).getByText("7 ports · 2 U · 482,6 mm")).toBeInTheDocument();
  });

  test("légende du schéma : ports par famille de signal", () => {
    render(<FacesPanel form={baseForm()} lookup={LOOKUP} />);
    const legend = screen.getByRole("list", { name: "Familles de signal" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Vidéo 4", "Énergie 1"]);
  });

  test("survol d'une entrée sur la face, repris dans le schéma", () => {
    render(<FacesPanel form={baseForm()} lookup={LOOKUP} />);
    const panel = screen.getByRole("region", { name: "Faces et schéma" });
    const rear = within(panel).getByRole("img", { name: "Face arrière Videohub 40×40 12G" });
    const schema = within(panel).getByRole("img", { name: "Schéma de principe Videohub 40×40 12G" });
    fireEvent.mouseEnter(rear.querySelector('[data-entry="0"]')!);
    expect(schema.querySelector('[data-entry="0"]')).toHaveAttribute("data-hover");
    fireEvent.mouseLeave(rear.querySelector('[data-entry="0"]')!);
    expect(schema.querySelector('[data-entry="0"]')).not.toHaveAttribute("data-hover");
  });

  test("équipement posé : « pose libre »", () => {
    render(<FacesPanel form={{ ...baseForm(), isRackable: false }} lookup={LOOKUP} />);
    expect(screen.getByText("5 ports · pose libre")).toBeInTheDocument();
  });

  test("le panneau se replie", () => {
    render(<FacesPanel form={baseForm()} lookup={LOOKUP} />);
    const toggle = screen.getByRole("button", { name: "Replier le panneau Faces et schéma" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("img", { name: /Face arrière/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Déplier le panneau Faces et schéma" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

// ── Dans la fiche équipement (onglet Connectique) ────────────────────────────

const DETAIL = {
  source: "PERSONAL",
  isAccessible: true,
  item: {
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
    weight: null,
    powerW: null,
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
  },
};

function editorApi(iface: "strata" | "classique"): Api {
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
  };
}

describe("fiche équipement, onglet Connectique", () => {
  beforeAll(async () => {
    await import("@/app/(app)/admin/catalogue/equipment/[id]/page");
  }, 60000);
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    resetApp();
    delete document.documentElement.dataset.interface;
  });

  test("Strata : panneau « Faces et schéma » au-dessus de la connectique", async () => {
    renderApp("/admin/catalogue/equipment/e1", editorApi("strata"));
    await screen.findByPlaceholderText("BRC-X400", {}, { timeout: 15000 });
    expect(screen.queryByRole("region", { name: "Faces et schéma" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Connectique/ }));
    const panel = await screen.findByRole("region", { name: "Faces et schéma" });
    const rear = within(panel).getByRole("img", { name: "Face arrière HDC-5500" });
    expect(rear.querySelectorAll("[data-port]")).toHaveLength(2);
    expect(within(panel).getByRole("img", { name: "Schéma de principe HDC-5500" })).toBeInTheDocument();

    // Disposition : colonne pleine hauteur ; le panneau garde sa hauteur propre
    // (contenu plafonné, défilement à lui), l'onglet existant prend le reste et
    // garde sa seule zone de défilement (liste des ports).
    const layout = panel.closest("[data-strata-connectivity]") as HTMLElement;
    expect(layout).not.toBeNull();
    expect(layout.className.split(" ")).toEqual(expect.arrayContaining(["flex", "h-full", "min-h-0", "flex-col"]));
    expect(panel.parentElement).toHaveClass("shrink-0");
    expect(panel.parentElement?.parentElement).toBe(layout);
    expect(panel.querySelector("[data-faces-body]")).toHaveClass("max-h-[32vh]", "overflow-y-auto");
    const tab = layout.querySelector(":scope > [data-strata-connectivity-tab]") as HTMLElement;
    expect(tab).toHaveClass("min-h-0", "flex-1");
    expect(tab).not.toHaveClass("overflow-y-auto");
    expect(within(tab).getByRole("button", { name: /Ajouter un groupe de connecteurs/ })).toBeInTheDocument();
    expect(tab.contains(panel)).toBe(false);
    // Le conteneur de défilement de l'éditeur contient la colonne, sans autre enfant.
    expect(layout.parentElement?.children).toHaveLength(1);
  });

  test("Classique : pas de panneau « Faces et schéma »", async () => {
    renderApp("/admin/catalogue/equipment/e1", editorApi("classique"));
    await screen.findByPlaceholderText("BRC-X400", {}, { timeout: 15000 });
    fireEvent.click(screen.getByRole("button", { name: /Connectique/ }));
    await waitFor(() => expect(screen.getAllByText("SDI OUT").length).toBeGreaterThan(0));
    expect(screen.queryByRole("region", { name: "Faces et schéma" })).toBeNull();
    // Rendu d'arkyo : aucun élément de disposition Strata ajouté.
    expect(document.querySelector("[data-strata-connectivity]")).toBeNull();
    expect(document.querySelector("[data-strata-connectivity-tab]")).toBeNull();
  });
});
