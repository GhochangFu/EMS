# ADR 0136 — Root-cause suggestions on live alarms (`E2.3`)

## Status

**Accepted — 2026-11-17** (owner, in chat: *"Apart from question 6, it
should be yes. Other than that, all others are accepted."*). Drafted by an
agent for backlog row `E2.3` at the step 2 gate (AGENTS.md §10,
`docs/build-operating-model.md`) and proposed the same day in PR #1379.
**Q1–Q5, Q7 and Q8 are ruled as recommended. Q6 is ruled the other way:
yes**, so an operator can fill the enrichment form's root cause from a
suggestion; decision 6 now says how. Every *(recommended)* line in
the other decisions is therefore a ruling. One line marked *(drafter, after
the ruling)* is the agent's call inside the Q6 answer; see §Rulings.

Builds on [ADR 0034](./0034-alarm-enrichment-schema.md) (`E2.1`, the instance
enrichment), [ADR 0059](./0059-alarm-philosophy-operator-surface.md) (`E2.2`,
the class philosophy and the KB), [ADR 0135](./0135-ml-serving-foundation.md)
Amendment 5 (`E1.2`, advisory anomaly scores), [ADR 0099](./0099-admin-copilot.md)
and [ADR 0090](./0090-onboarding-agent-tool-calling-loop.md) Amendment 1 (the
LLM path), [ADR 0131](./0131-maintenance-windows.md) (maintenance cover) and
[ADR 0030](./0030-shared-api-contracts.md) (contracts). It narrows one line of
ADR 0135 Amendment 5 (decision 7 below, question **Q4**).

## Context

`E2.3` is *"AI-assisted root-cause suggestions on live alarms"* (P2, 4–6
person-weeks, Wave 4). Both dependencies are done: `E2.1` ✅ and `E1.2` ✅.
ADR 0034 decision 6 named it: *"`E2.3` … is what later proposes values into
this same surface."*

**What an operator sees on an alarm today.** `GET /api/v1/alarms/:id/details`
(`apps/api/src/alarms/alarm-details.service.ts`, on `FLEET_DRIZZLE` with a
hand-written organization predicate) feeds `alarm-details-panel.tsx`, which
the *Alarms* page and the alarm-bar popup both render. It shows the alarm, the
threshold beside the current value, the **class philosophy** (`E2.2`: cause,
impact, action, skill — resolved by exact provenance only, so `null` for most
seeded alarms) and the **instance enrichment** (`E2.1`: root cause, impact,
corrective actions, ETR, skill — written by an operator through
`PUT /alarms/:id/enrichment`). Nothing proposes a cause.

**Evidence that already exists in the database, per alarm:**

| Source | Where | What it can say |
|---|---|---|
| Past enrichments | `bms.alarm_enrichments` joined to earlier `bms.alarms` with the same `rule_id` on the same asset | "An operator recorded *X* as the root cause 3 times here before." |
| Related alarms | `bms.alarms` on the same asset, RTU or location, raised shortly before | "A *mains failure* alarm was raised on the same RTU 4 minutes earlier." |
| Device health | `apps/api/src/device-health/device-health.reads.ts` (`readRecentDrops`, `stateOf`) | "The asset's RTU dropped off-line before the alarm." |
| Maintenance cover | `apps/api/src/alarms/maintenance-cover.reads.ts` (ADR 0131) | "A maintenance window on this asset ended 10 minutes before the alarm." |
| Class philosophy | ADR 0059, already on the panel | "Engineering's note for this class: *cause*." |
| Anomaly scores | `ml.anomaly_scores` via `apps/api/src/ml/ml-anomalies.reads.ts` | "The asset's readings were unusual in the hours before the alarm." |

**The anomaly scores are not yet calibrated.** On the demo host, after 8
scored hours, `baseline_mad` marked **7.09 %** of asset-hours as unusual
(score ≥ 0.99, `ANOMALY_UNUSUAL_SCORE`), where the design expected about 1 %;
`isolation_forest` was at **1.39 %**. The owner's one-week read is due about
**2026-11-23**, and no threshold changes before the owner rules. So a single
`baseline_mad` mark is close to noise today: at 7 % an asset gets one most
days. The Isolation Forest runs only on assets with two or more scored points
(10 of 38). Simulated assets have no scores at all.

**ADR 0135 Amendment 5 forbids anomalies in alarm surfaces.** It says: *"No
anomaly reaches an alarm, a notification, a report, an export or a copilot
answer."* Showing a score as context on the alarm panel is not "raising an
alarm", but it does put a score on an alarm surface, so it needs an explicit
ruling (Q4) rather than a reading of the words.

**The LLM path exists, and it is admin-only.** `apps/api/src/llm/` has one
provider port (`LlmProvider.complete`, Anthropic / OpenAI / OpenRouter
adapters) and one choke point, `LlmResolver.resolveForOrganization`, which
picks the organization's own encrypted key, else the platform key, else
*guided mode* (no model). The copilot (ADR 0099) is offered only to the four
administrator roles, behind an organization switch that starts **off**.
Operators and viewers have no LLM feature: AGENTS.md §6 still holds
*"General site-wide AI Copilot … for operators and viewers"*. Usage is counted
in **turns per day** (`bms.copilot_usage`, `bms.copilot_org_usage`), not
tokens. Tests use hand-written fake `LlmProvider` objects; there is no live
model in CI. ADR 0135 decision 1 (*no hosted model API*) governs the ML
scoring stack, not the copilot.

**The demo host is small.** A t4g.large (2 vCPU, 8 GiB) shared by every
service; the `ml` container is capped at 1 vCPU / 1 GiB and its hourly cycle
measured 39.4 s and 674.7 MiB on 2026-11-17 (ADR 0135 Amendment 5).

## Decision

1. **The suggestion comes from deterministic rules over evidence already in
   the database — no LLM in this ADR** *(recommended, **Q1**, **Q2**)*. A pure
   function, `rankRootCauseCandidates(evidence) → candidates`, turns the
   evidence table above into at most **3 candidate causes**, each with the
   evidence items that support it. The "AI" in the row is the anomaly
   detector's context plus learning from what operators recorded before; the
   ranking itself is explainable rules, so every line on screen can be traced
   to a row. An LLM narrative is deferred to a later amendment (decision 9).

2. **The candidate rules** *(recommended; exact windows are the plan's,
   within these bounds)*:

   | # | Candidate | When | Strength |
   |---|---|---|---|
   | R1 | *Maintenance on this asset* | A window covered the asset within 60 min before `raised_at` | strong |
   | R2 | *Communication or power loss at RTU <name>* | The asset's RTU dropped or went silent within 60 min before `raised_at` | strong |
   | R3 | *Linked to <other alarm>* | Another alarm on the same asset or RTU raised within 30 min before | moderate |
   | R3b | — same, same location only | | weak |
   | R4 | *Recorded before: "<root cause text>"* | Earlier alarms of the same `rule_id` on the same asset, last 180 days, with an enrichment `root_cause`; identical text (trimmed, case-folded) grouped and counted | moderate at ≥ 2, weak at 1 |
   | R5 | *Class cause: "<philosophy.cause>"* | The class philosophy resolves (ADR 0059 decision 3) | weak |

   - **Strength is a word, never a number or a percentage.** There is no
     calibrated probability behind it, and a percentage would read as one.
     Order: strength, then the most recent evidence.
   - **Nothing is invented.** A candidate's text is either a fixed phrase
     naming a real row (R1–R3) or text a person wrote (R4 an operator, R5 an
     engineer), quoted and attributed to its kind (never to a named user).
   - **No candidate → the block says so** ("No likely cause found in the
     data."), rather than showing a guess.

3. **Anomaly scores are context only, with zero weight** *(recommended,
   **Q3**)*. The block may show one context line — *"Readings on this asset
   were unusual in the 6 h before the alarm (advisory, detector …, points …)"*
   — when `ml.anomaly_scores` holds a row ≥ `ANOMALY_UNUSUAL_SCORE` for the
   asset in that window. It **never creates a candidate and never raises a
   candidate's strength**, whichever detector marked it and however many
   marks there are. Reasons: the baseline flags 7.09 % of hours today; the
   threshold is frozen until the owner's one-week read; and a lone
   `baseline_mad` mark must not read as strong evidence. The threshold is
   imported from `packages/shared` (`ANOMALY_UNUSUAL_SCORE`), never restated
   or changed here. Giving scores weight later needs an amendment, after the
   owner has ruled on the threshold.

4. **Computed at read time; no new table, no migration** *(recommended,
   **Q7**)*. A new route, `GET /api/v1/alarms/:id/root-cause-suggestions`, in
   `apps/api/src/alarms/`, returns
   `{ computedAt, candidates[], context[] }`. Its contract lives in
   `packages/shared/src/contracts/alarm-root-cause.ts`, types by `z.infer`
   (ADR 0030). A separate route, not a new block on `/details`, so a slow or
   failed suggestion never delays or breaks the panel. Nothing is stored:
   the operator's saved enrichment is already the record of what they
   decided. The answer can change as new rows arrive; `computedAt` says when
   it was made.

5. **Grants and scope: nothing new** *(recommended)*.
   - Same access as `/details`: the caller's `readableAssetIds` must hold
     the alarm's asset, else a 404 ("not found or outside your access
     scope"), exactly as `AlarmDetailsService.get` answers today.
   - Reads on `bms.*` run on `FLEET_DRIZZLE` (`bms_fleet`, `BYPASSRLS`), so
     **every query carries the alarm's `organization_id` by hand**, as
     ADR 0059 decision 9 requires. No evidence row from another organization
     can reach the answer; an integration test proves it with a two-tenant
     fixture.
   - The anomaly read reuses `ml-anomalies.reads.ts` under `withReadScope`
     (`bms_tenant`, which already holds `SELECT` on `ml.anomaly_scores` from
     migration `0160`). No grant changes; `bms_auth` gets nothing.
   - Every query is bounded by a time window and a row cap (R4: 50 rows;
     R3: 20 rows) and served by existing indexes; the plan shows `EXPLAIN`
     for each and adds an index only if one shows a need.

6. **How it is shown: advisory, on the alarm details panel only**
   *(recommended, **Q5**, **Q6**)*.
   - A **"Possible causes — advisory"** section on `alarm-details-panel.tsx`,
     between the class philosophy and the enrichment form, so both the
     *Alarms* page and the alarm-bar popup get it. It loads after the panel.
   - Each candidate shows its text, its strength word and its evidence, each
     linking where it can (the related alarm, the RTU's drop history,
     the asset history at that hour, the KB entry).
   - It carries an *Advisory* pill and the line *"Suggestions from past
     records and live data. Not a diagnosis — check on site."* It uses the
     `ink` role, never an alarm or severity colour (as anomaly marks do,
     AGENTS.md §5).
   - **Everyone who can open the alarm sees it, `viewer` included**, as
     ADR 0059 Q0b did for the class philosophy. It is read-only.
   - **A "Use as root cause" button fills the form, and the operator still
     saves** *(owner, 2026-11-17, Q6: yes)*. This is ADR 0034 decision 6's
     "proposes values into this same surface", done by the operator's click:
     - It fills **only the `root_cause` field** of the enrichment form in the
       browser. It sends no request. Nothing is written until the operator
       presses the form's existing **Save**: `PUT /alarms/:id/enrichment`,
       with its `assertOperationsWriteRole` gate and its audit row
       (`updated_by` = the operator). The text stays editable before saving.
     - If the field already holds text, the button asks before it replaces it.
       It never appends, and it never fills a field silently.
     - It is shown only where the form is shown, so a `viewer` (who has no
       form) sees the suggestions and no button.
     - It does not fill skill, impact, corrective actions, ETR or affected
       assets. Nothing records that a suggestion was used (Q7: no storage).
     - **R5 (the class cause) has no button** *(drafter, after the ruling)*.
       Filling an instance root cause from class text is exactly what
       ADR 0059 Q1 refused, and Q6 did not name ADR 0059. So that ruling
       stands for R5, and R1–R4 carry the button. The owner may widen this
       by a one-line amendment.
   - **Not shown anywhere else:** not on the Active Alarms rail or list rows,
     not in a notification, work order, report, export, or copilot answer.

7. **The one change to ADR 0135 Amendment 5** *(recommended, **Q4**)*. Its
   line *"No anomaly reaches an alarm … or a copilot answer"* gains one
   exception: decision 3's context line on the alarm details panel. A score
   still raises no alarm, sends no notification, opens no work order, and is
   in no report, export or copilot answer. An `Amendment 6` pointer
   paragraph is added to ADR 0135 when this ADR is accepted, so a reader of
   ADR 0135 finds the exception.

8. **Budget on the demo host** *(recommended)*. The work runs in the
   existing API process, on request only (when a panel opens), as about six
   bounded, indexed queries and a pure ranking step. Target: p95 under
   150 ms on the demo host, checked there after deploy. **No new process,
   container, queue, Python code or dependency; the `ml` container and its
   1 vCPU / 1 GiB limit are untouched.** No LLM call means no per-call cost.
   The existing API rate limits (ADR 0125) apply.

9. **The LLM narrative is deferred, and these are its rules when it comes**
   *(recommended, **Q2**)*. If the owner later wants an LLM to word the
   suggestion, it needs its own amendment of this ADR, after the owner has
   seen a week of decision 2's output on the demo host. That amendment must
   keep at least these rules, stated now so the egress question is answered
   up front:
   - **What leaves the host:** only the suggestion DTO of decision 4 (the
     candidate texts, strength words, evidence kinds and times, the alarm's
     message, severity, asset class and point keys), after
     `scrubToolResult`; never raw rows, user names or e-mail addresses, RTU
     credentials or keys, or anything outside the alarm's organization.
     Operator free text (R4) goes only if the owner rules it may.
   - **Which key and switch:** `LlmResolver.resolveForOrganization` for the
     alarm's organization, and only when that organization's copilot switch
     is on; guided mode means no narrative. Who may press it, and whether
     that breaks the §6 line on operators and viewers, is that amendment's
     question.
   - **What the model may do:** reword and order the given candidates only;
     a reply naming a cause not in the list is discarded. On demand only
     (a button), never per alarm in the background.
   - **Cost:** counted in the copilot's daily turns, or a new counter if the
     owner rules so.
   - **Tests:** a fake `LlmProvider` in specs, as `agent-loop.spec.ts` and
     the onboarding loop do; no live model in CI.

10. **Testing without a live LLM** — there is no LLM in this ADR, so nothing
    is mocked for one:
    - **Unit (Vitest, `.spec.ts`):** `rankRootCauseCandidates` against fixed
      evidence fixtures, one per rule and per edge — no evidence, ties,
      the 3-candidate cap, R4 grouping, and **anomaly rows of every kind
      changing no candidate and no strength** (the Q3 guarantee as a test).
    - **Contract:** the response schema's spec in `packages/shared`.
    - **Integration (Postgres):** the route against seeded alarms,
      enrichments, an RTU drop, a maintenance window and `ml.anomaly_scores`
      rows; a second tenant's rows never appear; an out-of-scope alarm is
      the same 404 as `/details`.
    - **Web (jsdom):** the section renders the advisory pill, the
      disclaimer, the strength words, the "no likely cause" state, a failed
      load that leaves the rest of the panel working, and no alarm colour.
      The Q6 button: a click fills `root_cause` and sends no request until
      Save; existing text asks before it is replaced; a `viewer` sees no
      button; an R5 candidate has no button.
    - **Browser and demo host:** sent to `browser-verifier` and to the
      owner's demo-host checklist; see §Consequences.

11. **Out of scope, named so it stays out:** an LLM call of any kind
    (decision 9); storing suggestions or operator feedback (👍/👎); an
    accuracy figure; anomaly scores with weight (decision 3); a new
    threshold; suggestions in notifications, the alarm list or rail, work
    orders, reports, exports or the copilot; a copilot read tool for them;
    filling the enrichment **without** the operator's click and Save, or
    filling any field other than `root_cause` (decision 6); cross-organization
    learning; a new Python job.

## Dependencies

None. No npm or Python package, no new app or module (the route sits in
`apps/api/src/alarms/`), no migration, no environment variable.

## Consequences

- **Smaller than the row's estimate.** 4–6 assumed an ML or LLM build. This
  design is about **2–3**: one API PR (contract, pure ranking, route, tests)
  and one web PR (the panel section and the Q6 button), plus the closure. The plan confirms the
  split.
- **Coverage depends on data, honestly.** R4 needs earlier operator-written
  root causes; the demo database has few, so R4 is often empty at first and
  grows as operators fill enrichments. R5 is `null` for most seeded alarms
  (ADR 0059 §Consequences). R1–R3 work on any alarm. The integration fixture
  therefore builds every rule's evidence, or the suite would only prove that
  "no likely cause" renders.
- **The rules are simple on purpose.** They will miss causes an engineer
  would see. The block says *advisory* and *not a diagnosis* for that reason.
- **The panel grows again.** It is already the densest component in
  `apps/web`; the section is collapsible and loads after the rest.
- **Demo-host checks the owner runs after deploy** (this session cannot reach
  the host): open three alarms (one with an RTU drop, one under a recent
  window, one with neither) and check the section, its pill and its
  "no likely cause" state; as an operator, press "Use as root cause", check
  the form fills and nothing saves until Save; time the route (p95 < 150 ms);
  confirm the `ml` container's `docker stats` is unchanged.
- **Follow-ups owed after the build** (separate `chore(agents):` PR,
  §9.10/§10.1): AGENTS.md §3 *Layout* (the new route and contract) and §4.8
  (the contract). Queued in `docs/BACKLOG.md` §5 at closure. **Not a §6
  promotion**: no LLM reaches operators or viewers.

## Open questions for the owner (all ruled 2026-11-17)

Each had a recommended answer. The owner accepted every recommendation except
**Q6**, which was ruled **yes** (see §Rulings and decision 6).

1. **Q1 — Where does the suggestion come from?** Options: (a) rules over
   existing evidence (maintenance, RTU health, related alarms, past
   enrichments, class philosophy), with anomaly scores as context only;
   (b) an LLM over the same evidence; (c) both now.
   **Recommended: (a)** — explainable, no data leaves the host, no cost, and
   testable without a model. *(Decisions 1–2.)*
2. **Q2 — An LLM narrative now, or later?** **Recommended: later**, by an
   amendment after a week of (a) on the demo host, under decision 9's rules.
   If you want it now, say so and this ADR gains that amendment before the
   plan; it then also needs a ruling on who may press the button (the §6
   operator/viewer line).
3. **Q3 — How much weight do anomaly scores get?** Options: (a) context
   only, zero weight; (b) a "weak" point when **both** detectors mark the
   same hour; (c) any mark counts. **Recommended: (a)** until your one-week
   read (~2026-11-23) and any threshold ruling. (c) is ruled out by the
   7.09 % figure.
4. **Q4 — May an anomaly context line appear on the alarm details panel?**
   This is an exception to ADR 0135 Amendment 5. **Recommended: yes, that
   panel only**, labelled advisory, zero weight; everything else in that
   line stays forbidden. If no, decision 3's context line is dropped and the
   rest stands.
5. **Q5 — Who sees the suggestions?** **Recommended: everyone who can open
   the alarm, `viewer` included**, read-only (as ADR 0059 Q0b).
6. **Q6 — A "use this" button that fills the enrichment form?**
   Recommended: no, as ADR 0059 Q1. **Ruled: yes** (decision 6).
7. **Q7 — Store suggestions or feedback?** **Recommended: no** — computed at
   read time, no table, no migration. A feedback table is a follow-up with
   its own migration if you want accuracy data later.
8. **Q8 — A new ADR, or an ADR 0135 amendment?** **Recommended: this new
   ADR 0136**, plus a short pointer paragraph in ADR 0135 for decision 7.
   E2.3 is an alarm feature that reads ML output, not a change to the ML
   service.

## Rulings

| # | Question | Ruling (owner, 2026-11-17) |
|---|----------|----------------------------|
| **Q1** | Where suggestions come from | **As recommended:** rules over existing evidence; anomaly scores as context |
| **Q2** | LLM narrative now or later | **As recommended:** later, by an amendment under decision 9 |
| **Q3** | Anomaly weight | **As recommended:** context only, zero weight |
| **Q4** | Anomaly context line on the alarm panel | **As recommended:** yes, that panel only (ADR 0135 Amendment 6 pointer) |
| **Q5** | Who sees suggestions | **As recommended:** everyone who can open the alarm, `viewer` included |
| **Q6** | A button that fills the enrichment form | **Yes**, against the recommendation. Decision 6 says how: `root_cause` only, the operator saves, no button for a `viewer` |
| **Q7** | Store suggestions or feedback | **As recommended:** no |
| **Q8** | New ADR or ADR 0135 amendment | **As recommended:** this ADR, plus the pointer in ADR 0135 |

**Drafter call inside Q6, flagged for the owner:** R5 (class cause) has no
fill button, so ADR 0059 Q1 still stands for class text. Say so if the
button should reach R5 too.
