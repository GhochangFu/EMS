import { BadRequestException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { automationRules } from "@bms/db";
import type { BmsDb } from "@bms/db";

/**
 * Rule code identity — the org-scoped "is this code taken" check and the
 * auto-generated fallback used when the operator names no code at all.
 *
 * `E7.1c` §4.5 extraction, done for the same reason `rule-reads.ts` and
 * `rule-samples.ts` were: `rules.service.ts` was at the 1000-line cap before
 * this task's fix could be added. Migration `0048` re-keyed
 * `automation_rules`' identity from a global `code` to `(organization_id,
 * code)` — the live unique index is `automation_rules_org_code_idx`, **not**
 * `automation_rules_code_unique`, a name that has never existed in this
 * database (verified against `pg_indexes`, not assumed). Both functions here
 * read on `fleetDb`, matching every other pre-write lookup in this service.
 */

/**
 * Refuses a `code` already used by another (non-archived) rule in the SAME
 * organization. Before `0048` this scanned every tenant's codes — a global
 * unique index backed that — which after the re-key both false-positived
 * (another tenant's code blocked this one) and leaked a foreign tenant's code
 * existence through the 400. Narrowed here to `organizationId`.
 *
 * `organizationId: null` skips the check outright. The only caller that
 * passes `null` is `previewRule`: a preview evaluates a draft that may not
 * even be persisted (E7.1c item D's "no org on either axis" — an asset-less
 * time-window preview has no org to scope this to), and the preview never
 * writes a rule. The authoritative check runs when the draft is actually
 * saved, through `createDraft`, which always resolves a real org first.
 */
export async function assertRuleCodeAvailable(
  fleetDb: BmsDb,
  organizationId: string | null,
  code: string,
  currentId?: string,
): Promise<void> {
  if (organizationId === null) {
    return;
  }
  const existingRules = await fleetDb
    .select({
      id: automationRules.id,
      code: automationRules.code,
      lifecycleStatus: automationRules.lifecycleStatus,
    })
    .from(automationRules)
    .where(eq(automationRules.organizationId, organizationId))
    .orderBy(automationRules.createdAt);
  const existing = existingRules.find(
    (rule) =>
      rule.id !== currentId &&
      rule.lifecycleStatus !== "archived" &&
      rule.code.trim().toUpperCase() === code,
  );
  if (existing) {
    throw new BadRequestException("Rule code already exists");
  }
}

/**
 * Generates a fresh code from a seed name — `SEED`, `SEED-2`, `SEED-3`, …
 *
 * **Scoped to `organizationId`** (`F4.289`), as `assertRuleCodeAvailable`
 * above and the `(organization_id, code)` unique index are. The scan was
 * global until then: it runs on `fleetDb` (BYPASSRLS), so the returned suffix
 * told a caller THAT a literal code existed in another tenant (seed a guessed
 * code and read back whether the candidate skipped), though never whose. The
 * batch route would have answered 25 such probes per request. Pinned by
 * `rules-batch.integration.spec.ts`
 * (`aCodeTakenInAnotherOrganizationDoesNotMoveTheGeneratedCode`); the suffix
 * walk by `twoRowsWithTheSameNameGetDistinctCodes` and
 * `anExplicitCodeLaterInTheBatchIsNotGeneratedForAnEarlierRow`.
 *
 * The arguments are named, not positional: `organizationId` and `seed` are
 * both strings, and a swap would still compile.
 *
 * `exclude` (`F4.289`): codes a batch has already taken but not yet inserted.
 * A candidate in the set is skipped as if it existed. Without it, two batch
 * rows named alike (or a generated code equal to a later row's explicit one)
 * would get the same code, and the second insert would hit the
 * `(organization_id, code)` unique index: a 500 instead of a row's 400.
 */
export async function nextRuleCode(
  fleetDb: BmsDb,
  {
    organizationId,
    seed,
    exclude = new Set(),
  }: { organizationId: string; seed: string; exclude?: ReadonlySet<string> },
): Promise<string> {
  const base = seed
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const prefix = base.length >= 3 ? base : "OPERATOR-RULE";

  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? prefix : `${prefix}-${index + 1}`;
    if (exclude.has(candidate)) {
      continue;
    }
    const [existing] = await fleetDb
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(and(eq(automationRules.organizationId, organizationId), eq(automationRules.code, candidate)))
      .limit(1);
    if (!existing) {
      return candidate;
    }
  }

  throw new BadRequestException("Could not generate a unique rule code");
}
