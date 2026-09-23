// Pinned to a half-hour zone that is neither UTC nor any fixture zone BEFORE
// anything reads the clock: a `Date` component read (getHours, getDate, a
// local-time constructor) anywhere in the code under test then disagrees with
// the fixture's UTC arithmetic — the hour floor above all — so the
// wall-clock-as-UTC bug cannot pass here the way it passes in CI's UTC.
process.env.TZ = "America/St_Johns";

import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { loadFixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertADenseMonthAnswers,
  assertASparseMonthRefusesWindowSparse,
  assertAvgOverTheSparseMonthAnswers,
  assertBothHoursCoveredAnswers,
  assertDeltaOverTheSparseMonthAnswers,
  assertMaxOverTheSparseMonthAnswers,
  assertMinOverTheSparseMonthAnswers,
  assertTheHourFloorClipsTheHead,
  assertTheHourFloorClipsTheTail,
  assertTheSparseBatchRunsTwoStatements,
  assertThreeCoveredHoursOn1hAnswers,
  cleanup,
  seedSparseFixture,
  sparseAnchors,
  type SparseAnchors,
  type SparseFixture,
} from "./calc-windows.sparse.integration.spec";

/**
 * `E4.4` — Vitest entry point for the `window_sparse` guard on a real
 * database (ADR 0070 Amendment 3). Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle and the `TZ` pin. One
 * `it()` per claim, so a mutation reddens the assertion that owns it.
 */

const connectionString = requireIntegrationDb({
  item: "E4.4",
  label: "calc window sparse-coverage tests",
  because:
    "the three coverage facts are computed inside the level statement over real continuous aggregates, and " +
    "a sparse month refusing while the dense month answers is a database behaviour a pure test cannot check.",
});

describe.skipIf(!connectionString)("E4.4 — a window sum refuses window_sparse below 90% coverage", () => {
  let pool: pg.Pool | undefined;
  let fixture: SparseFixture;
  // computed before the seed, so `afterAll` re-covers both ranges even when
  // the seed throws after its asset insert and `fixture` stays unset
  let anchors: SparseAnchors | undefined;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "E4.4");
    pool = created;
    const fx = await loadFixtures(created);
    await cleanup(created);
    anchors = sparseAnchors(Date.now());
    fixture = await seedSparseFixture(created, fx, anchors);
  }, 300_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool, anchors);
      await pool.end();
    }
  }, 300_000);

  it("S1 — sum over ten days with three dark days refuses window_sparse", async () => {
    if (!pool) throw new Error("pool required");
    await assertASparseMonthRefusesWindowSparse(pool, fixture);
  });

  it("S2 — positive control: sum over the dense ten days answers 2400", async () => {
    if (!pool) throw new Error("pool required");
    await assertADenseMonthAnswers(pool, fixture);
  });

  it("S3a — avg over the sparse month answers", async () => {
    if (!pool) throw new Error("pool required");
    await assertAvgOverTheSparseMonthAnswers(pool, fixture);
  });

  it("S3b — min over the sparse month answers", async () => {
    if (!pool) throw new Error("pool required");
    await assertMinOverTheSparseMonthAnswers(pool, fixture);
  });

  it("S3c — max over the sparse month answers", async () => {
    if (!pool) throw new Error("pool required");
    await assertMaxOverTheSparseMonthAnswers(pool, fixture);
  });

  it("S3d — delta over the sparse month answers", async () => {
    if (!pool) throw new Error("pool required");
    await assertDeltaOverTheSparseMonthAnswers(pool, fixture);
  });

  it("S4 — the sparse read runs two statements, reading only the 1d view: coverage adds no statement", async () => {
    if (!pool) throw new Error("pool required");
    await assertTheSparseBatchRunsTwoStatements(pool, fixture);
  });

  it("S5a — the hour floor clips the head: two 5m buckets in one hour cover 45 min of a 1 h window → window_sparse", async () => {
    if (!pool) throw new Error("pool required");
    await assertTheHourFloorClipsTheHead(pool, fixture);
  });

  it("S5b — the hour floor clips the tail: one bucket in the last hour covers 15 min → window_sparse", async () => {
    if (!pool) throw new Error("pool required");
    await assertTheHourFloorClipsTheTail(pool, fixture);
  });

  it("S5c — both hours covered → the window answers", async () => {
    if (!pool) throw new Error("pool required");
    await assertBothHoursCoveredAnswers(pool, fixture);
  });

  it("S6 — three covered hours of three, served from 1h alone, answer: the 1h coverage unit is an hour", async () => {
    if (!pool) throw new Error("pool required");
    await assertThreeCoveredHoursOn1hAnswers(pool, fixture);
  });
});
