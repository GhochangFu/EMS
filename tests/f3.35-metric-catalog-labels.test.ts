import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.35` Stage C Unit 5 — the metric catalog is declared in `packages/shared` and labelled in
 * `apps/web`, and the two must name the same set.
 *
 * Here rather than beside either file for the reason `f3.35-tile-icon-vocabulary.test.ts` gives:
 * this reads across `packages/shared` and `apps/web`, and no app's Vitest project can see the
 * other. Per §4.6's carve-out, files in `tests/` hold their assertions inline.
 *
 * **The compiler already catches one direction and not the other, which is why this exists.**
 * `METRIC_CATALOG_PRESENTATION` is a `Record<MetricCatalogKey, …>`, so a key added to the enum
 * with no entry here fails the build. The reverse — an entry here for a key the enum no longer
 * declares — is a widened `Record` key that TypeScript accepts as excess only under some
 * settings, and a stale label is not a compile error in any of them. It is dead: no author can
 * select it, because the write path refuses the key before it is stored.
 *
 * The second test is the one with teeth on the day Stage B lands. `WIDGET_SOURCE_SHAPES` is
 * read by the picker AND by the write path, so a widget type that admits a binding while naming
 * no drawable shape gives an author a form whose every option answers 400.
 */
describe("F3.35 Stage C — the metric catalog's labels", () => {
  /** The enum members, parsed from the contract that governs what a stored binding may carry. */
  const enumMembers = (): string[] => {
    const block = /export const metricCatalogKeySchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(
      read("packages/shared/src/contracts/dashboard-builder.ts"),
    );
    if (!block) {
      throw new Error(
        "could not find metricCatalogKeySchema's z.enum([...]) in dashboard-builder.ts. The " +
          "declaration's shape changed; update this parser rather than deleting the guard — a " +
          "guard that fails open on the edit it exists to catch is worse than none, because it " +
          "is also reassuring.",
      );
    }
    const members = [...(block[1] as string).matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
    if (members.length === 0) {
      throw new Error(
        "metricCatalogKeySchema's z.enum([...]) parsed to zero members. That is not a real state " +
          "for this vocabulary to be in — fix the parser, do not let this pass on an empty set.",
      );
    }
    return members;
  };

  /** `METRIC_CATALOG_PRESENTATION`'s keys and labels, parsed from the frontend map. */
  const presentationEntries = (): Record<string, string> => {
    const block =
      /export const METRIC_CATALOG_PRESENTATION: Readonly<[\s\S]*?> = \{([\s\S]*?)\n\};/.exec(
        read("apps/web/src/lib/metric-catalog.ts"),
      );
    if (!block) {
      throw new Error(
        "could not find METRIC_CATALOG_PRESENTATION's declaration in metric-catalog.ts. The " +
          "declaration's shape changed; update this parser rather than deleting the guard — a " +
          "guard that fails open on the edit it exists to catch is worse than none, because it " +
          "is also reassuring.",
      );
    }
    const entries = [...(block[1] as string).matchAll(/"([\w.]+)":\s*\{[\s\S]*?label:\s*"([^"]*)"/g)];
    if (entries.length === 0) {
      throw new Error(
        "METRIC_CATALOG_PRESENTATION parsed to zero entries. That is not a real state for this " +
          "map to be in — fix the parser, do not let this pass on an empty set.",
      );
    }
    const out: Record<string, string> = {};
    for (const entry of entries) {
      out[entry[1] as string] = entry[2] as string;
    }
    return out;
  };

  it("labels exactly the keys the enum declares, both directions", () => {
    const enumSet = new Set(enumMembers());
    const labels = presentationEntries();
    const mapSet = new Set(Object.keys(labels));

    const missingFromMap = [...enumSet].filter((key) => !mapSet.has(key));
    const missingFromEnum = [...mapSet].filter((key) => !enumSet.has(key));

    expect(
      missingFromMap,
      "metricCatalogKeySchema declares these keys with no entry in METRIC_CATALOG_PRESENTATION: " +
        `${missingFromMap.join(", ")}. The builder's picker would show the raw key, and an ` +
        "author would be choosing between strings like `alarms.active.count`.",
    ).toEqual([]);

    expect(
      missingFromEnum,
      "METRIC_CATALOG_PRESENTATION labels these keys with no matching member in " +
        `metricCatalogKeySchema: ${missingFromEnum.join(", ")}. No author can ever select one — ` +
        "the write path refuses the key before it is stored, so the label is dead.",
    ).toEqual([]);
  });

  it("gives every entry a non-empty label and description", () => {
    const labels = presentationEntries();
    for (const [key, label] of Object.entries(labels)) {
      expect(
        label.trim().length > 0,
        `METRIC_CATALOG_PRESENTATION["${key}"].label is empty — the picker would render a blank row.`,
      ).toBe(true);
      expect(
        label,
        `METRIC_CATALOG_PRESENTATION["${key}"].label is the raw key. A label is what makes this ` +
          "map worth having; copying the key back is the same as having no label at all.",
      ).not.toBe(key);
    }
  });

  it("gives every widget type that admits a catalog binding at least one drawable shape", () => {
    const source = read("packages/shared/src/contracts/dashboard-builder.ts");

    const recordBody = (name: string): string => {
      const block = new RegExp(`export const ${name}: Record<[\\s\\S]*?> = \\{([\\s\\S]*?)\\n\\};`).exec(
        source,
      );
      if (!block) {
        throw new Error(
          `could not find ${name}'s declaration in dashboard-builder.ts. Update this parser ` +
            "rather than deleting the guard.",
        );
      }
      return block[1] as string;
    };

    const cardinality = [
      ...recordBody("WIDGET_SOURCE_CARDINALITY").matchAll(/(\w+):\s*\{\s*min:\s*\d+,\s*max:\s*(\d+)\s*\}/g),
    ];
    const shapes = [...recordBody("WIDGET_SOURCE_SHAPES").matchAll(/(\w+):\s*\[([^\]]*)\]/g)];

    expect(cardinality.length, "WIDGET_SOURCE_CARDINALITY parsed to zero entries").toBeGreaterThan(0);
    expect(shapes.length, "WIDGET_SOURCE_SHAPES parsed to zero entries").toBeGreaterThan(0);
    expect(
      shapes.map((m) => m[1]).sort(),
      "the two records must cover the same widget types — a type in one and not the other is a " +
        "gap no compiler sees, because each Record is checked against the enum and not against " +
        "the other.",
    ).toEqual(cardinality.map((m) => m[1]).sort());

    const drawable = new Map(shapes.map((m) => [m[1] as string, (m[2] as string).trim()]));
    for (const [, widgetType, max] of cardinality) {
      const admits = Number(max) > 0;
      const names = (drawable.get(widgetType as string) ?? "").length > 0;
      expect(
        names,
        `${widgetType}: WIDGET_SOURCE_CARDINALITY ${admits ? "admits" : "admits no"} catalog ` +
          `binding, and WIDGET_SOURCE_SHAPES names ${names ? "a" : "no"} drawable shape. A type ` +
          "that admits a binding while naming no shape gives an author a picker whose every " +
          "option answers 400; a type that names a shape it cannot bind is dead configuration.",
      ).toBe(admits);
    }
  });
});
