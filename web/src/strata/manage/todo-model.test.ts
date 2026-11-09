/**
 * Modèle de l'espace Gérer (interface Strata v2, spec v2 §4.2) : « Ce qu'il
 * reste à faire » et lignes de la Vue d'ensemble, calculés sur les données
 * déjà chargées (éditeur, `canvas-data`, câbles, rapport de validation).
 */

import { describe, expect, test } from "vitest";
import type { InventaireBomItem, InventaireRack } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import type { ProjectFicheData } from "@/app/(fullscreen)/project/[id]/fiche/fiche-client";
import type { ValidationReport } from "@/lib/services/rack-validation";
import { CONNECTIONS, MONITOR_SLOT, PANEL_SLOT, SLOT, canvasData } from "../bottom/test-fixtures";
import type { InventoryDto } from "./placement";
import { computeDomains, computeTodo, placementOf, type ManageData } from "./todo-model";

const FICHE: ProjectFicheData = {
  id: "p1",
  name: "Finale",
  status: "EN_PREPARATION",
  interventionType: "PRESTATION",
  rigType: "CAR",
  clientName: "France TV",
  shootingDate: "2026-11-20T00:00:00.000Z",
  shootingEndDate: null,
  planningStart: null,
  planningEnd: null,
  commissioningDate: null,
  location: "Stade de France",
  description: null,
  prestationType: null,
  documents: [],
  counts: { tasks: 0, messages: 0, documents: 0 },
};

function bom(id: string, name: string, extra: Partial<InventaireBomItem> = {}): InventaireBomItem {
  return {
    id,
    kind: "equipment",
    refId: `eq-${id}`,
    quantity: 1,
    name,
    reference: null,
    brandName: null,
    category: "Vidéo",
    categoryColor: "#3b82f6",
    isRackable: true,
    heightU: 1,
    depthMm: 300,
    weightKg: 2,
    powerW: 50,
    snapshotId: null,
    ...extra,
  };
}

function rack(id: string, name: string, extra: Partial<InventaireRack> = {}): InventaireRack {
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
    hasConnectors: true,
    canvasX: null,
    canvasY: null,
    locationId: "l1",
    isVirtual: false,
    slots: [],
    bom: [],
    ...extra,
  };
}

/** Deux des trois moniteurs ajoutés au contenant ne sont pas encore posés (slots fantômes). */
const GHOSTS = [
  { ...MONITOR_SLOT, id: "g1", inventoryItemId: "i2", startU: null, heightU: null },
  { ...MONITOR_SLOT, id: "g2", inventoryItemId: "i2", startU: null, heightU: null },
];

const BAIE = rack("r1", "Baie 1", {
  bom: [
    bom("i1", "Caméra X", { refId: "eq1", heightU: 2 }),
    bom("i2", "Moniteur 17", { refId: "eq2", quantity: 3 }),
  ],
});
const LIBRE = rack("v1", "", { isVirtual: true, isRackable: false, bom: [bom("i5", "Ordinateur", { isRackable: false })] });
const CAISSE = rack("r2", "Caisse", { isRackable: false, bom: [bom("i6", "Intercom", { quantity: 3 })] });

/** Inventaire de `racks/{id}/inventory` tiré du BOM de l'éditeur (`refId` des panels en plus). */
const inventoryOf = (r: InventaireRack, refs: Record<string, string> = {}): InventoryDto[] =>
  r.bom.map((i) => ({ id: i.id, kind: i.kind, refId: refs[i.id] ?? i.refId, quantity: i.quantity, hostItemId: i.hostItemId ?? null }));

const REPORT: ValidationReport = {
  issues: [
    { id: "iss-1", severity: "error", kind: "duplicate_label", subject: "V-0101", message: "Label utilisé deux fois", refs: {} },
    { id: "iss-2", severity: "warning", kind: "unlabelled_cable", message: "Câble sans label", refs: {} },
    { id: "iss-3", severity: "warning", kind: "unlabelled_cable", message: "Câble sans label", refs: {} },
  ],
  counts: { error: 1, warning: 2, info: 0 },
};

function data(extra: Partial<ManageData> = {}): ManageData {
  return {
    fiche: FICHE,
    racks: [BAIE, LIBRE, CAISSE],
    locations: [{ id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: "v1" }],
    canvas: { r1: canvasData("r1", "Baie 1", [SLOT, { ...MONITOR_SLOT, inventoryItemId: "i2" }, ...GHOSTS]) },
    connections: { r1: CONNECTIONS, v1: [], r2: [] },
    inventory: { r1: inventoryOf(BAIE) },
    unavailable: {},
    validation: null,
    ...extra,
  };
}

describe("computeTodo", () => {
  test("équipement non placé, fiche incomplète, rapport de validation", () => {
    const todo = computeTodo(
      data({
        fiche: { ...FICHE, clientName: null, shootingDate: null },
        validation: { report: REPORT, view: "Régie" },
      }),
    );
    expect(todo.map((t) => [t.id, t.severity])).toEqual([
      ["validation:duplicate_label", "danger"],
      ["validation:unlabelled_cable", "warn"],
      ["unplaced:i2", "warn"],
      ["fiche", "info"],
    ]);
    const [dup, unlabelled, unplaced, fiche] = todo;
    expect(dup).toMatchObject({ label: "Label en doublon (1)", detail: "V-0101 : Label utilisé deux fois" });
    expect(dup.target).toEqual({ space: "concevoir", tab: "synoptique", objectId: "iss-1" });
    expect(unlabelled.label).toBe("Câble sans label (2)");
    expect(unplaced).toMatchObject({ label: "Placer Moniteur 17 en rack", detail: "Baie 1 · 2 à placer" });
    expect(unplaced.target).toEqual({ space: "concevoir", tab: "rack", objectId: "r1" });
    expect(fiche).toMatchObject({ label: "Compléter la fiche", detail: "Client, date de tournage" });
    expect(fiche.target).toEqual({ space: "gerer", page: "fiche" });
  });

  test("panels et accessoires à placer, comme « Éléments à placer » de l'onglet Rack", () => {
    // Le panel `pn1` est posé (PANEL_SLOT) ; un second panel `pn9` ne l'est pas ;
    // une plaque pleine 1 U est posée (notes JSON), l'autre non.
    const plaque = { ...SLOT, id: "a1", equipmentId: null, catalogEquipmentId: null, inventoryItemId: null, equipment: null, startU: 30, heightU: 1, notes: JSON.stringify({ accessoryType: "plaque", style: "plein" }) };
    const baie = rack("r1", "Baie 1", {
      bom: [
        bom("p1", "Patch BNC 8", { kind: "panel", refId: undefined, isRackable: false, heightU: 1 }),
        bom("p9", "Patch RJ45", { kind: "panel", refId: undefined, isRackable: false, heightU: 1 }),
        bom("a1", "Plaque pleine 1U", { kind: "accessory", refId: undefined, isRackable: false, heightU: 1, quantity: 2 }),
        bom("x1", "Adaptateur", { kind: "adapter", refId: undefined }),
      ],
    });
    const inventory: InventoryDto[] = [
      { id: "p1", kind: "panel", refId: "pn1", quantity: 1 },
      { id: "p9", kind: "panel", refId: "pn9", quantity: 1 },
      { id: "a1", kind: "accessory", accessoryType: "plaque", accessoryHeightU: 1, accessoryVariant: "plein", quantity: 2 },
      { id: "x1", kind: "adapter", refId: "ad1", quantity: 4 },
    ];
    const d = data({
      racks: [baie],
      canvas: { r1: canvasData("r1", "Baie 1", [PANEL_SLOT, plaque]) },
      inventory: { r1: inventory },
    });
    expect(computeTodo(d).map((t) => [t.id, t.detail])).toEqual([
      ["unplaced:p9", "Baie 1 · 1 à placer"],
      ["unplaced:a1", "Baie 1 · 1 à placer"],
    ]);
    expect(placementOf(baie.bom[3], baie, d)).toMatchObject({ status: "none", missing: 0 });
  });

  test("rien à faire : liste vide", () => {
    const canvas = { r1: canvasData("r1", "Baie 1", [SLOT, { ...MONITOR_SLOT, inventoryItemId: "i2" }]) };
    const baie = rack("r1", "Baie 1", { bom: [bom("i1", "Caméra X", { refId: "eq1", heightU: 2 }), bom("i2", "Moniteur 17", { refId: "eq2" })] });
    expect(computeTodo(data({ racks: [baie], canvas, inventory: { r1: inventoryOf(baie) } }))).toEqual([]);
  });

  test("contenant en lecture : pas de « à placer » supposé", () => {
    expect(computeTodo(data({ canvas: {} })).map((t) => t.id)).toEqual([]);
    expect(computeTodo(data({ inventory: {} })).map((t) => t.id)).toEqual([]);
  });

  test("lecture impossible : une ligne le dit, au lieu de « rien à faire »", () => {
    const d = data({ canvas: {}, unavailable: { r1: true } });
    expect(computeTodo(d).map((t) => [t.id, t.label, t.severity])).toEqual([
      ["unavailable:r1", "Baie 1 : lecture impossible", "warn"],
    ]);
    expect(placementOf(BAIE.bom[1], BAIE, d)).toMatchObject({ status: "unavailable", missing: 0 });
    expect(computeDomains(d).find((r) => r.id === "materiel")).toMatchObject({
      summary: "8 équipements · 1 emplacement · 2 contenants · 1 contenant illisible",
      severity: "warn",
    });
  });

  test("sans contenant rackable : ni « à placer » ni bilan de rack", () => {
    const d = data({ racks: [LIBRE, CAISSE], canvas: {}, inventory: {} });
    expect(computeTodo(d)).toEqual([]);
    const racks = computeDomains(d).find((r) => r.id === "racks")!;
    expect(racks).toMatchObject({ summary: "Aucun contenant rackable", severity: "neutral" });
    expect(placementOf(CAISSE.bom[0], CAISSE, d)).toMatchObject({ status: "container", missing: 0 });
    expect(placementOf(LIBRE.bom[0], LIBRE, d)).toMatchObject({ status: "free", missing: 0 });
  });
});

describe("computeDomains", () => {
  test("une ligne par domaine, chacune avec sa cible", () => {
    const rows = computeDomains(data({ validation: { report: REPORT, view: "Régie" } }));
    expect(rows.map((r) => r.label)).toEqual([
      "Fiche",
      "Matériel",
      "Racks",
      "Câblage",
      "Validation · Régie",
      "Réseau",
      "Livraison",
      "Dossier",
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.materiel).toMatchObject({ summary: "8 équipements · 1 emplacement · 2 contenants · 2 à placer", severity: "warn" });
    expect(by.materiel.target).toEqual({ space: "gerer", page: "materiel" });
    expect(by.racks.summary).toBe("1 contenant rackable · 3/42 U · 160 W");
    expect(by.racks.target).toEqual({ space: "concevoir", tab: "rack" });
    expect(by.cables).toMatchObject({ summary: "3 câbles · 1 sans numéro", severity: "warn" });
    expect(by.validation).toMatchObject({ summary: "1 erreur · 2 avertissements", severity: "danger" });
    expect(by.validation.target).toEqual({ space: "concevoir", tab: "synoptique" });
    expect(by.fiche).toMatchObject({ summary: "France TV · Stade de France · tournage le 20 nov. 2026", severity: "ok" });
    expect(by.reseau).toMatchObject({ summary: "Bientôt disponible", severity: "neutral" });
  });

  test("sans rapport noté pour ce projet : « Aucun rapport »", () => {
    const row = computeDomains(data()).find((r) => r.id === "validation")!;
    expect(row).toMatchObject({ label: "Validation", summary: "Aucun rapport", severity: "neutral", aside: "Concevoir" });
  });
});
