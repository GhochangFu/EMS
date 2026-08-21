# Ion Exchange — what we need from you (meeting, 2026-08-17)

**Purpose.** We have turned the SOW
([`sow-enterprise-ems-euphoria-infotech.pdf`](./sow-enterprise-ems-euphoria-infotech.pdf))
into a costed, sequenced backlog ([`BACKLOG.md`](./BACKLOG.md)). Most of it we
can build without asking you anything. This document lists **only the points
where the SOW is deliberately open and a wrong guess costs real time** — each
one anchored to the clause it comes from.

**How to use it.** **Parts A, B and C are the asks and may be read out or handed
over.** The **internal annex** at the end is not: it records what each answer
decides on our side, including two places where an answer forces us to reopen an
accepted design decision. A/B/C are urgency tiers over one continuous A1→C22
list, not separate documents.

**If only four things come out of today, make them A1, A2, A4 and A5.**
A4 is the largest single unknown on the board; A2 decides the shape of a whole
clause of the SOW, which is why it sits above it.

**⚑ marks an ask that needs a commercial voice in the room, not only an
engineer** — A2, C20 and C21.

**Status of the previous ask.** Five questions were sent on 2026-08-09 and are
still unanswered ([`e5.1-client-questions.md`](./e5.1-client-questions.md)).
A1, A3, B7, B8 and C17 below are those five, restated against the SOW. Nothing
has overtaken them; the reference dashboards on pp. 9–10 narrowed two and closed
none.

**Capture four fields for every item you get an answer to** — the answer is not
the deliverable, the commitment is:

| # | Artifact / decision | Owner (named person) | By when | Acceptable format |
|---|---|---|---|---|
| | | | | |

---

## Part A — needed to start work already committed to

### A1. One real plant's tag list — *SOW §4.1 (Asset Templates), §3 (Water Infrastructure)*

**What we need:** a P&ID, an I/O schedule, or a SCADA/PLC tag export — from
**any one** plant, of **any** type. Redacted or anonymised is fine.

**Why it beats every other answer:** it settles three things at once that we can
otherwise only assume — your **naming conventions**, your **units**, and above
all **which instruments are actually fitted** rather than theoretically
available. §3 lists ten water asset classes and §8 lists fifteen instrument
types; one real plant tells us which of those coexist in practice.

**What it unblocks:** the water-treatment template pack — the flagship item and
the subject of the target demo. It is the only committed P0 on the board waiting
on you rather than on us.

### A2. ⚑ The overlay boundary — who builds what — *SOW §1, §2, §4, §14*

The SOW is explicit that **Euphoria provides the digital foundation and Ion
Exchange overlays its proprietary engineering templates, AI models and
optimisation logic** (§14; also §1 and §2's closing line). That division is the
right one — but nothing in the document defines the seam, and it changes what we
build under §4 substantially. Specifically:

- **Asset templates (§4.1).** Do we ship a *template authoring surface* that your
  engineers populate, or do we author the template content — KPIs, alarm
  philosophies, health models, maintenance rules — from your specifications?
  Our current plan assumes **we author the first water pack, you own it
  thereafter**. Please confirm or correct.
- **AI models (§4.2–4.5).** Anomaly detection, health scoring, forecasting and
  optimisation advisories — are these **yours to supply and ours to serve**, or
  ours to build? If yours: in what form (container image, Python package, or a
  hosted API we call), what do they expect as input, and what do they return?
  We need the *interface*, not the model.
- **Optimisation logic (§4.5).** Pump sequencing, chiller and boiler
  optimisation, dosing — is this expressed as engineering rules we implement, or
  as models you provide?
- **When can we see one worked example** of whatever you intend to overlay —
  one template, or one model — even in draft?

**Why it is second only to A1:** the model-serving foundation is one of the
largest pieces of work in §4, and its shape is completely different depending on
the answer. A plug-in surface for your models is a different product from a
model factory.

### A3. Which plant type, which end-customer, which site, first? — *SOW §3*

Our drafted first set is **RO plants, cooling water / cooling towers, sewage
treatment plants, and softeners**, chosen to match the remote-monitoring
packages IESL already offers.

- Your own reference dashboards (pp. 9–10) give **ETP** a dedicated nav entry
  and a full process train, and reduce softener/RO to a single node. **ETP is not
  in our drafted four.** Should it be — or is the deck illustrative rather than a
  deployment order?
- §3 says "multiple industries". **Which industry and which end-customer** does
  the first deployment serve? Name the **first physical site** if it is known —
  site, plant type, and roughly how many assets.

### A4. Protocols and control systems — makes, models, versions — *SOW §10*

§10 names **OPC-UA, MQTT, Modbus, BACnet, IEC 60870 and REST**, plus PLC, SCADA,
BMS, EMS and DCS integration. That is the correct list for a platform; it is not
a build order. **Each adapter is months of work in its own right and they are
not interchangeable** — this is the largest single unknown on our plan. We run
MQTT today (one RTU, live pilot); the rest are
designed-for and unbuilt, and our own gap analysis records the DCS protocol as
*"TBD with client"*.

- Which protocol is **first**, and which is second?
- For the systems in scope: **manufacturer, model, and firmware/version** of the
  PLC / DCS / SCADA / gateway. ("Modbus" is not enough to build against — we need
  register maps or the device manual.)
- How many RTUs / gateways / sites in phase 1?
- Are the points already exposed by an **existing SCADA or historian** we could
  read from, or do we go to the devices directly?

### A5. Deployment model and network access — *SOW §11*

§11 requires cloud, on-premise **and** hybrid. For **phase 1**, we need one:

- **Which is it**, and **who operates it** — Euphoria, Ion Exchange IT, the end
  customer, or a third party?
- What network path does telemetry take out of the plant, and **who authorises
  it**? Is a VPN or site-to-site link needed (§11 *Secure remote access*), and
  what is the process to get one?
- **When can we get access to a real device or a test bench?** Until we do, every
  adapter is written against a simulator. This is usually the longest lead-time
  item in an engagement of this shape, which is why it sits in Part A.

### A6. Multi-tenancy — where is the tenant boundary? — *SOW §11*

§11 requires **multi-tenant architecture**, so the *whether* is settled. The open
question is **what a tenant is**:

- One platform serving **Ion Exchange's end customers**, each seeing only their
  own sites? Or one tenant per **Ion Exchange business unit**, with customers as
  sites beneath?
- Does an end customer's own staff get logins, or only Ion Exchange personnel?
- Is multi-tenancy needed **in phase 1**, or is phase 1 single-tenant with the
  model reserved?

We need the intent, not the design — the design is ours. It is a fork in the
data model, and it is cheap now and expensive later.

---

## Part B — decides how we build it, needed before the relevant wave

### B7. Alarm setpoints — per site, or Ion Exchange standards? — *SOW §4.1*

Our current plan: templates specify **which parameters to alarm on and what each
one means**, with the actual numbers set per site at commissioning — on the
reading that most limits follow the plant's design and its discharge consent.
**If Ion Exchange applies standard setpoints across plants, tell us before we
build it rather than after.**

### B8. For effluent and sewage plants — where does the treated water go? — *SOW §3*

Inland surface water · public sewer · land for irrigation · recycle/reuse. CPCB
Schedule VI limits differ substantially by route (BOD is 30 mg/L to inland
surface water and 350 mg/L to a public sewer), so the route decides which numbers
a plant is actually held to. If your plants span several routes, that is useful
to know too.

### B9. Alarm severity ladder — *SOW §5 (Severity classification, Priority level)*

Your reference dashboards use **Critical / High / Warning**. We ship
**Critical / Warning / Info** — there is no `high`. Which ladder, and what are
the operational definitions of each level? §5 also lists *severity* and
*priority* as separate fields — are they genuinely two axes for you, or one?
(Renaming is cheap; adding a level touches stored rules and every alarm screen.)

### B10. Alarm enrichment — which fields are day one, and who supplies them? — *SOW §5*

§5 lists thirteen fields per alarm, including **probable root cause**, **impact
assessment**, **estimated energy / water / production impact**, **estimated
resolution time** and **skill requirements**. We can build the schema and the
panel; **the content is engineering domain knowledge, which §14 places on your
side.**

- Which of the thirteen are **must-have for phase 1** versus later?
- For the water asset classes: does a root-cause / corrective-action knowledge
  base already exist in any form (SOPs, troubleshooting guides, service
  checklists) we could ingest, rather than authoring from scratch?

### B11. Notifications, escalation and SLA — *SOW §5, §6*

- Channels: **email, SMS, WhatsApp, in-app**? Any corporate gateway we must use,
  and who owns those credentials?
- Who receives what — by role, by site, by severity? Is there an existing
  **escalation matrix** to encode rather than invent (§5 *Escalation workflow*,
  §6 *Escalation management*)?
- Your reference cards read **"SLA 30 mins"** and **"SLA 1h"**. Are those real
  response targets, and are they per severity, per plant type, or contractual per
  end customer?
- §6 requires **closure approval** — who approves, and is it one level or two?

### B12. Systems we have to integrate with — *SOW §6, §10*

§10 names ERP, CMMS, historians, data lakes and third-party applications. Which
of these **actually exist** in the phase-1 environment?

- **CMMS / EAM** (SAP PM, Maximo, in-house)? If one exists, does TRINETRA feed
  it or replace it? §6 says "where required" — is it required here?
- **ERP / historian / data lake** that should receive exports — which product,
  and push or pull?
- Who owns those systems, and is there an integration contact?

### B13. Security and identity — *SOW §12*

§12 requires RBAC, **SSO**, **MFA**, encryption at rest and in transit, audit
logging and *"compliance with applicable cybersecurity standards"*.

- **SSO against which identity provider** — Azure AD / Entra, on-prem AD, Okta,
  or platform-local accounts for phase 1?
- **MFA** — enforced by your IdP (which is where it belongs if SSO is used), or
  expected from the platform itself?
- **Which standards** does "applicable" mean concretely — ISO 27001, IEC 62443,
  SOC 2, an internal Ion Exchange policy, or an end-customer's requirement? This
  is the one word in §12 we cannot cost. If there is a security questionnaire or
  policy document, that answers it faster than a conversation.
- Who defines the **user roles**, and is there an existing role list?

### B14. The numbers behind sustainability reporting — *SOW §7*

§7 requires energy / water / chemical savings, carbon reduction, wastewater
recovery, efficiency and cost optimisation. Savings are measured against
something, and we cannot invent it:

- **Energy tariff (₹/kWh)** and **water / effluent cost (₹/kL)** — flat, slab, or
  time-of-day? Per site?
- **Carbon factors** — standard grid emission factor, or customer-specific?
- **Baselines** — what does a saving get measured *against*: last year, design
  spec, or a commissioning benchmark?
- Your reference dashboard promotes **Water Recycle %** and **Operational
  Efficiency %** to top-level KPIs. **Define each one** (numerator and
  denominator). We will not guess a formula that appears on an executive screen.

### B15. Health-score inputs — *SOW §4.3*

§4.3 says the health score evaluates operational conditions, **historical
performance, maintenance records, environmental factors and equipment
utilisation**. Live telemetry we will have. The other three we will not, unless:

- **Maintenance records** — do they exist digitally today, and where? (This
  overlaps B12.)
- **Environmental factors** — ambient conditions from site instrumentation, or an
  external weather source?
- Is there any **historical telemetry** we can backfill from, or does the record
  start on the day we connect? This decides whether models can be trained at
  go-live or only after a season of data.

### B16. Data retention and statutory reporting

We currently keep **raw telemetry for 2 years** and hourly/daily rollups
indefinitely.

- Does 2 years of raw data meet your obligation, or do you need longer?
- Is there any **statutory reporting or real-time data submission** to SPCB /
  CPCB — or to your end customers — that the platform is expected to produce or
  feed? If so, in what format and on what schedule? **We have assumed none**, and
  the SOW does not mention it.

---

## Part C — presentation, naming and delivery logistics

### C17. What do you call these plants internally? — *SOW §3, §4.1*

We would rather use your product names than generic ones on an operator's
screen. We have seen **INDION FMR**, **NGPSTP** and **Eco MBR** referenced for
packaged sewage treatment; we are less confident on the RO, DM and softener side.
Please confirm or correct, including how you want them written in a
customer-facing screen.

### C18. The reference dashboards — requirement or illustration? — *SOW pp. 9–10*

Both points change our UI direction rather than our feature list:

- They are **dark-canvas with neon accents**; our approved mockups and every
  shipped screen are light. **Is the dark treatment a requirement, or is it the
  layout you are pointing at?**
- Their sidebar is **one entry per domain** (Electrical · Water · STP · ETP ·
  HVAC · Alarms · Work Orders · Assets · Analytics · Reports · Sustainability);
  ours groups by function. **Is per-domain navigation what your operators
  expect?** If so, are **STP and ETP** plant types *inside* Water, or top-level
  peers of Electrical?
- Their sidebar footer reads **"Data Quality 98.6% Good"** — what would you want
  that number to mean: sensor freshness, ingest completeness, or something you
  already report?

### C19. Stakeholder dashboards — who signs them off? — *SOW §9*

§9 names six stakeholder groups (Executive, Plant Operations, Maintenance,
Sustainability, Utility Managers, Facility Managers). Which of these exist at the
first deployment, **who is the named reviewer for each**, and is there a
preferred default landing screen per role?

### C20. ⚑ Instrumentation — supply or integrate? — *SOW §8*

§8 says the Vendor *"shall support integration and deployment"* of fifteen
instrument and gateway types. We read that as **integration scope, with supply
and installation on the project/procurement side**. Please confirm — and either
way, we need the **fitment schedule**, because nothing can be tested against a
real plant until the instruments are in.

### C21. ⚑ Delivery logistics — *SOW §13*

§13 covers documentation, **training** and **post-deployment support** without
detail. To plan them:

- **Environments** — do you need separate dev / UAT / production, and who hosts
  each?
- **Acceptance** — what is the UAT process, who signs off, and against what
  criteria? Is there a phase-1 scope freeze we should be writing down today?
- **Training** — which audiences (operators, maintenance, admins, your
  engineering team building templates on top), what format, and how many people?
- **Support** — expected response/uptime commitments, support hours, and warranty
  period after go-live?
- A **named single point of contact** with authority to answer the above, plus a
  **UAT owner** on your side.
- **Next review date.**

### C22. Sites and branding

- The **site list and hierarchy** for phase 1 (organisation → site → plant →
  asset), even provisionally.
- **Brand assets** — logo, colours, and how TRINETRA and Ion Exchange are to be
  co-presented in the header and on reports.

---
---

# Internal annex — do not hand over

Everything above (A1–C22) is the handout. Everything below is ours: planning-grade
effort figures, the ADR collisions, and the list of things that must **not** be
raised with the client.

## What each answer decides, and what a wrong guess costs

Effort figures are planning-grade, from `BACKLOG.md` and
`client-requirements-matrix.csv`. **They are deliberately absent from Parts A–C**
— across a table an estimate reads as a commitment or a price anchor.

| Ask | SOW | Backlog row(s) | Decides | Cost of guessing |
|---|---|---|---|---|
| A1 tag list | §4.1, §3 | `E5.1`, seeds `F2.7` | `template_points` catalog — point keys, units, fitted instruments | 6–8 pw of templates against instruments no real plant reports |
| A2 overlay boundary ⚑ | §1, §2, §4, §14 | `E1.1` ⭐, all `E1.x`, `E5.1`, `E1.7` | Whether we build models or a **plug-in surface** for theirs; who authors template content | 8–12 pw building the wrong half of §4; the ML-stack ADR cannot be written without it |
| A3 first plant / customer | §3 | `E5.1`, `E5.2` | Which asset classes ship first | 6–8 pw aimed at the wrong plant type |
| A4 protocols | §10 | `F1.2`–`F1.6`, `F1.7`, `E5.4`, `E6.1` | Which adapter is built, against what | **10–14 pw each for Modbus / BACnet / OPC-UA, 8–12 for DCS** — largest single guess on the board. It is not in the top-three-if-only line above A2 only because A2 decides the shape of an entire SOW clause; if the client can answer just one of the two, take A4. |
| A5 deployment / access | §11 | `E7.2`, `E7.3`, `E7.4`, `F4.27` | Packaging, DR, edge buffering, and when real testing can start | Adapters validated only against a simulator; longest lead time |
| A6 tenancy boundary | §11 | `E7.1`, informs `F4.16` | Tenant model and row-level isolation | 10–14 pw retrofit; reopens a superseded decision (§5 *Multi-tenancy re-open*) |
| B7 setpoints | §4.1 | `E5.1` | Whether templates carry **numbers** or only parameter + meaning | **Reopens ADR 0019 — see below** |
| B8 discharge route | §3 | `E5.1`, `E4.3` | Whether packs may carry limits, and which CPCB Schedule VI column | Limits authored against the wrong route |
| B9 severity ladder | §5 | `F4.46`, `F3.6` | Stored rule vocabulary + every alarm surface | Migration over live rules plus UI rework |
| B10 enrichment fields | §5 | `E2.1`, `E2.2`, `E2.3` | Schema breadth, and whether the KB is ingested or authored | A 13-field schema nobody populates |
| B11 notify / SLA | §5, §6 | `F3.10`, `E2.1`, `E3.1` | Channel adapters, escalation model, SLA as a first-class field | Escalation rebuilt; SLA retrofitted into work orders |
| B12 integrations | §6, §10 | `E3.3`, `E6.2` | Connector scope and direction | A connector nobody uses |
| B13 security / SSO / MFA / standards | §12 | auth, `F4.16`, `E8.x` | Identity model; whether a certification effort exists at all | An auth model that must be replaced; an unbudgeted audit |
| B14 tariffs / factors / KPI formulas | §7 | `E4.1`, `E4.2`, `E1.6` | Savings-engine inputs and two executive KPIs | Wrong money and wrong CO₂ on a board-level screen |
| B15 health-score inputs | §4.3 | `E1.3`, `E1.5` | Whether the score is telemetry-only at go-live | A "health score" that is one input wearing a name |
| B16 retention / statutory | — | `F4.2` (done), reports | Whether the shipped 2-year ladder is sufficient | Data already dropped when it is asked for |
| C17 product names | §3, §4.1 | `E5.1` | Template `code` and display names | Wrong product names in front of an operator |
| C18 canvas + IA | pp. 9–10 | `F3.28`, `F3.29`, `F3.30`, §5 ADR rows | Palette and navigation IA | A theme/IA change across every shipped page |
| C19 personas | §9 | `E4.2`, `F3.1` | Dashboard defaults per role, and who reviews them | Dashboards built for a persona with no reviewer |
| C20 instrumentation ⚑ | §8 | §6 note | Supply-vs-integrate boundary; test sequencing | Schedule slip, and a commercial argument later |
| C21 delivery logistics ⚑ | §13 | — | Environments, acceptance, training, support | Unbounded support expectation; no acceptance criteria |
| C22 sites / branding | §3 | `F3.29` | Seed hierarchy and header treatment | Rework, not redesign |

## Two collisions to be aware of in the room

**B7 collides with an accepted ADR.** [ADR 0019](./adr/0019-template-content-model.md)
is merged and declares `thresholdValue: number` — **required**. The answer we
expect from B7 ("numbers are set per site at commissioning") means that template
**cannot be authored** under the current contract without inventing placeholder
numbers, which is exactly what ADR 0019 was written to prevent. A per-site answer
therefore requires **ADR 0019 Amendment 1** making `thresholdValue` optional.
Amending an accepted ADR is the owner's call — *take the answer in the room,
raise the amendment afterwards; do not concede a design change across the table.*
In `E5.1`'s favour, the *meaning* half already has a home
(`philosophy.cause` / `.impact` / `.action` / `.skill` in that same schema), so
the CPCB context behind B8 has somewhere to live today.

**C18 asks for a requirement, not a decision.** Adopting the reference's dark
canvas contradicts `AGENTS.md` §5, both mockups, and every shipped page at
once — a §10 scope change and an owner/ADR decision, not something to agree to
across a table. Ask **whether it is a requirement**; decide **whether to do it**
internally. Same for domain-first IA. Worth knowing: the reference's *density and
component vocabulary* (alarm rail, process diagram, stepper, health donut,
gauges) are all achievable in the existing light palette — **only the canvas
colour is gated**, so nothing stalls either way.

## Explicitly **not** client questions — do not raise these

Open on our board, and owner/ADR decisions. Raising them reads as asking the
client to run our engineering:

- ML stack choice for `E1.x` — runtime, registry, serving path. **A2 is the
  client-facing half of this** (what plugs in), and the stack decision stays ours.
- `apps/api` `moduleResolution` (node10 vs node16/bundler)
- The encryption-at-rest boundary retro ADR for `E8.1`
- Rule-vocabulary `CHECK` constraints (absorbed into ADR 0031)
- Whether to write the dark-canvas / domain-first IA ADRs at all

Hardware **supply** (C20) is the one procurement topic that belongs in the
meeting, and only because it gates when ingestion can be tested against reality.

## Provenance

Every ask above is anchored to a clause of
[`sow-enterprise-ems-euphoria-infotech.pdf`](./sow-enterprise-ems-euphoria-infotech.pdf)
(text extracted with `pdftotext -layout`; pp. 9–10 are full-bleed images with no
text layer, read separately in
[`docs/ux/ion-exchange-reference-alignment.md`](./ux/ion-exchange-reference-alignment.md)).
Backlog rows, effort and blocking status come from [`BACKLOG.md`](./BACKLOG.md)
§2, §5, §6 and §7; the five previously-sent questions from
[`e5.1-client-questions.md`](./e5.1-client-questions.md); per-protocol gap effort
and the *"DCS — protocol TBD with client"* entry from
[`client-requirements-matrix.csv`](./client-requirements-matrix.csv) and
[`client-requirements-as-is-report.md`](./client-requirements-as-is-report.md).

The CPCB Schedule VI reasoning and the IESL product names (INDION Swift, INDION
FMR, NGPSTP, Eco MBR) are **what we asked about, not verified fact** — C17 is
precisely the request to confirm them.

**One claim in the handout is about *our* product rather than theirs, so it was
checked in the code rather than read off the board:** B9's "we ship Critical /
Warning / Info, there is no `high`" is
`packages/shared/src/contracts/operations.ts:302` —
`z.enum(["info", "warning", "critical"])`, mirrored in
`apps/api/src/rules/rules.schema.ts:32`. (`alarms-page.tsx:140` filters a stray
`"major"` string that is in no schema; it does not change the answer, and it is
`F4.46`'s territory rather than the client's.)

**When answers land:** record A1/A3/B7/B8/C17 in `e5.1-client-questions.md` and
the rest here. Then write the `E5.1` ADR before any `E5.1` code, and update the
`E5.1` row in `BACKLOG.md` §2 Track B — §1's critical-path note and §1b slot 8
both point at that row. A2's answer is a prerequisite for the **ML stack ADR**
in §5, which cannot be drafted until the plug-in surface is known.
