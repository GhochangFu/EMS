import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const SCHEMA_REL = "apps/api/src/dashboard-builder/dashboards.schema.ts";
const CONTRACT_REL = "packages/shared/src/contracts/dashboard-builder.ts";
const MIGRATION_REL = "packages/db/drizzle/0054_dashboard_widget_sources.sql";

/**
 * The `METRIC_CATALOG_PARAMS_WRITE` map's source text, from `export const` to its closing brace.
 *
 * Scoped rather than scanning the whole file, because the whole file legitimately contains
 * `.uuid(` — `widgetIdentityWriteFields.id` and `pointBindingWriteSchema.pointId` are both
 * uuids and must stay so. A file-wide ban would be red on correct code, which is the fastest
 * route to a test being deleted rather than fixed.
 */
const paramsMapSource = (): string => {
  const source = read(SCHEMA_REL);
  const start = source.indexOf("export const METRIC_CATALOG_PARAMS_WRITE");
  if (start < 0) {
    throw new Error(
      `could not find METRIC_CATALOG_PARAMS_WRITE in ${SCHEMA_REL}. If the write-side params ` +
        "map was renamed or moved, fix this parser — do not delete the assertions, because " +
        "nothing else stops an id reaching `params`.",
    );
  }
  const end = source.indexOf("\n};", start);
  if (end < 0) throw new Error("unterminated METRIC_CATALOG_PARAMS_WRITE declaration");
  return source.slice(start, end + 3);
};

/** The catalog keys the shared vocabulary declares, parsed from source. */
const catalogKeys = (): string[] => {
  const block = /export const metricCatalogKeySchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(
    read(CONTRACT_REL),
  );
  if (block === null) {
    throw new Error(`could not find metricCatalogKeySchema's z.enum([...]) in ${CONTRACT_REL}`);
  }
  const keys = (block[1] ?? "")
    .split(",")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  if (keys.length === 0) throw new Error("metricCatalogKeySchema parsed to an empty list");
  return keys;
};

/**
 * `F3.35` Stage C — no id may reach `bms.dashboard_widget_sources.params`.
 *
 * **This file exists because a docblock claimed it already did.** The contract's
 * `dashboardWidgetSourceDtoSchema` stated, in the past tense, that `params` id containment "is
 * enforced rather than merely intended", and named two files as the enforcement. This item's
 * migration review checked: neither file existed. The claim was written forward, as a
 * specification, and then read backward, as a fact — and nothing in a committed file
 * distinguishes the two.
 *
 * **What is actually at stake.** A binding inherits its dashboard's scope
 * (`dashboards.location_id` / `asset_group_id`). A location or asset id inside `params` would be
 * an id inside `jsonb` that no foreign key covers and no orphan check can report — the ADR 0019
 * problem that ADR 0047 decision 3 rejected `jsonb` bindings to avoid, and that ADR 0048
 * decision 4 created a *fourth table* rather than re-create. Arriving through `params` it would
 * be the same defect one column over, having cost a migration to avoid.
 *
 * The database cannot hold this line. `dashboard_widget_sources_params_object_check` refuses a
 * scalar or an array at the top level and accepts `{"locationId": "<any uuid>"}` — it is a
 * floor, as migration `0054` says of itself. The write schema is the only control, and this is
 * the only thing that holds the write schema.
 *
 * In `tests/`, not beside the schema, because it reads across `apps/api`, `packages/shared` and
 * `packages/db`, and no app's Vitest project can see the others. Per §4.6's carve-out, files
 * here hold their assertions inline.
 */
describe("F3.35 Stage C — no id reaches a catalog binding's params", () => {
  it("declares a write-side params schema for every catalog key", () => {
    expect(existsSync(join(repoRoot, SCHEMA_REL)), `${SCHEMA_REL} must exist`).toBe(true);
    const map = paramsMapSource();
    const keys = catalogKeys();

    // The `Record<MetricCatalogKey, …>` annotation is what makes a missing key a COMPILE error,
    // so this assertion is the belt to that suspenders — and it is the half that survives
    // someone widening the annotation to `Record<string, …>` to silence a build.
    expect(map).toMatch(/Record<\s*MetricCatalogKey\s*,/);

    for (const key of keys) {
      expect(map, `${key} needs a write-side params schema`).toContain(`"${key}":`);
    }

    // And nothing beyond them. A sixth entry here with no enum member is a parameter schema for
    // a catalog entry that cannot be bound.
    const declared = [...map.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]);
    expect([...declared].sort()).toEqual([...keys].sort());
  });

  it("admits no uuid field in any entry", () => {
    const map = paramsMapSource();

    // THE RULE. Written against the map's own source rather than by parsing each schema,
    // because a `z.string().uuid()` nested inside an object or an array is still an id and a
    // structural walk would have to descend to find it. A text scan cannot be evaded by nesting.
    expect(
      map,
      "a uuid in `params` is an id inside jsonb that no foreign key covers — the ADR 0019 " +
        "problem ADR 0048 decision 4 created a fourth table to refuse",
    ).not.toMatch(/\.uuid\s*\(/);

    // The near-misses, named so a later author does not route around the line above. `.cuid()`
    // and `.ulid()` are ids by another spelling; a bare `locationId`/`assetId`/`pointId` field
    // is one even typed as a plain string.
    expect(map).not.toMatch(/\.(cuid2?|ulid|nanoid)\s*\(/);
    expect(map, "name the scope on the dashboard, never inside a binding's params").not.toMatch(
      /\b(locationId|assetGroupId|assetId|pointId|organizationId|dashboardId|widgetId)\b/,
    );
  });

  it("keeps every entry strict, and keeps them separate", () => {
    const map = paramsMapSource();
    const keys = catalogKeys();

    // `.strict()` per entry, or an unrecognized key is silently accepted and stored — which is
    // how an id gets in without ever being declared.
    expect((map.match(/\.strict\(\)/g) ?? []).length).toBe(keys.length);

    // The entries are identical today and must not be collapsed into one shared schema:
    // `alarms.active` takes a severity filter and `workorders.open` takes a status, and one
    // object would silently give every entry both. Recorded as an assertion because "they are
    // all the same, simplify it" is the obvious and wrong next edit.
    expect(map).not.toMatch(/:\s*sharedParamsSchema/);
  });

  it("is not scanning a stale claim", () => {
    // The contract must no longer assert this containment in the past tense, and must not name
    // a file that does not exist. That sentence is what this whole file was written to replace.
    const contract = read(CONTRACT_REL);
    expect(contract).not.toContain("apps/api/src/metric-catalog/metric-catalog.schema.ts");

    // And the floor the database actually provides is named as a floor, so a reader does not
    // mistake it for the control.
    expect(read(MIGRATION_REL)).toContain(
      "CONSTRAINT dashboard_widget_sources_params_object_check",
    );
  });
});
