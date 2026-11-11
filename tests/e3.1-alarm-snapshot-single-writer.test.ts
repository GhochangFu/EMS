import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, walk } from "./support/source-scan";

/**
 * `E3.4`, folded into `E3.1` (ADR 0122 decision 5a.2, plan T4.2 and D17) — the alarm
 * snapshot has ONE writer and no request door. Static, and it says so (AGENTS.md 4.4):
 * a second writer added to a status or root-cause path would pass every behavioural
 * test that does not happen to send it a value. Assertions inline (section 4.6).
 *
 * (a) Under `apps/api/src`, the four Drizzle snapshot columns are written — appear as an
 *     object key — in `work-orders/work-order-create.ts` only. Reading them
 *     (`workOrders.alarmRootCause`) is allowed anywhere.
 * (b) No raw SQL under `apps/api/src` assigns one of the four database columns.
 * (c) No request body schema in `packages/shared/src/contracts` has a key that names
 *     the snapshot: a value sent by a browser could be forged.
 *
 * Comments are stripped before each scan, so prose about the columns is not read as code.
 */

const THE_ONE_WRITER = "apps/api/src/work-orders/work-order-create.ts";
const DRIZZLE_KEYS = ["alarmRootCause", "alarmCorrectiveActions", "alarmSkillCode", "alarmEtrAt"];
const SQL_COLUMNS = ["alarm_root_cause", "alarm_corrective_actions", "alarm_skill_code", "alarm_etr_at"];

/** Block comments, then line comments not preceded by `:` (a URL) or inside a quote. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** `key:` as an object key or shorthand-free assignment, not `workOrders.key` (a read) and not `snapshotKey:` (an alias). */
const writesKey = (code: string, key: string): boolean => new RegExp(`(?<![.\\w])${key}\\s*:`).test(code);

/** `column =` in a SET list or `column` in an INSERT column list — any raw assignment. */
const assignsColumn = (code: string, column: string): boolean =>
  new RegExp(`\\b${column}\\b\\s*=(?!=)|INSERT[^;]*\\b${column}\\b`, "i").test(code);

function apiSources(): Array<{ rel: string; code: string }> {
  return walk(join(repoRoot, "apps", "api", "src"))
    .filter((file) => file.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(file))
    .map((file) => ({ rel: relative(repoRoot, file).replace(/\\/g, "/"), code: stripComments(readFileSync(file, "utf8")) }));
}

describe("E3.4 — the alarm snapshot has one writer", () => {
  it("the scan reads real source", () => {
    expect(apiSources().length, "the walk found no source — it is broken").toBeGreaterThan(50);
  });

  it("the four snapshot columns are written in work-order-create.ts only", () => {
    const writers = apiSources()
      .filter(({ code }) => DRIZZLE_KEYS.some((key) => writesKey(code, key)))
      .map(({ rel }) => rel);
    expect(writers).toEqual([THE_ONE_WRITER]);
  });

  it("the one writer writes all four", () => {
    const code = stripComments(readFileSync(join(repoRoot, THE_ONE_WRITER), "utf8"));
    expect(DRIZZLE_KEYS.filter((key) => !writesKey(code, key))).toEqual([]);
  });

  it("no raw SQL under apps/api/src assigns a snapshot column", () => {
    const offenders = apiSources()
      .filter(({ code }) => SQL_COLUMNS.some((column) => assignsColumn(code, column)))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("the scans kill the writers they exist to catch", () => {
    expect(writesKey("tx.update(workOrders).set({ status, alarmRootCause: dto.alarmRootCause })", "alarmRootCause")).toBe(true);
    expect(writesKey(".set({\n  alarmEtrAt : null,\n})", "alarmEtrAt")).toBe(true);
    expect(writesKey("select({ snapshotRootCause: workOrders.alarmRootCause })", "alarmRootCause"), "a read is not a write").toBe(false);
    expect(writesKey("row.alarmRootCause !== null ? 1 : 2", "alarmRootCause"), "a ternary on a read").toBe(false);
    expect(assignsColumn("sql`UPDATE bms.work_orders SET alarm_root_cause = ${value}`", "alarm_root_cause")).toBe(true);
    expect(assignsColumn("INSERT INTO bms.work_orders (id, alarm_etr_at) VALUES ($1, $2)", "alarm_etr_at")).toBe(true);
    expect(assignsColumn("SELECT alarm_root_cause FROM bms.work_orders WHERE alarm_root_cause == 1", "alarm_root_cause")).toBe(false);
  });

  it("no request body in the shared contracts has a snapshot key", () => {
    const dir = join(repoRoot, "packages", "shared", "src", "contracts");
    const offenders = walk(dir)
      .filter((file) => /-writes\.ts$/.test(file))
      .filter((file) => /\balarm(RootCause|CorrectiveActions|SkillCode|EtrAt|Snapshot)\b\s*:/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(repoRoot, file).replace(/\\/g, "/"));
    expect(walk(dir).filter((file) => /-writes\.ts$/.test(file)).length, "the walk found no body file").toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});
