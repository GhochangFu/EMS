import { randomUUID } from "node:crypto";

import type pg from "pg";

import { assetTemplates, assets, createDb, templatePoints } from "@bms/db";
import { CALC_DIALECT, CALC_DIALECT_V2 } from "@bms/shared";

import type { CalcStatusRegistry } from "../../calc/calc-status.registry";
import type { Fixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import type { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";

/**
 * `F2.9` Task 12 — the override author refuses a `bms-calc-v2` formula that
 * would close a dependency cycle (ADR 0055 decision 8).
 *
 * **A sibling file, not more cases in `asset-point-calc-override.integration.spec.ts`.**
 * That file is at 780 lines against AGENTS.md §4.5's 1000-line cap, and finding
 * 19's ruling is that the answer to a full file is a sibling, never a squeeze.
 *
 * **Why these cases cannot be unit tests.** The cycles here do not exist in any
 * one formula. `X.TOTAL = sum({KW} @site)` names no asset; it becomes an edge
 * to `Y.KW` only because `Y` sits at `X`'s location and declares `KW`. That is
 * a fact about rows in `bms.assets` and `bms.template_points`, resolved by
 * `CalcScopeService` against the real database, and nothing short of one can
 * produce it.
 *
 * The fixture, in `fx.organizationId`:
 *
 * - **X** — at location 1, `TOTAL = sum({KW} @site)` under `v2`.
 * - **Y** — at location 1, `KW` derived under `v1` from a measured key. It is
 *   the site member `X` aggregates, and it is the point every case overrides.
 * - **V** — at location 1, `TOTAL = {Y.KW}` under `v2` — a qualified reference
 *   back to `Y`.
 * - **W** — at location 2, pinned to the **same template as V**, so it carries
 *   the identical formula. `V` and `W` differ in exactly one thing: location.
 *
 * That last pair is the point of `assertQualifiedReferenceIsConfinedToLocation`.
 * `bms.assets.code` is globally unique, so a lookup by code alone finds `W`
 * from location 1; only decision 12's `location_id` filter stops it. The same
 * override text is therefore refused against `V` and accepted against `W`.
 */

/** Per-run, so two instances of this file never delete each other's rows
 * (`tests/integration-fixture-isolation.test.ts`). */
export const TEST_CODE = `F29-OVRCYC-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

const KEY_SUFFIX = TEST_CODE.slice(-8);
/** Per-run too: `registerFixturePointKeys` removes only what it inserted, and a
 * shared code under a concurrent instance would be deleted from under this
 * fixture's `template_points` rows. */
export const KEY_MEASURED = `OVRCYC_M_${KEY_SUFFIX}`;
export const KEY_KW = `OVRCYC_KW_${KEY_SUFFIX}`;
export const KEY_TOTAL = `OVRCYC_TOTAL_${KEY_SUFFIX}`;

export const CODE_X = `${TEST_CODE}-X`;
export const CODE_Y = `${TEST_CODE}-Y`;
export const CODE_V = `${TEST_CODE}-V`;
export const CODE_W = `${TEST_CODE}-W`;

export type CycleFixture = { readonly x: string; readonly y: string; readonly v: string; readonly w: string };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The rejection's message and HTTP status, or a throw naming what was expected. */
async function expectRejection(
  run: () => Promise<unknown>,
  match: RegExp,
  what: string,
  expectedStatus: number,
): Promise<string> {
  let message: string | null = null;
  let status: number | null = null;
  try {
    await run();
  } catch (err) {
    const getStatus = (err as { getStatus?: () => number } | null)?.getStatus;
    status = typeof getStatus === "function" ? getStatus.call(err) : null;
    const response = (err as { response?: unknown } | null)?.response;
    const nested = (response as { message?: unknown } | null)?.message;
    message =
      typeof nested === "string"
        ? nested
        : typeof response === "string"
          ? response
          : err instanceof Error
            ? err.message
            : String(err);
  }
  assert(message !== null, `${what}: expected a rejection, but the call succeeded`);
  assert(match.test(message ?? ""), `${what}: rejected with "${message}", which does not match ${match}`);
  assert(status === expectedStatus, `${what}: expected status ${expectedStatus}, got ${String(status)}`);
  return message ?? "";
}

/** Children first: asset_points and audit rows, then assets, then templates. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.audit_log WHERE entity_id IN
       (SELECT ap.id FROM bms.asset_points ap
          JOIN bms.assets a ON a.id = ap.asset_id
         WHERE a.code LIKE $1)`,
    [`${TEST_CODE}%`],
  );
  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_CODE}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_CODE}%`]);
  // template_points cascade on the FK.
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE}%`]);
}

/**
 * Writes the four assets and their three templates directly. This suite is
 * about what the detector does with rows already in the database, not about how
 * they got there — and two of these formulas are ones the template author would
 * itself refuse once instantiated, which is the situation the tick exists for.
 */
export async function seedCycleFixture(pool: pg.Pool, fx: Fixtures): Promise<CycleFixture> {
  const db = createDb(pool);

  const template = async (
    suffix: string,
    points: {
      pointKey: string;
      kind: "measured" | "derived";
      formula?: string;
      formulaDialect?: string;
      sortOrder: number;
    }[],
  ): Promise<string> => {
    const [row] = await db
      .insert(assetTemplates)
      .values({
        organizationId: fx.organizationId,
        code: `${TEST_CODE}-${suffix}`,
        version: 1,
        name: `Override Cycle Fixture ${suffix}`,
        assetType: "test_rig",
        domain: "electrical",
        status: "published",
        publishedAt: new Date(),
      })
      .returning({ id: assetTemplates.id });
    await db.insert(templatePoints).values(
      points.map((point) => ({
        organizationId: fx.organizationId,
        templateId: row.id,
        pointKey: point.pointKey,
        kind: point.kind,
        sortOrder: point.sortOrder,
        sourceDataKeyPattern: point.kind === "measured" ? "SITE/{asset_code}/M" : undefined,
        formula: point.formula,
        formulaDialect: point.formulaDialect,
        // Decision 10: a `v2` point is scheduled, with an interval.
        calcTrigger: point.formula ? ("scheduled" as const) : undefined,
        calcIntervalSeconds: point.formula ? 300 : undefined,
      })),
    );
    return row.id;
  };

  const measured = { pointKey: KEY_MEASURED, kind: "measured" as const, sortOrder: 0 };

  const aggregateTemplate = await template("TAGG", [
    measured,
    {
      pointKey: KEY_TOTAL,
      kind: "derived",
      formula: `sum({${KEY_KW}} @site)`,
      formulaDialect: CALC_DIALECT_V2,
      sortOrder: 1,
    },
  ]);
  const memberTemplate = await template("TMEM", [
    measured,
    {
      pointKey: KEY_KW,
      kind: "derived",
      formula: `{${KEY_MEASURED}} * 2`,
      formulaDialect: CALC_DIALECT,
      sortOrder: 1,
    },
  ]);
  // One template for both V and W — the two assets then differ in nothing but
  // their location, which is what makes the containment case a controlled pair.
  const qrefTemplate = await template("TQREF", [
    measured,
    {
      pointKey: KEY_TOTAL,
      kind: "derived",
      formula: `{${CODE_Y}.${KEY_KW}}`,
      formulaDialect: CALC_DIALECT_V2,
      sortOrder: 1,
    },
  ]);

  const asset = async (code: string, templateId: string, locationId: string): Promise<string> => {
    const [row] = await db
      .insert(assets)
      .values({
        code,
        name: `Cycle Fixture ${code}`,
        siteName: "Cycle Fixture Site",
        organizationId: fx.organizationId,
        locationId,
        domain: "electrical",
        templateId,
      })
      .returning({ id: assets.id });
    return row.id;
  };

  return {
    x: await asset(CODE_X, aggregateTemplate, fx.rtuLocationId),
    y: await asset(CODE_Y, memberTemplate, fx.rtuLocationId),
    v: await asset(CODE_V, qrefTemplate, fx.rtuLocationId),
    w: await asset(CODE_W, qrefTemplate, fx.otherLocationId),
  };
}

const NOTHING = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
} as const;

async function formulaOf(pool: pg.Pool, assetId: string, pointKey: string): Promise<string | null | undefined> {
  const { rows } = await pool.query<{ formula: string | null }>(
    `SELECT formula FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
    [assetId, pointKey],
  );
  return rows.length === 0 ? undefined : rows[0].formula;
}

/**
 * ADR 0055 decision 8 at the override author: a `v2` formula that closes a
 * cycle **through site membership** is refused, and nothing is written.
 *
 * `X.TOTAL = sum({KW} @site)` already reads `Y.KW`, because `Y` is at `X`'s
 * location and declares `KW`. Overriding `Y.KW` to `{X.TOTAL}` closes the loop
 * — and neither formula names the other's asset, so no check on this request
 * alone could see it. That is the whole reason the detector builds the real
 * graph rather than inspecting the text in front of the author.
 *
 * Three things are asserted beyond the status, because a 400 by itself is weak
 * evidence: **no row is written** (the refusal must precede the eager create),
 * the message names both members, and it does **not** name `V` — which reads
 * `Y.KW` and is therefore downstream of the cycle rather than on it (plan
 * design decision 7, the owner's Q6 ruling).
 */
export async function assertV2OverrideRefusesAMembershipCycle(
  pool: pg.Pool,
  fx: Fixtures,
  svc: AssetPointCalcOverrideService,
): Promise<void> {
  const fixture = await seedCycleFixture(pool, fx);

  const message = await expectRejection(
    () =>
      svc.setOverride(fx.adminJwt, fixture.y, KEY_KW, {
        ...NOTHING,
        formula: `{${CODE_X}.${KEY_TOTAL}}`,
        formulaDialect: CALC_DIALECT_V2,
        calcTrigger: "scheduled",
        calcIntervalSeconds: 60,
      }),
    /dependency cycle/,
    "a bms-calc-v2 override closing a cycle through @site membership",
    400,
  );
  assert(
    (await formulaOf(pool, fixture.y, KEY_KW)) === undefined,
    "the refusal must precede the eager create — no asset_points row may exist afterwards",
  );
  assert(
    message.includes(`${CODE_X}/${KEY_TOTAL}`) && message.includes(`${CODE_Y}/${KEY_KW}`),
    `the message must name both points on the cycle so the author can break it, got: ${message}`,
  );
  assert(
    !message.includes(CODE_V),
    "V reads Y.KW but is not on the cycle. Reporting it would be Kahn's stuck set, which " +
      `decision 7 and the Q6 ruling both refuse — only members are named. Got: ${message}`,
  );
  assert(
    !message.includes("sum("),
    "a refusal must never echo formula text back to the caller — a stored formula is " +
      "pre-authorship tenant content (ADR 0037's logging discipline)",
  );

  // Anti-vacuity: the same qualified-reference shape against a **measured**
  // point of X forms no edge and must be written. Without this the case above
  // is equally satisfied by "every v2 qualified reference is refused".
  await svc.setOverride(fx.adminJwt, fixture.y, KEY_KW, {
    ...NOTHING,
    formula: `{${CODE_X}.${KEY_MEASURED}}`,
    formulaDialect: CALC_DIALECT_V2,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
  });
  assert(
    (await formulaOf(pool, fixture.y, KEY_KW)) === `{${CODE_X}.${KEY_MEASURED}}`,
    "a v2 override that closes no cycle must be stored verbatim",
  );
}

/**
 * ADR 0055 decision 12 through the detector: `{CODE.key}` resolves only at the
 * **owner's** location, so a cycle that would exist if it did not is not one.
 *
 * `V` and `W` are pinned to the same template and carry the identical formula
 * `{Y.KW}`; `V` is at `Y`'s location and `W` is not. The same override text on
 * `Y.KW` is therefore accepted against `W` and refused against `V`. Asserting
 * only the acceptance would be vacuous — a detector that never ran would also
 * accept — so the refusing half is the control, in the same case, on the same
 * row.
 *
 * The second call also proves the refusal precedes the **update** path, not
 * just the insert: the row already exists, and it must come back unchanged.
 */
export async function assertQualifiedReferenceIsConfinedToLocation(
  pool: pg.Pool,
  fx: Fixtures,
  svc: AssetPointCalcOverrideService,
): Promise<void> {
  const fixture = await seedCycleFixture(pool, fx);

  const acrossLocations = `{${CODE_W}.${KEY_TOTAL}}`;
  await svc.setOverride(fx.adminJwt, fixture.y, KEY_KW, {
    ...NOTHING,
    formula: acrossLocations,
    formulaDialect: CALC_DIALECT_V2,
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
  });
  assert(
    (await formulaOf(pool, fixture.y, KEY_KW)) === acrossLocations,
    "W is at another location, so neither reference resolves and there is no cycle to refuse. " +
      "assets.code is globally unique — only decision 12's location_id filter makes this true.",
  );

  await expectRejection(
    () =>
      svc.setOverride(fx.adminJwt, fixture.y, KEY_KW, {
        ...NOTHING,
        formula: `{${CODE_V}.${KEY_TOTAL}}`,
        formulaDialect: CALC_DIALECT_V2,
        calcTrigger: "scheduled",
        calcIntervalSeconds: 60,
      }),
    /dependency cycle/,
    "the same formula against the same template at the owner's own location",
    400,
  );
  assert(
    (await formulaOf(pool, fixture.y, KEY_KW)) === acrossLocations,
    "the refusal must precede the update too — the existing row must be untouched",
  );
}

/**
 * `F2.9` Task 16 — design decision 9, layer 3: a refusal the engine recorded
 * reaches the page the operator is looking at.
 *
 * The registry passed in is the **same instance** the service was constructed
 * with, so a `record` here is exactly what a sweep in the same process would
 * have left behind. Nothing is stubbed between the write and the read.
 *
 * **Three controls, because "a nullable object" is the easy thing to get
 * wrong.** A field that is always `null` satisfies the contract, satisfies
 * every existing case in this directory, and would ship. So this asserts, in
 * order: the point reads `null` *before* anything is recorded (or the recorded
 * read below proves nothing); the recorded read carries **exactly** the three
 * promised keys with the promised values, and `at` decodes back to the
 * millisecond that was recorded; and a **different** asset's point is still
 * `null` afterwards, which is what makes this a per-formula-instance read
 * rather than one flag for the estate.
 *
 * The fourth assertion is the `written` half: `lastSkipReason` must come back
 * `null` rather than absent or `"null"`, since that is the value the web pill
 * branches on.
 */
export async function assertTheCalcPointsReadCarriesTheRecordedRefusal(
  pool: pg.Pool,
  fx: Fixtures,
  svc: AssetPointCalcOverrideService,
  status: CalcStatusRegistry,
): Promise<void> {
  const fixture = await seedCycleFixture(pool, fx);

  const before = (await svc.listCalcPoints(fx.adminJwt, fixture.x)).items;
  const total = before.find((item) => item.pointKey === KEY_TOTAL);
  assert(total !== undefined, `the aggregate point ${KEY_TOTAL} must be listed for X`);
  assert(
    total?.runtime === null,
    `a point this process has not evaluated reads null, not a fabricated outcome, got ${JSON.stringify(total?.runtime)}`,
  );

  const atMs = Date.UTC(2026, 8, 5, 12, 0, 0);
  status.record(fixture.x, total?.templatePointId ?? "", {
    outcome: "skipped",
    reason: "dependency_cycle",
    atMs,
  });

  const after = (await svc.listCalcPoints(fx.adminJwt, fixture.x)).items;
  const runtime = after.find((item) => item.pointKey === KEY_TOTAL)?.runtime;
  assert(
    JSON.stringify(Object.keys(runtime ?? {}).sort()) === JSON.stringify(["at", "lastOutcome", "lastSkipReason"]),
    `the DTO promises exactly lastOutcome, lastSkipReason and at, got ${JSON.stringify(runtime)}`,
  );
  assert(
    runtime?.lastOutcome === "skipped" && runtime.lastSkipReason === "dependency_cycle",
    `the recorded refusal must reach the read verbatim, got ${JSON.stringify(runtime)}`,
  );
  assert(
    new Date(runtime?.at ?? 0).getTime() === atMs,
    `at is the recorded evaluation time as an ISO string, got ${JSON.stringify(runtime?.at)}`,
  );

  const otherAsset = (await svc.listCalcPoints(fx.adminJwt, fixture.y)).items;
  assert(
    otherAsset.every((item) => item.runtime === null),
    `recording X's point must not answer for Y's — the read is per formula instance, got ` +
      `${JSON.stringify(otherAsset.map((item) => item.runtime))}`,
  );

  const kw = otherAsset.find((item) => item.pointKey === KEY_KW);
  assert(kw !== undefined, `the derived point ${KEY_KW} must be listed for Y`);
  status.record(fixture.y, kw?.templatePointId ?? "", { outcome: "written", reason: null, atMs });
  const written = (await svc.listCalcPoints(fx.adminJwt, fixture.y)).items.find(
    (item) => item.pointKey === KEY_KW,
  )?.runtime;
  assert(
    written?.lastOutcome === "written" && written.lastSkipReason === null,
    `a written outcome carries a null reason — the value the pill branches on, got ${JSON.stringify(written)}`,
  );
}
