import { randomUUID } from "node:crypto";

import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { UNRESTRICTED_SCOPE } from "../maintenance-windows/maintenance-window-scope";
import type { WindowsFixture } from "../maintenance-windows/maintenance-windows.service.rls.integration.spec";
import { tenantWindowReads } from "./copilot-maintenance-window-targets";
import { copilotContext } from "./copilot-request-context";

/**
 * `F4.359` PR 6 (ADR 0099 Amendment 19) — the Copilot's maintenance-window
 * writes and reads on the real `bms_tenant` / `bms_fleet` pair, over the
 * service's own fixture (`buildWindowsFixture`: organization A with site S,
 * its child C, site T and an asset at each; B with site U and its asset).
 *
 * (1) The plan's one integration claim: a create confirmed through a Copilot
 * change (the interceptor runs the handler inside `copilotContext`) writes the
 * window and an audit row marked `via: "copilot"` with the change id.
 * (2) The target's reads under `withTenant`: a create's rows with their labels
 * in their own organization only, the assets a location covers, and a stored
 * window with its state and every target.
 *
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const fromNow = (ms: number): string => new Date(Date.now() + ms).toISOString();
const HOUR = 60 * 60 * 1000;

/** (1) Inside a Copilot change, the create writes the window and one audit row carrying the mark and the change id. */
export async function aConfirmedCreateWritesTheWindowAndACopilotAuditRow(fx: WindowsFixture): Promise<void> {
  const changeId = randomUUID();
  const reason = `F4.359 copilot create ${fx.run}`;
  const item = await copilotContext.run({ change: { via: "copilot", changeId } }, () =>
    fx.svc.create(fx.actor, { reason, endsAt: fromNow(2 * HOUR), targets: [{ kind: "asset", assetId: fx.asset.C }] }, UNRESTRICTED_SCOPE),
  );
  const window = await fx.db.query<{ organization_id: string; reason: string }>(
    "SELECT organization_id, reason FROM bms.maintenance_windows WHERE id = $1",
    [item.id],
  );
  expect(window.rows).toEqual([{ organization_id: fx.a, reason }]);
  const audit = await fx.db.query<{ action: string; via: string | null; change_id: string | null }>(
    "SELECT action, payload->>'via' AS via, payload->>'changeId' AS change_id FROM bms.audit_log WHERE entity_id = $1",
    [item.id],
  );
  expect(audit.rows).toEqual([{ action: "maintenance_window_create", via: "copilot", change_id: changeId }]);
}

/** (2) The target's reads: labels in the organization only, the covered assets, and a stored window with its state. */
export async function theTargetReadsAreTenantBound(fx: WindowsFixture, tenantDb: BmsDb): Promise<void> {
  const reads = tenantWindowReads(tenantDb);
  const input = [
    { kind: "location" as const, locationId: fx.site.S },
    { kind: "asset" as const, assetId: fx.asset.C },
    { kind: "asset" as const, assetId: fx.asset.U },
  ];
  const inA = await reads.targetsIn(fx.a, input);
  expect(inA.map((row) => [row.kind, row.id, row.organizationId, row.label]).sort()).toEqual(
    [
      ["asset", fx.asset.C, fx.a, "F4.359 asset C"],
      ["location", fx.site.S, fx.a, "F4.359 site S"],
    ].sort(),
  );
  expect((await reads.targetsIn(fx.b, input)).map((row) => row.id)).toEqual([fx.asset.U]);
  // S's subtree holds S's asset and C's.
  expect(await reads.coveredAssetCount(fx.a, [fx.site.S])).toBe(2);
  expect(await reads.coveredAssetCount(fx.b, [fx.site.S])).toBe(0);

  const reason = `F4.359 copilot read ${fx.run}`;
  const item = await fx.svc.create(
    fx.actor,
    { reason, endsAt: fromNow(2 * HOUR), targets: [{ kind: "location", locationId: fx.site.S }, { kind: "rule", ruleId: fx.ruleC }] },
    UNRESTRICTED_SCOPE,
  );
  const stored = await reads.windowIn(fx.a, item.id);
  expect([stored?.reason, stored?.state, stored?.endsAt]).toEqual([reason, "active", item.endsAt]);
  expect(stored?.targets.map((target) => [target.kind, target.id, target.label]).sort()).toEqual(
    [
      ["location", fx.site.S, "F4.359 site S"],
      ["rule", fx.ruleC, "F4.359 rule C"],
    ].sort(),
  );
  expect(stored?.targets.find((target) => target.kind === "rule")).toMatchObject({ assetId: fx.asset.C });
  expect(await reads.windowIn(fx.b, item.id)).toBeNull();
}
