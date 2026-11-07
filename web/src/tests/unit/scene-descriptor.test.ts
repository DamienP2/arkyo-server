import { describe, expect, it } from "vitest";

import {
  CARD_METRICS,
  SCENE_ELEMENT_KINDS,
  buildEquipmentCards,
  redrawKinds,
  type CardPortInput,
  type CardSlotInput,
} from "@/components/synoptique/lib/scene-descriptor";
import {
  PENDING_REDRAW_KINDS,
  RENDERED_ELEMENT_KINDS,
} from "@/lib/pdf/synoptic-cards";

/**
 * Garde-fou anti-dérive de l'export vectoriel.
 *
 * L'ancien exportateur programmatique du synoptique est mort d'un défaut
 * silencieux : chaque nouveau type d'élément ajouté à l'éditeur manquait au
 * PDF, sans erreur, sans trace, parfois pendant des mois. Ce test rend ce
 * défaut BRUYANT — une famille qui doit être redessinée et que le renderer
 * ignore fait échouer la suite.
 */
describe("descripteur de scène synoptique", () => {
  it("n'a pas deux familles sous le même identifiant", () => {
    const ids = SCENE_ELEMENT_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("donne une route à chaque famille", () => {
    for (const kind of SCENE_ELEMENT_KINDS) {
      expect(["svg", "redraw", "editor-only"]).toContain(kind.route);
      expect(kind.source.length).toBeGreaterThan(0);
    }
  });

  it("couvre toute famille à redessiner, ou l'assume explicitement", () => {
    const covered = new Set([...RENDERED_ELEMENT_KINDS, ...PENDING_REDRAW_KINDS]);
    const missing = redrawKinds()
      .filter((k) => !covered.has(k.id))
      .map((k) => `${k.id} (${k.label}) — voir ${k.source}`);
    expect(
      missing,
      "Familles à redessiner que le rendu PDF ignore. Ajoutez-les à " +
        "RENDERED_ELEMENT_KINDS une fois dessinées, ou à PENDING_REDRAW_KINDS " +
        "pour assumer qu'elles sortent encore en image.",
    ).toEqual([]);
  });

  it("ne garde pas de dette pour une famille déjà dessinée", () => {
    const both = PENDING_REDRAW_KINDS.filter((id) =>
      RENDERED_ELEMENT_KINDS.includes(id),
    );
    expect(both, "Famille à la fois dessinée et en dette").toEqual([]);
  });

  it("ne référence que des familles connues dans les deux listes", () => {
    const known = new Set(SCENE_ELEMENT_KINDS.map((k) => k.id));
    for (const id of [...RENDERED_ELEMENT_KINDS, ...PENDING_REDRAW_KINDS]) {
      expect(known, `Famille inconnue du descripteur : ${id}`).toContain(id);
    }
  });
});

// ── Construction des cartes ────────────────────────────────────────────────

function port(over: Partial<CardPortInput> & { portIndex: number }): CardPortInput {
  return {
    side: "left",
    color: "#0af",
    label: "SDI",
    panelLabel: null,
    direction: null,
    filled: false,
    entryIndex: 0,
    groupLabel: null,
    ...over,
  };
}

function slot(over: Partial<CardSlotInput> & { id: string }): CardSlotInput {
  return {
    isPanel: false,
    title: "Équipement",
    subtitle: null,
    rowLabel: null,
    container: null,
    badges: [],
    ports: [],
    ...over,
  };
}

/** Ancres régulières : une rangée tous les `portH`, sous le bandeau. */
const anchors =
  (nodeY: number) =>
  (_slotId: string, portIndex: number) => ({
    x: 0,
    y:
      nodeY +
      CARD_METRICS.headerH +
      CARD_METRICS.portH / 2 +
      portIndex * CARD_METRICS.portH,
    side: "left" as const,
  });

describe("buildEquipmentCards", () => {
  const positions = new Map([["s1", { x: 100, y: 50 }]]);

  it("dérive la hauteur du DERNIER port, pas d'une formule de disposition", () => {
    const cards = buildEquipmentCards(
      [slot({ id: "s1", ports: [port({ portIndex: 0 }), port({ portIndex: 3 })] })],
      positions,
      anchors(50),
    );
    // 4ᵉ rangée : en-tête + 3,5 rangées + demi-rangée + respiration.
    const expected =
      CARD_METRICS.headerH +
      4 * CARD_METRICS.portH +
      CARD_METRICS.bottomPad;
    expect(cards[0].h).toBeCloseTo(expected, 5);
  });

  it("retient la hauteur minimale pour une carte sans port", () => {
    const cards = buildEquipmentCards([slot({ id: "s1" })], positions, anchors(50));
    expect(cards[0].h).toBe(CARD_METRICS.minH);
  });

  it("reprend les ancres telles quelles, sans les recalculer", () => {
    const cards = buildEquipmentCards(
      [slot({ id: "s1", ports: [port({ portIndex: 0 })] })],
      positions,
      () => ({ x: 1234, y: 5678, side: "right" }),
    );
    expect(cards[0].ports[0]).toMatchObject({ x: 1234, y: 5678, side: "right" });
  });

  it("ignore un port sans ancre plutôt que de le poser au hasard", () => {
    const cards = buildEquipmentCards(
      [slot({ id: "s1", ports: [port({ portIndex: 0 }), port({ portIndex: 1 })] })],
      positions,
      (_s, i) => (i === 0 ? { x: 0, y: 90, side: "left" } : null),
    );
    expect(cards[0].ports).toHaveLength(1);
  });

  it("ignore une carte sans position", () => {
    expect(buildEquipmentCards([slot({ id: "absent" })], positions, anchors(50))).toEqual(
      [],
    );
  });

  it("apparie les traversées d'un panel par entrée connecteur", () => {
    const cards = buildEquipmentCards(
      [
        slot({
          id: "s1",
          isPanel: true,
          ports: [
            port({ portIndex: 0, side: "left", entryIndex: 7 }),
            port({ portIndex: 1, side: "right", entryIndex: 7, panelLabel: "8 · BNC · 8" }),
            port({ portIndex: 2, side: "right", entryIndex: 9 }),
          ],
        }),
      ],
      positions,
      (_s, i) => ({
        x: 0,
        y: 100 + i,
        side: i === 0 ? ("left" as const) : ("right" as const),
      }),
    );
    const rows = cards[0].panelRows;
    expect(rows).toHaveLength(2);
    expect(rows[0].left).not.toBeNull();
    expect(rows[0].label).toBe("8 · BNC · 8");
    // La seconde entrée n'a pas de port gauche : traversée borgne, pas d'erreur.
    expect(rows[1].left).toBeNull();
    expect(cards[0].ports).toHaveLength(0);
  });

  it("marque une traversée active dès qu'une extrémité porte une direction", () => {
    const cards = buildEquipmentCards(
      [
        slot({
          id: "s1",
          isPanel: true,
          ports: [
            port({ portIndex: 0, side: "left", entryIndex: 0, direction: "IN" }),
            port({ portIndex: 1, side: "right", entryIndex: 0 }),
          ],
        }),
      ],
      positions,
      (_s, i) => ({
        x: 0,
        y: 100,
        side: i === 0 ? ("left" as const) : ("right" as const),
      }),
    );
    expect(cards[0].panelRows[0].active).toBe(true);
  });

  it("pose un mini-en-tête par groupe et un filet entre les bandes", () => {
    const cards = buildEquipmentCards(
      [
        slot({
          id: "s1",
          ports: [
            port({ portIndex: 0, groupLabel: "Carte A" }),
            port({ portIndex: 1, groupLabel: "Carte A" }),
            port({ portIndex: 2, groupLabel: "Carte B" }),
          ],
        }),
      ],
      positions,
      anchors(50),
    );
    expect(cards[0].segments.map((s) => s.label)).toEqual(["Carte A", "Carte B"]);
    expect(cards[0].dividers.some((d) => d.kind === "segment")).toBe(true);
  });

  it("pose un filet court à chaque changement d'entrée connecteur", () => {
    const cards = buildEquipmentCards(
      [
        slot({
          id: "s1",
          ports: [
            port({ portIndex: 0, entryIndex: 0 }),
            port({ portIndex: 1, entryIndex: 0 }),
            port({ portIndex: 2, entryIndex: 1 }),
          ],
        }),
      ],
      positions,
      anchors(50),
    );
    expect(cards[0].dividers.filter((d) => d.kind === "port")).toHaveLength(1);
  });
});
