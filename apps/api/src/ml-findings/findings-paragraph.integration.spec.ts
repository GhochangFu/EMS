import { mlFindingsParagraphResponseSchema } from "@bms/shared";
import type { JwtPayload, MlFindingsParagraphResponse } from "@bms/shared";
import type pg from "pg";
import { expect } from "vitest";

import type { MlFindingsService } from "../ml/ml-findings.service";
import type { FindingsParagraphController } from "./findings-paragraph.controller";
import { FINDINGS_DAILY_ATTEMPT_CAP, FINDINGS_FAILED_RETRY_MS, type FindingsParagraphService } from "./findings-paragraph.service";
import { startOfUtcDay } from "./findings-paragraph.store";
import { pseudonymiseFacts } from "./findings-pseudonymise";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decisions 4–7 (plan T3.4) — the paragraph
 * route, its cache and its cap against a real Postgres, on the real roles: the
 * cache and the copilot switch on `bms_tenant`, the facts on `bms_tenant` /
 * `bms_fleet`, access control on `bms_auth`. The provider is a fake handed in
 * through `LlmResolver.buildProvider`; no live LLM. The wrapper
 * (`findings-paragraph.integration.test.ts`) plants every row and removes it by
 * the ids, organizations and hashes it created. Synthetic names only.
 *
 * Fixtures (anomaly scores, all Baseline, in the last day). `n` is derived from
 * the run's stamp (2–21), so the facts — and so the hashes — of two runs on one
 * database differ:
 * - organization A (wc-admin's): `aMine` (wc-admin's own location, `n` unusual
 *   hours) and `aOther` (a new location, 1 hour);
 * - organization B (PHEWB): `bOne` (`n` hours, the same shape as `aMine`, so the
 *   pseudonymised facts of `[bOne]` equal those of `[aMine]`) and `bTwo` (1 hour).
 *
 * The hash ignores names and ids by design, so every row read here is filtered
 * by organization as well as hash, and each case makes the rows it needs itself.
 */
export type ParagraphFixtures = {
  svc: FindingsParagraphService;
  facts: MlFindingsService;
  controller: FindingsParagraphController;
  superuser: pg.Pool;
  tenant: pg.Pool;
  /** How many times the fake provider has been called so far. */
  calls: () => number;
  setSwitch: (organizationId: string, on: boolean) => Promise<void>;
  /** Plants a row as the superuser and remembers its hash for the cleanup. */
  plant: (row: { organizationId: string; hash: string; status: string; reason: string | null; paragraph: string | null; attempts: number; ageMs: number }) => Promise<void>;
  remember: (hash: string) => void;
  /** A 64-hex hash unique to this run and `tag`, for planted rows. */
  runHash: (tag: string) => string;
  users: { locationAdmin: JwtPayload };
  now: () => Date;
  organizations: { a: string; b: string };
  assets: { aMine: string; aOther: string; bOne: string; bTwo: string };
  /** Every fixture name, which must never reach the table. */
  names: string[];
};

const states = (r: MlFindingsParagraphResponse): string[] => r.cards.map((c) => c.state);

async function hashOf(ctx: ParagraphFixtures, assetIds: string[]): Promise<{ organizationId: string; hash: string }> {
  const facts = await ctx.facts.anomalyFacts(assetIds, ctx.now());
  const card = facts.cards[0];
  if (!card) throw new Error("E1.9c: the fixture assets give no card");
  const p = pseudonymiseFacts("anomalies", card);
  if (!p.sendable) throw new Error("E1.9c: the fixture card is not sendable");
  ctx.remember(p.hash);
  return { organizationId: card.organizationId, hash: p.hash };
}

/** One organization's rows of one hash. */
async function rowsOf(ctx: ParagraphFixtures, organizationId: string, hash: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await ctx.superuser.query(
    `SELECT organization_id, status, reason, paragraph, provider, model, attempts FROM bms.ml_finding_paragraphs
      WHERE organization_id = $1 AND facts_hash = $2`,
    [organizationId, hash],
  );
  return rows;
}

async function forget(ctx: ParagraphFixtures, organizationId: string, hash: string): Promise<void> {
  await ctx.superuser.query("DELETE FROM bms.ml_finding_paragraphs WHERE organization_id = $1 AND facts_hash = $2", [organizationId, hash]);
}

/** Makes sure the key has an ok row: one read, the call settles. */
async function written(ctx: ParagraphFixtures, assetIds: string[]): Promise<void> {
  await ctx.svc.get("anomalies", assetIds, false, ctx.now());
  await ctx.svc.settled();
}

/** The first read is pending; after the call settles the next is ok; the row is the card's organization's, in placeholder form. */
export async function assertFirstPendingThenOkInPlaceholderForm(ctx: ParagraphFixtures): Promise<void> {
  const ids = [ctx.assets.aMine, ctx.assets.aOther];
  const { hash } = await hashOf(ctx, ids);
  await forget(ctx, ctx.organizations.a, hash);
  const first = await ctx.svc.get("anomalies", ids, false, ctx.now());
  expect(states(first)).toEqual(["pending"]);
  await ctx.svc.settled();
  const second = mlFindingsParagraphResponseSchema.parse(await ctx.svc.get("anomalies", ids, false, ctx.now()));
  expect(states(second)).toEqual(["ok"]);
  expect(second.cards[0]!.segments).toContainEqual({ assetRef: "A1" });
  expect(second.cards[0]!.assets.map((a) => a.assetId)).toEqual([ctx.assets.aMine]);
  const rows = await rowsOf(ctx, ctx.organizations.a, hash);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "ok", reason: null, provider: "openrouter", model: "fake/findings-model", attempts: 1 });
  const paragraph = String(rows[0]!.paragraph);
  expect(paragraph).toMatch(/\[A1\]/);
  for (const name of ctx.names) expect(paragraph, name).not.toContain(name);
}

/** The global admin's write lands under the card's organization: `bms_tenant` under that setting reads it, under the other none. */
export async function assertAGlobalWriteLandsUnderTheCardsOrganization(ctx: ParagraphFixtures): Promise<void> {
  const ids = [ctx.assets.aMine, ctx.assets.aOther];
  const { hash } = await hashOf(ctx, ids);
  // B's [bOne, bTwo] has the same facts as A's [aMine, aOther]; no case writes it, and this one clears it.
  await forget(ctx, ctx.organizations.b, hash);
  await written(ctx, ids);
  const read = async (organizationId: string): Promise<number> => {
    const client = await ctx.tenant.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_organization', $1, true)", [organizationId]);
      const { rows } = await client.query("SELECT 1 FROM bms.ml_finding_paragraphs WHERE facts_hash = $1", [hash]);
      await client.query("ROLLBACK");
      return rows.length;
    } finally {
      client.release();
    }
  };
  expect(await read(ctx.organizations.a)).toBe(1);
  expect(await read(ctx.organizations.b)).toBe(0);
}

/** A's cached paragraph is never served for B: the same facts in B make B's own call and B's own row. */
export async function assertTheSameFactsInTwoOrganizationsAreTwoRows(ctx: ParagraphFixtures): Promise<void> {
  const a = await hashOf(ctx, [ctx.assets.aMine]);
  const b = await hashOf(ctx, [ctx.assets.bOne]);
  expect(b.hash, "the fixture makes the two facts equal").toBe(a.hash);
  await forget(ctx, ctx.organizations.b, b.hash);
  await written(ctx, [ctx.assets.aMine]);
  expect(await rowsOf(ctx, ctx.organizations.a, a.hash)).toHaveLength(1);
  const before = ctx.calls();
  expect(states(await ctx.svc.get("anomalies", [ctx.assets.bOne], false, ctx.now())), "B is not served A's row").toEqual(["pending"]);
  await ctx.svc.settled();
  expect(ctx.calls()).toBe(before + 1);
  expect(await rowsOf(ctx, ctx.organizations.b, b.hash)).toHaveLength(1);
  expect(await rowsOf(ctx, ctx.organizations.a, a.hash)).toHaveLength(1);
}

/** The location-scoped user has its own key: its first read is pending even with the admin's paragraph cached, then ok with its own assets. */
export async function assertTheLocationAdminHasItsOwnKey(ctx: ParagraphFixtures): Promise<void> {
  const adminIds = [ctx.assets.aMine, ctx.assets.aOther];
  const admin = await hashOf(ctx, adminIds);
  const scoped = await hashOf(ctx, [ctx.assets.aMine]);
  expect(scoped.hash).not.toBe(admin.hash);
  await written(ctx, adminIds);
  expect(states(await ctx.svc.get("anomalies", adminIds, false, ctx.now()))).toEqual(["ok"]);
  await forget(ctx, ctx.organizations.a, scoped.hash);
  const query = { kind: "anomalies", assetId: ctx.assets.aMine };
  const first = await ctx.controller.get(ctx.users.locationAdmin, query);
  expect(first.cards.map((c) => [c.organizationId, c.state])).toEqual([[ctx.organizations.a, "pending"]]);
  await ctx.svc.settled();
  const second = mlFindingsParagraphResponseSchema.parse(await ctx.controller.get(ctx.users.locationAdmin, query));
  expect(states(second)).toEqual(["ok"]);
  expect(second.cards[0]!.assets.map((a) => a.assetId)).toEqual([ctx.assets.aMine]);
  // An asset outside the user's scope narrows to nothing: no card, never the admin's paragraph.
  const outside = await ctx.controller.get(ctx.users.locationAdmin, { kind: "anomalies", assetId: ctx.assets.aOther });
  expect(outside.cards).toEqual([]);
}

/** The switch off: `none`, no call, no row — and a cached paragraph of that organization is not served either. */
export async function assertTheSwitchOffIsNoneWithNoRow(ctx: ParagraphFixtures): Promise<void> {
  const ids = [ctx.assets.bOne, ctx.assets.bTwo];
  const { hash } = await hashOf(ctx, ids);
  await forget(ctx, ctx.organizations.b, hash);
  await written(ctx, [ctx.assets.bOne]);
  const before = ctx.calls();
  await ctx.setSwitch(ctx.organizations.b, false);
  try {
    expect(states(await ctx.svc.get("anomalies", ids, false, ctx.now()))).toEqual(["none"]);
    expect(states(await ctx.svc.get("anomalies", [ctx.assets.bOne], false, ctx.now())), "the cached ok row is not served").toEqual(["none"]);
  } finally {
    await ctx.setSwitch(ctx.organizations.b, true);
  }
  await ctx.svc.settled();
  expect(ctx.calls()).toBe(before);
  expect(await rowsOf(ctx, ctx.organizations.b, hash)).toEqual([]);
}

/** 200 attempts today: `none`, no call. */
export async function assertTheDailyCapIsNoneWithNoCall(ctx: ParagraphFixtures): Promise<void> {
  const ids = [ctx.assets.bOne, ctx.assets.bTwo];
  const { hash } = await hashOf(ctx, ids);
  await forget(ctx, ctx.organizations.b, hash);
  const capHash = ctx.runHash("cap");
  const sinceMidnight = ctx.now().getTime() - startOfUtcDay(ctx.now()).getTime();
  try {
    await ctx.plant({
      organizationId: ctx.organizations.b,
      hash: capHash,
      status: "failed",
      reason: "timeout",
      paragraph: null,
      attempts: FINDINGS_DAILY_ATTEMPT_CAP,
      ageMs: Math.min(60_000, sinceMidnight),
    });
    const before = ctx.calls();
    expect(states(await ctx.svc.get("anomalies", ids, false, ctx.now()))).toEqual(["none"]);
    await ctx.svc.settled();
    expect(ctx.calls()).toBe(before);
    expect(await rowsOf(ctx, ctx.organizations.b, hash)).toEqual([]);
  } finally {
    await forget(ctx, ctx.organizations.b, capHash);
  }
}

/** A `failed` row older than 30 minutes is replaced (attempts + 1 on the same UTC day); a write deletes rows over 14 days old. */
export async function assertARetryReplacesAndRetentionDeletes(ctx: ParagraphFixtures): Promise<void> {
  const ids = [ctx.assets.bTwo];
  const { hash } = await hashOf(ctx, ids);
  await forget(ctx, ctx.organizations.b, hash);
  const age = FINDINGS_FAILED_RETRY_MS + 60_000;
  const day = 86_400_000;
  const old = ctx.runHash("15-days");
  const young = ctx.runHash("13-days");
  await ctx.plant({ organizationId: ctx.organizations.b, hash, status: "failed", reason: "timeout", paragraph: null, attempts: 2, ageMs: age });
  await ctx.plant({ organizationId: ctx.organizations.b, hash: old, status: "failed", reason: "timeout", paragraph: null, attempts: 1, ageMs: 15 * day });
  await ctx.plant({ organizationId: ctx.organizations.b, hash: young, status: "failed", reason: "timeout", paragraph: null, attempts: 1, ageMs: 13 * day });
  expect(states(await ctx.svc.get("anomalies", ids, false, ctx.now()))).toEqual(["pending"]);
  await ctx.svc.settled();
  const sameDay = startOfUtcDay(new Date(ctx.now().getTime() - age)).getTime() === startOfUtcDay(new Date()).getTime();
  expect((await rowsOf(ctx, ctx.organizations.b, hash)).map((r) => [r.status, r.attempts])).toEqual([["ok", sameDay ? 3 : 1]]);
  expect(await rowsOf(ctx, ctx.organizations.b, old), "a row 15 days old is gone").toEqual([]);
  expect(await rowsOf(ctx, ctx.organizations.b, young), "a row 13 days old stays").toHaveLength(1);
}
