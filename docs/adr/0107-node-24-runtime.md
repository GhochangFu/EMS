# ADR 0107 — Move the runtime from Node 20 to Node 24 (security item C2)

## Status

**Accepted — 2026-10-31** (owner). Proposed 2026-10-25; the merge of the PR
that carries this record lands it. Code citations are to `main` at `a731eee3`.

## Context

Every image and CI job runs Node 20, which is end of life and receives no fix.
The Node.js security release of 2026-10-21 fixed 10 CVEs, among them
CVE-2026-111497 (Brotli decoder out-of-bounds write, High) and three High
CVEs in hostname and IP validation, in 22.23.4, 24.22.1 and 26.12.1 only
(<https://nodejs.org/en/blog/vulnerability/october-2026-security-releases>).
The `api` image ran 20.20.2. The developer laptop already runs Node 24.14.0, so
the code and the test suite already run on 24. `@types/node` is already `^22`
in `apps/api` and `apps/e2e`, so it lags both the runtime and the laptop.

The repository has no `.nvmrc` and no `engines` field, so nothing states the
supported Node version.

## Decision

1. All Node base images move to Node **24.22.1**, pinned to the patch tag:
   `node:24.22.1-bookworm-slim` in `apps/api` (both stages), `apps/sim` and
   `apps/web` (build stage), and `node:24.22.1-alpine` in `apps/ingest`. A digest
   is not pinned: the tag is readable and a later patch is a deliberate edit.
2. `actions/setup-node` uses `node-version: 24` in `.github/workflows/ci.yml`
   (4 jobs) and `.github/workflows/e2e.yml`.
3. `@types/node` in `apps/api` and `apps/e2e` moves from `^22` to `^24`.
4. `.nvmrc` holds `24`. Root `package.json` gets `"engines": {"node": ">=24.22.1"}`.
5. Documentation that names Node 20 (`docs/local-setup.md`,
   `docs/AGENTS.production.md`) is updated. `AGENTS.md` names Node 20 in two
   places; that edit is a separate `chore(agents):` PR (§9.10).
6. The `nginx` runtime stage of `apps/web/Dockerfile` is out of scope here.
7. Fallback: if Node 24 breaks a build or a test that cannot be fixed small, the
   pin moves to Node 22.23.4, the other patched line.

## Dependencies

No new package. `@types/node` changes major version in two apps.

## Consequences

- `bcrypt@5.1.1` fetches an N-API prebuilt binding, which does not depend on the
  Node major. The image build must still load it (`require('bcrypt')`).
- Node 24 ships npm 11 and a newer V8. Timing and locale output can differ from
  Node 20 (see `apps/api/src/asset-health/health-score.ts`).
- Comments that cite "Node 20" as a measured fact (`docs/roadmap.md`, a spec
  comment) record history and stay as they are.
- Images must be rebuilt and redeployed. The AWS demo picks the change up on the
  next green CI deploy.

## Verification (2026-10-26)

- Images `api`, `ingest`, `sim` and `web` built with `--no-cache` on
  `24.22.1`. `node -v` printed `v24.22.1` in the `api`, `ingest` and `sim`
  images. The `web` runtime stage is `nginx`, which has no Node.
- `require('bcrypt')` loaded in the `api` image and a hash and compare returned
  `true`.
- `pnpm --filter api build` passed. The `api` unit tests passed (5232 passed,
  1942 skipped for lack of `DATABASE_URL`). One test timed out at 5000 ms under
  load and passed alone.
