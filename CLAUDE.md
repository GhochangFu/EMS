# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## Read the rulebook first

**[`AGENTS.md`](./AGENTS.md) is the authoritative rulebook** for scope, code
style, architecture, and process. Read it — and the source files you are about
to touch — before editing anything. It is maintained by the human/AI team and
may only be changed via a `chore(agents): ...` PR.

This file does **not** duplicate AGENTS.md. It only points to it and records
the few things an agent needs to orient quickly.

### Precedence when documents conflict

AGENTS.md is authoritative on **code rules, architecture, and process**
(§4 code rules, §5 visual reference, §9 agent operating rules, §10 promotion
process). However, its **status line and §6 "Out of Scope" list lag behind
`main`**. Where they conflict with recent ADRs (`docs/adr/`) and git history,
**the ADRs and commits are authoritative on what is actually in scope now.**
Scope changes in this repo are made through ADRs per AGENTS.md §10, so a newer
ADR that amends AGENTS.md wins on the "is this in scope" question.

Concretely, as of the latest commits on `main`:

- The **AI onboarding wizard** and **PHE MQTT real ingestion** are merged and
  in scope (ADR 0007–0012), even though AGENTS.md §6 still lists "Real
  protocol adapters (MQTT)" and "AI Copilot" as out of scope, and its status
  line stops at "Phase 5 Sprint J/K/L/M/N Location and Access."
- `apps/ingest` exists (MQTT TLS subscriber) but is not in AGENTS.md §3's
  repository layout.

When in doubt about current scope, check `docs/adr/` and `git log` before
trusting AGENTS.md's status/§6.

## What this project is

A real-time enterprise monitoring platform (BMS/EMS) for electrical, HVAC,
UPS/battery, water and environmental telemetry across sites. Product brand
**TRINETRA**, powered by Euphoria Infotech India Limited. Per **ADR 0013** this
repository is the **Enterprise EMS product line for Ion Exchange (India)
Ltd.**, forked from the Eskom SMOC engagement (earlier branding: Eskom SMOC /
InfraPulse). Internal identifiers (`smoc_campus`, org code `ESKOM`, seed demo
data, `ESKOM_SMOC.html` mockups) intentionally keep their Eskom-era names —
display-layer branding only was changed. The live pending-feature backlog is
`docs/BACKLOG.md`.

Core pipeline: `simulated device / real MQTT RTU → Postgres + TimescaleDB →
NestJS API → WebSocket (Socket.IO) → React UI → user`.

## Layout

pnpm monorepo (`apps/*`, `packages/*`):

- `apps/web` — React 18 + Vite + Tailwind + TanStack Query + Zustand SPA
- `apps/api` — NestJS REST + WebSocket (module-per-domain under `src/`)
- `apps/sim` — telemetry simulator (Node script)
- `apps/ingest` — MQTT TLS subscriber for the PHE real-ingestion pilot
- `packages/shared` — cross-cutting TS types & constants
- `packages/db` — Drizzle schema, migrations, seeds
- `docs/adr/` — architecture decision records (the live record of scope changes)
- `docs/roadmap.md` — phase/sprint plan and status
- `ESKOM_SMOC.html` / `TRINETRA.html` — read-only UX reference mockups

## Commands

```bash
pnpm install                       # postinstall builds @bms/shared and @bms/db
pnpm db:migrate && pnpm db:seed    # set up / seed the database

# Dev (three processes):
pnpm --filter api dev              # NestJS on :4000
pnpm --filter web dev              # Vite on :5173
pnpm --filter sim start            # telemetry simulator

pnpm build                         # builds shared → db → api → web
pnpm typecheck                     # alias of build
pnpm test                          # Vitest, all projects (api · web · ingest)
pnpm test:watch                    # Vitest in watch mode
pnpm test:coverage                 # + coverage thresholds — what CI enforces
pnpm test:onboarding               # onboarding/credential/ingest subset
```

Docker Compose profiles (`core`, `sim`, `pilot`, `observability`, etc.) are
documented in [`README.md`](./README.md). Full local setup:
[`docs/local-setup.md`](./docs/local-setup.md).

Seeded demo logins (local `AUTH_MODE`): `admin@bms.local` / `admin123`
(global), `wc-admin@bms.local` (location-scoped), `wc-hvac-admin@bms.local`
(asset-group-scoped).
