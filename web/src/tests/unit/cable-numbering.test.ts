import { describe, expect, it } from "vitest";
import {
  formatCableNumber,
  parseCableNumber,
  validateCableNumber,
  nextCableNumber,
  computeCableLabel,
  type CableNumberingConfig,
} from "@/lib/services/cable-numbering";

describe("formatCableNumber", () => {
  it("formate un numéro canonique avec padding par défaut (3)", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 12 })).toBe(
      "REG-A1-SDI012",
    );
  });

  it("accepte un padding custom", () => {
    expect(
      formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 12 }, { seqWidth: 5 }),
    ).toBe("REG-A1-SDI00012");
  });

  it("normalise en majuscules", () => {
    expect(formatCableNumber({ zone: "reg", rack: "a1", type: "sdi", seq: 1 })).toBe(
      "REG-A1-SDI001",
    );
  });

  it("retourne chaîne vide si composant invalide", () => {
    expect(formatCableNumber({ zone: "X", rack: "A1", type: "SDI", seq: 1 })).toBe("");
    expect(formatCableNumber({ zone: "REG", rack: "", type: "SDI", seq: 1 })).toBe("");
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "1SDI", seq: 1 })).toBe("");
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 0 })).toBe("");
  });
});

describe("parseCableNumber", () => {
  it("parse un numéro valide", () => {
    expect(parseCableNumber("REG-A1-SDI012")).toEqual({
      zone: "REG",
      rack: "A1",
      type: "SDI",
      seq: 12,
      seqText: "012",
      seqWidth: 3,
    });
  });

  it("rejette les minuscules", () => {
    expect(parseCableNumber("reg-a1-sdi012")).toBeNull();
  });

  it("parse la forme courte (1 lettre de type)", () => {
    const r = parseCableNumber("STUA-RGA-S001");
    expect(r?.type).toBe("S");
    expect(r?.seq).toBe(1);
  });

  it("rejette le format malformé", () => {
    expect(parseCableNumber("NOP")).toBeNull();
    expect(parseCableNumber("REG-A1-SDI")).toBeNull();
  });
});

describe("validateCableNumber", () => {
  it("accepte un numéro canonique", () => {
    expect(validateCableNumber("REG-A1-SDI012")).toEqual({ ok: true });
  });

  it("rejette chaîne vide avec message FR", () => {
    const r = validateCableNumber("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/vide/i);
  });

  it("rejette seq=0", () => {
    const r = validateCableNumber("REG-A1-SDI000");
    expect(r.ok).toBe(false);
  });

  it("rejette minuscules", () => {
    const r = validateCableNumber("reg-a1-sdi012");
    expect(r.ok).toBe(false);
  });
});

describe("nextCableNumber", () => {
  it("retourne 1 si aucun existant", () => {
    expect(
      nextCableNumber({
        zone: "REG",
        rack: "A1",
        type: "SDI",
        existingNumbers: [],
      }),
    ).toBe("REG-A1-SDI001");
  });

  it("strict increment (max+1) par défaut", () => {
    expect(
      nextCableNumber({
        zone: "REG",
        rack: "A1",
        type: "SDI",
        existingNumbers: ["REG-A1-SDI001", "REG-A1-SDI003"],
      }),
    ).toBe("REG-A1-SDI004");
  });

  it("fillGaps=true comble le trou", () => {
    expect(
      nextCableNumber({
        zone: "REG",
        rack: "A1",
        type: "SDI",
        existingNumbers: ["REG-A1-SDI001", "REG-A1-SDI003"],
        fillGaps: true,
      }),
    ).toBe("REG-A1-SDI002");
  });

  it("ignore les contextes différents", () => {
    expect(
      nextCableNumber({
        zone: "REG",
        rack: "A1",
        type: "SDI",
        existingNumbers: ["REG-A1-AUD005", "REG-B1-SDI005"],
      }),
    ).toBe("REG-A1-SDI001");
  });

  it("ignore les chaînes non parsables", () => {
    expect(
      nextCableNumber({
        zone: "REG",
        rack: "A1",
        type: "SDI",
        existingNumbers: ["garbage", "REG-A1-SDI002"],
      }),
    ).toBe("REG-A1-SDI003");
  });
});

describe("computeCableLabel", () => {
  const cfg: CableNumberingConfig = {
    pad: 5,
    sep1: "",
    sep2: "",
    includeRack: true,
  };

  it("format classique avec dirDigit préfixé (sep1='' → segments collés)", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "1",
        seq: 1,
        config: cfg,
      }),
    ).toBe("RGAS10001");
  });

  it("includeZone legacy ignoré (zone retirée de la convention)", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "1",
        seq: 1,
        config: { ...cfg, includeZone: false },
      }),
    ).toBe("RGAS10001");
  });

  it("legacy `separator` (alias sep1) entre rack et prefix", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "1",
        seq: 1,
        config: { ...cfg, sep1: "-" },
      }),
    ).toBe("RGA-S10001");
  });

  it("ajoute suffix avec sep2='-'", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "A",
        signalSuffix: "L",
        dirDigit: "1",
        seq: 1,
        config: { ...cfg, sep2: "-" },
      }),
    ).toBe("RGAA10001-L");
  });

  it("template libre remplace la composition classique", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "S",
        signalSuffix: "L",
        dirDigit: "2",
        seq: 42,
        config: {
          ...cfg,
          templateEnabled: true,
          template: "{zone}/{rack}.{prefix}{dir}{seq}_{suffix}",
        },
      }),
    ).toBe("/RGA.S200042_L"); // {zone} mappe à "" (compat legacy)
  });

  it("template : placeholders manquants → chaînes vides", () => {
    expect(
      computeCableLabel({
        zoneCode: null,
        rackCode: "RGA",
        signalPrefix: "",
        signalSuffix: "",
        dirDigit: "1",
        seq: 5,
        config: {
          ...cfg,
          templateEnabled: true,
          template: "{zone}-{rack}-{prefix}{seq}",
        },
      }),
    ).toBe("-RGA-00005");
  });

  it("pad clampé à [1, 10]", () => {
    expect(
      computeCableLabel({
        zoneCode: "A",
        rackCode: "B",
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "1",
        seq: 1,
        config: { ...cfg, pad: 999 },
      }),
    ).toMatch(/S1\d{9}/);
  });
});
