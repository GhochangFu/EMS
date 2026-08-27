import { expect } from "vitest";
import pg from "pg";

import type { AlarmRaiseRule } from "./alarm-raise.service";
import type { AlarmRaiser } from "./alarm-raise.service";

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
