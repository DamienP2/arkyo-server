/**
 * Composants rack partagés de l'onglet Rack (phase 4b, Task 3) :
 * `rack-visual` (faces FRONT, REAR, REAR_INTERIOR) et `side-rack-visual`
 * (SIDE), copiés d'arkyo:app/(app)/rigs/[id]/rack/[rackId]/_components.
 * Test de fumée : les quatre vues se montent avec des données réelles (un
 * équipement par face, un panel, un slot fantôme), sans erreur en console.
 */

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { RackVisual } from "./[id]/rack/[rackId]/_components/rack-visual";
import { SideRackVisual } from "./[id]/rack/[rackId]/_components/side-rack-visual";
import type { Equipment, Rack, Slot, ViewId } from "@/components/synoptique/lib/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function equipment(id: string, name: string, heightU: number, depthMm: number): Equipment {
  return {
    id,
    name,
    reference: null,
    category: "Vidéo",
    categoryId: null,
    heightU,
    widthFraction: "FULL",
    depthMm,
    dimLmm: null,
    dimWmm: null,
    dimHmm: null,
    weight: 4,
    powerW: 120,
    isRackable: true,
    connectors: [],
    imageUrl: null,
    rackSymbolUrl: null,
    rackSymbolRearUrl: null,
    rackPhotoFrontUrl: null,
    rackPhotoRearUrl: null,
    brand: null,
  };
}

function slot(id: string, view: ViewId, startU: number | null, eq: Equipment | null, extra: Partial<Slot> = {}): Slot {
  return {
    id,
    view,
    equipmentId: eq?.id ?? null,
    parentSlotId: null,
    startU,
    heightU: startU == null ? null : (eq?.heightU ?? 1),
    widthFraction: "FULL",
    column: 0,
    label: null,
    notes: null,
    panelLabels: null,
    equipment: eq,
    panel: null,
    synopticX: null,
    synopticY: null,
    ...extra,
  };
}

const SLOTS: Slot[] = [
  slot("s-front", "FRONT", 10, equipment("e1", "Mélangeur ATEM", 2, 400)),
  slot("s-rear", "REAR", 4, equipment("e2", "Routeur Videohub", 1, 300)),
  slot("s-rint", "REAR_INTERIOR", 6, equipment("e3", "Convertisseur SDI", 1, 120)),
  slot("s-panel", "FRONT", 1, null, {
    panel: {
      id: "p1",
      name: "Panel BNC 16",
      heightU: 1,
      panelType: "PATCH",
      category: null,
      slots: [],
      rows: null,
    } as unknown as Slot["panel"],
  }),
  // Slot fantôme (inventorié, pas encore posé) : jamais dessiné.
  slot("s-ghost", "FRONT", null, equipment("e4", "Fantôme non posé", 1, 100)),
];

const RACK: Rack = {
  id: "r1",
  name: "Baie A",
  totalU: 12,
  depthMm: 800,
  maxWeightKg: null,
  maxPowerW: null,
  rearInteriorGapMm: 50,
  slots: SLOTS,
};

test("rack_visual_renders_four_views", () => {
  const errors = vi.spyOn(console, "error");
  const views: Record<Exclude<ViewId, "SIDE">, string> = {
    FRONT: "Mélangeur ATEM",
    REAR: "Routeur Videohub",
    REAR_INTERIOR: "Convertisseur SDI",
  };
  for (const [view, name] of Object.entries(views) as [ViewId, string][]) {
    const { container, unmount } = render(
      <DndContext>
        <RackVisual
          rack={RACK}
          slots={SLOTS}
          view={view}
          showInfo
          onRemoveSlot={() => {}}
          selectedEquipment={null}
          onTapPlace={() => {}}
        />
      </DndContext>,
    );
    const scope = within(container);
    expect(scope.getAllByText(name).length).toBeGreaterThan(0);
    // Chaque face ne dessine que ses slots.
    for (const other of Object.values(views).filter((n) => n !== name)) {
      expect(scope.queryByText(other)).toBeNull();
    }
    expect(scope.queryByText("Fantôme non posé")).toBeNull();
    if (view === "FRONT") expect(scope.getAllByText("Panel BNC 16").length).toBeGreaterThan(0);
    unmount();
  }

  const { container } = render(<SideRackVisual rack={RACK} slots={SLOTS} innerW={200} />);
  // Vue de côté : les trois faces posées, en profondeur ; le fantôme n'y est pas.
  // Face avant : la profondeur de l'équipement ; faces arrière : nom et profondeur en info-bulle.
  const side = within(container);
  expect(side.getAllByText("400mm").length).toBeGreaterThan(0);
  expect(side.queryByText("100mm")).toBeNull();
  const titles = [...container.querySelectorAll("[title]")].map((el) => el.getAttribute("title") ?? "");
  expect(titles).toContain("Routeur Videohub — 300mm");
  expect(titles).toContain("Convertisseur SDI — 120mm");
  expect(titles.some((t) => t.includes("Fantôme"))).toBe(false);
  expect(screen.queryByText("Fantôme non posé")).toBeNull();

  expect(errors).not.toHaveBeenCalled();
});
