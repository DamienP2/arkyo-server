/**
 * Exports de l'onglet Rack, 1/2 (arkyo:app/(fullscreen)/project/[id]/rack/
 * _components/rack-export{,-layout,-capture,-stage}.ts(x),
 * `_components/export-{cartouche,pdf-model}-options.tsx`,
 * `lib/print/{export-with-cartouche,render-print-layout}.ts`,
 * `lib/pdf/synoptic-export.ts`) : PDF et image de la planche d'élévations,
 * cartouche intégré ou modèle de l'espace.
 *
 * Exports 2/2 (Task 8) : le composeur de mise en page (`rack-export-composer`)
 * et la section VUES (`rack-export-{views,object}-panel`) sont les copies
 * d'arkyo. La composition part de l'amorçage (contenant affiché par l'onglet),
 * se construit depuis la colonne de réglages, et les nœuds de capture sont
 * ceux que rend le composeur.
 *
 * happy-dom ne fait pas de mise en page : `offsetWidth/Height` valent 0. Ils
 * sont donc fixés pour les nœuds posés sur la feuille (`[data-rack-page]`),
 * ce qui donne au composeur sa mesure du rendu et à la capture sa taille
 * naturelle.
 *
 * happy-dom ne rasterise ni SVG ni canvas : la capture html-to-image
 * (`captureElementToCanvas`) et la rasterisation du cartouche
 * (`svgStringToPngDataUrl`) sont remplacées par un PNG 1 × 1. Tout le reste
 * est réel : la composition, le cartouche SVG, et le PDF du jsPDF embarqué
 * (décision 6, `lib/pdf/bundled-libs.test.ts` pour les bibliothèques).
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { constants, inflateSync } from "node:zlib";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OWNER_PERMS, renderApp, resetApp, signedInApi, type Api } from "@/tests/app-harness";
import { standardComposerZone } from "@/app/(fullscreen)/project/[id]/rack/_components/rack-export-composer";

const FIRST_LOAD = { timeout: 15000 };

const raster = vi.hoisted(() => {
  const PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  return {
    PNG_B64,
    PNG_DATA_URL: `data:image/png;base64,${PNG_B64}`,
    /** Éléments capturés et options de capture. */
    captures: [] as { el: HTMLElement; opts: Record<string, unknown> }[],
    /** SVG rasterisés (cartouche intégré ou layout d'un modèle). */
    svgs: [] as string[],
  };
});

vi.mock("@/lib/export/synoptic-capture", async (orig) => ({
  ...(await orig<typeof import("@/lib/export/synoptic-capture")>()),
  captureElementToCanvas: vi.fn(async (el: HTMLElement, opts: Record<string, unknown> = {}) => {
    raster.captures.push({ el, opts });
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

type FakeCanvasProps = { rack: { id: string; name: string } };

vi.mock("@/app/(fullscreen)/project/[id]/rack/_components/rack-placement-canvas", () => ({
  RackDragOverlayContent: () => null,
  RackPlacementCanvas: forwardRef<unknown, FakeCanvasProps>(function FakeCanvas(props, ref) {
    useImperativeHandle(ref, () => ({
      rackId: props.rack.id,
      ownsSlot: () => false,
      handleDragStart: () => {},
      handleDragOver: () => {},
      handleDragEnd: async () => {},
      cancelDrag: () => {},
      notifyShelfOnlyMiss: () => false,
      clearSelection: () => {},
      fitAll: () => {},
      centerContent: () => {},
      zoomIn: () => {},
      zoomOut: () => {},
    }));
    return <div data-testid="rack-canvas" data-rack={props.rack.id} />;
  }),
}));

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

function rack(id: string, name: string) {
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
    racks: [rack("r1", "Baie 1"), { ...rack("v1", "Plateau"), isVirtual: true, isRackable: false, totalU: 0 }],
    locations: [{ id: "l1", name: "Plateau", cableCode: "PLT", sortOrder: 0, virtualRackId: "v1" }],
  },
  cartographie: { maps: [] },
};

const CANVAS_DATA = {
  rack: { id: "r1", name: "Baie 1", totalU: 42, depthMm: 600, rackType: "STANDARD", rearInteriorGapMm: null, rigs: [], slots: [] },
  allEquipment: [],
  rackAccessories: [],
  allPanels: [],
  categories: [],
  connectorTypes: [],
  signals: [],
  signalCategories: [],
  patchPanelDepthMm: 100,
  cableSafetyDepthMm: 100,
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
    "GET /api/tenant/projects/p1/racks/r1/canvas-data": { body: CANVAS_DATA },
    "GET /api/tenant/projects/p1/racks/r1/inventory": { body: { items: [] } },
    // Nom de l'espace = nom du site (phase 2).
    "GET /api/tenant/espace/informations": { body: { id: "site", name: SITE, logoUrl: null } },
    "GET /api/tenant/parametres/print": { body: { templates: SEEDED_TEMPLATES, settings: null } },
    ...extra,
  };
}

const LAYOUT_KEY = "export:rack:p1:layout";

/**
 * Composition mémorisée d'une session précédente : la face avant de Baie 1.
 *
 * Sans elle, la première ouverture part d'une feuille vide. C'est la parité
 * arkyo : l'amorçage (`seed`) pose bien le contenant, mais l'effet « la
 * composition suit la feuille » estampille, dans le même commit, la
 * composition d'avant l'amorçage, et sa publication l'écrase. À partir de la
 * deuxième ouverture (feuille déjà estampillée), l'amorçage tient.
 */
const RESTORED = { items: [{ id: "o1", kind: "rack", rackId: "r1", views: ["FRONT"], x: 20, y: 20, w: 60 }] };
const restoreLayout = () => window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(RESTORED));

/** Composition mémorisée par le modal (réglage par projet, comme dans arkyo). */
function storedLayout(): { items: Array<Record<string, unknown> & { id: string; kind: string }> } | null {
  const raw = window.localStorage.getItem(LAYOUT_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** Nœuds de capture rendus par le composeur sur la feuille. */
function captureNodes(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-rack-page] [data-rack-view-capture]")];
}

/** Taille de mise en page des nœuds posés sur la feuille (happy-dom n'en calcule aucune). */
function layoutSizes() {
  const onPage = (el: HTMLElement) => !!el.closest?.("[data-rack-page]");
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return onPage(this) ? 400 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return onPage(this) ? 300 : 0;
  });
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

/** Ouvre l'onglet Rack puis le modal d'export. */
async function openExport() {
  renderApp("/project/p1?tab=rack", api());
  await screen.findByTestId("rack-canvas", {}, FIRST_LOAD);
  fireEvent.click(within(document.querySelector("aside") as HTMLElement).getByTitle("Exporter"));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Exporter les élévations")).toBeInTheDocument();
  return dialog;
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
const RACK_EXPORT = resolve(__dirname, "[id]/rack/_components/rack-export.tsx");
/** Copies de la Task 8 (chemins sous `web/src`). */
const COMPOSER_FILES = [
  "app/(fullscreen)/project/[id]/rack/_components/rack-export-composer.tsx",
  "app/(fullscreen)/project/[id]/rack/_components/rack-export-views-panel.tsx",
  "app/(fullscreen)/project/[id]/rack/_components/rack-export-object-panel.tsx",
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
  layoutSizes();
});

afterEach(() => {
  resetApp();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("exports de l'onglet Rack", () => {
  test("rack_export_png_pdf_without_cdn", async () => {
    restoreLayout();
    const downloads = captureDownloads();
    const dialog = await openExport();
    const stamp = new Date().toISOString().slice(0, 10);

    // Cartouche intégré (« Standard », défaut) rasterisé pour la feuille.
    await waitFor(() => expect(raster.svgs.length).toBeGreaterThan(0));
    const page = document.querySelector<HTMLElement>("[data-rack-page]");
    expect(page).not.toBeNull();

    // PDF : l'objet restauré (Baie 1, face avant) est capturé à sa taille
    // naturelle, posé à ses cotes, le cartouche par-dessus ; le jsPDF embarqué
    // produit le document. Le nœud capturé est celui que rend le composeur.
    await waitFor(() => expect(captureNodes()).toHaveLength(1), FIRST_LOAD);
    const node = captureNodes()[0];
    expect(node.getAttribute("data-rack-view-capture")).toBe("o1");
    fireEvent.click(within(dialog).getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Télécharger/ })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: /Télécharger/ }));
    await waitFor(() => expect(downloads).toHaveLength(1), { timeout: 5000 });
    expect(downloads[0].name).toBe(`Racks_Finale-Coupe-de-France_${stamp}.pdf`);
    const pdf = downloads[0].blob;
    expect(new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect(raster.captures[0].el).toBe(node);
    // Feuille A4 paysage (842 × 595 pt) ; la vue et le cartouche en images.
    const text = await pdfText(pdf);
    expect(text).toMatch(/\/MediaBox \[0 0 841\.88\d* 595\.27\d*\]/);
    expect(text.match(/\/Subtype \/Image/g)?.length).toBeGreaterThanOrEqual(2);

    // Image PNG : la page composée, ornements d'édition masqués.
    fireEvent.click(within(dialog).getByRole("button", { name: "Image" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "PNG" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Télécharger/ }));
    await waitFor(() => expect(downloads).toHaveLength(2), { timeout: 5000 });
    expect(downloads[1].name).toBe(`Racks_Finale-Coupe-de-France_${stamp}.png`);
    expect(downloads[1].blob.type).toBe("image/png");
    const shot = raster.captures.at(-1)!;
    expect(shot.el).toBe(page);
    expect(shot.opts).toMatchObject({ pixelRatio: 2, background: "#ffffff", hideSelectors: ["[data-composer-chrome]"] });

    // Aucune balise <script> ajoutée par les exports.
    expect(document.querySelectorAll("script[src]")).toHaveLength(0);

    // Aucune URL de CDN ni balise <script> dans la fermeture de l'export Rack.
    const closure = importClosure([RACK_EXPORT]);
    expect(closure.size).toBeGreaterThan(20);
    for (const f of [
      "lib/print/export-with-cartouche.ts",
      "lib/print/render-print-layout.ts",
      "lib/pdf/synoptic-export.ts",
      "lib/pdf/load-jspdf.ts",
      "lib/export/synoptic-capture.ts",
      // Task 8 : le composeur et la section VUES font partie de la fermeture.
      ...COMPOSER_FILES,
    ]) {
      expect(closure.has(resolve(SRC, f))).toBe(true);
    }
    const offenders = [...closure].filter((f) =>
      /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|cdn\.sheetjs\.com|createElement\(\s*["']script["']\s*\)/.test(
        stripComments(readFileSync(f, "utf8")),
      ),
    );
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  test("no_arkyo_brand_text_in_rack_export", async () => {
    restoreLayout();
    const downloads = captureDownloads();
    const dialog = await openExport();
    const stamp = new Date().toISOString().slice(0, 10);

    // Cartouche intégré : nom du site (en-tête et pied), aucune marque Arkyo.
    await waitFor(() => expect(raster.svgs.length).toBeGreaterThan(0));
    const standard = raster.svgs.at(-1)!;
    expect(standard).toContain(SITE.toUpperCase());
    expect(standard).toContain(SITE);
    expect(standard).not.toMatch(/arkyo/i);
    // Page capturée en image, vue du composeur comprise : aucun texte de marque.
    await waitFor(() => expect(captureNodes()).toHaveLength(1), FIRST_LOAD);
    expect(document.querySelector("[data-rack-page]")!.textContent).toContain("Baie 1");
    expect(document.querySelector("[data-rack-page]")!.textContent).not.toMatch(/arkyo/i);
    // Ni la colonne de réglages (section VUES) ni la barre d'état du composeur.
    expect(dialog.textContent).not.toMatch(/arkyo/i);

    // Modèles de l'espace livrés : leur layout rasterisé ne porte aucune marque.
    const chips = () => within(dialog).getAllByRole("button", { name: "Standard" });
    expect(chips()).toHaveLength(2);
    for (const name of ["Compact", "Détaillé"]) {
      const before = raster.svgs.length;
      fireEvent.click(within(dialog).getByRole("button", { name }));
      await waitFor(() => expect(raster.svgs.length).toBeGreaterThan(before));
      expect(raster.svgs.at(-1)).not.toMatch(/arkyo/i);
    }
    let before = raster.svgs.length;
    fireEvent.click(chips()[1]);
    await waitFor(() => expect(raster.svgs.length).toBeGreaterThan(before));
    // Modèle « Standard » de l'espace : projet et nature du document.
    expect(raster.svgs.at(-1)).toContain(">Finale Coupe de France<");
    expect(raster.svgs.at(-1)).toContain(">Racks<");
    expect(raster.svgs.at(-1)).not.toMatch(/arkyo/i);

    // Modèle sans layout (« Vide ») : chrome de secours dessiné par jsPDF.
    fireEvent.click(within(dialog).getByRole("button", { name: "Vide" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "PDF" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Télécharger/ }));
    await waitFor(() => expect(downloads).toHaveLength(1), { timeout: 5000 });
    expect(downloads[0].name).toBe(`Racks_Finale-Coupe-de-France_${stamp}.pdf`);
    const blank = await pdfText(downloads[0].blob);
    expect(blank).toContain("(VIDE) Tj");
    expect(blank).not.toMatch(/arkyo/i);

    // Retour au cartouche intégré : PDF sans marque non plus.
    before = raster.svgs.length;
    fireEvent.click(chips()[0]);
    await waitFor(() => expect(raster.svgs.length).toBeGreaterThan(before));
    fireEvent.click(within(dialog).getByRole("button", { name: /Télécharger/ }));
    await waitFor(() => expect(downloads).toHaveLength(2), { timeout: 5000 });
    expect(await pdfText(downloads[1].blob)).not.toMatch(/arkyo/i);
    expect(raster.svgs.at(-1)).not.toMatch(/arkyo/i);

    // Fermeture : le seul dessin de marque des captures partagées (le
    // monogramme et « Strata Arkyo » de l'en-tête des PDF Réseau,
    // `captureToPdf`, phase 5) n'est pas atteignable depuis l'export Rack.
    const closure = importClosure([RACK_EXPORT]);
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

    // Composeur et section VUES (Task 8) : dans la fermeture, et aucun texte
    // de marque hors commentaires (les `// arkyo-server:` sont des commentaires).
    for (const f of COMPOSER_FILES) {
      expect(closure.has(resolve(SRC, f))).toBe(true);
      expect(codeOnly(readFileSync(resolve(SRC, f), "utf8"))).not.toMatch(/arkyo/i);
    }
  });

  test("composer_builds_pages_from_views", async () => {
    const downloads = captureDownloads();
    const dialog = await openExport();
    const page = document.querySelector<HTMLElement>("[data-rack-page]")!;
    expect(page).not.toBeNull();

    // 1. Première ouverture : feuille vide, estampillée au papier (A4 paysage).
    await waitFor(() => expect(storedLayout()).toEqual({ items: [], page: { w: 297, h: 210 } }));
    expect(captureNodes()).toHaveLength(0);
    expect(within(dialog).getByText("Vues", { selector: "p" })).toBeInTheDocument();

    // 2. « Ajouter une vue » (bouton en pointillés), puis Contenant › Baie 1.
    const add = within(dialog).getByRole("button", { name: /Ajouter une vue/ });
    expect(add.className).toContain("border-dashed");
    fireEvent.click(add);
    await waitFor(() => expect(storedLayout()!.items).toHaveLength(1));
    expect(storedLayout()!.items[0].kind).toBe("placeholder");
    await screen.findByText("Objet à configurer");
    fireEvent.click(within(dialog).getByRole("button", { name: "Baie 1" }));
    await waitFor(() => expect(storedLayout()!.items[0]).toMatchObject({ kind: "rack", rackId: "r1", views: ["FRONT"] }));
    await waitFor(() => expect(captureNodes()).toHaveLength(1), FIRST_LOAD);
    expect(captureNodes()[0].getAttribute("data-rack-view-capture")).toBe(storedLayout()!.items[0].id);
    await screen.findByText("Baie 1 · Avant");

    // Une deuxième vue sur le même contenant : elles se cumulent, dans l'ordre
    // des vues. Jamais zéro vue : retirer les deux laisse la dernière.
    fireEvent.click(within(dialog).getByRole("button", { name: "Arrière" }));
    await waitFor(() => expect(storedLayout()!.items[0]).toMatchObject({ views: ["FRONT", "REAR"] }));
    await screen.findByText("Baie 1 · Avant + Arrière");
    fireEvent.click(within(dialog).getByRole("button", { name: "Avant" }));
    await waitFor(() => expect(storedLayout()!.items[0]).toMatchObject({ views: ["REAR"] }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Arrière" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Avant" }));
    await waitFor(() => expect(storedLayout()!.items[0]).toMatchObject({ views: ["FRONT", "REAR"] }));

    // 3. Deuxième objet : un emplacement à configurer.
    fireEvent.click(within(dialog).getByRole("button", { name: /Ajouter une vue/ }));
    await waitFor(() => expect(storedLayout()!.items).toHaveLength(2));
    expect(storedLayout()!.items[1].kind).toBe("placeholder");
    await screen.findByText("Objet à configurer");
    // Un emplacement vide ne part pas au document : une seule vue à capturer.
    expect(captureNodes()).toHaveLength(1);

    // 4. L'emplacement devient un LIEU (Plateau, qui porte Baie 1).
    fireEvent.click(within(dialog).getByRole("button", { name: "Emplacement" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Plateau/ }));
    await waitFor(() =>
      expect(storedLayout()!.items[1]).toMatchObject({ kind: "location", locationId: "l1", view: "FRONT" }),
    );
    await waitFor(() => expect(captureNodes()).toHaveLength(2));
    const [rackId, locationId] = storedLayout()!.items.map((i) => i.id);
    expect(captureNodes().map((n) => n.getAttribute("data-rack-view-capture"))).toEqual([rackId, locationId]);
    // Mise en page : la feuille est estampillée, les deux objets tiennent sur
    // le papier (placement différé à l'arrivée de la mesure). Faute de place à
    // droite du précédent, le nouvel objet part au coin de la zone utile
    // (`placeNewItem` d'arkyo) : un chevauchement est permis.
    const stored = storedLayout() as unknown as {
      page: { w: number; h: number };
      items: { x: number; y: number; w: number }[];
    };
    expect(stored.page).toEqual({ w: 297, h: 210 });
    const [a, b] = stored.items.map((i) => ({ ...i, h: (i.w * 300) / 400 }));
    for (const r of [a, b]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(297.01);
      expect(r.y + r.h).toBeLessThanOrEqual(210.01);
    }
    const zone = standardComposerZone({ w: 297, h: 210 });
    expect(a.x + a.w + 8 + b.w).toBeGreaterThan(zone.x + zone.w);
    expect({ x: b.x, y: b.y }).toEqual({ x: zone.x, y: zone.y });

    // 5. PDF : une page A4 paysage, les deux vues capturées sur leurs nœuds
    //    du composeur, plus le cartouche.
    fireEvent.click(within(dialog).getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Télécharger/ })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: /Télécharger/ }));
    await waitFor(() => expect(downloads).toHaveLength(1), { timeout: 5000 });
    expect(raster.captures.map((c) => c.el)).toEqual(captureNodes());
    const text = await pdfText(downloads[0].blob);
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(text).toMatch(/\/MediaBox \[0 0 841\.88\d* 595\.27\d*\]/);
    // Trois images posées sur la page (deux vues, le cartouche). jsPDF
    // dédoublonne les images identiques (ici le même PNG 1 × 1) : on compte
    // les dessins `Do`, pas les XObject.
    expect(text.match(/\/I\w* Do\b/g)).toHaveLength(3);
    expect(text).not.toMatch(/arkyo/i);

    // 6. Supprimer la sélection (le lieu) : la composition revient à une vue.
    fireEvent.click(within(dialog).getByRole("button", { name: /Supprimer/ }));
    await waitFor(() => expect(storedLayout()!.items).toHaveLength(1));
    expect(storedLayout()!.items[0].id).toBe(rackId);
    await waitFor(() => expect(captureNodes()).toHaveLength(1));
  });
});
