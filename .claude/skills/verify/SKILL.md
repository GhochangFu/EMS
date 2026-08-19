---
name: verify
description: Run the TRINETRA BMS verification suite from AGENTS.md §7 — package builds, the Vitest suite, test type-checking, and smoke checks — and report pass/fail with evidence. Use before committing non-trivial changes, before opening a merge request, whenever asked to confirm the repo is green, and at step 1 of `backlog-cycle` mode `done`.
---

# Verify

Run the project's verification commands and report the result honestly. Never
claim "passing" without showing the command output. Run from the repo root
(`D:\Projects\portal.bms`). Use the Bash tool (pnpm/tsx/node are POSIX-friendly).

## 1. Static checks (no running services or DB needed)

Run these first — they are always safe to run:

```bash
pnpm typecheck                      # = pnpm build: shared → db → api → web → ingest
pnpm typecheck:tests                # the tests/ files and vitest configs
node --check apps/sim/src/index.js
pnpm test                           # vitest run — the whole suite
```

**The runner is Vitest (ADR 0014).** `pnpm test` runs everything;
`pnpm test:coverage` adds the thresholds and is **what CI enforces** — run that
one before a merge request rather than `pnpm test`. `pnpm test:onboarding` is a
narrow subset (onboarding, credential-crypto, admin-access, RTU-config) for a
fast loop while working in that area; it is **not** a substitute for the suite,
and reporting it as "tests pass" is a false green.

Prefer `pnpm typecheck` over building the packages one by one: the root script
also builds `ingest`, which a hand-written list has forgotten before.

`pnpm typecheck:tests` names each `tests/` file explicitly instead of globbing,
because `tests/` has no `tsconfig.json`. A new invariant file is type-checked by
nothing until it is added there by hand (AGENTS.md §4.6).

**Integration suites gate on `DATABASE_URL`, asymmetrically.** Unset, they skip
locally but **throw under `CI`**. Set, a failed connection fails everywhere
rather than skipping. Coverage thresholds assume those suites ran, so a local
run with no database is a *partial* result — say so.

## 2. Smoke checks (need the dev stack and/or a seeded DB)

Only run these if the API/DB are up, or start them first. They will fail with
connection errors otherwise — report that as "not run", not as a failure:

```bash
pnpm --filter web smoke:cr          # Control Room extension smoke
pnpm --filter web smoke:realtime    # Redis-backed Socket.IO fan-out
pnpm --filter @bms/db verify:hierarchy   # Org→Location→RTU→Asset hierarchy (needs DB)
```

If the change touches the DB schema/seed, also run a clean migration/seed
(`pnpm db:migrate && pnpm db:seed`) against a scratch database — this is on the
open Location-and-Access hardening checklist in `docs/roadmap.md`.

## 3. Report

- Show the exact commands you ran and their pass/fail status.
- If anything failed, paste the relevant error output and stop — do not
  paper over it.
- State clearly which smoke checks were **skipped** because services weren't
  running. "Skipped" is not "passed".
- Name the narrowing. If you ran `test:onboarding` instead of `test`, or `test`
  instead of `test:coverage`, or had no `DATABASE_URL`, say which suites did not
  run. A subset reported as "the tests" is the false green this skill exists to
  prevent.
- Only report the suite as green when every command you ran actually succeeded.

Scope this to what the change touched when a full run is impractical (e.g. a
web-only change needs `pnpm typecheck` plus the relevant smoke), but say so
explicitly when you narrow it.

A green suite is not a deployment. Step 6 of
[`docs/build-operating-model.md`](../../../docs/build-operating-model.md) —
verification against the running Docker stack — is a separate step, and this
skill does not cover it.
