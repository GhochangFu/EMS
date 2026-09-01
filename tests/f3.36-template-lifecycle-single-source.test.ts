import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F3.36` / ADR 0049 decision 2 — the template lifecycle is declared **once**.
 *
 * Decision 2 rules full lifecycle parity between `bms.asset_templates` and the
 * new `bms.dashboard_templates`, and then says how that parity is held: *"The
 * status vocabulary **and the legal transitions** are declared once and both
 * tables read that declaration; a source scan fails a second copy. A convention
 * that the two 'stay in step' is not a gate."*
 *
 * This is that source scan. Two halves, because the ADR asks for two things:
 * the **vocabulary** (half 1) and the **transitions** (half 2).
 *
 * **Why a source scan and not a unit test.** A restated
 * `z.enum(["draft","published","archived"])` typechecks, passes every
 * behavioural test of the file it lives in, and stays correct until the day one
 * lifecycle gains a fourth state — at which point one surface accepts a status
 * another refuses, and an administrator meets a 409 on a template that
 * published fine yesterday. `tests/f3.1d-grid-bounds-single-source.test.ts` is
 * the direct model, and its own header is the argument: the grid bound was
 * undercounted **twice** while `F3.1d` was planned and built, and the scan then
 * found a seventh copy on its first run.
 *
 * ---
 *
 * **THE NAMED EXCEPTION: the automation-rule lifecycle is a DIFFERENT
 * vocabulary that happens to spell its states the same way.** It is excluded by
 * name, and the reason is a read of the code rather than a preference:
 *
 * - `rules.service.ts` `archiveRule` carries **no status guard at all**, so a
 *   rule goes `draft -> archived` directly.
 * - `rules.service.ts` `publishRule` refuses only `archived`, so
 *   `published -> published` re-publish is legal.
 * - The template lifecycle permits **neither**: `publish` calls `assertDraft`,
 *   and `archive` refuses anything that is not `published`.
 *
 * §4.8 records this exact failure mode from `F4.45` — *"an asymmetry that will
 * not resolve is often two vocabularies wearing one name"*. Collapsing them
 * would be a behaviour change to the rules engine smuggled into a dashboard
 * feature branch, which is both a bug and unrequested scope.
 *
 * **The exclusion is a NAMED SYMBOL carrying its reason, not a path
 * allowlist.** That distinction matters, because `f3.1d`'s header says "never
 * widen the allowlist" and a later reader will otherwise read this as the thing
 * that warning forbids. It is not: `f3.1d` warns about fail-open **path**
 * exclusions, which hide whatever else that file grows. A named constant hides
 * exactly one declaration and nothing else, and it is the shape
 * `tests/adr-0043-tenant-columns.test.ts`'s `NO_COLUMN` set already uses —
 * named rather than pattern-matched, because it is a decision, not a shape.
 *
 * ---
 *
 * **What the half-1 predicate deliberately does NOT match**, stated here
 * because an over-broad rule that has to be allowlisted six times is a rule
 * nobody trusts:
 *
 * - `status === "archived"` and other single-value comparisons. Half 2 covers
 *   the two files where a comparison is a transition rule; everywhere else a
 *   comparison is a render branch, and presentation is not the vocabulary.
 * - `status: "draft"` as an initial value on an insert. That is a value, not a
 *   restatement of the set.
 * - `<option value="archived">` in markup, and
 *   `type Filter = "all" | "draft" | ...`, which is a **superset** — a UI filter
 *   that adds "all" is not a copy of the vocabulary.
 *
 * `*.spec.ts(x)` is allowlisted for `f3.1d`'s reason: a fixture that iterates
 * the three states is the thing being tested, not the production declaration.
 * `*.test.ts(x)` mirrors are **not** exempt — they re-export a spec's runner and
 * carry no fixtures of their own.
 *
 * If this fires, fix the file it names — do not add a path to an allowlist.
 */

const DECLARATION_REL = "packages/shared/src/contracts/template-lifecycle.ts";
const DECLARATION_CONST = "TEMPLATE_LIFECYCLE_STATUSES";
const DECLARATION_TRANSITIONS = "TEMPLATE_LIFECYCLE_TRANSITIONS";

/**
 * Excluded by NAME, each with its reason. Two entries and no more.
 *
 * 1. The declaration itself — the one place the set is allowed to be spelled.
 * 2. The automation-rule lifecycle — a different vocabulary, see the header.
 */
const NAMED_EXCEPTIONS = new Set([DECLARATION_CONST, "automationRuleLifecycleStatusSchema"]);

const SCAN_ROOTS = [
  join(repoRoot, "packages/shared/src"),
  join(repoRoot, "apps/api/src"),
  join(repoRoot, "apps/web/src"),
];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

const LIFECYCLE_SET = ["archived", "draft", "published"].join("|");

/** Strips block and line comments before scanning — the repo idiom at
 * `tests/repo-invariants.test.ts:610-612` — so the docblock above cannot trip
 * the rule it explains. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * Every array literal whose members are string literals and whose member SET is
 * exactly {draft, published, archived}, in any order.
 *
 * `[^[\]]*` matches newlines, so a prettier-wrapped
 * `z.enum([\n  "draft",\n  "published",\n  "archived",\n])` is caught — the
 * shape a reformat produces and a single-line regex misses.
 *
 * The "members are ALL string literals" test is what keeps
 * `[draft, published, archived]` (three identifiers) and
 * `["draft", ...OTHER]` out: after removing the literals and the separators,
 * nothing but whitespace may remain.
 */
export function lifecycleArrayLiterals(
  src: string,
): Array<{ index: number; text: string }> {
  const stripped = stripComments(src);
  const out: Array<{ index: number; text: string }> = [];

  for (const match of stripped.matchAll(/\[[^[\]]*\]/g)) {
    const body = match[0].slice(1, -1);
    const literals = [...body.matchAll(/["']([^"']*)["']/g)].map((m) => m[1]);
    if (literals.length !== 3) continue;

    // Nothing but string literals, commas and whitespace.
    const residue = body.replace(/["'][^"']*["']/g, "").replace(/[\s,]/g, "");
    if (residue !== "") continue;

    const set = [...new Set(literals)].sort().join("|");
    if (set !== LIFECYCLE_SET) continue;

    out.push({ index: match.index ?? 0, text: match[0].replace(/\s+/g, " ") });
  }

  return out;
}

/** The nearest preceding declared name, so a hit can be reported — and
 * excluded — by the symbol it belongs to rather than by its file. */
function nearestDeclaredName(src: string, index: number): string {
  const before = stripComments(src).slice(0, index);
  const names = [...before.matchAll(/\b(?:const|let|var|function|type|enum)\s+([A-Za-z_$][\w$]*)/g)];
  return names.length > 0 ? (names[names.length - 1][1] ?? "<unknown>") : "<unknown>";
}

function lineOf(src: string, index: number): number {
  return stripComments(src).slice(0, index).split(/\r?\n/).length;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function scanFiles(): string[] {
  return SCAN_ROOTS.flatMap((root) => walk(root));
}

/** `f3.1d`'s rule, for `f3.1d`'s reason. */
const isAllowlistedSpec = (name: string) => /\.spec\.tsx?$/.test(name);

// ---------------------------------------------------------------------------
// Half 1 — the vocabulary
// ---------------------------------------------------------------------------

describe("F3.36 half 1: the template lifecycle vocabulary is stated once", () => {
  it("scanned a non-trivial number of files (a broken walk would pass vacuously)", () => {
    // Well over a thousand .ts/.tsx files exist across the three roots. Set far
    // under that and far above zero, so a walk that silently returns nothing —
    // a renamed root, a throw swallowed by the try/catch — fails here rather
    // than reporting a clean scan.
    expect(scanFiles().length).toBeGreaterThan(100);
  });

  it("the walk recurses: files are found inside subdirectories of each root", () => {
    for (const root of SCAN_ROOTS) {
      const nested = walk(root).some((f) => /[\\/]/.test(relative(root, f)));
      expect(
        nested,
        `the walk must recurse into ${relative(repoRoot, root)}, or a nested copy is invisible`,
      ).toBe(true);
    }
  });

  it("the predicate matches a restated vocabulary and not the rewired form", () => {
    const restated = [
      'export const a = z.enum(["draft", "published", "archived"]);',
      "export const b = ['published', 'archived', 'draft'] as const;",
      'const c = [\n  "draft",\n  "published",\n  "archived",\n];',
    ].join("\n");
    expect(lifecycleArrayLiterals(restated)).toHaveLength(3);

    const rewired = [
      "export const a = z.enum(TEMPLATE_LIFECYCLE_STATUSES);",
      "export const b = templateLifecycleStatusSchema;",
      'const filter = ["all", "draft", "published", "archived"] as const;',
      'const two = ["draft", "published"] as const;',
      'const shape = ["draft", "published", other] as const;',
      'if (template.status === "archived") return null;',
      '<option value="archived">Archived</option>',
    ].join("\n");
    expect(lifecycleArrayLiterals(rewired)).toHaveLength(0);
  });

  it("a comment restating the vocabulary does not trip the rule it explains", () => {
    const commented = [
      '// the states are ["draft", "published", "archived"]',
      '/* z.enum(["draft", "published", "archived"]) */',
      "const ok = 1;",
    ].join("\n");
    expect(lifecycleArrayLiterals(commented)).toHaveLength(0);
  });

  it("the declaration file declares the vocabulary and the transitions", () => {
    // Without this, a rename makes NAMED_EXCEPTIONS cover nothing and the scan
    // below passes vacuously forever.
    expect(
      existsSync(join(repoRoot, DECLARATION_REL)),
      `${DECLARATION_REL} is missing. ADR 0049 decision 2 requires ONE declaration that both ` +
        "template tables read.",
    ).toBe(true);

    const declaration = readFileSync(join(repoRoot, DECLARATION_REL), "utf8");
    expect(declaration).toContain(DECLARATION_CONST);
    expect(
      declaration,
      `${DECLARATION_REL} must also declare ${DECLARATION_TRANSITIONS}. Decision 2 asks for the ` +
        "vocabulary AND the legal transitions in one place — a shared enum with the transition " +
        "rules still copied into each service is the drift the ADR names.",
    ).toContain(DECLARATION_TRANSITIONS);
  });

  it("no file outside the named exceptions restates the lifecycle vocabulary", () => {
    const offenders: string[] = [];

    for (const file of scanFiles()) {
      const name = file.split(/[\\/]/).pop() ?? file;
      if (isAllowlistedSpec(name)) continue;

      const src = readFileSync(file, "utf8");
      for (const hit of lifecycleArrayLiterals(src)) {
        const owner = nearestDeclaredName(src, hit.index);
        if (NAMED_EXCEPTIONS.has(owner)) continue;
        offenders.push(
          `${relative(repoRoot, file).replace(/\\/g, "/")}:${lineOf(src, hit.index)} ` +
            `(${owner}): ${hit.text}`,
        );
      }
    }

    expect(
      offenders,
      "the template lifecycle is declared once, as TEMPLATE_LIFECYCLE_STATUSES in " +
        `${DECLARATION_REL}. Import it — a restated z.enum(["draft","published","archived"]) ` +
        "typechecks, passes its own file's tests, and diverges the day one lifecycle gains a " +
        "fourth state (ADR 0049 decision 2). Fix the file named here; do not add a path to an " +
        "allowlist. Exactly two names are excluded: the declaration itself, and " +
        "automationRuleLifecycleStatusSchema, which is a DIFFERENT lifecycle — archiveRule has " +
        "no status guard and publishRule allows re-publish, neither of which the template " +
        "lifecycle permits. Migration 0056's SQL CHECK is a permanent exception and is not " +
        "scanned, because SQL has no imports.",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Half 2 — the transitions
// ---------------------------------------------------------------------------

/**
 * Scoped to exactly the two services that own the two tables decision 2 names,
 * and the narrowness is deliberate: a React render branch on
 * `status === "archived"` is presentation, not a transition rule, and scanning
 * for it repo-wide would force allowlists that hollow out half 1's credibility.
 *
 * `dashboard-templates.service.ts` is created in Part E. Until then it is
 * absent and skipped — and the moment it exists this assertion starts biting,
 * which is the point. The anti-vacuity check below fails if NEITHER file is
 * present, so a rename cannot empty this describe block silently.
 */
const TRANSITION_OWNERS = [
  "apps/api/src/admin/asset-templates/asset-templates.service.ts",
  "apps/api/src/admin/dashboard-templates/dashboard-templates.service.ts",
];

const LITERAL_STATUS_COMPARISON = /\bstatus\s*[!=]==?\s*["'](?:draft|published|archived)["']/;

describe("F3.36 half 2: both template services read the shared transitions", () => {
  const present = TRANSITION_OWNERS.filter((rel) => existsSync(join(repoRoot, rel)));

  it("at least one transition owner exists (a rename cannot empty this suite)", () => {
    expect(
      present,
      "neither template service was found at its expected path. If one was moved, move this " +
        "list with it — an empty scope makes every assertion below pass vacuously.",
    ).toContain(TRANSITION_OWNERS[0]);
  });

  it("the comparison predicate matches a hand-rolled guard and not the rewired form", () => {
    expect(LITERAL_STATUS_COMPARISON.test('if (template.status !== "draft") throw x;')).toBe(true);
    expect(LITERAL_STATUS_COMPARISON.test("if (t.status === 'archived') return;")).toBe(true);
    expect(
      LITERAL_STATUS_COMPARISON.test('if (!canTransition(template.status, "published")) throw x;'),
    ).toBe(false);
    expect(LITERAL_STATUS_COMPARISON.test('await tx.update(t).set({ status: "draft" });')).toBe(
      false,
    );
  });

  it.each(present)("%s imports the shared transition helper", (rel) => {
    const src = readFileSync(join(repoRoot, rel), "utf8");
    expect(
      src,
      `${rel} does not read TEMPLATE_LIFECYCLE_TRANSITIONS. ADR 0049 decision 2: both tables ` +
        "read one declaration, and a convention that they stay in step is not a gate.",
    ).toContain("canTransition");
  });

  it.each(present)("%s states no transition rule as a literal comparison", (rel) => {
    const stripped = stripComments(readFileSync(join(repoRoot, rel), "utf8"));
    const hits = stripped
      .split(/\r?\n/)
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter(({ line }) => LITERAL_STATUS_COMPARISON.test(line));

    expect(
      hits.map((h) => `${rel}:${h.no}: ${h.line}`),
      `${rel} compares status to a literal. The legal transitions live in ` +
        `${DECLARATION_REL} as ${DECLARATION_TRANSITIONS}; call canTransition() and ` +
        "transitionRefusedMessage() so revising one lifecycle cannot leave the other behind.",
    ).toEqual([]);
  });
});
