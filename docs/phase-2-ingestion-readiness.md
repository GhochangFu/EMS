# Phase 2 Sprint 0 — Real Ingestion Readiness

Phase 2 Sprint 0 is a planning and decision sprint. It prepares the BMS
for real ingestion, but does **not** add EMQX, protocol adapters, or
live-device dependencies.

The sprint output will be a clear decision:

- **Path A — Real Access:** start Phase 2 Sprint 1 with one real source
  and one selected protocol.
- **Path B — No Real Access Yet:** pause real ingestion implementation and
  move to Phase 5 operations modules, or continue only with contract and
  mock-gateway planning.

Until Sprint 0 is completed, the simulator remains the active data source.
Real ingestion implementation resumes only when access to a real source is
available and documented.

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

Fill one row per possible source.

| Field | Notes |
|-------|-------|
| Source name | Vendor/system/device/gateway name. |
| Owner/contact | Person or team who can grant access. |
| Site/location | SMOC campus, station, plant room, rack, or building. |
| Candidate protocol | REST, MQTT, BACnet/IP, Modbus TCP, SNMP, OPC-UA, CSV/manual export. |
| Access status | Unknown, requested, approved, blocked, available. |
| Network path | Public IP, VPN, private subnet, jump host, or local-only. |
| Credentials | Where credentials will be stored; never paste secrets here. |
| Sample data available | Yes/no; link or filename if committed sample is safe. |
| Operational risk | Low/medium/high; include vendor restrictions. |

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

---

## 6. Decision Gate

At the end of Sprint 0, choose exactly one path.

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

If Path B is selected, do not add EMQX or protocol adapter implementation
while no real source is available. If ingestion preparation must continue
before real access exists, limit it to contracts and mock-gateway planning
while the simulator remains operational.

---

## 7. Exit Checklist

- [ ] Candidate source inventory completed.
- [ ] First-priority protocol selected or explicitly deferred.
- [ ] External-to-BMS mapping drafted.
- [ ] Source-health rules drafted.
- [ ] Security constraints documented without committing secrets.
- [ ] Path A or Path B selected.
- [ ] ADR drafted for the chosen next step.
