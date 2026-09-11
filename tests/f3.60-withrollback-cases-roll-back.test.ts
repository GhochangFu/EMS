import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, walk, withoutComments } from "./support/source-scan";

/**
 * `F3.60` — every `withRollback` case must call `tx.rollback()`.
 *
 * `withRollback` catches the `TransactionRollbackError` that `tx.rollback()`
 * throws. A case that simply returns therefore **commits**, and its fixture
 * becomes permanent. Nothing failed in the offending suite: it asserted what it
 * meant to, went green, and left rows behind.
 *
 * **The instance, so the class is not abstract.** `channel-reads.integration.spec.ts`
 * shipped with six cases and zero `tx.rollback()` calls. It committed **298
 * `f360-*` notification channels** to the shared development database over one
 * session, and in CI it broke `storm-control.integration.test.ts` — a suite it
 * does not touch, in a job whose failure I first attributed to a concurrent
 * session's writes. That is the shape of this defect: a leaked fixture never
 * fails its own suite, so the blame lands somewhere else and a real regression
 * and a polluted database look identical.
 *
 * **Why the existing gate could not catch it.**
 * `integration-fixture-isolation.test.ts` selects the suites it governs BY the
 * presence of `tx.rollback()` — reasonably, because that marker is what tells a
 * rollback-isolated suite from a committed-fixture one. A spec that calls
 * `withRollback` and never rolls back is invisible to it. This rule is the
 * complement: it keys on the CALL, not on the marker.
 *
 * The comparison is `>=`, not `===`: a docblock may name `tx.rollback()` and a
 * case may legitimately roll back on more than one path. What cannot happen is
 * fewer rollbacks than cases.
 */
describe("F3.60 — a withRollback case must roll back", () => {
  it("every spec calling withRollback calls tx.rollback() at least as often", () => {
    const specs = ["apps", "packages"]
      .flatMap((root) => {
        try {
          return walk(join(repoRoot, root));
        } catch {
          return [];
        }
      })
      .filter((f) => /\.spec\.tsx?$/.test(f));

    // Comments stripped, so a docblock that merely NAMES either call cannot
    // satisfy this rule — the defect being gated is a missing call, and prose
    // about the call is exactly what the offending file already had.
    const offenders = specs.flatMap((file) => {
      const source = withoutComments(readFileSync(file, "utf8"));
      const calls = source.match(/\bawait\s+withRollback\s*\(/g)?.length ?? 0;
      if (calls === 0) {
        return [];
      }
      const rollbacks = source.match(/\btx\.rollback\s*\(\s*\)/g)?.length ?? 0;
      return rollbacks >= calls
        ? []
        : [`${relative(repoRoot, file)}: ${calls} withRollback case(s), ${rollbacks} rollback(s)`];
    });

    // The positive control. An empty offender list passes whether the rule
    // works or the scan found nothing at all, and this repository has shipped
    // that false green before — so the scan must prove it saw the suites.
    const scanned = specs.filter((f) =>
      /\bawait\s+withRollback\s*\(/.test(withoutComments(readFileSync(f, "utf8"))),
    );
    expect(
      scanned.length,
      "the scan found no withRollback spec at all — the walk or the pattern is broken, not the repo",
    ).toBeGreaterThanOrEqual(8);

    expect(offenders, "a withRollback case that does not roll back COMMITS its fixture").toEqual([]);
  });
});
