import { defineConfig } from "vitest/config";

/**
 * Root test config (ADR 0014). Each app owns a project config so `apps/web`
 * can inherit its Vite resolution while `apps/api` stays a plain node project.
 *
 * Coverage thresholds start at the measured baseline rather than the
 * `AGENTS.production.md` §10 targets (80% lines / 70% branches). With this few
 * specs those numbers are not reachable yet, and a declared-but-unmet gate is
 * worse than none. Ratchet these upward as features land with their tests;
 * §10 stays the destination.
 */
export default defineConfig({
  test: {
    projects: [
      "apps/api",
      "apps/web",
      "apps/ingest",
      {
        test: {
          name: "repo",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      // Untested files count too, so the denominator is the real source tree
      // rather than a flattering subset. `apps/web` is scoped to `src/lib`
      // because everything above it is React components with no test story
      // yet — including them would report a number that says nothing.
      include: [
        "apps/api/src/**/*.ts",
        "apps/web/src/lib/**/*.ts",
        "apps/ingest/src/**/*.js",
        // `F1.1` is migrating `apps/ingest` to TypeScript (ADR 0016 §6). Added
        // now, while the TS surface is small, so the host lands *inside* the
        // coverage denominator rather than invisible to it.
        "apps/ingest/src/**/*.ts",
      ],
      // Vitest excludes `*.spec.*` and `*.test.*` from coverage by default and
      // that cannot be overridden by listing them here — verified empirically:
      // no spec file appears in lcov.info either way. So coverage CANNOT detect
      // a `.spec.ts` that no wrapper runs. `tests/repo-invariants.test.ts` is
      // what actually catches that; do not rely on this gate for it.
      exclude: ["**/*.spec.ts", "**/*.test.ts", "**/*.test.js", "**/*.d.ts"],
      // Measured 2026-08-10 at F4.1 HEAD, after the three review rounds — the
      // `point-aggregates` read helper, its pure spec, and the integration suite
      // covering the real-time and materialized branches, the refresh-offset
      // invariant, the coarse-rollup guard, the production-vs-probe shape check,
      // and `DashboardService.energySummary` executed end to end:
      // statements 33.29 · branches 28.62 · functions 34.47 · lines 33.44.
      // (45 files / 109 tests, five integration suites running.)
      //
      // The +0.7 over the pre-review figure (32.59 · 27.64 · 33.86 · 32.74) is
      // almost entirely `dashboard.service.ts`: the compliance review found the one
      // converted read site had no test that executed it, so the suite now calls
      // the real method instead of reconstructing its query.
      //
      // `packages/db/src/refresh-aggregates.ts` is NOT in the denominator:
      // `include` covers `apps/*`, not `packages/db`. It is exercised by CI
      // running `pnpm db:refresh-aggregates`, not by a test.
      //
      // Measured 2026-08-10 at E8.3 HEAD with ADR 0022 Amendment 6 — the
      // contested-code fix, substring key matching, the prototype-key guards,
      // and the endpoint/gate/fail-closed cover in
      // `onboarding-credentials.spec.ts`:
      // statements 32.48 · branches 27.54 · functions 33.53 · lines 32.62.
      //
      // Set against HEAD, not an intermediate commit. The compliance review
      // caught the previous entry asserting a figure the tree no longer had,
      // which left roughly double the usual slack — in this repo specifically,
      // a document asserting a measurement the code does not have is the exact
      // failure ADR 0022's amendments exist to record.
      //
      // Measured 2026-08-09 with E8.3's onboarding credential capture (ADR 0022):
      // statements 30.22 · branches 24.92 · functions 31.25 · lines 30.36.
      //
      // Measured 2026-08-09 with F4.14's audit read API (ADR 0021), its fourth
      // integration suite, and the review-driven additions (controller suite,
      // the Amendment 1 provisioning check):
      // statements 29.94 · branches 24.42 · functions 31.06 · lines 30.07.
      // (Before the security/compliance review fixes: 29.33 · 24.25 · 30.69 ·
      // 29.48.)
      //
      // Previously measured 2026-08-06 with all three integration suites in the
      // tree, the F1.1 ingest host landed, the rules module split under §4.5,
      // and the
      // MQTT top-level source-key fix:
      // statements 27.99 · branches 22.88 · functions 28.92 · lines 28.17.
      // (Before the MQTT fix: 27.87 · 22.77 · 28.83 · 28.05. Before the rules
      // split: 26.47 · 18.92 · 27.08 · 26.60. Before the
      // host: 17.18 · 11.37 · 20.66 · 17.11. Before E1.7: 14.22 · 9.35 · 18.29
      // · 14.07. Before F2.2: 10.96 · 6.76 · 14.65 · 10.96. F4.10 alone was
      // 7.12 · 4.53 · 9.44 · 7.14; F2.1 alone 8.70 · 5.14 · 10.74 · 8.76;
      // F4.11 4.47 · 2.72 · 4.72 · 4.59; F4.4 baseline 3.60 · 1.86 · 3.37 ·
      // 3.72.)
      //
      // The branches jump is disproportionate because the rules split gave the
      // engine's decision logic its first tests — `compare`, `parseTime` and
      // the time-window comparison are almost entirely branch.
      //
      // The +9 point jump is the ingest host: `apps/ingest/src/**/*.ts` was
      // added to the denominator by the F1.1 contracts PR while the numerator
      // was nearly empty, so it depressed these numbers before it raised them.
      // `src/main.ts` is deliberately wiring-only and stays uncovered; the
      // decisions it would otherwise make live in `host/config.ts`,
      // `host/bindings.ts` and `host/supervisor.ts`, which are.
      //
      // Set just below each so a regression trips the gate while normal churn
      // does not. Ratchet up, never down (§4.6).
      //
      // These numbers assume the `*.integration.test.ts` suites ran, which needs
      // a reachable `DATABASE_URL`; without one they skip and coverage falls far
      // enough to trip the gate. That is intended — the gate should measure a
      // complete run, not a partial one — and CI always has the database
      // (`db:migrate` → `db:seed` → `test:coverage`). The skipped suites print
      // the reason and the command to fix it. Do NOT lower these to make a
      // database-less run pass.
      //
      // Locally, use `127.0.0.1` and not `localhost` in `DATABASE_URL`: where
      // `localhost` resolves to IPv6 first, `access-control.integration` fails the
      // whole run with a connection timeout rather than skipping — correctly, since
      // a set `DATABASE_URL` is a claim that a database exists. CI is unaffected.
      // Ratcheted by `F4.36` from 37.7/31.8/39.2/38.0. Measured 2026-08-14 against
      // the live database, all 153 tests running and none skipped:
      // 38.24 statements · 32.31 branches · 39.53 functions · 38.50 lines.
      // (53 files / 153 tests.) New coverage: `telemetry-reading.schema.ts`
      // arrives tested, and the listener gained its drop path. Re-measured after
      // the review round added the payload cap and the Infinity case.
      //
      // Ratcheted by `F4.34` from 36.5/31.2/38.2/36.7. Measured 2026-08-14
      // against the live database, all 153 tests running and none skipped:
      // 37.79 statements · 31.89 branches · 39.29 functions · 38.03 lines.
      // (53 files / 153 tests.)
      //
      // **An earlier run in the same item measured 37.93/31.81/39.52/38.17 —
      // higher — and the difference is worth knowing about.** The compliance
      // review showed the ADR 0016 §5 backoff had been copied rather than
      // shared, so it moved to `packages/shared/src/ingest.ts`. `include` above
      // covers `apps/*` only, so **moving covered code into `packages/shared`
      // deletes it from the numerator and the gate stops seeing it**. Coverage
      // fell ~0.15 for a change that removed a duplicate and added no untested
      // line. Anyone extracting into `packages/*` should expect the same dip and
      // not read it as a regression; whether `packages/shared` belongs in the
      // denominator at all is a separate question and not settled here.
      //
      // Unlike the `F1.1` entry below, this rise **is** new coverage rather than
      // a denominator shrink: `telemetry-listener.ts` and `listener-backoff.ts`
      // are new files that arrive tested, and `telemetry-notify.service.ts` went
      // from entirely uncovered to having its wiring exercised. Worth
      // distinguishing, since the two look identical in the summary line.
      //
      // `rollup-conversion.integration` completed here, which it does **not**
      // do on a database with compressed chunks (`F4.33`). That is not a fix —
      // this machine's chunks were decompressed manually during `F1.1` and the
      // compression policy had not yet re-compressed them. `F4.33` is still open
      // and will bite again once it does.
      //
      // Ratcheted by `F1.1` (ADR 0016 §6 commit 4) from 35.7/30.8/37.6/35.9.
      // Measured 2026-08-14 against the live database, **all 152 tests running
      // and none skipped**: 36.53 statements · 31.26 branches · 38.23 functions
      // · 36.75 lines. (52 files / 152 tests.)
      //
      // The rise is a **denominator shrink, not new tests** — deleting
      // `apps/ingest/src/index.js` removed 234 lines that no test ever imported,
      // and `apps/ingest/src/**/*.js` is in `include` above. Worth stating,
      // because "coverage went up" normally means the numerator moved and here it
      // did not: nothing became better tested.
      //
      // **Getting a complete run needed a database fix that is not in this
      // branch.** `rollup-conversion.integration` fails in teardown with `tuple
      // decompression limit exceeded` once `point_values` has compressed chunks:
      // `cleanupProbes` issues a `DELETE` with no time predicate, so Timescale
      // decompresses candidate tuples across every compressed chunk before
      // filtering and blows the 100k
      // `max_tuples_decompressed_per_dml_transaction` cap — even though the probe
      // assets do not exist and it matches zero rows. Verified pre-existing by
      // running it with this branch stashed. CI never sees it (a fresh database
      // has no compressed chunks), so it is invisible to the pipeline by
      // construction and only bites a machine with history. `decompress_chunk`
      // locally is the workaround; the compression policy re-compresses on its
      // own schedule.
      //
      // Ratcheted by `F4.29` (ADR 0026) from 35.5/30.7/36.9/35.7. Measured
      // 2026-08-10 against the live database, all seven integration suites running:
      // 35.78 statements · 30.88 branches · 37.68 functions · 35.97 lines.
      // (52 files / 151 tests.) The rise is the two new serialiser specs: ADR 0026
      // fact 5 recorded that `energyCsv` had **never been executed by a test** —
      // `F4.28` covered `reports.service.ts` through `energyPreview` only — so its
      // row building moved to `reports.serialise.ts` where a `Pool` is not needed.
      //
      // Ratcheted by `F4.28` (ADR 0025 decision 9) from 33.2/28.5/34.3/33.3.
      // Measured 2026-08-10 against the live database with all seven integration
      // suites running: 35.60 statements · 30.81 branches · 37.04 functions ·
      // 35.81 lines. Most of the rise is `reports.service.ts`, which had **no
      // tests at all** before this item (ADR 0025 fact 7) and is now exercised
      // through `energyPreview` rather than by reconstructing its queries.
      thresholds: {
        statements: 38.2,
        branches: 32.3,
        functions: 39.5,
        lines: 38.4,
      },
    },
  },
});
