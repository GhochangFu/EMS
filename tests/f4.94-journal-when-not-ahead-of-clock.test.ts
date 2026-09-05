import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.94` — the drizzle journal must never carry a `when` ahead of the wall
 * clock. Drizzle applies a file only when `Number(lastDbMigration.created_at)
 * < migration.folderMillis`; a future-stamped entry sorts above a later,
 * honestly-stamped one, so the later migration is skipped, silently, on
 * every database that already ran the future one. Model:
 * `tests/adr-0055-min-coverage-ratio-migration.test.ts`.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/`
 * carve-out (§4.6).
 */
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const DRIZZLE_DIR = join(repoRoot, "packages", "db", "drizzle");

interface JournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

interface Journal {
  readonly entries: ReadonlyArray<JournalEntry>;
}

/**
 * The same clock-skew tolerance lives in `scripts/checks/drizzle-journal.mjs`
 * as `JOURNAL_CLOCK_SKEW_MS`. It cannot be imported here — an untyped `.mjs`
 * import fails `typecheck:tests` (`tests/pre-commit-gate.test.ts:13-25`
 * records why) — so the number is duplicated and must be kept in step by
 * hand.
 */
const JOURNAL_CLOCK_SKEW_MS = 60 * 60 * 1000;

const journal: Journal = JSON.parse(read(JOURNAL_REL)) as Journal;

/**
 * `new Date(w).toISOString()` throws `RangeError` when `|w| > 8.64e15`, and the
 * largest future stamp is exactly the one this file exists to report. A failure
 * message that throws while it is being built turns a clear assertion failure
 * into an unrelated stack trace, so the formatter degrades instead.
 * `scripts/checks/drizzle-journal.mjs` formats the same way.
 */
const MAX_DATE_MS = 8.64e15;

function isoOrOutOfRange(when: number): string {
  return Number.isFinite(when) && Math.abs(when) <= MAX_DATE_MS
    ? new Date(when).toISOString()
    : "out of Date range";
}

describe("F4.94 — journal `when` is strictly increasing", () => {
  it("no entry's `when` is at or below the previous entry's `when`", () => {
    const entries = journal.entries;
    for (let i = 1; i < entries.length; i += 1) {
      const previous = entries[i - 1];
      const current = entries[i];
      expect(
        current.when,
        `journal entry "${current.tag}" (when = ${current.when}) is not strictly greater ` +
          `than the previous entry "${previous.tag}" (when = ${previous.when}). Drizzle ` +
          "applies only migrations newer than the newest applied one, so an out-of-order " +
          "entry can never apply to an existing database.",
      ).toBeGreaterThan(previous.when);
    }
  });
});

describe("F4.94 — journal `when` is never ahead of the wall clock", () => {
  /**
   * Every other check here compares `when` numerically, and every comparison
   * against `NaN` is false. A string date or a missing `when` would therefore
   * pass the ordering and the clock check in silence, so the shape is asserted
   * before the value is.
   */
  it("every entry's `when` is a finite integer", () => {
    for (const entry of journal.entries) {
      expect(
        Number.isInteger(entry.when),
        `journal \`when\` ${entry.tag} = ${JSON.stringify(entry.when)} is not a finite ` +
          "integer. Drizzle compares it numerically, so every ordering check against it is " +
          "false and the entry's position in the chain is undefined.",
      ).toBe(true);
    }
  });

  it("every entry's `when` is at most one hour ahead of Date.now()", () => {
    const now = Date.now();
    for (const entry of journal.entries) {
      expect(
        entry.when,
        `journal \`when\` ${entry.tag} = ${entry.when} (${isoOrOutOfRange(entry.when)}) ` +
          "is ahead of the wall clock; the next generated migration takes Date.now(), which " +
          "is smaller, and is skipped on every database that already ran this entry.",
      ).toBeLessThanOrEqual(now + JOURNAL_CLOCK_SKEW_MS);
    }
  });
});

describe("F4.94 — journal tags and .sql files match, both directions", () => {
  const sqlTags = readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""));

  it("every .sql file has a journal entry", () => {
    const tagSet = new Set(journal.entries.map((e) => e.tag));
    const unjournaled = sqlTags.filter((t) => !tagSet.has(t));
    expect(
      unjournaled,
      `migration file(s) with no journal entry (drizzle will silently skip these): ` +
        unjournaled.join(", "),
    ).toEqual([]);
  });

  it("every journal entry has a matching .sql file", () => {
    const fileSet = new Set(sqlTags);
    const orphans = journal.entries.filter((e) => !fileSet.has(e.tag)).map((e) => e.tag);
    expect(
      orphans,
      `journal entry/entries with no .sql file (migrate will fail to read them): ` +
        orphans.join(", "),
    ).toEqual([]);
  });

  it("no tag is journaled twice", () => {
    const tags = journal.entries.map((e) => e.tag);
    const duplicates = tags.filter((t, i) => tags.indexOf(t) !== i);
    expect(duplicates, `duplicate journal tag(s): ${duplicates.join(", ")}`).toEqual([]);
  });
});

/**
 * The three assertions above keep this repository's journal honest. They say
 * nothing about the databases that already carry the future stamps, which is
 * what the pre-flight in `packages/db/src/migrate.ts` repairs. Comments are
 * stripped before the source is read: an `f3.1a` lesson, where a mention in a
 * comment kept a `toContain` green after the code it described had gone.
 */
describe("F4.94 — db:migrate re-syncs drizzle's stamps before it migrates", () => {
  it("calls the re-sync pre-flight before migrate()", () => {
    const source = read("packages/db/src/migrate.ts")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    const message =
      "db:migrate must re-sync drizzle's created_at stamps before migrate(); without it " +
      "every existing database keeps the future stamps and skips the next migration.";

    expect(source, message).toContain('from "drizzle-orm/migrator"');

    const resyncAt = source.indexOf("await resyncJournalStamps(");
    const migrateAt = source.indexOf("await migrate(db");
    expect(resyncAt, message).toBeGreaterThan(-1);
    expect(migrateAt, message).toBeGreaterThan(-1);
    expect(resyncAt, message).toBeLessThan(migrateAt);
  });
});
