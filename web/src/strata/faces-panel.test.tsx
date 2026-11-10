/**
 * Bandeau des faces de l'éditeur d'équipement pleine page (interface Strata
 * v2) : faces avant et arrière dessinées depuis le formulaire en cours de
 * saisie. Le schéma de principe est dans la colonne d'aperçu
 * (`pages/equipment-editor-layout.test.tsx`).
 */

import { useState } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ConnectorEntry, FormData } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { initialForm } from "@/app/(app)/admin/equipment/[id]/_editor/types";
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
    const strip = screen.getByRole("region", { name: "Faces" });
    const rear = () => within(strip).getByRole("img", { name: "Face arrière Videohub 40×40 12G" });
    const front = () => within(strip).getByRole("img", { name: "Face avant Videohub 40×40 12G" });

    expect(rear().querySelectorAll("[data-entry]")).toHaveLength(2);
    expect(front().querySelectorAll("[data-port]")).toHaveLength(0);
    // Le schéma de principe n'est plus dans le bandeau (colonne d'aperçu).
    expect(within(strip).queryByRole("img", { name: /Schéma de principe/ })).toBeNull();
    expect(within(strip).getByText("5 ports · 2 U · 482,6 mm")).toBeInTheDocument();
    expect(within(strip).getByText("sans connectique")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ajouter" }));

    expect(rear().querySelectorAll("[data-entry]")).toHaveLength(3);
    expect(rear().querySelectorAll("[data-port]")).toHaveLength(4 + 1 + 2);
    expect(within(strip).getByText("7 ports · 2 U · 482,6 mm")).toBeInTheDocument();
    expect(within(strip).getByText("7 ports")).toBeInTheDocument();
  });

  test("survol partagé : `hoverEntry` / `onEntryHover`", () => {
    const seen: (number | null)[] = [];
    const { rerender } = render(
      <FacesPanel form={baseForm()} lookup={LOOKUP} hoverEntry={null} onEntryHover={(e) => seen.push(e)} />,
    );
    const rear = screen.getByRole("img", { name: "Face arrière Videohub 40×40 12G" });
    fireEvent.mouseEnter(rear.querySelector('[data-entry="0"]')!);
    fireEvent.mouseLeave(rear.querySelector('[data-entry="0"]')!);
    expect(seen).toEqual([0, null]);
    rerender(<FacesPanel form={baseForm()} lookup={LOOKUP} hoverEntry={1} onEntryHover={() => {}} />);
    expect(rear.querySelector('[data-entry="1"]')).toHaveAttribute("data-hover");
  });

  test("équipement posé : « pose libre »", () => {
    render(<FacesPanel form={{ ...baseForm(), isRackable: false }} lookup={LOOKUP} />);
    expect(screen.getByText("5 ports · pose libre")).toBeInTheDocument();
  });

  test("le bandeau se replie", () => {
    render(<FacesPanel form={baseForm()} lookup={LOOKUP} />);
    const toggle = screen.getByRole("button", { name: "Replier le bandeau des faces" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("img", { name: /Face arrière/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Déplier le bandeau des faces" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
