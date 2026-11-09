/**
 * Modèle de l'espace Gérer (interface Strata v2, spec v2 §4.2), sans React :
 * position des équipements, « Ce qu'il reste à faire » et lignes de la Vue
 * d'ensemble, calculés sur les données que l'éditeur tient déjà :
 *   - `GET /api/tenant/projects/{id}/editor` (fiche, contenants et leur BOM,
 *     emplacements) ;
 *   - `canvas-data` et inventaire (`racks/{id}/inventory`) des contenants
 *     rackables : slots posés et « à placer », par la règle de l'onglet Rack
 *     d'arkyo (`placement.ts`) ;
 *   - câbles du projet (`useProjectCables`, la liste de la page Câbles) ;
 *   - rapport de validation que le synoptique de CE projet a publié
 *     (`validation-record.ts`), s'il existe.
 *
 * Longueur de câble : arkyo n'en stocke aucune (Ruling 9) ; elle n'est pas une
 * source de « Ce qu'il reste à faire ».
 */

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
import { flattenSlots, rackBilan } from "../bottom/rack-model";
import type { CableRow } from "./cables-model";
import { fmtDay, plural } from "./format";
import { isPlaceable, remainingByItem, type InventoryDto } from "./placement";

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
  /**
   * Tous les câbles du projet (`useProjectCables` : contenants et câbles
   * entre lieux), la même liste que la page Câbles ; `null` avant la
   * première lecture.
   */
  cables: readonly Pick<CableRow, "label">[] | null;
  /** La lecture des câbles a échoué (et aucune liste n'est connue). */
  cablesError?: boolean;
  /** Inventaire par contenant rackable (absent ou `null` : pas encore lu). */
  inventory: Readonly<Record<string, readonly InventoryDto[] | null | undefined>>;
  /** Contenants dont une lecture (`canvas-data` ou inventaire) a échoué. */
  unavailable: Readonly<Record<string, boolean | undefined>>;
  /** Rapport du synoptique de ce projet, et la vue qu'il couvre (« Régie »). */
  validation: { report: ValidationReport; view: string | null } | null;
};

/** Contenant réel où l'on pose en U : rackable, pas un rack virtuel de lieu. */
export const isRackableContainer = (r: Pick<InventaireRack, "isRackable" | "isVirtual">) =>
  r.isRackable && !r.isVirtual;

// ── Position d'une ligne d'inventaire ───────────────────────────────────────

export type Placement = {
  /**
   * - `free` : équipement libre du lieu (rack virtuel) ;
   * - `container` : dans un contenant non rackable ;
   * - `component` : composant d'un châssis ;
   * - `none` : élément qui ne se pose pas (adaptateur…) ;
   * - `loading` : contenant pas encore lu ;
   * - `unavailable` : lecture du contenant en échec ;
   * - `placed` / `partial` / `unplaced` : élément d'un contenant rackable.
   */
  status: "free" | "container" | "component" | "none" | "loading" | "unavailable" | "placed" | "partial" | "unplaced";
  /** Slots posés de la ligne (U de départ, face). */
  slots: Slot[];
  /** Exemplaires encore à poser. */
  missing: number;
};

/** Slots posés d'une ligne d'inventaire (équipement, panel) : en U, ou sur une étagère posée. */
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

/** Restants d'un contenant, calculés une fois par couple (inventaire, `canvas-data`). */
const remainingCache = new WeakMap<readonly InventoryDto[], WeakMap<RackCanvasData, Map<string, number>>>();
function remainingOf(inventory: readonly InventoryDto[], canvas: RackCanvasData): Map<string, number> {
  let byCanvas = remainingCache.get(inventory);
  if (!byCanvas) remainingCache.set(inventory, (byCanvas = new WeakMap()));
  let out = byCanvas.get(canvas);
  if (!out) byCanvas.set(canvas, (out = remainingByItem(inventory, canvas.rack.slots as Slot[])));
  return out;
}

export function placementOf(
  item: InventaireBomItem,
  rack: InventaireRack,
  data: Pick<ManageData, "canvas" | "inventory" | "unavailable">,
): Placement {
  if (item.hostItemId) return { status: "component", slots: [], missing: 0 };
  if (rack.isVirtual) return { status: "free", slots: [], missing: 0 };
  if (!rack.isRackable) return { status: "container", slots: [], missing: 0 };
  if (!isPlaceable(item)) return { status: "none", slots: [], missing: 0 };
  if (data.unavailable[rack.id]) return { status: "unavailable", slots: [], missing: 0 };
  const canvas = data.canvas[rack.id];
  const inventory = data.inventory[rack.id];
  if (!canvas || canvas.rack.id !== rack.id || !inventory) return { status: "loading", slots: [], missing: 0 };
  const slots = placedSlots(canvas, item.id);
  const missing = remainingOf(inventory, canvas).get(item.id) ?? 0;
  return {
    status: missing === 0 ? "placed" : missing < item.quantity ? "partial" : "unplaced",
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

/** Tous les câbles du projet (`null` tant qu'ils ne sont pas lus). */
export function allCables(data: ManageData): readonly Pick<CableRow, "label">[] | null {
  return data.cables;
}

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
  const report = data.validation?.report ?? null;
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

  // Contenants illisibles : leurs « à placer » ne sont pas connus.
  for (const rack of data.racks) {
    if (!isRackableContainer(rack) || !data.unavailable[rack.id]) continue;
    out.push({
      id: `unavailable:${rack.id}`,
      label: `${rack.name} : lecture impossible`,
      detail: "Éléments à placer non comptés",
      severity: "warn",
      target: { space: "concevoir", tab: "rack", objectId: rack.id },
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
  const unreadable = rackable.filter((r) => data.unavailable[r.id]).length;
  const cables = allCables(data);
  const missingFields = missingFicheFields(fiche);

  // Fiche : client, lieu, échéance ; tâches et messages.
  const due =
    fiche.interventionType === "PRESTATION"
      ? fmtDay(fiche.shootingDate) && `tournage le ${fmtDay(fiche.shootingDate)}`
      : fmtDay(fiche.commissioningDate) && `mise en service le ${fmtDay(fiche.commissioningDate)}`;
  const ficheParts = [fiche.clientName?.trim(), fiche.location?.trim(), due].filter(Boolean) as string[];
  if (fiche.counts.tasks > 0) ficheParts.push(plural(fiche.counts.tasks, "tâche"));

  // Matériel.
  const materiel = [
    plural(equipmentCount(data.racks), "équipement"),
    plural(data.locations.length, "emplacement"),
    plural(containers.length, "contenant"),
    ...(unplaced > 0 ? [`${unplaced} à placer`] : []),
    ...(unreadable > 0 ? [`${plural(unreadable, "contenant illisible", "contenants illisibles")}`] : []),
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
  const cablesSummary =
    cables == null
      ? data.cablesError
        ? "Lecture des câbles impossible"
        : "Lecture des câbles…"
      : cables.length === 0
        ? "Aucun câble"
        : [
            plural(cables.length, "câble"),
            ...(unlabelled > 0 ? [`${unlabelled} sans numéro`] : []),
          ].join(" · ");

  // Validation (rapport du synoptique).
  const report = data.validation?.report ?? null;
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
      severity: unplaced + unreadable > 0 ? "warn" : "ok",
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
      severity: cables == null || cables.length === 0 ? "neutral" : unlabelled > 0 ? "warn" : "ok",
      target: { space: "gerer", page: "cables" },
    },
    {
      id: "validation",
      label: data.validation?.view ? `Validation · ${data.validation.view}` : "Validation",
      ...validation,
      aside: "Concevoir",
      target: { space: "concevoir", tab: "synoptique" },
    },
    soon("reseau", "Réseau"),
    soon("livraison", "Livraison"),
    soon("dossier", "Dossier"),
  ];
}
