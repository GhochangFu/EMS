import { and, eq, inArray } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { notificationChannels, ruleNotifications } from "@bms/db";

import type { ChannelsService } from "./channels.service";
import { reasonOf } from "./raise-attempts";

/**
 * `F3.10`, and since `F3.60` the two channel reads the alarm lifecycle sweep
 * needs that `ChannelsService` does not already have (ADR 0057 decision 9,
 * ADR 0041 Amendment 10). {@link loadEnabledChannelsByIds} is the escalation
 * phase's, by channel id; {@link loadEnabledChannelsForRules} is the
 * raise-retry phase's, by rule id.
 *
 * **Why neither is a method on `ChannelsService`.** That file stood at 986 of
 * AGENTS.md §4.5's 1000 lines when `F3.10` wrote this sentence and stands at
 * 964 now, so the headroom `F3.60` would have needed for a batching loop, a
 * failure shape and a docblock was never there. It gains nothing either (plan
 * D10). The row shape is `ChannelsService.toChannelRow`'s parameter — the same
 * projection `loadForRule` selects — so the caller maps with the already-public
 * method and decryption stays in the one place ADR 0041 decision 8 put it.
 * `F3.60`'s backlog row sketches this read as `ChannelsService.loadForRules`;
 * the sketch is followed in everything but its home, for the reason above and
 * on `raise-attempts.ts`'s stated precedent.
 *
 * **`fleetDb`, with its reason (ADR 0043 Amendment 3, §4.3).** The caller is
 * a system sweep with no JWT that spans every tenant — the same reason
 * `AlarmEngineService` and `HealthRollupService` give — and the ids it passes
 * were read from the tenant's own escalation profile under that tenant's
 * policy. A fleet-wide (`NULL`-org) channel is a legitimate target here for
 * the same reason it is on `rule_notifications` (plan D6), so no organization
 * predicate is added: the profile's policy already decided who may name the
 * channel; this read only decides whether it is still enabled.
 */

/** A stored channel row, ciphertext and all: what `ChannelsService.toChannelRow` takes. */
export type StoredChannelRow = Parameters<ChannelsService["toChannelRow"]>[0];

/**
 * The enabled channels among `ids`, in channel-code order — the order
 * `loadForRule` gives, so a step's deliveries land in the same order a raise's
 * do. A disabled channel is silently absent: an operator who disabled it asked
 * for exactly that. Empty `ids` returns `[]` without a query.
 */
export async function loadEnabledChannelsByIds(
  db: BmsDb,
  ids: readonly string[],
): Promise<StoredChannelRow[]> {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select({
      id: notificationChannels.id,
      organizationId: notificationChannels.organizationId,
      code: notificationChannels.code,
      name: notificationChannels.name,
      kind: notificationChannels.kind,
      config: notificationChannels.config,
      enabled: notificationChannels.enabled,
      secretCiphertext: notificationChannels.secretCiphertext,
      secretIv: notificationChannels.secretIv,
      // `E8.4` (ADR 0062 decision 3): `toChannelRow` decrypts at the stored
      // version, so this projection has to carry it. Drop this line and the
      // build stops compiling — `StoredChannelRow` is that method's parameter
      // type and the property is required there.
      secretKeyVersion: notificationChannels.secretKeyVersion,
      updatedAt: notificationChannels.updatedAt,
    })
    .from(notificationChannels)
    .where(and(inArray(notificationChannels.id, [...ids]), eq(notificationChannels.enabled, true)))
    .orderBy(notificationChannels.code);
}

/**
 * `F3.60` — how many rule ids one statement binds.
 *
 * One parameter per rule id plus the `enabled` literal, so the pessimal bind
 * count is `RULE_CHANNEL_BATCH_SIZE + 1` against the extended protocol's 65 535
 * — two orders of magnitude of headroom. It is **its own constant and not
 * `RAISE_ATTEMPT_BATCH_SIZE`**, which happens to hold the same number: that one
 * binds roughly two parameters per alarm across three `IN` lists, so the two
 * arithmetics are different and a later change to either must not silently move
 * the other. The size is not chosen against the limit alone — a statement
 * holding tens of thousands of parameters plans and transfers badly long before
 * it fails — which is `raise-attempts.ts`'s own reasoning, and it is quoted
 * rather than referenced because a reader here must not have to go and find it.
 */
export const RULE_CHANNEL_BATCH_SIZE = 500;

/** What one tick's rule-channel read gives back — the groups it read, and the rules it could not. */
export type RuleChannelsRead<Row> = {
  /**
   * Rule id → its enabled joined channels, in `code` order: `loadForRule`'s
   * list, per rule. A rule whose batch RETURNED but that joins no enabled
   * channel has **no entry**, so a caller's `?? []` is the same
   * `channels.length === 0` exit it always had. Only a rule whose batch
   * returned can appear here at all.
   */
  byRule: ReadonlyMap<string, readonly Row[]>;
  /**
   * The rule ids of every batch that did not return. The caller must decide
   * NOTHING about their alarms this tick — not "owed" and not "not owed". An
   * absent group and a group that was never read are indistinguishable in
   * {@link RuleChannelsRead.byRule}, and they mean opposite things, so the
   * difference lives here.
   */
  unread: ReadonlySet<string>;
  /** One bounded reason per failed batch, in batch order — the caller's warn line. */
  reasons: readonly string[];
};

/**
 * `ruleIds` de-duplicated over the WHOLE list, then sliced into fixed-size
 * batches.
 *
 * Exported so the shape can be asserted directly (cases C1–C2). **The
 * de-duplication happens before the slicing, and that is the one place this
 * differs from `raiseAttemptBatches`**, which slices first and de-duplicates
 * inside each batch. The difference is load-bearing rather than stylistic: a
 * rule id landing in two batches is read twice and grouped twice, and
 * `channelsOwedTheRaise` would then be handed the same channel twice and offer
 * it twice — a duplicate send, which is the exact failure `F3.51` exists to
 * stop. `raiseAttemptBatches` never faced it because the phase builds one ref
 * per alarm and an alarm appears once.
 */
export function ruleChannelBatches(
  ruleIds: readonly string[],
  size: number = RULE_CHANNEL_BATCH_SIZE,
): string[][] {
  const distinct = [...new Set(ruleIds)];
  const batches: string[][] = [];
  for (let start = 0; start < distinct.length; start += size) {
    batches.push(distinct.slice(start, start + size));
  }
  return batches;
}

/** One batch's rows: the projection `toChannelRow` takes, plus the rule that joined it. */
type RuleChannelRow = StoredChannelRow & { ruleId: string };

/**
 * `F3.60` — the enabled channels joined to each of `ruleIds`, grouped by rule,
 * in `ceil(distinct ruleIds / RULE_CHANNEL_BATCH_SIZE)` statements.
 *
 * **The statement is `ChannelsService.loadForRule`'s**, one rule id widened to
 * an `IN` list and `rule_notifications.rule_id` added to the projection so the
 * rows can be grouped. Same join, same `enabled = true` filter, same eleven
 * columns and the same `ORDER BY code`, so "the rule's channels" keeps the one
 * definition `AlarmLifecycleDeps.loadRuleChannels` promises it has.
 *
 * **CI4 asserts the two lists id-for-id, and that is weaker than it reads.** It
 * compares ids, so it says nothing about the PROJECTION: this read shipped
 * missing `secret_key_version` and CI4 stayed green. What caught it was
 * `pnpm build`, after the merge, on `main` — `E8.4` added that column to
 * `toChannelRow`'s parameter and to both reads that existed when it landed,
 * while this one sat on an unmerged branch. Each pull request was green alone.
 * **`tsc -p tsconfig.json --noEmit` did not catch it either**, and the reason is
 * worth keeping: the branch was rebased onto a `main` that did not yet carry
 * `E8.4`, so the type it had to satisfy was the old one. A rebase is only a
 * merge-skew test against the `main` that exists when you run it.
 *
 * **Order inside a group is the statement's**, because the rows are appended in
 * the order they arrive. `ORDER BY code` is over the whole batch, so two rules'
 * channels interleave; grouping by insertion leaves each rule's own slice in
 * code order, which is what the caller needs (case C4).
 *
 * **`size` is a parameter for one reason: so a case can drive more than one
 * batch against a real database.** The default is the only value production
 * uses. Without it every integration fixture is a single batch, in which
 * "each statement binds its own batch" and "each statement binds the whole
 * list" are the same statement — and the correctness review found exactly that
 * gap: a mutation replacing `batch` with the whole de-duplicated list survived
 * all eighteen cases. Case CI6 drives `size: 2` and kills it.
 *
 * **A failing batch costs only its own rules** — `loadRaiseAttempts`'s shape,
 * and its reason: one noisy tenant's volume must not disable raise retry for
 * the whole fleet. The other batches are still read, the failed batch's ids go
 * to `unread`, and one bounded cause per failure goes to `reasons`. Empty
 * `ruleIds` issues no statement.
 *
 * **`fleetDb`, and the reason is {@link loadEnabledChannelsByIds}'s** — a
 * system sweep with no JWT, spanning every tenant. There is one difference
 * worth naming: the ids there were read from a tenant's own escalation profile,
 * whereas here they are rule ids the sweep already holds for alarms it is
 * deciding. No organization predicate is added for the same reason: a
 * fleet-wide (`NULL`-org) channel is a legitimate target on `rule_notifications`
 * (plan D6), and the raise path this re-offers reads exactly this join.
 */
export async function loadEnabledChannelsForRules(
  db: BmsDb,
  ruleIds: readonly string[],
  size: number = RULE_CHANNEL_BATCH_SIZE,
): Promise<RuleChannelsRead<StoredChannelRow>> {
  const byRule = new Map<string, StoredChannelRow[]>();
  const unread = new Set<string>();
  const reasons: string[] = [];

  for (const batch of ruleChannelBatches(ruleIds, size)) {
    let rows: RuleChannelRow[];
    try {
      rows = await selectRuleChannelBatch(db, batch);
    } catch (err) {
      // Per statement, never per phase — the caller is told exactly which
      // rules it may not decide about, and the rest of the fleet is decided.
      for (const ruleId of batch) {
        unread.add(ruleId);
      }
      reasons.push(reasonOf(err));
      continue;
    }
    for (const { ruleId, ...channel } of rows) {
      const forRule = byRule.get(ruleId) ?? [];
      forRule.push(channel);
      byRule.set(ruleId, forRule);
    }
  }

  return { byRule, unread, reasons };
}

async function selectRuleChannelBatch(db: BmsDb, ruleIds: string[]): Promise<RuleChannelRow[]> {
  return db
    .select({
      ruleId: ruleNotifications.ruleId,
      id: notificationChannels.id,
      organizationId: notificationChannels.organizationId,
      code: notificationChannels.code,
      name: notificationChannels.name,
      kind: notificationChannels.kind,
      config: notificationChannels.config,
      enabled: notificationChannels.enabled,
      secretCiphertext: notificationChannels.secretCiphertext,
      secretIv: notificationChannels.secretIv,
      // `E8.4` added this column to `toChannelRow`'s parameter and to both of
      // the reads that existed when it landed. This read was on an unmerged
      // branch at the time, so nothing connected the two: each pull request was
      // green alone and `main` was red with both. See the header.
      secretKeyVersion: notificationChannels.secretKeyVersion,
      updatedAt: notificationChannels.updatedAt,
    })
    .from(ruleNotifications)
    .innerJoin(notificationChannels, eq(ruleNotifications.channelId, notificationChannels.id))
    .where(
      and(inArray(ruleNotifications.ruleId, ruleIds), eq(notificationChannels.enabled, true)),
    )
    .orderBy(notificationChannels.code);
}
