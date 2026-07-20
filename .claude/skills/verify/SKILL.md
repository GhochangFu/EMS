---
name: verify
description: Run the TRINETRA BMS verification suite from AGENTS.md §7 — package builds, spec/smoke tests, and simulator/ingest syntax checks — and report pass/fail with evidence. Use before committing non-trivial changes, before opening a merge request, or whenever asked to confirm the repo is green.
disable-model-invocation: true
---

# Verify

Run the project's verification commands and report the result honestly. Never
claim "passing" without showing the command output. Run from the repo root
(`D:\Projects\portal.bms`). Use the Bash tool (pnpm/tsx/node are POSIX-friendly).

## 1. Static checks (no running services or DB needed)

Run these first — they are always safe to run:

```bash
pnpm --filter @bms/shared build
pnpm --filter @bms/db build
pnpm --filter api build
pnpm --filter web build
node --check apps/sim/src/index.js
pnpm test:onboarding
```

`pnpm test:onboarding` runs the onboarding schema, credential-crypto,
redaction, preview, admin-access, and RTU-config specs (the repo's only test
script — there is no Jest/Vitest runner; specs execute via `tsx`/`node`).

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
- Only report the suite as green when every command you ran actually succeeded.

Scope this to what the change touched when a full run is impractical (e.g. a
web-only change needs `@bms/shared` + `web` builds + the relevant smoke), but
say so explicitly when you narrow it.
