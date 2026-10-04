import { randomUUID } from "node:crypto";

import type pg from "pg";
import { sql } from "drizzle-orm";

import { assets, locations, pointKeys, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { DEFAULT_RULE_CATEGORY_CODE } from "@bms/shared";
import type { AssetInstantiationResultDto, JwtPayload, TemplateContent } from "@bms/shared";

import type { BmsTx } from "../../database/tenant-context";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { instantiateAssetsBodySchema } from "./asset-templates.schema";
import type { AssetTemplatesAdminService } from "./asset-templates.service";
import type { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import {
  inRolledBackTransaction,
  RollbackSentinel,
} from "./asset-templates-write-cores.integration.spec";

/**
 * `F3.22` PR 1 (ADR 0091 decision 1) — the instantiate core reads its guards
 * through the caller's transaction.
 *
 * Every claim is "a row written earlier in the **same uncommitted transaction**
 * is visible to the guard": an RTU, a location, a published template, a point
 * key, an asset code, a rule code. A pool read cannot see such a row, so a core
 * that still read on `fleetDb` refuses — and each claim asserts **positively**
 * on what only the `tx` read produces (a result, or the guard's own named
 * refusal), never on the absence of another message.
 *
 * C9 and C10 call `instantiateInTransaction` directly, so the route's
 * `translateAssetCodeCollision` never runs: with the `tx` half of a guard gone,
 * the batch reaches the INSERT and Postgres answers with its raw unique-violation
 * text. The guard's own sentence is therefore the only thing that can make them
 * green (plan §2a A3).
 *
 * **Nothing written inside a claim commits** — each runs inside
 * `inRolledBackTransaction` (U2's harness). The committed fixtures are two
 * published templates carrying `TEST_CODE_PREFIX`, deleted on the owner pool
 * before and after the run.
 */

export const TEST_CODE_PREFIX = "F322-INST-";

export type Fixtures = {
  organizationId: string;
  /** One active point-key code from the seeded catalog. */
  seededPointKey: string;
  /** A seeded active location in the organization. */
  otherLocationId: string;
  /** An active `bms.location_types` code, read with `listLocationTypes`' predicate. */
  locationTypeCode: string;
  /** A live rule category and alarm severity, for the alarm-bearing template. */
  categoryCode: string;
  severityCode: string;
  adminJwt: JwtPayload;
};

export type Harness = {
  tenantDb: BmsDb;
  /** The owner pool — committed fixture setup and cleanup only. */
  pool: pg.Pool;
  templates: AssetTemplatesAdminService;
  instantiation: AssetTemplateInstantiationService;
  fx: Fixtures;
  /** Published, one measured point `{asset_code}_A`, no alarms. */
  templateId: string;
  /** Published, the same point and one alarm — every asset seeds one rule. */
  alarmTemplateId: string;
  /**
   * The same services over a tenant pool of **one** connection with a short
   * connect timeout (C11–C14). A core that reads anything on a second tenant
   * connection while its `tx` holds the only one gets the pool's
   * "timeout exceeded when trying to connect" instead of an answer.
   */
  single: {
    tenantDb: BmsDb;
    templates: AssetTemplatesAdminService;
    instantiation: AssetTemplateInstantiationService;
  };
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const unique = (): string => randomUUID().slice(0, 8).toUpperCase();

/** Wire shape through the real schema, as the controller parses it. */
const parse = (body: unknown) => instantiateAssetsBodySchema.parse(body);

/**
 * Deletes only this suite's committed rows. Nothing but the two templates
 * should ever commit; the asset, rule and key deletes are for a run that
 * crashed between a public write and its rollback.
 */
export async function cleanup(pool: pg.Pool): Promise<void> {
  const like = `${TEST_CODE_PREFIX}%`;
  await pool.query(
    `DELETE FROM bms.automation_rules
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [like],
  );
  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [like],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [like]);
  // template_points cascade on the FK.
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [like]);
  await pool.query(`DELETE FROM bms.point_keys WHERE code LIKE $1`, [like]);
}

export async function loadFixtures(pool: pg.Pool): Promise<Fixtures> {
  // F3.78: the admin payload carries the real bms.users.id as sub.
  await primeSeededSubjects(pool);
  const { rows: grants } = await pool.query<{ organization_id: string; location_id: string }>(
    `SELECT l.organization_id, l.id AS location_id
       FROM bms.users u
       JOIN bms.user_location_access ula ON ula.user_id = u.id
       JOIN bms.locations l ON l.id = ula.location_id
      WHERE u.email = 'wc-admin@bms.local' AND l.active = true
      LIMIT 1`,
  );
  const grant = grants[0];
  const { rows: keyRows } = await pool.query<{ code: string }>(
    `SELECT code FROM bms.point_keys
      WHERE active = true AND code NOT LIKE $1 ORDER BY created_at, code LIMIT 1`,
    [`${TEST_CODE_PREFIX}%`],
  );
  const { rows: otherRows } = grant
    ? await pool.query<{ id: string }>(
        `SELECT id FROM bms.locations
          WHERE organization_id = $1 AND active = true AND id <> $2
          ORDER BY created_at, code LIMIT 1`,
        [grant.organization_id, grant.location_id],
      )
    : { rows: [] };
  // `VocabulariesService.listLocationTypes`' predicate and order.
  const { rows: typeRows } = await pool.query<{ code: string }>(
    `SELECT code FROM bms.location_types WHERE active = true ORDER BY sort_order, code LIMIT 1`,
  );
  // As `asset-templates.seed-rules.integration.spec.ts`' `loadSeedFixtures` reads them.
  const { rows: categories } = await pool.query<{ code: string }>(
    `SELECT code FROM bms.rule_categories WHERE active = true ORDER BY sort_order, code`,
  );
  const { rows: severities } = await pool.query<{ code: string }>(
    `SELECT code FROM bms.alarm_severities WHERE active = true ORDER BY rank, code`,
  );
  const category =
    categories.find((row) => row.code !== DEFAULT_RULE_CATEGORY_CODE)?.code ?? categories[0]?.code;
  if (
    !grant ||
    !keyRows[0] ||
    !otherRows[0] ||
    !typeRows[0] ||
    !category ||
    !severities[0]
  ) {
    throw new Error(
      "F3.22 fixtures missing — need the seeded wc-admin organization with a second active " +
        "location, one active point key, one active location type, one live rule category " +
        "and one live alarm severity. Run 'pnpm db:seed'.",
    );
  }
  return {
    organizationId: grant.organization_id,
    seededPointKey: keyRows[0].code,
    otherLocationId: otherRows[0].id,
    locationTypeCode: typeRows[0].code,
    categoryCode: category,
    severityCode: severities[0].code,
    adminJwt: jwtFor("admin@bms.local", "admin"),
  };
}

function draftBody(
  fx: Fixtures,
  code: string,
  pointKey: string,
  content?: TemplateContent,
) {
  return {
    organizationId: fx.organizationId,
    code,
    name: "F3.22 instantiate-core fixture",
    assetType: "test_skid",
    domain: "water",
    points: [
      {
        pointKey,
        kind: "measured" as const,
        required: true,
        sortOrder: 0,
        sourceDataKeyPattern: "{asset_code}_A",
      },
    ],
    ...(content ? { content } : {}),
  };
}

/** The alarm template `TA`'s content: one alarm, so every asset derives one rule code. */
function alarmContent(fx: Fixtures): TemplateContent {
  return {
    contentVersion: 1,
    alarms: [
      {
        code: "f322_high",
        pointKey: fx.seededPointKey,
        operator: "gt",
        thresholdValue: 5,
        severity: fx.severityCode,
        message: "F3.22 instantiate-core alarm fixture",
        category: fx.categoryCode,
      },
    ],
  };
}

/** Publishes `T` and `TA` through the public methods — committed fixtures. */
export async function publishFixtureTemplates(
  templates: AssetTemplatesAdminService,
  fx: Fixtures,
): Promise<{ templateId: string; alarmTemplateId: string }> {
  const t = await templates.create(
    fx.adminJwt,
    draftBody(fx, `${TEST_CODE_PREFIX}T-${unique()}`, fx.seededPointKey),
  );
  await templates.publish(fx.adminJwt, t.id);
  const ta = await templates.create(
    fx.adminJwt,
    draftBody(fx, `${TEST_CODE_PREFIX}TA-${unique()}`, fx.seededPointKey, alarmContent(fx)),
  );
  await templates.publish(fx.adminJwt, ta.id);
  return { templateId: t.id, alarmTemplateId: ta.id };
}

/** A location written on `tx` — invisible to every pool read. */
async function insertLocation(tx: BmsTx, fx: Fixtures): Promise<string> {
  const suffix = unique();
  const [row] = await tx
    .insert(locations)
    .values({
      organizationId: fx.organizationId,
      code: `${TEST_CODE_PREFIX}L-${suffix}`,
      slug: `f322-inst-l-${suffix.toLowerCase()}`,
      name: "F3.22 tx location",
      type: fx.locationTypeCode,
      latitude: 0,
      longitude: 0,
      active: true,
      updatedAt: sql`now()`,
    })
    .returning({ id: locations.id });
  return row.id;
}

/** Runs `fn` and returns its error message, or `null` when it resolved. */
async function messageOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * C5 — the core resolves an RTU (and its location) written earlier in the same
 * transaction, and writes the batch onto it.
 */
export async function assertInstantiateCoreSeesAnRtuWrittenInTheSameTransaction(
  h: Harness,
): Promise<void> {
  const assetCode = `${TEST_CODE_PREFIX}C5-${unique()}`;
  const captured = await inRolledBackTransaction<{
    result: AssetInstantiationResultDto;
    locationId: string;
    rtuId: string;
    storedRtuId: string | undefined;
  }>(h.tenantDb, h.fx.organizationId, async (tx) => {
    const locationId = await insertLocation(tx, h.fx);
    const [rtu] = await tx
      .insert(rtus)
      .values({
        organizationId: h.fx.organizationId,
        locationId,
        code: `${TEST_CODE_PREFIX}R-${unique()}`,
        displayName: "F3.22 tx RTU",
        sourceType: "mqtt",
        ingestEnabled: false,
        active: true,
      })
      .returning({ id: rtus.id });
    const result = await h.instantiation.instantiateInTransaction(
      tx,
      h.fx.adminJwt,
      h.templateId,
      parse({ rtuId: rtu.id, assets: [{ code: assetCode, name: "C5 asset" }] }),
    );
    const stored = await tx.execute(
      sql`select rtu_id from bms.assets where code = ${assetCode}`,
    );
    throw new RollbackSentinel({
      result,
      locationId,
      rtuId: rtu.id,
      storedRtuId: (stored.rows[0] as { rtu_id?: string } | undefined)?.rtu_id,
    });
  });
  assert(captured.result.assetCount === 1, `C5: assetCount ${captured.result.assetCount}`);
  assert(captured.result.rtuId === captured.rtuId, "C5: the result names another RTU");
  assert(
    captured.result.locationId === captured.locationId,
    "C5: the result names another location — the RTU's own location must be the target",
  );
  assert(
    captured.result.sourceKind === "measured",
    `C5: sourceKind ${captured.result.sourceKind}, expected measured`,
  );
  assert(
    captured.storedRtuId === captured.rtuId,
    `C5: the asset's stored rtu_id through tx is ${captured.storedRtuId}`,
  );
}

/** C6 — the core resolves a location written earlier in the same transaction. */
export async function assertInstantiateCoreSeesALocationWrittenInTheSameTransaction(
  h: Harness,
): Promise<void> {
  const captured = await inRolledBackTransaction<{
    result: AssetInstantiationResultDto;
    locationId: string;
  }>(h.tenantDb, h.fx.organizationId, async (tx) => {
    const locationId = await insertLocation(tx, h.fx);
    const result = await h.instantiation.instantiateInTransaction(
      tx,
      h.fx.adminJwt,
      h.templateId,
      parse({ locationId, assets: [{ code: `${TEST_CODE_PREFIX}C6-${unique()}`, name: "C6" }] }),
    );
    throw new RollbackSentinel({ result, locationId });
  });
  assert(
    captured.result.sourceKind === "unmapped",
    `C6: sourceKind ${captured.result.sourceKind}, expected unmapped`,
  );
  assert(captured.result.rtuId === null, "C6: a location target must carry no RTU");
  assert(
    captured.result.locationId === captured.locationId,
    "C6: the result names another location",
  );
}

/**
 * C7 — the core reads the template row through the transaction: a template
 * created and published earlier in the same transaction instantiates.
 */
export async function assertInstantiateCoreSeesATemplatePublishedInTheSameTransaction(
  h: Harness,
): Promise<void> {
  const captured = await inRolledBackTransaction<{
    templateId: string;
    result: AssetInstantiationResultDto;
  }>(h.tenantDb, h.fx.organizationId, async (tx) => {
    const draft = await h.templates.createInTransaction(
      tx,
      h.fx.adminJwt,
      draftBody(h.fx, `${TEST_CODE_PREFIX}C7-${unique()}`, h.fx.seededPointKey),
    );
    await h.templates.publishInTransaction(tx, h.fx.adminJwt, draft.id);
    const result = await h.instantiation.instantiateInTransaction(
      tx,
      h.fx.adminJwt,
      draft.id,
      parse({
        locationId: h.fx.otherLocationId,
        assets: [{ code: `${TEST_CODE_PREFIX}C7-${unique()}`, name: "C7" }],
      }),
    );
    throw new RollbackSentinel({ templateId: draft.id, result });
  });
  assert(
    captured.result.templateId === captured.templateId,
    "C7: the result names another template",
  );
  assert(captured.result.assetCount === 1, `C7: assetCount ${captured.result.assetCount}`);
}

/**
 * C8 — the core checks the point-key catalog through the transaction.
 *
 * The plan's first fixture re-activated a committed key with
 * `tx.update(pointKeys)`; migration `0059` revokes `UPDATE` on `bms.point_keys`
 * from `bms_tenant`, so the key is **inserted** on `tx` instead (plan §2a A1).
 * It exists only inside the transaction, so a catalog read on a pool refuses
 * the batch with the catalog's own message.
 */
export async function assertInstantiateCoreChecksTheCatalogThroughTheTransaction(
  h: Harness,
): Promise<void> {
  const keyCode = `${TEST_CODE_PREFIX}K8-${unique()}`;
  const result = await inRolledBackTransaction<AssetInstantiationResultDto>(
    h.tenantDb,
    h.fx.organizationId,
    async (tx) => {
      await tx.insert(pointKeys).values({ code: keyCode, name: "F3.22 C8 tx key", active: true });
      const draft = await h.templates.createInTransaction(
        tx,
        h.fx.adminJwt,
        draftBody(h.fx, `${TEST_CODE_PREFIX}C8-${unique()}`, keyCode),
      );
      await h.templates.publishInTransaction(tx, h.fx.adminJwt, draft.id);
      throw new RollbackSentinel(
        await h.instantiation.instantiateInTransaction(
          tx,
          h.fx.adminJwt,
          draft.id,
          parse({
            locationId: h.fx.otherLocationId,
            assets: [{ code: `${TEST_CODE_PREFIX}C8-${unique()}`, name: "C8" }],
          }),
        ),
      );
    },
  );
  assert(result.assetCount === 1, `C8: assetCount ${result.assetCount}`);
}

/**
 * C9 — the asset-code guard reads `assets` through the transaction: a code
 * written earlier in the same transaction is refused **by name**, by the guard.
 *
 * The message is captured and the sentinel thrown at once: on a mutated core
 * the refusal is a Postgres unique violation, which aborts the transaction, so
 * no `tx` statement may follow the catch.
 */
export async function assertInstantiateCoreSeesAnAssetCodeWrittenInTheSameTransaction(
  h: Harness,
): Promise<void> {
  const code = `${TEST_CODE_PREFIX}C9-${unique()}`;
  const message = await inRolledBackTransaction<string | null>(
    h.tenantDb,
    h.fx.organizationId,
    async (tx) => {
      await tx.insert(assets).values({
        organizationId: h.fx.organizationId,
        code,
        name: "C9 existing",
        siteName: "F3.22",
        locationId: h.fx.otherLocationId,
        domain: "water",
        active: true,
      });
      const refused = await messageOf(() =>
        h.instantiation.instantiateInTransaction(
          tx,
          h.fx.adminJwt,
          h.templateId,
          parse({ locationId: h.fx.otherLocationId, assets: [{ code, name: "C9 again" }] }),
        ),
      );
      throw new RollbackSentinel(refused);
    },
  );
  assert(message !== null, "C9: a code written earlier in the transaction must be refused");
  assert(
    (message ?? "").includes(`already exist: ${code}`),
    `C9: the asset-code guard must name the code it found through tx, but the refusal was: ` +
      `"${message}"`,
  );
}

/**
 * C10 — the rule-code guard reads `automation_rules` through the transaction.
 *
 * The first instantiation seeds `A1`'s rule in the transaction; the second uses
 * `A1`'s punctuation twin — a different, free asset code that `seededRuleCode`
 * normalises to the same rule code (the pair
 * `assertIntraBatchCodeCollisionRefused` uses). Only a `tx` read sees the first
 * rule and refuses with the guard's sentence.
 */
export async function assertInstantiateCoreSeesARuleCodeWrittenInTheSameTransaction(
  h: Harness,
): Promise<void> {
  const stem = `${TEST_CODE_PREFIX}C10-${unique()}`;
  const message = await inRolledBackTransaction<string | null>(
    h.tenantDb,
    h.fx.organizationId,
    async (tx) => {
      await h.instantiation.instantiateInTransaction(
        tx,
        h.fx.adminJwt,
        h.alarmTemplateId,
        parse({ locationId: h.fx.otherLocationId, assets: [{ code: `${stem}-1`, name: "A1" }] }),
      );
      const refused = await messageOf(() =>
        h.instantiation.instantiateInTransaction(
          tx,
          h.fx.adminJwt,
          h.alarmTemplateId,
          parse({
            locationId: h.fx.otherLocationId,
            assets: [{ code: `${stem}_1`, name: "A1 twin" }],
          }),
        ),
      );
      throw new RollbackSentinel(refused);
    },
  );
  assert(message !== null, "C10: a rule code seeded earlier in the transaction must be refused");
  assert(
    (message ?? "").includes("already exist in this organization:"),
    `C10: the rule-code guard must refuse with its own sentence, but the refusal was: ` +
      `"${message}"`,
  );
}

/**
 * Why C11–C14 fail when they do: the single-connection pool's checkout timed
 * out, because the only connection was the core's own `tx`.
 */
const SECOND_CONNECTION =
  "a read inside the core asked the tenant pool for a second connection while tx held the " +
  "only one — on a production pool of N, N concurrent cores wait on each other for good " +
  "(review finding, F3.22 PR 1). Pass tx to the read.";

/**
 * C11 — `createTemplateCore` makes every tenant-pool read on its `tx`,
 * including the two vocabulary checks (`assertAssetDomain`, and the alarm
 * vocabularies' `list`). The body carries an alarm so the `list` read runs.
 */
export async function assertCreateCoreHoldsOneTenantConnection(h: Harness): Promise<void> {
  const captured = await inRolledBackTransaction<{ error: string | null; status?: string }>(
    h.single.tenantDb,
    h.fx.organizationId,
    async (tx) => {
      let status: string | undefined;
      const error = await messageOf(async () => {
        const row = await h.single.templates.createInTransaction(
          tx,
          h.fx.adminJwt,
          draftBody(
            h.fx,
            `${TEST_CODE_PREFIX}C11-${unique()}`,
            h.fx.seededPointKey,
            alarmContent(h.fx),
          ),
        );
        status = row.status;
      });
      throw new RollbackSentinel({ error, status });
    },
  );
  assert(
    captured.error === null,
    `C11: create failed with "${captured.error}" — ${SECOND_CONNECTION}`,
  );
  assert(captured.status === "draft", `C11: created row status ${captured.status}`);
}

/**
 * C14 — the domain refusal's own lookup (`unknownCodeMessage`, the live codes
 * it lists back) runs on the core's `tx` too. A bad domain is the one path that
 * reaches it, so C11's `"water"` cannot cover it.
 */
export async function assertCreateCoreDomainRefusalHoldsOneTenantConnection(
  h: Harness,
): Promise<void> {
  const badDomain = `f322_no_such_domain_${unique().toLowerCase()}`;
  const message = await inRolledBackTransaction<string | null>(
    h.single.tenantDb,
    h.fx.organizationId,
    async (tx) => {
      const refused = await messageOf(() =>
        h.single.templates.createInTransaction(tx, h.fx.adminJwt, {
          ...draftBody(h.fx, `${TEST_CODE_PREFIX}C14-${unique()}`, h.fx.seededPointKey),
          domain: badDomain,
        }),
      );
      throw new RollbackSentinel(refused);
    },
  );
  assert(
    !(message ?? "").includes("timeout exceeded"),
    `C14: the domain refusal failed with "${message}" — ${SECOND_CONNECTION}`,
  );
  assert(
    (message ?? "").startsWith(`domain "${badDomain}" is not a live value. Expected one of: `),
    `C14: a bad domain must be refused with assertAssetDomain's own sentence, but got "${message}"`,
  );
}

/**
 * C12 — `publishTemplateCore` makes every tenant-pool read on its `tx`,
 * including the stored-alarm vocabulary `list`. The draft is committed first on
 * the ordinary pools, so only the publish core runs on the single connection.
 */
export async function assertPublishCoreHoldsOneTenantConnection(h: Harness): Promise<void> {
  const draft = await h.templates.create(
    h.fx.adminJwt,
    draftBody(h.fx, `${TEST_CODE_PREFIX}C12-${unique()}`, h.fx.seededPointKey, alarmContent(h.fx)),
  );
  const captured = await inRolledBackTransaction<{ error: string | null; status?: string }>(
    h.single.tenantDb,
    h.fx.organizationId,
    async (tx) => {
      let status: string | undefined;
      const error = await messageOf(async () => {
        const row = await h.single.templates.publishInTransaction(tx, h.fx.adminJwt, draft.id);
        status = row.status;
      });
      throw new RollbackSentinel({ error, status });
    },
  );
  assert(
    captured.error === null,
    `C12: publish failed with "${captured.error}" — ${SECOND_CONNECTION}`,
  );
  assert(captured.status === "published", `C12: publish returned status ${captured.status}`);
}

/**
 * C13 — `instantiateTemplateCore` makes every tenant-pool read on its `tx`,
 * including `assertAlarmVocabulariesStillLive`'s `list`: the alarm template
 * `TA` is what makes that read run, and `ruleCount === 1` proves it did.
 */
export async function assertInstantiateCoreHoldsOneTenantConnection(h: Harness): Promise<void> {
  const captured = await inRolledBackTransaction<{
    error: string | null;
    result?: AssetInstantiationResultDto;
  }>(h.single.tenantDb, h.fx.organizationId, async (tx) => {
    let result: AssetInstantiationResultDto | undefined;
    const error = await messageOf(async () => {
      result = await h.single.instantiation.instantiateInTransaction(
        tx,
        h.fx.adminJwt,
        h.alarmTemplateId,
        parse({
          locationId: h.fx.otherLocationId,
          assets: [{ code: `${TEST_CODE_PREFIX}C13-${unique()}`, name: "C13" }],
        }),
      );
    });
    throw new RollbackSentinel({ error, result });
  });
  assert(
    captured.error === null,
    `C13: instantiate failed with "${captured.error}" — ${SECOND_CONNECTION}`,
  );
  assert(captured.result?.assetCount === 1, `C13: assetCount ${captured.result?.assetCount}`);
  assert(
    captured.result?.ruleCount === 1,
    `C13: ruleCount ${captured.result?.ruleCount} — the alarm template must seed one rule, ` +
      "or the vocabulary read this claim targets never ran",
  );
}
