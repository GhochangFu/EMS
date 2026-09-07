import { randomUUID } from "node:crypto";

import type pg from "pg";

import type {
  AdminAssetTemplateDto,
  JwtPayload,
  SeededRuleDto,
  SeededRulesListResponse,
  TemplateContent,
} from "@bms/shared";

import type { AssetTemplateSeededRulesService } from "./asset-templates-seeded-rules.service";
import type { Fixtures } from "./asset-templates.instantiate.integration.spec";
import {
  ALARM_DERIVED,
  ALARM_LONG,
  ALARM_PHILOSOPHY,
  ALARM_PROTO,
  FIXTURE_DOMAIN,
  TEST_ASSET_PREFIX,
  TEST_TEMPLATE_CODE,
  assert,
  cleanup2,
  fixtureContent,
  type SeedFixtures,
  type Services,
} from "./asset-templates.seed-rules.integration.spec";
import { seededRuleName, valuesEqual } from "./template-alarm-rules";

/**
 * `E2.4` / ADR 0058 decision 8 — the drift list and the per-rule re-apply,
 * against a real database.
 *
 * `template-alarm-rules.spec.ts` proves `driftVerdict` over hand-built values;
 * this file proves the two routes are wired to rows the seed **actually
 * wrote**. Every fixture rule here is created by the real `instantiate`, never
 * by an INSERT, and every expectation is computed with **independent SQL
 * through the pool** rather than read back from the service's own DTO — a
 * service that reports `in_sync` over a row it re-derived differently must
 * fail here.
 *
 * Two cases exist because the PR 1 review round named them as the hazards PR 2
 * would meet, and nothing else in the repository can hold their claim:
 *
 * - **A freshly seeded rule reads `in_sync`** for a message that is over 255
 *   characters, one under three, and one padded. `seededRuleName` trims, floors
 *   and slices; a `current` built from `alarm.message` raw would differ from a
 *   baseline nobody has touched, and every such rule would read
 *   `template_moved` — the mirror of the false `local_override` PR 1 fixed.
 *   The three fixture guards below (`LONG_MESSAGE.length > 255` and the two
 *   beside it) are what make this a proof rather than a decoration.
 * - **Nothing makes the four provenance columns all-or-none.** A row with
 *   `source_template_id` set and `seeded_baseline` NULL has no defined verdict;
 *   the list must leave it out rather than throw, and re-apply must refuse it
 *   by name.
 *
 * Split from `asset-templates.seed-rules.integration.spec.ts` rather than
 * appended to it — that file stands at 989 of AGENTS.md §4.5's 1000 lines. The
 * fixtures are that suite's fixtures, imported rather than rebuilt; each Vitest
 * file evaluates the module afresh, so this suite's `TEST_TEMPLATE_CODE` and
 * `TEST_ASSET_PREFIX` are a different per-run pair from its sibling's.
 */

/** The three halves these cases drive. `Services` also carries `rules`, which nothing here needs. */
export type DriftServices = Pick<Services, "templates" | "instantiate"> & {
  seededRules: AssetTemplateSeededRulesService;
};

/**
 * The sibling suite's `publishFixtureTemplate` reads only `svc.templates`; its
 * parameter type carries `rules` because that suite's other cases drive the
 * arming guard. This adaptor is what lets this wrapper skip constructing
 * `RulesService` with its two stand-in collaborators.
 */
export function asSeedServices(svc: DriftServices): Services {
  return { ...svc, rules: undefined as unknown as Services["rules"] };
}

/** One `content.alarms[]` entry, as the shared content contract types it. */
type ContentAlarm = NonNullable<TemplateContent["alarms"]>[number];

/**
 * The seed fixtures plus the two base fixtures the scoping cases need: a
 * location in the same organization that `wc-admin@bms.local` holds no grant
 * on, and that admin's JWT. `loadSeedFixtures` spreads its base argument, so
 * the values are present at run time; this type is what makes them visible.
 */
export type DriftFixtures = SeedFixtures & Pick<Fixtures, "otherLocationId" | "locationAdminJwt">;

/** The template these cases instantiate. Swept by the sibling suite's `cleanup` (`LIKE code%`). */
export const DRIFT_TEMPLATE_CODE = `${TEST_TEMPLATE_CODE}-DRIFT`;

/** The three alarms whose messages `seededRuleName` rewrites — the regression guard for hazard 1. */
export const ALARM_LONG_MESSAGE = "FEED_FLOW_LOW";
export const ALARM_SHORT_MESSAGE = "PH_LOW";
export const ALARM_PADDED_MESSAGE = "CONDUCTIVITY_HIGH";

/** 300 characters: over the rule name's 255, under the content contract's 500. */
export const LONG_MESSAGE =
  "Feed flow below the class floor; check the strainer and the suction valve before restart. ".repeat(
    4,
  ).slice(0, 300);
/** Two characters: under `seededRuleName`'s three-character floor. */
export const SHORT_MESSAGE = "pH";
/** Leading and trailing whitespace that `seededRuleName` trims. */
export const PADDED_MESSAGE = "  Conductivity above the class limit  ";

/** The v2 values the template moves to. */
export const V2_PROTO_THRESHOLD = 7;
export const V2_PHILOSOPHY_OPERATOR = "gt";
export const V2_PHILOSOPHY_THRESHOLD = 3;

/**
 * The two assets every case builds. `D` for drift, so a sibling's `01`/`02`
 * never collide. Exported for the guards suite, which builds the same two
 * assets from its own template: one spelling, so `cleanup2`'s `LIKE` prefix
 * sweeps both files' rows.
 */
export const ASSET_A = `${TEST_ASSET_PREFIX}D1`;
export const ASSET_B = `${TEST_ASSET_PREFIX}D2`;

/**
 * The fixture guards. If any of these stops holding, the `in_sync` case below
 * passes for the wrong reason — `seededRuleName` would return the raw message
 * unchanged and a `current` built from it would agree by accident.
 */
export function assertMessageFixturesAreNotVacuous(): void {
  assert(
    LONG_MESSAGE.length > 255 && LONG_MESSAGE.length <= 500,
    `LONG_MESSAGE must be over 255 and at most 500 characters, is ${LONG_MESSAGE.length}`,
  );
  assert(
    SHORT_MESSAGE.trim().length < 3,
    `SHORT_MESSAGE must be under seededRuleName's three-character floor, is "${SHORT_MESSAGE}"`,
  );
  assert(
    PADDED_MESSAGE !== PADDED_MESSAGE.trim(),
    "PADDED_MESSAGE must carry whitespace that seededRuleName trims",
  );
  for (const raw of [LONG_MESSAGE, SHORT_MESSAGE, PADDED_MESSAGE]) {
    const alarm = { code: "X", message: raw } as Parameters<typeof seededRuleName>[0];
    assert(
      seededRuleName(alarm) !== raw,
      `seededRuleName must rewrite "${raw.slice(0, 20)}…" — otherwise a current built from ` +
        "the raw message would agree with the baseline by accident and this suite proves nothing",
    );
  }
}

/**
 * v1: the sibling suite's four alarms plus the three message-shape alarms.
 * v2: the proto threshold moves, the philosophy row gains a limit, and the
 * derived-point alarm is removed — one alarm per verdict the list can give.
 */
export function driftContent(fx: SeedFixtures, version: 1 | 2): TemplateContent {
  const base = fixtureContent(fx, version === 1 ? 5 : V2_PROTO_THRESHOLD);
  const alarms = (base.alarms ?? []).flatMap((alarm): ContentAlarm[] => {
    if (version === 2 && alarm.code === ALARM_DERIVED) {
      return [];
    }
    if (version === 2 && alarm.code === ALARM_PHILOSOPHY) {
      return [
        {
          ...alarm,
          operator: V2_PHILOSOPHY_OPERATOR,
          thresholdValue: V2_PHILOSOPHY_THRESHOLD,
        },
      ];
    }
    return [alarm];
  });
  const messageShapes: ContentAlarm[] = [
    {
      code: ALARM_LONG_MESSAGE,
      pointKey: fx.pointKeys[0].code,
      operator: "lt",
      thresholdValue: 1,
      severity: fx.severityCodes[1],
      message: LONG_MESSAGE,
      category: fx.categoryCode,
    },
    {
      code: ALARM_SHORT_MESSAGE,
      pointKey: fx.pointKeys[0].code,
      operator: "lt",
      thresholdValue: 6.5,
      severity: fx.severityCodes[0],
      message: SHORT_MESSAGE,
      category: fx.categoryCode,
    },
    {
      code: ALARM_PADDED_MESSAGE,
      pointKey: fx.pointKeys[0].code,
      operator: "gt",
      thresholdValue: 800,
      severity: fx.severityCodes[2],
      message: PADDED_MESSAGE,
      category: fx.categoryCode,
    },
  ];
  return { ...base, alarms: [...alarms, ...messageShapes] };
}

/**
 * Publishes v1 of the drift template. The three points restate the sibling
 * suite's (that file exports no point builder, and it stands at the §4.5 cap):
 * a measured point with the catalog unit, a measured point with an override,
 * and a derived one.
 */
export async function publishDriftFixture(
  svc: DriftServices,
  fx: SeedFixtures,
): Promise<AdminAssetTemplateDto> {
  const draft = await svc.templates.create(fx.adminJwt, {
    organizationId: fx.organizationId,
    code: DRIFT_TEMPLATE_CODE,
    name: "Seeded Rule Drift Fixture",
    assetType: "test_skid",
    domain: FIXTURE_DOMAIN,
    points: [
      {
        pointKey: fx.pointKeys[0].code,
        kind: "measured",
        required: true,
        sortOrder: 0,
        sourceDataKeyPattern: "{asset_code}_FEED_P",
      },
      {
        pointKey: fx.pointKeys[1].code,
        kind: "measured",
        required: true,
        sortOrder: 1,
        unit: "degC",
        sourceDataKeyPattern: "CH{unit}_SUPPLY_T",
      },
      {
        pointKey: fx.pointKeys[2].code,
        kind: "derived",
        required: true,
        sortOrder: 2,
        sourceDataKeyPattern: "{asset_code}_EFFICIENCY",
        formula: `{${fx.pointKeys[0].code}}`,
        formulaDialect: "bms-calc-v1",
        calcTrigger: "streaming",
      },
    ],
    content: driftContent(fx, 1),
  });
  return svc.templates.publish(fx.adminJwt, draft.id);
}

/** Forks v1 to v2 with `driftContent(fx, 2)` and publishes it. */
export async function publishV2(
  svc: DriftServices,
  fx: SeedFixtures,
  v1: AdminAssetTemplateDto,
): Promise<AdminAssetTemplateDto> {
  const draft = await svc.templates.createDraftFrom(fx.adminJwt, v1.id);
  await svc.templates.update(fx.adminJwt, draft.id, { content: driftContent(fx, 2) });
  const v2 = await svc.templates.publish(fx.adminJwt, draft.id);
  assert(v2.version === 2, `the fork must publish as v2, got v${v2.version}`);
  return v2;
}

export async function expectRejection(
  run: () => Promise<unknown>,
  match: RegExp,
  what: string,
): Promise<string> {
  let message: string | null = null;
  try {
    await run();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assert(message !== null, `${what}: expected a rejection, but the call succeeded`);
  assert(
    match.test(message ?? ""),
    `${what}: rejected with "${message}", which does not match ${match}`,
  );
  return message ?? "";
}

export type RuleRow = {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  /** Carried so `snapshot` sees an arming write, and for the archived-rule guard. */
  lifecycle_status: string;
  /** Carried for the moved-point guard: re-apply must never change it. */
  point_key: string | null;
  category: string;
  operator: string | null;
  threshold_value: number | null;
  severity: string | null;
  source_template_id: string | null;
  source_template_version: number | null;
  source_alarm_code: string | null;
  seeded_baseline: Record<string, unknown> | null;
  updated_at: string;
  asset_id: string;
  asset_code: string;
  asset_name: string;
  location_id: string;
};

/** Every rule on this suite's assets, joined to its asset, by independent SQL. */
export async function ruleRows(pool: pg.Pool): Promise<RuleRow[]> {
  const { rows } = await pool.query<RuleRow>(
    `SELECT r.id, r.code, r.name, r.enabled, r.lifecycle_status, r.point_key,
            r.category, r.operator,
            r.threshold_value::float8 AS threshold_value, r.severity,
            r.source_template_id, r.source_template_version, r.source_alarm_code,
            r.seeded_baseline, r.updated_at::text AS updated_at,
            a.id AS asset_id, a.code AS asset_code, a.name AS asset_name, a.location_id
       FROM bms.automation_rules r
       JOIN bms.assets a ON a.id = r.asset_id
      WHERE a.code LIKE $1
      ORDER BY a.code, r.source_alarm_code`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  return rows;
}

export function rowFor(rows: RuleRow[], assetCode: string, alarmCode: string): RuleRow {
  const row = rows.find((r) => r.asset_code === assetCode && r.source_alarm_code === alarmCode);
  if (!row) {
    throw new Error(
      `no seeded rule for asset ${assetCode} alarm ${alarmCode}; found ` +
        rows.map((r) => `${r.asset_code}/${r.source_alarm_code}`).join(", "),
    );
  }
  return row;
}

export function itemFor(
  list: SeededRulesListResponse,
  assetCode: string,
  alarmCode: string,
): SeededRuleDto {
  const item = list.items.find(
    (i) => i.assetCode === assetCode && i.sourceAlarmCode === alarmCode,
  );
  if (!item) {
    throw new Error(
      `the list has no item for asset ${assetCode} alarm ${alarmCode}; it has ` +
        list.items.map((i) => `${i.assetCode}/${i.sourceAlarmCode}`).join(", "),
    );
  }
  return item;
}

/** A serialisation of every rule row, for "nothing was written" claims. */
export async function snapshot(pool: pg.Pool): Promise<string> {
  return JSON.stringify(await ruleRows(pool));
}

export async function seed(
  svc: DriftServices,
  jwt: JwtPayload,
  templateId: string,
  target: { rtuId: string } | { locationId: string },
  assets: { code: string; unit: string }[],
): Promise<void> {
  await svc.instantiate(jwt, templateId, {
    ...target,
    assets: assets.map((a) => ({
      code: a.code,
      name: `Drift Skid ${a.unit}`,
      sourceDataKeyVars: { unit: a.unit },
    })),
  });
}

async function seedBoth(svc: DriftServices, fx: DriftFixtures, templateId: string): Promise<void> {
  await seed(svc, fx.adminJwt, templateId, { rtuId: fx.rtuId }, [
    { code: ASSET_A, unit: "D1" },
    { code: ASSET_B, unit: "D2" },
  ]);
}

/** The DTO must be the row, field for field — checked against SQL, not trusted. */
function assertItemMatchesRow(item: SeededRuleDto, row: RuleRow): void {
  const where = `${row.asset_code}/${row.source_alarm_code}`;
  assert(item.ruleId === row.id, `${where}: ruleId must be the row's id`);
  assert(item.ruleCode === row.code, `${where}: ruleCode must be ${row.code}, got ${item.ruleCode}`);
  assert(item.enabled === row.enabled, `${where}: enabled must be ${row.enabled}`);
  assert(item.assetId === row.asset_id, `${where}: assetId must be the asset's id`);
  assert(item.assetCode === row.asset_code, `${where}: assetCode must be ${row.asset_code}`);
  assert(item.assetName === row.asset_name, `${where}: assetName must be ${row.asset_name}`);
  assert(item.locationId === row.location_id, `${where}: locationId must be the asset's`);
  assert(
    item.sourceTemplateId === row.source_template_id,
    `${where}: sourceTemplateId must be ${row.source_template_id}`,
  );
  assert(
    item.sourceTemplateVersion === row.source_template_version,
    `${where}: sourceTemplateVersion must be ${row.source_template_version}, got ${item.sourceTemplateVersion}`,
  );
  assert(
    item.live.operator === row.operator &&
      item.live.thresholdValue === row.threshold_value &&
      item.live.severity === row.severity &&
      item.live.category === row.category &&
      item.live.message === row.name,
    `${where}: live must be the row's own columns (name as message), got ${JSON.stringify(item.live)}`,
  );
  // Key-sorted on both sides: jsonb stores keys by length then name, and the
  // DTO carries them in the contract's order. The values are what must agree.
  assert(
    canonical(item.seededBaseline) === canonical(row.seeded_baseline),
    `${where}: seededBaseline must be the stored jsonb, got ${JSON.stringify(item.seededBaseline)} ` +
      `vs ${JSON.stringify(row.seeded_baseline)}`,
  );
}

/** JSON with keys sorted, so two objects compare on values rather than on key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/**
 * Hazard 1 — a rule nobody touched reads `in_sync`, for every message shape.
 *
 * The long, short and padded messages are the whole point: each one's stored
 * `name` differs from the raw `alarm.message`, so `current` can only agree with
 * the baseline if it was built through `seededBaselineValues`.
 */
export async function assertFreshSeedReadsInSync(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
): Promise<void> {
  assertMessageFixturesAreNotVacuous();
  await cleanup2(pool);
  await seedBoth(svc, fx, v1.id);

  const rows = await ruleRows(pool);
  assert(rows.length === 14, `expected 14 seeded rules (2 assets x 7 alarms), got ${rows.length}`);

  const list = await svc.seededRules.list(fx.adminJwt, v1.id);
  assert(
    list.templateCode === DRIFT_TEMPLATE_CODE,
    `templateCode must be ${DRIFT_TEMPLATE_CODE}, got ${list.templateCode}`,
  );
  assert(
    list.currentVersion?.id === v1.id && list.currentVersion.version === 1,
    `currentVersion must be v1 (${v1.id}), got ${JSON.stringify(list.currentVersion)}`,
  );
  assert(list.items.length === 14, `expected 14 items, got ${list.items.length}`);

  for (const row of rows) {
    const item = itemFor(list, row.asset_code, row.source_alarm_code ?? "");
    assertItemMatchesRow(item, row);
    assert(
      item.current !== null,
      `${row.asset_code}/${row.source_alarm_code}: v1 carries this alarm, so current must not be null`,
    );
    assert(
      item.verdict === "in_sync",
      `${row.asset_code}/${row.source_alarm_code}: a freshly seeded, untouched rule must read ` +
        `in_sync, got ${item.verdict} — live ${JSON.stringify(item.live)}, baseline ` +
        `${JSON.stringify(item.seededBaseline)}, current ${JSON.stringify(item.current)}`,
    );
    assert(
      item.current !== null && valuesEqual(item.current, item.seededBaseline),
      `${row.asset_code}/${row.source_alarm_code}: current must equal the baseline it was seeded from`,
    );
  }

  // The three message shapes, by name: the stored name is what the derivation
  // wrote, and `current.message` must be that same derivation.
  for (const [alarmCode, raw] of [
    [ALARM_LONG_MESSAGE, LONG_MESSAGE],
    [ALARM_SHORT_MESSAGE, SHORT_MESSAGE],
    [ALARM_PADDED_MESSAGE, PADDED_MESSAGE],
  ] as const) {
    const row = rowFor(rows, ASSET_A, alarmCode);
    const item = itemFor(list, ASSET_A, alarmCode);
    assert(row.name !== raw, `${alarmCode}: the stored name must differ from the raw message`);
    assert(
      item.current?.message === row.name,
      `${alarmCode}: current.message must be the derived name "${row.name}", got ` +
        `"${item.current?.message}" — a current built from alarm.message raw reports ` +
        "template_moved on every long, short or padded message",
    );
  }
}

/** `local_override` — an engineer's edit is attributed to the engineer. */
export async function assertLocalOverrideIsAttributed(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
): Promise<void> {
  await cleanup2(pool);
  await seedBoth(svc, fx, v1.id);
  const rows = await ruleRows(pool);
  const proto = rowFor(rows, ASSET_A, ALARM_PROTO);
  const long = rowFor(rows, ASSET_A, ALARM_LONG);
  const padded = rowFor(rows, ASSET_A, ALARM_PADDED_MESSAGE);

  // Three of the five drift fields, one each, by independent SQL.
  await pool.query(`UPDATE bms.automation_rules SET threshold_value = 9 WHERE id = $1`, [proto.id]);
  await pool.query(`UPDATE bms.automation_rules SET severity = $2 WHERE id = $1`, [
    long.id,
    fx.severityCodes[0],
  ]);
  await pool.query(`UPDATE bms.automation_rules SET name = 'Renamed by an engineer' WHERE id = $1`, [
    padded.id,
  ]);

  const list = await svc.seededRules.list(fx.adminJwt, v1.id);
  for (const [alarmCode, field, expected] of [
    [ALARM_PROTO, "thresholdValue", 9],
    [ALARM_LONG, "severity", fx.severityCodes[0]],
    [ALARM_PADDED_MESSAGE, "message", "Renamed by an engineer"],
  ] as const) {
    const item = itemFor(list, ASSET_A, alarmCode);
    assert(
      item.verdict === "local_override",
      `${ASSET_A}/${alarmCode}: an edited ${field} must read local_override, got ${item.verdict}`,
    );
    assert(
      item.live[field] === expected,
      `${ASSET_A}/${alarmCode}: live.${field} must show the edit (${expected}), got ${item.live[field]}`,
    );
    assert(
      item.seededBaseline[field] !== expected,
      `${ASSET_A}/${alarmCode}: the baseline must still record what was seeded, not the edit`,
    );
  }
  const untouched = list.items.filter(
    (i) =>
      !(i.assetCode === ASSET_A && [ALARM_PROTO, ALARM_LONG, ALARM_PADDED_MESSAGE].includes(i.sourceAlarmCode)),
  );
  assert(untouched.length === 11, `expected 11 untouched items, got ${untouched.length}`);
  for (const item of untouched) {
    assert(
      item.verdict === "in_sync",
      `${item.assetCode}/${item.sourceAlarmCode}: untouched, must read in_sync, got ${item.verdict}`,
    );
  }
}

/**
 * The owner's 2026-09-07 ruling over ADR 0058 decision 8's text: both routes
 * are scoped to **writable locations**. A rule whose asset sits in a location
 * the caller cannot write is absent from the list for a location-scoped admin
 * and present for a global one.
 *
 * The anti-vacuity half is the SQL that proves `wc-admin@bms.local` holds no
 * grant on `otherLocationId` — without it, both callers seeing 14 would pass a
 * list that never filtered.
 */
export async function assertListIsScopedToWritableLocations(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
): Promise<void> {
  await cleanup2(pool);
  await seed(svc, fx.adminJwt, v1.id, { rtuId: fx.rtuId }, [{ code: ASSET_A, unit: "D1" }]);
  await seed(svc, fx.adminJwt, v1.id, { locationId: fx.otherLocationId }, [
    { code: ASSET_B, unit: "D2" },
  ]);

  const { rows: grants } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM bms.user_location_access ula
       JOIN bms.users u ON u.id = ula.user_id
      WHERE u.email = $1 AND ula.location_id = $2`,
    [fx.locationAdminJwt.email, fx.otherLocationId],
  );
  assert(
    Number(grants[0].n) === 0,
    `fixture defect: ${fx.locationAdminJwt.email} holds a grant on otherLocationId, so the ` +
      "scoping case cannot distinguish a filtered list from an unfiltered one",
  );
  const rows = await ruleRows(pool);
  assert(
    rowFor(rows, ASSET_B, ALARM_PROTO).location_id === fx.otherLocationId,
    "fixture defect: asset B must sit in otherLocationId",
  );

  const scoped = await svc.seededRules.list(fx.locationAdminJwt, v1.id);
  assert(
    scoped.items.length === 7,
    `a location admin must see only the 7 rules on the asset in their location, got ${scoped.items.length}`,
  );
  assert(
    scoped.items.every((i) => i.assetCode === ASSET_A && i.locationId === fx.rtuLocationId),
    "every item a location admin sees must be on an asset in their own location",
  );
  assert(
    !scoped.items.some((i) => i.locationId === fx.otherLocationId),
    "a rule on an asset in a location the caller cannot write must be ABSENT from their list",
  );

  const global = await svc.seededRules.list(fx.adminJwt, v1.id);
  assert(global.items.length === 14, `a global admin must see all 14, got ${global.items.length}`);
  assert(
    global.items.filter((i) => i.locationId === fx.otherLocationId).length === 7,
    "the global admin's list must include the 7 rules in the other location",
  );
}

/**
 * Hazard 2 — a row with `source_template_id` set and `seeded_baseline` NULL has
 * no defined verdict. The list leaves it out rather than throwing; re-apply
 * refuses it by name and writes nothing.
 */
export async function assertIncompleteProvenanceIsTolerated(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
): Promise<void> {
  await cleanup2(pool);
  await seed(svc, fx.adminJwt, v1.id, { rtuId: fx.rtuId }, [{ code: ASSET_A, unit: "D1" }]);
  const rows = await ruleRows(pool);
  const broken = rowFor(rows, ASSET_A, ALARM_LONG);
  await pool.query(`UPDATE bms.automation_rules SET seeded_baseline = NULL WHERE id = $1`, [
    broken.id,
  ]);

  const list = await svc.seededRules.list(fx.adminJwt, v1.id);
  assert(
    list.items.length === 6,
    `the list must tolerate the broken row by leaving it out — expected 6 items, got ${list.items.length}`,
  );
  assert(
    !list.items.some((i) => i.ruleId === broken.id),
    "a row whose seeded_baseline is NULL has no verdict and must not be listed",
  );

  const before = await snapshot(pool);
  await expectRejection(
    () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [broken.id] }),
    new RegExp(`${broken.code}[\\s\\S]*provenance`),
    "re-applying a rule whose provenance is incomplete",
  );
  assert((await snapshot(pool)) === before, "the refusal must write nothing");
}

/**
 * `template_moved` and `both_moved`, and D5's removed alarm — `current === null`.
 * Returns v2, which every later case re-applies from.
 */
export async function assertTemplateMoveIsAttributed(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
): Promise<AdminAssetTemplateDto> {
  await cleanup2(pool);
  await seedBoth(svc, fx, v1.id);
  const rows = await ruleRows(pool);
  await pool.query(`UPDATE bms.automation_rules SET threshold_value = 9 WHERE id = $1`, [
    rowFor(rows, ASSET_A, ALARM_PROTO).id,
  ]);

  const v2 = await publishV2(svc, fx, v1);

  // The path id is v1; the list keys on the CODE and compares against v2.
  const list = await svc.seededRules.list(fx.adminJwt, v1.id);
  assert(
    list.currentVersion?.id === v2.id && list.currentVersion.version === 2,
    `currentVersion must be v2 after the republish, got ${JSON.stringify(list.currentVersion)}`,
  );
  assert(list.items.length === 14, `still 14 items, got ${list.items.length}`);

  const bothMoved = itemFor(list, ASSET_A, ALARM_PROTO);
  assert(
    bothMoved.verdict === "both_moved",
    `${ASSET_A}/${ALARM_PROTO}: edited locally AND moved by v2 must read both_moved, got ${bothMoved.verdict}`,
  );
  assert(
    bothMoved.live.thresholdValue === 9 &&
      bothMoved.seededBaseline.thresholdValue === 5 &&
      bothMoved.current?.thresholdValue === V2_PROTO_THRESHOLD,
    `${ASSET_A}/${ALARM_PROTO}: the three sides must read 9 / 5 / ${V2_PROTO_THRESHOLD}`,
  );

  const templateMoved = itemFor(list, ASSET_B, ALARM_PROTO);
  assert(
    templateMoved.verdict === "template_moved",
    `${ASSET_B}/${ALARM_PROTO}: untouched but moved by v2 must read template_moved, got ${templateMoved.verdict}`,
  );
  assert(
    templateMoved.current?.thresholdValue === V2_PROTO_THRESHOLD,
    `${ASSET_B}/${ALARM_PROTO}: current must carry v2's ${V2_PROTO_THRESHOLD}`,
  );

  for (const assetCode of [ASSET_A, ASSET_B]) {
    const removed = itemFor(list, assetCode, ALARM_DERIVED);
    assert(
      removed.current === null,
      `${assetCode}/${ALARM_DERIVED}: v2 no longer carries this alarm, so current must be null`,
    );
    assert(
      removed.verdict === "template_moved",
      `${assetCode}/${ALARM_DERIVED}: a removed alarm is template_moved by definition, got ${removed.verdict}`,
    );
    const philosophy = itemFor(list, assetCode, ALARM_PHILOSOPHY);
    assert(
      philosophy.verdict === "template_moved" &&
        philosophy.current?.operator === V2_PHILOSOPHY_OPERATOR &&
        philosophy.current.thresholdValue === V2_PHILOSOPHY_THRESHOLD &&
        philosophy.seededBaseline.operator === null,
      `${assetCode}/${ALARM_PHILOSOPHY}: v2 supplied a limit, so template_moved with current ` +
        `${V2_PHILOSOPHY_OPERATOR} ${V2_PHILOSOPHY_THRESHOLD}, got ${philosophy.verdict} / ${JSON.stringify(philosophy.current)}`,
    );
    for (const alarmCode of [ALARM_LONG, ALARM_LONG_MESSAGE, ALARM_SHORT_MESSAGE, ALARM_PADDED_MESSAGE]) {
      const same = itemFor(list, assetCode, alarmCode);
      assert(
        same.verdict === "in_sync",
        `${assetCode}/${alarmCode}: unchanged between v1 and v2 must stay in_sync, got ${same.verdict}`,
      );
    }
  }

  // The same list through v2's id: the routes key on the code, not the row.
  const viaV2 = await svc.seededRules.list(fx.adminJwt, v2.id);
  assert(
    [...viaV2.items.map((i) => i.ruleId)].sort().join() === [...list.items.map((i) => i.ruleId)].sort().join(),
    "listing through v2's id must return the same rules as through v1's — the list keys on the template code",
  );
  return v2;
}

/**
 * D6 — re-apply moves only the named rules, re-stamps all three provenance
 * values, arms the rule it completes, and never disables one.
 */
export async function assertReapplyMovesOnlyTheNamedRules(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
  v2: AdminAssetTemplateDto,
): Promise<void> {
  await cleanup2(pool);
  // v1 stays published after v2 exists, so the rows are seeded at v1 with v1's values.
  await seedBoth(svc, fx, v1.id);
  const before = await ruleRows(pool);
  const protoA = rowFor(before, ASSET_A, ALARM_PROTO);
  const philosophyA = rowFor(before, ASSET_A, ALARM_PHILOSOPHY);
  const protoB = rowFor(before, ASSET_B, ALARM_PROTO);
  await pool.query(`UPDATE bms.automation_rules SET threshold_value = 9 WHERE id = $1`, [protoA.id]);
  // An engineer turned this one off.
  await pool.query(`UPDATE bms.automation_rules SET enabled = false WHERE id = $1`, [protoB.id]);
  assert(philosophyA.enabled === false, "fixture: a philosophy row seeds disabled");

  const result = await svc.seededRules.reapply(fx.adminJwt, v1.id, {
    ruleIds: [protoA.id, philosophyA.id, protoB.id],
  });
  assert(result.appliedVersion === 2, `appliedVersion must be 2, got ${result.appliedVersion}`);
  assert(result.items.length === 3, `the response lists the 3 named rules, got ${result.items.length}`);

  const after = await ruleRows(pool);
  const movedA = rowFor(after, ASSET_A, ALARM_PROTO);
  assert(
    movedA.threshold_value === V2_PROTO_THRESHOLD && movedA.enabled === true,
    `${ASSET_A}/${ALARM_PROTO}: must move to v2's ${V2_PROTO_THRESHOLD} and stay enabled, got ` +
      `${movedA.threshold_value} / ${movedA.enabled}`,
  );
  const armedA = rowFor(after, ASSET_A, ALARM_PHILOSOPHY);
  assert(
    armedA.operator === V2_PHILOSOPHY_OPERATOR && armedA.threshold_value === V2_PHILOSOPHY_THRESHOLD,
    `${ASSET_A}/${ALARM_PHILOSOPHY}: must take v2's limit, got ${armedA.operator} / ${armedA.threshold_value}`,
  );
  assert(
    armedA.enabled === true,
    `${ASSET_A}/${ALARM_PHILOSOPHY}: both fields were NULL and are now filled, so re-apply must ARM it`,
  );
  const stillOffB = rowFor(after, ASSET_B, ALARM_PROTO);
  assert(
    stillOffB.threshold_value === V2_PROTO_THRESHOLD && stillOffB.enabled === false,
    `${ASSET_B}/${ALARM_PROTO}: must move to ${V2_PROTO_THRESHOLD} and STAY disabled — re-apply never ` +
      `re-enables a rule an engineer turned off, got ${stillOffB.threshold_value} / ${stillOffB.enabled}`,
  );
  for (const row of [movedA, armedA, stillOffB]) {
    const where = `${row.asset_code}/${row.source_alarm_code}`;
    assert(
      row.source_template_id === v2.id && row.source_template_version === 2,
      `${where}: source_template_id/version must be re-stamped to v2, got ${row.source_template_id} v${row.source_template_version}`,
    );
    const baseline = row.seeded_baseline as { thresholdValue?: unknown; operator?: unknown } | null;
    assert(
      baseline?.thresholdValue ===
        (row.source_alarm_code === ALARM_PHILOSOPHY ? V2_PHILOSOPHY_THRESHOLD : V2_PROTO_THRESHOLD),
      `${where}: seeded_baseline must be re-stamped with v2's values, got ${JSON.stringify(baseline)}`,
    );
    const item = result.items.find((i) => i.ruleId === row.id);
    assert(item !== undefined, `${where}: the response must include it`);
    assert(
      item?.verdict === "in_sync" && item.sourceTemplateVersion === 2,
      `${where}: after re-apply the item must read in_sync at v2, got ${item?.verdict} v${item?.sourceTemplateVersion}`,
    );
  }

  // Un-named rules did not move — the one whose alarm v2 changed most of all.
  const untouchedB = rowFor(after, ASSET_B, ALARM_PHILOSOPHY);
  const untouchedBefore = rowFor(before, ASSET_B, ALARM_PHILOSOPHY);
  assert(
    untouchedB.operator === null &&
      untouchedB.threshold_value === null &&
      untouchedB.enabled === false &&
      untouchedB.source_template_version === 1 &&
      untouchedB.updated_at === untouchedBefore.updated_at,
    `${ASSET_B}/${ALARM_PHILOSOPHY}: not named, must be untouched at v1 — got ` +
      `${untouchedB.operator} / ${untouchedB.threshold_value} / v${untouchedB.source_template_version}`,
  );
  const named = new Set([protoA.id, philosophyA.id, protoB.id]);
  for (const row of after.filter((r) => !named.has(r.id))) {
    const was = before.find((r) => r.id === row.id);
    assert(
      JSON.stringify(row) === JSON.stringify(was),
      `${row.asset_code}/${row.source_alarm_code}: not named, must be byte-for-byte unchanged`,
    );
  }

  const { rows: audit } = await pool.query<{ payload: Record<string, unknown>; entity_id: string }>(
    `SELECT payload, entity_id FROM bms.audit_log
      WHERE action = 'master.asset_template.reapply_alarms' AND entity_id = $1
      ORDER BY created_at DESC`,
    [v2.id],
  );
  assert(audit.length === 1, `expected exactly one reapply audit row on v2, got ${audit.length}`);
  const payload = audit[0].payload;
  assert(
    payload.appliedVersion === 2 &&
      Array.isArray(payload.ruleIds) &&
      (payload.ruleIds as string[]).length === 3 &&
      Array.isArray(payload.armedRuleIds) &&
      (payload.armedRuleIds as string[]).join() === philosophyA.id,
    `the audit payload must carry appliedVersion 2, the 3 ruleIds and the one armed id, got ${JSON.stringify(payload)}`,
  );

  // The list agrees with the rows.
  const list = await svc.seededRules.list(fx.adminJwt, v1.id);
  assert(itemFor(list, ASSET_A, ALARM_PROTO).verdict === "in_sync", "re-applied proto A reads in_sync");
  assert(itemFor(list, ASSET_A, ALARM_PHILOSOPHY).verdict === "in_sync", "armed philosophy A reads in_sync");
  assert(itemFor(list, ASSET_B, ALARM_PROTO).verdict === "in_sync", "re-applied proto B reads in_sync");
  assert(
    itemFor(list, ASSET_B, ALARM_PHILOSOPHY).verdict === "template_moved",
    "un-named philosophy B still reads template_moved",
  );
}

/**
 * D6's refusals, each leaving every row byte-for-byte as it was: 404 for a
 * rule seeded from another template, 400 naming the rule whose alarm code v2
 * no longer carries, 403 across locations — and a mixed batch is all or
 * nothing.
 *
 * The last case is the **crossed** one, added by the PR 2 security review: a
 * caller who could take either the 403 or the 400 must take the 403, because
 * the 400 quotes stored template content. It asserts the message the caller
 * gets AND, negatively, that the alarm code is absent from it.
 */
export async function assertReapplyRefusals(
  svc: DriftServices,
  fx: DriftFixtures,
  pool: pg.Pool,
  v1: AdminAssetTemplateDto,
  otherTemplate: AdminAssetTemplateDto,
): Promise<void> {
  await cleanup2(pool);
  await seed(svc, fx.adminJwt, v1.id, { rtuId: fx.rtuId }, [{ code: ASSET_A, unit: "D1" }]);
  await seed(svc, fx.adminJwt, v1.id, { locationId: fx.otherLocationId }, [
    { code: ASSET_B, unit: "D2" },
  ]);
  const foreignAsset = `${TEST_ASSET_PREFIX}X1`;
  await seed(svc, fx.adminJwt, otherTemplate.id, { rtuId: fx.rtuId }, [
    { code: foreignAsset, unit: "X1" },
  ]);
  const rows = await ruleRows(pool);
  const protoA = rowFor(rows, ASSET_A, ALARM_PROTO);
  const derivedA = rowFor(rows, ASSET_A, ALARM_DERIVED);
  const protoB = rowFor(rows, ASSET_B, ALARM_PROTO);
  const foreign = rowFor(rows, foreignAsset, ALARM_PROTO);
  assert(
    foreign.source_template_id === otherTemplate.id && otherTemplate.id !== v1.id,
    "fixture: the foreign rule must be seeded from a different template",
  );
  const before = await snapshot(pool);

  // 404 — seeded, but from another template; and an id that is nothing at all.
  const unknown = randomUUID();
  const notFound = await expectRejection(
    () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [protoA.id, foreign.id, unknown] }),
    /not seeded from/i,
    "re-applying a rule seeded from another template",
  );
  assert(
    notFound.includes(foreign.id) && notFound.includes(unknown) && !notFound.includes(protoA.id),
    `the 404 must name the foreign and unknown ids and not the valid one, got "${notFound}"`,
  );
  assert((await snapshot(pool)) === before, "a 404 must write nothing, the valid rule included");

  // 400 — the alarm code v2 no longer carries, named by rule code.
  const gone = await expectRejection(
    () => svc.seededRules.reapply(fx.adminJwt, v1.id, { ruleIds: [protoA.id, derivedA.id] }),
    new RegExp(`${derivedA.code}[\\s\\S]*${ALARM_DERIVED}[\\s\\S]*no longer`),
    "re-applying a rule whose alarm code the current version no longer carries",
  );
  assert(gone.includes("v2"), `the 400 must name the version it compared against, got "${gone}"`);
  assert((await snapshot(pool)) === before, "a 400 must write nothing, the valid rule included");

  // 403 — the location admin cannot reach asset B's location; a batch that
  // mixes an in-scope rule with it is refused whole.
  await expectRejection(
    () => svc.seededRules.reapply(fx.locationAdminJwt, v1.id, { ruleIds: [protoB.id] }),
    /outside your access scope/i,
    "a location admin re-applying a rule on an asset outside their locations",
  );
  await expectRejection(
    () => svc.seededRules.reapply(fx.locationAdminJwt, v1.id, { ruleIds: [protoA.id, protoB.id] }),
    /outside your access scope/i,
    "a mixed batch with one rule outside the caller's locations",
  );
  assert((await snapshot(pool)) === before, "a 403 must write nothing, the in-scope rule included");

  // The crossed case, and it is a security assertion rather than a third
  // refusal: a location admin naming an out-of-scope rule whose alarm the
  // current version has DROPPED must be told about their access scope and
  // never about the alarm. Both refusals fit, and only the statement order in
  // `reapply` decides which fires — the 400 interpolates `sourceAlarmCode`,
  // which is stored template content. Nothing but this case pins that order.
  const derivedB = rowFor(rows, ASSET_B, ALARM_DERIVED);
  const crossed = await expectRejection(
    () => svc.seededRules.reapply(fx.locationAdminJwt, v1.id, { ruleIds: [derivedB.id] }),
    /outside your access scope/i,
    "a location admin naming an out-of-scope rule whose alarm the current version dropped",
  );
  assert(
    !crossed.includes(ALARM_DERIVED) && !crossed.includes(derivedB.code),
    `the access-scope refusal must not echo the stored alarm code or the rule code, got "${crossed}"`,
  );
  assert((await snapshot(pool)) === before, "the crossed refusal must write nothing");

  // The in-scope half of that batch DOES apply for the same caller alone —
  // otherwise the 403 could be "refuse every location admin" and still pass.
  const applied = await svc.seededRules.reapply(fx.locationAdminJwt, v1.id, {
    ruleIds: [protoA.id],
  });
  assert(
    applied.items.length === 1 && applied.items[0].verdict === "in_sync",
    "the location admin must be able to re-apply a rule inside their own location",
  );
  assert(
    rowFor(await ruleRows(pool), ASSET_A, ALARM_PROTO).threshold_value === V2_PROTO_THRESHOLD,
    `${ASSET_A}/${ALARM_PROTO}: the location admin's re-apply must land`,
  );
}
