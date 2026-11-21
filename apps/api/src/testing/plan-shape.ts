import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { Recorded } from "./recording-pool";

/**
 * `F4.393` (plan §4, Task 1.1; D7) — the plan-shape seam: record a statement exactly as the code
 * issued it, then ask the planner what it would scan. No assertions live here; the spec
 * `telemetry/point-values-plan-shape.integration.spec.ts` makes them.
 *
 * The property gated is **which chunks the planner kept**, never a planning time: a read whose
 * time bound the planner can use before it runs names only its window's chunks in the plan and
 * reports no `Chunks excluded during startup`; a read the planner can only prune at executor
 * startup (`now() - 15 * interval '1 minute'`) plans every chunk first and reports them there;
 * a read with no usable lower bound names every chunk.
 */

/** A pool that forwards every query to `client` and records its text and parameters. */
export function recordingClient(client: Pick<pg.PoolClient, "query">): {
  pool: pg.Pool;
  statements: Recorded[];
} {
  const statements: Recorded[] = [];
  const forward = client.query.bind(client) as (first: unknown, params?: unknown) => Promise<unknown>;
  const pool = {
    // `first` is a string from `pool.query(text, params)`, or drizzle's query config object
    // (`{ name, text, rowMode, types }`) with the parameters as the second argument.
    query: (first: string | { text: string }, params?: unknown[]) => {
      const text = typeof first === "string" ? first : first.text;
      statements.push({ text, params: params ?? [] });
      return forward(first, params);
    },
  } as unknown as pg.Pool;
  return { pool, statements };
}

/** What the planner kept for one statement. */
export interface PlanShape {
  /** Distinct `_hyper_N_M_chunk` relations named anywhere in the plan. */
  readonly chunks: number;
  /** Σ `Chunks excluded during startup` over every node. */
  readonly excludedAtStartup: number;
}

const CHUNK_RELATION = /^_hyper_\d+_\d+_chunk$/;

type PlanNode = {
  readonly "Relation Name"?: string;
  readonly "Chunks excluded during startup"?: number;
  readonly Plans?: readonly PlanNode[];
};

/** `EXPLAIN (FORMAT JSON)` — no `ANALYZE` — of `statement` with its recorded parameters. */
export async function planShape(
  client: Pick<pg.PoolClient, "query">,
  statement: Recorded,
): Promise<PlanShape> {
  const result = await client.query<{ "QUERY PLAN": readonly { Plan: PlanNode }[] }>(
    `EXPLAIN (FORMAT JSON) ${statement.text}`,
    [...statement.params],
  );
  const root = result.rows[0]?.["QUERY PLAN"][0]?.Plan;
  if (!root) throw new Error("EXPLAIN returned no plan");
  const relations = new Set<string>();
  let excludedAtStartup = 0;
  const walk = (node: PlanNode): void => {
    const relation = node["Relation Name"];
    if (relation !== undefined && CHUNK_RELATION.test(relation)) relations.add(relation);
    excludedAtStartup += node["Chunks excluded during startup"] ?? 0;
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(root);
  return { chunks: relations.size, excludedAtStartup };
}

/** The fixture {@link seedDayChunks} wrote. */
export interface DayChunks {
  readonly assetId: string;
  readonly pointKey: string;
  /** `count(*)` of `show_chunks('telemetry.point_values')` after the insert. */
  readonly total: number;
}

/**
 * One row a day at `now() − 3 d … now() − 42 d` (40 days, so 40 one-day chunks at least) for a
 * random asset id on key `f4393_shape`. Run it inside a transaction the caller rolls back: the
 * chunks it creates go with the rollback.
 */
export async function seedDayChunks(client: Pick<pg.PoolClient, "query">): Promise<DayChunks> {
  const assetId = randomUUID();
  const pointKey = "f4393_shape";
  await client.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     SELECT now() - make_interval(days => d), $1::uuid, $2, d, 'kW'
       FROM generate_series(3, 42) AS d`,
    [assetId, pointKey],
  );
  const chunks = await client.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM show_chunks('telemetry.point_values')",
  );
  return { assetId, pointKey, total: Number(chunks.rows[0]?.total ?? 0) };
}
