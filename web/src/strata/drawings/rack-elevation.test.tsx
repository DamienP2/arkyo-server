/**
 * `RackElevation` (interface Strata) : un équipement qui dépasse le haut du
 * rack reste dans le cadre ; la vue « Côté » sans profondeur connue ne
 * dessine pas de réserve de câbles.
 */

import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { RackElevation, type RackElevationSlot } from "./rack-elevation";
import { U_MM } from "./face-layout";

afterEach(cleanup);

const TOP = 22;

const slot = (id: string, startU: number, heightU: number, extra: Partial<RackElevationSlot> = {}): RackElevationSlot => ({
  id,
  startU,
  heightU,
  label: id.toUpperCase(),
  name: `Équipement ${id}`,
  ...extra,
});

/** Rectangle de la plaque neutre d'un slot (`y`, `height`). */
function plate(id: string) {
  const r = document.querySelector(`[data-slot="${id}"] rect`) as SVGRectElement;
  return { y: Number(r.getAttribute("y")), h: Number(r.getAttribute("height")) };
}

describe("RackElevation", () => {
  test("un équipement qui dépasse le haut du rack est dessiné dans le cadre, rogné", () => {
    // 10 U, équipement de 4 U posé en U9 : U9–U10 visibles, U11–U12 hors rack.
    render(<RackElevation units={10} slots={[slot("a", 9, 4), slot("b", 1, 1)]} face="FRONT" labels={false} />);
    const a = plate("a");
    expect(a.y).toBeCloseTo(TOP + 0.5, 5);
    expect(a.h).toBeCloseTo(2 * U_MM - 1, 5);
    // Le placement ordinaire ne change pas.
    expect(plate("b").y).toBeCloseTo(TOP + 9 * U_MM + 0.5, 5);
  });

  test("vue Côté sans profondeur connue : pas de réserve de câbles", () => {
    render(<RackElevation units={4} slots={[slot("a", 1, 1), slot("b", 3, 1)]} face="SIDE" labels={false} />);
    expect(document.querySelectorAll('[stroke-dasharray="4 4"]')).toHaveLength(0);
    expect(document.body.textContent).toContain("Profondeur non renseignée");
  });

  test("vue Côté avec profondeur : réserve en pointillés derrière chaque équipement", () => {
    render(
      <RackElevation
        units={4}
        depthMm={600}
        slots={[slot("a", 1, 1, { depthMm: 300 }), slot("b", 3, 1)]}
        face="SIDE"
        labels={false}
      />,
    );
    expect(document.querySelectorAll('[stroke-dasharray="4 4"]')).toHaveLength(2);
    expect(document.body.textContent).toContain("Profondeur utile 600 mm");
  });
});
