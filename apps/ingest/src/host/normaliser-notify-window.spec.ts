import { NOTIFY_LIVE_WINDOW_MS } from "@bms/shared/ingest";

import { assert, makeFakeClient } from "./normaliser.spec.js";
import { writeResolved, type PointValueRow } from "./normaliser.js";

/**
 * `E7.2` / ADR 0123 decision 10 — `writeResolved` notifies only the rows inside
 * the live window, keyed on each row's own `time`.
 *
 * Every row is written; only a row whose `time` is no more than `liveWindowMs`
 * before `now()` is announced on `bms_telemetry`. The rule is the row's time,
 * not the path that wrote it, so an `F1.10` replay and an edge backlog both
 * land in history without raising a live alarm (ADR 0016 Amendment 9).
 *
 * Assertions live here; `normaliser-notify-window.test.ts` is the vitest entry
 * point (ADR 0014). One exported function per claim, so a mutation reddens the
 * `it()` that owns it. Every function is async and the wrapper awaits it — an
 * assertion in a floating promise reports as a pass.
 */

const NOW = new Date("2026-11-10T09:00:00.000Z");
const OPTIONS = { now: () => NOW, liveWindowMs: NOTIFY_LIVE_WINDOW_MS };

function rowAt(ageMs: number, assetId = "asset-a"): PointValueRow {
  return {
    time: new Date(NOW.getTime() - ageMs),
    assetId,
    pointKey: "FLOW_RATE",
    value: 1,
    unit: "m³/h",
    deviceTime: null,
  };
}

const LIVE_AGE_MS = 4 * 60_000 + 59_000;
const LATE_AGE_MS = 5 * 60_000 + 1_000;

type Call = { text: string; values?: readonly unknown[] };

/** Every reading announced across the notifications, as `assetId` strings. */
function notifiedAssets(calls: readonly Call[]): string[] {
  return calls
    .filter((c) => c.text.includes("pg_notify"))
    .flatMap((c) => (JSON.parse(String(c.values?.[1])) as { readings: { assetId: string }[] }).readings)
    .map((r) => r.assetId);
}

/** Rows bound across every upsert statement — six parameters per row. */
function upsertedRowCount(calls: readonly Call[]): number {
  return calls
    .filter((c) => c.text.startsWith("INSERT INTO telemetry.point_values"))
    .reduce((n, c) => n + (c.values?.length ?? 0) / 6, 0);
}

/** A row 4 m 59 s old is inside the five-minute window and is notified. */
export async function aRowJustInsideTheWindowIsNotified(): Promise<void> {
  const { client, calls } = makeFakeClient();
  const result = await writeResolved(client, [rowAt(LIVE_AGE_MS)], OPTIONS);
  assert(
    notifiedAssets(calls).join(",") === "asset-a",
    `a row 4 m 59 s old must be notified, got [${notifiedAssets(calls).join(",")}]`,
  );
  assert(result.notificationsSent === 1, `one notification, got ${result.notificationsSent}`);
}

/** A row 5 m 01 s old is written and not notified. */
export async function aRowJustOutsideTheWindowIsWrittenNotNotified(): Promise<void> {
  const { client, calls } = makeFakeClient();
  const result = await writeResolved(client, [rowAt(LATE_AGE_MS)], OPTIONS);
  assert(upsertedRowCount(calls) === 1, `the late row must still be upserted, got ${upsertedRowCount(calls)}`);
  assert(result.rowsWritten === 1, `the late row is counted as written, got ${result.rowsWritten}`);
  assert(
    notifiedAssets(calls).length === 0,
    `a row 5 m 01 s old must not be notified (ADR 0123 decision 10), got [${notifiedAssets(calls).join(",")}]`,
  );
}

/** A mixed batch upserts every row and notifies only the live ones. */
export async function aMixedBatchUpsertsAllAndNotifiesOnlyLiveRows(): Promise<void> {
  const rows = [
    rowAt(LATE_AGE_MS, "late-1"),
    rowAt(10_000, "live-1"),
    rowAt(3 * 3_600_000, "late-2"),
    rowAt(LIVE_AGE_MS, "live-2"),
  ];
  const { client, calls } = makeFakeClient();
  const result = await writeResolved(client, rows, OPTIONS);
  assert(
    upsertedRowCount(calls) === 4,
    `every row is upserted, late or live — the window gates the notification, never the write; got ${upsertedRowCount(calls)}`,
  );
  assert(result.rowsWritten === 4, `rowsWritten covers the whole batch, got ${result.rowsWritten}`);
  assert(
    notifiedAssets(calls).join(",") === "live-1,live-2",
    `only the live rows are announced, in order; got [${notifiedAssets(calls).join(",")}]`,
  );
}

/** An all-late batch commits and sends no `pg_notify` at all. */
export async function anAllLateBatchCommitsAndSendsNoNotify(): Promise<void> {
  const { client, calls } = makeFakeClient();
  const result = await writeResolved(client, [rowAt(LATE_AGE_MS), rowAt(86_400_000, "asset-b")], OPTIONS);
  assert(calls.some((c) => c.text === "COMMIT"), "an all-late batch still commits");
  assert(
    !calls.some((c) => c.text.includes("pg_notify")),
    "an all-late batch sends no pg_notify — not even an empty readings payload",
  );
  assert(result.notificationsSent === 0, `no notification is reported, got ${result.notificationsSent}`);
}

/** A row 30 s ahead of `now` (an edge clock running fast) is notified. */
export async function aRowAheadOfNowIsNotified(): Promise<void> {
  const { client, calls } = makeFakeClient();
  await writeResolved(client, [rowAt(-30_000)], OPTIONS);
  assert(
    notifiedAssets(calls).join(",") === "asset-a",
    `a row 30 s in the future is live, not late; got [${notifiedAssets(calls).join(",")}]`,
  );
}

/** `rowsNotNotified` is the count of written rows the window held back. */
export async function rowsNotNotifiedIsTheCount(): Promise<void> {
  const rows = [rowAt(LATE_AGE_MS, "a"), rowAt(0, "b"), rowAt(LATE_AGE_MS * 2, "c"), rowAt(LATE_AGE_MS * 3, "d")];
  const { client } = makeFakeClient();
  const result = await writeResolved(client, rows, OPTIONS);
  assert(result.rowsNotNotified === 3, `three rows were held back, got ${result.rowsNotNotified}`);

  const live = makeFakeClient();
  const allLive = await writeResolved(live.client, [rowAt(0)], OPTIONS);
  assert(allLive.rowsNotNotified === 0, `an all-live batch holds nothing back, got ${allLive.rowsNotNotified}`);

  const empty = makeFakeClient();
  const none = await writeResolved(empty.client, [], OPTIONS);
  assert(none.rowsNotNotified === 0, `an empty batch holds nothing back, got ${none.rowsNotNotified}`);
}

/** A row exactly `liveWindowMs` old is inside the window: the bound is inclusive. */
export async function aRowExactlyAtTheWindowIsNotified(): Promise<void> {
  const { client, calls } = makeFakeClient();
  await writeResolved(client, [rowAt(NOTIFY_LIVE_WINDOW_MS)], OPTIONS);
  assert(
    notifiedAssets(calls).join(",") === "asset-a",
    "a row exactly liveWindowMs old must be notified (the bound is inclusive, as in the API)",
  );
}

/**
 * A window outside the bounds is refused before anything is written. Without
 * this a caller passing 0, a negative number or NaN writes every row and
 * notifies none, which is the deleted `INGEST_NOTIFY` switch again.
 */
export async function aWindowOutsideTheBoundsIsRefused(): Promise<void> {
  for (const liveWindowMs of [0, -1, Number.NaN, 59_999, 900_001]) {
    const { client, calls } = makeFakeClient();
    let threw = false;
    try {
      await writeResolved(client, [rowAt(0)], { now: () => NOW, liveWindowMs });
    } catch {
      threw = true;
    }
    assert(threw, `liveWindowMs ${liveWindowMs} must be refused`);
    assert(calls.length === 0, `liveWindowMs ${liveWindowMs} must be refused before any query`);
  }
}
