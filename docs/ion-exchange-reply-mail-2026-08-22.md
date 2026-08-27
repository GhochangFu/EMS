# Draft reply mail — IONSiTE NEXUS (2026-08-22)

> **Status: DRAFT — not sent.** For review before sending. Attachments
> referenced: the updated question form
> (`ion-exchange-response-form-2026-08-22.md` / CSV export), the derived
> tag list (`e5.1-derived-taglist-v1.md`), and the architecture one-pager
> (to be produced for the workshop).

---

**Subject:** IONSiTE NEXUS — feature mapping, delivery view, and the workshop

Dear [name],

Thank you for the feature list and for the IONSiTE NEXUS framing. We have
mapped all fifteen feature areas against the platform, and the fit is strong:
**eleven of the fifteen are either live today or already in the current build
plan.** The four that are new to the plan — scheduled sFTP/file ingestion, the
eLogBook functions, the configurable plant/network mimic builder, and
DeviceNet connectivity — have been added to it this week.

**On the standardized, scalable offering:** we agree, and the platform is
built that way. Asset types are templates (model once, deploy many), KPIs and
calculations are configurable rather than coded per site, and the portal is
being designed multi-tenant. The commonality you saw across the use cases is
the product.

## What we can deliver, on your timeline

**Available now** — running today and demonstrable at the workshop:

- Live IoT ingestion over MQTT (TLS), with a pluggable adapter framework for further protocols
- Asset templates with a no-code authoring studio: points, KPIs, alarm rules, calculation formulas
- Streaming calculation engine for derived tags and configurable KPIs
- Alarm engine with severity, acknowledgement, and an enrichment schema (root cause, impact, corrective action, skill, ETR)
- Manual data entry and Excel/CSV bulk import for offline data
- Operations dashboards and live process diagrams; work orders and maintenance
- Role-based access with site- and asset-group-level scoping; full audit trail
- Two-year telemetry store with hourly/daily rollups; documented REST API

**By one month:**

- Notification service (email + webhook first) with escalation and distribution lists
- Self-service dashboard builder (KPI cards, gauges, trends, comparisons)
- Tag-mapping bulk editor with an Excel mapping sheet; scheduled sFTP/file ingestion
- The **water-treatment template pack ready to start authoring**. We
  understand the plant tag lists follow once the agreement completes, so we
  have not waited: attached is a **derived tag list** for six plant types —
  STP, ETP, cooling tower, WTP, RO and softener, ~100 points — built from
  industry practice, your reference dashboards and IESL's published
  monitoring packages. We propose authoring in that order (your own documents
  emphasize STP, ETP, cooling tower and WTP); re-ordering costs nothing —
  tell us at the workshop. **What we ask now is an hour's redline, not a tag
  export**: strike what is not fitted, add what is missing. Templates are
  versioned, so the confirmed list simply publishes as version 2 later.
- The architecture pack for the four layers (below), presented at the workshop

**By three months:**

- Water-treatment and mechanical/HVAC template packs live (STP, ETP, RO, cooling water, chillers, pumps, compressors)
- The AI serving layer: your algorithms plugged in over REST, plus the health score with your roll-up formula and pre-threshold anomaly alerts
- The first field protocol adapter (Modbus / OPC-UA / BACnet — whichever the workshop names first) validated against your named devices
- Mobile experience for dashboards, alarms, approvals and field data entry
- AI-assisted onboarding: templates and tag mapping set up conversationally
- First cut of the configurable plant mimic builder
- Multi-tenant commissioning model in place

**By six months:**

- Second and third protocol adapters; edge gateway software with store-and-forward and offline buffering
- Forecasting and optimisation advisories (serving your models); sustainability/ESG module with your tariffs, factors and baselines
- ERP/CMMS export connectors where the workshop names a system
- Production hardening for scale and high availability; the facility/smart-building pack

Two inputs keep these dates honest, and both are workshop-sized: **an hour's
redline of the attached tag list** (it converts the water pack from derived to
confirmed) and **the protocol and device details** (they start the adapters).
Everything in "available now" and most of month one depends on neither.

## Architecture

Your four layers map directly onto the platform as built: **Data Connect**
(edge gateway + protocol adapters + file/manual ingestion), **Data
Management** (time-series store, asset model, templates, tag
contextualization), **Analytics / AI Library** (calculation engine, rules,
KPI library, and the REST plug-in surface for IEIL algorithms), and
**Visualization** (the web portal, dashboards, mimics, and mobile). We will
bring the architecture pack for all four layers — including the EDGE and
multi-tenant cloud topology — to the workshop.

## Workshop

We welcome Partha and Rohit, and we suggest using the sessions to close the
small set of inputs that unlock the fastest deliveries. We attach an updated
question form, now in two parts: **Part 1 lists the positions we have adopted
from industry standards and are already proceeding on** — object where we
guessed wrong, silence is consent; **Part 2 is the short list only Ion
Exchange can answer.** Points your reply already settled are marked closed
and not asked again. The form ends with a **bring-list**; if the redlined tag
list and one device manual are in the room, the water pack and the first
adapter both start the same week. Please propose two or three dates that suit
them.

## Offering and pricing

We agree it is time to shape the offering and back-to-back pricing informally
so NEXUS promotion can move. We suggest the workshop's closing session for
this, with the commercial leads from both sides present — please tell us who
joins from yours.

Could you also name a single working-level point of contact and a date for
the next review? Those two fields, more than any technical answer, are what
keep the timeline above real.

Best regards,

[sender]
Euphoria Infotech India Ltd.

---
*Attachments: IONSiTE NEXUS — open points (response form, 2026-08-22) · Derived tag list v1 (six plant types, for redline) · Architecture one-pager (workshop)*
