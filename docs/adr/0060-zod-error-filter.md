# ADR 0060 — A single `ZodError` filter answers a malformed parameter (`F4.108`)

## Status

Accepted — 2026-09-09, by the repository owner, at `F4.108`'s start gate
(AGENTS.md §10 step 2). Three rulings, asked one at a time and recorded verbatim
in §Rulings. **The second ruling widened the row**: the surface a global filter
touches is not the 44 sites the backlog names, and ten of the sites it would
newly answer are server faults rather than client errors.

An ADR exists for this row at all because `F4.103` ruling 1 said the
`F4.103`–`F4.109` batch closes on rulings recorded in each row rather than on
ADRs. The owner ruled that a global exception filter falls outside that: it
changes what **every controller in `apps/api`** returns on a Zod failure,
including routes nobody in this batch has read.

## Context

### What the row says, and what is actually there

`F4.108` was filed as *"a malformed session id answers 500, not 400"*, naming
**two routes** — `POST /admin/onboarding/sessions/<not-a-uuid>/validate` and
`getSession` — against `chat` and `patchDraft`, which wrap
`idParamSchema.parse(id)` in a `try` and answer 400.

Measured on `ccc58470` by brace-tracking each `try` block rather than by
proximity, because a parse three lines below a closing brace looks guarded and
is not:

| | Count |
|---|---|
| `idParamSchema.parse(` sites | **73** across 14 files |
| …inside a `try` | 29 |
| …**not** inside a `try`, so a `ZodError` escapes | **44**, across **12** controllers |

Onboarding alone has four unguarded, not the two the row names — `getSession`,
`uploadExcel`, `validate` and `commit`. `apps/api/src` registers **no exception
filter at all**: `main.ts` has neither `useGlobalFilters` nor `useGlobalPipes`,
so an escaped `ZodError` reaches Nest's default handler and becomes
`500 Internal server error`.

That matters for two reasons the row states correctly. A 500 is recorded as a
server fault, so a mistyped link pollutes whatever watches for real faults; and
the operator who pasted it cannot tell they mistyped.

### The number that decides this ADR is not 44

A global `@Catch(ZodError)` does not catch 44 sites. It catches **every**
`ZodError` that escapes anything, anywhere in the application. Measured across
all of `apps/api/src`, counting throwing `.parse(` calls only — `safeParse`
never throws:

| | Count |
|---|---|
| Throwing zod `.parse(` calls | **157** |
| …inside a `try` | 102 |
| …**unguarded**, and therefore what a global filter would newly answer | **55** |
| …of those, in a **controller** | 45 |
| …of those, in a **service** | **10** |

The ten are the problem, and they are not a rounding error on the 45:

```
admin/asset-templates/asset-templates-stock.service.ts:83    stockAssetTemplateDtoSchema.parse
admin/asset-templates/asset-templates-stock.service.ts:183   createAssetTemplateBodySchema.parse
admin/dashboard-templates/dashboard-templates-instantiate.service.ts:175  sectionTemplateContentSchema.parse
admin/dashboard-templates/dashboard-templates-instantiate.service.ts:553  dashboardDtoSchema.parse
admin/dashboard-templates/dashboard-templates.service.ts:141 sectionTemplateContentSchema.parse
admin/dashboard-templates/dashboard-templates.service.ts:275 sectionTemplateContentSchema.parse
admin/dashboard-templates/dashboard-templates.service.ts:649 dashboardTemplateDtoSchema.parse
admin/dashboard-templates/dashboard-templates.service.ts:658 sectionTemplateContentSchema.parse
admin/dashboard-templates/dashboard-templates.service.ts:670 sectionTemplateContentSchema.parse
vocabularies/vocabularies.service.ts:335                     sectionTemplateContentSchema.parse
```

**A controller parse validates what the client sent. A service parse of a
`*DtoSchema` or `sectionTemplateContentSchema` validates what this application
itself stored, on the way back out.** When one of those throws, a row in the
database does not match the contract the code believes it keeps. That is a
server fault, and it is the shape ADR 0030 exists to guard: every API response
type is `z.infer`red from a shared contract, and these parses are where that
inference is checked at runtime.

A filter cannot tell the two apart. `ZodError` carries `issues` with a path
inside the parsed value; it carries nothing about who supplied the value. So a
blanket 400 would tell a caller that the server's own corrupt row is their bad
request, and would remove that corruption from every server-fault signal at the
same time.

### What the guarded sites already do

70 sites across `apps/api/src` throw `new BadRequestException(err.flatten())`.
`HttpException.createBody` returns an object argument unchanged, so the wire
body is `{"formErrors":[…],"fieldErrors":{…}}` with no `message`, `error` or
`statusCode`. `F4.106` built `apiErrorMessage`
(`apps/web/src/lib/api-error-message.ts`) to render exactly that shape, taking
`formErrors` first and unlabelled and then each `fieldErrors` key.

**A parameter refusal lands in `formErrors`, not `fieldErrors`.**
`idParamSchema` is `z.string().uuid()` — a bare string with no object wrapper —
so its issue has an empty path and `flatten()` puts the message in `formErrors`.
That is the mirror image of `F4.115`, where the `patchDraftBodySchema` wrapper
prefixed `draft` onto a path-less issue and the message landed in
`fieldErrors.draft`. Unlabelled is correct here: there is no field to name, and
naming one would invent it.

### One thing found in passing, not fixed here

`idParamSchema` is declared **three times**: `admin/admin.schema.ts:6`, and
again locally in `dashboard-builder.controller.ts:33` and
`maintenance.controller.ts:29`. All three are `z.string().uuid()` today. That is
a §4.8 vocabulary split, and it is recorded rather than repaired because
collapsing it changes imports in files this row otherwise does not touch.

## Rulings

**Ruling 1 — an ADR is owed, despite `F4.103` ruling 1.** Asked whether the
batch ruling covers a change this wide. The owner ruled: *write an ADR first*.
A global exception filter changes what every controller returns on a Zod
failure, including routes nobody in this batch has read, and AGENTS.md §10 wants
a promotion like that recorded.

**Ruling 2 — fix the ten service parses first, then register the filter.** Asked
how the ADR should handle the ten sites where a `ZodError` means the server's
own stored data is malformed. The owner ruled: *fix the ten first, then filter
globally*. The ten are changed to say explicitly that a malformed stored row is
a server fault, so that by the time the filter is registered, **every
`ZodError` that can still reach it came from client input and 400 is always the
honest answer.** The declined alternatives were scoping the filter to the 12
controllers with `@UseFilters()` — precise, but a thirteenth controller added
later would be silently unprotected — and filtering all 55 as 400, which would
report a corrupt dashboard template as the caller's bad request.

**Ruling 3 — the body shape is `err.flatten()`, decided by the building session
rather than asked.** The 70 existing sites already throw it, `apiErrorMessage`
already reads it, and a second shape would mean the same failure looked
different depending on whether the route happened to have a `try`. Recorded here
so the choice is visible, not because it was open.

## Decision

1. **The ten service parses stop being ambiguous.** Each is changed so a
   contract violation on stored data raises an explicit server fault rather than
   a bare `ZodError`. The row does not change what the client sees for those —
   they answer 500 before and after — it changes *why*, so the filter's contract
   can be true.

2. **One `ZodErrorFilter`, registered globally in `main.ts`.** It answers
   `400` with `err.flatten()` as the body, matching the 70 sites that already
   throw that shape.

3. **The 29 already-guarded sites are not touched.** They keep their existing
   `try`/`catch` and their existing bodies. This ADR adds a floor; it does not
   rewrite what already stands on it.

4. **No route-by-route wrapper.** 44 wrappers would be 44 chances to miss one,
   and the next controller would start unprotected.

## Consequences

- **Every route in `apps/api` gains a 400 for a malformed parameter or body**
  that previously escaped as a 500. That is the point of the row, and it is also
  the widest behaviour change in the `F4.103`–`F4.109` batch.
- **A corrupt stored row keeps reporting as a server fault**, because ruling 2
  makes that explicit before the filter exists. Without that ordering the filter
  would have silently reclassified ten real faults.
- **The wire shape is unchanged** for the 70 sites that already flatten, so
  `apiErrorMessage` needs no change and no web work is owed.
- **`safeParse` call sites are unaffected** — they never throw, so the filter
  never sees them. `OnboardingValidateService.validate` in particular keeps
  returning `{valid:false}` rather than refusing, which is what makes a stored
  deep draft readable under `F4.115`.
- **`idParamSchema`'s three declarations stay three.** A later row may collapse
  them; this one records the split rather than widening to fix it.
- **The filter is a new global**, so an unrelated future `ZodError` anywhere in
  the application will answer 400 by default. Ruling 2's ordering is what makes
  that default correct, and it is the invariant a later reader must not quietly
  break: **a `.parse()` on data this application stored belongs behind an
  explicit server fault, not behind the filter.**

## Amendment 1 — the service set is eight, not ten (2026-09-09)

Recorded before any source moved, at `F4.108`'s build start. **No ruling
changes**: ruling 2 said fix the stored-data parses before registering the
filter, and that is as true of eight as of ten. What was wrong is the list, in
two of its entries, and both errors were mine.

**`vocabularies/vocabularies.service.ts:335` is not a call site.** It is prose
inside a docblock that discusses parse sites by name. The script that produced
§Context's table matched `.parse(` in comment text. Re-measured with comments and
string literals blanked by a character scanner — so a `//` inside a string and a
quote inside a comment are both handled — the totals move by one:

| | §Context said | Measured with comments stripped |
|---|---|---|
| Throwing zod `.parse(` calls | 157 | **156** |
| …inside a `try` | 102 | 102 |
| …unguarded | 55 | **54** |
| …in a controller | 45 | **45** — unchanged |
| …in a service | 10 | **9** |
| `idParamSchema.parse(` unguarded | 44 across 12 controllers | **44 across 12** — unchanged |

**The row's own headline is therefore untouched.** `F4.108` is still 44
unguarded `idParamSchema` sites across 12 controllers.

**`admin/asset-templates/asset-templates-stock.service.ts:183` is client input,
and must not be converted.** `createAssetTemplateBodySchema.parse({ ...body,
organizationId })` stands on a request path: `importStock`
(`asset-templates.controller.ts:114`) wraps `await this.stock.import(...)` in a
`try` whose `catch` already maps a `ZodError` to
`BadRequestException(err.flatten())`. Turning it into a server fault would
convert a correct 400 into a 500 — the exact inversion this ADR exists to
prevent, pointed the other way.

**The source had already written this down.** The docblock above that parse
states it: *"Eight other service sites parse with no `try`/`catch` around them —
measured … Every one of them parses STORED or CONSTRUCTED data — a row's
`content`, a DTO being assembled — and none parses caller input. That, not the
bare throw, is the real distinction: this parse stands on a request path, so its
failure is an answer the caller is owed and the controller maps it; there a
failure is an invariant break with no answer to give."* It enumerates the eight,
and its count agrees with the corrected measurement exactly.

**The eight sites ruling 2 covers:**

```
admin/asset-templates/asset-templates-stock.service.ts:83                  stockAssetTemplateDtoSchema.parse
admin/dashboard-templates/dashboard-templates.service.ts:141               sectionTemplateContentSchema.parse
admin/dashboard-templates/dashboard-templates.service.ts:275               sectionTemplateContentSchema.parse
admin/dashboard-templates/dashboard-templates.service.ts:649               dashboardTemplateDtoSchema.parse
admin/dashboard-templates/dashboard-templates.service.ts:658               sectionTemplateContentSchema.parse
admin/dashboard-templates/dashboard-templates.service.ts:670               sectionTemplateContentSchema.parse
admin/dashboard-templates/dashboard-templates-instantiate.service.ts:175   sectionTemplateContentSchema.parse
admin/dashboard-templates/dashboard-templates-instantiate.service.ts:553   dashboardDtoSchema.parse
```

`:83`'s caller `listStock` has no `catch`, so its `ZodError` reaches Nest's
default handler as a 500 today. Making it an explicit server fault keeps the
status and gives the body a reason.

**A third correction, measured during the build and belonging to this
amendment rather than to a later one.** The sentence that stood here said that
500's message is "the JSON of `issues`". It is not, and the claim came from a
comment in `asset-templates-stock.service.ts` that I quoted without checking.
`BaseExceptionFilter.handleUnknownError`
(`@nestjs/core/exceptions/base-exception-filter.js:34`) emits
`{statusCode: 500, message: MESSAGES.UNKNOWN_EXCEPTION_MESSAGE}` for anything
that is not an `HttpException` or an `http-errors` error — a bare `ZodError` is
neither — and passes `exception.message` to `logger.error` separately. So the
`issues` JSON reaches the **log**, never the response.

That makes the observable change at the eight **larger** than §Decision item 1
claims, not smaller. The status is unchanged at 500, but the body moves from
Nest's generic `{"statusCode":500,"message":"Internal server error"}` to one
naming the context the parse was given. That is a real, testable difference, so
the commit that converts the eight has a gate rather than only a rationale. The
same false sentence has been removed from the service comment it came from.

**What this costs the invariant in §Verification.** "No throwing `.parse(`
outside a `try` in a service" is now false as stated, because `:183` is one and
is correct. The assertion must allow it by name with the reason, and it must
strip comments — this amendment exists because a measurement did not.

**A fourth correction, and it is to §Context's last paragraph rather than to its
table.** §Context says `idParamSchema` is declared **three times** and
§Consequences repeats it as "three declarations stay three". It is declared
**seven** times, all `z.string().uuid()`:

```
apps/api/src/admin/admin.schema.ts:6                              (the exported one)
apps/api/src/dashboard-builder/dashboard-builder.controller.ts:33
apps/api/src/maintenance/maintenance.controller.ts:29
apps/api/src/notifications/escalation-profiles.controller.ts:31
apps/api/src/notifications/notifications.controller.ts:32
apps/api/src/rules/rules.controller.ts:39
apps/api/src/work-orders/work-orders.controller.ts:29
```

So the §4.8 split is **six local re-declarations of one exported schema**, not
two. This ADR still declines to collapse them and the branch collapses none —
the scope is unchanged. What changes is what a later row inherits: told to
"collapse the three", it would fix three, leave four, and believe it had
finished.

**Three of this ADR's measurements have now been corrected, and all three were
mine.** A regex that matched inside comments; a site classified as stored data
that stands on a request path; and a grep narrow enough to miss four of seven
declarations. The first two were caught by reading the source before the build,
the third by the compliance review. The pattern is not carelessness about any
one number — it is that a count written into a document reads as settled
afterwards, and nothing re-runs it. AGENTS.md §4.6 already says a correction is
a claim; the harder half is that **the original count is a claim too, and an ADR
is exactly the artefact where it stops looking like one.**

## Verification this ADR expects

- The 44 unguarded controller sites answer 400 with a `formErrors` body on a
  malformed id, measured live against the running container rather than in a
  unit test alone — the row was found live, and the same route that found it can
  confirm it.
- The ten service sites still answer 500 on malformed stored data, and say so
  explicitly.
- A mutation removing the filter registration reddens an assertion that names
  the filter, not merely a suite.
- The count itself is a claim: an assertion pins that **no** throwing `.parse(`
  sits outside a `try` in a service, so a later service parse added without a
  server-fault wrapper reddens rather than silently becoming a 400.
