/**
 * Dock bas de l'éditeur Strata (spec §6.2, lot 3) : Contrôles (`validateRack`
 * sur le contenant courant, ou rapport du synoptique), Câbles, Bilan.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EditorShell } from "@/components/editor-shell/editor-shell";
import { WorkspaceProvider } from "@/components/editor-shell/workspace-context";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import type { ValidationReport } from "@/lib/services/rack-validation";
import { InterfaceProvider } from "@/strata/interface-context";
import { RackBottomDock } from "./rack-bottom-dock";
import { CONNECTIONS, RACK, SLOTS } from "./test-fixtures";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  useTopbarActions.getState().setValidationReport(null);
  useTopbarActions.getState().setOnSelectValidationIssue(undefined);
});

const SOURCES = [{ data: RACK, slots: SLOTS, connections: CONNECTIONS }];

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("RackBottomDock", () => {
  test("onglet Contrôles : un clic sur un problème sélectionne le slot en cause", () => {
    const onSelectSlot = vi.fn();
    render(<RackBottomDock sources={SOURCES} onSelectSlot={onSelectSlot} />);
    // Compteurs d'erreurs et d'avertissements sur l'onglet.
    expect(tab(/Contrôles/)).toHaveAccessibleName("Contrôles 2 erreurs, 2 avertissements");
    const list = screen.getByRole("list", { name: "Contrôles" });
    // Erreurs d'abord.
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveAttribute("data-severity", "error");
    expect(items[4]).toHaveAttribute("data-severity", "info");

    fireEvent.click(within(list).getByRole("button", { name: /CAM 1 - Caméra X.*connecté 2 fois/ }));
    expect(onSelectSlot).toHaveBeenCalledWith(SLOTS[0]);
    // Rangée virtuelle d'un panel → slot réel du panel.
    fireEvent.click(within(list).getByRole("button", { name: /PATCH A - Patch BNC 8.*partiellement/ }));
    expect(onSelectSlot).toHaveBeenLastCalledWith(SLOTS[1]);
  });

  test("onglet Câbles : liste numérotée du contenant", () => {
    const onSelectSlot = vi.fn();
    render(<RackBottomDock sources={SOURCES} onSelectSlot={onSelectSlot} />);
    fireEvent.click(tab(/Câbles/));
    expect(tab(/Câbles/)).toHaveAccessibleName("Câbles 3");
    const table = screen.getByRole("table", { name: "Câbles" });
    const body = within(table).getAllByRole("row").slice(1);
    expect(body.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["A-0101", "MON 1 · AES", "CAM 1 · SDI OUT 1", "AES3"],
      ["V-0101", "CAM 1 · SDI OUT 1", "MON 1 · SDI IN", "12G-SDI"],
      ["—", "CAM 1 · SDI OUT 2", "PATCH A", "12G-SDI"],
    ]);
    fireEvent.click(body[0]);
    expect(onSelectSlot).toHaveBeenCalledWith(SLOTS[2]);
  });

  test("Bilan : U occupés, puissance face à la capacité des PDU, poids, BTU/h", () => {
    render(<RackBottomDock sources={SOURCES} onSelectSlot={() => {}} />);
    fireEvent.click(tab(/Bilan/));
    const card = screen.getByRole("group", { name: "Baie 1" });
    const [u, w] = within(card).getAllByRole("meter");
    expect(u).toHaveAccessibleName("U");
    expect(u).toHaveAttribute("aria-valuenow", "5");
    expect(u).toHaveAttribute("aria-valuemax", "42");
    expect(w).toHaveAccessibleName("W");
    expect(w).toHaveAttribute("aria-valuenow", "160");
    expect(w).toHaveAttribute("aria-valuemax", "1000");
    expect(within(card).getByText("11,5 kg · 546 BTU/h")).toBeInTheDocument();
    expect(within(card).getByText("5 ports · Vidéo 4 · Audio 1")).toBeInTheDocument();
  });

  test("Bilan sans capacité renseignée : puissance seule", () => {
    const data = { ...RACK, rack: { ...RACK.rack, maxPowerW: null } };
    render(<RackBottomDock sources={[{ data, slots: SLOTS, connections: CONNECTIONS }]} onSelectSlot={() => {}} />);
    fireEvent.click(tab(/Bilan/));
    const card = screen.getByRole("group", { name: "Baie 1" });
    expect(within(card).getAllByRole("meter")).toHaveLength(1);
    expect(within(card).getByText("160 W · capacité non renseignée")).toBeInTheDocument();
  });

  test("câbles en cours de lecture : attente, contenant sans câble : état vide", () => {
    const { rerender } = render(
      <RackBottomDock sources={[{ data: RACK, slots: SLOTS, connections: null }]} onSelectSlot={() => {}} />,
    );
    expect(screen.getByText("Chargement…")).toBeInTheDocument();
    rerender(<RackBottomDock sources={[{ data: RACK, slots: [], connections: [] }]} onSelectSlot={() => {}} />);
    expect(screen.getByText("Aucun problème")).toBeInTheDocument();
    fireEvent.click(tab(/Câbles/));
    expect(screen.getByText("Aucun câble")).toBeInTheDocument();
  });
});

const REPORT: ValidationReport = {
  issues: [
    {
      id: "iss-1",
      severity: "error",
      kind: "signal_mismatch",
      subject: "V-0204",
      message: "Signaux incompatibles",
      refs: { connectionIds: ["c9"] },
    },
  ],
  counts: { error: 1, warning: 0, info: 0 },
};

function Synoptic() {
  return (
    <InterfaceProvider value="strata">
      <WorkspaceProvider workspace="synoptic">
        <EditorShell globalTopbar={<div>topbar</div>} canvas={<div>canevas</div>} />
      </WorkspaceProvider>
    </InterfaceProvider>
  );
}

describe("dock bas du synoptique", () => {
  test("dans le synoptique, le dock lit validationReport du store", () => {
    const onSelect = vi.fn();
    useTopbarActions.getState().setValidationReport(REPORT);
    useTopbarActions.getState().setOnSelectValidationIssue(onSelect);
    render(<Synoptic />);
    const bottom = document.querySelector('[data-dock="bottom"]') as HTMLElement;
    expect(within(bottom).getByRole("tab", { name: /Contrôles/ })).toHaveAccessibleName("Contrôles 1 erreur, 0 avertissement");
    fireEvent.click(within(bottom).getByRole("button", { name: /V-0204/ }));
    expect(onSelect).toHaveBeenCalledWith(REPORT.issues[0]);
  });

  test("sans rapport publié (synoptique pas encore chargé) : pas de dock", () => {
    render(<Synoptic />);
    expect(document.querySelector('[data-dock="bottom"]')).toBeNull();
  });
});
