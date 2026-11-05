// arkyo-server: SheetJS est bundlé (décision 6, réseau local sans internet
// garanti) — le classeur se construit sans injecter de script CDN.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildXlsxBlobMulti, XLSX_MIME } from "@/lib/export/table-xlsx";

describe("table-xlsx (SheetJS bundlé)", () => {
  it("construit un .xlsx multi-feuilles sans charger de script externe", async () => {
    const before = document.querySelectorAll("script").length;
    const blob = await buildXlsxBlobMulti([
      {
        sheetName: "Équipements",
        columns: [
          { key: "name", label: "Nom" },
          { key: "u", label: "Hauteur (U)" },
        ],
        rows: [
          { name: "Mixer X32", u: 3 },
          { name: "Switch", u: null },
        ],
      },
      { sheetName: "Équipements", columns: [{ key: "a", label: "A" }], rows: [] },
    ]);
    expect(document.querySelectorAll("script").length).toBe(before);
    expect(blob.type).toBe(XLSX_MIME);

    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array" });
    expect(wb.SheetNames).toEqual(["Équipements", "Équipements 2"]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Équipements"], { header: 1 });
    expect(rows).toEqual([["Nom", "Hauteur (U)"], ["Mixer X32", 3], ["Switch"]]);
  });
});
