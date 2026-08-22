# Response Form — Information & Decisions Requested

**Companion to:** *Information & Decisions Requested — Enterprise AI Monitoring &
Optimisation Foundry* (Euphoria Infotech → Ion Exchange, 17 August 2026)
**Reference numbers match that document exactly.**

---

## How to use this form

- **Answer what you can and return it.** Partial responses are useful; please do
  not hold the form waiting on one item.
- **Status** — use one of: `Answered` · `Partial` · `Owner assigned` ·
  `Not applicable` · `Deferred`.
- **"Assumption confirmed" is a complete answer** wherever we have stated an
  assumption. It is the fastest reply available and it is not a lesser one.
- **Attachments** — name the file in the *Attachment* column and send it with
  the form. Redacted or anonymised documents are fully acceptable.
- **If an item is not applicable**, please say so explicitly rather than leaving
  it blank — a stated "not applicable" closes the item; a blank does not.

**Return to:** _______________________  **Date returned:** _______________

---

## Section 0 — Assumption check *(fastest section to complete)*

These are the assumptions we are currently building on, as listed in **section 4
of the request document**. Mark each **C** (confirmed) or **X** (wrong), and add
a correction only where you mark X. **Confirming a block of these is a complete
and valuable reply on its own.**

**▲ is a proposed phasing, not an assumption.** The SOW requires these
capabilities and none of them is being dropped — we are proposing an order.
**Please treat the five ▲ rows as needing discussion rather than a tick.**

| Ref | Our assumption, in short | C / X | Correction, if X |
|-----|--------------------------|-------|------------------|
| A2 | We author the first water template pack; your AI models are yours to supply, ours to serve | | |
| A3a | First template set is RO, cooling water, STP, softener — **ETP excluded** | | |
| A4 | No vendor-licensed driver, paid SDK or proprietary gateway needed to read points | | |
| A5 ▲ | Build and prove **one** of the three deployment models in phase 1 — which one, and who operates it, are open | | |
| A6 ▲ | Multi-tenant model built; phase 1 **commissioned** single-tenant. Tenant = an Ion Exchange end customer | | |
| B7 | Templates name the parameter and its meaning; limit values set per site at commissioning | | |
| B8 | Plants span several discharge routes, so no default limits ship in templates | | |
| B9 | Existing Critical / Warning / Info ladder retained; severity and priority as one axis | | |
| B10 | Full thirteen-field alarm schema built, populated progressively by Ion Exchange | | |
| B11 | Email and in-app notifications first; no corporate gateway | | |
| B12 ▲ | Framework supports all four; **no connector built in phase 1** until we know which products are present | | |
| B13 ▲ | SSO to your identity provider, MFA enforced there; every §12 control implemented, but **no third-party certification audit** in phase 1 | | |
| B14 | Tariffs, carbon factors and baselines supplied by you as configuration | | |
| B15 ▲ | Health score **commissioned on live telemetry first**, other §4.3 inputs folded in as they become available; no historical data to backfill | | |
| B16 | Two-year raw retention is sufficient; **no statutory reporting obligation** | | |
| C17 | Product names (INDION FMR, NGPSTP, Eco MBR) are researched, not verified | | |
| C18 | Light palette and function-grouped navigation retained | | |
| C19 | Executive, Plant Operations and Maintenance are the phase-1 personas | | |
| C20 | Instrumentation supply and installation sit on the project side; we integrate | | |
| C22 | Hierarchy is organisation → site → plant → asset | | |

*C21 (environments, acceptance, training, support, warranty) carries **no
assumption** and cannot be closed from our side — it needs agreement. See
section 4 of this form.*

---

## Section 1 — The four we would take first

| Ref | What we need | Your answer | Owner | Target date | Attachment | Status |
|-----|--------------|-------------|-------|-------------|------------|--------|
| **A1** | Tag list / P&ID / I/O schedule / SCADA export from **one** plant | | | | | |
| **A2** | Overlay boundary: who authors templates; what form your AI models take; one worked example | | | | | |
| **A4** | Which protocol first; PLC/DCS/SCADA make, model and firmware; register map or manual | | | | | |
| **A5** | Phase-1 deployment model; who operates it; network path and approver; date we can reach a real device | | | | | |

---

## Section 2 — Remainder of Part A

| Ref | What we need | Your answer | Owner | Target date | Attachment | Status |
|-----|--------------|-------------|-------|-------------|------------|--------|
| **A3a** | Is **ETP** in the first template set? Are the drafted four (RO, cooling water, STP, softener) right? | | | | | |
| **A3b** | First industry and end-customer; first physical site, plant type, approximate asset count | | | | | |
| **A6** | What constitutes a tenant; do end-customer staff hold logins; is multi-tenancy needed in phase 1 | | | | | |

---

## Section 3 — Part B

| Ref | What we need | Your answer | Owner | Target date | Attachment | Status |
|-----|--------------|-------------|-------|-------------|------------|--------|
| **B7** | Setpoints set per site at commissioning, or Ion Exchange standards across plants? | | | | | |
| **B8** | Discharge route(s) for effluent/sewage plants — inland surface water, public sewer, irrigation, reuse | | | | | |
| **B9** | Severity ladder (Critical/High/Warning vs Critical/Warning/Info) + definitions; are severity and priority two axes or one? | | | | | |
| **B10** | Which of the thirteen §5 alarm fields are essential in phase 1; does a root-cause / SOP knowledge base exist? | | | | | |
| **B11** | Notification channels + gateway; recipients by role/site/severity; escalation matrix; SLA targets; closure approval levels | | | | | |
| **B12** | Existing CMMS/EAM, ERP, historian or data lake — product, direction of flow, owner and contact | | | | | |
| **B13** | SSO identity provider; where MFA is enforced; which cybersecurity standards apply; role list; security questionnaire if one exists | | | | | |
| **B14** | Energy tariff (₹/kWh); water/effluent cost (₹/kL); carbon factors; savings baseline; **definitions of Water Recycle % and Operational Efficiency %** | | | | | |
| **B15** | Where maintenance records live; source of environmental data; availability of historical telemetry for backfill | | | | | |
| **B16** | Is 2-year raw retention sufficient? Any statutory reporting or real-time submission to SPCB/CPCB or end customers? | | | | | |

---

## Section 4 — Part C

| Ref | What we need | Your answer | Owner | Target date | Attachment | Status |
|-----|--------------|-------------|-------|-------------|------------|--------|
| **C17** | Confirm or correct internal product names (INDION FMR, NGPSTP, Eco MBR, and the RO / DM / softener range) and their customer-facing spelling | | | | | |
| **C18a** | Is the **dark canvas** a requirement, or is the layout the point? | | | | | |
| **C18b** | Is **per-domain navigation** expected? Are STP and ETP inside Water, or peers of Electrical? | | | | | |
| **C18c** | What should **"Data Quality %"** measure? | | | | | |
| **C19** | Which of the six stakeholder groups exist at first deployment; named reviewer per group; default landing screen per role | | | | | |
| **C20** | Confirm instrumentation is integration scope (supply on the project side); **fitment schedule** | | | | | |
| **C21a** | Environments required (dev / UAT / production) and who hosts each | | | | | |
| **C21b** | UAT process, sign-off authority and acceptance criteria; phase-1 scope freeze | | | | | |
| **C21c** | Training audiences, format and headcount | | | | | |
| **C21d** | Support hours, response/uptime expectations, warranty period | | | | | |
| **C21e** | Named single point of contact and UAT owner | | | | | |
| **C21f** | Date of next review | | | | | |
| **C22a** | Site list and hierarchy for phase 1 (organisation → site → plant → asset) | | | | | |
| **C22b** | Brand assets and TRINETRA / Ion Exchange co-presentation | | | | | |

---

## Section 5 — Anything we have not asked

If there is a requirement, constraint, deadline or existing system that is not
covered above, please add it here. Items raised now are far cheaper to
accommodate than the same items raised at UAT.

| # | Topic | Detail | Owner | Target date |
|---|-------|--------|-------|-------------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

---

*A spreadsheet version of this form is available as
`ion-exchange-response-form-2026-08-17.csv` if that is easier to circulate
internally.*
