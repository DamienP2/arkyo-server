/**
 * Dessins techniques (interface Strata) : face d'équipement à l'échelle
 * dessinée depuis la connectique du catalogue, ports reliés, libellés.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ConnectorEntry } from "@/app/(app)/admin/equipment/[id]/_editor/types";
import { EquipmentFace, type FaceEquipment } from "./equipment-face";
import { BlockDiagram } from "./block-diagram";
import { CableDrawing } from "./cable-drawing";
import { AdapterDrawing } from "./adapter-drawing";
import { RackElevation } from "./rack-elevation";
import { Gauge } from "./gauge";

// `ConnectorIcon` charge les surcharges de symboles une fois : réponse vide.
beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })));
});
afterAll(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CONNECTOR_TYPES = [
  { id: "ct-bnc", name: "BNC", iconId: "bnc" },
  { id: "ct-rj45", name: "RJ45", iconId: "rj45" },
  { id: "ct-iec", name: "IEC C14", iconId: "iec13" },
];
const SIGNALS = [
  { name: "12G-SDI", color: "#3654ff" },
  { name: "Ethernet 1G", color: "#10b981" },
  { name: "Secteur 230 V", color: "#6b7280", isPower: true },
];

function entry(p: Partial<ConnectorEntry>): ConnectorEntry {
  return {
    id: "c",
    face: "REAR",
    connectorTypeId: "ct-bnc",
    signalName: "12G-SDI",
    quantity: 1,
    label: "SDI IN",
    direction: "IN",
    gender: "FEMALE",
    ...p,
  };
}

const VIDEOHUB: FaceEquipment = {
  name: "Videohub 40×40 12G",
  brand: "Blackmagic Design",
  heightU: 2,
  isRackable: true,
  dims: [482, 300, 89],
  connectors: [
    entry({ quantity: 40, label: "SDI IN" }),
    entry({ quantity: 40, label: "SDI OUT", direction: "OUT" }),
    entry({ connectorTypeId: "ct-rj45", label: "ETHERNET", signalName: "Ethernet 1G", direction: "BOTH" }),
    entry({ face: "FRONT", connectorTypeId: "ct-rj45", label: "LAN", signalName: "Ethernet 1G", direction: "BOTH" }),
    entry({ connectorTypeId: "ct-iec", label: "AC", signalName: "Secteur 230 V", gender: "MALE" }),
  ],
};

const face = (props: Partial<Parameters<typeof EquipmentFace>[0]> = {}) =>
  render(
    <EquipmentFace
      equipment={VIDEOHUB}
      face="REAR"
      connectorTypes={CONNECTOR_TYPES}
      signals={SIGNALS}
      {...props}
    />,
  );

describe("EquipmentFace", () => {
  test("dessine un port par connecteur de la face, groupés par entrée", () => {
    const { container } = face();
    expect(screen.getByRole("img", { name: "Face arrière Videohub 40×40 12G" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-port]")).toHaveLength(40 + 40 + 1 + 1);
    expect(container.querySelectorAll("[data-entry]")).toHaveLength(4);
    expect(container.querySelector('[data-port="3:1"]')).toBeNull();
    expect(screen.getByText("SDI IN 1–40")).toBeInTheDocument();
    expect(screen.getByText("ARRIÈRE")).toBeInTheDocument();
  });

  test("EquipmentFace sans connectique rend une façade neutre", () => {
    const loose: FaceEquipment = { ...VIDEOHUB, isRackable: false, connectors: [], dims: [210, 150, 44] };
    const { container } = face({ equipment: loose });
    expect(container.querySelectorAll("[data-port]")).toHaveLength(0);
    expect(screen.getByText("Pose libre · 210 × 150 × 44 mm")).toBeInTheDocument();

    cleanup();
    const rackable = render(<EquipmentFace equipment={{ ...VIDEOHUB, connectors: [] }} face="FRONT" />);
    expect(rackable.container.querySelectorAll("[data-port]")).toHaveLength(0);
    expect(screen.queryByText(/Pose libre/)).toBeNull();
  });

  test("port relié marqué", () => {
    const onPortClick = vi.fn();
    const { container } = face({ links: { "0:1": "V-0101" }, onPortClick, selectedPort: "0:2" });
    const linked = container.querySelector('[data-port="0:1"]');
    expect(linked).toHaveAttribute("data-linked");
    expect(container.querySelector('[data-port="0:3"]')).not.toHaveAttribute("data-linked");
    expect(container.querySelector('[data-port="0:2"]')).toHaveAttribute("data-selected");
    fireEvent.click(linked!);
    expect(onPortClick).toHaveBeenCalledWith("0:1");
  });

  test("title du port", () => {
    const { container } = face({ links: { "0:1": "V-0101" } });
    const title = (key: string) => container.querySelector(`[data-port="${key}"] > title`)?.textContent;
    expect(title("0:3")).toBe("SDI IN 3 · BNC F · 12G-SDI · entrée · libre");
    expect(title("0:1")).toBe("SDI IN 1 · BNC F · 12G-SDI · entrée · V-0101");
    expect(title("1:7")).toBe("SDI OUT 7 · BNC F · 12G-SDI · sortie · libre");
    expect(title("2:1")).toBe("ETHERNET · RJ45 F · Ethernet 1G · E/S · libre");
    expect(title("4:1")).toBe("AC · IEC C14 M · Secteur 230 V · entrée · libre");

    cleanup();
    const noGender = { ...entry({ label: "REF" }), gender: undefined } as unknown as ConnectorEntry;
    const r = render(
      <EquipmentFace equipment={{ ...VIDEOHUB, connectors: [noGender] }} face="REAR" connectorTypes={CONNECTOR_TYPES} />,
    );
    expect(r.container.querySelector('[data-port="0:1"] > title')?.textContent).toBe(
      "REF · BNC N · 12G-SDI · entrée · libre",
    );
  });

  test("pictogramme téléversé (iconId = URL) rendu en <image> SVG", () => {
    const { container } = render(
      <EquipmentFace
        equipment={{ ...VIDEOHUB, connectors: [entry({ connectorTypeId: "ct-custom", quantity: 2 })] }}
        face="REAR"
        connectorTypes={[{ id: "ct-custom", name: "Multi 37", iconId: "/uploads/symbols/multi37.svg" }]}
      />,
    );
    const img = container.querySelector('[data-port="0:2"] image');
    expect(img).toHaveAttribute("href", "/uploads/symbols/multi37.svg");
    expect(container.querySelectorAll("[data-port] image")).toHaveLength(2);
    expect(container.querySelector("[data-port] img")).toBeNull();
  });

  test("survol d'une entrée signalé à l'appelant", () => {
    const onEntryHover = vi.fn();
    const { container } = face({ onEntryHover, hoverEntry: 1 });
    expect(container.querySelector('[data-entry="1"]')).toHaveAttribute("data-hover");
    fireEvent.mouseEnter(container.querySelector('[data-entry="0"]')!);
    expect(onEntryHover).toHaveBeenLastCalledWith(0);
    fireEvent.mouseLeave(container.querySelector('[data-entry="0"]')!);
    expect(onEntryHover).toHaveBeenLastCalledWith(null);
  });
});

describe("autres dessins", () => {
  test("BlockDiagram : entrées à gauche, sorties à droite, E/S dessous, énergie au-dessus", () => {
    const { container } = render(
      <BlockDiagram
        connectors={VIDEOHUB.connectors}
        connectorTypes={CONNECTOR_TYPES}
        signals={SIGNALS}
        name="Videohub 40×40 12G"
        brand="Blackmagic Design"
      />,
    );
    expect(screen.getByRole("img", { name: "Schéma de principe Videohub 40×40 12G" })).toBeInTheDocument();
    const side = (ei: number) => container.querySelector(`[data-entry="${ei}"]`)?.getAttribute("data-side");
    expect([0, 1, 2, 3, 4].map(side)).toEqual(["in", "out", "both", "both", "power"]);
    expect(screen.getByText("ENTRÉES / SORTIES")).toBeInTheDocument();
  });

  test("CableDrawing et AdapterDrawing : connecteurs et genres M/F/N", () => {
    render(
      <CableDrawing
        cable={{
          name: "Cordon BNC 12G",
          left: { connectorName: "BNC", iconId: "bnc", gender: "MALE" },
          right: { connectorName: "DIN 1.0/2.3", iconId: "din102", gender: "NEUTRAL" },
          color: "#3654ff",
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "Cordon BNC 12G" })).toBeInTheDocument();
    expect(screen.getByText("BNC M")).toBeInTheDocument();
    expect(screen.getByText("DIN 1.0/2.3 N")).toBeInTheDocument();

    render(
      <AdapterDrawing
        adapter={{
          name: "Éclateur XLR",
          inputs: [{ connectorName: "D-Sub 25", iconId: "dsub", gender: "FEMALE" }],
          outputs: [{ connectorName: "XLR 3", iconId: "xlr3", gender: "MALE", quantity: 8 }],
          powered: true,
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "Éclateur XLR" })).toBeInTheDocument();
    expect(screen.getByText("D-Sub 25 F")).toBeInTheDocument();
    expect(screen.getByText("XLR 3 M ×8")).toBeInTheDocument();
    expect(screen.getByText("alimenté")).toBeInTheDocument();
  });

  test("RackElevation : repères nommés, U libres, sélection", () => {
    const onSlotClick = vi.fn();
    const { container } = render(
      <RackElevation
        units={12}
        face="REAR"
        labels
        connectorTypes={CONNECTOR_TYPES}
        signals={SIGNALS}
        selectedSlotId="s1"
        onSlotClick={onSlotClick}
        slots={[
          { id: "s1", startU: 10, heightU: 2, label: "GRI-01", name: "Videohub 40×40 12G", equipment: VIDEOHUB },
          { id: "s2", startU: 1, heightU: 1, label: "PAT-01", name: "Panel BNC 16", status: "warning" },
        ]}
      />,
    );
    expect(screen.getByText("GRI-01")).toBeInTheDocument();
    // Plaque neutre (sans équipement du catalogue) et repère : le nom deux fois.
    expect(screen.getAllByText("Panel BNC 16")).toHaveLength(2);
    expect(container.querySelector('[data-slot="s2"] [data-status="warning"]')).not.toBeNull();
    // 12 U, 3 occupés : 9 U libres, numérotés sur les deux montants.
    expect(container.querySelectorAll("[data-u]")).toHaveLength(9);
    expect(container.querySelector('[data-u="10"]')).toBeNull();
    expect(screen.getAllByText("12")).toHaveLength(2);
    expect(container.querySelector('[data-slot="s1"]')).toHaveAttribute("data-selected");
    // La face arrière de l'équipement est dessinée dans le rack.
    expect(container.querySelectorAll('[data-slot="s1"] [data-port]')).toHaveLength(82);
    fireEvent.click(container.querySelector('[data-slot="s2"]')!);
    expect(onSlotClick).toHaveBeenCalledWith("s2");

    cleanup();
    const side = render(
      <RackElevation
        units={12}
        face="SIDE"
        labels={false}
        depthMm={800}
        slots={[{ id: "s1", startU: 10, heightU: 2, label: "GRI-01", name: "Videohub", depthMm: 300 }]}
      />,
    );
    expect(screen.getByText("GRI-01 · 300 mm")).toBeInTheDocument();
    expect(screen.getByText(/Profondeur utile 800 mm/)).toBeInTheDocument();
    expect(side.container.querySelectorAll("[data-callout]")).toHaveLength(0);
  });
});

test("Gauge : valeur, maximum, ton danger au-delà de 90 %", () => {
  render(<Gauge value={39} max={42} unit="U" />);
  expect(screen.getByText("39 / 42 U")).toBeInTheDocument();
  const bar = screen.getByRole("meter", { name: "U" }).firstElementChild as HTMLElement;
  expect(bar.style.width).toBe("92.9%");
  expect(bar.style.background).toBe("var(--danger)");
});

describe("variables --strata-face-*", () => {
  // Les faces sont un rendu du matériel : sombres dans les deux thèmes.
  const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (selector: string) => {
    const out: Record<string, string> = {};
    const re = new RegExp(`^${selector.replace(".", "\\.")} \\{([\\s\\S]*?)^\\}`, "gm");
    for (const m of css.matchAll(re)) for (const d of m[1].matchAll(/(--strata-face-[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
    return out;
  };
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const f = (s: number) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  test("mêmes valeurs en clair et en sombre, encres lisibles sur le châssis", () => {
    const light = block(":root");
    const dark = block(".dark");
    expect(Object.keys(light).sort()).toEqual(
      ["accent", "bg", "ink", "ink-2", "ink-3", "line", "well"].map((k) => `--strata-face-${k}`),
    );
    expect(dark).toEqual(light);
    for (const ink of ["--strata-face-ink", "--strata-face-ink-2", "--strata-face-ink-3"]) {
      expect(ratio(light[ink], light["--strata-face-bg"])).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(light["--strata-face-accent"], light["--strata-face-bg"])).toBeGreaterThanOrEqual(4.5);
  });
});
