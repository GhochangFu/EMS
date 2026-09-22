# ADR 0071 — Scheduled PDF / Excel energy reports (`F3.5`)

## Status

Accepted — drafted and ruled at the §10 gate on 2026-09-21, before any
implementation code. Five gate questions were put to the owner one at a time;
the rulings are recorded under *Gate questions* and carried into *Decision*.

Promotes two §6 lines (`AGENTS.md`: *Energy reports (PDF)* and the *persisted
report storage* clause of the Phase 5 status paragraph) and un-skips roadmap
Phase 5 Sprint F. The `chore(agents):` sweep is a separate PR (§9.10).

Splits `F3.5` into `F3.5a` (renderer, on-demand PDF, stored files, history)
and `F3.5b` (schedules, the two queues, email delivery, admin surface), serial.

## Context

`F3.5` (Track C, Wave 3, P2, *"Scheduled PDF / Excel energy reports"*,
`Depends: F3.1, F4.1`) was written on 2026-08-03 with an effort of 4–6. Both
dependencies closed within the month. The row waited because three things it
needs did not exist then, and now do. Each fact below was read from source on
2026-09-21.

**1. The report exists, in two of three formats, and its serialisation is
already shared.** `ReportsService.energyPreview` builds the Energy
Consumption report (summary, source totals, top consumers) for a
`startDate`/`endDate` and an `assetIds` scope; `energyCsv` and `energyXlsx`
render it through `reports.serialise.ts`, whose `energyTable` is the one
row source both formats read (ADR 0026 Amendment 2, `F4.51`). The preview's
`notes` still say *"PDF output and report history remain deferred to later
sprint scope"*, and `AGENTS.md` §6 says the same twice: *"Energy reports
(PDF)"* and *"Report PDF output … persisted report storage … remain out of
scope"*.

**2. Scope is threaded, not ambient.** `ReportsService` runs on `FLEET_POOL`
(BYPASSRLS) because the report joins `bms.assets`, and its only isolation
control is the `assetIds` argument, supplied today by
`AccessControlService.readableAssetIds(jwt)` in `ReportsController`. A
scheduled run has no JWT, so the substitute for that argument is a decision,
not a detail — silence here is the finding `security-reviewer` would return.

**3. The worker exists, and both of its queues are static.** ADR 0063
(`F4.24`) gave `apps/api` a second entrypoint, one `QueueModule`, one typed
registry (`ALL_QUEUES`), tenancy-bound processors (`runProcessor`) and one
`Worker` per declaration; ADR 0064 (`F3.11`) added `rules-sweep`. Both
queues are declared at build time and given one repeatable job at
`onModuleInit`. Nothing yet creates a schedule at runtime for one
organization, which is what a report schedule is. `ALL_QUEUES`'s docblock
says a new queue is declared *"here … and nowhere else"*, and
`WorkerHostService`'s says every consumer is registered *"beside
`ALL_QUEUES`'s declarations"* — the shape this ADR must fit.

**4. Object storage exists, and its rules bind any second file table.** ADR
0066 (`F3.3`/`F3.4`) promoted S3-API storage with one bucket,
server-generated keys under `org/<organizationId>/…`, the row as the
authority (decision 4), an API-proxied read path that never presigns
(decision 6), a per-asset cap that refuses with 409 before any storage call,
and a delete order of row-then-object with an orphan sweep (decision 11).
The roadmap's Sprint F line already says a report file store *"would reuse
`apps/api/src/storage/` and needs no new promotion"*.

**5. Email exists, without attachments.** `EmailTransport` (`F3.8`, ADR
0041) sends through nodemailer when `SMTP_HOST` is set and hands out
`LogTransport` otherwise. `NotificationMessage` carries `subject`, `body`
and rule/alarm identifiers; it has no attachment field, and the delivery
ledger (`bms.notification_deliveries`) is keyed to a rule and an alarm.

**6. Time has a zone since `E4.1b`.** `bms.locations.timezone` (migration
`0075`, ADR 0070 decision 6) is an IANA zone, nullable. Organizations carry
`currency` (migration `0076`, `E4.1c`) but no zone. A daily report for an
Indian site must close at local midnight, which is a half-hour offset from
UTC — the case ADR 0070 Q6 recorded.

**7. The row's effort is stale.** 4–6 was estimated before the queue, the
storage path and persisted history were in play. What the rulings below
enumerate is a migration, a renderer, a storage path with retention, a
download route, a dispatcher, a render job, an email attachment and an admin
surface. That is `E4.1`'s size (10–13, split into three), not a 4–6.

## Gate questions

**Q1 — How does the worker schedule a per-organization report?** *(a)*
**A dispatcher tick over a table** — one fleet-tenancy queue ticks, reads due
rows from `bms.report_schedules`, and enqueues one tenant job per due
schedule; Postgres stays the authority, the same shape as `rules-sweep`.
*(b)* One BullMQ job scheduler per row, mirrored on every edit and
reconciled at boot; Redis becomes authoritative for timing. *(c)* Defer
scheduling and ship on-demand PDF plus history. **Ruled (a).**

**Q2 — Under whose scope does a scheduled run read?** *(a)* **An explicit
scope on the row** — `location_ids`, empty meaning the whole organization,
resolved to asset ids under RLS at render time; creating a schedule requires
manage rights over every named location; a stored file is readable by users
whose scope covers it. *(b)* Re-resolve the creator's scope at render time —
breaks silently when the user is deactivated or narrowed. *(c)*
Organization-wide only. **Ruled (a).**

**Q3 — Which PDF renderer?** *(a)* `pdfkit`, pure JS, hand-built layout.
*(b)* **`pdfmake`** — declarative tables and page layout over `pdfkit`,
still pure JS, no Chromium. *(c)* Headless Chromium — mirrors the web
preview, at the cost of Chromium in two images, a CI change and memory the
compose stack has already run short of. **Ruled (b).**

**Q4 — Storage, retention and delivery.** *(a)* History with a retention cap,
email deferred. *(b)* **History with a retention cap, and email attachment
in v1** — a schedule may name an `email` channel; the render job attaches
the file; the transport gains an attachment field and a size ceiling. *(c)*
History without retention. **Ruled (b).**

**Q5 — Split the row?** *(a)* **Two children, serial** — `F3.5a` renderer,
on-demand PDF, `bms.report_files`, storage write, proxied download, history,
retention helper; `F3.5b` `bms.report_schedules`, the two queues, period and
timezone maths, email attachment, admin surface. *(b)* Three children. *(c)*
One row re-estimated. **Ruled (a).** Umbrella effort becomes 11–15.

## Decision

1. **Promote PDF output and persisted report files, and nothing else from
   §6.** The two `AGENTS.md` §6 targets are the bullet *"Energy reports
   (PDF)"* and the clause *"Report PDF output … persisted report storage"*
   in the Phase 5 status paragraph. NERSA / ISO compliance reports, CR
   Trends and every other §6 line are untouched. Roadmap Phase 5 Sprint F
   (*"skipped for now"*) becomes active under this ADR and closes with
   `F3.5a`.

2. **Renderer: `pdfmake` in `apps/api`, §9.4-gated by this ADR, with the
   PDF standard Helvetica family and no font VFS.** `reports/energy-pdf.ts`
   exports a pure `energyPdfDefinition(preview: EnergyReportPreview):
   TDocumentDefinitions` that reads the same `energyTable` rows as the CSV
   and XLSX — one report, three formats, one row source — and a
   `renderPdf(definition): Promise<Buffer>` that drives `PdfPrinter`. **The
   fonts narrow what Q3 offered.** Q3 described `pdfmake` as shipping a
   Roboto font VFS (~1 MB); that VFS is the browser build's, and the server
   build accepts the PDF standard-14 font names through `PdfPrinter` —
   `{ Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics:
   "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" } }` (pdfmake
   docs, *Standard 14 fonts*, read 2026-09-21) — so no `.ttf` and no VFS is
   shipped, loaded or bundled. **Consequence, ruled here:** the docs say the
   standard fonts *"support only ANSI code page"*, so the PDF writes money
   as `<ISO code> <amount>` (`INR 1,234.56`), never a currency symbol, and
   an asset name outside WinAnsi renders as pdfkit's fallback glyph; the
   XLSX and CSV already carry numbers only and are the formats for such
   names. A bundled Unicode font is a named deferral.

3. **One more on-demand route, same query, same scope, same headers:**
   `GET /api/v1/reports/energy/export.pdf` beside `export.csv` and
   `export.xlsx` — `Content-Type: application/pdf`, `Content-Disposition:
   attachment`, `Cache-Control: no-store`, `@Res()` for the `Buffer`, scope
   from `readableAssetIds(jwt)`. A separate route, not a `?format=`, for
   the reason `export.xlsx` gives.

4. **`bms.report_files`, migration `0077`, tenant-scoped in the creating
   migration** (ADR 0043/0045: policy and grants land with the table, never
   retrofitted). Columns: `id`, `organization_id` (FK, NOT NULL),
   `schedule_id` (FK `bms.report_schedules`, nullable — added by `0078`;
   NULL names an on-demand save), `template_id` (`energy_consumption`),
   `format` (`pdf` | `xlsx`, CHECK), `period_start`, `period_end` (date),
   `location_ids` (`uuid[]`, NOT NULL, `{}` = whole organization — the
   readers' scope, snapshotted at write), `object_key` (unique, never
   echoed), `content_type`, `byte_size`, `sha256`, `filename`,
   `delivery_status` (`none` | `sent` | `skipped_unconfigured` | `failed`,
   CHECK, default `none`), `delivery_error` (text, nullable, never carries
   an address), `created_by` (nullable FK `users`), `created_at`. Unique
   `(schedule_id, period_end, format)` where `schedule_id IS NOT NULL` — the
   idempotency row for decision 9.

5. **Object keys and the storage rules are ADR 0066's.** `object-key.ts`
   gains `buildReportObjectKey({ organizationId, fileId })` →
   `org/<organizationId>/reports/<fileId>`, uuid-checked like
   `buildObjectKey`. The write is row-then-object with the same
   commit-then-discard cleanup `F3.4` measured; the read is proxied through
   `GET /api/v1/reports/files/:id/download` with `Content-Disposition:
   attachment; filename="<filename>"`, `Cache-Control: no-store`, and the
   row's `content_type`; the delete is row-then-object, and the orphan sweep
   of decision 11 covers the new prefix. Nothing is presigned. With storage
   unconfigured the file routes answer 503 and `export.pdf` still answers —
   the renderer needs no bucket.

6. **Who reads and writes a report file.** A file's readers are the users
   whose manage scope covers its `location_ids`: the global admin, an
   organization admin of `organization_id`, or a location admin for whom
   `canManageLocation` holds for **every** id in the array (an empty array
   requires organization-level rights). The list route filters by the same
   rule. An on-demand save — `POST /api/v1/reports/energy/files`
   `{ startDate, endDate, format }` → 201 with the file DTO — renders under
   `readableAssetIds(jwt)` and stamps `location_ids` from
   `writableLocationIds(jwt)` (`null` → `{}`); a caller with asset-group
   scope only (`wc-hvac-admin`) has no location set to stamp and is
   refused with 403. `DELETE /api/v1/reports/files/:id` follows the read
   rule. On-demand files are capped per organization at
   `REPORT_ONDEMAND_CAP` (default 50) and the save refuses with 409 before
   any storage call — ADR 0066's cap shape, fail-closed on a non-numeric
   count.

7. **`bms.report_schedules`, migration `0078`, tenant-scoped in the creating
   migration.** Columns: `id`, `organization_id`, `name` (text, ≤120),
   `template_id`, `formats` (`text[]`, non-empty subset of `{pdf, xlsx}`,
   CHECK), `cadence` (`daily` | `weekly` | `monthly`, CHECK), `run_at_local`
   (`time`, minute precision), `timezone` (varchar(64), NOT NULL, IANA — the
   admin surface defaults it from the first named location's
   `locations.timezone`, else `Asia/Kolkata`), `location_ids` (`uuid[]`,
   NOT NULL, `{}` = whole organization), `channel_id` (nullable FK
   `bms.notification_channels`, same organization, kind `email`),
   `enabled` (bool, default true), `next_run_at` (timestamptz, NOT NULL),
   `last_run_at` (nullable), `created_by`, `created_at`, `updated_at`.
   Creating or editing one requires manage rights over every id in
   `location_ids` (empty → organization admin or global admin); a
   `channel_id` must pass `canManageNotificationChannel`. The period a run
   covers is the **previous complete unit** in `timezone`: `daily` — the
   local day before the run; `weekly` — the seven local days ending the
   previous Sunday, runs on Monday; `monthly` — the previous local
   calendar month, runs on day 1. A weekday or day-of-month column is a
   named deferral. `next_run_at` and the period bounds are computed in the
   zone by a pure `reports/report-period.ts` over `Intl.DateTimeFormat`
   (no date library — `E4.1b` put its calendar windows in SQL, and the API
   holds no zone helper to reuse) and stored in UTC; `Asia/Kolkata`
   (+05:30) and a DST zone are the spec's fixtures.

8. **Two queues, appended to `ALL_QUEUES` and to `WorkerHostService`'s
   constructor in slot order, nothing moved.** `reports-dispatch` — fleet
   tenancy, empty strict payload, one repeatable job upserted at
   `onModuleInit` every `REPORT_DISPATCH_INTERVAL_MS` (default `60000`,
   floor `10000`), scheduler id `reports-dispatch`. Its handler runs as
   `bms_fleet` on `ctx.db`, inside one transaction: `SELECT … FROM
   bms.report_schedules WHERE enabled AND next_run_at <= now() FOR UPDATE
   SKIP LOCKED`, then one `enqueue` per row, then `UPDATE … SET next_run_at
   = <next>, last_run_at = now()` for the rows enqueued, then commit.
   Enqueue before advance, because the queue is the idempotent side: a tick
   that dies between the two leaves `next_run_at` due, the next tick
   enqueues the same `jobId` and BullMQ de-duplicates it while the earlier
   job is retained; the reverse order would lose the period. A second
   dispatcher (an `api-replica`'s worker) skips the locked rows.
   `reports-render` — tenant tenancy, payload
   `{ organizationId, scheduleId, periodStart, periodEnd }` (uuid, uuid,
   date, date, strict), `jobId` `<scheduleId>:<periodEnd>`, retry
   `RETRY_DEFAULTS`. `concurrency: 1` on both, as `startQueueWorkers` sets.

9. **The render job is idempotent on the unique row, and it reaches the
   report through a named import edge.** The job body lives in a
   `ReportRenderService` in `apps/api/src/reports/`, exported by a
   loop-free `ReportsCoreModule` (the `RuleSweepModule` shape, ADR 0064
   decision 3) that `WorkerModule` imports beside `RuleSweepModule`;
   `WorkerHostService` injects it as constructor slot 7 and its docblock
   records the second `queue/ → reports/` edge in the sentence that
   already records `queue/ → rules/`. `ReportsCoreModule` provides
   `ReportsService`, `ReportRenderService` and — **as a provider, never by
   importing `CalcModule`** — `CalcParametersService` (one `FLEET_DRIZZLE`
   dependency, from the `@Global()` `DatabaseModule`), because
   `CalcModule` carries `CalcStreamingService` and `CalcSchedulerService`
   and ADR 0063 decision 3 forbids the worker a loop the API starts;
   `NotificationsCoreModule` supplies the transports for decision 10, as it
   does for `RuleSweepModule`. The fence
   `tests/f4.24-worker-imports-no-api-loop.test.ts` stays the gate: the new
   module's closure reaches no sweep loop, no listener and no controller,
   and the fence reddens if a later edit makes that false;
   `fleet-read-wiring.spec.ts` pins the new slot, and the compose
   boot is the DI gate (a green build is not one). `ReportsModule` imports
   `ReportsCoreModule` in place of providing `ReportsService` itself.
   Inside
   `withTenant(tenantDb, organizationId, …)` the job loads the schedule, resolves
   `location_ids` to asset ids **under RLS** (the tenant transaction), calls
   `ReportsService` with those ids on the fleet pool exactly as the
   controller does, writes one `report_files` row and one object per format,
   prunes to the newest `REPORT_RETENTION_PER_SCHEDULE` (default 24) files
   of that schedule row-then-object, then delivers (decision 10). A retry
   that finds its `(schedule_id, period_end, format)` row already present
   skips that format and continues — the queue never promises exactly-once
   (`ALL_QUEUES`). A schedule that is disabled or deleted between dispatch
   and render completes with no row and a counted `info`. Two counters
   join `countQueueJob`: `bms_report_files_written_total{format}` and
   `bms_report_deliveries_total{status}`.

10. **Email attachment through the existing transport.**
    `NotificationMessage` gains `attachments?: readonly { filename: string;
    contentType: string; body: Buffer }[]`; `EmailTransport` passes them to
    `sendMail` and `LogTransport` and `WebhookTransport` ignore them. The
    render job builds one message per run — subject `<schedule name> —
    <period>`, body the summary lines, one attachment per format — to
    `channel_id`'s channel when set. Ceiling `REPORT_EMAIL_MAX_BYTES`
    (default `10485760`): above it the body carries the history link and no
    attachment. The outcome lands on **`report_files.delivery_status` and
    `delivery_error`**, not in `bms.notification_deliveries` — that ledger is
    keyed to a rule and an alarm, and a report is neither; the row is where
    an operator looks for the file. `delivery_error` names counts and
    `err.name`, never an address (§9.6).

11. **Routes and contracts.** `GET|POST /api/v1/reports/schedules`,
    `GET|PATCH|DELETE /api/v1/reports/schedules/:id`, `GET
    /api/v1/reports/files`, `GET /api/v1/reports/files/:id/download`,
    `DELETE /api/v1/reports/files/:id`, `POST /api/v1/reports/energy/files`.
    Every response type is `z.infer`red from
    `packages/shared/src/contracts/reports.ts` (ADR 0030); the file DTO
    never carries `object_key`. Request schemas are `.strict()`.

12. **Web.** `F3.5a`: the Reports panel gains a **PDF** button beside CSV and
    XLSX, a **Save to history** action, and a **History** list (filename,
    period, format, size, delivery status, download, delete). `F3.5b`: a
    **Schedules** section on the same page for users who can create one
    (name, cadence, run time, timezone, formats, locations, email channel,
    enabled), matching `TRINETRA.html`'s Reports & Analytics (`R.rp`)
    where the mock has a shape for it.

13. **Compose and CI change nothing.** The worker already joins the `core`,
    `pilot` and `phe` profiles (ADR 0063 decision 12); MinIO and Redis are
    already pinned in CI (ADR 0063 decision 13, ADR 0066 decision 10).
    `pdfmake` is a pure-JS dependency, so no image gains a binary.

## Dependencies

- `pdfmake` (runtime) and `@types/pdfmake` (dev) in `apps/api`. Pure
  JavaScript over `pdfkit`; no native module, no browser. §9.4-gated here;
  the manifest change lands in `F3.5a`'s first PR with this ADR as its
  justification.

## Consequences

- **`AGENTS.md` §6 owes two edits and the status line one paragraph**, in a
  separate `chore(agents):` PR after `F3.5a` merges: soften the
  *"Energy reports (PDF)"* bullet and the *"Report PDF output … persisted
  report storage"* clause; §2 gains a *Reports* row naming the three
  formats, the file table and the two queues.
- **`ReportsService.energyPreview`'s `notes`** lose the *"PDF output and
  report history remain deferred"* line in `F3.5a`, and the *"generated on
  demand and not persisted"* line is rewritten to name the history.
- **The worker now opens tenant backends on a schedule** (the render job),
  so its `pg_stat_activity` count rises when a report is due; ADR 0064's
  Consequences already record the sweep's numbers, and `F3.5b`'s closure
  row records the render job's.
- **A stored report is a scope snapshot.** A user whose scope later narrows
  keeps no access — the read rule is evaluated on the row's `location_ids`
  at request time, not at write time. A file whose location is deleted
  keeps its array and becomes readable by organization admins only.
- **Deferred, by name:** a weekday / day-of-month choice for weekly and
  monthly schedules; CSV as a scheduled format; templates other than
  `energy_consumption`; NERSA / ISO compliance reports (§6, untouched);
  a delivery row in `bms.notification_deliveries` for reports; a
  presigned download; report files for a user with asset-group scope
  only.
- **Effort:** `F3.5` becomes an umbrella at 11–15 — `F3.5a` 5–7,
  `F3.5b` 6–8, serial, `F3.5b` depends on `F3.5a`.

## Amendment 1 — `F3.5a` plan rulings and what the build measured (2026-09-21, in progress)

The step-3 plan (`docs/plans/f3.5a-pdf-report-files.md`) put three
questions to the owner and made twelve further rulings where this ADR is
silent; the owner accepted all fifteen as recommended on 2026-09-21. The
three answers, because they change decisions 6 and 11:

1. **The save body carries an optional `organizationId`** (plan Q-1, R-4).
   Decision 11's `POST /api/v1/reports/energy/files` body is
   `{ startDate, endDate, format, organizationId? }`. A global admin, or an
   organization admin who holds several organizations, must send it (400
   naming the field); an admin with exactly one organization may omit it, and
   a value that differs from their own is 403. The render scope is
   `readableAssetIds(jwt)` intersected with that organization's assets, so a
   file never carries another organization's rows. Decision 6's original
   sentence had no organization to stamp on the row for those callers.
2. **An organization admin's file stamps `location_ids = {}`** (Q-2, R-5),
   not `writableLocationIds(jwt)` as decision 6 says — that helper returns
   every location of every organization the admin holds, which would stamp
   foreign ids on the row. A `location_admin` stamps their writable locations
   intersected with the organization's; an empty intersection is 403.
3. **Out-of-scope download and delete answer 403** (Q-3, R-6), the
   asset-image routes' status, with one sentence:
   `Report file is outside your access scope`.

Measured at Unit 1, correcting decision 2's API description:

4. **`pdfmake@0.3.11` exports a singleton, not a `PdfPrinter` class.**
   Decision 2 says `renderPdf` "drives `PdfPrinter`" and names
   `PdfPrinter` for the standard-14 descriptor; that is the 0.2.x server
   API. `0.3.x`'s `js/index.js` is `module.exports = new pdfmake()` with
   `setFonts` / `createPdf`, and `new PdfMake(...)` fails `TS2351`
   (measured). `energy-pdf.ts` calls `PdfMake.setFonts(STANDARD_FONTS)`
   then `PdfMake.createPdf(definition).getBuffer()`. The font descriptor
   and the "no `.ttf`, no VFS" claim are unchanged and pinned by
   `assertFontsAreTheStandardFourWithNoFile`.
5. **The renderer sets a fail-closed access policy, and the warnings are
   gone.** `createPdf` warns when no URL policy and no local-file policy is
   set. Unit 1 tried a deny-all local-file policy, which threw `Access to
   local file denied` for `Helvetica-Bold`, and recorded the warnings as a
   residual. The step-5 fix measured what Unit 1 had not:
   `setLocalAccessPolicy`'s callback receives the descriptor value itself
   (`"Helvetica-Bold"`), so a policy can name the standard fonts.
   `renderPdf` now sets a local policy that allows exactly the four
   Standard-14 names and a URL policy that denies every URL. Measured: all
   four styles render, zero `console.warn`, and a definition naming
   `/etc/passwd` rejects with `denied by resource access policy`
   (`energy-pdf.spec.ts`, three rows; removing the policy reddens two).
6. **The lockfile gained no native module** (decision 13, measured): no
   `optionalDependencies` with a `cpu`/`os` field under `pdfkit` or
   `fontkit`.

The step-5 reviews (2026-09-21; `code-reviewer`, `security-reviewer`,
`migration-reviewer`, `agents-compliance-reviewer`) found no Critical or
High. What they found, and the test that reddens on each, all applied on
the branch before the PR:

7. **(Security, Medium — confirmed)** a calendar-invalid date such as
   `2026-02-30` passed the `^\d{4}-\d{2}-\d{2}$` regex, V8 rolled it to
   `03-02` (measured — the ADR first wrote `03-01`), the render and `putObject` ran, and Postgres refused the `date`
   insert — a 500 for a caller error plus one put and one delete per
   attempt, repeatable by one master-data user with no HTTP rate limiter.
   The save body's two dates now carry a round-trip refine with a NaN guard
   (`2026-13-01` made the bare `toISOString()` throw `RangeError`) and a
   `.describe()`; `report-files.controller.spec.ts` gates it at the parse.
   **Residual, recorded:** the three export routes keep the silent roll —
   `export.csv` for `02-31` covers to `03-02`. That is pre-existing and not
   this row's; a later row may lift the refine into
   `energyReportQuerySchema`.
8. **(Security, Low)** `canReadReportFile`'s `location` branch checked
   only the location ids, not `file.organizationId`; unreachable today
   because a location cannot move between organizations through the API,
   hardened anyway (`locationAdminIsRefusedByAForeignOrganization`).
9. **(Code review, false green — confirmed)** the advisory-lock row
   asserted SQL text (`hashtextextended($1, 0)`) and never the bound
   parameter, so a constant lock key survived; the harness now records
   `params`, and a second row pins the tenant GUC to the resolved
   organization. **(Code review, false green — confirmed)** the web client
   spec dropped the URL, so `downloadPdfHitsExportPdf` asserted
   `toBeDefined()` on a default `{}`; every row now asserts the path suffix
   and the method (routing the PDF to `export.csv` reddens).
10. **(Migration review, Low)** three fence rows read the raw migration
    file; a header comment quoting a statement would have kept its deletion
    green. They read `sqlOnly()` now (measured: green before, red after).
11. **(Code review, closed)** `download` treats a `null` `contentLength` as
    a match; `@aws-sdk/client-s3` always sends `Content-Length` on
    `GetObject`, so the branch is unreachable. No change.
12. **Recorded, not changed:** an `organization_admin` holding two or more
    organizations gets the API's 400 from the panel, because the organization
    select renders for the global admin only (plan R-13, owner-approved);
    the History table has no *Generated by* column although `createdBy` is in
    the DTO (the mockup's *Recent Exports* table has one); the
    `Content-Disposition` filename is quoted but not escaped, safe because
    the only writer builds it from two bounded dates and an enum — `F3.5b`'s
    schedule writer must never put a schedule name in `filename`;
    `X-Content-Type-Options` is set but not in CORS `exposedHeaders`, so a
    browser applies it and the SPA cannot read it; `content_type` has no
    CHECK (the DTO enum gates it on read); `created_by` is `NO ACTION` like
    `asset_images`; `access-control.service.ts` crossed the §4.5 cap and
    `scopeFromSource` / `directOrganizationIds` moved to
    `access-scope-sources.ts` in their own `refactor(F3.5a):` commit
    (`2ab82d84`, byte-identical bodies); the integration suite is two spec
    files for the same cap.

§4.6, what ran against the stack (compose from the repo root, 2026-09-21):

- **Database:** `db:migrate` applied `0077` on the dev database; `\d
  bms.report_files` shows the sixteen columns, five constraints, the index,
  `FORCE` and the own-column policy; `bms_tenant` and `bms_fleet` hold the
  four privileges through `0041`'s default grants. **Cold start** on a
  scratch database (`bms_tmp`: init hook, `roles → migrate → seed` with the
  CI role passwords): 77 migrations applied, `report_files` forced, 148
  seeded assets, 0 report files; dropped afterwards.
- **API:** the container was rebuilt and restarted after U2, U8, U9 and the
  review fix (CreatedAt moved each time); Nest booted with
  `ReportFilesController {/api/v1/reports}` mapping four routes and no
  unresolved dependency. The HTTP matrix ran from the SPA tab (OIDC, the
  owner's session): `export.pdf` 200/`%PDF-`/`no-store`, reversed dates 400;
  save 201 with the DTO shape and no `objectKey`, 400 without
  `organizationId` for the global admin, 404 for an unknown organization,
  400 for `csv`, 400 for an unknown key; list newest first, `limit=500`
  400; download with the five headers and a body whose SHA-256 equals the
  row's; delete 204 then 404.
- **Object store:** 40 integration rows against MinIO (run twice); the
  orphan after a failed row is discarded; MinIO stopped → save 503 with one
  warn naming the file id, list 200-shape, `export.pdf` 200.
- **Browser** (`browser-verifier`, `javascript_tool` assertions, 0
  screenshots, served bundle `index-CcOsrotG.js` after a hard reload): 39
  claims across three users, 0 failures. `admin@bms.local`: three export
  buttons, the deferred pill absent, PDF download name, organization
  select listing ESKOM and PHEWB, Save disabled with the sentence until an
  organization is chosen, the saved line and the History row, Download,
  Delete and the empty sentence. `wc-admin@bms.local`: no organization
  select, Save enabled, its file stamped `[RSMOC-WC]`, the admin's `{}`
  file invisible in the list and 403 on download and delete, an XLSX save
  and download. `wc-hvac-admin@bms.local`: Export PDF present and 200, no
  Save block, no History, every file route 403 with the master-data
  sentence. Claims the jsdom specs already held (role gate, pill absence,
  by-position save arguments, the two-deletes pending state, the 503
  sentence) were re-run in the browser only where a click reaches the
  server.
- **Coverage** (full suite with the CI env block): 83.21 statements ·
  80.00 branches · 84.36 functions · 83.35 lines against 80.2 / 77.4 / 81.3
  / 80.4; thresholds unchanged. One suite failed locally on a leaked
  `mechanical-lift` draft template created 2026-09-19 — pre-existing, not
  this branch; CI on a fresh database is the gate.

13. **Post-merge sweep (2026-09-21).** One confirmed false green: the
    multi-organization branch of `resolveOrganization` with a body id —
    `writable.includes(requested)` — was reached by no row (every row with a
    body id held one grant), and inverting it left all 52 rows green. The
    scenario it guards is an organization admin of A and B filing a report
    stamped `organization_id = C`, a cross-tenant write the policy cannot
    refuse because the tenant GUC is set from the same value. Two rows now
    gate it (a held second organization resolves; a third is 403 before any
    render or put) and the inverted guard reddens exactly those two. Also
    added: an empty-scope render row (no consumers, `null` cost — measured
    to resolve, never gated). Two prose corrections: item 7 said V8 rolled
    `02-30` to `03-01`; it is `03-02`. The panel docblock overclaimed that
    every disabled state renders its sentence — the pending state carries it
    in the button label instead.

## Amendment 2 — `F3.5b` plan rulings, corrections and what the build measured (2026-09-22)

The step-3 plan (`docs/plans/f3.5b-report-schedules.md`) put six questions
to the owner and made nineteen further rulings where this ADR is silent;
the owner accepted all as recommended on 2026-09-21, before any
implementation code.

1. **Owner rulings (2026-09-21), all as the plan recommended.** **Q-1** the
   compose `worker` service gains `api`'s seven `OBJECT_STORAGE_*` lines,
   verbatim, and `depends_on: minio: service_healthy`. **Q-2** files are
   removed with their schedule: `report_files.schedule_id` carries no
   `ON DELETE` clause — Postgres's default is `NO ACTION`, identical to
   `RESTRICT` for a constraint that is not `DEFERRABLE`, which this one is
   not (the plan and the already-applied `0078` migration header both say
   `RESTRICT`; corrected below to the accurate term) — and the DELETE route
   removes the schedule's `report_files` rows, then the schedule row, then
   the objects, best-effort, after commit. **Q-3** a tick never catches up a
   missed period; each due row is enqueued once, for the period ending
   before its due instant, and advances to the next occurrence after now.
   **Q-4** `runProcessor` gains a post-commit continuation
   (`ProcessorContinuation.afterCommit`), awaited after the transaction
   commits and never when the handler threw or the commit failed; the
   render job's phase B (object prune, attachment read-back, email) and
   phase C (`delivery_status` update) run there. **Q-5**
   `MAX_REPORT_SCHEDULES_PER_ORGANIZATION = 50`, enforced under
   `pg_advisory_xact_lock` before any write. **Q-6** a `location_admin`
   cannot attach a channel — `canManageNotificationChannel` is `false` for
   that role, and no permission moves to change it; the create/edit form
   offers no channel select for that role and reads "Email delivery needs
   an organization administrator" instead.

   R-1..R-19 were accepted without change; the ones that correct or extend
   this ADR's text are folded into items 2–4 below. The rest (period
   signatures, dispatcher counters, DTO shape, config readers, the two
   byte-identical extraction commits, the web component split) are as the
   plan states and are not restated here.

2. **Three decision sentences measured false before code, corrected here.**
   - Decision 8's `jobId` `<scheduleId>:<periodEnd>` cannot be enqueued:
     `assertJobId` (`apps/api/src/queue/queue-registry.ts`) refuses any `:`,
     and BullMQ 5.81.5 throws `Custom Id cannot contain :` for one that
     reaches Redis regardless. The id is `<scheduleId>_<periodEnd>`, an
     underscore (`queue/reports-render.ts`).
   - Decision 13's "Compose and CI change nothing" is false for the worker:
     the compose `worker` service carried none of them (`api` carries six
     `OBJECT_STORAGE_*` lines plus the empty-string `ALLOW_INSECURE`
     default), so `readStorageConfig`
     answered `unconfigured` there and every render would have refused with
     `Object storage is not configured` on the reference stack. Corrected by
     Q-1.
   - `storage.module.ts`'s docblock claim "never `WorkerModule`: no job
     reads an object" is false since `F3.5b`: `WorkerModule` now imports
     `StorageModule` so the render job can put and read report objects.
     Consequences, measured rather than assumed: the worker's `GET /health`
     carries a `storage` section (`configured: true`; with MinIO stopped,
     `status: "degraded"`, `storage.reachable: false`, HTTP 200, recovering
     roughly 3 s after MinIO restarts); `StorageBootstrap.onModuleInit` runs
     `ensureBucket` on both processes; the worker image now loads
     `@aws-sdk/client-s3`, `xlsx` and the `pdfmake` singleton at start.

3. **Measured at the units — plan defects and rulings this ADR was silent
   on.**
   - **U3 (`report-period.ts`).** ICU canonicalises `Asia/Kolkata` to
     `Asia/Calcutta` on both Node 20.20.2 (the `api` container) and 24.17.0
     (the host) — `Intl.supportedValuesOf("timeZone")` lists
     `Asia/Calcutta` only — so a `resolvedOptions().timeZone === zone`
     equality check refuses the pilot's own zone. Owner-ruled instead:
     `isValidTimeZone` requires a `/`, a construction that does not throw
     `RangeError`, and every `/`-segment starting with an uppercase letter
     (`asia/kolkata` still refused). A plain two-pass UTC-offset
     computation lands a DST fold on the later occurrence; `toInstant`
     enumerates candidate offsets and keeps the earliest instant that
     round-trips (the `01:30` fold on 2026-10-25 in `Europe/London` lands
     on `00:30Z`). Two of the plan's mutations were inert against the
     first draft of the spec — dropping the second offset pass survived
     the BST-crossing row, and a local-midnight `getDay()` was
     self-consistent under the default host zone — and were replaced by
     mutations that redden (a `TZ=America/St_Johns` pin on the whole
     `.test.ts` file for the second).
   - **U6 (`runProcessor`).** `afterCommit` must also be skipped when the
     **commit** fails after the handler already resolved, not only when the
     handler itself throws — a row for that case was added; the plan's
     `finally`-based mutation for it was inert and was replaced.
   - **U7/U8 (storage extraction and render job).** R-15's
     `discardObjectsBestEffort(client, logger, keysByFileId)` did not exist
     at U7; it is written at U8 as the plural best-effort discard the
     render job's phase B and the DELETE route both call.
   - **U8 (`ReportRenderService`).** Delivery runs in **two** tenant
     transactions (read the rows still at `none` plus the channel, commit;
     then the S3 read-back and the SMTP send; then a second `withTenant` for
     the status update) — a tenant connection is never held across a
     network round trip. `RenderOutcome` carries `channelId`, `assetIds`
     and `prunedKeys: Map<fileId, key>`, fields the plan's shape did not
     name — `prunedKeys` is what lets phase B's best-effort discard run
     without re-reading the pruned rows — so `finish` never re-reads the
     schedule. A JS array inside a drizzle `sql` template
     expands to `($1, $2)`, which `any(...)` refuses as a row constructor
     (measured) — the location predicate uses `inArray`/`pgArray` instead.
     `tests/f3.3`'s row that pinned "the worker gets no storage" was
     inverted to the positive. The `CalcModule` fence mutation — adding
     `import { CalcModule } from "../calc/calc.module"` to
     `ReportsCoreModule.imports` — reddened four rows naming
     `calc/calc.module.ts` and `telemetry/telemetry.module.ts` in
     `tests/f4.24-worker-imports-no-api-loop.test.ts`.
   - **U9 (dispatcher).** Drizzle's raw `execute` returns a `timestamptz`
     column as the driver's **text**, not a `Date` — the first integration
     run warned `RangeError` on every real row while the `Date`-carrying
     unit fake passed; `tick` now reads the instant the way drizzle's own
     column mapper does. `tick` accepts `BmsDb | BmsTx`, and
     `NodePgTransaction.transaction` opens a savepoint on the same session,
     so a `withRollback` integration case claims its own inserts. The
     mutation swapping the dispatch/render declarations' order in
     `startQueueWorkers`'s array is inert — array order is not behaviour,
     each `Worker` is built from its own registration's `decl.name` — a
     plan claim recorded as a defect, not acted on.
   - **U10/U11 (email, routes).** The plan's row `aFailedFinishLeavesRowsAtNone`
     assumed "the sender throws once" leaves a row at `none`; it does not —
     `EmailTransport.send` catches the throw and returns `failed`. The row
     fails phase B through a `getObject` that throws once instead. `pg`
     returns a `time(0)` column as `"HH:MM:SS"` text; `runAtLocal` is
     sliced to `HH:MM`.
   - **U11 (routes and rights).** `ChannelsService` is not `@Global()`, so
     `ReportsModule` imports `NotificationsCoreModule` to reach it — a DI
     hole `pnpm build` cannot see; only the compose boot proved the wiring.
     `created_by` on a schedule route is resolved the way `F3.5a` resolves
     it (`resolveActorId`, a private copy — the plan named no shared
     source). A PATCH counts as a change when a value differs from the
     stored row, never by key presence alone. `remove` on a schedule needs
     storage configured (503 otherwise, since its objects must be
     discardable).
   - **U13 (web).** `fetchAdminLocations` takes the literal `"true"`, not
     `"active"` — it is a `MasterDataActiveFilter` (`"true" | "false" |
     "all"`), a plan defect recorded and not built as written. Disabling a
     schedule is a per-row toggle: a first-draft global-disable control
     would have made the "two deletes" row unreachable and was not built.
     An empty PATCH (no changed keys) answers "Nothing changed yet" rather
     than a guaranteed 400.

4. **Step-5 reviews (2026-09-22; `code-reviewer`, `security-reviewer`,
   `migration-reviewer` on Opus, `agents-compliance-reviewer` on Sonnet):
   no Critical or High.** Applied in `02d32ca5`, each with the row that
   reddens:
   - (Medium, false green) a committed **due** render fixture on a shared
     database was claimed by the live compose worker inside 60 s — green in
     CI (no worker runs there), flaky locally. Render fixtures now set
     `next_run_at = now() + interval '10 years'`; the dispatch claim row
     used to prove the `FOR UPDATE SKIP LOCKED` lock lives only inside its
     own scenario.
   - (Low) with retention set below the format count, the prune deleted one
     of the run's own just-written rows (same `now()`, a uuid tie in
     `created_at DESC, id DESC` ordering). `REPORT_RETENTION_PER_SCHEDULE`
     is now clamped to `max(value, REPORT_FILE_FORMATS.length)` with one
     warn — R-14 had said floor 1.
   - (Low) the post-commit continuation row now asserts that `finish` was
     **not** called before `afterCommit()` ran, not only that it was called
     after.
   - (Security, Low) `REPORT_HISTORY_URL` is normalised on read: userinfo
     cleared, the value trimmed, a trailing slash removed.
   - (Security, Low) `ReportPeriodError` messages name the field only,
     never the zone value or the clock reading.
   - (Security, Low) the dispatch claim carries `LIMIT 200`
     (`REPORT_DISPATCH_CLAIM_LIMIT`), so a slow Redis bounds how long one
     lock-holding transaction can run.
   - (Migration, Low) `run_at_local` is `time("run_at_local", { precision: 0
     })`; two prose sites and a test title that had said `RESTRICT` now say
     `NO ACTION` (item 2).
   - (nit) the `location_admin` empty-scope refusal reads "Choose at least
     one location".

   Recorded, not changed: the compliance reviewer's note that in-code
   comments cite "Amendment 2" before this text existed — true at merge
   time; the `0078` migration file's header comment still says `RESTRICT`
   and is frozen (forward-only, already applied to the dev database — see
   `6f5aa0b0`); `locationIds.max(200)` is a step-3 bound, not this row's to
   change; an `organization_admin` holding several organizations sends no
   `organizationId` in the schedule create body (R-18 carries `F3.5a`'s
   limitation forward — the organization select renders for the global
   admin only); the notification-channel DELETE route answers 200, a
   pre-existing shape this row did not touch.

5. **§4.6, what ran against the stack (compose from the repo root,
   2026-09-22).**
   - **Database.** `0078` applied (ledger id 87, hash equal to the file);
     `\d bms.report_schedules` and `\d bms.report_files` show `FORCE`, the
     own-column policy, and the four privileges for `bms_tenant` and
     `bms_fleet`. The cold start was **not** re-run on this branch —
     `F3.5a`'s cold-start result stands, and CI's fresh database is the
     gate for `0078`.
   - **API.** The container was rebuilt three times (U10, U11, the review
     fix; last `CreatedAt 2026-09-22 04:24:38 +0530`); Nest booted with
     `ReportSchedulesController {/api/v1/reports}` mapping five routes and
     no unresolved dependency. The HTTP matrix ran from the SPA tab (OIDC,
     the owner's sessions, via `browser-verifier`'s `javascript_tool`
     assertions, 0 screenshots): **admin** — 18 claims, 17 pass and one
     expectation of the dispatch wrong (the pre-existing channel `DELETE`
     answers 200 by `@HttpCode(OK)`, not 204 — the route is not this
     row's); the 17 include 201 with
     `nextRunAt` equal to the hand-computed IST instant (diff 0 s), 400
     without `organizationId`, `asia/kolkata` 400 `fieldErrors.timezone`,
     `Not/AZone` 400, `formats: []`/`csv`/an extra key 400, a webhook
     channel 400, an email channel 201, list newest first, `PATCH
     { enabled: false }` then `{ enabled: true }`, an empty PATCH body 400,
     a strict-unknown-key PATCH 400, `locationIds` `[WC]` 200 and a foreign
     uuid 400, the cap — 201 up to the organization's 50th row then 409
     "This organization already has 50 report schedules; delete one before
     creating another" — then 47 DELETEs 204 and a second DELETE 404.
     **wc-admin** — 16 claims, including the three whole-organization rows
     invisible in the list and in `/reports/files`, `[WC]` 201, `[]` 403,
     `CSMOC-GP` (a foreign location) 403, a channel 403, the admin's row
     403 on GET, PATCH to `[]` 403, DELETE 204. **wc-hvac-admin** — 7
     claims, every route 403 with the master-data sentence.
   - **Worker.** Rebuilt (`CreatedAt 2026-09-22 04:24:39`); four
     `worker started` lines, no unresolved dependency. A schedule inserted
     as `bms_fleet` was claimed on the next tick
     (`due=1 enqueued=1 skippedInvalid=0 durationMs=76`), rendered
     (`written=2 skippedExisting=0 pruned=0 assets=100`), `next_run_at`
     advanced to the next 00:30 IST with the period equal to the previous
     local day. Counters: `bms_report_files_written_total{format="pdf"} 1`,
     `{format="xlsx"} 1`, `bms_report_deliveries_total{status="skipped_unconfigured"} 1`.
     `pg_stat_activity` for the worker's address: 0 backends at rest, a
     peak of 2 during one render (1 `bms_fleet`, 1 `bms_tenant`) — the
     number this ADR's Consequences paragraph promised.
   - **Object store.** Two keys under `org/<ESKOM>/reports/` per run,
     `\d`-equal sizes to the rows' `byte_size`; all fixtures removed
     afterwards (0 keys left).
   - **Email.** Mailpit via a one-off worker container
     (`docker compose run --rm -d -e SMTP_HOST=mailpit -e SMTP_PORT=1025
     -e REPORT_DISPATCH_INTERVAL_MS=10000 worker`, with the compose worker
     stopped first — `tests/adr-0041` keeps `SMTP_HOST` out of
     `docker-compose.yml` itself). One message received, subject
     `f3.5b-mail-sched — 2026-09-21 to 2026-09-21`, body the four summary
     lines (`Total energy: 414.16 kWh`, `Peak demand`, `PUE estimate: 1.88`,
     `Indicative cost: ZAR 890.45`) and the no-URL sentence, two
     attachments — `energy-consumption-2026-09-21-to-2026-09-21.pdf`
     (5486 bytes) and the `.xlsx` (19742 bytes), equal to the rows'
     `byte_size` — and both rows `sent` with `delivery_error NULL`. The
     compose worker was restored afterward.
   - **Browser.** Served bundle `index-T1l0lSHy.js` after a hard reload
     (rebuilt after the review fix). `admin@bms.local`: the Schedules
     heading, the History table's Origin column with "Scheduled" rows and
     "Email not configured", a create whose Next run equals the
     hand-computed IST instant, Edit toggling Enabled off/on, Delete, and
     "Enter a name". `wc-admin@bms.local`: no organization select, no
     whole-organization option, `RSMOC-WC` listed, the Q-6 sentence,
     "Choose at least one location", a create with one location, a delete.
     `wc-hvac-admin@bms.local`: no Schedules heading, no History (Export
     PDF count of 1 used as a control). 0 console errors, 0 screenshots.
     Claims already held by the jsdom specs were not re-run in the browser
     except where a click reaches the server.
   - **Full suite** with the CI env block, after the review fix
     (`02d32ca5`): **638 files, 5109 / 5109**, `--maxWorkers=2` in a
     detached process (two in-session runs were killed by the machine for
     low memory beside the compose stack). Coverage 83.64 statements ·
     80.38 branches · 84.71 functions · 83.79 lines against the thresholds
     80.2 / 77.4 / 81.3 / 80.4 — up from F3.5a's 83.21 / 80.00 / 84.36 /
     83.35 on every axis; thresholds unchanged, as F3.5a left them. The
     first run, before the fix, was 5096 / 5097 with one failure on a leaked
     `mechanical-lift` draft template (created 2026-09-19) on this dev
     database, not this branch; the draft was deleted before the final run.

6. **Deferred, by name (added to this ADR's Consequences list).** Catch-up
   of missed periods, and a per-schedule "run now" route (Q-3). The orphan
   sweep row (ADR 0066 decision 11 — the worker now has its second job
   kind that can leave an orphaned object; the `F3.5b` closure files the
   sweep row, nothing here builds it). The multi-organization
   `organization_admin` gap in the web create form (item 4, recorded
   above).

7. **Post-merge sweep (2026-09-22; `code-reviewer` and `security-reviewer`
   after the merge of #513).** Each finding with the row that reddens and
   the mutation that proved it:
   - **(High, false green — confirmed)** the two 403 branches of
     `assertWriteScope` on the PATCH path — a `locationIds` outside the
     writable set, and `[]` under a `location` read scope — were reached by
     no row: passing `writableLocations: null` at `update`'s call site, or
     turning a `[]` body into "not in this PATCH", left all 52 unit rows
     green. Two rows on the unit spec
     (`patchToAnUnheldLocationOfTheOrganizationIs403`,
     `patchToAnEmptyScopeUnderALocationReadScopeIs403`) and two on real
     grants (`wcAdminCannotPatchItsRowOutOfItsScope` — `wc-admin` moving
     its `[WC]` row to `[EC]`, then to `[]`, both 403, the row re-read
     still `[WC]`). Each call-site mutation now reddens exactly its row
     (53 / 54).
   - **(Security L1 — confirmed)** a `location_admin` whose grants resolve
     to no location got a **500** from `GET /reports/schedules` and from
     `GET /reports/files`: drizzle's `arrayContained(column, [])` throws
     `arrayContained requires at least one value` while the predicate is
     built. Both `list`s now answer `[]` before any select when
     `scope.kind === "location"` and `locationIds` is empty — fail closed,
     list nothing. One row per service spec (red first with that message;
     removing the guard reddens both).
   - **(Security L2 — confirmed; a change to plan R-6)** poison rows pinned
     the head of the dispatch claim and starved every other tenant. R-6
     said a row whose period computation throws is "left due and enabled";
     with `ORDER BY next_run_at LIMIT 200`, 200 `Not/A_Zone` ESKOM rows due
     two hours ago plus one valid PHEWB row gave three ticks of `due=200
     enqueued=0 skippedInvalid=200` and PHEWB was never enqueued. **Ruled:
     a poison row is deferred, not left due.** The tick sets `next_run_at =
     now + REPORT_DISPATCH_POISON_BACKOFF_MS` (a module constant, one hour)
     in the same transaction as the advances and leaves `last_run_at`,
     `enabled` and `updated_at` alone, so the row retries hourly and the
     warn fires once per hour per row instead of once per tick; a PATCH
     that corrects the zone recomputes `next_run_at` and clears the backoff.
     The unit block `aPoisonRowIsCountedWarnedAndLeftDue` became
     `aPoisonRowIsCountedWarnedAndDeferredAnHour` (one update naming the
     row, two parameters, `next_run_at = now + 1h`, written after every
     add). The probe is an integration case under `withRollback` +
     `tx.rollback()`: tick 1 cannot reach PHEWB whatever it does with the
     poison rows (the claim is full of them), so **the claim is on tick 2 at
     the same `now`** — PHEWB enqueued once and advanced, every poison row
     an hour ahead. Leaving the rows due (the old behaviour) reddens the
     tick-2 row with the probe's own signature (`got 0 of 0 adds; due=200
     enqueued=0 skippedInvalid=200`). Measured while writing it: the poison
     fixtures must be the *most* overdue rows in the table (ten years, not
     two hours) — `report-schedules.integration.spec.ts` in the same run
     parks a committed row a year overdue and stole one slot (`due=200
     enqueued=1 skippedInvalid=199`), leaving one poison row to head tick 2.
   - **(Medium, false green — confirmed)** the History table's `scheduleId`
     wiring was observed by nothing: every fixture carried `scheduleId:
     null`, so `originLabel({ scheduleId: null })` or
     `deliveryStatusLabel(status, null)` in the component left 10 / 10
     green. A `SCHEDULED` fixture (`deliveryStatus: "none"`, non-null
     `scheduleId`) and one row: its Origin cell reads "Scheduled" and its
     Delivery cell "Pending", while the on-demand row beside it reads "On
     demand" twice. Either `null` reddens it.
   - **(Low)** `rendersBothFormatsForAWholeOrganizationSchedule` did not
     assert the asset scope is tenant-bounded. It now reads
     `assetIdsOfOrganization` (a sibling of `assetIdsOfLocation` on the
     `F3.5a` fixtures, after the render) for ESKOM and PHEWB and asserts
     every rendered id is ESKOM's and none is PHEWB's, with both sets
     non-empty as positive controls.
   - **(Prose)** `tests/f4.24-worker-imports-no-api-loop.test.ts` said
     `WORKER_LEAVES` "names the nine files" against a list of twenty-six;
     the sentence now carries no number and a rule-1 row pins
     `WORKER_LEAVES.length` to 26. `report-period.ts` and its spec said a
     DST-gap wall time resolves to "the first instant after the gap"; the
     code returns the naive instant minus the pre-gap offset — the wall
     clock carried forward by the gap's width (London 01:30 → 02:30 BST,
     `01:30Z`), not 02:00 BST — and both now say so; the gap branch's local
     was renamed `preGapOffset` (the minimum candidate is the pre-gap
     offset, since spring-forward raises it).

   **Recorded, not changed.** A same-day cadence or run-time change can
   lose one period: the render's idempotency key is `(schedule_id,
   period_end, format)` and the `jobId` is `<scheduleId>_<periodEnd>`, so
   a daily → weekly PATCH on a Monday morning yields the same `period_end`
   as the daily report already written and the weekly report is skipped
   as existing. Whether `period_start` joins the key is the owner's
   decision (a later row). `report-render.service.ts`'s `format === "pdf"
   ? energyPdf : energyXlsx` is non-exhaustive for a third format,
   consistent with the on-demand sibling.
