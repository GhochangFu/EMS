import pg from "pg";
import { expect } from "vitest";

import type { AssetInstantiationResultDto, JwtPayload } from "@bms/shared";

/**
 * `F4.139` — the **third** writer of `assets.rtu_id`.
 *
 * `AssetsAdminService` (`F4.139`) and `OnboardingCommitService` (`F4.140`) were
 * the two the plan named. Review found this one: `instantiate` inserts N assets
 * carrying `target.rtuId` and, before this file, no `meta` at all — so a whole
 * commissioning batch deployed onto an ingest-enabled RTU arrived with the key
 * absent, which `apps/sim/src/index.js:397` reads as `sim` and
 * `apps/ingest/src/host/bindings.ts:422` reads as `mqtt`. Two producers on one
 * `(time, asset, point_key)`, N assets at a time, from the one screen that
 * creates assets in bulk.
 *
 * The invariant, the predicate and why the derived value wins the merge are
 * recorded once, in `admin/telemetry-source.ts`. This file asserts only that
 * this caller applies it.
 *
 * Its own fixture prefix, not `asset-templates.instantiate.integration.spec`'s:
 * Vitest runs files in parallel and that suite's `cleanup` deletes
 * `F22-INST-TEST-%` in `beforeAll`. Two suites sharing a prefix delete each
 * other's rows halfway through a run.
 */
export type InstantiateTelemetrySourceCtx = {
  /** Instantiate with the **wire-shape** body, parsed through the real schema. */
  readonly instantiate: (
    jwt: JwtPayload,
    templateId: string,
    body: unknown,
  ) => Promise<AssetInstantiationResultDto>;
  /** `bms_fleet` (BYPASSRLS) — fixture rows and read-back only. */
  readonly fixturePool: pg.Pool;
  readonly organizationId: string;
  readonly locationId: string;
  readonly templateId: string;
  readonly createdAssetIds: string[];
  readonly createdRtuIds: string[];
};

/** `bms.assets.meta` as this suite reads it. */
type AssetMeta = { telemetrySource?: string } | null;

/** `asset_templates.code` has no charset check; `assets.code` has (ADR 0065). */
export const FIXTURE_PREFIX = "F4139-INST";

let fixtureSeq = 0;

function nextTag(): string {
  return `${FIXTURE_PREFIX}-${Date.now()}-${fixtureSeq++}`;
}

/**
 * One RTU in the fixture location, inserted directly on the fixture pool.
 *
 * `organization_id` is the location's: `resolveTarget` joins `rtus` to
 * `locations` and the batch then writes under `withTenant(template.org)`, so an
 * RTU stamped with another organization would fail the org check rather than
 * reach the derivation.
 */
export async function createFixtureRtu(
  ctx: InstantiateTelemetrySourceCtx,
  rtu: { sourceType: string; ingestEnabled: boolean },
): Promise<string> {
  const tag = nextTag();
  const res = await ctx.fixturePool.query<{ id: string }>(
    `INSERT INTO bms.rtus
       (organization_id, location_id, code, display_name, source_type, ingest_enabled, active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING id`,
    [
      ctx.organizationId,
      ctx.locationId,
      `${tag}-rtu`,
      `F4.139 ${tag}`,
      rtu.sourceType,
      rtu.ingestEnabled,
    ],
  );
  const id = res.rows[0]?.id;
  if (id === undefined) {
    throw new Error("F4.139: fixture RTU insert returned no id");
  }
  ctx.createdRtuIds.push(id);
  return id;
}

/** Two assets, so "every row in the batch" is a claim and not a sample of one. */
async function instantiateOnto(
  ctx: InstantiateTelemetrySourceCtx,
  jwt: JwtPayload,
  target: { rtuId: string } | { locationId: string },
): Promise<string[]> {
  const tag = nextTag();
  const result = await ctx.instantiate(jwt, ctx.templateId, {
    ...target,
    assets: [
      { code: `${tag}-a`, name: `F4.139 batch ${tag} A` },
      { code: `${tag}-b`, name: `F4.139 batch ${tag} B` },
    ],
  });
  const ids = result.assets.map((asset) => asset.id);
  ctx.createdAssetIds.push(...ids);
  if (ids.length !== 2) {
    throw new Error(`F4.139: expected 2 instantiated assets, got ${ids.length}`);
  }
  return ids;
}

/** Read-back on `bms_fleet`, never the returned DTO: the row is the claim. */
async function readMetas(
  ctx: InstantiateTelemetrySourceCtx,
  assetIds: string[],
): Promise<AssetMeta[]> {
  const res = await ctx.fixturePool.query<{ meta: AssetMeta }>(
    "SELECT meta FROM bms.assets WHERE id = ANY($1) ORDER BY code",
    [assetIds],
  );
  if (res.rows.length !== assetIds.length) {
    throw new Error(
      `F4.139: expected ${assetIds.length} bms.assets rows, found ${res.rows.length}`,
    );
  }
  return res.rows.map((row) => row.meta);
}

/**
 * I1 — a batch deployed onto an ingest-enabled `mqtt` RTU is `mqtt` on every row.
 *
 * `toEqual` over the whole array rather than a loop of assertions: one failing
 * row in a batch of two is the partial-write shape this service's own header
 * calls the outcome worse than failure, and a loop would stop at the first.
 */
export async function assertInstantiateDerivesMqttForEveryAssetInTheBatch(
  ctx: InstantiateTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const rtuId = await createFixtureRtu(ctx, { sourceType: "mqtt", ingestEnabled: true });
  const assetIds = await instantiateOnto(ctx, jwt, { rtuId });

  const sources = (await readMetas(ctx, assetIds)).map((meta) => meta?.telemetrySource);
  expect(sources).toEqual(["mqtt", "mqtt"]);
}

/**
 * I2 — and `catalog` on every row of a `simulator` RTU's batch.
 *
 * The explicit string, not `undefined`: an absent key is exactly the bug this
 * file closes, so a service that derived the value for `mqtt` alone and left the
 * simulator batch bare would still be shipping two producers' worth of
 * ambiguity. This is also the `F4.59` first-draft defect (`!== "catalog"`) at
 * the third caller — a `simulator` RTU is `ingest_enabled` here on purpose.
 */
export async function assertInstantiateDerivesCatalogForASimulatorRtu(
  ctx: InstantiateTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const rtuId = await createFixtureRtu(ctx, { sourceType: "simulator", ingestEnabled: true });
  const assetIds = await instantiateOnto(ctx, jwt, { rtuId });

  const sources = (await readMetas(ctx, assetIds)).map((meta) => meta?.telemetrySource);
  expect(sources).toEqual(["catalog", "catalog"]);
}

/**
 * I3 — a location target writes no key at all.
 *
 * The gateway-less path (ADR 0018): there is no RTU to derive from, and
 * inventing `catalog` here would claim an answer nobody gave — the same rule
 * `AssetsAdminService.create` follows with `rtuId: null` (case A5). Without this
 * case, deriving on both branches of `resolveTarget` would pass I1 and I2.
 */
export async function assertALocationTargetWritesNoTelemetrySource(
  ctx: InstantiateTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const assetIds = await instantiateOnto(ctx, jwt, { locationId: ctx.locationId });

  const metas = await readMetas(ctx, assetIds);
  expect(metas.map((meta) => meta?.telemetrySource)).toEqual([undefined, undefined]);
}
