/**
 * Inspecteur Strata (spec §6.2, lot 3) : face de l'équipement sélectionné,
 * ports reliés, liste des entrées et occupation, câble d'un port.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EquipmentFaceCard } from "./equipment-face-card";
import { CONNECTIONS, RACK, SLOTS } from "../bottom/test-fixtures";

// `ConnectorIcon` charge les surcharges de symboles une fois : réponse vide.
beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
});
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

const port = (key: string) => document.querySelector(`[data-port="${key}"]`) as SVGGElement;

function renderCard() {
  return render(
    <EquipmentFaceCard slot={SLOTS[0]} canvasData={RACK} connections={CONNECTIONS} slots={SLOTS} rackName="Baie 1" />,
  );
}

describe("EquipmentFaceCard", () => {
  test("face avec ports reliés, liste des entrées et occupation n/q, clic sur un port → câble et autre extrémité", () => {
    renderCard();
    // Face la plus garnie (arrière) d'abord, à l'échelle.
    expect(screen.getByRole("img", { name: "Face arrière Caméra X" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arrière" })).toHaveAttribute("aria-pressed", "true");
    expect(port("0:1")).toHaveAttribute("data-linked");
    expect(port("0:2")).toHaveAttribute("data-linked");
    expect(screen.getByText("2 / 3 ports reliés")).toBeInTheDocument();

    // Entrées de la face : repère de famille, connecteur et genre, occupation.
    const list = screen.getByRole("list", { name: "Entrées de connectique" });
    const sdi = within(list).getByText("SDI OUT").closest("li")!;
    expect(within(sdi).getByText("BNC F")).toBeInTheDocument();
    expect(within(sdi).getByText("2/2")).toBeInTheDocument();

    // Un port : son câble et l'autre extrémité.
    fireEvent.click(port("0:1"));
    expect(port("0:1")).toHaveAttribute("data-selected");
    const box = screen.getByRole("region", { name: "Port SDI OUT 1" });
    expect(within(box).getByText("BNC F · 12G-SDI · sortie")).toBeInTheDocument();
    expect(within(box).getByText("V-0101")).toBeInTheDocument();
    expect(within(box).getByText("→ MON 1 · SDI IN")).toBeInTheDocument();

    // Câble sans numéro vers un panel.
    fireEvent.click(port("0:2"));
    const box2 = screen.getByRole("region", { name: "Port SDI OUT 2" });
    expect(within(box2).getByText("Sans numéro")).toBeInTheDocument();
    expect(within(box2).getByText("→ PATCH A")).toBeInTheDocument();

    // Face avant : l'entrée REF, libre.
    fireEvent.click(screen.getByRole("button", { name: "Avant" }));
    expect(screen.getByRole("img", { name: "Face avant Caméra X" })).toBeInTheDocument();
    const ref = within(screen.getByRole("list", { name: "Entrées de connectique" })).getByText("REF").closest("li")!;
    expect(within(ref).getByText("0/1")).toBeInTheDocument();
    fireEvent.click(port("1:1"));
    expect(within(screen.getByRole("region", { name: "Port REF" })).getByText("Libre")).toBeInTheDocument();
  });

  test("position, énergie et réseau", () => {
    renderCard();
    expect(screen.getByText("Baie 1")).toBeInTheDocument();
    expect(screen.getByText("U1–U2 · 2 U · avant")).toBeInTheDocument();
    expect(screen.getByText("300 mm")).toBeInTheDocument();
    expect(screen.getByText("100 W · double alimentation")).toBeInTheDocument();
    expect(screen.getByText("341 BTU/h")).toBeInTheDocument();
    expect(screen.getByText("5 kg")).toBeInTheDocument();
  });

  test("rien sans équipement sélectionné (panel, aucune sélection)", () => {
    const { container, rerender } = render(<EquipmentFaceCard slot={null} canvasData={RACK} connections={CONNECTIONS} />);
    expect(container.innerHTML).toBe("");
    rerender(<EquipmentFaceCard slot={SLOTS[1]} canvasData={RACK} connections={CONNECTIONS} />);
    expect(container.innerHTML).toBe("");
  });
});
