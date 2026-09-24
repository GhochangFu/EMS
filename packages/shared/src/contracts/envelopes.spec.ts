import { expect } from "vitest";

import {
  alarmSummaryResponseSchema,
  assetListResponseSchema,
  assetListRowSchema,
  notificationDeliveriesResponseSchema,
  pointAggregateBucketSchema,
  pointAggregateResponseSchema,
  pointAggregateStatsSchema,
  pointValuesAtInstantResponseSchema,
} from "./envelopes";
// The whole module as a record, for the "old name is gone" assertion. A static
// namespace import rather than `await import("./envelopes")`: `typecheck:tests`
// runs this file under `moduleResolution: nodenext`, where a dynamic relative
// import without an extension is TS2835.
import * as envelopesModule from "./envelopes";
import {
  notificationDeliveryEventSchema,
  notificationDeliveryStatusSchema,
} from "./notifications";

/**
 * `F3.35` Stage A — the point-aggregate response contract (ADR 0048 decision 3).
 *
 * Assertions live here; `envelopes.test.ts` is the vitest entry point (ADR 0014).
 * Everything in this file is a plain object and needs no connection.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectAccepts(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === true, `${message} — expected success, got a refusal`);
}

function expectRejects(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === false, `${message} — expected a refusal, got success`);
}

const stats = {
  sum: 2_705.5,
  average: 12.1,
  min: 0,
  max: 18.4,
  peakAt: "2026-08-30T22:10:00.000Z",
  sampleCount: 1_440,
};

const response = {
  pointRef: "88888888-8888-4888-8888-888888888888:kw",
  from: "2026-08-29T00:00:00.000Z",
  to: "2026-08-30T00:00:00.000Z",
  bucketSeconds: 60,
  stats,
  compare: null,
  buckets: null,
};

/**
 * The tile's shape and the chart's shape are the same response with different
 * halves filled in. Both must parse, and neither may require the other's half.
 *
 * `compare` and `buckets` are orthogonal on purpose — compare is tile-only and
 * never carries buckets, `buckets` is chart-only and never carries a compare.
 * If either becomes required, one of the two callers breaks.
 */
export function runPointAggregateResponseShapeTests(): void {
  expectAccepts(
    pointAggregateResponseSchema,
    response,
    "the tile's shape — stats only, no compare, no buckets",
  );
  expectAccepts(
    pointAggregateResponseSchema,
    {
      ...response,
      compare: { from: "2026-08-28T00:00:00.000Z", to: "2026-08-29T00:00:00.000Z", stats },
    },
    "the tile's compare shape — a preceding window's scalar stats",
  );
  expectAccepts(
    pointAggregateResponseSchema,
    {
      ...response,
      buckets: [
        { t: "2026-08-29T00:00:00.000Z", v: 11.2 },
        { t: "2026-08-29T00:01:00.000Z", v: 11.9 },
      ],
    },
    "the chart's shape — a bucket array beside the same scalar stats",
  );
  expectAccepts(
    pointAggregateResponseSchema,
    { ...response, buckets: [] },
    "an empty bucket array must parse — a window with no data is not an error",
  );
}

/**
 * A window with no samples at all is an ordinary answer, not a failure. Every
 * statistic goes `null` together and `sampleCount` is `0`.
 *
 * This is the assertion that stops someone tightening `sum` to `z.number()`
 * because "a total is always a number". It is not: `sum(...)` over no rows is
 * SQL `NULL`, and a dead sensor is exactly when an operator looks at the tile.
 */
export function runPointAggregateEmptyWindowTests(): void {
  expectAccepts(
    pointAggregateStatsSchema,
    { sum: null, average: null, min: null, max: null, peakAt: null, sampleCount: 0 },
    "a window with no samples must parse with every statistic null",
  );
  expectAccepts(
    pointAggregateBucketSchema,
    { t: "2026-08-29T00:00:00.000Z", v: null },
    "a bucket with no samples must parse — the renderer draws a gap, not a zero",
  );
  expectRejects(
    pointAggregateStatsSchema,
    { ...stats, sampleCount: 12.5 },
    "a fractional sample count must be refused — it is a COUNT(), not a measurement",
  );
}

/**
 * A response contract, so it must tolerate a field the server adds later.
 *
 * §4.8's direction: `checkResponse` returns the original payload, so a strict
 * response schema turns every additive server change into a hard failure in dev
 * and test. No schema in this directory is strict, and this one must not become
 * the first.
 */
export function runPointAggregateIsNotStrictTests(): void {
  expectAccepts(
    pointAggregateResponseSchema,
    { ...response, level: "1m" },
    "a response contract must tolerate a field the server has added",
  );
  expectAccepts(
    pointAggregateStatsSchema,
    { ...stats, p95: 17.2 },
    "the nested stats shape must tolerate one too — strictness does not descend, " +
      "and neither should its absence be accidental",
  );
}

/**
 * `bucketSeconds` is what the granularity cell derives from, and it stands in
 * for the `AggregateLevel` this contract deliberately does not restate. A zero
 * or negative width would divide by zero in any formatter that reads it.
 */
export function runPointAggregateBucketSecondsTests(): void {
  for (const seconds of [60, 300, 3_600, 86_400]) {
    expectAccepts(
      pointAggregateResponseSchema,
      { ...response, bucketSeconds: seconds },
      `bucketSeconds ${seconds} — one of the four ADR 0023 widths — must parse`,
    );
  }
  expectRejects(
    pointAggregateResponseSchema,
    { ...response, bucketSeconds: 0 },
    "a zero bucket width must be refused",
  );
  expectRejects(
    pointAggregateResponseSchema,
    { ...response, bucketSeconds: 90.5 },
    "a fractional bucket width must be refused — the four widths are whole seconds",
  );
}

/**
 * `F3.52` — the deliveries envelope admits every status the database does.
 *
 * **This is the one gate on the web client's own Zod parse.**
 * `apps/web/src/api/notifications.ts:168` runs
 * `checkResponse(notificationDeliveriesResponseSchema, …)` on the real
 * response, so a status the envelope refuses becomes a thrown error and an
 * empty page rather than an unlabelled row. The deliveries page's jsdom test
 * cannot see that: it stubs `fetchNotificationDeliveries`, which is the
 * function that does the parsing.
 *
 * Every value is driven from `notificationDeliveryStatusSchema.options` rather
 * than from a list written here, so a seventh status added to the contract is
 * covered the day it lands instead of the day someone remembers this file.
 */
export function runNotificationDeliveryStatusEnvelopeTests(): void {
  const row = {
    id: "d1",
    organizationId: "00000000-0000-4000-8000-000000000001",
    ruleId: null,
    ruleCode: null,
    alarmId: null,
    channelId: "00000000-0000-4000-8000-0000000000c1",
    channelCode: "ops-webhook",
    status: "sent",
    attemptedAt: "2026-09-09T10:00:00.000Z",
    error: null,
    // `F3.56` — `event` is required, and this literal is untyped, so `tsc`
    // says nothing when it is missing: every `expectAccepts` below simply
    // starts failing at run time. `test` is the honest value here, because the
    // row's `ruleId` and `alarmId` are both null and that is what a send test
    // looks like (ADR 0041 Amendment 8).
    event: "test",
  };

  for (const status of notificationDeliveryStatusSchema.options) {
    expectAccepts(
      notificationDeliveriesResponseSchema,
      { items: [{ ...row, status }] },
      `status ${status} must survive the envelope the web client parses with`,
    );
  }

  // `skipped_stale` is named explicitly as well as driven from the enum: the
  // loop above passes vacuously if the enum ever loses the value, and the whole
  // point of this case is that losing it breaks the page.
  expectAccepts(
    notificationDeliveriesResponseSchema,
    { items: [{ ...row, status: "skipped_stale" }] },
    "`skipped_stale` must survive the envelope (`F3.52`)",
  );

  expectRejects(
    notificationDeliveriesResponseSchema,
    { items: [{ ...row, status: "skipped_invented" }] },
    "a status outside the contract must be refused, or the enum gates nothing",
  );
}

/**
 * The delivery row the `F3.56` event cases vary, held apart from the status
 * cases' own literal on purpose: those fix `event` and vary `status`, these fix
 * `status` and vary `event`, and one shared literal would let a mutation to
 * either axis be read as a change to the other.
 */
const deliveryEventRow = {
  id: "d1",
  organizationId: "00000000-0000-4000-8000-000000000001",
  ruleId: "00000000-0000-4000-8000-000000000011",
  ruleCode: "UPS-BATT-TEMP",
  alarmId: "00000000-0000-4000-8000-0000000000a1",
  channelId: "00000000-0000-4000-8000-0000000000c1",
  channelCode: "ops-webhook",
  status: "sent",
  attemptedAt: "2026-09-10T10:00:00.000Z",
  error: null,
  event: "raise",
};

/**
 * `F3.56` S1 — the deliveries envelope admits every event kind the contract
 * declares (ADR 0041 Amendment 8).
 *
 * The same gate `runNotificationDeliveryStatusEnvelopeTests` above is: the web
 * client runs `checkResponse(notificationDeliveriesResponseSchema, …)` on the
 * real response, so a kind the envelope refuses becomes a thrown error and an
 * empty page rather than an unlabelled row.
 *
 * The loop is driven from `notificationDeliveryEventSchema.options`, so a sixth
 * kind is covered the day it lands — **and the explicit list below is what
 * stops the loop passing vacuously.** An enum that lost `cleared` would still
 * satisfy every iteration of a loop over its own options.
 */
export function deliveryEventEnvelopeAdmitsEveryKind(): void {
  const options = notificationDeliveryEventSchema.options;

  for (const event of options) {
    expectAccepts(
      notificationDeliveriesResponseSchema,
      { items: [{ ...deliveryEventRow, event }] },
      `event ${event} must survive the envelope the web client parses with`,
    );
  }

  expect(options).toEqual(["raise", "escalation", "cleared", "test", "unknown"]);
}

/**
 * `F3.56` S2 — an invented event kind is refused.
 *
 * `retry` is not an arbitrary invalid string. It is the value open row `F3.57`
 * would add — Amendment 8 declines to mark a re-offered raise, because
 * Amendment 5 makes it byte-identical to its original — and until that row is
 * ruled on, the wire must refuse it rather than let a client ship a label the
 * server never produces.
 */
export function deliveryEventEnvelopeRefusesAnInventedKind(): void {
  expectRejects(
    notificationDeliveriesResponseSchema,
    { items: [{ ...deliveryEventRow, event: "retry" }] },
    "`retry` is F3.57's value, not this row's — the envelope must refuse it",
  );
}

/**
 * `F3.56` S3 — `event` is required on every row, not optional.
 *
 * An optional field would typecheck everywhere and go inert: `listDeliveries`
 * could stop deriving it and no consumer, no spec and no compiler would notice.
 * Required is what makes the producer's omission a parse failure.
 */
export function deliveryEventIsRequiredOnEveryRow(): void {
  const withoutEvent: Record<string, unknown> = { ...deliveryEventRow };
  delete withoutEvent.event;
  expectRejects(
    notificationDeliveriesResponseSchema,
    { items: [withoutEvent] },
    "a delivery row with no `event` must be refused — the field is required, not optional",
  );
}

const alarmSummaryRow = { code: "critical", label: "Critical", tone: "critical", rank: 30, count: 1 };

/**
 * `F3.28` — `alarmSummaryResponseSchema` carries every active severity's row,
 * including one with a zero count, plus the running `total`.
 */
export function alarmSummaryResponseAcceptsAZeroCountRow(): void {
  expectAccepts(
    alarmSummaryResponseSchema,
    { items: [alarmSummaryRow, { ...alarmSummaryRow, code: "warning", tone: "warning", rank: 20, count: 0 }], total: 1 },
    "a zero-count severity row must parse — every active severity is represented",
  );
}

/** A response with no `total` field is refused — it is required, not derived by the client. */
export function alarmSummaryResponseRequiresTotal(): void {
  expectRejects(
    alarmSummaryResponseSchema,
    { items: [alarmSummaryRow] },
    "alarmSummaryResponseSchema must require total",
  );
}

/**
 * `F3.28` — `pointValuesAtInstantResponseSchema` (ADR 0074 decision 2 / plan
 * decision 2): one item per requested ref, `time`/`value` nullable together
 * for a ref with no sample at or before `at`, and `unit` carried alongside so
 * a caller need not re-look it up.
 */
export function pointValuesAtInstantAcceptsASampledAndAnUnsampledRef(): void {
  expectAccepts(
    pointValuesAtInstantResponseSchema,
    {
      at: "2026-09-24T10:00:00.000Z",
      items: [
        { pointRef: "00000000-0000-4000-8000-000000000001:kw", time: "2026-09-24T09:58:00.000Z", value: 12.4, unit: "kW" },
        { pointRef: "00000000-0000-4000-8000-000000000002:kw", time: null, value: null, unit: null },
      ],
    },
    "a mix of a sampled ref and an unsampled ref must both parse in the same response",
  );
}

/** `time` and `value` are independently nullable in the schema — a half-null row is still refused by the producer, not the contract, but the contract must not force them to travel together. */
export function pointValuesAtInstantRequiresPointRefAndAt(): void {
  expectRejects(
    pointValuesAtInstantResponseSchema,
    { items: [] },
    "a response with no `at` must be refused",
  );
  expectRejects(
    pointValuesAtInstantResponseSchema,
    { at: "2026-09-24T10:00:00.000Z", items: [{ time: null, value: null, unit: null }] },
    "an item with no `pointRef` must be refused",
  );
}

/**
 * `F3.31` — the wired shape of `assetListRowSchema` (ADR 0068 decision 2).
 *
 * `rtuId`, `rtuDisplayName`, `telemetrySource` and `templateId` all carry a
 * real value here — the companion case below carries all four as `null`. Two
 * rows, not one with optional fields, so a schema change that makes a field
 * optional instead of nullable is caught by E3, not silently accepted here.
 */
const wiredAssetListRow = {
  id: "00000000-0000-4000-8000-000000000001",
  code: "CR-HVAC-1",
  name: "Control Room HVAC 1",
  siteName: "RSMOC Western Cape",
  domain: "hvac",
  locationId: "00000000-0000-4000-8000-000000000002",
  locationName: "Western Cape control room",
  rtuId: "00000000-0000-4000-8000-000000000003",
  rtuDisplayName: "RTU 1",
  telemetrySource: "mqtt",
  active: true,
  templateId: "00000000-0000-4000-8000-000000000004",
};

export function assetListRowAcceptsAFullyWiredRow(): void {
  expectAccepts(
    assetListRowSchema,
    wiredAssetListRow,
    "a fully wired row — every nullable field carrying a real value — must parse",
  );
}

/**
 * `F4.139`'s pre-existing shape: an asset created by hand carries no RTU, no
 * reported source and no template. All four nullable fields go `null`
 * together — never omitted, so E3 stays the case that catches "made optional".
 */
export function assetListRowAcceptsAnUnwiredRow(): void {
  expectAccepts(
    assetListRowSchema,
    {
      ...wiredAssetListRow,
      rtuId: null,
      rtuDisplayName: null,
      telemetrySource: null,
      templateId: null,
    },
    "an unwired, hand-created row — every nullable field null — must parse",
  );
}

/**
 * A required field made optional would pass every "accepts" case above by
 * simply being left off the literal — so this is the case that actually
 * exercises the boundary, one field omitted at a time.
 */
export function assetListRowRefusesAMissingRequiredField(): void {
  const withoutActive: Record<string, unknown> = { ...wiredAssetListRow };
  delete withoutActive.active;
  expectRejects(
    assetListRowSchema,
    withoutActive,
    "a row with no `active` must be refused — it is required, not optional",
  );

  const withoutLocationName: Record<string, unknown> = { ...wiredAssetListRow };
  delete withoutLocationName.locationName;
  expectRejects(
    assetListRowSchema,
    withoutLocationName,
    "a row with no `locationName` must be refused — it is required, not optional",
  );
}

/**
 * The rename left no alias: `assetPickerRowSchema` is gone from the module,
 * not merely unused (ADR 0068 decision 2, ruling 2). A `describe`/`it` running
 * the async import needs no connection — this is still a plain module check.
 */
export async function assetListResponseSchemaAndNoOldNameSurvives(): Promise<void> {
  assert(
    assetListResponseSchema.parse([wiredAssetListRow]).length === 1,
    "assetListResponseSchema must parse an array of one valid row",
  );

  const E: Record<string, unknown> = envelopesModule;
  assert(
    "assetPickerRowSchema" in E === false,
    "assetPickerRowSchema must be gone from the module, not merely unused — no alias",
  );
  assert(
    "assetPickerResponseSchema" in E === false,
    "assetPickerResponseSchema must be gone from the module too",
  );
}
