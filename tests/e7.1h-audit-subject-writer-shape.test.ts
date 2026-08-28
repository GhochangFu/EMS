import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const apiSrc = join(repoRoot, "apps", "api", "src");

/**
 * `E7.1h` / ADR 0046 Amendment 2 — **the writers' half of the redaction.**
 *
 * `tests/e7.1h-audit-subject-redaction-guard.test.ts` pins the reader: a
 * non-`admin` caller gets `payload - 'oidcSubject'`. That operator is a
 * **top-level** jsonb key removal. It is correct today only because all 16
 * write sites put the key at the top level of `payload`, which `E7.1h` verified
 * by reading each one rather than trusting ADR 0046's own claim — the same ADR
 * whose decision 3 `E7.1e` found wrong as written.
 *
 * **Nothing held that.** The `E7.1h` security review named it: the top-level
 * assumption lived in a doc comment, and a seventeenth write site nesting the
 * key one level deeper would defeat the scrub in silence. No test failed, no
 * type broke, and the reader's own guard cannot see it — it inspects
 * `audit.service.ts` and the writers are in six other services. The tenant
 * would simply start receiving the operator's IdP subject again.
 *
 * This file is that gate. It is **static, and says so** (§4.4): the property is
 * about *every future writer*, so no fixture can express it. A behavioural test
 * can only prove the sites that exist today already redact, which
 * `audit.integration.spec.ts` does.
 *
 * **It does not forbid a new write site.** Recording the acting operator is
 * what `payload` is for. It requires only that the key stay where the reader
 * can reach it. A site that genuinely needs it nested is a real decision — take
 * it to the owner, because the fix is a recursive scrub in `selectRows` and
 * that is an ADR 0046 amendment, not an implementation detail.
 */

/** Every `.ts` under `apps/api/src` that ships, tests excluded. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".spec.ts") || entry.name.endsWith(".test.ts")) continue;
    found.push(full);
  }
  return found;
}

/**
 * Blanks comments and string/template literals, preserving length and newlines.
 *
 * Indices stay valid, so a match found in the blanked text points at the same
 * offset in the original. Two consequences worth stating rather than
 * discovering: `audit.service.ts`'s own `- 'oidcSubject'` lives inside a `sql`
 * template and is therefore invisible here, which is correct — it is the reader,
 * not a writer. And a regex literal containing a quote would desynchronise the
 * scan; the floor assertion below is what turns that into a loud failure
 * instead of a quiet one.
 */
function blankNonCode(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      let j = i + 2;
      while (j < n && source[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(source[j] === "*" && source[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === c) break;
        j++;
      }
      j = Math.min(j + 1, n);
      blank(i, j);
      i = j;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** The source text immediately before the innermost `{` enclosing `index`. */
function enclosingObjectPrefix(code: string, index: number): string | null {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = code[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) return code.slice(Math.max(0, i - 60), i);
      depth--;
    }
  }
  return null;
}

type Site = { file: string; line: number; prefix: string | null };

const sites: Site[] = [];
for (const file of sourceFiles(apiSrc)) {
  const original = readFileSync(file, "utf8");
  if (!original.includes("oidcSubject")) continue;
  const code = blankNonCode(original);
  for (const match of code.matchAll(/\boidcSubject\s*:/g)) {
    const index = match.index ?? 0;
    sites.push({
      file: relative(repoRoot, file).replace(/\\/g, "/"),
      line: original.slice(0, index).split("\n").length,
      prefix: enclosingObjectPrefix(code, index),
    });
  }
}

describe("E7.1h / ADR 0046 Amendment 2 — every writer keeps oidcSubject where the reader can remove it", () => {
  it("finds the audit write sites at all", () => {
    // Not a count assertion — a new audited mutation is ordinary work and must
    // not break the build. This is a floor, and its only job is to stop the
    // scan passing vacuously: if `blankNonCode` desynchronises or the key is
    // renamed, `sites` empties and every assertion below becomes trivially
    // true. E7.1g's lesson, applied to a source scan instead of a fixture.
    expect(
      sites.length,
      `found ${sites.length} oidcSubject write sites under apps/api/src; there were 16 at ` +
        "E7.1h. A drop to zero means the scanner broke, not that the writers stopped " +
        "recording the operator. If sites were deliberately removed, lower this floor in " +
        "the same commit and say why.",
    ).toBeGreaterThanOrEqual(16);
  });

  it("keeps every one of them a direct child of `payload`", () => {
    const nested = sites.filter((site) => !/payload\s*:\s*$/.test(site.prefix ?? ""));
    expect(
      nested.map((site) => `${site.file}:${site.line}`),
      "these sites write `oidcSubject` somewhere other than the top level of an audit " +
        "`payload` object. `AuditAdminService.selectRows` removes it with the jsonb `-` " +
        "operator, which deletes a TOP-LEVEL key only, so a nested one is returned to every " +
        "tenant admin that reads the audit log — silently, with no test and no type failing. " +
        "Either lift the key to the top level of its `payload`, or take the nesting to the " +
        "owner: the fix on the reader's side is a recursive scrub, which is an ADR 0046 " +
        "amendment and not an implementation detail.",
    ).toEqual([]);
  });
});
