/**
 * Onglet Inventaire de l'éditeur projet, 3/3 (arkyo:app/(fullscreen)/project/
 * [id]/inventaire/_components/{rack-card-canvas, container-sheet-card,
 * slot-ruler, rack-mini-svg, item-properties-panel,
 * container-properties-panel, inventaire-export}.tsx, `_lib/bom-pdf.ts`,
 * `_components/export-menu.tsx`, `reseau/_components/shared/export-*.ts`,
 * `lib/print/technical-frame.ts`, `lib/export/*`) : lignes d'inventaire
 * éditables, panneaux de propriétés, transfert et retrait d'un item, export
 * PDF / CSV / XLSX de la liste du matériel.
 *
 * Les copies d'arkyo sont rendues par le chargeur réel (`/project/:id`).
 * L'export PDF passe par le jsPDF embarqué (décision 6) : aucune balise
 * `<script src>` n'est ajoutée, et la fermeture de l'inventaire ne contient
 * plus aucune URL de CDN.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as XLSX from "xlsx";
import {
  OWNER_PERMS,
  renderApp,
  resetApp,
  sentBody,
  signedInApi,
  type Api,
} from "@/tests/app-harness";
import { buildBomPdf } from "./[id]/inventaire/_lib/bom-pdf";
import { buildBomTable, DEFAULT_BOM_TABLE_OPTIONS } from "./[id]/inventaire/_lib/bom-table";
import type { InventaireRack } from "./[id]/inventaire/inventaire-client";

const HEADER = {
  id: "p1",
  name: "Finale Coupe de France",
  status: "EN_PREPARATION",
  interventionType: "PRESTATION",
  rigType: "CAR",
  clientName: "France TV",
  shootingDate: "2026-11-20T00:00:00.000Z",
  location: "Stade de France",
  prestationType: null,
};

/** Contenant de la route `editor` (`InventaireRack`). */
function rack(id: string, name: string, locationId: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    rigConfigId: "rc1",
    name,
    rackType: "STANDARD",
    totalU: 42,
    depthMm: 600,
    widthMm: null,
    heightMm: null,
    hasWheels: false,
    emptyWeightKg: null,
    slotsCount: 0,
    constructionChecks: 0,
    isRackable: true,
    hasConnectors: false,
    canvasX: null,
    canvasY: null,
    locationId,
    isVirtual: false,
    slots: [],
    bom: [],
    ...extra,
  };
}

/** Ligne d'inventaire (`InventaireBomItem` de la route `editor`, `items` du GET inventory). */
function grille(quantity: number) {
  return {
    id: "i1",
    kind: "equipment",
    refId: "eq1",
    quantity,
    name: "Grille vidéo",
    reference: "SW-12",
    brandName: "Blackmagic",
    category: "Vidéo",
    categoryColor: "#3b82f6",
    isRackable: true,
    heightU: 1,
    depthMm: 300,
    weightKg: 2,
    powerW: 30,
    snapshotId: null,
  };
}

/** La Régie : deux baies, la première contient la grille vidéo. */
function editor(qty: number) {
  return {
    header: HEADER,
    fiche: {
      ...HEADER,
      shootingEndDate: null,
      planningStart: null,
      planningEnd: null,
      commissioningDate: null,
      description: null,
      documents: [],
      counts: { tasks: 0, messages: 0, documents: 0 },
    },
    inventaire: {
      rigConfigId: "rc1",
      racks: [
        rack("r1", "Baie 1", "l1", { bom: [grille(qty)] }),
        rack("r2", "Baie 2", "l1"),
        rack("v1", "Régie", "l1", { isVirtual: true, isRackable: false, totalU: 0 }),
      ],
      locations: [{ id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: "v1" }],
    },
    cartographie: { maps: [] },
  };
}

const CATALOG = { equipments: [], panels: [], adapters: [] };

function editorApi(qty: number, extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A"),
    "GET /api/tenant/projects/p1/editor": { body: editor(qty) },
    "GET /api/tenant/projects/p1/inventaire/catalog": { body: CATALOG },
    "GET /api/tenant/espace/informations": { body: { name: "Régie A", logoUrl: null } },
    ...extra,
  };
}

/** Ouvre l'onglet Inventaire et attend la carte de la première baie. */
async function open(qty: number, extra: Api = {}) {
  const app = renderApp("/project/p1?tab=inventaire", editorApi(qty, extra));
  await screen.findByText("Finale Coupe de France", {}, { timeout: 5000 });
  await screen.findByText("Équipements libres");
  return app;
}

/** Carte pleine largeur d'un contenant (`ContainerSheetCard`, `data-rack-id`). */
function card(rackId: string): HTMLElement {
  return document.querySelector(`[data-rack-id="${rackId}"]`) as HTMLElement;
}

/** Ligne d'inventaire d'une carte (`BomRow`, draggable). */
function bomRow(rackId: string, name: string): HTMLElement {
  return within(card(rackId)).getByText(name).closest(".group\\/row") as HTMLElement;
}

/** Panneau droit (`InventaireRightPanel`, seule `aside` de la coquille). */
function rightPanel(): HTMLElement {
  return document.querySelector("aside") as HTMLElement;
}

/** Valeur d'une `InfoCard` du panneau droit. */
function info(label: string): HTMLElement | null {
  return within(rightPanel()).getByText(label).nextElementSibling as HTMLElement | null;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  resetApp();
  window.localStorage.clear();
});

describe("éditeur projet : inventaire 3/3", () => {
  test("item_properties_patch", async () => {
    let qty = 2;
    let rackName = "Baie 1";
    const { fetchSpy } = await open(qty, {
      "PATCH /api/tenant/projects/p1/racks/r1/inventory/i1": (init) => {
        qty = JSON.parse(String(init?.body)).quantity;
        return { body: { item: grille(qty) } };
      },
      "GET /api/tenant/projects/p1/racks/r1/inventory": () => ({ body: { items: [grille(qty)] } }),
      "PATCH /api/tenant/projects/p1/racks/r1": (init) => {
        rackName = JSON.parse(String(init?.body)).name;
        return { body: { rack: { id: "r1", name: rackName } } };
      },
    });

    // Carte de la baie : type, totaux (2 × 30 W, 2 × 2 kg, 2 U) et la ligne.
    const baie = card("r1");
    expect(within(baie).getByText('Baie standard 19" · 42U · 600mm')).toBeInTheDocument();
    expect(within(baie).getByText(/60 W · 4 kg · 2\/42U/)).toBeInTheDocument();
    expect(within(bomRow("r1", "Grille vidéo")).getByText("Blackmagic · SW-12")).toBeInTheDocument();

    // Clic sur la ligne : le panneau droit affiche les propriétés de l'item.
    fireEvent.click(bomRow("r1", "Grille vidéo"));
    await within(rightPanel()).findByText("Équipement · Vidéo");
    expect(info("Quantité")).toHaveTextContent("2");
    expect(info("Hauteur")).toHaveTextContent("1U");
    expect(info("Profondeur")).toHaveTextContent("300 mm");
    expect(info("Contenant")).toHaveTextContent("Baie 1");

    // Stepper de la ligne : PATCH de la quantité, puis relecture du BOM.
    fireEvent.click(within(bomRow("r1", "Grille vidéo")).getByTitle("Augmenter"));
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PATCH", "/api/tenant/projects/p1/racks/r1/inventory/i1")).toEqual({ quantity: 3 }),
    );
    await waitFor(() => expect(info("Quantité")).toHaveTextContent("3"));
    expect(within(card("r1")).getByText(/90 W · 6 kg · 3\/42U/)).toBeInTheDocument();

    // Fermer le panneau d'item, puis sélectionner la baie : panneau du contenant.
    fireEvent.click(within(rightPanel()).getByRole("button", { name: "Fermer" }));
    fireEvent.click(within(card("r1")).getByText("Baie 1"));
    const nameInput = await within(rightPanel()).findByDisplayValue("Baie 1");
    expect(info("Conso")).toHaveTextContent("90 W");
    expect(info("Poids")).toHaveTextContent("6 kg");
    fireEvent.change(nameInput, { target: { value: "baie a" } });
    fireEvent.blur(nameInput);
    await waitFor(() =>
      expect(sentBody(fetchSpy, "PATCH", "/api/tenant/projects/p1/racks/r1")).toEqual({ name: "BAIE A" }),
    );
    // Mise à jour optimiste : la carte suit.
    expect(within(card("r1")).getByText("BAIE A")).toBeInTheDocument();
  });

  test("transfer_and_delete_item", async () => {
    // Où se trouve la grille : r1, puis r2 après le transfert, puis nulle part.
    let where: "r1" | "r2" | null = "r1";
    const inventory = (rackId: string) => () => ({ body: { items: where === rackId ? [grille(1)] : [] } });
    const { fetchSpy } = await open(1, {
      "POST /api/tenant/projects/p1/racks/r1/inventory/i1/transfer": () => {
        where = "r2";
        return { body: { item: { ...grille(1) }, targetRackId: "r2" } };
      },
      "GET /api/tenant/projects/p1/racks/r1/inventory": inventory("r1"),
      "GET /api/tenant/projects/p1/racks/r2/inventory": inventory("r2"),
      "DELETE /api/tenant/projects/p1/racks/r2/inventory/i1": () => {
        where = null;
        return { body: { ok: true } };
      },
    });

    // Glisser la ligne sur la deuxième baie : le scope repère la carte sous le
    // curseur (`document.elementsFromPoint`) et transfère la ligne entière.
    const target = card("r2");
    const elementsFromPoint = vi.fn(() => [target]);
    Object.defineProperty(document, "elementsFromPoint", { value: elementsFromPoint, configurable: true });
    try {
      const row = bomRow("r1", "Grille vidéo");
      expect(row).toHaveClass("cursor-grab");
      fireEvent.pointerDown(row, { clientX: 10, clientY: 10, isPrimary: true, button: 0, pointerId: 1 });
      await act(async () => {
        fireEvent.pointerMove(document, { clientX: 300, clientY: 40, isPrimary: true, pointerId: 1 });
      });
      await act(async () => {
        fireEvent.pointerMove(document, { clientX: 320, clientY: 50, isPrimary: true, pointerId: 1 });
      });
      await act(async () => {
        fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1 });
      });
      await act(() => new Promise((r) => setTimeout(r, 60)));
    } finally {
      delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
    await waitFor(() =>
      expect(sentBody(fetchSpy, "POST", "/api/tenant/projects/p1/racks/r1/inventory/i1/transfer")).toEqual({
        targetRackId: "r2",
      }),
    );
    expect(await screen.findByText("« Grille vidéo » déplacé vers Baie 2.")).toBeInTheDocument();
    await waitFor(() => expect(within(card("r2")).getByText("Grille vidéo")).toBeInTheDocument());
    expect(within(card("r1")).queryByText("Grille vidéo")).toBeNull();

    // Retrait depuis le panneau de l'item : confirmation, DELETE, relecture.
    fireEvent.click(bomRow("r2", "Grille vidéo"));
    await within(rightPanel()).findByText("Équipement · Vidéo");
    expect(info("Contenant")).toHaveTextContent("Baie 2");
    fireEvent.click(within(rightPanel()).getByRole("button", { name: /Retirer du contenant/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Retirer « Grille vidéo » ?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer" }));
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([u, init]) =>
            String(u) === "/api/tenant/projects/p1/racks/r2/inventory/i1" && init?.method === "DELETE",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(within(card("r2")).queryByText("Grille vidéo")).toBeNull());
    // L'item a disparu : le panneau retombe sur son contenant.
    await waitFor(() => expect(within(rightPanel()).getByDisplayValue("Baie 2")).toBeInTheDocument());
    expect(within(rightPanel()).getByText("0/42 U")).toBeInTheDocument();
  });

  test("bom_export_builds_rows", async () => {
    // Téléchargements : on capture le blob et le nom de fichier.
    const downloads: { name: string; blob: Blob }[] = [];
    const blobs = new Map<string, Blob>();
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      const url = `blob:test/${blobs.size}`;
      blobs.set(url, b as Blob);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, blob: blobs.get(this.href)! });
    });

    await open(2);
    fireEvent.click(within(rightPanel()).getByTitle("Exporter"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Exporter l'inventaire")).toBeInTheDocument();

    // Excel : l'aperçu montre les DONNÉES (colonnes réelles, lignes groupées).
    fireEvent.click(within(dialog).getByRole("button", { name: "Excel" }));
    const table = await within(dialog).findByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).toEqual(["Type", "Désignation", "Marque", "Quantité", "Poids (kg)", "Conso (W)"]);
    expect(within(table).getByText("RÉGIE")).toBeInTheDocument();
    expect(within(table).getByText("Baie 1")).toBeInTheDocument();
    expect(within(table).getByText("Grille vidéo")).toBeInTheDocument();

    const stamp = new Date().toISOString().slice(0, 10);

    // CSV : séparateur `;`, BOM UTF-8, même modèle de tableau.
    fireEvent.click(within(dialog).getByRole("button", { name: "CSV" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Télécharger/ }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toBe(`Inventaire_Finale-Coupe-de-France_${stamp}.csv`);
    const csv = await downloads[0].blob.text();
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe('"Type";"Désignation";"Marque";"Quantité";"Poids (kg)";"Conso (W)"');
    expect(lines).toContain('"Équipement";"Grille vidéo";"Blackmagic";"2";"2";"30"');

    // XLSX : classeur réel (SheetJS embarqué), feuille « Matériel ».
    fireEvent.click(within(dialog).getByRole("button", { name: "XLSX" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Télécharger/ })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: /Télécharger/ }));
    await waitFor(() => expect(downloads).toHaveLength(2), { timeout: 5000 });
    expect(downloads[1].name).toBe(`Inventaire_Finale-Coupe-de-France_${stamp}.xlsx`);
    const wb = XLSX.read(new Uint8Array(await downloads[1].blob.arrayBuffer()), { type: "array" });
    expect(wb.SheetNames).toEqual(["Matériel"]);
    const sheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Matériel"]);
    expect(sheet.some((r) => r["Désignation"] === "Grille vidéo" && r["Quantité"] === 2)).toBe(true);
    expect(document.querySelectorAll("script[src]")).toHaveLength(0);
  });

  test("pdf_export_uses_bundled_jspdf", async () => {
    // Le PDF de la liste du matériel est construit avec le jsPDF embarqué.
    const racks = editor(2).inventaire.racks as unknown as InventaireRack[];
    const table = buildBomTable(racks, [{ id: "l1", name: "Régie" }], DEFAULT_BOM_TABLE_OPTIONS);
    const { blob, pageCount } = await buildBomPdf({
      table,
      title: "Inventaire",
      espace: { name: "Régie A", logoUrl: null },
      meta: { projectName: "Finale Coupe de France", location: "Stade de France" },
    });
    expect(blob.type).toBe("application/pdf");
    expect(pageCount).toBe(1);
    expect(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect(document.querySelectorAll("script[src]")).toHaveLength(0);

    // Aucune URL de CDN ni balise <script> injectée dans la fermeture
    // d'imports de l'inventaire et de ses exports.
    const SRC = resolve(__dirname, "../..");
    const project = resolve(__dirname, "[id]");
    const entries = [
      resolve(project, "inventaire/inventaire-client.tsx"),
      resolve(project, "inventaire/_components/item-properties-panel.tsx"),
      resolve(project, "inventaire/_components/container-properties-panel.tsx"),
      resolve(project, "inventaire/_components/inventaire-export.tsx"),
      resolve(project, "inventaire/_components/equipment-card.tsx"),
    ];
    const IMPORT = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
    const resolveSpec = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/") ? resolve(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
      if (!base) return null;
      for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const p = base + ext;
        if (existsSync(p) && !p.endsWith("/") && /\.(tsx?)$/.test(p)) return p;
      }
      return null;
    };
    const seen = new Set<string>();
    const stack = [...entries];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const m of readFileSync(f, "utf8").matchAll(IMPORT)) {
        const next = resolveSpec(f, m[1] ?? m[2]);
        if (next && !seen.has(next)) stack.push(next);
      }
    }
    expect(seen.size).toBeGreaterThan(15);
    // Commentaires en début de ligne seulement : un `/*` dans une chaîne
    // (`"https://cdn…/*"`) ne doit pas masquer une URL.
    const strip = (s: string) => s.replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "");
    const offenders = [...seen].filter((f) =>
      /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|cdn\.sheetjs\.com|createElement\(\s*["']script["']\s*\)/.test(
        strip(readFileSync(f, "utf8")),
      ),
    );
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});
