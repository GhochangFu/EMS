import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0091_mimic_lucide_licence.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SHARED_REGISTRY_REL = "packages/shared/src/mimic-symbol-libraries/index.ts";
const GENERATOR_REL = "scripts/mimic-symbols/generate.mjs";
const SHARED_LUCIDE_REL = "packages/shared/src/mimic-symbol-libraries/lucide.generated.ts";
const WEB_LUCIDE_REL = "apps/web/src/components/widgets/mimic-symbol-libraries/lucide.generated.ts";
const TAG = "0091_mimic_lucide_licence";
/** 0090's `when` — the F4.94 class: a stamp not above the last applied one is skipped. */
const WHEN_0090 = 1790672932525;

const UPDATE = "UPDATE bms.mimic_symbol_libraries SET licence = 'ISC and MIT' WHERE code = 'lucide';";
const HEADER_LINE = "// Lucide — ISC and MIT. The full licence notice is";

/** Strip `--` comment lines before a scan — a raw scan is satisfied by a comment quoting the
 * statement it explains (the `f3.1a` lesson). 0091's header names its statement. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migration = (): string => sqlOnly(read(MIGRATION_REL));
const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

/** The slice from `head` to the first `end` after it (inclusive); throws if either is missing. */
const sliceBetween = (text: string, head: string, end: string, what: string): string => {
  const start = text.indexOf(head);
  if (start < 0) throw new Error(`${what}: no ${JSON.stringify(head)}`);
  const stop = text.indexOf(end, start + head.length);
  if (stop < 0) throw new Error(`${what}: no ${JSON.stringify(end)} after the head`);
  return text.slice(start, stop + end.length);
};

/** The DO block, from `DO $$` to the last `END $$;`; throws if either is missing. */
const doBlock = (sql: string): string => {
  const start = sql.indexOf("DO $$");
  const stop = sql.lastIndexOf("END $$;");
  if (start < 0 || stop < start) throw new Error("0091: no DO $$ … END $$; block");
  return sql.slice(start, stop + "END $$;".length);
};

/**
 * `F3.32f` / ADR 0086 decision 10 — the carried review fixes of slice 1: migration `0091`
 * corrects the Lucide licence label to "ISC and MIT" (16 of the 126 curated icons are
 * Feather-derived under MIT, and 0090 is frozen), and the registry, the generator and both
 * generated headers say the same. The live half is
 * `tests/f3.32f-carried-fixes.integration.test.ts`; the registry-equals-rows claim lives in
 * `tests/f3.32e-mimic-symbol-libraries.test.ts`, which overlays 0091 on 0090.
 * Assertions inline, no `.spec` sibling (§4.6).
 */
describe("F3.32f — migration 0091: the Lucide licence label", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(migration()).toContain(UPDATE);
  });

  it("registers migration 0091 in the journal at idx 91, after 0090 and not ahead of the clock", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as { entries: Array<Record<string, unknown>> };
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, "migration 0091 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(91);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(WHEN_0090);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  describe("the role bracket", () => {
    it("has exactly one SET ROLE bms_owner; and one RESET ROLE;", () => {
      const sql = migration();
      expect(countOf(sql, "SET ROLE bms_owner;")).toBe(1);
      expect(countOf(sql, "RESET ROLE;")).toBe(1);
    });

    it("runs the UPDATE inside the bracket", () => {
      const sql = migration();
      const set = sql.indexOf("SET ROLE bms_owner;");
      const update = sql.indexOf(UPDATE);
      const reset = sql.indexOf("RESET ROLE;");
      expect(set, "SET ROLE bms_owner; must be present").toBeGreaterThan(-1);
      expect(update, "the UPDATE must follow SET ROLE bms_owner;").toBeGreaterThan(set);
      expect(reset, "RESET ROLE; must follow the UPDATE").toBeGreaterThan(update);
    });

    it("puts the DO $$ block after RESET ROLE;, and ends the file with END $$;", () => {
      const sql = migration();
      expect(sql.indexOf("RESET ROLE;")).toBeGreaterThan(-1);
      expect(sql.indexOf("DO $$")).toBeGreaterThan(sql.indexOf("RESET ROLE;"));
      expect(sql.trimEnd().endsWith("END $$;")).toBe(true);
    });
  });

  it("issues exactly one UPDATE, and it is the lucide licence UPDATE", () => {
    const updates = [...migration().matchAll(/\bUPDATE\b[^;]*;/g)].map((m) => m[0]);
    expect(updates).toEqual([UPDATE]);
  });

  it("the DO $$ block asserts the effect with IS DISTINCT FROM 'ISC and MIT'", () => {
    expect(doBlock(migration())).toContain("IS DISTINCT FROM 'ISC and MIT'");
  });

  it("issues no GRANT, CREATE, ALTER, INSERT, DELETE, row security or policy", () => {
    const sql = migration();
    // Positive control: the scan reads statements at all.
    expect(sql).toMatch(/\bUPDATE\b/);
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bCREATE\b/i);
    expect(sql).not.toMatch(/\bALTER\b/i);
    expect(sql).not.toMatch(/\bINSERT\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/\bPOLICY\b/i);
  });
});

describe("F3.32f — the Lucide licence label outside the migration", () => {
  it("the shared registry's lucide entry reads licence \"ISC and MIT\" (source, not dist)", () => {
    const entry = sliceBetween(read(SHARED_REGISTRY_REL), 'code: "lucide",', "}", "registry lucide");
    expect(entry).toMatch(/\blicence: "ISC and MIT",/);
  });

  it("the generator's lucide entry reads licenceName \"ISC and MIT\"", () => {
    const entry = sliceBetween(read(GENERATOR_REL), 'code: "lucide",', "load: lucideSource", "generator lucide");
    expect(entry).toMatch(/\blicenceName: "ISC and MIT",/);
  });

  it("the shared lucide.generated.ts header says ISC and MIT", () => {
    expect(read(SHARED_LUCIDE_REL).split("\n")).toContain(
      `${HEADER_LINE} \`LUCIDE_LICENCE_NOTICE\` in`,
    );
  });

  it("the web lucide.generated.ts header says ISC and MIT", () => {
    expect(read(WEB_LUCIDE_REL).split("\n")).toContain(
      `${HEADER_LINE} \`LUCIDE_LICENCE_NOTICE\` in`,
    );
  });

  it("the web Lucide notice carries the ISC text, the MIT text and the Feather attribution", () => {
    const module = read(WEB_LUCIDE_REL);
    expect(module).toContain("ISC License");
    expect(module).toContain("The MIT License (MIT)");
    expect(module).toContain("Feather");
  });

  it("scripts/mimic-symbols/generate.mjs parses", () => {
    const result = spawnSync(process.execPath, ["--check", join(repoRoot, GENERATOR_REL)], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
