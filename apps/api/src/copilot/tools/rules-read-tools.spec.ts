import { expect } from "vitest";

import type { JwtPayload, RuleListItem } from "@bms/shared";

import type { ResolvedIdentity } from "../../auth/identity-resolver";
import { mapRuleRow } from "../../rules/rule-mapping";
import { ruleRow } from "../../rules/rule-mapping.spec";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { organizationOutOfScope } from "./copilot-tool-scope";

/**
 * `F4.278` (ADR 0099 Amendment 8 D7) — `list_rules` over a fake `RulesService`
 * that logs its calls. One call per organization with that organization's
 * readable asset ids, never `null` or `[]`. Vitest entry point: the sibling
 * `.test.ts`.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const ORG_EMPTY = "00000000-0000-4000-8000-0000000000dd";
const ORG_B = "00000000-0000-4000-8000-0000000000cc";
const ASSET_X = "30000000-0000-4000-8000-0000000000aa";
const ASSET_X2 = "30000000-0000-4000-8000-0000000000a2";
const ASSET_Y = "30000000-0000-4000-8000-0000000000bb";

const ASSETS_BY_ORG: Record<string, string[]> = { [ORG_X]: [ASSET_X, ASSET_X2], [ORG_Y]: [ASSET_Y], [ORG_EMPTY]: [] };

function ctx(allowed: readonly string[]): CopilotToolContext {
  return {
    identity: { id: USER, role: "admin", organizationId: null } as ResolvedIdentity,
    user: { sub: USER, role: "admin" } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: new Date("2026-10-23T06:00:00Z"),
  };
}

function rule(index: number, over: Parameters<typeof ruleRow>[0] = {}): RuleListItem {
  const n = String(index).padStart(2, "0");
  return mapRuleRow(ruleRow({ id: `rule-${n}`, code: `RULE-${n}`, name: `Rule ${n}`, assetId: ASSET_X, ...over }));
}

function fake(rulesByOrg: Record<string, RuleListItem[]>) {
  const log: (readonly string[] | null | undefined)[] = [];
  const services = {
    access: {
      readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => ASSETS_BY_ORG[organizationId] ?? [],
    },
    rules: {
      listRules: async (assetIds?: string[] | null) => {
        log.push(assetIds);
        const owner = Object.keys(ASSETS_BY_ORG).find((org) => (ASSETS_BY_ORG[org] ?? []).includes(assetIds?.[0] ?? ""));
        return { items: owner ? (rulesByOrg[owner] ?? []) : [] };
      },
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), log };
}

type Listed = { organizations: { organizationId: string; items: Record<string, unknown>[] }[]; truncated: boolean };

async function listRules(tools: ReturnType<typeof fake>["tools"], args: Record<string, unknown>, allowed: readonly string[]) {
  const result: CopilotToolResult = await tools.dispatch("list_rules", args, ctx(allowed));
  if (!result.ok) throw new Error(result.error);
  return result.result as unknown as Listed;
}

const itemsOf = (listed: Listed) => listed.organizations.flatMap((entry) => entry.items);

/** An organization outside the allowed set is refused, and `listRules` is not called. */
export async function anOrganizationOutsideTheAllowedSetIsRefused(): Promise<void> {
  const { tools, log } = fake({ [ORG_X]: [rule(1)] });
  const result = await tools.dispatch("list_rules", { organizationId: ORG_B }, ctx([ORG_X]));
  expect(result).toEqual({ ok: false, error: organizationOutOfScope([ORG_X]) });
  expect(log).toEqual([]);
}

/** `listRules` is called once per organization with that organization's readable asset ids, never `null`. */
export async function listRulesIsCalledPerOrganizationWithItsAssets(): Promise<void> {
  const { tools, log } = fake({ [ORG_X]: [rule(1)], [ORG_Y]: [rule(2, { assetId: ASSET_Y })] });
  await listRules(tools, {}, [ORG_X, ORG_Y]);
  expect(log).toEqual([[ASSET_X, ASSET_X2], [ASSET_Y]]);
}

/** An organization with no readable asset is not read. */
export async function anOrganizationWithNoReadableAssetIsNotRead(): Promise<void> {
  const { tools, log } = fake({ [ORG_X]: [rule(1)] });
  await listRules(tools, {}, [ORG_EMPTY, ORG_X]);
  expect(log).toEqual([[ASSET_X, ASSET_X2]]);
}

/** Archived and disabled rules come back, so a publish, enable or archive can name one. */
export async function archivedAndDisabledRulesComeBack(): Promise<void> {
  const { tools } = fake({
    [ORG_X]: [rule(1, { lifecycleStatus: "archived", enabled: false }), rule(2, { enabled: false }), rule(3)],
  });
  const items = itemsOf(await listRules(tools, {}, [ORG_X]));
  expect(items.map((item) => [item.code, item.lifecycleStatus, item.enabled])).toEqual([
    ["RULE-01", "archived", false],
    ["RULE-02", "published", false],
    ["RULE-03", "published", true],
  ]);
}

/** `search` matches a code case-insensitively on the 30th of 40 rows: it filters before the cap. */
export async function searchFiltersBeforeTheCap(): Promise<void> {
  const rows = Array.from({ length: 40 }, (_, i) => rule(i + 1));
  const { tools } = fake({ [ORG_X]: rows });
  const listed = await listRules(tools, { search: "rule-30" }, [ORG_X]);
  expect(itemsOf(listed).map((item) => item.code)).toEqual(["RULE-30"]);
  expect(listed.truncated).toBe(false);
}

/** 40 rows are cut to 25, with `truncated`. */
export async function fortyRowsAreCutToTwentyFive(): Promise<void> {
  const { tools } = fake({ [ORG_X]: Array.from({ length: 40 }, (_, i) => rule(i + 1)) });
  const listed = await listRules(tools, {}, [ORG_X]);
  expect([itemsOf(listed).length, listed.truncated]).toEqual([25, true]);
}

/** `assetId` narrows the list to that asset's rules. */
export async function assetIdNarrows(): Promise<void> {
  const { tools } = fake({ [ORG_X]: [rule(1), rule(2, { assetId: ASSET_X2 })] });
  const items = itemsOf(await listRules(tools, { assetId: ASSET_X2 }, [ORG_X]));
  expect(items.map((item) => item.code)).toEqual(["RULE-02"]);
}

/** The projection names the rule's condition fields and drops the rest (an extra contract key never reaches the model). */
export async function theProjectionKeepsTheConditionAndDropsTheRest(): Promise<void> {
  const { tools } = fake({ [ORG_X]: [rule(1)] });
  const [item] = itemsOf(await listRules(tools, {}, [ORG_X]));
  expect(Object.keys(item ?? {}).sort()).toEqual(
    [
      "id",
      "code",
      "name",
      "ruleType",
      "lifecycleStatus",
      "enabled",
      "assetId",
      "assetCode",
      "pointKey",
      "operator",
      "thresholdValue",
      "severity",
      "clearHoldSeconds",
      "condition",
    ].sort(),
  );
}
