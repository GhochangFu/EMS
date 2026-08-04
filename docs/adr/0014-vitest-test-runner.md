# ADR 0014 — Adopt Vitest as the test runner

## Status

Accepted (2026-08-04). Backlog item `F4.4` (Wave 0, P0, ⭐ enabler).

**The §10 promotion is deliberately deferred, not done.** This ADR adopts a
runner; it does **not** copy `docs/AGENTS.production.md` §10 (Testing Standards)
into `AGENTS.md`, and `AGENTS.md` still has no testing section. Per AGENTS.md
§9.10 that edit may not ride along in a feature PR. It is owed as a separate
`chore(agents):` commit — see Consequences. This follows the precedent set by
ADR 0013.

## Context

`F4.4` is the designated first build cycle because a trusted test gate is the
precondition for delegating work to subagents without reading every diff
(`docs/build-operating-model.md` §4). Today the repository has no test runner.

What exists instead: seven hand-rolled spec files executed by `tsx`, each
exporting a `runXTests()` function and asserting via a local `assert()` helper.

Three concrete gaps were measured on `main` at `7abee62`:

1. **Two spec files were never executed by anything.**
   `apps/api/src/admin/admin.schema.spec.ts` and
   `apps/api/src/dashboard/dashboard.schema.spec.ts` are committed but absent
   from the `test:onboarding` script. Both pass when run by hand — they are
   orphaned, not broken. This is the same silent-failure class as the drizzle
   journal bug: the artefact exists, nothing runs it.
2. **CI never ran any test.** `.github/workflows/ci.yml` ran `typecheck` and
   `db:migrate` only. A suite that CI does not execute is not a gate.
3. **CI never ran `db:seed`,** which is the only check that proves the
   migration journal is complete. That is precisely how `0018`/`0021`/`0022`
   reached `main` without creating `bms.point_keys`.

Gaps 1–3 need no new dependency and are addressed in a separate commit ahead of
this ADR. What remains — replacing the hand-rolled harness with a real runner —
adds a dependency, and `AGENTS.md:160` requires an ADR for that.

## Decision drivers

- `AGENTS.md:160` / §9.4 — no new dependency without an ADR.
- `docs/AGENTS.production.md` §10 already names **Vitest** for both the unit and
  integration tiers, and Playwright for E2E. The runner choice was pre-declared
  by the project's own production standard.
- The seven existing specs must keep asserting exactly what they assert today.
  Standing up infrastructure and changing test content in the same step makes
  both unreviewable.

## Options considered

### A. `node --test` (Node 20 built-in) — zero dependencies

No dependency, therefore no §9.4 gate. Runs the existing files close to as-is.
But it needs a loader shim for TypeScript, has weaker watch/coverage
ergonomics, gives `apps/web` no JSDOM or Vite-transform story, and contradicts
the already-declared production standard. Choosing it means either amending
`AGENTS.production.md` §10 or migrating a second time later.

### B. Vitest — recommended

Already implied by `AGENTS.production.md` §10. `apps/web` is Vite-based, so it
inherits the existing transform and path aliases at near-zero config. Native TS
and ESM, so no loader shim. Provides the coverage instrumentation the operating
model's gate depends on, and is the same runner the production standard names
for the integration tier — so the testcontainers work later in Wave 0+ does not
require a second migration.

Cost: one devDependency (plus `@vitest/coverage-v8`), and `apps/api` needs its
own small config since it is not a Vite app.

### C. Jest

Mature, but slower on ESM/TS in this layout, needs more config for both apps,
and is not what §10 declares. No advantage here that offsets that.

## Decision

**Adopt Vitest (option B)**, phased so that the migration is mechanical and
reviewable:

1. Add `vitest` + `@vitest/coverage-v8` as root devDependencies; a workspace
   config per app (`apps/web` extends the existing Vite config; `apps/api` gets
   a minimal node-environment config).
2. **Keep every existing `runXTests()` exported function unchanged.** Add thin
   `*.test.ts` files that import and call them. This preserves every current
   assertion, keeps the diff readable, and means a regression during migration
   is impossible to confuse with a behaviour change.
3. Point `pnpm test` at Vitest; keep `test:onboarding` as a named subset so the
   command documented in `CLAUDE.md` keeps working.
4. Convert the `runXTests()` bodies to idiomatic `describe`/`it` **later**, per
   file, as those files are touched by feature work — not in this cycle.

`test:onboarding` is a **filename substring filter**, not an enumeration: any
future file whose path contains `onboarding`, `credential-crypto`,
`admin-access` or `rtu-config` joins that subset silently. That is acceptable
for a convenience alias; `pnpm test` remains the complete run.

## Dependencies

Root `devDependencies` only — nothing reaches a production build
(`apps/api/tsconfig.build.json` excludes `**/*.test.ts` and `vitest.config.ts`):

- `vitest` `^4.1.10`
- `@vitest/coverage-v8` `^4.1.10`

### Coverage gate

`AGENTS.production.md` §10 specifies 80% lines / 70% branches, and 95% for
command/alarm/audit/RBAC. **Those thresholds are not adopted yet.** With seven
spec files the real figure is in the single digits; declaring 80% now would
force either an immediate broad test-writing effort or an
`autoUpdate`-style escape hatch that renders the gate meaningless.

Instead: enable coverage **reporting** now, set the initial threshold to the
measured baseline, and ratchet it upward as each feature lands with its tests.
The §10 targets stay the destination and are promoted into `AGENTS.md` when the
numbers are genuinely met — not before.

Baseline measured at implementation time. Untested files are counted, so the
denominator is not a flattering subset — but it is **not** the whole repository
either. Scope is `apps/api/src`, `apps/web/src/lib` and `apps/ingest/src`;
`packages/shared`, `packages/db`, `apps/sim` and everything in `apps/web/src`
outside `lib/` (i.e. all React components) are **out** of the denominator. Read
these numbers as "of the code we currently claim to test", not "of the product".

| Metric | Measured | Threshold set |
| --- | --- | --- |
| Statements | 3.60% (108/2996) | 3.5% |
| Branches | 1.86% (40/2150) | 1.8% |
| Functions | 3.37% (19/563) | 3.2% |
| Lines | 3.72% (107/2876) | 3.6% |

Each threshold sits just under its measurement, so a regression trips the gate
while ordinary churn does not. These numbers are deliberately unflattering —
that is the point of recording them.

### Coverage cannot detect an unwrapped spec — a structural test does

Vitest excludes `*.spec.*` and `*.test.*` from coverage by default, and listing
them under `coverage.exclude` does not change that (verified: no spec file
appears in `lcov.info` either way). So a `.spec.ts` added without its `.test.ts`
wrapper would be invisible to the runner *and* to the coverage gate — exactly
gap 1 of the Context above, rebuilt by the fix for it.

`tests/repo-invariants.test.ts` closes this: it walks `apps/` and `packages/`
and fails if any `.spec` file lacks a sibling `.test` wrapper. It is the direct
counterpart of `.claude/hooks/check-drizzle-journal.mjs`, which asserts every
migration `.sql` has a journal entry. Verified by deleting a wrapper and
confirming the suite goes red.

## Consequences

**Positive.** A gate that actually runs on every PR; subagent output becomes
trustworthy enough to delegate, which is the whole point of doing `F4.4` first;
coverage becomes visible rather than assumed; no second runner migration when
the integration tier arrives.

**Negative.** Two new devDependencies and four config files. Two harnesses
coexist during the phased conversion — mitigated by keeping the `runXTests()`
exports as the single source of assertions, so nothing is duplicated.

**Owed follow-up (blocking nothing, but do not lose it).** A separate
`chore(agents):` commit must, per AGENTS.md §10:

1. Add a testing section to `AGENTS.md` describing what is *actually* adopted —
   Vitest, `.spec`-holds-assertions / `.test`-wraps convention, and a
   baseline-ratchet coverage gate — **not** §10's 80%/70%, which remain
   aspirational.
2. Update the §2 stack table, which still says CI does "install, build/typecheck,
   and migration validation" and omits `typecheck:tests`, `db:seed` and
   `test:coverage`.
3. Mark the phase active in `docs/roadmap.md`.

§10 step 5 asks for that PR to land *before* the feature code. That ordering is
inverted here, knowingly: the rules should describe a runner that demonstrably
works, and its coverage numbers cannot be written down until it has run.

**Neutral.** CI wall-clock grows by the test and seed steps; both are small
next to the existing build.

### Two ordering constraints that are load-bearing

- **Tests run last in CI, after `db:seed`.** Vitest fails fast, so running it
  earlier lets one broken unit test abort the job before the seed step — the
  step that exists specifically to catch an incomplete migration journal. The
  cheap-checks-first instinct is wrong here.
- **CI runs `test:coverage`, not `test`.** Thresholds are only evaluated when
  the coverage provider runs; plain `test` would go green while coverage
  regressed.

### Typechecking the wrappers

`nest build` uses `tsconfig.build.json`, which excludes `**/*.test.ts`, so the
API wrappers would be compiled by nothing and checked by nothing — the same
"artefact exists, nothing runs it" shape this cycle exists to eliminate.
`vitest --typecheck` does not close it (it only covers `*.test-d.ts` and is
flagged experimental), so a `typecheck:tests` script runs `tsc --noEmit` over
the full API project instead. `apps/web` already covers its own via
`tsc --noEmit`.

## Verification

The deliverable is a CI gate, so a green local run is not sufficient evidence.
`F4.4` is `✅` only when a workflow run on a pull request shows the `Run tests`
and `Validate seed against a fresh schema` steps passing on a clean Timescale
service container.

That seed step is also the first end-to-end exercise of the repaired
`meta/_journal.json` on a genuinely fresh database — the local fix was applied
by hand via `psql` because a back-dated migration cannot self-apply. A red run
there is a real finding about the journal, not a CI configuration problem.
