import { randomUUID } from "node:crypto";

import { notificationChannels, ruleNotifications } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  assert,
  insertFixtureRule,
  insertFixtureSeverity,
  withRollback,
} from "../alarms/alarm-lifecycle.integration.spec";
import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import { loadEnabledChannelsForRules } from "./channel-reads";
import { ChannelsService } from "./channels.service";

/**
 * `F3.60` — `loadEnabledChannelsForRules` against a real database
 * (ADR 0041 Amendment 10).
 *
 * `channel-reads.spec.ts` drives the same function over a fake that applies no
 * `WHERE` and performs no ordering, so it can assert how many statements run
 * and how the rows are grouped, and nothing at all about the statement itself.
 * Everything below needs the real one:
 *
 * - the `enabled = true` filter, which decides whether a channel an operator
 *   switched off is still offered a raise;
 * - the `ORDER BY notification_channels.code`, which is the order the raise
 *   path delivers in and therefore the order a re-offer must keep;
 * - the `rule_notifications` join itself, which is how a rule learns who its
 *   channels are;
 * - and, in CI4, that a rule's group really is `ChannelsService.loadForRule`'s
 *   list — the sentence `AlarmLifecycleDeps.loadRuleChannels`' docblock makes,
 *   asserted id-for-id against the other implementation rather than trusted.
 *
 * **Rollback isolation, so nothing is committed.** Every case runs inside
 * `withRollback`, which is why the fixture needs no cleanup and no committed
 * prefix. Nothing here resolves a seeded row, so a concurrent session's data
 * cannot change an outcome: each case reads only rules it created in its own
 * transaction.
 *
 * Assertions live here; the sibling `.test` is the Vitest entry point
 * (ADR 0014). One `it()` per case, by `F4.105`.
 */

/** The channel codes of one rule's group, in the order the read left them, suffix stripped. */
function codesOf(
  byRule: ReadonlyMap<string, readonly { code: string }[]>,
  ruleId: string,
): string {
  return (byRule.get(ruleId) ?? [])
    .map((channel) => channel.code.replace(/^f360-/, "").replace(/-[0-9a-f]{8}$/, ""))
    .join(",");
}

/** The channel ids of one rule's group, in order, as one comparable string. */
function idsOf(byRule: ReadonlyMap<string, readonly { id: string }[]>, ruleId: string): string {
  return (byRule.get(ruleId) ?? []).map((channel) => channel.id).join(",");
}

type PlantedRules = { r1: string; r2: string; r3: string; unrequested: string };

/**
 * Three rules: r1 joined to three channels, r2 to one, r3 to none.
 *
 * **The insertion order is the reverse of the code order, deliberately.** `c2`
 * is inserted before `c1`, so a read that lost its `ORDER BY` and came back in
 * heap order would show `c2,c1`. And the disabled channel's code is `c0`, which
 * sorts FIRST, so a read that lost its `enabled` filter puts it at the head of
 * r1's group rather than somewhere a loose assertion might miss.
 */
async function plantThreeRules(tx: BmsDb): Promise<PlantedRules> {
  // `insertFixtureRule` writes `automation_rules.severity`, which has a foreign
  // key to `alarm_severities`; without this the insert is refused.
  await insertFixtureSeverity(tx);
  const loc = await fixtureLocation(tx);
  const [assetId] = await createFixtureAssets(tx, 1, "F310", loc);
  const suffix = randomUUID().slice(0, 8);

  const rules: string[] = [];
  for (const index of [0, 1, 2, 3]) {
    const rule = await insertFixtureRule(tx, {
      assetId: assetId as string,
      organizationId: loc.organizationId,
      pointKey: `f360_batch_${index}_${suffix}`,
      thresholdValue: 100,
      clearHoldSeconds: 30,
      action: { type: "notify", target: "Operations" },
    });
    rules.push(rule.id);
  }
  const [r1, r2, r3, unrequested] = rules as [string, string, string, string];

  const channel = async (code: string, enabled: boolean): Promise<string> => {
    const rows = await tx
      .insert(notificationChannels)
      .values({
        organizationId: loc.organizationId,
        code: `f360-${code}-${suffix}`,
        name: `F3.60 ${code}`,
        kind: "webhook",
        config: { url: "https://hooks.example.com/f360" },
        enabled,
      })
      .returning({ id: notificationChannels.id });
    const row = rows[0];
    assert(row !== undefined, `fixture channel ${code}`);
    return (row as { id: string }).id;
  };

  // Inserted c2 before c1 — see the docblock. c0 is disabled and sorts first.
  const c2 = await channel("c2", true);
  const c1 = await channel("c1", true);
  const c0 = await channel("c0", false);
  const c3 = await channel("c3", true);
  const c4 = await channel("c4", true);

  await tx.insert(ruleNotifications).values([
    { ruleId: r1, channelId: c2 },
    { ruleId: r1, channelId: c1 },
    { ruleId: r1, channelId: c0 },
    { ruleId: r2, channelId: c3 },
    // Never passed to the read — CI5's whole fixture. See that case.
    { ruleId: unrequested, channelId: c4 },
  ]);

  return { r1, r2, r3, unrequested };
}

/**
 * CI1 — the `enabled = true` filter is really in the statement.
 *
 * The absence rides beside a positive in the SAME assertion: `c0` must be gone
 * AND `c1` must be present. An absence asserted alone passes when the read
 * returned nothing at all, which has cost this repository three times.
 */
export async function assertTheEnabledFilterIsInTheStatement(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const { r1 } = await plantThreeRules(tx);

    const read = await loadEnabledChannelsForRules(tx, [r1]);
    const codes = codesOf(read.byRule, r1);

    assert(
      !codes.includes("c0") && codes.includes("c1"),
      `CI1: a disabled channel must be absent and an enabled one present, got [${codes}]`,
    );
  });
}

/**
 * CI2 — inside a group the order is `code` order, not insertion order.
 *
 * **What this case can and cannot gate, stated rather than implied.** Dropping
 * the `ORDER BY` reddens it on the heap order THIS fixture happens to produce,
 * because the rows are inserted in reverse code order. A heap order is
 * unspecified, so the mutant is free to coincide with the right answer on
 * another day or another page layout. The claim is gated at the source instead
 * by the clause being the same one `loadForRule` carries, and CI4 is what holds
 * the two together.
 */
export async function assertTheGroupIsInCodeOrder(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const { r1 } = await plantThreeRules(tx);

    const read = await loadEnabledChannelsForRules(tx, [r1]);

    assert(
      codesOf(read.byRule, r1) === "c1,c2",
      `CI2: the group must be in code order, got [${codesOf(read.byRule, r1)}]`,
    );
  });
}

/**
 * CI3 — a rule that joins nothing has no entry, its neighbour is untouched,
 * and neither is unread.
 *
 * The three halves are one claim about what an absent group means: read it and
 * nothing joined. Only `unread` may mean "never read", and a returning batch
 * must put nothing in it.
 */
export async function assertAQuietRuleHasNoEntryAndIsNotUnread(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const { r1, r2, r3 } = await plantThreeRules(tx);

    const read = await loadEnabledChannelsForRules(tx, [r1, r2, r3]);

    assert(
      codesOf(read.byRule, r2) === "c3" && !read.byRule.has(r3) && read.unread.size === 0,
      `CI3: r2 must hold its own channel, r3 none, and nothing may be unread — ` +
        `got r2=[${codesOf(read.byRule, r2)}] r3-entry=${read.byRule.has(r3)} unread=${read.unread.size}`,
    );
  });
}

/**
 * CI5 — the read returns groups for the rules it was ASKED about, and no others.
 *
 * **This case exists because a mutation survived without it.** The projection
 * carries `rule_notifications.rule_id` and the caller groups on it, so dropping
 * `WHERE rule_id IN (…)` altogether changes no decision the phase makes: the
 * extra rules land in `byRule` as entries nobody reads. Every other case here
 * stayed green under exactly that mutant. What it does instead is return every
 * rule's channels on the whole fleet, in every batch, every tick — which is the
 * opposite of what this row was built for, and it would have shipped invisibly.
 *
 * The unit spec cannot hold this claim: its fake applies no `WHERE` at all.
 *
 * **The absence rides beside a positive in the same assertion.** `r1` must be
 * present and the unrequested rule absent; the absence alone would pass against
 * a read that returned nothing. The unrequested rule is planted inside this
 * transaction with a channel of its own, so the fixture does not depend on the
 * fleet holding any `rule_notifications` row — and on this stack it holds none,
 * which is exactly why an assertion over seeded data would have proved nothing.
 */
export async function assertOnlyTheRequestedRulesComeBack(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const { r1, unrequested } = await plantThreeRules(tx);

    const read = await loadEnabledChannelsForRules(tx, [r1]);

    assert(
      read.byRule.has(r1) && !read.byRule.has(unrequested),
      `CI5: only the requested rule may come back — got requested=${read.byRule.has(r1)} ` +
        `unrequested=${read.byRule.has(unrequested)} over ${read.byRule.size} group(s)`,
    );
  });
}

/**
 * CI4 — per rule, the batched read is `ChannelsService.loadForRule`'s list.
 *
 * This is the case that makes "the rule's channels has one definition" a
 * measured fact rather than a sentence in two docblocks. It compares ids in
 * order against the other implementation, on the same transaction and the same
 * fixture, so a divergence in the join, the filter or the ordering shows up
 * here whichever of the two moved.
 */
export async function assertEachGroupIsLoadForRulesList(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const { r1, r2 } = await plantThreeRules(tx);
    const channels = new ChannelsService(
      tx,
      tx,
      { decrypt: () => ({}) } as unknown as ConstructorParameters<typeof ChannelsService>[2],
      {} as unknown as ConstructorParameters<typeof ChannelsService>[3],
    );

    const read = await loadEnabledChannelsForRules(tx, [r1, r2]);

    for (const ruleId of [r1, r2]) {
      const expected = (await channels.loadForRule(ruleId)).map((row) => row.id).join(",");
      assert(
        idsOf(read.byRule, ruleId) === expected,
        `CI4: the group must be loadForRule's list — got [${idsOf(read.byRule, ruleId)}], ` +
          `loadForRule gives [${expected}]`,
      );
    }
  });
}
