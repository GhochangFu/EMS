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
      "packages/shared",
      "packages/db",
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
      //
      // **That rationale no longer describes all of it** (`F4.52`).
      // `apps/web/src/api/http.ts` is pure logic, not a component, and it now
      // has `http.spec.ts` behind a `.test.ts` wrapper — the suite runs it
      // (`apps/web/vitest.config.ts` includes `src/**/*.test.ts`), but this
      // gate cannot see it. Do not widen `include` here as a tidy-up: adding a
      // path moves the denominator and every threshold below is a measurement
      // against the current one. Fold `apps/web/src/api/**/*.ts` in at the
      // next deliberate ratchet, with a fresh measurement.
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
      //
      // Ratcheted by `F4.46` from 39.2/33.6/40.0/39.5. Measured 2026-08-16
      // against the live database, all 202 tests running and none skipped:
      // 40.32 statements · 35.25 branches · 41.56 functions · 40.61 lines.
      // (66 files / 202 tests.)
      //
      // **Only part of that rise is `F4.46`'s**, and the split was measured
      // rather than assumed — the note below records this file getting it wrong
      // twice, so the parent commit (`b4d03d3`, the tip of `main`) was measured
      // the same way for comparison: 39.80 · 34.24 · 40.98 · 40.10 (64 files /
      // 197 tests). So:
      //
      //   - `F4.46` itself is +0.52 statements, **+1.01 branches**, +0.58
      //     functions, +0.51 lines. Branches lead by a wide margin because what
      //     this item added is almost entirely decision logic —
      //     `offersNoSeverityOption` is two arms, `severityFromRule` is a
      //     `safeParse` fork, and the API cases exercise both severity branches
      //     of `validateRuleDraft` for the first time;
      //   - the other ~0.5 predates this branch. `main` had already drifted from
      //     the `F4.38` measurement of 39.28/33.73/40.09/39.57 up to
      //     39.80/34.24/40.98/40.10 across `F4.43`–`F4.45`, none of which
      //     ratcheted. Those three points of gain were sitting unprotected: a
      //     regression could have given all of it back without tripping this
      //     gate. Ratcheting here banks it.
      //
      // Ratcheted by `F4.38` from the `F4.37` **measurement** of
      // 38.98/33.42/39.88/39.26 (its thresholds were 38.9/33.4/39.8/39.2 —
      // comparing this measurement against those thresholds would overstate the
      // gain by the safety margin, which an earlier version of this note did).
      // Measured 2026-08-15 against the live database, all 156 tests running
      // and none skipped, after the review round:
      // 39.28 statements · 33.73 branches · 40.09 functions · 39.57 lines.
      // (54 files / 156 tests.)
      //
      // The rise is entirely `schematic-telemetry.ts` again — `freshValue`,
      // `staleCount` and `sumFresh` arrive tested. The seven page files that
      // consume them are **not** in the denominator (`include` reaches
      // `apps/web/src/lib/**` and nothing above it), so the largest part of this
      // change is invisible to this gate. That is why ADR 0027's page-level
      // guarantee is carried by a static invariant in `tests/repo-invariants.test.ts`
      // rather than by coverage.
      //
      // Ratcheted by `F4.37` from 38.2/32.3/39.5/38.4. Measured 2026-08-14 against
      // the live database, all 155 tests running and none skipped:
      // 38.98 statements · 33.42 branches · 39.88 functions · 39.26 lines.
      // (54 files / 155 tests.)
      //
      // **This is the mirror image of the `F4.34` dip below and worth reading
      // next to it.** Moving the schematic slice core out of a `.tsx` component
      // and into `apps/web/src/lib/` moved it *into* the denominator — `include`
      // covers `apps/web/src/lib/**` and nothing above it — so code that had
      // been invisible to this gate for six sprints now counts.
      //
      // The two effects were measured separately, because the summary line hides
      // which is which. After the move but before the point-key mapping test:
      // 38.26/32.31/39.88/38.52. So:
      //
      //   - the move alone gave functions +0.35 and essentially nothing else —
      //     the 34-arm switch is one function, and it arrived uncovered;
      //   - the mapping test gave branches +1.11, statements +0.72, lines +0.74,
      //     and functions **+0.00**.
      //
      // The functions rise here is therefore entirely a denominator move and not
      // new testing; the branches rise is entirely new testing. An earlier
      // version of this note said "only the +0.7 here is new testing", which
      // blurred the two — corrected after the `F4.37` compliance review checked
      // the decomposition against these numbers.
      //
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
      // **Getting a complete run needed a database fix, raised as `F4.40` and
      // since landed** — this note recorded it as an open blocker and no longer
      // should. `rollup-conversion.integration` failed with `tuple decompression
      // limit exceeded` once `point_values` had compressed chunks. The cause was
      // not the missing time predicate this note first blamed: `asset_id` is a
      // **segmentby** column, so a constant filter on it prunes compressed
      // batches, and the `DELETE` filtered it through a *subquery* — which the
      // planner cannot fold to a constant, so every batch was decompressed to
      // evaluate the predicate. Measured 186706 tuples decompressed while
      // matching **zero** rows. Fixed by resolving the ids first; held by a
      // static invariant in `tests/adr-0024-retention-bounds.test.ts`.
      //
      // CI never saw it and never will (a fresh database has no compressed
      // chunks), so it was invisible to the pipeline by construction and bit only
      // machines with history — which is every developer's after ADR 0024's
      // 7-day compression threshold, and every pilot.
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
      // Ratcheted by `E2.1` (ADR 0034) from 40.3/35.2/41.5/40.6. Measured
      // 2026-08-19 against the live database, all 80 test files running and
      // none skipped: 43.22 statements · 39.33 branches · 45.07 functions ·
      // 43.44 lines (80 files / 253 tests). The rise is new coverage:
      // `alarm-details.ts` (lib, tested first — operatorSymbol,
      // formatThresholdPairing, alarmSkillLabel) plus the integration
      // suites for `bms.alarm_enrichments`/`bms.alarm_skills`,
      // `VocabulariesService`'s fourth vocabulary, the template
      // `philosophy.skill` tightening, `AlarmDetailsService` and
      // `AlarmEnrichmentService`.
      //
      // Ratcheted by `F1.8` (manual telemetry entry) + `F1.9` (CSV/Excel
      // telemetry bulk import) landing together, from 43.0/39.1/44.8/43.2.
      // The two PRs each measured their own delta in isolation before this
      // merge; re-measured after resolving the merge conflicts, against the
      // live database, all 94 files / 286 tests running and none skipped:
      // 47.5 statements · 43.34 branches · 48.55 functions · 47.61 lines.
      //
      // Ratcheted by `F2.4` (calc execution engine, ADR 0037) from
      // 47.6/43.7/48.8/47.7. Measured 2026-08-20 against the live database,
      // all 110 files / 337 tests running and none skipped:
      // 50.19 statements · 45.68 branches · 50.98 functions · 50.24 lines.
      //
      // The rise is `apps/api/src/calc/**` in full: two runtime hosts, the
      // definition/input/write services, and the pure helpers each of them
      // calls (calc-batch, calc-inputs, calc-schedule) — deliberately split
      // out of the hosts so the decision logic (asset-isolation filtering,
      // missing/stale classification, epoch-bucket truncation) is covered
      // cheaply and directly rather than only indirectly through a host
      // integration test. `evaluate.ts` (`packages/shared/src/calc-dsl`) is
      // NOT in this denominator for the same reason `F2.3`'s parser wasn't —
      // `include` reaches `apps/*` only; its own test project is what proves
      // it runs.
      //
      // One flake surfaced while measuring, unrelated to this item:
      // `alarm-enrichment.integration.spec.ts`'s `firstSeededAssetId` picks
      // its fixture asset via `SELECT id FROM assets LIMIT 1` with no
      // deterministic ORDER BY, and failed an FK insert once when run
      // alongside the larger parallel integration-suite set this item adds.
      // Reproduced in isolation: passes every time alone, and the full run
      // above is the clean rerun. Pre-existing latent race, not introduced
      // here — recorded rather than fixed, since fixing an unrelated
      // suite's fixture resolution is out of this item's scope.
      // Ratcheted by `F2.5` (template authoring UI, ADR 0038) from
      // 49.9/45.3/50.6/50.0. **Re-measured 2026-08-21 after the review round**,
      // against the live database, all 130 files / 478 tests running and none
      // skipped:
      // 53.87 statements · 50.02 branches · 55.49 functions · 53.94 lines.
      //
      // The first measurement in this item was 53.62/49.67/55.03/53.69 at
      // 128 files / 462 tests, and the thresholds were set to
      // 53.3/49.3/54.7/53.4 against it. Three reviews then landed four defect
      // fixes, each shipping the test that would have caught it (§4.6), and two
      // further `lib/` modules — so both the numerator and the file count moved
      // and the recorded figure went stale within the same item. Re-measured
      // rather than left as a floor: a note asserting a figure the tree no
      // longer has is the exact failure the `E8.3` entry above records.
      //
      // **The attribution is clean, and that was checked rather than assumed.**
      // `git rev-list --count $(git merge-base origin/main HEAD)..origin/main`
      // is 0 — `origin/main` has not moved since this branch left it at
      // `724efa9` — so the whole delta over the `F2.4` measurement
      // (50.19/45.68/50.98/50.24) belongs to this item. The `F4.46` entry above
      // records finding ~0.5 of unattributed drift sitting in its rise, and the
      // `F4.37`/`F4.38` entries record this file getting attribution wrong
      // twice. There is no such drift here.
      //
      // The rise is **seventeen** new `apps/web/src/lib/` modules, each shipped
      // with its spec in its own commit — the calc-DSL editor rules
      // (`calc-decorations`, `calc-preview`, `calc-token-ranges`,
      // `formula-editor-rules`) and thirteen `template-*` form-rule modules
      // behind the five authoring tabs, the unsaved-edit guard and the
      // instantiate payload. Branches lead again (+4.34 against +3.68
      // statements) for the reason the rules-split entry gives: these modules
      // are almost entirely decision logic — kind switching, trigger policy,
      // vocabulary closure, and the optional-key builders that decide between
      // an absent key and a sent value.
      //
      // **Most of this item's volume is invisible to this gate.** Ten new
      // `.tsx` files landed alongside — the five tabs, the editor and its lazy
      // wrapper, the tab strip, and two pages — and `include` reaches
      // `apps/web/src/lib/**` and nothing above it. That is deliberate and is
      // why the logic was put in `lib/` in the first place: `apps/web`'s Vitest
      // project runs `environment: "node"` over `src/**/*.test.ts`, so a `.tsx`
      // is unreachable by any test in this repo. What those files promise is
      // carried by the source scans in `tests/adr-0038-*.test.ts`, the same way
      // ADR 0027's page-level guarantee is carried in `tests/repo-invariants`.
      //
      // `packages/shared/src/calc-dsl`'s widened re-export is coverage-neutral
      // here for the reason the `F2.4` entry gives: `include` covers `apps/*`.
      //
      // **Measured on a long-lived local database, not a freshly seeded one**,
      // as every entry above was. Worth stating because this file already
      // documents two local/CI divergences (`F4.33`, still open, and the
      // `F4.34` note on compressed chunks). Two `CalcWriteService` warnings
      // fired during the run — `refresh window too small`, and a synthesised
      // `source_data_key` of 129 chars exceeding the 128-char column — so those
      // branches in `apps/api/src/calc/**` were reached from accumulated state
      // that `db:migrate` → `db:seed` may not reproduce. Two branches out of
      // 3974 is ~0.05%, comfortably inside the margin these thresholds leave.
      // Per axis, against the figures above: statements 0.37, branches
      // **0.32**, functions 0.39, lines 0.34 — so 0.32 is the binding one and
      // 0.05 sits well inside it. Recorded rather than assumed away.
      //
      // The first version of this line quoted "0.32–0.37" against the earlier
      // measurement, where the real per-axis margins were statements 0.32,
      // branches 0.37, functions 0.33 and **lines 0.29**. The range had left
      // out the tightest axis, so it overstated the headroom by claiming a
      // floor the gate did not have. Every axis is now listed rather than
      // summarised, because a range hides which constraint binds — and this
      // note's whole job is to say how a number was obtained.
      // **The unordered-fixture race has a second instance, found while
      // measuring this.** `evaluate-enabled-rules.integration.spec.ts:57` does
      // `select({id}).from(assets).limit(2)` with **no ORDER BY** — the same
      // shape as `alarm-enrichment.integration.spec.ts`'s `firstSeededAssetId`
      // recorded below — and failed with
      // `automation_rules_asset_id_fkey` on one full parallel run, passing 2/2
      // in isolation immediately after. Two files now share the defect, so it
      // is a pattern rather than one bad fixture. Still not fixed here: it is
      // `apps/api` rules-module code and unrelated to this item. CI will see
      // it intermittently.
      //
      // **Re-measured a third time, at the branch tip, 2026-08-21.** The
      // section 7 browser pass and the owner's `wc-admin` sign-in each found a
      // defect after the second measurement, and both fixes shipped with the
      // test that would have caught them — so the figure moved again. All 131
      // files / 483 tests running and none skipped:
      // 54.04 statements · 50.32 branches · 55.61 functions · 54.11 lines.
      //
      // Ratcheted 53.5/49.7/55.1/53.6 → 53.7/50.0/55.3/53.8. Per axis the
      // margin is statements 0.34, branches 0.32, functions 0.31, lines 0.31.
      // Banked rather than left: at the previous thresholds roughly 0.2 of
      // this item's own gain was unprotected, and a regression could have
      // given it back without tripping the gate — which is the exact failure
      // the `F4.46` entry above records finding in `main`.
      //
      // Ratcheted by `F3.1c` (the four dashboard widget renderers, ADR 0047)
      // from 53.7/50.0/55.3/53.8. Measured 2026-08-29 against the live
      // database (port 5433 on this machine), all 215 files / 1052 tests
      // running and none skipped: 68.52 statements · 65.33 branches ·
      // 70.68 functions · 68.57 lines.
      //
      // **The jump is almost entirely NOT this item's**, and that is stated
      // plainly so the next reader does not misattribute 15 points to three
      // small files. `F3.1c` adds exactly three files to this denominator —
      // `widget-catalog.ts`, `widget-value.ts`, `widget-echarts-option.ts`,
      // 333 lines together — against a 7517-statement denominator, roughly
      // 2% of it. The evidence, not just the claim: the `F2.5` entry above
      // (2026-08-21, the last time this ratchet was measured) recorded 131
      // files / **483 tests**; `F3.1a`'s closure record
      // (`docs/BACKLOG.md:436`) recorded **1023 passed**; this measurement
      // is **1052**. Test count more than doubled between the last ratchet
      // and `F3.1a` alone, and rose by 29 more since — several large items
      // landed in between (the `E7.1` multi-tenant series, ADR 0043–0047,
      // `F3.1a`) without anyone re-measuring this gate, so it had drifted
      // roughly 15 points **stale-low** rather than tight. This entry
      // catches the ratchet up to the branch tip; it does not claim `F3.1c`
      // wrote 15 points of new coverage.
      //
      // Two full-suite runs under default parallelism each hit a different,
      // unrelated pre-existing timeout flake — `evaluate-enabled-rules.
      // integration.test.ts` once, then `pre-commit-gate.test.ts` and
      // `telemetry-listener.test.ts` together on the next attempt — each
      // file verified green in isolation immediately after. Consistent with
      // the CPU-contention pattern this file already documents for
      // `evaluate-enabled-rules.integration.spec.ts` and
      // `alarm-enrichment.integration.spec.ts` above, not a regression from
      // this item. The measurement above is the clean `--no-file-parallelism`
      // rerun: 215/215 files, 1052/1052 tests, exit 0.
      //
      // **Margin widened well past this file's usual ~0.3, deliberately.**
      // This file documents two hazards against itself that a normal ~0.3
      // margin does not absorb: `apps/api/src/calc/**` branches reachable
      // only from state a fresh `db:migrate` → `db:seed` may not reproduce
      // (the `F2.5` entry above), and `F4.33` (compressed chunks) recorded
      // as still open. The measurement above was taken against this
      // machine's long-lived database, not the fresh one `db:migrate` →
      // `db:seed` produces per CI run — that is the divergence the margin
      // is for. (An earlier version of this note also cited
      // `--no-file-parallelism` as a reason to widen; that was wrong and is
      // corrected here — parallelism changes how many worker processes run
      // concurrently, not which lines execute, so it has no bearing on a
      // coverage measurement and was never a real hazard to margin against.)
      // A threshold CI cannot meet is worse than a stale-low one and §4.6
      // leaves no clean escape — never lower a threshold to go green — so
      // ~0.5–1.0 per axis is banked here instead of ~0.2, still catching
      // roughly 14 of the 15 stale-low points.
      // `F3.1d` (2026-08-30) — the dashboard builder, the read-only viewer and
      // the duplicate action. Measured against the live database on a full
      // serial run, 234/234 files and 1155/1155 tests, **none skipped**, exit 0:
      // 70.1 statements · 66.55 branches · 72.4 functions · 70.22 lines.
      //
      // **Most of what this row wrote is outside the denominator, and the rise
      // is smaller than the row's size suggests for that reason.** `include`
      // reaches `apps/web/src/lib/**` and nothing above it, so the four pure
      // modules Unit 4 added (`dashboard-grid-geometry`, `dashboard-widget-data`,
      // `dashboard-builder-form`, `dashboard-duplicate`) and Unit 1's extracted
      // `widget-config-form` are counted, while every page, component and hook
      // Units 6–7 and 9 wrote is invisible here. That asymmetry is the reason
      // the plan put the row's logic in `lib/` in the first place — logic above
      // that boundary is untested as far as this gate can tell, whatever its
      // own specs assert.
      //
      // Margin held at this file's post-`F3.1c` ~0.7–1.0 per axis rather than
      // narrowed: the two hazards documented above are unchanged — `apps/api/
      // src/calc/**` branches reachable only from state a fresh `db:migrate` →
      // `db:seed` may not reproduce, and `F4.33` still open — and this
      // measurement was again taken against this machine's long-lived database
      // rather than CI's fresh one.
      thresholds: {
        statements: 69.4,
        branches: 65.5,
        functions: 71.7,
        lines: 69.5,
      },
    },
  },
});
