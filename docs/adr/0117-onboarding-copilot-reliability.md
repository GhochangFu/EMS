# ADR 0117 — Onboarding copilot reliability: true replies, catalog point keys, credential reuse, topic release and locked drafts (`F4.339`, `F4.328`, `F4.327`)

## Status

**Accepted — 2026-11-08** (owner, in chat: "Accept"; proposed the same day). Raised by the agent for backlog row `F4.339`, the
umbrella row the owner asked for after onboarding all six BCPL locations on
`bms.demosites.co.in` on 2026-11-08 (21 RTUs; the copilot was used for LAKWA
and LALMATI and then, on the owner's ruling, the draft API for the rest). The
owner gave nine rulings in chat on 2026-11-08, one at a time, before this
record was written (listed under *Rulings*). Lines marked *(drafter)* are
drafter calls that the `F4.339` plan may refine; the others are rulings.

It is a scope change because it adds a migration (a draft lock and an RTU
topic record), a credential route and new copilot behaviour. It promotes
nothing out of AGENTS.md §6 and adds no dependency (§9.4).

**Amends:**
- [ADR 0090](./0090-onboarding-agent-tool-calling-loop.md) decision 6 (how
  earlier action rows reach the model) and Amendment 4 D3 (which lines code
  may write into a reply);
- [ADR 0092](./0092-onboarding-agent-point-keys-and-source-tag-mapping.md)
  decision 3 (when the point-keys step is complete);
- [ADR 0103](./0103-mqtt-live-discovery-for-onboarding.md) decision 5 (the
  window maximum) and Amendment 1 item 7 (the device key and copied
  credentials);
- [ADR 0022](./0022-onboarding-credential-capture.md) decision 1 (the only way
  credentials enter onboarding).

**Closes** `F4.328` and `F4.327` with `F4.339` (decision 10). Code citations
are to `main` at `8b64cf03`.

## Context

The BCPL onboarding of 2026-11-08 recorded fifteen copilot defects in
`F4.339` and two older ones in `F4.327` / `F4.328`. A read of the code on
2026-11-08 found:

- **Replies that claim writes that were never made (`F4.328`).** A successful
  tool write always stores its `action` rows and checkpoint in the same locked
  update as the reply (`onboarding.service.ts:476-545`); a refused write adds a
  `Not applied:` line (ADR 0090 Amendment 4). So a reply that reads like action
  lines with no action row is a turn in which **the model called no tool**. The
  cause is ADR 0090 decision 6: `buildHistory` replays every stored `action`
  row to the model as plain **assistant** text (`onboarding-agent-loop.ts:108-119`),
  so the model sees its own past turns as lines such as "Added asset …" and
  copies the pattern. One reply on 2026-11-08 read
  `Mapped 'treated_water_flow_klh' → 'tired_water_flow_klh' …` followed by
  `[Silence — the assistant does not continue beyond this message.]`. The plain
  copilot already marks replayed action rows (`COPILOT_ACTION_RECORD_PREFIX`,
  `copilot-turn.service.ts:85, 316`) and checks card claims (`F4.293`/`F4.295`,
  `copilot-card-claim.ts`); the onboarding agent has neither.
- **The point-keys gate** needs declared `pointKeys` (`draftNeedsPointKeys`,
  `onboarding-validate.service.ts:69-75`) even when every mapping uses an
  existing catalog key, while the copilot says no declaration is needed.
- **Discovery** shows no card in several cases (`copilot-onboarding-discovery.ts:50-80`),
  the drawer is fixed at 60 s, and the maximum is 120 s (ADR 0103 decision 5),
  shorter than the ~160 s publish interval of some ThinkIoT meters.
- **Credentials** are entered once per RTU (ADR 0022 decision 1); BCPL typed one
  broker login 21 times. A server-side copy of the ciphertext already exists for
  discovered devices (`copyEncryptedCredentials`, `onboarding-redaction.ts:517-540`).
- **A deactivated RTU keeps its MQTT topic**: `RtusService.deactivate` only sets
  `active = false` (`rtus.service.ts:432-472`), and `rtus_mqtt_topic_idx`
  (`0016_org_location_rtu_hierarchy.sql:65`) covers inactive rows, so a new RTU
  cannot take the topic. Ingest filters `ingest_enabled`, not `active`
  (`apps/ingest/src/host/bindings.ts:176-188`).
- **Any draft can be changed by anyone with access**, including a draft kept as
  defect evidence (the agent changed the `F4.327` evidence draft by mistake).
- **The draft location has no timezone field** (`onboarding.schema.ts:79`), so
  the model wrote "Asia/Kolkata" into `capital`.
- **The draft MQTT config is `.passthrough()`** (`packages/shared/src/ingest-adapters/mqtt.ts:84-95`),
  so `brokerHost` and `devId` were kept but read by nothing (`F4.327`).

## Rulings

Given by the owner in chat on 2026-11-08, one question at a time.

| # | Question | Ruling |
|---|---|---|
| R1 | Item 8 — the model imitates action lines | Mark replayed action rows as system records, and add a reply-claim guard with one retry |
| R2 | Item 4 — point-keys gate vs the copilot | The gate accepts mappings to existing catalog keys; listing them in `pointKeys` becomes optional |
| R3 | Item 5 — turn limits | Keep 45 s / 8 calls; one asset or device per turn; stop replies name what was and was not written |
| R4 | Item 3 — discovery window | Every proposal renders its card; the drawer gets a window field; the maximum rises to 300 s |
| R5 | Item 12 — credential reuse | Copy within one draft **and** from a committed RTU of the same organization and broker |
| R6 | Item 14 — topic of a deactivated RTU | Clear it on deactivate (kept in a record, restored on reactivate if free); ingest skips inactive RTUs; no index migration |
| R7 | Item 15 — protecting drafts | A lock flag set by a global admin; a locked draft refuses every write |
| R8 | Item 2 — timezone | An optional IANA `timezone` field on the draft location, written to `bms.locations.timezone` at commit |
| R9 | Item 13 and `F4.327` | Discovery offers the found device key as the RTU code (one action, never automatic) and names the topic when nothing arrives; the draft MQTT config refuses unknown keys with a hint |

## Decision

1. **Replayed action rows are records, not the model's words (R1, amends
   ADR 0090 decision 6).** `buildHistory` sends each stored `action` row to the
   model as a marked record — the same convention as the plain copilot's
   `COPILOT_ACTION_RECORD_PREFIX` *(drafter: reuse that constant)* — and the
   system prompt says the records are written by the system and are never to
   be reproduced as text. The user-visible thread is unchanged.

2. **A reply may claim only what was stored (R1, amends ADR 0090 Amendment 4
   D3).** After a turn ends with stop reason `final`, code compares the reply
   with the turn's action lines. A reply that states a write (a fixed set of
   verbs and the tool-line shapes — `Added …`, `Mapped …`, `Updated …`,
   `Removed …`, `Set location …`, `Proposed …` *(drafter: the plan lists the
   patterns)*) while the turn has **no** successful write gets **one** retry
   with a correction that names the missing tool call. If the retry still
   writes nothing, the stored reply is replaced by the fixed line
   "Nothing was written in this turn." followed by the model's own text
   stripped of the false claim *(drafter)*. A turn that did write is not
   checked. Code-written lines remain limited to refusals, stop replies and
   this line.

3. **Turn limits stay; turns stay small (R3).** `MAX_TOOL_CALLS_PER_TURN` (8)
   and `TURN_DEADLINE_MS` (45 s) are unchanged (ADR 0090 decision 3). The system
   prompt asks for one asset with its mappings, or one discovered device, per
   turn, and to offer "Next". A stop reply lists the action lines that were
   stored and says plainly that the rest was not.

4. **The point-keys step accepts catalog keys (R2, amends ADR 0092 decision
   3).** The step is complete when the draft declares `pointKeys`, or sets
   `useExistingPointKeys`, **or** every mapping names an active catalog point
   key. Declared keys still win for a new key. Validate and the phase inference
   use the same rule, so "confirm point keys" moves on when the mappings are
   complete.

5. **Discovery cards and windows (R4, amends ADR 0103 decision 5).** Every
   accepted discovery proposal renders its card with the proposed window, also
   when another change is open (the card is queued, not dropped) *(drafter: the
   plan decides queue vs replace)*. The maximum window rises from 120 s to
   **300 s**; the default stays 60 s. The draft-preview drawer gets a window
   field (10–300 s). The worker's job timeout and the broker connection limits
   follow the new maximum *(drafter: the plan checks the BullMQ job and the
   collector timeouts)*.

6. **Discovery offers the device key and names the topic (R9, extends ADR
   0103 Amendment 1 item 7).** When an RTU's discovery finds exactly one
   device, the result card and the copilot summary offer "Use `<deviceKey>` as
   this RTU's code" — one `update_rtu` write, never automatic. When nothing
   arrives, the fixed text names the topic: "No message arrived on topic `<t>`
   in `<n>` s — check the topic name and the window."

7. **Credential reuse (R5, amends ADR 0022 decision 1 and ADR 0103 Amendment
   1 item 7).** A new route `POST /api/v1/admin/onboarding/sessions/:id/credentials/copy`
   with body `{ toRtuIndexes: number[], from: { rtuIndex } | { rtuId } }`
   copies an **encrypted** credential server-side; no secret crosses the API in
   either direction.
   - **From the same draft** (`rtuIndex`): as `copyEncryptedCredentials` does
     for discovered devices.
   - **From a committed RTU** (`rtuId`): the RTU must belong to the session's
     organization, be in the caller's writable scope, and have a stored
     credential.
   - **Both:** the source and every target must share host, port and TLS
     (`sameConnection`); a target that already has a credential is refused
     unless the body says `replace: true` *(drafter)*; the copy re-encrypts
     under the current key version (ADR 0062) *(drafter: or copies the blob
     when the version is current)*; it runs under the session lock and binds
     the draft hash like `POST :id/credentials`; it is audited as
     `onboarding.credentials.copy` with the source and target codes, never the
     value. The copilot may **propose** a copy (a card the admin confirms) but
     never sees a credential (ADR 0022 decision 2). The RTU step shows "Same
     credentials as …" beside "Add credentials".

8. **Deactivating an RTU releases its topic (R6).** A forward-only migration
   adds `bms.rtus.released_mqtt_topic text null`. `RtusService.deactivate`
   moves `mqtt_topic` into it and sets `mqtt_topic = null` in the same
   transaction; `reactivate` moves it back when no other RTU holds that topic,
   and otherwise reactivates without a topic and says so. The index
   `rtus_mqtt_topic_idx` is unchanged (no ADR 0008 change). The ingest binding
   query adds `r.active = true`. The onboarding commit conflict for a topic
   names the holding RTU when it is in the session's organization, and keeps
   today's fixed text otherwise (no other tenant's row is named).

9. **Locked drafts (R7).** A forward-only migration adds
   `bms.onboarding_sessions.locked_at timestamptz null`, `locked_by uuid null`
   and `lock_reason varchar(500) null`. `POST …/sessions/:id/lock { reason }`
   and `POST …/sessions/:id/unlock` are global-admin only and audited. A locked
   draft refuses chat turns, `PATCH draft`, upload, credentials, discovery,
   rollback and commit with one fixed 409 message that gives the reason; it
   stays readable. The Resume list and the panel show a lock badge.

10. **Draft contract fixes (R8, R9).**
    - The draft location gains optional `timezone` (an IANA zone validated
      against `Intl.supportedValuesOf("timeZone")` *(drafter)*); `set_location`
      writes it; the commit writes it to `bms.locations.timezone`. A stored
      `meta.timezone` is read as a fallback for drafts made before this ADR.
    - `set_location` writes `parentCode: null` when the user says "top level"
      (ADR 0098 Amendment 2 B6, already on the guided path).
    - The draft MQTT config refuses keys it does not read, with a fixed hint
      for known mistakes (`brokerHost → host`, `devId → rtuCode`); an MQTT RTU
      without `host` fails validation (closes `F4.327`). A stored draft with a
      stray key is reported by validate, not rewritten.

11. **Plain fixes inside existing decisions (no ADR change):**
    "Onboard with AI" opens the draft picker when the organization has drafts
    (item 1, ADR 0099 Amendment 2 A1); committed asset points take the catalog
    unit when the mapping has none (item 6, ADR 0092 D4, respecting ADR 0104);
    Undo says why it is disabled and works on a credentialed draft whose
    history exists (item 10, ADR 0094); the commit wizard refetches the session
    before it opens (item 11, ADR 0099 decision 7).

## Dependencies

None.

## Consequences

- `F4.328` closes with a known cause and a guard that does not depend on the
  model; the plain copilot's own guard pattern is reused.
- Two forward-only migrations (`rtus.released_mqtt_topic`; the three lock
  columns on `onboarding_sessions`). Both go through the `migration-reviewer`
  agent; the credential copy, the lock routes and the ingest query change go
  through the `security-reviewer` agent.
- The credential copy widens where a ciphertext may be read: a committed RTU's
  credential can now seed a draft in the same organization. The scope check,
  the same-connection rule and the audit row are the controls.
- A 300 s discovery holds one broker connection five times longer; with the
  ADR 0103 per-organization limit unchanged, a second discovery waits longer.
- ADR 0099's copilot catalog gains a credential-copy proposal; the plan decides
  whether that needs ADR 0099 Amendment 18 *(drafter: likely yes, as for
  Amendment 17)*.
- **AGENTS.md:** no §6 item moves. A later `chore(agents):` sweep may index
  this ADR (§10.1).
