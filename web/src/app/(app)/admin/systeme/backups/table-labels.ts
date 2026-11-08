/**
 * Libellés français des tables d'un fichier .arkyo (aperçu et rapport
 * d'import). L'ordre est celui de l'affichage : projet, contenants, câblage,
 * catalogue, historique. Plusieurs tables peuvent partager un libellé.
 */

const GROUPS: [string, string[]][] = [
  ["Projets", ["Project"]],
  ["Fiches techniques", ["TechnicalSheet"]],
  ["Documents", ["ProjectDocument"]],
  ["Tâches", ["Task"]],
  ["Messages", ["Message"]],
  ["Lieux", ["Location"]],
  ["Régies", ["RigConfig"]],
  ["Contenants", ["Rack"]],
  ["Contenants en régie", ["RigRack"]],
  ["Emplacements", ["RackSlot"]],
  ["Rangées de panel", ["RackSlotPanelRow"]],
  ["Éléments d'inventaire", ["RackInventoryItem"]],
  ["Zones", ["RackZone", "ProjectSynopticZone"]],
  ["Étiquettes", ["RackLabel", "ProjectSynopticLabel"]],
  ["Faisceaux", ["CableBundle", "ProjectCableBundle"]],
  ["Adaptateurs", ["SynopticAdapter", "ProjectSynopticAdapter"]],
  ["Ports externes", ["ExternalPort"]],
  ["Câbles", ["RackConnection", "ProjectConnection"]],
  ["Équipements du projet", ["ProjectEquipment"]],
  ["Repères", ["SynopticGuide"]],
  ["Mises en page du synoptique", ["ProjectSynopticLayout"]],
  ["Panels", ["Panel"]],
  ["Emplacements de panel", ["PanelSlot"]],
  ["Fonctions", ["TenantFunction"]],
  ["Phases", ["TenantPhase"]],
  ["Marques", ["TenantBrand"]],
  ["Catégories d'équipement", ["TenantEquipmentCategory"]],
  ["Types", ["TenantType"]],
  ["Connecteurs", ["TenantConnectorType"]],
  ["Signaux", ["TenantSignalType"]],
  ["Gabarits de dimensions", ["TenantDimensionPreset"]],
  ["Modèles de câble", ["TenantCableModel"]],
  ["Équipements", ["TenantEquipment"]],
  ["Composants d'équipement", ["TenantEquipmentComponent"]],
  ["Câbles du catalogue", ["TenantCable"]],
  ["Adaptateurs du catalogue", ["TenantAdapter"]],
  ["Historique", ["AuditLog"]],
];

/** « Projets 1 · Contenants 3 », libellés regroupés, tables à zéro omises. */
export function summarize(counts: Record<string, number>): string {
  const rest = new Map(Object.entries(counts));
  const parts: string[] = [];
  for (const [label, tables] of GROUPS) {
    let n = 0;
    for (const t of tables) {
      n += rest.get(t) ?? 0;
      rest.delete(t);
    }
    if (n > 0) parts.push(`${label} ${n}`);
  }
  for (const [t, n] of rest) if (n > 0) parts.push(`${t} ${n}`);
  return parts.join(" · ");
}
