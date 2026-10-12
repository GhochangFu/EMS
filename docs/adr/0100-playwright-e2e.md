# ADR 0100 — Playwright end-to-end tests for the critical user paths (`F4.7`)

## Status

**Accepted — 2026-10-12** (owner, with every drafter choice below; proposed
the same day). Source: owner rulings 2026-10-12, four questions
put one at a time; each was ruled for the recommended option. Each ruling maps
to a numbered decision below. Where a decision needed a detail the rulings do
not give, the detail is listed under *Drafter choices (not asked)* for the
owner to confirm at acceptance. Drafted before any implementation code. Line
citations are to `main` at `3067fc07`.

Promotes nothing out of `AGENTS.md` §6: §6 does not list end-to-end tests.

| Ruling (2026-10-12) | Decision |
| --- | --- |
| 1 — the suite tests the built web bundle (`vite build` + `vite preview` on :5173) against the API run from source in local auth, on the CI Postgres and Redis | 4 |
| 2 — the CI job runs once when a PR gets the `e2e` label, and by manual dispatch | 5 |
| 3 — local sign-in: one spec drives the login form, the rest sign in per role through `POST /auth/login`; raise a row for one OIDC smoke test | 6, 9 |
| 4 — the first suite is the core five paths | 7 |

## Context

- `F4.7` ("E2E (Playwright) for critical UX paths", P1, Wave 1) depends only on
  `F4.4`, which is done (`docs/roadmap.md:677`).
- ADR 0014 chose Vitest for the unit and integration tiers and recorded that
  `docs/AGENTS.production.md` §10 had already named Playwright for E2E
  (`docs/adr/0014-vitest-test-runner.md:43-45`). It decided nothing about E2E.
  `docs/AGENTS.production.md:281-284` lists the production standard's E2E
  paths: login to dashboard, alarm ack, command dispatch, energy report, campus
  drilldown, command audit.
- ADR 0099 says `F4.7` "should land before release 2, when the master-data
  forms change" (`docs/adr/0099-admin-copilot.md:448`). Release 2 is `F3.86`.
  It adds copilot catalog entries and stepper wizards for locations, RTUs,
  assets, asset groups, point keys, asset points, users and grants.
- The repo has no E2E layer. A user path is gated today by jsdom specs (which
  stub the API and the socket), the API integration suites, and a browser run
  by hand or by the `browser-verifier` agent at step 6. `F3.37` measured that
  browser run at 360.2k of one session's 363.4k message tokens
  (`.claude/skills/verify/SKILL.md` §4).
- Two rules gate this record. `AGENTS.md` §9 rule 4: no new dependency without
  an ADR. `AGENTS.md` §4.6: "Never add a second runner without an ADR (§9.4)".
  Playwright brings its own runner.
- No `playwright` package resolves in `pnpm-lock.yaml` today. The only mention
  is Vitest's optional, uninstalled peer `@vitest/browser-playwright`.

## Decision

1. **The dependency.** Add `@playwright/test` **`1.63.0`**, exact (no caret),
   Apache-2.0, as a `devDependency` of a new private workspace package,
   `apps/e2e`. No other package depends on it. CI installs Chromium only.
   The version is a drafter choice (below).

2. **A second runner, kept apart from Vitest.** The E2E suite runs on
   Playwright's own runner and nowhere else.
   - `pnpm test`, `pnpm test:watch` and `pnpm test:coverage` never run it.
     `apps/e2e` is not added to the root `vitest.config.ts` `projects` list.
   - A new root script, `pnpm test:e2e`, runs it.
   - The suite contributes nothing to coverage, and no coverage threshold
     counts it.

3. **Placement and naming.**
   - Specs live in `apps/e2e/specs/` and are named `*.e2e.ts`, with
     `testMatch: "**/*.e2e.ts"` set explicitly. The name `*.spec.ts` is
     already the Vitest convention in `apps/api` and `apps/web`, and
     `tests/repo-invariants.test.ts` fails a web `.spec` that has no `.test`
     wrapper.
   - `apps/e2e` has its own `tsconfig.json`. `pnpm typecheck:tests` gains
     `tsc -p apps/e2e/tsconfig.json --noEmit`. The `build` chain does not
     include `apps/e2e`, and `tsconfig.typecheck-tests.json` does not list it.
   - The `apps/*` glob in `pnpm-workspace.yaml` already covers the package.

4. **What the suite tests (ruling 1).**
   - The web: `vite build` with `VITE_AUTH_MODE=local`, served by
     `vite preview` on `127.0.0.1:5173`. Port 5173 is required: the API's CORS
     allowlist names only `localhost:5173` and `127.0.0.1:5173`
     (`apps/api/src/main.ts:43`).
   - The API: built from source and run with `AUTH_MODE=local`, no
     `OIDC_ISSUER`, on `:4000`.
   - The database: Postgres with Timescale, then `roles`, `db:migrate` and
     `db:seed` as `ci.yml` does them. Redis.
   - The simulator: `apps/sim`, which writes `telemetry.point_values` and calls
     `pg_notify('bms_telemetry', …)` for the API (`apps/sim/src/index.js:5`).
   - Not started: Keycloak, the worker, the ingest service, and Docker images.
     The plan confirms which of MinIO and the worker the API needs for the
     five paths, and starts only those.
   - **What this replaces, and what it does not.** The suite can replace the
     browser checks of logic at step 6 for the paths it covers: a route
     renders, a write persists across a reload, a scope hides a record. It
     does **not** replace the check of what is actually served. It never
     runs the Docker images, so it cannot see a stale image or a container
     that did not restart (`.claude/skills/verify/SKILL.md` §4.1). That check
     stays at step 6.

5. **When it runs in CI (ruling 2).**
   - A separate workflow, `.github/workflows/e2e.yml`. It is not in `ci.yml`
     and is not a required check.
   - Triggers: `pull_request` with `types: [labeled]`, guarded by
     `github.event.label.name == 'e2e'`, and `workflow_dispatch`. It never
     runs on a push to `main` and has no schedule.
   - The agent adds the label to a PR that touches a covered path: the login,
     the socket path, alarms, the master-data pages, users and grants. Each
     `F3.86` PR is such a PR. The PR body records the run.
   - It uses `pull_request`, never `pull_request_target`, and needs no
     repository secret.
   - Chromium is installed with `playwright install --with-deps chromium`,
     and `~/.cache/ms-playwright` is cached on the pinned version.
     *Correction 1:* the first draft also set
     `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` on installs that do not run E2E.
     `playwright@1.63.0` publishes no install script, so `pnpm install`
     downloads no browser and the variable does nothing; it is not set.
   - On failure only, the job uploads the Playwright report and traces with a
     short retention. They hold the seeded demo data and a token signed by
     the run's own secret, which dies with the run.

6. **How the suite signs in (ruling 3).**
   - One spec fills in the real login form at `/login`.
   - Every other spec starts signed in: a global setup calls
     `POST /auth/login` once per role and saves the `bms-auth` localStorage
     entry (`apps/web/src/stores/auth-store.ts:67`) as a Playwright
     `storageState` file. The files are written per run and are git-ignored.
   - The roles are the four seeded ones, password `admin123`
     (`packages/db/src/demo-users-seed.ts`): `admin@bms.local` (global
     `admin`), `phe-admin@bms.local` (`organization_admin`),
     `wc-admin@bms.local` (`location_admin`), `wc-hvac-admin@bms.local`
     (`asset_group_admin`). The Keycloak realm's `operator@bms.local` and
     `viewer@bms.local` have no database row, so the suite does not use them.
   - `JWT_SECRET` is generated per run and masked; the public fallback
     `dev-only-change-me` (`apps/api/src/auth/auth.module.ts:23`) is never
     used.
   - The Playwright config refuses a base URL whose host is not `127.0.0.1`
     or `localhost`. The suite never runs against `bms.demosites.co.in` or
     any shared deployment.

7. **The first suite (ruling 4): five paths.**
   1. Log in through the form, reach the Control Room at `/`, and stay
      signed in after a reload.
   2. A live value changes on screen over Socket.IO while `apps/sim` runs.
   3. Acknowledge an active alarm; the row's state changes and stays changed
      after a reload. The seed's two demo alarms are already acknowledged and
      cleared (`packages/db/src/demo-operations-seed.ts`), so the alarm comes
      from the API's alarm engine on simulated values
      (`apps/api/src/alarms/alarm-engine.service.ts:181`) or from the suite's
      own setup. The plan proves which one works before it writes the spec.
   4. Create a location, then an RTU, an asset and its points, through the
      admin pages. This is the safety net for `F3.86`.
   5. `wc-admin@bms.local` sees its own location and not another one, on a
      list page and by direct URL.

   Each spec asserts exact values, not an impression of the screen. A spec
   that creates a record names it with a per-run prefix, so a second run on
   the same database passes.

8. **The copilot path is not in the first suite.** The API has no stub LLM
   provider: `platformDefault()` accepts only real providers and needs their
   key (`apps/api/src/llm/llm-resolver.ts:103-120`). A copilot spec would need
   the real OpenRouter key in CI, and the repo is public. The jsdom specs of
   the dock and the wizard shell stay that path's gate.

9. **The follow-up row.** Raise `F4.253`: one OIDC smoke test that drives the
   Keycloak login form against the CI Keycloak container, with a web build
   that carries the OIDC settings. Depends on `F4.7`.

## Security

- No new secret enters the repo or CI. The demo password `admin123` is
  already public in `packages/db/src/demo-users-seed.ts` and
  `infra/keycloak/bms-realm.json`. It is valid only on the run's own
  database.
- `JWT_SECRET` is generated per run (decision 6). `storageState` files are
  git-ignored and written per run.
- The workflow uses `pull_request` with no secrets (decision 5), so a PR from
  a fork cannot read one.
- The base-URL guard keeps the suite off any shared deployment (decision 6).

## Drafter choices (not asked)

- **The version, `1.63.0`.** It is the newest stable release that a later
  release has followed. `1.64.0` was published on 2026-10-07, five days
  before this record. The repo has no rule on a release's age; this is a
  caution, not a rule. The owner can choose `1.64.0` at acceptance.
- **The package name `apps/e2e`**, and the spec suffix `*.e2e.ts`.
- **Report retention** on a failed run: three days.
- **Chromium only.** No Firefox or WebKit run; the product's users run
  Chromium-based browsers on the control-room wall and the admin desks.
- **No copilot follow-up row.** A stub LLM provider would let a copilot spec
  run in CI. It is a product change to the API, so it is not raised here. The
  owner can ask for it.

## Dependencies

`@playwright/test` `1.63.0` (Apache-2.0), a `devDependency` of `apps/e2e`
only. It is the only new package. It pulls in `playwright` and
`playwright-core` at the same version; no runtime package of `apps/api`,
`apps/web` or `packages/*` changes.

*Correction 1 (owner, 2026-10-12, at the plan gate):* `apps/e2e` also
declares `@types/node` `^22.10.5`, the range `apps/api` already uses
(`apps/api/package.json:56`). It is not new to the repo. The Playwright
config needs the `process` and `node:crypto` types, and `playwright-core`
does not declare them.

## Consequences

- A broken login, socket path, alarm acknowledgement, master-data form or
  location scope fails a labeled PR before merge. `F3.86` gets that net
  before it changes the master-data pages.
- Step 6 gets cheaper for the covered paths: a green labeled run stands for
  the browser checks of logic, and only the served-image check stays manual.
- Each labeled run costs about 8–10 billed Actions minutes. An unlabeled PR
  costs nothing more than today.
- The label is a habit, not a gate: nothing forces the agent to add it. The
  PR body records whether it ran.
- The OIDC login path (PKCE and the callback) stays without E2E coverage
  until `F4.253`.
- `AGENTS.md` §4.6 needs an E2E rule (when to label, what the suite
  replaces). It lands in a separate `chore(agents):` PR after the feature
  (§9 rule 10).

## Verification owed

- The workflow runs green on the feature PR itself, labeled `e2e`.
- `pnpm test` and `pnpm test:coverage` still run exactly the Vitest projects
  they ran before; no `*.e2e.ts` file is collected.
- Each of the five specs is shown to fail when its feature is broken (one
  mutation each), and passes again when restored.
- The base-URL guard refuses a non-local host.
