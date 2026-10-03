# ADR 0090 — Tool-calling onboarding agent loop (`F3.21`)

## Status

Accepted — drafted on 2026-10-03, before any implementation code. Seven scope
questions were put to the owner one at a time on 2026-10-03; all were ruled,
and each ruling is recorded under *Gate questions*. The owner approved this
written record on 2026-10-03, with the note under *Where rulings 1 and 4 leave
the design* stated to them before the approval.

**Amendment 1 (2026-10-03, before any implementation code)** replaces ruling 2
and decision 1 with three providers, adds `@anthropic-ai/sdk`, and moves a
per-organization key screen and its table into this row. It is at the end of
this record.

Implements row `F3.21` (Track E, Wave 2, ⭐). Amends
[ADR 0011](./0011-ai-onboarding-chat.md) decision 1 (see *Amended records*).
Keeps [ADR 0022](./0022-onboarding-credential-capture.md) unchanged. Promotes
nothing out of `AGENTS.md` §6: the agent stays inside the scoped admin
onboarding wizard, and the general site-wide AI copilot stays out of scope
(`AGENTS.md` rule 15).

**Dependency reading.** The row lists `create APIs, F4.4`. `F4.4` closed with
PR #1 (ADR 0014). The 2026-08-05 backlog note read "create APIs" as the onboarding
create APIs and held the row on them. Those now exist: the admin CRUD for
locations, RTUs, assets, point keys and asset points, and the onboarding
`sessions`, `chat`, `draft`, `validate` and `commit` routes. The owner started
the row on 2026-10-03 on that reading.

## Context

**What the chat does today** (`apps/api/src/admin/onboarding/`):

- `OnboardingChatService.handleTurn` makes one model call per user turn
  (`handleOpenAiTurn`). It sends the system prompt, the redacted draft
  (`serialiseDraftForPrompt`) and **the current message only** — no history and
  no tools. The model returns one JSON object (`response_format:
  json_object`) with a `draftPatch`, which `onboardingDraftSchema.safeParse`
  filters.
- With no `OPENAI_API_KEY`, or on any OpenAI error, `handleRuleBasedTurn` runs
  without a message to the user. `.env.example` ships the key empty, so the
  rule-based path is the default on an ordinary deployment.
- `OnboardingService.chat` refuses a turn that looks like a credential before
  any side effect (ADR 0022 decision 2), applies the draft caps on the merged
  draft (`draftCountProblem`, `F4.103`), scrubs a credential-looking reply,
  and writes the draft, the phase and the messages in one update.
- Nothing writes master data until `POST sessions/:id/commit`.
  `OnboardingCommitService.commit` writes the whole draft in one transaction,
  checks `canManageOrganization`, and writes the master-data audit rows.
- `onboarding_sessions.messages` is `jsonb`. `onboardingChatMessageSchema`
  allows the roles `user`, `assistant` and `system`.

**What the row asks.** A tool-calling agent loop that invokes real create APIs,
not a single-shot JSON draft. Rows `F3.22`–`F3.27` build on it: templates,
point-key and mapping Q&A, protocol discovery, per-step confirm and rollback,
retrieval grounding, and fallback parity.

**The risk this record has to bound.** The agent reads text that the operator
did not type as an instruction: uploaded workbook cells, catalog names, and
earlier messages. Any of these can steer the model. So the model must not be
the component that decides to write master data.

## Gate questions

1. **The write path.** Options: the tools edit the session draft and a commit
   tool reaches the existing commit service; the tools call the admin create
   services and write rows at each step; the tools edit the draft and only the
   preview button commits. **Ruled as recommended: the tools edit the draft,
   and the agent reaches the existing commit service.** RBAC, RLS, the audit
   rows, the caps and the one-transaction rollback stay in one place.
2. **The provider.** Options: OpenAI behind a provider port; add the Anthropic
   SDK; both, chosen by an env var; OpenAI called directly. **Ruled as
   recommended: OpenAI behind a port.** No new dependency.
3. **Where the loop runs.** Options: in the request with caps; a BullMQ job with
   socket progress; in the request with streaming. **Ruled as recommended: in
   the request, with caps.**
4. **Who confirms a commit.** Options: the server checks the confirm; the model
   judges the "yes"; the button only. **Ruled as recommended: the server
   checks the confirm**, never the model.
5. **What the transcript shows.** Options: code-written action lines; the final
   reply only; a new tool-call table. **Ruled as recommended: code-written
   action lines.** No migration.
6. **Failure in the middle of a loop.** Options: discard the turn and run the
   rule-based path; keep the edits and report; discard and report only.
   **Ruled as recommended: discard the turn, then run the rule-based path,
   and tell the user.**
7. **The tool set.** Options: the draft sections that exist now; the loop and
   the read tools only; also the templates. **Ruled as recommended: the draft
   sections that exist now.** Templates, discovery and retrieval stay with
   `F3.22`–`F3.26`.

**Where rulings 1 and 4 leave the design.** Together, the two rulings mean that
the model never calls a create API. The model edits the draft and proposes a
commit. Server code commits, and only on the user's own confirm. This is close
to option 3 of question 1, which the gate described as "does not meet the row
text". It differs in two points: the agent proposes the commit and shows its
summary, and a typed confirm phrase in the chat commits as well as the button.
The owner approves this record with that fact stated here.

## Decision

1. **A provider port.** `apps/api` gains an onboarding LLM port: messages and
   tool definitions in, either tool calls or a final text out. The only
   implementation is OpenAI, through the existing `openai` package and its
   chat-completions tool calling. `OPENAI_API_KEY` and `OPENAI_MODEL` keep
   their meaning (default `gpt-4o-mini`). The port knows nothing about the
   draft, and the tools know nothing about OpenAI. A second provider is a new
   implementation and its own ADR (§9.4).

2. **The loop runs inside `POST /api/v1/admin/onboarding/sessions/:id/chat`.**
   The request and response contract of that route does not change, except
   for decision 6. One user turn runs: model → tool calls → model, until the
   model returns a final text or a cap stops it.

3. **Caps, as code constants, not env vars:**
   - at most **8 tool calls** per user turn;
   - at most **45 s** of wall time per user turn;
   - at most the **last 20 messages** of the session as history;
   - the draft goes into the prompt through `serialiseDraftForPrompt`, as now
     (`F4.107` budget and marker rules apply unchanged);
   - each history message goes into the prompt cut to **2,000 characters**
     (`cutToBound`, never a bare `.slice()`);
   - each tool result goes into the prompt cut to **8,000 characters**. A list
     result (the fleet-wide point-key catalog grows with every commit) goes
     through `echoedItems` and `moreTail` first, so the model sees how many
     items it did not get.

   At a cap, the loop stops, keeps the draft edits that passed validation up
   to that point, and the reply says that the assistant stopped early. When the
   45 s deadline arrives during a model call, the loop aborts that call and
   stops with `cap_time`, not `provider_error`: the edits of the tool calls
   that completed are kept (ruling 3), and the rule-based path does not run.

4. **The tool set** (ruling 7). Every tool runs as the session user, inside the
   session's organization, through the services and schemas that exist now.
   - **Read:** `list_point_keys` (`OnboardingCatalogService`),
     `list_location_types` (`VocabulariesService`), `list_protocols`
     (`OnboardingProtocolService`), `get_draft` (the redacted draft).
   - **Draft write:** `set_location`, `add_rtu`, `update_rtu`, `add_point_key`,
     `add_asset`, `map_point`, a remove tool for each array section, and
     `use_existing_point_keys`, which sets only
     `onboardingMeta.useExistingPointKeys` (the flag the rule-based path sets
     today). The arguments of each tool are parsed with the matching element
     schema of `onboardingDraftSchema`. No tool can write `_secrets`,
     `credentialsSet` or any other `onboardingMeta` field.

   **No tool takes a credential, and code enforces it.** `rtus[].config` is
   `z.record(z.unknown())`, so the element schema cannot see a password inside
   it, and today the redactors scrub it only on the way out
   (`redactDraftForClient`, `redactDraftForLlm`). For `add_rtu` and
   `update_rtu`, the tool refuses the whole call, as a tool error, when any key
   at any depth of `config` matches the secret fragments that
   `onboarding-redaction.ts` already uses (`SECRET_FRAGMENTS`, normalised
   substring), or when any string value `looksLikeCredential`. One list serves
   both the scrub and the refusal. The plan gates each refusal path with a
   test.
   - **Check:** `validate_draft` (`OnboardingValidateService`).
   - **Commit:** `propose_commit` (decision 5).

   Each draft write is applied to an in-memory copy of the draft and checked
   with `draftCountProblem` and the inactive-location-type filter
   (`F4.157`) before the next model call. A refused write goes back to the model
   as a tool error result. It never throws out of the loop. The turn writes
   the session row once, at the end, as `OnboardingService.chat` does now.

5. **The model cannot commit.** `propose_commit` writes nothing. It records a
   commit proposal bound to a hash of the draft at that moment, and it shows a
   code-written summary of what the commit creates. The server commits only
   when the **next** user turn is a confirm:
   - the existing Commit button, which calls `POST sessions/:id/commit` as now;
     or
   - a chat message that matches an exact confirm phrase (`confirm commit`).
     Code matches the phrase before any model call, checks that the draft
     hash still matches the proposal, and calls
     `OnboardingCommitService.commit`.

   Any other turn, and any draft change, clears the proposal. A model-written
   "yes" and text from a workbook cell cannot reach the commit, because the
   model is not on that path.

6. **Action lines.** `onboardingChatMessageSchema.role` gains `action`
   (`packages/shared`). Each successful draft write and each proposal adds one
   `action` message. **Code writes its text** from the validated result, for
   example `Added RTU RTU-1 (mqtt)`. The raw tool arguments and the model's own
   wording are never stored as an action. The web chat
   (`apps/web/src/pages/admin/onboarding-chat-page.tsx`) shows `action`
   messages as small lines between the turns; today it shows any role other
   than `user` in the assistant style. History for the model (decision 3)
   includes them, sent as `assistant` text, because the provider accepts no
   `action` role. `scrubMessages` and the stored-message read paths must accept
   the new role.

7. **Failure and fallback** (ruling 6). On a provider error or a malformed
   model reply, the loop discards every draft edit of that turn and runs
   `handleRuleBasedTurn` on the same message. The reply starts with one
   sentence that says the assistant is not available and that the guided mode
   answered. With no `OPENAI_API_KEY`, the rule-based path runs as now, with no
   such sentence. The rule-based path itself does not change in this row;
   `F3.27` owns its parity.

8. **What stays the same.** The ADR 0022 credential refusal runs first, before
   the loop and before the confirm check. The reply scrub for credential-like
   text stays. The Excel upload, `PATCH sessions/:id/draft`, `validate` and
   `commit` routes do not change. The commit transaction, its access checks and
   its audit rows do not change. No migration: the proposal and the action
   lines live in the existing `jsonb` columns.

9. **Logging.** Each turn logs one line with the session id, the tool names
   called, the count, the stop reason (`final`, `cap_calls`, `cap_time`,
   `provider_error`) and the duration. No message text, no tool arguments, no
   draft content (§9.6).

## Dependencies

None. `openai` (`^6.45.0`, ADR 0011) is already in `apps/api`.

## Consequences

- **The agent can do in one turn what took several.** "Add an MQTT RTU with
  two energy meters, mapped to kW" becomes a series of tool calls and one
  reply, with an action line for each step.
- **More model calls per turn.** A turn can now cost up to nine model calls
  (eight tool rounds and a final reply). The caps bound it. Cost tracking per
  organization is not in this row.
- **A turn can take up to 45 s.** The web shows the existing "thinking" state
  for that time. A reverse proxy in a deployment with a shorter read timeout
  than 45 s cuts the turn; the stack's own `nginx.conf` does not proxy the
  API. Streaming progress is a later row if the owner asks for it (ruling 3).
- **The contract gains a role.** A client that reads `messages` and knows only
  `user`, `assistant` and `system` must accept `action`. In this repository
  the only consumer outside `apps/api` is
  `apps/web/src/pages/admin/onboarding-chat-page.tsx`; the OpenAPI document
  (ADR 0029) shows the new enum value.
- **The fallback answers a message that was written for the agent.** On a
  provider error, `handleRuleBasedTurn` gets a message such as "add an MQTT
  RTU with two meters". On a fresh session its location branch takes the whole
  message as `location.name`. The user sees this in the preview and can edit
  it. `F3.27` owns making the two paths agree.
- **The commit proposal is new state with a narrow rule.** It is bound to the
  draft hash, so it cannot commit a draft that the user did not see. The plan
  must name where it is stored and gate the clearing rule with a test for each
  path.
- **Prompt injection is bounded, not removed.** A steered model can still make
  wrong draft edits. Each one shows as an action line and in the preview, and
  none of them is master data until the user confirms. `F3.25` adds per-step
  confirm and rollback on top of the action lines.
- **Deferred:** templates (`F3.22`), point-key and mapping Q&A (`F3.23`),
  protocol discovery (`F3.24`), per-step confirm and rollback (`F3.25`),
  retrieval grounding (`F3.26`), rule-based parity (`F3.27`), a second
  provider, streaming, and per-organization cost limits.

## Amended records

- **ADR 0011 decision 1** — "chat completions with structured JSON output"
  becomes chat completions **with tool calling**, behind the provider port of
  decision 1 above. Decisions 2–6 of ADR 0011 stand.

## Amendment 1 — three providers and a per-organization key screen (2026-10-03)

### Status

Accepted — the owner ruled ten questions one at a time on 2026-10-03, after
the record above was merged (#702) and before any implementation code. The
owner asked for it: there is no OpenAI key available for testing, an
OpenRouter key is, and the keys must be settable in the UI, not only in
`.env`. The owner approved this written amendment on 2026-10-03, with four
facts stated before the approval: the migration, page and route group it adds;
the Anthropic refusal fallback and its billing; that an organization row never
uses the platform key; and effort `medium`.

**Supersedes:** ruling 2 and decision 1 (one provider), decision 8's "No
migration", and *Dependencies* ("None"). Every other decision stands. The
amended row is larger: it now carries a migration, a new admin page and a new
dependency, so `migration-reviewer` joins the reviews.

### Gate questions

1. **Which providers?** Options: OpenAI + OpenRouter + Anthropic; OpenAI +
   OpenRouter only; OpenRouter only. **Ruled as recommended: all three.**
2. **How is the provider chosen?** Options: an explicit `LLM_PROVIDER`; the
   first key that is set; explicit with a fallback chain. **Ruled as
   recommended: an explicit `LLM_PROVIDER`.**
3. **Default models.** **Ruled by the owner:** OpenAI keeps `gpt-4o-mini`;
   Anthropic defaults to `claude-sonnet-5-5`; OpenRouter has **no default** —
   the owner chooses a third-party model (for example a Kimi or GLM model) in
   `OPENROUTER_MODEL`.
4. **Keys in the UI — this row or a later one?** Options: a later row; this
   row. **Ruled: this row** (against the recommendation).
5. **Level.** Options: one platform setting; per organization; both. **Ruled:
   per organization** (against the recommendation), with `.env` as the
   platform default (question 8).
6. **What the screen shows of a saved key.** Options: "set" and the last four
   characters; "set" only. **Ruled as recommended: "set" and the last four.**
7. **Who sets it.** Options: an admin of that organization; a global admin
   only. **Ruled as recommended: `canManageOrganization`.**
8. **Precedence.** Options: the organization wins and `.env` is the default,
   with an "Off" choice; the organization only; the organization wins with no
   "Off". **Ruled as recommended: the organization wins, `.env` is the
   default, and "Off" exists.**
9. **Checking a key.** Options: a Test button; a test on every save; no test.
   **Ruled as recommended: a Test button.** Saving does not need a passed test.
10. **Placement.** Options: a new organization sub-page; a panel in the chat.
    **Ruled as recommended: a sub-page**, no sidebar change (the IA decision
    `F3.29` stays open).

### Decisions

A1. **Three implementations of the decision-1 port.** The port gains one
    field: an assistant message that carries tool calls also carries the
    provider's own reply content, opaque to the loop, and the adapter that
    produced it sends it back unchanged in the next round of the same turn.
    The Anthropic Messages API needs this: an assistant turn with tool calls
    must go back as the full content it returned, thinking blocks included.
    History across turns stays plain text (decision 6).
    - `openai` — the `openai` package, its default base URL.
    - `openrouter` — the same `openai` package with
      `baseURL: "https://openrouter.ai/api/v1"`. OpenRouter accepts the OpenAI
      chat-completions format with tools, so it differs from `openai` only in
      the base URL, the key and the model.
    - `anthropic` — the official `@anthropic-ai/sdk`, Messages API with
      client tools, `tool_choice: { type: "auto" }` (Claude Sonnet 5.5 refuses
      a forced tool choice), non-streaming, `max_tokens` 16,000, and `output_config.effort: "medium"`
      (Anthropic's suggested start for multistep tool use; the model default,
      `high`, makes each of up to nine calls slower inside the 45 s deadline).
      Thinking stays at the model default (adaptive). It sends the
      server-side refusal fallback (`fallbacks: "default"` with the
      `server-side-fallback-2026-07-01` beta), as Anthropic recommends for this
      model. A response whose final `stop_reason` is still `refusal` is a
      provider error, so ruling 6 applies: the turn is discarded and the
      guided mode answers.

A2. **The platform default comes from `.env`.** Seven variables, documented in
    `.env.example` and passed to the `api` service in `docker-compose.yml`:

| Variable | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | empty | `openai`, `openrouter` or `anthropic`; empty = the agent is off |
| `OPENAI_API_KEY` | empty | |
| `OPENAI_MODEL` | `gpt-4o-mini` | |
| `OPENROUTER_API_KEY` | empty | |
| `OPENROUTER_MODEL` | none | required when `LLM_PROVIDER=openrouter` |
| `ANTHROPIC_API_KEY` | empty | |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | |

    When the selected provider has no key, or OpenRouter has no model, the
    agent is off and the API logs one boot warning that names the missing
    variable, never a value.

A3. **Per-organization setting.** A new tenant table
    `bms.organization_llm_settings`, in the next free migration:
    - `organization_id uuid` primary key, references `bms.organizations`,
      `ON DELETE CASCADE`;
    - `provider varchar(16) NOT NULL`, `CHECK` in
      (`off`, `openai`, `openrouter`, `anthropic`). A `CHECK`, not a
      vocabulary table, because every value needs an adapter in code — a row
      added at run time could do nothing;
    - `model varchar(200)`, `NOT NULL` unless `provider = 'off'` (`CHECK`);
    - `key_ciphertext bytea`, `key_iv bytea`, `key_version integer`,
      `key_last4 varchar(4)` — the key is encrypted with
      `CredentialCryptoService` (ADR 0012, rotation per ADR 0062); the four
      columns are all NULL or all set (`CHECK`);
    - `updated_by uuid` references `bms.users`, `updated_at timestamptz`.

    `ENABLE` and `FORCE ROW LEVEL SECURITY` with the standard
    `app.current_organization` policy, and grants only to the API's tenant
    role, as every tenant table since ADR 0045.

    *Correction, 2026-10-03 (plan ruling 7):* the last clause describes a
    pattern this repository does not use. Recent tenant tables (migration
    `0094` is the model) write no `GRANT` and rely on `0041`'s default
    privileges, which also reach `bms_fleet` (it bypasses RLS). The owner ruled
    to follow `0094`: no `GRANT` and no `REVOKE`. `bms_fleet` can read the
    encrypted rows; it cannot decrypt them without the credential key.

A4. **Resolution, once per chat turn.** If the organization has a row:
    `off` → the guided mode; a complete row (provider, model, key) → that
    provider; an incomplete row → the guided mode and one warning log line. If
    it has no row → the `.env` platform default (A2). The key is decrypted for
    the turn and is never cached across turns.

    So the provider is no longer one DI singleton that reads the environment.
    A resolver, injected into the chat service, returns for one organization
    either nothing (the guided mode) or a provider instance built for that
    turn with its key and model. The adapters read no environment variable;
    the resolver alone reads A2's variables.

    **An organization row never uses the platform key.** A row without a key
    means the guided mode, as above, and the Test button follows the same
    rule (A5).

A5. **API**, under `/api/v1/admin/organizations/:orgId/ai-assistant`, gated by
    `canManageOrganization`:
    - `GET` → `{ provider, model, keySet, keyLast4, updatedAt, source }`, where
      `source` is `organization` or `platform`; for `platform` it also names
      the platform provider and model, and whether a platform key is set —
      never a key.
    - `PUT` `{ provider, model, apiKey? }` (strict body) — `apiKey` omitted
      keeps the stored key; `apiKey` given replaces it. With
      `CREDENTIAL_ENCRYPTION_KEY` not configured, a `PUT` that carries
      `apiKey` answers 400 and stores nothing (ADR 0062 decision 8: no false
      success).
    - `DELETE` → removes the row; the organization returns to the platform
      default.
    - `POST …/test` `{ provider, model, apiKey? }` — `apiKey` omitted uses the
      organization's stored key. With no stored key, the test can only check
      the platform default as it is: the request must name the platform's own
      provider and model, or it answers 400. An org admin cannot spend the
      platform key on another model. One minimal billed call with one trivial
      tool and `tool_choice` auto. The answer is `ok` or one error class:
      `invalid_key`, `unknown_model`, `no_tool_support`, `rate_limited`,
      `unreachable`, `provider_error`. Never the key, never the provider's raw
      text.

    `PUT` and `DELETE` write a master-data audit row with the provider, the
    model and whether the key changed — never the key and never its last four
    characters.

A6. **Web.** A new page `/admin/organizations/:orgId/ai-assistant`, opened by
    an "AI assistant" action on each row of the Organizations page. It has a
    provider choice (Platform default, Off, OpenAI, OpenRouter, Anthropic), a
    model field with the provider's default as its placeholder, a write-only
    key field, the line "Key set, ends in …xxxx" with the date, Replace and
    Remove, a Test button and Save. No sidebar change.

A7. **Secret hygiene.** The key never appears in a response, a log line, an
    audit row, an error message or the chat. The tests gate each surface: the
    `GET` body, the `PUT` response, the audit row, the test endpoint's answer
    and the agent turn's log line.

### Dependencies

- `@anthropic-ai/sdk` `^0.131.0` in `apps/api` — MIT; direct dependencies
  `standardwebhooks` and `json-schema-to-ts`. Imported dynamically, like
  `openai`, so an organization that never selects Anthropic never loads it.
  The repository's dependency gate needs an ADR staged in the same commit as
  the manifest change; that commit adds a dated line to this amendment.
- No dependency for OpenRouter.
- *2026-10-03, the build:* `@anthropic-ai/sdk` `^0.131.0` added to `apps/api`
  by `pnpm --filter api add`, in the same commit as this line. Version
  0.131.0 declares no `engines` field; the Node 20 gate is the `api` image
  build and a booted container at step 6.

### Consequences

- **A deployment that sets only `OPENAI_API_KEY` now also needs
  `LLM_PROVIDER=openai`.** Compose does not pass `OPENAI_API_KEY` today, so no
  stack deployment uses it now.
- **OpenRouter models differ in tool support and quality.** The Test button
  reports `no_tool_support`; the quality of a third-party model's tool calls
  is the owner's choice and is not gated here.
- **Each organization pays for its own key.** An org admin can spend that
  organization's money; the audit row records who changed the setting.
- **The row grows.** One migration (`migration-reviewer`), one new page, one
  new route group and one dependency join the plan. The plan is re-cut before
  the first unit.
- **Deferred:** a global-admin platform setting in the UI (the platform
  default stays in `.env`), per-organization cost limits, and model lists
  fetched from the providers.
