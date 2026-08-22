# Information & Decisions Requested — Enterprise AI Monitoring & Optimisation Foundry

**From:** Euphoria Infotech India Limited (Sector V, Kolkata)
**To:** Ion Exchange (India) Ltd., Bangalore
**Date:** 17 August 2026
**Reference:** Statement of Work — *Enterprise AI Monitoring & Optimisation Foundry*

---

## 1. Purpose of this document

We have converted the Statement of Work into a detailed, sequenced delivery
plan. The large majority of the platform can be built from the SOW as written,
and that work is under way.

This document lists **only the points where the SOW is deliberately open** and
where our assumption, if wrong, would cost significant rework. Each request is
tagged with the SOW clause it arises from.

**We have stated our current assumption wherever we hold one**, both inline with
each request and consolidated in **section 4**, so that nothing we are building
on is left unsaid. In most cases the fastest possible reply is simply
*"assumption confirmed"* — we are not asking Ion Exchange to design the
platform, only to settle the inputs that only you can settle.

## 2. How to respond

- Please use the accompanying **Response Form**, which lists every reference
  number below with space for the answer, an owner and a target date.
- **Partial replies are welcome and useful.** Please do not hold the whole set
  waiting for one answer.
- Where an item asks for a document, a redacted or anonymised copy is entirely
  acceptable.

## 3. If only four items can be answered

| Ref | Request | Why it is first |
|-----|---------|-----------------|
| **A1** | A tag list from any one plant | Unblocks the water-treatment template library, which is the single largest item currently waiting on input |
| **A2** | The boundary between your overlay and our foundation | Determines the design of the AI/analytics layer under SOW §4 |
| **A4** | Which protocol first, and the control-system details | Each protocol adapter is a substantial, non-transferable piece of work |
| **A5** | Deployment model, and access to a real device | Longest lead time in the engagement; until then all work is validated against a simulator |

---

## 4. Our current assumptions — please confirm or correct

Work is proceeding on the assumptions below. **They are listed here in full so
that none of them is silent.** Where an assumption is right, *"confirmed"* is a
complete answer and the fastest reply available to us — it is not a lesser one.

Where we have deliberately made **no** assumption, that is stated too, because
those items cannot be closed by us at all.

**▲ marks a proposed phasing rather than an assumption.** The SOW requires these
capabilities and we are not proposing to drop any of them — we are proposing an
order, so that phase 1 delivers working depth on a first site rather than a thin
version of everything. **These five need your explicit agreement**, not a silent
confirmation, and we would rather they were discussed than assumed.

| Ref | Our current assumption | If it is wrong |
|-----|------------------------|----------------|
| **A1** | In the absence of a real tag list, we are designing water templates by inference from the remote-monitoring packages IESL publishes. | The point catalogue describes instruments no real plant reports. |
| **A2** | We author the first water template pack; Ion Exchange owns and extends it thereafter. The AI models of §4.2–4.5 are **yours to supply and ours to serve** — we build the serving surface, not the models. | We build the wrong half of SOW §4. |
| **A3** | The first template set is **RO plants, cooling water / cooling towers, STPs and softeners**. ETP is *not* in it. | Six to eight weeks of template work aimed at the wrong plant type. |
| **A4** | Points are reachable over an IP network, and **no vendor-licensed driver, paid SDK or proprietary gateway** is required to read them. MQTT remains first because it is already live. | Licensing cost and lead time we have not planned for. |
| **A5 ▲** | SOW §11 requires cloud, on-premise and hybrid. **We propose building and proving one of the three in phase 1**, with the others following, and we need to know which. Who operates the phase-1 environment is an open commercial point, not something we have assumed. | Packaging, disaster recovery and edge buffering are all designed against the wrong target. |
| **A6 ▲** | SOW §11 requires a multi-tenant architecture and we are designing for it. **We propose that phase 1 is commissioned as a single tenant** — the model built, not yet exercised across customers — with the tenant defined as an Ion Exchange end customer. | A data-model change that is cheap now and expensive later. |
| **B7** | Templates name **which parameters to alarm on and what each one means**; the limit values are set per site at commissioning. | Templates are authored against limits that do not apply. |
| **B8** | Plants span **several** discharge routes, so templates ship no default limit values. | Limits authored against the wrong CPCB Schedule VI column. |
| **B9** | The platform's existing **Critical / Warning / Info** ladder is retained, with severity and priority treated as one axis. | Change to stored rules and to every alarm screen. |
| **B10** | The full thirteen-field alarm schema is built, but populated progressively — Ion Exchange supplies the engineering content over time. | A thirteen-field schema that nothing fills. |
| **B11** | **Email and in-app** notification first, with SMS and WhatsApp later, sent through our own service rather than a corporate gateway. | Rework of the notification path and its credentials. |
| **B12 ▲** | SOW §10 names CMMS, ERP, historians and data lakes as integration targets, and the framework supports them. **We propose that no such connector is built in phase 1** — work orders are managed inside the platform — because a connector is built against a specific product, and we do not yet know which products are present. B12 is the question that settles it. | A required integration discovered late. |
| **B13 ▲** | Single sign-on against your corporate identity provider, with **MFA enforced there** rather than by the platform. We implement every control SOW §12 lists; what we have **not** assumed into phase 1 is a **third-party certification audit** (ISO 27001, IEC 62443, SOC 2), which is a separate exercise with its own cost and calendar. If one is expected, we need to know now. | An unbudgeted certification effort, or an identity model that must be replaced. |
| **B14** | Tariffs, carbon factors and baselines are **configuration supplied by Ion Exchange**, not values we derive. Savings are measured against a commissioning benchmark. | Incorrect financial and CO₂ figures on an executive screen. |
| **B15 ▲** | SOW §4.3 names five input classes. **We propose the score is commissioned on live telemetry first**, with maintenance records, environmental factors and utilisation folded in as each source becomes available — the score is only as complete as its inputs, and four of the five are not ours to produce. We have also assumed **no historical data is available to backfill**, so models train from go-live onward. | Either a score narrower than §4.3 describes, or training data we did not know we had. |
| **B16** | **Two years** of raw telemetry is sufficient, and **there is no statutory reporting or real-time submission obligation** to SPCB, CPCB or your end customers. | Data already deleted when it is asked for; or an unbuilt statutory feed. |
| **C17** | The product names we have used (INDION FMR, NGPSTP, Eco MBR) are **researched, not verified**. | Wrong product names on an operator's screen. |
| **C18** | The **light palette** of the approved mockups is retained, and navigation stays grouped by function rather than by domain. | A theme and navigation change across every screen built to date. |
| **C19** | Executive Management, Plant Operations and Maintenance are the personas present at first deployment; the other three follow. | Dashboards built for a persona with no reviewer. |
| **C20** | Instrumentation **supply and installation sit on the project/procurement side**; our scope is integration with what is fitted. | A commercial gap discovered during delivery. |
| **C21** | **No assumption made.** Environments, acceptance criteria, training scope, support hours and warranty period need to be agreed rather than inferred — we have not priced or planned them. | These cannot be closed from our side at all. |
| **C22** | The hierarchy is organisation → site → plant → asset, and TRINETRA is presented as the platform with Ion Exchange branding alongside. | Seed data and header rework. |

---

## Part A — Required to proceed with work already committed

### A1. A tag list from one real plant
*SOW §4.1 Asset Templates; §3 Water Infrastructure*

**What we need:** a P&ID, an I/O schedule, or a SCADA/PLC tag export — from
**any one** plant, of **any** type.

**Why:** it settles three things at once that we can otherwise only assume —
your **naming conventions**, your **engineering units**, and above all **which
instruments are actually fitted** rather than theoretically available. SOW §3
lists ten water asset classes and §8 lists fifteen instrument types; one real
plant tells us which of those coexist in practice.

**Format:** any existing export. Redacted or anonymised is fine. A single plant
is sufficient — we are not asking for a survey.

### A2. The boundary between Ion Exchange's overlay and our foundation
*SOW §1, §2, §4, §14*

The SOW states that Euphoria provides the digital foundation and **Ion Exchange
overlays its proprietary engineering templates, AI models and optimisation
logic** (§14). We agree with that division. The SOW does not define the seam,
and it materially changes what we build under §4:

- **Asset templates (§4.1).** Do we provide a *template authoring surface* that
  your engineers populate, or do we author the template content — KPIs, alarm
  philosophies, health models, maintenance rules — to your specification?
  *Our current assumption: we author the first water pack; Ion Exchange owns and
  extends it thereafter.*
- **AI models (§4.2–4.5).** Anomaly detection, health scoring, forecasting and
  optimisation advisories — are these **yours to supply and ours to serve**, or
  ours to build? If yours, in what form (container image, Python package, or a
  hosted API we call), what input do they expect, and what do they return? We
  need the *interface*, not the model itself.
- **Optimisation logic (§4.5).** Pump sequencing, chiller and boiler
  optimisation, chemical dosing — engineering rules for us to implement, or
  models you provide?
- **May we see one worked example** of whatever you intend to overlay — one
  template or one model — even in draft form?

### A3. First plant type, first end-customer, first site
*SOW §3*

Our drafted first set of templates is **RO plants, cooling water / cooling
towers, sewage treatment plants and softeners**, chosen to match the
remote-monitoring packages Ion Exchange Services already offers.

- **A3a.** Your reference dashboards give **ETP** a dedicated navigation entry
  and a full process train, while reducing softeners and RO to a single node.
  **ETP is not in our drafted four.** Should it be, or are the reference screens
  illustrative rather than an indication of deployment order?
- **A3b.** SOW §3 refers to multiple industries. **Which industry and which
  end-customer** does the first deployment serve? If known: the **first physical
  site**, its plant type, and approximately how many assets.

### A4. Protocols and control systems — makes, models and versions
*SOW §10*

SOW §10 names OPC-UA, MQTT, Modbus, BACnet, IEC 60870 and REST, together with
PLC, SCADA, BMS, EMS and DCS integration. That is the correct list for a
platform, but it is not a build order — each protocol adapter is a substantial
piece of engineering in its own right and they are not interchangeable. We
currently run MQTT in a live pilot.

- Which protocol should we build **first**, and which second?
- For the systems in scope: **manufacturer, model and firmware/version** of the
  PLC / DCS / SCADA / gateway. "Modbus" alone is not enough to build against —
  we need the register map or the device manual.
- How many RTUs, gateways and sites are in phase 1?
- Are the points already exposed by an **existing SCADA system or historian**
  that we could read from, or do we connect to the devices directly?

### A5. Deployment model and network access
*SOW §11*

SOW §11 requires cloud, on-premise **and** hybrid deployment. For **phase 1** we
need to build for one:

- **Which model**, and **who operates it** — Euphoria, Ion Exchange IT, the end
  customer, or a third party?
- What network path will telemetry take out of the plant, and **who authorises
  it**? Is a VPN or site-to-site link required (§11, *Secure remote access*),
  and what is the process for obtaining one?
- **When can we be given access to a real device or a test bench?** Until then,
  every adapter is validated against a simulator. In our experience this is the
  longest lead-time item in an engagement of this shape.

### A6. Multi-tenancy — where does the tenant boundary lie?
*SOW §11*

SOW §11 requires a multi-tenant architecture, so the requirement itself is
settled. What we need is **what constitutes a tenant**:

- One platform serving **Ion Exchange's end customers**, each seeing only their
  own sites? Or one tenant per **Ion Exchange business unit**, with customers as
  sites beneath?
- Will an end customer's own staff hold logins, or only Ion Exchange personnel?
- Is multi-tenancy required **in phase 1**, or is phase 1 single-tenant with the
  model held in reserve?

We need the intent only; the architecture is ours to design.

---

## Part B — Required before the corresponding stage of build

### B7. Alarm setpoints — per site, or Ion Exchange standards?
*SOW §4.1*

Our current plan is that templates specify **which parameters to alarm on and
what each one means**, with the actual limit values set per site at
commissioning — on the understanding that most limits follow the individual
plant's design and its discharge consent. **If Ion Exchange applies standard
setpoints across plants, we would like to know before building rather than
after.**

### B8. For effluent and sewage plants — where does the treated water go?
*SOW §3*

Inland surface water · public sewer · land for irrigation · recycle and reuse.
CPCB Schedule VI limits differ substantially by discharge route — BOD is 30 mg/L
to inland surface water against 350 mg/L to a public sewer — so the route
determines which figures a given plant is actually held to. If your plants span
several routes, that is equally useful to know.

### B9. Alarm severity ladder
*SOW §5*

Your reference dashboards use **Critical / High / Warning**. The platform
currently ships **Critical / Warning / Info** — there is no *High*. Which ladder
would you like, and what is the operational definition of each level?

SOW §5 also lists *severity classification* and *priority level* as separate
fields — are these genuinely two axes in your practice, or one?

### B10. Alarm enrichment — which fields matter first, and who supplies them?
*SOW §5*

SOW §5 lists thirteen fields per alarm, including probable root cause, impact
assessment, estimated energy / water / production impact, estimated resolution
time and skill requirements. We will build the schema and the operator-facing
panel; **the content is engineering domain knowledge, which §14 places on the
Ion Exchange side.**

- Which of the thirteen are **essential for phase 1**, and which can follow?
- For the water asset classes, does a root-cause or corrective-action knowledge
  base already exist in any form — SOPs, troubleshooting guides, service
  checklists — that we could work from rather than author from scratch?

### B11. Notifications, escalation and service levels
*SOW §5, §6*

- Which channels: **email, SMS, WhatsApp, in-app**? Is there a corporate gateway
  we are required to use, and who owns those credentials?
- Who receives what — by role, by site, by severity? Is there an existing
  **escalation matrix** we should encode rather than invent?
- Your reference screens show **"SLA 30 mins"** and **"SLA 1h"** against work
  orders. Are these your actual response targets, and do they vary by severity,
  by plant type, or contractually by end customer?
- SOW §6 requires **closure approval** — who approves, and is it one level or
  two?

### B12. Enterprise systems we must integrate with
*SOW §6, §10*

SOW §10 names ERP, CMMS, historians, data lakes and third-party applications.
Which of these **actually exist** in the phase-1 environment?

- **CMMS / EAM** (SAP PM, Maximo, in-house)? If one exists, does the platform
  feed it or replace it? §6 says "where required" — is it required here?
- **ERP, historian or data lake** that should receive exports — which product,
  and should the flow be push or pull?
- Who owns those systems, and is there an integration contact?

### B13. Security, identity and compliance
*SOW §12*

SOW §12 requires RBAC, SSO, MFA, encryption at rest and in transit, audit
logging, and *"compliance with applicable cybersecurity standards"*.

- **Single sign-on against which identity provider** — Azure AD / Entra, on-prem
  Active Directory, Okta, or platform-local accounts for phase 1?
- **MFA** — enforced by your identity provider (its natural home if SSO is
  used), or expected from the platform itself?
- **Which standards does "applicable" mean in practice** — ISO 27001,
  IEC 62443, SOC 2, an internal Ion Exchange policy, or an end-customer
  requirement? This is the one clause in §12 we cannot scope as written. **If a
  security questionnaire or policy document exists, sharing it answers this
  faster than a discussion.**
- Who defines the **user roles**, and does an approved role list already exist?

### B14. The figures behind sustainability reporting
*SOW §7*

SOW §7 requires energy, water and chemical savings, carbon reduction, wastewater
recovery, efficiency and cost optimisation. A saving is measured against
something, and that something cannot be invented:

- **Energy tariff (₹/kWh)** and **water / effluent cost (₹/kL)** — flat, slab or
  time-of-day? Do they vary by site?
- **Carbon factors** — a standard grid emission factor, or a customer-specific
  one?
- **Baselines** — is a saving measured against last year, design specification,
  or a commissioning benchmark?
- Your reference dashboard promotes **Water Recycle %** and **Operational
  Efficiency %** to top-level KPIs. **Please define each one — numerator and
  denominator.** We would rather ask than assume a formula that appears on an
  executive screen.

### B15. Inputs to the Asset Health Score
*SOW §4.3*

SOW §4.3 states that the health score evaluates operational conditions,
**historical performance, maintenance records, environmental factors and
equipment utilisation**. Live telemetry we will have; the remainder we will not,
unless:

- **Maintenance records** — do these exist digitally today, and in which system?
  (Related to B12.)
- **Environmental factors** — from site instrumentation, or an external weather
  source?
- Is there **historical telemetry** we can backfill from, or does the record
  begin on the day we connect? This determines whether models can be trained at
  go-live or only after a season of operation.

### B16. Data retention and statutory reporting

The platform currently retains **raw telemetry for two years**, with hourly and
daily aggregates kept indefinitely.

- Does two years of raw data meet your obligations, or is a longer period
  required?
- Is there any **statutory reporting or real-time data submission** — to SPCB or
  CPCB, or to your end customers — that the platform is expected to produce or
  feed? If so, in what format and on what schedule? **We have assumed none**, as
  the SOW does not refer to it.

---

## Part C — Presentation, naming and delivery logistics

### C17. Internal product naming
*SOW §3, §4.1*

We would prefer to use Ion Exchange's own product names rather than generic ones
on an operator's screen. We have seen **INDION FMR**, **NGPSTP** and **Eco MBR**
referenced for packaged sewage treatment; we are less certain on the RO, DM and
softener side. Please confirm or correct these, including how you would like
them written in a customer-facing screen.

### C18. The reference dashboards — requirement or illustration?
*SOW pp. 9–10*

- **C18a.** The reference screens are **dark-canvas with neon accents**; the
  approved mockups and every screen built to date are light. **Is the dark
  treatment a requirement, or is the layout the point being made?**
- **C18b.** The reference sidebar carries **one entry per domain** (Electrical ·
  Water · STP · ETP · HVAC · Alarms · Work Orders · Assets · Analytics ·
  Reports · Sustainability); ours groups by function. **Is per-domain navigation
  what your operators expect?** If so, are **STP and ETP** plant types *within*
  Water, or top-level peers of Electrical?
- **C18c.** The reference sidebar footer reads **"Data Quality 98.6% Good"**.
  What would you want that figure to represent — sensor freshness, ingest
  completeness, or a measure you already report?

### C19. Stakeholder dashboards and their reviewers
*SOW §9*

SOW §9 names six stakeholder groups — Executive Management, Plant Operations,
Maintenance, Sustainability, Utility Managers and Facility Managers. Which exist
at the first deployment, **who is the named reviewer for each**, and is there a
preferred default landing screen per role?

### C20. Instrumentation — supply or integration?
*SOW §8*

SOW §8 states that the Vendor *"shall support integration and deployment"* of
fifteen instrument and gateway types. We read this as **integration scope, with
supply and physical installation on the project/procurement side.** Please
confirm — and in either case we require the **fitment schedule**, since nothing
can be tested against a real plant until the instruments are in place.

### C21. Delivery logistics
*SOW §13*

SOW §13 covers documentation, training and post-deployment support without
detail. To plan them:

- **C21a. Environments** — are separate development, UAT and production
  environments required, and who hosts each?
- **C21b. Acceptance** — what is the UAT process, who signs off, and against
  what criteria? Should a phase-1 scope freeze be recorded?
- **C21c. Training** — which audiences (operators, maintenance, administrators,
  and the Ion Exchange engineering team building templates on top), in what
  format, and for how many people?
- **C21d. Support** — expected response and uptime commitments, support hours,
  and warranty period following go-live.
- **C21e.** A **named single point of contact** with authority over the above,
  and a **UAT owner** on the Ion Exchange side.
- **C21f.** A **date for the next review**.

### C22. Sites and branding

- **C22a.** The **site list and hierarchy** for phase 1 (organisation → site →
  plant → asset), even provisionally.
- **C22b. Brand assets** — logo, colours, and how TRINETRA and Ion Exchange are
  to be presented together in the application header and on reports.

---

## 5. What happens next

1. Ion Exchange returns the **Response Form** — partially is fine, and the four
   items in section 3 first. Section 4's assumptions can be confirmed as a block.
2. We confirm in writing what each answer changes in the delivery plan, and
   re-issue the plan where an answer moves it.
3. Any item still open at the next review **stays in section 4 as a stated
   assumption**, carried forward with a date, so that it remains visible rather
   than becoming silent.

*Prepared by Euphoria Infotech India Limited. Questions on this document may be
directed to the Euphoria project lead.*
