import { expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

/** Retire les commentaires (blocs et lignes) avant de chercher. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("aucune mention affichée de arkyo.io dans web/src ni web/index.html", () => {
  const hits = walk(resolve(ROOT, "src")).filter((f) => /arkyo\.io/.test(stripComments(readFileSync(f, "utf8"))));
  expect(hits).toEqual([]);
  expect(readFileSync(resolve(ROOT, "index.html"), "utf8")).not.toContain("arkyo.io");
});
