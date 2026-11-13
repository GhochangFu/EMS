import { expect } from "vitest";
import pg from "pg";

import { createDb } from "@bms/db";

import type { AlarmRaiseResult, AlarmRaiseRule } from "./alarm-raise.service";
import type { AlarmRaiser } from "./alarm-raise.service";
import { ALARM_NOTIFY_CHANNEL } from "./alarm-notify-channel";
import { readAlarmListItem } from "./alarm-list-item";
import { type CoverOrganization, insertWindow } from "./maintenance-cover.reads.integration.spec";

/**
 * `E7.1b` — the org-stamping and relocation-guard proof for `AlarmRaiser`
 * against real, non-owner roles.
 *
 * `AlarmRaiser` is the one writer of `bms.alarms` and the streaming path's
 * writer of `bms.rule_executions`. `alarms.org` derives from the asset and
 * `rule_executions.org` from the rule (migration `0046`); both gain a
 * `tenant_isolation` policy + `FORCE` in `0047`. Constructing the raiser with a
 * real `bms_tenant` connection is the only proof it stamps both columns under
 * `withTenant`, and that its divergence guard refuses to file an alarm into the
 * wrong tenant — the owner connection bypasses row-level security and would
 * pass regardless.
 */
export type AlarmRaiseRlsFixtures = {
  raiser: AlarmRaiser;
  ownerPool: pg.Pool;
  organizationId: string;
  /** An asset + threshold rule pair in `organizationId`, for the happy path. */
  stampAssetId: string;
  stampRule: AlarmRaiseRule;
  /** A second pair, for the relocation-guard path (never actually raised). */
  guardAssetId: string;
  guardRule: AlarmRaiseRule;
};

/**
 * A raise stamps the asset's org on `alarms` and the rule's org on
 * `rule_executions` — proven equal by the guard — under a real `bms_tenant`
 * connection.
 */
export async function assertRaiseStampsBothOrgsUnderRealRls(
  ctx: AlarmRaiseRlsFixtures,
): Promise<void> {
  const { raiser, ownerPool, organizationId, stampAssetId, stampRule } = ctx;

  const result = await raiser.raise(stampAssetId, organizationId, stampRule, 999_999);
  expect(result.raised, "a fresh (asset, rule) raises").toBe(true);
  expect(result.alarmId).not.toBeNull();

  const alarm = await ownerPool.query<{ organization_id: string | null }>(
    "SELECT organization_id FROM bms.alarms WHERE id = $1",
    [result.alarmId],
  );
  expect(alarm.rows[0]?.organization_id, "alarms.org = the asset's org").toBe(organizationId);

  const trace = await ownerPool.query<{ organization_id: string | null }>(
    "SELECT organization_id FROM bms.rule_executions WHERE rule_id = $1",
    [stampRule.id],
  );
  expect(trace.rows.length, "the raise wrote one rule_executions trace").toBe(1);
  expect(trace.rows[0]?.organization_id, "rule_executions.org = the rule's org").toBe(
    organizationId,
  );
}

/**
 * When the rule's org and the asset's org disagree — an asset relocated out from
 * under a rule still pointing at it — the raise is refused and nothing is
 * written, rather than filing the alarm into the rule's (now foreign) tenant.
 */
export async function assertRaiseRefusesCrossOrgUnderRealRls(
  ctx: AlarmRaiseRlsFixtures,
): Promise<void> {
  const { raiser, ownerPool, organizationId, guardAssetId, guardRule } = ctx;

  // guardRule carries a different org than the asset's; the guard must fire.
  expect(guardRule.organizationId).not.toBe(organizationId);

  const result = await raiser.raise(guardAssetId, organizationId, guardRule, 999_999);
  expect(result.raised, "a cross-org raise is refused").toBe(false);
  expect(result.alarmId).toBeNull();

  const alarm = await ownerPool.query(
    "SELECT id FROM bms.alarms WHERE asset_id = $1 AND rule_id = $2",
    [guardAssetId, guardRule.id],
  );
  expect(alarm.rows.length, "no alarm row is written for a refused raise").toBe(0);

  const trace = await ownerPool.query(
    "SELECT id FROM bms.rule_executions WHERE rule_id = $1",
    [guardRule.id],
  );
  expect(trace.rows.length, "no rule_executions trace is written either").toBe(0);
}

/**
 * `F3.16` / ADR 0127 decision 12 — the device half of the fixtures. The RTUs and
 * the organization are seeded; the raiser runs on the same `bms_tenant`
 * connection as `raise`.
 */
export type DeviceRaiseRlsFixtures = {
  raiser: AlarmRaiser;
  ownerPool: pg.Pool;
  organizationId: string;
  /** An RTU of `organizationId` with no open device alarm. */
  rtuId: string;
  /** An RTU of another organization. */
  foreignRtuId: string;
};

/** The id of every `NOTIFY bms_alarms` payload that names `alarmId`, heard while `body` runs. */
async function notificationsDuring(
  ownerPool: pg.Pool,
  body: () => Promise<void>,
): Promise<Array<Record<string, unknown>>> {
  const listener = await ownerPool.connect();
  const heard: Array<Record<string, unknown>> = [];
  const onNotification = (msg: pg.Notification): void => {
    if (msg.channel === ALARM_NOTIFY_CHANNEL && msg.payload) heard.push(JSON.parse(msg.payload) as Record<string, unknown>);
  };
  listener.on("notification", onNotification);
  try {
    await listener.query(`LISTEN ${ALARM_NOTIFY_CHANNEL}`);
    await body();
    // A committed NOTIFY reaches a listener on another connection asynchronously.
    for (let i = 0; i < 50 && heard.length === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
    await listener.query(`UNLISTEN ${ALARM_NOTIFY_CHANNEL}`);
  } finally {
    listener.off("notification", onNotification);
    listener.release();
  }
  return heard;
}

/**
 * An `rtu_comms` raise as `bms_tenant`: one row in the RTU's organization with no
 * asset and no rule, one `created` NOTIFY in `raise`'s payload shape, and no
 * `rule_executions` trace. A second raise for the same RTU is deduped by
 * `alarms_open_per_device_uidx` and announces nothing.
 */
export async function assertRaiseDeviceRaisesOnceAndNotifies(ctx: DeviceRaiseRlsFixtures): Promise<void> {
  const { raiser, ownerPool, organizationId, rtuId } = ctx;
  let first: Awaited<ReturnType<AlarmRaiser["raiseDevice"]>> | undefined;
  const heard = await notificationsDuring(ownerPool, async () => {
    first = await raiser.raiseDevice({
      organizationId,
      source: "rtu_comms",
      rtuId,
      severity: "warning",
      message: "Communication lost",
    });
  });
  expect(first?.raised, "a fresh RTU raises").toBe(true);
  const alarmId = first?.alarmId as string;
  expect(heard.filter((n) => n.alarmId === alarmId)).toEqual([{ type: "created", alarmId, organizationId }]);

  const row = await ownerPool.query(
    `SELECT organization_id, source, rtu_id, asset_id, rule_id, rule_key, severity, message, cleared_at
       FROM bms.alarms WHERE id = $1`,
    [alarmId],
  );
  expect(row.rows).toEqual([
    {
      organization_id: organizationId,
      source: "rtu_comms",
      rtu_id: rtuId,
      asset_id: null,
      rule_id: null,
      rule_key: null,
      severity: "warning",
      message: "Communication lost",
      cleared_at: null,
    },
  ]);
  // The listener's read (`readAlarmListItem`) left-joins the absent asset and names the RTU.
  const code = await ownerPool.query<{ code: string }>("SELECT code FROM bms.rtus WHERE id = $1", [rtuId]);
  const item = await readAlarmListItem(createDb(ownerPool), alarmId);
  expect(item).toMatchObject({
    id: alarmId,
    source: "rtu_comms",
    rtuId,
    rtuCode: code.rows[0]?.code,
    assetId: null,
    assetCode: null,
    assetName: null,
    siteName: null,
    assetRtuName: null,
    assetLocationName: null,
  });

  const trace = await ownerPool.query(`SELECT 1 FROM bms.rule_executions WHERE trace->>'alarmId' = $1`, [alarmId]);
  expect(trace.rows, "a device raise writes no rule_executions trace").toHaveLength(0);

  const again = await notificationsDuring(ownerPool, async () => {
    const second = await raiser.raiseDevice({
      organizationId,
      source: "rtu_comms",
      rtuId,
      severity: "warning",
      message: "Communication lost",
    });
    expect(second, "an open alarm for the RTU dedupes").toEqual({ raised: false, alarmId: null });
  });
  expect(again.filter((n) => n.organizationId === organizationId), "a deduped raise announces nothing").toEqual([]);
}

/** An `ingest_host` raise: one per organization, neither RTU nor asset. */
export async function assertRaiseDeviceHostAlarmOncePerOrganization(ctx: DeviceRaiseRlsFixtures): Promise<void> {
  const { raiser, ownerPool, organizationId } = ctx;
  const input = {
    organizationId,
    source: "ingest_host" as const,
    severity: "critical",
    message: "Ingest host not reporting",
  };
  const first = await raiser.raiseDevice(input);
  expect(first.raised).toBe(true);
  expect(await raiser.raiseDevice(input)).toEqual({ raised: false, alarmId: null });
  const row = await ownerPool.query(`SELECT source, rtu_id, asset_id FROM bms.alarms WHERE id = $1`, [first.alarmId]);
  expect(row.rows).toEqual([{ source: "ingest_host", rtu_id: null, asset_id: null }]);
}

/**
 * An `rtu_comms` raise naming an RTU of another organization is refused before
 * anything is written or announced — the tenant cannot see the RTU, and the
 * composite key would refuse it anyway.
 */
export async function assertRaiseDeviceRefusesForeignRtu(ctx: DeviceRaiseRlsFixtures): Promise<void> {
  const { raiser, ownerPool, organizationId, foreignRtuId } = ctx;
  const heard = await notificationsDuring(ownerPool, async () => {
    const result = await raiser.raiseDevice({
      organizationId,
      source: "rtu_comms",
      rtuId: foreignRtuId,
      severity: "warning",
      message: "Communication lost",
    });
    expect(result).toEqual({ raised: false, alarmId: null });
  });
  expect(heard.filter((n) => n.organizationId === organizationId)).toEqual([]);
  const rows = await ownerPool.query(`SELECT 1 FROM bms.alarms WHERE rtu_id = $1`, [foreignRtuId]);
  expect(rows.rows, "no alarm row names the foreign RTU").toHaveLength(0);
}

/**
 * `F4.359` U7 (ADR 0131 decisions 4–6; plan Q1 (a), D8) — the raiser decides
 * suppression inside its own raise transaction, as `bms_tenant`: the cover read
 * needs no fleet handle. The fixture is an organization of its own
 * (`insertCoverOrganization`) and one foreign organization; each assertion
 * opens the windows it needs, raises on an `(asset, rule)` pair no other
 * assertion uses, and ends its windows before it returns.
 */
export type SuppressionRlsFixtures = {
  raiser: AlarmRaiser;
  /** Superuser: windows and reads. */
  admin: pg.Pool;
  org: CoverOrganization;
  foreign: CoverOrganization;
};

type StampRow = { suppressed_at: Date | null; suppressed_by_window_id: string | null; unsuppressed_at: Date | null };

async function stampOf(admin: pg.Pool, alarmId: string | null): Promise<StampRow | undefined> {
  const { rows } = await admin.query<StampRow>(
    "SELECT suppressed_at, suppressed_by_window_id, unsuppressed_at FROM bms.alarms WHERE id = $1",
    [alarmId],
  );
  return rows[0];
}

async function endWindows(admin: pg.Pool, org: CoverOrganization): Promise<void> {
  await admin.query(
    "UPDATE bms.maintenance_windows SET ended_at = now(), ended_by = $2 WHERE organization_id = $1 AND ended_at IS NULL",
    [org.organizationId, org.userId],
  );
}

function coverRule(org: CoverOrganization, ruleId: string): AlarmRaiseRule {
  return {
    id: ruleId,
    code: `F4359-${ruleId.slice(0, 8)}`,
    name: "F4.359 suppression rule",
    pointKey: "f4359_point",
    severity: "warning",
    organizationId: org.organizationId,
    alarmMessage: null,
    unit: null,
  };
}

/**
 * A raise on an asset target inside an active window stamps both columns in the
 * raise transaction; the `created` NOTIFY still goes out, and the list item the
 * listener reads by its id after commit already reads `suppressed: true`.
 */
export async function assertRaiseInsideAWindowIsStamped(ctx: SuppressionRlsFixtures): Promise<void> {
  const { raiser, admin, org } = ctx;
  const windowId = await insertWindow(admin, org, { startsInSeconds: -60, endsInSeconds: 3600, assetIds: [org.assetIds[0]] });
  try {
    let result: AlarmRaiseResult | undefined;
    const heard = await notificationsDuring(admin, async () => {
      result = await raiser.raise(org.assetIds[0], org.organizationId, coverRule(org, org.ruleId), 999_999);
    });
    expect(result).toMatchObject({ raised: true, suppressed: true });
    const alarmId = result?.alarmId ?? null;
    const row = await stampOf(admin, alarmId);
    expect(row?.suppressed_at, "suppressed_at is stamped").toBeInstanceOf(Date);
    expect(row?.suppressed_by_window_id, "suppressed_by_window_id names the window").toBe(windowId);
    expect(row?.unsuppressed_at).toBeNull();

    const created = heard.filter((n) => n.alarmId === alarmId);
    expect(created, "a suppressed raise still announces itself (the list and history keep it)").toEqual([
      { type: "created", alarmId, organizationId: org.organizationId },
    ]);
    const item = await readAlarmListItem(createDb(admin), alarmId as string);
    expect(item).toMatchObject({ id: alarmId, suppressed: true, maintenanceWindowId: windowId, unsuppressedAt: null });
  } finally {
    await endWindows(admin, org);
  }
}

/**
 * Not stamped: after `ended_at`, after `ends_at`, before `starts_at`, and under
 * another organization's window that covers its whole tree. The positive
 * neighbour — an active window over another asset, raised in the same
 * assertion — is stamped, so the negatives cannot pass by stamping nothing.
 */
export async function assertRaiseOutsideAnActiveWindowIsNotStamped(ctx: SuppressionRlsFixtures): Promise<void> {
  const { raiser, admin, org, foreign } = ctx;
  const target = org.assetIds[1];
  await insertWindow(admin, org, { startsInSeconds: -600, endsInSeconds: 3600, ended: true, assetIds: [target] });
  await insertWindow(admin, org, { startsInSeconds: -7200, endsInSeconds: -3600, assetIds: [target] });
  await insertWindow(admin, org, { startsInSeconds: 3600, endsInSeconds: 7200, assetIds: [target] });
  await insertWindow(admin, foreign, { startsInSeconds: -60, endsInSeconds: 3600, locationIds: [foreign.site] });
  const active = await insertWindow(admin, org, { startsInSeconds: -60, endsInSeconds: 3600, assetIds: [org.assetIds[2]] });
  try {
    const outside = await raiser.raise(target, org.organizationId, coverRule(org, org.ruleId), 999_999);
    expect(outside).toMatchObject({ raised: true, suppressed: false });
    expect(await stampOf(admin, outside.alarmId)).toEqual({ suppressed_at: null, suppressed_by_window_id: null, unsuppressed_at: null });
    const item = await readAlarmListItem(createDb(admin), outside.alarmId as string);
    expect(item).toMatchObject({ suppressed: false, maintenanceWindowId: null });

    const inside = await raiser.raise(org.assetIds[2], org.organizationId, coverRule(org, org.ruleId), 999_999);
    expect(inside).toMatchObject({ raised: true, suppressed: true });
    expect((await stampOf(admin, inside.alarmId))?.suppressed_by_window_id).toBe(active);

    // A dedupe is not a raise: nothing to suppress.
    const again = await raiser.raise(org.assetIds[2], org.organizationId, coverRule(org, org.ruleId), 999_999);
    expect(again).toMatchObject({ raised: false, alarmId: null, suppressed: false });
  } finally {
    await endWindows(admin, org);
    await endWindows(admin, foreign);
  }
}

/** `rtu_comms` under a target location is stamped (decision 5); `ingest_host` never is, under a window over everything. */
export async function assertDeviceRaiseStampsRtuCommsAndNeverIngestHost(ctx: SuppressionRlsFixtures): Promise<void> {
  const { raiser, admin, org } = ctx;
  const windowId = await insertWindow(admin, org, {
    startsInSeconds: -60,
    endsInSeconds: 3600,
    locationIds: [org.site, org.room],
    assetIds: [...org.assetIds],
  });
  try {
    const rtu = await raiser.raiseDevice({
      organizationId: org.organizationId,
      source: "rtu_comms",
      rtuId: org.rtuId,
      severity: "warning",
      message: "Communication lost",
    });
    expect(rtu.raised).toBe(true);
    const rtuRow = await stampOf(admin, rtu.alarmId);
    expect(rtuRow?.suppressed_at, "an rtu_comms alarm under a target location is stamped").toBeInstanceOf(Date);
    expect(rtuRow?.suppressed_by_window_id).toBe(windowId);

    const host = await raiser.raiseDevice({
      organizationId: org.organizationId,
      source: "ingest_host",
      severity: "critical",
      message: "Ingest host not reporting",
    });
    expect(host.raised).toBe(true);
    expect(await stampOf(admin, host.alarmId), "an ingest_host alarm is never suppressed").toEqual({
      suppressed_at: null,
      suppressed_by_window_id: null,
      unsuppressed_at: null,
    });
  } finally {
    await endWindows(admin, org);
  }
}
