import { CalcStatusRegistry } from "./calc-status.registry";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F2.9` Task 16 — the in-process runtime registry behind the calc-points
 * status pill (ADR 0055 decision 8; plan design decision 9, layer 3).
 *
 * Assertions live here; `calc-status.registry.test.ts` is the Vitest entry
 * point (ADR 0014, AGENTS.md §4.6).
 */
export function runCalcStatusRegistryTests(): void {
  // ---- an unknown key reads as null, never as a fabricated "written" -----------

  {
    const registry = new CalcStatusRegistry();
    assert(
      registry.get("asset-1", "tp-1") === null,
      "a point the engine has not evaluated must read as null — the DTO's nullable() means " +
        "'no run recorded in this process', and any other answer would invent one",
    );
  }

  // ---- last write wins --------------------------------------------------------

  {
    const registry = new CalcStatusRegistry();
    registry.record("asset-1", "tp-1", { outcome: "skipped", reason: "stale_input", atMs: 1_000 });
    registry.record("asset-1", "tp-1", { outcome: "skipped", reason: "missing_input", atMs: 2_000 });
    const latest = registry.get("asset-1", "tp-1");
    assert(
      latest?.reason === "missing_input" && latest.atMs === 2_000,
      `the registry holds the last outcome, not the first, got ${JSON.stringify(latest)}`,
    );
  }

  // ---- a skip and a later write both land --------------------------------------
  // The pill's whole purpose is to show a refusal clearing: an operator who
  // breaks a cycle must see the point go back to `written`, so a write must
  // overwrite a skip and must clear `reason` with it.

  {
    const registry = new CalcStatusRegistry();
    registry.record("asset-1", "tp-1", { outcome: "skipped", reason: "dependency_cycle", atMs: 1_000 });
    const skipped = registry.get("asset-1", "tp-1");
    assert(
      skipped?.outcome === "skipped" && skipped.reason === "dependency_cycle",
      `a recorded skip carries its reason, got ${JSON.stringify(skipped)}`,
    );

    registry.record("asset-1", "tp-1", { outcome: "written", reason: null, atMs: 3_000 });
    const written = registry.get("asset-1", "tp-1");
    assert(
      written?.outcome === "written" && written.reason === null && written.atMs === 3_000,
      `a later write replaces the skip and clears its reason, got ${JSON.stringify(written)}`,
    );
  }

  // ---- two assets sharing one template point are tracked separately ------------
  // The exact bug `defKey`'s own docblock records from the scheduler: one
  // published template is instantiated on many assets, and each asset's own
  // formula instance runs, is refused, and is reported independently. Keyed on
  // the bare `templatePointId`, the first asset written would answer for every
  // other asset on that template — so an operator reading asset B's page would
  // see asset A's outcome and would have no way to tell.

  {
    const registry = new CalcStatusRegistry();
    registry.record("asset-1", "tp-shared", { outcome: "written", reason: null, atMs: 1_000 });
    registry.record("asset-2", "tp-shared", { outcome: "skipped", reason: "dependency_cycle", atMs: 1_000 });

    const first = registry.get("asset-1", "tp-shared");
    const second = registry.get("asset-2", "tp-shared");
    assert(
      first?.outcome === "written" && first.reason === null,
      `asset-1 keeps its own outcome when asset-2 shares the template point, got ${JSON.stringify(first)}`,
    );
    assert(
      second?.outcome === "skipped" && second.reason === "dependency_cycle",
      `asset-2 keeps its own outcome, got ${JSON.stringify(second)}`,
    );
  }

  // ---- the two ids are not interchangeable ------------------------------------
  // `defKey` separates them with `|` for this reason; a naive `${a}${b}` join
  // would make ("a1", "tp1") and ("a1t", "p1") the same entry.

  {
    const registry = new CalcStatusRegistry();
    registry.record("a1", "tp1", { outcome: "written", reason: null, atMs: 1_000 });
    assert(
      registry.get("a1t", "p1") === null,
      "a different (assetId, templatePointId) pair must not collide with a recorded one",
    );
  }
}
