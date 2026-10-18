# ADR 0103 — Live device discovery over MQTT for the onboarding agent (`F3.24b`)

## Status

**Proposed — 2026-10-18.** Five gate questions were put to the owner one at a
time, in chat, each with options and a recommendation. The owner accepted all
five recommendations (see *Gate questions*). Six further details were then
put the same way; the owner confirmed five and changed one (see *Drafter
choices*). Drafted before any implementation code. Code citations are to
`main` at `23af3e93`.

This record **amends ADR 0093** decision 7 and gate question 1: it builds
`F3.24b` over MQTT, which ADR 0093 did not recommend, and it does not wait for
`F1.4` or `F1.5`. The amendment is the owner's: MQTT is the one protocol with a
live device in this deployment (the PHE fleet, `F1.7`), so it is the one
discovery path that can be tested now.

## Context

The owner wants the onboarding agent (and the admin copilot, which hosts it
since ADR 0099 Amendment 2) to take the MQTT broker credentials of a site,
connect, find the devices that publish, find their point keys, and map them
into the onboarding draft without the user typing each key.

ADR 0093 deferred live discovery because nothing on `main` could do it:

- `IngestAdapter.discover?()` and `DiscoveredPoint { sourceKey, label?, unit?,
  sampleValue? }` exist only as types (`packages/shared/src/ingest.ts`). The
  one registered adapter, `mqtt` (`apps/ingest/src/adapter/registry.ts`), has
  no `discover()`. MQTT is push-only and cannot browse a device.
- `apps/api` has no `mqtt` dependency (`apps/ingest/package.json` has
  `mqtt ^5.10.4`) and may not import `apps/ingest` (ADR 0016 §8). The ingest
  health server answers only loopback. No API-to-ingest channel exists.
- Draft credentials sit in the onboarding session's `_secrets`, encrypted by
  `CredentialCryptoService` (`apps/api/src/security/credential-crypto.service.ts`)
  and keyed by RTU code. No `rtuId` exists before commit, so an `RtuBinding`
  cannot be built.
- The normaliser counts an unmapped source key
  (`apps/ingest/src/host/normaliser.ts`, `counters.unmappedSourceKey`) and
  stores no key, so no record of "keys seen on the wire" exists.
- The model has no tool with external I/O. ADR 0090 ruling 1 lets it edit only
  the draft. Every turn has a 45 s deadline (`TURN_DEADLINE_MS`).

What *can* be read off an MQTT feed without browsing: the ingest adapter finds
a device by `dev_id` in the payload and a point by a key in `values`
(`apps/ingest/src/adapters/mqtt.ts`, envelope keys `dev_id`, `ts`, `values`).
Listening to a topic filter for a bounded window and grouping what arrives by
topic → `dev_id` → keys gives the same three things `F3.23`'s mapping needs.

The BullMQ worker (ADR 0063, `apps/api/src/worker.ts`) already runs jobs out of
the request path with the API's own services, which removes the need for a new
channel.

## Gate questions

1. **Which process connects to the site's broker?**
   - A. The API worker: add `mqtt` to `apps/api`, run a BullMQ discovery job.
   - B. `apps/ingest`, through a request table it polls.
   - C. `apps/ingest`, through a new authenticated HTTP endpoint.

   **Ruled as recommended: A.** No new channel, no new table, and ingest code
   does not change. The owner asked first what happens to PHE and the other
   ingest feeds: nothing. Ingest keeps its permanent connections. Discovery is
   a separate, short connection with its own client ID (decision 4).

2. **Who starts the connection?**
   - A. The copilot proposes; the job starts only on the user's Confirm.
   - B. A user button only (ADR 0093's default position).
   - C. The copilot, with no confirm.

   **Ruled as recommended: A.** The ADR 0099 Confirm pattern, unchanged.

3. **Which hosts may a job reach?**
   - A. Refuse internal addresses only; permit any other host, private LAN
     ranges included.
   - B. An operator allowlist only.
   - C. Also refuse the RFC 1918 private ranges.

   **Ruled as recommended: A.** On-site brokers commonly sit on a private LAN.

4. **Which topics does a job subscribe to?**
   - A. A prefix plus `/#`, in the discovery job only.
   - B. The whole broker (`#`).
   - C. The exact draft topic only.

   **Ruled as recommended: A.** Saved device topics stay exact (`F4.215`).

5. **What does the copilot do with the results?**
   - A. Map them into the draft by itself; the user checks the preview and
     commits.
   - B. Propose the mappings on a Confirm card per device.
   - C. Show the candidates only; the user maps by hand.

   **Ruled as recommended: A.**

## Decision

1. **The worker runs discovery.** `apps/api` gains the `mqtt` dependency, at
   the same range as `apps/ingest`. A new BullMQ queue, `onboarding-discovery`,
   is registered in `apps/api/src/queue/queue-registry.ts` and processed only by
   the worker process (`pnpm --filter api worker`). The request path never
   opens a broker connection. `apps/ingest` does not change, and the ADR 0016
   §8 import boundary holds: the job uses the `mqtt` package and the shared
   schemas in `@bms/shared/ingest`, not ingest code.

2. **A route starts a job, and only a Confirm reaches the route.**
   `POST /api/v1/admin/onboarding/sessions/:id/discovery` with body
   `{ rtuCode, topicPrefix, windowSeconds? }` validates with Zod, checks the
   caller may edit the session (the existing onboarding guards), resolves the
   RTU's MQTT config from the draft, applies decision 3, and enqueues the job.
   It answers `202` with a `discoveryId`.
   - The copilot gets a **propose** tool, `propose_discovery`, that follows
     ADR 0099 decisions 4–7: it writes a pending action, the dock shows a
     Confirm card with **host, port, TLS on/off, the full topic filter and the
     window**, and the browser sends the real `POST` with the user's own token
     on Confirm. The model never opens a connection, and the call never runs
     inside the 45 s turn.
   - The onboarding UI also shows a **Discover** button on an MQTT RTU in the
     draft preview. It sends the same `POST`.
   - The model gets a **read** tool, `get_discovery_results`, that returns the
     stored result of the session's latest job (decision 6).

3. **Host guard (SSRF), in code, after DNS.** The job resolves the broker host
   and refuses the connection if **any** resolved address is loopback
   (`127.0.0.0/8`, `::1`), unspecified (`0.0.0.0`, `::`), link-local
   (`169.254.0.0/16`, `fe80::/10`, which includes the cloud metadata address),
   or multicast. It also refuses, before DNS, a host equal to a compose
   service name in `docker-compose.yml` (today `postgres`, `redis`, `minio`,
   `keycloak`, `keycloak-provision`, `migrate`, `api`, `api-replica`,
   `worker`, `web`, `sim`, `ingest`, `prometheus`, `loki`, `promtail`,
   `grafana`, `mailpit`) and `host.docker.internal`. The list is read from one
   constant, and a test fails when a compose service is missing from it. Private ranges
   are permitted (ruling 3). The port must be an integer 1–65535. The route
   runs the same name check so a refusal reaches the user at once; the job
   repeats the full check because only the job sees the resolved address. The
   job connects to the address it checked, not to a second lookup.

4. **The connection is read-only, short and separate from ingest.**
   - Client ID `bms-discovery-<discoveryId>`, always unique, never the ingest
     client ID. A clean session. QoS 0.
   - One subscription: `<topicPrefix>/#`. `topicPrefix` must be non-empty,
     must contain no `+` or `#`, and is bounded by the `F4.208` topic-length
     bound. The wildcard is built by code, only here; `mqttDeviceSchema` and
     the `F4.215` refusal on a saved device topic do not change.
   - The job never publishes.
   - TLS settings come from the draft RTU's MQTT config (`mqttConfigSchema`).
   - The job disconnects at the end of the window or at the first cap
     (decision 5), whichever comes first.

5. **Bounds.** Window: default 60 s, maximum 120 s. Caps per job: 5,000
   messages, 256 KiB per payload (a larger payload is counted and skipped),
   200 devices, 500 keys per device. A job that reaches a cap stops and marks
   the result `truncated`. One job runs per session at a time; a second
   `POST` while one runs answers `409`.

6. **The result is stored in the session, not in a new table.** The job writes
   `_discovery` on the onboarding session draft: `{ discoveryId, status
   (queued | running | done | failed), startedAt, finishedAt, truncated,
   error?, devices: [{ topic, devId, messageCount, keys: [{ sourceKey,
   sampleValue }] }] }`. A sample value is a finite number, a boolean, or a
   string cut to 64 characters; any other value is stored as its type name.
   Only the latest job is kept. `_discovery` is erased with the draft
   (ADR 0099 Amendment 2, the 30-day erase) and is never committed. No
   migration.

7. **Credentials stay out of the job payload and out of the model.** The job
   payload carries only `{ sessionId, rtuCode, discoveryId, topicPrefix,
   windowSeconds }`. The worker reads `_secrets[rtuCode]` and decrypts it with
   `CredentialCryptoService`. No credential appears in a job payload, a log
   line, a result, an audit entry or a tool reply. Neither new tool takes a
   credential argument, so the existing tool-input refusal (`isSecretKey`,
   `looksLikeCredential`, ADR 0093 decision 4) applies unchanged. A sample
   string that `looksLikeCredential` is stored as `"<redacted>"`. A broker error is
   reported by class (`auth refused`, `host unreachable`, `TLS failed`,
   `timeout`), not by the broker's raw message.

8. **The copilot maps the results into the draft by itself** (ruling 5). After
   `get_discovery_results` returns `done`, the model adds the devices and the
   key-to-template-point mappings through the existing draft tools and the
   `F3.23` mapping path (ADR 0092). Every mapping that came from discovery
   carries `source: "discovery"` in the draft, and the preview marks it. Nothing
   reaches the database before the user's commit, which does not change.

9. **Audit.** The route writes one `bms.audit_log` entry per started job
   (action `onboarding.discovery.start`, with session, RTU code, host, port and
   topic filter), and the worker writes one per finished job
   (`onboarding.discovery.finish`, with status and counts). A refused attempt
   also writes one entry (`onboarding.discovery.refuse`, with session, RTU
   code, host, port, topic filter and the refusal class: `blocked host`,
   `bad prefix`, `bad port`, `busy`, `no worker`), from the route or from the
   job, whichever refused it. No entry carries a credential or a sample value.

10. **Not in this ADR.** Discovery for OPC-UA, SNMP and REST stays with `F1.4`
    and `F1.5`. A model-started connection with no Confirm. Discovery of an
    already committed RTU. Storing wire keys from the running ingest feed
    (the normaliser's `unmappedSourceKey` stays a counter).

## Drafter choices

Put to the owner one at a time on 2026-10-18, after the gate questions. Five
followed the recommendation; choice 5 did not.

1. The bounds in decision 5 (60 s / 120 s, 5,000 messages, 256 KiB, 200
   devices, 500 keys, one job per session). **Confirmed** (alternatives:
   30/60 s, 120/300 s).
2. The route shape and the two tool names in decision 2. **Confirmed**
   (alternatives: one tool only, an extra `GET` status route).
3. Storing the result in the draft as `_discovery` (decision 6). **Confirmed**
   (alternative: a `bms.onboarding_discoveries` table).
4. The `source: "discovery"` marker and a "Discovered" badge with the sample
   value in the preview (decision 8), not committed. **Confirmed**
   (alternatives: commit the origin, no marker).
5. Audit. **Owner chose start, finish and refusals** over the recommended
   start and finish only, for a better trace of a misuse attempt. Decision 9
   carries the third action.
6. **A broker that permits one connection per username** may drop the ingest
   connection while a discovery job is connected with the same username.
   This ADR does not detect that case. The Confirm card and the Discover button
   show the warning text: "If this broker allows one connection per user, use
   a separate username for discovery." **Confirmed** (alternatives: separate
   discovery credentials, block while ingest is connected).

## Dependencies

- `mqtt` (`^5.10.4`, the range `apps/ingest` already uses) in
  `apps/api/package.json`. This ADR is the §9.4 justification. The
  dependency-ADR hook needs this file staged in the same commit as the
  manifest change.

## Consequences

- The onboarding agent can find the devices and keys of an MQTT site in about
  a minute, and the copilot maps them. The user's work drops to checking the
  preview and committing.
- Discovery needs the worker. Where the worker does not run (no `REDIS_URL`),
  the route answers `503` and the button is disabled with that reason.
- The worker, and therefore the API's container network, now opens outbound
  connections to hosts a user typed. Decision 3 is the only guard beyond the
  Confirm, and it permits private ranges by ruling. On a shared cloud host an
  admin can still reach a LAN address that host can route to.
- MQTT discovery sees only what devices publish during the window. A silent
  device, or one that publishes on change only, can be missed. Units and labels
  appear only if the payload carries them. The draft preview says so when a
  result is empty.
- `apps/api` carries a second copy of an MQTT client beside `apps/ingest`. The
  shared parts (config and device schemas, `mqttTopicHasWildcard`) already live
  in `@bms/shared/ingest`; the envelope parse (`dev_id`, `values`) moves there
  too so both sides read a payload the same way.
- `F3.24b`'s `Depends` changes from `F3.24a, F3.23, F1.4 or F1.5` to
  `F3.24a, F3.23, ADR 0103`. `docs/BACKLOG.md` is updated with this record.

## Verification owed

- Unit: the host guard refuses each blocked range and each compose name, and
  checks every resolved address; the topic-prefix guard refuses `+` and `#`;
  the result grouping by topic → `dev_id` → keys; every cap; the sample-value
  rule.
- Integration: a job against a local broker (the compose test broker) with a
  publisher that sends two `dev_id`s, proving the result, `truncated`, the
  unique client ID, that the job never publishes, and that a concurrent ingest
  subscriber on the same topic keeps receiving.
- Security: no credential in the job payload, the logs, the result, the audit
  rows or a tool reply.
- Browser: the Confirm card shows host, port, TLS, filter and window; the
  preview marks discovered mappings.
- Live: one discovery against the owner's MQTT device.

## Amends and relates to

- **ADR 0093** — amends decision 7 and gate question 1 (MQTT discovery is now
  built; the default position "user action only" becomes "Confirm or button").
- **ADR 0016** — §7 (only browsing adapters discover) is narrowed for MQTT by
  this record; §8 (no API import of ingest) holds.
- **ADR 0012** — credential encryption, unchanged.
- **ADR 0063** — the worker and the queue registry.
- **ADR 0090** — ruling 1 holds: the model edits only the draft.
- **ADR 0092** — the mapping path the results feed.
- **ADR 0099** — the Confirm pattern and Amendment 2's draft erase.
