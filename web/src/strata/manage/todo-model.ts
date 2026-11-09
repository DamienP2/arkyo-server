/**
 * Modèle de l'espace Gérer (interface Strata v2, spec v2 §4.2), sans React :
 * position des équipements, « Ce qu'il reste à faire » et lignes de la Vue
 * d'ensemble, calculés sur les données que l'éditeur tient déjà :
 *   - `GET /api/tenant/projects/{id}/editor` (fiche, contenants et leur BOM,
 *     emplacements) ;
 *   - `canvas-data` des contenants rackables (slots, dont les slots fantômes
 *     `startU = null` des équipements ajoutés mais pas encore posés, liés à
 *     leur ligne d'inventaire par `inventoryItemId`) ;
 *   - câbles de chaque contenant (`GET /api/racks/{id}/connections`) ;
 *   - rapport de validation que le synoptique publie
 *     (`useTopbarActions().validationReport`), s'il existe.
 *
 * Longueur de câble : arkyo n'en stocke aucune (ni colonne `RackConnection`,
 * ni champ d'API ; seule une estimation est calculée sur le rack). Une
 * longueur n'est « manquante » que si la ligne de câble porte le champ
 * `lengthM` à `null` ; absent, il n'est pas connu et rien n'est signalé.
 */

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import type { ProjectFicheData } from "@/app/(fullscreen)/project/[id]/fiche/fiche-client";
import type {
  InventaireBomItem,
  InventaireLocation,
  InventaireRack,
} from "@/app/(fullscreen)/project/[id]/inventaire/inventaire-client";
import type { RackCanvasData } from "@/app/(fullscreen)/project/[id]/rack/rack-tab-client";
import type { ProjectTabId } from "@/app/(fullscreen)/project/[id]/_editor/tab-bar";
import type { Slot } from "@/components/synoptique/lib/types";
import type { IssueKind, IssueSeverity, ValidationReport } from "@/lib/services/rack-validation";
import { flattenSlots, rackBilan, type RackConnectionRow } from "../bottom/rack-model";

// ── Pages et cibles ─────────────────────────────────────────────────────────

export const MANAGE_PAGES = ["overview", "fiche", "materiel", "cables", "reseau", "livraison", "dossier"] as const;
export type ManagePage = (typeof MANAGE_PAGES)[number];

export const isManagePage = (v: unknown): v is ManagePage =>
  typeof v === "string" && (MANAGE_PAGES as readonly string[]).includes(v);

/** Objet visé par une ligne : un onglet de Concevoir, ou une page (et un objet) de Gérer. */
export type TodoTarget = {
  space: "concevoir" | "gerer";
  tab?: ProjectTabId;
  page?: ManagePage;
  /** Concevoir › Racks : le contenant ; Concevoir › Synoptique : le contrôle ; Gérer : l'objet de la page. */
  objectId?: string;
};

export type TodoSeverity = "danger" | "warn" | "info";

export type TodoItem = {
  id: string;
  label: string;
  detail: string;
  severity: TodoSeverity;
  target: TodoTarget;
};

// ── Données ─────────────────────────────────────────────────────────────────

export type ManageData = {
  fiche: ProjectFicheData;
  /** Tous les contenants du projet, racks virtuels des lieux compris. */
  racks: readonly InventaireRack[];
  locations: readonly InventaireLocation[];
  /** `canvas-data` par contenant (absent ou `null` : pas encore lu). */
  canvas: Readonly<Record<string, RackCanvasData | null | undefined>>;
  /** Câbles par contenant (absent ou `null` : pas encore lus). */
  connections: Readonly<Record<string, readonly RackConnectionRow[] | null | undefined>>;
  validationReport: ValidationReport | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Contenant réel où l'on pose en U : rackable, pas un rack virtuel de lieu. */
export const isRackableContainer = (r: Pick<InventaireRack, "isRackable" | "isVirtual">) =>
  r.isRackable && !r.isVirtual;

// ── Position d'une ligne d'inventaire ───────────────────────────────────────

export type Placement = {
  /**
   * - `free` : équipement libre du lieu (rack virtuel) ;
   * - `container` : dans un contenant non rackable ;
   * - `component` : composant d'un châssis ;
   * - `none` : élément qui ne se pose pas en U (adaptateur, accessoire…) ;
   * - `loading` : contenant pas encore lu ;
   * - `placed` / `partial` / `unplaced` : équipement d'un contenant rackable.
   */
  status: "free" | "container" | "component" | "none" | "loading" | "placed" | "partial" | "unplaced";
  /** Slots posés de la ligne (U de départ, face). */
  slots: Slot[];
  /** Exemplaires encore à poser. */
  missing: number;
};

/** Slots posés d'une ligne d'inventaire : en U, ou sur une étagère posée. */
function placedSlots(canvas: RackCanvasData, itemId: string): Slot[] {
  const all = canvas.rack.slots as Slot[];
  const byId = new Map(flattenSlots(all).map((s) => [s.id, s]));
  return flattenSlots(all).filter((s) => {
    if ((s as Slot & { inventoryItemId?: string | null }).inventoryItemId !== itemId) return false;
    if (s.startU != null) return true;
    const parent = s.parentSlotId ? byId.get(s.parentSlotId) : undefined;
    return parent?.startU != null;
  });
}

/** Un équipement qui se pose dans un rack (arkyo : `BomItemsList` de l'onglet Rack). */
function placeable(item: InventaireBomItem): boolean {
  if (item.kind !== "equipment" || item.hostItemId) return false;
  // Rackable sans hauteur connue : impossible à poser en U (arkyo l'écarte aussi).
  return !(item.isRackable && !(item.heightU != null && item.heightU > 0));
}

export function placementOf(
  item: InventaireBomItem,
  rack: InventaireRack,
  data: Pick<ManageData, "canvas">,
): Placement {
  if (item.hostItemId) return { status: "component", slots: [], missing: 0 };
  if (rack.isVirtual) return { status: "free", slots: [], missing: 0 };
  if (!rack.isRackable) return { status: "container", slots: [], missing: 0 };
  if (!placeable(item)) return { status: "none", slots: [], missing: 0 };
  const canvas = data.canvas[rack.id];
  if (!canvas || canvas.rack.id !== rack.id) return { status: "loading", slots: [], missing: 0 };
  const slots = placedSlots(canvas, item.id);
  const missing = Math.max(0, item.quantity - slots.length);
  return {
    status: missing === 0 ? "placed" : slots.length > 0 ? "partial" : "unplaced",
    slots,
    missing,
  };
}

/** U de départ d'un slot posé (celui de l'étagère qui le porte, à défaut). */
export function slotStartU(slot: Slot, canvas: RackCanvasData | null | undefined): number | null {
  if (slot.startU != null) return slot.startU;
  const parent = slot.parentSlotId
    ? flattenSlots(canvas?.rack.slots ?? []).find((s) => s.id === slot.parentSlotId)
    : undefined;
  return parent?.startU ?? null;
}

export type Unplaced = { item: InventaireBomItem; rack: InventaireRack; missing: number };

export function unplacedItems(data: ManageData): Unplaced[] {
  const out: Unplaced[] = [];
  for (const rack of data.racks) {
    if (!isRackableContainer(rack)) continue;
    for (const item of rack.bom) {
      const p = placementOf(item, rack, data);
      if (p.missing > 0) out.push({ item, rack, missing: p.missing });
    }
  }
  return out;
}

// ── Fiche ───────────────────────────────────────────────────────────────────

/**
 * Champs de fiche attendus pour un projet prêt : client, lieu, et la date qui
 * fixe l'échéance (début de tournage en prestation, mise en service en
 * intégration). Les autres champs d'arkyo restent facultatifs.
 */
export function missingFicheFields(fiche: ProjectFicheData): string[] {
  const out: string[] = [];
  if (!fiche.clientName?.trim()) out.push("client");
  if (!fiche.location?.trim()) out.push("lieu");
  if (fiche.interventionType === "PRESTATION") {
    if (!fiche.shootingDate) out.push("date de tournage");
  } else if (!fiche.commissioningDate) out.push("date de mise en service");
  return out;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Câbles ──────────────────────────────────────────────────────────────────

/** Tous les câbles connus des contenants (`null` tant qu'un contenant n'est pas lu). */
export function allCables(data: ManageData): RackConnectionRow[] | null {
  const out: RackConnectionRow[] = [];
  for (const r of data.racks) {
    const rows = data.connections[r.id];
    if (rows == null) return null;
    out.push(...rows);
  }
  return out;
}

/** Longueur connue comme manquante (voir l'en-tête : champ présent et `null`). */
const lengthMissing = (c: RackConnectionRow) => "lengthM" in c && (c as { lengthM?: unknown }).lengthM == null;

// ── Validation ──────────────────────────────────────────────────────────────

/** Libellés et ordre des contrôles du synoptique d'arkyo (`validation-panel.tsx`). */
export const CHECK_LABEL: Record<IssueKind, string> = {
  missing_slot: "Slot manquant",
  missing_port: "Port manquant",
  duplicate_label: "Label en doublon",
  port_overused: "Port sur-utilisé",
  signal_mismatch: "Signal incompatible",
  panel_partial: "Panel partiellement câblé",
  orphan_adapter: "Adaptateur non câblé",
  unlabelled_cable: "Câble sans label",
  panel_unused: "Panel non utilisé",
  empty_slot: "Slot vide",
  equipment_unused: "Équipement non câblé",
  empty_zone: "Zone vide",
  unnamed_zone: "Zone sans nom",
};

const SEVERITY: Record<IssueSeverity, TodoSeverity> = { error: "danger", warning: "warn", info: "info" };
const RANK: Record<TodoSeverity, number> = { danger: 0, warn: 1, info: 2 };

// ── Ce qu'il reste à faire ──────────────────────────────────────────────────

export function computeTodo(data: ManageData): TodoItem[] {
  const out: TodoItem[] = [];

  // Contrôles de validation, un par contrôle (dans l'ordre du synoptique).
  const report = data.validationReport;
  if (report) {
    for (const kind of Object.keys(CHECK_LABEL) as IssueKind[]) {
      const issues = report.issues.filter((i) => i.kind === kind);
      if (issues.length === 0) continue;
      const worst = issues.some((i) => i.severity === "error")
        ? "error"
        : issues.some((i) => i.severity === "warning")
          ? "warning"
          : "info";
      out.push({
        id: `validation:${kind}`,
        label: `${CHECK_LABEL[kind]} (${issues.length})`,
        detail: issues
          .slice(0, 2)
          .map((i) => (i.subject ? `${i.subject} : ${i.message}` : i.message))
          .join(" ; "),
        severity: SEVERITY[worst],
        target: { space: "concevoir", tab: "synoptique", objectId: issues[0].id },
      });
    }
  }

  // Équipements ajoutés à un contenant rackable mais pas posés.
  for (const { item, rack, missing } of unplacedItems(data)) {
    out.push({
      id: `unplaced:${item.id}`,
      label: `Placer ${item.name} en rack`,
      detail: `${rack.name} · ${missing} à placer`,
      severity: "warn",
      target: { space: "concevoir", tab: "rack", objectId: rack.id },
    });
  }

  // Longueurs de câble manquantes.
  const noLength = (allCables(data) ?? []).filter(lengthMissing);
  if (noLength.length > 0) {
    out.push({
      id: "lengths",
      label: `Renseigner ${plural(noLength.length, "longueur")} de câble`,
      detail: noLength
        .slice(0, 6)
        .map((c) => c.label?.trim() || "sans numéro")
        .join(", "),
      severity: "warn",
      target: { space: "gerer", page: "cables" },
    });
  }

  // Fiche incomplète.
  const missingFields = missingFicheFields(data.fiche);
  if (missingFields.length > 0) {
    out.push({
      id: "fiche",
      label: "Compléter la fiche",
      detail: capitalize(missingFields.join(", ")),
      severity: "info",
      target: { space: "gerer", page: "fiche" },
    });
  }

  // Les plus graves d'abord ; à gravité égale, l'ordre des sources.
  return out
    .map((t, i) => ({ t, i }))
    .sort((a, b) => RANK[a.t.severity] - RANK[b.t.severity] || a.i - b.i)
    .map(({ t }) => t);
}

// ── Vue d'ensemble : une ligne par domaine ──────────────────────────────────

export type DomainId = "fiche" | "materiel" | "racks" | "cables" | "validation" | "reseau" | "livraison" | "dossier";

export type DomainRow = {
  id: DomainId;
  label: string;
  summary: string;
  /** Espace de la cible quand elle n'est pas dans Gérer (« Concevoir »). */
  aside: string | null;
  severity: "danger" | "warn" | "ok" | "neutral";
  target: TodoTarget;
};

const fmtDate = (iso: string | null) => (iso ? format(new Date(iso), "d MMM yyyy", { locale: fr }) : null);
const fmtInt = (n: number) => Math.round(n).toLocaleString("fr-FR");

/** Nombre d'équipements (exemplaires) du projet, libres compris. */
export function equipmentCount(racks: readonly InventaireRack[]): number {
  return racks.reduce((n, r) => n + r.bom.filter((i) => i.kind === "equipment").reduce((m, i) => m + i.quantity, 0), 0);
}

export function computeDomains(data: ManageData): DomainRow[] {
  const { fiche } = data;
  const containers = data.racks.filter((r) => !r.isVirtual);
  const rackable = data.racks.filter(isRackableContainer);
  const unplaced = unplacedItems(data).reduce((n, u) => n + u.missing, 0);
  const cables = allCables(data);
  const missingFields = missingFicheFields(fiche);

  // Fiche : client, lieu, échéance ; tâches et messages.
  const due =
    fiche.interventionType === "PRESTATION"
      ? fmtDate(fiche.shootingDate) && `tournage le ${fmtDate(fiche.shootingDate)}`
      : fmtDate(fiche.commissioningDate) && `mise en service le ${fmtDate(fiche.commissioningDate)}`;
  const ficheParts = [fiche.clientName?.trim(), fiche.location?.trim(), due].filter(Boolean) as string[];
  if (fiche.counts.tasks > 0) ficheParts.push(plural(fiche.counts.tasks, "tâche"));

  // Matériel.
  const materiel = [
    plural(equipmentCount(data.racks), "équipement"),
    plural(data.locations.length, "emplacement"),
    plural(containers.length, "contenant"),
    ...(unplaced > 0 ? [`${unplaced} à placer`] : []),
  ].join(" · ");

  // Racks : U occupés et puissance des équipements posés (bilan d'arkyo).
  let racksSummary = "Aucun contenant rackable";
  if (rackable.length > 0) {
    let used = 0;
    let total = 0;
    let power = 0;
    let known = true;
    for (const r of rackable) {
      const canvas = data.canvas[r.id];
      if (!canvas || canvas.rack.id !== r.id) {
        known = false;
        total += r.totalU;
        continue;
      }
      const placed = (canvas.rack.slots as Slot[]).filter((s) => s.startU != null);
      const bilan = rackBilan(canvas, placed);
      used += bilan.usedU;
      total += bilan.totalU;
      power += bilan.powerW;
    }
    racksSummary = [
      plural(rackable.length, "contenant rackable", "contenants rackables"),
      known ? `${used}/${total} U` : `${total} U`,
      ...(known ? [`${fmtInt(power)} W`] : []),
    ].join(" · ");
  }

  // Câblage.
  const unlabelled = cables?.filter((c) => !c.label?.trim()).length ?? 0;
  const noLength = cables?.filter(lengthMissing).length ?? 0;
  const cablesSummary =
    cables == null
      ? "Lecture des câbles…"
      : cables.length === 0
        ? "Aucun câble"
        : [
            plural(cables.length, "câble"),
            ...(unlabelled > 0 ? [`${unlabelled} sans numéro`] : []),
            ...(noLength > 0 ? [`${plural(noLength, "longueur")} ${noLength > 1 ? "manquantes" : "manquante"}`] : []),
          ].join(" · ");

  // Validation (rapport du synoptique).
  const report = data.validationReport;
  let validation: Pick<DomainRow, "summary" | "severity">;
  if (!report) validation = { summary: "Aucun rapport", severity: "neutral" };
  else if (report.counts.error + report.counts.warning === 0)
    validation = { summary: "Conforme aux contrôles", severity: "ok" };
  else
    validation = {
      summary: [
        ...(report.counts.error > 0 ? [plural(report.counts.error, "erreur")] : []),
        plural(report.counts.warning, "avertissement"),
      ].join(" · "),
      severity: report.counts.error > 0 ? "danger" : "warn",
    };

  const soon = (id: DomainId, label: string): DomainRow => ({
    id,
    label,
    summary: "Bientôt disponible",
    aside: null,
    severity: "neutral",
    target: { space: "gerer", page: id as ManagePage },
  });

  return [
    {
      id: "fiche",
      label: "Fiche",
      summary: ficheParts.join(" · ") || "Fiche vide",
      aside: null,
      severity: missingFields.length > 0 ? "warn" : "ok",
      target: { space: "gerer", page: "fiche" },
    },
    {
      id: "materiel",
      label: "Matériel",
      summary: materiel,
      aside: null,
      severity: unplaced > 0 ? "warn" : "ok",
      target: { space: "gerer", page: "materiel" },
    },
    {
      id: "racks",
      label: "Racks",
      summary: racksSummary,
      aside: "Concevoir",
      severity: rackable.length > 0 ? "ok" : "neutral",
      target: { space: "concevoir", tab: "rack" },
    },
    {
      id: "cables",
      label: "Câblage",
      summary: cablesSummary,
      aside: null,
      severity: cables == null || cables.length === 0 ? "neutral" : unlabelled + noLength > 0 ? "warn" : "ok",
      target: { space: "gerer", page: "cables" },
    },
    {
      id: "validation",
      label: "Validation",
      ...validation,
      aside: "Concevoir",
      target: { space: "concevoir", tab: "synoptique" },
    },
    soon("reseau", "Réseau"),
    soon("livraison", "Livraison"),
    soon("dossier", "Dossier"),
  ];
}
