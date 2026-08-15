# ADR 0030 — Shared API contracts, and the two packages F4.23 does not need

## Status

**Proposed** — 2026-08-15. Four questions are left open for the repository
owner at the §10 gate; they are collected at the end. Nothing is built until
they are answered.

`F4.23` is `⬜ → 🟡`. Its dependency `F4.20` is `✅` (ADR 0029, PR #61), so the
row is eligible; this ADR exists because *eligible* and *right as written* are
different things, and reading the row against `main` showed the difference.

## Context

`F4.23` (Wave 1, P2, effort 6–8 — the largest number left on the board) reads:

> `packages/contracts` (Zod), `packages/ui`, `telemetry-sdk`

It is the second dependency of `F4.6` (contract tests, API ↔ web), whose other
dependency `F4.4` is already `✅`. So `F4.23` is the only thing between `main`
and contract tests.

The row names three packages and says nothing else. It has no elaboration
anywhere in `docs/BACKLOG.md`, and the archived source it came from
(`docs/archive/pending-features.md:220`) adds only the parenthetical *"shared
Zod API contracts"*. **Where the three names actually come from is
`docs/AGENTS.production.md`** — the target-state tree at lines 89–90, and the
three rules at lines 126, 193 and 269. That file's own header says:

> **Status:** REFERENCE / NORTH STAR. … Do not assume a section here is
> enforced today — check `/AGENTS.md` first.

The same tree also assumes `apps/worker`, and `apps/ingest/{bacnet,modbus,snmp,
opcua}` directories, all of which AGENTS.md §6 holds out of scope behind their
own ADRs. **`F4.23` is a slice of a north-star layout, transcribed into the
backlog as one row.** That is not a reason to reject it. It is a reason to
check each of the three against `main` before building any of them, which is
what the facts below do.

## Measured facts

Measured on `main` at `eeaa653`, 2026-08-15.

### The contract already exists and is already shared

1. **`packages/shared` is the contracts package in everything but name.**
   1,251 lines across three modules, exporting **100 types** — `LoginResponse`,
   `LocationDashboardDto`, `AlarmListItem`, `AdminAssetDto`,
   `AuditLogListResponse`, and so on: the response shape of essentially every
   route.
2. **Both sides already import it.** `apps/web` references `@bms/shared` at
   **62** sites; `apps/api` at **86**, and not only in controllers —
   `alarms.service.ts` declares `Promise<AlarmListItem>` and
   `dashboard.service.ts` derives its internal row type *from*
   `LocationDashboardDto`. The API is written against the client's contract
   today.
3. So the thing a `packages/contracts` would be created to achieve — one
   description of the wire format, shared by producer and consumer — **is not
   missing.** It has been in place since before this backlog existed.

### What is missing is a runtime

4. **`packages/shared` has no dependencies at all** (`"dependencies"` is
   absent; `typescript` is its only devDependency). Every export is a `type` or
   an `interface`. All 100 vanish at build time.
5. **`apps/web` imports `zod` exactly zero times.** No response from the API is
   validated anywhere in the client. A field that changes type, or disappears,
   is discovered by a component rendering `undefined`.
6. **Where the API uses raw SQL, the compile-time chain starts from an
   assertion.** **Three** non-test files carry a typed raw query —
   `dashboard.service.ts` (9), `map.service.ts` (3) and `reports.service.ts`
   (3) — **15** `pool.query<{…}>(…)` call sites in total. That generic is an
   *assertion*, not a check: TypeScript believes the row shape because the
   author wrote it down. **23 of the 32 service files use Drizzle**, where the
   row type is derived from `packages/db`'s schema and genuinely checked — so
   **this is a claim about three files, not about the API.**

   Those three are, however, the hot read paths behind the dashboard, the map
   and the reports — surfaces `F4.37`, `F4.38` and `F4.39` each found a defect
   in.

So the honest summary: **the contract is enforced at compile time on both
sides and at runtime on neither**, and in four files the compile-time chain
rests on a hand-written assertion at the SQL boundary.

### Moving the request schemas is not free

7. **19 `*.schema.ts` files hold the 63 Zod request schemas, inside
   `apps/api/src`, beside the module each serves** (ADR 0029 fact 4). ADR 0029
   built two things directly on that location:
   - `openapi-registry.ts` imports every one of them **by relative path**
     (`../admin/audit/audit.schema`, …) to join 43 handlers to their schemas.
   - `tests/adr-0029-openapi-contract.test.ts` **walks `apps/api/src`** for
     `*.schema.ts` and asserts `files.length > 10` as its anti-vacuity floor,
     then checks every refinement is followed by a `.describe()`.

   Relocating those schemas moves the walk's target out from under it and
   drops the count below the floor. **That is an amendment to ADR 0029, not a
   refactor**, and it must be decided here rather than discovered mid-build.

8. And the client would not use them if they moved. `apps/web` never validates
   a request body — it builds payloads from typed function arguments in
   `apps/web/src/api/*.ts` and posts them. A shared *request* schema has no
   consumer today; a shared *response* schema has two.

### The other two packages have no consumer

9. **`telemetry-sdk` has no stated purpose anywhere in this repository.**
   Every occurrence outside a stale worktree copy is one of: the north-star
   tree (`AGENTS.production.md:90`), a backlog row restating `F4.23`, ADR
   0029's context line listing `F4.23` as a dependent, or the generated status
   dashboard. **No document says what it does, what it wraps, or who calls
   it.** It is a directory name.
10. **`packages/ui` has exactly one statement of purpose and exactly one
    possible consumer.** The purpose: *"design tokens in `packages/ui/theme`"*
    (`AGENTS.production.md:126`). The consumer: `apps/web`, which is the only
    React app in the workspace and the only one in scope. A second frontend is
    not planned — mobile apps appear in `docs/client-requirements-as-is-report.md:157`
    as explicitly **out of scope**, and in `docs/zoho-iot-gap-analysis.md` as an
    unbuilt competitor gap.

    Extracting a component library for a single consumer produces indirection
    and a second build step, and delivers a shared component library to nobody.

11. `AGENTS.production.md:310` does ask for *"Storybook story added/updated for
    any new shared component"* — the nearest thing to a justification for
    `packages/ui`. It is in the same non-enforced file, and Storybook is not a
    dependency of this workspace.

### Monorepo mechanics any new package must satisfy

12. Root `build` is an **ordered chain**: `shared → db → api → web → ingest`. A
    package the API depends on has to be inserted before `api`, in that script.
13. `postinstall` builds **only** `shared` and `db`. A new package that others
    import breaks a fresh `pnpm install` until it is added there too.
14. `typecheck:tests` enumerates every root-level test file **by hand**. Any
    new `tests/*.test.ts` must be appended or it is typechecked by nothing —
    the §4.6 asymmetry that has already bitten twice.

## Decision

**All of the following are proposals.** Decisions 1, 2, 4 and 7 restate
questions the owner must settle; the rest follow from them.

1. **`F4.23` is split, and only the contracts half is proposed for promotion
   now.** `packages/ui` and `telemetry-sdk` are **not** built under this ADR.
   Facts 9 and 10 are the reason: neither has a consumer on `main` or in any
   promoted scope, and this repository has already paid once for a second path
   built ahead of its consumer — ADR 0016 §6, cited again by ADR 0029
   Amendment 2 when it **deleted** the guarded OpenAPI machinery rather than
   leave it dormant. Building either now repeats that, twice.

   They are **not dropped.** They keep their place in the backlog, split into
   their own rows, so the provenance survives and each is reconsidered when a
   consumer appears — a second frontend for `packages/ui`, a named external
   integrator for `telemetry-sdk`.

2. **The contract package is `packages/shared` grown a runtime — not a new
   directory.** Add `zod` to `packages/shared`, express the response contracts
   as Zod schemas there, and derive the existing exported types with
   `z.infer<typeof …>` so **all 148 existing import sites keep compiling
   unchanged**.

   This is ADR 0029 decision 1 applied to the response side. That decision's
   thesis was that the description is generated from the schema that already
   enforces the shape, and that a second hand-written description is worse than
   none because it is believed. Creating `packages/contracts` beside a
   `packages/shared` that holds the same 100 types produces exactly that second
   description, and a migration window in which both are true and neither is
   authoritative.

   **The alternative is stated and is the owner's to take:** create
   `packages/contracts` as the north-star tree names it, and migrate the types
   out of `shared`. It costs a package, a build-chain slot, a `postinstall`
   entry, and a period of two-sources-of-truth; it buys the name in the
   production rulebook and a clean split between *contract* and *constant*
   (`packages/shared` also holds `ELECTRICAL_POINT_KEYS` and friends, which are
   not contracts).

3. **Request schemas stay in `apps/api/src/**/*.schema.ts`.** Facts 7 and 8:
   moving them breaks ADR 0029's registry and its guard, and no client would
   use them. If the owner wants them moved anyway, this ADR must carry the ADR
   0029 amendment explicitly — the registry's imports and the test's walk root
   both change, and the anti-vacuity floor has to be re-derived rather than
   quietly lowered.

4. **A spike runs before any schema is written.** ADR 0029 mandated one, and it
   found the fact that decided the design; this ADR mandates the same. It
   answers two questions, and the second is the one that matters:

   - **(a) Can the 100 types be expressed as Zod schemas whose `z.infer` is
     *identical* to what is exported today?** Checked by a type-level equality
     assertion, not by reading. Union types, the `&`-intersection
     (`LocationDashboardDto`), and the `export type * from` re-export are the
     candidates to fail.
   - **(b) How many live API responses actually satisfy the contract they
     declare?** Measured by validating real responses from the running stack
     against the new schemas. **A drift count of zero and a drift count of ten
     lead to different designs**, and neither is guessable from source — every
     response type is currently believed, never checked. This is the same
     shape as ADR 0029's refinement spike, and it is expected to be the part
     that changes the plan.

   If (a) fails for a type, the schema is not contorted to match: the finding
   amends this ADR, per ADR 0029's precedent.

5. **Nothing validates in production until decision 7 is answered.** A response
   validator that throws converts a cosmetic drift — an extra field, a
   `null` where the type said optional — into an outage on a page that
   currently renders fine.

6. **Scope limits, stated so they are not absorbed later.** Out of scope for
   this ADR: `packages/ui`; `telemetry-sdk`; RFC 7807 error envelopes
   (`F4.21`); WebSocket payload contracts (`AlarmSocketEvent` is a type in
   `shared` today and stays one); and response schemas in the OpenAPI document
   — **ADR 0029 decision 8 deferred those and this ADR does not reopen it.**
   It is worth recording that landing decision 2 would make that deferral
   cheap to revisit, because the document generator already converts Zod. That
   is a later decision, not a consequence of this one.

7. **The estimate is wrong and is restated.** 6–8 covered three packages. Under
   decision 1 the contracts half alone is **3–5**, and that number carries the
   spike, the `z.infer` equality proof, and whatever (b) turns up — the same
   ingredients that made `F4.20`'s 2–3 wrong. `packages/ui` and `telemetry-sdk`
   carry their own estimates on their own rows, when they have consumers.

## Dependencies

`zod` added to `packages/shared` — **`^3.24.1`, the exact range `apps/api`
already declares**, resolving to the `3.25.76` already in the lockfile. No new
package enters the tree; this is a workspace manifest change that makes an
existing dependency explicit where it is used.

It is still a manifest change, so **§9.4 gates it** and it is part of what the
owner is approving here.

If the owner takes the `packages/contracts` alternative in decision 2, that
package's manifest is a second §9.4 surface with the same single dependency.

## Consequences

- **`packages/shared` stops being type-only.** Its build already runs `tsc`,
  and it is consumed by `apps/web` through Vite and by `apps/api`/`apps/ingest`
  through Node, so the emitted `zod` import must resolve in all three. Adding
  the dependency to `packages/shared`'s own manifest is what makes that true
  under pnpm's strict linking — it is not optional tidiness.
- **`apps/web` gains `zod` transitively.** Bundle cost is real and small; it
  should be measured against the current `vite build` output rather than
  asserted.
- **Build chain and `postinstall` are unchanged under decision 2** and both
  need editing under the alternative (facts 12–13).
- **`F4.6` (contract tests) is what this unblocks**, and only under decision 2
  or its alternative — a contracts package with no runtime does not enable a
  contract test, which is the whole reason the row's Zod parenthetical matters.
- **ADR 0029 is untouched under decision 3** and amended under its alternative.
- **Two backlog rows are created** under decision 1, and the `F4.23` row is
  rewritten to the contracts half. Per the backlog's own rule, nothing is
  deleted — scope removal is `⛔ dropped` with the row intact, and this is a
  split rather than a removal.
- **`docs/AGENTS.production.md` is not edited by this ADR.** It is a north-star
  document and it is allowed to describe a layout `main` does not have. If the
  owner accepts decision 2, the divergence between its `packages/contracts` and
  this repo's `packages/shared` is worth a line there eventually — in its own
  change, not this one.

## Open questions for the repository owner (§10 gate)

1. **One package or two?** Grow `packages/shared` (decision 2), or create
   `packages/contracts` as the north-star tree names it?
2. **`packages/ui` and `telemetry-sdk`** — split into their own rows and defer
   (decision 1), keep them inside `F4.23` and build all three, or `⛔ drop`
   them outright?
3. **Request schemas** — leave them in `apps/api` (decision 3), or move them
   and amend ADR 0029 in this ADR?
4. **On a response that fails validation** — throw (fail fast, and a drift
   becomes an outage), or log-and-pass (the page keeps rendering, and the drift
   is discovered in logs)? Decision 5 blocks on this. The spike's question (b)
   should inform it, so this one may reasonably be answered after the spike
   rather than before.
