/**
 * Audit format — traducteur pur d'actions `AuditLog` en libellés lisibles FR.
 *
 * `AuditLog.action` est une chaîne technique (ex. `"rackConnection.renumber"`).
 * Ce module la convertit en `{ label, category }` pour l'UI, sans dépendance
 * Prisma / React. Les actions inconnues retournent la chaîne brute — rien
 * n'est perdu si on ajoute une nouvelle action côté API.
 */

export type AuditCategory =
  | "cable"
  | "slot"
  | "panel"
  | "rack"
  | "zone"
  | "label"
  | "adapter"
  | "bundle"
  | "other";

export type AuditFormatted = {
  label: string;
  category: AuditCategory;
};

const MAP: Record<string, AuditFormatted> = {
  // Rack
  "rack.create": { label: "Création du rack", category: "rack" },
  "rack.update": { label: "Modification du rack", category: "rack" },
  "rack.delete": { label: "Suppression du rack", category: "rack" },

  // Slots
  "rackSlot.create": { label: "Ajout d'un slot", category: "slot" },
  "rackSlot.update": { label: "Modification d'un slot", category: "slot" },
  "rackSlot.delete": { label: "Suppression d'un slot", category: "slot" },
  "rackSlot.clearAll": { label: "Vidage du rack", category: "rack" },

  // Panel rows
  "rackSlotPanelRow.upsert": { label: "Mise à jour d'une rangée de panel", category: "panel" },

  // Connexions (câbles)
  "rackConnection.create": { label: "Création d'un câble", category: "cable" },
  "rackConnection.update": { label: "Modification d'un câble", category: "cable" },
  "rackConnection.delete": { label: "Suppression d'un câble", category: "cable" },
  "rackConnection.renumber": { label: "Renumérotation auto", category: "cable" },
  "rackConnection.manualNumber": { label: "Numérotation manuelle", category: "cable" },
  "rackConnection.clearLabels": { label: "Effacement des labels", category: "cable" },

  // Zones / labels / adapters / bundles
  "rackZone.create": { label: "Création d'une zone", category: "zone" },
  "rackZone.update": { label: "Modification d'une zone", category: "zone" },
  "rackZone.delete": { label: "Suppression d'une zone", category: "zone" },
  "rackLabel.create": { label: "Ajout d'un label", category: "label" },
  "rackLabel.update": { label: "Modification d'un label", category: "label" },
  "rackLabel.delete": { label: "Suppression d'un label", category: "label" },
  "rackAdapter.create": { label: "Ajout d'un adaptateur", category: "adapter" },
  "rackAdapter.update": { label: "Modification d'un adaptateur", category: "adapter" },
  "rackAdapter.delete": { label: "Suppression d'un adaptateur", category: "adapter" },
  "cableBundle.create": { label: "Création d'un bundle", category: "bundle" },
  "cableBundle.update": { label: "Modification d'un bundle", category: "bundle" },
  "cableBundle.delete": { label: "Suppression d'un bundle", category: "bundle" },
};

export function formatAuditAction(action: string): AuditFormatted {
  return MAP[action] ?? { label: action, category: "other" };
}

/** Grouper une liste de logs par jour (YYYY-MM-DD, timezone locale). */
export function groupByDay<T extends { createdAt: Date | string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const d = typeof it.createdAt === "string" ? new Date(it.createdAt) : it.createdAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  return groups;
}
