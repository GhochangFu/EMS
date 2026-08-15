# ADR 0030 — Shared API contracts, and the two packages F4.23 does not need

## Status

**Accepted** — 2026-08-15, by the repository owner, who ruled on all four
questions the draft left open. Each was answered as drafted, so the decisions
below stand as written, with three sharpened by the ruling:

- **Q1 — grow `packages/shared`, schemas under a `contracts/` subpath.** The
  draft offered the whole package or a new `packages/contracts`; the owner took
  the subpath variant, which the draft raised because §4.5's 1,000-line cap
  forces new modules under either option anyway. Decision 2 is rewritten to it.
- **Q2 — `packages/ui` and `telemetry-sdk` split onto their own rows,
  deferred.** Not dropped. Decision 1 stands, and now names the two rows.
- **Q3 — request schemas stay in `apps/api`.** ADR 0029 is untouched.
  Decision 3 stands.
- **Q4 — the failure direction is decided after the spike**, not now. The
  default direction is recorded; decision 5 is rewritten to say what the spike
  must produce before it can be settled. **The spike has since run and Q4 is
  settled as drafted — see Amendment 1.**

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

1. **`F4.23` is split, and only the contracts half is promoted.**
   `packages/ui` and `telemetry-sdk` are **not** built under this ADR.
   Facts 9 and 10 are the reason: neither has a consumer on `main` or in any
   promoted scope, and this repository has already paid once for a second path
   built ahead of its consumer — ADR 0016 §6, cited again by ADR 0029
   Amendment 2 when it **deleted** the guarded OpenAPI machinery rather than
   leave it dormant. Building either now repeats that, twice.

   They are **not dropped.** They keep their place in the backlog as
   **`F4.41` (`packages/ui`)** and **`F4.42` (`telemetry-sdk`)**, so the
   provenance survives and each is reconsidered when a consumer appears.

   The two rows are **not equivalent, and are written differently.** `F4.41`
   is an ordinary deferred item with a stated trigger: a second frontend.
   `F4.42` cannot be estimated at all — fact 9 is that nothing in this
   repository says what a telemetry SDK would wrap or who would call it — so
   its row records that its **purpose is undefined** and that a named consumer
   and a scope statement are prerequisites to sizing it. A row that cannot be
   written honestly should say so rather than carry an invented estimate.

2. **The contract package is `packages/shared` grown a runtime — not a new
   directory — and the schemas live under a `contracts/` subpath.** Add `zod`
   to `packages/shared`, express the response contracts as Zod schemas in new
   modules under `packages/shared/src/contracts/`, publish them through a
   **`@bms/shared/contracts` export entry** — the package already does exactly
   this for `./ingest`, so the mechanism is established rather than invented —
   and derive the existing exported types with `z.infer<typeof …>` so **all
   148 existing import sites keep compiling unchanged**.

   This is ADR 0029 decision 1 applied to the response side. That decision's
   thesis was that the description is generated from the schema that already
   enforces the shape, and that a second hand-written description is worse than
   none because it is believed. Creating `packages/contracts` beside a
   `packages/shared` that holds the same 100 types produces exactly that second
   description, and a migration window in which both are true and neither is
   authoritative.

   **The subpath is what makes the one-package answer honest.** The objection
   to growing `shared` is that it already mixes contracts with things that are
   not contracts — `ELECTRICAL_POINT_KEYS`, `TELEMETRY_POINT_REF_SEP` and the
   other point-key constants. A separate export entry draws that line at the
   import site without a second manifest, a second build-chain slot, a second
   `postinstall` entry, or a window with two sources of truth.

   **New modules were forced anyway.** `packages/shared/src/index.ts` is
   **966 lines** against §4.5's 1,000-line cap, so schemas for 100 types could
   not have gone there under any option. The subpath costs nothing that was
   avoidable.

   **What was given up:** the name `packages/contracts` in
   `docs/AGENTS.production.md`. That file is the north star and is allowed to
   diverge from `main`; see the Consequences.

3. **Request schemas stay in `apps/api/src/**/*.schema.ts`.** Facts 7 and 8:
   moving them breaks ADR 0029's registry and its guard, and no client would
   use them. **Ruled: they stay, and ADR 0029 is untouched by this ADR.**

   Recorded for whoever revisits it: the move becomes worth making when the
   web should fail fast on a bad payload before a round trip. That is a
   separate item, and it carries the ADR 0029 amendment itself — the registry's
   relative imports and the contract test's walk root both change, and the
   `> 10` anti-vacuity floor has to be **re-derived**, not quietly lowered to
   whatever the new tree happens to contain.

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

5. **The failure direction is decided after the spike, not before it — and
   the spike must deliver the number that decides it.** The owner deferred
   this deliberately, which makes spike question (b) a blocking deliverable
   rather than a curiosity: **a drift count of zero and a drift count of ten
   make different answers correct.** Throwing is affordable at zero and an
   outage on day one at ten, and no one can currently say which this is,
   because no response has ever been checked.

   **The default direction, recorded so the spike has something to falsify:**
   throw in dev and test, log-and-pass in production, both from one
   `safeParse`. The reasoning is the failure-direction asymmetry this
   repository already applied to `API_DOCS_ENABLED` in ADR 0029 Amendment 2 —
   for a monitoring product, a blank Control Room page during an incident is a
   worse failure than a page rendering with one drifted field. Loud where a
   developer sees it; forgiving where an operator does.

   **Until that decision lands, nothing validates in production.** A validator
   shipped ahead of its failure policy has chosen one by default, and the
   default would be whichever the first implementation happened to write.

6. **Scope limits, stated so they are not absorbed later.** Out of scope for
   this ADR: `packages/ui`; `telemetry-sdk`; RFC 7807 error envelopes
   (`F4.21`); WebSocket payload contracts (`AlarmSocketEvent` is a type in
   `shared` today and stays one); and response schemas in the OpenAPI document
   — **ADR 0029 decision 8 deferred those and this ADR does not reopen it.**
   It is worth recording that landing decision 2 would make that deferral
   cheap to revisit, because the document generator already converts Zod. That
   is a later decision, not a consequence of this one.

7. **The estimate is wrong and is restated.** 6–8 covered three packages.
   Decision 1 having been ruled, `F4.23`'s Effort cell becomes **3–5** for the
   contracts half — and that number carries the spike, the `z.infer` equality
   proof, and whatever (b) turns up, the same ingredients that made `F4.20`'s
   2–3 wrong. **It should be read as the estimate most likely to move.**

   `F4.41` carries its own estimate. **`F4.42` carries none**, per decision 1 —
   an undefined purpose cannot be sized, and a placeholder number would be the
   invention this ADR is trying to avoid.

## Dependencies

`zod` added to `packages/shared` — **`^3.24.1`, the exact range `apps/api`
already declares**, resolving to the `3.25.76` already in the lockfile. No new
package enters the tree; this is a workspace manifest change that makes an
existing dependency explicit where it is used.

It is still a manifest change, so **§9.4 gates it — and accepting this ADR is
that approval**, which is what the gate asks for.

**One manifest, not two.** Decision 2 having been ruled in favour of the
subpath, `packages/shared/package.json` is the only manifest that changes: the
`zod` dependency, and the `./contracts` export entry beside `./ingest`. The
`packages/contracts` alternative would have been a second §9.4 surface
carrying the same single dependency; it was not taken.

## Consequences

- **`packages/shared` stops being type-only.** Its build already runs `tsc`,
  and it is consumed by `apps/web` through Vite and by `apps/api`/`apps/ingest`
  through Node, so the emitted `zod` import must resolve in all three. Adding
  the dependency to `packages/shared`'s own manifest is what makes that true
  under pnpm's strict linking — it is not optional tidiness.
- **`apps/web` gains `zod` transitively.** Bundle cost is real and small; it
  should be measured against the current `vite build` output rather than
  asserted.
- **Build chain and `postinstall` are unchanged**, decision 2 having been
  ruled. Facts 12–13 described the cost of the alternative; it was not taken,
  so no root script changes.
- **The `@bms/shared/contracts` export entry is a manifest edit** to
  `packages/shared/package.json`, alongside `./` and `./ingest`. Consumers
  resolving the subpath depend on it being declared; an undeclared subpath
  fails at import under pnpm, not at build.
- **`F4.6` (contract tests) is what this unblocks** — and only because
  decision 2 ships a runtime. A contracts package holding types alone does not
  enable a contract test, which is the whole reason the row's Zod parenthetical
  matters.
- **ADR 0029 is untouched**, decision 3 having been ruled.
- **Two backlog rows are created** — `F4.41` and `F4.42` — and the `F4.23` row
  is rewritten to the contracts half with its Effort at 3–5 per decision 7.
  Per the backlog's own rule nothing is deleted: scope removal is `⛔ dropped`
  with the row intact, and this is a split rather than a removal.
- **`docs/AGENTS.production.md` is not edited by this ADR.** It is a north-star
  document and it is allowed to describe a layout `main` does not have.
  Decision 2 having been taken, its `packages/contracts` will not exist —
  `@bms/shared/contracts` serves the role. That divergence is worth a line
  there eventually, in its own change, not this one.
- **The `AGENTS.md` promotion this ADR owes** is a `chore(agents):` sweep under
  §9.10/§10.1, after the feature lands: a §2 row for runtime-validated
  contracts, a §3 entry for `packages/shared/src/contracts/`, and whatever
  §4.x rule the spike's findings turn out to justify. It is **not** written
  yet, because the spike may change what there is to say.

## Questions resolved at the §10 gate

All four were put to the repository owner on 2026-08-15 and all four were
answered as drafted. Kept here as the record of what was asked, since the
Status section records only what was chosen.

1. **One package or two?** → *Grow `packages/shared`, schemas under a
   `contracts/` subpath.* Decision 2.
2. **`packages/ui` and `telemetry-sdk`?** → *Split onto their own rows,
   deferred — not dropped.* Decision 1, now `F4.41` and `F4.42`.
3. **Request schemas — move them?** → *No; they stay in `apps/api`.*
   Decision 3.
4. **Throw or log-and-pass on a failed response?** → *Decide after the spike.*
   Decision 5, which now names spike question (b) as the blocking deliverable
   and records the default direction for the spike to falsify.

---

## Amendment 1 — the spike ran (2026-08-15)

Decision 4 mandated a spike before any schema was written, and made its second
question a blocking deliverable for decision 5. Both halves are done. **Neither
result changes a decision** — which is worth stating plainly, because ADR 0029's
spike reversed one and the expectation here was that this one might too.

### (a) Every structural class converts, and the strict bar holds

A census sorted the **99 named declarations** into structural classes. Nine
types covering **every** class were converted and asserted against **both**
bars — strict conditional-type identity, and mutual assignability — each
assertion a standalone `const` so `tsc` reports every failure instead of
stopping at the first.

**14 measurements. 3 strict failures. 0 assignability failures.** Every strict
failure has a passing sibling encoding, so all three are authoring choices
rather than limits:

| exported shape | fails | passes |
|---|---|---|
| `A & B` | `.merge()` — flattens | `z.intersection` |
| `Omit<A, k> & B` | `.omit().extend()` — flattens | `z.intersection(A.omit(…), B)` |
| all-`readonly` object | plain `z.object` — infers mutable | `.readonly()` |

**Decision 4(a)'s "identical" needs no softening, and the strict bar earns its
keep.** Nothing failed assignability — under that bar alone all three wrong
encodings pass silently, and the package would have begun flattening
intersections, changing the identity of an exported type for anyone doing
type-level work on it with no signal anywhere. **Strict is the only bar that
discriminates, and what it discriminates is exactly the encoding choice.** Those
three rules are what the `chore(agents):` sweep should carry into §4.

**A completeness scan ran separately from the census, and earned its place.**
The taxonomy was regex-derived, so a construct nobody thought to look for would
have been filed under "object" and counted as covered. The scan found two —
`readonly` property modifiers and `Date`-typed properties, **18 sites across 4
types, all in `ingest.ts`**. Both were then measured rather than assumed:
`Date` converts cleanly through `z.date()`, so it was the modifier, not the
type.

**Found while doing it, and pre-existing:** `apps/web/vite.config.ts` aliased
`"@bms/shared"` as a string, which Vite matches as a **prefix** — so
`@bms/shared/contracts` resolved to `…/src/index.ts/contracts`, a path that
cannot exist. `tsc` resolves the subpath correctly through the `exports` map and
says nothing, so it fails only at `vite build`, pointing at a file nobody wrote.
It was latent because `@bms/shared/ingest` is used only by `apps/ingest`, which
does not go through Vite; **decision 2 makes `apps/web` the first subpath
consumer, so it would have bitten mid-implementation.** Fixed with the array
form, most specific first.

**Bundle cost, measured against the current output as the Consequences asked
rather than asserted:** 1,807.61 kB raw / 555.03 kB gzip becomes 1,866.75 /
568.66 with `zod` and one schema — **+59.1 kB raw, +13.6 kB gzip (+3.3% /
+2.5%)**.

### (b) Drift is zero on the measured surface

Four endpoints were sampled against the running stack, comparing the observed
wire shape against fingerprints derived from the proven schemas. Shape only —
key paths and type tags, no value ever left the page, and the session's token
was read and used inside the page that already held it.

| endpoint | type | declared paths | missing | extra | type drift |
|---|---|---|---|---|---|
| `/alarms` | `AlarmListItem` | 12 | 0 | 0 | 0 |
| `/admin/organizations` | `AdminOrganizationDto` | 7 | 0 | 0 | 0 |
| `/dashboard/locations` | `LocationKpiSummary` | 16 | 0 | 0 | 0 |
| `/dashboard/locations/:id` | `LocationDashboardDto` | 64 | 0 | 0 | 0 |

**99 declared paths, zero drift.**

**The first sample was not good enough, and the difference matters.** Against a
single location, 8 of the 64 paths on `LocationDashboardDto` came back
unobserved — `telemetry` was `array:empty` and `latestAlarm` was `null` on
every asset. **An unobserved path is neither satisfied nor violated**, and
reporting it as either would have been false. Widening to all **16 locations —
148 assets, 492 telemetry rows, 30 non-null `latestAlarm` objects** — closed
the gap exactly: 64 declared, 64 observed. Of 9 declared-nullable fields **8
were actually seen carrying `null`**; only `province` never did, which is a
fact about the data, not a contract violation.

**The scope limit is the important part of this result.** Four endpoints of 93
routes, chosen because they are the ones the spike had proven schemas for.
**"Zero drift where measured" is not "the API has no drift."**

### What this settles for decision 5

Question (b) existed because a drift count of zero and a count of ten make
different answers correct. **It is zero**, so throwing would not have caused an
outage on any measured path.

**The recorded default stands — throw in dev and test, log-and-pass in
production — but its justification changes.** It is no longer a hedge against
suspected chaos; it is cheap insurance for the **89 routes this spike did not
measure**, bought at no cost on the four it did. Nothing about zero drift on
4 % of the surface licenses throwing on the other 96 %.

Decision 5 is therefore **settled as drafted**, and the failure policy is no
longer blocking.

---

## Amendment 2 — what building it changed (2026-08-15)

The schemas are written and `index.ts` now derives every response type with
`z.infer`. Two facts turned up that the accepted decisions did not anticipate.
Neither reverses a decision; one narrows where decision 2's benefit lands, and
one is a small contract change that could not be avoided.

### The subpath does not reach `apps/api`

**`apps/api` compiles with `moduleResolution: "node"` (node10), which ignores
the package `exports` map entirely.** `@bms/shared/contracts` therefore does not
typecheck from that package. TypeScript says so in as many words:

> There are types at `…/dist/contracts/index.d.ts`, but this result could not be
> resolved under your current 'moduleResolution' setting.

**Node's own runtime resolution honours `exports` and works** — which is the
dangerous half of this, not the safe half. A subpath import from `apps/api`
fails to compile but would run correctly, so anyone who reached for a
`@ts-expect-error` would get a working, untyped import.

This was already known here and already answered: `index.ts` re-exports
`./ingest` for exactly this reason, in a comment that predates `F4.23`. The
same workaround is applied — **`index.ts` re-exports the schemas as values** —
so `apps/api` imports contracts from `@bms/shared` and `apps/web` uses
`@bms/shared/contracts`.

**What this costs is half of decision 2's stated benefit.** The subpath was
chosen to draw the contract/constant line *at the import site*; it now draws it
for `apps/web` only. That is worth stating plainly rather than filing under
"resolved": the decision is not wrong, but it does not buy what it was said to
buy for one of the two consumers.

**Left open, and not taken here:** moving `apps/api` to `node16`/`nodenext`/
`bundler` would make the subpath universal. That is a build-configuration change
touching every import in the package, with CommonJS/ESM interop and NestJS
decorator metadata in its blast radius. It is `apps/api`'s decision and needs
its own justification, not a side effect of a contracts package.

### A required `unknown` property is not expressible in Zod

`AuditLogEntryDto.payload` was `unknown` and **required**. It is now optional,
and this is the only contract the migration changed.

`z.unknown()` yields an **optional** key: Zod marks any key whose output
includes `undefined`, and `unknown` includes `undefined`. Unlike Amendment 1's
three encoding rules, **this one has no passing sibling encoding** —
`z.any()`, `z.custom<unknown>()` and every other spelling infer an output that
`undefined` extends, so the key is optional under all of them.

**The practical gap is nil and the principle is not.** `payload: unknown`
already permitted the value `undefined`, so no consumer could ever have relied
on the key carrying something; the difference is only whether a *producer* is
forced to write it. Blast radius was measured rather than argued: the full
build and **all 180 tests, including every integration suite against a real
database**, pass unchanged.

It is recorded here, and in the type's own doc comment, because a contract
weakened without announcement is precisely what this package now exists to
prevent.

### The migration was proved, and the proof is deliberately not kept

Before `index.ts` was switched, **81 assertions** compared each schema to the
hand-written type it was about to replace, at strict type identity. **79 were
identical on the first run**; the 2 that differed are the `payload` case above.

Those assertions are **not in the repository**. Once the types are `z.infer` of
the schemas, `Strict<z.infer<S>, z.infer<S>>` is trivially `true` and all 79
become tautologies — and the fact that they were once meaningful is exactly
what would have made them hard to spot later. AGENTS.md §4.4 is a running list
of guards that passed while checking nothing.

What is kept instead is the pair of properties that can still break:
`tests/adr-0030-contract-derivation.test.ts` rejects a hand-written response
type in `index.ts`, and rejects `.merge()` / `.omit().extend()` in
`contracts/`. Both were mutation-tested — 2 of 2 mutations die — and the second
exists because the property it protects (strict identity, not assignability) is
invisible to every runtime test.

### One guard got better

`tests/ingest-contracts.test.ts` verified that every ingest protocol is
expressible in onboarding by **scraping the `OnboardingProtocol` union out of
`index.ts` as text**, because a type is erased before a test can see it. With
the schema as the source, the union is a runtime value and is now simply read
from `onboardingProtocolSchema.options`.

Worth recording for a reason beyond the tidiness: **the old check failed loudly
when the migration broke it**, because it carried an anti-vacuity floor. It
would otherwise have gone quietly green over an empty scrape — the failure mode
§4.4 exists to catch, caught.
