import { PgDialect } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { expect } from "vitest";

import {
  advisoryCandidatesStatement,
  candidateOf,
  readPairHours,
  readTopEnergyAssets,
  type AdvisoryCandidateDbRow,
} from "./advisories.reads";

/**
 * `E1.6a` / ADR 0137 (plan T1.6, T1.7, Q6, R-e) — the advisory SQL as text, and
 * the pure row mapping. The candidate statement holds the ML "real" line, an
 * active `kw` point and the asset filter chosen by `ids === null`; the ranking
 * and pair statements bind the candidate ids as `= ANY($1::uuid[])`. Every
 * value is a bound parameter. Assertions live here; `advisories.reads.test.ts`
 * is the vitest entry point (ADR 0014).
 */
const dialect = new PgDialect();
const normalise = (text: string): string => text.replace(/\s+/g, " ").trim();
const REAL = "a.meta->>'telemetrySource' = 'mqtt' OR (ap.source_kind = 'measured' AND r.ingest_enabled)";
const A1 = "0f0a0000-0000-4000-8000-000000000101";
const A2 = "0f0a0000-0000-4000-8000-000000000102";

type Call = { text: string; values: unknown[] };
function fakePool(rows: unknown[]): { pool: Pick<Pool, "query">; calls: Call[] } {
  const calls: Call[] = [];
  const pool = {
    query: async (text: string, values: unknown[]) => {
      calls.push({ text, values });
      return { rows };
    },
  };
  return { calls, pool: pool as unknown as Pick<Pool, "query"> };
}

export function theCandidateStatementHoldsTheRealLineAndAnActiveKwPoint(): void {
  for (const ids of [null, [A1, A2]]) {
    const { sql } = dialect.sqlToQuery(advisoryCandidatesStatement(ids));
    const text = normalise(sql);
    expect(text).toContain(REAL);
    expect(text).toContain("ap.point_key = 'kw'");
    expect(text).toMatch(/\bap\.active\b/);
    expect(text).toContain("LEFT JOIN bms.rtus r ON r.id = ap.rtu_id");
    expect(text).toContain("l.timezone AS location_zone");
    expect(text).toContain("o.energy_features AS energy_features");
  }
}

export function theAssetFilterIsChosenByIdsBeingNull(): void {
  const all = dialect.sqlToQuery(advisoryCandidatesStatement(null));
  expect(all.sql).not.toMatch(/ANY\(/);
  expect(all.params).toEqual([]);
  const some = dialect.sqlToQuery(advisoryCandidatesStatement([A1, A2]));
  expect(normalise(some.sql)).toContain("a.id = ANY($1::uuid[])");
  expect(some.params).toEqual([`{${A1},${A2}}`]);
  // An empty list is still a filter (it matches nothing), never the admin's unfiltered read.
  expect(normalise(dialect.sqlToQuery(advisoryCandidatesStatement([])).sql)).toContain("a.id = ANY($1::uuid[])");
  expect(() => advisoryCandidatesStatement(["not-a-uuid"])).toThrow(/not a UUID/);
}

export async function theRankingReadBindsTheIdsAndTheLimit(): Promise<void> {
  const { pool, calls } = fakePool([{ asset_id: A2 }, { asset_id: A1 }]);
  const since = Date.parse("2026-11-10T00:00:00Z");
  expect(await readTopEnergyAssets(pool, [A1, A2], since, 200)).toEqual([A2, A1]);
  expect(calls).toHaveLength(1);
  const text = normalise(calls[0]!.text);
  expect(text).toContain("FROM telemetry.point_values_1h p");
  expect(text).toContain("p.asset_id = ANY($1::uuid[])");
  expect(text).toContain("p.point_key = 'kw'");
  expect(text).toContain("p.bucket >= $2");
  expect(text).toContain("LIMIT $3");
  expect(calls[0]!.values).toEqual([[A1, A2], new Date(since), 200]);
  // No candidate, no read.
  const empty = fakePool([]);
  expect(await readTopEnergyAssets(empty.pool, [], since, 200)).toEqual([]);
  expect(empty.calls).toEqual([]);
}

export async function thePairReadBindsTheIdsAndPivotsByHour(): Promise<void> {
  const fromMs = Date.parse("2026-11-09T18:30:00Z");
  const toMs = fromMs + 7 * 86_400_000;
  const t0 = Date.parse("2026-11-09T19:00:00Z");
  const { pool, calls } = fakePool([
    { asset_id: A1, bucket_ms: t0 + 3_600_000, point_key: "kw", mean: 40 },
    { asset_id: A1, bucket_ms: t0, point_key: "kw", mean: 50 },
    { asset_id: A1, bucket_ms: t0, point_key: "kva", mean: 60 },
    { asset_id: A2, bucket_ms: t0, point_key: "pf", mean: "0.8" },
  ]);
  const byAsset = await readPairHours(pool, [A1, A2], fromMs, toMs);
  const text = normalise(calls[0]!.text);
  expect(text).toContain("FROM telemetry.point_values_1h p");
  expect(text).toContain("p.asset_id = ANY($1::uuid[])");
  expect(text).toContain("p.point_key = ANY($2::text[])");
  expect(text).toContain("p.bucket >= $3 AND p.bucket < $4");
  expect(text).toContain("(sum(p.sum_value) / sum(p.sample_count))");
  expect(calls[0]!.values).toEqual([[A1, A2], ["kw", "kva", "pf"], new Date(fromMs), new Date(toMs)]);
  expect(byAsset.get(A1)).toEqual([
    { bucketMs: t0, kw: 50, kva: 60, pf: null },
    { bucketMs: t0 + 3_600_000, kw: 40, kva: null, pf: null },
  ]);
  expect(byAsset.get(A2)).toEqual([{ bucketMs: t0, kw: null, kva: null, pf: 0.8 }]);
  const empty = fakePool([]);
  expect((await readPairHours(empty.pool, [], fromMs, toMs)).size).toBe(0);
  expect(empty.calls).toEqual([]);
}

const row = (overrides: Partial<AdvisoryCandidateDbRow> = {}): AdvisoryCandidateDbRow => ({
  asset_id: A1,
  organization_id: "0f0a0000-0000-4000-8000-000000000001",
  location_id: "0f0a0000-0000-4000-8000-000000000002",
  asset_code: "EM-01",
  asset_name: "Fixture incomer meter",
  asset_rtu_name: null,
  location_name: "North Yard",
  domain: "electrical",
  location_zone: "Asia/Kolkata",
  currency: "INR",
  energy_features: "auto",
  has_pf: true,
  has_kva: null,
  has_kwh_total: true,
  has_kvah_total: false,
  ...overrides,
});

export function aRowBecomesACandidateOnlyWithItsOwnZoneAndEnergyNotOff(): void {
  expect(candidateOf(row())).toEqual({
    assetId: A1,
    organizationId: "0f0a0000-0000-4000-8000-000000000001",
    locationId: "0f0a0000-0000-4000-8000-000000000002",
    assetCode: "EM-01",
    assetName: "Fixture incomer meter",
    assetRtuName: null,
    assetLocationName: "North Yard",
    domain: "electrical",
    timeZone: "Asia/Kolkata",
    zone: "Asia/Kolkata",
    currency: "INR",
    points: { pf: true, kva: false, kwhTotal: true, kvahTotal: false },
  });
  // No zone of its own, or one that is not valid: no advisory (the organization's zone is not used).
  expect(candidateOf(row({ location_zone: null }))).toBeNull();
  expect(candidateOf(row({ location_zone: "Mars/Olympus" }))).toBeNull();
  // "UTC" is a valid stored zone; the arithmetic runs in Etc/UTC.
  expect(candidateOf(row({ location_zone: "UTC" }))).toMatchObject({ timeZone: "UTC", zone: "Etc/UTC" });
  // Energy features off: no advisory; on and auto both count (the meter has energy data by definition).
  expect(candidateOf(row({ energy_features: "off" }))).toBeNull();
  expect(candidateOf(row({ energy_features: "on" }))).not.toBeNull();
  // A char(3) currency is trimmed.
  expect(candidateOf(row({ currency: "USD" }))?.currency).toBe("USD");
}
