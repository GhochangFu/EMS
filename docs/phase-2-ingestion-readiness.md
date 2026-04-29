# Phase 2 Sprint 0 — Real Ingestion Readiness

Phase 2 Sprint 0 was a planning and decision sprint. It prepared the BMS
for real ingestion, but did **not** add EMQX, protocol adapters, or
live-device dependencies.

The sprint decision is:

- **Selected now: Path B — No Real Access Yet.** No real device, gateway,
  broker, API, file export, protocol details, credentials, network route,
  or sample payload/register/object list is currently available.
- **Deferred: Path A — Real Access.** Start Phase 2 Sprint 1 only when one
  real source and one selected protocol are confirmed.

While Path B is selected, the simulator remains the active data source.
The next implementation phase is Phase 5 operations modules. Real
ingestion resumes when access to a real source is available and
documented.

---

## 1. Sprint Rules

- Keep the simulator as the current operational data source.
- Do not add BACnet, Modbus, SNMP, OPC-UA, MQTT, REST poller, or EMQX
  implementation code during Sprint 0.
- Do not add new runtime dependencies unless an ADR first proves they are
  needed for the readiness work itself.
- Prefer documentation, source inventory, data contracts, and decision
  records over speculative infrastructure.
- Treat credentials, IP addresses, VPN details, and vendor documents as
  sensitive. Do not commit secrets.

---

## 2. Candidate Source Inventory

Current status: no real source has been confirmed yet. The rows below are
candidate classes to validate with the site/vendor team when access
discussions resume.

| Source name | Candidate protocol | Current access status | Required next evidence |
|-------------|--------------------|-----------------------|------------------------|
| Vendor/system API | REST poller | Unknown | Base URL, auth method, sample response, rate limit, source owner. |
| Existing broker/topic source | MQTT | Unknown | Broker URL, TLS/auth requirement, topic list, sample payload, owner. |
| BMS controls network | BACnet/IP | Unknown | Reachable device IPs, object list, BBMD/foreign device requirement, owner approval. |
| Meter/controller network | Modbus TCP | Unknown | Host, port, unit ID, register map, byte order, owner approval. |
| UPS/network/HVAC equipment | SNMP | Unknown | Device list, SNMP version, MIB/OID list, credential handling, owner approval. |
| Industrial/SCADA gateway | OPC-UA | Unknown | Endpoint URL, security policy, namespace/node list, certificate process. |
| Manual/vendor export | CSV/manual export | Unknown | File owner, export cadence, sample file, column definitions. |

Do not move a source to "available" until all required evidence is present
and safe credential handling is agreed.

---

## 2.1 Current System Ingestion Baseline

The current system has a simulator-first ingestion path:

1. `apps/sim` loads existing rows from `bms.assets`.
2. It generates telemetry for assets by `domain`:
   - `electrical` assets use electrical point keys.
   - `hvac` assets use CRAC/cooling point keys.
3. It inserts rows into `telemetry.point_values`.
4. It emits `pg_notify('bms_telemetry', ...)`.
5. The API listens to `bms_telemetry` and broadcasts readings over
   Socket.IO.
6. Alarm threshold rules evaluate the latest in-process telemetry batch
   and create rows in `bms.alarms`.

Current canonical telemetry row shape:

| Field | Current meaning |
|-------|-----------------|
| `time` | Timestamp of the sample. |
| `asset_id` | Existing `bms.assets.id`. |
| `point_key` | Logical point name such as `kw` or `supply_air_temp_c`. |
| `value` | Numeric value. |
| `unit` | Optional unit string. |

Current point keys written by the simulator:

| Domain | Point keys |
|--------|------------|
| Electrical | `voltage_l1_v`, `current_a`, `kw`, `kvar`, `pf`, `breaker_main` |
| HVAC | `supply_air_temp_c`, `return_air_temp_c`, `fan_rpm`, `fan_speed_pct`, `chw_flow_lps`, `chw_supply_temp_c`, `chw_return_temp_c`, `compressor_ok`, `cooling_kw` |

Sprint 0 implication: a future adapter must either map real points into
these existing keys or propose a controlled point-key extension.

---

## 2.2 Known Gaps Before Real Ingestion

The current schema does not yet model:

- Gateway/source identity.
- External device identity separate from `bms.assets`.
- External point identifiers.
- Source quality/status.
- Source timestamp versus ingest timestamp.
- Per-source health, last success, and last error.
- Adapter ownership of writes versus simulator ownership of writes.

Sprint 0 should decide whether these become schema changes in the first
real ingestion sprint or remain implementation metadata until a real source
proves they are needed.

---

## 3. Protocol Readiness Questions

### REST Poller

- What base URL and endpoint paths are available?
- Is authentication API key, OAuth/OIDC, basic auth, or vendor-specific?
- What is the rate limit?
- Are timestamps source-generated or server-generated?
- Does the API return current values, historical values, alarms, or all
  of them?

### MQTT

- Is there an existing broker, or would BMS need to host one later?
- What are the topic patterns?
- Is TLS required?
- Are messages retained?
- What payload format is used: JSON, Sparkplug B, binary, or custom?

### BACnet/IP

- Which device IPs and network numbers are reachable?
- Is BBMD or foreign device registration needed?
- What object list and property IDs are available?
- What polling interval is acceptable to the controls network owner?

### Modbus TCP

- Which host, port, unit ID, and register map are available?
- Which data types and byte/word order are used?
- Which registers are read-only telemetry versus command-capable?
- What polling interval is acceptable?

### SNMP

- Which devices expose SNMP?
- Which version is enabled: v2c or v3?
- Which MIBs/OIDs are required?
- Are traps needed later, or only polling?

### OPC-UA

- What endpoint URL and security policy are available?
- Is certificate exchange required?
- Which namespace and node IDs represent the points?
- Is subscription supported, or must BMS poll?

### CSV / Manual Export

- Who produces the file?
- How often is it exported?
- What columns are present?
- Is this only a temporary data-validation path?

---

## 4. Mapping Plan

Each external point must be mapped before implementation.

| External concept | BMS mapping question |
|------------------|----------------------|
| Gateway/source | Does this map to a future `bms.gateways` row or only metadata for now? |
| Device | Which existing `bms.assets` row owns this point? |
| Point ID | What internal telemetry point name should it become? |
| Unit | Does the value need unit normalization before storage? |
| Timestamp | Use source timestamp, ingest timestamp, or both later? |
| Quality/status | How are stale, offline, bad quality, and uncertain values represented? |
| Alarm | Is this raw telemetry only, or should it create/clear alarms? |

### Initial Mapping Rules

- Every real point must map to exactly one current or proposed
  `point_key`.
- Every real point must map to one existing or newly seeded `bms.assets`
  row.
- Units must be normalized before writing to `telemetry.point_values`.
- Boolean/status values should be numeric only when the point meaning is
  explicit, e.g. `breaker_main` uses `1` for closed/on and `0` for
  open/off.
- Real ingestion should preserve source identity somewhere before multiple
  sources can write the same asset/point.
- Alarm behavior must be declared per point: telemetry-only, threshold
  rule, source-provided alarm, or future command/state signal.

### Open Mapping Questions

- Should Phase 2 Sprint 1 add `bms.gateways` and `bms.gateway_devices`, or
  wait until a real source requires it?
- Should `telemetry.point_values` gain `source_id`, `quality`, or
  `ingest_time`, or should those be stored in a separate ingestion-health
  table first?
- Should simulator and real data be able to write the same asset/point, or
  should real-enabled assets disable simulator output?
- How should stale real-source data appear in the dashboard, SLD, CRAC,
  map, and alarm centre?

---

## 5. Source Health Rules

Define these before the first adapter is written:

- **Last success time:** latest successful poll/message per source.
- **Last error:** sanitized error category, not full secret-bearing
  payloads.
- **Stale threshold:** how long before the UI should mark a source stale.
- **Backoff behavior:** retry cadence when a source is unavailable.
- **Data quality:** accepted values for good, bad, uncertain, and missing.
- **Observability:** Prometheus counters/gauges needed for Sprint 1.

### Proposed Health Signals For Sprint 1

These are planning targets only; do not implement them during Sprint 0.

| Signal | Purpose |
|--------|---------|
| `source_up` | Whether the source is currently reachable. |
| `last_success_at` | Last successful poll/message/process time. |
| `last_error_at` | Last failed poll/message/process time. |
| `last_error_code` | Sanitized failure category without secrets. |
| `points_ingested_total` | Count of accepted telemetry points. |
| `points_rejected_total` | Count of rejected telemetry points. |
| `source_stale` | Whether the source exceeded its stale threshold. |

### Proposed Stale Threshold Defaults

| Source type | Initial stale threshold |
|-------------|-------------------------|
| REST poller | 3x configured poll interval. |
| MQTT subscriber | 3x expected message interval, or 5 minutes if unknown. |
| BACnet/IP | 3x configured poll interval. |
| Modbus TCP | 3x configured poll interval. |
| SNMP | 3x configured poll interval. |
| OPC-UA subscription | 3x expected publish interval. |
| CSV/manual export | 2x expected export cadence. |

---

## 6. Decision Gate

Sprint 0 selected exactly one path for now.

### Path A — Real Access

Use this path only if all are true:

- A source is reachable from the deployment environment.
- Credentials or test access are approved.
- Sample payloads/registers/object lists are available.
- The source owner agrees to the proposed poll/message frequency.
- A first protocol can be selected without guessing.

Next sprint: **Phase 2 Sprint 1 — First Real Ingestion Path**.

### Path B — No Real Access Yet

Use this path if any blocker remains:

- No reachable device, gateway, broker, API, or export.
- No credentials or network route.
- No sample payload/register/object list.
- Vendor restrictions are not clear.

Current decision: **Path B selected for now.** Do not add EMQX or protocol
adapter implementation while no real source is available. If ingestion
preparation must continue before real access exists, limit it to contracts
and mock-gateway planning while the simulator remains operational.

---

## 7. Exit Checklist

- [x] Candidate source inventory completed with current status: no real
  source available.
- [x] First-priority protocol explicitly deferred because no real source is
  available.
- [x] Current ingestion baseline documented.
- [x] External-to-BMS mapping questions drafted.
- [x] Source-health rules drafted.
- [x] Security constraints documented without committing secrets.
- [x] Path B selected for now.
- [x] ADR drafted for the chosen next step.

---

## 8. Information Needed From The User / Site Team

Answer these before Sprint 0 can close:

1. Is there any real device, gateway, broker, API, or file export we are
   allowed to access?
2. Who owns that source and can approve connection/testing?
3. What protocol or export format is available first?
4. Where will BMS run when connecting to it: laptop, Windows VM, site VM,
   VPN, or private network?
5. Are credentials available, and where should they be stored securely?
6. Is a safe sample payload/register/object/OID/node list available?
7. What poll/message rate is allowed by the source owner?
8. Are values read-only telemetry, source-provided alarms, or
   command-capable points?
9. Which current BMS asset/site should the source map to?
10. Are there vendor restrictions on polling, storing, or displaying the
    data?
