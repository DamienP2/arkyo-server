/**
 * Coquille « Concevoir » de l'interface Strata v2 (`StrataCanvasShell`, spec
 * v2 §4.1) : `EditorShell` dispose ses slots autour d'un canevas plein (outils
 * flottants, tiroir à droite, bandeau de validation). En Classique, le DOM
 * d'`EditorShell` est celui d'arkyo, au caractère près. Une bascule
 * Classique ↔ Strata ne remonte pas le canevas (Review Focus 1).
 */

import { useEffect, useState, type ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EditorShell, type EditorShellSlots } from "@/components/editor-shell/editor-shell";
import { WorkspaceProvider } from "@/components/editor-shell/workspace-context";
import { useWorkspaceActions } from "@/components/editor-shell/hooks/use-workspace";
import { useTopbarActions } from "@/components/editor-shell/topbar-actions-context";
import type { WorkspaceId } from "@/components/editor-shell/tool-registry";
import type { ValidationReport } from "@/lib/services/rack-validation";
import { InterfaceProvider, type UiInterface } from "@/strata/interface-context";
import { useStrataDrawer } from "@/strata/shell/canvas-shell";

afterEach(() => {
  useTopbarActions.getState().setValidationReport(null);
  useTopbarActions.getState().setOnSelectValidationIssue(undefined);
  delete document.documentElement.dataset.interface;
});

function Shell({
  iface,
  workspace = "design",
  ...slots
}: EditorShellSlots & { iface: UiInterface; workspace?: WorkspaceId }) {
  return (
    <MemoryRouter initialEntries={["/project/p1?tab=synoptique"]}>
      <InterfaceProvider value={iface}>
        <WorkspaceProvider workspace={workspace}>
          <EditorShell {...slots} />
        </WorkspaceProvider>
      </InterfaceProvider>
    </MemoryRouter>
  );
}

const slot = (label: string): ReactNode => <div>{label}</div>;

const SLOTS: EditorShellSlots = {
  globalTopbar: slot("topbar"),
  contextualTopbar: slot("contextuelle"),
  leftToolbar: slot("outils"),
  leftSidePanel: slot("panneau"),
  canvas: slot("canevas"),
  rightPanel: slot("inspecteur"),
  slideOver: slot("volet"),
  globalTopbarHeight: 44,
};

const zone = (name: string) => document.querySelector(`[data-zone="${name}"]`) as HTMLElement | null;

/** DOM d'`EditorShell` relevé sur `main` (avant toute accroche Strata), mêmes slots. */
const classicDom = (canvas = "<div>canevas</div>") =>
  '<div class="bg-background text-foreground fixed right-0 bottom-0 left-0 z-50 flex flex-col overflow-hidden" style="top: calc(var(--dev-banner-height) + var(--impersonation-banner-height, 0px));">' +
  '<div style="height: 44px;" class="border-border flex-none border-b"><div>topbar</div></div>' +
  '<div style="height: 44px;" class="border-border bg-card flex-none border-b"><div>contextuelle</div></div>' +
  '<div class="flex flex-1 overflow-hidden">' +
  '<div style="width: 48px;" class="border-border bg-card flex-none border-r"><div>outils</div></div>' +
  '<div style="width: 280px;" class="border-border bg-card flex-none border-r"><div>panneau</div></div>' +
  `<div class="relative flex-1 overflow-hidden">${canvas}</div>` +
  '<div style="width: 300px;" class="border-border bg-background flex-none border-l"><div>inspecteur</div></div>' +
  "</div></div>";

describe("EditorShell en Classique", () => {
  test("classique : EditorShell inchangé (DOM exact)", () => {
    const { container } = render(
      <Shell iface="classique" {...SLOTS} strata={{ drawerTop: slot("faces"), mode: "page" }} />,
    );
    // Le champ `strata` est ignoré.
    expect(container.innerHTML).toBe(classicDom());
  });

  test("classique : un panneau gauche qui apparaît se place avant le canevas", () => {
    const { container, rerender } = render(<Shell iface="classique" {...SLOTS} leftSidePanel={null} />);
    rerender(<Shell iface="classique" {...SLOTS} />);
    expect(container.innerHTML).toBe(classicDom());
    rerender(<Shell iface="classique" {...SLOTS} leftToolbar={null} leftSidePanel={null} />);
    rerender(<Shell iface="classique" {...SLOTS} />);
    expect(container.innerHTML).toBe(classicDom());
  });
});

describe("EditorShell en Classique (suite)", () => {
  test("classique : un panneau droit puis un volet qui apparaissent gardent l'ordre exact", () => {
    function OpenSlideOver() {
      const { openSlideOver } = useWorkspaceActions();
      return (
        <button type="button" onClick={() => openSlideOver("export")}>
          ouvrir
        </button>
      );
    }
    const canvas = <OpenSlideOver />;
    const html = '<button type="button">ouvrir</button>';
    const { container, rerender } = render(<Shell iface="classique" {...SLOTS} canvas={canvas} rightPanel={null} />);
    rerender(<Shell iface="classique" {...SLOTS} canvas={canvas} />);
    expect(container.innerHTML).toBe(classicDom(html));
    fireEvent.click(screen.getByRole("button", { name: "ouvrir" }));
    // Le volet s'ajoute en fin de rangée, après le panneau droit.
    expect(container.innerHTML).toBe(
      classicDom(html).slice(0, -"</div></div>".length) +
        '<div style="width: 480px;" class="border-border bg-card flex-none border-l shadow-xl"><div>volet</div></div>' +
        "</div></div>",
    );
  });
});

describe("StrataCanvasShell", () => {
  test("canevas plein, outils flottants, tiroir fermé par défaut", () => {
    render(<Shell iface="strata" {...SLOTS} strata={{ drawerTop: slot("faces") }} />);
    const shell = document.querySelector("[data-strata-canvas-shell]") as HTMLElement;
    // Même boîte fixe et même décalage haut qu'`EditorShell`.
    expect(shell.className).toMatch(/\bfixed\b/);
    expect(shell.style.top).toBe("calc(var(--dev-banner-height) + var(--impersonation-banner-height, 0px))");
    expect(within(zone("topbar")!).getByText("topbar")).toBeInTheDocument();

    // Canevas sur toute la surface.
    const canvas = zone("canvas")!;
    expect(canvas.className).toMatch(/\babsolute\b/);
    expect(canvas.className).toMatch(/\binset-0\b/);
    expect(within(canvas).getByText("canevas")).toBeInTheDocument();

    // Barre d'outils flottante, en haut au centre, avec le `leftToolbar` existant.
    const tools = zone("tools")!;
    expect(tools.className).toMatch(/\babsolute\b/);
    expect(within(tools).getByRole("toolbar", { name: "Outils" })).toHaveTextContent("outils");
    // Barre contextuelle repliée dans « Options de la vue ».
    const options = within(tools).getByRole("button", { name: "Options de la vue" });
    expect(options).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("contextuelle")).not.toBeVisible();
    fireEvent.click(options);
    expect(options).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("contextuelle")).toBeVisible();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByText("contextuelle")).not.toBeVisible();

    // Panneau latéral existant, flottant à gauche.
    expect(screen.getByRole("complementary", { name: "Panneau latéral" })).toHaveTextContent("panneau");

    // Tiroir fermé par défaut ; un bouton l'ouvre, la croix et Échap le ferment.
    const drawer = zone("drawer")!;
    expect(drawer).not.toBeVisible();
    expect(screen.getByText("inspecteur")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir l'inspecteur" }));
    expect(drawer).toBeVisible();
    expect(drawer).toBe(screen.getByRole("complementary", { name: "Inspecteur" }));
    // `strata.drawerTop` au-dessus du panneau existant.
    const faces = within(drawer).getByText("faces");
    expect(faces.compareDocumentPosition(within(drawer).getByText("inspecteur")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: "Fermer l'inspecteur" }));
    expect(drawer).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir l'inspecteur" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(drawer).not.toBeVisible();

    // Aucune colonne de la disposition Classique.
    expect(document.querySelector(".border-r.flex-none")).toBeNull();
  });

  test("useStrataDrawer : ouvre sur une nouvelle sélection, pas après une fermeture manuelle", () => {
    function Selection() {
      const drawer = useStrataDrawer();
      return (
        <>
          <button onClick={() => drawer.requestOpen("a")}>sélection A</button>
          <button onClick={() => drawer.requestOpen("b")}>sélection B</button>
          <button onClick={() => drawer.requestOpen(null)}>aucune sélection</button>
        </>
      );
    }
    render(<Shell iface="strata" globalTopbar={slot("topbar")} canvas={<Selection />} rightPanel={slot("inspecteur")} />);
    const drawer = zone("drawer")!;
    expect(drawer).not.toBeVisible();
    fireEvent.click(screen.getByText("sélection A"));
    expect(drawer).toBeVisible();
    fireEvent.click(within(drawer).getByRole("button", { name: "Fermer l'inspecteur" }));
    // Même sélection : le tiroir reste fermé.
    fireEvent.click(screen.getByText("sélection A"));
    expect(drawer).not.toBeVisible();
    // Nouvelle sélection : il s'ouvre.
    fireEvent.click(screen.getByText("sélection B"));
    expect(drawer).toBeVisible();
    fireEvent.keyDown(document.body, { key: "Escape" });
    // Désélection puis même objet : c'est une nouvelle sélection.
    fireEvent.click(screen.getByText("aucune sélection"));
    expect(drawer).not.toBeVisible();
    fireEvent.click(screen.getByText("sélection B"));
    expect(drawer).toBeVisible();
  });

  test("sans rightPanel ni drawerTop : pas de tiroir ; un slot null ne réserve rien", () => {
    render(<Shell iface="strata" globalTopbar={slot("topbar")} canvas={slot("canevas")} contextualTopbar={null} leftToolbar={null} />);
    expect(zone("drawer")).toBeNull();
    // Sans outils ni barre contextuelle, la barre flottante ne porte que le
    // sélecteur de mode de Concevoir (`?tab=synoptique`).
    const tools = zone("tools")!;
    expect(within(tools).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Mode : Synoptique"]);
    expect(within(tools).queryByRole("toolbar")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ouvrir l'inspecteur" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Panneau latéral" })).toBeNull();
  });

  test("mode page : outils et barre contextuelle dans une bande au-dessus du contenu", () => {
    render(<Shell iface="strata" {...SLOTS} strata={{ mode: "page" }} />);
    const strip = zone("tools")!;
    expect(strip.className).not.toMatch(/\babsolute\b/);
    expect(within(strip).getByRole("toolbar", { name: "Outils" })).toHaveTextContent("outils");
    expect(within(strip).getByText("contextuelle")).toBeVisible();
    // Le bouton du tiroir est dans la bande, pas sur le contenu.
    expect(within(strip).getByRole("button", { name: "Ouvrir l'inspecteur" })).toBeInTheDocument();
    expect(within(zone("canvas")!).getByText("canevas")).toBeInTheDocument();
    expect(strip.compareDocumentPosition(zone("canvas")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("?space=gerer : le canevas n'est pas monté (ni ses raccourcis), il l'est au retour dans Concevoir", () => {
    const shortcut = vi.fn();
    let mounts = 0;
    function Synoptic() {
      useEffect(() => {
        mounts += 1;
        // Comme `SynopticView` : ⌘Z, ⌘X… écoutés sur `window`.
        const onKey = (e: KeyboardEvent) => {
          if (e.metaKey) shortcut(e.key);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, []);
      return <div>synoptique</div>;
    }
    function Back() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/project/p1?tab=synoptique")}>
          Concevoir
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={["/project/p1?tab=synoptique&space=gerer"]}>
        <InterfaceProvider value="strata">
          <WorkspaceProvider workspace="synoptic">
            <EditorShell {...SLOTS} globalTopbar={<Back />} canvas={<Synoptic />} />
          </WorkspaceProvider>
        </InterfaceProvider>
      </MemoryRouter>,
    );
    expect(zone("manage")).not.toBeNull();
    expect(zone("canvas")).toBeNull();
    expect(zone("drawer")).toBeNull();
    expect(zone("tools")).toBeNull();
    expect(screen.queryByText("synoptique")).toBeNull();
    expect(mounts).toBe(0);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    fireEvent.keyDown(window, { key: "x", metaKey: true });
    expect(shortcut).not.toHaveBeenCalled();

    // Retour dans Concevoir : le canevas est monté, ses raccourcis répondent.
    fireEvent.click(screen.getByRole("button", { name: "Concevoir" }));
    expect(within(zone("canvas")!).getByText("synoptique")).toBeInTheDocument();
    expect(mounts).toBe(1);
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(shortcut).toHaveBeenCalledWith("z");
  });

  test("Échap ferme d'abord « Options de la vue », puis le tiroir", () => {
    render(<Shell iface="strata" {...SLOTS} />);
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir l'inspecteur" }));
    fireEvent.click(screen.getByRole("button", { name: "Options de la vue" }));
    expect(screen.getByText("contextuelle")).toBeVisible();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByText("contextuelle")).not.toBeVisible();
    expect(zone("drawer")).toBeVisible();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(zone("drawer")).not.toBeVisible();
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
    {
      id: "iss-2",
      severity: "error",
      kind: "missing_port",
      subject: "CAM 1",
      message: "Port introuvable",
      refs: { slotIds: ["s1"] },
    },
    {
      id: "iss-3",
      severity: "warning",
      kind: "unlabelled_cable",
      subject: "Câble 4",
      message: "Câble sans label",
      refs: { connectionIds: ["c4"] },
    },
  ],
  counts: { error: 2, warning: 1, info: 0 },
};

describe("bandeau de validation", () => {
  test("bandeau : compteurs du validationReport, clic → liste, clic ligne → onSelectValidationIssue", () => {
    const onSelect = vi.fn();
    useTopbarActions.getState().setValidationReport(REPORT);
    useTopbarActions.getState().setOnSelectValidationIssue(onSelect);
    render(<Shell iface="strata" workspace="synoptic" {...SLOTS} />);
    const banner = screen.getByRole("region", { name: "Validation" });
    expect(banner).toHaveTextContent("2 erreurs");
    expect(banner).toHaveTextContent("1 avertissement");
    // Liste des contrôles fermée par défaut.
    expect(screen.queryByRole("region", { name: "Contrôles" })).toBeNull();
    fireEvent.click(within(banner).getByRole("button", { name: "Voir les contrôles" }));
    const list = screen.getByRole("region", { name: "Contrôles" });
    // Liste du synoptique arkyo (groupes par contrôle).
    expect(within(list).getByText("Signal incompatible")).toBeInTheDocument();
    fireEvent.click(within(list).getByText("V-0204"));
    expect(onSelect).toHaveBeenCalledWith(REPORT.issues[0]);
    fireEvent.click(within(banner).getByRole("button", { name: "Masquer les contrôles" }));
    expect(screen.queryByRole("region", { name: "Contrôles" })).toBeNull();
  });

  test("rapport sans problème : « Conforme »", () => {
    useTopbarActions.getState().setValidationReport({ issues: [], counts: { error: 0, warning: 0, info: 0 } });
    render(<Shell iface="strata" workspace="synoptic" {...SLOTS} />);
    expect(screen.getByRole("region", { name: "Validation" })).toHaveTextContent("Conforme");
  });

  test("sans rapport publié, ou hors du synoptique : pas de bandeau", () => {
    const { unmount } = render(<Shell iface="strata" workspace="synoptic" {...SLOTS} />);
    expect(screen.queryByRole("region", { name: "Validation" })).toBeNull();
    unmount();
    useTopbarActions.getState().setValidationReport(REPORT);
    render(<Shell iface="strata" workspace="design" {...SLOTS} />);
    expect(screen.queryByRole("region", { name: "Validation" })).toBeNull();
  });
});

describe("bascule Classique ↔ Strata", () => {
  test("bascule-canvas-shell : le canevas n'est pas remonté, sa vue est conservée", () => {
    let mounts = 0;
    function Canvas() {
      const [zoom, setZoom] = useState(100);
      useEffect(() => {
        mounts += 1;
      }, []);
      return (
        <button type="button" onClick={() => setZoom((z) => z + 25)}>
          zoom {zoom}
        </button>
      );
    }
    const canvas = <Canvas />;
    const { container, rerender } = render(<Shell iface="classique" {...SLOTS} canvas={canvas} />);
    fireEvent.click(screen.getByRole("button", { name: "zoom 100" }));
    const view = screen.getByRole("button", { name: "zoom 125" });
    expect(container.innerHTML).toBe(classicDom('<button type="button">zoom 125</button>'));

    // Classique → Strata : même nœud, même état, dans le canevas plein.
    rerender(<Shell iface="strata" {...SLOTS} canvas={canvas} />);
    expect(document.querySelector("[data-strata-canvas-shell]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "zoom 125" })).toBe(view);
    expect(zone("canvas")!.contains(view)).toBe(true);
    fireEvent.click(view);
    expect(view).toHaveTextContent("zoom 150");

    // Strata → Classique : même chose, et le DOM d'arkyo au caractère près.
    rerender(<Shell iface="classique" {...SLOTS} canvas={canvas} />);
    expect(screen.getByRole("button", { name: "zoom 150" })).toBe(view);
    expect(container.innerHTML).toBe(classicDom('<button type="button">zoom 150</button>'));
    expect(mounts).toBe(1);
  });
});
