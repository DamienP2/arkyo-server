import { describe, expect, it } from "vitest";
import {
  BACKUP_SECTIONS,
  backupFilename,
  backupSummary,
  validateBackupFile,
  type ArkyoBackup,
} from "@/lib/services/backup";

function makeValidBackup(overrides?: Partial<ArkyoBackup["data"]>): unknown {
  return {
    meta: {
      format: "arkyo-backup",
      version: 1,
      exportedAt: "2026-07-08T10:00:00.000Z",
      sections: ["equipment", "cables", "adapters", "settings"],
    },
    data: {
      equipment: [{ id: "eq1" }, { id: "eq2" }],
      cables: [{ id: "cb1" }],
      adapters: [],
      settings: {
        brands: [{ id: "br1" }],
        connectors: [{ id: "co1" }, { id: "co2" }],
        appConfig: [],
      },
      ...overrides,
    },
  };
}

describe("BACKUP_SECTIONS", () => {
  it("expose les 4 sections avec labels FR", () => {
    expect(BACKUP_SECTIONS).toEqual([
      { key: "equipment", label: "Équipements" },
      { key: "cables", label: "Câbles" },
      { key: "adapters", label: "Adaptateurs" },
      { key: "settings", label: "Paramètres" },
    ]);
  });
});

describe("validateBackupFile", () => {
  it("accepte un fichier de sauvegarde valide", () => {
    const result = validateBackupFile(makeValidBackup());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.backup.meta.format).toBe("arkyo-backup");
      expect(result.backup.meta.sections).toEqual([
        "equipment",
        "cables",
        "adapters",
        "settings",
      ]);
      expect(result.backup.data.equipment).toHaveLength(2);
    }
  });

  it("accepte un fichier partiel (une seule section)", () => {
    const raw = {
      meta: {
        format: "arkyo-backup",
        version: 1,
        exportedAt: "2026-07-08T10:00:00.000Z",
        sections: ["equipment"],
      },
      data: { equipment: [{ id: "eq1" }] },
    };
    const result = validateBackupFile(raw);
    expect(result.ok).toBe(true);
  });

  it("rejette un objet racine invalide", () => {
    const result = validateBackupFile(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/objet JSON/i);
  });

  it("rejette un tableau en racine", () => {
    const result = validateBackupFile([1, 2, 3]);
    expect(result.ok).toBe(false);
  });

  it("rejette un format inconnu", () => {
    const raw = makeValidBackup() as { meta: Record<string, unknown> };
    raw.meta.format = "not-arkyo";
    const result = validateBackupFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/format inconnu/i);
  });

  it("rejette une version non supportée", () => {
    const raw = makeValidBackup() as { meta: Record<string, unknown> };
    raw.meta.version = 2;
    const result = validateBackupFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/version/i);
  });

  it("rejette une section inconnue dans meta.sections", () => {
    const raw = makeValidBackup() as { meta: Record<string, unknown> };
    raw.meta.sections = ["equipment", "projects"];
    const result = validateBackupFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/section inconnue/i);
  });

  it("rejette data malformée (equipment non-tableau)", () => {
    const raw = makeValidBackup() as { data: Record<string, unknown> };
    raw.data.equipment = { id: "eq1" };
    const result = validateBackupFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/liste/i);
  });

  it("rejette settings malformée (sous-clé non-tableau)", () => {
    const raw = makeValidBackup() as { data: { settings: Record<string, unknown> } };
    raw.data.settings.brands = { id: "br1" };
    const result = validateBackupFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/settings\.brands/i);
  });

  it("rejette une meta absente", () => {
    const result = validateBackupFile({ data: {} });
    expect(result.ok).toBe(false);
  });

  it("rejette une data absente", () => {
    const result = validateBackupFile({
      meta: {
        format: "arkyo-backup",
        version: 1,
        exportedAt: "2026-07-08T10:00:00.000Z",
        sections: ["equipment"],
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe("backupSummary", () => {
  it("compte chaque section présente", () => {
    const result = validateBackupFile(makeValidBackup());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(backupSummary(result.backup)).toEqual({
      equipment: 2,
      cables: 1,
      adapters: 0,
      settings: 3, // brands(1) + connectors(2) + appConfig(0)
    });
  });

  it("ignore les sections absentes du fichier", () => {
    const raw = {
      meta: {
        format: "arkyo-backup",
        version: 1,
        exportedAt: "2026-07-08T10:00:00.000Z",
        sections: ["equipment"],
      },
      data: { equipment: [{ id: "eq1" }, { id: "eq2" }, { id: "eq3" }] },
    };
    const result = validateBackupFile(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(backupSummary(result.backup)).toEqual({ equipment: 3 });
  });

  it("somme correctement des settings avec plusieurs sous-tableaux vides", () => {
    const raw = {
      meta: {
        format: "arkyo-backup",
        version: 1,
        exportedAt: "2026-07-08T10:00:00.000Z",
        sections: ["settings"],
      },
      data: { settings: { brands: [], connectors: [], signals: [] } },
    };
    const result = validateBackupFile(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(backupSummary(result.backup)).toEqual({ settings: 0 });
  });
});

describe("backupFilename", () => {
  it("formate AAAA-MM-JJ avec zero-padding", () => {
    expect(backupFilename(new Date(2026, 6, 8))).toBe("arkyo-sauvegarde-2026-07-08.json");
  });

  it("zero-pad les mois/jours à un chiffre", () => {
    expect(backupFilename(new Date(2026, 0, 5))).toBe("arkyo-sauvegarde-2026-01-05.json");
  });
});
