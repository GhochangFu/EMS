import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  ELECTRICAL_POINT_KEYS,
  HVAC_POINT_KEYS,
} from "@bms/shared";

import type { BmsDb } from "@bms/db";

import {
  mergeRulePointKeys,
  pointKeysForAsset,
  ruleTargetPointKeysByAsset,
} from "./rule-points";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function same(actual: string[], expected: readonly string[], label: string): void {
  assert(
    actual.length === expected.length && actual.every((key, i) => key === expected[i]),
    `${label}: expected [${expected.join(", ")}], got [${actual.join(", ")}]`,
  );
}

/**
 * Assertions for the point catalog (ADR 0014, §4.6).
 *
 * The order of the checks inside `pointKeysForAsset` is load-bearing: several
 * `CR-` prefixes are narrower than the trailing control-room electrical
 * fallback. Each case below pins one branch *and* the branch it must beat.
 */
export function runRulePointsTests(): void {
  same(pointKeysForAsset("it", "CR-RACK-01"), CONTROL_ROOM_IT_POINT_KEYS, "CR-RACK");
  same(pointKeysForAsset("it", "CR-PDU-01"), CONTROL_ROOM_IT_POINT_KEYS, "CR-PDU");
  same(pointKeysForAsset("ups", "CR-UPS-01"), CONTROL_ROOM_UPS_POINT_KEYS, "CR-UPS");
  same(pointKeysForAsset("ups", "CR-BATT-01"), CONTROL_ROOM_UPS_POINT_KEYS, "CR-BATT");

  same(
    pointKeysForAsset("environment", "ANY-CODE"),
    CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
    "environment domain",
  );
  for (const code of ["CR-ENV-01", "CR-LEAK-01", "CR-SMOKE-01"]) {
    same(
      pointKeysForAsset("electrical", code),
      CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
      `${code} is environment by code even when its domain is not`,
    );
  }

  same(pointKeysForAsset("hvac", "CRAC-01"), HVAC_POINT_KEYS, "hvac domain");

  // The `CR-` fallback, and the two things that must beat it.
  same(
    pointKeysForAsset("electrical", "CR-MAIN-01"),
    CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
    "an unrecognised CR- code falls back to control-room electrical",
  );
  // The `CR-RACK`-beats-`CR-` ordering is pinned by the content comparison
  // above: the IT and control-room-electrical catalogs differ, so `same()`
  // discriminates. An identity check against the shared constant would not —
  // every branch returns a fresh copy, so it is true either way.
  same(
    pointKeysForAsset("hvac", "CR-CRAC-01"),
    HVAC_POINT_KEYS,
    "the hvac domain must beat the CR- electrical fallback",
  );

  same(
    pointKeysForAsset("electrical", "FEEDER-01"),
    ELECTRICAL_POINT_KEYS,
    "a non-CR asset falls back to plain electrical",
  );

  // A fresh array each call — the catalogs are module constants and a caller
  // that mutated the result would corrupt every later lookup.
  const first = pointKeysForAsset("electrical", "FEEDER-01");
  first.push("injected");
  const second = pointKeysForAsset("electrical", "FEEDER-01");
  assert(
    !second.includes("injected"),
    "the returned array must be a copy, not the shared constant",
  );
}

/*
 * `F3.49` / ADR 0058 Amendment 2 — the union both sides of the rules module
 * read. One claim per exported function, each its own `it()` in the wrapper:
 * `assert` throws, so a second claim in the same function is unreachable once
 * the first fails, and a mutation that reddens "the" test would then be
 * reddening whichever claim happened to come first.
 */

/** No template keys: the map, byte-for-byte — a template-less asset's list does not move. */
export function runMergeKeepsTemplateLessListTests(): void {
  same(
    mergeRulePointKeys("electrical", "FEEDER-01", []),
    ELECTRICAL_POINT_KEYS,
    "no template keys: exactly the hard-coded list",
  );
}

/** Map first, then the template keys in the order given — not sorted, not first. */
export function runMergeOrderTests(): void {
  same(
    mergeRulePointKeys("water", "WTP-1", ["b_key", "a_key"]),
    [...ELECTRICAL_POINT_KEYS, "b_key", "a_key"],
    "map first, then template keys in the order given, not sorted",
  );
}

/** `kw` is in `ELECTRICAL_POINT_KEYS`; `pue` is not. Seven keys, not eight. */
export function runMergeDedupeTests(): void {
  same(
    mergeRulePointKeys("electrical", "FEEDER-01", ["kw", "pue"]),
    [...ELECTRICAL_POINT_KEYS, "pue"],
    "a key in both sets appears once, at its map position",
  );
}

type FoldChain = {
  from: () => FoldChain;
  innerJoin: () => FoldChain;
  where: () => FoldChain;
  orderBy: () => FoldChain;
  then: (resolve: (rows: unknown[]) => void) => void;
};

/**
 * A thenable answering `ruleTargetPointKeysByAsset`'s one query:
 * `.select().from().innerJoin().where().orderBy()`. It ignores its arguments,
 * so a `where` predicate or an added filter is invisible here — the seed-rules
 * integration suite is what sees those.
 */
function foldDb(rows: unknown[]): BmsDb {
  const chain: FoldChain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    then: (resolve) => resolve(rows),
  };
  return { select: () => chain } as unknown as BmsDb;
}

/**
 * Three claims in one function, and they are **ordered**: `assert` throws, so
 * the second is reachable only once the first holds, and the third only once
 * both do. A fold that built its `Map` from the query rows alone reddens on the
 * first (`c` absent); a fold that answered a stray `assetId` reddens on the
 * third — and only if the first two hold.
 */
export async function runFoldAnswersEveryInputAssetTests(): Promise<void> {
  const db = foldDb([
    { assetId: "a", pointKey: "x" },
    { assetId: "b", pointKey: "y" },
    { assetId: "zz", pointKey: "stray" },
  ]);
  const byAsset = await ruleTargetPointKeysByAsset(db, [
    { id: "a", code: "W-1", domain: "water" },
    { id: "b", code: "W-2", domain: "water" },
    { id: "c", code: "W-3", domain: "water" },
  ]);

  assert(
    byAsset.has("c"),
    "an input asset with no template row must get an entry, not an absence the caller papers over with `?? []`",
  );
  same(byAsset.get("c") ?? [], ELECTRICAL_POINT_KEYS, "a template-less asset gets the map");
  same(
    byAsset.get("a") ?? [],
    [...ELECTRICAL_POINT_KEYS, "x"],
    "an asset with a template row gets the map then its template key",
  );
  assert(
    !byAsset.has("zz"),
    "a row for an asset not asked about is ignored, not answered",
  );
}

/**
 * drizzle-orm 0.38.4 renders `inArray(col, [])` as `false`, so the query on an
 * empty list would run and answer nothing — the early return is a saved
 * round-trip, and this is what keeps it from being removed as "defensive".
 */
export async function runFoldSkipsTheQueryOnEmptyInputTests(): Promise<void> {
  const db = {
    select: () => {
      throw new Error("select must not be called for an empty asset list");
    },
  } as unknown as BmsDb;
  const byAsset = await ruleTargetPointKeysByAsset(db, []);
  assert(byAsset.size === 0, `an empty input resolves to an empty Map, got ${byAsset.size} entries`);
}
