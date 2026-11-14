import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { tariffCatalogSnapshotSchema } from "../packages/shared/src/contracts/tariffs";
import { describe, expect, it } from "vitest";

/**
 * `F4.365` / ADR 0134 decisions 1–2 — the committed catalog snapshot,
 * generated from the owner's workbook by `tariffs:import --out`. Each pin below
 * changes ON PURPOSE when the catalog is re-imported: update it in the same
 * commit as the new JSON, with the workbook's new sha256.
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const snapshot = tariffCatalogSnapshotSchema.parse(
  JSON.parse(readFileSync(join(repoRoot, "packages", "db", "src", "tariff-catalog.json"), "utf8")),
);
const categories = snapshot.categories;
const byKey = (key: string) => {
  const c = categories.find((x) => x.key === key);
  if (!c) throw new Error(`no category ${key}`);
  return c;
};
const count = <T extends string>(f: (c: (typeof categories)[number]) => T) =>
  categories.reduce<Record<string, number>>((m, c) => ((m[f(c)] = (m[f(c)] ?? 0) + 1), m), {});

describe("F4.365 — the committed tariff catalog snapshot", () => {
  it("records the workbook it came from (a re-import changes this on purpose)", () => {
    expect(snapshot.source).toEqual({
      workbook: "India_Electricity_Tariff_Calculator.xlsx",
      sha256: "d9c7535ed8aa0efa2a57dd6bce643338706479eae9daa2efd25df5e7159691ab",
      sheet: "Rate Chart",
    });
  });

  it("holds 316 categories and 461 slabs (a re-import changes this on purpose)", () => {
    expect(categories.length).toBe(316);
    expect(categories.reduce((n, c) => n + c.slabs.length, 0)).toBe(461);
    expect(new Set(categories.map((c) => `${c.key}@${c.effectiveFrom}`)).size).toBe(316);
  });

  it("counts by data status, energy unit and closed last slab (a re-import changes this on purpose)", () => {
    expect(count((c) => c.dataStatus)).toEqual({ official: 234, secondary: 68, indicative: 14 });
    expect(count((c) => c.energyUnit)).toEqual({ kwh: 232, kvah: 84 });
    expect(categories.filter((c) => c.slabs[c.slabs.length - 1].toUnits !== null).length).toBe(16);
    expect(categories.some((c) => c.key.startsWith("custom:"))).toBe(false);
  });

  it("keeps the slab literals the golden bills are computed from", () => {
    const msedcl = byKey("Maharashtra | MSEDCL | LT-I(B) Residential (single phase)");
    expect(msedcl.fixedBasis).toBe("per_connection_month");
    expect(msedcl.slabs.map((s) => [s.fromUnits, s.toUnits, s.energyRate, s.fixedRate, s.wheelingRate])).toEqual([
      [0, 100, 3.96, 130, 1.6],
      [101, 300, 10.8, 130, 1.6],
      [301, 500, 15.03, 130, 1.6],
      [501, null, 17.53, 130, 1.6],
    ]);
    const rajasthan = byKey("Rajasthan | JVVNL/AVVNL/JdVVNL | DS Domestic");
    expect(rajasthan.slabs.map((s) => [s.fromUnits, s.toUnits, s.energyRate, s.fixedRate, s.wheelingRate])).toEqual([
      [0, 50, 4.75, 150, 0.7],
      [51, 150, 6, 150, 0.7],
      [151, 500, 7, 300, 1],
      [501, null, 7.5, 800, 1],
    ]);
    const haryana = byKey("Haryana | UHBVN/DHBVN | DS-II Domestic Category-II (consumption >100 u/month)");
    expect(haryana.fixedBasis).toBe("per_kw_month");
  });
});
