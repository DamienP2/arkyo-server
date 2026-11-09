/**
 * Section « Avancé » des écrans dessinés par l'interface Strata (spec v2 §2) :
 * repliée par défaut, ouverture mémorisée par type d'écran (`kind`), ou
 * toujours ouverte (préférence « Toujours afficher les sections avancées »).
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdvancedAlwaysToggle, AdvancedSection } from "./advanced-section";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const header = () => screen.getByRole("button", { name: /Avancé/ });

describe("AdvancedSection", () => {
  test("AdvancedSection mémorise par kind", () => {
    const { unmount } = render(
      <AdvancedSection kind="materiel" summary="Référence, identifiant">
        <p>Contenu rare</p>
      </AdvancedSection>,
    );
    // Repliée par défaut, résumé visible.
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Référence, identifiant")).toBeInTheDocument();
    expect(screen.queryByText("Contenu rare")).toBeNull();

    fireEvent.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Contenu rare")).toBeInTheDocument();
    expect(window.localStorage.getItem("strata-advanced-materiel")).toBe("1");
    unmount();

    // Même type d'écran : rouvert ; autre type : replié.
    render(
      <>
        <AdvancedSection kind="materiel" summary="a">
          <p>Matériel</p>
        </AdvancedSection>
        <AdvancedSection kind="cable" summary="b">
          <p>Câble</p>
        </AdvancedSection>
      </>,
    );
    expect(screen.getByText("Matériel")).toBeInTheDocument();
    expect(screen.queryByText("Câble")).toBeNull();

    // Refermée : mémorisé aussi.
    fireEvent.click(screen.getAllByRole("button", { name: /Avancé/ })[0]);
    expect(screen.queryByText("Matériel")).toBeNull();
    expect(window.localStorage.getItem("strata-advanced-materiel")).toBe("0");
  });

  test("« Toujours afficher les sections avancées » ouvre toutes les sections", () => {
    render(
      <>
        <AdvancedAlwaysToggle />
        <AdvancedSection kind="cable" summary="b">
          <p>Câble</p>
        </AdvancedSection>
      </>,
    );
    expect(screen.queryByText("Câble")).toBeNull();
    const toggle = screen.getByRole("switch", { name: "Toujours afficher les sections avancées" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem("strata-advanced-always")).toBe("1");
    expect(screen.getByText("Câble")).toBeInTheDocument();
    expect(screen.getByText("toujours affiché")).toBeInTheDocument();
    // La mémoire par type n'est pas touchée.
    expect(window.localStorage.getItem("strata-advanced-cable")).toBeNull();
  });
});
