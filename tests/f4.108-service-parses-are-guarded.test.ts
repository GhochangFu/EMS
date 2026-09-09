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
 * ## What this scans — every non-test `.ts`, not only `*.service.ts`
 *
 * It scanned `*.service.ts` for `.parse(` when it was written, and review named
 * the hole. **The filter is registered globally, so it catches a `ZodError`
 * raised anywhere in the process.** A stored-data parse added to a mapper, a
 * repository, a plain helper module or a controller — or spelled
 * `.parseAsync(` — became a silent 400 with nothing here reddening. The narrow
 * rule matched the eight sites ADR 0060 moved, not the surface the filter
 * actually covers. So: every non-test `.ts` under `apps/api/src`, and both
 * spellings.
 *
 * The widening pulls in `apps/api/src/testing/` and every other non-domain
 * module, and that is deliberate rather than overreach — those compile into the
 * same process and a `ZodError` from one reaches the same filter.
 *
 * **Controllers are excused as a class, with the reason.** A controller parse
 * validates what the client sent — that is what a controller *is* — so 400 is
 * the honest answer there, and the global filter is what supplies it. 45 of the
 * 46 unguarded sites in the tree are controller sites and every one of them is
 * correct; excusing them by file suffix rather than listing 45 entries keeps the
 * rule readable. A blanket exclusion needs its own control, because an
 * over-broad one empties the list in silence, so the assertions below pin both
 * that the walk still reaches controllers and that it has not swallowed the one
 * non-controller site.
 *
 * **This widening changes no outcome today.** Two censuses run independently at
 * review time found no unguarded stored-data parse outside the one allowlisted
 * site, and the tree holds zero `.parseAsync(` calls. It is hardening, and only
 * a mutation demonstrates it landed.
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
 * The one unguarded parse outside a controller that is **correct**, allowlisted
 * by name with its reason — ADR 0060 Amendment 1.
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
 * What it still cannot see: a `/` that opens a **regex literal**. The sentence
 * that stood here claimed a wrong answer "would over-report rather than
 * under-report". That is a guarantee this code cannot give, and review measured
 * it: the blind spot fails in **both** directions, and the dangerous one is the
 * silent one. A regex literal is not blanked, so its braces are counted by
 * `tryBlockRanges` below:
 *
 * - **An unmatched `}`** — `/\}/`, or `/\{[^}]*\}/`, whose `[^}]` and `\}` are
 *   two closers against one opener — drops the depth to zero early, so a `try`
 *   range ends before its real closing brace and a genuinely guarded parse after
 *   it is reported. **Over-reports**, which is loud and gets read.
 * - **An unmatched `{`** — `/[{]/`, say — extends the range past the closing
 *   brace, so a later real unguarded parse falls inside it and looks guarded.
 *   **Under-reports**, silently, which is the exact failure this file exists to
 *   prevent.
 *
 * Only a regex inside a `try` body can do either, and only within its own file:
 * ranges and offenders are both computed per file.
 *
 * **Re-measured after the scan widened, and it is no longer vacuous.** Across
 * the 64 `*.service.ts` files there were no brace-bearing regex literals at all.
 * Across every non-test `.ts` there is one:
 * `admin/asset-points/mapping-sheet-rows.ts` declares `const BRACED =
 * /\{[^}]*\}/`, which leaves that file at 90 `{` against 91 `}` — the
 * over-report direction. It is harmless today, because the declaration is
 * top-level and well before that file's only `try`, and the file holds no
 * `.parse(` at all. "Harmless today" is not a property to leave in prose, so the
 * brace-balance `it()` below gates the condition that makes it harmless.
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

/**
 * `receiver.parse(` or `receiver.parseAsync(` — a dotted receiver, not preceded
 * by another identifier char.
 *
 * `parseAsync` is zod's second entry point and throws the same `ZodError`. The
 * tree holds none today, so nothing in the offender list changes; the fixture
 * assertion below is what actually holds this half of the pattern.
 */
const PARSE_CALL = /(?<![.\w$])([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\.parse(?:Async)?\(/g;

/** The suffix the class-wide controller allowance keys on — see the header. */
const CONTROLLER_SUFFIX = ".controller.ts";

/** Every non-test `.ts` under `apps/api/src`, sorted. */
function scannedFiles(): string[] {
  const found: string[] = [];
  const pending: string[] = [API_SRC];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(join(repoRoot, current), { withFileTypes: true })) {
      const rel = `${current}/${entry.name}`;
      if (entry.isDirectory()) pending.push(rel);
      else if (entry.name.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(entry.name)) found.push(rel);
    }
  }
  return found.sort();
}

/** One unguarded call site: the file it is in, and the key the allowlist uses. */
interface ParseSite {
  readonly file: string;
  /** `<file> <receiver>` — keyed by receiver, never by line. See {@link ALLOWED_SITE}. */
  readonly site: string;
}

/**
 * Every `.parse(`/`.parseAsync(` outside a `try` whose receiver could be zod,
 * across every scanned file — **controllers included**.
 *
 * The controller allowance is applied by the caller rather than here, so the
 * excused set stays visible and can be asserted against.
 */
function unguardedZodParses(): ParseSite[] {
  const offenders: ParseSite[] = [];
  for (const rel of scannedFiles()) {
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
        offenders.push({ file: rel, site: `${rel} ${receiver}` });
      }
      match = PARSE_CALL.exec(code);
    }
  }
  return offenders.sort((a, b) => a.site.localeCompare(b.site));
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
      `const e = await schemaE.parseAsync(value);`,
      `// schemaF.parseAsync( inside a line comment`,
    ].join("\n");
    const blanked = blankCommentsAndStrings(fixture);

    expect(blanked.length, "offsets must survive, or reported line numbers lie").toBe(
      fixture.length,
    );
    expect(blanked.split("\n").length).toBe(fixture.split("\n").length);

    // `schemaE` is the only live assertion `parseAsync` has: the tree holds no
    // `.parseAsync(` call, so dropping it from PARSE_CALL would change no
    // offender list and nothing else here would notice.
    const seen = [...blanked.matchAll(PARSE_CALL)].map((m) => m[1]);
    expect(
      seen,
      "only the real calls survive, and both zod spellings are matched: a `//` inside a string " +
        "must not open a comment, a quote inside a comment must not open a string, and " +
        "`.parseAsync(` throws the same ZodError as `.parse(`",
    ).toEqual(["schemaD", "schemaE"]);
  });

  /**
   * The rule itself. ADR 0060 §Verification: *"an assertion pins that **no**
   * throwing `.parse(` sits outside a `try` in a service, so a later service
   * parse added without a server-fault wrapper reddens rather than silently
   * becoming a 400."* Widened past "in a service" on review — see the header.
   *
   * Four assertions, in the order a failure is most usefully read:
   *
   * 1. **Two file-count floors.** The total one is the walk's control now that
   *    it covers 298 files; the `*.service.ts` one is kept because it is the
   *    floor the original rule was written against, and a walk that silently
   *    stopped descending into the domain modules would still clear a total.
   * 2. **The controller rule is doing work.** 45 unguarded sites live in
   *    controllers, so a walk or a regex that no longer reaches beyond services
   *    would excuse nothing — and since the excused set never appears in the
   *    result, the whole widening would revert in silence. This is the only
   *    assertion that fails if `scannedFiles` regresses to `*.service.ts`.
   * 3. **The allowlisted site is present exactly once.** Present, because the
   *    absence half below is satisfied by a scanner that found nothing at all,
   *    and a scanner that finds nothing is what a bad walk, a bad blanking pass
   *    and a bad `try` tracker all produce. Exactly once, because the key is
   *    `<file> <receiver>`: a *second* `createAssetTemplateBodySchema.parse(`
   *    added to the stock service on a non-request path produces the identical
   *    string and `Set.has` would drop both.
   * 4. **The absence half.**
   */
  it("leaves exactly one unguarded non-controller parse, the allowlisted client-input one", () => {
    const files = scannedFiles();
    expect(
      files.length,
      "the walk over apps/api/src found almost no non-test .ts — it is broken, and an empty " +
        "offender list below would mean nothing",
    ).toBeGreaterThanOrEqual(250);
    expect(
      files.filter((rel) => rel.endsWith(".service.ts")).length,
      "the walk no longer reaches the *.service.ts files, which is where ADR 0060 moved all " +
        "eight stored-data parses",
    ).toBeGreaterThanOrEqual(50);

    const all = unguardedZodParses();
    const excusedAsControllers = all.filter((entry) => entry.file.endsWith(CONTROLLER_SUFFIX));
    const considered = all
      .filter((entry) => !entry.file.endsWith(CONTROLLER_SUFFIX))
      .map((entry) => entry.site);

    expect(
      excusedAsControllers.length,
      "the class-wide controller allowance excused almost nothing, so this scan is not " +
        "reaching controllers at all. That is what a walk narrowed back to *.service.ts looks " +
        "like — and it would revert the widening without changing a single line of the result " +
        "below, because controller sites never appear there.",
    ).toBeGreaterThanOrEqual(40);

    expect(
      considered.filter((site) => site === ALLOWED_SITE).length,
      "the allowlisted client-input parse in AssetTemplatesStockService.import must appear " +
        "exactly once. Zero: either it was converted to a server fault — which would turn its " +
        "correct 400 into a 500, and ADR 0060 Amendment 1 forbids it — or this scanner is " +
        "broken and the absence assertion below proves nothing. Two: a second parse with the " +
        "same receiver was added to that file, and ALLOWED would silently excuse it too. Give " +
        "it its own allowlist entry or wrap it in parseStoredContract.",
    ).toBe(1);

    expect(
      considered.filter((site) => !ALLOWED.has(site)),
      "a zod .parse()/.parseAsync() sits outside a try, in a file that is not a controller. " +
        "The global ZodErrorFilter answers 400 for every ZodError that escapes anywhere in " +
        "this process, so this one now tells the caller that the server's own stored row is " +
        "their bad request. If it parses data this application stored, wrap it in " +
        "parseStoredContract (apps/api/src/common/parse-stored-contract.ts). If it parses " +
        "caller input on a request path, add it to ALLOWED with the reason.",
    ).toEqual([]);
  });

  /**
   * The soundness condition for the blanker's one blind spot — a regex literal,
   * whose braces it cannot see.
   *
   * `tryBlockRanges` finds a `try` body by counting braces in the blanked
   * source, so an unmatched brace inside a regex literal moves the range: an
   * extra `}` ends it early (over-reports), an extra `{` extends it past the
   * real closing brace (**under-reports**, silently, which is the failure this
   * whole file exists to prevent). Both are stated in
   * `blankCommentsAndStrings`'s docblock.
   *
   * Ranges and offenders are computed **per file**, so the condition that makes
   * an imbalance harmless is exactly this: the file holds no parse call. That is
   * a rule rather than an allowlist, and it stays true on its own — the moment
   * `mapping-sheet-rows.ts` (the one imbalanced file today, 90 `{` against 91
   * `}` from `const BRACED = /\{[^}]*\}/`) grows a `.parse(`, this reddens and a
   * human classifies it.
   *
   * **Necessary, not sufficient**, and the failure message says so: `/}{/ ` is
   * count-balanced and order-wrong. A count is what a test can cheaply hold; a
   * reader who hits this should check the ordering too.
   */
  it("no scanned file has both a parse call and braces the blanker cannot balance", () => {
    const files = scannedFiles();
    expect(
      files.length,
      "the walk is broken, so an empty list below would mean nothing",
    ).toBeGreaterThanOrEqual(250);

    const unsound = files.flatMap((rel) => {
      const code = blankCommentsAndStrings(read(rel));
      const open = (code.match(/\{/g) ?? []).length;
      const close = (code.match(/\}/g) ?? []).length;
      if (open === close) return [];
      if ((code.match(PARSE_CALL) ?? []).length === 0) return [];
      return [`${rel} (${open} { against ${close} })`];
    });

    expect(
      unsound,
      "a file holds a parse call AND braces that do not balance after comments and strings " +
        "are blanked. The blanker cannot see a regex literal, so its braces are counted as " +
        "code: an unmatched `{` extends a try range past its closing brace and hides a real " +
        "unguarded parse, which the rule above would then report as clean. Rewrite the regex " +
        "with balanced braces (`/[{]/` becomes `new RegExp(\"\\\\{\")`), or teach " +
        "blankCommentsAndStrings to skip regex literals. Note this count check is necessary " +
        "and not sufficient — a `/}{/ ` balances by count and still mis-orders the range.",
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
