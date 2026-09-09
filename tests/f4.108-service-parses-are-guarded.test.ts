import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.108` / **ADR 0060 §Verification** — the invariant a global
 * `@Catch(ZodError)` rests on.
 *
 * The filter answers **400**. It cannot tell who supplied the value that
 * failed, so the whole design is only honest while every `ZodError` still able
 * to reach it came from client input. A `.parse()` on data this application
 * stored, added later without a server-fault wrapper, would silently become a
 * 400 telling a caller that the server's own corrupt row is their bad request.
 * Nothing in the type system says that; this file does.
 *
 * Assertions are **inline**, which is §4.6's carve-out for the top-level
 * `tests/` directory. The root `vitest.config.ts` `repo` project globs
 * `tests/**\/*.test.ts`, and this file is listed by hand in the root
 * `package.json` `typecheck:tests` script — without that a file here is
 * type-checked by nothing.
 *
 * ---
 *
 * ## Why this file blanks comments and strings, and why that is not tidiness
 *
 * **ADR 0060 Amendment 1 exists because a measurement did not.** The script
 * that produced §Context's table matched `.parse(` in comment text and counted
 * `vocabularies/vocabularies.service.ts:335` — a docblock that discusses parse
 * sites *by name* — as a call. The ADR shipped naming ten sites where there
 * were nine. This repo writes long docblocks that quote the code they guard, so
 * a scanner that reads them is not slightly wrong here; it is wrong by
 * construction.
 *
 * `tests/support/source-scan.ts` already exports a `withoutComments`, and it is
 * deliberately **not** reused: it is line-keyed (it drops whole lines that
 * *start* with a comment marker), which loses every offset. This rule needs
 * offsets, because "is this call inside a `try`" is a question about position.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const API_SRC = "apps/api/src";

const STOCK_SERVICE = "apps/api/src/admin/asset-templates/asset-templates-stock.service.ts";
const TEMPLATES_SERVICE = "apps/api/src/admin/dashboard-templates/dashboard-templates.service.ts";
const INSTANTIATE_SERVICE =
  "apps/api/src/admin/dashboard-templates/dashboard-templates-instantiate.service.ts";
const HELPER = "apps/api/src/common/parse-stored-contract.ts";

/**
 * The one unguarded parse in a service that is **correct**, allowlisted by name
 * with its reason — ADR 0060 Amendment 1.
 *
 * `createAssetTemplateBodySchema.parse({ ...body, organizationId })` in
 * `AssetTemplatesStockService.import` stands on a **request path**:
 * `importStock` (`asset-templates.controller.ts:114`) wraps the call in a `try`
 * whose `catch` already maps a `ZodError` to `BadRequestException(flatten())`.
 * The global filter answers that same 400 if the controller's `catch` ever goes
 * away. Converting it to a server fault would turn a correct 400 into a 500 —
 * the exact inversion ADR 0060 exists to prevent, pointed the other way.
 *
 * Keyed by file **and receiver**, not by line: `:183` became `:198` in the very
 * commit that wrote this rule, so a line number here would be a maintenance
 * trap that fails on an unrelated edit above it.
 */
const ALLOWED_SITE = `${STOCK_SERVICE} createAssetTemplateBodySchema`;
const ALLOWED = new Set([ALLOWED_SITE]);

/**
 * Receivers whose `.parse` is not zod's and cannot raise a `ZodError`.
 *
 * A **denylist**, not an allowlist of schema-shaped names, and the direction is
 * the point: an unfamiliar `foo.parse(` in a service is reported rather than
 * ignored, so the failure mode is a human being asked to classify it. A rule
 * keyed on "the receiver ends in `Schema`" would go quiet the first time a
 * contract object is spelled any other way.
 *
 * These three are what the tree actually holds — `JSON.parse` in
 * `onboarding-chat`, `alarms` and `credential-crypto`, `Date.parse` in
 * `telemetry-write`.
 */
const NON_ZOD_RECEIVERS = new Set(["JSON", "Date", "Number", "Math"]);

/**
 * `source` with every comment and every string literal replaced by spaces,
 * **byte offset for byte offset**, newlines preserved.
 *
 * One left-to-right character scan, so the two directions of the trap are both
 * closed: a `//` inside a string literal does not open a comment, and a quote
 * inside a comment does not open a string. Reported line numbers stay true
 * because the output has the same length and the same newline positions as the
 * input.
 *
 * A regex alternation over comment-or-string cannot do this — it has no state,
 * so it matches whichever alternative starts first at each position and gets
 * `"http://x"` wrong in one direction and `/* a "quote" *\/` wrong in the other.
 *
 * What it still cannot see: a `/` that opens a **regex literal** containing a
 * quote or a `//`. No service in this tree writes one, and a wrong answer there
 * would over-report rather than under-report.
 *
 * `blankStrings` is `false` for the one caller that is *looking for* string
 * literals — the context-literal census below reads
 * `StoredContractContext`'s union members and the arguments matching them, and
 * blanking those would count zero of everything and pass on a technicality.
 * Comments are blanked for that caller too, which is the half that matters:
 * this file's own subject is a docblock that was mistaken for code.
 */
function blankCommentsAndStrings(source: string, blankStrings = true): string {
  const out = source.split("");
  const n = source.length;
  const wipe = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  let i = 0;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      let j = i + 2;
      while (j < n && source[j] !== "\n") j += 1;
      wipe(i, j);
      i = j;
      continue;
    }
    if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(source[j] === "*" && source[j + 1] === "/")) j += 1;
      const end = Math.min(j + 2, n);
      wipe(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      // A string is still SCANNED when `blankStrings` is false — otherwise a
      // `//` or a `/*` inside one would open a comment that never closes.
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = source[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === ch) {
          closed = true;
          break;
        }
        // Only a template literal may span lines. A newline inside `'`/`"`
        // means the delimiter never opened a string — an apostrophe in prose
        // that survived, say — so give up rather than swallow the rest of the
        // file looking for a partner.
        if (ch !== "`" && c === "\n") break;
        j += 1;
      }
      if (closed) {
        if (blankStrings) wipe(i, j + 1);
        i = j + 1;
        continue;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/**
 * The `[start, end)` offsets of every `try { … }` body, by brace depth.
 *
 * Depth-tracked rather than measured by proximity, which is how ADR 0060's
 * §Context table was built: a parse three lines below a closing brace *looks*
 * guarded and is not.
 */
function tryBlockRanges(code: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const opener = /\btry\s*\{/g;
  let match: RegExpExecArray | null = opener.exec(code);
  while (match !== null) {
    let depth = 1;
    let k = match.index + match[0].length;
    while (k < code.length && depth > 0) {
      if (code[k] === "{") depth += 1;
      else if (code[k] === "}") depth -= 1;
      k += 1;
    }
    ranges.push([match.index, k]);
    match = opener.exec(code);
  }
  return ranges;
}

/** `receiver.parse(` — a dotted receiver, not preceded by another identifier char. */
const PARSE_CALL = /(?<![.\w$])([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\.parse\(/g;

function serviceFiles(): string[] {
  const found: string[] = [];
  const pending: string[] = [API_SRC];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(join(repoRoot, current), { withFileTypes: true })) {
      const rel = `${current}/${entry.name}`;
      if (entry.isDirectory()) pending.push(rel);
      else if (entry.name.endsWith(".service.ts")) found.push(rel);
    }
  }
  return found.sort();
}

/** Every `.parse(` outside a `try`, in a service, whose receiver could be zod. */
function unguardedZodParses(): string[] {
  const offenders: string[] = [];
  for (const rel of serviceFiles()) {
    const code = blankCommentsAndStrings(read(rel));
    const ranges = tryBlockRanges(code);
    PARSE_CALL.lastIndex = 0;
    let match: RegExpExecArray | null = PARSE_CALL.exec(code);
    while (match !== null) {
      const receiver = match[1] as string;
      // `JSON.parse(` captures "JSON"; `this.contracts.parse(` captures
      // "this.contracts". The last segment is what names the object.
      const owner = receiver.split(".").pop() as string;
      const index = match.index;
      const guarded = ranges.some(([from, to]) => index >= from && index < to);
      if (!guarded && !NON_ZOD_RECEIVERS.has(owner)) {
        offenders.push(`${rel} ${receiver}`);
      }
      match = PARSE_CALL.exec(code);
    }
  }
  return offenders.sort();
}

describe("F4.108 / ADR 0060 — a stored-data parse never reaches the ZodError filter", () => {
  /**
   * The scanner reads code and not prose.
   *
   * This is the assertion Amendment 1 paid for, and it is first because every
   * other assertion in this file is a measurement taken through it.
   */
  it("blanks comments and string literals without moving any offset", () => {
    const fixture = [
      `const a = "not a // comment, and schemaA.parse( is text";`,
      `// schemaB.parse( inside a line comment`,
      `/* schemaC.parse( and an unmatched " quote */`,
      `const d = schemaD.parse(value);`,
    ].join("\n");
    const blanked = blankCommentsAndStrings(fixture);

    expect(blanked.length, "offsets must survive, or reported line numbers lie").toBe(
      fixture.length,
    );
    expect(blanked.split("\n").length).toBe(fixture.split("\n").length);

    const seen = [...blanked.matchAll(PARSE_CALL)].map((m) => m[1]);
    expect(
      seen,
      "only the real call survives: a `//` inside a string must not open a comment, and a " +
        "quote inside a comment must not open a string",
    ).toEqual(["schemaD"]);
  });

  /**
   * The rule itself. ADR 0060 §Verification: *"an assertion pins that **no**
   * throwing `.parse(` sits outside a `try` in a service, so a later service
   * parse added without a server-fault wrapper reddens rather than silently
   * becoming a 400."*
   *
   * The allowlisted site is asserted **present** first. Without that the
   * absence half is satisfied by a scanner that found nothing at all — and a
   * scanner that finds nothing is exactly what a bad walk, a bad blanking pass
   * or a bad `try` tracker all produce.
   */
  it("leaves exactly one unguarded service parse, the allowlisted client-input one", () => {
    const files = serviceFiles();
    expect(
      files.length,
      "the walk over apps/api/src found almost no *.service.ts — it is broken, and an empty " +
        "offender list below would mean nothing",
    ).toBeGreaterThanOrEqual(50);

    const offenders = unguardedZodParses();

    expect(
      offenders,
      "the allowlisted client-input parse in AssetTemplatesStockService.import was not found. " +
        "Either it was converted to a server fault — which would turn its correct 400 into a " +
        "500, and ADR 0060 Amendment 1 forbids it — or this scanner is broken and the absence " +
        "assertion below proves nothing.",
    ).toContain(ALLOWED_SITE);

    expect(
      offenders.filter((site) => !ALLOWED.has(site)),
      "a zod .parse() sits outside a try in a service. The global ZodErrorFilter answers 400 " +
        "for every ZodError that escapes, so this one now tells the caller that the server's " +
        "own stored row is their bad request. If it parses data this application stored, wrap " +
        "it in parseStoredContract (apps/api/src/common/parse-stored-contract.ts). If it " +
        "parses caller input on a request path, add it to ALLOWED with the reason.",
    ).toEqual([]);
  });

  /**
   * The eight actually moved.
   *
   * The absence assertion above goes quiet either way: once a site reads
   * `parseStoredContract(schema, …)` there is no `.parse(` left at it to find,
   * so "no offenders" is equally true of eight converted sites and of eight
   * sites deleted. This counts the positive.
   */
  it("routes all eight stored-data parses through parseStoredContract", () => {
    const occurrences = (rel: string): number =>
      (blankCommentsAndStrings(read(rel)).match(/parseStoredContract\(/g) ?? []).length;

    expect(
      { stock: occurrences(STOCK_SERVICE), templates: occurrences(TEMPLATES_SERVICE), instantiate: occurrences(INSTANTIATE_SERVICE) },
      "ADR 0060 Amendment 1 enumerates eight stored-data parses: one in the stock service, " +
        "five in dashboard-templates.service.ts and two in the instantiate service. A site " +
        "reverted to a bare .parse() answers 400 under the filter, which is ruling 2's " +
        "failure mode exactly.",
    ).toEqual({ stock: 1, templates: 5, instantiate: 2 });
  });

  /**
   * Each site keeps its own context literal.
   *
   * `StoredContractContext` is the site index: five of the eight parse the same
   * `sectionTemplateContentSchema`, so the literal is the only thing that says
   * *which* of them broke. Two sites sharing one literal compiles, passes the
   * count above, and quietly makes a 500 unattributable.
   */
  it("uses each StoredContractContext literal at exactly one call site", () => {
    const helper = blankCommentsAndStrings(read(HELPER), false);
    const union = helper.slice(helper.indexOf("export type StoredContractContext"));
    const declared = [...union.slice(0, union.indexOf(";")).matchAll(/"([^"]+)"/g)].map(
      (m) => m[1] as string,
    );

    expect(
      declared.length,
      "the StoredContractContext union no longer parses as a list of string literals, so the " +
        "per-site counts below would be vacuous",
    ).toBe(8);

    const callSites = [STOCK_SERVICE, TEMPLATES_SERVICE, INSTANTIATE_SERVICE]
      .map((rel) => blankCommentsAndStrings(read(rel), false))
      .join("\n");

    expect(
      Object.fromEntries(
        declared.map((literal) => [
          literal,
          (callSites.match(new RegExp(`"${literal}"`, "g")) ?? []).length,
        ]),
      ),
      "every context literal must name exactly one call site — it is the only thing that says " +
        "which of the five sectionTemplateContentSchema parses raised the 500. Add a literal " +
        "to the union rather than reusing one.",
    ).toEqual(Object.fromEntries(declared.map((literal) => [literal, 1])));
  });
});
