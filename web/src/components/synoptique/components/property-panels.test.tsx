/**
 * arkyo-server: phase 4c (Task 9) : composants du synoptique 1/2.
 *
 * `property_panels_render_with_real_data` : les 9 panneaux de propriétés
 * copiés d'arkyo se montent avec des données réelles (les formes que
 * `synoptic-view` leur passe), sans erreur en console. S'y ajoutent les
 * requêtes, une par type d'objet :
 * - équipement : le panneau envoie lui-même `PATCH /api/racks/:id/slots/:slotId`
 *   avec `{ label }` (champ de `updateSchema`, rack_slots.rs) ;
 * - câble : le picker de modèle appelle `GET /api/tenant/parametres/cable-models?signalName=`
 *   (parametres/cabling.rs) ;
 * - zone, label, adaptateur, connexion externe, câbles : les panneaux passent
 *   par la poignée de `synoptic-view`. On fige ici les patchs émis, dont les
 *   valeurs doivent rester dans les schémas Rust (rack_objects*.rs,
 *   rack_connections.rs : borderStyle solid|dashed|dotted, borderWidth 0..6,
 *   textDecoration none|underline, pillRadius 0..64, kind INTER_LIEU|MONDE…).
 * Plus les dialogues, la barre d'étiquette, le picker de couleur de zone, les
 * toasts, la bulle d'incompatibilité et l'aide au tracé.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AdapterSelectionDetails,
  CableSelectionDetails,
  CableSummary,
  ExternalPortSelectionDetails,
  ExternalPortSummary,
  LabelSelectionDetails,
  NodeSelectionDetails,
  ZoneSelectionDetails,
} from "@/components/synoptique/synoptic-view";
import type { CanvasLabel, Zone } from "@/components/synoptique/types/synoptic";
import { SynopticAdapterPropertiesPanel } from "./synoptic-adapter-properties-panel";
import { SynopticCablePropertiesPanel } from "./synoptic-cable-properties-panel";
import { SynopticExternalPortPropertiesPanel } from "./synoptic-external-properties-panel";
import { SynopticLabelPropertiesPanel } from "./synoptic-label-properties-panel";
import { SynopticMultiCablePropertiesPanel } from "./synoptic-multi-cable-properties-panel";
import { SynopticMultiExternalPropertiesPanel } from "./synoptic-multi-external-properties-panel";
import { SynopticMultiNodePropertiesPanel } from "./synoptic-multi-node-properties-panel";
import { SynopticNodePropertiesPanel } from "./synoptic-node-properties-panel";
import { SynopticZonePropertiesPanel } from "./synoptic-zone-properties-panel";
import { SynopticLabelToolbar } from "./synoptic-label-toolbar";
import { SynopticLabelInput } from "./synoptic-label-input";
import { SynopticZoneColorPicker } from "./synoptic-zone-color-picker";
import { SynopticIncompatTooltip } from "./synoptic-incompat-tooltip";
import { SynopticDrawingHint } from "./synoptic-drawing-hint";
import { SynopticToasts } from "./synoptic-toasts";
import { SynopticEmptyInfoDialog } from "./synoptic-empty-info-dialog";
import { SynopticDecableDialog } from "./synoptic-decable-dialog";
import { SynopticClearLabelsDialog } from "./synoptic-clear-labels-dialog";

const CABLE_MODELS = {
  models: [
    {
      id: "tcm-1",
      name: "Belden 1694A",
      reference: "1694A",
      impedance: 75,
      bandwidthMHz: 4500,
      diameterMm: 6.9,
      function: { id: "f1", label: "Vidéo", color: "#2563eb" },
      brand: { id: "b1", name: "Belden", logoUrl: null },
      compatibility: "match",
    },
    {
      id: "tcm-2",
      name: "RG59",
      reference: null,
      impedance: 75,
      bandwidthMHz: 1000,
      diameterMm: null,
      function: null,
      brand: null,
      compatibility: "warn",
    },
  ],
  leftConnector: null,
  rightConnector: null,
};

let fetchMock: ReturnType<typeof vi.fn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/tenant/parametres/cable-models")) {
      return new Response(JSON.stringify(CABLE_MODELS), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function expectNoConsoleError() {
  expect(consoleError).not.toHaveBeenCalled();
}

// ── Données réelles (formes construites par synoptic-view) ──────────────────

const NODE: NodeSelectionDetails = {
  slotId: "slot-atem",
  label: "MIX-1",
  equipmentName: "ATEM 2 M/E Constellation HD",
  panelName: null,
  brandName: "Blackmagic Design",
  reference: "SWATEMCON2ME",
  category: "Vidéo",
  heightU: 2,
  widthFraction: "FULL",
  powerW: 150,
  weightKg: 4.2,
  depthMm: 320,
  imageUrl: null,
  notes: null,
  view: "FRONT",
  startU: 10,
  connectors: [
    { name: "BNC", color: "#2563eb", count: 20, signalName: "3G-SDI", direction: "IN" },
    { name: "BNC", color: "#2563eb", count: 12, signalName: "3G-SDI", direction: "OUT" },
    { name: "RJ45", color: "#16a34a", count: 1, signalName: "Ethernet", direction: "BIDIR" },
  ],
};

const CABLE: CableSelectionDetails = {
  id: "conn-1",
  label: "V-001",
  color: "#2563eb",
  signalName: "3G-SDI",
  cableStyle: "ortho",
  notes: null,
  tags: [],
  from: {
    slotName: "MIX-1",
    portLabel: "PGM 1",
    portNum: 1,
    connectorLabel: "SDI Out 1",
    direction: "OUT",
    adapterHop: null,
  },
  to: {
    slotName: "MON-1",
    portLabel: null,
    portNum: 3,
    connectorLabel: null,
    direction: "IN",
    adapterHop: { adapterName: "Barrel BNC", adapterPortNum: 2 },
  },
  estimatedLengthM: 2.5,
  catalogCableModelId: "tcm-1",
};

const ADAPTER: AdapterSelectionDetails = {
  id: "ad-1",
  name: "Splitter SDI 1→2",
  label: "SPL-1",
  attachedSlotName: "MIX-1",
  attachedPortNum: 4,
  attachedPortLabel: null,
  attachedConnectorLabel: "SDI Out 4",
  connectors: [
    { connectorTypeName: "BNC", connectorColor: "#2563eb", quantity: 1, direction: "IN" },
    { connectorTypeName: "BNC", connectorColor: "#2563eb", quantity: 2, direction: "OUT" },
  ],
  reference: "SPL-12",
  attachedSide: "right",
};

const EXTERNAL: ExternalPortSelectionDetails = {
  id: "ext-1",
  kind: "INTER_LIEU",
  label: "V-010",
  worldLabel: null,
  color: "#2563eb",
  signalName: "3G-SDI",
  notes: null,
  connectorTypeName: "BNC",
  from: {
    slotName: "MIX-1",
    portLabel: null,
    portNum: 7,
    connectorLabel: "SDI Out 7",
    direction: "OUT",
  },
  targetLabel: "Régie A · Rack 2",
};

const ZONE: ZoneSelectionDetails = {
  id: "zone-1",
  label: "Plateau",
  labelPosition: "top-left",
  color: "#6366f1",
  borderRadius: 8,
  borderWidth: 2,
  borderStyle: "solid",
  opacity: 0.12,
  labelFontSize: 12,
  labelFontWeight: "normal",
  labelFontStyle: "normal",
  labelTextDecoration: "none",
  labelFontFamily: null,
};

const LABEL: LabelSelectionDetails = {
  id: "lbl-1",
  text: "Entrées caméras",
  color: "#111827",
  fontWeight: "normal",
  fontSize: 14,
  fontFamily: null,
  fontStyle: "normal",
  textDecoration: "none",
  pill: true,
  pillBg: "#fde68a",
  pillRadius: 12,
};

const CABLE_SUMMARIES: CableSummary[] = [
  { id: "conn-1", label: "V-001", color: "#2563eb", signalName: "3G-SDI", catalogCableModelId: "tcm-1", cableStyle: null },
  { id: "conn-2", label: null, color: "#2563eb", signalName: "3G-SDI", catalogCableModelId: null, cableStyle: "rounded" },
];

const EXTERNAL_SUMMARIES: ExternalPortSummary[] = [
  { id: "ext-1", label: "V-010", color: "#2563eb", signalName: "3G-SDI", targetLabel: "Régie A" },
  { id: "ext-2", label: null, color: "#16a34a", signalName: null, targetLabel: "Patch" },
];

const CANVAS_LABEL: CanvasLabel = {
  id: "lbl-1",
  text: "Entrées caméras",
  x: 200,
  y: 120,
  fontSize: 14,
  color: "#111827",
  fontWeight: "normal",
};

const CANVAS_ZONE: Zone = {
  id: "zone-1",
  x: 100,
  y: 80,
  w: 400,
  h: 240,
  label: "Plateau",
  color: "#6366f1",
  labelPosition: "top-left",
};

// ── Test de fumée ───────────────────────────────────────────────────────────

describe("property_panels_render_with_real_data", () => {
  test("équipement : identité, connecteurs, cartes d'info et numérotation", () => {
    const onStart = vi.fn();
    const onAfter = vi.fn();
    render(
      <SynopticNodePropertiesPanel
        node={NODE}
        rackId="rack-1"
        catColorMap={{ Vidéo: "#2563eb" }}
        connections={[
          { id: "conn-1", fromSlotId: "slot-atem", toSlotId: "slot-mon" },
          { id: "conn-9", fromSlotId: "slot-x", toSlotId: "slot-y" },
        ]}
        onStartManualNumberForCables={onStart}
        onAfterStartManualNumber={onAfter}
      />,
    );
    expect(screen.getByText("Équipement")).toBeInTheDocument();
    expect(screen.getByDisplayValue("MIX-1")).toBeInTheDocument();
    expect(screen.getByText("Blackmagic Design · ATEM 2 M/E Constellation HD")).toBeInTheDocument();
    expect(screen.getByText("Connecteurs (33)")).toBeInTheDocument();
    expect(screen.getByText("10U – 11U")).toBeInTheDocument();
    expect(screen.getByText("4.2 kg")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Numérotation de cet équipement"));
    expect(onStart).toHaveBeenCalledWith(["conn-1"]);
    expect(onAfter).toHaveBeenCalledOnce();
    expectNoConsoleError();
  });

  test("câble : parcours, style, modèle chargé et actions", async () => {
    const onSetStyle = vi.fn();
    const onClear = vi.fn();
    render(
      <SynopticCablePropertiesPanel
        cable={CABLE}
        onSetStyle={onSetStyle}
        onStartManualNumber={vi.fn()}
        onClearLabel={onClear}
        onDelete={vi.fn()}
        onSetCableModel={vi.fn()}
      />,
    );
    expect(screen.getByText("V-001")).toBeInTheDocument();
    expect(screen.getByText("SDI Out 1")).toBeInTheDocument();
    expect(screen.getByText("→ Barrel BNC Port 2")).toBeInTheDocument();
    expect(screen.getByText("2.5 m")).toBeInTheDocument();
    // Le picker charge les modèles dès qu'une valeur est posée et affiche le libellé.
    expect(await screen.findByText("Belden 1694A")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Arrondi"));
    expect(onSetStyle).toHaveBeenCalledWith(["conn-1"], "rounded");
    fireEvent.click(screen.getByText("Effacer le numéro"));
    expect(onClear).toHaveBeenCalledWith("conn-1");
    expectNoConsoleError();
  });

  test("adaptateur : libellé, schéma et rattachement", () => {
    render(<SynopticAdapterPropertiesPanel adapter={ADAPTER} onUpdateLabel={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByDisplayValue("SPL-1")).toBeInTheDocument();
    expect(screen.getByText("Splitter SDI 1→2")).toBeInTheDocument();
    expect(screen.getByText("Attaché à")).toBeInTheDocument();
    expect(screen.getByText("SDI Out 4")).toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
    expectNoConsoleError();
  });

  test("connexion externe : type, parcours et cible", () => {
    render(
      <SynopticExternalPortPropertiesPanel
        external={EXTERNAL}
        onDelete={vi.fn()}
        onSetKind={vi.fn()}
        onSetWorldLabel={vi.fn()}
      />,
    );
    expect(screen.getByText("Connexion externe")).toBeInTheDocument();
    expect(screen.getByText("Inter-emplacements")).toBeInTheDocument();
    expect(screen.getByText("Régie A · Rack 2")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Feed diffuseur, antenne…")).toBeNull();
    expectNoConsoleError();
  });

  test("zone : titre, position, couleur, contours, transparence", () => {
    render(<SynopticZonePropertiesPanel zone={ZONE} onUpdate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByDisplayValue("Plateau")).toBeInTheDocument();
    expect(screen.getByText("↖ Haut-G")).toBeInTheDocument();
    expect(screen.getByText("0.12")).toBeInTheDocument();
    expect(screen.getByText("Supprimer la zone")).toBeInTheDocument();
    expectNoConsoleError();
  });

  test("label : texte, style, taille et pillule", () => {
    render(<SynopticLabelPropertiesPanel label={LABEL} onUpdate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByDisplayValue("Entrées caméras")).toBeInTheDocument();
    expect(screen.getByText("14px")).toBeInTheDocument();
    expect(screen.getByText("Fond")).toBeInTheDocument();
    expect(screen.getByText("12px")).toBeInTheDocument();
    expectNoConsoleError();
  });

  test("multi-câbles : compteur, liste, styles mixtes, modèle", async () => {
    render(
      <SynopticMultiCablePropertiesPanel
        summaries={CABLE_SUMMARIES}
        onSetStyle={vi.fn()}
        onStartManualNumberForIds={vi.fn()}
        onClearLabelsForIds={vi.fn()}
        onDeleteForIds={vi.fn()}
        onSetCableModelForIds={vi.fn()}
      />,
    );
    expect(screen.getByText("2 câbles")).toBeInTheDocument();
    expect(screen.getByText("3G-SDI")).toBeInTheDocument();
    expect(screen.getByText("Styles mixtes — choisir applique à tous.")).toBeInTheDocument();
    expect(screen.getByText("Valeurs mixtes — choisir applique à tous.")).toBeInTheDocument();
    await act(async () => {});
    expectNoConsoleError();
  });

  test("multi-externes : compteur et liste", () => {
    render(
      <SynopticMultiExternalPropertiesPanel
        summaries={EXTERNAL_SUMMARIES}
        onClearLabelsForIds={vi.fn()}
        onDeleteForIds={vi.fn()}
      />,
    );
    expect(screen.getByText("2 connexions externes")).toBeInTheDocument();
    expect(screen.getByText("Patch")).toBeInTheDocument();
    expectNoConsoleError();
  });

  test("multi-équipements : compteurs", () => {
    render(<SynopticMultiNodePropertiesPanel nodeCount={3} rackCount={1} />);
    expect(screen.getByText("3 équipements")).toBeInTheDocument();
    expect(screen.getByText("Contenants")).toBeInTheDocument();
    expectNoConsoleError();
  });
});

// ── Requêtes, une par type d'objet ──────────────────────────────────────────

describe("requêtes des panneaux", () => {
  test("équipement : PATCH /api/racks/:id/slots/:slotId avec { label }", async () => {
    render(
      <SynopticNodePropertiesPanel
        node={NODE}
        rackId="rack-1"
        catColorMap={{}}
        connections={[]}
        onStartManualNumberForCables={vi.fn()}
        onAfterStartManualNumber={vi.fn()}
      />,
    );
    const input = screen.getByDisplayValue("MIX-1");
    fireEvent.change(input, { target: { value: "mix-2" } });
    fireEvent.blur(input);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/racks/rack-1/slots/slot-atem");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ label: "MIX-2" });
    expect(new Headers(init.headers).get("X-Client-Id")).toBeTruthy();
  });

  test("câble : le picker lit /api/tenant/parametres/cable-models filtré par signal", async () => {
    const onSetCableModel = vi.fn();
    render(
      <SynopticCablePropertiesPanel
        cable={{ ...CABLE, catalogCableModelId: null }}
        onSetStyle={vi.fn()}
        onStartManualNumber={vi.fn()}
        onClearLabel={vi.fn()}
        onDelete={vi.fn()}
        onSetCableModel={onSetCableModel}
      />,
    );
    fireEvent.click(screen.getByText("Aucun câble assigné…"));
    expect(await screen.findByText("RG59")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/tenant/parametres/cable-models?signalName=3G-SDI");
    expect(screen.getByText("Compatible")).toBeInTheDocument();
    expect(screen.getByText("Bande passante limite")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Belden 1694A"));
    expect(onSetCableModel).toHaveBeenCalledWith("conn-1", "tcm-1");
  });

  test("câbles : le style est appliqué à toute la sélection", () => {
    const onSetStyle = vi.fn();
    render(
      <SynopticMultiCablePropertiesPanel
        summaries={[CABLE_SUMMARIES[0], { ...CABLE_SUMMARIES[1], signalName: "Ethernet" }]}
        onSetStyle={onSetStyle}
        onStartManualNumberForIds={vi.fn()}
        onClearLabelsForIds={vi.fn()}
        onDeleteForIds={vi.fn()}
        onSetCableModelForIds={vi.fn()}
      />,
    );
    // Signaux hétérogènes : pas de picker de modèle, donc aucun fetch.
    expect(screen.queryByText("Modèle du câble")).toBeNull();
    fireEvent.click(screen.getByText("Flèches"));
    expect(onSetStyle).toHaveBeenCalledWith(["conn-1", "conn-2"], "arrow");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("zone : patchs dans le schéma de PATCH /racks/:id/zones/:zoneId", () => {
    const onUpdate = vi.fn();
    render(<SynopticZonePropertiesPanel zone={ZONE} onUpdate={onUpdate} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText("↘ Bas-D"));
    fireEvent.click(screen.getByText("Tirets"));
    fireEvent.click(screen.getByText("U"));
    const [border, opacity] = [screen.getAllByRole("slider")[1], screen.getAllByRole("slider")[2]];
    fireEvent.change(border, { target: { value: "6" } });
    fireEvent.change(opacity, { target: { value: "0.35" } });
    expect(onUpdate.mock.calls).toEqual([
      ["zone-1", { labelPosition: "bottom-right" }],
      ["zone-1", { borderStyle: "dashed" }],
      ["zone-1", { labelTextDecoration: "underline" }],
      ["zone-1", { borderWidth: 6 }],
      ["zone-1", { opacity: 0.35 }],
    ]);
  });

  test("label : patchs dans le schéma de PATCH /racks/:id/labels/:labelId", () => {
    const onUpdate = vi.fn();
    render(<SynopticLabelPropertiesPanel label={LABEL} onUpdate={onUpdate} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText("I"));
    fireEvent.click(screen.getByText("U"));
    fireEvent.click(screen.getByText("48"));
    const radius = screen.getAllByRole("slider")[1];
    fireEvent.change(radius, { target: { value: "32" } });
    expect(onUpdate.mock.calls).toEqual([
      ["lbl-1", { fontStyle: "italic" }],
      ["lbl-1", { textDecoration: "underline" }],
      ["lbl-1", { fontSize: 48 }],
      ["lbl-1", { pillRadius: 32 }],
    ]);
  });

  test("adaptateur : libellé en majuscules, null si vide (PATCH /racks/:id/adapters/:adapterId)", () => {
    const onUpdateLabel = vi.fn();
    render(<SynopticAdapterPropertiesPanel adapter={ADAPTER} onUpdateLabel={onUpdateLabel} onDelete={vi.fn()} />);
    const input = screen.getByDisplayValue("SPL-1");
    fireEvent.change(input, { target: { value: "spl-2 " } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);
    expect(onUpdateLabel.mock.calls).toEqual([
      ["ad-1", "SPL-2"],
      ["ad-1", null],
    ]);
  });

  test("connexion externe : kind MONDE puis étiquette libre (PATCH /racks/:id/external-ports/:portId)", () => {
    const onSetKind = vi.fn();
    const onSetWorldLabel = vi.fn();
    const { rerender } = render(
      <SynopticExternalPortPropertiesPanel
        external={EXTERNAL}
        onDelete={vi.fn()}
        onSetKind={onSetKind}
        onSetWorldLabel={onSetWorldLabel}
      />,
    );
    fireEvent.click(screen.getByText("Lien externe"));
    expect(onSetKind).toHaveBeenCalledWith("ext-1", "MONDE");
    rerender(
      <SynopticExternalPortPropertiesPanel
        external={{ ...EXTERNAL, kind: "MONDE" }}
        onDelete={vi.fn()}
        onSetKind={onSetKind}
        onSetWorldLabel={onSetWorldLabel}
      />,
    );
    expect(screen.getByText("Hors projet")).toBeInTheDocument();
    const input = screen.getByPlaceholderText("Feed diffuseur, antenne…");
    fireEvent.change(input, { target: { value: " Feed TF1 " } });
    fireEvent.blur(input);
    expect(onSetWorldLabel).toHaveBeenCalledWith("ext-1", "Feed TF1");
  });
});

// ── Composants de canvas et dialogues ───────────────────────────────────────

describe("composants de canvas et dialogues", () => {
  test("barre d'étiquette, saisie et picker de couleur de zone", () => {
    const onColor = vi.fn();
    const onZoneColor = vi.fn();
    const onConfirm = vi.fn();
    render(
      <div>
        <SynopticLabelToolbar
          selectedLabelId="lbl-1"
          canvasLabels={[CANVAS_LABEL]}
          pan={{ x: 0, y: 0 }}
          zoom={1}
          onColorChange={onColor}
          onBoldToggle={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
        <SynopticZoneColorPicker
          selectedZoneId="zone-1"
          zones={[CANVAS_ZONE]}
          pan={{ x: 0, y: 0 }}
          zoom={1}
          onColorChange={onZoneColor}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
        <SynopticLabelInput
          labelEditing={{ mode: "edit", labelId: "lbl-1" }}
          canvasLabels={[CANVAS_LABEL]}
          viewRef={{ current: { pan: { x: 0, y: 0 }, zoom: 1 } }}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />
      </div>,
    );
    // Barre d'étiquette puis picker de zone : les deux palettes ont le rouge.
    const [labelRed, zoneRed] = screen.getAllByLabelText("Appliquer la couleur #ef4444");
    fireEvent.click(labelRed);
    fireEvent.click(zoneRed);
    expect(onColor).toHaveBeenCalledWith("lbl-1", "#ef4444");
    expect(onZoneColor).toHaveBeenCalledWith("zone-1", "#ef4444");
    expect(screen.getAllByText("Supprimer")).toHaveLength(2);
    // Le placeholder d'arkyo est écrit `"Libellé…"` dans un attribut
    // JSX, où les échappements ne sont pas interprétés : on cible la valeur.
    const input = screen.getByDisplayValue("Entrées caméras");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledWith("lbl-1", "Entrées caméras");
    expectNoConsoleError();
  });

  test("toasts, bulle d'incompatibilité et aide au tracé", () => {
    render(
      <div>
        <SynopticToasts
          toasts={[
            { id: 1, lines: ["Câble créé"], type: "success" },
            { id: 2, lines: ["Échec mise à jour de la zone — rechargement"], type: "error" },
          ]}
        />
        <SynopticIncompatTooltip
          incompatTooltip={{ msg: "Entrée → entrée · Signal différent — connexion possible quand même", x: 10, y: 10 }}
          multiHoverTooltip={null}
        />
        <SynopticDrawingHint
          drawingFrom={{ slotId: "slot-atem", portIndex: 0 }}
          multiSrcPorts={null}
          multiSrcConfirmed={false}
          cableCount="single"
          cableMode="auto"
        />
      </div>,
    );
    expect(screen.getByText("Câble créé")).toBeInTheDocument();
    expect(screen.getByText("Connexion non recommandée")).toBeInTheDocument();
    expect(screen.getByText("Signal différent")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
    expectNoConsoleError();
  });

  test("dialogues : information, décâblage et suppression de la numérotation", () => {
    const onClose = vi.fn();
    const onDecable = vi.fn();
    const onClear = vi.fn();
    render(
      <div>
        <SynopticEmptyInfoDialog open title="Rien à numéroter" message="Aucun câble dans ce rack." onClose={onClose} />
        <SynopticDecableDialog open connectionCount={12} onConfirm={onDecable} onCancel={vi.fn()} />
        <SynopticClearLabelsDialog open onConfirm={onClear} onCancel={vi.fn()} />
      </div>,
    );
    expect(screen.getByText("Rien à numéroter")).toBeInTheDocument();
    expect(screen.getByText("12 câbles")).toBeInTheDocument();
    fireEvent.click(screen.getByText("OK"));
    fireEvent.click(screen.getByText("Décâbler"));
    fireEvent.click(screen.getByText("Supprimer"));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onDecable).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
    expectNoConsoleError();
  });

  test("dialogues fermés : rien n'est rendu", () => {
    const { container } = render(
      <div>
        <SynopticEmptyInfoDialog open={false} title="x" message="y" onClose={vi.fn()} />
        <SynopticDecableDialog open={false} connectionCount={1} onConfirm={vi.fn()} onCancel={vi.fn()} />
        <SynopticClearLabelsDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />
      </div>,
    );
    expect(container.innerHTML).toBe("<div></div>");
    expect(document.body.querySelector(".fixed")).toBeNull();
  });
});
