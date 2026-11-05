import { describe, expect, it } from "vitest";
import {
  adaptPrintLayoutToSize,
  type LineElement,
  type PrintLayout,
  type RectElement,
  type TextElement,
} from "@/lib/services/print-layout";

// A4 paysage → A2 paysage : le cas typique cartouche conçu en A4, exporté en
// grand format (et l'inverse pour la réduction).
const A4L = { w: 297, h: 210 };
const A2L = { w: 594, h: 420 };

function makeLayout(elements: PrintLayout["elements"]): PrintLayout {
  return {
    version: 1,
    gridSize: 5,
    background: { type: "SOLID", color: "#ffffff" },
    elements,
  };
}

const rect = (partial: Partial<RectElement> & Pick<RectElement, "x" | "y" | "w" | "h">): RectElement => ({
  id: "r1",
  type: "RECT",
  fill: "none",
  stroke: "#0f172a",
  strokeWidth: 0.5,
  ...partial,
});

const text = (partial: Partial<TextElement> & Pick<TextElement, "x" | "y" | "w" | "h">): TextElement => ({
  id: "t1",
  type: "TEXT",
  text: "Titre du plan",
  fontSize: 14,
  fontWeight: "normal",
  fontStyle: "normal",
  align: "left",
  color: "#0f172a",
  ...partial,
});

const line = (partial: Partial<LineElement> & Pick<LineElement, "x1" | "y1" | "x2" | "y2">): LineElement => ({
  id: "l1",
  type: "LINE",
  stroke: "#0f172a",
  strokeWidth: 0.5,
  ...partial,
});

describe("adaptPrintLayoutToSize", () => {
  it("retourne le layout tel quel si src == dst (à ε près)", () => {
    const layout = makeLayout([rect({ x: 10, y: 10, w: 50, h: 20 })]);
    expect(adaptPrintLayoutToSize(layout, A4L, { ...A4L })).toBe(layout);
  });

  it("cadre de feuille (étirable sur les 2 axes) : conserve les écarts aux bords", () => {
    // Cadre à 5 mm des 4 bords sur A4 paysage → couvre ≥ 60 % des 2 axes.
    const layout = makeLayout([rect({ x: 5, y: 5, w: 287, h: 200 })]);
    const out = adaptPrintLayoutToSize(layout, A4L, A2L);
    const el = out.elements[0] as RectElement;
    expect(el.x).toBe(5);
    expect(el.y).toBe(5);
    expect(el.w).toBe(A2L.w - 5 - 5); // 584
    expect(el.h).toBe(A2L.h - 5 - 5); // 410
  });

  it("bloc bas-droite : ancré au bord le plus proche, taille native", () => {
    // Bloc cartouche 80×30 à 10 mm des bords droit et bas.
    const layout = makeLayout([rect({ x: 207, y: 170, w: 80, h: 30 })]);
    const out = adaptPrintLayoutToSize(layout, A4L, A2L);
    const el = out.elements[0] as RectElement;
    expect(el.w).toBe(80);
    expect(el.h).toBe(30);
    expect(el.x).toBe(A2L.w - 10 - 80); // 504 — écart droit 10 mm conservé
    expect(el.y).toBe(A2L.h - 10 - 30); // 380 — écart bas 10 mm conservé
  });

  it("bloc haut-gauche : ancré, position inchangée", () => {
    const layout = makeLayout([rect({ x: 12, y: 8, w: 40, h: 15 })]);
    const out = adaptPrintLayoutToSize(layout, A4L, A2L);
    const el = out.elements[0] as RectElement;
    expect(el).toMatchObject({ x: 12, y: 8, w: 40, h: 15 });
  });

  it("TEXT : fontSize inchangé, boîte ancrée à taille native", () => {
    const layout = makeLayout([
      text({ x: 207, y: 175, w: 80, h: 10, fontSize: 14 }),
    ]);
    const out = adaptPrintLayoutToSize(layout, A4L, A2L);
    const el = out.elements[0] as TextElement;
    expect(el.fontSize).toBe(14); // le but de l'ancrage : taille réelle conservée
    expect(el.w).toBe(80);
    expect(el.h).toBe(10);
    expect(el.x).toBe(A2L.w - 10 - 80); // ancré à droite comme son bloc
  });

  it("élément centré : re-centré à taille native sur l'axe cible", () => {
    // Centré en X ((297-40)/2 = 128.5 de chaque côté), proche du haut en Y.
    const layout = makeLayout([rect({ x: 128.5, y: 5, w: 40, h: 10 })]);
    const out = adaptPrintLayoutToSize(layout, A4L, A2L);
    const el = out.elements[0] as RectElement;
    expect(el.x).toBe((A2L.w - 40) / 2); // 277
    expect(el.w).toBe(40);
    expect(el.y).toBe(5); // ancré en haut
  });

  it("ligne de cadre horizontale : s'étire en X, ancrée en Y", () => {
    // Ligne de 5 mm à 292 mm (étirable en X), à 10 mm du bord bas.
    const layout = makeLayout([line({ x1: 5, y1: 200, x2: 292, y2: 200 })]);
    const out = adaptPrintLayoutToSize(layout, A4L, A2L);
    const el = out.elements[0] as LineElement;
    expect(el.x1).toBe(5);
    expect(el.x2).toBe(A2L.w - 5); // 589
    expect(el.y1).toBe(A2L.h - 10); // 410 — écart bas 10 mm conservé
    expect(el.y2).toBe(A2L.h - 10);
  });

  it("ligne : préserve l'ordre/direction des extrémités", () => {
    // Même ligne tracée de droite à gauche.
    const layout = makeLayout([line({ x1: 292, y1: 200, x2: 5, y2: 200 })]);
    const out = adaptPrintLayoutToSize(layout, A4L, A2L);
    const el = out.elements[0] as LineElement;
    expect(el.x1).toBe(A2L.w - 5); // reste l'extrémité droite
    expect(el.x2).toBe(5); // reste l'extrémité gauche
  });

  it("réduction A2 → A4 : ancrage symétrique", () => {
    // Bloc bas-droite conçu sur A2 paysage, exporté en A4 paysage.
    const layout = makeLayout([rect({ x: 504, y: 380, w: 80, h: 30 })]);
    const out = adaptPrintLayoutToSize(layout, A2L, A4L);
    const el = out.elements[0] as RectElement;
    expect(el.w).toBe(80);
    expect(el.h).toBe(30);
    expect(el.x).toBe(A4L.w - 10 - 80); // 207
    expect(el.y).toBe(A4L.h - 10 - 30); // 170
  });

  it("background et métadonnées du layout inchangés", () => {
    const layout = makeLayout([rect({ x: 5, y: 5, w: 287, h: 200 })]);
    const out = adaptPrintLayoutToSize(layout, A4L, A2L);
    expect(out.background).toEqual(layout.background);
    expect(out.gridSize).toBe(layout.gridSize);
    expect(out.version).toBe(1);
  });
});
