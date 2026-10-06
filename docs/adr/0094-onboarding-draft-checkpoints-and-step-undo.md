# ADR 0094 — Draft checkpoints, step undo and step confirms for the onboarding chat (`F3.25`)

## Status

Accepted — 2026-10-06, before any implementation code. The Track E decision
packet (Phase A, 2026-10-06, read-only on `origin/main` `b3bcb26f`) put seven
scope decisions for this row, each with options and a recommendation. On
2026-10-06 the owner accepted every recommendation of the packet in chat. The
rulings below are those recommendations. The owner did not rule the questions
one at a time, and this written text is the record of the accepted
recommendations, not a separately approved draft.

The same ruling fixed the Track E numbering and build order:
`F3.27` (ADR 0090 Amendment 2) → `F3.25` (this record) → `F3.23` (ADR 0092)
→ `F3.26` (ADR 0095) → `F3.24a` (ADR 0093). The scope analysis proposed the
title "ADR 0090 Amendment 2" for this row. That amendment now belongs to
`F3.27`, so this row is a standalone record and amends ADR 0090 only where
*Amended records* says.

Implements row `F3.25` (Track E, Wave 3, P1, estimate 3–4, 3 PRs). Builds on
[ADR 0090](./0090-onboarding-agent-tool-calling-loop.md) (with Amendment 1)
and [ADR 0091](./0091-onboarding-agent-asset-templates.md). Keeps
[ADR 0022](./0022-onboarding-credential-capture.md) and the ADR 0062
credential rules unchanged. Promotes nothing out of `AGENTS.md` §6: the work
stays inside the scoped admin onboarding wizard (`AGENTS.md` rule 15). It adds
one nullable column, so it is a schema change under `AGENTS.md` §9.4 and §10.

**Dependency reading.** The row lists `F3.21`. `F3.21` (ADR 0090) closed with
PR #705. The owner's build order puts `F3.27` first. `F3.27` adds a
tool-coverage spec that every later Track E row must pass, so this row's
changes to the tool set and the guided path must pass it.

## Context

**What the row asks.** The original row text
(`docs/archive/pending-features.md:149`) reads "Interactive, question-driven
UX with per-step confirm + rollback (beyond current all-at-once commit)". That
text predates ADR 0090. ADR 0090 rulings 1 and 4 then fixed the all-at-once,
server-confirmed commit, and ADR 0090 re-framed this row as "per-step confirm
and rollback on top of the action lines" (`0090-onboarding-agent-tool-calling-loop.md:253`).
That is a draft-level feature, not a master-data one.

**The commit model today** (`apps/api/src/admin/onboarding/`, ADR 0090
decisions 4 and 5):

- The tools edit an in-memory copy of the draft
  (`onboarding-agent-loop.ts:141`, `runTool` at `:206`). `diffSections`
  (`:115`) returns the changed sections wholesale. There are seven sections:
  `location`, `rtus`, `pointKeys`, `assets`, `assetPoints`, `templates` and
  `onboardingMeta` (`DRAFT_SECTIONS`, `:62`).
- `OnboardingService.chat` writes the session row once per turn, with no
  `FOR UPDATE` and no version check (`onboarding.service.ts:335-347`).
  `patchDraft` and `uploadExcel` write the same way.
- `propose_commit` binds a proposal to `draftHash`. `mergeDraft` clears the
  proposal on every write (`onboarding-chat.service.ts:442`).
- The exact phrase `confirm commit` is matched by code before any model call
  (`onboarding.service.ts:244`, `isConfirmCommitPhrase` in
  `onboarding-commit-proposal.ts:65`). The commit is one `withTenant`
  transaction (`onboarding-commit.service.ts:304`) that inserts in foreign-key
  order with audit rows.

**Rollback today is only implicit.**

- A `provider_error` discards the whole turn
  (`onboarding-agent-loop.ts:168-170`).
- The user can repair the draft by hand through `PATCH sessions/:id/draft`
  (`onboarding.service.ts:367`). The arrays replace wholesale, and
  `inferPhase` re-derives the phase.
- No draft history, checkpoint, undo route or undo phrase exists.
  `bms.onboarding_sessions` (`packages/db/src/schema/bms-schema.ts:650`) holds
  `draft`, `messages`, `current_phase`, `status` and `result`, and nothing
  else that could hold a history.

**Per-step confirm today is guided-mode only.** `CONFIRM_STEP_REPLIES`
(`F4.199`, `onboarding-chat-rule-based.ts:111-116`) and `confirmStepTurn`
(`:539`) answer `confirm rtu`, `confirm point keys`, `confirm assets` and
`confirm mappings`. They change nothing and only report the step state from
`inferPhase`. The agent path has no step confirm. It hardcodes
`suggestedReplies` to `["View draft"]` (`onboarding-chat.service.ts:354`).

**Question-driven UX today.** The system prompt says "ask the user when
unsure" for the location type only (`onboarding-agent-loop.ts:93`). The model
has no structured question or reply-chip primitive. `F3.23` and `F3.24` both
need one, so the row that builds it first defines it for the others.

**Messages and phases.** Each message has an `id` (`randomUUID`,
`onboarding-chat.service.ts:482`). Code writes the `action` lines, but no
action line links to a checkpoint. The phases are `location`, `rtu`,
`point_keys`, `assets`, `mappings` and `review`
(`packages/shared/src/contracts/onboarding.ts:18`). Templates are not a phase.
The phase is inferred from the draft. It is not recorded as transitions.

**Constraints on any new state inside the draft.**

- `draftHash` strips only `_commitProposal`
  (`onboarding-commit-proposal.ts:70,107`).
- `redactDraftForClient` deletes only `_secrets` and `_commitProposal` by
  name (`onboarding-redaction.ts:234-238`). `redactDraftForLlm` composes it.
- `MAX_ONBOARDING_DRAFT_DEPTH = 10` (`onboarding.schema.ts:335`). Past it,
  `draftHash` returns null.
- `mergeDraftPatch` merges `location` and `onboardingMeta` field by field
  (`onboarding-draft-merge.ts:19-35`). An inverse patch through it cannot
  remove a field that a step added.
- `reconcileSecrets` drops orphaned `_secrets` entries
  (`onboarding-chat.service.ts:459`). `credential-rotation.service.ts` does
  not touch onboarding drafts.
- `F4.185` (open) records that the shared scrub is narrow. Any new hidden
  state that holds RTU `config` inherits that gap unless it never reaches the
  client or the prompt.

**After commit.** No `@Delete` route exists for locations, RTUs or assets in
`apps/api/src/admin`. ADR 0091 records that a template publish inside a chat
commit is irreversible (`0091-onboarding-agent-asset-templates.md:316`).

**Shipped overlap.** The `F4.199` step labels are a label-only per-step
confirm. The `F3.21` per-turn discard on `provider_error` and the `PATCH`
draft editor are partial rollbacks. ADR 0091's proposal, which names every
publish, is the only guard for an irreversible publish.

## Re-scope

`F3.25` is narrowed to **draft-level step rollback plus step confirms. The
ADR 0090 commit model does not change.**

1. Each chat turn that changes the draft records a checkpoint of the seven
   draft sections, taken before the write.
2. The user can undo the last step, or roll back to a named checkpoint. The
   rollback restores the sections wholesale, keeps the current `_secrets`,
   reconciles them, re-derives the phase, clears any commit proposal and
   appends a code-written `action` line.
3. The entry points are code-only and work in both modes: a hash-bound route
   with a web Undo control, and the exact phrase `undo`. The model has no undo
   tool.
4. Per-step confirm becomes the `F4.199` step labels, offered on the agent
   path too. No tool is gated.
5. A small, code-filtered suggested-reply primitive for the agent replaces the
   hardcoded `["View draft"]`. `F3.23` and `F3.24a` reuse it.

Out of scope: per-step commit to master data, rollback after commit, staged or
pending edits, redo, and checkpoints for the Excel upload, `PATCH` draft or
credentials.

## Gate questions

1. **What does rollback act on?** Options: the session draft, with the commit
   model unchanged; staged per-turn edits (a pending layer that the user
   accepts or rejects before apply); per-step commit to master data with
   rollback of committed rows. **Ruled as recommended: the session draft
   only.** The commit stays one transaction on the Commit button or on
   `confirm commit`, bound to the draft hash.
   - *Staged edits* rejected: it reverses ADR 0090 decision 4 ("the turn
     writes the session row once") and the decision 3 cap rule (`cap_time`
     keeps the edits). `finalizeTurn`, `draftHash`, `redactDraftForClient` and
     the web preview would all need a two-layer model. It changes rulings, not
     only adds to them.
   - *Per-step commit* rejected: it is not buildable as stated. It reverses ADR
     0090 rulings 1 and 4. No delete route or service exists for locations,
     RTUs or assets. A template publish inside the commit is irreversible (ADR
     0091). A partial commit cannot be rolled back after its transaction ends.

2. **What is one step?** Options: one chat turn that changes the draft, in
   either mode; one draft-writing request (chat, Excel upload, `PATCH` draft);
   one tool call (one action line); one wizard phase. **Ruled as recommended:
   one chat turn that changes the draft, in agent or guided mode.** It is the
   unit the user sees: one message, its action lines and one reply. It has one
   capture point that exists now, and both modes write through it.
   - *Per request* rejected for now: it is buildable, but `uploadExcel` also
     attaches encrypted credentials, and nobody ruled the upload and `PATCH`
     in. They can be added later without a change to the model.
   - *Per tool call* rejected: the guided path has no tool calls, so the unit
     differs by mode (an `F3.27` parity gap). Storage grows up to eight times
     per turn, and no action line links to a snapshot today.
   - *Per phase* rejected: the phase is inferred, not stored as transitions.
     Templates are not a phase, and one agent turn can span several phases, so
     a phase checkpoint can hold unrelated edits.

3. **Where are checkpoints stored?** Options: a hidden `_checkpoints` key
   inside `onboarding_sessions.draft` (no migration); a new nullable `jsonb`
   column `onboarding_sessions.checkpoints`; a new table
   `onboarding_session_checkpoints`. **Ruled as recommended: the new nullable
   `jsonb` column, as a ring of the last 10 checkpoints.** This needs a
   migration.
   - *In-draft key* rejected: it threads through three rules that each fail
     silently. `draftHash` must strip it, or every proposal goes stale.
     `redactDraftForClient` must delete it by name, or `GET /sessions/:id`,
     `validate` and the prompt receive old RTU configs. A snapshot adds two or
     three levels of depth above `rtus[].config`, so the depth bound of 10 can
     make `draftHash` return null.
   - *New table* rejected: it needs its own RLS policy with `FORCE`, the ADR
     0045 role privileges, and a write inside the turn's `withTenant`
     transaction. That is the heaviest option, with no gain at a bounded ring.

4. **How are credentials handled on a rollback?** Options: restore the
   sections only, keep the current `_secrets`, then run `reconcileSecrets`;
   snapshot and restore `_secrets` too. **Ruled as recommended: the sections
   only.**
   - *Snapshot `_secrets`* rejected: a rollback could bring back a credential
     that the user deliberately replaced. The extra ciphertext copies are
     outside `credential-rotation.service.ts`, so old key versions would
     outlive a rotation.

5. **How is a rollback started?** Options: a route `POST sessions/:id/rollback`
   with a web Undo control, bound to the checkpoint id and the current draft
   hash; the exact chat phrase `undo`, matched by code before the model; a
   model tool `undo_last_step`; both the route and the phrase. **Ruled as
   recommended: both the hash-bound route with the Undo control and the exact
   phrase `undo`. The model has no undo tool.**
   - *Model tool* rejected: a prompt-injected model could undo silently. The
     tool does not exist in the guided mode (an `F3.27` gap), and it counts
     against the eight calls per turn.
   - *Route only* or *phrase only* rejected: the route covers the race on the
     unlocked `chat` write. The phrase gives guided-mode parity at no cost.

6. **What does per-step confirm mean on the agent path?** Options: labels only,
   the `F4.199` `confirm <step>` replies offered on the agent path too;
   server-recorded step confirmations that gate the write tools; confirm as
   Keep or Undo on each turn. **Ruled as recommended: labels only.** A label
   changes no state, and no tool is gated.
   - *Server-recorded gate* rejected: it needs a contract change to
     `onboardingMeta` and its strict tool parse. It breaks multi-section agent
     turns ("add an MQTT RTU with two meters"), templates (not a phase) and the
     Excel upload (which fills every section at once). The guided path would
     need the same gate for parity.
   - *Keep or Undo* rejected: Undo is decision 5's route already, and Keep is
     a no-op with no server write.

7. **Where does the question-driven half of the row go?** Options: a small
   reply primitive in this row, reused by `F3.23` and `F3.24a`; the Q&A
   entirely in `F3.23` and `F3.24a`; a prompt-only instruction to ask one
   question per turn. **Ruled as recommended: a small code-filtered
   suggested-reply primitive here.**
   - *Q&A in the topic rows* rejected: two rows would each invent a reply
     mechanism.
   - *Prompt only* rejected: nothing enforces it, and the replies stay
     `["View draft"]`.

## Decision

1. **The ADR 0090 commit model does not change.** Every draft edit still
   applies to the draft at once. The commit stays one transaction, started by
   the Commit button or by `confirm commit`, bound to the draft hash. Nothing
   in this row writes, changes or deletes master data.

2. **A new column `bms.onboarding_sessions.checkpoints jsonb`, nullable,** in
   the next free migration. The table already has `ENABLE ROW LEVEL SECURITY`
   (`packages/db/drizzle/0040_rls_on_org_bearing_tables.sql:18`) and `FORCE ROW
   LEVEL SECURITY` (`0041_bms_owner_and_force_rls.sql:136`). The column is written in the same `set({...})` as `draft`,
   so it shares the turn's single `withTenant` update. `packages/db`
   `bms-schema.ts` gains the matching nullable column.

3. **What a checkpoint holds.** An id, a sequence number, the time, a bounded
   label, the id of the user message of the turn, and a copy of the seven draft
   sections as they were before the turn. It never holds `_secrets` or
   `_commitProposal`. A stored value that does not parse is read as an empty
   ring (fail closed). The ring holds at most **10** checkpoints. When it is
   full, the oldest one leaves.

4. **Capture.** `OnboardingService.chat` records one checkpoint when the
   turn's `draftPatch` is not empty, in agent and guided mode. A turn that
   changes nothing records none. The Excel upload, `PATCH` draft, the
   credential route and the commit record no checkpoint.

5. **Restore.**
   - The rollback assigns each of the seven sections wholesale from the
     checkpoint. A section that is absent in the checkpoint is removed. It does
     not go through `mergeDraftPatch`, because that keeps a `location` or
     `onboardingMeta` field that the undone step added.
   - It keeps the current `_secrets`, then runs `reconcileSecrets`. A
     credential blob of an RTU that is absent after the restore is dropped. A
     restored RTU whose blob was dropped shows `credentialsSet: false`, and
     the reply names the RTU codes whose credential the user must enter again.
   - It clears `_commitProposal` and re-derives the phase with `inferPhase`.
   - It appends a code-written `action` line, `Undid: <label>`, so that the
     model history does not reason about edits that no longer exist.

6. **Entry points, code only, in both modes.**
   - `POST /api/v1/admin/onboarding/sessions/:id/rollback`, with a strict body
     that carries the checkpoint id and the draft hash that the client last
     saw. The server answers **409** when the stored draft's hash differs, and
     writes nothing. This also covers the race with the unlocked `chat` write.
     The route uses `loadSession`, so the existing access gates apply. (Plan
     detail: an unknown checkpoint id answers 404.)
   - The web chat page gains an Undo control that lists the checkpoints and
     calls the route. (Plan detail: a 409 tells the user that the draft
     changed elsewhere and reloads the session.)
   - The exact phrase **`undo`** (after trim and lower-casing, as `confirm
     commit`) undoes the last checkpoint. Code matches it in `chat` after the
     ADR 0022 credential refusal and beside `isConfirmCommitPhrase`, before any
     model call. With an empty ring the reply is that there is nothing to undo,
     and the draft does not change. A typed phrase carries no hash, so it can
     undo a step that another tab made. The route is the hash-bound path.
   - No model tool undoes a step.

7. **Checkpoints never reach the client or the prompt.** The column and the
   stored sections are never returned by `mapSession`, never sent in a
   response and never put in the prompt. This keeps old RTU `config` values
   out of the `F4.185` gap. The scope analysis worded this as "`mapSession`
   does not return it". The Undo control of decision 6 needs a list to choose
   from, so the client receives a derived list of summaries only (id,
   sequence, label, time). How the list reaches the client is a plan point
   (*Left to the plan*).

8. **Step confirms.** The `F4.199` `confirm <step>` labels are answered by
   `confirmStepTurn` in both modes. A label never reaches the model, changes
   no state, and gates no tool. The agent path offers the step labels for the
   current phase, as the guided path does. (Plan detail: the match moves from
   `handleRuleBasedTurn` to `handleTurn`, before the mode choice.)

9. **The suggested-reply primitive.** The agent can offer a small number of
   suggested replies. Code bounds their count and length, removes duplicates,
   and drops any reply that `looksLikeCredential`. It also drops the two
   acting phrases, **`confirm commit` and `undo`**, so that a model-written
   chip cannot start a commit or a rollback when the user clicks it. Code then
   adds the step labels of decision 8 and `View draft`. The result replaces
   the hardcoded `["View draft"]`. The web filter `offeredReplies`
   (`apps/web/src/pages/admin/onboarding-chat-page.tsx:113-118`) drops only
   `confirm commit`, so the server filter is the guard for `undo`, and the web
   filter stays as defence in depth. `F3.23` and `F3.24a` reuse this primitive
   for their questions.

## Left to the plan

The packet's accepted recommendations do not settle these points. The plan
names each as a question and gates the answer with a test:

- **How the client learns the draft hash and the checkpoint list.** Decision 6
  binds the route to the draft hash, not to `updatedAt`. The draft plan adds
  `draftHash` and a strict checkpoint-summary array to
  `onboardingSessionDtoSchema`, filled by `mapSession`. Strict, so that a
  leaked `sections` key fails the web's runtime parse.
- **A byte bound on the ring.** Decision 3 bounds the ring by count (10). The
  draft limits allow 5,000 asset points per draft, so one snapshot can be large.
  Whether to add a byte bound is open.
- **What `PATCH` draft and the Excel upload do to the ring.** The draft plan
  records nothing and clears nothing. A later rollback then overwrites a
  `PATCH` made after that turn, and the hash binding tells the client.
- **Whether a rollback records its own checkpoint (redo).** The draft plan says
  no, and cuts the ring to the entries before the restored one.
- **Whether the reply primitive is a tool or a reply field.** The draft plan
  adds a 25th tool, `suggest_replies`. A field on the provider's final reply
  is the alternative.

Plan details, not rulings, are marked "(Plan detail: …)" under *Decision*.
One more: the draft plan nulls `checkpoints` when the commit closes the
session, because the snapshots hold RTU `config`.

## Dependencies

No new npm package. One migration: a nullable `jsonb` column on an existing
tenant table. `migration-reviewer` joins the reviews of the PR that adds it.

## Consequences

- **The user can take back a wrong step.** A steered or mistaken agent turn
  is undone with one click or the word `undo`. ADR 0090 recorded that prompt
  injection is bounded, not removed. This row adds the per-step way back that
  ADR 0090 left to `F3.25`.
- **The session row grows.** Up to ten copies of the draft sections live in the
  same row that every turn reads. The ring is bounded by count. A byte bound
  is a plan question.
- **A restored credentialed RTU can lose its credential.** If an undone step
  removed an RTU and the restore brings it back, `reconcileSecrets` has
  already dropped its blob. The user must enter the credential again, and the
  reply says so.
- **The `undo` phrase is not hash-bound.** It acts on the last checkpoint of
  the stored session, which can be a step from another tab. The Undo control
  is the safe path for concurrent use.
- **The session DTO changes.** It gains checkpoint summaries, and the chat
  response carries the session DTO, so every DTO fixture in the web specs
  changes. The OpenAPI document (ADR 0029) shows the new fields.
- **The guided path changes behaviour in one place.** `confirm <step>` is
  answered the same way in both modes. The row lands after `F3.27` (ADR 0090
  Amendment 2), so it must pass that row's tool-coverage spec. If the reply
  primitive is a tool, its row classifies it in that spec.
- **Estimate.** 3–4, in 3 PRs: storage, capture, rollback and the phrase;
  the step labels and the reply primitive; the web Undo control.

**Deferred:**

- per-step commit to master data, and rollback after commit — not buildable on
  the ADR 0090 and 0091 commit model;
- staged or pending edits;
- redo;
- checkpoints for the Excel upload, `PATCH` draft and the credential route;
- a model tool for undo.

## Amended records

- **ADR 0090 decision 2** — "the request and response contract of that route
  does not change, except for decision 6". The chat response carries
  `onboardingSessionDtoSchema`, which gains checkpoint summaries (decision 7)
  and the means to read the draft hash (*Left to the plan*). That is a second
  exception.
- **ADR 0090 decision 4** (as amended by ADR 0091) — only if the plan makes the
  reply primitive a tool: the tool set grows from 24 to 25 with one tool that
  writes no draft section. No undo tool is added.
- **ADR 0090 decision 5** — extended. A second phrase, `undo`, is matched by
  code before any model call, after the ADR 0022 refusal (decision 8 order).
  Its rule "any draft change clears the proposal" already covers a rollback,
  and this record's decision 5 clears the proposal on every restore.
- **ADR 0090 *Deferred* bullet** — "per-step confirm and rollback (`F3.25`)"
  is delivered with the scope of this record.
- **Unchanged by this record:** ADR 0090 rulings 1, 4 and 6, the decision 3
  caps, the decision 7 fallback and the decision 6 action lines as amended by
  Amendment 2 (`F3.27`; this row only adds `Undid:` lines); ADR 0090
  Amendment 1; ADR 0091 (its irreversible publish is why
  rollback after commit stays out of scope); ADR 0022 and the ADR 0062
  credential rules (decision 5 keeps `_secrets` on its one path); ADR 0011.
