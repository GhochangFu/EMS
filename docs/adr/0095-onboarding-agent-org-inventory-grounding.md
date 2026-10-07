# ADR 0095 — The onboarding agent reads the organization's inventory (`F3.26`)

## Status

Accepted — 2026-10-06. Drafted before any implementation code. The Track E
decision packet of 2026-10-06 put six scope questions for this row (D1–D6),
each with options and a recommendation. On 2026-10-06, in chat, the owner
accepted every recommendation of the packet, the numbering of the five Track E
records (ADR 0092 `F3.23`, ADR 0093 `F3.24a`, ADR 0094 `F3.25`, this record
`F3.26`, ADR 0090 Amendment 2 `F3.27`) and the build order `F3.27` → `F3.25`
→ `F3.23` → `F3.26` → `F3.24a`. Each ruling is recorded under *Gate
questions*.

Implements row `F3.26` (Track E, Wave 3, P1) as re-scoped below. Builds on
[ADR 0090](./0090-onboarding-agent-tool-calling-loop.md) and amends its
ruling 7 and decision 4 (see *Amended records*). Confirms
[ADR 0091](./0091-onboarding-agent-asset-templates.md) decision 3 unchanged.
Promotes nothing out of `AGENTS.md` §6: the agent stays inside the scoped admin
onboarding wizard (`AGENTS.md` rule 15).

**Dependency reading.** The row lists `F3.21`. `F3.21` (the tool-calling loop,
ADR 0090) closed with PR #705.

## Context

**Where the row comes from.** The row text is "Agent grounding on org
catalog/templates/protocols (retrieval context, not hardcoded scripts)"
(`docs/archive/pending-features.md:150`). The "scripts" are the guided step
machine, `handleRuleBasedTurn` (`onboarding-chat-rule-based.ts:167`). On the
model path, ADR 0090 and ADR 0091 already replace that step machine with tool
reads that the model calls when it needs them. All paths below are under
`apps/api/src/admin/onboarding/` unless stated.

**The read grounding that shipped** (`F3.21`, `F3.22`):

- `get_draft` — the redacted draft through `serialiseDraftForPrompt`
  (`onboarding-agent-tools.ts:274`).
- `list_point_keys` — the fleet-wide catalog (`onboarding-agent-tools.ts:277-284`).
  `OnboardingCatalogService.listPointKeys` ignores its `_organizationId`
  argument, because the catalog is fleet-wide since migration `0057`
  (`onboarding-catalog.service.ts:40`). The tool matches a substring on code
  and name only. It has no domain or unit filter and no ranking, and
  `echoedItems` cuts it to `TOOL_LIST_MAX_ITEMS` = 100
  (`onboarding-tool-outcome.ts:23`). The seeded catalog holds 613 keys
  (`onboarding-catalog.service.ts:59`), so the model sees at most the first 100
  in code order.
- `list_location_types` — the active type codes, which are also in the system
  prompt.
- `list_protocols` — `OnboardingProtocolService.getContextForOrganization`
  (`onboarding-protocol.service.ts:73`) returns the protocol catalog and up to 8
  RTUs of the organization, and `formatForAssistant` turns them into markdown
  (`onboarding-agent-tools.ts:289-295`). The query selects
  `rtuConnectionConfigs.config` (`onboarding-protocol.service.ts:80`), but the
  formatter prints only names, codes and the protocol.
- `list_templates`, `get_template`, `list_stock_templates`
  (`onboarding-template-tools.ts:242`, `:253`, `:274`). ADR 0091 records that
  `F3.26` "does not replace the three read tools".
- `validate_draft` — `OnboardingValidateService` is pure and reads no database.

The system prompt (`buildSystemPrompt`, `onboarding-agent-loop.ts:84-99`)
holds the organization name, the phase, the type codes, the credential and
commit rules, the template recipe and the redacted draft. It holds no
inventory of the organization.

**The protocol content is empty today.** No migration creates
`bms.protocol_catalog`. `listCatalog` catches the error and returns `[]`
(`onboarding-protocol.service.ts:54-69`), so every chat receives an empty
protocol catalog. The packet gives this defect to `F3.24a` (ADR 0093).

**The gaps that are real:**

1. **No tool reads the organization's committed locations, RTUs or assets.**
   The agent cannot follow the organization's naming, and it learns of a code
   collision only at commit, through `translateCommitUniqueConflict`
   (`onboarding-commit-conflict.ts`). Six of the ten mapped constraints are
   fleet-wide (`scope: "global"`): `locations_slug_unique`,
   `point_keys_code_unique`, `assets_code_unique`, `rtus_external_rtu_idx`,
   `rtus_mqtt_topic_idx` and `rtus_rtu_code_idx`
   (`onboarding-commit-conflict.ts:145`, `:215-270`). For those, the `F4.109`
   wording rule forbids a message that implies that another organization
   exists (`onboarding-commit-conflict.ts:79-82`).
2. **The point-key list has no relevance.** `asset_points` carries
   `organization_id` and a `point_key` column
   (`packages/db/src/schema/bms-schema.ts:384`, `:387`, `:393`), so "keys this
   organization already maps" needs no schema change. `point_keys` has
   `domain` and `unit` columns (`bms-schema.ts:480-481`).
3. **No retrieval infrastructure exists.** No `pgvector` extension or vector
   column exists in `packages/db`. `docker-compose.yml:15` runs
   `timescale/timescaledb:2.29.1-pg16`. The LLM port has `complete()` only and
   no embeddings method (`onboarding-llm-port.ts:59`).

**Access.** Onboarding needs the `admin` or `organization_admin` role and
`canManageOrganization` on the session's organization
(`onboarding.service.ts:556-560`). `locations`, `rtus`, `assets` and
`asset_points` all carry `organization_id` (`bms-schema.ts:102`, `:133`,
`:285`, `:387`). A read of the organization's own rows stays inside the
scope the user already has. `getContextForOrganization` is the precedent: a
`fleetDb` join filtered on the organization (`onboarding-protocol.service.ts:86`).

## Re-scope

The row as written names catalog, templates and protocols. The catalog,
template and protocol reads shipped with `F3.21` and `F3.22`. The row is
narrowed to:

> Organization-inventory grounding and point-key relevance for the model path.
> Read only. No schema change, no new dependency, one PR, effort about 2.

In scope: one new tenant-scoped read tool (decisions 1, 2, 6), a filter and a
ranking on `list_point_keys` (decision 3), and one system-prompt sentence
(decision 4). Out of scope, each with its owner, under *Deferred*.

The packet's alternative — close the row as delivered by `F3.21` and `F3.22`,
and raise the inventory lookup as an F4 row — was not chosen (D1 option D).

## Gate questions

1. **D1 — Which retrieval mechanism?** Options: (A) new tenant-scoped read
   tools in the existing registry, plus point-key filters and a ranking;
   (B) a bounded digest of the organization's codes in the system prompt on
   every turn; (C) embedding retrieval (`pgvector` and provider embeddings);
   (D) no new mechanism: close the row as delivered. **Ruled as recommended:
   A.** B puts text that any `organization_admin` can author into the system
   role, and it costs tokens on each of the up to nine model calls of a turn.
   C cannot be built inside this row: it needs an image change, a migration, a
   new dependency, a new port method and its own ADR. D leaves the two real
   gaps open.
2. **D2 — How far can the lookup see?** Options: (A) tenant only, and the
   result states that a fleet-wide conflict is visible only at commit; (B) a
   fleet-wide availability check (`check_codes`) for given codes; (C) an
   asynchronous database pre-check inside `validate_draft` on the draft's own
   codes. **Ruled as recommended: A.** B is an enumeration oracle: at 8 calls a
   turn, a user could list the asset codes and MQTT topics of other tenants,
   where today the same signal needs a ready draft and a confirm. C changes the
   pure, synchronous validator and the `ToolContext.validator` signature
   (`onboarding-agent-tools.ts:118-124`), and its probe count is bounded only
   by draft edits. B and C change the posture that `F4.109` set. If the owner
   wants either one later, it is a new F4 row with a security review.
3. **D3 — How do point keys become relevant?** Options: (A) domain and unit
   filters only; (B) the keys that the organization already maps come first,
   each with an `inUse` flag, plus the domain and unit filters; (C) no change.
   **Ruled as recommended: B.** It is read only and cheap, and it directly
   cuts the guessing over a list that the model cannot see whole. A gives no
   ranking, so the model still sees the first 100 of 613 keys in code order
   when a filter does not narrow the list. C leaves the gap open.
4. **D4 — Which row reads a committed asset's points and source keys?**
   Options: (A) not `F3.26`: it reads codes and summaries only; (B) `F3.26`,
   through `find_existing` returning each asset's points. **Ruled as
   recommended: A.** B needs a bound at the scale of asset points
   (`MAX_ONBOARDING_ASSET_POINTS`), and it puts more organization-authored
   text into the prompt. The chat cannot write to a committed asset: its
   mappings change on the `F2.7` sheet, and `F3.23` maps draft assets only
   (ADR 0092). A chat read with no chat write gives little value, and
   summaries keep this row to one PR.
5. **D5 — Does `F3.26` change protocol grounding?** Options: (A) no;
   (B) structured protocol data and a protocol filter on `list_protocols`;
   (C) expose the ingest adapters' `configSchema`. **Ruled as recommended:
   A.** B is cosmetic, and `formatForAssistant` is shared with the guided
   protocol reply, so the tool would need its own serializer. C cannot be
   built here: `configSchema` lives in `apps/ingest/src/adapter/types.ts`, and
   `apps/api` imports nothing from `apps/ingest`.
6. **D6 — Does the cap of 8 calls change?** Options: (A) keep 8 and add one
   tool with a `kind` argument; (B) keep 8 and add three tools
   (`list_locations`, `list_rtus`, `list_assets`); (C) raise the cap, for
   example to 10. **Ruled as recommended: A.** B adds three tools to a list
   that the smaller live models must read, and each lookup is still a separate
   call against the same cap. C changes ADR 0090 ruling 3 and decision 3 and
   the 45 s arithmetic (up to 11 model calls).

## Decision

1. **One new read tool, `find_existing`** (D1-A, D6-A). Its arguments are
   `{ kind: "location" | "rtu" | "asset", search?, locationCode? }`, strict,
   with bounded strings. It lists the session organization's committed rows of
   that kind:
   - a location: its code, slug, name, type, whether it is active, and its RTU
     count;
   - an RTU: its code, display name, protocol, location code, and whether it
     is active;
   - an asset: its code, name, domain, location code, RTU code, and its
     template code and version.

   `search` is a lowercased substring match on code and name, the same rule as
   `list_point_keys`. `locationCode` is an exact match. The list goes through
   `echoedItems` and `moreTail` with `TOOL_LIST_MAX_ITEMS`, and the result is
   cut to `TOOL_RESULT_MAX_CHARS` (ADR 0090 decision 3). The query reads at
   most one row more than the cap, so the tool can say that more exist without
   a load of the whole table. The tool writes nothing to the draft and writes
   no action line. A new service reads the rows on `fleetDb`, as
   `getContextForOrganization` does, because the organization is authorized
   upstream in `OnboardingService`.

2. **The read is tenant only** (D2-A). Every query of `find_existing` filters
   on the session's `organization_id` first. No tool answers whether a code is
   free across the fleet, and `validate_draft` stays pure. Every result of
   `find_existing` carries one constant scope note, written by code. The note
   must say two things: only this organization's rows are listed, and a slug,
   asset code, RTU device id (`rtus.rtu_code`, unique fleet-wide since
   `packages/db/drizzle/0071_rtu_code_unique.sql:89-91`), external RTU id or
   MQTT topic can still be refused at commit. An RTU's `code` is not in that
   list: it is unique per location (`rtus_location_code_unique`, `"tenant"`),
   so the listed RTU codes are its whole collision set. The note must not imply that another organization exists — the
   `F4.109` rule for a `"global"` constraint
   (`onboarding-commit-conflict.ts:79-82`). The commit's 409 stays the only
   cross-tenant signal. The plan proposes the exact text, and the compliance
   review checks it against `F4.109`. The scope analysis' phrase "codes held
   outside the organization" fails that rule and is not used.

3. **No connection config and no credential reaches the tool** (D2-A). The RTU
   read selects `rtu_connection_configs.protocol` only, never
   `rtu_connection_configs.config` and never a credential column. The shared
   scrub still misses short secret names (`F4.185`, open), so an echoed config
   could carry a credential into the prompt and to the client. The result keys
   of each kind are a fixed list, and a test holds each list.

4. **`list_point_keys` gains a filter and a ranking** (D3-B). Its arguments
   gain an optional `domain` and an optional `unit` (case-insensitive equality).
   The keys that the organization already maps in `asset_points` come first,
   then the rest in code order, and each row gains an `inUse` flag. A new
   method on `OnboardingCatalogService` reads the organization's distinct
   `asset_points.point_key` values. `listPointKeys` does not change: its other
   callers (the Excel upload, `handleRuleBasedTurn` and
   `formatPointKeysForChat`) keep their behavior. The cap and the tail stay.

5. **One sentence in the system prompt.** `buildSystemPrompt` tells the model
   to call `find_existing` before it chooses a new location, RTU or asset code,
   and to follow the organization's naming. The organization's rows go to the
   model in tool results only, bounded and cut, never in the system role
   (D1-A against D1-B).

6. **The read stops at summaries** (D4-A). `find_existing` returns no asset
   point, no `source_data_key` and no source kind. Point-level detail and
   mapping belong to `F3.23` for draft assets (ADR 0092), and to the `F2.7`
   mapping sheet for committed assets. No chat tool reads a committed asset's
   points after this row.

7. **Protocol grounding does not change** (D5-A). `list_protocols`, its
   service and its formatter stay as they are. The empty live catalog
   (*Context*) and the per-protocol config shape belong to `F3.24a`
   (ADR 0093). Live discovery belongs to `F3.24b`.

8. **The caps do not change** (D6-A). `MAX_TOOL_CALLS_PER_TURN` stays 8
   (`onboarding-agent-loop.ts:24`), and the 45 s deadline, the history bound
   and the result bound of ADR 0090 decision 3 stay. The registry gains one
   tool. Because `F3.23` lands first in the owner's build order and adds its
   own tools, the count after this row is one more than the count after
   `F3.23`, not a fixed number written here. The `TOOL_DEFINITIONS` docblock
   (`onboarding-agent-tools.ts:198`) and the tool-count spec follow the real
   count.

9. **Guided-mode coverage** (build order). `F3.27` lands first and adds a
   tool-coverage spec that fails when a tool in `TOOL_DEFINITIONS` is not
   classified as guided or agent-only (ADR 0090 Amendment 2). `F3.26`
   classifies `find_existing` as agent-only, with a reason that names `F3.26`.
   The guided path does not change: retrieval needs a model. The scope
   analysis' rule that "F3.26 must land before F3.27" is superseded by the
   owner's build order and by that spec.

10. **What stays the same.** The commit model, the proposal and the confirm of
    ADR 0090 decisions 5 and 8. The credential refusal of ADR 0090 decision 4
    and ADR 0091 decision 9. The three template reads of ADR 0091 decision 3.
    The chat route's request and response contract: tool results stay inside
    the loop, so `packages/shared/src/contracts/onboarding.ts` does not change.
    No migration and no new dependency.

11. **Verification.** One PR. The plan holds the test list. These claims each
    get their own test, and the first gets a mutation:
    - The tenant filter: an integration test under RLS with two
      organizations, run with `DATABASE_URL` as `bms_owner`. It asserts that
      the own RTU code is present and the other organization's RTU code is
      absent. Removing the `organization_id` predicate must make it fail.
    - No config echo: a fixture RTU whose config holds a sentinel password.
      The serialized rows do not contain the sentinel and do contain the RTU
      code.
    - The cap and the tail, the scope note (exact match), the refusal of an
      unknown `kind`, the fixed result keys per kind, and no draft change.
    - The in-use order and the `inUse` flag, as two separate tests, and the
      domain and unit filters.
    - The prompt sentence, as an exact substring.
    - The dependency injection graph, proved by booting the `api` container,
      not by `tsc`.

    Reviews: code, security (the tenant predicate, no config echo, the oracle
    of D2, the prompt-injection bound) and compliance (the scope note against
    `F4.109`). No migration review: no migration.

## Dependencies

None. No new npm package, no migration.

## Consequences

- **The agent can follow the organization's naming.** It reads the existing
  location, RTU and asset codes before it proposes new ones, and it sees a
  collision inside the organization before the commit.
- **A fleet-wide collision still appears only at commit.** A slug, an asset
  code, an MQTT topic, an external RTU id or an RTU device id that another tenant
  holds still answers the commit's 409, with the `F4.109` wording. This is
  the price of D2-A, and the scope note tells the model so.
- **More organization-authored text reaches the model.** Location, RTU, asset
  and point-key names are text that any `organization_admin` can write through
  a commit. ADR 0090's rule applies: prompt injection is bounded, not removed.
  The text stays in tool results, bounded by the list cap and the result cap,
  and it never enters the system role.
- **`F3.23` ships without the ranking.** In the owner's build order `F3.23`
  lands before `F3.26`, so its question-driven point-key turns use the
  unranked `list_point_keys` until this row lands.
- **The live protocol catalog stays empty until `F3.24a`.** This row does not
  change it.
- **Deferred:**
  - a fleet-wide code-availability check, or a database pre-check in
    `validate_draft` (a new F4 row with a security review, if the owner wants
    one);
  - embedding or semantic retrieval (a new ADR: image, migration, dependency,
    port method);
  - a chat read of a committed asset's points and source keys (no row; the
    `F2.7` sheet shows them);
  - per-adapter config and live discovery (`F3.24a`, `F3.24b`);
  - any change to the guided path (`F3.27`).

## Open for the plan

The packet did not put these to the owner. The plan proposes an answer to
each, and the owner rules them before any code:

- **Q-A.** Does `find_existing` also list inactive locations and RTUs? They
  still hold their unique codes.
- **Q-B.** Does the RTU row carry `rtus.rtu_code` (the device id of
  `F4.182`)?
- **Q-C.** Does `find_existing` join `CREDENTIAL_CHECKED_TOOLS`
  (`onboarding-agent-tools.ts:89`)? Its arguments are search strings and are
  never stored. The prompt-marker refusal runs on every tool in any case.
- **Q-D.** The exact text of the scope note (decision 2).

**Owner rulings at the PR gate, 2026-10-07** (on #759, in chat). Plan
questions Q-A, Q-C, Q-D and Q-E are accepted as recommended. Q-B was reversed
in the build and the reversal is accepted: the RTU row lists `rtuCode` (the
`F4.182` device id), because the draft RTU schema carries it.

## Amended records

- **ADR 0090 ruling 7 and decision 4** — the tool set gains `find_existing`
  (decision 1 above), and `list_point_keys` gains the `domain` and `unit`
  arguments, the in-use order and the `inUse` flag (decision 4 above). The
  other tools stand.
- **ADR 0090 *Consequences*, the *Deferred* bullet** — retrieval grounding
  (`F3.26`) is no longer deferred. It is delivered as re-scoped here.
- **ADR 0090 ruling 3 and decision 3** — confirmed unchanged: 8 calls, 45 s,
  the history bound and the result bound.
- **ADR 0091 decision 3 and its *Deferred* bullet** — confirmed unchanged:
  `F3.26` does not replace `list_templates`, `get_template` or
  `list_stock_templates`.
