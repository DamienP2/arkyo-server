import { expect, test } from "vitest";
import { summarize } from "./table-labels";

test("libellés français, tables regroupées, ordre fixe, repli sur le nom brut", () => {
  expect(
    summarize({ TenantBrand: 2, RackConnection: 2, ProjectConnection: 1, Project: 1, Zzz: 4, Rack: 0 }),
  ).toBe("Projets 1 · Câbles 3 · Marques 2 · Zzz 4");
});
