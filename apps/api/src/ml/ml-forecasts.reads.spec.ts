import { PgDialect } from "drizzle-orm/pg-core";
import { PAST_FORECAST_MAX_LEAD_HOURS } from "@bms/shared";
import { expect } from "vitest";

import { HOUR_MS } from "./ml-forecasts.pure";
import { pastForecastStatement, uuidArray } from "./ml-forecasts.reads";

/**
 * `E1.4a` — the one piece of `ml-forecasts.reads.ts` a unit test can hold without a database:
 * the `uuid[]` literal the list read binds (PR 1 security review L2). The SQL itself is held by
 * `ml-forecasts.integration.spec.ts`. Entry point: `ml-forecasts.reads.test.ts` (ADR 0014).
 * `E1.4e` adds the past-forecast statement's text below.
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

export function aUuidListBecomesOneArrayLiteral(): void {
  expect(uuidArray([A, B])).toBe(`{${A},${B}}`);
  expect(uuidArray([])).toBe("{}");
}

export function anElementThatIsNotAUuidIsRefused(): void {
  for (const bad of [`${A},${B}`, `${A}}`, `"${A}"`, "not-a-uuid", ""]) {
    expect(() => uuidArray([A, bad]), JSON.stringify(bad)).toThrow(/not a UUID/);
  }
}

const dialect = new PgDialect();
/** Whitespace folded, so a re-indent is not a failure but a dropped clause is. */
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * `E1.4e` (ADR 0135 Amendment 4) — the past-forecast statement's text: the 1-hour-ahead rule
 * (issued before the bucket, at most `PAST_FORECAST_MAX_LEAD_HOURS` before it), the succeeded
 * join, the window, the newest-issue pick, and every value bound as a parameter. The rows it
 * selects are held against Postgres in `ml-forecasts.integration.spec.ts`.
 */
export function thePastStatementHoldsTheLeadRuleTheJoinAndTheWindow(): void {
  const hostileKey = "temp'; select 1; --";
  const point = { assetId: A, pointKey: hostileKey };
  const fromHourMs = Date.parse("2026-11-15T00:00:00.000Z");
  const endMs = fromHourMs + 10 * HOUR_MS;
  const query = dialect.sqlToQuery(pastForecastStatement(point, fromHourMs, endMs));
  const text = flat(query.sql);

  expect(text).toMatch(/^SELECT DISTINCT ON \(f\.horizon_bucket\)/);
  expect(text).toMatch(/ORDER BY f\.horizon_bucket, f\.issued_at DESC$/);
  expect(text).toContain(
    "JOIN ml.model_runs r ON r.id = f.model_run_id AND r.organization_id = f.organization_id AND r.status = 'succeeded'",
  );
  expect(text).toMatch(/f\.asset_id = \$\d+::uuid AND f\.point_key = \$\d+/);
  expect(text).toMatch(
    /f\.horizon_bucket >= to_timestamp\(\$\d+::float8 \/ 1000\) AND f\.horizon_bucket < to_timestamp\(\$\d+::float8 \/ 1000\)/,
  );
  expect(text).toContain("AND f.issued_at < f.horizon_bucket");
  expect(text).toMatch(/AND f\.issued_at >= f\.horizon_bucket - make_interval\(hours => \$\d+::int\)/);
  expect(text).toContain("::float8 AS bucket_ms");

  // Every value is a parameter: the request's text never reaches the statement.
  expect(query.params).toEqual([A, hostileKey, fromHourMs, endMs, PAST_FORECAST_MAX_LEAD_HOURS]);
  expect(query.sql).not.toContain(hostileKey);
  expect(query.sql).not.toContain(A);
  expect(PAST_FORECAST_MAX_LEAD_HOURS).toBe(3);
}
