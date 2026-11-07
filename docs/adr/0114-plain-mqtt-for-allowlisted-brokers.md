# ADR 0114 — Plain MQTT for allowlisted brokers (`F4.326`)

## Status

**Accepted — 2026-11-07** (owner, in chat: "Accept, open PR"; proposed the same day). Raised by the owner on 2026-11-07 while onboarding
the BCPL (Brahmaputra Cracker and Polymer Limited) water meters on the AWS
demo: their broker offers no TLS port. The owner gave four rulings in chat on
2026-11-07, one at a time, before this record was written (listed under
*Rulings*). Lines marked *(drafter)* are drafter calls that the `F4.326` plan
may refine; the others are rulings.

Promotes nothing out of AGENTS.md §6 and adds no dependency (§9.4): `mqtt`
already serves both schemes in `apps/ingest` and `apps/api`.

**Amends [ADR 0103](./0103-mqtt-live-discovery-for-onboarding.md)
Amendment decision 6 (decisions Q5, "Always `mqtts`")** for allowlisted hosts
only, and the TLS-only connection of [ADR 0007](./0007-phe-mqtt-ingest-pilot.md)
decision 3 and [ADR 0016](./0016-ingest-adapter-framework.md) as carried by
`apps/ingest/src/adapters/mqtt.ts`. Code citations are to `main` at `9447caa5`.

## Context

**What BCPL has.** 21 water flow meters at 6 locations (LALMATI, DULIAJAN,
LAKWA, LEPETKATA, BARBARUAH, SIVSAGAR), read from `bcpl.thinkiot.co.in` on
2026-11-07. Each meter publishes on its own flat topic (for example
`BCPL_LAL_RAILWAY_01_LALMATI`) to the ThinkIoT broker
`shapoorji.thinkiot.co.in` (13.234.200.52). On 2026-11-07, port 1883 (plain
MQTT) answered and port 8883 (MQTT over TLS) did not, from this network and
for `mqtt.thinkiot.co.in` too.

**What the platform does.** Every broker connection is TLS, and nothing in a
config can change that:

- Ingest builds `mqtts://${host}:${port}` unconditionally
  (`apps/ingest/src/adapters/mqtt.ts:272`).
- Discovery is "Always `mqtts`, always `rejectUnauthorized: true`"
  (`apps/api/src/onboarding-discovery/discovery-transport.ts:14`, ADR 0103
  decisions Q5). The Confirm card says "TLS: always on".
- The onboarding draft carries a `tls` key, but it is draft-only and "selects
  nothing" (ADR 0103 Amendment decision 6;
  `packages/shared/src/ingest-adapters/mqtt.ts:79`). The onboarding agent
  writes `tls: false` when asked, the draft accepts it, and the committed RTU
  still connects with TLS. On a plain-only broker that RTU never connects, and
  no message says why.

So a BCPL RTU can be onboarded, credentialed and committed today, and it will
never receive a reading.

**Why a gate and not a flag.** `rtu_connection_configs.config` is writable by
an `organization_admin` through the onboarding commit (the comment at
`apps/ingest/src/host/bindings.ts:452-469`). On a plain connection the ingest
host sends the decrypted broker username and password unencrypted. A flag the
organization admin can set alone would let any organization admin send stored
credentials in clear text to any host. `bindings.ts` already refuses a stored
`rejectUnauthorized` for the same reason (`tls-downgrade-refused`). The
precedent for an operator-owned insecure switch is
`OBJECT_STORAGE_ALLOW_INSECURE` (ADR 0066).

## Rulings (owner, 2026-11-07)

1. **Q1 — the control: an environment allowlist AND the RTU flag.** An RTU
   connects plain only when its config has `tls: false` **and** its host is on
   the operator's `MQTT_PLAINTEXT_HOSTS` list. Alternatives refused: the RTU
   flag alone; one global switch for any host.
2. **Q2 — discovery follows the same rule.** A discovery job connects plain
   only under the same two conditions. Alternative refused: ingest only, with
   discovery kept `mqtts`-only.
3. **Q3 — a refusal fails closed and visibly.** `tls: false` on a host that is
   not on the list skips the RTU with a named reason, and the onboarding
   validator refuses the draft before commit. Alternative refused: connect
   with TLS anyway (today's silent behaviour).
4. **Q4 — disclosure: badge, warning, audit and log.** A "Plain MQTT" badge,
   a warning on the discovery card and the commit wizard, `tls: false` in the
   commit audit entry, and one ingest warning per plain endpoint. Alternative
   refused: a log line only.

## Decision

1. **`MQTT_PLAINTEXT_HOSTS`.** A comma-separated list of broker host names,
   read by `apps/ingest`, `apps/api` and the API worker. Unset or empty means
   no host may connect plain, which is today's behaviour. *(drafter)* Each
   entry is trimmed and lower-cased; a match is exact on the lower-cased
   typed host, with no wildcard, no port and no IP range. An entry that is
   not a valid host name is a boot refusal with a fixed message, not a
   silent skip. One parser in `@bms/shared` (`parseMqttPlaintextHosts`)
   serves all three processes, so they cannot disagree.

2. **`tls` becomes a real config field.** `mqttConfigSchema` gains
   `tls: z.boolean().default(true)`. Absent means TLS, so every RTU committed
   before this ADR keeps its behaviour. *(drafter)* Only the literal `false`
   selects plain. The draft schema keeps `tls` but no longer calls it
   draft-only.

3. **Ingest (`apps/ingest`).**
   - The host (`apps/ingest/src/host/bindings.ts`) checks the rule, because
     an adapter may not read the environment (ADR 0016 §4). An RTU with
     `tls: false` whose host is not on the list is skipped with the new
     reason `plaintext-host-not-allowed` (ruling 3). It never falls back to
     TLS.
   - The adapter builds `mqtt://` when `config.tls === false` and `mqtts://`
     otherwise. On a plain connection it passes no `rejectUnauthorized`.
   - *(drafter)* The endpoint key includes the scheme, so a TLS RTU and a
     plain RTU on one host never share a connection.
   - One `warn` per plain endpoint at connect: `mqtt endpoint is plaintext`,
     with the host and port only. Never the username, the password or a
     payload (AGENTS.md §9.6).
   - The `tls-downgrade-refused` rule for `rejectUnauthorized` does not
     change.

4. **Discovery (`apps/api/src/onboarding-discovery/`).** The transport selects
   `protocol: "mqtt"` when the draft RTU has `tls: false` and its host is on
   the list, and `mqtts` otherwise (ruling 2). The host guard of ADR 0103
   decision 3 runs before both. A refused case is the new refusal class
   `plaintext not allowed`, written to the `onboarding.discovery.refuse`
   audit entry like the other classes.

5. **Onboarding validation (`apps/api/src/admin/onboarding/`).** The draft
   validator refuses an MQTT RTU with `tls: false` whose host is not on the
   API's list, with the fixed message "Plain MQTT is not allowed for this
   broker host; ask the operator to add it to MQTT_PLAINTEXT_HOSTS". The
   commit runs the same check. The message names no host (§9.6, the
   validator's fixed-text rule).

6. **Disclosure (`apps/web`; ruling 4).**
   - A "Plain MQTT" status pill on the RTU row of `/admin/rtus` and on the
     RTU in the onboarding draft preview.
   - The discovery Confirm card and the commit wizard show "TLS: off —
     credentials and data cross the network unencrypted" instead of "TLS:
     always on" for such an RTU.
   - The existing onboarding commit audit entry records `tls: false` for each
     plain RTU.
   - The admin RTU edit form shows the TLS value and does not let an
     `organization_admin` change it once credentials are set (the existing
     ADR 0093 freeze of host, port and TLS).

7. **Deployment.** The operator sets `MQTT_PLAINTEXT_HOSTS` per deployment in
   the env of the `api`, `worker` and `ingest` services. `docker-compose.yml`
   passes it through, empty by default. For the AWS demo the first value is
   `shapoorji.thinkiot.co.in`; the owner sets it through `bms-ctl` after the
   build merges. *(drafter)* `docs/env-inventory.md` and
   `docs/ingest-host.md` gain the variable.

8. **Not in this ADR.** Plain MQTT for any host not on the list. A per-
   organization allowlist in the database. Broker certificate pinning. A
   plain-MQTT option for any other protocol. Changing the BCPL broker itself.

## Dependencies

None. `mqtt ^5.10.4` already supports `mqtt://`.

## Consequences

- **The credentials of an allowlisted broker cross the network in clear
  text**, on every ingest connection and every discovery job. Anyone on the
  path can read the username, the password and the telemetry. The allowlist
  limits this to hosts an operator named. The owner accepts this risk for
  BCPL. The BCPL MQTT password must be rotated, because it was also exposed in
  a chat on 2026-11-07.
- A plain broker cannot prove its identity, so a DNS or route attack can feed
  false telemetry. The ADR 0103 host guard still blocks internal addresses.
- An existing RTU with `tls: false` in its stored config starts to connect
  plain only if an operator lists its host. With the list empty by default,
  no deployment changes behaviour when this ships. *(drafter)* The `F4.326`
  plan counts such RTUs on the AWS demo before the build.
- Three processes read one variable. A host on the ingest list but not the
  API list makes the validator refuse an RTU that ingest would serve. The
  shared parser and one compose variable keep them equal. A test checks that
  compose passes the variable to all three services.
- Tests: the adapter URL for each scheme; the host skip reason; the discovery
  protocol choice and refusal class; the validator message; the badge and
  the card text; a docker-compose invariant for the three services. An
  integration test reaches a plain broker in CI, which the discovery suite
  already does through its injected transport.
- Separate from this ADR, the BCPL onboarding found two onboarding-agent
  faults that need their own rows: the agent wrote `brokerHost` and `devId`
  instead of `host` and `rtuCode`, and it reported removing two RTUs when it
  wrote nothing.
