# ADR 0021 — Audit read API and export (`F4.14`)

## Status

**Accepted (2026-08-09).** Backlog item `F4.14` (Wave 1, P1). Drafted and
accepted the same day by the repo owner at the AGENTS.md §10 gate.

The open question below — whether audit reads are themselves audited — was
**not** settled by that acceptance and stays open for `F4.15`/`F4.19`.

`0020` stays reserved for the E8.1 encryption-at-rest retro, as `BACKLOG.md` §5
and ADR 0019's numbering note both record. This ADR takes `0021` so that
reservation — and `E5.1`'s `0022` — are undisturbed.

## Context

`bms.audit_log` (`packages/db/src/schema/bms-schema.ts:514`) has been written
since ADR 0009 and **has never been readable**. There is no audit controller.
Rows arrive across 43 distinct `action` values spanning master data (`master.*`),
rules, alarms, work orders and maintenance.

**Corrected 2026-08-09 (security review).** An earlier draft of this ADR said
"every row goes in through one writer, `MasterDataAuditService.write()`". That
is false and the error matters, because decision 6's standing obligation was
scoped to it. There are **15** `insert(auditLog)` sites; **14 bypass** that
writer — `alarms.service.ts`, `maintenance.service.ts`, `rules.service.ts` and
`work-orders.service.ts`. All 14 were inspected: each writes small hand-picked
objects (codes, statuses, ids, `actorEmail`), no secrets. So there is no leak
today, but **decision 6 applies to all 15 sites, not to one writer.**

An append-only audit that nobody can read satisfies no audit requirement. It
also means the compliance surface `F4.19` and the tamper-evidence work `F4.15`
both build on a table whose contents have never been inspected in the product.

`F4.14` is P1, Wave 1, and lists no dependencies. It is chosen now because it is
**purely additive**: an existing, already-populated table gains read endpoints.
No schema change, no migration lock, no new npm package.

Two facts constrain the design and are the reason this ADR exists rather than a
straight build:

1. **`audit_log` has no tenancy column.** There is no `organization_id`. A row
   identifies its subject only as `entity_type` + `entity_id`, so "which
   organisation does this row belong to" is answerable only by joining
   per-entity-type — and is *unanswerable* for a row whose entity was since
   deleted. The master-data scope predicates in §4.7
   (`writableOrganizationIds` / `writableLocationIds`) therefore cannot be
   applied to this table as it stands.
2. **`payload` stores the verbatim request body.** **Twelve** call sites pass
   `payload: body` — six modules (assets, asset-points, locations,
   organizations, point-keys, RTUs) x create and update. An earlier draft said
   ten; the count is what a future reviewer checks against, so it is corrected
   here rather than left to be re-derived. The coupling is standing: any future field
   added to an audited request body becomes readable through this API by
   construction. `E8.3` is the same failure mode discovered late.

## Decision

1. **Read access is restricted to the global admin** — the role whose
   `writableOrganizationIds` is `null`. Scoped audit reads for
   `organization_admin`, `location_admin` and `asset_group_admin` are
   **deferred**, not silently omitted; see Consequences. Resolve the role from
   `bms.users`, never from the JWT claim (§4.7).

2. **Two endpoints**, in a new module at **`apps/api/src/admin/audit/`**,
   alongside the writer and under the existing `@Controller("admin/<thing>")`
   convention:

   - `GET /api/v1/admin/audit` — list, newest first.
   - `GET /api/v1/admin/audit/export` — same filters, file response.

   The module sits under `src/admin/` rather than at top level because the
   writer, the route prefix and the global-admin gate are all already there.

3. **Filters**, all optional and Zod-validated, on both endpoints:
   `action` (exact), `entityType` (exact), `entityId` (uuid), `actorId` (uuid),
   `from` / `to` (ISO timestamps). Unknown query keys are rejected — `.strict()`,
   matching `onboarding.schema.ts` and ADR 0019's envelope.

4. **Pagination is offset-based** (`limit` ≤ 200, default 50; `offset` ≥ 0), and
   the response carries a `total`. Cursor pagination is `F4.22` and is
   deliberately not pre-empted here: the response shape adds a cursor field
   without removing anything when `F4.22` lands.

5. **Export is CSV and XLSX only**, via the `xlsx` package already in
   `apps/api/package.json`. `format` is `csv | xlsx`, default `csv`. **A time
   window is required** on export (`from` and `to` both present, span ≤ 366
   days) and the result is capped at **50,000 rows**; exceeding the cap is a
   `400` naming the count, never a truncated file. An export that silently
   drops rows is worse than one that refuses.

   **Measured 2026-08-09 and confirmed, not lowered.** 50,000 synthetic rows
   carrying a realistic `payload: body` for an asset create produced a 42.6 MB
   workbook in 2.47 s, using 144 MB `heapUsed` and 502 MB RSS against Node's
   2,240 MB default heap limit. `docker-compose.yml` sets no memory limit on the
   `api` service, so nothing constrains this below the host.

   **The residual risk is concurrency, not size.** Each in-flight export costs
   roughly half a gigabyte of RSS, so several at once is the failure mode rather
   than one large one. Bounding concurrent exports belongs with `F4.17` (rate
   limiting) and is **not** solved here.

   The cap lives in `audit.limits.ts` with an injectable ceiling, so the refusal
   is exercised at a cap of `2` in `audit.limits.spec.ts` rather than only at
   50,000 — a rule with no caller in a test is not verified by being reviewed.

6. **`payload` is returned verbatim** to the global admin. This rests on a
   measurement, not an assumption: on 2026-08-09 the Zod body schemas behind all
   twelve `payload: body` call sites — `assets`, `asset-points`, `locations`,
   `organizations`, `point-keys`, `rtus` (create and update each) — were checked
   for credential, password, secret and token fields, and none admits one. The
   onboarding schema carries `credentialsSet: boolean`, a flag rather than a
   secret.

   **That check is the standing obligation, not a one-off:** any change to a
   `payload: body` call site, or to a schema behind one, must re-run it. Adding
   a secret-bearing field to an audited request body creates an audit-read
   exposure. A redaction pass over `payload` is rejected *for now* because there
   is nothing to redact, and a redactor with no known secret to remove encodes a
   guess about which key names matter.

7. **`F4.14` adds no columns, no triggers, no migration.** `actor_id` is
   nullable and stays so; rows whose actor lookup failed render as `null`, not
   as a fabricated identity. The response DTO is additive-only so `F4.15`'s
   hash-chain columns can appear later without a breaking change.

## Amendment 1 (2026-08-09) — the gate needs a provisioning check

Raised by the security review, **reproduced against a real database**, and fixed
before merge. Decision 1 as originally written was not sufficient, and this ADR's
own wording asserted a property the code did not have.

`AccessControlService.resolveDbUser` deliberately falls back to the **JWT claim**
when no `bms.users` row matches the token
(`apps/api/src/auth/access-control.service.ts` — the row-absent branch). In OIDC
mode — which is what `docker-compose.yml` runs and what the pilot uses — a
Keycloak principal holding the realm role `admin` who was never provisioned in
`bms.users` therefore resolves to `role: "admin"`, and
`writableOrganizationIds()` returns `null`.

Every other `/admin/*` endpoint constrains that with a second, scope-specific
check. **This endpoint's only control is the `null` scope**, so the fallback
handed the entire audit log — every organisation, every verbatim `payload`,
every actor email — to anyone the IdP called an admin. Sharper still: deleting
someone's `bms.users` row would have *escalated* them to global admin rather
than revoking them, because the row was the only thing constraining the claim.

**Decision 1 is amended:** `requireGlobalAdmin` first requires a matching
`bms.users` row and rejects when there is none, then requires the unrestricted
scope. The integration suite covers the unprovisioned-admin-claim case for both
endpoints; before the fix it failed with *"expected a rejection, but the call
succeeded"*.

**The fallback itself is unchanged and out of scope here.** It is pre-existing,
affects all of `/admin/*`, and is already recorded against `F4.10` in
`docs/BACKLOG.md` as belonging to its own ADR. This amendment only stops this
ADR's control from resting on it.

## Known gap — the row cap is not a byte cap

Also from the security review, and **not fixed here** because narrowing an
accepted cap is a change to what was gated, not an implementation detail.

Decision 5's 50,000-row measurement used a realistic asset-create payload. But
`meta: z.record(z.unknown())` on assets, locations, organizations and RTUs
accepts arbitrary nested JSON up to Express's 100 kB default body limit, and the
export materialises everything at once — row array, then per-row
`JSON.stringify`, then the whole CSV string or XLSX buffer. 50,000 rows of large
`meta` exceeds the heap the cap was validated against.

The chain is availability, not confidentiality, and it is not remote: a
master-data admin plants large `meta` across many writes, and the failure fires
later when a global admin runs an export. **Options are a byte budget alongside
the row cap, or streaming the CSV response.** Tracked as follow-up; the human
gate decides which, since either changes decision 5.

## Open question for the gate

**Should audit reads themselves be audited?** This ADR does **not** decide it.
The argument against is that a read-logging rule makes the table grow under
inspection and lets a reader inflate it; the argument for is that "who read the
audit log" is exactly what a compliance reviewer asks. It is a posture decision
about a compliance surface, and `F4.14`'s row covers a read API and an export —
not read-logging policy. If it is settled here, whoever approves a read API also
silently approves the answer. **Recommended: leave it open and let `F4.15` or
`F4.19` own it**, since both already own tamper-evidence and compliance.

## Dependencies

**None.** `xlsx` is already a dependency of `apps/api`; no `package.json`
change, so AGENTS.md §9.4 is not engaged.

## Consequences

- **Deferred: scoped audit reads.** `organization_admin` and below get nothing
  from this ADR. Closing that gap needs a tenancy anchor on `audit_log` —
  either an `organization_id` column populated by the writer (DDL, migration
  lock, and a backfill decision for existing rows, whose organisation is
  partly unrecoverable) or a per-`entity_type` resolver that must answer for
  deleted entities. **That is its own ADR**, and it should be written before
  anyone promises scoped audit in a client demo.
- **Deferred: `rules/preview` volume.** §4.7 notes every `rules/preview` call
  inserts a `rule_preview` row. Those rows will dominate any unfiltered list.
  This ADR does not filter them out — hiding rows by default in an audit tool is
  a worse default than a noisy one — but a UI built on this should default the
  `action` filter.
- **`F4.15` is unblocked** (it lists `F4.14`), and nothing here constrains its
  append-only trigger or nightly hash chain.
- **Standing review obligation** from decision 6: `payload: body` call sites are
  now a security surface.

## Promotion follow-ups (AGENTS.md §10, owed separately)

Not to be done in the feature PR — §9.10 puts rulebook edits in their own
`chore(agents):` change, and §10.1 allows one promotion per PR:

- **AGENTS.md** — §2 gains an *Audit read* row; §6's audit line softens; §4.7
  gains the global-admin read gate **including Amendment 1's provisioning
  check**, and the decision-6 obligation across all twelve `payload: body`
  sites. **§3 needs no new entry** — `apps/api/src/admin/` is already listed and
  the module sits inside it. One clarifying clause is also owed on §6's *"Report
  PDF/XLSX output … remain out of scope"* line: that is the reports domain, and
  audit export is ADR 0021 — without it the next reviewer reads a contradiction.
- **`docs/roadmap.md`** — mirror `F4.14` per §10 step 4.
- **`docs/BACKLOG.md`** — flip `F4.14` to `✅` only after tests pass, and record
  that `F4.15` is thereby unblocked.
