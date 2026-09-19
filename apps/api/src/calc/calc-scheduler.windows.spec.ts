import { CALC_DIALECT_V3, windowKey, type CalcWindowRead } from "@bms/shared";

import { defKey, inputKey } from "./calc-batch";
import { runScheduledSweep } from "./calc-scheduler.service";
import { buildSweepDeps, def, membershipOf, windowFakeKey } from "./calc-scheduler.spec";
import type { WindowReadResult } from "./calc-windows.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function count(skips: readonly string[], reason: string): number {
  return skips.filter((s) => s === reason).length;
}

/**
 * Window reads in the sweep (ADR 0070 decisions 5 and 6; `E4.1b` U9). The
 * host collects every read of every DUE `v3` definition once per sweep,
 * hands them to `CalcWindowsService` in one call, and serves `evaluate`'s
 * fifth map from the answers. An `ok: false` answer is a counted refusal
 * under its own reason (`window_empty` / `timezone_unset`) that writes
 * nothing; a thrown batch refuses every definition holding a window read as
 * `windows_unresolved` (plan ruling Q8, the mirror of
 * `parameters_unresolved`) and touches nothing else. The order inside one
 * formula is parameters → local readings → cross references → windows →
 * evaluate (design decision 10), and the fake below answers under the
 * service's own key so the host's lookup is what is exercised.
 */
const V3 = { dialect: CALC_DIALECT_V3 } as const;
const ok = (value: number): WindowReadResult => ({ ok: true, value });
const refused = (reason: "window_empty" | "timezone_unset"): WindowReadResult => ({ ok: false, reason });

function readsOf(formula: string): CalcWindowRead[] {
  return def({ ...V3, formula }).windowReads;
}

/** H1 — both reads present → one write with delta / hours, at the bucketed tick */
export async function windowReadsPresentWrite(): Promise<void> {
  const daily = def({ ...V3, pointKey: "KWH_PER_H", formula: "delta({kwh}, today) / hours(today)" });
  const [deltaRead, hoursRead] = readsOf("delta({kwh}, today) / hours(today)");
  const samples = new Map([["asset-1:kwh", { value: 200, timeMs: 0 }]]);
  const windows = new Map([
    [windowFakeKey("asset-1", deltaRead), ok(70)],
    [windowFakeKey("asset-1", hoursRead), ok(2)],
  ]);
  const { deps, writes, skips, status } = buildSweepDeps([daily], samples, { windows });
  await runScheduledSweep(deps, new Map(), 90_000);
  const batch = writes.flat();
  assert(batch.length === 1 && batch[0]?.pointKey === "KWH_PER_H" && batch[0].value === 35, `70 / 2 must write 35, got ${JSON.stringify(batch)}`);
  assert(batch[0].time.getTime() === 60_000, `the write carries the bucketed tick, got ${batch[0].time.toISOString()}`);
  assert(skips.length === 0, `no skip when both reads answer, got ${JSON.stringify(skips)}`);
  assert(status.get("asset-1", "tp-1")?.outcome === "written", "the registry records the write");
}

/** H2 — the owed guard: window_empty → one skip, no row, the v1 sibling still writes */
export async function emptyWindowRefusesWithoutARow(): Promise<void> {
  const daily = def({ ...V3, pointKey: "KWH_TODAY", templatePointId: "tp-kwh", formula: "delta({kwh}, today)" });
  const plain = def({ pointKey: "PLAIN", templatePointId: "tp-plain", formula: "{kwh} * 2" });
  const [deltaRead] = readsOf("delta({kwh}, today)");
  const samples = new Map([["asset-1:kwh", { value: 200, timeMs: 0 }]]);
  const windows = new Map([[windowFakeKey("asset-1", deltaRead), refused("window_empty")]]);
  const { deps, writes, skips, status } = buildSweepDeps([daily, plain], samples, { windows });
  await runScheduledSweep(deps, new Map(), 0);
  const batch = writes.flat();
  assert(batch.length === 1 && batch[0]?.pointKey === "PLAIN" && batch[0].value === 400, `only the v1 sibling writes, got ${JSON.stringify(batch)}`);
  assert(!batch.some((w) => w.pointKey === "KWH_TODAY"), "an empty window writes NO row — never 0");
  assert(count(skips, "window_empty") === 1 && skips.length === 1, `exactly one window_empty skip, got ${JSON.stringify(skips)}`);
  const recorded = status.get("asset-1", "tp-kwh");
  assert(recorded?.outcome === "skipped" && recorded.reason === "window_empty", `the registry reads skipped/window_empty, got ${JSON.stringify(recorded)}`);
}

/** H3 — timezone_unset likewise */
export async function unsetZoneRefusesWithoutARow(): Promise<void> {
  const daily = def({ ...V3, pointKey: "KWH_TODAY", formula: "delta({kwh}, today)" });
  const [deltaRead] = readsOf("delta({kwh}, today)");
  const samples = new Map([["asset-1:kwh", { value: 200, timeMs: 0 }]]);
  const windows = new Map([[windowFakeKey("asset-1", deltaRead), refused("timezone_unset")]]);
  const { deps, writes, skips, status } = buildSweepDeps([daily], samples, { windows });
  await runScheduledSweep(deps, new Map(), 0);
  assert(writes.flat().length === 0, "a calendar window at a location with no zone writes nothing");
  assert(count(skips, "timezone_unset") === 1 && skips.length === 1, `exactly one timezone_unset, got ${JSON.stringify(skips)}`);
  assert(status.get("asset-1", "tp-1")?.reason === "timezone_unset", "the registry names the reason");
}

/** H4 — a thrown batch refuses only the definitions holding a window read, with one warn */
export async function failedReadRefusesOnlyWindowHolders(): Promise<void> {
  const windowed = def({ ...V3, pointKey: "AVG24", templatePointId: "tp-avg", formula: "avg({kw}, 24h)" });
  const paramOnly = def({ ...V3, pointKey: "COST", templatePointId: "tp-cost", formula: "{kw} * $f" });
  const plain = def({ pointKey: "PLAIN", templatePointId: "tp-plain", formula: "{kw}" });
  const samples = new Map([["asset-1:kw", { value: 10, timeMs: 0 }]]);
  const parameters = new Map([[inputKey("asset-1", "f"), 2]]);
  const { deps, writes, skips, warnings } = buildSweepDeps([windowed, paramOnly, plain], samples, { parameters, windowsThrows: true });
  await runScheduledSweep(deps, new Map(), 0);
  const batch = writes.flat().map((w) => w.pointKey).sort();
  assert(batch.join(",") === "COST,PLAIN", `the $-only v3 and the v1 formulas still write, got ${batch.join(",")}`);
  assert(count(skips, "windows_unresolved") === 1 && skips.length === 1, `exactly one windows_unresolved, got ${JSON.stringify(skips)}`);
  assert(warnings.length === 1 && /window/.test(warnings[0]), `one warn naming the window read, got ${JSON.stringify(warnings)}`);
}

/** H5 — the requests are the distinct (owner, readAsset, windowKey) set of the DUE definitions, once per sweep, and a qualified read's asset comes through membership */
export async function requestsAreTheDistinctSetOfDueDefinitions(): Promise<void> {
  const own = def({ ...V3, pointKey: "A", templatePointId: "tp-a", formula: "avg({kw}, 24h) + avg({kw}, 1440m)" });
  const qualified = def({ ...V3, pointKey: "B", templatePointId: "tp-b", formula: "max({TX_01.kw}, 7d)" });
  const notDue = def({ ...V3, pointKey: "C", templatePointId: "tp-c", formula: "min({kw}, today)", intervalSeconds: 3600 });
  const samples = new Map([
    ["asset-1:kw", { value: 10, timeMs: 0 }],
    ["asset-2:kw", { value: 20, timeMs: 0 }],
  ]);
  const membership = membershipOf([["asset-1", [["TX_01", "asset-2"]]]]);
  const [ownRead] = readsOf("avg({kw}, 24h)");
  const [qualifiedRead] = readsOf("max({TX_01.kw}, 7d)");
  const windows = new Map([
    [windowFakeKey("asset-1", ownRead), ok(1)],
    [windowFakeKey("asset-1", qualifiedRead), ok(2)],
  ]);
  const { deps, windowRequests, writes } = buildSweepDeps([own, qualified, notDue], samples, { membership, windows });
  // C ran at its bucket 0 already and is not due at t = 60 s; A and B are
  const lastRunMs = new Map([[defKey("asset-1", "tp-c"), 0]]);
  await runScheduledSweep(deps, lastRunMs, 60_000);
  assert(windowRequests.length === 1, `one resolveReads call per sweep, got ${windowRequests.length}`);
  const received = windowRequests[0].map((r) => `${r.ownerAssetId}|${r.readAssetId}|${windowKey(r.node)}|${r.endMs}`).sort();
  assert(
    received.join(" ; ") === "asset-1|asset-1|avg({kw}, 1440m)|60000 ; asset-1|asset-2|max({TX_01.kw}, 10080m)|60000",
    `the distinct due reads, the qualified one on the member asset, at the bucketed tick — got ${received.join(" ; ")}`,
  );
  assert(!received.some((r) => r.includes("min({kw}, today)")), "a definition that is not due is not read");
  assert(writes.flat().length === 2, `A and B write, got ${JSON.stringify(writes.flat())}`);
}

/** H6 — a stale local reading beside an empty window is stale_input, not window_empty (design decision 10) */
export async function staleInputWinsOverEmptyWindow(): Promise<void> {
  const daily = def({ ...V3, pointKey: "X", formula: "{kwh} + delta({kwh}, today)", maxInputAgeSeconds: 10 });
  const [deltaRead] = readsOf("delta({kwh}, today)");
  const samples = new Map([["asset-1:kwh", { value: 200, timeMs: 0 }]]);
  const windows = new Map([[windowFakeKey("asset-1", deltaRead), refused("window_empty")]]);
  const { deps, skips } = buildSweepDeps([daily], samples, { windows });
  await runScheduledSweep(deps, new Map(), 60_000);
  assert(count(skips, "stale_input") === 1 && skips.length === 1, `stale_input, and only that, got ${JSON.stringify(skips)}`);
}

/** H7 — a parameter absent beside a window: parameter_unset, and the window batch still ran once (batching is per sweep) */
export async function parameterUnsetStillBatchesWindows(): Promise<void> {
  const daily = def({ ...V3, pointKey: "X", formula: "delta({kwh}, today) * $f" });
  const [deltaRead] = readsOf("delta({kwh}, today)");
  const samples = new Map([["asset-1:kwh", { value: 200, timeMs: 0 }]]);
  const windows = new Map([[windowFakeKey("asset-1", deltaRead), ok(70)]]);
  const { deps, skips, windowRequests, writes } = buildSweepDeps([daily], samples, { windows });
  await runScheduledSweep(deps, new Map(), 0);
  assert(count(skips, "parameter_unset") === 1 && skips.length === 1, `parameter_unset, got ${JSON.stringify(skips)}`);
  assert(writes.flat().length === 0, "nothing written");
  assert(windowRequests.length === 1 && windowRequests[0].length === 1, "the window read was batched once for the sweep regardless");
}

/** H8 — no definition holds a window read → resolveReads is never called */
export async function noWindowReadsMakesNoCall(): Promise<void> {
  const cost = def({ ...V3, pointKey: "COST", formula: "{kw} * $f" });
  const samples = new Map([["asset-1:kw", { value: 10, timeMs: 0 }]]);
  const parameters = new Map([[inputKey("asset-1", "f"), 2]]);
  const { deps, windowRequests, writes } = buildSweepDeps([cost], samples, { parameters, windowsThrows: true });
  await runScheduledSweep(deps, new Map(), 0);
  assert(windowRequests.length === 0, "no window read → resolveReads not called (a throwing fake proves it)");
  assert(writes.flat().length === 1, "the formula writes");
}
