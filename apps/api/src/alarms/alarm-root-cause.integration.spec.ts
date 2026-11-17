import { NotFoundException } from "@nestjs/common";
import { is, sql, TransactionRollbackError, type SQL } from "drizzle-orm";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import { alarmRootCauseSuggestionsResponseSchema, type AlarmRootCauseSuggestionsResponse } from "@bms/shared";

import { withTenant, type BmsTx } from "../database/tenant-context";
import { AlarmDetailsService } from "./alarm-details.service";
import {
  pastRootCausesStatement,
  readCoveringWindows,
  readLocationAncestorIds,
  readPastRootCauses,
  readRelatedAlarms,
  readSubjectAsset,
  relatedAlarmsStatement,
} from "./alarm-root-cause.reads";
import { AlarmRootCauseService } from "./alarm-root-cause.service";

/**
 * `E2.3` / ADR 0136 (plan §6 T1.7) — the root-cause suggestions against a real
 * database: the rules on real rows, their exact boundaries, the two controls on
 * a cross-tenant read (the hand-written predicates on the BYPASSRLS fleet pool,
 * the `bms_tenant` policy through the service), the 404 shared with `/details`,
 * and decision 3's zero weight. The lifecycle and the fixtures are the sibling
 * `.test.ts`'s (ADR 0014). All data is synthetic.
 */

export const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString();

export type OrgFixture = {
  readonly tag: "A" | "B";
  readonly organizationId: string;
  readonly locations: Readonly<Record<"site" | "building" | "room" | "roomB" | "roomC" | "roomD" | "roomE", string>>;
  readonly rtuId: string;
  readonly rtuName: string;
  readonly assets: Readonly<Record<"a1" | "a2" | "a3" | "a4" | "a5" | "a6" | "a7" | "a8", string>>;
  readonly rules: Readonly<Record<"s1" | "other" | "s2" | "s5", string>>;
  readonly windows: Readonly<Record<"w1" | "w2" | "w3" | "w4" | "w5" | "w6" | "w7" | "w8", string>>;
  readonly alarms: Readonly<
    Record<
      | "s1" | "c40" | "c60" | "c61" | "la2" | "la1Other" | "na3" | "na4" | "n31" | "b30" | "b30s" | "same" | "reraise"
      | "s2" | "p1" | "p2" | "p179" | "p3" | "p181" | "pSame" | "pBlank"
      | "s3" | "s4" | "onA4" | "onA6" | "s5" | "s5Rtu",
      string
    >
  >;
  readonly classCause: string;
  readonly templateName: string;
  readonly texts: { readonly dryBearing: string; readonly looseCoupling: string };
};

export type RootCauseFixtures = {
  readonly svc: AlarmRootCauseService;
  readonly details: AlarmDetailsService;
  readonly fleetDb: BmsDb;
  readonly tenantDb: BmsDb;
  readonly superuserDb: BmsDb;
  readonly a: OrgFixture;
  readonly b: OrgFixture;
  readonly poison: { readonly alarmId: string; readonly causeAlarmId: string };
  /** `T` of S1 and S2 in epoch ms, with the fixture's microsecond fraction. */
  readonly t1Ms: number;
  readonly t2Ms: number;
  readonly now: Date;
  readonly readable: { readonly locationAdmin: string[] | null };
  readonly plantAnomalies: (opts: {
    organizationId: string;
    assetId: string;
    startedMs: number;
    scores: ReadonlyArray<readonly [number, "baseline_mad" | "isolation_forest", number, readonly string[]]>;
  }) => Promise<string>;
};

const shape = (answer: AlarmRootCauseSuggestionsResponse): string[][] =>
  answer.candidates.map((c) => [c.rule, c.strength]);
const evidenceAlarmIds = (answer: AlarmRootCauseSuggestionsResponse, index: number): (string | null)[] =>
  answer.candidates[index]!.evidence.map((e) => e.alarmId);
const sorted = (ids: readonly string[]): string[] => [...ids].sort();

const s1Args = (org: OrgFixture, raisedMs: number) => ({
  organizationId: org.organizationId,
  alarmId: org.alarms.s1,
  assetId: org.assets.a1,
  ruleId: org.rules.s1,
  rtuId: org.rtuId,
  locationId: org.locations.room,
  raisedMs,
  assetIds: null,
});
const s2Args = (org: OrgFixture, raisedMs: number) => ({
  organizationId: org.organizationId,
  alarmId: org.alarms.s2,
  assetId: org.assets.a5,
  ruleId: org.rules.s2,
  raisedMs,
});

/** The plan's stop rule: if one grant is missing, stop — no grant may be added. */
export async function assertTheTenantRoleHoldsTheGrants(ctx: RootCauseFixtures): Promise<void> {
  const tables = [
    "bms.alarms",
    "bms.alarm_enrichments",
    "bms.maintenance_windows",
    "bms.maintenance_window_targets",
    "bms.assets",
    "bms.rtus",
    "bms.locations",
    "ml.anomaly_scores",
    "ml.model_runs",
  ];
  for (const table of tables) {
    const { rows } = await ctx.fleetDb.execute<{ ok: boolean }>(
      sql`SELECT has_table_privilege('bms_tenant', ${table}, 'SELECT') AS ok`,
    );
    expect(rows[0]?.ok, `bms_tenant lacks SELECT on ${table}: STOP, no grant may be added (plan §2.4)`).toBe(true);
  }
  await withTenant(ctx.tenantDb, ctx.a.organizationId, async (tx) => {
    const { rows } = await tx.execute<{ who: string; bypass: boolean }>(
      sql`SELECT current_user AS who, r.rolbypassrls AS bypass FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(rows[0]).toEqual({ who: "bms_tenant", bypass: false });
  });
}

/** S1: two strong candidates and the linked one; the maintenance evidence is the two right windows. */
export async function assertS1MaintenanceCommsAndLinked(ctx: RootCauseFixtures): Promise<void> {
  const { a } = ctx;
  const t1 = Math.floor(ctx.t1Ms);
  const answer = await ctx.svc.get(a.alarms.s1, null, ctx.now);
  expect(shape(answer)).toEqual([
    ["maintenance", "strong"],
    ["rtu_comms", "strong"],
    ["linked_alarm", "moderate"],
  ]);
  const [maintenance, comms, linked] = answer.candidates;
  expect(maintenance!.title).toBe("Maintenance on this asset");
  expect(maintenance!.evidence.map((e) => [e.kind, e.at, e.endedAt])).toEqual([
    ["maintenance_window", iso(t1 - 120 * MIN), iso(t1 - 20 * MIN)],
    ["maintenance_window", iso(t1 - 180 * MIN), iso(t1 + 120 * MIN)],
  ]);
  expect(comms!.title).toBe(`Communication or power loss at RTU ${a.rtuName}`);
  expect(evidenceAlarmIds(answer, 1)).toEqual([a.alarms.c40, a.alarms.c60]);
  expect(comms!.evidence[0]).toMatchObject({ kind: "rtu_comms_alarm", at: iso(t1 - 40 * MIN), endedAt: iso(t1 - 39 * MIN) });
  // Newest first: the same-instant alarm (R-f), a2 at 10, a1's other rule at 29, a2 at exactly 30.
  expect(evidenceAlarmIds(answer, 2)).toEqual([a.alarms.same, a.alarms.la2, a.alarms.la1Other, a.alarms.b30]);
  expect(linked!.title).toBe(`Linked to "E23-A a2 at the same instant"`);
  expect(linked!.evidence[1]).toMatchObject({
    kind: "alarm",
    assetId: a.assets.a2,
    assetRtuName: a.rtuName,
    assetLocationName: "E23-A location room",
    label: "E23-A neighbour on a2",
  });
  expect(JSON.stringify(answer)).not.toContain(a.alarms.reraise);
}

/** The reads on a tenant transaction, at their exact boundaries; `T` keeps its microseconds. */
export async function assertBoundariesThroughTheReads(ctx: RootCauseFixtures): Promise<void> {
  const { a } = ctx;
  await withTenant(ctx.tenantDb, a.organizationId, async (tx) => {
    const subject = await readSubjectAsset(tx, a.organizationId, a.alarms.s1, a.assets.a1);
    expect(subject).not.toBeNull();
    expect(Math.abs(subject!.raisedMs - ctx.t1Ms)).toBeLessThan(0.001);
    expect(Number.isInteger(subject!.raisedMs), "the fixture's T must carry a sub-millisecond fraction").toBe(false);
    expect(subject).toMatchObject({ rtuId: a.rtuId, rtuName: a.rtuName, locationId: a.locations.room });

    const related = (await readRelatedAlarms(tx, s1Args(a, subject!.raisedMs))).map((r) => r.id);
    // In: R2 at 40 and at exactly 60 min; R3 at exactly 30 min and at T itself. Out: the re-raise of
    // S1's rule on a1 (R4's population, dropped before the cap), 30 min + 1 s, 31 min, R2 at 61 min,
    // other locations, S1 itself.
    expect(sorted(related)).toEqual(
      sorted([a.alarms.c40, a.alarms.c60, a.alarms.la2, a.alarms.la1Other, a.alarms.b30, a.alarms.same]),
    );

    // R1: an asset target or one on an ancestor-or-self location, overlapping [T − 60 min, T]. Out:
    // ending exactly at T − 60 min, the sibling room's window (w7), and the one cancelled before it began (w8).
    const ancestors = await readLocationAncestorIds(tx, a.organizationId, a.locations.room);
    expect(sorted(ancestors)).toEqual(sorted([a.locations.room, a.locations.building, a.locations.site]));
    const windows = (await readCoveringWindows(tx, a.organizationId, a.assets.a1, ancestors, subject!.raisedMs)).map((w) => w.id);
    expect(sorted(windows)).toEqual(sorted([a.windows.w1, a.windows.w2]));

    const s2 = await readSubjectAsset(tx, a.organizationId, a.alarms.s2, a.assets.a5);
    const past = await readPastRootCauses(tx, s2Args(a, s2!.raisedMs));
    // 179 days in, 181 out; T itself out (strictly before); a blank text out.
    expect(sorted(past.map((p) => p.alarmId))).toEqual(sorted([a.alarms.p1, a.alarms.p2, a.alarms.p179, a.alarms.p3]));
  });
}

/** S2: two R4 groups by trimmed, case-folded text, then the class cause. */
export async function assertS2RecordedBeforeAndClassCause(ctx: RootCauseFixtures): Promise<void> {
  const { a } = ctx;
  const answer = await ctx.svc.get(a.alarms.s2, null, ctx.now);
  expect(shape(answer)).toEqual([
    ["recorded_before", "moderate"],
    ["recorded_before", "weak"],
    ["class_cause", "weak"],
  ]);
  const [grouped, single, classCause] = answer.candidates;
  expect(grouped).toMatchObject({ quote: a.texts.dryBearing, occurrences: 3 });
  expect(evidenceAlarmIds(answer, 0)).toEqual([a.alarms.p1, a.alarms.p2, a.alarms.p179]);
  expect(grouped!.evidence[0]).toMatchObject({ kind: "enrichment", at: iso(Math.floor(ctx.t2Ms) - DAY) });
  expect(single).toMatchObject({ quote: a.texts.looseCoupling, occurrences: 1 });
  expect(evidenceAlarmIds(answer, 1)).toEqual([a.alarms.p3]);
  expect(classCause).toMatchObject({ quote: a.classCause, occurrences: null });
  expect(classCause!.evidence).toEqual([expect.objectContaining({ kind: "class_philosophy", label: `${a.templateName} v1` })]);
  expect(answer.context).toEqual([]);
}

export async function assertS3HasNothing(ctx: RootCauseFixtures): Promise<void> {
  const answer = await ctx.svc.get(ctx.a.alarms.s3, null, ctx.now);
  expect(answer).toEqual({ computedAt: ctx.now.toISOString(), candidates: [], context: [] });
}

/** `$rtu` null: `= NULL` is never true, so an RTU-less subject links only by its own location (R3b). */
export async function assertS4RtulessLinksByLocationOnly(ctx: RootCauseFixtures): Promise<void> {
  const { a } = ctx;
  const answer = await ctx.svc.get(a.alarms.s4, null, ctx.now);
  expect(shape(answer)).toEqual([["linked_alarm_location", "weak"]]);
  expect(evidenceAlarmIds(answer, 0)).toEqual([a.alarms.onA6]);
  expect(JSON.stringify(answer)).not.toContain(a.alarms.onA4);
}

/** On the fleet pool (BYPASSRLS) the hand-written predicates alone leave both POISON rows out. */
export async function assertTheFleetReadsKeepBothPoisonRowsOut(ctx: RootCauseFixtures): Promise<void> {
  const { a } = ctx;
  await ctx.fleetDb.transaction(async (tx) => {
    const { rows: role } = await tx.execute<{ bypass: boolean }>(
      sql`SELECT r.rolbypassrls AS bypass FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(role[0]?.bypass, "the fleet pool must bypass row security, or this proves nothing").toBe(true);
    // Positive control: both POISON rows exist and this connection sees them.
    const { rows: seen } = await tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM bms.alarms WHERE id IN (${ctx.poison.alarmId}::uuid, ${ctx.poison.causeAlarmId}::uuid)`,
    );
    expect(seen[0]?.n).toBe(2);

    const s1 = await readSubjectAsset(tx, a.organizationId, a.alarms.s1, a.assets.a1);
    const related = await readRelatedAlarms(tx, s1Args(a, s1!.raisedMs));
    expect(related.map((r) => r.id)).not.toContain(ctx.poison.alarmId);
    expect(related.map((r) => r.message)).not.toContain("POISON-ALARM");
    expect(related).toHaveLength(6);

    const s2 = await readSubjectAsset(tx, a.organizationId, a.alarms.s2, a.assets.a5);
    const past = await readPastRootCauses(tx, s2Args(a, s2!.raisedMs));
    expect(past.map((p) => p.alarmId)).not.toContain(ctx.poison.causeAlarmId);
    expect(past.map((p) => p.rootCause)).not.toContain("POISON-CAUSE");
    expect(past).toHaveLength(4);

    // The POISON alarm stamped B on A's asset is not A's subject either.
    expect(await readSubjectAsset(tx, ctx.b.organizationId, ctx.poison.alarmId, a.assets.a1)).toBeNull();
  });
}

/** Row security binds on `bms_tenant`: a statement naming B's organization under A's GUC reads nothing. */
export async function assertThePolicyBindsWithoutThePredicate(ctx: RootCauseFixtures): Promise<void> {
  const { a, b } = ctx;
  const args = { ...s1Args(a, ctx.t1Ms), organizationId: b.organizationId, rtuId: null };
  const onFleet = await ctx.fleetDb.transaction((tx) => readRelatedAlarms(tx, args));
  expect(onFleet.map((r) => r.id), "control: on the fleet pool the B-stamped POISON alarm matches").toContain(
    ctx.poison.alarmId,
  );
  const onTenant = await withTenant(ctx.tenantDb, a.organizationId, (tx) => readRelatedAlarms(tx, args));
  expect(onTenant).toEqual([]);
}

/** No answer for A holds an id or a text of B or a POISON row; B's holds nothing of A. */
export async function assertBTenantSeesNothingOfA(ctx: RootCauseFixtures): Promise<void> {
  const answersOf = async (org: OrgFixture): Promise<AlarmRootCauseSuggestionsResponse[]> => [
    await ctx.svc.get(org.alarms.s1, null, ctx.now),
    await ctx.svc.get(org.alarms.s2, null, ctx.now),
    await ctx.svc.get(org.alarms.s3, null, ctx.now),
    await ctx.svc.get(org.alarms.s4, null, ctx.now),
  ];
  const forA = await answersOf(ctx.a);
  const forB = await answersOf(ctx.b);
  // The same shapes at the same minutes, so the absence below is not an empty answer.
  expect(forB.map(shape)).toEqual(forA.map(shape));
  const idsOf = (org: OrgFixture): string[] => [...Object.values(org.alarms), ...Object.values(org.assets)];
  const textA = JSON.stringify(forA);
  const textB = JSON.stringify(forB);
  for (const id of [...idsOf(ctx.b), ctx.poison.alarmId, ctx.poison.causeAlarmId]) expect(textA).not.toContain(id);
  for (const id of [...idsOf(ctx.a), ctx.poison.alarmId, ctx.poison.causeAlarmId]) expect(textB).not.toContain(id);
  // Texts carry `E23-<tag> `, codes `-<tag>-a<n>` (the run stamp is hex, so neither can collide).
  expect(textA).not.toMatch(/E23-B |e23-b |-B-a\d|POISON/);
  expect(textB).not.toMatch(/E23-A |e23-a |-A-a\d|POISON/);
  expect(textA).toContain("E23-A");
  expect(textB).toContain("E23-B");
}

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, but the call succeeded");
}

/** The 404 is `/details`' own, for the same arguments. */
export async function assertTheNotFoundIsDetails(ctx: RootCauseFixtures): Promise<void> {
  const { a, b } = ctx;
  const locationAdmin = ctx.readable.locationAdmin;
  expect(Array.isArray(locationAdmin) && locationAdmin.length > 0, "the seeded location admin has a scope").toBe(true);
  expect(locationAdmin).not.toContain(a.assets.a1);
  for (const scope of [[b.assets.a1], [], locationAdmin]) {
    const ours = await rejection(() => ctx.svc.get(a.alarms.s1, scope, ctx.now));
    const theirs = await rejection(() => ctx.details.get(a.alarms.s1, scope));
    expect(ours).toBeInstanceOf(NotFoundException);
    expect(theirs).toBeInstanceOf(NotFoundException);
    expect((ours as NotFoundException).getResponse()).toEqual((theirs as NotFoundException).getResponse());
    expect((ours as NotFoundException).message).toBe("Alarm not found or outside your access scope");
  }
  // Control: the asset's own id opens it.
  await expect(ctx.svc.get(a.alarms.s1, [a.assets.a1], ctx.now)).resolves.toMatchObject({ candidates: expect.any(Array) });
}

/** Q4: a visible device alarm answers the empty lists, and the service opens no evidence transaction. */
export async function assertADeviceAlarmReadsNoEvidence(ctx: RootCauseFixtures): Promise<void> {
  const refusing = {
    transaction: () => {
      throw new Error("an evidence transaction was opened");
    },
    execute: () => {
      throw new Error("an evidence statement ran");
    },
  } as unknown as BmsDb;
  const guarded = new AlarmRootCauseService(ctx.details, refusing);
  const empty = { computedAt: ctx.now.toISOString(), candidates: [], context: [] };
  await expect(guarded.get(ctx.a.alarms.c40, null, ctx.now)).resolves.toEqual(empty);
  await expect(ctx.svc.get(ctx.a.alarms.c40, null, ctx.now)).resolves.toEqual(empty);
  // Control: the guard does trip on a rule alarm.
  await expect(guarded.get(ctx.a.alarms.s1, null, ctx.now)).rejects.toThrow(/evidence transaction/);
}

/** Decision 3 at the route: anomaly rows change no candidate; only the newest run at the line gives context. */
export async function assertAnomaliesHaveZeroWeight(ctx: RootCauseFixtures): Promise<void> {
  const { a, b } = ctx;
  const hour = Math.floor(ctx.t2Ms / HOUR) * HOUR;
  const sixHours = [1, 2, 3, 4, 5, 6].map((k) => hour - k * HOUR);
  const both = (score: number) =>
    sixHours.flatMap((bucket) => [
      [bucket, "baseline_mad", score, ["kw", "pf"]] as const,
      [bucket, "isolation_forest", score === 0.99 ? 1 : score, ["temp"]] as const,
    ]);
  const startedAt = (step: number): number => hour + HOUR + step * MIN;
  const base = await ctx.svc.get(a.alarms.s2, null, ctx.now);
  expect(base.candidates.length).toBeGreaterThan(0);
  expect(base.context).toEqual([]);
  const check = async (contextLength: number): Promise<AlarmRootCauseSuggestionsResponse> => {
    const answer = await ctx.svc.get(a.alarms.s2, null, ctx.now);
    expect(answer.candidates).toEqual(base.candidates);
    expect(answer.context).toHaveLength(contextLength);
    return answer;
  };

  // B's asset only: no context for A, and B's own answer does get one (control).
  await ctx.plantAnomalies({ organizationId: b.organizationId, assetId: b.assets.a5, startedMs: startedAt(1), scores: both(0.99) });
  await check(0);
  expect((await ctx.svc.get(b.alarms.s2, null, ctx.now)).context).toHaveLength(1);
  // The alarm's own hour and an hour before the window: outside R-g's window.
  await ctx.plantAnomalies({
    organizationId: a.organizationId,
    assetId: a.assets.a5,
    startedMs: startedAt(2),
    scores: [
      [hour, "baseline_mad", 1, ["kw"]],
      [hour - 7 * HOUR, "baseline_mad", 1, ["kw"]],
    ],
  });
  await check(0);
  // Just under the line.
  await ctx.plantAnomalies({ organizationId: a.organizationId, assetId: a.assets.a5, startedMs: startedAt(3), scores: both(0.989999) });
  await check(0);
  // All six hours, both detectors, at and above the line: one context item, the same candidates.
  await ctx.plantAnomalies({ organizationId: a.organizationId, assetId: a.assets.a5, startedMs: startedAt(4), scores: both(0.99) });
  const marked = await check(1);
  expect(marked.context[0]).toEqual({
    kind: "anomaly",
    from: iso(hour - 6 * HOUR),
    to: iso(hour),
    unusualHours: 6,
    detectors: ["baseline_mad", "isolation_forest"],
    contributingPoints: ["kw", "pf", "temp"],
  });
  // A newer run lowers every score: the newest run wins, no context.
  await ctx.plantAnomalies({ organizationId: a.organizationId, assetId: a.assets.a5, startedMs: startedAt(5), scores: both(0.5) });
  await check(0);
}

export async function assertEveryAnswerParses(ctx: RootCauseFixtures): Promise<void> {
  for (const org of [ctx.a, ctx.b]) {
    for (const id of [org.alarms.s1, org.alarms.s2, org.alarms.s3, org.alarms.s4, org.alarms.s5, org.alarms.c40]) {
      const answer = await ctx.svc.get(id, null, ctx.now);
      expect(alarmRootCauseSuggestionsResponseSchema.parse(answer)).toEqual(answer);
    }
  }
}

/**
 * Review finding 1: a scoped caller (`assetIds`, what `readableAssetIds` hands an asset-group or
 * location admin) never sees a related `rule` alarm on an asset outside its scope — `/details` would
 * 404 on it — while the `rtu_comms` rows on the subject asset's RTU stay (`alarmVisibleTo`).
 */
export async function assertTheRelatedAlarmsKeepTheCallersScope(ctx: RootCauseFixtures): Promise<void> {
  const { a } = ctx;
  // Same RTU, outside [a1]: la2, same and b30 are on a2.
  const sameRtuOutside = [a.alarms.la2, a.alarms.same, a.alarms.b30];
  const sameRtuTexts = ["E23-A neighbour on a2", "E23-A a2 at the same instant", "E23-A a2 at exactly 30"];
  const open = await ctx.svc.get(a.alarms.s1, null, ctx.now);
  for (const id of sameRtuOutside) expect(JSON.stringify(open), "control: the admin sees it").toContain(id);
  for (const id of sameRtuOutside) await expect(ctx.details.get(id, [a.assets.a1])).rejects.toBeInstanceOf(NotFoundException);

  const scoped = await ctx.svc.get(a.alarms.s1, [a.assets.a1], ctx.now);
  expect(shape(scoped)).toEqual([
    ["maintenance", "strong"],
    ["rtu_comms", "strong"],
    ["linked_alarm", "moderate"],
  ]);
  expect(evidenceAlarmIds(scoped, 1)).toEqual([a.alarms.c40, a.alarms.c60]);
  expect(evidenceAlarmIds(scoped, 2)).toEqual([a.alarms.la1Other]);
  const scopedText = JSON.stringify(scoped);
  for (const id of [...sameRtuOutside, a.assets.a2]) expect(scopedText).not.toContain(id);
  for (const text of sameRtuTexts) expect(scopedText).not.toContain(text);
  // Control: a scope that holds a2 gets them back.
  expect(evidenceAlarmIds(await ctx.svc.get(a.alarms.s1, [a.assets.a1, a.assets.a2], ctx.now), 2)).toEqual(
    evidenceAlarmIds(open, 2),
  );

  // Same location only, outside [a3]: onA6 is on a6, a3's room.
  await expect(ctx.details.get(a.alarms.onA6, [a.assets.a3])).rejects.toBeInstanceOf(NotFoundException);
  const s4Scoped = await ctx.svc.get(a.alarms.s4, [a.assets.a3], ctx.now);
  expect(s4Scoped.candidates).toEqual([]);
  expect(JSON.stringify(s4Scoped)).not.toContain(a.alarms.onA6);
  expect(JSON.stringify(s4Scoped)).not.toContain("E23-A same room");
  const s4Both = await ctx.svc.get(a.alarms.s4, [a.assets.a3, a.assets.a6], ctx.now);
  expect(shape(s4Both)).toEqual([["linked_alarm_location", "weak"]]);
  expect(evidenceAlarmIds(s4Both, 0)).toEqual([a.alarms.onA6]);

  // The read itself, so the absence is SQL's and not the ranking's.
  await withTenant(ctx.tenantDb, a.organizationId, async (tx) => {
    const s1 = await readSubjectAsset(tx, a.organizationId, a.alarms.s1, a.assets.a1);
    const rows = await readRelatedAlarms(tx, { ...s1Args(a, s1!.raisedMs), assetIds: [a.assets.a1] });
    expect(sorted(rows.map((r) => r.id))).toEqual(sorted([a.alarms.c40, a.alarms.c60, a.alarms.la1Other]));
  });
}

/**
 * Review finding 3: S5 on a2 has 20 re-raises of its own rule and 21 location-only alarms on a8, all
 * newer than its one same-RTU alarm (a1, 25 min before). R3's 20 rows are its own, so it still appears.
 */
export async function assertR3KeepsItsOwnCap(ctx: RootCauseFixtures): Promise<void> {
  const { a } = ctx;
  const answer = await ctx.svc.get(a.alarms.s5, null, ctx.now);
  expect(shape(answer)).toEqual([
    ["linked_alarm", "moderate"],
    ["linked_alarm_location", "weak"],
  ]);
  expect(evidenceAlarmIds(answer, 0)).toEqual([a.alarms.s5Rtu]);
  await withTenant(ctx.tenantDb, a.organizationId, async (tx) => {
    const s5 = await readSubjectAsset(tx, a.organizationId, a.alarms.s5, a.assets.a2);
    const rows = await readRelatedAlarms(tx, {
      organizationId: a.organizationId,
      alarmId: a.alarms.s5,
      assetId: a.assets.a2,
      ruleId: a.rules.s5,
      rtuId: a.rtuId,
      locationId: a.locations.room,
      raisedMs: s5!.raisedMs,
      assetIds: null,
    });
    expect(rows.filter((r) => r.ruleId === a.rules.s5)).toEqual([]);
    expect(rows.filter((r) => r.assetId === a.assets.a8)).toHaveLength(20);
    expect(rows.map((r) => r.id)).toContain(a.alarms.s5Rtu);
    expect(rows).toHaveLength(21);
  });
}

type PlanNode = { "Node Type"?: string; "Relation Name"?: string; "Index Name"?: string; Plans?: PlanNode[] };

const alarmScans = (node: PlanNode): string[] => {
  const here = node["Relation Name"] === "alarms" ? [`${node["Node Type"]}${node["Index Name"] ? ` using ${node["Index Name"]}` : ""}`] : [];
  return [...here, ...(node.Plans ?? []).flatMap(alarmScans)];
};

async function explainAlarmScans(tx: BmsTx, statement: SQL): Promise<string[]> {
  const result = await tx.execute<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>(sql`EXPLAIN (FORMAT JSON) ${statement}`);
  const plan = result.rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
  if (!plan) throw new Error("E2.3: EXPLAIN returned no plan");
  return alarmScans(plan);
}

/**
 * Plan §2.3, a smoke check of the shipped plans (the `OFFSET 0` mutation gate is the text check in
 * `tests/e2.3-root-cause-containment.test.ts`). 20,000 synthetic alarms for A's a1 over a year,
 * `ANALYZE`d inside a rolled-back transaction, as the fleet role and as `bms_tenant` under A's GUC.
 */
export async function assertThePlansScanAlarmsOnceAndProbeThePkey(ctx: RootCauseFixtures): Promise<void> {
  const { a } = ctx;
  await ctx.superuserDb
    .transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO bms.alarms (organization_id, source, asset_id, severity, message, raised_at, cleared_at)
        SELECT ${a.organizationId}::uuid, 'rule', ${a.assets.a1}::uuid, 'warning', 'E23-A bulk',
               to_timestamp(${ctx.t1Ms}::float8 / 1000) - make_interval(mins => g * 26),
               to_timestamp(${ctx.t1Ms}::float8 / 1000) - make_interval(mins => g * 26) + interval '1 minute'
          FROM generate_series(100, 20100) AS g`);
      await tx.execute(sql`ANALYZE bms.alarms`);
      await tx.execute(sql`ANALYZE bms.alarm_enrichments`);
      const reads = [
        ["R4", pastRootCausesStatement(s2Args(a, ctx.t2Ms))],
        ["R2 + R3", relatedAlarmsStatement(s1Args(a, ctx.t1Ms))],
      ] as const;
      for (const role of ["fleet", "tenant"] as const) {
        if (role === "tenant") {
          await tx.execute(sql`SELECT set_config('app.current_organization', ${a.organizationId}, true)`);
          await tx.execute(sql.raw("SET LOCAL ROLE bms_tenant"));
        } else {
          await tx.execute(sql.raw("SET LOCAL ROLE bms_fleet"));
        }
        const r4 = await explainAlarmScans(tx, reads[0][1]);
        expect(r4.length, `${role} R4 reads bms.alarms`).toBeGreaterThan(0);
        expect(r4.filter((scan) => /Seq Scan/.test(scan)), `${role} R4: ${r4.join(", ")}`).toEqual([]);
        const related = await explainAlarmScans(tx, reads[1][1]);
        expect(related, `${role} R2 + R3 scans bms.alarms once`).toHaveLength(1);
        await tx.execute(sql.raw("RESET ROLE"));
      }
      tx.rollback();
    })
    .catch((err: unknown) => {
      if (!is(err, TransactionRollbackError)) throw err;
    });
}
