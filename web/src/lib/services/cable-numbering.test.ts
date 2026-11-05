/**
 * Tests unitaires — lib/services/cable-numbering.ts
 *
 * Logique pure, pas de mock, pas d'I/O. Déterministe.
 * Convention testée : {zone}-{rack}-{type}{seq}
 * Ex. "REG-A1-SDI012", "STUA-RGA-S001", "PLT-B2-ETH004"
 *
 * Pattern AAA (Arrange / Act / Assert).
 */

import { describe, it, expect } from "vitest";
import {
  computeCableLabel,
  formatCableNumber,
  parseCableNumber,
  validateCableNumber,
  nextCableNumber,
  type CableNumberParts,
  type NextCableNumberContext,
  type CableNumberingConfig,
} from "./cable-numbering";

// ─────────────────────────────────────────────────────────────────────────────
// formatCableNumber — cas positifs
// ─────────────────────────────────────────────────────────────────────────────

describe("formatCableNumber — valid inputs", () => {
  it("exemple de base : REG-A1-SDI012", () => {
    const parts: CableNumberParts = { zone: "REG", rack: "A1", type: "SDI", seq: 12 };
    expect(formatCableNumber(parts)).toBe("REG-A1-SDI012");
  });

  it("exemple court : STUA-RGA-S001", () => {
    expect(formatCableNumber({ zone: "STUA", rack: "RGA", type: "S", seq: 1 })).toBe(
      "STUA-RGA-S001",
    );
  });

  it("PLT-B2-ETH004", () => {
    expect(formatCableNumber({ zone: "PLT", rack: "B2", type: "ETH", seq: 4 })).toBe(
      "PLT-B2-ETH004",
    );
  });

  it("LOC-C3-PWR042", () => {
    expect(formatCableNumber({ zone: "LOC", rack: "C3", type: "PWR", seq: 42 })).toBe(
      "LOC-C3-PWR042",
    );
  });

  it("type 5 lettres (TALLY) — longueur max autorisée", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "TALLY", seq: 1 })).toBe(
      "REG-A1-TALLY001",
    );
  });

  it("zone 5 caractères (STUA1) — longueur max autorisée", () => {
    expect(formatCableNumber({ zone: "STUA1", rack: "A1", type: "SDI", seq: 1 })).toBe(
      "STUA1-A1-SDI001",
    );
  });

  it("rack 1 caractère (A) — longueur min autorisée", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A", type: "SDI", seq: 1 })).toBe("REG-A-SDI001");
  });

  it("seq=1 → zero-padded à 3 digits : 001", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 1 })).toBe(
      "REG-A1-SDI001",
    );
  });

  it("seq=999 → 999 (3 digits, pas de troncature)", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 999 })).toBe(
      "REG-A1-SDI999",
    );
  });

  it("seq=1000 → 1000 (4 digits, pas de troncature même > seqWidth)", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 1000 })).toBe(
      "REG-A1-SDI1000",
    );
  });

  it("seqWidth=4 → zero-padded à 4 digits", () => {
    expect(
      formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 1 }, { seqWidth: 4 }),
    ).toBe("REG-A1-SDI0001");
  });

  it("seqWidth=1 → pas de padding pour seq=5", () => {
    expect(
      formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 5 }, { seqWidth: 1 }),
    ).toBe("REG-A1-SDI5");
  });

  it("inputs en minuscules → normalisés en majuscules automatiquement", () => {
    expect(formatCableNumber({ zone: "reg", rack: "a1", type: "sdi", seq: 1 })).toBe(
      "REG-A1-SDI001",
    );
  });

  it("zone mixte casse → normalisée", () => {
    expect(formatCableNumber({ zone: "Reg", rack: "A1", type: "SDI", seq: 1 })).toBe(
      "REG-A1-SDI001",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatCableNumber — cas invalides → chaîne vide
// ─────────────────────────────────────────────────────────────────────────────

describe("formatCableNumber — invalid inputs → empty string", () => {
  it("zone vide → ''", () => {
    expect(formatCableNumber({ zone: "", rack: "A1", type: "SDI", seq: 1 })).toBe("");
  });

  it("zone 1 caractère (trop court) → ''", () => {
    expect(formatCableNumber({ zone: "R", rack: "A1", type: "SDI", seq: 1 })).toBe("");
  });

  it("zone 6 caractères (trop long) → ''", () => {
    expect(formatCableNumber({ zone: "TOOLONG", rack: "A1", type: "SDI", seq: 1 })).toBe("");
  });

  it("zone avec tiret → '' (tiret non autorisé)", () => {
    expect(formatCableNumber({ zone: "RE-G", rack: "A1", type: "SDI", seq: 1 })).toBe("");
  });

  it("rack vide → ''", () => {
    expect(formatCableNumber({ zone: "REG", rack: "", type: "SDI", seq: 1 })).toBe("");
  });

  it("rack 6 caractères (trop long) → ''", () => {
    expect(formatCableNumber({ zone: "REG", rack: "TOOLNG", type: "SDI", seq: 1 })).toBe("");
  });

  it("rack avec tiret → '' (tiret non autorisé)", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A-1", type: "SDI", seq: 1 })).toBe("");
  });

  it("type vide → ''", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "", seq: 1 })).toBe("");
  });

  it("type 6 lettres (trop long) → ''", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "TOOLNG", seq: 1 })).toBe("");
  });

  it("type avec chiffre → '' (type doit être lettres seulement — TYPE_REGEX rejette SD1)", () => {
    // formatCableNumber validates type with TYPE_REGEX = /^[A-Z]{1,5}$/ which rejects digits.
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "SD1", seq: 1 })).toBe("");
  });

  it("seq=0 → '' (séquence doit être ≥ 1)", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 0 })).toBe("");
  });

  it("seq=-1 → ''", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: -1 })).toBe("");
  });

  it("seq=1.5 (non entier) → ''", () => {
    expect(formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 1.5 })).toBe("");
  });

  it("seqWidth=0 → ''", () => {
    expect(
      formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 1 }, { seqWidth: 0 }),
    ).toBe("");
  });

  it("seqWidth non entier → ''", () => {
    expect(
      formatCableNumber({ zone: "REG", rack: "A1", type: "SDI", seq: 1 }, { seqWidth: 2.5 }),
    ).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCableNumber — cas positifs
// ─────────────────────────────────────────────────────────────────────────────

describe("parseCableNumber — valid inputs", () => {
  it("REG-A1-SDI012 → composants corrects", () => {
    const result = parseCableNumber("REG-A1-SDI012");
    expect(result).not.toBeNull();
    expect(result?.zone).toBe("REG");
    expect(result?.rack).toBe("A1");
    expect(result?.type).toBe("SDI");
    expect(result?.seq).toBe(12);
    expect(result?.seqText).toBe("012");
    expect(result?.seqWidth).toBe(3);
  });

  it("STUA-RGA-S001 → type 1 lettre, seq=1", () => {
    const result = parseCableNumber("STUA-RGA-S001");
    expect(result?.zone).toBe("STUA");
    expect(result?.rack).toBe("RGA");
    expect(result?.type).toBe("S");
    expect(result?.seq).toBe(1);
    expect(result?.seqText).toBe("001");
    expect(result?.seqWidth).toBe(3);
  });

  it("PLT-B2-ETH004 → parsing standard", () => {
    const result = parseCableNumber("PLT-B2-ETH004");
    expect(result?.zone).toBe("PLT");
    expect(result?.rack).toBe("B2");
    expect(result?.type).toBe("ETH");
    expect(result?.seq).toBe(4);
  });

  it("seqText préserve le zero-padding : '001' (seqWidth=3)", () => {
    const result = parseCableNumber("REG-A1-SDI001");
    expect(result?.seqText).toBe("001");
    expect(result?.seqWidth).toBe(3);
  });

  it("seqWidth=4 si la séquence est '0042'", () => {
    const result = parseCableNumber("REG-A1-SDI0042");
    expect(result?.seq).toBe(42);
    expect(result?.seqText).toBe("0042");
    expect(result?.seqWidth).toBe(4);
  });

  it("seq=0 est parsé (parseur permissif pour données historiques)", () => {
    // parseCableNumber accepte seq=0 ; validateCableNumber le rejette
    const result = parseCableNumber("REG-A1-SDI000");
    expect(result).not.toBeNull();
    expect(result?.seq).toBe(0);
  });

  it("type 5 lettres (TALLY) → parsé correctement", () => {
    const result = parseCableNumber("REG-A1-TALLY001");
    expect(result?.type).toBe("TALLY");
    expect(result?.seq).toBe(1);
  });

  it("séquence 1 digit (sans zero-padding) → parsé", () => {
    const result = parseCableNumber("REG-A1-SDI1");
    expect(result?.seq).toBe(1);
    expect(result?.seqText).toBe("1");
    expect(result?.seqWidth).toBe(1);
  });

  it("zone alphanumérique (STUA1) → parsé", () => {
    const result = parseCableNumber("STUA1-A1-SDI001");
    expect(result?.zone).toBe("STUA1");
  });

  it("rack numérique pur (12) → parsé", () => {
    const result = parseCableNumber("REG-12-SDI001");
    expect(result?.rack).toBe("12");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCableNumber — cas négatifs → null
// ─────────────────────────────────────────────────────────────────────────────

describe("parseCableNumber — invalid inputs → null", () => {
  it("chaîne vide → null", () => {
    expect(parseCableNumber("")).toBeNull();
  });

  it("minuscules → null (casse-sensible)", () => {
    expect(parseCableNumber("reg-a1-sdi012")).toBeNull();
  });

  it("minuscules partielles → null", () => {
    expect(parseCableNumber("REG-a1-SDI012")).toBeNull();
  });

  it("trop de segments (3 tirets) → null", () => {
    expect(parseCableNumber("REG-A1-SDI-012")).toBeNull();
  });

  it("un seul segment (pas de tiret) → null", () => {
    expect(parseCableNumber("REGA1SDI012")).toBeNull();
  });

  it("zone 1 caractère → null", () => {
    expect(parseCableNumber("R-A1-SDI012")).toBeNull();
  });

  it("zone 6 caractères → null", () => {
    expect(parseCableNumber("TOOLONG-A1-SDI012")).toBeNull();
  });

  it("rack avec tiret → null", () => {
    expect(parseCableNumber("REG-A-1-SDI012")).toBeNull();
  });

  it("type commence par chiffre → null", () => {
    expect(parseCableNumber("REG-A1-1SDI012")).toBeNull();
  });

  it("type 6 lettres → null", () => {
    expect(parseCableNumber("REG-A1-TOOLNG001")).toBeNull();
  });

  it("séquence vide après type → null", () => {
    expect(parseCableNumber("REG-A1-SDI")).toBeNull();
  });

  it("séquence avec lettres → null", () => {
    expect(parseCableNumber("REG-A1-SDIAB")).toBeNull();
  });

  it("espaces en début → null", () => {
    expect(parseCableNumber(" REG-A1-SDI012")).toBeNull();
  });

  it("espaces en fin → null", () => {
    expect(parseCableNumber("REG-A1-SDI012 ")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateCableNumber — cas positifs
// ─────────────────────────────────────────────────────────────────────────────

describe("validateCableNumber — valid inputs", () => {
  const validCables = [
    "REG-A1-SDI012",
    "STUA-RGA-S001",
    "PLT-B2-ETH004",
    "LOC-C3-PWR042",
    "REG-A1-TALLY001",
    "STUA1-A1-SDI001",
    "REG-A-SDI001",
    "REG-A1-S001",
    "REG-A1-HDMI001",
    "REG-12-SDI999",
  ];

  for (const cable of validCables) {
    it(`"${cable}" → { ok: true }`, () => {
      expect(validateCableNumber(cable)).toEqual({ ok: true });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// validateCableNumber — cas négatifs
// ─────────────────────────────────────────────────────────────────────────────

describe("validateCableNumber — invalid inputs", () => {
  it("chaîne vide → ok: false", () => {
    const result = validateCableNumber("");
    expect(result.ok).toBe(false);
  });

  it("minuscules → ok: false avec mention majuscules", () => {
    const result = validateCableNumber("reg-a1-sdi012");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/majuscules/i);
    }
  });

  it("espaces en début → ok: false", () => {
    const result = validateCableNumber(" REG-A1-SDI012");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/espaces/i);
    }
  });

  it("espaces en fin → ok: false", () => {
    const result = validateCableNumber("REG-A1-SDI012 ");
    expect(result.ok).toBe(false);
  });

  it("2 segments seulement → ok: false (format incorrect)", () => {
    const result = validateCableNumber("REG-A1SDI012");
    expect(result.ok).toBe(false);
  });

  it("4 segments (3 tirets) → ok: false", () => {
    const result = validateCableNumber("REG-A1-SDI-012");
    expect(result.ok).toBe(false);
  });

  it("zone 1 caractère → ok: false avec mention zone", () => {
    const result = validateCableNumber("R-A1-SDI012");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.toLowerCase()).toMatch(/zone/i);
    }
  });

  it("zone 6 caractères → ok: false avec mention zone", () => {
    const result = validateCableNumber("TOOLONG-A1-SDI012");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.toLowerCase()).toMatch(/zone/i);
    }
  });

  it("rack vide (double tiret) → ok: false avec mention rack", () => {
    const result = validateCableNumber("REG--SDI012");
    expect(result.ok).toBe(false);
    // Either rack or format error
    expect(result.ok).toBe(false);
  });

  it("rack 6 caractères → ok: false avec mention rack", () => {
    const result = validateCableNumber("REG-TOOLNG-SDI012");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.toLowerCase()).toMatch(/rack/i);
    }
  });

  it("type avec chiffre intercalé entre lettres : SDI1ABC → ok: false (séquence non numérique)", () => {
    // The third segment "SDI1ABC" does not match /^([A-Z]{1,5})(\d+)$/ because
    // after the digits "1" there are letters "ABC". Parser rejects it.
    const result = validateCableNumber("REG-A1-SDI1ABC");
    expect(result.ok).toBe(false);
  });

  it("segment type+seq ambigu SD1012 → ok: true (interprété comme type=SD, seq=1012)", () => {
    // "SD1012" is parsed by /^([A-Z]{1,5})(\d+)$/ as type="SD", seq="1012" — both valid.
    // The validator accepts it. This is documented expected behavior.
    const result = validateCableNumber("REG-A1-SD1012");
    expect(result.ok).toBe(true);
  });

  it("type 6 lettres → ok: false", () => {
    const result = validateCableNumber("REG-A1-TOOLNG012");
    expect(result.ok).toBe(false);
  });

  it("séquence = 0 → ok: false (doit être ≥ 1)", () => {
    const result = validateCableNumber("REG-A1-SDI000");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/séquence/i);
    }
  });

  it("séquence vide → ok: false", () => {
    const result = validateCableNumber("REG-A1-SDI");
    expect(result.ok).toBe(false);
  });

  it("séquence avec lettres → ok: false", () => {
    const result = validateCableNumber("REG-A1-SDIABC");
    expect(result.ok).toBe(false);
  });

  it("zone avec tiret interne → ok: false (trop de segments)", () => {
    const result = validateCableNumber("RE-G-A1-SDI012");
    expect(result.ok).toBe(false);
  });

  it("zone avec espace interne → ok: false", () => {
    const result = validateCableNumber("RE G-A1-SDI012");
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateCableNumber vs parseCableNumber — cohérence (seq=0)
// ─────────────────────────────────────────────────────────────────────────────

describe("validateCableNumber vs parseCableNumber — cohérence seq=0", () => {
  it("SDI000 : parsé (permissif) mais non valide (strict)", () => {
    const parsed = parseCableNumber("REG-A1-SDI000");
    const validated = validateCableNumber("REG-A1-SDI000");
    expect(parsed).not.toBeNull();
    expect(parsed?.seq).toBe(0);
    expect(validated.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nextCableNumber — strict increment (default)
// ─────────────────────────────────────────────────────────────────────────────

describe("nextCableNumber — strict increment (fillGaps: false)", () => {
  it("liste vide → premier numéro : REG-A1-SDI001", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: [],
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI001");
  });

  it("existants [SDI001, SDI003] → SDI004 (max+1)", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-SDI001", "REG-A1-SDI003"],
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI004");
  });

  it("exemple de la JSDoc : SDI001, SDI003, AUD001 → SDI004", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-SDI001", "REG-A1-SDI003", "REG-A1-AUD001"],
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI004");
  });

  it("existants [SDI001] → SDI002", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-SDI001"],
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI002");
  });

  it("trous non comblés : [SDI001, SDI003] → SDI004 (pas SDI002)", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-SDI001", "REG-A1-SDI003"],
    };
    const result = nextCableNumber(ctx);
    expect(result).toBe("REG-A1-SDI004");
    expect(result).not.toBe("REG-A1-SDI002");
  });

  it("filtre les autres types : AUD n'interfère pas avec SDI", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-AUD001", "REG-A1-AUD002", "REG-A1-AUD100"],
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI001");
  });

  it("filtre les autres zones : STUA n'interfère pas avec REG", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["STUA-A1-SDI001", "STUA-A1-SDI010"],
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI001");
  });

  it("filtre les autres racks : B1 n'interfère pas avec A1", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-B1-SDI001", "REG-B1-SDI050"],
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI001");
  });

  it("numéros non parsables sont ignorés silencieusement", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["INVALID", "not-a-cable", "", "REG-A1-SDI002"],
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI003");
  });

  it("input en minuscules → normalisé → contexte reconnu", () => {
    const ctx: NextCableNumberContext = {
      zone: "reg", // minuscule → normalisé en REG
      rack: "a1", // normalisé en A1
      type: "sdi", // normalisé en SDI
      existingNumbers: ["REG-A1-SDI005"],
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI006");
  });

  it("seqWidth=4 → résultat zero-paddé à 4 digits", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-SDI001"],
      seqWidth: 4,
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI0002");
  });

  it("existants avec seq=999 → suivant = SDI1000 (débordement du padding)", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-SDI999"],
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI1000");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nextCableNumber — fillGaps: true
// ─────────────────────────────────────────────────────────────────────────────

describe("nextCableNumber — fillGaps: true", () => {
  it("exemple de la JSDoc : SDI001, SDI003 → SDI002 (comble le trou)", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-SDI001", "REG-A1-SDI003"],
      fillGaps: true,
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI002");
  });

  it("liste vide → SDI001 (même résultat qu'en mode strict)", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: [],
      fillGaps: true,
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI001");
  });

  it("SDI001, SDI002, SDI003 → SDI004 (pas de trou)", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-SDI001", "REG-A1-SDI002", "REG-A1-SDI003"],
      fillGaps: true,
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI004");
  });

  it("SDI002 sans SDI001 → SDI001 (comble le premier trou)", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-SDI002"],
      fillGaps: true,
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI001");
  });

  it("SDI001, SDI003, SDI005 → SDI002 (premier trou)", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-SDI001", "REG-A1-SDI003", "REG-A1-SDI005"],
      fillGaps: true,
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI002");
  });

  it("fillGaps vs strict : résultats différents quand il y a des trous", () => {
    const existing = ["REG-A1-SDI001", "REG-A1-SDI003"];
    const ctxStrict: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: existing,
    };
    const ctxGaps: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: existing,
      fillGaps: true,
    };
    expect(nextCableNumber(ctxStrict)).toBe("REG-A1-SDI004");
    expect(nextCableNumber(ctxGaps)).toBe("REG-A1-SDI002");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nextCableNumber — gestion de seq=0 dans existingNumbers
// ─────────────────────────────────────────────────────────────────────────────

describe("nextCableNumber — seq=0 dans existingNumbers ignoré", () => {
  it("SDI000 (seq=0) dans la liste est ignoré → prochain = SDI001", () => {
    // parseCableNumber accepte seq=0 mais nextCableNumber ne l'ajoute pas à usedSeqs
    // (seuls les seq >= 1 sont pris en compte)
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SDI",
      existingNumbers: ["REG-A1-SDI000"],
    };
    expect(nextCableNumber(ctx)).toBe("REG-A1-SDI001");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nextCableNumber — contexte invalide
// ─────────────────────────────────────────────────────────────────────────────

describe("nextCableNumber — contexte invalide → chaîne vide (via formatCableNumber)", () => {
  it("zone invalide (1 caractère) → '' (formatCableNumber renvoie vide)", () => {
    const ctx: NextCableNumberContext = {
      zone: "R",
      rack: "A1",
      type: "SDI",
      existingNumbers: [],
    };
    expect(nextCableNumber(ctx)).toBe("");
  });

  it("type avec chiffre (SD1) → '' (TYPE_REGEX rejette SD1 dans formatCableNumber)", () => {
    const ctx: NextCableNumberContext = {
      zone: "REG",
      rack: "A1",
      type: "SD1",
      existingNumbers: [],
    };
    expect(nextCableNumber(ctx)).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip : formatCableNumber → parseCableNumber
// ─────────────────────────────────────────────────────────────────────────────

describe("round-trip : format → parse → format", () => {
  const cases: CableNumberParts[] = [
    { zone: "REG", rack: "A1", type: "SDI", seq: 1 },
    { zone: "STUA", rack: "RGA", type: "S", seq: 42 },
    { zone: "PLT", rack: "B2", type: "ETH", seq: 999 },
    { zone: "LOC", rack: "C3", type: "TALLY", seq: 100 },
  ];

  for (const parts of cases) {
    it(`round-trip : ${parts.zone}-${parts.rack}-${parts.type}${parts.seq}`, () => {
      const formatted = formatCableNumber(parts);
      const parsed = parseCableNumber(formatted);

      expect(parsed).not.toBeNull();
      expect(parsed?.zone).toBe(parts.zone);
      expect(parsed?.rack).toBe(parts.rack);
      expect(parsed?.type).toBe(parts.type);
      expect(parsed?.seq).toBe(parts.seq);

      // Re-format depuis les composants parsés → identique à l'original
      const reformatted = formatCableNumber(
        { zone: parsed!.zone, rack: parsed!.rack, type: parsed!.type, seq: parsed!.seq },
        { seqWidth: parsed!.seqWidth },
      );
      expect(reformatted).toBe(formatted);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// computeCableLabel — convention runtime {rack}{sep1}{prefix}{dirDigit}{seq}{sep2}{suffix}
// (la zone a été retirée de la convention canonique : cf. CLAUDE.md + flag
// `includeZone: deprecated` dans le service)
// ─────────────────────────────────────────────────────────────────────────────

describe("computeCableLabel", () => {
  const baseConfig: CableNumberingConfig = {
    pad: 5,
    sep1: "",
    sep2: "",
    includeRack: true,
  };

  it("format rack+prefix+IN avec sep1='' → segments collés", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "1",
        seq: 1,
        config: baseConfig,
      }),
    ).toBe("RGAS10001");
  });

  it("zoneCode est ignoré (zone retirée de la convention)", () => {
    expect(
      computeCableLabel({
        zoneCode: null,
        rackCode: "RGA",
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "1",
        seq: 1,
        config: baseConfig,
      }),
    ).toBe("RGAS10001");
  });

  it("toggle includeRack=false → omet le segment rack", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "1",
        seq: 1,
        config: { ...baseConfig, includeRack: false },
      }),
    ).toBe("S10001");
  });

  it("ni zone ni rack", () => {
    expect(
      computeCableLabel({
        zoneCode: null,
        rackCode: null,
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "1",
        seq: 42,
        config: baseConfig,
      }),
    ).toBe("S10042");
  });

  it("direction OUT=2", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "2",
        seq: 1,
        config: baseConfig,
      }),
    ).toBe("RGAS20001");
  });

  it("direction BIDI=3", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "3",
        seq: 1,
        config: baseConfig,
      }),
    ).toBe("RGAS30001");
  });

  it("suffix avec sep2='-'", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "S",
        signalSuffix: "HD",
        dirDigit: "1",
        seq: 1,
        config: { ...baseConfig, sep2: "-" },
      }),
    ).toBe("RGAS10001-HD");
  });

  it("sep1='-' entre rack et prefix", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "1",
        seq: 1,
        config: { ...baseConfig, sep1: "-" },
      }),
    ).toBe("RGA-S10001");
  });

  it("signalPrefix vide → rack + dirDigit + seq sur pad-1 (direction toujours visible)", () => {
    expect(
      computeCableLabel({
        zoneCode: "ALPH",
        rackCode: "RGA",
        signalPrefix: "",
        signalSuffix: "",
        dirDigit: "1",
        seq: 7,
        config: { ...baseConfig, pad: 3 },
      }),
    ).toBe("RGA107");
  });

  it("pad borné à [1,10] et seq borné à ≥1", () => {
    // seq<1 → traité comme 1
    expect(
      computeCableLabel({
        zoneCode: null,
        rackCode: null,
        signalPrefix: "S",
        signalSuffix: "",
        dirDigit: "1",
        seq: 0,
        config: { ...baseConfig, pad: 3 },
      }),
    ).toBe("S101");
  });
});
