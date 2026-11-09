/**
 * Modèle de l'espace Gérer (interface Strata v2, spec v2 §4.2) : « Ce qu'il
 * reste à faire » et lignes de la Vue d'ensemble, calculés sur les données
 * déjà chargées (éditeur, `canvas-data`, câbles, rapport de validation).
 */

import { describe, expect, test } from "vitest";
import type { InventaireBomItem, InventaireRack } from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import type { ProjectFicheData } from "@/app/(fullscreen)/project/[id]/fiche/fiche-client";
import type { ValidationReport } from "@/lib/services/rack-validation";
import { CONNECTIONS, MONITOR_SLOT, SLOT, canvasData } from "../bottom/test-fixtures";
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

/** Deux moniteurs ajoutés au contenant mais pas encore posés (slots fantômes). */
const GHOSTS = [
  { ...MONITOR_SLOT, id: "g1", inventoryItemId: "i9", startU: null, heightU: null },
  { ...MONITOR_SLOT, id: "g2", inventoryItemId: "i9", startU: null, heightU: null },
];

const BAIE = rack("r1", "Baie 1", {
  bom: [
    bom("i1", "Caméra X", { heightU: 2 }),
    bom("i2", "Moniteur 17"),
    bom("i9", "Moniteur 17", { quantity: 2 }),
  ],
});
const LIBRE = rack("v1", "", { isVirtual: true, isRackable: false, bom: [bom("i5", "Ordinateur", { isRackable: false })] });
const CAISSE = rack("r2", "Caisse", { isRackable: false, bom: [bom("i6", "Intercom", { quantity: 3 })] });

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
    validationReport: null,
    ...extra,
  };
}

describe("computeTodo", () => {
  test("équipement non placé, longueur manquante, fiche incomplète, rapport de validation", () => {
    const todo = computeTodo(
      data({
        fiche: { ...FICHE, clientName: null, shootingDate: null },
        // Un câble dont la longueur est connue comme absente (`lengthM: null`).
        connections: { r1: [{ ...CONNECTIONS[0], lengthM: null } as never, CONNECTIONS[1]], v1: [], r2: [] },
        validationReport: REPORT,
      }),
    );
    expect(todo.map((t) => [t.id, t.severity])).toEqual([
      ["validation:duplicate_label", "danger"],
      ["validation:unlabelled_cable", "warn"],
      ["unplaced:i9", "warn"],
      ["lengths", "warn"],
      ["fiche", "info"],
    ]);
    const [dup, unlabelled, unplaced, lengths, fiche] = todo;
    expect(dup).toMatchObject({ label: "Label en doublon (1)", detail: "V-0101 : Label utilisé deux fois" });
    expect(dup.target).toEqual({ space: "concevoir", tab: "synoptique", objectId: "iss-1" });
    expect(unlabelled.label).toBe("Câble sans label (2)");
    expect(unplaced).toMatchObject({ label: "Placer Moniteur 17 en rack", detail: "Baie 1 · 2 à placer" });
    expect(unplaced.target).toEqual({ space: "concevoir", tab: "rack", objectId: "r1" });
    expect(lengths).toMatchObject({ label: "Renseigner 1 longueur de câble", detail: "V-0101" });
    expect(lengths.target).toEqual({ space: "gerer", page: "cables" });
    expect(fiche).toMatchObject({ label: "Compléter la fiche", detail: "Client, date de tournage" });
    expect(fiche.target).toEqual({ space: "gerer", page: "fiche" });
  });

  test("rien à faire : liste vide ; une longueur absente de l'API n'est pas « manquante »", () => {
    const canvas = { r1: canvasData("r1", "Baie 1", [SLOT, { ...MONITOR_SLOT, inventoryItemId: "i2" }]) };
    const done = data({ racks: [rack("r1", "Baie 1", { bom: [bom("i1", "Caméra X", { heightU: 2 }), bom("i2", "Moniteur 17")] })], canvas });
    expect(computeTodo(done)).toEqual([]);
  });

  test("contenant en lecture : pas de « à placer » supposé", () => {
    expect(computeTodo(data({ canvas: {} })).map((t) => t.id)).toEqual([]);
  });

  test("sans contenant rackable : ni « à placer » ni bilan de rack", () => {
    const d = data({ racks: [LIBRE, CAISSE], canvas: {} });
    expect(computeTodo(d)).toEqual([]);
    const racks = computeDomains(d).find((r) => r.id === "racks")!;
    expect(racks).toMatchObject({ summary: "Aucun contenant rackable", severity: "neutral" });
    expect(placementOf(CAISSE.bom[0], CAISSE, d)).toMatchObject({ status: "container", missing: 0 });
    expect(placementOf(LIBRE.bom[0], LIBRE, d)).toMatchObject({ status: "free", missing: 0 });
  });
});

describe("computeDomains", () => {
  test("une ligne par domaine, chacune avec sa cible", () => {
    const rows = computeDomains(data({ validationReport: REPORT }));
    expect(rows.map((r) => r.label)).toEqual([
      "Fiche",
      "Matériel",
      "Racks",
      "Câblage",
      "Validation",
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
});
