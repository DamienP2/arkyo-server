/**
 * Backup — sauvegarde/restauration JSON du catalogue tenant.
 *
 * Ce module est 100% TypeScript pur : aucune dépendance à Prisma, React ou
 * Next.js. Il définit le format de fichier `arkyo-backup` (v1) et les
 * fonctions de validation/synthèse utilisées à la fois par les routes API
 * (`app/api/tenant/parametres/backup/**`) et par l'UI (parsing côté client
 * avant upload).
 *
 * Cf. spec : `docs/superpowers/specs/2026-07-08-import-export-backup-design.md`.
 *
 * Contrat d'API stable — l'UI est développée en parallèle contre ces exports
 * exacts, ne pas renommer sans coordination.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type BackupSectionKey = "equipment" | "cables" | "adapters" | "settings";

export type RestoreMode = "merge" | "replace";

export type ArkyoBackupMeta = {
  format: "arkyo-backup";
  version: 1;
  exportedAt: string;
  sections: BackupSectionKey[];
};

export type ArkyoBackup = {
  meta: ArkyoBackupMeta;
  data: {
    equipment?: unknown[];
    cables?: unknown[];
    adapters?: unknown[];
    settings?: Record<string, unknown[]>;
  };
};

export type RestoreSectionReport = {
  created: number;
  updated: number;
  deleted: number;
};

export type RestoreReport = Partial<Record<BackupSectionKey, RestoreSectionReport>>;

// ─── Sections ────────────────────────────────────────────────────────────────

export const BACKUP_SECTIONS: { key: BackupSectionKey; label: string }[] = [
  { key: "equipment", label: "Équipements" },
  { key: "cables", label: "Câbles" },
  { key: "adapters", label: "Adaptateurs" },
  { key: "settings", label: "Paramètres" },
];

const BACKUP_SECTION_KEYS: readonly BackupSectionKey[] = BACKUP_SECTIONS.map((s) => s.key);

function isBackupSectionKey(value: unknown): value is BackupSectionKey {
  return typeof value === "string" && (BACKUP_SECTION_KEYS as string[]).includes(value);
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Valide la forme d'un fichier de sauvegarde brut (JSON.parse non typé).
 * Ne valide PAS le contenu détaillé de chaque ligne (délégué à Prisma /
 * l'allowlist de champs côté route restore) — uniquement l'enveloppe
 * `meta`/`data` et le typage grossier des sections.
 */
export function validateBackupFile(
  raw: unknown,
): { ok: true; backup: ArkyoBackup } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Fichier invalide : ce n'est pas un objet JSON." };
  }
  const obj = raw as Record<string, unknown>;

  const meta = obj.meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return { ok: false, error: "Fichier invalide : section « meta » manquante ou incorrecte." };
  }
  const metaObj = meta as Record<string, unknown>;

  if (metaObj.format !== "arkyo-backup") {
    return {
      ok: false,
      error: "Ce fichier n'est pas une sauvegarde Arkyo (format inconnu).",
    };
  }

  if (metaObj.version !== 1) {
    return {
      ok: false,
      error: `Version de sauvegarde non prise en charge (${String(metaObj.version)}).`,
    };
  }

  if (typeof metaObj.exportedAt !== "string" || metaObj.exportedAt.trim() === "") {
    return { ok: false, error: "Fichier invalide : date d'export manquante." };
  }

  if (!Array.isArray(metaObj.sections) || metaObj.sections.length === 0) {
    return { ok: false, error: "Fichier invalide : aucune section déclarée." };
  }
  for (const s of metaObj.sections) {
    if (!isBackupSectionKey(s)) {
      return { ok: false, error: `Fichier invalide : section inconnue « ${String(s)} ».` };
    }
  }

  const data = obj.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "Fichier invalide : section « data » manquante ou incorrecte." };
  }
  const dataObj = data as Record<string, unknown>;

  for (const key of ["equipment", "cables", "adapters"] as const) {
    if (key in dataObj && dataObj[key] !== undefined && !Array.isArray(dataObj[key])) {
      return { ok: false, error: `Fichier invalide : la section « ${key} » doit être une liste.` };
    }
  }

  if ("settings" in dataObj && dataObj.settings !== undefined) {
    const settings = dataObj.settings;
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      return { ok: false, error: "Fichier invalide : la section « settings » doit être un objet." };
    }
    for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
      if (!Array.isArray(v)) {
        return {
          ok: false,
          error: `Fichier invalide : « settings.${k} » doit être une liste.`,
        };
      }
    }
  }

  return {
    ok: true,
    backup: {
      meta: {
        format: "arkyo-backup",
        version: 1,
        exportedAt: metaObj.exportedAt,
        sections: metaObj.sections as BackupSectionKey[],
      },
      data: dataObj as ArkyoBackup["data"],
    },
  };
}

// ─── Synthèse ────────────────────────────────────────────────────────────────

/**
 * Compteurs par section présente dans le fichier — pour l'écran de
 * vérification côté restauration. `settings` = somme des tailles de tous
 * les sous-tableaux (marques, connecteurs, signaux…).
 */
export function backupSummary(backup: ArkyoBackup): Partial<Record<BackupSectionKey, number>> {
  const result: Partial<Record<BackupSectionKey, number>> = {};

  if (backup.data.equipment !== undefined) result.equipment = backup.data.equipment.length;
  if (backup.data.cables !== undefined) result.cables = backup.data.cables.length;
  if (backup.data.adapters !== undefined) result.adapters = backup.data.adapters.length;
  if (backup.data.settings !== undefined) {
    let total = 0;
    for (const arr of Object.values(backup.data.settings)) {
      total += Array.isArray(arr) ? arr.length : 0;
    }
    result.settings = total;
  }

  return result;
}

// ─── Nommage fichier ─────────────────────────────────────────────────────────

/** `arkyo-sauvegarde-AAAA-MM-JJ.json` — date locale du poste appelant. */
export function backupFilename(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `arkyo-sauvegarde-${y}-${m}-${d}.json`;
}
