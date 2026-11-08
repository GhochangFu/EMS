import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0131_rtu_released_mqtt_topic.sql";
const TAG = "0131_rtu_released_mqtt_topic";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The text of `name` from its declaration to the next top-level declaration. */
const sliceFrom = (source: string, start: string, end: RegExp): string => {
  const from = source.indexOf(start);
  expect(from, `${start} must exist`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(from + start.length);
  const stop = rest.search(end);
  return stop < 0 ? rest : rest.slice(0, stop);
};

/**
 * `F4.339` / ADR 0117 decision 8 (plan T4.1) — the static half of migration `0131`
 * (`bms.rtus.released_mqtt_topic`). What Postgres enforces is owed to the local stack (the PR
 * body lists it). Assertions inline (§4.6, top-level `tests/`).
 */
describe("F4.339 — bms.rtus.released_mqtt_topic (migration 0131)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(sqlOnly(read(MIGRATION_REL)).split(";").filter((s) => s.trim().length > 0).length).toBe(3);
  });

  it("registers migration 0131 in the journal as idx 132, after 0130 and not ahead of now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const prev = journal.entries.find((e) => e.tag === "0130_mqtt_payload_formats");
    expect(entry, "migration 0131 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(prev?.when).toBe(1794119871850);
    expect(entry?.idx).toBe(132);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(prev?.when as number);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
    // Migration review L1: newer than every earlier entry, so a rebase over another migration is caught.
    const earlier = journal.entries.filter((e) => (e.idx as number) < 132).map((e) => e.when as number);
    expect(entry?.when as number).toBeGreaterThan(Math.max(...earlier));
  });

  it("adds the nullable column idempotently, inside SET ROLE bms_owner / RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const setRole = migration.indexOf("SET ROLE bms_owner;");
    const alter = migration.indexOf("ALTER TABLE bms.rtus ADD COLUMN IF NOT EXISTS released_mqtt_topic varchar(255);");
    const reset = migration.indexOf("RESET ROLE;");
    expect(setRole).toBeGreaterThanOrEqual(0);
    expect(alter).toBeGreaterThan(setRole);
    expect(reset).toBeGreaterThan(alter);
  });

  it("issues no GRANT, POLICY, INDEX or UPDATE (plan R6: rtus_mqtt_topic_idx is unchanged; no backfill)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(/\bPOLICY\b/i);
    expect(migration).not.toMatch(/\bINDEX\b/i);
    expect(migration).not.toMatch(/\bUPDATE\b/i);
  });

  it("declares the Drizzle column inside rtus", () => {
    const table = sliceFrom(read("packages/db/src/schema/bms-schema.ts"), 'export const rtus = bmsSchema.table("rtus", {', /\n\}\);/);
    expect(table).toContain('releasedMqttTopic: varchar("released_mqtt_topic", { length: 255 })');
  });

  it("no seed writes released_mqtt_topic", () => {
    const seeds = readdirSync(join(repoRoot, "packages/db/src"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => read(`packages/db/src/${name}`));
    // Positive control: the scan reads the RTU seed, which writes mqtt_topic.
    expect(read("packages/db/src/phe-pilot-seed.ts")).toContain("mqtt_topic");
    expect(seeds.length).toBeGreaterThan(0);
    for (const seed of seeds) {
      expect(seed).not.toContain("released_mqtt_topic");
    }
  });
});
