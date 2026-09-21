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
5. **Two `console.warn` lines per render are an accepted residual for
   now.** `createPdf` warns when no URL policy and no local-file policy is
   set. A deny-all local-file policy was tried and measured to throw
   `Access to local file denied` for `Helvetica-Bold`, because
   `PDFDocument.provideFont` validates every font not in the VFS, standard
   names included. A policy that allows exactly the four standard-14 names
   and denies everything else is the fail-closed shape and is owed to the
   step-5 review of `F3.5a`; until then the warning is noise, not a defect.
6. **The lockfile gained no native module** (decision 13, measured): no
   `optionalDependencies` with a `cpu`/`os` field under `pdfkit` or
   `fontkit`.
