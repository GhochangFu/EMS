import assert from "node:assert/strict";

import {
  assetPoints,
  assets,
  assetTemplates,
  locations,
  organizations,
  pointKeys,
  rtuConnectionConfigs,
  rtus,
} from "@bms/db";
import type { BmsDb } from "@bms/db";

import { withRollback } from "../../testing/with-rollback";
import { OnboardingCatalogService } from "./onboarding-catalog.service";
import {
  OnboardingInventoryService,
  type ExistingKind,
  type ExistingQuery,
  type ExistingRow,
} from "./onboarding-inventory.service";

/**
 * `F3.26` / ADR 0095 decisions 1–4 — `OnboardingInventoryService.listExisting`
 * and `OnboardingCatalogService.listInUsePointKeys` against a real database.
 *
 * **Fixture shape: rolled back, never committed.** Every claim runs inside
 * `withRollback` on the `bms_fleet` pool, inserts its two organizations (and
 * their locations, RTUs, connection configs, templates, assets, catalog keys
 * and asset points), runs the service on the transaction and ends in
 * `tx.rollback()`. Nothing commits, so there is no `afterAll` deletion and no
 * stale sweep. `bms_fleet` carries BYPASSRLS, so the service's tenant
 * predicate is the only thing that separates A from B here — which is the
 * claim under test (decision 2), not RLS.
 *
 * Every globally unique value (organization code, location slug, asset code,
 * point-key code) carries the per-run token, so two runs never wait on each
 * other's uncommitted rows. The run token is base-36 alphanumerics: no `_`
 * and no `%` reach any code or name, which `assertSearchEscapesLikeWildcards`
 * depends on. Location codes start with `F326` so the prefix negative in
 * `assertLocationCodeFilterIsExact` is meaningful.
 *
 * Point keys are the run's own `f326-<run>-kw`, `-kwh` and `-flow`, inserted in
 * the transaction: `asset_points.point_key` is a foreign key into
 * `point_keys`, and a fresh database need not hold `kwh` or `flow`.
 */
export type InventoryCtx = {
  /** `createDb` on the `bms_fleet` pool. */
  readonly fleetDb: BmsDb;
  /** Per-run token, base 36. */
  readonly run: string;
};

type Tx = Parameters<Parameters<BmsDb["transaction"]>[0]>[0];

const META_SENTINEL = "SENTINEL-F326-META";
const CONFIG_SENTINEL = "SENTINEL-F326-CONFIG";

type OrgFixture = {
  readonly organizationId: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly rtuId: string;
  readonly rtuCode: string;
  readonly assetCode: string;
};

type Family = {
  readonly a: OrgFixture;
  readonly b: OrgFixture;
  readonly keys: { readonly kw: string; readonly kwh: string; readonly flow: string };
};

function first<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`F3.26: fixture ${what} was not created`);
  return row;
}

async function seedOrganization(
  tx: Tx,
  run: string,
  side: "A" | "B",
  pointKeyCodes: readonly string[],
): Promise<OrgFixture> {
  const lower = side.toLowerCase();
  const org = first(
    await tx
      .insert(organizations)
      .values({ code: `F326-INV-${run}-${side}`, name: `F3.26 inventory ${side}`, currency: "INR" })
      .returning({ id: organizations.id }),
    `organization ${side}`,
  );
  const locationCode = `F326-LOC-${side}-${run}`;
  const location = first(
    await tx
      .insert(locations)
      .values({
        organizationId: org.id,
        code: locationCode,
        slug: `f326-loc-${lower}-${run}`,
        name: `F3.26 location ${side}`,
        type: "smoc_campus",
        latitude: 0,
        longitude: 0,
        meta: { token: META_SENTINEL },
      })
      .returning({ id: locations.id }),
    `location ${side}`,
  );
  const rtuCode = `F326-RTU-${side}`;
  const rtu = first(
    await tx
      .insert(rtus)
      .values({
        organizationId: org.id,
        locationId: location.id,
        code: rtuCode,
        displayName: `F3.26 RTU ${side}`,
        meta: { token: META_SENTINEL },
      })
      .returning({ id: rtus.id }),
    `RTU ${side}`,
  );
  await tx.insert(rtuConnectionConfigs).values({
    organizationId: org.id,
    rtuId: rtu.id,
    protocol: "mqtt",
    config: { password: CONFIG_SENTINEL, host: "h" },
  });
  let templateId: string | undefined;
  if (side === "A") {
    const template = first(
      await tx
        .insert(assetTemplates)
        .values({
          organizationId: org.id,
          code: `F326-TPL-${run}`,
          version: 1,
          name: "F3.26 template",
          assetType: "meter",
          domain: "electrical",
        })
        .returning({ id: assetTemplates.id }),
      "template A",
    );
    templateId = template.id;
  }
  const assetCode = `F326-AST-${side}-${run}`;
  const asset = first(
    await tx
      .insert(assets)
      .values({
        organizationId: org.id,
        code: assetCode,
        name: `F3.26 asset ${side}`,
        siteName: `F3.26 site ${side}`,
        locationId: location.id,
        rtuId: rtu.id,
        domain: "electrical",
        templateId,
        meta: { token: META_SENTINEL },
      })
      .returning({ id: assets.id }),
    `asset ${side}`,
  );
  if (pointKeyCodes.length > 0) {
    await tx.insert(assetPoints).values(
      pointKeyCodes.map((pointKey) => ({
        organizationId: org.id,
        assetId: asset.id,
        pointKey,
        sourceDataKey: `${pointKey}-src`,
      })),
    );
  }
  return {
    organizationId: org.id,
    locationId: location.id,
    locationCode,
    rtuId: rtu.id,
    rtuCode,
    assetCode,
  };
}

async function seedFamily(tx: Tx, run: string): Promise<Family> {
  const keys = { kw: `f326-${run}-kw`, kwh: `f326-${run}-kwh`, flow: `f326-${run}-flow` };
  await tx.insert(pointKeys).values([
    { code: keys.kw, name: "F3.26 kW", unit: "kW", domain: "electrical" },
    { code: keys.kwh, name: "F3.26 kWh", unit: "kWh", domain: "electrical" },
    { code: keys.flow, name: "F3.26 flow", unit: "m3/h", domain: "water" },
  ]);
  const a = await seedOrganization(tx, run, "A", [keys.kw, keys.kwh]);
  const b = await seedOrganization(tx, run, "B", [keys.flow]);
  return { a, b, keys };
}

async function addAsset(tx: Tx, owner: OrgFixture, code: string, name: string): Promise<void> {
  await tx.insert(assets).values({
    organizationId: owner.organizationId,
    code,
    name,
    siteName: "F3.26 site",
    locationId: owner.locationId,
    domain: "electrical",
  });
}

function service(tx: Tx): OnboardingInventoryService {
  return new OnboardingInventoryService(tx as unknown as BmsDb);
}

async function codes(
  svc: OnboardingInventoryService,
  organizationId: string,
  query: ExistingQuery,
): Promise<string[]> {
  const { rows } = await svc.listExisting(organizationId, query);
  return rows.map((row) => row.code);
}

async function assertKindListsOnlyTheSessionOrganization(
  ctx: InventoryCtx,
  kind: ExistingKind,
  codeOf: (fixture: OrgFixture) => string,
): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const { a, b } = await seedFamily(tx, ctx.run);
    const listed = await codes(service(tx), a.organizationId, { kind });
    assert.ok(listed.includes(codeOf(a)), `A's ${kind} ${codeOf(a)} is listed for A: ${listed.join(", ")}`);
    assert.ok(!listed.includes(codeOf(b)), `B's ${kind} ${codeOf(b)} is not listed for A`);
    tx.rollback();
  });
}

/** I1 */
export async function assertLocationsListOnlyTheSessionOrganization(ctx: InventoryCtx): Promise<void> {
  await assertKindListsOnlyTheSessionOrganization(ctx, "location", (f) => f.locationCode);
}

/** I2 — the mutation gate: delete `eq(rtus.organizationId, …)` and this reddens. */
export async function assertRtusListOnlyTheSessionOrganization(ctx: InventoryCtx): Promise<void> {
  await assertKindListsOnlyTheSessionOrganization(ctx, "rtu", (f) => f.rtuCode);
}

/** I3 */
export async function assertAssetsListOnlyTheSessionOrganization(ctx: InventoryCtx): Promise<void> {
  await assertKindListsOnlyTheSessionOrganization(ctx, "asset", (f) => f.assetCode);
}

/** I4 — ADR 0095 decision 3: no `config`, no credential column, no `meta`. */
export async function assertNoRowCarriesTheConfigOrMetaSentinel(ctx: InventoryCtx): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const { a } = await seedFamily(tx, ctx.run);
    const svc = service(tx);
    const all: ExistingRow[] = [];
    for (const kind of ["location", "rtu", "asset"] as const) {
      all.push(...(await svc.listExisting(a.organizationId, { kind })).rows);
    }
    const text = JSON.stringify(all);
    assert.ok(text.includes(a.rtuCode), "the adjacent positive: A's RTU code is in the rows");
    assert.ok(!text.includes(CONFIG_SENTINEL), "no row carries rtu_connection_configs.config");
    assert.ok(!text.includes(META_SENTINEL), "no row carries a meta column");
    tx.rollback();
  });
}

/**
 * I5 — ADR 0095 decision 3, "a test holds each list". The RTU list carries
 * `rtuCode`: the plan's Q-B flips to yes because `draftRtuSchema` has an
 * `rtuCode` field (`onboarding.schema.ts:106`).
 */
export async function assertResultKeysArePerKindAllowlists(ctx: InventoryCtx): Promise<void> {
  const expected: Record<ExistingKind, string[]> = {
    location: ["active", "code", "name", "rtuCount", "slug", "type"],
    rtu: ["active", "code", "displayName", "locationCode", "protocol", "rtuCode"],
    asset: ["code", "domain", "locationCode", "name", "rtuCode", "templateCode", "templateVersion"],
  };
  await withRollback(ctx.fleetDb, async (tx) => {
    const { a } = await seedFamily(tx, ctx.run);
    const svc = service(tx);
    for (const kind of ["location", "rtu", "asset"] as const) {
      const { rows } = await svc.listExisting(a.organizationId, { kind });
      assert.ok(rows.length > 0, `A has at least one ${kind}`);
      for (const row of rows) {
        assert.deepEqual(Object.keys(row).sort(), expected[kind], `${kind} row keys`);
      }
    }
    tx.rollback();
  });
}

/** I6 */
export async function assertSearchIsACaseInsensitiveSubstringOnCodeAndName(
  ctx: InventoryCtx,
): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const { a } = await seedFamily(tx, ctx.run);
    const meter = `F326-MTR-${ctx.run}`;
    const pump = `F326-PUMP-${ctx.run}`;
    await addAsset(tx, a, meter, "Main meter");
    await addAsset(tx, a, pump, "Feed pump");
    const svc = service(tx);
    assert.deepEqual(await codes(svc, a.organizationId, { kind: "asset", search: "METER" }), [meter]);
    assert.deepEqual(await codes(svc, a.organizationId, { kind: "asset", search: "pump" }), [pump]);
    tx.rollback();
  });
}

/** I7 — `%`, `_` and `\` are escaped; unescaped, `%` matches every row. */
export async function assertSearchEscapesLikeWildcards(ctx: InventoryCtx): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const { a } = await seedFamily(tx, ctx.run);
    const svc = service(tx);
    assert.ok(
      (await codes(svc, a.organizationId, { kind: "asset" })).includes(a.assetCode),
      "the adjacent positive: A has an asset with no search",
    );
    for (const kind of ["location", "rtu", "asset"] as const) {
      for (const search of ["%", "_"]) {
        const result = await svc.listExisting(a.organizationId, { kind, search });
        assert.deepEqual(result, { rows: [], total: 0 }, `${kind} search ${search}`);
      }
    }
    tx.rollback();
  });
}

/** I8 */
export async function assertLocationCodeFilterIsExact(ctx: InventoryCtx): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const { a } = await seedFamily(tx, ctx.run);
    const svc = service(tx);
    assert.deepEqual(
      await codes(svc, a.organizationId, { kind: "rtu", locationCode: a.locationCode }),
      [a.rtuCode],
    );
    assert.deepEqual(
      await svc.listExisting(a.organizationId, { kind: "rtu", locationCode: "F326" }),
      { rows: [], total: 0 },
    );
    tx.rollback();
  });
}

/** I9 — A holds its fixture asset plus 100 more: 101. Mutation: drop `.limit()`. */
export async function assertTheCapAndTheTotal(ctx: InventoryCtx): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const { a } = await seedFamily(tx, ctx.run);
    await tx.insert(assets).values(
      Array.from({ length: 100 }, (_, i) => ({
        organizationId: a.organizationId,
        code: `F326-BULK-${ctx.run}-${String(i).padStart(3, "0")}`,
        name: `F3.26 bulk ${i}`,
        siteName: "F3.26 site",
        locationId: a.locationId,
        domain: "electrical",
      })),
    );
    const { rows, total } = await service(tx).listExisting(a.organizationId, { kind: "asset" });
    assert.equal(rows.length, 100);
    assert.equal(total, 101);
    tx.rollback();
  });
}

/** I10 — ADR 0095 Q-A: an inactive row still blocks a code, so it is listed. */
export async function assertInactiveRowsAreListedWithTheFlag(ctx: InventoryCtx): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const { a } = await seedFamily(tx, ctx.run);
    const inactiveLocationCode = `F326-LOC-A2-${ctx.run}`;
    const inactive = first(
      await tx
        .insert(locations)
        .values({
          organizationId: a.organizationId,
          code: inactiveLocationCode,
          slug: `f326-loc-a2-${ctx.run}`,
          name: "F3.26 retired location",
          type: "smoc_campus",
          latitude: 0,
          longitude: 0,
          active: false,
        })
        .returning({ id: locations.id }),
      "inactive location",
    );
    await tx.insert(rtus).values({
      organizationId: a.organizationId,
      locationId: inactive.id,
      code: "F326-RTU-OFF",
      displayName: "F3.26 retired RTU",
      active: false,
    });
    const svc = service(tx);
    const activeBy = async (kind: ExistingKind) =>
      Object.fromEntries(
        (await svc.listExisting(a.organizationId, { kind })).rows.map((row) => [
          row.code,
          (row as { active: boolean }).active,
        ]),
      );
    assert.deepEqual(await activeBy("location"), {
      [a.locationCode]: true,
      [inactiveLocationCode]: false,
    });
    assert.deepEqual(await activeBy("rtu"), { [a.rtuCode]: true, "F326-RTU-OFF": false });
    tx.rollback();
  });
}

/** I11 — ADR 0095 decision 4. */
export async function assertInUsePointKeysAreTenantScoped(ctx: InventoryCtx): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const { a, b, keys } = await seedFamily(tx, ctx.run);
    const catalog = new OnboardingCatalogService(tx as unknown as BmsDb);
    const inA = await catalog.listInUsePointKeys(a.organizationId);
    const inB = await catalog.listInUsePointKeys(b.organizationId);
    assert.deepEqual([...inA].sort(), [keys.kw, keys.kwh].sort());
    assert.deepEqual([...inB], [keys.flow]);
    tx.rollback();
  });
}
