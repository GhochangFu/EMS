import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, walk, withoutComments } from "./support/source-scan";

/**
 * `F4.71` U2 — every fixture call into `@bms/db`'s `refreshAggregatesFrom` that
 * runs from an integration suite must be wrapped in
 * `apps/api/src/testing/cagg-materialize.ts`'s `retryOnConcurrentRefresh`.
 *
 * `refreshAggregatesFrom` already retries `55P03` once, internally, with
 * `REQUEST_PATH_RETRY` (in `packages/db/src/refresh-aggregates.ts`, 2 attempts,
 * 1 s). That budget is sized for a live API request racing the scheduled
 * continuous-aggregate policies — one caller, one contention window. A fixture
 * calling the same function is a second, independent contender: three
 * `*.integration` suites (`calc-windows`, `calc-windows.sparse`, `energy-cost`)
 * refresh overlapping ranges near `now()` under `maxWorkers: 2`
 * (`cagg-materialize.ts`'s own `F4.149` paragraph), so a fixture can lose the
 * race to a sibling fixture as well as to a policy tick, and 2 attempts at 1 s
 * were exhausted on 08-31 (`reports.service.rls.integration`'s hook-failure
 * signature, M3 in `docs/plans/f4.71-shared-db-flakes.md`). Wrapping the call a
 * second time in `retryOnConcurrentRefresh` (default `FIXTURE_REFRESH_RETRY`,
 * 5 attempts at 3 s) gives the fixture path a budget sized for fixture-vs-fixture
 * contention without touching the production request-path budget at all.
 *
 * This file is two static rules, not one, because the fix has two shapes: wrap
 * the call (rule 1), or — for the two files that issue the underlying `CALL`
 * directly rather than going through `refreshAggregatesFrom` — say in the source
 * why that file does not need the wrapper (rule 2).
 *
 * **Scan scope, and what is deliberately outside it.** Both rules walk
 * `apps/**` and `tests/**` filtered to `.integration.{spec,test}.ts` — `F4.53`
 * walks `tests` too. That filter is also why this file does not flag itself:
 * its `theAnalysisKillsTheMutation` strings quote `refreshAggregatesFrom(`
 * unwrapped, but its name is not an integration suite's.
 * `packages/db/src/refresh-aggregates.ts` (the function's own home),
 * `cagg-materialize.ts` (already wrapped by U1) and the production write
 * services are not suites and are out of scope by construction, not by
 * exemption.
 *
 * **Aliases.** An aliased import (`import { refreshAggregatesFrom as refresh }`)
 * would hide every call from the `refreshAggregatesFrom(` pattern, so rule 1
 * reports the alias itself as an offender rather than chasing the new name. A
 * namespace call (`db.refreshAggregatesFrom(`) still matches. A rebinding by
 * assignment (`const refresh = refreshAggregatesFrom;`) or a computed member
 * (`db["refreshAggregatesFrom"](`) remains unseen — the same fail-open `F4.53`
 * records for a query assembled by concatenation.
 */
describe("F4.71 — the shared-aggregate refresh retries at the fixture layer", () => {
  /** Integration suites; the `.spec`/`.test` split `F4.53` also scans. */
  const INTEGRATION_SUITE = /\.integration\.(spec|test)\.tsx?$/;
  /** `apps/**` and the top-level `tests/*.integration.test.ts` suites. */
  const SCAN_ROOTS = ["apps", "tests"] as const;

  /**
   * How far back from a `refreshAggregatesFrom(` occurrence the scan looks for
   * its own statement's `retryOnConcurrentRefresh(` wrapper — the `f4.53`
   * `CHAIN_WINDOW` idiom, bounded at the statement's own start rather than an
   * arbitrary character count, so a wrapper belonging to a PRIOR statement can
   * never launder this one.
   *
   * Returns every `refreshAggregatesFrom(` **site**, not only the offending
   * ones — the floor assertion below reads `sites.length`, from this same
   * regex pass, so a broken pattern that finds nothing cannot pass the floor
   * by accident the way a second, independent regex could (measured: the
   * mutation that broke this regex left a separately-counted floor green).
   */
  function scanRefreshAggregatesFrom(source: string): { sites: string[]; offenders: string[] } {
    const src = withoutComments(source);
    const sites: string[] = [];
    const offenders: string[] = [];
    const re = /refreshAggregatesFrom\(/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(src)) !== null) {
      const idx = match.index;
      const snippet = src.slice(Math.max(0, idx - 40), idx + 40).replace(/\s+/g, " ").trim();
      sites.push(snippet);
      // The statement's own start: the character after the nearest `;` (or
      // block/file start) before this occurrence. A wrapper opened in an
      // earlier statement cannot reach across that boundary.
      const priorSemi = src.lastIndexOf(";", idx);
      const statementStart = priorSemi === -1 ? 0 : priorSemi + 1;
      const statement = src.slice(statementStart, idx);
      if (!/retryOnConcurrentRefresh\s*\(/.test(statement)) {
        offenders.push(snippet);
      }
    }
    // An aliased import renames every call out of reach of the pattern above.
    for (const alias of src.matchAll(/\brefreshAggregatesFrom\s+as\s+\w+/g)) {
      offenders.push(`aliased import: ${alias[0]}`);
    }
    return { sites, offenders };
  }

  /** Back-compat name for the mutation `it()` below: just the offenders. */
  function offendingCalls(source: string): string[] {
    return scanRefreshAggregatesFrom(source).offenders;
  }

  it("everyRefreshAggregatesFromInAnIntegrationSuiteIsWrappedInRetryOnConcurrentRefresh", () => {
    const offenders: string[] = [];
    let totalSites = 0;
    for (const file of SCAN_ROOTS.flatMap((root) => walk(join(repoRoot, root)))) {
      if (!INTEGRATION_SUITE.test(file)) continue;
      const source = readFileSync(file, "utf8");
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      const { sites, offenders: found } = scanRefreshAggregatesFrom(source);
      totalSites += sites.length;
      for (const snippet of found) {
        offenders.push(`${rel} — ${snippet}`);
      }
    }

    // The floor every sibling rule in this repo carries: an empty offender list
    // has to mean "found calls, all wrapped", never "the walk found nothing".
    // Counted from the SAME regex pass the offender check uses, so a broken
    // pattern reddens this floor rather than silently emptying both lists.
    expect(
      totalSites,
      "no refreshAggregatesFrom( call sites were found under apps/** or tests/** *.integration.* — " +
        "the walk or the pattern is broken, and the empty offender list below " +
        "would prove nothing",
    ).toBeGreaterThanOrEqual(1);

    expect(
      offenders,
      `these refreshAggregatesFrom( calls race sibling fixtures with only the production ` +
        `request-path budget (F4.71):\n${offenders.join("\n")}\n\n` +
        "Wrap the call: retryOnConcurrentRefresh(() => refreshAggregatesFrom(...)).",
    ).toEqual([]);
  });

  /**
   * The two files that issue `CALL refresh_continuous_aggregate` themselves
   * rather than through `refreshAggregatesFrom` — named here with the reason
   * each does not need `retryOnConcurrentRefresh`. **The reason is prose, not a
   * gate**: this rule only proves the file is on the list and the list only
   * gets shorter; it does not verify that `point-aggregates.integration.spec.ts`'s
   * two `refreshProductionAggregate` callers actually loop on `55P03` at `:774`
   * and `:911` — that loop is read by eye, the same way `F4.53`'s `EXEMPT`
   * arguments are.
   */
  const CALL_REFRESH_ALLOWLIST: ReadonlyArray<{ readonly file: string; readonly why: string }> = [
    {
      file: "apps/api/src/telemetry/aggregate-retention.integration.spec.ts",
      why: "probe views only (F4.55) — they carry no continuous-aggregate policy, so nothing can refresh them concurrently",
    },
    {
      file: "apps/api/src/telemetry/point-aggregates.integration.spec.ts",
      why: "probe views, plus refreshProductionAggregate whose two callers already loop three times on 55P03",
    },
  ];

  it("anIntegrationSuiteThatIssuesCALLRefreshItselfIsNamedWithItsReason", () => {
    const allowlistFiles = new Set(CALL_REFRESH_ALLOWLIST.map((e) => e.file));
    const unlisted: string[] = [];
    let scanned = 0;

    for (const file of SCAN_ROOTS.flatMap((root) => walk(join(repoRoot, root)))) {
      if (!INTEGRATION_SUITE.test(file)) continue;
      scanned += 1;
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      const source = withoutComments(readFileSync(file, "utf8"));
      if (!/CALL\s+refresh_continuous_aggregate/.test(source)) continue;
      if (!allowlistFiles.has(rel)) {
        unlisted.push(rel);
      }
    }

    expect(scanned, "no apps/** or tests/** *.integration.* files were scanned").toBeGreaterThan(20);
    expect(
      unlisted,
      `these files issue CALL refresh_continuous_aggregate directly with no allowlist entry ` +
        `(F4.71):\n${unlisted.join("\n")}\n\n` +
        "Either route the refresh through refreshAggregatesFrom + retryOnConcurrentRefresh, " +
        "or add the file to CALL_REFRESH_ALLOWLIST with the argument for why it is safe.",
    ).toEqual([]);

    // The allowlist only gets shorter — the same guard F4.53's EXEMPT carries.
    expect([...allowlistFiles]).toEqual([
      "apps/api/src/telemetry/aggregate-retention.integration.spec.ts",
      "apps/api/src/telemetry/point-aggregates.integration.spec.ts",
    ]);
    for (const entry of CALL_REFRESH_ALLOWLIST) {
      expect(entry.why.length, `${entry.file} is listed with no argument`).toBeGreaterThan(20);
    }
  });

  it("theAnalysisKillsTheMutation", () => {
    expect(
      offendingCalls("await refreshAggregatesFrom(pool, a, b);"),
    ).toHaveLength(1);

    expect(
      offendingCalls("await retryOnConcurrentRefresh(() => refreshAggregatesFrom(pool, a, b));"),
    ).toHaveLength(0);

    expect(
      offendingCalls("// await refreshAggregatesFrom(pool, a, b);\nconst x = 1;"),
    ).toHaveLength(0);

    // An aliased import hides the call from the pattern, so the alias offends.
    expect(
      offendingCalls(
        'import { refreshAggregatesFrom as refresh } from "@bms/db";\nawait refresh(pool, a, b);',
      ),
    ).toHaveLength(1);
  });
});
