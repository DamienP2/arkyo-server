#!/usr/bin/env node
// Extracts arkyo's starting referentials into crates/arkyo-server/seeds/*.json.
//
//   node tools/extract-seeds/extract.mjs [--arkyo <arkyo clone>] [--out <dir>] [--force]
//
// ONE-SHOT TOOL, NOT SHIPPED. The JSON files it writes are committed and
// embedded in the server; their ids are the ids of the seeded rows in every
// base. Re-running it generates NEW ids (cuid v1): once a version has been
// released, NEVER re-run it (bases in the field would get a second copy of
// each referential on `restore-arkyo`, and the old ids would no longer
// match). It refuses to overwrite existing files without --force.
//
// Everything else is deterministic: same arkyo commit → same rows, same
// order, same values.
//
// How: the seed handlers of arkyo (app/api/supervisor/dev/seed-*/route.ts)
// are executed as they are (Node strips the TypeScript types), with their
// imports redirected to stubs and `mainDb` (Prisma) replaced by an in-memory
// collector. So the rows are exactly what arkyo's POST handlers write into
// its main base: name resolutions (functionKey, brandName, connector names),
// skips (cables whose connector is unknown), defaults of the Prisma schema.
// Then the non-stale scripts/seed-*.ts run against the same collector (they
// add the network flags of the signals and link cords to their cable model).
// Finally the Catalog* rows are converted to the Tenant* shape (decision 3
// of the phase: join tables → JSON id arrays, SaaS columns dropped).

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ARKYO_COMMIT = "88b2e4b245b3c11bb8e4a8989c83fe98b063582d";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const arkyo = resolve(arg("--arkyo", join(repo, ".ref/arkyo")));
const out = resolve(arg("--out", join(repo, "crates/arkyo-server/seeds")));
const force = process.argv.includes("--force");

const head = execFileSync("git", ["-C", arkyo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== ARKYO_COMMIT) {
  console.error(`arkyo est à ${head}, attendu ${ARKYO_COMMIT} (scripts/fetch-refs.sh)`);
  process.exit(1);
}
if (existsSync(join(out, "functions.json")) && !force) {
  console.error(
    `${out} contient déjà des seeds : les régénérer change tous les ID (voir l'en-tête). --force pour passer outre.`,
  );
  process.exit(1);
}

// ── cuid v1 (same format as the `cuid` crate used by the server) ──────────
const BASE = 36;
const pad = (s, n) => s.padStart(n, "0").slice(-n);
const fingerprint = (() => {
  const host = hostname();
  const sum = [...host].reduce((a, c) => a + c.charCodeAt(0), host.length + BASE);
  return pad(process.pid.toString(BASE), 2) + pad(sum.toString(BASE), 2);
})();
let counter = 0;
function cuid() {
  const block = () => pad(randomBytes(4).readUInt32BE(0).toString(BASE), 4);
  counter = (counter + 1) % BASE ** 4;
  return "c" + Date.now().toString(BASE) + pad(counter.toString(BASE), 4) + fingerprint + block() + block();
}

// ── In-memory stand-in for arkyo's main Prisma client ─────────────────────
// Defaults of the main schema (database/main/schema.prisma) for the models
// the seeds write: a column a handler does not set takes this value, as in
// arkyo's base.
const DEFAULTS = {
  catalogFunction: { color: "#3b82f6", cablePrefix: null, cableSuffix: null, sortOrder: 0, systemCategory: null },
  catalogPhase: { sortOrder: 0 },
  catalogType: { parentId: null, iconId: null, schemaImageUrl: null, sortOrder: 0 },
  catalogEquipmentCategory: { color: "#6b7280", parentId: null, isActive: false, iconId: null },
  catalogBrand: { logoUrl: null, website: null, isActive: false, sortOrder: 0 },
  catalogSymbol: { isBuiltin: false, svgUrl: null, svgUrlD: null, sortOrder: 0 },
  catalogConnectorType: { versions: [], svgUrl: null, iconId: "circle", color: "#6b7280", isActive: false, sortOrder: 0 },
  catalogConnectorTypeFunction: {},
  catalogSignalType: {
    color: "#6b7280", connectors: [], isDefault: false, isActive: false, cablePrefix: "", cableSuffix: "",
    bandwidth: null, requiredImpedance: null, minBandwidthMHz: null, isIp: false, supportsRedundancy: false,
    redundancyStyle: "AB", usesMulticast: false, sortOrder: 0, functionId: null,
  },
  catalogAdapter: {
    reference: null, imageUrl: null, inputs: [], outputs: [], notes: null, isActive: false, sortOrder: 0, functionId: null,
  },
  cableModel: {
    reference: null, functionId: null, brandId: null, impedance: null, bandwidthMHz: null, diameterMm: null,
    conductor: null, shielding: null, jacketMaterial: null, fireRating: null, customFields: [], imageUrl: null,
    datasheetUrl: null, notes: null, isActive: false, sortOrder: 0,
  },
  cable: {
    functionId: null, cableModelId: null, brandId: null, model: null, reference: null, useCases: [],
    availableLengths: [], customMinLength: null, customMaxLength: null, notes: null, imageUrl: null,
    isActive: false, sortOrder: 0,
  },
  dimensionPreset: { isReel: false, isBuiltin: false, isActive: true, sortOrder: 0 },
  printTemplate: {
    description: null, paperFormat: "A3", orientation: "LANDSCAPE", layout: null, slots: [], isBuiltin: false,
    isActive: true, sortOrder: 0,
  },
  cableLabelStock: {
    reference: null, brandId: null, description: null, datasheetUrl: null, printableHeight: null, wrapHeight: null,
    printablePadding: null, printableColor: null, cableDiameterMin: null, cableDiameterMax: null, isBuiltin: false,
    isActive: true, sortOrder: 0,
  },
};

const store = Object.fromEntries(Object.keys(DEFAULTS).map((m) => [m, []]));

const isOperator = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every((k) => ["in", "not"].includes(k));

function matches(rec, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && !isOperator(v)) {
      return matches(rec, v); // compound unique selector, e.g. name_brandId: { name, brandId }
    }
    const value = rec[k] ?? null;
    if (isOperator(v)) {
      if ("in" in v && !v.in.includes(value)) return false;
      if ("not" in v && value === (v.not ?? null)) return false;
      return true;
    }
    return value === (v ?? null);
  });
}

const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const project = (rec, select) =>
  rec && select ? Object.fromEntries(Object.keys(select).map((k) => [k, clone(rec[k])])) : clone(rec);

function model(name) {
  const rows = store[name];
  if (!rows) throw new Error(`modèle Prisma inattendu dans un seed : ${name}`);
  const create = (data) => {
    const rec = { id: cuid(), ...clone(DEFAULTS[name]), ...clone(data) };
    rows.push(rec);
    return rec;
  };
  const update = (rec, data) => Object.assign(rec, clone(data));
  return {
    async findUnique({ where, select }) {
      return project(rows.find((r) => matches(r, where)) ?? null, select);
    },
    async findFirst({ where, select } = {}) {
      return project(rows.find((r) => matches(r, where)) ?? null, select);
    },
    async findMany({ where, select } = {}) {
      return rows.filter((r) => matches(r, where)).map((r) => project(r, select));
    },
    async create({ data, select }) {
      return project(create(data), select);
    },
    async createMany({ data }) {
      for (const d of data) create(d);
      return { count: data.length };
    },
    async update({ where, data }) {
      const rec = rows.find((r) => matches(r, where));
      if (!rec) throw new Error(`${name}.update : aucun enregistrement pour ${JSON.stringify(where)}`);
      return clone(update(rec, data));
    },
    async upsert({ where, update: u, create: c }) {
      const rec = rows.find((r) => matches(r, where));
      return clone(rec ? update(rec, u) : create(c));
    },
    async deleteMany({ where } = {}) {
      const before = rows.length;
      const kept = rows.filter((r) => !matches(r, where));
      rows.splice(0, rows.length, ...kept);
      return { count: before - kept.length };
    },
    async count({ where } = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
  };
}

let disconnected = () => {};
globalThis.__seedDb = new Proxy(
  {},
  {
    get(_, prop) {
      if (prop === "$disconnect") return async () => disconnected();
      return model(prop);
    },
  },
);

// ── Module redirection: arkyo's imports → stubs ───────────────────────────
// BUILTIN_CONNECTOR_ICONS lives in a .tsx (JSX: no type stripping) — its
// literal array is evaluated on its own.
const iconsSrc = readFileSync(join(arkyo, "components/ui/connector-icon.tsx"), "utf8");
const iconsMatch = iconsSrc.match(/export const BUILTIN_CONNECTOR_ICONS[^=]*=\s*(\[[\s\S]*?\n\]);/);
if (!iconsMatch) throw new Error("BUILTIN_CONNECTOR_ICONS introuvable");
const icons = new Function(`return ${iconsMatch[1]};`)();

const STUBS = {
  "next/server": "export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };",
  "@/lib/db-main": "export const mainDb = globalThis.__seedDb;",
  "@/lib/require-collaborator": "export async function requireCollaboratorPermissionApi() { return { ok: true }; }",
  "@/lib/catalog-sync": "export async function reSyncAllCatalogToTenants() {}",
  "@/components/ui/connector-icon": `export const BUILTIN_CONNECTOR_ICONS = ${JSON.stringify(icons)};`,
  dotenv: "export function config() {}",
};
const stubFor = (specifier) => {
  if (specifier in STUBS) return STUBS[specifier];
  if (/(^|\/)lib\/db-main(\.ts)?$/.test(specifier)) return STUBS["@/lib/db-main"]; // scripts: "../lib/db-main"
  return null;
};

registerHooks({
  resolve(specifier, context, next) {
    const stub = stubFor(specifier);
    if (stub !== null) {
      return { url: `data:text/javascript,${encodeURIComponent(stub)}`, format: "module", shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"));
      return { format: "module", source, shortCircuit: true };
    }
    return next(url, context);
  },
});

// ── 1. arkyo's seed routes, in dependency order ───────────────────────────
// Order of seed-all (functions → types → brands → symbols → connectors →
// signals → adapters → cable-models → cables → dimensions → print-templates),
// plus the seeds seed-all does not chain: phases, eq-categories,
// cable-label-stocks. Not taken: seed-equipment (the equipment catalogue
// starts empty, decision 4), seed-features / seed-plans (SaaS),
// seed-signal-categories (410, model removed).
const ROUTES = [
  "functions", "phases", "types", "eq-categories", "brands", "symbols", "connectors", "signals",
  "adapters", "cable-models", "cables", "dimensions", "print-templates", "cable-label-stocks",
];
for (const slug of ROUTES) {
  const mod = await import(pathToFileURL(join(arkyo, `app/api/supervisor/dev/seed-${slug}/route.ts`)).href);
  const res = await mod.POST();
  if (res.status !== 200) throw new Error(`seed-${slug} : HTTP ${res.status} ${JSON.stringify(res.body)}`);
  console.log(`seed-${slug}`.padEnd(26), JSON.stringify(res.body));
}

// ── 2. scripts/seed-*.ts still in phase with the schema ───────────────────
// seed-signals (network flags isIp / supportsRedundancy / usesMulticast),
// seed-cables (cableModelId by brand + model), seed-adapters (same upsert).
// Not taken: seed-connectors.ts (writes columns dropped by the migration
// connector_mount_simplify), seed-types-brands.ts (reads a TYPES array that
// no longer exists), seed-equipment.ts (decision 4).
// The scripts run main() on import and end with $disconnect().
process.chdir(arkyo); // they read the route files from process.cwd()
for (const script of ["seed-signals", "seed-cables", "seed-adapters"]) {
  const done = new Promise((ok) => (disconnected = ok));
  await import(pathToFileURL(join(arkyo, `scripts/${script}.ts`)).href);
  await done;
}

// ── 3. Catalog* (main) → Tenant* rows ─────────────────────────────────────
// Seeded rows are active (Catalog*.isActive was the supervisor's publication
// flag, and arkyo serves its functions, phases, types and categories to the
// tenants whatever it is). Ids are kept, so references stay resolved.
const pick = (rec, cols) => Object.fromEntries(cols.map((c) => [c, rec[c] === undefined ? null : rec[c]]));
const SEEDED_BY = "system"; // createdById of seeded cords and adapters (no user)

const functionIdsOf = (connectorId) =>
  store.catalogConnectorTypeFunction.filter((j) => j.connectorTypeId === connectorId).map((j) => j.functionId);

// PrintSettings singleton: arkyo creates it with `{ key: "default" }` on first
// read (app/api/supervisor/print-settings/route.ts), i.e. the schema defaults.
const printSettings = {
  id: cuid(), key: "default", defaultPaperFormat: "A3", defaultOrientation: "LANDSCAPE",
  defaultMarginTop: 15, defaultMarginRight: 15, defaultMarginBottom: 15, defaultMarginLeft: 15,
  watermarkUrl: null, watermarkOpacity: 0.1, pdfOptions: {},
};

const FAMILIES = [
  {
    family: "functions", source: "app/api/supervisor/dev/seed-functions/route.ts",
    tables: [["TenantFunction", store.catalogFunction.map((r) => ({
      ...pick(r, ["id", "key", "label", "color", "cablePrefix", "cableSuffix", "systemCategory", "sortOrder"]),
      isActive: true,
    }))]],
  },
  {
    family: "phases", source: "app/api/supervisor/dev/seed-phases/route.ts",
    tables: [["TenantPhase", store.catalogPhase.map((r) => ({ ...pick(r, ["id", "key", "label", "sortOrder"]), isActive: true }))]],
  },
  {
    family: "types", source: "app/api/supervisor/dev/seed-types/route.ts",
    tables: [["TenantType", store.catalogType.map((r) => ({
      ...pick(r, ["id", "name", "functionId", "parentId", "iconId", "schemaImageUrl", "sortOrder"]),
      isActive: true,
    }))]],
  },
  {
    family: "equipment-categories", source: "app/api/supervisor/dev/seed-eq-categories/route.ts",
    tables: [["TenantEquipmentCategory", store.catalogEquipmentCategory.map((r) => ({
      ...pick(r, ["id", "name", "color", "iconId", "parentId"]),
      sortOrder: 0,
      isActive: true,
    }))]],
  },
  {
    family: "brands", source: "app/api/supervisor/dev/seed-brands/route.ts (+ LAPP de seed-cable-label-stocks)",
    tables: [["TenantBrand", store.catalogBrand.map((r) => ({ ...pick(r, ["id", "name", "website", "logoUrl"]), isActive: true }))]],
  },
  {
    family: "symbols", source: "app/api/supervisor/dev/seed-symbols/route.ts",
    tables: [["CatalogSymbol", store.catalogSymbol.map((r) =>
      pick(r, ["id", "key", "label", "isBuiltin", "svgUrl", "svgUrlD", "sortOrder"]))]],
  },
  {
    family: "connectors", source: "app/api/supervisor/dev/seed-connectors/route.ts",
    tables: [["TenantConnectorType", store.catalogConnectorType.map((r) => ({
      ...pick(r, ["id", "name", "versions", "iconId", "svgUrl", "color"]),
      functionIds: functionIdsOf(r.id),
      isActive: true,
    }))]],
  },
  {
    family: "signals", source: "app/api/supervisor/dev/seed-signals/route.ts + scripts/seed-signals.ts",
    tables: [["TenantSignalType", store.catalogSignalType.map((r) => ({
      ...pick(r, ["id", "name", "color", "functionId", "cablePrefix", "cableSuffix", "bandwidth",
        "requiredImpedance", "minBandwidthMHz"]),
      connectorIds: r.connectors,
      ...pick(r, ["isIp", "supportsRedundancy", "redundancyStyle", "usesMulticast", "isDefault", "sortOrder"]),
      isActive: true,
    }))]],
  },
  {
    family: "adapters", source: "app/api/supervisor/dev/seed-adapters/route.ts + scripts/seed-adapters.ts",
    tables: [["TenantAdapter", store.catalogAdapter.map((r) => ({
      ...pick(r, ["id", "name", "reference", "functionId", "inputs", "outputs", "notes", "imageUrl"]),
      isActive: true,
      createdById: SEEDED_BY,
    }))]],
  },
  {
    family: "cable-models", source: "app/api/supervisor/dev/seed-cable-models/route.ts",
    tables: [["TenantCableModel", store.cableModel.map((r) => ({
      ...pick(r, ["id", "name", "reference", "functionId", "brandId", "impedance", "bandwidthMHz", "diameterMm",
        "conductor", "shielding", "jacketMaterial", "fireRating", "customFields", "imageUrl", "datasheetUrl",
        "notes", "sortOrder"]),
      isActive: true,
    }))]],
  },
  {
    family: "cables", source: "app/api/supervisor/dev/seed-cables/route.ts + scripts/seed-cables.ts",
    tables: [["TenantCable", store.cable.map((r) => ({
      ...pick(r, ["id", "name", "reference", "leftConnectorId", "leftGender", "rightConnectorId", "rightGender",
        "functionId", "brandId", "model", "cableModelId", "useCases", "availableLengths", "customMinLength",
        "customMaxLength", "notes", "imageUrl", "sortOrder"]),
      isActive: true,
      createdById: SEEDED_BY,
    }))]],
  },
  {
    family: "dimensions", source: "app/api/supervisor/dev/seed-dimensions/route.ts",
    tables: [["TenantDimensionPreset", store.dimensionPreset.map((r) => ({
      ...pick(r, ["id", "category", "value", "unit", "isReel", "sortOrder"]),
      isActive: true,
    }))]],
  },
  {
    family: "print-templates", source: "app/api/supervisor/dev/seed-print-templates/route.ts",
    tables: [["TenantPrintTemplate", store.printTemplate.map((r) => ({
      ...pick(r, ["id", "key", "name", "description", "paperFormat", "orientation", "slots", "layout", "sortOrder"]),
      isActive: true,
    }))]],
  },
  {
    family: "cable-label-stocks", source: "app/api/supervisor/dev/seed-cable-label-stocks/route.ts",
    tables: [["TenantCableLabelStock", store.cableLabelStock.map((r) => ({
      ...pick(r, ["id", "name", "reference", "brandId", "description", "datasheetUrl", "paperFormat", "orientation",
        "pageMarginTop", "pageMarginRight", "pageMarginBottom", "pageMarginLeft", "columns", "rows", "gutterX",
        "gutterY", "labelWidth", "labelHeight", "printableHeight", "wrapHeight", "printablePadding",
        "printableColor", "cableDiameterMin", "cableDiameterMax", "sortOrder"]),
      isActive: true,
    }))]],
  },
  {
    // arkyo has no seed for its export models (created in the supervisor UI):
    // the family exists, empty, so that `restore-arkyo` has a source.
    family: "print-export-models", source: "aucun seed dans arkyo (modèles créés depuis le superviseur)",
    tables: [["TenantPrintExportModel", []], ["TenantPrintExportPage", []]],
  },
  {
    family: "print-settings", source: "database/main/schema.prisma (PrintSettings, valeurs par défaut)",
    tables: [["PrintSettings", [printSettings]]],
  },
];

mkdirSync(out, { recursive: true });
for (const f of FAMILIES) {
  const doc = {
    family: f.family,
    source: `arkyo@${ARKYO_COMMIT.slice(0, 7)}:${f.source}`,
    tables: f.tables.map(([table, rows]) => ({ table, rows })),
  };
  writeFileSync(join(out, `${f.family}.json`), JSON.stringify(doc, null, 2) + "\n");
  console.log(`${f.family}.json`.padEnd(26), f.tables.map(([t, r]) => `${t}: ${r.length}`).join(", "));
}
