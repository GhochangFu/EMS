# ADR 0091 — The onboarding agent onboards asset templates (`F3.22`)

## Status

Accepted — drafted on 2026-10-04, before any implementation code. Six scope
questions were put to the owner one at a time on 2026-10-04; all were ruled,
and each ruling is recorded under *Gate questions*. The owner approved this
written record on 2026-10-04.

Implements row `F3.22` (Track E, Wave 3, P0). Builds on
[ADR 0090](./0090-onboarding-agent-tool-calling-loop.md) and amends its
ruling 7, decision 4, decision 8 and its *Deferred* bullet, and
[ADR 0015](./0015-asset-template-schema.md) §8 (see *Amended records*). Keeps
[ADR 0022](./0022-onboarding-credential-capture.md),
[ADR 0039](./0039-template-version-lifecycle.md),
[ADR 0052](./0052-stock-asset-template-catalog.md),
[ADR 0058](./0058-template-alarms-seed-automation-rules.md) and
[ADR 0067](./0067-per-asset-default-dashboards.md) unchanged for every caller
other than the onboarding chat. Promotes nothing out of `AGENTS.md` §6: the
agent stays inside the scoped admin onboarding wizard (`AGENTS.md` rule 15).

**Dependency reading.** The row lists `F2.2, F3.21`. `F2.2` (instantiate from
a template, ADR 0015 §6/§7 as amended) closed with PR #7. `F3.21` (the
tool-calling loop, ADR 0090) closed with PR #705. The owner started the row on
2026-10-04.

## Context

**What the chat does today** (`apps/api/src/admin/onboarding/`, ADR 0090):

- A closed registry of 17 tools (`onboarding-agent-tools.ts`, `TOOL_SCHEMAS`)
  edits an in-memory copy of the session draft. Every write goes through
  `write()`: `mergeDraftPatch`, `draftCountProblem`, the depth bound, and the
  pending proposal is dropped.
- The model cannot commit. `propose_commit` binds a proposal to `draftHash`;
  the Commit button or the exact phrase `confirm commit` commits, and
  `commitProposed` re-checks the hash on the session row locked `FOR UPDATE`.
- `OnboardingCommitService.commitWith` writes the location, the point keys,
  the RTUs, the plain assets and their asset points in one `withTenant`
  transaction, with one audit row `master.onboarding.commit`.
- `onboardingDraftSchema` has six sections (`location`, `rtus`, `pointKeys`,
  `assets`, `assetPoints`, `onboardingMeta`) in two copies: `apps/api`
  `onboarding.schema.ts` and `packages/shared` `contracts/onboarding.ts`. No
  section knows templates.

**What the template domain does today** (`apps/api/src/admin/asset-templates/`):

- `AssetTemplatesService.create` writes a draft template; `publish` freezes a
  version for ever (ADR 0015 §5, ADR 0039). `AssetTemplatesStockService.import`
  calls `create` with a catalog entry (ADR 0052 decision 5).
- `AssetTemplateInstantiationService.instantiate` needs a **published**
  version. It writes assets with the `template_id` pin and telemetry-source
  meta, one asset point per measured template point, seeded automation rules
  (ADR 0058) and default dashboards (ADR 0067), and the audit row
  `master.asset.instantiate`.

**The central fact.** Every public method of the two template services opens
its own `withTenant` transaction, and their guards read the target RTU and
location, the point-key catalog and the template rows through `fleetDb`, and
their vocabulary checks on a second connection of the tenant pool
(`VocabulariesService` injects `TENANT_DRIZZLE`; corrected 2026-10-04 at the
PR 1 review — an earlier draft said "the vocabulary pool", which does not
exist) (`asset-templates-instantiate.service.ts:281`, `:513-580`,
`:618-628`; `asset-templates.service.ts:193`, `:369`, `:635-660`). Those reads
cannot see rows that the onboarding commit wrote but has not committed. So the
services cannot run inside the onboarding commit as they stand: a template
asset on an RTU of the same draft fails with "RTU not found", and a template
that uses a point key of the same draft fails the catalog check. The two
service files are 940 and 996 lines, against the 1,000-line cap of
`AGENTS.md` §4.5.

## Gate questions

1. **What may the agent "create"?** Options: instantiate existing published
   templates only; also import a stock template; also author a new template
   with points only; also author content (alarms, KPIs, dashboards). **Ruled
   as recommended: stock import and authoring with points only.** Content
   stays on the template editor (`F2.5`), so a steered model cannot set an
   alarm threshold.
2. **Where may a template asset be placed?** Options: an RTU of the same
   draft; the same draft or a committed RTU; a committed RTU or location
   only; also gateway-less (a location with no RTU). **Ruled as recommended:
   an RTU of the same draft (`rtuIndex`), with measured points.**
3. **How does a confirmed commit write the templates and their assets?**
   Options: one transaction; two phases (site first, then the unchanged
   template services); expand the template into plain assets at tool time.
   **Ruled as recommended: one transaction.** Templates, point keys, the
   location, the RTUs and every asset commit together or not at all (ADR 0090
   ruling 1).
4. **When is a template that the chat authored or imported published?**
   Options: on the confirmed commit; after a second, separate confirm; never in
   chat. **Ruled as recommended: the confirmed commit publishes it, then
   instantiates it.** The proposal names each publish.
5. **How many PRs?** Options: two PRs, the refactor first; one PR. **Ruled as
   recommended: two PRs.** PR 1 is the refactor with no behavior change.
6. **The remaining decisions** — the record form, the tool set, the read
   tools, an existing code, the source-key variables, the side effects, the
   injection bounds, the fallback, and the live verification. Options: accept
   each as recommended in this draft; rule each one. **Ruled: accept all as
   recommended.** They are decisions 2, 3, 6, 7, 9 and 11 below.

## Decision

1. **Transaction-aware cores (PR 1, no behavior change).** Template create,
   publish and instantiate each gain a core that takes the caller's `tx`, the
   organization and the actor, and does every guard read through that `tx`:
   the target RTU and location, the asset-code and rule-code checks, the
   point-key catalog, the template row and its points. The cores live in new
   files; the two service files do not grow. Each public method becomes a thin
   wrapper: it opens `withTenant` and calls its core. The routes, their
   bodies, their responses, their audit rows and their error texts do not
   change. The existing integration suites of the template domain must pass
   unchanged, and that is the gate of PR 1. `deriveTelemetrySource(tx, …)` and
   `AssetDashboardsInstantiateService.instantiateForAssets(tx, …)` already take
   `tx` and are reused as they are.

   *Dated note, 2026-10-04 (the plan, owner ruling):* under `FORCE ROW LEVEL
   SECURITY` a read through the tenant `tx` cannot see another
   organization's rows. A core with every read on `tx` would change two
   answers of the instantiate route: a target in another organization would
   answer 404, not today's 400, and an asset-code collision with another
   organization would lose today's 409 text. So "every guard read through
   that `tx`" yields to "no behavior change" in two places. The instantiate
   core keeps two `fleetDb` reads: a probe that runs only when the `tx` read
   of the target misses, to tell "another organization" (400) from "not
   found" (404), and an estate-wide read of asset codes beside the `tx` read,
   combined by code. A test pins these two reads by name. Every other guard
   read is on `tx`, so a row written earlier in the same commit stays
   visible.

2. **The draft gains templates.** Both copies of `onboardingDraftSchema` gain:
   - `templates[]` — one entry per template that this chat creates. An entry
     is either **authored** (`code`, `name`, `domain`, optional `description`,
     and a `points` array in the shape of the template points body, with no
     `content`) or **stock** (`stockCode` only; the content comes from the
     catalog module at commit, never from the draft, ADR 0052 decision 5).
   - `assets[].template` — an optional reference `{ code, version?,
     sourceDataKeyVars? }`. The code names a `templates[]` entry of the same
     draft or a published template of the session's organization. For an
     organization template, the tool writes the version it resolved, so the
     draft hash binds an immutable version (ADR 0015 §5).

   A templated asset takes its `domain` from its template and has no
   `assetPoints` entries: its points come from the template. Validation
   refuses a mismatched domain and an `assetPoints` entry on a templated
   asset, so the commit cannot write a point twice. Every new field gets a
   cap: a count of templates per draft, points per authored template, and
   variables per asset; entries in `ONBOARDING_DRAFT_STRING_MAX`; the depth
   bound; `draftCountProblem`; and a shedding stage in
   `serialiseDraftForPrompt` (`F4.107`). The plan derives each value from the
   shipped producers (the `F4.103` rule), never from a guess. Every walker of
   the draft learns the new fields: `mergeDraftPatch`, `DRAFT_SECTIONS`,
   `redactDraftForClient`, `redactDraftForLlm`, the caps, the validate service
   and the OpenAPI output. The plan enumerates them by the parse call, not by
   a name search. No migration: the draft is `jsonb`.

   *Dated note, 2026-10-04 (the PR 2 plan, owner rulings Q1 and Q2):*
   - **A stock entry carries patterns.** The shipped stock catalog has no
     source-key pattern on any of its 779 points, and 234 of them are
     required, because the catalog must not guess a site's wiring
     (`stock-catalog/water-wtp.ts`). With `stockCode` only, a chat-imported
     stock template with a required point cannot be instantiated. So a stock
     entry is `{ stockCode, patterns? }`: `patterns` maps a measured point key
     of that entry to a pattern in the shared token grammar, with the column's
     length bound and a count cap. `import_stock_template` collects it, and
     the commit lays it over the catalog body before the create checks run.
     The rest of the content still comes from the catalog module only.
     Validation refuses, before the proposal, a templated asset whose required
     measured point still has no pattern, and names the point.
   - **An authored point is measured only.** An authored entry's points carry
     `pointKey`, `label`, `unit`, `sourceDataKeyPattern`, `required` and
     `sortOrder`, and the commit sets `kind: "measured"`. Derived points
     (formulas and calc timing) and instrument defaults stay on the template
     editor (`F2.5`) as a new version, so the model never writes calc DSL. The
     entry gains an optional `assetType` (the table requires `asset_type`),
     which defaults to the template code.

3. **The tool set grows from 17 to 24 tools.**
   - **Read:** `list_templates` (the organization's published templates: code,
     highest version, domain, point count), `get_template` (one organization
     version or one stock entry: its points, their `sourceDataKeyPattern` and
     the variables they need), `list_stock_templates` (the catalog: code,
     name, domain, point count). Each list goes through `echoedItems` and
     `moreTail`, and each result is cut to 8,000 characters (ADR 0090
     decision 3).
   - **Draft write:** `add_template` (the whole authored body in one call, so a
     template of many points fits the 8-call cap), `import_stock_template`,
     `remove_template` (refused while an asset references it), and
     `add_template_assets` (one template, one `rtuIndex`, and a batch of
     assets, each with `code`, `name`, `siteName` and `sourceDataKeyVars`).
     The existing `remove_asset` removes a templated asset.

   Each argument schema is parsed from the matching element schema of the
   draft, as in ADR 0090 decision 4. Action lines are written by code from
   the validated result, for example `Added template CHILLER-CENTRIF (12
   points)` and `Added 4 assets from WTP-PUMP v2 on RTU-1`.

4. **The commit writes everything in one transaction**, in this order inside
   the existing `withTenant` transaction of `commitWith`: the location, the
   point keys, the RTUs, then each draft template through the create core and
   the publish core, then the plain assets and their asset points, then each
   group of templated assets through the instantiate core, with the RTU ids
   and the location id that the same transaction wrote. Because every core
   reads through `tx`, a point key, an RTU or a template written earlier in the
   same commit is visible to the guards that follow. A failure anywhere rolls
   back the whole commit. Each core writes the audit rows that its route
   writes (`master.asset_template.create` or `.import`,
   `master.asset_template.publish`, `master.asset.instantiate`) inside the same
   transaction, and `master.onboarding.commit` records the extended result.
   The commit result (the shared contract) gains the template ids and the
   counts of templated assets, asset points, seeded rules and dashboards; the
   confirm action line and the web read them. The batch limits of instantiate
   (200 assets, 8,000 point rows, 2,500 rule rows) apply to the sum over the
   commit, and asset-code and rule-code collisions answer the same 409 texts as
   the plain commit and the route.

5. **Access.** The onboarding gate (`admin` or `organization_admin`,
   `canUseOnboarding`) stays the first check. A draft that holds a template
   entry also needs `assertCanAuthor` for the session's organization. The
   instantiate core's `canManageLocation` cannot be checked against a location
   that the same transaction creates; for a location of this commit, the
   organization check (`canManageOrganization` on the session's organization)
   is the check, and the plan gates it with a test. Nothing lets a
   `location_admin` author a template.

6. **An existing code is used, never re-authored.** `add_template` and
   `import_stock_template` refuse a code that the organization already holds in
   any version, or that the draft already holds, and the error names the
   existing versions. `add_template_assets` resolves a code to the draft's own
   entry first, then to the organization's published version (the version
   given, or the highest published). New versions, overlays and the migration
   of existing assets stay on the `F2.5` and `F2.6` surfaces (ADR 0039).
   ADR 0052 decision 4's "re-import opens the next version" does not apply in
   the chat.

7. **Source-key variables.** The agent collects `sourceDataKeyVars` for each
   templated asset. `get_template` tells it which variables each pattern
   needs. Validation refuses, before the proposal, a templated asset whose
   required measured point has a pattern that does not resolve, with the
   variable named, so the instantiate core's 400 is not the first place the
   user learns it. A variable key must be a token of that template's
   patterns, and `asset_code` stays reserved (`@bms/shared`
   `source-key-pattern`).

8. **The proposal names what the commit publishes and creates.** The
   code-written summary of `propose_commit` lists each draft template as `will
   publish <code> v<n> (cannot be edited afterwards)` with its point count, and
   the counts that instantiation will create: templated assets, asset points,
   seeded rules and dashboards. The model is not on the commit path, so it
   cannot publish (ADR 0090 decision 5).

   *Dated note, 2026-10-04 (the closure audit, owner ruling):* this holds for
   the `confirm commit` path, which commits a proposal. The Commit button
   (ADR 0090 decision 5, unchanged) commits the draft with no proposal, so on
   that path the web preview is what names each template, its points and
   their patterns before the publish.

9. **Injection and credential bounds.** `add_template` and
   `add_template_assets` join `CREDENTIAL_CHECKED_TOOLS`: the credential walk
   and the prompt-marker refusal run on every string they carry. Each
   `sourceDataKeyPattern` must match the shared token grammar
   (`SOURCE_KEY_PATTERN_TOKEN`), and a pattern or variable value that
   `looksLikeCredential` is refused. Each refusal path gets its own test and
   its own mutation. `F4.185` (the shared scrub misses short names) stays its
   own row.

   *Dated note, 2026-10-04 (the closure audit, owner ruling):* the build
   checks three template tools, not two: `import_stock_template` also joins
   `CREDENTIAL_CHECKED_TOOLS`, because its `patterns` carry free text. The
   prompt-marker refusal runs on the arguments of every tool, not only these.

10. **Side effects are identical to the Instantiate button.** The onboarding
    commit and the instantiate route call the same instantiate core, so a
    templated asset gets the same pin, telemetry-source meta, asset points,
    seeded rules (in `review`, ADR 0058) and dashboards whichever door made
    it. A test holds that the commit writes no template asset rows of its own.

11. **What stays the same.** The 8-call and 45 s caps, the confirm rule, the
    action-line rule and the logging rule of ADR 0090. The rule-based path
    (`handleRuleBasedTurn`) does not change: it leaves `templates[]` and
    `assets[].template` untouched, and `validate` and `commit` still handle
    them. After a provider error the turn's edits are discarded first (ADR
    0090 ruling 6), so no half-written template survives. `F3.27` owns parity.
    The Excel upload does not learn templates; the plan states what an upload
    does to a draft that holds templates and gates that behavior with a test.
    The web preview (`apps/web/src/lib/onboarding-draft-summary.ts`) gains a
    line per template and per templated asset, with a spec, because the
    formatter has none today.

    *Dated note, 2026-10-04 (the PR 2 review, owner ruling):* "does not
    change" yields to "leaves `assets[].template` untouched" in one place. The
    guided mappings branch wrote its point mapping onto `assets[0]` even when
    that asset was templated, which put an `assetPoints` entry on a templated
    asset and broke a ready all-template draft. The branch now maps onto the
    first asset with no template, and it does not run when every asset is
    templated. Nothing else in `handleRuleBasedTurn` changes; `F3.27` still
    owns parity.

12. **Delivery and verification.** PR 1 is decision 1. PR 2 is decisions 2–11
    and the web preview. Verification: the template-domain integration suites
    unchanged (PR 1); the full suites and a cold start (PR 2); one live turn on
    the OpenRouter provider of `F3.21`; and one water-plant scenario (import a
    stock template, add assets with variables, propose, confirm) in the
    browser through the `browser-verifier` agent, asserted with
    `javascript_tool`.

## Dependencies

None. No new npm package, no migration.

## Consequences

- **A new site with its equipment classes onboards in one conversation.** The
  user names the plant; the agent imports or authors the templates and places
  the assets on the RTUs; one confirm writes all of it.
- **A publish happens inside a chat commit, and it is irreversible.** A
  steered model can propose a template with wrong points. The proposal names
  every publish and the preview shows every point, but the guard is the user
  who reads them. A wrong template needs a new version through the editor.
- **The template services change shape.** Their public behavior does not, and
  PR 1 proves it on the existing suites, but every later change to a guard
  must go into the core, or the chat and the routes diverge.
- **A chat commit can be large.** It can now create templates, seeded rules
  and dashboards. The summed batch limits bound it, and the proposal states
  the counts.
- **A conversation can extend the global point-key catalog** through a template
  that uses a new code (ADR 0051 Amendment 1). The unit and domain
  contradiction refusal still applies.
- **The row may run past its 4–5 estimate.** The refactor, the contract, the
  tools, the commit and the preview are all in it, as ADR 0039 recorded for
  `F2.6`.
- **Deferred:** chat authoring of template content (alarms, KPIs, dashboards);
  template assets on a committed RTU or location, and gateway-less assets;
  new versions and migrations from the chat; rule-based parity (`F3.27`);
  retrieval grounding (`F3.26`, which does not replace the three read tools).

## Amended records

- **ADR 0090 ruling 7 and decision 4** — the tool set gains the seven template
  tools of decision 3 above. The other tools stand.
- **ADR 0090 decision 8** — "the commit transaction … do[es] not change"
  becomes: the commit transaction also writes draft templates and templated
  assets through the template cores (decision 4 above). Its access checks gain
  `assertCanAuthor` for a draft that holds a template entry.
- **ADR 0090 *Consequences*, the *Deferred* bullet** — templates (`F3.22`)
  are no longer deferred.
- **ADR 0015 §8** — "resolves a template by `(organization_id, code,
  version)` using the same get-or-create-by-code loop it already runs for
  `pointKeys`" becomes: an existing code is instantiated at a pinned published
  version and never re-authored, and a new code is created and published by
  the commit (decisions 4 and 6 above). The draft field is
  `assets[].template.code`, not `assets[].templateCode`.
