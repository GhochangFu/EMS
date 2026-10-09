import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, walk, withoutComments } from "./support/source-scan";

/**
 * `F2.10` / ADR 0098 *Security* 2–3 — every recursive CTE over `bms.locations`
 * in `apps/api` carries the organization predicate **on the recursive term**,
 * joins its steps with `UNION` (never `UNION ALL`) and bounds the walk with
 * `LOCATION_TREE_MAX_DEPTH`.
 *
 * Why the recursive term and not the statement: an `organization_id =` in the
 * anchor alone filters the starting rows and then walks across any edge the
 * data holds, so a planted cross-organization edge (the integration tripwire's
 * assertion 6 plants one with the foreign key switched off) widens the closure
 * into another tenant. The scan therefore splits each statement at its one
 * `UNION` and tests the half after it. `UNION` rather than `UNION ALL` is what
 * keeps a cycle from doubling every row until the depth bound stops it, and the
 * depth bound is what stops it at all.
 *
 * The count is pinned: a sixth recursive CTE anywhere under `apps/api/src`, or
 * one outside `auth/location-tree.ts`, fails here and is reviewed into this
 * file by hand — the helpers exist so nothing else walks the tree.
 */

const API_SRC = join(repoRoot, "apps", "api", "src");
const TREE_MODULE = "apps/api/src/auth/location-tree.ts";
const EXPECTED_STATEMENTS = 5;

const rel = (file: string): string => relative(repoRoot, file).split("\\").join("/");

function productionSources(): string[] {
  return walk(API_SRC)
    .filter((f) => /\.ts$/.test(f) && !/\.(spec|test)\.ts$/.test(f))
    .sort();
}

/**
 * Each `WITH RECURSIVE … ` statement in `source`, taken from the keyword to the
 * closing backtick of the template literal it sits in (every statement in the
 * tree module is a drizzle `sql\`…\`` template).
 */
export function recursiveStatements(source: string): string[] {
  const code = withoutComments(source);
  const out: string[] = [];
  const re = /WITH\s+RECURSIVE/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const end = code.indexOf("`", match.index);
    out.push(code.slice(match.index, end === -1 ? undefined : end));
  }
  return out;
}

type Verdict = { ok: true } | { ok: false; reason: string };

/** The ADR 0098 shape of one statement; the recursive term is the text after its single `UNION`. */
export function judge(statement: string): Verdict {
  if (/\bUNION\s+ALL\b/i.test(statement)) {
    return { ok: false, reason: "uses UNION ALL — a cycle doubles every row until the bound" };
  }
  const halves = statement.split(/\bUNION\b/i);
  if (halves.length !== 2) {
    return { ok: false, reason: `has ${halves.length - 1} UNION keyword(s), expected exactly one` };
  }
  const recursiveTerm = halves[1] as string;
  // Two different aliases: the joined row against the walk's row. A bare
  // `organization_id =` would accept the tautology `c.organization_id =
  // c.organization_id`, which bounds nothing (security review L1).
  const predicates = [...recursiveTerm.matchAll(/\b(\w+)\.organization_id\s*=\s*(\w+)\.organization_id\b/g)];
  if (!predicates.some((m) => m[1] !== m[2])) {
    return { ok: false, reason: "the recursive term carries no organization_id = predicate between two aliases" };
  }
  if (!recursiveTerm.includes("${LOCATION_TREE_MAX_DEPTH}")) {
    return { ok: false, reason: "the recursive term is not bounded by ${LOCATION_TREE_MAX_DEPTH}" };
  }
  return { ok: true };
}

describe("F2.10 — every recursive CTE over bms.locations is organization-bounded at the recursive term", () => {
  const found = productionSources().flatMap((file) =>
    recursiveStatements(readFileSync(file, "utf8")).map((statement) => ({ file: rel(file), statement })),
  );

  it(`pins ${EXPECTED_STATEMENTS} WITH RECURSIVE statements under apps/api/src, all in ${TREE_MODULE}`, () => {
    expect(
      found.map((f) => f.file),
      "a recursive CTE outside the tree module, or a new one inside it, must be reviewed into this scan",
    ).toEqual(Array<string>(EXPECTED_STATEMENTS).fill(TREE_MODULE));
  });

  it("each statement has one UNION, never UNION ALL, and the recursive term carries organization_id = and the depth bound", () => {
    const offenders = found
      .map(({ file, statement }) => ({ file, verdict: judge(statement), head: statement.slice(0, 60).replace(/\s+/g, " ") }))
      .filter((f) => !f.verdict.ok)
      .map((f) => `${f.file}: ${f.head}… — ${(f.verdict as { reason: string }).reason}`);
    expect(found.length, "nothing was scanned — the walk or the WITH RECURSIVE pattern broke").toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  // Positive controls: the shapes the rule exists to catch are reported.
  const base = (anchorPredicate: string, recursivePredicate: string, union = "UNION") => `
    WITH RECURSIVE t (id, organization_id, depth) AS (
      SELECT l.id, l.organization_id, 1 FROM bms.locations l WHERE l.id = ANY(\${roots}) ${anchorPredicate}
      ${union}
      SELECT c.id, c.organization_id, t.depth + 1 FROM bms.locations c
        JOIN t ON c.parent_id = t.id ${recursivePredicate}
       WHERE t.depth < \${LOCATION_TREE_MAX_DEPTH}
    )
    SELECT id FROM t`;

  it("positive control: the real shape passes", () => {
    expect(judge(base("", "AND c.organization_id = t.organization_id"))).toEqual({ ok: true });
  });

  it("positive control: a predicate on the anchor alone is reported", () => {
    const verdict = judge(base("AND l.organization_id = ${orgId}", ""));
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain("recursive term carries no organization_id");
  });

  it("positive control: a tautological predicate on one alias is reported", () => {
    const verdict = judge(base("", "AND c.organization_id = c.organization_id"));
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain("between two aliases");
  });

  it("positive control: UNION ALL is reported", () => {
    const verdict = judge(base("", "AND c.organization_id = t.organization_id", "UNION ALL"));
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain("UNION ALL");
  });

  it("positive control: a missing depth bound is reported", () => {
    const unbounded = base("", "AND c.organization_id = t.organization_id").replace("WHERE t.depth < ${LOCATION_TREE_MAX_DEPTH}", "");
    const verdict = judge(unbounded);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain("LOCATION_TREE_MAX_DEPTH");
  });

  it("positive control: the statement extractor finds one statement per WITH RECURSIVE and stops at the template's end", () => {
    const source = "const a = sql`" + base("", "AND c.organization_id = t.organization_id") + "`;\nconst b = sql`WITH RECURSIVE u AS (SELECT 1) SELECT 1`;";
    const statements = recursiveStatements(source);
    expect(statements).toHaveLength(2);
    expect(statements[0]).not.toContain("const b");
  });
});
