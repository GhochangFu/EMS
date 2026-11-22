# ADR 0141 — Modbus TCP read adapter and device profiles, central or edge polling (`F1.2`)

## Status

**Accepted — 2026-11-22** (owner, in chat: "Accept, open PR"; proposed and
ruled the same day). All questions were ruled one at a time (see
*Rulings*). Six went as recommended. Two changed the draft: **Q4** (a
profile table and an editor in v1, not files only) and **Q5** (a poll
interval set per organization, overridden per endpoint, for every poll
protocol). Nothing is built until a step-3 plan is approved. Lines marked *(drafter)* are drafter calls that the plan may
refine.

Backlog row `F1.2` (Track A, Wave 1, P0, 10–12, depends on `F1.1` ✅). The
row stays ⬜ while this record is proposed. It moves to 🟡 on acceptance and
to 🔵 when the first code PR opens.
Code citations are to `main` at `15473692`.

**Promotes out of AGENTS.md §6** the Modbus line of "Real protocol adapters
for BACnet, Modbus, SNMP, OPC-UA, REST polling, DCS". BACnet, SNMP, OPC-UA,
REST polling and DCS stay in §6. The `chore(agents):` edit is owed
separately (§9.10, §10.1) and is listed under *Consequences*.

**Lifts the A4 park for `F1.2` only.** The backlog parks `F1.2`–`F1.6` "on
the A4 answer" (the client's device landscape), and ADR 0123 Q14 repeats it.
This record replaces that condition for Modbus with a product decision: the
client fleet is MQTT only today and no client can supply a register map, so
the adapter is built against public device manuals and a simulator, and
proved against one bench device. `F1.3`–`F1.6` and `F1.14` stay parked.

**Adds no npm dependency** (Q3: Node core only). **Adds one table and one
column in one forward migration** (Q4, Q5): `bms.device_profiles` and
`bms.organizations.default_poll_interval_ms`. **Adds no database role**; the
migration grants on the new table to the existing roles (ADR 0045).

**Amends** [ADR 0016](./0016-ingest-adapter-framework.md) §1 and §B3 for
every poll protocol (decision 10): the host still owns the timer, but the
interval it sleeps comes from the endpoint, then the organization, then the
adapter's `defaultPollIntervalMs`.

**Builds on** [ADR 0016](./0016-ingest-adapter-framework.md) (the frozen
`IngestAdapter` interface, poll mode, the registry, config in
`bms.rtu_connection_configs.config`, "each protocol brings its own ADR"),
[ADR 0123](./0123-edge-store-and-forward.md) (the edge runtime that runs
the same registry on site) and [ADR 0061](./0061-ingest-receive-time-and-device-time.md)
(receive time when a protocol carries no device time).

## Context

### The product position

TRINETRA is sold as a product, not as one client's integration. Every
site in the fleet today publishes over MQTT (PHEWB, BCPL, WBLDC), and no
client can supply a Modbus register map. Waiting for a client to ask means
the first Modbus site starts from zero. Modbus is the most common field
protocol on the energy meters, water analysers and PLCs this product
monitors, and an MQTT RTU of the kind the fleet uses commonly reads its
meters over Modbus on its serial side before it publishes (not verified
for the PHEWB, BCPL or WBLDC RTUs). So the product needs the adapter
before a client asks for it, and it needs it in a form that does not
depend on one client's register map.

That moves the hard part from the wire protocol to the **point map**. A
Modbus device publishes nothing about itself: the reader must already know
that, for example, "holding register 3059, two words, float32" is total
active power. That knowledge sits in the vendor's manual. A product must
let an operator supply it as data, never as code written for one client.

### What exists

- **The interface is frozen and poll-ready.** `apps/ingest/src/adapter/types.ts`
  defines `PollIngestAdapter` with `mode: "poll"`, `defaultPollIntervalMs`
  and `poll(): Promise<readonly SourceSample[]>`. The host owns the timer,
  the overlap guard, the backoff and the queue (ADR 0016 §B3). An adapter
  receives `bindings: RtuBinding<TDevice>[]`, each with a `deviceKey` and a
  `device` slice validated by the factory's `deviceSchema`.
- **The registry is waiting for this row.** `apps/ingest/src/adapter/registry.ts:33`
  reads "F1.2 adds `modbus_tcp:`". `modbus_tcp` is already in
  `INGEST_PROTOCOLS` (`packages/shared/src/ingest-protocols.ts:13`) but not
  in `INGEST_WIRED_PROTOCOLS` (`packages/shared/src/protocol-catalog.ts:29`,
  `["mqtt"]`). The registry is typed `satisfies Record<IngestWiredProtocol, …>`,
  so an adapter PR adds its code to both together. The host's
  binding and edge specs already use `modbus_tcp` rows as fixtures
  (`host/bindings.spec.ts`, `host/bindings-edge.spec.ts`).
- **The edge runtime is built.** ADR 0123's seven PRs are merged
  (the `E7.2` row stays 🟡 until its outage drill). `apps/ingest/src/edge-main.ts`
  builds the same registry, adapters and supervisor as `main.ts`, reads its
  devices from `EDGE_CONFIG_FILE`, and forwards over
  `POST /edge/v1/batches`. ADR 0123 decision 3: "The edge holds no point
  mapping: samples leave un-normalised". Decision 6: an RTU has one writer —
  the cloud host skips an RTU whose `edge_gateway_id` is set.
- **The production deployment is cloud.** The live host is the AWS demo
  (ADR 0096). On-prem packaging (`E7.3`) and site VPN (`E7.4`) are not built.
- **No protocol library is approved.** ADR 0016 *Dependencies*:
  "`modbus-serial`, `node-opcua`, `net-snmp`, `bacstack` and any DCS SDK are
  explicitly not decided here — each … brings its own ADR".

### One adapter, two places it can run

Because both entry points build the same registry, **one `modbus_tcp`
adapter file runs in both places with no change**. The choice between
central and edge polling is therefore not a choice between two codebases.
It is a choice of which deployment v1 supports, tests end to end and
documents, and of where the register map is resolved.

## Options considered — where the poll runs

### Option A — Central polling

The ingest host (`main.ts`, cloud or on-prem) opens a TCP socket to each
Modbus endpoint and polls it. The register map comes from
`bms.rtu_connection_configs.config`.

- **For:** no box on site; the config is edited in the product; the cloud
  host already has supervision, health, `F1.10` disk buffering and the
  `F3.16` device-health tables.
- **Against:** Modbus TCP has no authentication and no encryption. From the
  AWS host, a site device is reachable only if port 502 is exposed to the
  internet (not acceptable) or through a site VPN (`E7.4`, not built). Each
  poll crosses the WAN, so a 10 s cadence over many registers becomes
  latency- and loss-sensitive. A WAN outage loses data: nothing on site
  buffers it.
- **Where it fits:** an on-prem install (`E7.3`) or a lab, where the ingest
  host and the devices share a private network.

### Option B — Edge polling

The ADR 0123 edge runtime, on a box at the site, polls the devices on the
site LAN and forwards samples over the authenticated HTTPS uplink. The
register map lives in `EDGE_CONFIG_FILE` on the box.

- **For:** only outbound HTTPS leaves the site, which is the network posture
  the uplink was designed for. Modbus never crosses the internet. A WAN
  outage is buffered on site (ADR 0123 edge bounds). Poll latency is LAN
  latency. It matches how the fleet's MQTT RTUs already work: read locally,
  publish upward.
- **Against:** it needs a box on site, and edge hardware is out of this
  backlog (ADR 0123 Q13). The register map is in a local file, not edited
  in the product, so a profile must be exported into that file. The edge
  runtime is not yet proved by its outage drill.

### Option C — Both, with edge as the supported default *(recommended)*

Build the one adapter. Prove it under both entry points in CI. Document and
support **edge polling** as the field deployment, and **central polling only
where the ingest host and the devices share a private network** (on-prem,
lab, the local compose stack). Central polling across the internet is not a
supported deployment.

This costs almost nothing over B, because the adapter is the same file and
the central path is what the local compose stack and CI use anyway. It
keeps on-prem (`E7.3`) open without a second build.

## Decision

Each numbered item states the ruled answer. Items that depend on a
question name it.

### Deployment

1. **Option C** (Q1). One `modbus_tcp` adapter, registered in
   `apps/ingest/src/adapter/registry.ts`, runs under `main.ts` and under
   `edge-main.ts` unchanged. The same PR adds `modbus_tcp` to
   `INGEST_WIRED_PROTOCOLS` (`packages/shared/src/protocol-catalog.ts`), and
   updates whatever the protocol-catalog spec and the onboarding contract
   (`packages/shared/src/contracts/onboarding.ts`) assert about the wired
   list — the plan names each file after reading them. `docs/ingest-host.md` and the edge runbook
   state that a field site uses the edge, and that central polling is for a
   host on the same private network as the devices.

### Protocol scope

2. **Read only.** The adapter sends function codes 01 (coils), 02 (discrete
   inputs), 03 (holding registers) and 04 (input registers) and nothing
   else. A static test, `tests/f1.2-modbus-read-only.test.ts`, refuses the
   write codes 05, 06, 15 and 16 in the adapter source. Writing to a device is the command path (`F3.12`)
   and needs its own ADR.
3. **Modbus TCP only; serial devices through a gateway** (Q2). An RS-485
   device is read through a Modbus TCP gateway, which serves many unit ids
   over one socket — the case ADR 0016 *Context* names as the reason the
   endpoint is the unit of supervision. No `modbus_rtu` protocol, no serial
   port access, no native addon in the image.
4. **Own read-only client on `node:net`** (Q3). The adapter implements the
   MBAP header and the four read requests itself. No protocol library is
   added.

### Endpoint and device

5. **One adapter instance per endpoint.** The connection slice
   (`configSchema`) is `{ host, port = 502, timeoutMs = 1000, interRequestDelayMs = 0 }`.
   `endpointKey` is `modbus_tcp://<host>:<port>`, so every RTU behind one
   gateway shares one socket. Requests on one socket are sequential; the
   adapter matches each reply to its transaction id and drops a reply that
   matches none.
6. **One binding per Modbus unit.** The device slice (`deviceSchema`) is
   `{ unitId: 0–247, profile?: { code, version }, registers: Register[] }`.
   `deviceKey` resolves to `rtus.rtu_code` as for every adapter (ADR 0016 §3).
   `registers` is always the full, resolved list, so the adapter never looks a
   profile up — the same slice works from the database and from
   `EDGE_CONFIG_FILE`. `profile` is provenance only.
7. **A register entry** (`packages/shared/src/ingest-modbus.ts`, Zod):

   ```
   {
     sourceKey: string,              // = bms.asset_points.source_data_key
     table: "coil" | "discrete" | "holding" | "input",
     address: 0–65535,               // zero-based protocol address
     type: "bool" | "int16" | "uint16" | "int32" | "uint32"
         | "int64" | "uint64" | "float32" | "float64",
     wordOrder: "big" | "little" = "big",
     byteSwap: boolean = false,
     scale: number = 1,
     offset: number = 0,
     unit?: string,                  // display hint for onboarding only
   }
   ```

   The value is `raw × scale + offset`. An `int64`/`uint64` raw value outside
   `Number.MAX_SAFE_INTEGER` is emitted with `good: false`, never rounded
   silently. Two entries in one device may not share a `sourceKey`; the
   schema refuses it.
8. **Reads are coalesced per table.** Contiguous addresses in one table are
   read in one request, up to 125 registers (FC 03/04) or 2,000 bits
   (FC 01/02). Gaps are not bridged in v1, because many devices answer an
   exception for an unmapped address inside a range.
9. **Failure is per block, not per device.** A Modbus exception or a timeout
   on one block emits every sample of that block with `good: false` and the
   poll continues with the next block. The host discards and counts those
   samples under the point's `quality_policy` `discard_bad`, the default; a
   point set to `accept_bad` stores them (ADR 0056 Q3,
   `packages/shared/src/ingest.ts`). The same rule applies to decision 7's
   out-of-range `int64` sample. A lost socket rejects the poll, so the host's backoff applies.
   No sample carries `at`; the host stamps receive time (ADR 0061).
10. **Poll interval, configurable for every poll protocol** (Q5). The
    Modbus adapter's `defaultPollIntervalMs` is 10,000. The host resolves
    the interval for each poll endpoint as:

    ```
    interval := config.pollIntervalMs                     -- the endpoint
             ?? organizations.default_poll_interval_ms   -- the organization
             ?? adapter.defaultPollIntervalMs            -- the adapter
    ```

    - `pollIntervalMs` is one optional field in the connection slice of every
      poll protocol, already listed by `packages/shared/src/protocol-catalog.ts`
      for Modbus (`:108`) and REST (`:149`) and written by the onboarding
      wizard. Today `host/supervisor.ts:548` ignores it and sleeps
      `adapter.defaultPollIntervalMs`; this decision makes the host read it.
    - Both values are bounded 1,000–3,600,000 ms by one shared Zod schema.
      A value outside the bounds is refused on write and, if one is found at
      load, logged once and replaced by the next level down.
    - The new value takes effect at the next binding reload, as the
      organization ingest switch does (ADR 0115). No restart.
    - The endpoint value is edited in the RTU connection settings; the
      organization default in the organization settings. Who may edit the
      organization default: global `admin`, as for the ingest switch
      *(drafter)*.
    - The edge has no database, so decision 17's export writes the resolved
      interval into each endpoint's `pollIntervalMs`.
    - **MQTT is not affected.** It is push: the device sets its own cadence,
      and the product cannot change it.
11. **No credentials.** Modbus carries none. The adapter ignores
    `context.credentials`, and the conformance suite's secret-scan still runs.

### Device profiles

12. **A device profile is data** (Q4). A profile is
    `{ code, version, vendor, model, source: { document, revision, pages }, verified: boolean, registers: Register[] }`.
    `verified` is `false` until the profile has been read against a real
    device and the result recorded.
13. **Profiles live in a table, with an editor** (Q4). A new table
    `bms.device_profiles` holds an organization's profiles:
    `organization_id NOT NULL`, RLS and `FORCE ROW LEVEL SECURITY` in the
    creating migration (ADR 0043, ADR 0045), `protocol` (`modbus_tcp` in
    v1), `code`, `version`, the descriptive fields of decision 12, and
    `registers jsonb` validated by the decision 7 schema on every write.
    `(organization_id, protocol, code, version)` is unique. An admin screen
    lists, creates, edits and copies profiles; registers are edited as rows
    of a table, not as raw JSON *(drafter)*.
14. **Stock profiles are imported, not shared** (Q4a). Stock profiles ship
    as JSON files in `packages/shared/src/device-profiles/modbus/`, each
    validated in a unit test. v1 ships 3 to 5 profiles for energy meters
    that are common in India (Q6), each citing its public manual. An admin
    imports a stock profile as a copy into the organization's own rows and
    may then edit it — the asset-template stock catalog pattern. No row is
    shared across organizations.
15. **Binding copies the registers.** When an operator binds a device to a
    profile, the API copies the profile's registers into the device slice
    and records `profile: { code, version }`. A later edit to the profile
    does not change a bound device; it saves as a new version, and
    re-applying it to bound devices is a later row *(drafter)*.
16. **Profile keys meet template keys.** Where a stock asset template
    already names a point (for example `kwh_total`, `bms.point_keys`), the profile's
    `sourceKey` uses the same string. Then mapping a profile device onto an
    asset from that template needs no hand mapping of
    `source_data_key`.
17. **Edge export.** A script writes a device's resolved slice into the
    `EDGE_CONFIG_FILE` shape (ADR 0123 decision 3), so an edge box is
    configured from the same data the product holds. `registers` sits inside
    each device's `device` object, and the optional `sourceKeys` filter is
    not written: the register list already names every key the device reads.

### Test and acceptance

18. **No hardware in CI.** Unit tests run the ADR 0016 conformance suite
    (`runAdapterContractTests`) with a fake transport, plus golden byte
    fixtures for each request and reply shape taken from the Modbus
    Application Protocol specification, so the codec is not tested only
    against itself.
19. **An in-process Modbus TCP server** in `apps/ingest/src/testing/`
    serves a profile with generated values. An integration test runs the
    real adapter against it under the host supervisor, from both
    `main.ts`'s and `edge-main.ts`'s wiring.
20. **A demo device for the local stack** (Q7): `apps/sim` gains a Node-only
    Modbus TCP server that serves the stock profiles, under a new compose
    profile `modbus`, so the local stack shows Modbus end to end.
21. **The row closes on a real device** (Q8). Code PRs merge on the
    simulator. `F1.2` becomes ✅ only after one bench device has been read
    through the product and the result recorded, and that device's profile
    flips to `verified: true`.

## Rulings (owner, 2026-11-22)

Asked one at a time in chat. Each entry gives the question, the options
offered, the recommendation, and the ruling.

| Q | Ruling | As recommended |
|---|---|---|
| Q1 | C — both; edge is the field default, central only on a private network | yes |
| Q2 | A — TCP only; serial devices through a gateway | yes |
| Q3 | A — own read-only client on `node:net` | yes |
| Q4 | **B — a `bms.device_profiles` table and an editor screen in v1** | **no** (recommended A, files only) |
| Q4a | Stock profiles are imported as a copy per organization | yes |
| Q5 | **10 s default; an organization default plus an endpoint override, for every poll protocol** | **no** (recommended a fixed 10 s; the owner asked for an interface) |
| Q6 | Common Indian energy meters, 3 to 5 models | yes |
| Q7 | A Modbus simulator in `apps/sim`, compose profile `modbus` | yes |
| Q8 | The row closes on a recorded read from a real bench device | yes |

**Q1. Where does the poll run?** A. Central only. B. Edge only. C. Both,
edge as the supported field default, central only on a private network.
**Recommend C** — the adapter is one file either way, and C keeps on-prem
(`E7.3`) open at no extra build cost. **Ruled C.**

**Q2. Serial (Modbus RTU) devices?** A. TCP only in v1; serial devices
through an RS-485-to-Ethernet gateway. B. Direct serial too, with the
`serialport` package. **Recommend A** — `serialport` is a native addon,
which complicates the image and an ARM edge box, and a gateway costs less
than the integration. **Ruled A.**

**Q3. Protocol library?** A. Own read-only client on `node:net`, no
dependency. B. `modbus-serial` (needs its own §9.4 review: licence,
maintenance, transitive footprint including `serialport`). **Recommend A** —
the read subset is small and fully specified, ADR 0123 set the Node-core-only
precedent for the same process, and decision 18's spec fixtures stop the
codec from being tested only against itself. **Ruled A.**

**Q4. Where do profiles live?** A. JSON files in `packages/shared`, copied
into the device slice at bind time; no table. B. A new table
`bms.device_profiles` (stock plus organization rows) and an editor screen.
C. Inline registers only, no profiles. **Recommend A for v1**, with B as a
follow-up row — A needs no migration and no screen, and B can import A's
files as its stock rows. **Ruled B** — decisions 13 to 15. The cost moves
into `F1.2`: one migration (migration review), RLS, and an admin screen.

**Q4a. How do stock profiles reach an organization?** (asked after Q4 B,
because ADR 0043 requires `organization_id NOT NULL` and RLS on a tenant
table.) A. An admin imports a stock file as a copy into the organization's
rows. B. Global read-only rows, which need a tenancy exception. **Recommend
A** — the asset-template stock catalog pattern. **Ruled A** (decision 14).

**Q5. Default poll interval?** A. 10 s. B. 60 s. C. 1 s. **Recommend A.**
The owner answered: start at 10 s, and give the interval an interface, for
all protocols, so it can move to 60 s later. Asked again with three shapes:
per endpoint; per organization; or an organization default with an endpoint
override. **Ruled the last** (decision 10). MQTT is push, so its cadence
stays with the device.

**Q6. Which meters get stock profiles?** The owner names 3 to 5 models.
**Recommend** energy meters common on Indian sites, for example the
Schneider PowerLogic PM5000 series, Secure Elite 400 series, Elmeasure and
Selec multifunction meters — final list in the plan, after the manuals are
checked to be public. **Ruled as recommended.**

**Q7. A Modbus simulator in the local stack?** A. Yes, in `apps/sim`, Node
only, compose profile `modbus`. B. Tests only. **Recommend A** — the demo
needs a Modbus source to show the feature without hardware. **Ruled A.**

**Q8. What closes the row?** A. A read from one real bench device, recorded.
B. Simulator only. **Recommend A.** The purchase of the bench device (a
Modbus TCP meter, or an RTU meter with an RS-485-to-Ethernet gateway) is the
owner's decision and is not part of this record. **Ruled A.**

## Dependencies

None (Q3 A). The adapter uses `node:net`, `node:buffer` and the `zod`
already approved for `apps/ingest` by ADR 0016. The profile editor uses the
web stack that exists.

**Schema** (one forward migration, next free number at build time):
`bms.device_profiles` (decision 13) and the nullable column
`bms.organizations.default_poll_interval_ms` (decision 10). It goes through
the `migration-reviewer` and the ADR 0045 grants.

## Consequences

- **The protocol work is small; the profile work is the product.** Most of
  the effort is the register schema, the profile table and editor, the
  stock profiles and the bind-time copy. `bms.device_profiles` carries a
  `protocol` column so `F1.3`–`F1.5` can reuse it (a BACnet object list and
  an OPC-UA node list are the same idea), each with its own register schema.
- **The effort estimate moves.** Q4 B and Q5 add a migration, two admin
  surfaces and a host change for every poll protocol. The plan re-estimates
  `F1.2` against its 10–12.
- **The configurable interval serves every future poll adapter.** `F1.3`,
  `F1.5` and `E6.1` get it with no further work, because the host resolves
  it, not the adapter.
- **A profile from a manual can be wrong.** Word order, scale and base
  address differ between vendors and even between firmware versions.
  `verified: false` makes that visible, and Q8 makes one profile true.
- **Edge sites are configured by file in v1.** The operator edits profiles
  in the product and exports them to the box (decision 17). A config push
  from the cloud to the edge is not in ADR 0123's scope and is not in this
  one.
- **Central polling across the internet stays unsupported.** Nothing in the
  code prevents a public `host`; the documentation and the onboarding text
  say not to. A guard is a possible follow-up, not v1.
- **Writes stay out.** `F3.12` owns writing to devices, with its own ADR and
  the safety gates of `F3.13` and `F3.14`.
- **Owed after acceptance, separately:**
  - `chore(agents):` (§9.10, §10.1) — every AGENTS.md place that defers
    Modbus, measured on `15473692`: the §6 line (~5576), the "Real protocol
    adapters (BACnet, Modbus, …)" row (~5126), the deferred-adapter notes
    (~2040, ~2070, ~2117, ~2210) and the ingest-adapter stack row (~2261),
    plus the status line. Re-measure at sweep time; line numbers move.
  - `docs/roadmap.md` — Modbus at ~253 ("Graduates"), ~276, ~288 and ~912.
  - `docs/BACKLOG.md` — `F1.2` to 🟡 on acceptance, retitled "Modbus TCP read
    adapter and device profiles"; a new parked row for Modbus RTU direct
    serial (Q2 B); a new row for re-applying an edited profile to bound
    devices (decision 15); and
    the A4 park text that names `F1.2` at ~114, ~220, ~1655 and ~1677,
    narrowed so it no longer covers `F1.2` (`F1.14` at ~448 cites the `F1.2`
    park and needs the same edit).
  - ADR 0123 Q14 — a one-line note that `F1.2` no longer waits on A4.

## Amendment 1 — the plan rulings (`F1.2`, 2026-11-22)

**Status:** Accepted 2026-11-22 (owner, in chat: "Accept both, open PR";
proposed the same day). The owner ruled the step-3 plan's
questions P1–P12 on 2026-11-22, one at a time in chat, and approved the plan
([`docs/plans/f1.2-modbus-tcp-adapter-and-device-profiles.md`](../plans/f1.2-modbus-tcp-adapter-and-device-profiles.md)
§12). Five rulings change a decision of this record; this amendment states
them. P5, P9 and P10 change the host and are recorded in
[ADR 0016 Amendment 10](./0016-ingest-adapter-framework.md). P2, P4 and P12b
confirm a decision as written and change nothing here. P7 confirms decision
9 too; part (b) only states the placeholder value it implies. Lines marked
*(drafter)* are drafter calls the build may refine. No code PR that depends
on a part below starts before this amendment is accepted.

**(a) Decision 6 — unit id 255 is accepted (P1).** The device slice's
`unitId` is `0–247` **or `255`**. The Modbus TCP implementation guide names
255 for a device addressed directly over TCP, and some Ethernet meters
answer to no other value. `modbusDeviceSchema` refuses 248–254 and anything
above 255. PR 1 confirms the guide's wording from the document and cites the
section in the fixture file.

**(b) Decision 9 — the value of a failed read (P7, a clarification).** A
sample from a failed block, an out-of-range 64-bit value and a non-finite
float are emitted as `{ value: 0, good: false }`. ADR 0016's conformance
suite requires a finite `value` on every sample, so the `0` is a placeholder,
never a reading. Under the default `discard_bad` the host drops and counts
it. `docs/modbus-device-profiles.md` says not to set `accept_bad` on a Modbus
point, because that policy would store the `0`.

**(c) Decision 10 — who edits the organization default (P12a).** The
*(drafter)* line "global `admin`, as for the ingest switch" is replaced:
**the global `admin`, and an `organization_admin` with a direct grant on
that organization**, through the gate the organization's
energy settings use (`AccessControlService.isOrganizationLevelAdmin`,
`apps/api/src/auth/access-control.service.ts:299`, called at
`apps/api/src/admin/organizations/organizations.service.ts:232`). A
location-scoped or asset-group-scoped user cannot set it. The endpoint
override stays with whoever may manage the RTU's location.

**(d) Decision 17 — the edge export writes mapped registers only (P8).** The
export writes, for each device, only the registers whose `sourceKey` is
mapped to an active asset point of that RTU. It still writes no
`sourceKeys` key. A register that no point maps is not read on the edge, so
the cloud receiver does not count it as unmapped on every batch. A new
mapping needs a new export to the box; the export script lists the
registers it left out, by `sourceKey`, so the operator can see why.

**(e) New decision 22 — the cloud host dials only allow-listed Modbus hosts
(P6).** This replaces the *Consequences* line "Nothing in the code prevents a
public `host` … A guard is a possible follow-up, not v1."

- `MODBUS_TCP_HOSTS` is read by `apps/ingest` in `host/config.ts` (an adapter
  may not read the environment, ADR 0016 §4). **Unset or empty means the
  cloud host dials no Modbus endpoint** — fail closed. This follows the
  parsing and fail-closed half of ADR 0114's `MQTT_PLAINTEXT_HOSTS`, not its
  API half (see the last bullet).
- A comma-separated list. Each entry is trimmed and lower-cased, and is one
  of: a host name (exact match, no wildcard), an IPv4 or IPv6 literal, or an
  IPv4 CIDR block *(drafter: CIDR because meters are usually addressed by IP
  on a site subnet)*. No port. An entry that parses as none of these refuses
  the host's start with a fixed message. One parser in `@bms/shared`.
- The check runs in the binding plan of `main.ts` only. An RTU whose Modbus
  `host` is not on the list is skipped with the reason
  `modbus-host-not-allowed`, logged once per RTU per process and shown on the
  health body. It never dials. The match is on the configured `host` string;
  a name is not resolved to check it against a CIDR block *(drafter)*.
- **The edge is not affected.** The edge box sits on the site LAN by design
  (decision 1), and its configuration is a local file the site owns.
- The API does not refuse a bind for a host that is not listed *(drafter)*:
  the API cannot know whether the RTU will be polled by the cloud or by an
  edge box. The skip reason is visible on the health body. This is where it
  differs from ADR 0114, whose API also reads the list and refuses at
  onboarding validation and discovery.

**(f) New decision 23 — onboarding binds a profile (P11).** The onboarding
draft of a `modbus_tcp` RTU may name one of the organization's device
profiles (`profileId`). At commit, the API copies that profile's registers
into the device slice with the same helper as the RTUs page bind (decision
15) — one code path, not two — and records `profile: { code, version }`.
For a Modbus RTU committed **with** a profile, the operator may switch
ingest on at commit; without a profile it is committed with ingest off, as
every non-MQTT RTU is today
(`apps/api/src/admin/onboarding/onboarding-commit.service.ts:591-592`). The
guided chat and the Excel import path accept the profile reference. A
profile of another organization is refused as not found. This is plan PR
11.

**What this amendment does not change.** Decisions 1–5, 7, 8, 11–16, 18–21
stand as written. P3 (five stock meters, manuals fetched by the build agent)
and P4 (keep the 1 h bound and warn above 360 s) are plan scope, not ADR
decisions.

**Owed after acceptance, added to this record's *Consequences* list** (the
separate `chore(agents):` sweep, §9.10, §10.1): AGENTS.md's ingest stack row
(~2250) says the reload "swaps point mappings only" — it now also replaces a
poll endpoint on `device-config-changed` and `poll-interval-changed` (ADR 0016
Amendment 10 (a)); the same row lists `MQTT_PLAINTEXT_HOSTS` and must list
`MODBUS_TCP_HOSTS`; the compose topology (the `modbus-sim` network and the
`modbus` profile, ADR 0016 Amendment 10 (b)) and the poll-adapter restart
rule (Amendment 10 (c)) are new. Re-measure the line numbers at sweep time.
