import { BadRequestException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";

/**
 * Rule-write organization resolution — `E7.1c` §4.5 extraction, done for the
 * same reason `rule-codes.ts`, `rule-audit.ts`, `rule-reads.ts` and
 * `rule-samples.ts` were: `rules.service.ts` was at the 1000-line cap before
 * `previewRule`'s item-D audit fix could be added. Both functions here read
 * on `fleetDb`, matching every other pre-write lookup in this service.
 */

/**
 * The organization a new rule is written into: its asset's org. An
 * asset-less rule is refused with a 4xx (ruling 4) — never a NULL insert —
 * until the E7.1d org-picker lands. `ruleType` is only for that message: a
 * `time_window` rule is legitimately asset-less by design, but a `threshold`
 * rule missing its asset is a different mistake (it has nothing to read a
 * point from), and naming the wrong one here sends the operator to fix a
 * field that was never wrong.
 */
export async function resolveWriteOrg(
  fleetDb: BmsDb,
  assetId: string | null,
  ruleType: string,
): Promise<string> {
  if (!assetId) {
    const noun =
      ruleType === "threshold" ? "an asset-less threshold rule" : "an asset-less time-window rule";
    throw new BadRequestException(
      `Select an organization for this rule: ${noun} has no organization to derive one from`,
    );
  }
  const [asset] = await fleetDb
    .select({ organizationId: assets.organizationId })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset) {
    throw new BadRequestException("Selected asset does not exist");
  }
  if (!asset.organizationId) {
    throw new BadRequestException("Asset has no organization; run the 0046 backfill");
  }
  return asset.organizationId;
}

/**
 * `previewRule`'s best-effort counterpart to `resolveWriteOrg`: the org an
 * asset resolves to, or `null` — never a throw. A preview evaluates drafts
 * `createDraft` would refuse outright (an unresolvable asset, a pre-backfill
 * NULL-org asset), and the audit trail must not block that; `null` here just
 * means the audit row falls back to the genuinely asset-less, fleet-managed
 * case.
 */
export async function resolveAssetOrgOrNull(
  fleetDb: BmsDb,
  assetId: string,
): Promise<string | null> {
  const [asset] = await fleetDb
    .select({ organizationId: assets.organizationId })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  return asset?.organizationId ?? null;
}
