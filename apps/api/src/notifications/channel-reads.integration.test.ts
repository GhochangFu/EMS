import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAQuietRuleHasNoEntryAndIsNotUnread,
  assertEachGroupIsLoadForRulesList,
  assertOnlyTheRequestedRulesComeBack,
  assertTheEnabledFilterIsInTheStatement,
  assertTheGroupIsInCodeOrder,
} from "./channel-reads.integration.spec";

/**
 * `F3.60` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, following
 * `alarm-lifecycle-raise-retry.integration.test.ts`'s shape.
 */
const connectionString = requireIntegrationDb({
  item: "F3.60",
  label: "rule-channel batched read integration tests",
  because:
    "a green run here would assert that the batched read filters on enabled, orders each group by " +
    "channel code, leaves a rule that joins nothing out of the groups without marking it unread, " +
    "and gives per rule exactly the list ChannelsService.loadForRule gives — while nothing checked " +
    "any of it against a real rule_notifications join. The unit spec's fake applies no WHERE and " +
    "performs no ordering, so it cannot stand in. Fix the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("F3.60 — the batched rule-channel read against a real database", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.60");
    db = createDb(pool);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 60_000);

  it("CI1 — leaves a disabled channel out while its enabled sibling stays", async () => {
    await assertTheEnabledFilterIsInTheStatement(db);
  }, 60_000);

  it("CI2 — returns each rule's group in channel-code order, not insertion order", async () => {
    await assertTheGroupIsInCodeOrder(db);
  }, 60_000);

  it("CI3 — gives a rule that joins nothing no entry, and marks nothing unread", async () => {
    await assertAQuietRuleHasNoEntryAndIsNotUnread(db);
  }, 60_000);

  it("CI5 — returns groups only for the rules it was asked about", async () => {
    await assertOnlyTheRequestedRulesComeBack(db);
  }, 60_000);

  it("CI4 — gives per rule the same list, in the same order, as ChannelsService.loadForRule", async () => {
    await assertEachGroupIsLoadForRulesList(db);
  }, 60_000);
});
