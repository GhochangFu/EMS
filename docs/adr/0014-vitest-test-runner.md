# ADR 0014: Adopt Vitest as the test runner (F4.4)

- **Status:** Proposed — awaiting human approval (§9.4 dependency gate)
- **Date:** 2026-08-04
- **Backlog item:** `F4.4` (Wave 0, P0, ⭐ enabler)
- **Supersedes/amends:** partially promotes `docs/AGENTS.production.md` §10
  (Testing Standards) into `AGENTS.md` per §10 promotion process

---

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

## Consequences

**Positive.** A gate that actually runs on every PR; subagent output becomes
trustworthy enough to delegate, which is the whole point of doing `F4.4` first;
coverage becomes visible rather than assumed; no second runner migration when
the integration tier arrives.

**Negative.** One new devDependency and two config files. Two harnesses coexist
during the phased conversion — mitigated by keeping the `runXTests()` exports
as the single source of assertions, so nothing is duplicated.

**Neutral.** CI wall-clock grows by the test and seed steps; both are small
next to the existing build.

## Verification

The deliverable is a CI gate, so a green local run is not sufficient evidence.
`F4.4` is `✅` only when a workflow run on a pull request shows the `Run tests`
and `Validate seed against a fresh schema` steps passing on a clean Timescale
service container.

That seed step is also the first end-to-end exercise of the repaired
`meta/_journal.json` on a genuinely fresh database — the local fix was applied
by hand via `psql` because a back-dated migration cannot self-apply. A red run
there is a real finding about the journal, not a CI configuration problem.
