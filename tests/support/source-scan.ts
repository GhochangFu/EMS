import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const skipDirs = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

/** Every file under `dir`, skipping the directories no rule in this repo scans. */
export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/*
 * The source scan the `bms.assets` reading rules in
 * `tests/integration-fixture-isolation.test.ts` share.
 *
 * It sat inside that file's `F4.67` describe until a second reading rule — the
 * positional-read rule — needed it. It lives here so both use one scanner rather
 * than two that can drift apart, and so that file stays under the AGENTS.md §4.5
 * length limit. **Nothing about it changed in the move**; the docstrings below
 * are the originals, including the defects they record.
 *
 * This directory deliberately holds no `*.test.ts`: the `repo` Vitest project
 * collects `tests/**` + `*.test.ts` only, so a module here is imported rather
 * than run, and it is typechecked as an import of the file that uses it.
 */

/** Stateless membership test — is there a `bms.assets` read in this file at all. */
export const READS_ASSETS_TABLE = /\bFROM\s+bms\.assets\b/;

/**
 * Prose about the rule is not the rule being broken — this file and the suites
 * involved all quote the offending queries in their header comments. Line-keyed,
 * matching the rollback rule below; a comment that opens mid-line after code is
 * not a shape this repo writes.
 */
export function withoutComments(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

/**
 * Every string literal in `source`, of all three JavaScript delimiters.
 *
 * **Scanned rather than matched by one regex, and that is the fix for three
 * separate defects the `F4.67` review measured in the first draft:**
 *
 * 1. It read backtick literals only. Six live sites in this tree write a
 *    `bms.assets` read as a double-quoted string, so the identical defect in
 *    that spelling scored **zero** offenders — a mutation that survived the
 *    rule outright.
 * 2. Its window was capped at 600 characters either side of `FROM
 *    bms.assets`, and an over-long literal produced no match and was reported
 *    as **clean** rather than as unanalysable. `rollup-conversion`'s own CTE
 *    already sits at ~70% of that cap.
 * 3. `` /`[^`]*…`/ `` happily spans from one literal's closing delimiter,
 *    through raw source, to the next literal's opening one — so both the
 *    offender text and the {@link ID_SCOPED} exemption could be computed over
 *    arbitrary code. Demonstrated on `locations.rls.integration.spec.ts`.
 *
 * A literal is bounded by its own delimiter, so there is no window to size and
 * no way to run past the close. Escapes are honoured; an unterminated `'`/`"`
 * ends at the newline, as it does in the language.
 *
 * **What this still cannot see**, kept next to the code rather than only in
 * the header: a `${...}` interpolation containing a nested backtick literal
 * ends the outer window early, and a query assembled by concatenation or held
 * in a `.sql` file never appears as one literal at all.
 */
export function stringLiterals(source: string): string[] {
  const out: string[] = [];
  const delimiters = new Set(['"', "'", "`"]);
  let i = 0;
  while (i < source.length) {
    const quote = source[i] as string;
    if (!delimiters.has(quote)) {
      i += 1;
      continue;
    }
    let j = i + 1;
    let closed = false;
    while (j < source.length) {
      const ch = source[j];
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === quote) {
        closed = true;
        break;
      }
      // Only a template literal may span lines; a newline inside `'`/`"` means
      // the delimiter was not a string opener at all (an apostrophe in prose
      // that survived comment-stripping, say), so give up on it rather than
      // swallowing the rest of the file looking for a partner.
      if (quote !== "`" && ch === "\n") {
        break;
      }
      j += 1;
    }
    if (closed) {
      out.push(source.slice(i, j + 1));
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * The files the rule covers: `.spec` / `.integration.test` suites, **and the
 * shared fixture helpers under `src/testing/`**.
 *
 * The helpers are in scope because `apps/api/src/testing/integration-fixtures.ts`
 * is this repo's named home for fixture resolution — moving a resolver there is
 * a plausible refactor, and without this the rule would go quiet with no test
 * failing to say so.
 *
 * `tests/` is deliberately NOT a root, which is the same reason the cleanup
 * rules give: this file quotes the forbidden query in its own mutation strings,
 * so scanning `tests/` would make the rule flag itself and need a
 * self-exemption — a hole worth more than it closes.
 * `tests/f1.7-seed-ownership.integration.test.ts` reads `bms.assets` and is
 * therefore unscanned; it holds no pattern read today.
 */
export function specsReadingAssets(): string[] {
  return ["apps", "packages"]
    .flatMap((root) => {
      try {
        return walk(join(repoRoot, root));
      } catch {
        return [];
      }
    })
    .filter(
      (f) =>
        /(\.spec|\.integration\.test)\.tsx?$/.test(f) ||
        /[\\/]src[\\/]testing[\\/][^\\/]+\.tsx?$/.test(f),
    )
    .filter((f) => READS_ASSETS_TABLE.test(withoutComments(readFileSync(f, "utf8"))))
    .map((f) => relative(repoRoot, f).replace(/\\/g, "/"))
    .sort();
}
