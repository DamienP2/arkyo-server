/**
 * Projet de test de l'espace Gérer : réponses d'API de l'éditeur projet
 * (`/editor`, `canvas-data`, câbles…) pour le banc `renderApp`.
 */

import { OWNER_PERMS, signedInApi, type Api } from "@/tests/app-harness";
import type { UiInterface } from "@/strata/interface-context";
import { CONNECTIONS, MONITOR_SLOT, SLOT, canvasData } from "../bottom/test-fixtures";

export const HEADER = {
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

export function bomItem(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "equipment",
    refId: "eq1",
    quantity: 1,
    name,
    reference: "CX-1",
    brandName: "Sony",
    category: "Vidéo",
    categoryColor: "#3b82f6",
    isRackable: true,
    heightU: 2,
    depthMm: 300,
    weightKg: 5,
    powerW: 100,
    snapshotId: null,
    ...extra,
  };
}

export function rack(id: string, name: string, extra: Record<string, unknown> = {}) {
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

/** Baie 1 : la caméra posée (U1), trois moniteurs dont un posé (U10) et deux à placer. */
export const BAIE = rack("r1", "Baie 1", {
  bom: [
    bomItem("i1", "Caméra X"),
    bomItem("i2", "Moniteur 17", { refId: "eq2", reference: "MON-17", brandName: "TVLogic", heightU: 1, quantity: 3 }),
  ],
});

/** `GET …/racks/r1/inventory` de la Baie 1. */
export const BAIE_INVENTORY = [
  { id: "i1", kind: "equipment", refId: "eq1", quantity: 1, hostItemId: null },
  { id: "i2", kind: "equipment", refId: "eq2", quantity: 3, hostItemId: null },
];
/** Équipements libres du lieu (rack virtuel). */
export const LIBRE = rack("v1", "", {
  isVirtual: true,
  isRackable: false,
  bom: [bomItem("i5", "Ordinateur", { refId: "eq3", isRackable: false, heightU: null })],
});
/** Contenant non rackable. */
export const CAISSE = rack("r2", "Caisse", {
  isRackable: false,
  bom: [bomItem("i6", "Intercom", { refId: "eq3", quantity: 3, isRackable: false, heightU: null })],
});

const GHOSTS = [
  { ...MONITOR_SLOT, id: "g1", inventoryItemId: "i2", startU: null, heightU: null },
  { ...MONITOR_SLOT, id: "g2", inventoryItemId: "i2", startU: null, heightU: null },
];
export const BAIE_CANVAS = canvasData("r1", "Baie 1", [SLOT, { ...MONITOR_SLOT, inventoryItemId: "i2" }, ...GHOSTS]);

export function editor(racks: unknown[], ficheExtra: Record<string, unknown> = {}) {
  return {
    header: HEADER,
    fiche: {
      ...HEADER,
      shootingEndDate: null,
      planningStart: null,
      planningEnd: null,
      commissioningDate: null,
      description: null,
      documents: [
        {
          id: "d1",
          name: "Plan de feu.pdf",
          url: "/uploads/d1.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          uploadedAt: "2026-11-01T10:00:00.000Z",
        },
      ],
      counts: { tasks: 2, messages: 0, documents: 1 },
      ...ficheExtra,
    },
    inventaire: {
      rigConfigId: "rc1",
      racks,
      locations: [{ id: "l1", name: "Régie", cableCode: "REG", sortOrder: 0, virtualRackId: "v1" }],
    },
    cartographie: { maps: [] },
  };
}

export function manageApi(iface: UiInterface, racks: unknown[] = [BAIE, LIBRE, CAISSE], extra: Api = {}): Api {
  return {
    ...signedInApi(OWNER_PERMS, "Régie A", iface),
    "GET /api/tenant/projects/p1/editor": { body: editor(racks) },
    "GET /api/tenant/projects/p1": { body: { ...HEADER, createdById: "u1", documents: [], rigConfigs: [] } },
    "GET /api/tenant/members": { body: [{ id: "u1", name: "Admin", email: "admin@regie.fr" }] },
    "GET /api/tenant/projects/p1/racks/r1/canvas-data": { body: BAIE_CANVAS },
    "GET /api/tenant/projects/p1/racks/r2/canvas-data": { body: canvasData("r2", "Caisse", []) },
    "GET /api/tenant/projects/p1/racks/v1/canvas-data": { body: canvasData("v1", "", []) },
    "GET /api/tenant/projects/p1/racks/r1/inventory": { body: { items: BAIE_INVENTORY } },
    "GET /api/racks/r1/connections": { body: CONNECTIONS },
    "GET /api/racks/r2/connections": { body: [] },
    "GET /api/racks/v1/connections": { body: [] },
    "GET /api/tenant/projects/p1/audit": { body: [] },
    "GET /api/tenant/projects/p1/inventaire/catalog": { body: { equipments: [], panels: [], adapters: [] } },
    "GET /api/tenant/espace/informations": { body: { name: "Régie A", logoUrl: null } },
    ...extra,
  };
}

/**
 * URL comparable : paramètres triés, sans le `tab=inventaire` que l'éditeur
 * ajoute de lui-même quand `?tab=` manque (onglet par défaut, comme en
 * Classique), à un moment qui dépend du rendu.
 */
export function normUrl(url: string): string {
  const u = new URL(url, "http://localhost");
  const q = [...u.searchParams.entries()].filter(([k, v]) => !(k === "tab" && v === "inventaire"));
  q.sort(([a], [b]) => a.localeCompare(b));
  return u.pathname + (q.length ? `?${new URLSearchParams(q).toString()}` : "");
}
