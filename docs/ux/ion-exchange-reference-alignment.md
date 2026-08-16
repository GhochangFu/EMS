# Ion Exchange reference dashboards — alignment gap analysis

**Source:** `docs/sow-enterprise-ems-euphoria-infotech.pdf`, **pages 9 and 10**.
Both pages are full-bleed images with no text layer. Page 8 ends with the
caption that introduces them:

> "Reference Dashboard for automatic Alarm Generation"

**Read that caption carefully.** These are *reference designs attached to the
SOW*, captioned as such. They are not stated to be screenshots of a running
legacy system, and nothing in the document says Ion Exchange operates these
screens today. Treat them as the client's picture of the target, which is the
strongest possible signal about what they expect to receive — and a weak signal
about what they already run. **No conclusion below depends on which of the two
they are.**

**Date:** 2026-08-16. **Compared against:** the running local deployment
(`localhost:5173`, containers `bms-web-1` / `bms-api-1` up, seeded database),
not against source alone.

To regenerate the images:

```bash
# both are DCTDecode XObjects; obj 60 = page 9, obj 64 = page 10
python - <<'PY'
import re
d = open('docs/sow-enterprise-ems-euphoria-infotech.pdf','rb').read()
for num in (60, 64):
    m = re.search(rb'\n%d 0 obj' % num, d)
    b = d[m.end():d.find(b'endobj', m.end())]
    s = b.find(b'stream') + 7
    open('page%s.jpg' % num, 'wb').write(b[s:b.rfind(b'endstream')].lstrip(b'\r\n'))
PY
```

---

## 1. The headline

**The reference layout is not a new dashboard pattern for us. It is
`/cr-overview` generalised — one instance per utility domain.**

Our `/cr-overview` already renders: a KPI tile row, a live single-line process
diagram with values on each node, a right-hand rail, and a strip of
per-subsystem status cards below. That is structurally the same page as the
reference's Electrical Distribution Overview. The reference then repeats that
shape for Water, STP and ETP, and adds an integrated roll-up on top.

This matters for how the work is framed. The gap is **not** "build dashboards
we do not have." It is:

1. the pattern exists on exactly one page and is not reusable,
2. it is pointed at the data-centre control room rather than at a plant,
3. **the diagram is hidden from navigation** (see §4.1), and
4. the right rail shows *rules*, not *alarms*.

---

## 2. What the two pages actually contain

### Page 9 — two stacked domain dashboards

**Electrical Distribution Overview** ("Real-time monitoring of electrical
assets and performance")

| Region | Content |
|---|---|
| KPI row (5) | Total Power 5.62 MW *+3.2% vs yesterday* · Demand 4.85 MW *78% of Contract Demand* · Power Factor 0.96 *Good* · Energy Today 112.75 MWh *+6.8% vs yesterday* · Active Alarms 7 *3 Critical / 4 High* |
| Single-line diagram | GRID 33kV (5.12 MW, 50.1 Hz, 11.2 kV) and DG SET 2 (Standby, 0.00 MW) → MAIN HT PANEL → TRANSFORMER 1 (2.60 MVA, 11.2/0.433 kV, 48.7 °C, Load 72%) / TRANSFORMER 2 (2.00 MVA, 65.3 °C, Load 68%, ⚠) → LT PANEL-1 (2.58 MW, PF 0.97, Load 75%, ON) / LT PANEL-2 (1.85 MW, PF 0.94, Load 89%, **HIGH LOAD**) → MCC-1…4 (MCC-4 0.72 MW **OVERLOAD**, red) → VFD PANEL, CAPACITOR BANK |
| Legend | **Normal · Warning · High · Critical · Offline** |
| Asset Health Summary | Per asset-class count **plus worst state**: Transformers 2 *(1 Warning)* · HT Panels 2 *(All Good)* · LT Panels 2 *(1 High)* · MCCs 4 *(1 Critical)* · VFDs 2 *(All Good)* · Capacitor Banks 1 · DG Sets 2 *(1 Standby)* |
| Right rail | Tabs **ACTIVE ALARMS / ALARM SUMMARY**; table Time · Asset · Alarm · Severity; breach value inline in the alarm text — "Overload (112%)", "Oil Temperature High (65.3 °C)", "THD High (6.8%)" |
| Maintenance workflow | Stepper: Alarm Triggered → Work Order Created → Assigned → In Progress → Completed |
| Work-order card | WO #ELEC-2025-0523-001 *(Critical)* · Asset MCC-4 · Issue Overload (112%) · Assigned To Ramesh Kumar · Priority Critical · **SLA 30 mins** · Status In Progress · Created 10:22 AM · **[View Work Order]** |

**Water & Wastewater Management Overview** ("Real-time monitoring of water
systems, STP & ETP")

| Region | Content |
|---|---|
| KPI row (5) | Water Consumption Today 1,245 KL *-4.3%* · STP Treated Today 980 KL *98% Efficiency* · ETP Treated Today 890 KL *96% Efficiency* · Active Alarms 9 *4 Critical / 5 High* · Water Recycle % 72% *+5%* |
| Raw water train | Raw Water Tank *(Level 72%)* → Raw Water Pump *(2 Pumps, 1 Running)* → Clarifier *(Turbidity 1.2 NTU)* |
| STP train | Equalization Tank *(Level 65%)* → Aeration Tank *(DO 2.1 mg/L)* → Secondary Clarifier *(MLSS 2,850 mg/L)* → Disinfection *(Chlorine 0.5 mg/L)* → Treated Water Tank *(Level 68%)* |
| ETP train | Equalization Tank *(Level 60%)* → pH Neutralization *(pH 4.8)* → Biological Treatment *(MLSS 3,250 mg/L)* → Settling Tank *(TSS 45 mg/L)* → Discharge *(Flow 120 KL/hr)* |
| Inline alarm cards | Rendered **inside** the process train at the offending unit: "HIGH D.O. ALARM · DO: 2.1 mg/L · High", "LOW CHLORINE ALARM · Chlorine: 0.5 mg/L · Low", "LOW pH ALARM · pH: 4.8 · Critical" |
| Key Parameters strip (9) | Three distinct widget types: **tank-level** (fill illustration + %), **plain value + unit** (1,050 KL/day), **radial gauge** (98%) |

### Page 10 — Integrated Operations Overview

Subtitle: "Electrical • Water • STP • ETP • Assets • Alarms".

| Region | Content |
|---|---|
| Sidebar | Dashboard · **Electrical · Water · STP · ETP · HVAC** · Alarms **(16)** · Work Orders · **Assets** · Analytics · Reports · **Sustainability** · Settings — flat, single level, one icon + label per entry |
| Sidebar footer | **System Status** — shield, "All Systems Operational"; **Data Quality** — **98.6% Good** |
| Top bar | **Site selector** (dropdown) · date · time · search · notifications bell · **alarm bell with count badge (12)** · help (?) · avatar + **"Admin / Operations Manager"** |
| KPI row (6) | Total Active Alarms 16 *(6 Critical, 6 High, 4 Warning)* · Open Work Orders 32 *(18 In Progress, 14 Pending)* · Energy Today 112.75 MWh *↓6.8%* · Water Today 1,245 KL *↓4.3%* · Water Recycle % 72% *5%* · Operational Efficiency 91.2% *2.6%* — each with a domain icon |
| System Overview | **Diagram View / List View toggle.** Electrical chain (Incoming 33kV → Transformer 33/11 kV → HT Panels → LT Panels → MCCs → Utilities DG/UPS/Solar/Capacitor) + Water chain (Raw Water Intake → Pump House → Treatment (Softener/RO) → OHT/Tanks → Distribution Network) + STP and ETP trains, with severity dots on affected nodes |
| Active Alarms | 8 rows + **View All**; same Time · Area/Asset · Alarm · Severity shape |
| **Alarm Details** | Asset Type · Location · Triggered At · **Current Value 112%** · **Threshold >100%** · Status Active |
| Alarm Action / Workflow | Same 5-step stepper + WO card, **SLA 1h** |
| Bottom row | Energy Consumption (today) area chart 00:00–24:00 · Water Consumption (today) area chart · **Asset Health Summary donut** — 265 Total Assets: Excellent 112 (42%), Good 86 (32%), Fair 42 (16%), Poor 17 (6%), Critical 8 (3%) · Open Work Orders table (WO ID · Area/Asset · Priority · Status · SLA) |
| Mobile companion | Phone overlay: critical-alarm push with **Acknowledge / View Details**, "My Work Orders 4 In Progress / 6 Pending", bottom tab bar |
| Footer ribbon | Real-time Monitoring · Intelligent Alerts · Predictive Maintenance · Automated Workflows · Energy & Water Optimization · Sustainability Insights · Mobile Ready |

---

## 3. Gaps, in three buckets

The buckets matter more than the individual lines. Most of what the reference
shows **is already on the board** — the reference confirms priority and supplies
acceptance detail, but adds no new scope. A smaller set has no row I could find.
A very small set cannot be decided without the human §10 gate.

### 3.1 Already has a backlog row — reference adds acceptance detail, not scope

| Reference feature | Existing row |
|---|---|
| Water / STP / ETP domain dashboards and process trains | **`E5.1`** water-treatment domain pack *(blocked — see §4.2)* |
| Asset Health Summary donut, per-class health strip | **`E1.3`** Asset Health Score, asset → plant → enterprise rollups |
| Alarm Details panel (root cause, threshold, current value, impact) | **`E2.1`** alarm enrichment schema |
| Alarm → work-order stepper, SLA, assignment, closure | **`E3.1`** work-order depth |
| Mobile companion panel, acknowledge from phone | **`F3.20`** mobile PWA + **`E3.2`** mobile work execution |
| Sustainability nav entry, recycle %, efficiency KPIs | **`E4.1`** metrics engine + **`E4.2`** sustainability dashboards |
| Right rail showing **alarms** rather than rules | **`F3.6`** unify alarm engine + **`F3.10`** escalation/auto-clear |
| Mixed widget types (gauge, tank level, area chart) | **`F3.1`** dashboard builder + **`F4.41`** `packages/ui` |
| HVAC domain dashboard | `/crac` exists **but is hidden** — see §4.1 |
| Analytics nav entry, cross-site benchmarking | **`E4.2`** |

**Nothing above needs a new row.** The value of the reference here is that it
pins down *what "done" looks like* for rows that were one-line descriptions —
SLA in minutes and the five-step stepper on `E3.1`, the five named health
buckets on `E1.3`, current-value-beside-threshold on `E2.1`, the first actual
list of "core widgets" on `F3.1`.

**That detail was written into the rows themselves on 2026-08-16**, not left
here — a row an agent picks up should carry its own acceptance criteria rather
than depend on someone having read this file first. This section records the
*mapping*; the rows record the *requirement*.

### 3.2 Had no row — now does

**These were carried into `docs/BACKLOG.md` on 2026-08-16 as seven new rows**
(`F3.28`–`F3.31`, `F4.46`–`F4.48`) plus two `§5` ADR-queue entries. The board is
the tracker; the `Row` column below is the only status this document carries,
and it is a pointer, not a state.

The original search was keyword-based over a prose-heavy file, so each of these
began as *no row **found***, not *no row exists* — worth remembering if one of
them turns out to duplicate something.

| # | Gap | Row |
|---|---|---|
| 1 | **Domain-first navigation IA** — reference sidebar is one flat entry per *domain* (Electrical, Water, STP, ETP, HVAC); ours is five *function* groups with 20+ entries. See §4.3: cheaper than it looks. | **§5 ADR** *(gated)* · surface in `F3.29` |
| 2 | **Persistent site selector in the top bar** — reference scopes the whole app to one site from the header; we use org filter pills *inside* the dashboard body. | `F3.29` |
| 3 | **Diagram View / List View toggle** — we have no list fallback for the SLD. | `F3.28` |
| 4 | **KPI period-delta and tile icons** — "↓6.8% vs yesterday" on every tile. `KpiTile` has **no comparison-to-prior-period concept anywhere**; needs a prior-period query, not a prop. | `F3.28` |
| 5 | **Breach value inline in alarm text** — "Overload (112%)". Our rows carry a message; the triggering value is not composed into it. | `F3.28` |
| 6 | **Status legend row** — Normal · Warning · **High** · Critical · Offline. | `F3.28` (legend) · `F4.46` (the missing `high`) |
| 7 | **System Status + Data Quality** — the genuinely new concept. A natural rollup of `F4.37`/`F4.38`/`F4.39`, which built telemetry-freshness checks precisely because pages rendered stale data as live. | `F3.30` |
| 8 | **Operator-facing Assets browser** — ours is `/admin/assets`, a master-data editor under Administration. | `F3.31` |
| 9 | **Per-asset-class health strip with worst state** — "MCCs 4 · *1 Critical*". Distinct from `E1.3`'s per-asset score. | `F3.28` |
| 10 | **"Key Parameters" gauge strip** — radial-gauge and tank-level widget types, named by neither `F3.1` nor `F4.41`. | `F3.28` · detail added to `F3.1` |
| 11 | **Footer capability ribbon** — cosmetic; folded in rather than given its own row. | `F3.28` |
| 12 | **The rule builder persists a downgraded severity on save** — a live defect, not a layout gap. See §4.4. | `F4.46` **P0** |

**Two more rows came out of this work rather than out of the reference:**

| Gap | Row |
|---|---|
| `/sld` and `/crac` built, routed and hidden from the nav since 2026-05-03, recorded nowhere. Found *because* the reference put a process diagram at the centre of every page. See §4.1. | `F4.47` |
| The client-facing backlog dashboard fails its own leak check, and no CI job runs the script that would report it. Found while regenerating the board after the rows above landed; **pre-existing**, verified by re-running the generator on `HEAD`. | `F4.48` |

### 3.3 Needs the human §10 gate — do not decide these without an ADR

**Both are now queued in `docs/BACKLOG.md` §5 (Decision ADR queue)**, which is
where this repo holds decisions owed before the affected items start.

| Decision | Queued as | Why it is gated |
|---|---|---|
| **Dark canvas** | §5 *Reference layout language* — blocks `F3.28` and any theme work | See §4.5. Both mockups are light-canvas by explicit token. AGENTS.md §5 names one of them as *the* UX spec. |
| **Domain-first IA** | §5 *Domain-first navigation IA* — blocks `F3.29`, informs `E5.1` | AGENTS.md §5: "Match the original screen's information architecture first." Reordering the sidebar around domains is a deliberate departure from that instruction, not an implementation detail. |

**One promotion is owed either way and is not an agent's to make.** If either
decision is taken, `AGENTS.md` §5 is what an agent reads before building any
screen, and it currently describes only the `ESKOM_SMOC.html` shell — so it
would need a pointer to this document and to whichever ADR results. AGENTS.md
may only be edited through a `chore(agents):` PR (§9.10), so that is recorded
here rather than done.

---

## 4. Five findings worth stating plainly

### 4.1 The process diagram is the centrepiece of both reference pages — and ours is hidden from the nav

`apps/web/src/layouts/app-shell.tsx:72`:

```ts
const temporarilyHiddenModulePaths = new Set(["/sld", "/crac"]);
```

`/sld` (Electrical SLD) and `/crac` (HVAC) are built, routed, and suppressed
from the sidebar. Every reference page puts a live process diagram at its
centre; we have one and an operator cannot reach it from the nav.

`/cr-sld` remains reachable under "Control Room 2D", so the capability is not
invisible — but it is filed under the data-centre control room rather than
presented as the plant's primary view.

**This is the cheapest, sharpest gap in the whole comparison.** Whatever else is
decided, the question "why are these two hidden, and is that still true?" is
worth answering first. It is one line of code and a decision, not a project.

### 4.2 Water, STP and ETP are half the reference — and `E5.1` cannot start

Of the reference's three dashboards, **one and a half are water**. `E5.1`
(water-treatment domain pack) is the flagship P0, both its dependencies are `✅`,
and it is **blocked on an unanswered client question set** — see
`docs/e5.1-client-questions.md`, sent and unanswered since 2026-08-09.

So the client's own target layout is half-composed of the one thing we are
waiting on them to unblock.

**But the reference pages partially answer two of the five questions.** Stated
precisely, because the distinction matters:

- **Q1 — "are RO / cooling water / STP / softeners the right place to start?"**
  The reference names **STP and ETP** as the two treatment trains with dedicated
  nav entries and full process flows, plus a raw-water train, plus
  "Treatment (Softener/RO)" as a single node on the integrated view. That
  suggests **ETP belongs in the first set and is currently absent from our
  drafted four**, and that softener/RO are less prominent than we assumed.
  This narrows Q1. It does not close it — a marketing reference deck is not a
  statement of deployment order.

- **Q2 — "could we see the tag list from one real plant?"** The trains name
  unit operations and parameters: Equalization Tank, Aeration Tank *(DO mg/L)*,
  Secondary Clarifier *(MLSS mg/L)*, Disinfection *(Chlorine mg/L)*, pH
  Neutralization *(pH)*, Biological Treatment *(MLSS)*, Settling Tank
  *(TSS mg/L)*, Discharge *(Flow KL/hr)*, Clarifier *(Turbidity NTU)*, tank
  levels *(%)*. That is a usable first vocabulary with units.
  **It is not a plant tag export** — no naming convention, no I/O schedule, no
  indication of which instruments are actually fitted at a real site. The mail
  called Q2 the priority ask for exactly those three reasons, and this supplies
  none of them.

- **Q3 (setpoints), Q4 (discharge route), Q5 (product names) — untouched.**
  The reference shows *breached values* ("DO: 2.1 mg/L · High"), which tells us
  **which parameters are alarmed** but not what the limits are. If anything this
  supports the mail's proposed design — templates that name the parameter and
  its meaning, numbers set per site — which is the answer that would reopen
  ADR 0019.

**None of this unblocks `E5.1`,** and it should not be used to argue that it
does. It does mean a reply narrowed to Q2 alone would now be enough to start.

### 4.3 F4.45 already made domain-first navigation cheap

`F4.45` (merged `25835f6`) replaced the hardcoded `assetDomain` enum with the
**`bms.asset_domains` lookup table**, seeded with `electrical`, `hvac`, `it`,
`environment`, **`water`**, and exposed at `GET /api/v1/vocabularies`.

A domain-first sidebar can therefore be **generated from that table** rather
than hand-written — which is precisely the dynamic-vocabulary principle already
ruled on. Adding STP and ETP as domains becomes an `INSERT`, and they appear in
the nav.

That turns gap 3.2 #1 from a structural rewrite into a rendering change over
data we already serve. **The gate in §3.3 is about whether to reorganise the IA
at all, not about whether it is affordable.**

One caveat: the reference's `STP` and `ETP` are *plant types within water*, not
siblings of `electrical`. Whether they are two more rows in `asset_domains` or a
level below `water` is a modelling question the E5.1 ADR should settle — it is
the same parent/child question ADR 0018 deferred for locations.

### 4.4 The reference ladder is Critical / High / Warning — we have no `high`, and the two places that handle severity break differently

The legend on page 9 names five states: **Normal · Warning · High · Critical ·
Offline** (plus *Standby*, used for DG Sets). Every alarm row on both pages uses
**Critical / High / Warning**.

Measured on the running database:

```
alarms|warning|20    alarms|critical|19    alarms|info|1
rules |critical|46   rules |warning|42     rules |<NULL>|1
```

We use **`info` / `warning` / `critical`**. There is no `high`, and `info` does
not appear in the reference at all.

The column itself is open — `varchar(32)`, no CHECK, `z.string()` in the
contracts — so the *database* would accept `high` today. **The frontend would
not**, and the two places that handle severity fail differently. Both were
traced rather than inferred.

**The rule builder writes the wrong value back.**
`apps/web/src/components/rule-builder-panel.tsx`:

```ts
:530   severity: normalizeSeverity(rule.severity),   // seeds the form on load
:486   severity: form.severity,                      // create payload
:506   severity: form.severity,                      // update payload

:539   function normalizeSeverity(value: string | null): "info" | "warning" | "critical" {
         if (value === "info" || value === "critical") {
           return value;
         }
         return "warning";
       }
```

The form is seeded through `normalizeSeverity` and the save sends `form.severity`
straight back. So opening a rule whose severity is anything outside
`info | warning | critical` and saving **any unrelated field** persists
`warning`. That is not "the same class as" `F4.44` — it is `F4.44`: a `<select>`
whose options are a hardcoded union, and a silent reclassification on save.
`F4.43`–`F4.45` closed that for `automation_rules.category` and `assets.domain`
and did not look at `severity`.

**This is live today, independent of the reference.** One rule —
`Weekday energy review window` (`source = operator_rule`) — has
`severity IS NULL`. `normalizeSeverity(null)` returns `"warning"`, so the
builder already shows a severity nobody chose, and saving that rule writes
`warning` into a column that was NULL. The `high` case below is **prospective**:
there is no `high` in the database today.

**The alarms page mis-colours and mis-counts, but does not relabel.**
`apps/web/src/pages/alarms-page.tsx`:

```ts
:54    function severityTone(severity: string): "critical" | "warning" | "info" {
         if (severity === "critical") return "critical";
         if (severity === "warning" || severity === "major") return "warning";
         return "info";
       }

:294   label={a.severity}          // raw string — the text is correct
:295   tone={severityTone(a.severity)}
```

The label renders the raw value, so a `high` alarm would read "high" correctly —
but take the **`info`** tone, the *lowest* rung, and the summary counters
(`:140`) bucket it into **`minor`** via
`!["critical", "warning", "major"].includes(...)`. A High alarm would appear as
the least urgent thing on the page.

**A third drift falls out of reading the two together:** `alarms-page.tsx`
recognises **`major`**, a value that appears in no contract, no schema, and no
row of the database. The two files do not agree on what the vocabulary is.

**Worth a backlog row on its own merits**, before any question of adopting the
reference ladder. And note the asymmetry `F4.45` established: severity is a
**closed** vocabulary — the engine ranks it, styles it, and escalates on it — so
unlike domain and category it wants a CHECK and an exhaustive switch, not a
lookup table.

### 4.5 The palette conflict is real, and it is against both mockups

Worth checking rather than assuming, because `AGENTS.md` §5 names
`ESKOM_SMOC.html` while `AppShell`'s own comment cites `TRINETRA.html`. If the
current-branding mockup were already dark, the conflict would be narrow.

It is not. `TRINETRA.html:12`:

```css
--bg:#F2F4F7;  --sf:#FFF;  --s2:#F7F8FA;  --tx:#1A2230;
--hb:#1D2430;  /* dark top bar */        --g:#00A651;  --gl:#3DCD58;
```

A **light canvas** (`#F2F4F7`) with a dark top bar, green nav and dark status
bar — matching §5's description and matching the running app exactly. Both
mockups are light-canvas; the reference is dark-canvas with neon accents
throughout.

So adopting the reference palette contradicts **the §5 spec, the current
branding mockup, and every shipped page**. That is a §10 scope decision and
belongs to the human, not to an implementation pass.

Worth separating two things that look like one: the reference's **information
density and component vocabulary** (right-hand alarm rail, process diagram,
workflow stepper, health donut) are entirely achievable in the existing light
palette. **Only the canvas colour is gated.** Nothing in §3.1 or §3.2 has to
wait on the theme decision.

---

## 5. Suggested sequence

**Everything below is now a row on the board** — see `docs/BACKLOG.md` §7 for
the mapping. Nothing is started. The first two are gates and both are the
human's.

1. **Decide `temporarilyHiddenModulePaths`** — `F4.47`. One line, and it decides
   whether an operator can reach the process diagram at all. (§4.1)
2. **Decide the two §3.3 questions** — dark canvas yes/no, domain-first IA
   yes/no, both queued in `BACKLOG.md` §5. If either is yes it needs an ADR
   before any code, and a `chore(agents):` pointer from AGENTS.md §5 after.
3. **Fix the severity defect** — `F4.46`, **P0**. The rule builder writes a
   downgraded severity back on save, provable today on the one NULL-severity
   rule, and unrelated to everything above. The fix is a **single defaulting
   rule**, not a patch to `normalizeSeverity`: the API disagrees with itself
   (`?? "warning"` for threshold rules, `?? "info"` for time-window) and the
   builder disagrees with both. (§4.4)
4. **Chase Q2 of the E5.1 mail** — the reference narrows Q1 and gives a starter
   vocabulary, so a reply on **Q2 alone** would now be enough to start the
   flagship. (§4.2)
5. **Sanity-check `F3.28`–`F3.31` against the board** — they were added from a
   keyword search, so confirm none duplicates an existing row before starting
   one.

Items 1–3 are independent of each other and of the water blocker. `F4.48` — the
dashboard leak check — came out of this work but belongs to none of it.
