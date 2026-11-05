import { describe, expect, it } from "vitest";
import {
  detectColumns,
  normalizeToken,
  levenshtein,
  similarity,
  type ColumnMapping,
} from "@/lib/services/import/detect-columns";

function byHeader(mapping: ColumnMapping[], header: string): ColumnMapping {
  const m = mapping.find((c) => c.header === header);
  if (!m) throw new Error(`header introuvable: ${header}`);
  return m;
}

describe("normalizeToken", () => {
  it("retire accents, casse et ponctuation", () => {
    expect(normalizeToken("Référence (mm)")).toBe("reference mm");
    expect(normalizeToken("Poids_kg")).toBe("poids kg");
    expect(normalizeToken("  MARQUE  ")).toBe("marque");
  });
});

describe("levenshtein / similarity", () => {
  it("distance nulle sur chaînes identiques", () => {
    expect(levenshtein("marque", "marque")).toBe(0);
    expect(similarity("marque", "marque")).toBe(1);
  });
  it("distance croissante avec les écarts", () => {
    expect(levenshtein("marque", "marques")).toBe(1);
    expect(similarity("brand", "brnad")).toBeGreaterThan(0.5);
  });
});

describe("detectColumns — en-têtes FR", () => {
  const headers = ["Désignation", "Marque", "Référence", "U", "Profondeur (mm)", "Poids kg"];
  const rows = [
    ["Caméra HD", "Sony", "HXC-100", "2", "450", "6.5"],
    ["Grille SDI", "Blackmagic", "GX-12", "1", "300", "3.2"],
  ];
  const mapping = detectColumns({ headers, rows });

  it("mappe le nom", () => {
    expect(byHeader(mapping, "Désignation").suggestedField).toBe("name");
  });
  it("mappe la marque", () => {
    expect(byHeader(mapping, "Marque").suggestedField).toBe("brand");
  });
  it("mappe la référence", () => {
    expect(byHeader(mapping, "Référence").suggestedField).toBe("reference");
  });
  it("mappe la hauteur U", () => {
    expect(byHeader(mapping, "U").suggestedField).toBe("heightU");
  });
  it("mappe la profondeur", () => {
    expect(byHeader(mapping, "Profondeur (mm)").suggestedField).toBe("depthMm");
  });
  it("mappe le poids", () => {
    expect(byHeader(mapping, "Poids kg").suggestedField).toBe("weight");
  });
});

describe("detectColumns — en-têtes EN", () => {
  const headers = ["Name", "Brand", "Model", "Rack U", "Depth", "Weight", "Power (W)"];
  const mapping = detectColumns({ headers, rows: [] });

  it("mappe name/brand/reference/heightU/depth/weight/power", () => {
    expect(byHeader(mapping, "Name").suggestedField).toBe("name");
    expect(byHeader(mapping, "Brand").suggestedField).toBe("brand");
    expect(byHeader(mapping, "Model").suggestedField).toBe("reference");
    expect(byHeader(mapping, "Rack U").suggestedField).toBe("heightU");
    expect(byHeader(mapping, "Depth").suggestedField).toBe("depthMm");
    expect(byHeader(mapping, "Weight").suggestedField).toBe("weight");
    expect(byHeader(mapping, "Power (W)").suggestedField).toBe("powerW");
  });
});

describe("detectColumns — booléens et 2110 via en-tête", () => {
  const headers = ["Nom", "ST 2110", "Double alimentation"];
  const rows = [
    ["Switch", "oui", "non"],
    ["Routeur", "non", "oui"],
  ];
  const mapping = detectColumns({ headers, rows });
  it("détecte is2110 et hasDualPsu", () => {
    expect(byHeader(mapping, "ST 2110").suggestedField).toBe("is2110");
    expect(byHeader(mapping, "Double alimentation").suggestedField).toBe("hasDualPsu");
  });
});

describe("detectColumns — déterminisme et unicité", () => {
  const headers = ["Nom", "Désignation", "Marque"];
  it("n'assigne pas deux fois le même champ", () => {
    const mapping = detectColumns({ headers, rows: [] });
    const fields = mapping.map((m) => m.suggestedField).filter(Boolean);
    const set = new Set(fields);
    expect(set.size).toBe(fields.length);
  });
  it("produit la même sortie sur deux exécutions", () => {
    const a = detectColumns({ headers, rows: [] });
    const b = detectColumns({ headers, rows: [] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("detectColumns — colonne inconnue", () => {
  it("laisse suggestedField null si aucun champ ne matche", () => {
    const mapping = detectColumns({ headers: ["Fournisseur XYZ zzz", "Colonne bidon 42"], rows: [] });
    // "Colonne bidon" ne doit rien matcher de fort.
    const bidon = byHeader(mapping, "Colonne bidon 42");
    expect(bidon.suggestedField === null || bidon.score < 0.7).toBe(true);
  });
});

describe("detectColumns — alternatives triées", () => {
  it("expose des alternatives distinctes du champ suggéré", () => {
    const mapping = detectColumns({ headers: ["Hauteur"], rows: [] });
    const h = byHeader(mapping, "Hauteur");
    expect(h.alternatives).not.toContain(h.suggestedField);
  });
});
