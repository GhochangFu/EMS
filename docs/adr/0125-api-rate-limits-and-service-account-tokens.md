# ADR 0125 — API rate limits that hold across replicas, and service-account tokens (`F4.17`)

## Status

**Proposed — 2026-11-10.** Drafted by an agent for backlog row `F4.17`, as one
of four overnight scope drafts (E3.1 → ADR 0122, E7.2 → ADR 0123, F4.5 → ADR
0124). Nothing here is ruled. Every line marked *(recommended)* is the
drafter's recommendation for a numbered open question below; the owner rules
each one at the scope gate. The step-3 plan is
[`docs/plans/f4.17-rate-limits-service-tokens.md`](../plans/f4.17-rate-limits-service-tokens.md),
and no code is written before the owner approves it.

## Context

`F4.17` asks for two things: **API rate limiting** (per identity and per IP,
holding across API replicas) and **service-account tokens** (non-human
identities with scoped, revocable, audited access). Two security reviews
recorded the gap: `F2.12` (2026-09-03 — no HTTP rate limit on any route;
`GET /admin/asset-templates/stock` returns about 77 KB per call) and `F4.101`
(2026-09-07 — the telemetry import still costs up to about 1.5 s of blocked
event loop per 2.7 KB upload and can be repeated).

What exists today, read from `main` at `0bc360c`:

**Rate limits.** There is no general HTTP limiter. `apps/api/package.json` has
no `@nestjs/throttler` and no `express-rate-limit`, and no `APP_GUARD` is
registered anywhere. The bounds that do exist are all domain-specific:

- `F3.47`: *Evaluate now* has a 30 s in-process `Map`
  (`apps/api/src/rules/evaluate-throttle.ts`). Each API process holds its own
  `Map`, so `api-replica` doubles the ceiling, as the `docker-compose.yml`
  comment on that service already admits.
- The copilot has daily turn caps per user and per organization in Postgres
  (`copilot_usage`, `copilot_org_usage`; `COPILOT_USER_DAILY_TURNS` 150,
  `COPILOT_ORG_DAILY_TURNS` 1500). It also has per-turn bounds
  (`MAX_TOOL_CALLS_PER_TURN` 8, 45 s deadline; onboarding 120 s).
- Notification channels have a `ratePerHour` (ADR 0041).
- Upload routes have multer size limits (5 MB imports, 10 MB images, 64 KB
  SVG, 3 × 10 MB copilot attachments).

The two existing 429 bodies differ. The rules route returns a string
`message`; the copilot route returns `{statusCode, message, scope, resetsAt}`.

**Authentication.** `JwtAuthGuard` (`apps/api/src/auth/jwt-auth.guard.ts`) is
applied per controller, 67 times. Some routes have no guard: `/health`,
`/health/ready`, `/metrics` (all outside the `api/v1` prefix),
`/api/v1/public/appearance` and `POST /api/v1/auth/login`.

- **Under OIDC**, the guard verifies RS256 against the Keycloak JWKS. It
  refuses any token whose `azp` is not `OIDC_CLIENT_ID`, so a client-credentials
  token from another Keycloak client is refused today.
- **Under local `AUTH_MODE`**, `POST /auth/login` signs an HS256 JWT with
  `JWT_SECRET`.
- **The principal** (`jwtPayloadSchema`) is `{sub, email, name, role,
  emailVerified?}`. It carries no organization and no scopes.
  `resolveDbUser` makes the `bms.users` row authoritative for role and
  organization (ADR 0089), and a row with `disabled_at` set is refused with
  401.
- **Socket.IO** (`/ws/telemetry`, `/ws/alarms`) checks the handshake through
  the same `verifyToken`. Neither gateway limits connection count or rate.

**No inbound machine credential exists.** The only `client_credentials` use is
outbound: `KeycloakIdentityAdminClient` as `bms-api-admin`, which holds
`manage-users` and `view-users` only (ADR 0089).

**Tenancy and audit.** A request runs on one of three pools:

- `bms_tenant`, with `app.current_organization` and `app.current_user` set by
  `withTenant` and `withUser`;
- `bms_fleet` (BYPASSRLS) for the global `admin`;
- `bms_auth` for the pre-tenant identity read (ADR 0043 decision 8 and
  Amendment 1, ADR 0045).

`bms.audit_log.actor_id` is a foreign key to `bms.users`, and
`MasterDataAuditService` is the writer.

**Topology.**

- **AWS demo** (ADR 0096): Caddy on the host terminates TLS. It proxies to the
  `web` nginx container (`deploy/aws/nginx.conf`), which sets `X-Real-IP` and
  appends `X-Forwarded-For` before proxying `/api/`, `/socket.io/` and
  `/health` to a single `api`. `main.ts` does not set `trust proxy`, so
  `req.ip` would be the nginx container's address for every caller.
- **Local compose**: `api-replica` (profile `realtime-smoke`, port 4001) is a
  second process that shares the database and Redis.
- **Redis** is `redis:7-alpine` with `noeviction` and `mem_limit: 256m` on AWS.
  It is unauthenticated (`--requirepass` is `F3.12`'s gate, ADR 0063
  Amendment 2). It is optional in the API: with `REDIS_URL` unset, Socket.IO
  falls back to in-process and the queue reports "unconfigured". The API
  reaches Redis through `redis@^5` (node-redis), used by the Socket.IO
  adapter. `ioredis` arrives only transitively, through `bullmq`.

**Scope boundaries this ADR must respect:**

- **Redis.** AGENTS.md §2/§9.7 approve Redis for two uses only: Socket.IO
  fan-out (ADR 0002) and the BullMQ queue (ADR 0063). Caching is unpromoted. A
  shared rate-limit store would be a third use.
- **Keycloak.** AGENTS.md §6 limits Keycloak to local/pilot OIDC login and,
  since ADR 0089, account administration. MFA (`F4.13`), SSO/AD federation,
  self-service sign-up and identity governance (access reviews, approval
  workflows, SCIM) stay deferred.
- **Production rulebook.** `docs/AGENTS.production.md` §9 asks for "rate
  limiting at Traefik per IP and at API per user / IP". Traefik is not in the
  stack: `F4.24` narrowed it out under ADR 0063.

## Decision (proposed)

### Part A — rate limiting

1. **Two stages per request, one shared store.**
   - **Stage 1 (pre-auth, per client IP)** covers every `/api/v1/*` route,
     including `POST /auth/login` and `/public/appearance`.
   - **Stage 2 (post-auth, per identity)** keys on the resolved `bms.users.id`,
     whether the caller is a human or a service account (Part B). Under
     service-account tokens the key is the **token id**, so one leaked token
     cannot drain its siblings.
   - `/health`, `/health/ready` and `/metrics` are outside the prefix and are
     never limited.
2. **Where each stage runs** (Q3):
   - **Stage 1** is Express middleware registered in `main.ts` before the Nest
     router. It runs before any guard, pipe or multer buffer.
   - **Stage 2** is a single call at the end of `JwtAuthGuard.canActivate`,
     after identity resolution *(recommended)*. One site therefore covers all
     67 guarded controllers, and it runs before the controller-scoped
     `FileInterceptor` buffers an upload. This also closes the ADR 0066
     Security L-2 note.
   - The Socket.IO gateways call the same Stage 1 check on the handshake.
3. **The store is Redis, through the existing `redis@^5` client** *(Q1
   recommended)*. Each check is one atomic Lua script (`INCR` + `PEXPIRE …
   NX`, fixed window) per stage. Keys look like
   `rl:v1:<stage>:<class>:<subject>:<window>`, and every key carries a TTL, so
   `noeviction` cannot fill Redis with dead counters. This is a **third Redis
   use, and it needs promotion** (Consequences). Caching stays unpromoted:
   these keys are counters with a TTL, not cached data.
4. **When Redis is down or `REDIS_URL` is unset, the limiter fails open to an
   in-process fixed-window store** *(Q5 recommended)*. Limits then hold per
   process, not per fleet. Every fallback is counted
   (`bms_rate_limit_store_errors_total`) and reported on `/health` as
   `rateLimit: degraded`. A Redis outage therefore does not become an API
   outage.
5. **Route classes and starting limits** *(Q4 recommended; every number is
   provisional until the shadow-mode measurement in decision 7)*:

   | Class | Routes | Stage 2 limit (per identity) |
   |---|---|---|
   | `read` | every `GET` not listed below | 600 / min |
   | `write` | every `POST`/`PUT`/`PATCH`/`DELETE` not listed below | 120 / min |
   | `heavy` | `GET /admin/asset-templates/stock`, every multer upload/import route, report exports, `POST /rules/evaluate`, onboarding discover, copilot turn routes | 12 / min |

   Stage 1 (per IP, all classes together) is 1,200 / min. `POST /auth/login`
   has its own Stage 1 limit of 10 / min per IP. The Socket.IO handshake is
   30 / min per IP.

   A route opts into a class with a `@RateLimitClass('heavy')` decorator, and
   a static repo invariant lists the routes that must carry it. The limits
   are read from env (`RATE_LIMIT_READ_PER_MIN` and siblings), so an operator
   can tune them without a release.
6. **Existing domain limits stay and stack.** The copilot daily caps, the
   per-turn bounds, notification `ratePerHour` and the multer sizes are all
   unchanged. The `F3.47` evaluate throttle moves onto the shared store, which
   removes its per-replica multiplier *(Q9 recommended)*; its 30 s rule and
   bucket keys are unchanged.
7. **`RATE_LIMIT_MODE=off|shadow|enforce`**, with default `shadow` on first
   deploy *(Q4)*. In `shadow` the limiter counts and logs would-be refusals
   (`bms_rate_limit_decisions_total{stage,class,outcome}`) but never refuses.
   The owner reads a week of AWS numbers, then switches to `enforce`, in a
   one-line env change.
8. **Client IP behind the proxy comes from an explicit hop count** *(Q2
   recommended)*. The setting is `API_TRUST_PROXY_HOPS`, an integer with
   default `0`, passed to `app.set('trust proxy', n)`. With `0`, `req.ip` is
   the socket peer, which is correct for direct local access and safe
   against a forged `X-Forwarded-For`. The AWS chain (Caddy → nginx → api)
   sets `2`. A hop count reads from the right, so a client-supplied
   `X-Forwarded-For` prefix cannot pick its own bucket. That value must be
   measured once on the host, because Caddy's config is not in the repo.
9. **The refusal is 429** with:
   - a `Retry-After` header;
   - `RateLimit-Policy` and `RateLimit` headers (IETF
     `draft-ietf-httpapi-ratelimit-headers`);
   - the body `{statusCode: 429, error: "Too Many Requests", code:
     "rate_limited", message, retryAfterSeconds}`.

   **One helper builds it** (`rateLimitedException()` in
   `apps/api/src/rate-limit/`), so the `F4.21` envelope converts a single site.
   CORS exposes no new header: the SPA reads `retryAfterSeconds` from the
   body, as `F3.47` ruled.

### Part B — service-account tokens

10. **A service account is a `bms.users` row with `kind = 'service'`** *(Q7
    recommended)*. This reuses the existing machinery:
    - `audit_log.actor_id`, the grant tables
      (`user_location_access`, `user_asset_group_access`) and `resolveDbUser`;
    - the RLS session (`app.current_user` and `app.current_organization` set
      exactly as for a human);
    - `disabled_at`.

    Migration rules for the row:
    - It may never hold a password or an OIDC subject, and never log in
      through `/auth/login` or Keycloak.
    - Its `organization_id` is `NOT NULL`.
    - Its role is **capped at `viewer` or `operator`** *(Q8 recommended)*. It
      never holds `admin` or any master-data role, so a token can never reach
      the `bms_fleet` pool or a configuration write.
    - `email` is `NOT NULL UNIQUE` today, so a service account carries a
      synthetic `svc-<uuid>@service-account.invalid` (RFC 2606 `.invalid`).
      The ADR 0089 user screens filter `kind = 'human'`.
11. **Tokens are app-issued, opaque and stored hashed** *(Q6 recommended over
    Keycloak client credentials)*:
    - **Format.** `bms_sat_<12-char id>_<43-char base64url secret>` (32 random
      bytes).
    - **Storage.** `SHA-256(secret)` is stored. A slow hash is not needed for
      256-bit random secrets, and it would put bcrypt on every request.
    - **Lookup and display.** The id is the lookup key and the only part shown
      after creation. The full token is returned once, by the create response.
    - **Recognition.** `JwtAuthGuard` recognises the `bms_sat_` prefix before
      any JWT parse. It verifies with a constant-time compare and resolves the
      owning service-account row on the `bms_auth` pool, then continues down
      the ordinary path. This works the same under OIDC and local
      `AUTH_MODE`.
12. **Scope = the service account's role plus its grants**, and nothing on the
    token itself *(Q8)*. One optional narrowing is allowed: `read_only` on the
    token, which turns any non-`GET` into 403 before the controller runs. The
    ADR 0017 `WRITE_MATRIX` and every existing helper (`assertMasterDataRole`,
    `readableAssetIds`, …) then apply unchanged.
13. **Lifecycle** *(Q10 recommended)*:
    - **Expiry.** Mandatory. The default is 90 days and the maximum 365.
    - **Count.** At most 2 live tokens per account, which allows overlap
      rotation: issue a new token, switch the client over, revoke the old one.
    - **Revocation.** Revocation sets `revoked_at` and sends
      `NOTIFY bms_service_token_revoked`. Each API process uses that to drop
      its verify cache (≤ 30 s TTL) and disconnect that token's sockets, the
      same pattern as `bms_user_disabled` (ADR 0089).
    - **Disabling the account.** This revokes all of its tokens.
    - **Usage tracking.** `last_used_at` is written at most once per minute per
      token per process.
14. **Management routes** (`admin` for any organization, `organization_admin`
    for its own; `location_admin` and below are refused). The routes are:
    - `GET/POST /api/v1/admin/service-accounts`
    - `PATCH /api/v1/admin/service-accounts/:id` (name, role within the cap,
      disable/enable)
    - `PUT /api/v1/admin/service-accounts/:id/grants`
    - `GET/POST /api/v1/admin/service-accounts/:id/tokens`
    - `POST /api/v1/admin/service-accounts/:id/tokens/:tokenId/revoke`

    The SPA gets an `/admin/service-accounts` screen in the same row, because
    a store no screen reaches is the `F3.1d` reachability defect. Request and
    response types are Zod contracts in `packages/shared/src/contracts/`
    (ADR 0030).
15. **Audit.** These actions write `bms.audit_log` with the organization set,
    using actions `service_account.created`, `.updated`, `.disabled`,
    `service_token.issued` and `service_token.revoked`. The payload carries the
    token id, name, expiry and `read_only`, never the secret or its hash
    (AGENTS.md §9.6). Writes made *by* a token already audit with `actor_id` =
    the service account row, with no new column. Per-request access logging
    is not added *(Q11)*.
16. **Socket.IO accepts a service token on the handshake** *(Q12
    recommended)*, so an integration can subscribe to live telemetry under the
    same `readableAssetIds` scope.

### Schema, roles and dependencies

17. **One migration**, the next free number at build time (`0140` on `main`
    today, journal idx 141; the parallel drafts may take it first):
    - `bms.users.kind varchar(16) NOT NULL DEFAULT 'human'`, with
      `users_kind_check` (`human`/`service`). A second CHECK says `service` ⇒
      `password_hash IS NULL AND oidc_subject IS NULL AND organization_id IS
      NOT NULL AND role IN ('viewer','operator')`.
    - New table `bms.service_account_tokens`:
      - `id uuid pk`
      - `organization_id uuid NOT NULL → organizations`
      - `service_account_id uuid NOT NULL → users`
      - `token_id char(12) UNIQUE`
      - `token_hash bytea NOT NULL`
      - `name varchar(64)`
      - `read_only boolean NOT NULL DEFAULT false`
      - `expires_at timestamptz NOT NULL`
      - `revoked_at`, `revoked_by → users`, `created_by → users`
      - `created_at`, `last_used_at`

      It has a `tenant_isolation` policy and `FORCE ROW LEVEL SECURITY` from
      the first migration (ADR 0043/0045 pattern).
    - Grants:
      - `bms_tenant`: `SELECT, INSERT`, plus `UPDATE (revoked_at,
        revoked_by)`.
      - `bms_fleet`: the same.
      - `bms_auth`: `SELECT (id, organization_id, service_account_id,
        token_id, token_hash, read_only, expires_at, revoked_at)` and
        `UPDATE (last_used_at)`, with a role-scoped policy `TO bms_auth`.
        Like its read of `bms.users`, `bms_auth` needs the pre-tenant lookup.
      - No `DELETE` for any pool role: a token row is kept for audit.
    - Ownership is `bms_owner` (ADR 0045). The `roles` script is unchanged: no
      new database role.
18. **Dependencies:** **none under the recommended options.** The limiter is
    in-repo over `redis@^5`, which is already a direct `apps/api` dependency.
    Hashing uses `node:crypto`. If the owner instead picks `@nestjs/throttler`
    (Q1 option B) or a Redis storage adapter (option C), each package is named
    there, and this ADR is its §9.4 record.
19. **Env vars (new):**
    - `RATE_LIMIT_MODE`
    - `RATE_LIMIT_READ_PER_MIN`, `RATE_LIMIT_WRITE_PER_MIN`,
      `RATE_LIMIT_HEAVY_PER_MIN`
    - `RATE_LIMIT_IP_PER_MIN`, `RATE_LIMIT_LOGIN_PER_MIN`,
      `RATE_LIMIT_WS_HANDSHAKE_PER_MIN`
    - `API_TRUST_PROXY_HOPS`

    All are set in both compose files, and in `api-replica` identically to
    `api`.

## Open questions for the owner (rule each before the plan is built)

1. **Q1 — Limiter implementation and store.**
   - (A) In-repo limiter: one Lua fixed-window script over the existing
     `redis@^5` client, with an in-process fallback. No new dependency.
   - (B) `@nestjs/throttler` (MIT, Nest 10-compatible major) plus an in-repo
     `ThrottlerStorage` over `redis@^5`. One new dependency.
   - (C) `@nestjs/throttler` plus `@nest-lab/throttler-storage-redis` plus a
     direct `ioredis`. Three new dependencies.
   - **Recommend A.** The two-stage design (pre-auth middleware, post-auth
     check inside `JwtAuthGuard`, and the Socket.IO handshake) does not fit
     `ThrottlerGuard`'s one-guard model, and B would need a custom store
     anyway. The algorithm is a sub-choice: fixed window (recommended; it
     allows a burst of at most 2× at a window edge) or a sliding-window
     counter (smoother, two keys per check).
2. **Q2 — Client IP behind the reverse proxy.**
   - (A) `API_TRUST_PROXY_HOPS` hop count, default 0, AWS 2, measured on the
     host.
   - (B) A trusted-CIDR list.
   - (C) Read nginx's `X-Real-IP`.
   - **Recommend A.** C is spoofable on any path that bypasses nginx, and B
     breaks whenever the Docker bridge subnet changes. The owner's step is to
     confirm Caddy's `X-Forwarded-For` behaviour on the host, because its
     config is outside the repo.
3. **Q3 — Where Stage 2 runs.**
   - (A) Inside `JwtAuthGuard` after identity resolution.
   - (B) A global interceptor reading `req.user`.
   - (C) A decorator plus guard on each of the 67 controllers.
   - **Recommend A.** It needs one edit and runs before the multer buffer. B
     also works but couples to interceptor ordering. C is 67 edits that a new
     controller can forget.
4. **Q4 — Classes, numbers and rollout.**
   - Approve the three classes and the starting numbers in decision 5.
   - Approve `shadow` on the first AWS deploy, with `enforce` after the owner
     reviews about a week of counts.
   - **Recommend yes to both.** The SPA's real polling rate (dashboards with
     many widgets, Control Room screens) is not measured yet, and a wrong
     `read` number would 429 the demo.
5. **Q5 — Redis unavailable.**
   - (A) Fail open to per-process memory, counted and reported on `/health`.
   - (B) Fail closed with 503.
   - (C) Fail open with no limit.
   - **Recommend A.**
   - **Also rule** whether the store waits for `F3.12`'s `--requirepass`.
     Recommend it does not: a counter is not a secret. The cost is that
     anything on the compose network can reset a bucket, the same exposure
     BullMQ has today.
6. **Q6 — Token technology.**
   - (A) App-issued opaque tokens, stored as SHA-256 hashes in Postgres.
   - (B) Keycloak client-credentials: one confidential client per service
     account, with the guard's `azp` check widened to an allow-list.
   - (C) Long-lived app-signed JWTs.
   - **Recommend A.** It works under both `AUTH_MODE`s, revocation is
     immediate, and it does not widen Keycloak's approved use. B needs
     `bms-api-admin` to gain `manage-clients`, a realm-wide power far beyond
     `manage-users`, and so a §6 promotion of Keycloak scope. C cannot be
     revoked without a deny-list.
7. **Q7 — Where a service account lives.**
   - (A) A `bms.users` row with `kind = 'service'`.
   - (B) A separate `bms.service_accounts` table, plus a new
     `audit_log.actor_service_account_id` column and parallel grant tables.
   - **Recommend A.** It reuses grants, audit, RLS and `disabled_at`
     unchanged. Its costs are a synthetic `.invalid` email and a
     `kind = 'human'` filter on the ADR 0089 user screens and on the
     report-schedule owner picker.
8. **Q8 — Scope ceiling.**
   - (A) `viewer` or `operator` role, the existing grants, and an optional
     per-token `read_only`.
   - (B) Any role up to `organization_admin`.
   - (C) A new per-route scope vocabulary (`telemetry:read`, `alarms:ack`, …).
   - **Recommend A.** B lets a leaked token administer users. C is a second
     authorization model beside ADR 0017 and §4.7.
   - **Also rule** whether `location_admin` and `organization_admin` may hold
     a service account later (recommend: not in this row).
9. **Q9 — Move `F3.47`'s evaluate throttle onto the shared store.** Recommend
   yes, in the same PR as the store. Its own ADR 0033 discharge note then
   gains a line, and the `api-replica` compose comment about two sweeps per
   30 s becomes false and is rewritten.
10. **Q10 — Lifecycle numbers.** The proposal is 90-day default expiry, 365
    maximum, 2 live tokens per account, a verify cache of at most 30 s, and
    `last_used_at` at most once per minute. **Recommend as drafted.** Also
    rule whether the expiry warning is in this row: recommend no; it is a
    notifications follow-up.
11. **Q11 — Audit depth.**
    - (A) Lifecycle events plus the actor on every write, as today.
    - (B) Also log every authenticated request a token makes.
    - **Recommend A.** B is an access log, which `bms.audit_log` is not, and
      its volume would dwarf the table.
12. **Q12 — Socket.IO.**
    - (A) Accept service tokens on the handshake.
    - (B) HTTP only.
    - **Recommend A.** Live subscription is the main reason an integration
      wants a token.
13. **Q13 — The §6 boundary.**
    - Confirm that app-issued service-account tokens with expiry and
      revocation fall outside the §6 "identity governance" deferral. That
      deferral covers access reviews, approval workflows and SCIM.
    - Confirm that the limiter's Redis use is promoted by this ADR.
    - **Recommend confirming both.** The catch-up `chore(agents):` sweep then
      records each in AGENTS.md §2 and §9.7. If the owner reads service
      accounts as identity governance, Part B is deferred and the row ships
      Part A alone.

## Interfaces with neighbouring rows (not planned here)

- **`F4.21` (RFC 7807, correlation id, idempotency keys).** This row emits 429
  through one helper with a stable `code: "rate_limited"` and
  `retryAfterSeconds`. It also emits 401 and 403 for token failures with the
  `code` values `token_invalid`, `token_expired`, `token_revoked` and
  `token_read_only`. `F4.21` maps each to a problem `type` and changes no call
  site. Idempotency keys would be per identity, and a service-account
  identity is a `users.id` like any other.
- **`F4.25` (SLOs, API p95 < 250 ms).** Each guarded request gains two Redis
  round-trips (Stage 1 and Stage 2) plus, on a token request, one cached
  `bms_auth` lookup. The plan measures the added p95 locally and records it.
  The new counters live in the existing `prom-client` registry for `F4.25`
  to use.
- **`F4.128` (duplicate loops across replicas).** This row adds no sweep. The
  `LISTEN bms_service_token_revoked` client is a per-process fan-in, like
  `bms_user_disabled`, and must run in every replica. The shared store is the
  reason the limit holds across replicas at all.
- **`E7.2` (edge gateway, ADR 0123).** A store-and-forward gateway that pushes
  to the API would be a natural first consumer of a service token. If ADR
  0123 needs a write-capable gateway identity beyond `operator`, that is an
  amendment to this ADR's Q8 ceiling.

## Dependencies

None under the recommended options (Q1 A, Q6 A). Under Q1 B the only new
dependency is `@nestjs/throttler` (`apps/api`). Under Q1 C the new
dependencies are `@nestjs/throttler`, `@nest-lab/throttler-storage-redis` and
`ioredis` (`apps/api`).

## Consequences

- **Promotion owed (§10.1), recorded in `docs/BACKLOG.md` §5 at closure.** A
  catch-up `chore(agents):` sweep must record two things. First, Redis's third
  approved use (rate-limit counters with a TTL; still no caching) in §2 and
  §9.7. Second, the service-account identity kind and its role ceiling in
  §4.7. This ADR does not edit AGENTS.md (§9.10).
- **Two Redis round-trips per request.** Redis latency now sits on the request
  path, and decision 4 decides what an outage costs.
- **Shared NAT.** Per-IP limits treat a whole site behind one NAT as one
  client. That is why Stage 1 is generous and the identity limit is the real
  bound.
- **Tokens are bearer secrets.** A leaked token is usable until revoked or
  expired. The mitigations are the role ceiling, `read_only`, expiry,
  per-token buckets and immediate revocation. IP pinning of a token is not in
  this row.
- **The ADR 0089 screens change.** Every query that lists users "for a human"
  (user admin, report-schedule owners, work-order assignees, the copilot's
  user tools) must filter `kind = 'human'`. The plan lists each site, and the
  security review checks for misses.
- **`docker-compose.yml`'s `api-replica` comment** changes under Q9 and loses
  its two-sweeps sentence.
- **Deferred:** per-organization limit overrides, a limit-admin screen, token
  IP allow-lists, an expiry-warning notification, Keycloak client-credentials
  service accounts (Q6 B), and the Traefik edge limiter
  `AGENTS.production.md` names.
