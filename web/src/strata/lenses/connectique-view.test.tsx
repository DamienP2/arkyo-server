/**
 * Vue Connectique (lentille propre à Strata, spec §6.2, lot 3) : faces de
 * chaque équipement du contenant, du haut vers le bas, avec les câbles de la
 * face affichée.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ConnectiqueView } from "./connectique-view";
import { CONNECTIONS, RACK, SLOTS } from "../bottom/test-fixtures";

// `ConnectorIcon` charge les surcharges de symboles une fois : réponse vide.
beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
});
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

/** Lignes d'équipement (enfants directs de la liste du contenant). */
const rows = () => Array.from(screen.getByRole("list", { name: "Baie 1" }).children) as HTMLElement[];

describe("ConnectiqueView", () => {
  test("une ligne par équipement, du haut vers le bas, câbles de la face affichée", () => {
    const onSelectSlot = vi.fn();
    render(
      <ConnectiqueView
        sources={[{ data: RACK, slots: SLOTS, connections: CONNECTIONS }]}
        selectedSlotId={null}
        onSelectSlot={onSelectSlot}
      />,
    );
    // Élévation du contenant à côté de la liste.
    expect(screen.getByRole("img", { name: "Élévation du rack" })).toBeInTheDocument();
    // Équipements seulement (pas le panel), du haut (U20) vers le bas (U1).
    expect(rows().map((r) => r.querySelector("strong")?.textContent)).toEqual(["ALIM", "MON 1", "CAM 1"]);

    const [alim, mon, cam] = rows();
    expect(within(mon).getByText("Moniteur 17 · U10")).toBeInTheDocument();
    expect(within(mon).getByText("2 / 2 ports reliés")).toBeInTheDocument();
    expect(within(cam).getByText("Caméra X · U1–2")).toBeInTheDocument();
    // Face arrière par défaut, dessinée.
    expect(within(cam).getByRole("img", { name: "Face arrière Caméra X" })).toBeInTheDocument();
    const camCables = within(within(cam).getByRole("list", { name: "Câbles" })).getAllByRole("listitem");
    expect(camCables.map((c) => c.textContent)).toEqual([
      "A-0101SDI OUT 1 → MON 1 · AES",
      "V-0101SDI OUT 1 → MON 1 · SDI IN",
      "—SDI OUT 2 → PATCH A",
    ]);
    expect(within(alim).getByText("Aucun câble sur cette face")).toBeInTheDocument();

    // Face avant : la caméra n'y a pas de câble.
    fireEvent.click(screen.getByRole("button", { name: "Avant" }));
    expect(within(rows()[2]).getByRole("img", { name: "Face avant Caméra X" })).toBeInTheDocument();
    expect(within(rows()[2]).getByText("Aucun câble sur cette face")).toBeInTheDocument();

    // Une ligne sélectionne son équipement.
    fireEvent.click(within(rows()[1]).getByText("MON 1"));
    expect(onSelectSlot).toHaveBeenCalledWith(SLOTS[2]);

    // Un câble est atteignable au clavier : il sélectionne l'équipement et son port.
    fireEvent.click(screen.getByRole("button", { name: "Arrière" }));
    const cableButton = within(within(rows()[2]).getByRole("list", { name: "Câbles" })).getByRole("button", {
      name: /^V-0101\s*SDI OUT 1 → MON 1 · SDI IN$/,
    });
    expect(cableButton.tagName).toBe("BUTTON");
    fireEvent.click(cableButton);
    expect(onSelectSlot).toHaveBeenLastCalledWith(SLOTS[0]);
    expect(rows()[2].querySelector('[data-port="0:1"]')).toHaveAttribute("data-selected");
  });

  test("ligne sélectionnée marquée", () => {
    render(
      <ConnectiqueView
        sources={[{ data: RACK, slots: SLOTS, connections: CONNECTIONS }]}
        selectedSlotId="s3"
        onSelectSlot={() => {}}
      />,
    );
    expect(rows()[1]).toHaveAttribute("aria-current", "true");
    expect(rows()[0]).not.toHaveAttribute("aria-current");
  });

  test("sans équipement placé : état vide ; au chargement : attente", () => {
    const { rerender } = render(
      <ConnectiqueView sources={[{ data: RACK, slots: [], connections: [] }]} selectedSlotId={null} onSelectSlot={() => {}} />,
    );
    expect(screen.getByText("Aucun équipement placé")).toBeInTheDocument();
    rerender(<ConnectiqueView sources={null} selectedSlotId={null} onSelectSlot={() => {}} />);
    expect(screen.getByText("Chargement…")).toBeInTheDocument();
  });
});
