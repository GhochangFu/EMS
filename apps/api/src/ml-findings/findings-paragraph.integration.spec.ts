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
 * the ids and hashes it created. Synthetic names only.
 *
 * Fixtures (anomaly scores, all Baseline, in the last day):
 * - organization A (wc-admin's): `aMine` (wc-admin's own location, 2 unusual
 *   hours) and `aOther` (a new location, 1 hour);
 * - organization B (PHEWB): `bOne` (2 hours, the same shape as `aMine`, so the
 *   pseudonymised facts of `[bOne]` equal those of `[aMine]`) and `bTwo` (1 hour).
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

async function rowsOf(ctx: ParagraphFixtures, hash: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await ctx.superuser.query(
    "SELECT organization_id, status, reason, paragraph, provider, model, attempts FROM bms.ml_finding_paragraphs WHERE facts_hash = $1 ORDER BY organization_id",
    [hash],
  );
  return rows;
}

/** The first read is pending; after the call settles the next is ok; the row is the card's organization's, in placeholder form. */
export async function assertFirstPendingThenOkInPlaceholderForm(ctx: ParagraphFixtures): Promise<void> {
  const ids = [ctx.assets.aMine, ctx.assets.aOther];
  const { hash } = await hashOf(ctx, ids);
  const first = await ctx.svc.get("anomalies", ids, false, ctx.now());
  expect(states(first)).toEqual(["pending"]);
  await ctx.svc.settled();
  const second = mlFindingsParagraphResponseSchema.parse(await ctx.svc.get("anomalies", ids, false, ctx.now()));
  expect(states(second)).toEqual(["ok"]);
  expect(second.cards[0]!.segments).toContainEqual({ assetRef: "A1" });
  const rows = await rowsOf(ctx, hash);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ organization_id: ctx.organizations.a, status: "ok", reason: null, provider: "openrouter", model: "fake/findings-model", attempts: 1 });
  const paragraph = String(rows[0]!.paragraph);
  expect(paragraph).toMatch(/\[A1\]/);
  for (const name of ctx.names) expect(paragraph, name).not.toContain(name);
}

/** The global admin's write lands under the card's organization: `bms_tenant` under that setting reads it, under the other none. */
export async function assertAGlobalWriteLandsUnderTheCardsOrganization(ctx: ParagraphFixtures): Promise<void> {
  const { hash } = await hashOf(ctx, [ctx.assets.aMine, ctx.assets.aOther]);
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
  await ctx.svc.get("anomalies", [ctx.assets.aMine], false, ctx.now());
  await ctx.svc.settled();
  const before = ctx.calls();
  expect(states(await ctx.svc.get("anomalies", [ctx.assets.bOne], false, ctx.now())), "B is not served A's row").toEqual(["pending"]);
  await ctx.svc.settled();
  expect(ctx.calls()).toBe(before + 1);
  expect((await rowsOf(ctx, a.hash)).map((r) => r.organization_id).sort()).toEqual([ctx.organizations.a, ctx.organizations.b].sort());
}

/** The location-scoped user's facts hash differs from the admin's, and neither is served the other's paragraph. */
export async function assertTheLocationAdminHasItsOwnKey(ctx: ParagraphFixtures): Promise<void> {
  const admin = await hashOf(ctx, [ctx.assets.aMine, ctx.assets.aOther]);
  const scoped = await hashOf(ctx, [ctx.assets.aMine]);
  expect(scoped.hash).not.toBe(admin.hash);
  const body = await ctx.controller.get(ctx.users.locationAdmin, { kind: "anomalies", assetId: ctx.assets.aMine });
  expect(body.cards.map((c) => c.organizationId)).toEqual([ctx.organizations.a]);
  // An asset outside the user's scope narrows to nothing: no card, never the admin's paragraph.
  const outside = await ctx.controller.get(ctx.users.locationAdmin, { kind: "anomalies", assetId: ctx.assets.aOther });
  expect(outside.cards).toEqual([]);
}

/** The switch off: `none`, no call, no row. */
export async function assertTheSwitchOffIsNoneWithNoRow(ctx: ParagraphFixtures): Promise<void> {
  const ids = [ctx.assets.bOne, ctx.assets.bTwo];
  const { hash } = await hashOf(ctx, ids);
  const before = ctx.calls();
  await ctx.setSwitch(ctx.organizations.b, false);
  try {
    expect(states(await ctx.svc.get("anomalies", ids, false, ctx.now()))).toEqual(["none"]);
  } finally {
    await ctx.setSwitch(ctx.organizations.b, true);
  }
  await ctx.svc.settled();
  expect(ctx.calls()).toBe(before);
  expect(await rowsOf(ctx, hash)).toEqual([]);
}

/** 200 attempts today: `none`, no call. */
export async function assertTheDailyCapIsNoneWithNoCall(ctx: ParagraphFixtures): Promise<void> {
  const ids = [ctx.assets.bOne, ctx.assets.bTwo];
  const { hash } = await hashOf(ctx, ids);
  const sinceMidnight = ctx.now().getTime() - startOfUtcDay(ctx.now()).getTime();
  await ctx.plant({
    organizationId: ctx.organizations.b,
    hash: "c".repeat(63) + "1",
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
  expect(await rowsOf(ctx, hash)).toEqual([]);
  await ctx.superuser.query("DELETE FROM bms.ml_finding_paragraphs WHERE facts_hash = $1", ["c".repeat(63) + "1"]);
}

/** A `failed` row older than 30 minutes is replaced (attempts + 1 on the same UTC day); a write deletes rows over 14 days old. */
export async function assertARetryReplacesAndRetentionDeletes(ctx: ParagraphFixtures): Promise<void> {
  const ids = [ctx.assets.bTwo];
  const { hash } = await hashOf(ctx, ids);
  const age = FINDINGS_FAILED_RETRY_MS + 60_000;
  await ctx.plant({ organizationId: ctx.organizations.b, hash, status: "failed", reason: "timeout", paragraph: null, attempts: 2, ageMs: age });
  const day = 86_400_000;
  await ctx.plant({ organizationId: ctx.organizations.b, hash: "d".repeat(63) + "5", status: "failed", reason: "timeout", paragraph: null, attempts: 1, ageMs: 15 * day });
  await ctx.plant({ organizationId: ctx.organizations.b, hash: "d".repeat(63) + "3", status: "failed", reason: "timeout", paragraph: null, attempts: 1, ageMs: 13 * day });
  expect(states(await ctx.svc.get("anomalies", ids, false, ctx.now()))).toEqual(["pending"]);
  await ctx.svc.settled();
  const sameDay = startOfUtcDay(new Date(ctx.now().getTime() - age)).getTime() === startOfUtcDay(new Date()).getTime();
  expect((await rowsOf(ctx, hash)).map((r) => [r.status, r.attempts])).toEqual([["ok", sameDay ? 3 : 1]]);
  expect(await rowsOf(ctx, "d".repeat(63) + "5"), "a row 15 days old is gone").toEqual([]);
  expect(await rowsOf(ctx, "d".repeat(63) + "3"), "a row 13 days old stays").toHaveLength(1);
}
