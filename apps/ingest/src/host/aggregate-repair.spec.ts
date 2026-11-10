import { createHostLogger } from "./logger.js";
import { assert } from "./normaliser.spec.js";
import {
  CLEAR_DIRTY_WINDOW,
  createAggregateRepair,
  createRepairStore,
  type DirtyWindow,
  type RepairStore,
} from "./aggregate-repair.js";

/**
 * `E7.2` / ADR 0123 decision 11, plan T3.4 — the repair pass with the refresh
 * injected and a fake store that implements compare-and-clear.
 *
 * Assertions live here; `aggregate-repair.test.ts` is the vitest entry point
 * (ADR 0014). The real `refreshAggregatesFrom` case is owed with the `@bms/db`
 * dependency (plan P8); the store's SQL is `aggregate-repair.integration.spec.ts`'s.
 */

const T0 = new Date("2026-11-10T09:00:00.000Z");

function windowOf(gatewayId: string, fromIso: string, toIso: string, seqKey = "1"): DirtyWindow {
  return { gatewayId, from: new Date(fromIso), to: new Date(toIso), fromKey: fromIso, toKey: toIso, seqKey };
}

/** A fake store: one window per gateway, cleared only when the bounds and the generation still match. */
function fakeStore(initial: readonly DirtyWindow[]): RepairStore & {
  readonly windows: Map<string, DirtyWindow>;
  clears: number;
} {
  const windows = new Map(initial.map((w) => [w.gatewayId, w]));
  const store = {
    windows,
    clears: 0,
    async listDirty() {
      return [...windows.values()];
    },
    async clear(window: DirtyWindow) {
      store.clears += 1;
      const current = windows.get(window.gatewayId);
      if (
        current === undefined ||
        current.fromKey !== window.fromKey ||
        current.toKey !== window.toKey ||
        current.seqKey !== window.seqKey
      ) {
        return false;
      }
      windows.delete(window.gatewayId);
      return true;
    },
  };
  return store;
}

function harness(store: RepairStore, refresh: (from: Date, to: Date) => Promise<void>) {
  let now = T0;
  const lines: string[] = [];
  const repair = createAggregateRepair({
    store,
    refresh,
    now: () => now,
    logger: createHostLogger({}, (line) => lines.push(line)),
  });
  return {
    repair,
    lines,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

const W1 = windowOf("gw-1", "2026-11-10T03:00:00.000Z", "2026-11-10T05:00:00.000Z");

/** A successful refresh over the window, then the window is cleared. */
export async function aSuccessfulRefreshClearsTheWindow(): Promise<void> {
  const store = fakeStore([W1]);
  const seen: string[] = [];
  const h = harness(store, async (from, to) => {
    seen.push(`${from.toISOString()}..${to.toISOString()}`);
  });
  await h.repair.runOnce();
  assert(seen.join(";") === "2026-11-10T03:00:00.000Z..2026-11-10T05:00:00.000Z", `refreshed ${seen.join(";")}`);
  assert(!store.windows.has("gw-1"), "a refreshed window must be cleared");
  assert(h.lines.some((l) => l.includes("aggregate window repaired")), "a repair is logged");
}

/** `refresh` throws → the window stays and exactly one line is logged. */
export async function aFailedRefreshKeepsTheWindowAndLogsOnce(): Promise<void> {
  const store = fakeStore([W1]);
  const h = harness(store, async () => {
    throw Object.assign(new Error("could not obtain lock"), { code: "55P03" });
  });
  await h.repair.runOnce();
  assert(store.windows.has("gw-1"), "a failed refresh must leave the window");
  assert(store.clears === 0, "nothing may be cleared after a failed refresh");
  assert(h.lines.length === 1, `exactly one line for the failure, got ${h.lines.length}`);
  assert(h.lines[0].includes("aggregate repair failed") && h.lines[0].includes('"code":"55P03"'), "the line names the code");
  assert(!h.lines[0].includes("could not obtain lock"), "the line carries the class and code, not the message");
}

/** A window widened while the refresh ran is not cleared. */
export async function aWindowWidenedDuringTheRefreshSurvives(): Promise<void> {
  const store = fakeStore([W1]);
  const wider = windowOf("gw-1", "2026-11-10T01:00:00.000Z", "2026-11-10T05:00:00.000Z");
  const h = harness(store, async () => {
    store.windows.set("gw-1", wider);
  });
  await h.repair.runOnce();
  assert(store.windows.get("gw-1") === wider, "the widened window must survive for the next pass");
  assert(h.lines.some((l) => l.includes("kept for the next pass")), "the kept window is logged");
}

/** A late row landing inside the unchanged window during the refresh keeps the window (code review 2). */
export async function anInWindowWriteDuringTheRefreshKeepsTheWindow(): Promise<void> {
  const store = fakeStore([W1]);
  const sameBoundsNextGeneration = { ...W1, seqKey: "2" };
  const h = harness(store, async () => {
    store.windows.set("gw-1", sameBoundsNextGeneration);
  });
  await h.repair.runOnce();
  assert(
    store.windows.get("gw-1") === sameBoundsNextGeneration,
    "a window whose generation moved must survive, even with the same bounds",
  );
}

/** At most one pass a minute per gateway; other gateways are not held up. */
export async function atMostOnePassAMinutePerGateway(): Promise<void> {
  const store = fakeStore([W1]);
  let refreshes = 0;
  const h = harness(store, async () => {
    refreshes += 1;
    throw new Error("still locked");
  });
  await h.repair.runOnce();
  h.advance(59_999);
  await h.repair.runOnce();
  assert(refreshes === 1, `a second pass inside a minute must not refresh, got ${refreshes}`);
  store.windows.set("gw-2", windowOf("gw-2", "2026-11-10T02:00:00.000Z", "2026-11-10T03:00:00.000Z"));
  await h.repair.runOnce();
  assert(refreshes === 2, "another gateway's window is not held back by gw-1's minute");
  h.advance(1);
  await h.repair.runOnce();
  assert(refreshes === 3, "after a full minute gw-1 is retried");
}

/** Two passes never overlap. */
export async function passesNeverOverlap(): Promise<void> {
  const store = fakeStore([W1]);
  let release: () => void = () => undefined;
  let refreshes = 0;
  const h = harness(store, () => {
    refreshes += 1;
    return new Promise<void>((done) => {
      release = done;
    });
  });
  const first = h.repair.runOnce();
  await new Promise((r) => setImmediate(r));
  h.advance(120_000);
  await h.repair.runOnce();
  release();
  await first;
  assert(refreshes === 1, `an overlapping pass must not start a second refresh, got ${refreshes}`);
}

/** A store that cannot list is one error line, never a rejection. */
export async function aFailingListIsOneLine(): Promise<void> {
  const h = harness(
    {
      listDirty: async () => {
        throw new Error("connection refused");
      },
      clear: async () => true,
    },
    async () => undefined,
  );
  await h.repair.runOnce();
  assert(h.lines.length === 1 && h.lines[0].includes("aggregate repair pass failed"), "one error line");
}

/** The clear names its gateway and both bounds; the store passes the stored text keys. */
export async function theClearComparesBothBoundsByGateway(): Promise<void> {
  const sql = CLEAR_DIRTY_WINDOW.replace(/\s+/g, " ");
  assert(
    /WHERE id = \$1 AND backfill_dirty_from = \$2::timestamptz AND backfill_dirty_to = \$3::timestamptz AND backfill_dirty_seq = \$4::bigint/.test(
      sql,
    ),
    "the clear must compare both bounds and the generation, and filter by gateway id",
  );
  const calls: { text: string; values?: unknown[] }[] = [];
  const store = createRepairStore({
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("SELECT")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: "gw-1",
              backfill_dirty_from: new Date("2026-11-10T03:00:00.000Z"),
              backfill_dirty_to: new Date("2026-11-10T05:00:00.000Z"),
              from_key: "2026-11-10 03:00:00.000001+00",
              to_key: "2026-11-10 05:00:00+00",
              seq_key: "9007199254740993",
            },
            { id: "gw-bad", backfill_dirty_from: null, backfill_dirty_to: null, from_key: null, to_key: null },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  });
  const windows = await store.listDirty();
  assert(windows.length === 1, "a row with no window is skipped");
  const cleared = await store.clear(windows[0]);
  assert(!cleared, "rowCount 0 means the window moved");
  const values = calls[1]?.values ?? [];
  assert(
    values[0] === "gw-1" &&
      values[1] === "2026-11-10 03:00:00.000001+00" &&
      values[2] === "2026-11-10 05:00:00+00" &&
      values[3] === "9007199254740993",
    "the clear binds the stored text keys, so a microsecond is never lost",
  );
}
