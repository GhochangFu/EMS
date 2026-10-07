# ADR 0092 — The onboarding agent declares point keys and maps source tags in bulk (`F3.23`)

## Status

Accepted — 2026-10-06. The owner accepted every recommendation of the Track E
decision packet in chat on 2026-10-06. For this row, that is the re-scope and
decisions D1–D6, each as recommended. The same ruling fixed the ADR numbers
(0092 `F3.23`, 0093 `F3.24a`, 0094 `F3.25`, 0095 `F3.26`, ADR 0090
Amendment 2 `F3.27`) and the build order `F3.27` → `F3.25` → `F3.23` →
`F3.26` → `F3.24a`. Each ruling is recorded under *Gate questions*. Items that
the draft plan proposes but the owner did not rule are listed under *Left to
the plan*; they are not rulings of this record.

Implements row `F3.23` (Track E, P0, `docs/BACKLOG.md:606`). Folds in open
row `F4.119` (`BACKLOG.md:774`) and the "Left open" items of `F4.195`
(`BACKLOG.md:850`). Builds on [ADR 0090](./0090-onboarding-agent-tool-calling-loop.md)
and [ADR 0091](./0091-onboarding-agent-asset-templates.md), and amends parts of
both (see *Amended records*). Promotes nothing out of `AGENTS.md` §6: the agent
stays inside the scoped admin onboarding wizard (`AGENTS.md` rule 15).

**Dependency reading.** The row lists `F3.21, F2.7`. `F3.21` (the tool-calling
loop, ADR 0090) closed with PR #705. `F2.7` (the tag-mapping bulk editor,
ADR 0056) closed on 2026-09-07 (`BACKLOG.md:270`, `:463`).

Every line number below is from `main` at `b3bcb26f`.

## Context

**What "tag" means in this repository.** `F2.7` is the "Tag-mapping bulk
editor" (`BACKLOG.md:270`). Its tag is a source data key. The tag table is
`bms.asset_points` (`packages/db/src/schema/bms-schema.ts:384`), which maps a
`source_data_key` to a `point_key` per asset. There is no other asset-tag
column or table; `bms.assets` has only `meta` jsonb.

**What the agent already does** (ADR 0090 decision 4,
`apps/api/src/admin/onboarding/onboarding-agent-tools.ts`):

- The registry (`TOOL_SCHEMAS`, `:142`) holds the point-key tools
  `add_point_key`, `remove_point_key`, `use_existing_point_keys` and
  `list_point_keys` (with `search`), and the mapping tools `map_point`
  (`draftAssetPointSchema`: `assetIndex`, `pointKey`, `sourceDataKey`,
  `sensorCode?`, `unit?`) and `remove_asset_point`. So the row's question loop
  already works on the LLM path, one mapping per call.
- Templated assets (ADR 0091) take their source keys from
  `sourceDataKeyPattern` plus `sourceDataKeyVars`, and validation refuses an
  `assetPoints` entry on a templated asset (ADR 0091 decision 2, V4).
- `unresolvedPointKey` (`onboarding-template-refs.ts:102`) and the fleet
  catalog in `ctx.templates.pointKeys` (code → active, read once per turn,
  `F4.196`) already exist.

**The gaps.**

1. **No tool-time check on a mapping.** `map_point` (`:447`) only appends. It
   does not check that the asset exists or is plain, that the point key
   resolves, or that the row is a duplicate.
2. **No validation of the key or of duplicates.** The `assetPoints` block of
   `OnboardingValidateService` (`onboarding-validate.service.ts:229-252`)
   checks the shape, the index range and the templated asset only. It never
   runs `unresolvedPointKey` on a mapping.
3. **So a ready proposal can fail at commit.** The commit inserts each mapping
   with no pre-check (`onboarding-commit.service.ts:527-548`).
   - An undeclared key raises the foreign key `asset_points_point_key_point_keys_code_fk`
     (`23503`), which answers 500. This is open row `F4.119`. The scope
     analysis records that `assertPointKeysActive` covers template points only.
   - A duplicate `(asset, pointKey)` or `(asset, sourceDataKey)` is caught
     only as `23505` and answers 409 through `COMMIT_UNIQUE_CONFLICTS`
     (`onboarding-commit-conflict.ts:277-295`). The constraints are
     `asset_points_asset_id_point_key_unique` and
     `asset_points_asset_source_key_idx`
     (`packages/db/drizzle/0015_phe_ingestion_catalog.sql:33`, `:42`). The
     source-key index is on the raw column, with no `lower()`.
4. **No bulk path before commit.** `MAX_TOOL_CALLS_PER_TURN = 8`
   (`onboarding-agent-loop.ts:24`), so a plain asset with 40 points needs at
   least 5 turns. The Excel upload carries the location, the RTUs and the
   assets only, with no mappings or point keys
   (`onboarding-excel.service.ts:393-416`).
5. **The `F4.195` leftovers.** `use_existing_point_keys` does not check that
   the catalog holds `kw`, and the point-key action lines echo the code without
   `quoteCell` (`BACKLOG.md:850`). The `map_point` action line also embeds raw
   model strings (`onboarding-agent-tools.ts:453`).
6. **No source-key discovery.** The scope analysis records that no store of
   seen source keys exists: ingest only counts `unmappedSourceKey` per batch
   (`apps/ingest/src/host/normaliser.ts`), and a draft RTU has no `bms.rtus`
   row, so its samples drop as `unknownDevice`.
7. **The guided path maps one fixed sample.** `onboarding-chat-rule-based.ts`
   adds only the key `kw` (`:411`) and maps only `s09_r01` → `kw` (`:492`).

**What the other surfaces own.** The `F2.7` mapping sheet and the asset-points
`PATCH`, bulk-update and metadata routes edit committed rows only, and own the
point metadata (`scale_multiplier`, `scale_offset`, `eng_min`, `eng_max`,
`quality_policy`). The columns exist, and `pointMetadataBodyShape` and
`refinePointMetadata` are exported
(`apps/api/src/admin/asset-points/point-metadata.schema.ts:44`, `:96`).

## Re-scope

The row text reads "Agent onboards parameters (point keys) + asset tags and
maps source↔tag via Q&A". The owner accepted this narrower row:

> The agent declares point keys and maps source tags on **plain draft
> assets**, correctly and in bulk, through question-driven turns.

The effort moves from 3–4 to about 2, because the base tools exist. No
migration: the draft is `jsonb`.

## Gate questions

1. **D1 — What is a "tag", and where may the agent write mappings?** Options:
   draft only, where a tag is the `sourceDataKey` on a plain draft asset; draft
   plus committed assets through the `F2.7` services; a new asset-tag (label)
   concept. **Ruled as recommended: draft only.** The row depends on `F2.7`,
   whose tag is the source data key. The draft-only target keeps ADR 0090
   ruling 1: one transaction, the hash-bound proposal and the server-side
   confirm. Rejected: the `F2.7` services write committed rows in their own
   transactions, outside the draft, hash and confirm model, so the second
   option changes ADR 0090 ruling 1 and needs a transaction-aware refactor like
   ADR 0091 PR 1; ADR 0091 deferred the same for templates. A label concept
   needs a migration, a new module surface and its own ADR, and nothing in
   `F2.7` or in the row points to it.
2. **D2 — How do many mappings and point keys fit the 8-call cap?** Options:
   add the batch tools `map_points` and `add_point_keys` and keep the single
   tools; widen `map_point` and `add_point_key` to take an array; no batch;
   raise `MAX_TOOL_CALLS_PER_TURN`. **Ruled as recommended: add the two batch
   tools and keep the single tools.** This follows the `add_template_assets`
   precedent (ADR 0091 decision 3). Rejected: an array-or-row argument is a
   union and breaks ADR 0090 decision 4 (each argument schema is parsed from
   the matching element schema); no batch keeps today's 5 turns for 40 points;
   the 8-call and 45 s caps are ADR 0090 decision 3, which ADR 0091 decision 11
   kept, and a higher cap raises the cost per turn while the 45 s deadline still
   binds.
3. **D3 — Which mapping checks, and do `F4.119` and the `F4.195` leftovers
   fold in?** Options: fold both in, with one predicate for the tool and the
   validator; validator only; leave `F4.119` separate and add tools only.
   **Ruled as recommended: fold both in, one predicate.** Batch writes make the
   500 and the late 409 easier to reach, because one call can write many bad
   rows. Rejected: a validator-only check tells the model about a bad row only
   after `validate_draft`, which costs calls, and `F4.196` made the tool and the
   validator use one rule for this reason; leaving `F4.119` separate leaves a
   ready proposal that fails at commit.
4. **D4 — Does a draft mapping carry the `F2.7` point metadata?** Options: no,
   `unit` and `sensorCode` only; yes, add the five fields. **Ruled as
   recommended: no.** The `F2.7` sheet and the metadata `PATCH` set them after
   commit. Rejected: the five fields are a shared contract change, and every
   walker of the draft (`mergeDraftPatch`, the redaction walkers, the caps, the
   prompt shedding of `F4.107`, the OpenAPI output and the web preview) must
   learn them, which roughly doubles the row.
5. **D5 — Where do the source tags come from, and who suggests the keys?**
   Options: a model-led question loop from a typed or pasted tag list; a
   deterministic suggester read tool; discovery from the RTU's live telemetry
   before commit; a mappings sheet in the onboarding Excel upload. **Ruled as
   recommended: a model-led question loop from a typed or pasted tag list**,
   with no new suggester code. Rejected: a suggester that ranks catalog codes is
   retrieval, which `F3.26` owns; live discovery is not buildable, because a
   draft RTU's samples drop as `unknownDevice` and no key store exists, so it
   needs `F3.24` discovery and a migration; an Excel mappings sheet needs new
   parsing beside `parseUpload` and a frozen-header decision like `F2.28`.
6. **D6 — Does `F3.23` change the guided (rule-based) path?** Options: no
   guided change, `F3.27` owns parity; add guided grammar now (`add key <code>
   <unit>`, `map <tag> to <key>`). **Ruled as recommended: no new guided
   grammar; `F3.27` owns parity.** This follows ADR 0091 decision 11.
   Rejected: guided grammar here duplicates `F3.27` and grows a 599-line file
   toward the 1,000-line cap of `AGENTS.md` §4.5.

## Decision

1. **Scope: plain draft assets only (D1).** `F3.23` writes
   `draft.pointKeys`, `draft.assetPoints` and
   `onboardingMeta.useExistingPointKeys` only. The confirmed commit writes them,
   as it does today. Mapping onto a committed asset or location stays on the
   `F2.7` mapping sheet. A templated asset takes no mapping (ADR 0091 V4
   stands).

2. **One mapping predicate, at tool time and in validation (D3).** One
   function decides whether a mapping will commit. A row is refused when:
   - its `assetIndex` names no asset, or names a templated asset;
   - its `pointKey` does not resolve through `unresolvedPointKey` against the
     keys the draft declares plus `ctx.templates.pointKeys`;
   - its `(assetIndex, pointKey)` pair is already in the draft or earlier in
     the same batch;
   - its `(assetIndex, sourceDataKey)` pair is already in the draft or earlier
     in the same batch. The comparison is exact, with no case folding, because
     `asset_points_asset_source_key_idx` is on the raw column.

   `map_point`, the new `map_points`, `remove_point_key` (a key that a
   mapping still uses) and the `assetPoints` block of
   `OnboardingValidateService` all call this function. The error texts are the
   texts that already exist: `assetIndex out of range`, the ADR 0091 V4
   sentence, the sentence of `unresolvedPointKey`, and the two
   `COMMIT_UNIQUE_CONFLICTS` sentences, so the user reads the same words at
   every layer. A proposal that reads `readyToCommit` therefore cannot fail at
   commit as `23503` (500) or `23505` (409) on a mapping. This closes `F4.119`.

3. **The `F4.195` leftovers (D3).** `use_existing_point_keys` with
   `value: true` is refused when `ctx.templates.pointKeys` holds no active
   `kw`. The action lines of `add_point_key`, `remove_point_key`, `map_point`
   and `remove_asset_point` pass every model-supplied string through
   `quoteCell`.

4. **Two batch write tools; the single tools stay (D2).**
   - `add_point_keys` takes a bounded array of point keys.
   - `map_points` takes one `assetIndex` and a bounded array of mapping rows
     (`pointKey`, `sourceDataKey`, `sensorCode?`, `unit?`).

   Each element is parsed with the matching element schema of the draft
   (`draftPointKeySchema`, `draftAssetPointSchema`), as ADR 0090 decision 4
   requires. Each call is all-or-none: one bad element refuses the whole call,
   and the error names the element. Each successful call writes one action
   line, written by code from the validated result with `quoteCell`. Each
   write goes through `write()`, so `draftCountProblem` keeps the draft caps
   (`MAX_ONBOARDING_POINT_KEYS` 500, `MAX_ONBOARDING_ASSET_POINTS` 5,000,
   `packages/shared/src/contracts/onboarding.ts:500`, `:512`). Both tools join
   `CREDENTIAL_CHECKED_TOOLS` (`onboarding-agent-tools.ts:89`), so every string
   they carry gets the credential walk.

5. **The question loop is a system-prompt section (D5).** `buildSystemPrompt`
   (`onboarding-agent-loop.ts:84`) gains a section that tells the agent to:
   - ask for the RTU's tag list, or take a pasted list;
   - match the tags with `list_point_keys` search;
   - show the proposed mapping table in text;
   - write with `add_point_keys` and `map_points` only after the user says yes;
   - say which keys are new to the catalog.

   This "yes" is a prompt instruction. No server code checks it. Under ADR
   0090 ruling 4, server code checks only the commit confirm. The guards before
   master data stay the code-written action lines, the preview, and the
   hash-bound `confirm commit` or the Commit button. The question loop uses
   the code-filtered suggested-reply primitive that ADR 0094 (`F3.25`) adds,
   because `F3.25` is built first (see decision 7).

6. **No new guided grammar (D6).** `handleRuleBasedTurn` gains no point-key
   or mapping command, and keeps its fixed `kw` and `s09_r01` sample. Because
   `F3.27` is built first and sends guided writes through `runTool`, the
   decision 2 and 3 checks on `map_point` and `use_existing_point_keys` also
   apply to a guided write. That is intended: the guided path then refuses what
   the commit would refuse. `F3.27`'s scripted guided-session spec is the
   regression gate for this. The two new tools go into `F3.27`'s tool-coverage
   map as agent-only, with a reason that names `F3.23`.

7. **Build order and the rows built before this one.** The owner fixed the
   order `F3.27` → `F3.25` → `F3.23` → `F3.26` → `F3.24a`. So:
   - `F3.23` passes the tool-coverage spec that `F3.27` adds;
   - `F3.23` reuses the reply primitive of ADR 0094 and does not build its own;
   - ADR 0094 makes one step equal one chat turn that changes the draft (its
     D2), so an undo removes a `map_points` or `add_point_keys` batch together
     with the rest of the turn that wrote it;
   - ADR 0094 keeps the ADR 0090 commit model (its D1), so the batch tools stay
     draft-only and need no other change for it.

8. **What stays the same.** ADR 0090 ruling 1, the caps of decision 3 (8
   calls, 45 s), the confirm rule of decision 5 and the action-line rule of
   decision 6. The commit transaction and `onboarding-commit.service.ts` do not
   change: the predicate matches the constraints the commit already hits. No
   change to `packages/db`. The Excel upload does not learn mappings. The unit
   and domain contradiction between a declared key and the catalog
   (`pointKeyConflictMessage`) stays a refusal at commit; D3 does not include
   it.

   *(Amended 2026-10-07, `F4.225`: the tools and the validator now refuse
   this contradiction too, with the predicate the commit uses. The template
   context carries the catalog unit and domain of each key
   (`pointKeyFields`). The commit keeps its in-transaction comparison.)*

## Left to the plan

The draft plan proposes these items. The owner did not rule them on
2026-10-06. The plan states each one, and the owner rules it when the plan is
approved:

- **The batch caps.** The plan proposes 100 keys per `add_point_keys` call
  (`TOOL_LIST_MAX_ITEMS`) and 200 rows per `map_points` call (as
  `MAX_ONBOARDING_TEMPLATE_POINTS`). The draft caps bind in all cases.
- **A focused read `get_asset_points { assetIndex }`.** The scope analysis
  marks it optional. It exists because `get_draft` is cut at 8,000 characters
  (ADR 0090 decision 3), so a large draft can hide its own mappings.
- **A tool-time check of the unit and domain contradiction.** It needs unit
  and domain in `ctx.templates.pointKeys`, which holds code → active only. The
  plan proposes a separate P3 row; until then it is a known late refusal
  (decision 8).
- **Whether `add_point_keys` refuses a code the draft already declares** while
  `add_point_key` keeps today's tolerance, or whether both align.
- **The proposal summary** naming how many declared keys are new to the
  catalog (`commitSummary`).
- **A static invariant under `tests/`** that the validator and the tools call
  the one predicate.
- **The tool count.** This record adds two write tools (three with
  `get_asset_points`). `F3.25` may add a tool first, so the plan states the
  absolute count at build time and edits the assertions that pin it.

## Open boundary — `F3.26` decision D4

The accepted packet rules for `F3.26` (D4) that "F3.23 reads the point level"
of committed asset points, and `F3.26` reads summaries only. This record adds
no read of a committed asset's points: its scope is draft-only (decision 1),
and none of D1–D6 adds such a read. ADR 0095 decision 6 reads the boundary the
same way: point-level detail belongs to `F3.23` for draft assets and to the
`F2.7` mapping sheet for committed assets, and no chat tool reads a committed
asset's points. The packet's D4 wording and this record differ, so the owner
confirms that reading. Until a later row rules otherwise, the `F2.7`
mapping-sheet export is the read path for committed mappings.

**Owner rulings at the PR gate, 2026-10-07** (on #757, in chat). Plan
questions Q1–Q9 are accepted as recommended. The credential walk does not
cover `add_point_key` and `map_point`; the owner accepted this as built, so
decision 4 stays as written.

## Dependencies

None. No new npm package, no migration, no contract change in
`packages/shared`.

## Consequences

- **A plant's tag list onboards in one or two turns.** The user pastes the
  tags, checks one proposed table, says yes, and the agent writes the keys and
  the mappings in a few calls.
- **A ready proposal no longer fails at commit on a mapping.** The tool, the
  validator and the commit apply one rule. `F4.119` closes with this row.
- **Batch writes widen prompt-injection reach.** One steered call can write
  many wrong mappings or new catalog keys. The bounds are the credential walk
  (`CREDENTIAL_CHECKED_TOOLS`), code-written action lines with `quoteCell`,
  the preview of every row before the confirm, and the user who reads them.
- **A conversation can extend the global point-key catalog** in bulk at commit
  (ADR 0051 Amendment 1). The unit and domain contradiction refusal still
  applies, at commit only.
  *(Amended 2026-10-07, `F4.225`: the tools and the validator refuse it as
  well; the commit check stays.)*
- **The guided path refuses more.** After `F3.27`, a guided `map_point` or
  `use_existing_point_keys` that the commit would refuse is refused at the
  tool. This is a behavior change on the guided path, with no new grammar.
- **Every new tool adds to the `F3.27` coverage map**, and to the tool-count
  assertions.
- **Large drafts.** Up to 5,000 mappings strain the 8,000-character cut of
  `get_draft` and the prompt shedding of `serialiseDraftForPrompt` (`F4.107`).
  The focused read (*Left to the plan*) is the proposed answer.
- **Deferred:**
  - mapping onto committed assets or locations (stays on the `F2.7` sheet);
  - live tag discovery (`F3.24b`, which waits for `F1.4` or `F1.5`, plus a key
    store);
  - suggestion and ranking of point keys (`F3.26`);
  - point metadata in the draft (a later row, if a site needs scaling at first
    commit);
  - per-point overrides on templated assets (ADR 0091 V4);
  - a mappings sheet in the Excel upload;
  - guided-mode point-key and mapping grammar;
  - the adjacent rows `F2.28` (`sensor_code` is not a mapping-sheet column) and
    `F2.29` (`sourceDataKeyVars` not persisted), which stay their own rows.

## Amended records

- **ADR 0090 ruling 7 and decision 4** — the tool set gains `add_point_keys`
  and `map_points` (decision 4 above). `map_point`, `remove_point_key` and
  `use_existing_point_keys` gain the checks of decisions 2 and 3. The other
  tools stand.
- **ADR 0091 decision 3** — "the tool set grows from 17 to 24 tools" is no
  longer the current count. The plan states the count at build time (*Left to
  the plan*).
- **ADR 0091 decision 9** — `CREDENTIAL_CHECKED_TOOLS` gains `add_point_keys`
  and `map_points`.
- **ADR 0090 *Consequences*, the *Deferred* bullet** — point-key and mapping
  Q&A (`F3.23`) is no longer deferred.
- **Confirmed unchanged:** ADR 0090 ruling 1, decision 3 (the caps), decision
  5 (the model cannot commit) and decision 6 (action lines written by code);
  ADR 0091 decision 2's V4 rule (no `assetPoints` entry on a templated asset)
  and decision 11 (`F3.27` owns parity); ADR 0056 (`F2.7`), which keeps the
  committed mappings and the point metadata.
