# ADR 0119 — Binary MQTT payload formats (`F4.343`; amends ADR 0116)

## Status

**Accepted — 2026-11-09** (owner, in chat: "Accept"; proposed the same day). Raised by the agent on 2026-11-09 while preparing
the onboarding of organization **WBLDC** (West Bengal Livestock Development
Corporation) on `bms.demosites.co.in`, the owner's end-to-end test of
`F4.339`. The owner gave six rulings in chat on 2026-11-09, one at a time,
before this record was written (listed under *Rulings*). Lines marked
*(drafter)* are drafter calls that the `F4.343` plan may refine; the others
are rulings.

## Context

ADR 0116 made MQTT payload shapes a data catalog (`bms.mqtt_payload_formats`)
with two kinds: `builtin` (the ThinkIoT envelope) and `declarative` (JSON
fields and register arrays). Its Consequences said: "Binary or hex Modbus
frames are **not** covered; they need a later ADR." This is that ADR.

WBLDC's cold-chain temperature gateways publish to broker
`3.109.107.247:1883` (plain MQTT, login required) on five topics:
`Haringhata_VAP`, `Haringhata_GOAT`, `Haringhata_RAW`,
`Data_Siliguri_Chicken`, `Data_Siliguri2_Pork`. Ten minutes of samples
(100 messages, captured 2026-11-09 by a script the owner ran with the broker
login) show one shape on every topic:

- exactly **100 bytes**, once a minute, not valid UTF-8, so `JSON.parse`
  fails and today's `decodeMqttPayload` returns `not-json`;
- bytes `0–3`: a 4-byte field that differs per topic (not proven to be a
  stable device id);
- bytes `4–15`: six little-endian `uint16` — year, month, day, hour, minute,
  second — in **local time (IST, +05:30)** with no zone;
- bytes `16…`: little-endian `int16` readings in tenths of a degree Celsius,
  then zero padding; `0x8001` and `0x8002` mark a faulted or absent probe;
- each `<topic>_A` topic carries the single byte `0x0a`.

Matched minute by minute against the vendor portal (`wbldc.iothubs.in`), the
portal shows each raw channel plus a **constant per-sensor offset** (for
example `Haringhata_GOAT` channel 3 = Blast Freezer, −6.8 °C). The offsets
differ per sensor, so they belong to the point, not to the format.

Two code facts shape the decision. `decodeMqttPayload(definition, topic,
raw: string)` takes a string, and both callers — the ingest MQTT adapter
(`apps/ingest/src/adapters/mqtt.ts`, `payload.toString("utf8")`) and the
discovery collector (`apps/api/src/onboarding-discovery/discovery-collector.ts`)
— convert the payload to UTF-8 first, which destroys binary bytes.

## Rulings (owner, 2026-11-09)

- **R1 — scope.** A **generic `binary` format kind** any vendor can use,
  defined as data in the ADR 0116 catalog. WBLDC is its first format. No
  vendor-specific decoder code.
- **R2 — time.** The format may read the payload's own date fields and
  states a **fixed UTC offset**; an impossible date leaves the time absent
  (arrival time is then used, as ADR 0061 does today).
- **R3 — fault codes.** A reading whose raw value equals one of its listed
  **sentinel** values is **absent** — no value, no separate fault reading.
  The point goes stale and the existing stale/offline handling shows it.
- **R4 — device key.** The **topic** is the device key (one topic = one
  RTU), as ADR 0116 R5 already allows.
- **R5 — calibration.** Per-sensor offsets live in the **point's own
  `scale_offset`**. One shared WBLDC format reads raw channels; every
  WBLDC topic uses it.
- **R6 — discovery.** A binary format states its **exact message length**.
  Discovery tries binary formats only when the message is not valid UTF-8
  JSON and its length matches; JSON formats are tried first.

## Decision

1. **A third definition kind, `binary` (R1).** `mqttPayloadFormatDefinitionSchema`
   in `packages/shared/src/ingest-adapters/mqtt-payload-format.ts` gains a
   strict `{ kind: "binary", … }` member beside `builtin` and `declarative`.
   It is data, never code (ADR 0116 decision 3 stands): no expressions,
   scripts or regular expressions. It holds:
   - **`length`** — the exact message length in bytes, `1–4096`
     *(drafter: the cap stays under `MAX_PAYLOAD_BYTES`)*. A message of any
     other length is not decoded (reason `binary-length-mismatch`).
   - **`byteOrder`** — `big` | `little`, the default for every field.
   - **`time`** — optional, one of:
     - `{ fields: { year, month, day, hour, minute, second } }`, each a byte
       offset of a `uint16` (or `uint8`, *drafter*), plus
       **`utcOffsetMinutes`** (`−720…+840`; WBLDC `330`) (R2);
     - `{ offset, type: "uint32", unit: "epoch_s" | "epoch_ms" }`.
     A date that does not exist (month 13, 31 February, all zeros) leaves
     `at` absent, never `Date.now()`.
   - **`readings`** — capped at 128 like ADR 0116 (*drafter*), each with a
     `key` (the `source_data_key` it feeds), a byte **`offset`**, a **`type`**
     (`int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`, `float32`,
     `float64`), an optional per-reading `byteOrder`, optional `scale` and
     `offset` as in ADR 0116, and optional **`sentinels`** — up to 8 raw
     integer values that make the reading absent (R3). A field that runs past
     `length` is a schema error, not a runtime drop.
   - No `deviceKey`: a binary record's device key is the **topic** (R4).
     *(drafter: a later amendment may add a byte-range key if a vendor needs
     it.)*
   One message yields exactly one record.

2. **The decoder takes bytes (amends ADR 0116 decision 3).**
   `decodeMqttPayload(definition, topic, raw)` takes `raw: Uint8Array`
   *(drafter: or keeps the string signature and adds `decodeMqttPayloadBytes`;
   the plan picks one)*. `builtin` and `declarative` decode it as UTF-8
   exactly as today, so PHE and BCPL behave unchanged. `binary` reads it with
   `DataView`. A non-finite float is absent, as in ADR 0116.

3. **Ingest (amends ADR 0116 decision 6).** The MQTT adapter passes the
   payload bytes, not `payload.toString("utf8")`. The `MAX_PAYLOAD_BYTES`
   check stays first. A message a binary format cannot decode is logged with
   the format `code` and a fixed reason (`binary-length-mismatch`), never the
   bytes (§9.6).

4. **Discovery (amends ADR 0116 decision 8; R6).** The collector receives
   bytes. It tries the RTU's chosen format first; then the JSON formats; then,
   only when the message is not valid UTF-8 JSON, each `binary` format whose
   `length` equals the message length. A binary match records that format on
   the draft RTU like any other. Sample values shown in the drawer are the
   decoded numbers, never raw bytes.

5. **Admin test box (amends ADR 0116 decision 5).** `POST
   /api/v1/admin/mqtt-payload-formats/test` takes the sample as text (JSON
   formats) or as **hex** (binary formats) *(drafter: hex, whitespace
   ignored; base64 not needed)*. The web test box gets a "hex" toggle. The
   route still stores nothing and echoes nothing to the log.

6. **The WBLDC format (R5).** The build seeds a non-built-in format
   **`wbldc-temp-100`** *(drafter: by migration, as `0130` seeded
   `thinkiot-register-array`)*: `length: 100`, `byteOrder: little`, time from
   the six `uint16` at offsets `4, 6, 8, 10, 12, 14` with
   `utcOffsetMinutes: 330`, and sixteen readings `temp_ch0 … temp_ch15` =
   `int16` at offsets `16, 18, … 46`, `scale: 0.1`, sentinels `[-32767,
   -32766]` (`0x8001`, `0x8002`). Calibration offsets go on each asset point
   (`scale_offset`) at onboarding, never in the format.

7. **Copilot.** No new route is added and no route changes method, so no ADR
   0099 amendment is expected *(drafter: the plan confirms against
   `EXCLUDED_ROUTES` and the catalog coverage test)*. The copilot's
   `payloadFormat` choices list the new format like any other catalog row;
   its descriptions say "binary, 100 bytes" in fixed text.

## Dependencies

None. `DataView` and `TextDecoder` (with `fatal: true` for the UTF-8 test)
are in every runtime the repo ships.

## Consequences

- Vendors whose devices publish fixed binary records onboard with a catalog
  entry, not a code change. Variable-length frames, bit fields, checksums and
  Modbus RTU framing stay out of scope; they need a later ADR.
- PHE (built-in) and BCPL (`thinkiot-register-array`) must decode
  byte-for-byte as before; the plan adds golden-sample tests for both next to
  the new WBLDC golden samples (hex from the 2026-11-09 capture, no login in
  the fixtures).
- The build touches `packages/shared` (schema, decoder, contracts),
  `packages/db` (seed migration), `apps/ingest` (adapter), `apps/api`
  (discovery collector, test route) and `apps/web` (test box). The migration
  goes through the `migration-reviewer` agent; ingest and the admin route
  through the `security-reviewer` agent.
- **WBLDC onboarding after this ships** (owner tasks, not part of the build):
  add `3.109.107.247` to `MQTT_PLAINTEXT_HOSTS` on the AWS host (ADR 0114);
  onboard through the copilot (the `F4.339` test). Ready now: `Haringhata_GOAT`
  (4 sensors) and `Haringhata_VAP` (2 sensors + 1 faulted probe). Waiting on
  the vendor (EIIPL): the Phansidewa channel map (8 channels, 7 sensors), why
  `Haringhata_RAW` sends zeros, and what `Data_Siliguri2_Pork` measures.
- **AGENTS.md:** no §6 item moves. A later `chore(agents):` sweep may index
  this ADR (§10.1).
