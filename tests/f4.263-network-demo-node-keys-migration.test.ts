import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.263` — migration `0112` renames the hyphenated node keys (`grid-cb`) that `seedNetworkDemo`
 * wrote before F4.263 to the underscore form `MIMIC_LAYOUT_NODE_KEY` accepts, so the `PUT` body of
 * a seeded `ND-` layout parses again. One column moves, `bms.mimic_layout_nodes.key`; the pipes
 * reference node ids and follow. Model: `tests/f2.29-asset-source-data-key-vars-migration.test.ts`;
 * the live behaviour is `tests/f4.263-network-demo-node-keys-migration.integration.test.ts`.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out (§4.6).
 */
const STEM = "0112_network_demo_node_keys";
const MIGRATION_REL = `packages/db/drizzle/${STEM}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const PREVIOUS = "0111_organization_llm_vision_model";

/** Comments stripped before every assertion — a header quoting SQL must not hold a `toContain` green. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");

type JournalEntry = { idx: number; when: number; tag: string };
const journalEntries = (): ReadonlyArray<JournalEntry> =>
  (JSON.parse(read(JOURNAL_REL)) as { entries: ReadonlyArray<JournalEntry> }).entries;

describe("F4.263 — migration 0112 renames the seeded hyphen node keys", () => {
  it("exists", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL))).toBe(true);
  });

  it("updates bms.mimic_layout_nodes, replacing every hyphen of the key", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toContain("UPDATE bms.mimic_layout_nodes AS n SET key = replace(n.key, '-', '_')");
  });

  it("is scoped to the two seeded slugs", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain(
      "l.slug IN ('network-demo-ht-lt', 'network-demo-flow')",
    );
  });

  it("touches only a key that holds a hyphen", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain("AND n.key LIKE '%-%'");
  });

  it("skips a key whose underscore twin already exists in the layout", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toMatch(
      /AND NOT EXISTS \( SELECT 1 FROM bms\.mimic_layout_nodes AS o WHERE o\.layout_id = n\.layout_id AND o\.key = replace\(n\.key, '-', '_'\)\)/,
    );
  });

  it("runs as the migrator, never inside a SET ROLE bracket (FORCE RLS would make it UPDATE 0)", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/\bSET ROLE\b/i);
  });

  it("changes no schema, policy or privilege", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/\b(POLICY|GRANT|REVOKE|ALTER|CREATE|DROP)\b/i);
  });

  it("has no statement-breakpoint marker, not even in a comment", () => {
    expect(read(MIGRATION_REL)).not.toContain("statement-breakpoint");
  });
});

describe("F4.263 — migration 0112 is journalled", () => {
  it("has a journal entry whose tag equals the filename stem", () => {
    expect(
      journalEntries().find((e) => e.tag === STEM),
      `no journal entry with tag "${STEM}" — drizzle skips an unjournalled .sql file silently`,
    ).toBeDefined();
  });

  it(`stamps a when strictly greater than ${PREVIOUS}'s`, () => {
    const entries = journalEntries();
    const previous = entries.find((e) => e.tag === PREVIOUS);
    expect(previous, `journal entry ${PREVIOUS} not found`).toBeDefined();
    expect(entries.find((e) => e.tag === STEM)?.when).toBeGreaterThan(previous!.when);
  });

  it("stamps a when that is not ahead of the clock (AGENTS.md §4.4)", () => {
    expect(journalEntries().find((e) => e.tag === STEM)?.when).toBeLessThanOrEqual(Date.now());
  });
});
