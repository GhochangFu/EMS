import {
  notificationDeliveriesResponseSchema,
  pointAggregateBucketSchema,
  pointAggregateResponseSchema,
  pointAggregateStatsSchema,
} from "./envelopes";
import { notificationDeliveryStatusSchema } from "./notifications";

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
