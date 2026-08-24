# ADR 0045 — A non-superuser table owner, so `FORCE ROW LEVEL SECURITY` binds

## Status

**Accepted** — 2026-08-24, by the repository owner, at the start of `E7.1` and
**before any implementation code**. Six decisions, ruled in three passes: the
direction (demote the owner rather than record `FORCE` as decorative) first,
then the mechanism, after this document derived that migration `0039` blocks
the obvious path.

**One decision changed between the owner's ruling and this draft, and was put
back to the owner rather than changed quietly** — the same handling ADR 0043's
decision 6 received on the same day. The mechanism as ruled read *"`migrate`
and seed move to `bms_owner`"*. Drafting found that `migrate` cannot: a fresh
deployment replays the whole chain, and `0039:33` needs `SUPERUSER` while
`0000` needs the Timescale extension already present. The finding was returned
to the owner and **decision 3 was confirmed in its amended form** — `migrate`
keeps the superuser connection and issues `SET ROLE bms_owner`. `db:seed`,
`apps/sim` and `apps/ingest` move as originally ruled.

This is a **new ADR rather than an amendment to
[ADR 0043](0043-multi-tenant-architecture.md)**, ruled at the same gate. Role
provisioning is a deployment decision with its own future amendment surface —
managed Postgres, secret handling, the ordering of `db:roles` against
`db:migrate` — separable from ADR 0043's decisions about the tenant boundary.
It follows the precedent of
[ADR 0044](0044-fail-closed-unprovisioned-admin-claim.md), which was split out
of ADR 0043's closing review for the same reason.

It does **not** re-open ADR 0043. Decisions 1–7 and 9–13 are untouched.
Decision 8 is **completed**, not amended: this ADR supplies the missing half
that makes its `FORCE ROW LEVEL SECURITY` clause mean something. The read-path
half of `E7.1`'s ADR work is
[ADR 0043 Amendment 3](0043-multi-tenant-architecture.md#amendment-3-2026-08-24--the-read-path-is-hybrid-by-table-ruled-at-the-e71-gate),
ruled at the same gate and recorded there because it amends decision 12.

It adds no npm package, so AGENTS.md §9.4 does not apply. It **is** a §10
promotion: AGENTS.md's §2 deployment description and `docs/local-setup.md`
both assert that `bms_app` is the single owner identity, and this falsifies it.
The `chore(agents):` sweep is listed at the end and lands **after** `E7.1a`,
per §10.1.

**Amended once, before any implementation code** —
[Amendment 1](#amendment-1-2026-08-24--decision-4s-mechanism-does-not-execute-and-decision-3s-set-role-moves-into-the-migration-files),
ruled 2026-08-24 at the start of `E7.1a` after planning measured decision 4's
`REASSIGN OWNED BY` against the running engine and found it errors on every
deployment shape. The direction and the end state are unchanged; two mechanisms
are substituted and one Context claim is retracted. Read the amendment before
the Decision section — decisions 3 and 4 are stated there in their superseded
form.

**Amended a second time during implementation** —
[Amendment 2](#amendment-2-2026-08-24--a-sixth-role-bms_rollup-owns-the-continuous-aggregates),
ruled 2026-08-24 after verifying decision 4 against the running stack exposed a
pre-existing defect this change unmasked: `refresh_continuous_aggregate`
requires ownership, and the API has held none since `F4.16`. It adds decision 7
and a sixth role, `bms_rollup`. Decisions 1–6 are untouched.

## Context

### `FORCE ROW LEVEL SECURITY` is a no-op against the owner this repo actually runs

ADR 0043 decision 8 requires that every tenant table be created with
`ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`, *"so a future
owner-role connection does not silently defeat the policy."*
[Amendment 1](0043-multi-tenant-architecture.md#force-row-level-security-lands-in-e71-not-in-f416)
deferred `FORCE` from `F4.16` into `E7.1`, and then recorded — flagged by
`F4.16`'s closing review, by `security-reviewer` and
`agents-compliance-reviewer` independently and with the same finding — that
the stated purpose is contradicted by ADR 0043's own Context: *"a superuser
bypasses it even then."*

`bms_app` is a superuser everywhere this repository runs, and this was verified
rather than assumed:

- `docker-compose.yml:18` sets `POSTGRES_USER: bms_app`. The official Postgres
  image passes that value to `initdb --username`, so `bms_app` **is** the
  bootstrap superuser and no `postgres` role exists in the container at all.
- `.github/workflows/ci.yml:25` sets the same value for the CI service
  container, for the same reason.
- `docs/local-setup.md:152` instructs a native or WSL installation to run
  `CREATE ROLE bms_app WITH LOGIN SUPERUSER`, and `:143` states plainly that
  *"`bms_app` needs `SUPERUSER`, not just ownership."*

So `FORCE` as ADR 0043 planned it would have shipped a control that the one
connection it names is exempt from. `F4.16` was right to leave it alone —
nothing that item claimed depended on it — and right to hand the design
question here rather than paper over it with a one-line addition.

### Two statements, not one, require the superuser attribute

Only two things in this repository need `SUPERUSER` today. Separating them is
what makes a demotion tractable:

- **`CREATE EXTENSION timescaledb`** — `packages/db/docker-init/001-bms-init.sql`
  in Compose, and `.github/workflows/ci.yml:94` in CI. TimescaleDB is not a
  trusted extension, so this is superuser-only and stays that way.
- **`ALTER ROLE bms_fleet BYPASSRLS`** — `packages/db/drizzle/0039_tenant_roles_and_grants.sql:33`.
  PostgreSQL restricts `BYPASSRLS` to superusers unconditionally; `CREATEROLE`
  does not reach it, in any version this project targets.

`CREATE ROLE` itself needs only `CREATEROLE`. Every other statement in `0039`
— the `GRANT`s, the `REVOKE`s, the column-level grants on `bms.users`, the
default privileges — needs only ownership.

### Migration `0039` is the obstacle, and it is already applied

The obvious demotion — point `POSTGRES_USER` at `postgres`, make `bms_app` a
plain owner — fails on a fresh deployment. `0039:33` is **unconditional**: its
`CREATE ROLE` calls sit behind a `DO $$ ... IF NOT EXISTS` guard, but the three
`ALTER ROLE` statements below them do not. PostgreSQL checks the privilege
before the no-op, so `ALTER ROLE bms_fleet BYPASSRLS` fails as a non-superuser
**even when `bms_fleet` already holds the attribute**. Running `pnpm db:roles`
first does not rescue it.

`0039` cannot simply be edited. `packages/db/src/migrate.ts` uses the stock
`drizzle-orm/node-postgres` migrator, which keys the journal by **file hash**;
changing the file makes drizzle treat it as unapplied and re-run it on every
existing deployment. AGENTS.md §4 says forward-only, and this is exactly the
case that rule exists for.

### The ordering is also wrong for a fresh non-superuser deployment

`docker-compose.yml:87` runs `pnpm db:migrate && pnpm db:seed && pnpm --filter
@bms/db roles`, and the comment above it at `:82` says `db:roles` *"must run
once after every migrate"*. CI (`.github/workflows/ci.yml:97,111`) never runs
`db:roles` at all — it runs migrate and seed only, which is why CI has not
noticed. Once role provisioning carries the superuser work, it must run
**before** the migrations that depend on those roles existing, not after.

## Decision

1. **A new role `bms_owner` owns `bms` and `telemetry`, and it is not a
   superuser.** It is created `NOLOGIN` by the provisioning step of decision 2,
   given a password there, and it holds `CREATEROLE` on nothing. It is the
   identity `FORCE ROW LEVEL SECURITY` is designed to constrain, and after
   decision 4 it genuinely is constrained.

   *Rejected: pointing `POSTGRES_USER` at `postgres` and demoting `bms_app` in
   place.* It reaches the same end state and is tidier on paper, but it cannot
   get past `0039:33` without editing an applied migration (see the Context),
   and it silently rewrites the identity in five `DATABASE_URL`s, two compose
   healthchecks and the CI service block at once.

2. **`bms_app` keeps `SUPERUSER` and shrinks to a provisioning identity.** It
   runs `CREATE EXTENSION timescaledb`, it creates the four non-owner roles,
   and it sets `BYPASSRLS` on `bms_fleet`. It runs nothing else: not the API,
   not the migrations, not the seed, not the simulator, not the ingest worker.
   Its blast radius becomes one bootstrap script and one operational command.

   *Rejected: removing `SUPERUSER` from `bms_app` entirely.* `CREATE EXTENSION
   timescaledb` and `ALTER ROLE ... BYPASSRLS` both require it and neither can
   be delegated. Something in this deployment must be a superuser; the decision
   available is what that something is allowed to touch, not whether it exists.

3. **`pnpm db:seed`, `apps/sim` and `apps/ingest` move from `bms_app` to
   `bms_owner`. `migrate` does not, and it issues `SET ROLE bms_owner`
   instead.** `DATABASE_URL` keeps its name and changes its value to the
   `bms_owner` connection. `DATABASE_URL_AUTH`, `DATABASE_URL_TENANT` and
   `DATABASE_URL_FLEET` are untouched — `F4.16` already pointed the API at the
   three non-owner roles, and this ADR does not move them.

   A new `DATABASE_URL_SUPERUSER` carries the `bms_app` connection. It is read
   by the provisioning step of decision 2 and by `packages/db/src/migrate.ts`,
   and by nothing else. It is absent from the `api` and `api-replica` service
   environments, exactly as `DATABASE_URL` already is
   (`docker-compose.yml:104`).

   **Why `migrate` keeps the superuser connection.** The historical migration
   chain is not replayable as `bms_owner`: `0039:33` needs `SUPERUSER` and
   `0000` needs the Timescale extension already present. A fresh deployment
   replays every file, so the runner must be able to execute them. The chain is
   history and cannot be rewritten under §4.

   **Why that does not hand ownership back to `bms_app`.** `migrate.ts` issues
   `SET ROLE bms_owner` on each connection immediately after connecting, so
   every object a migration creates is owned by `bms_owner` and every statement
   it runs is evaluated as `bms_owner` — including row-level security, because
   PostgreSQL evaluates policies and the `BYPASSRLS` attribute against the
   *current* role, which `SET ROLE` changes. A migration that genuinely needs
   the superuser attribute issues `RESET ROLE` explicitly and says why in a
   comment. After this ADR there should be none; decision 6 makes that a rule.

   *Rejected: running the whole chain as `bms_app` with no `SET ROLE`.* Every
   new table would then be owned by a superuser and `FORCE` would be decorative
   again for anything created after `E7.1a` — the exact defect this ADR exists
   to remove, re-introduced on a six-month delay.

   **`drizzle.__drizzle_migrations` is the known hazard in this decision, and
   `E7.1a` must sequence it rather than discover it.** The migrator writes a
   journal row on every run, and under `SET ROLE` that write happens as
   `bms_owner` — which holds no grant on the `drizzle` schema, because `0039`'s
   grants cover `bms` and `telemetry` only. On a fresh deployment the migrator
   also *creates* that table, so it would be owned by `bms_owner`; on an
   existing deployment it is owned by `bms_app` and the write fails. Whether
   the `SET ROLE` is issued before or after the migrator's own bookkeeping, and
   what grant the `drizzle` schema needs, is `E7.1a`'s first task and is inside
   its `5–7`.

4. **Ownership transfers in a new forward-only migration, and no committed
   migration is edited.** `REASSIGN OWNED BY bms_app TO bms_owner` moves every
   existing table, sequence, view and materialized view in one statement, and
   the two schemas move with `ALTER SCHEMA ... OWNER TO`.

   This migration is the **one authorized `RESET ROLE`** under decision 3:
   `REASSIGN OWNED` requires the executing role to be a superuser or a member
   of both roles, and `bms_owner` is neither. The file opens with `RESET ROLE`,
   carries a comment naming this ADR, and is the last thing `bms_app` does to
   the schema as itself. `0039` and `0040` stay byte-identical, so the drizzle
   journal is untouched and every existing deployment sees exactly one new
   migration rather than three re-applications.

   **The Timescale objects are the risk here and must be verified, not
   assumed.** ADR 0023's four continuous aggregates and ADR 0024's compression
   and retention policies attach background jobs to an owner. `REASSIGN OWNED`
   moves the continuous aggregates' materialization hypertables, because those
   are catalog objects — but **`_timescaledb_config.bgw_job.owner` is a data
   column, not catalog ownership, so `REASSIGN OWNED` does not rewrite it** and
   the ADR 0024 policies keep running as `bms_app`. That is benign: `bms_app`
   is still a superuser under decision 2 and the jobs still write. It is named
   here because it is the specific row to query — `select id, proc_name, owner
   from _timescaledb_config.bgw_job` — and querying it is the difference
   between this decision being verified and being assumed. If a job must move,
   `alter_job` is the remedy. This is the one place this decision can fail
   quietly: a retention policy that stops running looks like nothing at all for
   days.

5. **`FORCE ROW LEVEL SECURITY` lands on every tenant table, and the seed
   splits per organization.** With decisions 1–4 the owner is no longer exempt,
   so `FORCE` does the job decision 8 named. `pnpm db:seed` then runs as a
   constrained owner, and its bulk inserts that span organizations must be
   split into per-organization transactions that each `SET LOCAL
   app.current_organization`. This is the seed restructuring ADR 0043
   Amendment 1 predicted; it is real in this world and would have been
   unnecessary in the one where `bms_app` stayed a superuser.

6. **`pnpm db:roles` runs before `pnpm db:migrate`, and CI runs it too.**
   It absorbs `CREATE ROLE` and `ALTER ROLE ... BYPASSRLS` from `0039` and
   keeps its present job of setting `LOGIN` and passwords from the environment.
   `docker-compose.yml:87` and the comment at `:82` are corrected, and
   `.github/workflows/ci.yml` gains the step it never had.

   `0039`'s own copies of those statements stay in the file, byte-identical,
   and stay applied on existing deployments — they are idempotent and simply
   never re-run. On a fresh deployment the roles already exist by the time
   `0039` executes, its `DO $$` guard skips the creates, and its three
   unconditional `ALTER ROLE` statements re-assert attributes that are already
   set. They succeed because decision 3 keeps `migrate` on the superuser
   connection; `0039` is one of the two historical files that is the reason it
   does.

   **Every migration authored after this ADR must run as `bms_owner`** — that
   is, under the `SET ROLE` of decision 3, with no `RESET ROLE`. A migration
   that cannot belongs in `db:roles` instead. This is a §4 rule and it is in
   the promotion list below.

## Consequences

- **The deployment gains a fifth Postgres role**: `bms_app` (superuser,
  provisioning only), `bms_owner` (owner, non-superuser), `bms_tenant`,
  `bms_fleet`, `bms_auth`. `docker-compose.yml` gains one connection string and
  changes the value of `DATABASE_URL` in four services.
- **`FORCE` stops being decorative, which is the entire point of this ADR.**
  After `E7.1a` a query on a tenant table under `DATABASE_URL` returns nothing
  without a tenant GUC, where today it returns everything. Any script, test
  fixture or operational runbook that leaned on the owner seeing all rows will
  break, and that breakage is the evidence the decision worked.
- **The seed becomes organization-aware.** It is the largest single piece of
  `E7.1a` and the one most likely to be under-estimated: `seed.ts`'s call order
  is described in its own header as load-bearing, and several sibling modules
  insert bulk arrays spanning both seeded organizations.
- **Managed Postgres gets closer but is not solved here.**
  `docs/local-setup.md:279-290` records that `0039` fails on RDS and Cloud SQL
  because neither grants `SUPERUSER`. This ADR narrows the superuser surface to
  one provisioning script, which is the shape a managed offering can satisfy
  through `rds_superuser` or `cloudsqlsuperuser` — but **this is not verified
  against either provider** and no claim is made that it works. It is a
  follow-up, and it belongs to `E7.3` (on-prem/hybrid packaging), not here.
- **CI grows a step it has never run.** `db:roles` in CI is new coverage, and
  it means a defect in role provisioning now fails the build instead of
  appearing first in Compose.
- **`bms_app` remains a superuser.** This ADR reduces what it does; it does not
  remove the account. A reader looking for "no superuser in the deployment"
  will not find it, and should not: decision 2 explains why that is not
  available.

## Promotion follow-ups (AGENTS.md §10, owed in a separate `chore(agents):` PR)

Per §10.1 these land **after `E7.1a`**, not with this ADR, and **not** batched
with the still-owed ADR 0043 or ADR 0033 sweeps.

- **AGENTS.md §2** — the deployment/roles description names `bms_app` as the
  application owner. It becomes ~~five~~ **six** roles (Amendment 2 adds
  `bms_rollup`) with `bms_owner` as the owner and `bms_app` as
  provisioning-only. Name what `bms_rollup` is for, and that `bms_tenant` and
  `bms_fleet` can assume it — that is the one privilege widening in this ADR.
- **AGENTS.md §4** — one new rule: a new migration is authored for `bms_owner`
  and must not require `SUPERUSER`. Anything that does belongs in `db:roles`.
- **`docs/local-setup.md`** — `:143`, `:152` and `:279-294` all instruct the
  reader to make `bms_app` a superuser and stop there. They need the second
  role and the new command order.
- ~~**`docker-compose.yml:82`** — the comment stating `db:roles` runs *after*
  migrate is falsified by decision 6.~~ **Moved into the feature PR by
  [Amendment 1](#amendment-1-2026-08-24--decision-4s-mechanism-does-not-execute-and-decision-3s-set-role-moves-into-the-migration-files),
  ruled 2026-08-24.** §9.10 governs AGENTS.md softening and roadmap mirrors; a
  stale code comment sitting on the line immediately above one the change edits
  is a defect in that change, not promotion debt. Shipping a comment that
  contradicts the command directly beneath it is worse than either bucket.
- **Verify rather than invent:** whether `docs/AGENTS.production.md` asserts
  anything about the owner identity, and whether AGENTS.md §6 contains any line
  this narrows. Five ADR sweeps running have had incomplete target lists; audit
  the files, do not copy this list.

## Amendment 1 (2026-08-24) — decision 4's mechanism does not execute, and decision 3's `SET ROLE` moves into the migration files

**Ruled by the repository owner on 2026-08-24, at the start of `E7.1a` and
before any implementation code**, after the step-3 plan measured this ADR's own
mechanisms against the running engine (TimescaleDB 2.29.1-pg16) rather than
assuming them. Three rulings and one retraction. **The direction is unchanged
and the end state is unchanged**: `bms_owner` owns `bms` and `telemetry`,
`bms_app` shrinks to a provisioning identity, and `FORCE ROW LEVEL SECURITY`
binds. Decisions 1, 2 and 5 are untouched.

### 1. `REASSIGN OWNED BY bms_app` errors, and the statement is replaced

Decision 4 moves ownership with `REASSIGN OWNED BY bms_app TO bms_owner`. It
does not run. Measured inside a rolled-back transaction:

```
REASSIGN OWNED BY bms_app TO probe_owner;
ERROR:  cannot reassign ownership of objects owned by role bms_app
        because they are required by the database system
```

The cause is the same fact this ADR's Context already establishes for a
different purpose. `POSTGRES_USER: bms_app` makes `bms_app` the **initdb
bootstrap superuser**, so `select oid from pg_roles where rolname = 'bms_app'`
returns **10** — a *pinned* role. PostgreSQL records no `pg_shdepend` owner
rows against a pinned role (`select count(*) from pg_shdepend where refobjid =
'bms_app'::regrole and deptype = 'o'` returns **0**, against 166 rows total),
and `REASSIGN OWNED` refuses outright rather than no-opping. This is not
version-specific and not fixable by ordering.

**Ruled: the end state is reached by enumerated `ALTER … OWNER TO` statements
instead.** Every statement below was verified on the live engine before this
amendment was written:

| Statement | Result |
|---|---|
| `ALTER SCHEMA bms/telemetry OWNER TO` | works |
| `ALTER TABLE …` over 36 `bms` + 1 `telemetry` table | works |
| `ALTER TABLE telemetry.point_values OWNER TO` | all 6 chunks follow, **including the compressed one** |
| `ALTER VIEW telemetry.point_values_1m OWNER TO` | **rejected** — `cannot alter continuous aggregate using ALTER VIEW` |
| `ALTER MATERIALIZED VIEW telemetry.point_values_1m OWNER TO` | works; materialization hypertable, its 3 indexes and its chunk follow |
| after tables + all four continuous aggregates | **10/10 chunks** on the new owner |

The `ALTER VIEW` rejection is the reason this is an enumerated loop rather than
a one-line substitution: ADR 0023's four continuous aggregates are `relkind =
'v'` and need `ALTER MATERIALIZED VIEW`, so a generic view loop fails on all
four. The migration therefore drives the continuous aggregates from
`timescaledb_information.continuous_aggregates` and **excludes** them from its
ordinary view loop.

Measured inventory, so a later reader knows what the loop covers and what it
found: `bms` 36 tables, `telemetry` 1 table + 4 continuous aggregates, and
**0 sequences, 0 functions, 0 composite types, domains or enums** in either
schema. The sequence loop ships anyway and stays empty — `0039`'s own comment
makes exactly this argument, and a serial column added later would otherwise be
owned by nobody the loop reaches.

*Rejected again, for the second time and for the original reason: pointing
`POSTGRES_USER` at `postgres`.* It would make `REASSIGN OWNED` work, and
decision 1 already rejected it because `0039:33` still needs `SUPERUSER` on a
fresh replay. Discovering a second problem with `REASSIGN OWNED` is not a
reason to re-open a rejection that never rested on it.

### 2. Decision 3's `SET ROLE` moves from the connection into the migration files

Decision 3 has `migrate.ts` issue `SET ROLE bms_owner` on each connection
immediately after connecting. Planning found this forces a grant the ADR does
not describe. Drizzle's migrator issues, on **every** run and before any
migration file executes:

```
CREATE SCHEMA IF NOT EXISTS drizzle
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (…)
select id, hash, created_at from drizzle.__drizzle_migrations …
```

Under a connect-time `SET ROLE` that preamble runs as `bms_owner`, and
`CREATE SCHEMA` requires `CREATE` on the database. Verified:

```
SET ROLE probe_owner;  CREATE SCHEMA IF NOT EXISTS drizzle;
ERROR:  permission denied for database bms
```

Pre-creating the schema does not rescue it — the database ACL check runs
**before** the `IF NOT EXISTS` existence check, so the error is raised on every
future run, not only the first.

**Ruled: each migration file authored after this ADR opens with `SET ROLE
bms_owner` and ends with `RESET ROLE`, and `migrate.ts` issues neither.** The
drizzle preamble and the journal write stay as `bms_app`, so **no new grant is
needed** — not `CREATE ON DATABASE`, not a `drizzle`-schema grant, and the
`drizzle.__drizzle_migrations` hazard decision 3 names as `E7.1a`'s first task
is dissolved rather than solved. `migrate.ts` changes only its connection
string, to `DATABASE_URL_SUPERUSER`, and its header records that the absent
`SET ROLE` is deliberate so a later reader does not add one back.

This also removes a failure mode the connect-time form carries. `pg.Pool`'s
`connect` handler is **not awaited** before the pool hands the client out, so a
`pool.on('connect', …)` implementation would let some migrations run as
`bms_app` and leave their objects superuser-owned, silently — the exact defect
this ADR exists to remove, re-introduced by its own remedy.

Decision 6's rule is unchanged in substance and stronger in form: every
migration authored after this ADR runs as `bms_owner`. It is now mechanically
enforceable, and `E7.1a` gates it with a repository invariant asserting that
every `packages/db/drizzle/*.sql` newer than the ownership migration which
issues `SET ROLE` also issues `RESET ROLE`. A forgotten `RESET ROLE` leaks past
`COMMIT` into the session — verified — so reviewer attention is not an adequate
gate for it.

### 3. Decision 4's "one authorized `RESET ROLE`" clause is vestigial

That clause exists only because decision 3 put a `SET ROLE` on the connection,
which the ownership migration then had to escape. With ruling 2 there is no
connection-level `SET ROLE` to escape, so the ownership migration needs no
`RESET ROLE` at its head. It runs as `bms_app` by default, which is correct and
is what `ALTER … OWNER TO` on catalog objects requires.

The clause is **not** deleted, because its intent survives inverted: the
ownership migration is still the last thing `bms_app` does to the schema as
itself, and it still says so in a comment naming this ADR. What changes is that
the file now issues `SET ROLE bms_owner` *before* the five `FORCE ROW LEVEL
SECURITY` statements — which proves, in the migration itself, that the
constrained owner can issue them on tables it now owns — and `RESET ROLE`
after.

### 4. Retraction: CI already runs `db:roles`

This ADR's Context states that CI *"never runs `db:roles` at all"*, and
decision 6 says CI *"gains the step it never had"*. **Both are false.**
`.github/workflows/ci.yml:104` runs `pnpm --filter @bms/db roles` today. The
claim was true when the ADR's Context was researched and was falsified the same
day by PR [#151](https://github.com/GhochangFu/EMS/pull/151), which landed
`F4.16`.

Decision 6's *intent* is untouched and the ordering problem is real: CI runs
schemas → migrate (`:97`) → roles (`:104`) → seed (`:111`), and once role
provisioning carries the superuser work it must run before the migrations that
depend on those roles existing. **The work is a reorder, not an addition**, and
the Consequences bullet claiming CI *"grows a step it has never run"* is
withdrawn with it. Recorded rather than quietly corrected, because the ADR used
the missing step as evidence for why the ordering defect had gone unnoticed,
and that reasoning no longer holds.

### 5. `docker-compose.yml:82` moves from the sweep into the feature PR

Ruled at the same gate; the promotion follow-up list above is struck through
accordingly. See that entry for the reasoning.

### Effort

`E7.1a` moves **`5–7` → `7–9`**, and `docs/BACKLOG.md` is updated with it. The
amendment itself is a gate rather than effort — it does not move the number.
Three measured findings do, none of them visible when the item was booked: the
catalog-driven ownership loop needs a real continuous-aggregate branch, because
`ALTER VIEW` is *rejected* on all four rather than merely inelegant; the seed
rework spans **8 write sites and 11 read sites** across eight modules, with one
cleanup that becomes a silent no-op and a cross-organization verifier that must
be redesigned rather than wrapped; and five API integration fixture suites
build their pool from the owner `DATABASE_URL` against `bms.asset_templates`
and `bms.locations`, a surface the booked figure did not carry at all.

*Superseded by [Amendment 2](#amendment-2-2026-08-24--a-sixth-role-bms_rollup-owns-the-continuous-aggregates): `7–9` → `9–11`.*

## Amendment 2 (2026-08-24) — a sixth role, `bms_rollup`, owns the continuous aggregates

**Ruled by the repository owner on 2026-08-24, during `E7.1a`'s implementation**,
after verifying decision 4 against the running stack exposed a **pre-existing
defect that this ADR's own change unmasked**. Adds decision 7. Decisions 1–6 and
Amendment 1 are untouched.

### The defect, and why it is fixed here rather than filed

`refresh_continuous_aggregate` requires **ownership** of the aggregate, and no
`GRANT` substitutes for it. Since `F4.16` (ADR 0043 decision 8) the API connects
as `bms_tenant`/`bms_fleet`, which own nothing — so the post-commit refresh in
`TelemetryWriteService` (`:430`) and `CalcWriteService` (`:194`) has been failing
with

```
ERROR:  must be owner of continuous aggregate "point_values_1m"
```

and being swallowed as a `WARN` ever since. Its integration test passed only
because the test pool was the `bms_app` superuser; `E7.1a` exposed it by making
that pool non-superuser. It was put to the owner as a candidate for its own
backlog row, and the owner ruled it into this item.

**It is a correctness defect, not a latency one, and that was measured rather
than argued.** The refresh policies carry bounded `start_offset`s — 3 h, 12 h,
3 days, 30 days — and real-time aggregation (`materialized_only = false`) covers
only data not yet materialised. A reading written outside its level's window is
therefore *permanently* absent from that rollup. A backdated import is the
ordinary way to reach that state.

### 7. `bms_rollup` owns the four aggregates and nothing else

Two mechanisms were tried and rejected before this one, both on evidence:

- ***Rejected: a `SECURITY DEFINER` wrapper owned by `bms_owner`.*** It does not
  exist as an option. TimescaleDB refuses:
  `refresh_continuous_aggregate() cannot be executed from a function`.
- ***Rejected: `GRANT bms_owner TO bms_tenant, bms_fleet`.*** Verified to work,
  and far too wide — `bms_owner` owns both entire schemas, so it hands the API
  full DDL and undoes the separation this ADR exists to build.

**Ruled:** a sixth role, `bms_rollup`, owns the four ADR 0023 continuous
aggregates and nothing else. `pnpm db:roles` creates it and grants membership to
`bms_owner` (for `pnpm db:refresh-aggregates`), `bms_tenant` and `bms_fleet` (for
the post-commit refresh). `refreshAggregatesFrom` checks out one connection and
issues `SET ROLE bms_rollup` … `RESET ROLE`.

**`SET ROLE`, not `SET LOCAL ROLE`, and that is forced rather than chosen.**
`refresh_continuous_aggregate` cannot run inside a transaction block, so there is
no transaction for a `LOCAL` setting to be scoped to. The connection is therefore
checked out explicitly and reset in a `finally`, and a connection whose reset
fails is destroyed rather than returned to the pool — a pooled connection handed
back still carrying a role is the defect ADR 0043 decision 10 exists to prevent.

**`bms_rollup` holds `LOGIN` and no password. Both halves are load-bearing, and
the first was found by measurement, not by reasoning.** TimescaleDB's background
workers connect *as the job owner*, and the four refresh policies plus the
aggregates' own compression and retention jobs follow the aggregates to this
role. Without `LOGIN` every one of them dies with
`FATAL: role "bms_rollup" is not permitted to log in` — and
`timescaledb_information.job_errors` records only the generic
*"failed to execute job"*, so **the real message appears solely in the server
log**. That is precisely the quiet failure decision 4 warns about: a retention
policy that stops running looks like nothing at all for days. It was caught
because the verification step queried the jobs instead of assuming them.

No password is set and the role is deliberately absent from `roles.ts`'s
`ROLE_ENV`: a background worker authenticates through none, while under
`scram-sha-256` a network client cannot authenticate as a role that has none. The
attribute buys the scheduler its connection and buys an attacker nothing.

**Residual risk, stated rather than hidden:** a role that can refresh an
aggregate can also drop it, and `bms_tenant`/`bms_fleet` can now assume it. That
is bounded next to the `DELETE` those roles already hold on every table in both
schemas (`0039`), and it is much narrower than the rejected `bms_owner` grant —
but it is a real widening of the API's reach and a reviewer should see it named.

### Migration `0042`, not an edit to `0041`

`0041` was already committed, so the ownership move lands in a new file under
AGENTS.md §4's forward-only rule. The repository's own pre-commit hook refused
the edit, which is the rule working as intended rather than an inconvenience.

### Effort

`E7.1a` moves **`7–9` → `9–11`**. Decision 7 is a role, a migration, a change to
`refreshAggregatesFrom`, and the `LOGIN` finding above — none of it in the plan,
all of it downstream of one defect that only became visible once the owner
stopped being a superuser.
