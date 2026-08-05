import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * ADR 0018 — the telemetry-source axis is separate from the spatial axis.
 *
 * Static assertions over the migration, the drizzle schema and the seed, rather
 * than queries against a live database. That is deliberate: the defect this ADR
 * fixes was never a runtime error. It was three artefacts disagreeing about
 * which column is mandatory, each individually plausible in review. `F4.10`
 * owns the live-database proof.
 *
 * These live in `tests/` rather than beside the code because `packages/db` is
 * not a Vitest project — a `.spec`/`.test` pair there would satisfy the orphan
 * invariant while nothing executed it.
 */
describe("ADR 0018 — source axis separation", () => {
  it("registers migration 0023 in the drizzle journal", () => {
    // A .sql file drizzle never applies is this repo's most-repeated failure
    // (0018/0021/0022 shipped unjournaled and left bms.point_keys missing).
    expect(read("packages/db/drizzle/meta/_journal.json")).toContain(
      "0023_source_axis_separation",
    );
  });

  it("inverts both polarities, and backfills before constraining", () => {
    const migration = read("packages/db/drizzle/0023_source_axis_separation.sql");

    expect(
      migration,
      "assets.location_id must become NOT NULL — it is the column every scoped access check filters on",
    ).toMatch(/ALTER COLUMN location_id SET NOT NULL/);
    expect(
      migration,
      "assets.rtu_id must become nullable — an asset need not be wired to exist",
    ).toMatch(/ALTER COLUMN rtu_id DROP NOT NULL/);

    // Order is load-bearing twice over.
    expect(
      migration.indexOf("SET location_id = r.location_id"),
      "the location backfill must run before location_id becomes NOT NULL",
    ).toBeLessThan(migration.indexOf("ALTER COLUMN location_id SET NOT NULL"));
    expect(
      migration.indexOf("SET rtu_id = a.rtu_id"),
      "asset_points must be backfilled while assets.rtu_id is still NOT NULL, or 'measured' rows land with a null source and the CHECK rejects them",
    ).toBeLessThan(migration.indexOf("asset_points_source_ref_check"));
  });

  it("makes a null source unambiguous via source_kind", () => {
    const migration = read("packages/db/drizzle/0023_source_axis_separation.sql");

    for (const kind of ["measured", "manual", "computed"]) {
      expect(migration, `must define the '${kind}' source kind`).toContain(`'${kind}'`);
    }
    expect(
      migration,
      "a 'measured' point must require a source reference",
    ).toMatch(/source_kind = 'measured' AND rtu_id IS NOT NULL/);
    expect(
      migration,
      "hand-entered and computed points must carry no source reference",
    ).toMatch(/source_kind IN \('manual', 'computed'\) AND rtu_id IS NULL/);
  });

  it("keeps the drizzle schema in step with the migration", () => {
    const schema = read("packages/db/src/schema/bms-schema.ts");
    const assetsBlock = schema.slice(
      schema.indexOf("export const assets = "),
      schema.indexOf("export const assetGroups = "),
    );
    const pointsBlock = schema.slice(
      schema.indexOf("export const assetPoints = "),
      schema.indexOf("export const userLocationAccess = "),
    );

    expect(assetsBlock, "assets.locationId must be notNull").toMatch(
      /locationId: uuid\("location_id"\)\s*\.notNull\(\)/,
    );
    expect(
      assetsBlock,
      "assets.rtuId must NOT be notNull — that is the constraint 0023 removes",
    ).not.toMatch(/rtuId: uuid\("rtu_id"\)\s*\.notNull\(\)/);
    expect(pointsBlock, "asset_points must carry the source reference").toMatch(
      /rtuId: uuid\("rtu_id"\)/,
    );
    expect(pointsBlock, "asset_points must carry source_kind").toMatch(
      /sourceKind: varchar\("source_kind"/,
    );
  });

  it("never lets the seed re-apply the constraint the migration removed", () => {
    // This is the one that actually bites. `enforceHierarchyNotNull` runs on
    // every `db:seed`, and CI runs `db:migrate` then `db:seed` — so a stray
    // SET NOT NULL here silently undoes migration 0023 on a freshly migrated
    // database while the migration still reads correctly in review.
    // Strip comments first: the docstring on `enforceHierarchyNotNull`
    // deliberately quotes the statement it warns against, and that prose must
    // not read as a violation. This assertion is about executable code.
    const seed = read("packages/db/src/hierarchy-seed.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(
      seed,
      "hierarchy-seed must NOT re-apply assets.rtu_id NOT NULL — it would undo migration 0023 on every db:seed",
    ).not.toMatch(/bms\.assets\s+ALTER COLUMN rtu_id SET NOT NULL/);
    expect(
      seed,
      "hierarchy-seed must enforce assets.location_id NOT NULL after backfill",
    ).toMatch(/bms\.assets\s+ALTER COLUMN location_id SET NOT NULL/);
    expect(
      seed,
      "the seed guard must check the column that is now mandatory, not the old one",
    ).toContain("assets without location_id remain");
  });

  it("does not silently drop gateway-less assets from admin queries", () => {
    // An INNER JOIN on a now-nullable FK hides exactly the assets this ADR
    // exists to make possible — the same silent-invisibility shape as the
    // nullable location_id it fixes.
    const service = read("apps/api/src/admin/assets/assets.service.ts");
    expect(
      service,
      "assets.service must LEFT JOIN rtus; an inner join drops assets with no gateway",
    ).not.toMatch(/innerJoin\(rtus/);
    expect(service).toMatch(/leftJoin\(rtus/);
  });
});
