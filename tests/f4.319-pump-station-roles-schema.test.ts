import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.319` / ADR 0113 decisions 3 and 4 — the static half of migration `0127`. The integration
 * half (`f4.319-pump-station-roles.integration.test.ts`) runs the two membership UPDATEs against a
 * database; this file holds the text a database run cannot see: the journal entry, the sort
 * orders, the bare `ON CONFLICT`, the post-check, the role bracket, and the predicate that keeps
 * an administrator's role.
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const TAG = "0127_pump_station_roles";
const SQL = read(`packages/db/drizzle/${TAG}.sql`);
/** The statements only: the header comments name the codes and the predicates in prose. */
const BODY = SQL.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

type JournalEntry = { idx: number; when: number; tag: string };
const JOURNAL = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as { entries: JournalEntry[] };

describe("F4.319 — migration 0127 (ADR 0113 decisions 3 and 4)", () => {
  it("is in the journal, after 0126, with a later `when`", () => {
    const entry = JOURNAL.entries.find((row) => row.tag === TAG);
    const previous = JOURNAL.entries.find((row) => row.tag === "0126_organization_control_room_views_and_catalog");
    expect(entry?.idx).toBe(128);
    expect(previous).toBeDefined();
    // The F4.94 class: a `when` not above the last applied one is skipped by drizzle.
    expect(entry!.when).toBeGreaterThan(previous!.when);
  });

  it("inserts exactly the two codes, at 195 and 200, with a bare ON CONFLICT DO NOTHING", () => {
    const insert = /INSERT INTO bms\.asset_roles \(code, label, sort_order\) VALUES([\s\S]*?);/.exec(BODY);
    expect(insert).not.toBeNull();
    const rows = [...insert![1]!.matchAll(/\('([a-z-]+)',\s*'([^']+)',\s*(\d+)\)/g)].map((m) => [m[1], m[2], Number(m[3])]);
    expect(rows).toEqual([
      ["dosing-pump", "Dosing pumps", 195],
      ["rtu-controller", "RTU controllers", 200],
    ]);
    expect(insert![1]).toMatch(/ON CONFLICT DO NOTHING\s*$/);
  });

  it("asserts both codes exist and are active in a DO block", () => {
    const block = /DO \$\$([\s\S]*?)\$\$;/.exec(BODY)?.[1] ?? "";
    expect(block).toContain("code = 'dosing-pump' AND active = true");
    expect(block).toContain("code = 'rtu-controller' AND active = true");
    expect(block.match(/RAISE EXCEPTION/g)).toHaveLength(2);
  });

  it("closes the bms_owner bracket before the membership updates", () => {
    const setRole = BODY.indexOf("SET ROLE bms_owner;");
    const reset = BODY.indexOf("RESET ROLE;");
    const firstUpdate = BODY.indexOf("UPDATE bms.asset_group_members");
    expect(setRole).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(setRole);
    // FORCE RLS: as bms_owner with no tenant GUC the updates would match no row.
    expect(firstUpdate).toBeGreaterThan(reset);
    expect(BODY.match(/^SET ROLE/gm)).toHaveLength(1);
    expect(BODY.match(/^RESET ROLE;/gm)).toHaveLength(1);
  });

  it("moves a chlorine pump only while its role is still `pump`", () => {
    const update = /UPDATE bms\.asset_group_members[\s\S]*?SET role = 'dosing-pump'([\s\S]*?);/.exec(BODY)?.[1] ?? "";
    expect(update).toContain("a.code LIKE 'PHE-PUMP-C-%'");
    expect(update).toContain("ag.code = 'electrical'");
    expect(update).toContain("agm.role = 'pump'");
  });

  it("gives an RTU-health unit `rtu-controller` only while its role is NULL", () => {
    const update = /UPDATE bms\.asset_group_members[\s\S]*?SET role = 'rtu-controller'([\s\S]*?);/.exec(BODY)?.[1] ?? "";
    expect(update).toContain("a.code LIKE 'PHE-AIRSP1051M-%'");
    expect(update).toContain("ag.code = 'environment'");
    expect(update).toContain("agm.role IS NULL");
  });
});
