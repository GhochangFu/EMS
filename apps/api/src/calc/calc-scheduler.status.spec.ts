import { runScheduledSweep } from "./calc-scheduler.service";
import { buildSweepDeps, def } from "./calc-scheduler.spec";
import type { CalcInputSample } from "./calc-inputs";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F2.9` Task 16 — what the scheduled sweep records into `CalcStatusRegistry`
 * (plan design decision 9, layer 3).
 *
 * **A sibling file, not more cases in `calc-scheduler.spec.ts`.** That file is
 * at 940 lines against AGENTS.md §4.5's 1000-line cap; finding 19's ruling is
 * that the answer to a full file is a sibling, never a squeeze. The harness is
 * imported from it, so both files drive the same fakes and the same real
 * registry.
 *
 * The one registry assertion that stays there is on the cycle case (iv), where
 * the refusal it reports is the one this layer exists for.
 */
export async function runCalcSchedulerStatusTests(): Promise<void> {
  // ---- two assets sharing one template point are recorded separately ----------
  //
  // This is `defKey`'s own documented bug, moved to the read side. One
  // published template is instantiated on many assets; each is a separate
  // formula instance and each can succeed or be refused on its own. The two
  // assets below differ in exactly one thing — asset-2 has no input — so they
  // record *different* outcomes on the same sweep. Keyed on `templatePointId`
  // alone, one entry would answer for both, and the asset that was refused
  // would show the other asset's `written` on its own page: the one reading an
  // operator has no way to check.

  {
    const onAssetOne = def({ assetId: "asset-1", templatePointId: "tp-shared", formula: "{A}" });
    const onAssetTwo = def({ assetId: "asset-2", templatePointId: "tp-shared", formula: "{A}" });
    const samples = new Map<string, CalcInputSample>([["asset-1:A", { value: 1, timeMs: 0 }]]);
    const { deps, status, skips } = buildSweepDeps([onAssetOne, onAssetTwo], samples);

    await runScheduledSweep(deps, new Map(), 0);

    const first = status.get("asset-1", "tp-shared");
    const second = status.get("asset-2", "tp-shared");
    assert(
      first?.outcome === "written" && first.reason === null && first.atMs === 0,
      `asset-1 had its input and computed, so its own entry says written, got ${JSON.stringify(first)}`,
    );
    assert(
      second?.outcome === "skipped" && second.reason === "missing_input",
      `asset-2 had no input and was refused, so its own entry says missing_input — not asset-1's ` +
        `outcome under a shared key, got ${JSON.stringify(second)}`,
    );
    assert(
      JSON.stringify(skips) === JSON.stringify(["missing_input"]),
      `exactly one refusal was counted, and the registry agrees with the counter, got ${JSON.stringify(skips)}`,
    );
  }

  // ---- a formula that is not due does not overwrite its last outcome ----------
  //
  // `isDue` returns before any refusal is counted, deliberately (correction
  // 61). The registry must return there too: a tick that did not evaluate a
  // formula has learnt nothing about it, and overwriting the entry would make
  // the page's "written 12 s ago" mean "the sweep ran 12 s ago" instead — the
  // same number, a different claim, and no longer the one the pill promises.

  {
    const formula = def({ assetId: "asset-1", templatePointId: "tp-1", formula: "{A}", intervalSeconds: 60 });
    const samples = new Map<string, CalcInputSample>([["asset-1:A", { value: 1, timeMs: 0 }]]);
    const { deps, status } = buildSweepDeps([formula], samples);
    const lastRunMs = new Map<string, number>();

    await runScheduledSweep(deps, lastRunMs, 0);
    assert(status.get("asset-1", "tp-1")?.atMs === 0, "the first sweep records the evaluation it ran");

    await runScheduledSweep(deps, lastRunMs, 10_000);
    const after = status.get("asset-1", "tp-1");
    assert(
      after?.atMs === 0 && after.outcome === "written",
      `10s into a 60s interval nothing was evaluated, so the entry still names the sweep that ` +
        `did evaluate it, got ${JSON.stringify(after)}`,
    );

    await runScheduledSweep(deps, lastRunMs, 60_000);
    assert(
      status.get("asset-1", "tp-1")?.atMs === 60_000,
      `the next due window records afresh, got ${JSON.stringify(status.get("asset-1", "tp-1"))}`,
    );
  }
}
