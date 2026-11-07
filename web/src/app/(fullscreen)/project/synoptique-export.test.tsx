/**
 * Exports de l'onglet Synoptique (arkyo:app/(fullscreen)/project/[id]/
 * _components/{project-view-export,export-live-page}.tsx, générateur poster
 * `exportPdf` de `components/synoptique/synoptic-view.tsx`, bibliothèques
 * `lib/pdf/{synoptic-vector,synoptic-cards}.ts` et
 * `lib/export/{synoptic-capture,svg-inline-styles}.ts`), montés par l'éditeur
 * réel (`/project/:id?tab=synoptique`) sur la vraie `SynopticView`.
 *
 * Le modal d'export partagé (`ExportMenu`) propose :
 * - **PDF** en mode poster (A0 → A4, paysage) : la colonne d'aperçu est la
 *   page vivante (`ExportLivePage`), une copie inerte du canvas ; le document
 *   est produit par le canvas sur la même copie et le même cadrage ;
 * - **Image** (PNG, JPG) : capture de la vue `[data-synoptic-capture]`.
 *
 * happy-dom ne rasterise ni SVG ni canvas : la capture html-to-image
 * (`captureElementToCanvas`) et la rasterisation du cartouche
 * (`svgStringToPngDataUrl`) sont remplacées par un PNG 1 × 1, comme pour les
 * exports de l'onglet Rack (`rack-export.test.tsx`). Tout le reste est réel :
 * la copie de la scène, le cartouche SVG, et le PDF du jsPDF embarqué.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { constants, inflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";

/** Premier montage : l'éditeur et la vue synoptique (≈ 14 000 l.) sont transformés à la demande. */
const FIRST_LOAD = { timeout: 15000 };

const raster = vi.hoisted(() => {
  const PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  return {
    PNG_B64,
    PNG_DATA_URL: `data:image/png;base64,${PNG_B64}`,
    /** Éléments capturés, leur texte au moment de la capture, et options. */
    captures: [] as { el: HTMLElement; text: string; opts: Record<string, unknown> }[],
    /** SVG rasterisés (cartouche intégré ou layout d'un modèle). */
    svgs: [] as string[],
  };
});

vi.mock("@/lib/export/synoptic-capture", async (orig) => ({
  ...(await orig<typeof import("@/lib/export/synoptic-capture")>()),
  captureElementToCanvas: vi.fn(async (el: HTMLElement, opts: Record<string, unknown> = {}) => {
    raster.captures.push({ el, text: el.textContent ?? "", opts });
    const bytes = Uint8Array.from(atob(raster.PNG_B64), (c) => c.charCodeAt(0));
    return {
      width: 4,
      height: 3,
      // Un navigateur rend un PNG pour un type qu'il ne sait pas encoder.
      toDataURL: () => raster.PNG_DATA_URL,
      toBlob: (cb: (b: Blob) => void) => cb(new Blob([bytes], { type: "image/png" })),
    } as unknown as HTMLCanvasElement;
  }),
}));

vi.mock("@/lib/print/render-print-layout", async (orig) => ({
  ...(await orig<typeof import("@/lib/print/render-print-layout")>()),
  svgStringToPngDataUrl: vi.fn(async (svg: string) => {
    raster.svgs.push(svg);
    return raster.PNG_DATA_URL;
  }),
}));

const NOW = "2026-11-07T10:00:00.000Z";

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
function rack(id: string, name: string, extra: Record<string, unknown> = {}) {
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
    locationId: "l1",
    isVirtual: false,
    slots: [],
    bom: [],
    ...extra,
  };
}

const EDITOR = {
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
    racks: [rack("r1", "Baie 1"), rack("v1", "Régie", { isVirtual: true, isRackable: false, totalU: 0 })],
    locations: [{ id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: "v1" }],
  },
  cartographie: { maps: [] },
};

const CONNECTOR_TYPES = [
  { id: "ct1", name: "BNC", version: null, iconId: "bnc", color: "#0ea5e9", category: "Vidéo", functions: [], functionId: null },
];
const SIGNALS = [
  { id: "sg1", name: "SDI", color: "#22c55e", cablePrefix: "V", cableSuffix: null, category: null, categoryRef: null },
];

function equipment(id: string, name: string, connectors: unknown[]) {
  return {
    id,
    name,
    reference: null,
    category: "Vidéo",
    heightU: 1,
    weight: 2,
    powerW: 50,
    depthMm: null,
    imageUrl: null,
    connectors,
    brand: { id: "b1", name: "Sony" },
  };
}
const out = (label: string) => ({ connectorTypeId: "ct1", quantity: 1, direction: "OUT", signalName: "SDI", label });
const inp = (label: string) => ({ connectorTypeId: "ct1", quantity: 1, direction: "IN", signalName: "SDI", label });

/** `RackSlot` (SLOT_COLS) + `equipment` / `components` / `panel` / `attachedAdapters` enrichis. */
function slotRow(id: string, startU: number, x: number, y: number, eq: ReturnType<typeof equipment>) {
  return {
    id,
    rackId: "r1",
    catalogEquipmentId: eq.id,
    snapshotId: null,
    panelId: null,
    parentSlotId: null,
    inventoryItemId: null,
    view: "FRONT",
    startU,
    heightU: 1,
    widthFraction: "FULL",
    column: 0,
    label: null,
    notes: null,
    patchNotes: null,
    panelLabels: null,
    synopticX: x,
    synopticY: y,
    createdAt: NOW,
    updatedAt: NOW,
    equipmentId: eq.id,
    equipment: eq,
    components: [],
    panel: null,
    attachedAdapters: [],
  };
}

/** Réponse de `GET /api/tenant/projects/:id/synoptic/location/:locationId` (synoptic_location.rs). */
const LOCATION = {
  location: { id: "l1", name: "Régie", cableCode: "REG", virtualRackId: "v1" },
  racks: [
    { id: "r1", name: "Baie 1", cableCode: null, cableId: 1, numberingOverride: null, isVirtual: false, totalU: 42, rackType: "STANDARD" },
    { id: "v1", name: "Régie", cableCode: null, cableId: 2, numberingOverride: null, isVirtual: true, totalU: 0, rackType: "STANDARD" },
  ],
  slots: [
    slotRow("s1", 1, 40, 40, equipment("eq1", "Caméra X", [out("SDI 1"), out("SDI 2")])),
    slotRow("s2", 2, 520, 40, equipment("eq2", "Moniteur", [inp("MON 1"), inp("MON 2")])),
  ],
  connections: [
    {
      id: "rc1",
      rackId: "r1",
      fromSlotId: "s1",
      fromConnectorIndex: 0,
      fromAdapterId: null,
      fromAdapterSide: null,
      fromAdapterPortIndex: null,
      fromComponentItemId: null,
      toSlotId: "s2",
      toConnectorIndex: 0,
      toAdapterId: null,
      toAdapterSide: null,
      toAdapterPortIndex: null,
      toComponentItemId: null,
      label: "V-001",
      color: "#22c55e",
      waypoints: null,
      cableStyle: null,
      notes: null,
      tags: null,
      catalogCableModelId: null,
      snapshotId: null,
      wired: false,
      wiredAt: null,
      wiredNotes: null,
      bundleId: null,
      createdAt: NOW,
    },
  ],
  projectConnections: [],
  zones: [],
  labels: [],
  adapters: [],
  externalPorts: [],
  panelRows: [],
  bundles: [],
  connectorTypes: CONNECTOR_TYPES,
  signals: SIGNALS,
  signalCategories: [],
  equipmentCategories: [{ id: "f1", name: "Vidéo", color: "#3b82f6", children: [] }],
  appConfig: {},
  project: { id: "p1", name: "Finale Coupe de France" },
};

/** Modèles de cartouche livrés avec le serveur (seed des Paramètres › Impression). */
const SEEDED_TEMPLATES = (
  JSON.parse(
    readFileSync(resolve(__dirname, "../../../../../crates/arkyo-server/seeds/print-templates.json"), "utf8"),
  ) as { tables: { table: string; rows: Record<string, unknown>[] }[] }
).tables.find((t) => t.table === "TenantPrintTemplate")!.rows;

const SITE = "Régie Mobile 4";

function api(extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, SITE),
    "GET /api/tenant/projects/p1/editor": { body: EDITOR },
    "GET /api/tenant/catalogue/adapters": { body: { arkyo: [], personal: [] } },
    "GET /api/tenant/projects/p1/synoptic/location/l1": { body: LOCATION },
    // Nom de l'espace = nom du site (phase 2).
    "GET /api/tenant/espace/informations": { body: { id: "site", name: SITE, logoUrl: null } },
    "GET /api/tenant/parametres/print": { body: { templates: SEEDED_TEMPLATES, settings: null } },
    ...extra,
  };
}

/** Téléchargements : nom de fichier et blob. */
function captureDownloads() {
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
  return downloads;
}

/** Ouvre l'onglet Synoptique sur le lieu « Régie », puis le modal d'export. */
async function openExport() {
  window.localStorage.setItem("project-p1-synoptique-rack", "loc:l1");
  // Dé-collision des îlots déjà faite (location-canvas) : aucune écriture de position au montage.
  window.localStorage.setItem("synoptic-loc-decollision:l1", "1");
  renderApp("/project/p1?tab=synoptique", api());
  await screen.findByText("Caméra X", {}, FIRST_LOAD);
  fireEvent.click(screen.getByTitle("Exporter"));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Exporter le synoptique")).toBeInTheDocument();
  return dialog;
}

/** Feuille de l'aperçu vivant : la copie inerte de la scène y est montée. */
function liveSheet(dialog: HTMLElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>("[data-synoptic-transform]");
}

/** Bouton « Télécharger » du modal, une fois actif. */
async function download(dialog: HTMLElement) {
  await waitFor(() => expect(within(dialog).getByRole("button", { name: /Télécharger/ })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole("button", { name: /Télécharger/ }));
}

/** Catégorie « Image » du modal (le rendu poster a aussi un bouton « Image »). */
function imageCategory(dialog: HTMLElement): HTMLElement {
  return within(dialog).getAllByRole("button", { name: "Image" })[0];
}

/** Texte d'un PDF, flux dégonflés compris (`JSPDF_BASE.compress`). */
async function pdfText(blob: Blob): Promise<string> {
  const bytes = Buffer.from(await blob.arrayBuffer());
  const raw = bytes.toString("latin1");
  let out = raw;
  const re = /stream\r?\n/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    try {
      out += inflateSync(bytes.subarray(start, end), { finishFlush: constants.Z_SYNC_FLUSH }).toString("latin1");
    } catch {
      /* flux non dégonflé */
    }
  }
  return out;
}

/** `web/src` (alias `@/`). */
const SRC = resolve(__dirname, "../../..");
/** Points d'entrée de l'export : l'onglet, le modal, et le générateur poster de la vue. */
const ENTRIES = [
  "app/(fullscreen)/project/[id]/synoptique/synoptique-tab-client.tsx",
  "app/(fullscreen)/project/[id]/_components/project-view-export.tsx",
  "components/synoptique/synoptic-view.tsx",
].map((f) => resolve(SRC, f));
/** Copies de la Task 13 (chemins sous `web/src`). */
const EXPORT_FILES = [
  "app/(fullscreen)/project/[id]/_components/project-view-export.tsx",
  "app/(fullscreen)/project/[id]/_components/export-live-page.tsx",
];
/** Source sans aucun commentaire (lignes, fin de ligne, blocs, JSX). */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Fermeture d'imports (`@/`, relatifs) d'un module. */
function importClosure(entries: string[]): Set<string> {
  const IMPORT = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  const resolveSpec = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? resolve(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const p = base + ext;
      if (existsSync(p) && /\.(tsx?)$/.test(p)) return p;
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
  return seen;
}

/** Commentaires retirés (en début de ligne seulement, cf. l'inventaire). */
const stripComments = (s: string) => s.replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => {
  window.localStorage.clear();
  raster.captures.length = 0;
  raster.svgs.length = 0;
});

afterEach(() => {
  resetApp();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("exports de l'onglet Synoptique", () => {
  test("synoptic_export_png_pdf_without_cdn", async () => {
    const downloads = captureDownloads();
    const dialog = await openExport();
    const stamp = new Date().toISOString().slice(0, 10);

    // Aperçu VIVANT : la copie inerte de la scène est montée dans la feuille,
    // le cartouche intégré (défaut « Intégré ») rasterisé par-dessus, et les
    // commandes de cadrage publiées dans la colonne de réglages.
    await waitFor(() => expect(liveSheet(dialog)).not.toBeNull(), FIRST_LOAD);
    await waitFor(() => expect(raster.svgs.length).toBeGreaterThan(0));
    const sheet = liveSheet(dialog)!.closest<HTMLElement>("[data-synoptic-capture]") ?? liveSheet(dialog)!;
    expect(sheet.textContent).toContain("Caméra X");
    expect(sheet.textContent).toContain("Moniteur");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Ajuster/ })).toBeEnabled());
    expect(within(dialog).getByRole("button", { name: /Centrer/ })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: /Ajuster/ }));

    // PDF poster (A1 paysage par défaut, rendu image) : le canvas produit le
    // document depuis une copie de la scène, capturée hors écran, et le jsPDF
    // embarqué l'assemble avec le calque du cartouche.
    fireEvent.click(within(dialog).getByRole("button", { name: "PDF" }));
    await download(dialog);
    await waitFor(() => expect(downloads).toHaveLength(1), { timeout: 5000 });
    expect(downloads[0].name).toBe(`Synoptique_Finale-Coupe-de-France_${stamp}.pdf`);
    const pdf = downloads[0].blob;
    expect(new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    const text = await pdfText(pdf);
    // A1 paysage : 841 × 594 mm.
    expect(text).toMatch(/\/MediaBox \[0 0 2383\.9\d* 1683\.7\d*\]/);
    // Le plan et le calque du cartouche en images.
    expect(text.match(/\/I\w* Do\b/g)?.length).toBeGreaterThanOrEqual(2);
    const poster = raster.captures.at(-1)!;
    expect(poster.el.querySelector("[data-synoptic-transform]")).not.toBeNull();
    expect(poster.el.isConnected).toBe(false);
    expect(poster.text).toContain("Caméra X");
    expect(poster.opts).toMatchObject({ background: "#ffffff" });

    // Image PNG : capture de la vue affichée, chrome d'édition masqué.
    fireEvent.click(imageCategory(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: "PNG" }));
    await download(dialog);
    await waitFor(() => expect(downloads).toHaveLength(2), { timeout: 5000 });
    expect(downloads[1].name).toBe(`Synoptique_Finale-Coupe-de-France_${stamp}.png`);
    expect(downloads[1].blob.type).toBe("image/png");
    const shot = raster.captures.at(-1)!;
    expect(shot.el).toBe(document.querySelector("[data-synoptic-capture]"));
    expect(shot.opts).toMatchObject({ pixelRatio: 2, background: "#ffffff" });
    expect(shot.opts.hideSelectors).toEqual(expect.arrayContaining(["[data-synoptic-grid]", "[data-minimap]"]));

    // Image JPG.
    fireEvent.click(within(dialog).getByRole("button", { name: "JPG" }));
    await download(dialog);
    await waitFor(() => expect(downloads).toHaveLength(3), { timeout: 5000 });
    expect(downloads[2].name).toBe(`Synoptique_Finale-Coupe-de-France_${stamp}.jpg`);

    // Aucune balise <script> ajoutée par les exports (ni le préchauffage de
    // svg2pdf à l'ouverture du modal, ni jsPDF, ni html-to-image).
    expect(document.querySelectorAll("script[src]")).toHaveLength(0);

    // Aucune URL de CDN ni balise <script> dans la fermeture de l'export Synoptique.
    const closure = importClosure(ENTRIES);
    for (const f of [
      ...EXPORT_FILES,
      "app/(fullscreen)/project/[id]/_components/export-menu.tsx",
      "app/(fullscreen)/project/[id]/_components/pending-export-store.ts",
      "lib/pdf/synoptic-vector.ts",
      "lib/pdf/synoptic-cards.ts",
      "lib/pdf/synoptic-export.ts",
      "lib/pdf/load-jspdf.ts",
      "lib/export/synoptic-capture.ts",
      "lib/export/svg-inline-styles.ts",
      "lib/print/export-with-cartouche.ts",
      "lib/print/render-print-layout.ts",
      "lib/print/technical-frame.ts",
    ]) {
      expect(closure.has(resolve(SRC, f)), f).toBe(true);
    }
    const offenders = [...closure].filter((f) =>
      /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|cdn\.sheetjs\.com|createElement\(\s*["']script["']\s*\)/.test(
        stripComments(readFileSync(f, "utf8")),
      ),
    );
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  test("no_arkyo_brand_text_in_synoptic_export", async () => {
    const downloads = captureDownloads();
    const dialog = await openExport();
    const stamp = new Date().toISOString().slice(0, 10);

    // Cartouche intégré : nom du site (en-tête et pied), lieu affiché et
    // nature du document, aucune marque Arkyo.
    await waitFor(() => expect(raster.svgs.length).toBeGreaterThan(0));
    const standard = raster.svgs.at(-1)!;
    expect(standard).toContain(SITE.toUpperCase());
    expect(standard).toContain("Finale Coupe de France");
    expect(standard).toMatch(/Régie|RÉGIE/);
    expect(standard).not.toMatch(/arkyo/i);
    // Aperçu vivant (copie de la scène) et colonne de réglages : aucun texte de marque.
    await waitFor(() => expect(liveSheet(dialog)).not.toBeNull(), FIRST_LOAD);
    expect(dialog.textContent).toContain("Caméra X");
    expect(dialog.textContent).not.toMatch(/arkyo/i);

    // PDF poster, cartouche intégré, rendu image : sans marque.
    fireEvent.click(within(dialog).getByRole("button", { name: "PDF" }));
    await download(dialog);
    await waitFor(() => expect(downloads).toHaveLength(1), { timeout: 5000 });
    expect(await pdfText(downloads[0].blob)).not.toMatch(/arkyo/i);
    expect(raster.svgs.at(-1)).not.toMatch(/arkyo/i);
    expect(raster.captures.at(-1)!.text).not.toMatch(/arkyo/i);

    // Rendu vectoriel : le calque du cartouche part en objets (svg2pdf
    // embarqué) ; sans marque non plus, quel que soit le rendu obtenu.
    fireEvent.click(within(dialog).getByRole("button", { name: "Vectoriel" }));
    await download(dialog);
    await waitFor(() => expect(downloads).toHaveLength(2), { timeout: 10000 });
    expect(downloads[1].name).toBe(`Synoptique_Finale-Coupe-de-France_${stamp}.pdf`);
    const vector = await pdfText(downloads[1].blob);
    // Rendu vectoriel effectif (pas de repli image) : les cartes
    // d'équipement et le cartouche sont du texte du PDF.
    expect(vector).toContain("(Cam");
    expect(vector).toContain("Finale Coupe de France");
    expect(vector).not.toMatch(/arkyo/i);
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Image" })[1]);

    // Modèles de l'espace livrés : leur layout rasterisé ne porte aucune marque.
    for (const name of ["Compact", "Détaillé"]) {
      const before = raster.svgs.length;
      fireEvent.click(within(dialog).getByRole("button", { name }));
      await waitFor(() => expect(raster.svgs.length).toBeGreaterThan(before));
      expect(raster.svgs.at(-1)).not.toMatch(/arkyo/i);
    }
    let before = raster.svgs.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Standard" }));
    await waitFor(() => expect(raster.svgs.length).toBeGreaterThan(before));
    // Modèle « Standard » de l'espace : projet et nature du document.
    expect(raster.svgs.at(-1)).toContain(">Finale Coupe de France<");
    expect(raster.svgs.at(-1)).toContain(">Synoptique<");
    expect(raster.svgs.at(-1)).not.toMatch(/arkyo/i);
    await download(dialog);
    await waitFor(() => expect(downloads).toHaveLength(3), { timeout: 5000 });
    expect(await pdfText(downloads[2].blob)).not.toMatch(/arkyo/i);
    expect(raster.svgs.at(-1)).not.toMatch(/arkyo/i);

    // Modèle sans layout (« Vide ») : chrome de secours dessiné par jsPDF.
    fireEvent.click(within(dialog).getByRole("button", { name: "Vide" }));
    await download(dialog);
    await waitFor(() => expect(downloads).toHaveLength(4), { timeout: 5000 });
    const blank = await pdfText(downloads[3].blob);
    expect(blank).toContain("(VIDE) Tj");
    expect(blank).not.toMatch(/arkyo/i);

    // Retour au cartouche intégré : image PNG sans marque non plus.
    before = raster.svgs.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Intégré" }));
    await waitFor(() => expect(raster.svgs.length).toBeGreaterThan(before));
    expect(raster.svgs.at(-1)).not.toMatch(/arkyo/i);
    fireEvent.click(imageCategory(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: "PNG" }));
    await download(dialog);
    await waitFor(() => expect(downloads).toHaveLength(5), { timeout: 5000 });
    expect(raster.captures.at(-1)!.text).not.toMatch(/arkyo/i);

    // Fermeture : le seul dessin de marque des captures partagées (le
    // monogramme et « Strata Arkyo » de l'en-tête des PDF Réseau,
    // `captureToPdf`, phase 5) n'est pas atteignable depuis l'export Synoptique.
    const closure = importClosure(ENTRIES);
    const shared = resolve(SRC, "app/(fullscreen)/project/[id]/reseau/_components/shared/export-capture.ts");
    expect(closure.has(shared)).toBe(true);
    const fromShared = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*reseau\/_components\/shared\/export-capture["']/g;
    const used = new Set<string>();
    for (const f of closure) {
      if (f === shared) continue;
      for (const m of stripComments(readFileSync(f, "utf8")).matchAll(fromShared)) {
        for (const name of m[1].split(",")) if (name.trim()) used.add(name.trim().replace(/^type\s+/, ""));
      }
    }
    expect([...used].sort()).toEqual(["captureWithFlatten", "loadJsPDF"]);
    const sharedSrc = readFileSync(shared, "utf8");
    for (const fn of ["captureWithFlatten", "loadJsPDF"]) {
      const start = sharedSrc.search(new RegExp(`export (async )?function ${fn}\\b`));
      const body = sharedSrc.slice(start, sharedSrc.indexOf("\n}\n", start));
      expect(body).not.toMatch(/arkyo(Logo|Monogram)|doc\.text\(/i);
    }

    // Copies de la Task 13 : dans la fermeture, et aucun texte de marque hors
    // commentaires (les `// arkyo-server:` sont des commentaires).
    for (const f of EXPORT_FILES) {
      expect(closure.has(resolve(SRC, f))).toBe(true);
      expect(codeOnly(readFileSync(resolve(SRC, f), "utf8"))).not.toMatch(/arkyo/i);
    }
  });
});
