import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { AlarmStatsService } from "./alarm-stats.service";

/**
 * `F4.291` PR 2 — `AlarmStatsService`'s claims that need no database: no
 * asset ids answer the empty shape and touch neither pool. The SQL claims
 * are in `alarm-stats.integration.spec.ts`. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 */

/** A pool that fails the claim on any use at all. */
function untouchable(name: string): BmsDb {
  return new Proxy({}, {
    get(_target, prop) {
      throw new Error(`F4.291: the ${name} pool was used (${String(prop)}) for an empty asset set`);
    },
  }) as BmsDb;
}

const FROM = new Date("2026-10-01T00:00:00.000Z");
const TO = new Date("2026-10-08T00:00:00.000Z");

export async function assertNoAssetIdsAnswerEmptyWithNoQuery(): Promise<void> {
  const svc = new AlarmStatsService(untouchable("tenant"), untouchable("fleet"));
  expect(await svc.range([], FROM, TO)).toEqual({
    from: FROM.toISOString(),
    to: TO.toISOString(),
    raised: 0,
    open: 0,
    bySeverity: [],
    byLocation: [],
    moreLocations: false,
    topAssets: [],
    mttaSeconds: null,
    mttrSeconds: null,
    acknowledgedCount: 0,
    clearedCount: 0,
  });
}
