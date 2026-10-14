import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.258` / ADR 0099 Amendment 2 — the static half of migration `0108`. The
 * live half, which executes the file against real rows, is
 * `tests/f4.258-committed-secrets-strip.integration.test.ts`; it skips without
 * a database, so the three claims a text read can hold are held here on every
 * machine.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6).
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const TAG = "0108_onboarding_committed_secrets_strip";
const migration = read(`packages/db/drizzle/${TAG}.sql`);
/** The executable text: `--` comments stripped, so header prose cannot satisfy a check. */
const executable = migration.replace(/--[^\n]*/g, "");

describe("F4.258 — migration 0108", () => {
  it("is registered in the drizzle journal", () => {
    // A .sql file drizzle never applies is this repo's most-repeated failure.
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.map((entry) => entry.tag)).toContain(TAG);
  });

  it("its header names F4.258 and ADR 0099 Amendment 2", () => {
    const header = migration.split(/\r?\n/).filter((line) => line.startsWith("--")).join("\n");
    expect({
      item: header.includes("F4.258"),
      adr: /ADR 0099 Amendment 2/.test(header),
    }).toEqual({ item: true, adr: true });
  });

  it("runs the UPDATE as the migrator, never inside a SET ROLE bracket", () => {
    // onboarding_sessions is FORCE ROW LEVEL SECURITY: as bms_owner with no GUC
    // the UPDATE would see no row (the 0071 rule).
    expect({
      update: /UPDATE\s+bms\.onboarding_sessions/i.test(executable),
      setRole: /\bSET\s+ROLE\b/i.test(executable),
    }).toEqual({ update: true, setRole: false });
  });
});
