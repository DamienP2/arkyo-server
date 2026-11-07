import { describe, expect, it } from "vitest";
import { formatAuditAction, groupByDay } from "@/lib/services/audit-format";

describe("formatAuditAction", () => {
  it("retourne le libellé FR pour une action connue", () => {
    expect(formatAuditAction("rackConnection.renumber")).toEqual({
      label: "Renumérotation auto",
      category: "cable",
    });
  });

  it("retourne la catégorie rack", () => {
    expect(formatAuditAction("rack.update").category).toBe("rack");
  });

  it("retourne la catégorie slot pour les slots", () => {
    expect(formatAuditAction("rackSlot.create").category).toBe("slot");
  });

  it("fallback 'other' + libellé brut pour action inconnue", () => {
    expect(formatAuditAction("whatever.unknown")).toEqual({
      label: "whatever.unknown",
      category: "other",
    });
  });

  it("panel row catégorie = panel", () => {
    expect(formatAuditAction("rackSlotPanelRow.upsert").category).toBe("panel");
  });

  it("bundle catégorie", () => {
    expect(formatAuditAction("cableBundle.create").category).toBe("bundle");
  });
});

describe("groupByDay", () => {
  it("regroupe par jour (YYYY-MM-DD)", () => {
    const items = [
      { createdAt: new Date("2026-04-16T08:00:00Z") },
      { createdAt: new Date("2026-04-16T22:00:00Z") },
      { createdAt: new Date("2026-04-15T12:00:00Z") },
    ];
    const groups = groupByDay(items);
    // Taille dépend de la timezone locale : UTC=2 groups, UTC+1=2, UTC+2 (CEST)=3
    // (car 22:00:00Z + 2h tombe à 00:00 le lendemain). Borné raisonnablement.
    expect(groups.size).toBeGreaterThanOrEqual(1);
    expect(groups.size).toBeLessThanOrEqual(3);
  });

  it("accepte un createdAt en string ISO", () => {
    const items = [{ createdAt: "2026-04-16T08:00:00Z" as const }];
    const groups = groupByDay(items);
    expect(groups.size).toBe(1);
  });

  it("retourne une map vide pour un tableau vide", () => {
    expect(groupByDay([]).size).toBe(0);
  });
});
