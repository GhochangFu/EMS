# ADR 0016 — Ingest adapter framework (`IngestAdapter`, pluggable)

## Status

Accepted (2026-08-04). Backlog item `F1.1` (Wave 0, P0, ⭐ enabler, 4–5).

All eight questions raised during drafting are resolved — see **Resolved
decisions**. Two were settled by querying the database rather than by opinion,
and one of those corrects a claim made in the Context below.

This ADR freezes an interface. `F1.2` (Modbus TCP/RTU), `F1.3` (BACnet),
`F1.4` (OPC-UA), `F1.5` (SNMP/REST) and `F1.6` (DCS) are planned as a parallel
agent fan-out in which each implements *this* interface in *its own* file
(`docs/BACKLOG.md` §1b slot 6). Everything below is written for that reader.

Per AGENTS.md §10 the corresponding `chore(agents):` edit — §2 stack table row,
§6 wording, `docs/roadmap.md` — is **owed separately** and does not ride along
in the feature PR. This follows the precedent set by ADR 0013 and ADR 0014.

## Context

### What exists today

`apps/ingest` is the one real adapter in the repository: a 234-line
`src/index.js` that subscribes to ThinkIoT MQTT over TLS for the PHE pilot and
writes `telemetry.point_values` + `pg_notify('bms_telemetry', …)` (ADR 0007).
It is **live** — the `ingest` / `pilot` / `phe` compose profiles run it.

Read as a design document, `index.js` already contains every piece the
framework needs, fused into one file with no seams:

| Concern | Where it lives today | Where it belongs |
| --- | --- | --- |
| Binding query (`rtus` ⋈ `assets` ⋈ `asset_points` ⋈ `rtu_connection_configs`) | `loadMapping()`, hardcoded `source_type = 'mqtt'` | host |
| Credential decrypt | `rtu-config.js` `resolveMqttConnection()` | host |
| Transport (connect/subscribe/reconnect) | `mqtt.connect()` in `main()` | **adapter** |
| Payload parse (`dev_id`, `values`, `ts`) | `parsePayload()` | **adapter** |
| `source_data_key → (assetId, pointKey, unit)` | inline in `handleMessage()` | host |
| Insert + NOTIFY chunking | `handleMessage()` / `chunkReadings()` | host |
| Health endpoint | inline `http.createServer` | host |

### One connection can serve many RTUs

> **Correction applied at acceptance.** An earlier draft of this section claimed
> the pilot *already* multiplexes several RTUs onto one topic. It does not. The
> database was queried at acceptance:
>
> ```
> mqtt_rtus | distinct_topics
>         1 |               1
> ```
>
> Every seeded RTU carries its own topic (`Airsprint-1051/Data/<devid>`), and
> `apps/ingest/src/index.js:81` filters to `source_type = 'mqtt'`, of which there
> is exactly one — consistent with ADR 0007's "one pilot RTU only". The
> `new Set(...)` de-duplication is **defensive, not currently load-bearing**.
>
> The design conclusion below stands, but on forward-looking grounds rather than
> on evidence from the pilot. Do not cite the pilot as proof.

The ingest host routes by device *inside* the message handler today:

- `const topics = [...new Set(topicByRtu.values())]` — the `Set` anticipates
  topic sharing even though the current data does not exhibit it.
- One `mqtt.connect()` and one `client.on("message")` serve every subscription.
- `mappingByRtu.get(parsed.devId)` — a message is attributed to an RTU by
  matching the payload's `dev_id` against `rtus.rtu_code`, not by topic.

The real justification for endpoint-as-unit-of-supervision is protocol
mechanics, not the pilot: a **Modbus TCP gateway serves many slave unit ids over
one socket**, an **OPC-UA session carries many nodes**, and an SNMP agent
exposes many OIDs per host. A naive "one adapter instance per RTU" framework
forces either N connections to one endpoint or N instances each re-filtering
every message. Those are real costs for F1.2/F1.4/F1.5 on day one — which is
what makes the endpoint/device split worth freezing into the interface now,
while it is still free to change.

`chunkReadings()` in `apps/ingest/src/index.js` and
`chunkReadingsForNotify()` in `apps/sim/src/index.js` are the *same function*,
copy-pasted, with the same `MAX_NOTIFY_UTF8_BYTES = 7000` constant. A third
copy per protocol is the default outcome if F1.1 does not claim that code.

### Failure handling is currently absent, and it is load-bearing

Three lines set the bar this ADR has to clear:

- `main().catch((err) => { console.error(err); process.exit(1); })` — any
  startup fault kills the process.
- `handleMessage(topic, payload).catch(() => { /* logged via metrics in future sprint */ })`
  — every per-message failure is silently discarded.
- `setInterval(() => { loadMapping().catch(() => {}); }, 60000)` — binding
  reloads fail invisibly.

With one adapter and one RTU that is survivable. With six protocols under one
supervisor it is not: one misconfigured Modbus slave must not take down the PHE
pilot, and a silent `catch {}` per protocol is six independent silent-failure
classes — precisely what ADR 0014 was written to eliminate.

### Two structural facts that shape the design

1. **`apps/ingest` is plain JavaScript.** `.js` + JSDoc, no `tsconfig.json`, no
   build step. `package.json` is `"start": "node src/index.js"` and
   `apps/ingest/Dockerfile` ends `CMD ["pnpm", "start"]` with no compile stage.
   A "TypeScript interface" is therefore not free here — see Options A.
2. **`bms.protocol_catalog` does not exist in any database.** It is declared in
   `packages/db/src/schema/bms-schema.ts:216` but appears in **no** migration
   under `packages/db/drizzle/` and in **no** seed. `OnboardingProtocolService.listCatalog()`
   wraps its query in `try { … } catch { return []; }`, so the missing relation
   is swallowed and the catalog silently reads empty. This is the orphaned-artefact
   shape from ADR 0014 §Context, third instance. The registry designed below
   therefore **must not** treat that table as its source of truth.

### What downstream items need from this interface

`F1.7` (MQTT beyond one RTU), `F1.10` (backoff + 1 h disk buffer), `F1.11`
(ingest as the only `telemetry.*` writer), `F3.16` (device health / last-seen),
`F3.24` (agent-driven protocol onboarding with per-adapter discovery), `E5.4`,
`E6.1` and `E7.2` all list `F1.1` as a dependency. Each is a place where a
missing seam becomes an interface break later. They are accounted for
explicitly in the Decision.

## Options considered

### A. Language of the adapter layer

**A1 — JSDoc only, stay pure JS.** Zero build change, Dockerfile untouched,
`node src/index.js` keeps working. But a `@implements` annotation is enforced
by nothing unless `checkJs` is wired into CI, and even then the ergonomics for
five cold agents writing five adapters are poor. An interface that the compiler
does not check is not frozen; it is a suggestion.

**A2 — TypeScript adapter layer, compiled to `dist/`. Recommended.**
`strict: true` and "no `any`" (AGENTS.md §4.1) become enforceable, the fan-out
agents get red squiggles instead of runtime surprises, and every other package
in the repo is already TS — including `apps/ingest/vitest.config.ts`, which is
a `.ts` file typechecked by the root `typecheck:tests` script today. Cost: a
`tsconfig.json`, a `typescript` devDependency in `apps/ingest` (exact precedent:
`packages/shared/package.json`), a `build` script, and one added
`RUN pnpm build` line in the Dockerfile.

The Dockerfile cost is the reason to choose A2 rather than fear it: adding the
build **before** the unchanged `CMD` means a compile error fails at *image build*
time, loudly, before deployment — rather than at runtime on the pilot. The
failure mode moves in the right direction.

**A3 — TS with `tsx` at runtime.** Rejected: adds a transpiler to a production
container to avoid a 30-second build step.

### B. Push versus poll — the central problem

**B1 — Two unrelated interfaces (`PushAdapter`, `PollAdapter`).** The host
ends up with two supervisors, two backoff implementations, two health paths.
F1.10 (backoff + buffering) would then have to be built twice.

**B2 — One interface where everything is poll; push adapters buffer
internally and drain on `poll()`.** Uniform, but it makes MQTT — the one
adapter that actually works today — the awkward case, adds latency to the
push path, and pushes an unbounded internal queue into every push adapter.
Exactly the "bolted on" outcome to avoid.

**B3 — One base contract plus a `mode` discriminant; the host owns every
timer. Recommended.** All adapters share `connect` / `disconnect` / `health`.
`mode: "push"` adds `subscribe(emit)`; `mode: "poll"` adds
`defaultPollIntervalMs` + `poll()`. The **host** runs the poll loop, the
overlap guard, the backoff, the jitter and the bounded queue. No adapter owns
a timer.

The discriminant is an explicit literal field, not duck-typing on which method
exists — so the host narrows the union at compile time and a fan-out agent
cannot half-implement both halves.

Checked against all six planned adapters: MQTT push · OPC-UA subscription push ·
Modbus TCP/RTU poll · SNMP poll · REST poll · BACnet/IP poll (COV is a later
push variant) · DCS/SCADA either, declared per deployment. Neither half is a
special case for its own protocols.

### C. Adapter registration

**C1 — Filesystem scan / dynamic `import()` of `adapters/*.js`.** Looks
pluggable; is a silent-failure generator. A typo'd filename yields a protocol
that is simply absent at runtime with no compile error — the orphaned-spec and
orphaned-migration pattern this repo has now shipped three times.

**C2 — DB-driven from `bms.protocol_catalog`.** Attractive on paper and the
table already has an `ingest_wired` boolean. Rejected on evidence: the table
has no migration and no seed (Context §2), and a runtime registry keyed on a
row someone can edit is a way to break ingest from a SQL prompt.

**C3 — Static map in `apps/ingest`, keyed on the protocol union, checked with
`satisfies`. Recommended.** One explicit object literal; adding an adapter is a
one-line diff; the compiler rejects an unknown key. `protocol_catalog` becomes
*metadata seeded from* this map (documentation for the onboarding UI), never
the runtime source of truth.

## Decision

### 1. The interface

`packages/shared/src/ingest.ts` — **data contracts** (needed outside ingest,
because F3.24's onboarding UI and the admin screens describe protocols and
their config shapes):

```ts
/** Protocols an ingest adapter can serve. Must remain a subset of `OnboardingProtocol`. */
export const INGEST_PROTOCOLS = [
  "mqtt",
  "modbus_tcp",
  "bacnet",
  "opc_ua",
  "snmp",
  "rest_poller",
] as const;

export type IngestProtocol = (typeof INGEST_PROTOCOLS)[number];

/** Compile-time drift guard: every ingest protocol must be expressible in onboarding. */
const _ingestProtocolsAreOnboardable: readonly OnboardingProtocol[] = INGEST_PROTOCOLS;

/** Whether the host drives the adapter (poll) or the adapter drives the host (push). */
export type AdapterMode = "push" | "poll";

/** One raw reading, keyed as the *device* names it (`bms.asset_points.source_data_key`). */
export type SourceSample = {
  readonly sourceKey: string;
  readonly value: number;
  /**
   * Which device produced this, when one adapter instance serves several
   * (MQTT `dev_id`, Modbus unit id, OPC-UA node prefix). Required when the
   * instance has more than one binding; omit when it has exactly one.
   */
  readonly deviceKey?: string;
  /** Device timestamp where the protocol carries one; host substitutes receive time otherwise. */
  readonly at?: Date;
  /** Protocol quality flag. `false` → host discards the sample and counts it. */
  readonly good?: boolean;
};

/** Operator-facing adapter state. Never carries secrets. */
export type AdapterHealth = {
  readonly state: "connected" | "degraded" | "disconnected";
  readonly detail?: string;
  readonly lastSampleAt?: Date;
};

/** One point an adapter can offer during onboarding (F3.24). */
export type DiscoveredPoint = {
  readonly sourceKey: string;
  readonly label?: string;
  readonly unit?: string;
  readonly sampleValue?: number;
};
```

`apps/ingest/src/adapter/types.ts` — the **behavioural interface**. It stays in
`apps/ingest` because nothing outside `apps/ingest` implements or invokes it:

```ts
import type { ZodType } from "zod";

import type {
  AdapterMode,
  AdapterHealth,
  DiscoveredPoint,
  IngestProtocol,
  SourceSample,
} from "@bms/shared/ingest";

/** Minimal logger the host binds to `{ rtuCode, protocol }`. Adapters must use only this. */
export type AdapterLogger = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

/** One device served by an adapter instance. */
export type RtuBinding<TDevice> = {
  readonly rtuId: string;
  readonly rtuCode: string;
  /** How the device identifies itself on the wire; matches `SourceSample.deviceKey`. */
  readonly deviceKey: string;
  /** Validated per-device config (MQTT topic, Modbus unit id, OPC-UA node prefix). */
  readonly device: TDevice;
  /** `source_data_key`s this RTU is mapped for; adapters may use it to scope a read set. */
  readonly sourceKeys: readonly string[];
};

/** Everything an adapter is given. It must not reach outside this object for state. */
export type AdapterContext<TConfig, TDevice> = {
  readonly protocol: IngestProtocol;
  /** Identity of the endpoint this instance serves — the host's grouping key. */
  readonly endpointKey: string;
  /** Validated connection-level config. Non-secret by definition. */
  readonly config: TConfig;
  /** Plaintext endpoint secrets, decrypted by the host. Never log, never echo, never persist. */
  readonly credentials: Readonly<Record<string, string>>;
  /** Devices on this endpoint. Exactly one for connection-per-device protocols. */
  readonly bindings: readonly RtuBinding<TDevice>[];
  readonly logger: AdapterLogger;
  /** Aborted on shutdown or supervisor restart. Long operations must honour it. */
  readonly signal: AbortSignal;
};

/** Lifecycle every adapter shares, regardless of mode. */
type IngestAdapterBase<TConfig, TDevice> = {
  /** Establishes the transport. Must reject rather than throw synchronously. */
  connect(context: AdapterContext<TConfig, TDevice>): Promise<void>;
  /** Releases the transport. Must be idempotent and must not reject. */
  disconnect(): Promise<void>;
  /** Synchronous, cheap, never throws — callable before connect and after disconnect. */
  health(): AdapterHealth;
  /** Optional point discovery for F3.24 onboarding. Omit when the protocol cannot browse. */
  discover?(): Promise<readonly DiscoveredPoint[]>;
};

export type PushIngestAdapter<TConfig, TDevice> = IngestAdapterBase<TConfig, TDevice> & {
  readonly mode: "push";
  /** Attaches the sink. Resolves once the subscription is established. */
  subscribe(emit: (samples: readonly SourceSample[]) => void): Promise<void>;
};

export type PollIngestAdapter<TConfig, TDevice> = IngestAdapterBase<TConfig, TDevice> & {
  readonly mode: "poll";
  /** Cadence floor. The host may widen it under backoff; it never shortens it. */
  readonly defaultPollIntervalMs: number;
  /** One complete read cycle across every binding. The host guarantees no overlap. */
  poll(): Promise<readonly SourceSample[]>;
};

export type IngestAdapter<TConfig = unknown, TDevice = unknown> =
  | PushIngestAdapter<TConfig, TDevice>
  | PollIngestAdapter<TConfig, TDevice>;

/** What an adapter module default-exports; the host builds one instance per endpoint. */
export type IngestAdapterFactory<TConfig = unknown, TDevice = unknown> = {
  readonly protocol: IngestProtocol;
  readonly mode: AdapterMode;
  /** Zod schema for the connection-level slice of `config` JSONB. Validated before `connect`. */
  readonly configSchema: ZodType<TConfig>;
  /** Zod schema for the per-device slice. Validated per binding before `connect`. */
  readonly deviceSchema: ZodType<TDevice>;
  /**
   * Grouping key. Return the connection identity (`host:port`) when one
   * connection serves many devices; return `rtuId` when each device needs its
   * own connection. This single function replaces a `scope` flag — the flag
   * would only ever be derivable from it.
   */
  endpointKey(config: TConfig, rtuId: string): string;
  /** Lets F3.24 filter for browsable protocols without constructing an instance. */
  readonly supportsDiscovery?: boolean;
  create(): IngestAdapter<TConfig, TDevice>;
};
```

**The unit of supervision is the endpoint, not the RTU.** The host groups
bindings by `(protocol, endpointKey(config, rtuId))` and creates **one adapter
instance per group**. MQTT returns `` `${host}:${port}` `` and gets one
connection serving every PHE RTU — matching the pilot's actual behaviour rather
than fighting it. A REST poller returns `rtuId` and gets one instance per
device. Modbus TCP may return either, per gateway topology, without a
framework change.

Correspondingly, `config` is split: `configSchema` validates the
connection-level slice (host, port, timeouts), `deviceSchema` the per-device
slice (MQTT topic, Modbus unit id, OPC-UA node prefix). This is the split the
data already has — `rtus.mqtt_topic` is per-RTU while broker host/port is not.

Test seams are provided by a second, named export per adapter rather than by a
generic dependency slot on the factory — see §9.

### 2. Adapters never touch Postgres

This is the clause that makes the fan-out safe, and it is a hard contract term,
not a guideline.

An adapter's total output is `SourceSample[]`. The **host** owns the
`source_data_key → (assetId, pointKey, unit)` lookup, the batched
`INSERT … ON CONFLICT` into `telemetry.point_values`, the
`pg_notify('bms_telemetry', …)` chunking (the single deduplicated
`chunkReadings` implementation), the timestamp fallback, and the counters.

Consequences that follow directly:

- Six adapters cannot produce six different write paths or six different
  NOTIFY chunkers.
- An adapter unit test needs a fake transport, not a database (§9).
- `F1.11` — "formalise ingest normaliser as the only `telemetry.*` writer" —
  becomes a one-module change rather than a six-module migration.
- `apps/sim` can adopt the same normaliser later without touching adapters.

### 3. Registration, discovery and binding to an RTU

`apps/ingest/src/adapter/registry.ts`:

```ts
const ADAPTERS = {
  mqtt: mqttAdapterFactory,
  // F1.2 adds `modbus_tcp:`, F1.4 `opc_ua:`, F1.5 `snmp:`/`rest_poller:`, F1.6 its own.
} satisfies Partial<Record<IngestProtocol, IngestAdapterFactory>>;
```

`Partial<Record<…>>` because most protocols have no adapter yet; `satisfies`
because an unknown key must be a compile error.

**This file is the one file every fan-out agent touches.** Each adds exactly
one line and one import. Keep the keys alphabetically ordered so a merge
conflict is a one-line, mechanically resolvable conflict. It is called out
here because `docs/build-operating-model.md` §3 forbids two agents editing the
same file — this is the single, deliberate, minimal exception.

**Binding.** `bms.rtus.ingest_enabled = true` remains the on/off switch.
Protocol resolution is:

```
protocol := rtu_connection_configs.protocol ?? rtus.source_type
```

with the `LEFT JOIN` the pilot query already uses, because the pilot RTU may
have no config row. If the resolved protocol is not a key of `ADAPTERS`, the
host logs it **once per RTU per process** and skips that RTU. It never throws.

**Where protocol-specific config lives.** `bms.rtu_connection_configs.config`
(JSONB, ADR 0012). The host reads it once per RTU and validates it twice — the
connection slice with `configSchema`, the device slice with `deviceSchema` —
before `connect`. No new columns on `bms.rtus` for any protocol, ever;
`mqtt_topic`, `station_code` and `external_rtu_id` are grandfathered, not a
pattern.

`deviceKey` resolves to `rtus.rtu_code`, which is what the PHE payload's
`dev_id` is already matched against in `mappingByRtu.get(parsed.devId)`. No new
column, no new concept — the existing routing key, named.

**F1.1 introduces no migration.** `mqtt_topic` lives as a column on `bms.rtus`,
so during the strangler phase the host applies one compatibility shim, scoped
to `protocol === "mqtt"` only, when assembling the device slice:

```
device := { topic: rtus.mqtt_topic, ...(config.device ?? {}) }
```

so a written `device.topic` wins once it exists. Backfilling it and retiring the
column is owed follow-up, not F1.1 — keeping this enabler out of the
migration-review path entirely.

### 4. Credential seam (ADR 0012)

ADR 0012 §4: decryption happens only in ingest runtime. The exact seam:

1. Host selects `config`, `credentials_ciphertext`, `credentials_iv` in the
   binding query — the join `loadMapping()` already performs.
2. Host decrypts via the **existing, unmodified** `decryptCredentials()` in
   `apps/ingest/src/rtu-config.js`, which is the file ADR 0012 established and
   the only ingest file with a CI-wired test.
3. Host narrows the decrypted object with a Zod schema and passes it as
   `context.credentials` — already plaintext — to `connect()`.

Therefore:

- An adapter never sees ciphertext, an IV, a key version, or
  `CREDENTIAL_ENCRYPTION_KEY`.
- An adapter never reads `process.env` for a secret **or** for a connection
  setting. Everything arrives via `context`. New adapters get **no environment
  fallback at all**.
- `MQTT_USERNAME` / `MQTT_PASSWORD` remain as a pilot-era compatibility path
  for the MQTT adapter only, because the pilot RTU may currently have no
  `rtu_connection_configs` row. It is retired in the cutover commit (§6), not
  extended to any other protocol.
- `context.credentials` must not appear in `health().detail`, in any
  `context.logger` call, or in a thrown `Error` message (AGENTS.md §9.6). §9
  makes this a mechanically asserted conformance test, not a review note.

### 5. Error handling, backoff, and what an adapter must NOT do

**Host: one supervisor per endpoint.** Each `(protocol, endpointKey)` group
gets an independent supervisor. A supervisor that fails restarts only its own
adapter instance. Sibling endpoints — including the live PHE MQTT broker
connection — are untouched by another protocol's failure. This is the direct
replacement for today's `main().catch(… process.exit(1))`.

The blast radius of a failure is therefore *the endpoint*, which for
connection-per-device protocols is exactly one RTU, and for multiplexed
protocols is the set of RTUs that genuinely share a connection and would have
failed together anyway. Enumerating that set in `health()` is what F3.16
(device health / last-seen) consumes.

Concrete numbers, stated so five agents do not invent five policies (the host
implements all of it; adapters implement none of it):

| Parameter | Value |
| --- | --- |
| Reconnect backoff | exponential, base 1 s, factor 2, cap 60 s |
| Jitter | ±20%, full-random within the band |
| `connect()` timeout | 30 s, then `signal` aborts and the supervisor backs off |
| `disconnect()` timeout | 5 s, then the supervisor abandons the instance |
| Poll overlap | forbidden — next tick is scheduled only after `poll()` settles |
| Consecutive poll failures before `degraded` | 3 |
| In-memory sample queue | bounded, default 10 000 samples, drop-oldest with a counter |
| Disk buffering | **out of scope — `F1.10`** |

The host installs `process.on("unhandledRejection")` and
`process.on("uncaughtException")` handlers that log and mark the owning
supervisor unhealthy. The process exits only on a genuinely
process-wide fault (loss of the Postgres pool), never on an adapter fault.

**An adapter MUST NOT:**

1. Call `process.exit()`, `process.abort()`, or register any `process.on(…)`
   handler. Process lifetime is the host's.
2. Open a Postgres connection, import `pg`, or write anything to `telemetry.*`
   or `bms.*` (§2, and `F1.11`).
3. Read `process.env` — for credentials, hosts, ports, intervals or anything
   else. `context` is the only input.
4. Own a timer. No `setInterval`, no self-scheduling `setTimeout` poll loop, no
   `while (true)`. The host owns cadence (Options B3).
5. Throw synchronously from `health()`, or return a `detail` derived from
   credentials.
6. Block the event loop: no synchronous I/O, no busy-wait, no unbounded
   synchronous parse of an arbitrarily large payload.
7. Buffer without bound. Anything an adapter cannot hand over promptly it must
   drop and count. The bounded queue is the host's.
8. Call `emit` before `subscribe()` resolves, or after `disconnect()` is called.
9. Swallow errors silently — the `catch {}` in today's `index.js` is the
   anti-pattern. Reject, or log through `context.logger` with a reason.
10. Use `console.*` (AGENTS.md §4.5) or log a full payload containing PII
    (§9.6).

**A failing adapter's blast radius is exactly one endpoint.** That sentence is
the acceptance criterion for the whole error-handling section.

### 6. Migrating the live PHE pilot — strangler, not rewrite

Requirement: the pilot must not be at risk at any point.

**Commit 1 — toolchain, additive.** Add `apps/ingest/tsconfig.json`
(`strict: true`, `allowJs: true`, `checkJs: false`, `outDir: dist`),
`typescript` devDependency, `"build": "tsc -p tsconfig.build.json"`. `"start"`
is **unchanged** (`node src/index.js`). `tsconfig.build.json` excludes
`src/index.js` and `src/**/*.test.js`. `src/index.js` is not edited — not one
line. Dockerfile gains `RUN pnpm build` **before** the existing
`CMD ["pnpm", "start"]`, so a compile fault fails the image build, not the
running pilot.

**Commit 2 — the framework, alongside.** `src/adapter/` (types, registry,
conformance spec), `src/host/` (binding query, credential resolution,
normaliser, NOTIFY chunker, supervisor, health server), `src/main.ts` as the
new entry, and `src/adapters/mqtt.ts` — the MQTT adapter, whose body is
`parsePayload()` and the `mqtt.connect()` block lifted out of `index.js` with
their logic intact. New script `"start:host": "node dist/main.js"`.
`src/index.js` still untouched and still what `pnpm start` runs.

**Commit 3 — verify in parallel.** Run `start:host` against the pilot database
alongside the legacy process. Both write the same rows through
`ON CONFLICT (time, asset_id, point_key) DO UPDATE` — which the existing
`handleMessage()` already uses — so concurrent *writes* are idempotent, not
corrupting.

**Concurrent `pg_notify` is not.** `telemetry-notify.service.ts` holds a
`LISTEN bms_telemetry` and fans every payload to Socket.IO clients, so two
processes notifying would deliver every PHE reading to the live dashboards
twice. The new host therefore starts with `INGEST_NOTIFY=off`: it writes and
counts but does not notify. The flag lives in `main.ts`, so `index.js` is still
never edited. Compare row counts, timestamps and per-RTU sample rates over the
window, then set `INGEST_NOTIFY=on` and flip the compose `ingest` service to
`command: ["pnpm", "start:host"]` in the same step, stopping the legacy
process. **No image rebuild, no code edit, and reverting is deleting one
compose line.**

The suppression flag is deleted in commit 4 — it must not survive as a
permanent way to run ingest with realtime silently off.

**Commit 4 — cutover, after the pilot is confirmed.** Delete `src/index.js`,
point `"start"` at `dist/main.js`, remove the compose `command:` override,
delete the `INGEST_NOTIFY` flag, and retire the `MQTT_USERNAME` /
`MQTT_PASSWORD` fallback once the pilot RTU has a `rtu_connection_configs` row.

`rtu-config.js` is **reused with zero logic changes** throughout. It keeps its
`resolveMqttConnection()` export so `rtu-config.test.js` — the one ingest test
CI runs today, and part of the `test:onboarding` substring filter — keeps
passing unmodified. The host imports `decryptCredentials()` and
`isCredentialKeyConfigured()` from it directly. Preserving that file preserves
both the ADR 0012 seam and the existing coverage contribution.

*Deviation noted:* an `INGEST_HOST_ENABLED` env flag was considered instead of
a separate entrypoint. Rejected — a runtime flag requires adding a branch
*inside* `index.js`, the live file. A separate entrypoint achieves the same
gate with zero edits to the live path, which is strictly safer.

### 7. New-adapter author checklist

This is the contract for the F1.2 / F1.4 / F1.5 / F1.6 agents. Everything not
on this list is the host's job — if you find yourself writing it, stop.

- [ ] Add the protocol to `INGEST_PROTOCOLS` in `packages/shared/src/ingest.ts`
      **only if absent**. `modbus_rtu` and `dcs` are not in the union yet.
- [ ] Create `apps/ingest/src/adapters/<protocol>.ts` — **one file**. Do not
      edit another adapter's file.
- [ ] Export a Zod `configSchema` (connection-level: host, port, timeouts) and
      a Zod `deviceSchema` (per-device: topic, unit id, node prefix). Non-secret
      fields only. Every field documented with a one-line JSDoc (AGENTS.md §4.1).
- [ ] Implement `endpointKey(config, rtuId)`. **Ask: does one connection serve
      several devices?** If yes, return the connection identity
      (`` `${config.host}:${config.port}` ``) — the host will hand you every
      binding on it. If each device needs its own connection, return `rtuId`.
      Getting this wrong is the one mistake that costs a broker N connections.
- [ ] Choose `mode` deliberately and declare it as a literal. If unsure:
      does the device call you, or do you call the device?
- [ ] Implement `connect` / `disconnect` / `health`, plus `subscribe` (push)
      **or** `defaultPollIntervalMs` + `poll` (poll). Never both halves.
      Serve **every** entry in `context.bindings`, not just the first.
- [ ] Emit `SourceSample[]` keyed by the **device's own** identifier. Set
      `deviceKey` whenever `context.bindings.length > 1`. Do not map to
      `point_key`. Do not touch `assetId`.
- [ ] Set `at` only when the protocol genuinely carries a device timestamp.
      Otherwise omit it — the host substitutes receive time.
- [ ] Take credentials and every connection setting from `context`. No
      `process.env`. No env fallback.
- [ ] Log only through `context.logger`. No `console.*`. No secrets, no full
      payloads.
- [ ] Own no timer, no process handler, no Postgres client, no unbounded queue.
- [ ] Honour `context.signal` in every await that can hang.
- [ ] Export a second, named factory taking an injected transport for tests:
      `export function createModbusTcpAdapter(transport: ModbusTransport = realTransport)`.
      The default-exported `IngestAdapterFactory.create()` calls it with no
      argument. This is how the adapter becomes testable without hardware.
- [ ] Add `<protocol>.spec.ts` (assertions) + `<protocol>.test.ts` (wrapper)
      per AGENTS.md §4.6. The wrapper must invoke
      `runAdapterContractTests(factory, fixtures)` **and** your
      protocol-specific cases.
- [ ] Register: one line in `apps/ingest/src/adapter/registry.ts`, keys
      alphabetical.
- [ ] `discover()` is optional. Implement it only if your protocol can browse
      (OPC-UA can; SNMP walk can; Modbus generally cannot). Set
      `supportsDiscovery: true` on the factory when you do, so F3.24 can filter
      without constructing an instance. F3.24 consumes both.
- [ ] **Your protocol library needs its own ADR** (AGENTS.md:160). Do not add a
      dependency in the adapter PR — see Dependencies.
- [ ] `pnpm typecheck && pnpm test:coverage` green, coverage not regressed.

### 8. Where the types live

Split, deliberately:

- **`packages/shared/src/ingest.ts`** — `IngestProtocol`, `INGEST_PROTOCOLS`,
  `AdapterMode`, `SourceSample`, `AdapterHealth`, `DiscoveredPoint`. These are
  consumed *outside* ingest: F3.24's onboarding agent and the `/admin/*` RTU
  screens need to name protocols and describe config shapes.
- **`apps/ingest/src/adapter/types.ts`** — `IngestAdapter`, `AdapterContext`,
  `RtuBinding`, `AdapterLogger`, `IngestAdapterFactory`. Nothing outside
  `apps/ingest` implements or calls these; exporting them would widen the
  shared surface for no consumer.

**Not appended to `packages/shared/src/index.ts`.** Two concrete reasons:

1. It is 818 lines against the 1000-line-per-file cap in AGENTS.md §4.5. The
   adapter types plus per-protocol config types would land it at or over the
   cap within the fan-out, and the ceiling would then be hit by whichever
   agent happened to go last.
2. `packages/shared/package.json` declares an `exports` map with only `"."`, so
   a new module needs an explicit subpath entry regardless. Given that the
   packaging work is unavoidable, spend it on a real module boundary rather
   than on growing a file that is already the package's single point of churn.

Two packaging details that will bite if missed:

- The new `"./ingest"` entry in the `exports` map needs **both** `import` and
  `require` conditions, mirroring the existing `"."` entry. `apps/sim`
  consumes `@bms/shared` through `createRequire(import.meta.url)`, so an
  `import`-only condition would break it.
- `ingest.ts` references `OnboardingProtocol` from `index.ts` while `index.ts`
  re-exports `ingest.ts`. Use `import type` — type-only imports are erased at
  emit, so there is no runtime cycle. If that ever becomes awkward, move
  `OnboardingProtocol` into `ingest.ts` and re-export it from `index.ts`
  instead.

### 9. Testability without hardware

- **Injected transport.** Each adapter's named factory takes its transport as a
  defaulted parameter (§7). Tests pass a fake; production passes nothing. No DI
  container, no module mocking, no `vi.mock` on a protocol library.
- **No database.** Adapters emit `SourceSample[]` and nothing else (§2), so
  every adapter test is pure in-memory.
- **A shared conformance suite — the highest-leverage artefact in F1.1.**
  `apps/ingest/src/adapter/adapter-contract.spec.ts` exports
  `runAdapterContractTests(factory, { validConfig, invalidConfig, validDevice, makeFakeTransport })`.
  Every adapter's `.test.ts` calls it. It asserts:
  - `factory.protocol` matches the registry key it is filed under;
  - `configSchema` accepts `validConfig` and rejects `invalidConfig`;
  - `health()` never throws — before `connect`, after `connect`, after
    `disconnect`;
  - `disconnect()` is idempotent and does not reject;
  - push: nothing is emitted before `subscribe()` resolves, nothing after
    `disconnect()`;
  - poll: `poll()` resolves an array and a second call after the first settles
    is clean;
  - emitted samples are well-formed — `sourceKey` non-empty string, `value`
    finite, `at` a `Date` when present;
  - `endpointKey()` is pure and stable: called twice with the same arguments it
    returns the same string;
  - **multi-binding**: given a context with two bindings, every emitted sample
    carries a `deviceKey` matching one of them, and no binding is silently
    ignored. This is the assertion that catches the
    `activeMqttConnection`-style "only the first row counts" bug at build time;
  - `process.exit` is never called (spied) on a `connect()` failure;
  - **no value from `context.credentials` appears in any `context.logger` call
    or in `health().detail`** — asserted by seeding a sentinel secret and
    scanning captured output.

  This turns §7's checklist from prose into a build gate.

- **Gate wiring (AGENTS.md §4.6: "a check that CI does not execute is not a
  gate").** Two edits are mandatory in the same PR or the entire new suite is
  invisible:
  1. `apps/ingest/vitest.config.ts` — `include` is `["src/**/*.test.js"]`
     today. Must become `["src/**/*.test.{js,ts}"]`, or every `.ts` adapter
     test silently never runs.
  2. Root `vitest.config.ts` — coverage `include` is
     `"apps/ingest/src/**/*.js"`. Must become `"apps/ingest/src/**/*.{js,ts}"`,
     with `apps/ingest/dist/**` excluded. Otherwise the adapter layer sits
     outside the denominator and the ratchet reports a number that means
     nothing.
- Root `build` gains `pnpm --filter ingest build` so `pnpm typecheck` covers
  `apps/ingest`. Root `typecheck:tests` already names
  `apps/ingest/vitest.config.ts`.
- `apps/ingest` has no `.spec.ts` today; its single test keeps assertions in
  the production module as an explicitly documented ADR 0014 exception. **New
  adapter tests do not inherit that exception** — `.spec.ts` holds assertions,
  `.test.ts` wraps, enforced by `tests/repo-invariants.test.ts`.
- Coverage thresholds are ratcheted upward once, at the F1.1 baseline
  measurement. Never lowered (AGENTS.md §4.6).

## Dependencies

Per AGENTS.md:160, every new dependency needs an ADR. This ADR covers exactly
two, both "already-approved library, new consumer" — **plus `@types/pg`, added
later by Amendment 2 when the host was built. The full approved list is
these two and that one.**

- **`zod` `^3.24.1`** in `apps/ingest` `dependencies`. Present in the repo
  (`apps/api`) but not in this package, so it is a new dependency here.
  Justification: each adapter owns a Zod schema for its own JSONB config and
  the host validates before `connect`. Without it, five agents hand-roll five
  validators over untyped JSONB — the exact rework this enabler exists to
  prevent. AGENTS.md §4.3 already mandates Zod for validating untrusted input,
  and `rtu_connection_configs.config` is untrusted input. **Fan-out agents may
  and should `import { z }`.**
- **`typescript` `~5.7.3`** in `apps/ingest` `devDependencies`. Already a root
  devDependency and a `packages/shared` devDependency; needed here explicitly
  because `apps/ingest/Dockerfile` runs `pnpm install --filter ingest`, which
  does not install root devDependencies.

**No new dependency for anything else.** Specifically:

- No logging library. `AdapterLogger` is a three-method interface implemented
  by the host over `process.stdout.write` with JSON lines — the pattern
  `apps/sim` already uses. Swapping in Pino later is a one-file change.
- No metrics library. The existing plain-text health endpoint is extended with
  per-RTU state. `prom-client` is deferred to F1.10 / F3.16.
- **No protocol library.** `mqtt` `^5.10.4` is already present (ADR 0007) and
  is the only transport F1.1 touches. `modbus-serial`, `node-opcua`,
  `net-snmp`, `bacstack` and any DCS SDK are **explicitly not decided here** —
  each of F1.2 / F1.3 / F1.4 / F1.5 / F1.6 brings its own ADR under
  AGENTS.md:160, covering licence, maintenance status and transitive footprint.
  F1.1 must not import any protocol library beyond `mqtt`.

**No schema migration.** F1.1 adds no table and no column (§3). The missing
`bms.protocol_catalog` migration is real but is not F1.1's — see Open questions.

## Consequences

**Positive.**

- The F1.4 / F1.5 / F1.6 fan-out becomes safe: one interface, one file each,
  one shared line in `registry.ts`, one conformance suite that mechanically
  enforces the contract. The cleanest parallel batch in the plan stays clean.
- A failing adapter's blast radius drops from "the whole ingest process" to
  "one endpoint". The live PHE pilot survives a broken Modbus config.
- The duplicated `chunkReadings` implementation collapses to one, and F1.11
  becomes a one-module change rather than a six-module migration.
- F1.7 (MQTT beyond one RTU) gets its two hardest obstacles removed — the
  hardcoded `source_type = 'mqtt'` filter and the `activeMqttConnection`
  singleton that keeps only the *first* row's connection. It is **not**
  delivered outright: F1.7 still owns enabling additional RTUs, their catalog
  rows and the per-RTU credential story. The framework makes it a
  configuration change rather than a rewrite.
- `health()` + `lastSampleAt` is the seam F3.16 (device health / last-seen)
  needs; optional `discover()` is the seam F3.24 needs. Neither will require
  breaking the frozen interface.
- Credential handling stops being MQTT-shaped and becomes a host concern with
  one enforcement point — and one asserted test.

**Negative.**

- `apps/ingest` gains a build step. `pnpm start` semantics change at commit 4,
  and the Dockerfile grows a compile stage on the live pilot path. Mitigated by
  the four-commit strangler (§6) and by the build failing at image-build time.
- Two entrypoints coexist between commit 2 and commit 4. Mitigated by
  `src/index.js` being frozen — not one line edited — so the legacy path cannot
  regress, and by the `ON CONFLICT` upsert making parallel operation
  idempotent.
- One shared file (`registry.ts`) is touched by every fan-out agent, against
  the operating-model rule. Mitigated to a one-line, alphabetically-ordered
  diff.
- The four-to-five-unit estimate assumes the MQTT adapter is a *lift*, not a
  rewrite. If review demands the MQTT payload parser be redesigned at the same
  time, that is a separate item.

**Neutral.**

- `apps/sim` is untouched. It keeps its own write path until F1.11 decides
  otherwise.
- `bms.rtus.source_type` stays as a coarse marker; `rtu_connection_configs.protocol`
  becomes authoritative where a row exists.

## Resolved decisions

Eight questions were open at drafting. All are settled. Two were answered by
querying the database rather than by opinion.

1. **ADR number is 0016.** `0015` is now `docs/adr/0015-asset-template-schema.md`
   (F2.1, accepted the same day). No renumbering needed.
2. **`bms.protocol_catalog` is not F1.1's to fix.** Confirmed at acceptance: the
   table is declared at `packages/db/src/schema/bms-schema.ts:216`, appears in
   **zero** migrations and **zero** seeds, and `listCatalog()`'s
   `catch { return []; }` has been silently returning an empty catalog to the
   onboarding wizard since ADR 0011 shipped. Tracked as its own standalone item.
   F1.1 keeps its registry in code (a static map) and does not depend on the
   table.
3. **`modbus_rtu` and `dcs` are added to the shared `OnboardingProtocol` union
   in F1.1**, not later by F1.2 and F1.6. One edit to `packages/shared` now
   beats two concurrent edits during the slot-6 fan-out.
4. **Cutover (commit 4) needs a named owner.** Deliberately left as a human
   decision — see Owed follow-up. Until someone owns deleting `src/index.js`,
   the two-entrypoint window stays open, and that duplication becoming permanent
   is the realistic failure mode of a strangler migration.
5. **The env credential fallback survives cutover.** Queried at acceptance: **no
   RTU has an `rtu_connection_configs` row** (`has_conn_config = f` for all 20+
   RTUs including the PHE pilot). So `MQTT_USERNAME` / `MQTT_PASSWORD` cannot be
   retired in commit 4 — there is no encrypted credential row to read instead.
   Writing that row is prerequisite work for anyone who wants the ADR 0012 path.
   *Caveat: this was the local seeded database; confirm against the production
   pilot before acting on it.*
6. **Backpressure: bounded 10,000-sample queue, drop-oldest, accepted for the
   pilot.** Any poll adapter going live at a **customer site** is gated behind
   F1.10 (backoff + disk buffering) so that telemetry loss during a database
   outage is bounded and recorded rather than silent. State that gate in F1.10's
   scope.
7. **Topic sharing is not real in the pilot today** — 1 MQTT RTU, 1 distinct
   topic. See the correction in Context. The endpoint/device split is justified
   by Modbus/OPC-UA/SNMP mechanics, not by current MQTT data.
8. **The AGENTS.md promotion is owed separately**, per ADR 0013/0014 precedent —
   §2 stack-table row, §6 wording (which currently reads against a pluggable
   adapter framework), and `docs/roadmap.md`. Not in the feature PR (§9.10).

### Approved dependencies (AGENTS.md:160 / §9.4)

Two approved at acceptance, both "already-approved library, new consumer".
**A third, `@types/pg`, was approved later by Amendment 2** — see the end of
this ADR; it is not listed here because this subsection records what was
decided *at acceptance*.

- **`zod` `^3.24.1`** in `apps/ingest` dependencies — each adapter owns a Zod
  schema for its own JSONB config; `rtu_connection_configs.config` is untrusted
  input, which §4.3 already requires Zod for. Fan-out agents should import it.
- **`typescript` `~5.7.3`** in `apps/ingest` devDependencies — needed explicitly
  because the Dockerfile's `pnpm install --filter ingest` does not pull root
  devDependencies.

`apps/ingest` becomes TypeScript with a build step (Option A2). An interface the
compiler does not check is not frozen; it is a suggestion — and five cold agents
will implement against it. `RUN pnpm build` goes **before** the unchanged `CMD`,
so a compile fault fails at image-build time rather than at runtime on the live
pilot.

**No protocol library is approved here.** `modbus-serial`, `node-opcua`,
`net-snmp`, `bacstack` and any DCS SDK each need their own ADR under
AGENTS.md:160. F1.1 must import no transport beyond the existing `mqtt`.

### Mandatory in the same PR — two gates that would otherwise not exist

- `apps/ingest/vitest.config.ts` currently includes only `src/**/*.test.js`, so
  a TypeScript adapter layer would be **invisible to the test runner**.
- Root `vitest.config.ts` coverage includes only `apps/ingest/src/**/*.js`, so
  the same layer would be **invisible to the coverage ratchet**.

Both must be widened to `.ts` in the PR that introduces the TypeScript layer.
Shipping the layer without them recreates precisely the orphaned-artefact class
this repository has now hit three times (migrations 0018/0021/0022, two
unwrapped specs, and `protocol_catalog`).

## Amendment 1 — `configSchema` / `deviceSchema` input type (2026-08-05)

Found while building the host (§6 commit 2), by the first adapter written
against the frozen interface.

§1 declares:

```ts
readonly configSchema: ZodType<TConfig>;
readonly deviceSchema: ZodType<TDevice>;
```

`ZodType` takes three parameters — `ZodType<Output, Def, Input>` — and `Input`
**defaults to `Output`**. So `ZodType<TConfig>` means "a schema whose input type
equals its output type", which excludes every schema built with `.default()`,
`.transform()`, or an optional-with-fallback: those deliberately accept an input
in which the defaulted fields are absent.

This is not a corner case. The MQTT adapter in this same ADR needs

```ts
rejectUnauthorized: z.boolean().default(true)
```

to carry `index.js`'s `MQTT_TLS_REJECT_UNAUTHORIZED !== "false"` behaviour, and
it failed to compile against the signature above. Every one of `F1.2`–`F1.6`
would have hit the same wall on its first schema, five times over, against an
interface whose entire purpose is to be built against in parallel.

**Amended to:**

```ts
readonly configSchema: ZodType<TConfig, ZodTypeDef, unknown>;
readonly deviceSchema: ZodType<TDevice, ZodTypeDef, unknown>;
```

`unknown` is also the honest input type: the host parses
`bms.rtu_connection_configs.config`, which is untrusted JSONB, and the parse is
exactly where that becomes a `TConfig`.

This is a **widening** — every schema that satisfied the original signature
still satisfies this one — so no existing code changes and nothing already
written against §1 is invalidated. `apps/ingest/src/adapter/types.spec.ts`
carries fixtures using `.default()` and `.transform()`, so tightening the
signature back stops the build rather than silently re-breaking the fan-out.

§7's author checklist is unchanged: adapters still export a Zod `configSchema`
and `deviceSchema`, and may now use defaults in them.

## Amendment 2 — `@types/pg` in `apps/ingest` (2026-08-05)

The Dependencies section above states "This ADR covers exactly two". Building
the host (§6 commit 2) needs a third, and it is recorded here rather than
slipped into a manifest.

- **`@types/pg` `^8.11.10`** in `apps/ingest` **devDependencies**.

Same category as the other two: **already-approved library, new consumer.** It
is already a devDependency of `apps/api` and of `packages/db` at this exact
version. `pg` itself has been a runtime dependency of `apps/ingest` since
ADR 0007 — only the type declarations are new, and they are erased at emit, so
this adds no runtime code and no transitive runtime footprint.

Why it cannot be left to the root: `apps/ingest/Dockerfile` runs
`pnpm install --filter ingest...`, which does not install root devDependencies,
and then `pnpm --filter ingest build`. Without the declaration in this
package's own manifest the image build fails on `new pg.Pool(…)` under
`strict` — the same reason `typescript` had to be declared explicitly rather
than inherited.

The alternative considered was hand-writing a structural type for the slice of
`pg` the host uses. `bindings.ts` and `normaliser.ts` already do exactly that
for their *arguments* (`BindingQueryable`, `QueryableClient`), which is what
keeps them database-free in tests — but `main.ts` has to **construct** a real
`pg.Pool`, and a hand-written ambient declaration for a third-party
constructor is a silent-drift generator: it keeps compiling after the library
changes shape. The published types are the honest option.
