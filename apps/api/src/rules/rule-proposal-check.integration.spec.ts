import { expect } from "vitest";

import { DEFAULT_RULE_CATEGORY_CODE } from "@bms/shared";

import { RuleProposalCheckService } from "./rule-proposal-check.service";
import type { RulesRlsFixtures } from "./rules.service.rls.integration.spec";

/**
 * `F4.278` (ADR 0099 Amendment 8, Q9) — the copilot's rule check writes no
 * audit row, on a real database. Counted as `bms_fleet` (`ctx.ownerPool`,
 * BYPASSRLS), so the count sees every organization's rows. The adjacent
 * positive control: `RulesService.previewRule` on the same draft adds one
 * `rule_preview` row, so a count that never moves would fail it. Run from
 * `rules.service.rls.integration.test.ts`, which owns the fixture lifecycle.
 */
export async function theRuleCheckWritesNoAuditRowWherePreviewWritesOne(
  ctx: RulesRlsFixtures,
  code: string,
): Promise<void> {
  const draft = {
    code,
    name: `F4.278 check ${code}`,
    category: DEFAULT_RULE_CATEGORY_CODE,
    ruleType: "threshold" as const,
    assetId: ctx.assetId,
    pointKey: ctx.pointKey,
    operator: "gt" as const,
    thresholdValue: 999_999,
    severity: null,
    condition: { window: "latest" as const },
    action: { type: "notify" as const, target: "Operations" },
  };
  const previews = async (): Promise<number> => {
    const { rows } = await ctx.ownerPool.query<{ n: string }>(
      "SELECT count(*) AS n FROM bms.audit_log WHERE action = 'rule_preview' AND payload->>'code' = $1",
      [code.toUpperCase()],
    );
    return Number(rows[0]?.n ?? 0);
  };
  const before = await previews();
  const check = new RuleProposalCheckService(ctx.tenantDb, ctx.service);
  const { note } = await check.check({
    entryId: "rule.create",
    params: {},
    body: draft,
    organizationId: ctx.organizationId,
    now: new Date(),
  });
  expect(note).toContain("Would match now:");
  expect(await previews(), "the copilot's check writes no rule_preview row").toBe(before);

  await ctx.service.previewRule({ ...draft, id: undefined }, ctx.scopedActor, [ctx.assetId]);
  expect(await previews(), "the positive control: previewRule writes one rule_preview row").toBe(before + 1);
}
