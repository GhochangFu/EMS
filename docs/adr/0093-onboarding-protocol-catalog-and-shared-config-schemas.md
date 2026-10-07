# ADR 0093 — Protocol prompts and checks for the onboarding agent: a code-defined protocol catalog and shared adapter config schemas (`F3.24a`)

## Status

Accepted — 2026-10-06, before any implementation code. The Track E decision
packet put six scope questions for row `F3.24` to the owner, each with options
and a recommendation. On 2026-10-06, in chat, the owner accepted every
recommendation, the split of `F3.24` into `F3.24a` (now) and `F3.24b`
(deferred until `F1.4` or `F1.5`), this record's number, and the Track E build
order `F3.27 → F3.25 → F3.23 → F3.26 → F3.24a`. Each ruling is recorded under
*Gate questions*. The owner ruled the recommendations in chat; this text
records them and is not itself an owner approval of its wording.

Implements row `F3.24a` (Track E, Wave 3, P1), split from `F3.24`. Builds on
[ADR 0016](./0016-ingest-adapter-framework.md) and
[ADR 0090](./0090-onboarding-agent-tool-calling-loop.md), and amends both (see
*Amended records*). Keeps
[ADR 0012](./0012-encrypted-rtu-credentials.md),
[ADR 0022](./0022-onboarding-credential-capture.md),
[ADR 0030](./0030-shared-api-contracts.md) and
[ADR 0091](./0091-onboarding-agent-asset-templates.md) unchanged. Promotes
nothing out of `AGENTS.md` §6: the agent stays inside the scoped admin
onboarding wizard (`AGENTS.md` rule 15), and no protocol library and no new
adapter come with this row.

**Dependency reading.** The row lists `F3.21, F1.1`. `F3.21` (the
tool-calling loop, ADR 0090) closed with PR #705. `F1.1` (the ingest adapter
framework, ADR 0016) closed on 2026-08-14. Live discovery (`F3.24b`) also
depends on `F1.4` or `F1.5`, which are ⬜ and parked on the A4 answer
(`docs/BACKLOG.md:433-434`); it is not part of this row.

## Context

Read on `origin/main` `b3bcb26f`.

**The discovery seam exists only as types.**

- `apps/ingest/src/adapter/types.ts:75-76` declares
  `discover?(): Promise<readonly DiscoveredPoint[]>`, and `:133` declares
  `supportsDiscovery?` on the factory. `packages/shared/src/ingest.ts:152-158`
  declares `DiscoveredPoint { sourceKey, label?, unit?, sampleValue? }`. ADR
  0016 §1, §7 and §8 name `F3.24` as their consumer.
- `apps/ingest/src/adapter/registry.ts:28-33` registers one adapter, `mqtt`.
  `apps/ingest/src/adapters/mqtt.ts` has no `discover()` and no
  `supportsDiscovery`. MQTT is push-only and cannot browse. ADR 0016 §7 states
  that OPC-UA and an SNMP walk can browse and Modbus generally cannot. The
  adapters that can browse are `F1.4` and `F1.5`, and both are parked.

**The API cannot reach the adapters.**

- `apps/api` has no import from `apps/ingest` and no `mqtt` dependency.
- The ingest health server answers only `GET /` and `GET /health`, for a
  loopback `Host` (`apps/ingest/src/host/health-server.ts:17`, `:306`,
  `:333`). No API-to-ingest channel exists.
- The ingest service runs only in the `ingest`, `pilot` and `phe` compose
  profiles (`docker-compose.yml:593`).
- The normaliser counts an unmapped source key
  (`apps/ingest/src/host/normaliser.ts:369`,
  `counters.unmappedSourceKey += 1`) and stores no key, so no record of "keys
  seen on the wire" exists to stand in for discovery.

**The protocol catalog reads empty, and this is measured.**

- `bms.protocol_catalog` is declared in
  `packages/db/src/schema/bms-schema.ts:671-679` (ADR 0016 cites `:216`; the
  file has grown since). No file under `packages/db/drizzle/` and no file in
  `packages/db/docker-init/` creates it, and no Drizzle snapshot or journal
  names it: only `bms-schema.ts` contains the string under `packages/db`. On
  the running `bms-postgres-1`, `to_regclass('bms.protocol_catalog')` returns
  no relation, while `bms.rtus` is present.
- `OnboardingProtocolService.listCatalog`
  (`apps/api/src/admin/onboarding/onboarding-protocol.service.ts:54-69`)
  catches the error and returns `[]`. The `registry.ts:9-16` docblock already
  records this: the catalog "has been silently reading empty since ADR 0011".
- So `formatForAssistant` (`:103-119`) has no catalog lines. The agent's
  `list_protocols` tool (`onboarding-agent-tools.ts:289-294`) and the guided
  protocol-question intercept (`onboarding-chat.service.ts:281-290`) return
  only the organization's RTU examples, or the line "No existing RTU protocol
  examples in this org yet. Try **…** with **MQTT**." They never return a
  label, a description, `ingestWired` or an example config.
- ADR 0016 Resolved decision 2 said the defect was "tracked as its own
  standalone item". No row in `docs/BACKLOG.md` names `protocol_catalog`.

**Per-protocol prompts and checks are MQTT-only.**

- `onboardingDraftRtuSchema.config` is `z.record(z.unknown())`
  (`packages/shared/src/contracts/onboarding.ts:231-245`).
  `onboardingProtocolSchema` (`:27-36`) has eight values, and two of them,
  `simulator` and `catalog`, have no adapter by design.
- `onboarding-validate.service.ts:146-199` checks only MQTT by hand: a topic is
  present, an MQTT topic has no wildcard (`F4.215`), and a nested
  `config.device.topic` has no wildcard (`F4.221`). The topic-length check
  (`F4.208`) runs for every protocol. Nothing checks a non-MQTT config.
- `mqttConfigSchema` (`host`, `port`, `rejectUnauthorized`) and
  `mqttDeviceSchema` (`topic`, with the wildcard refine) live in
  `apps/ingest/src/adapters/mqtt.ts:29-42` and `:62-82`. The API never applies
  them. MQTT `host` and `port` can come from the env fallback
  (`apps/ingest/src/host/bindings.ts`, `resolveMqttConnection`).
- The rule-based `defaultConfig`
  (`onboarding-chat-rule-based.ts:563`) is the only per-protocol prompt logic.
- `F4.221` moved `mqttTopicHasWildcard` into `@bms/shared/ingest`
  (`packages/shared/src/ingest.ts:48`), so that ingest, the agent and the admin
  RTU routes share one predicate. This is the shipped precedent for sharing an
  adapter's data contract.

**The agent's protocol surface today** is `list_protocols`, `add_rtu` and
`update_rtu` with a free-form `config`, the credential refusal of
`CREDENTIAL_CHECKED_TOOLS` (`onboarding-agent-tools.ts:89`, `:254`), and the
freeze of host, port, TLS, protocol and code once credentials are set
(`:329-345`).

## Re-scope

The row text, "agent drives protocol-based device onboarding (per-adapter
discovery/prompts)", is stale. Per-adapter discovery has no adapter to call.
The row splits in two:

- **`F3.24a` — protocol-aware prompts and checks. Buildable now.** A real
  protocol catalog, the MQTT config and device schemas shared with ingest, a
  per-protocol check on `rtus[].config`, and a `list_protocols` answer that
  names the fields each protocol needs. This record rules it.
- **`F3.24b` — live point discovery. Deferred.** A discovery action that
  returns `DiscoveredPoint[]` into the draft as mapping candidates for
  `F3.23`. It depends on `F1.4` or `F1.5` and needs its own ADR (decision 7).

## Gate questions

1. **What does `F3.24` deliver now, when no registered adapter can browse?**
   Options:
   - A. Split: `F3.24a` (the catalog and schema-driven prompts and checks)
     now; `F3.24b` (live discovery) deferred until `F1.4` or `F1.5`.
   - B. Build MQTT topic-sniff discovery now: connect with the draft
     credentials, subscribe to the draft topic for N seconds, return the keys
     seen. Not buildable as stated: `apps/api` has no `mqtt` dependency (a new
     dependency and an ADR), it cannot import `apps/ingest` (ADR 0016 §8), no
     API-to-ingest channel exists, draft `_secrets` are encrypted in the
     session and keyed by RTU code, and `RtuBinding` needs an `rtuId` that
     does not exist before commit. It also adds SSRF exposure for one protocol
     whose keys `F3.23`'s Q&A and the mapping sheet already capture.
   - C. Park all of `F3.24` until A4 or `F1.4`, and raise the catalog defect
     as its own F4 row. Ships nothing of the prompts.

   **Ruled as recommended: A.** It delivers the part of the row that has a
   producer and a consumer today, and it fixes a measured defect that every
   chat sees. It does not build discovery against an interface that no adapter
   implements.

2. **Which row owns the empty `bms.protocol_catalog`?** Options: A. `F3.24a`;
   B. `F3.26` (grounding on protocols); C. a separate F4 row fixed before
   either. **Ruled as recommended: A, `F3.24a`.** `F3.24a`'s prompts are the
   first consumer that breaks while the catalog reads empty, and one owner
   keeps `F3.24a` and `F3.26` from editing `onboarding-protocol.service.ts` in
   parallel. The `F3.26` ruling (ADR 0095) leaves protocol grounding to this
   row.

3. **Where does the protocol catalog live?** Options:
   - A. A code-defined catalog in `@bms/shared/ingest`, and the
     `protocolCatalog` Drizzle declaration is deleted.
   - B. A migration creates `bms.protocol_catalog` and a seed fills it from a
     code constant. This is ADR 0016 C3's literal text. It needs a migration,
     ADR 0045 grants to `bms_app` and `bms_fleet`, and a seed step, for a
     table that only mirrors code.
   - C. A migration seeded by hand-written SQL rows. Rejected: it is the
     two-sources drift that `registry.ts` warns about.

   **Ruled as recommended: A.** The table has never existed in any database,
   so nothing reads a real row. A code catalog cannot go silently empty, and
   ADR 0016 already rules that the code is the truth. Option B stays the path
   if the owner later wants a catalog that an admin can edit.

4. **How does the API get each protocol's config shape?** Options:
   - A. Move `mqttConfigSchema` and `mqttDeviceSchema` (and each later
     adapter's schemas) to `@bms/shared/ingest`; ingest imports them.
   - B. `apps/api` imports the `apps/ingest` registry or factories. Not
     buildable: ADR 0016 §8 keeps the factory interface inside
     `apps/ingest`, `apps/api` has no dependency on it, and the import would
     pull `mqtt` and `pg` into the API bundle.
   - C. Extend the hand-written MQTT checks in
     `onboarding-validate.service.ts` for each protocol. Rejected: a second
     copy drifts from ingest's schema by construction, which is the class of
     drift `F4.221` removed.

   **Ruled as recommended: A.** One schema and three readers (ingest, the
   validator, the agent tools), as `F4.221` did for the wildcard predicate. A
   draft config that the validator passes and ingest refuses becomes
   impossible.

5. **When live discovery is built (`F3.24b`), who starts the device
   connection?** Options:
   - A. A user-initiated button or endpoint only; the model reads the stored
     results but cannot start a connection.
   - B. A model-callable `discover` tool. It would be the first tool with
     external I/O, with a host and port that a prompt-injectable model chose
     (SSRF), and a live connection counts against the 45 s `TURN_DEADLINE_MS`.
   - C. Rule it later, in the `F3.24b` ADR.

   Neither A nor B is buildable on `main`: no adapter implements `discover()`
   and no API-to-ingest channel exists. **Ruled as recommended: C, with A as
   the recorded default position** (decision 7).

6. **What happens to an RTU whose protocol has no adapter schema** (`simulator`,
   `catalog`, and `modbus_tcp`, `bacnet`, `opc_ua`, `snmp`, `rest_poller` until
   `F1.2`–`F1.5`)? Options:
   - A. Allow it as "config only, not ingested", and say so in the reply and
     in the action line.
   - B. Refuse RTUs on a protocol with no registered adapter. Rejected: it
     breaks the `simulator` and `catalog` onboarding sources and existing
     Excel imports that use them, and the rule-based detection would have to
     change.
   - C. Allow it with a non-blocking `validate_draft` warning. Not buildable as
     stated: `validate_draft` returns `{ valid, readyToCommit, errors }` with
     no warnings channel, so it needs a contract change in `onboarding.ts` and
     on the web preview.

   **Ruled as recommended: A.** It matches ADR 0016 §3's skip-and-log rule and
   the v1 scope (MQTT, CSV and manual only), it keeps the `simulator` and
   `catalog` sources working, and it tells the user that the RTU is not
   ingested.

## Decision

1. **The split.** `F3.24` becomes `F3.24a` (this record, buildable now) and
   `F3.24b` (live discovery, a new row that depends on `F1.4` or `F1.5` and on
   `F3.23`). `F3.24a` builds no discovery, adds no `mqtt` dependency to
   `apps/api`, opens no channel from the API to ingest, and gives the model no
   tool that connects to a device.

2. **A code-defined protocol catalog in `@bms/shared/ingest`.** One read-only
   entry for each of the eight `onboardingProtocolSchema` values, in a module
   that `packages/shared/src/ingest.ts` re-exports. It does not go into
   `packages/shared/src/index.ts`: that file is 994 lines against the
   1,000-line cap of `AGENTS.md` §4.5 (the reason ADR 0016 §8 gave), and it
   already re-exports `./ingest` (`index.ts:994`), so `apps/api` reaches the
   catalog through `@bms/shared` without a new line there. Each entry carries
   the code, a label, a description, `ingestWired`, an example config, the
   required and optional config fields, `supportsDiscovery`, and the draft
   config schema of decision 4. The plan fixes the exact field names and the
   shared contract type (ADR 0030, §4.8).
   - **`ingestWired` cannot drift from the registry.** `packages/shared`
     cannot import `apps/ingest`, so the value is not read from `ADAPTERS` at
     runtime. Shared declares the list of protocols that have an adapter
     (today `mqtt` only), and `apps/ingest/src/adapter/registry.ts` is checked
     against that list at compile time, so a new adapter key that the shared
     list lacks, or a listed protocol with no adapter, fails the build. The
     direction is fixed: shared declares, the registry is checked. The
     existing `REGISTERED_PROTOCOLS` (`registry.ts:35`) stays the runtime list
     inside ingest.
   - **`supportsDiscovery` is `false` for every protocol** while no factory
     sets it. When `F1.4` or `F1.5` sets it on a factory, the same build must
     set it in the catalog; the plan names the check.
   - **No credential key in the catalog.** No required field, optional field
     or example-config key may match the secret-key list of
     `onboarding-redaction.ts` (`SECRET_FRAGMENTS` and the agent's secret key
     names). A spec in `packages/shared` asserts it. Credentials stay on the
     RTU credential step (ADR 0022).

3. **The `protocolCatalog` Drizzle declaration is deleted**
   (`bms-schema.ts:671-679`). No DROP migration: no migration, snapshot,
   journal or init file creates or names the table. `OnboardingProtocolService`
   stops reading a table: `listCatalog()` returns the code catalog, and the
   `try { … } catch { return []; }` goes, so the catalog cannot read empty
   again in silence. `formatForAssistant` adds, for each protocol, the required
   and optional fields and whether it can browse.

4. **The MQTT config and device schemas move to `@bms/shared/ingest`.**
   `mqttConfigSchema`, `MqttConfig`, `mqttDeviceSchema` and `MqttDevice` move
   unchanged, with the `.default(true)` on `rejectUnauthorized` and the
   wildcard refine. `apps/ingest/src/adapters/mqtt.ts` imports them, and
   `mqttAdapterFactory` does not change. Each later adapter (`F1.2`–`F1.6`)
   puts its `configSchema` and `deviceSchema` in `@bms/shared/ingest` the same
   way (see *Amended records*, ADR 0016 §7). The schemas are non-secret by ADR
   0016 §7, and stay so.
   - **The draft schema for MQTT is looser than the ingest schema in one
     place.** `host` and `port` are not required in the draft, because ingest
     can supply them from the env fallback (`resolveMqttConnection`). Every
     field that is present is checked with the shared schema, so a string
     port, a zero port or a wildcard device topic is refused.
   - **The wire contract does not change.** `onboardingDraftRtuSchema.config`
     stays `z.record(z.unknown())`. The per-protocol check is a refinement in
     the validator and the tools, not in the contract, so the web preview, the
     Excel import and `PATCH sessions/:id/draft` keep their shapes.

5. **The validator and the agent tools apply the protocol's schema.**
   - `OnboardingValidateService` (and so `validate_draft`) parses each
     `rtus[i].config` with its protocol's draft schema and reports each issue
     as `rtus.<i>.config.<path>` with the issue message, never the value
     (§9.6). The owner-ruled topic messages of `F4.208`, `F4.215` and `F4.221`
     stay; a check that the shared device schema now covers may go, with the
     plan naming which.
   - `add_rtu` and `update_rtu` parse `config` with the same schema after the
     credential walk and the credentials freeze, and refuse an invalid config
     as a tool error that names the field path. `update_rtu` uses the patched
     protocol, or the stored one. A refused call leaves the working draft
     unchanged.
   - `list_protocols` returns the catalog, with the fields each protocol needs,
     so the model asks for the right keys instead of guessing. No tool is
     added: the tool count stays 24 (ADR 0091 decision 3).
   - The system prompt tells the model to call `list_protocols` before
     `add_rtu` for any protocol other than MQTT, and never to ask for a
     credential value in chat.
   - The rule-based `defaultConfig` reads the catalog's example config for
     a non-MQTT protocol; its MQTT branch (the env fallback, `F4.104`'s cut)
     does not change. This is the only rule-based change; `F3.27` owns parity.

6. **An RTU on a protocol with no adapter is "config only, not ingested".**
   No protocol schema applies to it, so any config shape passes that step. The
   checks that do not depend on the protocol still apply: the element schema,
   the topic-length bound (`F4.208`), the credential refusal and the draft
   caps. The `add_rtu` and `update_rtu` action line, written by code, ends with
   `(config only, not ingested)`, and the `list_protocols` and intercept
   replies show `config only` for it. The commit and ingest's skip-and-log
   (ADR 0016 §3) do not change.

7. **`F3.24b` (live discovery) is deferred, with a default position.** It
   needs its own ADR, which rules: a new authenticated API-to-ingest channel,
   SSRF bounds on the host and port, a binding before commit with no `rtuId`,
   and the first external I/O in the agent's tool set. **The default position
   for that ADR is decision 5's option A:** discovery runs only on an explicit
   user action (a button or an endpoint), its results go into the draft as
   mapping candidates for `F3.23`, and the model reads them through a read
   tool but cannot start a connection. That keeps ADR 0090 ruling 1 (the model
   edits only the draft). The `F3.24b` ADR makes the final ruling. MQTT topic-sniff discovery is not the default and is not
   recommended (gate question 1, option B).

8. **Delivery and verification.** The plan proposes two PRs: PR 1 is decisions
   2–4 (the shared schemas, the code catalog, the deleted declaration and the
   service); PR 2 is decisions 5 and 6. Verification:
   - **Database:** `drizzle-kit generate` emits no file after the declaration
     is deleted, and a cold start (roles, migrate, seed) on a scratch database
     is unchanged.
   - **Ingest:** shared is rebuilt before the ingest suite (`tests/` reads
     `packages/shared/dist`); a mutation of `mqttTopicHasWildcard` must redden
     ingest's wildcard case; the rebuilt `ingest` container still binds the
     PHE RTU, and a wildcard topic still logs `invalid-device-config`.
   - **API:** each refusal path (a bad field in `validate_draft`, in `add_rtu`
     and in `update_rtu`) has its own test and its own mutation; an absence
     check (the draft is unchanged) sits beside a positive one (the same call
     with a valid config succeeds); `listCatalog()` returns eight entries.
   - **Browser:** the protocol reply and the `(config only, not ingested)`
     action line, asserted with `javascript_tool` through the
     `browser-verifier` agent.

## Dependencies

None. No new npm package. `zod` is already a runtime dependency of
`packages/shared` (ADR 0030). No migration: decision 3 deletes a declaration
of a table that no database holds.

## Consequences

- **Every chat gets a protocol catalog again.** `list_protocols` and the
  guided intercept name all eight protocols, which of them ingest, and what
  config each needs. The replies change, so specs that pin the old empty
  output ("Try **…** with **MQTT**", "No existing RTU protocol examples")
  change with them.
- **A draft MQTT config that ingest would refuse is refused before commit.**
  The validator, the tools and ingest read one schema. A draft that commits
  today with an invalid present field (for example a string `port`) no longer
  passes `validate_draft`. Drafts that omit `host` and `port` still pass.
- **The ingest build now depends on the shared schemas.** A change to the MQTT
  schemas is a change to `packages/shared`, and the ingest host loads the
  built package. Shared must be rebuilt before the ingest suite and the image.
- **The `protocol_catalog` table is gone from the schema.** An admin-editable
  catalog would now need a new ADR, a migration, grants and a seed (gate
  question 3, option B).
- **The secret-key list has a second copy.** The shared catalog spec cannot
  import the API's `isSecretKey`, so it asserts against a copy of
  `SECRET_FRAGMENTS` and the agent's secret key names. A change to the API
  list must also change the copy. `F4.185` (the narrow scrub) stays its own
  row; a schema-driven prompt must not widen what reaches the model.
- **`F3.27`'s parity work grows by one read.** The rule-based `defaultConfig`
  now reads the catalog; the other new prompt and validation paths go through
  shared code that both modes call, or are recorded for `F3.27`.
- **File conflicts with `F4.223` and `F4.224`.** Both touch
  `onboarding-chat-rule-based.ts`, `onboarding-validate.service.ts` and the
  intercept in `onboarding-chat.service.ts`. They must land in sequence with
  `F3.24a`, not in parallel worktrees. **Open:** the order (before, after, or
  folded into PR 2) was not ruled on 2026-10-06 and is owed before the plan
  starts.
- **Deferred:** live point discovery (`F3.24b`, decision 7); any `mqtt`
  dependency in `apps/api`; a model-started connection; an admin UI or table
  for the catalog; a warnings channel on `validate_draft`; config schemas for
  `F1.2`–`F1.6`, which each adapter row brings.

## Amended records

- **ADR 0016 Options C3, adopted by §3** — "`protocol_catalog` becomes
  *metadata seeded from* this map" becomes: the catalog is code in
  `@bms/shared/ingest`, and no table holds it (decisions 2 and 3). The
  `registry.ts:9-16` docblock repeats the old sentence; the build updates it.
  §3's static `ADAPTERS` map, `satisfies` check, binding rule and skip-and-log
  rule stand, and `registry.ts` gains the compile-time check of decision 2.
- **ADR 0016 Resolved decision 2** — "tracked as its own standalone item"
  becomes: `F3.24a` owns the defect (gate question 2). No other row exists.
- **ADR 0016 §7, the schema bullet** — an adapter's Zod `configSchema` and
  `deviceSchema` live in `@bms/shared/ingest`, not in
  `apps/ingest/src/adapters/<protocol>.ts`; the adapter file imports them and
  its factory references them. They stay non-secret, with a one-line JSDoc on
  each field. The `discover()` bullet now names `F3.24b` as the consumer.
- **ADR 0016 §8** — `packages/shared/src/ingest.ts` (and the modules it
  re-exports) holds the adapters' config and device schemas and the protocol
  catalog, as well as the types §8 lists. The factory interface and every
  other type in `apps/ingest/src/adapter/types.ts` stay in `apps/ingest`.
- **ADR 0016 §1, §7, §8 and *Consequences*, the `F3.24` references** — the
  consumer of `discover()`, `supportsDiscovery` and `DiscoveredPoint` is now
  `F3.24b`. The seam itself does not change.
- **ADR 0090 decision 4** — `add_rtu` and `update_rtu` also refuse a `config`
  that fails its protocol's draft schema, and `list_protocols` returns the
  catalog with each protocol's fields. The tool set stays as ADR 0091
  decision 3 left it.
- **ADR 0090 decision 8** — "the … `validate` … route[s] do not change"
  becomes: `validate` also checks `rtus[].config` against its protocol's draft
  schema (decision 5 above). The commit transaction does not change.
- **ADR 0090 *Consequences*, the *Deferred* bullet** — "protocol discovery
  (`F3.24`)" becomes: live discovery (`F3.24b`) only; the protocol prompts
  and checks are no longer deferred.
- **ADR 0043 decision 5** — `protocol_catalog` is not a table: the protocol
  catalog is code in `@bms/shared/ingest` (decision 3), so the vocabulary
  table list no longer names a table that exists.

**Confirmed unchanged:** ADR 0016 §1 (the interface, including the optional
`discover()` and `supportsDiscovery`), §3's binding and skip-and-log rules,
and Amendment 1 (schemas with `.default()` move intact); ADR 0012 and ADR 0022
(credentials stay on the RTU credential step); ADR 0030 (`rtus[].config`
stays `z.record(z.unknown())` on the wire); ADR 0090 ruling 1 and decision 5
(the model edits only the draft and cannot commit); ADR 0091 (the template
tools and the tool count).
