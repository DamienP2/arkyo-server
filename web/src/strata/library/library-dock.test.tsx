/**
 * Bibliothèque glissable de l'onglet Rack (interface Strata, spec §6.2) :
 * catalogue filtrable, face arrière en miniature, dépôt sur un U libre par le
 * `DndContext` du rack et bouton « Placer » (alternative au clavier).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import type { Equipment, Slot } from "@/components/synoptique/lib/types";
import { LibraryDock, type LibraryRack } from "./library-dock";

// Le dépôt passe par le moniteur du `DndContext` existant : on capte ses
// écouteurs pour simuler la fin d'un glisser.
const dnd = vi.hoisted(() => ({
  monitor: null as null | { onDragEnd?: (e: unknown) => void },
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...mod,
    useDndMonitor: (listener: { onDragEnd?: (e: unknown) => void }) => {
      dnd.monitor = listener;
      mod.useDndMonitor(listener);
    },
  };
});

const LOOKUP = {
  connectorTypes: [
    { id: "ct-bnc", name: "BNC", iconId: "bnc" },
    { id: "ct-xlr", name: "XLR3", iconId: "xlr3" },
    { id: "ct-rj45", name: "RJ45", iconId: "rj45" },
  ],
  signals: [
    { name: "12G-SDI", color: "#3654ff", functionId: "f1" },
    { name: "AES3", color: "#f59e0b", functionId: "f2" },
    { name: "Ethernet 1G", color: "#10b981", functionId: "f3" },
  ],
  functions: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/tenant/catalogue/lookup")) {
      return new Response(JSON.stringify(LOOKUP), { headers: { "Content-Type": "application/json" } });
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ id: "s-new", ...body }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  dnd.monitor = null;
});

function equipment(id: string, name: string, extra: Partial<Equipment> = {}): Equipment {
  return {
    id,
    name,
    reference: null,
    category: null,
    categoryId: null,
    heightU: 1,
    widthFraction: "FULL",
    depthMm: null,
    dimLmm: null,
    dimWmm: null,
    dimHmm: null,
    weight: null,
    powerW: null,
    isRackable: true,
    connectors: [],
    imageUrl: null,
    rackSymbolUrl: null,
    rackSymbolRearUrl: null,
    rackPhotoFrontUrl: null,
    rackPhotoRearUrl: null,
    brand: null,
    ...extra,
  } as Equipment;
}

const port = (signalName: string, connectorTypeId: string) => ({
  id: signalName,
  face: "REAR",
  connectorTypeId,
  signalName,
  quantity: 2,
  label: "",
  direction: "BOTH",
  gender: "FEMALE",
});

const ATEM = equipment("eq1", "ATEM 2 M/E", {
  category: "Vidéo",
  brand: { id: "b1", name: "Blackmagic" } as Equipment["brand"],
  connectors: [port("12G-SDI", "ct-bnc")],
});
const CONSOLE = equipment("eq2", "Console Yamaha", { category: "Audio", heightU: 2, connectors: [port("AES3", "ct-xlr")] });
const ROUTEUR = equipment("eq3", "Routeur", { category: "Réseau", connectors: [port("Ethernet 1G", "ct-rj45")] });
const PIED = equipment("eq4", "Pied de micro", { category: "Audio", isRackable: false });

function slot(id: string, startU: number, heightU: number): Slot {
  return {
    id,
    view: "FRONT",
    equipmentId: "x",
    parentSlotId: null,
    startU,
    heightU,
    widthFraction: "FULL",
    column: 0,
  } as Slot;
}

function renderDock(racks: LibraryRack[], items: Equipment[] = [ATEM, CONSOLE, ROUTEUR, PIED]) {
  return render(
    <DndContext>
      <LibraryDock equipment={items} racks={racks} view="FRONT" />
    </DndContext>,
  );
}

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

describe("LibraryDock", () => {
  test("déposer sur un U occupé n'envoie aucune requête et affiche « Pas assez d'U libres à partir de U12 »", async () => {
    renderDock([{ id: "r1", name: "Baie A", totalU: 42, slots: [slot("a", 12, 1)] }]);
    expect(dnd.monitor?.onDragEnd).toBeTypeOf("function");
    dnd.monitor!.onDragEnd!({
      active: { id: "library-eq1", data: { current: { type: "equipment", equipment: ATEM, widthFraction: "FULL" } } },
      over: { id: "drop-r1-FRONT-12-0", data: { current: { rackId: "r1", view: "FRONT", uIndex: 12, col: 0 } } },
    });
    expect(await screen.findByText("Pas assez d'U libres à partir de U12")).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  test("un dépôt sur un U libre est laissé au canvas, sans message", async () => {
    renderDock([{ id: "r1", name: "Baie A", totalU: 42, slots: [slot("a", 12, 1)] }]);
    dnd.monitor!.onDragEnd!({
      active: { id: "library-eq1", data: { current: { type: "equipment", equipment: ATEM, widthFraction: "FULL" } } },
      over: { id: "drop-r1-FRONT-20-0", data: { current: { rackId: "r1", view: "FRONT", uIndex: 20, col: 0 } } },
    });
    expect(screen.queryByText(/Pas assez d'U libres/)).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  test("Placer propose les trois premiers U libres ; choisir envoie le POST avec startU", async () => {
    renderDock([{ id: "r1", name: "Baie A", totalU: 42, slots: [slot("a", 1, 2)] }]);
    const card = screen.getByRole("listitem", { name: "ATEM 2 M/E" });
    fireEvent.click(within(card).getByRole("button", { name: "Placer" }));
    const choices = within(card).getByRole("group", { name: "U libres pour ATEM 2 M/E" });
    expect(within(choices).getAllByRole("button").map((b) => b.textContent)).toEqual(["U3", "U4", "U5"]);

    fireEvent.click(within(choices).getByRole("button", { name: "U4" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const [url, init] = posts()[0] as [string, RequestInit];
    expect(url).toBe("/api/racks/r1/slots");
    expect(JSON.parse(String(init.body))).toEqual({
      equipmentId: "eq1",
      view: "FRONT",
      startU: 4,
      heightU: 1,
      widthFraction: "FULL",
      column: 0,
    });
  });

  test("filtre par recherche, catégorie, signal", async () => {
    renderDock([{ id: "r1", name: "Baie A", totalU: 42, slots: [] }]);
    const names = () => screen.queryAllByRole("listitem").map((li) => li.getAttribute("aria-label"));
    // Équipements posables en U seulement, chacun avec sa face arrière.
    expect(names()).toEqual(["ATEM 2 M/E", "Console Yamaha", "Routeur"]);
    expect(screen.getByRole("img", { name: "Face arrière ATEM 2 M/E" })).toBeInTheDocument();

    const search = screen.getByRole("searchbox", { name: "Rechercher dans la bibliothèque" });
    fireEvent.change(search, { target: { value: "black" } });
    expect(names()).toEqual(["ATEM 2 M/E"]);
    fireEvent.change(search, { target: { value: "" } });

    const categories = screen.getByRole("group", { name: "Catégorie" });
    fireEvent.click(within(categories).getByRole("button", { name: "Audio" }));
    expect(names()).toEqual(["Console Yamaha"]);
    fireEvent.click(within(categories).getByRole("button", { name: "Toutes" }));

    // Les signaux viennent du référentiel (chargé à part).
    const signals = screen.getByRole("group", { name: "Signal" });
    fireEvent.click(await within(signals).findByRole("button", { name: "Ethernet 1G" }));
    expect(names()).toEqual(["Routeur"]);

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(names()).toEqual([]);
    expect(screen.getByText("Aucun équipement")).toBeInTheDocument();
  });
});
