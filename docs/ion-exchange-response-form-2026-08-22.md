# IONSiTE NEXUS — open points after your 2026-08-22 reply

**Purpose.** Your reply and the feature sheet settled several points from our
2026-08-17 set. This document now does two different things, and it is split
accordingly:

- **Part 1 — we proceed as follows unless you object.** Points where global
  industry practice gives a defensible default. We have adopted the stated
  position and work continues on it. Silence is consent; an objection at the
  workshop costs little to absorb.
- **Part 2 — we need you.** Points no standard can answer: facts about your
  plants, your systems, and your commercial choices. Each needs an **owner
  and a date** — those two fields, more than the answer itself, are the
  deliverable.

Rows marked ⚑ need a commercial voice, not only an engineer. Closed items are
listed at the end so nothing is asked twice.

**If only three things come out of the workshop, make them the A1 redline,
A4 and A6.**

---

## Part 1 — we proceed as follows unless you object

| Ref | Position we have adopted | Standard it stands on |
|---|---|---|
| **A2** (residual) | The AI serving surface is built **both-direction capable**: we can call your hosted model over REST, and we can accept scores you push back. One path gets deprecated once you confirm the direction. | Standard model-serving practice (synchronous scoring + asynchronous ingest) |
| **A3a** | **Template authoring order: 1. STP · 2. ETP · 3. Cooling tower · 4. WTP · 5. RO · 6. Softener.** Derived from your own signals: your reference dashboards give STP and ETP dedicated navigation and full process trains; your feature sheet names WTP, STP and cooling tower and does not mention RO or softeners. All six catalogs are drafted (see the attached derived tag list), so re-ordering costs nothing — one sentence at the workshop re-sequences it. | Your reference dashboards (SOW pp. 9–10) + feature sheet row 4 |
| **B7** | Alarm limit values are set **per site at commissioning**; templates carry the parameter and its meaning. | ISA-18.2 — alarm limits are site- and consent-specific |
| **B8** | Templates ship **no default discharge limits**; the CPCB Schedule VI column is chosen per site by its discharge route. | CPCB Schedule VI is published per route |
| **B9** | Severity ladder stays **Critical / Warning / Info**. Adding a "High" level later is a vocabulary insert, not a rebuild. | ISA-18.2 recommends 3–4 priorities |
| **B10** | Phase-1 alarm enrichment: **probable cause, corrective action, impact** first; the remaining fields populate progressively as your engineering content arrives. | ISA-18.2 alarm rationalization |
| **B11** | Notifications: **email + in-app first** via our service; SMS/WhatsApp follow; a standard three-tier escalation template until your matrix arrives. | Universal industry default |
| **B13** | **OIDC-standard SSO** (works with Entra ID, Okta, on-prem AD federation), MFA enforced at the identity provider, controls aligned to ISO 27001 / IEC 62443, OWASP ASVS L2. A third-party certification audit remains a separate, jointly-scoped exercise. | ISO 27001 · IEC 62443 · OWASP ASVS |
| **B14** | Carbon: **India CEA grid emission factor** as the default; tariffs and water costs are per-site configuration. We will draft **Water Recycle %** and **Operational Efficiency %** definitions **for your sign-off** — they appear on executive screens, so the sign-off is required, only the drafting is ours. | CEA baseline database; standard water-balance definitions |
| **B16** | **2-year raw telemetry + indefinite rollups**; no statutory or real-time submission until one is named. | Exceeds common practice; CPCB OCEMS applies to mandated categories only |
| **C17** | Generic plant-class names on screen now; your product names (INDION FMR, NGPSTP, Eco MBR …) are a display-name lookup swapped in when confirmed. | — |
| **C18** | Light palette and function-grouped navigation retained; the reference dashboards read as layout guidance. Tell us if the dark canvas or per-domain navigation is a **requirement** and we will treat it as one. | Our approved mockups |
| **C19** | First personas: **Executive, Plant Operations, Maintenance**; the other three follow. | The standard first trio in EMS deployments |
| **N2** | Mimics are **assembled from a widget/diagram library** (the Ignition / WinCC symbol-library model), not free-form drawing. A drawing surface can follow as a superset if needed. | How every major SCADA/HMI product does it |
| **N3** | Roll-up hierarchy is built **level-agnostic**: asset → subsystem (asset groups) → site → campus/township (optional tier) → enterprise. Tiers activate as data, not as code changes. | ISA-95 equipment hierarchy is variable-depth by design |
| **N4** | We author **KPI library v1** ourselves — chiller kW/TR and COP, cooling-tower approach/range, RO recovery and specific energy, kWh/KL, availability — and you review it, replacing any definition with your own. | ASHRAE + water-industry standard KPIs |

## Part 2 — we need you

| Ref | What we need | Why only you can answer | Owner | Date |
|---|---|---|---|---|
| **A1** | **Redline the attached derived tag list** (six plant types, ~100 points): strike what is not fitted, add what is missing, correct names. An hour of markup replaces the tag export — the full export can follow after the agreement completes, as you indicated. | Which instruments are actually fitted is a fact about your plants | | |
| **A3b** | **The first site**: end-customer, industry, plant type, rough asset count. | Which customer relationship carries the pilot is your commercial choice | | |
| **A4** | **Protocols and devices**: first and second protocol; PLC/DCS/SCADA make, model, firmware; register map or device manual; RTU/site count; can we read from an existing SCADA or historian? The sheet adds **DeviceNet** — which device speaks it, and how urgent? | Physical facts; an adapter cannot be built against a guess. The largest open item on the plan. | | |
| **A5** | Cloud + edge accepted. Still open: **who operates the cloud; the network path out of the plant and who authorises it; the VPN process; the date we get a real device or test bench.** | Your IT authority starts this clock; it is the longest lead-time item | | |
| **A6** | **What is a tenant**: one per end-customer, or per business unit? Do end-customer staff get logins in phase 1? | Your business model — and the fork in our data model | | |
| **B12** | Which of CMMS/EAM, ERP, historian, data lake **actually exist** in the phase-1 environment — product, direction, owner, contact. | Facts about your environment | | |
| **C20** ⚑ | Edge gateway in the deliverable — accepted. **Field instrumentation** (the fifteen §8 types): confirm supply and installation stay on the project side, and share the fitment schedule. | Commercial boundary | | |
| **C21** ⚑ | Environments and hosting; UAT process and sign-off; training audiences and headcount; support hours and warranty; **a named single point of contact; the next review date.** Are Partha and Rohit the working-level contacts going forward? | Organizational commitments | | |
| **C22** | Phase-1 **site list**; **brand assets for IONSiTE NEXUS** (logo, colours) and how NEXUS, TRINETRA and Ion Exchange co-present on screen and reports. | The rename needs the brand call made once, early | | |
| **N1** | **eLogBook** (sheet row 3): what should it do — shift logs, operator rounds, e-signatures? An example or screenshot. | Named with no definition; we will not invent it | | |
| **N5** | **Chiller health** (rows 4/9): one of the IEIL-scope algorithms, or ours to build? | The A2 boundary applied to the one named analytic | | |
| **N6** ⚑ | **Workshop**: two or three candidate dates, attendees, agenda agreement. **Commercial**: who joins the informal offering / back-to-back pricing session from your side? | Calendar and commercial — only yours | | |

---

## Workshop bring-list (closes Part 2's core in one sitting)

1. **The redlined tag list** — or an hour in the room doing it together (closes A1 v1; starts the water pack that week).
2. **One device's details**: PLC/DCS make, model, firmware, register map or manual (closes A4; starts the first adapter).
3. The **first site's name, plant type and asset count** (closes A3b).
4. A **sample mimic** and any **KPI definitions in use** (validates N2, N4).
5. The name of **who operates the phase-1 cloud** and how a VPN gets approved (closes A5).

## Already clarified by your reply — not asked again

- **AI boundary** (A2): your algorithms, our serving — confirmed; only call direction remains, and Part 1 hedges it.
- **Phase-1 deployment** (A5): cloud + edge — confirmed.
- **Health-score inputs** (old B15): superseded — your formula (in-range ÷ total points, weighted roll-up, bad-actor list) is adopted as the go-live definition.
- **Edge gateway as deliverable** (C20): accepted; only the instrumentation half remains open.
- **Plant-type emphasis** (A3a): read from your sheet and reference dashboards; adopted as the Part 1 authoring order.
- **Self-service configuration, KPI library location, alerting model**: your sheet confirms the platform direction already built or in plan.
