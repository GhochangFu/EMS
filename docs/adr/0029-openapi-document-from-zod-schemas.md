# ADR 0029 — OpenAPI document generated from the Zod schemas

## Status

**Accepted** — 2026-08-15, by the repository owner, who ruled on the two
questions the draft left open:

- **Decision 2 — the document goes behind the JWT, not behind absence.** The
  draft proposed leaving the route unregistered in production; the owner chose
  the stated alternative. Decision 2 below is rewritten to what was chosen, and
  records what was given up.
- **Decision 8 — responses stay deferred**, as drafted.

`F4.20` is therefore unblocked, and its npm dependencies are approved under
AGENTS.md §9.4.

## Context

`F4.20` (Wave 0, P0, ⭐ enabler) asks for OpenAPI / Swagger across every
`/api/v1` route. It is the sole dependency of `F4.23` (`packages/contracts`,
`packages/ui`, telemetry-sdk) and a dependency of `E3.3` (CMMS/EAM connector)
and `E6.2` (enterprise export connectors) — three consumers that all need a
machine-readable contract rather than a rendered page.

There is no API description today. A client integrating against this API reads
the controllers.

The obvious implementation is `@nestjs/swagger`'s decorators, and on this
codebase it does not work as advertised. That is the whole substance of this
ADR, so the facts come first.

## Measured facts

Measured on `main` at `34820d2`, 2026-08-15.

1. **93 routes across 21 controllers**, all under the `api/v1` global prefix.
   `main.ts` excludes exactly two paths from that prefix: `GET /health` and
   `GET /metrics`.
2. **There are no DTO classes.** `class-validator` and `class-transformer` are
   not dependencies of `apps/api` and appear nowhere in the tree.
3. **13 controllers declare `@Body() body: unknown`** and validate by calling
   `schema.parse(body)` inside the handler, converting `ZodError` to
   `BadRequestException` (`onboarding.controller.ts` is representative).
4. **19 `*.schema.ts` files** hold those Zod schemas, beside the module they
   serve. `zod@^3.24.1` is already a direct dependency of `apps/api`.
5. **`@nestjs/swagger` derives body and response schemas from TypeScript design-time
   metadata on DTO classes.** A parameter typed `unknown` emits no usable
   metadata. So on the 13 controllers above, the generated document would
   describe every request body as an untyped object unless a schema is written
   by hand for each one.

Fact 5 is what decides this ADR. The default approach does not produce a
contract here; it produces a route index with the payloads missing.

## Decision

1. **The OpenAPI document is generated from the Zod schemas that already
   validate the request, not from a parallel set of DTO classes or hand-written
   `@ApiBody({ schema })` literals.** Those schemas are the only description of
   a payload that is enforced at runtime; anything else is a second copy that
   drifts, and this repo has repeatedly paid for second copies — ADR 0026 exists
   because the CSV escaping rule had two, and AGENTS.md §4.4 now requires a
   static guard whenever a rule could acquire one. A document that disagrees
   with the validator is worse than no document, because it is believed.

2. **The document is served in every environment at `GET /api/v1/docs-json` and
   is guarded by `JwtAuthGuard`. The Swagger UI shell at `GET /api/v1/docs` is
   not guarded, and does not need to be.** The owner chose availability over
   absence: the Ion Exchange integrators can reach the contract with the
   credentials they already have, rather than needing a deploy-time flag flipped
   for them.

   **The split is forced by how the guard works, and is not laxity.**
   `JwtAuthGuard.canActivate` reads `req.headers.authorization` and requires a
   `Bearer ` prefix; there is no cookie or query-parameter path
   (`apps/api/src/auth/jwt-auth.guard.ts:118-123`, and `AuthModule` provides no
   alternative extractor). A browser navigating to a URL sends no `Authorization`
   header. So guarding the UI route would return 401 to the address bar and the
   UI could never load — the decision would defeat itself. What is protected is
   the **content**: the shell is a static bundle carrying no route information,
   and it obtains the document by fetching `docs-json`, which 401s without a
   token. The UI is therefore configured with `persistAuthorization: true` and
   the standard *Authorize* control, so the reader supplies a bearer token and
   the page is blank until they do.

   **Not chosen, and worth stating so it is a decision rather than an
   oversight:** teaching `JwtAuthGuard` to accept a cookie for this one route.
   That would add a second credential path to a guard 29 call sites depend on,
   and with it CSRF questions the API does not currently have.

   **What this gives up.** The draft's alternative left the route unregistered
   in production, so there was nothing to probe. That is now gone: the endpoint
   exists everywhere and answers 401. And **any authenticated user of any role
   can read the entire inventory** — every route, parameter and error shape,
   including the ADR 0017 operations write matrix and the ADR 0012 credential
   endpoints. No role restriction is applied. Restricting `docs-json` to
   `admin` remains available and was not taken; if that is wanted it is a
   one-line change to this decision, not a redesign.

3. **Route, parameter and auth metadata come from Nest's own reflection**
   (`SwaggerModule.createDocument`), which reads the routing decorators
   correctly regardless of DTOs. Only the *schema* half is supplied from Zod.
   The two are joined by a small registry rather than by decorating every
   handler.

4. **Scope is the 93 REST routes.** The Socket.IO gateway is **out** — OpenAPI
   does not describe WebSocket message contracts, and pretending otherwise
   produces a document that is silent about the realtime path while looking
   complete. `GET /health` and `GET /metrics` are also out: they sit outside the
   `api/v1` prefix by deliberate choice in `main.ts`.

5. **A static invariant holds the single-source rule** (AGENTS.md §4.4, "when a
   guarantee cannot be expressed as a behavioural test, write a static one"):
   no route may carry a hand-written request-body schema literal, and every
   controller must be reachable from the document builder. The failure this
   guards is silent by construction — a hand-written schema renders perfectly
   and is simply wrong — and it is the shape `F4.39` recorded as hardest to
   see. It goes in an ADR-scoped file, `tests/adr-0029-openapi-contract.test.ts`,
   not in `tests/repo-invariants.test.ts`, which is at 911 of its 1000-line cap
   (AGENTS.md §3, recorded by `F4.40`).

6. **The generated document is asserted against the running application, not
   just built.** A test builds the document and checks that the number of
   documented operations equals the number of routes Nest actually registered.
   A document that silently omits a controller is the defect this item is most
   likely to ship, and counting is the only thing that sees it.

7. **Authentication is described** — the JWT bearer scheme is declared once and
   applied to the routes carrying `JwtAuthGuard`, so a generated client sends
   credentials rather than discovering the requirement through a 401.

8. **Response schemas are explicitly deferred** — put to the owner and confirmed
   on 2026-08-15. This ADR covers request contracts, paths, parameters and auth.
   Response bodies are typed in `packages/shared` today and are not uniformly
   Zod-described, so making them authoritative is `F4.23`'s problem — which is
   precisely the item this one unblocks. The document will say responses are
   undescribed rather than describe them wrongly.

   The cost lands on the consumer and should be visible before anyone is
   surprised by it: a client generated from this document knows how to *call*
   every route and nothing about what comes back. For `F4.23` that is fine, since
   it is the item that will supply them. For an external integrator handed the
   document in the meantime, it is a half-contract, and saying so is part of
   handing it over.

## Dependencies

Both are new direct dependencies of **`apps/api`**, and are what §9.4 gates:

- **`@nestjs/swagger`** — the document builder and the Swagger UI handler.
  Must be the release line built for **NestJS 10.4.x**; the exact major is to be
  confirmed at install rather than asserted here.
- **`zod-to-json-schema`** — converts the existing Zod schemas to JSON Schema
  for embedding in the document.

**Not verified yet, and it is the risk in this ADR:** that
`zod-to-json-schema`'s output is faithful for the schemas actually in use —
`.refine`, `.superRefine`, discriminated unions, `z.record`, transforms and
coercions all have imperfect or lossy JSON Schema representations. Implementation
must begin by converting all 19 schema files and inspecting the result, and if a
schema does not survive conversion, this ADR is what gets amended. No
alternative library is proposed as a fallback here because the choice should be
made against that measurement, not ahead of it.

Adding these two is also what makes `pnpm install` non-reproducible for anyone
on the branch until the lockfile lands; nothing else in the repo changes.

## Consequences

- **`F4.23` becomes startable**, and it is the item that most wants this: a
  `packages/contracts` built on Zod inherits the same schemas this document is
  generated from, so the API, the document and the shared contracts package have
  one source rather than three. `E3.3` and `E6.2` gain a contract they can hand
  to an external integrator.
- **Writing a new endpoint gains an obligation**: its Zod schema must be
  registered, or decision 6's count fails the build. That is the intended cost —
  it is the mechanism that keeps the document honest, and it is cheap only
  because the schema already has to exist to validate the request.
- **The 13 `@Body() body: unknown` handlers are not refactored.** Their
  in-handler `parse` stays. This ADR reads the schemas; it does not restructure
  validation, and a validation-pipe migration would be its own item.
- **Decision 2 is now the hard-to-reverse direction, deliberately.** The draft's
  unregistered-in-production option could have been relaxed later at no cost;
  the chosen one cannot be tightened later at no cost, because integrators will
  have the URL. Withdrawing it after that is a breaking change to them, not a
  config change. The owner made that trade knowingly, and the mitigation if it
  is ever needed is the role restriction named in decision 2 rather than removal.
- **`docs-json` is a new unauthenticated-reachable 401 surface**, and the UI
  shell is genuinely public. Neither leaks route information, but both are new
  addresses. Whoever reviews the first implementation PR should confirm that
  concretely — that the shell contains no embedded specification and that
  `docs-json` refuses without a bearer token — rather than taking this paragraph
  for it.
- **The document does not describe the realtime path at all** (decision 4). Any
  consumer told "the API is documented" will still have to read
  `telemetry.gateway.ts` for Socket.IO. Worth stating in the README when this
  lands, so the gap is declared rather than discovered.
- **Nothing in AGENTS.md §6 is promoted.** §6 does not list OpenAPI or Swagger,
  and the roadmap does not mention them, so this is a §9.4 dependency gate and
  not a §10 scope promotion. Now that this is accepted, the `chore(agents):`
  sweep for `F4.20` owes two things and no more: the **status-line ADR index
  entry** for 0029, and a **§4.3 note** saying where API description lives and
  that it is generated from the Zod schemas rather than from decorators. No §6
  line to soften. Tracked in `docs/BACKLOG.md` §5 until it lands, per §10.1.
