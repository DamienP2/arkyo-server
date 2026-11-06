/**
 * arkyo-server: bundlé (hors ligne). jsPDF 2.5.1, svg2pdf.js 2.2.3 et
 * html-to-image 1.11.13 (versions des CDN d'arkyo) viennent des paquets npm :
 * aucun `<script>` de CDN n'est ajouté, et `window.jspdf` reste le point
 * d'accès des modules copiés d'arkyo.
 */

import { expect, test } from "vitest";
import { ensureJsPdf, JSPDF_BASE } from "@/lib/pdf/load-jspdf";
import { ensureSvg2Pdf } from "@/lib/pdf/synoptic-vector";

test("jsPDF et svg2pdf se chargent sans CDN, svg2pdf greffé sur le jsPDF exposé", async () => {
  await ensureJsPdf();
  await ensureSvg2Pdf();
  expect(document.querySelectorAll("script[src]")).toHaveLength(0);

  const w = window as unknown as { jspdf: { jsPDF: new (o: unknown) => { svg?: unknown; output: (t: string) => string } } };
  const doc = new w.jspdf.jsPDF({ ...JSPDF_BASE, unit: "mm", format: "a4" });
  expect(typeof doc.svg).toBe("function");
  expect(doc.output("datauristring")).toMatch(/^data:application\/pdf/);
});

test("html-to-image se charge depuis le paquet npm", async () => {
  const mod = await import("html-to-image");
  expect(typeof mod.toSvg).toBe("function");
  expect(document.querySelectorAll("script[src]")).toHaveLength(0);
});
