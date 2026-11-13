import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, walk, withoutComments } from "./support/source-scan";

/**
 * `F4.359` (ADR 0131 decisions 6–10; plan D4, D9, U10) — the maintenance-window suppression
 * gate. Inline assertions (a top-level `tests/` file, AGENTS.md §4.6).
 *
 *  - **G1** the only non-spec files under `apps/api/src` that write `suppressed_at` or
 *    `unsuppressed_at` are `alarm-raise.service.ts` (the stamp at the raise) and
 *    `alarm-lifecycle.service.ts` (the sweep's stamp and lift). A write is a drizzle
 *    `.set({…})` / `.values({…})` / `set: {…}` object naming `suppressedAt:` or
 *    `unsuppressedAt:`, or SQL text assigning `suppressed_at =` / `unsuppressed_at =`, or a raw
 *    `INSERT INTO bms.alarms (…)` column list naming either. Reads — a `select({ suppressedAt:
 *    alarms.suppressedAt })`, `isNull(alarms.suppressedAt)`, `suppressed_at IS NULL` — do not trip it.
 *  - **G2** the non-spec files under `apps/api/src/alarms` and `apps/api/src/rules` that call
 *    `dispatchToChannels(`, `dispatchRememberingLostRows(` or `notifications.dispatch(` equal
 *    `DISPATCH_SITES`, each row saying how that site treats a suppressed alarm. A new dispatch site
 *    fails here until its row is written.
 *  - **G3** `rule-actions.ts`'s `notifyOnRaise` reads `raise.suppressed` before `shouldNotify(`.
 *
 * Every scan strips comments first, so a docblock that spells the construct cannot pass or fail
 * the gate, and each rule is also run on a mutated source to prove it can fail.
 */

const API_SRC = join(repoRoot, "apps/api/src");
const rel = (path: string): string => relative(repoRoot, path).replace(/\\/g, "/");
const nonSpecTs = (dir: string): string[] =>
  walk(dir).filter((f) => /\.tsx?$/.test(f) && !/\.(spec|test)\.tsx?$/.test(f));

/** The text from `open` (an index of `(` or `{`) to its balanced close, inclusive. */
function balanced(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === "(" || c === "{") depth += 1;
    else if (c === ")" || c === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

const SET_OBJECT = /\.(?:set|values)\(|\bset\s*:\s*\{/g;
const STAMP_KEY = /\b(?:un)?suppressedAt\s*:/;
const SQL_ASSIGN = /\b(?:un)?suppressed_at\s*=(?!=)/i;
const SQL_INSERT_COLUMNS = /insert\s+into\s+bms\.alarms\s*\([^)]*\b(?:un)?suppressed_at\b/i;

/** G1's rule over one source: does it write either suppression stamp. */
function writesSuppressionStamp(source: string): boolean {
  const text = withoutComments(source);
  if (SQL_ASSIGN.test(text) || SQL_INSERT_COLUMNS.test(text)) return true;
  for (const match of text.matchAll(SET_OBJECT)) {
    const open = match.index + match[0].length - 1;
    if (STAMP_KEY.test(balanced(text, open))) return true;
  }
  return false;
}

const DISPATCH_CALL = /(?:\bdispatchToChannels|\bdispatchRememberingLostRows|\bnotifications\.dispatch)\(/;

/** G2's list: every dispatch site, and how it treats a suppressed alarm. */
const DISPATCH_SITES: Readonly<Record<string, string>> = {
  "apps/api/src/alarms/alarm-lifecycle.service.ts":
    "the deps wiring only — forwards dispatchToChannels to NotificationsService; every caller is a phase gated below",
  "apps/api/src/alarms/alarm-lifecycle-phases.ts":
    "runClearPhase calls notifyCleared only when suppressedAt === null; runRaiseRetryPhase and runEscalationPhase skip suppressedAt !== null before dispatchRememberingLostRows",
  "apps/api/src/alarms/alarm-lifecycle-device.ts":
    "runDeviceClearPhase calls notifyDeviceCleared only when suppressedAt === null; runDeviceEscalationPhase skips suppressedAt !== null",
  "apps/api/src/rules/rule-actions.ts":
    "notifyOnRaise returns before dispatch on raise.suppressed (G3)",
};

/** `notifyOnRaise`'s body, comments stripped; `""` when the function is missing. */
function notifyOnRaiseBody(source: string): string {
  const text = withoutComments(source);
  const start = text.indexOf("export function notifyOnRaise(");
  if (start < 0) return "";
  const end = text.indexOf("\n}\n", start);
  return text.slice(start, end < 0 ? undefined : end);
}

/** G3's rule: the suppressed check sits before `shouldNotify(` in `notifyOnRaise`. */
function checksSuppressedFirst(source: string): boolean {
  const body = notifyOnRaiseBody(source);
  const suppressed = body.search(/\braise\.suppressed\b/);
  const notify = body.indexOf("shouldNotify(");
  return suppressed >= 0 && notify >= 0 && suppressed < notify;
}

describe("F4.359 suppression gate", () => {
  it("G1: only the raiser and the lifecycle sweep write suppressed_at / unsuppressed_at", () => {
    // The rule bites on every write shape, and ignores reads and comments.
    expect(writesSuppressionStamp("db.update(alarms).set({ suppressedAt: sql`now()` })")).toBe(true);
    expect(writesSuppressionStamp("db.update(alarms).set({ x: 1, unsuppressedAt: now })")).toBe(true);
    expect(writesSuppressionStamp("db.insert(alarms).values({ id, suppressedAt: now })")).toBe(true);
    expect(writesSuppressionStamp("onConflictDoUpdate({ target: alarms.id, set: { suppressedAt: now } })")).toBe(true);
    expect(writesSuppressionStamp("db.execute(sql`UPDATE bms.alarms SET suppressed_at = now()`)")).toBe(true);
    expect(writesSuppressionStamp("sql`UPDATE bms.alarms SET unsuppressed_at=${at}`")).toBe(true);
    expect(writesSuppressionStamp("sql`INSERT INTO bms.alarms (id, suppressed_at) VALUES (1, now())`")).toBe(true);
    expect(writesSuppressionStamp("db.select({ suppressedAt: alarms.suppressedAt }).from(alarms)")).toBe(false);
    expect(writesSuppressionStamp("where(isNull(alarms.suppressedAt))")).toBe(false);
    expect(writesSuppressionStamp("sql`${alarms.suppressedAt} IS NULL AND suppressed_at IS NOT NULL`")).toBe(false);
    expect(writesSuppressionStamp("return { ...alarm, suppressedAt: input.now };")).toBe(false);
    expect(writesSuppressionStamp(" * a lift sets `unsuppressed_at = now()` in the sweep")).toBe(false);

    const writers = nonSpecTs(API_SRC)
      .filter((f) => writesSuppressionStamp(readFileSync(f, "utf8")))
      .map(rel)
      .sort();
    expect(
      writers,
      "a suppression stamp has a writer outside AlarmRaiser and the lifecycle sweep (plan D4): " +
        "a third writer can stamp or lift without the raise path's or the sweep's gating",
    ).toEqual(["apps/api/src/alarms/alarm-lifecycle.service.ts", "apps/api/src/alarms/alarm-raise.service.ts"]);
  });

  it("G2: every dispatch site under alarms/ and rules/ is listed with its suppression treatment", () => {
    expect(DISPATCH_CALL.test("await deps.dispatchToChannels(channels, input);")).toBe(true);
    expect(DISPATCH_CALL.test("n += await dispatchRememberingLostRows(deps, {")).toBe(true);
    expect(DISPATCH_CALL.test("void deps.notifications.dispatch(input)")).toBe(true);
    expect(DISPATCH_CALL.test("deps.notifications.dispatchCleared(input)")).toBe(false);
    expect(DISPATCH_CALL.test(withoutComments(" * calls `dispatchToChannels(channels, input)`"))).toBe(false);

    const sites = [...nonSpecTs(join(API_SRC, "alarms")), ...nonSpecTs(join(API_SRC, "rules"))]
      .filter((f) => DISPATCH_CALL.test(withoutComments(readFileSync(f, "utf8"))))
      .map(rel)
      .sort();
    expect(
      sites,
      "a notification dispatch site changed: add its row to DISPATCH_SITES saying how it treats a " +
        "suppressed alarm (ADR 0131 decision 10 — a suppressed alarm notifies nobody)",
    ).toEqual(Object.keys(DISPATCH_SITES).sort());
    for (const [site, note] of Object.entries(DISPATCH_SITES)) {
      expect(note.trim().length, `${site} has no suppression note`).toBeGreaterThan(0);
    }
  });

  it("G3: notifyOnRaise reads raise.suppressed before shouldNotify", () => {
    const source = readFileSync(join(API_SRC, "rules/rule-actions.ts"), "utf8");
    expect(checksSuppressedFirst(source)).toBe(true);

    const body = notifyOnRaiseBody(source);
    const check = /\s*if \(raise\.suppressed\) \{\s*return false;\s*\}/;
    expect(check.test(body), "the G3 mutation below no longer finds the check — update it").toBe(true);
    // Moved below shouldNotify: the gate must fail.
    const moved = source
      .replace(check, "")
      .replace(/(if \(!shouldNotify\(rule\.action\)\) \{\s*return false;\s*\})/, "$1\n  if (raise.suppressed) {\n    return false;\n  }");
    expect(moved).not.toBe(source);
    expect(checksSuppressedFirst(moved)).toBe(false);
    // Removed, or left only in a comment: the gate must fail.
    expect(checksSuppressedFirst(source.replace(check, ""))).toBe(false);
    expect(checksSuppressedFirst(source.replace(check, "\n  // if (raise.suppressed) return false;"))).toBe(false);
  });
});
