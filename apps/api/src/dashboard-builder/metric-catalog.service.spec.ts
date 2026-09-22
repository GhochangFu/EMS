import type { BmsTx } from "../database/tenant-context";
import { RESOLVERS } from "./metric-catalog.service";

/**
 * `E4.2` PR 1 sweep — the catalog's resolvers, pure claims (no database). Assertions live
 * here; `metric-catalog.service.test.ts` is the Vitest entry point (ADR 0014). One exported
 * function per claim.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const same = (actual: unknown, expected: unknown, what: string): void => {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
};

/** A transaction that refuses every statement: any SQL the resolver builds is the failure. */
const refusingTx = (): BmsTx => {
  const refuse = () => {
    throw new Error("the resolver built SQL for an empty scope");
  };
  return { execute: refuse, select: refuse } as unknown as BmsTx;
};

const noDeps = { health: undefined } as unknown as Parameters<(typeof RESOLVERS)["sustainability.total"]>[3];

/**
 * `sustainability.total` on an empty scope answers `0/0`, `null`, no unit and no currency
 * BEFORE any SQL — the sentence over `RESOLVERS` ("every entry below routes an empty scope to
 * a zero answer before building SQL") is true of this entry too. PR 1 read the point's unit
 * and the organization's currency first.
 */
export async function totalOnAnEmptyScopeBuildsNoSql(): Promise<void> {
  const resolved = await RESOLVERS["sustainability.total"](refusingTx(), "org", [], noDeps, {
    pointKey: "kl_today",
    aggregate: "sum",
  });
  same(
    resolved,
    {
      shape: "metric",
      key: "sustainability.total",
      value: null,
      unit: null,
      coverage: { fresh: 0, carrying: 0 },
      currency: null,
    },
    "sustainability.total over []",
  );
}

/** The sibling `by_location` entry is the control: it already short-circuited in PR 1. */
export async function byLocationOnAnEmptyScopeBuildsNoSql(): Promise<void> {
  const resolved = await RESOLVERS["sustainability.by_location"](refusingTx(), "org", [], noDeps, {
    pointKey: "kl_today",
    aggregate: "sum",
  });
  same(
    { shape: resolved.shape, rows: resolved.shape === "dataset" ? resolved.rows : undefined },
    { shape: "dataset", rows: [] },
    "sustainability.by_location over []",
  );
}
