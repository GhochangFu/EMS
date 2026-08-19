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

    for (const kind of ["measured", "manual", "computed", "unmapped"]) {
      expect(migration, `must define the '${kind}' source kind`).toContain(`'${kind}'`);
    }
    expect(
      migration,
      "a 'measured' point must require a source reference",
    ).toMatch(/source_kind = 'measured' AND rtu_id IS NOT NULL/);
    expect(
      migration,
      "sourceless kinds must carry no source reference",
    ).toMatch(/source_kind IN \('manual', 'computed', 'unmapped'\) AND rtu_id IS NULL/);

    // The default decides whether an existing writer that sets neither column
    // produces a valid row or a 500. Defaulting to 'measured' made every such
    // INSERT violate the ref check — two live endpoints, invisible to CI
    // because the seed sets the columns explicitly.
    expect(
      migration,
      "source_kind must default to 'unmapped'; defaulting to 'measured' breaks every writer that omits rtu_id",
    ).toMatch(/source_kind varchar\(16\) NOT NULL DEFAULT 'unmapped'/);

    // Constraint names are unique per relation, not per cluster.
    const guards = migration.match(/FROM pg_constraint/g) ?? [];
    const qualified = migration.match(/conrelid = 'bms\.asset_points'::regclass/g) ?? [];
    expect(
      qualified.length,
      "every pg_constraint existence guard must be qualified by conrelid, or a same-named constraint elsewhere makes ADD CONSTRAINT a silent no-op",
    ).toBe(guards.length);
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

    // Second contradiction, found by review after the first was fixed: the seed
    // verifier ran its own `assets WHERE rtu_id IS NULL` assertion and threw.
    // It passes today only because the seed happens to wire every asset — the
    // first gateway-less asset from F1.8/F1.9 would turn db:seed red in CI.
    const verifier = read("packages/db/src/verify-hierarchy-seed.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*(\/\/|--).*$/gm, "");
    expect(
      verifier,
      "verify-hierarchy-seed must not assert assets.rtu_id IS NULL = 0 — ADR 0018 makes a null gateway legal",
    ).not.toMatch(/bms\.assets WHERE rtu_id IS NULL/);
  });

  it("keeps every asset_points writer supplying provenance", () => {
    // The CHECK is only as good as the writers. These two omitted both columns
    // and would have 500'd on every call; neither has a test, and the seed sets
    // the columns explicitly, so CI stayed green while the endpoints were dead.
    for (const rel of [
      "apps/api/src/admin/asset-points/asset-points.service.ts",
      "apps/api/src/admin/onboarding/onboarding-commit.service.ts",
    ]) {
      const src = read(rel);
      expect(src, `${rel} must set sourceKind when inserting asset points`).toMatch(
        /sourceKind:/,
      );
      expect(src, `${rel} must set rtuId when inserting asset points`).toMatch(/rtuId:/);
    }
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

  it("exposes source_kind as a Zod enum matching the CHECK constraint (owed by F1.8/F1.9)", () => {
    // ADR 0018's own "Risk accepted" section: source_kind is enforced by a
    // CHECK constraint, not by Zod at the controller boundary, and "adding a
    // schema-level enum is owed when F1.8/F1.9 expose the field to callers."
    // This is that enum. A value present in one and not the other is exactly
    // the drift a hand-maintained pair invites — so both are parsed from their
    // own source of truth and compared, rather than one hard-coding the other's
    // list.
    const migration = read("packages/db/drizzle/0023_source_axis_separation.sql");
    const checkMatch = migration.match(
      /asset_points_source_kind_check\s+CHECK \(source_kind IN \(([^)]+)\)\)/,
    );
    if (!checkMatch) {
      throw new Error("could not find asset_points_source_kind_check in migration 0023");
    }
    const fromMigration = new Set(
      checkMatch[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")),
    );

    const contract = read("packages/shared/src/contracts/telemetry-entry.ts");
    const enumMatch = contract.match(
      /pointSourceKindSchema = z\.enum\(\[([^\]]+)\]\)/,
    );
    if (!enumMatch) {
      throw new Error(
        "packages/shared/src/contracts/telemetry-entry.ts must export " +
          "pointSourceKindSchema = z.enum([...]) with the four source_kind values",
      );
    }
    const fromContract = new Set(
      enumMatch[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")),
    );

    expect(
      [...fromContract].sort(),
      "pointSourceKindSchema must list exactly the CHECK's four values, no more, no fewer",
    ).toEqual([...fromMigration].sort());

    // The vocabulary a caller may WRITE excludes 'measured' — the API cannot
    // supply the rtu_id source_kind_check requires it to carry, so admitting
    // it would turn a 400 that names the options into a 500 from
    // asset_points_source_ref_check.
    expect(
      contract,
      "writableSourceKindSchema must derive from pointSourceKindSchema via .extract(), " +
        "not restate the list, and must exclude 'measured'",
    ).toMatch(
      /writableSourceKindSchema = pointSourceKindSchema\.extract\(\[[^\]]*"manual"[^\]]*"unmapped"[^\]]*\]\)/,
    );
    expect(contract).not.toMatch(/writableSourceKindSchema[\s\S]*?"measured"/);
  });
});
