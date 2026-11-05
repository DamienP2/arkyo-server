import { describe, expect, it } from "vitest";

import {
  buildConnectiqueRows,
  buildCsvText,
  collectConnectorTypeIds,
  COMPLETE_EXTRA_FIELDS,
  CONNECTIQUE_COLUMNS,
  csvEscape,
  equipmentCellValue,
  type ExportEquipment,
} from "@/lib/export/catalogue-export";

const mixer: ExportEquipment = {
  name: "Mixer X32",
  reference: "X32-R",
  isRackable: true,
  ip2110Mode: "OOB",
  functions: [{ label: "Audio" }, { label: "Réseau" }],
  connectors: [
    {
      id: "c1",
      face: "REAR",
      connectorTypeId: "ct-xlr",
      version: "",
      signalName: "Audio analogique",
      quantity: 16,
      label: "IN 1-16",
      direction: "IN",
      gender: "FEMALE",
    },
    {
      id: "c2",
      face: "FRONT",
      connectorTypeId: "ct-rj45",
      version: "Cat 6a",
      signalName: "Dante",
      quantity: 2,
      label: "",
      direction: "BOTH",
      gender: "MALE",
    },
  ],
};

describe("equipmentCellValue — champs export complet", () => {
  it("isRackable → Oui/Non", () => {
    expect(equipmentCellValue(mixer, "isRackable")).toBe("Oui");
    expect(equipmentCellValue({ name: "x", isRackable: false }, "isRackable")).toBe("Non");
  });

  it("ip2110Mode → valeur brute ou vide", () => {
    expect(equipmentCellValue(mixer, "ip2110Mode")).toBe("OOB");
    expect(equipmentCellValue({ name: "x" }, "ip2110Mode")).toBeNull();
  });

  it("functions → labels joints", () => {
    expect(equipmentCellValue(mixer, "functions")).toBe("Audio, Réseau");
    expect(equipmentCellValue({ name: "x" }, "functions")).toBeNull();
  });

  it("champs standard toujours gérés (nom, booléens, nombres)", () => {
    expect(equipmentCellValue(mixer, "name")).toBe("Mixer X32");
    expect(equipmentCellValue({ name: "x", hasDualPsu: true }, "hasDualPsu")).toBe("Oui");
    expect(equipmentCellValue({ name: "x", heightU: 3 }, "heightU")).toBe(3);
  });

  it("COMPLETE_EXTRA_FIELDS expose les 3 colonnes additionnelles", () => {
    expect(COMPLETE_EXTRA_FIELDS.map((f) => f.key)).toEqual([
      "isRackable",
      "ip2110Mode",
      "functions",
    ]);
  });
});

describe("collectConnectorTypeIds", () => {
  it("déduplique les IDs de types de connecteurs", () => {
    const items: ExportEquipment[] = [
      mixer,
      {
        name: "Autre",
        connectors: [
          { face: "REAR", connectorTypeId: "ct-xlr", quantity: 1, direction: "OUT", gender: "MALE" },
        ],
      },
    ];
    expect(collectConnectorTypeIds(items).sort()).toEqual(["ct-rj45", "ct-xlr"]);
  });

  it("ignore les connectors absents ou malformés", () => {
    expect(collectConnectorTypeIds([{ name: "x" }, { name: "y", connectors: "junk" }])).toEqual([]);
  });
});

describe("buildConnectiqueRows", () => {
  const names = new Map([
    ["ct-xlr", "XLR 3"],
    ["ct-rj45", "RJ45"],
  ]);

  it("une ligne par port, labels FR, noms résolus", () => {
    const rows = buildConnectiqueRows([mixer], names);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      equipment: "Mixer X32",
      reference: "X32-R",
      face: "Arrière",
      connector: "XLR 3",
      signal: "Audio analogique",
      direction: "Entrée",
      gender: "F",
      quantity: 16,
      label: "IN 1-16",
    });
    expect(rows[1]).toMatchObject({
      face: "Devant",
      connector: "RJ45",
      version: "Cat 6a",
      direction: "Bidirectionnel",
      gender: "M",
      quantity: 2,
    });
  });

  it("trie par nom d'équipement", () => {
    const a: ExportEquipment = {
      name: "Alpha",
      connectors: [{ face: "REAR", connectorTypeId: "ct-xlr", quantity: 1, direction: "IN", gender: "MALE" }],
    };
    const rows = buildConnectiqueRows([mixer, a], names);
    expect(rows[0].equipment).toBe("Alpha");
  });

  it("nom de connecteur non résolu → cellule vide", () => {
    const rows = buildConnectiqueRows([mixer], new Map());
    expect(rows[0].connector).toBeNull();
  });

  it("équipement sans connectique → aucune ligne", () => {
    expect(buildConnectiqueRows([{ name: "x" }], names)).toEqual([]);
  });

  it("les colonnes couvrent toutes les clés produites", () => {
    const keys = CONNECTIQUE_COLUMNS.map((c) => c.key);
    for (const k of Object.keys(buildConnectiqueRows([mixer], names)[0])) {
      expect(keys).toContain(k);
    }
  });
});

describe("csvEscape / buildCsvText", () => {
  it("échappe guillemets et point-virgule (RFC 4180)", () => {
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape("a;b")).toBe('"a;b"');
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(12)).toBe("12");
  });

  it("génère BOM + entête + lignes séparées par point-virgule", () => {
    const text = buildCsvText(
      [
        { key: "a", label: "Col A" },
        { key: "b", label: "Col B" },
      ],
      [{ a: "x", b: 1 }],
    );
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("Col A;Col B");
    expect(text).toContain("x;1");
  });
});
