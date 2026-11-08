# ADR 0116 — A catalog of MQTT payload formats, chosen per RTU (`F4.334`, `F4.335`)

## Status

**Accepted — 2026-11-08** (owner, in chat: "Accept"; proposed the same day). Raised by the agent on 2026-11-08 while onboarding
the 21 BCPL water flow meters on `bms.demosites.co.in` (row `F4.334`). The
owner widened the scope the same day: the fix must not be a BCPL or ThinkIoT
special case, but a platform-wide way to accept any organization whose devices
publish over MQTT in their own shape. The owner gave eight rulings in chat on
2026-11-08, one at a time, before this record was written (listed under
*Rulings*). Lines marked *(drafter)* are drafter calls that the `F4.334` plan
may refine; the others are rulings.

Promotes nothing out of AGENTS.md §6 and adds no dependency (§9.4). It is a
scope change because it adds a table, admin routes, an admin page and new
ingest and discovery behaviour.

**Amends [ADR 0016](./0016-ingest-adapter-framework.md)** (the MQTT adapter's
fixed payload parse) and **[ADR 0103](./0103-mqtt-live-discovery-for-onboarding.md)**
(discovery's collector). **Closes `F4.335`** as part of the build (decision 8).
Code citations are to `main` at `9b9b3f85`.

## Context

**What exists today.**

- One payload shape is known: the PHE (ThinkIoT) envelope
  `{ dev_id, ts, values }`, parsed by `parseMqttEnvelope`
  (`packages/shared/src/ingest-adapters/mqtt-envelope.ts`). Both the ingest
  MQTT adapter (`apps/ingest/src/adapters/mqtt.ts`) and the onboarding
  discovery collector (`apps/api/src/onboarding-discovery/discovery-collector.ts`)
  call it. Its own docblock says the envelope keys are "ThinkIoT's envelope,
  not MQTT's" and must "become per-connection configuration rather than a
  module constant".
- The adapter routes a message by the parsed `devId` to the binding whose
  `deviceKey` is `rtus.rtu_code` (`apps/ingest/src/host/bindings.ts`), and
  accepts it only when that `devId` is bound to the topic it arrived on
  (`deviceKeysByTopic`, `F1.7`). Readings are looked up by
  `asset_points.source_data_key`. Payloads over `MAX_PAYLOAD_BYTES` (256 KiB)
  are refused before decoding.
- The BCPL meters publish
  `[{ "Data": [16294,26214,81,18230,9202,113,17852,-17809,177,82], "Timestamp": "1794077986", "TagName": "BCPL_LAKWA_02" }]`
  every ~10 s: a one-element array, signed 16-bit registers, big-endian float32
  pairs at `Data[0..1]` (flow m³/h) and `Data[3..4]` (cumulative m³),
  `Timestamp` in epoch seconds as a string, `TagName` as the device name, and
  no `dev_id`. Every such message fails `parseMqttEnvelope`: discovery stores
  `messages: 0, skipped: 6` and ingest would drop every sample.
- The discovery drawer shows "No device published in the window" whenever
  `messages` is 0, and never shows `skipped` (`F4.335`).

## Rulings

Given by the owner in chat on 2026-11-08, one question at a time.

| # | Question | Ruling |
|---|---|---|
| R1 | Where a payload format lives | A shared catalog of named formats; each RTU names one; the PHE envelope is the built-in default |
| R2 | Who edits formats | Global admin, in an admin page with a test box; every change audited |
| R3 | Shapes in the first release | Named JSON fields and numeric register arrays; root may be an object or an array of records |
| R4 | Register types | int16, uint16, int32, uint32, float32, float64; word and byte order; optional scale and offset per reading |
| R5 | Device key and time | A field path each; no device-key path means the topic is the key; time units epoch s, epoch ms, ISO 8601; a bad time is left absent |
| R6 | Discovery | Tries every format, reports which one decoded each device, stores it on the draft RTU; the admin may change it; closes `F4.335` |
| R7 | BCPL readings mapped now | Flow (`Data[0..1]`) and cumulative total (`Data[3..4]`) only; the rest waits for ThinkIoT |
| R8 | Where the format is chosen | Per RTU (`payloadFormat` in the connection config, absent = the built-in envelope); edits apply at the ingest reload; a format in use cannot be deleted |

## Decision

1. **Catalog table (R1).** A forward-only migration adds
   `bms.mqtt_payload_formats`: `id uuid pk`, `code varchar(64) unique`
   (kebab-case), `name`, `description`, `definition jsonb not null`,
   `builtin boolean not null default false`, `created_at`, `updated_at`,
   `updated_by`. It is a **platform catalog**, not tenant data: no
   `organization_id`, readable by every role that can read an RTU config,
   writable only through the routes in decision 5 *(drafter: RLS and grants
   follow the other platform catalogs; the plan names the precedent)*.

2. **The built-in default (R1, R8).** The migration seeds one row,
   `thinkiot-envelope`, `builtin = true`. Its decoder **is**
   `parseMqttEnvelope`, unchanged — the row only names it. A built-in row
   cannot be edited or deleted. An RTU config without `payloadFormat` uses it,
   so every RTU committed before this ADR (all PHE RTUs) behaves exactly as
   today.

3. **The format definition (R3, R4, R5).** `definition` is data, never code:
   no expressions, no scripts, no regular expressions supplied by the admin. A
   Zod schema in `packages/shared/src/ingest-adapters/` (shared by api, worker,
   ingest and web) validates it, and one pure function
   `decodeMqttPayload(definition, topic, raw)` in the same package decodes a
   message into zero or more `{ deviceKey, at?, values }` records. The
   definition holds:
   - **`root`** — `object` or `array`. For `array`, every element is one
     record, up to a fixed cap per message *(drafter: 64)*.
   - **`deviceKey`** — a field path inside the record (BCPL `TagName`, PHE
     `dev_id`), or absent, in which case the **topic** is the device key.
   - **`time`** — optional field path plus unit `epoch_s`, `epoch_ms` or
     `iso8601`. A string holding a number is accepted. A missing, non-finite
     or unparsable value leaves `at` absent — never `Date.now()` — as
     `parseMqttEnvelope` already does (ADR 0061).
   - **`readings`** — a list, capped *(drafter: 128 per format)*, each with a
     `key` (the `source_data_key` it feeds) and one source:
     - **field**: a JSON path to a number or numeric string;
     - **register**: the path of a numeric array, a start `offset`, a `type`
       (`int16`, `uint16`, `int32`, `uint32`, `float32`, `float64`), and the
       format's `wordOrder` and `byteOrder` (`big` | `little`). Register
       values are read as 16-bit words; a signed word (BCPL sends `-17809`) is
       taken as its 16-bit pattern.
     - optional `scale` and `offset` (value × scale + offset), applied before
       the point's own `scale_multiplier` / `scale_offset`.
   - A record whose register array is too short, or whose value decodes to
     NaN or ±Infinity, yields that reading as **absent**, not zero — the same
     `missing` / `empty` path the adapter already logs.

4. **Choice per RTU (R8).** `mqttConfigSchema` gains optional
   `payloadFormat: string` (a catalog `code`). The onboarding draft schema,
   the admin RTU routes and the onboarding tools accept it; a code that is
   not in the catalog is a validation error with fixed text. Two RTUs bound to
   the **same topic** must name the same format, or the second one is skipped
   with reason **`payload-format-conflict`** *(drafter)*. The binding query
   joins the catalog so the host holds the definition with the binding.

5. **Admin routes and page (R2).** `GET /api/v1/admin/mqtt-payload-formats`
   (list), `GET …/:code`, `POST`, `PUT …/:code`, `DELETE …/:code`, and
   `POST …/test` (decode a pasted sample against a definition, store
   nothing). Write routes are global admin only (`assertAdminRole`); reads
   follow RTU-config read access *(drafter)*. Writes audit as platform events
   `master.mqtt_payload_format.create|update|delete` (`organizationId: null`).
   `DELETE` of a format that any RTU or open onboarding draft names returns
   409 with the count, never the RTU list of another tenant *(drafter)*.
   Contracts live in `packages/shared/src/contracts/` (ADR 0030). The web gets
   a global-admin **Payload formats** page beside the other platform
   catalogs, with a test box: paste a sample message (and its topic) and see
   the decoded device keys, times and readings before saving. The test box
   echoes nothing to the server log.

6. **Ingest (amends ADR 0016).** The MQTT adapter decodes each message with
   the format of the topic it arrived on, through `decodeMqttPayload`. Routing
   and the `F1.7` topic check are unchanged: each decoded record's
   `deviceKey` must be one bound to that topic, else it is dropped as today.
   The `MAX_PAYLOAD_BYTES` check stays before decoding. A message that a
   format cannot decode is logged with the format `code` and a fixed reason,
   never the payload. A format edit reaches running endpoints at the next
   binding reload (`INGEST_RELOAD_MS`), using the supervisor replacement of
   ADR 0115 decision 6 when the definition of a running endpoint changed —
   no restart.

7. **Device key equals `rtu_code` *(drafter)*.** The decoded device key is
   matched against `rtus.rtu_code`, as today. For BCPL that means the RTU's
   code is the `TagName` (for example `BCPL_LAKWA_02`). Discovery proposes the
   decoded key as the RTU code (decision 8). The existing LALMATI draft
   (codes `12310`, `123410`) must be corrected before commit.

8. **Discovery (R6, amends ADR 0103, closes `F4.335`).** The collector tries
   the RTU's chosen format first, then every other catalog format, on each
   message, and records per device which format decoded it. The draft RTU
   stores that `payloadFormat`; the drawer shows it and lets the admin pick
   another. A message no format decodes counts in `skipped`; the stored result
   keeps a per-reason count. When `skipped > 0` the drawer and the copilot's
   discovery summary say how many messages arrived and were not decoded, in
   fixed text that echoes no payload — for example
   "6 messages arrived but none matched a known payload format".

9. **The BCPL format (R7).** The build seeds, or the global admin creates on
   AWS *(drafter: the plan picks one)*, a non-built-in format
   `thinkiot-register-array` with `root: array`, `deviceKey: TagName`,
   `time: Timestamp / epoch_s`, word and byte order `big`, and two readings:
   `treated_water_flow_klh` = float32 at `Data[0]`, and
   `outlet_flow_totalizer_kl` = float32 at `Data[3]` (m³/h = kL/h and m³ = kL,
   so no scale). `Data[6..7]`, `Data[9]` and the constants 81 / 113 / 177 stay
   unmapped until ThinkIoT explains them; the admin can add a reading later.

## Dependencies

None. Float and integer decoding uses `DataView`, available in every runtime
the repo ships.

## Consequences

- New organizations whose devices publish JSON fields or register arrays over
  MQTT onboard with a catalog entry, not a code change. Binary or hex Modbus
  frames are **not** covered; they need a later ADR.
- `parseMqttEnvelope` stays as the built-in decoder, so PHE ingest has no
  behaviour change. Its docblock's "per-connection configuration" note is
  answered by this ADR.
- The build touches `packages/db` (migration, seed), `packages/shared`
  (definition schema, decoder, contracts, `mqttConfigSchema`), `apps/ingest`
  (binding query, adapter, reload), `apps/api` (catalog routes, discovery
  collector, onboarding validation, copilot summary) and `apps/web` (payload
  formats page, draft drawer). Ingest and admin-route changes go through the
  `security-reviewer` agent; the migration through the `migration-reviewer`
  agent.
- A decoder bug now hits every RTU on that format, not one vendor's code
  path. The test box and the per-reason `skipped` counts are the guard; the
  plan adds golden-sample tests for the BCPL and PHE payloads.
- A format edit on a busy broker reconnects that endpoint once (ADR 0115's
  replacement cost).
- BCPL onboarding stays blocked until this is built and deployed; then
  discovery, the asset template mapping and the owner's commit follow.
- **AGENTS.md:** no §6 item moves. A later `chore(agents):` sweep may index
  this ADR (§10.1).
