# ADR 0066 — Object storage on the S3 API, MinIO in the stack, and `bms.asset_images`

## Status

Accepted — drafted and ruled 2026-09-15 under `F3.3`. The five gate
questions (§"Gate questions") were put to the owner one at a time, in order,
and each was ruled **as drafted**, before any implementation code (AGENTS.md
§10, `backlog-cycle` step 2). One clarification was asked at Q1 and is
recorded there.

## Context

`F3.3` (Track C, Wave 0, P1, ⭐, `Depends: —`, *"Object storage (MinIO/S3) +
`asset_images` metadata"*) is the last Wave 0 enabler on the board. Two rows
wait on it: `F3.4` (Wave 1, P1, *"Image upload API + asset linkage"*, effort
`incl.` — its estimate is inside `F3.3`'s 8–12) and `E3.2` (Wave 3, P1,
*"Mobile work execution + photographic evidence"*, which also needs `E3.1` and
`F3.20`). ADR 0063 carved MinIO out of the `F4.24` infra bundle on 2026-09-11
and named this ADR as its promotion: *"MinIO is `F3.3`'s ADR (it **is** object
storage)"*.

Eight things are true of the repository today, each read from source on
2026-09-15 rather than assumed.

**1. There is no object storage and no `asset_images` table.** No package
under `apps/*` or `packages/*` depends on `minio`, `@aws-sdk/*` or any S3
client. No column in `packages/db/src/schema/*.ts` names an image, a file or an
attachment. `docs/security/encryption-at-rest.md` §7 says the same in its
title: *"Object storage — does not exist yet (F3.3)"*. The drizzle journal ends
at `0071_rtu_code_unique`, so this ADR's migration is `0072`.

**2. Three documents gate it, and one of them gates on the wrong trigger.**
AGENTS.md §6 lists *"MinIO / object storage"*; §9 rule 7 forbids introducing
MinIO without a §10 promotion; and §4 rule 13 says *"Defer MinIO/object storage
until persisted report files are actually needed"*. `docs/roadmap.md` repeats
the report-file trigger twice (lines 316 and 422) and its §6 table says
*"Phase 5 Sprint F only if persisted report storage is needed"*. But **PDF
energy reports are themselves §6** (*"Energy reports (PDF)"*; XLSX streams from
`GET /api/v1/reports/energy/export.xlsx` and persists nothing). The trigger
rule 13 waits for is out of scope; the rows that actually need object storage
are `F3.4` and `E3.2`, and neither is a report. This ADR replaces rule 13's
trigger rather than satisfying it.

**3. The mockups show no asset image.** `TRINETRA.html` carries three `<img>`
elements and `ESKOM_SMOC.html` three: two logos and the station map, all
data-URI. No asset card, detail pane or work-order card in either mock shows a
photograph. §5 visual alignment therefore constrains nothing here: `F3.3` is a
foundation, and the first surface that renders an image is `F3.4`'s.

**4. The upload precedent is set, and a test enforces it.** Since `F4.102`
every `FileInterceptor` in the API carries `limits: { fileSize, files, fields }`
(`onboarding.controller.ts:106` reads
`{ fileSize: MAX_IMPORT_FILE_BYTES, files: 1, fields: 1 }`), and
`tests/f4.102-file-interceptor-limits.test.ts` scans every controller and fails
one that carries no `fileSize`. `MAX_IMPORT_FILE_BYTES` is 5 MiB and lives in
`telemetry-import.schema.ts`, not `@bms/shared`. An image upload gets its own
constant, and the scan gates it for free.

**5. The configuration precedent is `REDIS_URL`.** `apps/api/src/queue/queue-config.ts`
(ADR 0063 decisions 4 and 9) reads an unset or whitespace-only `REDIS_URL` as
**unconfigured, not an error**, so a native-dev machine without Redis boots the
API with the queue reporting `unconfigured`. Its URL parser never puts the raw
value in a thrown message because the value can carry a password (§9.6). Object
storage carries a secret key and has the same two needs.

**6. The tenant-table precedent is migration `0050`.** A new tenant table is
`organization_id NOT NULL`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, a
`tenant_isolation` policy that **checks its org-bearing parents and not only
its own column** (a foreign key is validated with row security off, so a
correctly-stamped row can otherwise bind another tenant's parent — proved on
the stack during `F3.1a`), and **no explicit `GRANT`**: ADR 0045's default
privileges do it, and `0050`'s header says a hand-written one must not be
added. `bms.assets` (`bms-schema.ts:219`) is `organization_id NOT NULL`
(migration `0047`), so the parent check has a column to read.

**7. The compose and CI precedent is Redis.** `docker-compose.yml`'s `redis`
service is in profiles `core`, `pilot`, `phe` and `realtime-smoke`, pins
`redis:7-alpine`, binds its port to **loopback only** (ADR 0063 Amendment 2,
because the service carries no password), owns a named volume and a
healthcheck. `.github/workflows` runs one integration job with `services:`
entries for TimescaleDB and Redis, and ADR 0063's Q3 ruled that the spec of a
thing four rows build on must **gate in CI**, not skip where `REDIS_URL` is
absent.

**8. `docs/security/encryption-at-rest.md` §7 pre-wrote five requirements for
this row**, and two of them cannot be met on the compose stack: *(1)
server-side encryption by default on every bucket — SSE-S3 at minimum, MinIO
KES for self-hosted* needs a KES server and a KMS; *(2) TLS for all client
traffic; no plaintext `http://` endpoints* needs certificates the stack does
not issue (Postgres, Redis and the API all speak plaintext on the compose
network today). The other three — private buckets, credentials from the
environment and never an image layer, and the host-volume requirement — are
implementable here. E8.1's own boundary is that volume and KMS encryption are
**deployer actions, not code**; §7's items 1 and 2 are the same kind of
requirement and this ADR says so rather than leaving §7 to read as five
code obligations.

## Decision

1. **Promote object storage over the S3 API, and nothing else from §6.** The
   API talks S3; MinIO is the compose backend and any S3-compatible service
   (AWS S3, a hosted MinIO) is a deployment choice made with environment
   variables, never a code change. EMQX, Traefik and PDF reports stay in §6.
   AGENTS.md §4 rule 13 is **replaced**: the trigger is *"a row that stores a
   file"*, and `F3.4` is that row. The `chore(agents):` sweep carries the §4,
   §6 and roadmap edits (§9.10); this PR does not touch AGENTS.md.

2. **Client library: `@aws-sdk/client-s3` (v3) in `apps/api`**, §9.4-gated
   and justified here (Q1). Not the `minio` package: it binds the code to one
   vendor's client for a protocol every backend already speaks, and the AWS
   SDK is what a hosted deployment reaches for anyway. `@aws-sdk/lib-storage`
   is **not** added — a bounded single-part `PutObject` is enough for a
   capped image, and multipart upload is a later row's justification if it is
   ever needed.

3. **Configuration, in `apps/api/src/storage/storage-config.ts`, mirrors
   `queue-config.ts`.** Six variables: `OBJECT_STORAGE_ENDPOINT` (URL),
   `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`,
   `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_REGION` (default `us-east-1`,
   which MinIO accepts), `OBJECT_STORAGE_FORCE_PATH_STYLE` (default `true`;
   MinIO needs path-style, AWS S3 does not). An unset or whitespace-only
   `OBJECT_STORAGE_ENDPOINT` reads as **unconfigured**: the API boots, the
   health endpoint reports `storage: unconfigured`, and every route that
   needs storage returns `503` with a body that names the reason. A set
   endpoint with any of bucket, access key or secret key missing is a
   **configuration error at boot**, so a half-configured deployment never runs
   as "unconfigured". No thrown message ever contains the secret key or the
   endpoint URL (§9.6).

4. **One bucket, server-generated keys, and the row is the authority.** Every
   object lives in the one configured bucket under
   `org/<organization_id>/assets/<asset_id>/<image_id>`. The key is built from
   the row the API is about to insert and is **never accepted from a
   client** — not as a field, not as a path segment. A key without a
   `bms.asset_images` row is an orphan and is never served; a row whose
   object is missing serves `404` and is logged at `warn` with the image id
   (not the key).

5. **`bms.asset_images`, migration `0072`, drizzle in
   `packages/db/src/schema/asset-images-schema.ts`** (its own file, the
   `dashboard-schema.ts` precedent, because `bms-schema.ts` is near the §4.5
   line limit). Columns: `id uuid PK`, `organization_id uuid NOT NULL FK
   organizations`, `asset_id uuid NOT NULL FK assets ON DELETE CASCADE`,
   `object_key text NOT NULL UNIQUE`, `content_type text NOT NULL`,
   `byte_size integer NOT NULL CHECK (byte_size > 0)`, `sha256 char(64) NOT
   NULL`, `original_filename text NOT NULL`, `caption text NULL`,
   `created_by uuid NULL FK users`, `created_at timestamptz NOT NULL DEFAULT
   now()`. Index on `(asset_id, created_at DESC)`. `ENABLE` + `FORCE ROW LEVEL
   SECURITY`; policy `tenant_isolation` checks its own `organization_id`
   **and** that `asset_id` resolves to an asset in the same organization
   (Context 6). No explicit `GRANT`. Forward-only and idempotent per §4.4.

6. **The read path is API-proxied, never presigned (Q2).**
   `GET /api/v1/assets/:assetId/images` lists a tenant's rows for one asset,
   and `GET /api/v1/assets/:assetId/images/:imageId/content` streams the bytes
   with the stored `content_type`, an `ETag` of the stored `sha256`,
   `Cache-Control: private, max-age=0, must-revalidate` and
   `Content-Disposition: inline`. Both run under the existing JWT guard and
   the request's RLS context, in `apps/api/src/assets/` beside the
   `@Controller("assets")` that already exists. A browser therefore never
   talks to MinIO, MinIO's port binds to loopback like Redis (decision 9),
   and no CORS, no public bucket policy and no URL that outlives a session
   exist. Presigned URLs are a later row's decision, taken when a payload
   size makes proxying measurably costly, with a number.

7. **The `F3.3` / `F3.4` boundary (Q3).** `F3.3` ships decisions 2–6, 8–10,
   the `StorageModule` (`putObject`, `getObject` as a stream, `deleteObject`,
   `headObject`, `ensureBucket`), the two read routes, the health probe and
   the integration spec. **`F3.4` ships the write path**: `POST
   /api/v1/assets/:assetId/images` (multipart, `FileInterceptor` with
   `fileSize: MAX_ASSET_IMAGE_BYTES`, `files: 1`, `fields: 2`, held by the
   `F4.102` scan), `DELETE .../images/:imageId`, the `MasterDataAuditService`
   rows for both, and the first UI surface. The constants both rows share
   live in `packages/shared/src/contracts/asset-images.ts` from `F3.3`:
   `MAX_ASSET_IMAGE_BYTES = 10 * 1024 * 1024` and
   `ASSET_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"]`
   as a closed `z.enum` — a security allowlist, the §4.8 case for a closed
   vocabulary, not a domain vocabulary that wants a lookup table. `F3.3`'s
   integration spec exercises `putObject` → row → `GET …/content` end to end
   through the service, so the read path is proved before `F3.4` gives it a
   producer.

8. **Encryption at rest and TLS are deployer requirements, and the doc says
   so (Q4).** `docs/security/encryption-at-rest.md` §7 is amended in this PR:
   items 1 (SSE by default) and 2 (TLS to the object store) move to the
   deployer table beside volume encryption, with the sentence that the
   compose stack ships plaintext MinIO on a loopback port and that a hosted
   deployment sets `OBJECT_STORAGE_ENDPOINT` to an `https://` endpoint with
   SSE enabled on the bucket. Items 3, 4 and 5 are met by decisions 4, 3 and
   the compose volume respectively. The API **refuses** an `http://` endpoint
   unless `OBJECT_STORAGE_ALLOW_INSECURE=true` is also set, and compose sets
   it, so a production deployment that forgets TLS fails at boot instead of
   silently shipping plaintext.

9. **Compose: one `minio` service in profiles `core`, `pilot` and `phe`**,
   image pinned to a `minio/minio:RELEASE.*` tag resolved at build time (the
   way ADR 0063 resolved `bullmq 5.81.5`), ports `127.0.0.1:9000:9000` (S3)
   and `127.0.0.1:9001:9001` (console, for a human), named volume
   `bms-minio-data`, a healthcheck on `/minio/health/live`, root credentials
   from `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` in `.env.example` with
   dev-only defaults, and `api` (and `api-replica`) depending on it
   `service_healthy`. The API creates the bucket at module init when it is
   missing (`ensureBucket`, idempotent) — no init container, no `mc` script.
   `worker` does not get the storage config: no job reads an object yet.

10. **CI: one pinned `minio` entry in the integration job's `services:`, and
    the storage spec gates** (ADR 0063 Q3's ruling applied unchanged). The
    spec is skipped, and says so, only where `OBJECT_STORAGE_ENDPOINT` is
    absent — a native-dev machine — never in CI.

11. **Deletion order and the orphan sweep.** A delete removes the row in a
    transaction, commits, then deletes the object; an object-delete failure
    after commit is logged at `warn` with the image id and leaves an orphan
    object that costs storage and serves nothing (decision 4). A periodic
    orphan sweep is **not** in this ADR; it is filed as a row the day the
    worker has a second job kind, since it belongs on the queue.

## Dependencies

- `@aws-sdk/client-s3` (3.x) in `apps/api` — §9.4-gated, and this ADR is its
  justification. Version resolved at build time and recorded here by
  amendment, ADR 0063's pattern. No other package: not `minio`, not
  `@aws-sdk/lib-storage`, not `sharp` (no thumbnailing — a later row, with a
  size number that justifies it). Resolved 2026-09-15 to
  `@aws-sdk/client-s3 3.1132.0`. **MinIO image pinned to
  `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z`** (Amendment 1, registry).
  `docker pull minio/minio:latest` fails, and the unauthenticated Docker Hub
  API confirms it is not a rate limit — `GET
  https://hub.docker.com/v2/repositories/minio/minio/` returns `404`; the
  repository does not exist on Docker Hub under that name. Both facts were
  measured twice on 2026-09-15 (the Unit 1 builder, then the orchestrator).
  The tag on `quay.io` is proved with `docker manifest inspect` (exit 0) and
  the image ships both `curl` and `mc` for the healthcheck.
- Migration `0072` and one new drizzle schema file (decision 5). The
  migration adds one table and one policy; it touches no existing table.
- Compose: one new service, one volume, two changed services (decision 9).
  CI: one `services:` entry (decision 10). `.env.example`: six
  `OBJECT_STORAGE_*` variables plus the two MinIO root variables.

## Consequences

- **What this unblocks.** `F3.4` becomes eligible the day the row flips.
  `E3.2` still waits on `E3.1` and `F3.20`.
- **What stays deferred, and where.** Presigned URLs (decision 6), multipart
  and `lib-storage` (decision 2), thumbnails (Dependencies), the orphan sweep
  (decision 11), SSE-KMS and TLS on the compose stack (decision 8): each is
  named here so a reader can find the sentence that deferred it. PDF reports
  stay §6 and are not this ADR's trigger (Context 2).
- **Rule 13's premise is retired.** AGENTS.md §4 and `docs/roadmap.md` say
  object storage waits for report files; after the sweep they say it waits
  for a row that stores a file, and name `F3.4`.
- **The stack grows by one always-on service** in `core`. A developer who
  runs the API natively without MinIO gets `storage: unconfigured` and two
  routes that answer `503`, not a boot failure (decision 3).
- **A `503` on the read routes is not a defect** while `F3.3` is merged and
  `F3.4` is not: nothing writes a row, so the routes return an empty list and
  `404`. The `503` only appears when storage is unconfigured.
- **The §7 amendment narrows a security document.** It moves two of five
  requirements from "code must" to "deployer must". E8.1's open owner
  decision (BACKLOG §5, *Encryption-at-rest boundary*) is the same boundary;
  this ADR's Q4 is one instance of it and does not settle the general case.

## Gate questions, and the rulings (2026-09-15)

All five were ruled **as drafted**, one at a time, in the order below. The
alternatives are kept so a later reader can see what was declined and why.
At Q1 the owner asked whether having no AWS credential affects the choice.
It does not: `@aws-sdk/client-s3` is a library that speaks the S3 protocol,
it authenticates against the compose MinIO with the MinIO root user and
password, and it never contacts AWS unless `OBJECT_STORAGE_ENDPOINT` names an
AWS endpoint. The ruling followed that answer.

| # | Decision | As drafted (recommended) | The alternative, and what it costs |
|---|---|---|---|
| Q0 | 1 | Start `F3.3` now and retire rule 13's report-file trigger. | Leave `F3.3` deferred and pick another eligible row. Nothing on `main` consumes object storage today and the mockups show no asset image (Context 3), so the enabler has no visible consumer until `F3.4`. The cost of waiting is that `F3.4` (P1) and `E3.2` (P1) stay blocked behind a row with no dependency of its own, and the board keeps a Wave 0 star open into Wave 3. |
| Q1 | 2 | `@aws-sdk/client-s3`, vendor-neutral, one package. | The `minio` npm client. Smaller install, one vendor's API surface; a hosted-S3 deployment then needs either a second client or MinIO's compatibility mode, and the code names a vendor a deployment may not run. |
| Q2 | 6 | API-proxied content route; MinIO on loopback; no presigned URLs. | Presigned GET/PUT URLs so the browser talks to MinIO directly. Cheaper API CPU per byte, and it needs MinIO reachable from the browser, a CORS policy, a public hostname in the compose stack, and a URL that outlives the request and carries no RLS. Deferred until a measured payload size makes proxying costly. |
| Q3 | 7 | `F3.3` = infra + table + storage service + read routes; `F3.4` = upload, delete, audit, UI. | Fold `F3.4` into `F3.3` (its effort is already `incl.`). One PR proves the whole path in a browser, and the row grows from an enabler into a feature with a UI surface that the mockups do not specify — the shape §5 asks a design ruling for. |
| Q4 | 8 | §7 items 1 and 2 become deployer requirements; the API refuses `http://` without an explicit insecure flag. | Meet §7 as written: MinIO KES plus a KMS and TLS certificates in compose. It is the E8.1 boundary reopened for one service, adds two containers and a certificate workflow to `core`, and no other service in the stack meets the same bar. |

## Amendment 1 — plan rulings (2026-09-15)

Seven questions were raised by the step-3 plan (`docs/plans/f3.3-object-storage.md` §1) and ruled before code: two by the owner, five by the orchestrator as routine calls under the ADR.
- Q-C (owner): the `minio` service also carries the `realtime-smoke` profile, so `api-replica` can depend on it `service_healthy`; decision 9's profile list becomes `core`, `pilot`, `phe`, `realtime-smoke`.
- Q-D (owner): CI runs MinIO with a `docker run` step using the same image tag as compose plus a readiness loop, because a GitHub Actions `services:` entry accepts no `command:` and `minio/minio` needs `server /data`. The invariant test compares the two tag strings.
- Q-A: `storage` is optional on `livenessResponseSchema`; the worker's `/health` body has no `storage` key.
- Q-B: `configured && !reachable` reads `status: "degraded"` (HTTP 200), mirroring the queue rule; unconfigured reads `ok`.
- Q-E: `asset_images_content_type_check` backs the closed content-type vocabulary in SQL (§4.8).
- Q-F: a transport failure on the content route answers 503 "Object storage is unreachable", with a `warn` naming the image id.
- Q-G: `withRollback` is extracted to `apps/api/src/testing/with-rollback.ts` for new suites only; the eleven existing private copies stay.
- Registry (orchestrator, measured): decision 9's `minio/minio:RELEASE.*` reads `quay.io/minio/minio:RELEASE.*`. Docker Hub no longer hosts the repository (404 on the registry API); `quay.io` is MinIO's own registry and the image is the same build. The intent of decision 9 — one pinned official MinIO image, byte-identical in compose and CI — is unchanged. Unit 8's invariant regex matches the `quay.io/` prefix.
- Superseded by Q-D: decision 10's "one pinned `minio` entry in the integration job's `services:`" and the Dependencies section's "CI: one `services:` entry (decision 10)" both describe the option Q-D declined — `ci.yml` runs a `docker run -d` step plus a readiness loop instead, because GitHub Actions `services:` accepts no `command:`. The gate Q-D and decision 10 both protect — the storage spec runs in CI and never silently skips — is unchanged.

**Review findings applied 2026-09-15** (pre-merge review of the feature branch; each is gated by a test that reddened under mutation):
- A — `asset-images.controller.ts`: the content route streams through `pipeline(body, res, cb)` rather than `body.pipe(res)`, so a client that disconnects mid-download destroys the object stream instead of leaving its socket open; every header is set before the pipeline call (order pinned by the spec); `X-Content-Type-Options: nosniff` joins decision 6's headers; and the guard is now measured over stubs (denied → 403 and the service is never called), not only read by the source scan.
- B — `asset-images.service.ts`: an object whose reported `Content-Length` differs from the row's `byte_size` is the decision-4 missing-object case (404 and one warn naming the image id and both numbers; an unreported length is trusted); `content_type` is parsed through `assetImageContentTypeSchema` rather than cast; and the docblock no longer calls the `0072` policy "the backstop" for tenant isolation — on these routes the GUC is resolved from the path asset, so the policy scopes the read to that asset's organization and `canReadAsset` in the controller is the isolation gate, proved by the existing `access-control.integration.spec.ts` rows (`assertOrganizationScope`, `assertLocationScope`).
- C — `storage/`: the `CreateBucket` lost-race name is measured against real MinIO (`BucketAlreadyOwnedByYou` / 409, recorded in `aws-s3-ops.ts`'s table; `BUCKET_RACE_NAMES` is exported for the row), and `StorageBootstrap.onModuleInit` is bounded by `STORAGE_BOOTSTRAP_TIMEOUT_MS` (10 s) so a silent endpoint refuses the boot with a message naming the timeout, never the endpoint.
- D — `packages/shared/src/contracts/asset-images.ts`: `originalFilename` and `caption` are bounded (`MAX_ASSET_IMAGE_FILENAME_CHARS` = 255, `MAX_ASSET_IMAGE_CAPTION_CHARS` = 1000, exported for `F3.4`'s write path); the SQL columns stay `text` because `0072` is frozen.
- E — `docker-compose.yml`: `OBJECT_STORAGE_ENDPOINT` and `OBJECT_STORAGE_ALLOW_INSECURE` are `${…:-default}` on `api` and `api-replica`, so a pilot sets an `https://` endpoint in its `.env` without editing the file; the CI invariant now asserts the readiness step precedes `Run tests` rather than that the URL appears somewhere.
- F — docs: `encryption-at-rest.md` §7 item 3 is qualified to the hosted case (on compose the S3 port is on loopback with committed dev credentials, and "private by default" is MinIO's bucket default, not code); `local-setup.md` §14 no longer lists MinIO as not installed.
- Not solved here, filed as a backlog row by the closure commit: **M4** — the API authenticates to MinIO as the root user (`MINIO_ROOT_USER`), and a scoped service key with a bucket-only policy needs provisioning outside this repository.

## Amendment 2 — post-merge sweep (2026-09-15)

The post-merge review sweep (code review, security, compliance) of PR #451 found ten items; each is gated by a test that reddened under mutation unless marked prose.
1. (High) `asset-images.service.ts` `toDto` parsed only `content_type`; `sha256`, `originalFilename` and `caption` reached the DTO unparsed, and `0072` constrains none of them. A stored `sha256` with a CR threw `ERR_INVALID_CHAR` at `res.setHeader("ETag", …)` **before** `pipeline`, so the MinIO stream `content()` had opened was never consumed or destroyed. The whole assembled DTO is now parsed through `parseStoredContract(assetImageDtoSchema, …, "asset_images.to_dto.row")` — the union literal replaced `asset_images.to_dto.content_type` and stays at nine members — and the parse runs **before** the bucket is asked, so a row that cannot be served opens no stream. Defence in depth: the controller destroys `body` if anything between `content()` returning and `pipeline()` starting throws, then rethrows. Rows: three contract-breaking rows answer the 500, a CR `sha256` on `content` leaves no body open, a valid row is served with a live body, and a throwing `res.setHeader` fake destroys the body and propagates.
2. (Medium, false green) `tests/f3.3-object-storage-invariants.test.ts`'s SDK-absence row covered `storage-health.service.ts` and `health.controller.ts` but not `storage/storage-health.ts`, which the controller value-imports, so the worker loads it. Added with the positive control; `import "./aws-s3-ops"` in that file reddens it.
3. (Low) `tests/f4.108-service-parses-are-guarded.test.ts` said "all eight stored-data parses" and its count map omitted the asset-images service: nine, with `assetImages: 1`. A bare `.parse()` in the service reddens it.
4. (Nit) `storage.integration.spec.ts` `runRoundTrip` ran the object delete after an uncaught DB delete; `Promise.allSettled` over both, the DB failure still rethrown, so "every row that puts an object removes it on the way out" holds. No mutation reddens a row for this: no existing row makes the DB delete fail.
5. (Low) `asset_images` joins `bms-owner-rls.integration.spec.ts`'s `FORCED_TABLES`, so the live `relforcerowsecurity` check covers `0072`; `ALTER TABLE … NO FORCE ROW LEVEL SECURITY` reddens it. The count-0 check is vacuous for this table until `F3.4` writes a row, and the comment says so.
6. (Security M-1, compose fail-open) `docker-compose.yml` set `OBJECT_STORAGE_ALLOW_INSECURE: "${OBJECT_STORAGE_ALLOW_INSECURE:-true}"` on `api` and `api-replica` — defaulting the flag **open** when unset, which is what `encryption-at-rest.md` §9 tells a deployer to do. Both lines are now `"${OBJECT_STORAGE_ALLOW_INSECURE:-}"` (the ADR 0041 `${CREDENTIAL_ENCRYPTION_KEY:-}` precedent): dev sets `OBJECT_STORAGE_ALLOW_INSECURE=true` in the root `.env` (now uncommented in `.env.example`), and a stale `.env` fails loudly at boot with the decision-8 message. The invariants rows assert the empty-default form on both services (`:-true` reddens) and that `.env.example` carries the uncommented dev value. **Note on the plan's refusal proof:** it used a compose override that bypassed the `${…}` interpolation, so it proved the code guard (`readStorageConfig`) and not the deployer path; the invariants row now proves the path. `encryption-at-rest.md` §7 item 2 and the §9 checklist say the same, and §9 gains the two `MINIO_ROOT_*` variables (L-4).
7. (L-1) `asset-images.service.ts`'s docblock records that `canReadAsset`'s organization bound is a property of the grant data — no constraint forbids a cross-organization `user_location_access` row — and that a future grant-write endpoint must re-check the location's organization. (L-2) `F4.144`'s row notes that S3/MinIO answer `403 AccessDenied`, not 404, for `HeadBucket` under a scoped key, so `isMissing` rethrows and `StorageBootstrap` refuses the boot: the scoped policy must grant `HeadBucket`/`CreateBucket` or bucket creation moves to provisioning.
8. (Prose) `docs/scripts/backlog-status.mjs` `GATES` no longer lists `F3.3` (dated comment in the `F4.24` shape); `docs/status/README.md` §6's enumeration drops `MinIO`.
9. (Prose) "Wave 0 is closed" was false — `E8.1`, `E8.2`, `E8.4` and `F4.123` stay open in Wave 0; `docs/roadmap.md`'s done-section and `docs/BACKLOG.md` §1b slot 3 now say "the last Wave 0 star". Slot 3 uses the `~~**3**~~ **CLOSED**` form of slots 1 and 2. `F4.145` depends on `F3.4`, not `F3.3`. "37 invariants" is re-measured: 39 rows, 41 cases at merge; 42 rows, 44 cases after items 2 and 6. `F3.4`'s row names `canReadAsset` as the read path's tenant gate and `assetImageDtoSchema`'s bounds as the upload's validation.
10. (Prose) `docs/client-requirements-as-is-report.md` marks the store, the table and the read API delivered under this ADR; the upload API stays `F3.4`.


## Amendment 3 — `F3.4` plan rulings, review findings and the write path's measurements (2026-09-16)

`F3.4` shipped decision 7's write path on `feat/F3.4-asset-images-write-path` (plan: `docs/plans/f3.4-asset-image-upload.md`, planned on Fable, built in ten units on Sonnet, Opus and — before the owner's ruling of the same day that Fable is not the implementer's model — Fable for Units 3 and 4). This amendment records what the plan decided under the ADR, what the owner ruled, what the four step-5 reviews found, and what was measured on the stack.

**Owner rulings (step 2 and the plan's open questions), one at a time:**
- **Q-0 — the UI surface** (this ADR's Q3 asked for a §5 design ruling because no mockup shows an asset image): **two surfaces** — an "Images" action per row on `/admin/assets` opening a side panel with the gallery, an upload control and a per-image delete, gated by `canManageAsset`; and a **read-only gallery** for every `canReadAsset` reader. Declined: a section inside the Edit-asset modal, a new `/admin/assets/:id/images` route, the admin panel alone.
- **Q-1 — where the reader gallery lives:** the ruling first named the dashboard's asset-health section, which renders one donut per scope and carries no asset id (`HealthSummaryResponse` has `bandCounts`, no assets; `AssetHealthCard` has no production consumer). Ruled: an "Images" toggle per row of the **location dashboard's asset table** (`location-dashboard-page.tsx`), the only reader surface with asset rows and ids, already scoped by `readableAssetIds`; lazy — no image request until a row is opened. Declined: a per-asset list under the health donut (a second §5 ruling), a new asset-detail page (its own row).
- **Q-2 — panel shape:** the right-docked `<aside>` (the `onboarding-chat-page` precedent), not the page's centred modal. The panel uses `fixed` rather than that precedent's `absolute`, with the reason in its docblock.
- **Q-3 — `MAX_ASSET_IMAGES_PER_ASSET = 20`**, answered **409 Conflict** past it ("This asset already has 20 images; delete one before uploading another") — a state of the resource, not a malformed body. Declined: 10, 50.

**Routine rulings under this ADR (plan §2, R-1…R-9):** the content type is **sniffed** from the bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF????WEBP`) and must agree with the declared multer `mimetype`; the sniffed type is stored and the declared string is never echoed (R-1). **Put the object first, then the row** inside `withTenant` under the asset's own organization, with `SELECT … FOR UPDATE` on the asset serialising the authoritative count; any throw after the put deletes the object best-effort (R-2, R-6) — decision 4 makes the orphan object the tolerable failure and the object-less row the bad one. `sha256` and `byte_size` come from the buffer, never a header (R-4). Amendment 2 L-1 does **not** apply to this write: the GUC and the row's `organization_id` both come from `bms.assets.organization_id`, and no API path writes `user_location_access` today — every reference in `access-control.service.ts` is a read — so `F3.4` turns that grant from a read exposure into a write exposure and L-1's re-check must land together with any grant-write endpoint (R-5, sharpened by the security review). Nothing enters the OpenAPI registry: the upload is multipart (the sixth deliberate absence, named in `openapi-registry.ts`) and the delete has no body (R-8). The write routes live in a **second controller class** on the same prefix so `F3.3`'s controller scan stays byte-identical (R-9). Audit actions are `master.asset_image.create` / `.delete`, `entity_type = asset_image`, payload ids, a code and numbers only.

**Plan deviations, recorded not hidden:** the `remove` unit rows are a second spec pair (`asset-images-remove.service.spec.ts`) because the eleven rows plus their positive controls passed the 600-line spec budget; `assetImageCapReason` is a Unit 1 export the plan did not list; `useAssetImageObjectUrl` returns `{ url, status }` (two fields, not three); the KB formatter lives in the gallery component, gated by its spec rather than by the `src/lib/**` coverage denominator; the panel's in-flight delete state got its own held-open-promise row (`11250d42`) because every other delete row settles in one tick; the integration spec's foreign-image row uses a **third** fixture asset because both docblocks reserve `capAssetId` for the 409 row; Unit 9 replaced six hand-written `<th>` with `assetTableColumns.map(...)` so the gallery row's `colSpan` is derived; `openImagesFor` is not reset when the page's filters change (a stale id renders nothing).

**Review findings applied before merge** (each gated by a row that reddened under the named mutation):
1. **(High, correctness)** `image-signature.ts` compared the WebP signature with `buffer.toString("ascii", …)`, and Node's `ascii` decoder strips the high bit: `D2 C9 C6 C6 … D7 C5 C2 D0` read as `RIFF`…`WEBP` (measured). Bytes are compared numerically now; a twelve-byte high-bit look-alike is a row expecting `null`. Measured on the stack after the rebuild: that payload declared `image/webp` answers 400 "The file is not a JPEG, PNG or WebP image", and a genuine `RIFF????WEBP` header answers 201 (positive control).
2. **(Medium, false green)** the `F4.145` row matched only a **named** import of `OBJECT_KEY_PREFIX`; `import * as objectKey` + `objectKey.OBJECT_KEY_PREFIX` passed. A file is an importer when it imports from an `object-key` module **and** its comment-stripped body names the identifier. Both the named and the namespace form redden it now. `F4.145` closes with this row.
3. **(Medium, false green)** the docblock's "fail-closed" cap compare (`!(n < cap)`) was reachable by no test: the harness only supplied numbers. A scenario now returns a non-numeric count; the upload is a 409 and no storage call is made. `current >= cap` reddens both rows.
4. **(Security M-1)** the delete's `eq(assetImages.assetId, assetId)` conjunct is the only intra-organization scope control, and nothing gated it: a `location_admin` who manages asset A could otherwise delete asset B's image in another location of the same organization by naming A in the path. An integration row removes another asset's image through A's path → 404, and the row and the object survive. Dropping the conjunct reddens it.
5. **(Security L-1)** multer bounds the field **count** (`fields: 2`) but not the field **size** (default 1 MB); `fieldSize: 4096` joins the inline limits and the controller spec's exact-string rows. Measured on the stack: a 5000-character caption answers 400 "Field value too long" from multer, before the schema's 1000-character bound.
6. **(Security L-2, accepted and recorded)** the ≤10 MiB buffer is taken before `canManageAsset`, and `assertMasterDataRole` throws inside it, so a `viewer` or `operator` pays the buffer before the 403; `apps/api/src` registers no throttler. Accepted: `JwtAuthGuard` runs before the interceptor, so only an authenticated caller reaches the buffer, the shape matches the onboarding upload, and resolving the asset before the pipe is a second read path not worth its cost.
7. **(Low, correctness)** the panel's `onSettled` cleared `deletingId` unconditionally, so a second delete started before the first settled reverted to enabled mid-flight. It clears only its own id now; a two-deletes-held-open row gates it.
8. **(Quality)** `describeGalleryError`'s fallback was dead (`apiErrorMessage("")` never returns `""`) and a non-envelope 503 body rendered `adminFetch`'s `admin /assets/<uuid>/images 503`. Empty and non-envelope bodies read the generic sentence; an envelope reads its message. An unnecessary type assertion in the same file went.
9. **(Scan hygiene, Unit 4)** `tests/f4.102-file-interceptor-limits.test.ts` does not strip comments, so a docblock that spelled `FileInterceptor(` with its `limits` satisfied the gate before the real decorator existed. The prose was reworded and the controller spec holds that the call is spelled exactly once.

**Measured, not assumed:** `tests/f3.3-object-storage-invariants.test.ts` is **42 `it` + 2 `it.each` = 46 cases** after Unit 6 (Amendment 2 item 9's "42 rows, 44 cases" was right at merge). `asset-images-write.integration.spec.ts` is **980 lines** against §4.5's 1000 — the next row there forces the split into a `remove` spec that finding 4 already described. Nest's multer map on this stack: `LIMIT_FILE_SIZE` → 413 "File too large", `LIMIT_FIELD_COUNT` → 400 "Too many fields", `LIMIT_FIELD_VALUE` → 400 "Field value too long". With MinIO **stopped but configured**: `POST` answers 503 "Object storage is unreachable" after the SDK's connect timeout (~10.4 s measured), `GET …/images` answers **200** and still serves the rows (`requireStorageConfigured` checks `kind` only — decision 3's 503 is for *unconfigured*), `GET …/content` answers 503, and `DELETE` answers 204 with the row gone and the object left behind. The decision-11 warn on the stack read `asset image <id>: object delete failed after the row was removed (Error); an orphan object remains (ADR 0066 decision 11)` and carried no `org/`; the orphan was confirmed with `mc ls` and removed by hand with `mc rm`. Twenty uploads through the browser took 1.9 s; the 21st was the 409.

**Verification against the stack (§4.6), layers: database, API, browser, object store — N/A: none.** The full record is `docs/plans/f3.4-asset-image-upload.md` §8. In one sentence each: api and web recreated on the branch's images (the write service in `dist`, the served bundle hash moved twice); 21 HTTP and UI claims passed from the SPA tab as `admin@bms.local`, then as `wc-admin@bms.local` an out-of-scope asset answered 403 and an in-scope one 201/204 with `createdBy` resolved; both audit rows carried the asset's organization, a resolved actor and no filename or caption; with a row present `bms_tenant` counted 1 under the owning organization and 0 under another; the bucket listed `org/<org>/assets/<asset>/<image>` after the upload and nothing after the delete. Amendment 2 item 5's "count-0 check is vacuous until `F3.4` writes a row" is no longer vacuous.

## Amendment 4 — `F3.4` post-merge sweep (2026-09-16)

The post-merge review sweep of PR #456 found four items. Each is gated by a row that reddened under the named mutation; every row was run from the worktree root, never through a filtered runner.

1. **(C1, Medium — correctness)** `asset-images-write.controller.ts` parsed `file.originalname` straight from multer, and multer hands it over **latin1-decoded**. Verified in `node_modules` rather than assumed: busboy 1.6.0 builds every part header with `chunk.latin1Slice(...)` (`lib/types/multipart.js:63`, `:73`, `:112`) and chooses the `Content-Disposition` **parameter** decoder at `lib/types/multipart.js:236-238` — `getDecoder(cfg.defParamCharset)` when the caller passes one, otherwise `nullDecoder`, which returns the latin1 string untouched (`filename` is read at `:316-319`); multer 2.0.2 constructs busboy at `lib/make-middleware.js:38` as `Busboy({ headers: req.headers, limits: limits, preservePath: preservePath })` and passes **no** `defParamCharset`. So `café.png` was stored as `cafÃ©.png`, and a 90-character CJK name arrived as 270 code units and was refused by `assetImageFilenameSchema`'s `.max(255)`. Fixed with a pure `decodeMulterFilename` (`apps/api/src/assets/multer-filename.ts`): `Buffer.from(name, "latin1").toString("utf8")`, applied **only** when the UTF-8 round trip is lossless and no code unit is above `U+00FF`. Both guards are load-bearing and both have rows. The second is not decoration — `Buffer.from("Ā", "latin1")` truncates to `0x00`, which decodes to `" "` and re-encodes to the same byte, so the lossless test alone reports success and would turn a name that a future multer with `defParamCharset: "utf8"` handed over correctly into a NUL (measured). What no guard can separate: a genuine latin1 name whose bytes happen to be valid UTF-8 is decoded; the two readings are identical in the bytes, and the far more common one is chosen. The controller calls the decode **before** the parse, as two statements rather than a nested call, because the spec's order scan reads the source text. Rows: nine in `multer-filename.test.ts` (the decode, the two unchanged names, the guard-1 rows, the 270→90 CJK pair with its arriving-length positive control, and the schema accepting the decoded name), plus `upload decodes the multer filename before parsing it` (a source-scan order row inside `uploadBody`, so the docblock cannot satisfy it) and `upload decodes a latin1 "cafÃ©.png" to "café.png" before the service sees it`. **Mutation — remove the decode call: both controller rows redden**, while `upload passes file.buffer and file.originalname through` stays green as the positive control.
2. **(C2, Low — correctness)** the admin panel's `deletingId` held **one** id and `onMutate` overwrote it, so pressing Delete on A and then B put A's button back to "Delete", enabled, while A's request was still open — an invitation to press it again for a 404 on a row already leaving. Amendment 3's finding 7 fixed the `onSettled` half only; row A12b *recorded* the remaining state rather than refusing it. The state is now `deletingIds: readonly string[]` — `onMutate` appends, `onSettled` removes its own id — and `AssetImageGallery`'s prop is `deletingIds`, asked with `.includes(image.id)`. Rows: `disables both buttons while two deletes are in flight` (a positive state, so no flush machinery is needed: neither promise is released) and `re-enables only the released image's button when one of the two settles`, which locates each state inside its own grid cell so "one of each" cannot pass with the two states on the wrong images; releasing the second delete is that row's positive control. The gallery's A10 row passes the list form. **Mutations: `onMutate` replacing instead of appending reddens the first row; `onSettled` clearing every id reddens the second.**
3. **(C3, Low — correctness)** if the connection drops between the server's `COMMIT` and its acknowledgement, `withTenant` rejects **after** the row committed, and the catch's `discardObject` deleted the object under a live row — decision 4's bad state (a 404 that lies, a warn on every read) in exchange for avoiding the orphan object decision 4 calls tolerable. `discardObjectUnlessTheRowCommitted` now re-reads `bms.asset_images` by image id on `fleetDb` (BYPASSRLS; the tenant connection is the one that just failed) and keeps the object with one `warn` naming the image id when the row is there. A failure of the re-check itself is also "cannot prove the row absent", so it keeps the object too; either branch rethrows the original error, because the method never throws. The projection is `{ imageId: assetImages.id }` and not `{ id: … }` so the spec's fleet fake, which dispatches on the projection's key shape, cannot confuse it with `resolveActorId`'s read. Rows (`asset-images-write.service.spec.ts`, one claim each): the calls delta is `["putObject"]`, the original error still surfaces, exactly one warn, the warn names the **generated** id (`randomUUID()` decides it, never the fixture's), the warn carries no key, and two rows for the failed re-check. `assertInsertFailurePutsThenDeletesTheObject` is the positive control — the same `insertError` with the re-check finding nothing still deletes, and the two scenarios differ in exactly one field. Both new warns keep the F4.145 leak discipline — `namedError` stuffs `FIXTURE_KEY` into `err.message`, so each has its own `OBJECT_KEY_PREFIX`-absence row and switching either line to `err.message` reddens it. **Mutation — call `discardObject` directly: five rows redden.**

   *Deviation, recorded not hidden:* these rows take `asset-images-write.service.spec.ts` from 610 to roughly 690 lines. Amendment 3 gives a **600-line spec budget** as the reason `remove` became its own spec pair; the sweep sized against §4.5's 1000-line file cap instead, because the C3 rows need `runUploadRejecting` and the upload scenarios, which the `remove` spec does not import. The next rows in this file should force the split rather than widen it again.
4. **(Security, Low)** `originalFilename` and `caption` were bounded by length only, so `a\r\nb.png` was stored and read back verbatim. Only the constant `Content-Disposition: inline` with no `filename=` parameter keeps that harmless today — the same shape as Amendment 2 item 1, where a stored `sha256` was harmless until `res.setHeader("ETag", …)` quoted it. `packages/shared/src/contracts/asset-images.ts` exports `NO_CONTROL_CHARACTERS` (`/^[^\p{Cc}]*$/u`, the Unicode Other-Control category: U+0000–U+001F and U+007F–U+009F) and applies it to both DTO fields; `asset-images.schema.ts` **imports** the same constant for `assetImageFilenameSchema` and `assetImageUploadFieldsSchema`'s `caption` rather than restating it (§4.8) — two copies of a security pattern drift in silence. The request-path rows put the control character in the **interior** (`a\r\nb.png`) because those schemas `.trim()` first, so a trailing CR LF never reaches the pattern. Rows: four in the shared spec and four in `image-signature.spec.ts` (a CR LF filename and a BEL caption refused; `café.png` and an emoji caption accepted — a pattern that refused everything outside ASCII would pass both refusals while breaking the very names item 1 exists to recover). A stored row that breaks the new bound is now a `parseStoredContract` 500 like Amendment 2's three, so `asset-images.service.spec.ts` gains `originalFilename with a carriage return` in `CONTRACT_BREAKING_ROWS` and a second stream row proving that row opens no object stream. `tests/adr-0030-contract-derivation.test.ts` and the existing `assetImageDtoSchema` rows still pass. **Mutation — replace the pattern with `/^[\s\S]*$/u`: six rows redden** across the shared spec, the API schema spec and the service spec.

**The reviewer's two nits, recorded and not fixed.** A **duplicate `caption` part** fails closed with no row of its own: `@nestjs/platform-express`'s `append-field` turns two same-named fields into an array, `assetImageUploadFieldsSchema`'s `z.string()` refuses it, and the global `ZodErrorFilter` answers 400 — correct behaviour reached through three components, none of which names the case. `openImagesFor` on the location dashboard **survives a filter change** (Amendment 3's plan deviations already record that a stale id renders nothing): the row holding the open gallery unmounts, so nothing is rendered and no request is made.

**Verification (§4.6), layers: the API and browser layers are the caller's at step 6.** This sweep touches no migration and no seed, so the database layer is N/A beyond the rows Amendment 3 already measured. The unit and component suites, `tests/adr-0030-contract-derivation.test.ts`, `tests/f4.108-service-parses-are-guarded.test.ts`, `tests/f3.3-object-storage-invariants.test.ts` and `tests/repo-invariants.test.ts` were run from the worktree root, with `pnpm typecheck` and `pnpm run typecheck:tests`.
