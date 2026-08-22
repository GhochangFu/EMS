# ADR 0007 — PHE MQTT ingest pilot (Phase 2 Path A)

## Status

Accepted

## Context

Path B (simulator-only) is active for the Eskom SMOC demo stack, but a real
MQTT source exists for West Bengal Public Health Engineering (PHEWB) pump
houses via ThinkIoT (`phe.thinkiot.co.in`). Catalog data (RTU, device,
sensor, `DataKey` mapping) lives in `TeleCash_Wallet_1` on Azure SQL.

## Decision

1. Add `bms.ingestion_gateways` and `bms.asset_points` for catalog + MQTT
   topic binding.
2. Seed PHEWB OrgId 10 catalog into Postgres from exported MSSQL snapshot
   (`packages/db/src/phe-catalog.json`).
3. Add `apps/ingest` — MQTT TLS subscriber that writes
   `telemetry.point_values` and `pg_notify('bms_telemetry', …)` using the
   same pipeline as `apps/sim`.
4. Enable live ingest for **one pilot RTU** only (Bhutnirghat I,
   `EdgeRTUId = 13`, topic `Airsprint-1051/Data/861736076104923`).
5. Skip simulator output for assets with `meta.telemetrySource = 'mqtt'`.

## Dependencies

- `mqtt` (MQTT.js v5) in `apps/ingest` only.

## Consequences

- Phase 2 Path A is partially promoted for the PHE pilot scope only.
- EMQX and multi-protocol adapters remain deferred.
- Credentials are env-only (`MQTT_*`), never committed.

## Amendment 1 — decision 4 is superseded by a measured five (2026-08-22)

**Status: Accepted — 2026-08-22.** Ruled by the repository owner at the §10
gate, after the four-agent review round that produced the held-back set below.

Written at the `F1.7` gate. It supersedes decision 4's one-RTU limit, and
records the ownership rule that limit's removal forced. The two are one act:
the second exists only because of the first.

### Why an amendment and not a new ADR

`docs/BACKLOG.md` §1b already settled the *protocol* question — *"`F1.7` and
`F1.10` are the exceptions: MQTT is already promoted (ADR 0007)"* — so AGENTS.md
§6's gate on further protocol implementations is cleared and no new scope ADR is
owed. Decision 4 is not a protocol statement. It is a **numeric** one, written
when exactly one RTU had been measured, and clearing the protocol gate never
touched it. This amendment closes that gap and nothing wider.

### Decision 4 — the owner is named

Decision 4 enabled **one** pilot RTU. **The repository owner owns the expansion
to the five RTUs listed below**, instructed 2026-08-22.

Recorded because the gate needs a named owner rather than an instruction, the
same distinction Amendment 3 of ADR 0016 draws. This matters here for a specific
reason: commit `72ccdc9` of the `F1.7` branch wrote that pointing ingest at the
other eight stations was *"a separate change and an owner decision under ADR 0016
Amendment 3"*, and the next commit made that change without one. The standard
was stated and then not applied. Naming the owner here is what repairs it.

### The set is measured, not chosen, and two filters produced it

Five of the twelve RTUs in `packages/db/src/phe-catalog.json`, listed in
`packages/db/src/ingest-enabled-set.ts` and recorded with their evidence in
`docs/f1.7-fleet-probe.md`: Lotapata I, Lotapata II, Mora Nodir Kuthi I, Bilsi I
and Bhutnirghat I (the pilot).

**The criterion is that an enabled RTU must be better than the simulator it
replaces.** Decision 5 makes `apps/sim` skip assets marked
`meta.telemetrySource = 'mqtt'`, so enabling a station that cannot deliver a
readable value takes it from simulated to **dead**.

*Filter one — is it on the wire?* A read-only probe of all twelve topics ran
600 s, ten cycles at the fleet's ~60 s cadence. Nine sent 9–10 messages each;
**Banchukamari I, Banchukamari II and Bilsi II** sent nothing in any cycle.

*Filter two — is what it sends readable?* Four of those nine fail it, and the
first draft of this amendment missed them:

- **Salkumarhat I and Salkumarhat II** publish all 27 keys, but 17 carry no
  reading and those 17 are the entire Modbus register block — 5 of 21 points
  land, and the missing block includes `s09_r01` → `kw`, which is exactly what
  `sites_online` counts. Their meters are dark. Tracked as `F4.58`.
- **Mora Nodir Kuthi II** (clock −3:02:36) and **Bhutnirghat II** (−0:21:34)
  publish correctly, but their rows land outside every dashboard recency window,
  so the tiles read offline whatever the plant is doing. Tracked as `F4.57`.

Holding these four back is the criterion applied consistently; enabling them
would have put four sites on a control-room view that reads them wrong, which is
worse than the simulated data they keep. **Re-enabling any of them is one
`UPDATE` and no code change**, because the seed defers to the operator once a row
is stamped.

Re-measure before changing the set. The probe reports `absent=` per topic, so
filter two is visible rather than inferred.

### Decision 4a — the seed asserts the set once, then the operator owns it

New, and inseparable from the above. `bms.rtus.ingest_enabled` is operator-
editable through the admin RTU screen, and the seed's upsert carried
`ingest_enabled = EXCLUDED.ingest_enabled`, re-asserting its own opinion on every
run — including the `pnpm db:seed` that CI runs on every PR. At one enabled RTU
nobody would ever have seen it. Across a fleet it means an operator who switches a
flapping station off has that reverted, which is worse than not offering a
switch.

The rule is therefore versioned: the seed asserts a set **once**, stamps
`rtus.meta.enabledSetVersion` to record that it did, and from then on the row
belongs to whoever runs the plant — in **both** directions. Re-enabling a station
they disabled is the defect above; disabling one they enabled is the same mistake
mirrored, since a silent RTU may have come back.

### What this amendment does not decide

Named so they are not read as settled by it:

- **Device clock skew.** Timestamps come from the device and are unbounded;
  measured 2026-08-22 across nine devices spanning **−3:02:36 to +34:31**.
  `F4.37` — closed — names `F1.7` as where an ingest-side clamp belongs and
  calls the trade a product call. Tracked as `F4.57`; still open.
- **Two stations' meters are dark.** Salkumarhat I and II publish all 27 keys but
  17 carry no reading, so they land 5 of 21 points. A field condition, correctly
  handled and reported nowhere. Tracked as `F4.58`.
- **The dashboard consequence of both.** `sites_online` reads a 20 s window and
  the map 25 s. This is **why** the four are held back rather than a residual of
  enabling them — but the five that are enabled all run 8 to 34 minutes ahead,
  so each still reads online for as long as its clock leads after it dies. That
  half is not fixed here.

### Consequences

- Live ingest covers five PHE RTUs; the pilot is one of them. `meta.pilot`
  reverts to meaning the ADR 0007 RTU specifically.
- Enabling or disabling an RTU requires an ingest restart. The reload loop
  refreshes point mappings only and warns for a new *endpoint*, but MQTT groups
  a whole broker into one endpoint, so this is the silent case.
- Decisions 1, 2, 3 and 5 are unchanged.
