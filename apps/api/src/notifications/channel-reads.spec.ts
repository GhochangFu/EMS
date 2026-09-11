import {
  RULE_CHANNEL_BATCH_SIZE,
  loadEnabledChannelsForRules,
  ruleChannelBatches,
} from "./channel-reads";

/**
 * `F3.60` — `loadEnabledChannelsForRules`' batching, grouping and failure
 * shape, over a fake database (ADR 0041 Amendment 10).
 *
 * The raise-retry phase paid one round trip per distinct rule with an
 * evidence-bearing alarm, every tick, serially. Measured on the seeded stack as
 * `bms_fleet` from inside `bms-api-1`: 78 sequential reads cost 125–135 ms and
 * one batched statement over the same 78 rule ids cost 2.6–3.6 ms. The reads
 * are one statement per {@link RULE_CHANNEL_BATCH_SIZE} rules now.
 *
 * **A fake database, not the real one.** What is asserted here is the SHAPE of
 * the reads — how many statements, what de-duplication does to the batches,
 * what a failing one costs, and how the rows are grouped. None of that needs a
 * socket. That the `WHERE` really filters on `enabled`, that the `ORDER BY`
 * really orders, and that each group is `loadForRule`'s list id-for-id are
 * `channel-reads.integration.spec.ts`'s claims and stay there.
 *
 * **What this file cannot prove.** The fake applies no `WHERE` and discards the
 * argument it is handed, so a case here cannot tell a right predicate from a
 * missing one, nor see WHICH ids a statement bound. Every claim about the
 * predicate is CI1–CI6's — CI5 owns the `rule_id IN (…)` filter and CI6 owns
 * each statement binding its own batch, and both exist because a mutation
 * survived every case in this file.
 *
 * Assertions live here; the sibling `.test` is the Vitest entry point
 * (ADR 0014). **One `it()` per case, by `F4.105`**: `assert` throws, so a
 * single `it()` over seven cases stops at the first failure and every later
 * block becomes decoration a mutation can never redden. `raise-attempts.spec.ts`
 * has the older shape — one `it()` over six — and is left alone; a new file
 * does not inherit a shape that a recorded lesson calls wrong.
 */

type Db = Parameters<typeof loadEnabledChannelsForRules>[0];

type FakeRow = {
  ruleId: string;
  id: string;
  organizationId: string | null;
  code: string;
  name: string;
  kind: string;
  config: unknown;
  enabled: boolean;
  secretCiphertext: Buffer | null;
  secretIv: Buffer | null;
  updatedAt: Date;
};

const AT = new Date("2026-09-10T00:00:00.000Z");

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** One joined row: the rule that joined it, and the channel's code as its identity. */
function row(ruleId: string, code: string): FakeRow {
  return {
    ruleId,
    id: `channel-${code}`,
    organizationId: "org-0",
    code,
    name: code,
    kind: "webhook",
    config: {},
    enabled: true,
    secretCiphertext: null,
    secretIv: null,
    updatedAt: AT,
  };
}

/** `count` distinct rule ids, numbered from `start` so two runs cannot collide. */
function ruleIds(count: number, start = 0): string[] {
  return Array.from({ length: count }, (_, index) => `rule-${start + index}`);
}

/**
 * A database answering each `select().from().innerJoin().where().orderBy()`
 * from `answers(index)` — a row list, or an `Error` to reject that statement
 * with.
 */
function fakeDb(answers: (index: number) => FakeRow[] | Error): {
  db: Db;
  statements: () => number;
} {
  let statements = 0;
  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => {
              const answer = answers(statements);
              statements += 1;
              return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
            },
          }),
        }),
      }),
    }),
  };
  return { db: db as unknown as Db, statements: () => statements };
}

/** The codes of one rule's group, in the order the read left them. */
function codesOf(byRule: ReadonlyMap<string, readonly { code: string }[]>, ruleId: string): string {
  return (byRule.get(ruleId) ?? []).map((channel) => channel.code).join(",");
}

/**
 * C1 — more rule ids than one batch holds is more than one statement.
 *
 * The mutation this kills is the whole of the old shape arriving in one
 * statement: a read that binds every id at once plans and transfers badly, and
 * at 32 700 rules it exceeds the bind limit outright.
 */
export async function assertMoreIdsThanOneBatchIsMoreThanOneStatement(): Promise<void> {
  const { db, statements } = fakeDb(() => []);
  await loadEnabledChannelsForRules(db, ruleIds(RULE_CHANNEL_BATCH_SIZE * 2 + 1));
  assert(
    statements() === 3,
    `C1: ${RULE_CHANNEL_BATCH_SIZE * 2 + 1} rule ids must be 3 statements, got ${statements()}`,
  );
}

/**
 * C2 — the de-duplication runs over the whole list, before the slicing.
 *
 * Three assertions, and the middle one is the positive control: without it, a
 * `ruleChannelBatches` that returned one batch of everything would satisfy the
 * first. The duplicate straddles the batch boundary on purpose — a per-batch
 * de-duplication, `raiseAttemptBatches`' shape, leaves it in both.
 */
export function assertDuplicatesCollapseBeforeSlicing(): void {
  const withDuplicate = ["rule-a", ...ruleIds(RULE_CHANNEL_BATCH_SIZE - 1, 1), "rule-a"];
  const collapsed = ruleChannelBatches(withDuplicate);
  assert(
    collapsed.length === 1 && collapsed[0]?.length === RULE_CHANNEL_BATCH_SIZE,
    `C2: ${withDuplicate.length} ids with one duplicate must be 1 batch of ${RULE_CHANNEL_BATCH_SIZE}, ` +
      `got ${collapsed.length} batch(es) of ${collapsed.map((batch) => batch.length).join(",")}`,
  );

  const distinct = ruleIds(RULE_CHANNEL_BATCH_SIZE + 1);
  const sliced = ruleChannelBatches(distinct);
  assert(
    sliced.length === 2 && sliced[0]?.length === RULE_CHANNEL_BATCH_SIZE && sliced[1]?.length === 1,
    `C2: ${distinct.length} distinct ids must be batches of ${RULE_CHANNEL_BATCH_SIZE},1, ` +
      `got ${sliced.map((batch) => batch.length).join(",")}`,
  );

  const last = distinct[distinct.length - 1] ?? "";
  assert(
    sliced[1]?.includes(last) === true && sliced[0]?.includes(last) === false,
    `C2: the last id must be bound by batch 2 and by no other`,
  );
}

/**
 * C3 — a failing batch costs only its own rules, and the rest are read.
 *
 * Four assertions. The last one carries a positive control inside itself: a
 * `unread` filled with every requested id would satisfy "the failing batch's
 * rule is unread" and is caught only by asserting a returned batch's rule is
 * NOT in it.
 */
export async function assertAFailingBatchCostsOnlyItsOwnRules(): Promise<void> {
  const ids = ruleIds(RULE_CHANNEL_BATCH_SIZE * 2 + 1);
  const batches = ruleChannelBatches(ids);
  const first = batches[0]?.[0] ?? "";
  const second = batches[1]?.[0] ?? "";
  const third = batches[2]?.[0] ?? "";
  const { db, statements } = fakeDb((index) => {
    if (index === 1) return new Error("too many bind parameters");
    return [row(index === 0 ? first : third, "A")];
  });

  const read = await loadEnabledChannelsForRules(db, ids);

  assert(statements() === 3, `C3: must still issue 3 statements, got ${statements()}`);
  assert(
    read.byRule.has(first) && read.byRule.has(third),
    `C3: the batches that returned must be grouped, got ${[...read.byRule.keys()].join(",")}`,
  );
  assert(
    read.reasons.length === 1 && (read.reasons[0]?.includes("too many bind parameters") ?? false),
    `C3: must carry one reason naming the cause, got ${JSON.stringify(read.reasons)}`,
  );
  assert(
    read.unread.size === RULE_CHANNEL_BATCH_SIZE &&
      read.unread.has(second) &&
      !read.unread.has(first),
    `C3: only the failing batch's ${RULE_CHANNEL_BATCH_SIZE} rules may be unread, ` +
      `got ${read.unread.size} including-first=${read.unread.has(first)}`,
  );
}

/**
 * C4 — grouping preserves the order the statement returned, per rule.
 *
 * The fixture interleaves two rules exactly as `ORDER BY code` over a batch
 * does, so a grouping that prepends, or that sorts by anything of its own,
 * leaves at least one group out of code order.
 */
export async function assertGroupingPreservesTheStatementsOrder(): Promise<void> {
  const { db } = fakeDb(() => [row("rule-1", "A"), row("rule-2", "B"), row("rule-1", "C"), row("rule-2", "D")]);

  const read = await loadEnabledChannelsForRules(db, ["rule-1", "rule-2"]);

  assert(
    read.byRule.size === 2 &&
      codesOf(read.byRule, "rule-1") === "A,C" &&
      codesOf(read.byRule, "rule-2") === "B,D",
    `C4: each group must keep the statement's order, got rule-1=[${codesOf(read.byRule, "rule-1")}] ` +
      `rule-2=[${codesOf(read.byRule, "rule-2")}]`,
  );
}

/** C5 — no rule ids means no statement at all, and an empty read rather than a throw. */
export async function assertNoIdsIssuesNoStatement(): Promise<void> {
  const { db, statements } = fakeDb(() => []);

  const read = await loadEnabledChannelsForRules(db, []);

  assert(statements() === 0, `C5: no ids must issue no statement, got ${statements()}`);
  assert(
    read.byRule.size === 0 && read.unread.size === 0 && read.reasons.length === 0,
    `C5: no ids must give an empty read, got ${read.byRule.size}/${read.unread.size}/${read.reasons.length}`,
  );
}

/** C6 — the batch size is inside the bind limit it exists for. */
export function assertTheBatchFitsTheBindLimit(): void {
  const pessimal = RULE_CHANNEL_BATCH_SIZE + 1;
  assert(
    pessimal < 65_535,
    `C6: one rule id per parameter plus the enabled literal is ${pessimal} binds, ` +
      `which must stay under the extended protocol's 65535`,
  );
}

/**
 * C7 — a rule whose batch returned but that joins no enabled channel has no
 * entry, and is not unread.
 *
 * The two halves are one claim: an absent group means "read it, nothing joined"
 * and only `unread` means "never read". A read that pre-filled an empty group
 * per requested id would make `unread` unreadable at the caller, and a read
 * that marked a quiet rule unread would stop its alarms being decided for ever.
 */
export async function assertARuleWithNoEnabledJoinHasNoEntryAndIsNotUnread(): Promise<void> {
  const { db } = fakeDb(() => [row("rule-1", "A")]);

  const read = await loadEnabledChannelsForRules(db, ["rule-1", "rule-2"]);

  assert(
    read.byRule.has("rule-1") && !read.byRule.has("rule-2") && !read.unread.has("rule-2"),
    `C7: a rule with no enabled join must have no entry and not be unread, ` +
      `got entry=${read.byRule.has("rule-2")} unread=${read.unread.has("rule-2")}`,
  );
}
