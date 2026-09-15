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
