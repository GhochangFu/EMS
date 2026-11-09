import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Through the built subpath, as the 0130 test does: the ingest host and the
// worker load `dist/ingest.js`, so that is what must agree with the seed.
type Decoded =
  | { ok: true; records: Array<{ deviceKey: string; at?: Date; values: Record<string, unknown> }> }
  | { ok: false; reason: string };
type BinaryDefinition = {
  kind: string;
  length: number;
  byteOrder: string;
  time: { fields: Record<string, number>; utcOffsetMinutes: number };
  readings: Array<{ key: string; byte: number; type: string; scale: number; sentinels: number[] }>;
};
const require_ = createRequire(import.meta.url);
const { mqttPayloadFormatDefinitionSchema, decodeMqttPayload, hexToBytes } = require_("@bms/shared/ingest") as {
  mqttPayloadFormatDefinitionSchema: {
    safeParse(input: unknown): { success: true; data: BinaryDefinition } | { success: false; error: { issues: unknown[] } };
  };
  decodeMqttPayload(definition: unknown, topic: string, raw: Uint8Array): Decoded;
  hexToBytes(text: string): Uint8Array | null;
};

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0135_wbldc_temp_100_payload_format.sql";
const TAG = "0135_wbldc_temp_100_payload_format";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const seededDefinition = (): unknown => {
  const literal = /'(\{.*?\})'::jsonb/s.exec(sqlOnly(read(MIGRATION_REL)));
  expect(literal, "the seed row must carry a jsonb literal").not.toBeNull();
  return JSON.parse(literal?.[1] ?? "null");
};

/** The WBLDC frames captured 2026-11-09 (hex only, no login). */
const HEADER = "f2f01051" + "ea070b0009000f0024000000";
const frame = (readings: string): Uint8Array => {
  const bytes = hexToBytes(HEADER + readings + "00".repeat(76));
  if (bytes === null) throw new Error("fixture is not hex");
  return bytes;
};

/**
 * `F4.343` / ADR 0119 decision 6 — the static half of migration `0135`, which
 * seeds `wbldc-temp-100`. What Postgres does is owed to the local stack (the
 * PR body lists it). Assertions inline (§4.6, top-level `tests/`).
 */
describe("F4.343 — the wbldc-temp-100 seed (migration 0135)", () => {
  it("registers migration 0135 in the journal as idx 136, after 0134 and not ahead of now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const prev = journal.entries.find((e) => e.tag === "0134_portal_appearance");
    expect(entry, "migration 0135 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(prev?.when).toBe(1794207360214);
    expect(entry?.idx).toBe(136);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(prev?.when as number);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("seeds exactly one row, insert-only, without reverting a later edit", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration.match(/\bINSERT INTO bms\.mqtt_payload_formats\b/g)).toHaveLength(1);
    expect(migration.match(/\bINSERT INTO\b/gi)).toHaveLength(1);
    expect(migration.match(/^\s*\('[a-z0-9-]+',/gm)).toEqual(["  ('wbldc-temp-100',"]);
    expect(migration).toMatch(/\)\s*ON CONFLICT DO NOTHING;/);
    expect(migration).toMatch(/,\s*false\)\s*ON CONFLICT/);
    for (const forbidden of [/\bCREATE\b/i, /\bALTER\b/i, /\bGRANT\b/i, /\bREVOKE\b/i, /\bPOLICY\b/i, /\bSET ROLE\b/i]) {
      expect(migration).not.toMatch(forbidden);
    }
    // The marker drizzle splits on, before Postgres parses anything.
    expect(read(MIGRATION_REL)).not.toContain("--> statement-" + "breakpoint");
  });

  it("seeds a binary definition the shared schema accepts, as ADR 0119 decision 6 states it", () => {
    const parsed = mqttPayloadFormatDefinitionSchema.safeParse(seededDefinition());
    expect(parsed.success, JSON.stringify("error" in parsed ? parsed.error.issues : null)).toBe(true);
    if (!parsed.success) return;
    const definition = parsed.data;
    expect(definition.kind).toBe("binary");
    expect(definition.length).toBe(100);
    expect(definition.byteOrder).toBe("little");
    expect(definition.time).toEqual({
      fields: { year: 4, month: 6, day: 8, hour: 10, minute: 12, second: 14 },
      utcOffsetMinutes: 330,
    });
    expect(definition.readings.map((r) => r.key)).toEqual(Array.from({ length: 16 }, (_, i) => `temp_ch${i}`));
    expect(definition.readings.map((r) => r.byte)).toEqual(Array.from({ length: 16 }, (_, i) => 16 + i * 2));
    for (const reading of definition.readings) {
      expect(reading).toEqual({ key: reading.key, byte: reading.byte, type: "int16", scale: 0.1, sentinels: [-32767, -32766] });
    }
  });

  it("decodes the golden frames with the seeded definition (seed, schema and decoder cannot drift)", () => {
    const parsed = mqttPayloadFormatDefinitionSchema.safeParse(seededDefinition());
    if (!parsed.success) throw new Error("the seed does not parse");
    const goat = decodeMqttPayload(parsed.data, "Haringhata_GOAT", frame("0f010301acff2a00"));
    if (!goat.ok) throw new Error("the GOAT frame did not decode");
    expect(goat.records[0]?.deviceKey).toBe("Haringhata_GOAT");
    expect(goat.records[0]?.at?.toISOString()).toBe("2026-11-09T10:06:00.000Z");
    expect(goat.records[0]?.values.temp_ch0).toBe(27.1);
    expect(goat.records[0]?.values.temp_ch2).toBe(-8.4);
    const vap = decodeMqttPayload(parsed.data, "Haringhata_VAP", frame("69ff340001800280"));
    if (!vap.ok) throw new Error("the VAP frame did not decode");
    expect(vap.records[0]?.values.temp_ch0).toBe(-15.100000000000001);
    expect("temp_ch2" in (vap.records[0]?.values ?? {})).toBe(false);
  });

  it("describes the row in fixed text the copilot lists (ADR 0119 decision 7)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const row = migration.slice(migration.indexOf("('wbldc-temp-100',"));
    const description = /^\s*'([^']*)',\s*$/m.exec(row.split("\n").slice(1).join("\n"));
    expect(description?.[1]).toMatch(/\bbinary\b/i);
    expect(description?.[1]).toContain("100 bytes");
  });

  it("no seed in packages/db/src mentions wbldc", () => {
    const dir = join(repoRoot, "packages/db/src");
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
    const mentions = (needle: string) =>
      sources.filter((f) => readFileSync(join(dir, f), "utf8").toLowerCase().includes(needle));
    // Positive control: the scan reaches the seeds (the demo seed names location_types).
    expect(mentions("location_types").length).toBeGreaterThan(0);
    expect(mentions("wbldc")).toEqual([]);
  });
});
