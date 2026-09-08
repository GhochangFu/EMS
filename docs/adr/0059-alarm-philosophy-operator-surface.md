# ADR 0059 — The alarm philosophy reaches the operator (`E2.2`)

## Status

Accepted — 2026-09-08, by the repository owner, at `E2.2`'s start gate
(AGENTS.md §10 step 2). Six rulings, asked one at a time and recorded verbatim
in §Rulings. **Two of them widened the row**: the owner read "KB" as *both* an
operator block and a browsable surface, so this ADR ships as **two pull requests
on one ADR**, and the backlog's 3–4 estimate no longer holds.

## Context

`E2.2` is the backlog's *"template-driven alarm philosophy KB per asset class"*.
Its two dependencies are `✅` — `E1.7` (ADR 0019) shipped the content model and
`E2.1` (ADR 0034) shipped the enrichment schema — and it is the only P1 row in
Track D whose dependencies are all met.

**The content exists and nothing operator-facing reads it.** ADR 0019 put four
optional free-text fields on a template's alarm definition —
`content.alarms[].philosophy.{cause, impact, action, skill}`
(`packages/shared/src/asset-template-content.ts:88`, validated by
`alarmPhilosophySchema`). ADR 0034 bound `skill` to `bms.alarm_skills` and left
the other three as free text. The three domain packs authored under ADR 0040,
0053 and 0054 populate them across the water, mechanical and facility classes.
ADR 0019 said of that section, in as many words, *"nothing on `main` reads it."*

That sentence is no longer quite true, and the way it stopped being true is what
makes this row cheap now:

- **`E2.4` (ADR 0058, merged 2026-09-07) built the join.** Migration `0067`
  added `source_template_id`, `source_template_version`, `source_alarm_code` and
  `seeded_baseline` to `bms.automation_rules`. A rule seeded from a template
  alarm now names the exact `TemplateAlarm` entry it came from.
- **But what it built is not this row.** ADR 0058 §Consequences states the
  boundary: *"`E2.2` is untouched. This row wires the *rule* side; `E2.2`
  (template-driven alarm philosophy KB) remains the knowledge side, and the two
  meet only in `content.alarms[].philosophy`, which both read."*
- The only place the philosophy reaches a human today is
  `philosophyDescription()`
  (`apps/api/src/admin/asset-templates/template-alarm-rules.ts:187`), which
  flattens the four fields into one prose blob —
  `Cause: … / Impact: … / Action: … / Skill: …` — writes it to the seeded
  rule's `description`, and clamps it at 2000 characters with an ellipsis
  because `ruleUpdateBodySchema` would otherwise make the row un-`PATCH`able.
  That function's own comment says where the real text lives: *"The full text
  stays on the template, which is its home; the ellipsis says the rule's copy is
  short."*

So an operator looking at a live alarm sees, at best, a truncated prose copy on
a rule screen they may never open. The four fields are not structured, not
labelled, and not resolved — `skill` renders as its raw code because
`philosophyDescription` does no IO.

**What the operator surface already has.** `GET /api/v1/alarms/:id/details`
(`AlarmDetailsService`, ADR 0034 decision 5) composes the alarm, its asset, its
location, the threshold pairing, the latest reading, and the *instance*
enrichment from `bms.alarm_enrichments`.
`apps/web/src/components/alarm-details-panel.tsx` renders it, with the write
form hidden for `viewer`.

**What the authoring surface already has.** The template authoring screen's
Alarms tab (ADR 0038) reads and writes these same rows — but it is gated to the
master-data roles, so the operator and the technician cannot open it. That gate
is why the browsable half of this row is not the duplicate it first appears to
be: the content is browsable *for authors* and reachable by nobody else.

**The boundary this ADR must not blur.** `alarm_enrichments` carries
`root_cause`, `impact`, `corrective_actions` and `skill_code`, which map one to
one onto `philosophy.{cause, impact, action, skill}`. They are not the same
thing and ADR 0034 §Context drew the line: a philosophy describes an **asset
class**, an enrichment describes **this alarm instance**. The class text is what
engineering decided about pumps; the instance text is what happened at 14:02 to
pump 3. Merging them, or prefilling one from the other, destroys the
distinction that made two homes correct in the first place.

## Decision

1. **Two surfaces, two pull requests, one ADR** (ruling **Q0**). PR 1 is the
   operator block on the alarm details panel; PR 2 is the browsable knowledge
   base. The same pattern `E5.1`–`E5.3` and `E2.4` used. **No new table and no
   migration in either**: the philosophy is already stored in
   `bms.asset_templates.content`, and a KB with its own table would be a second
   copy that drifts from the template the moment an author edits one.

2. **PR 1 — `GET /api/v1/alarms/:id/details` gains a `classPhilosophy` block**
   beside the `enrichment` block it already returns. No new endpoint: the read
   that composes this panel already exists and already joins five tables.

3. **PR 1 resolution is by exact provenance only, and there is no fallback.**
   The chain is `alarms.rule_id` → `automation_rules.source_template_id` +
   `source_alarm_code` → that row's `content.alarms[]` entry whose `code`
   matches. When either link is absent, `classPhilosophy` is `null`.

   **Two columns, not three.** A row in `bms.asset_templates` *is* a version
   (ADR 0015, restated by the schema comment on `assets.template_id`), so
   `source_template_id` is already version-precise and adding
   `source_template_version` to the predicate would be a redundant match that
   only looks stricter. That column is denormalized for display and for
   `E2.4`'s drift attribution: the panel **shows** it, the lookup does not use
   it.

   **`bms.alarms` carries no alarm code**, so this is the only exact path. The
   rejected alternative was matching `automation_rules.point_key` against a
   template alarm's `pointKey` when provenance is NULL. That is a guess: one
   point key carries several alarms at different thresholds, and showing an
   operator the wrong class philosophy under a confident heading is worse than
   showing none. §Consequences states how much of the fleet this leaves at
   `null`.

4. **PR 2 — a browsable knowledge base, one entry per asset class**, listing
   that class's alarm philosophy rows. A new route under the operations side of
   the app, not under the admin/template screens, and a new read-only list
   endpoint over `bms.asset_templates`.

   - **It shows the current published version per template `code`** (ruling
     **Q0a**) — one row per asset class, what engineering says today. Not every
     published version, which multiplies the list by version count and reads as
     an archive; not only the versions the fleet pins, which hides a newly
     published class from the engineer who most wants to read it.
   - **Every signed-in user who can see alarms may open it, `viewer`
     included**, scoped to the caller's organization (ruling **Q0b**). It does
     **not** reuse `isMasterDataRole`. A `viewer` already reads these same four
     fields on the alarm panel under decision 2, so gating the KB would refuse
     in one place what the product hands out in another. This is a deliberate
     widening of who reads template content, and it is stated here rather than
     discovered later.
   - **An alarm entry the current published version does not carry is absent
     from the KB, and that absence is not an error.** This is ruling **Q2**'s
     second limb seen from the other side, and it is stated here because the
     two rulings meet in a case neither names on its own: a rule pinned to an
     older version keeps showing its philosophy on the panel (decision 6),
     while the KB lists only what the current version declares. So a class
     whose alarm entry was dropped in a later version appears on the panel and
     **not** in the KB. That is each surface answering its own question — the
     KB says what engineering states **now**, the panel says what this alarm
     was **seeded from**. Neither reports the other's absence, and PR 2 builds
     no cross-check: a diff between two template versions is `E2.4`'s drift
     job, not this row's.
   - The screen names the template and version each entry comes from, for the
     same reason decision 6 does.

5. **Read-only on both surfaces. Nothing prefills the enrichment, and there is
   no copy button** (ruling **Q1**). The panel renders the class philosophy
   beside the instance enrichment, each under its own heading, with the class
   block visibly labelled as class-level. An operator who wants the text reads
   it beside the form. A copy action would make instance text a copy of class
   text, so the ADR 0034 boundary would survive in the schema and die in the
   data; it also adds a write path and an audit question to a read row. If
   operators ask for it, it is a follow-up row, not an amendment.

6. **A pinned version is shown unchanged, even when archived or superseded**
   (ruling **Q2**). `source_template_id` pins the version the rule was seeded
   from, and `assets.template_id` already follows the same discipline —
   *"publishing a newer version never touches it"*. The block names its template
   and version, so the operator can see the text is historic. Hiding it would
   make the panel go blank for a reason unrelated to the alarm, and would let
   archiving a template silently change an alarm screen.

   **The two surfaces can therefore disagree, and that is correct.** PR 2 shows
   the current published version (decision 4); PR 1 shows the pinned one. Each
   names its version, so a reader can see which they are looking at. No
   cross-surface warning is built — "superseded" would need a definition
   covering archived, newer-published and code-dropped, which is three checks
   for a case nobody has met.

7. **`skill` resolves to its label.** `philosophy.skill` is a code into
   `bms.alarm_skills` (ADR 0034). Both reads resolve it to the label, the same
   way the panel's existing `alarmSkillLabel` resolves the enrichment's
   `skill_code`. An inactive skill still resolves — retirement is
   `active = false`, and a historic philosophy must stay readable.

8. **The contracts live in `packages/shared/src/contracts/` (ADR 0030).**
   `alarmDetailsResponseSchema` gains
   `classPhilosophy: z.object({ templateId, templateVersion, templateName,
   alarmCode, cause, impact, action, skillCode, skillLabel }).nullable()`,
   with the four text fields individually nullable. PR 2 adds its own list
   response schema reusing the same philosophy object. Both response types are
   `z.infer`red, so the web types follow without a second declaration.

9. **Both template reads carry an explicit organization predicate.**
   `AlarmDetailsService` runs on `FLEET_DRIZZLE`, which is `bms_fleet` and
   carries `BYPASSRLS` — RLS gives these reads nothing. The join to
   `asset_templates` must carry
   `eq(assetTemplates.organizationId, <the caller's org>)` written by hand: in
   PR 1 that is the `organizationId` the existing query already selects from
   `locations`; in PR 2 it is the caller's tenant. A template from another
   tenant must not be reachable through an alarm id or through the KB list.

10. **The rule's `description` is unchanged, and the template is
    authoritative.** `philosophyDescription()` keeps writing its truncated prose
    copy at instantiate. `E2.2` does not edit, remove or reconcile it. Where the
    two disagree — the rule's copy is stale, or short because the clamp cut it —
    the template version named by `source_template_version` is the authority,
    and the panel shows that full text. Stated so the difference is recorded as
    a decision rather than filed later as a duplication defect.

11. **Out of scope, and named so it stays out.**
    - The three enrichment fields a template cannot carry — affected assets,
      energy/water/production impact, ETR. ADR 0034 put them off the template
      contract **permanently**, not until a consumer exists. Do not add them.
    - Editing philosophy content from either new surface. Authoring stays in the
      template screen's Alarms tab (ADR 0038); both surfaces here are reads.
    - Template *maintenance* content reaching a running object. That is `E3.x`
      with its own ADR, and AGENTS.md §6 still holds it.
    - Any change to how `E2.4` seeds, re-applies or reports drift on rules.

## Dependencies

None. No new npm package, no new module, no migration, no new environment
variable.

## Consequences

**The backlog's effort estimate is wrong and must be corrected.** The row
records 3–4 against a one-surface reading. Two surfaces is **6–8**: PR 1 is the
3–4 the row estimated, and PR 2 adds a route, a list endpoint, a contract and a
screen. The correction lands in the `chore(agents):` change named below, before
the build starts (ruling **Q3**).

**PR 1's coverage is genuinely partial on today's data, and this is the honest
number.** `classPhilosophy` resolves to `null` for every alarm whose rule has
NULL provenance, which is:

- every rule written before migration `0067` (2026-09-07) — that is every rule
  on `main` except those seeded since;
- every operator-authored rule;
- every rule made by `duplicateRule`, which leaves provenance NULL on purpose
  (`alarms-schema.ts:229` — *"a duplicate is an operator rule, and its
  provenance stays NULL too"*);
- every alarm on an asset with `assets.template_id` NULL, which the schema
  comment notes is **every seeded asset**.

On the seeded demo database that block therefore renders `null` almost
everywhere. That is a property of the data, not a defect in the design, and it
improves on its own as templates get instantiated. **PR 1's verification needs a
fixture with a genuinely template-seeded rule**, or it proves nothing: a green
suite over the seed alone would only show that `null` renders as absence.

**PR 2 has no such limit, and that is the strongest argument for the owner's
Q0 ruling.** The KB reads published templates directly, so it shows the three
domain packs' authored philosophy on day one, with no dependence on provenance,
instantiation or seeding. The two halves fail in opposite conditions, which is
why shipping only PR 1 would have made the row look thin on the current data.

**Positive.** The four fields three domain packs have been authoring since
`E5.1` finally reach the people the alarms are for — at the alarm, and as a
reference. The panel read costs one join on a query that already joins five
tables. Nothing is copied, so nothing drifts.

**Negative.** Two blocks of near-identical headings sit on one panel — class
cause beside instance root cause, class action beside corrective actions. That
is the ADR 0034 boundary made visible, and it needs decision 5's labelling or it
reads as a bug. The panel grows, and it is already the densest component in
`apps/web`. Decision 4 also widens who reads template content, which is a real
change to the product's read surface and not merely a screen.

**Neutral.** `E2.2` closes without touching the template contract, so ADR 0019's
fifth and last reopening (`alarms.philosophy` under `E2.1`) stays closed. The
row needs no promotion out of AGENTS.md §6 — that bullet left the closed list
under ADR 0034 and both surfaces here are consumers over already-promoted
content.

## Rulings

Six questions, asked one at a time at the step 2 gate on 2026-09-08. The first
three were opened by the answer to the first.

| # | Question | Ruling |
|---|----------|--------|
| **Q0** | Does "KB" mean a panel block or a browsable knowledge base? | **Both, as two PRs on one ADR.** Declines the recommendation, which was the panel block alone. |
| **Q0a** | Which template versions does the KB list? | **The current published version per `code`** — one row per asset class. |
| **Q0b** | Who may open the KB screen? | **Anyone who can see alarms, `viewer` included**, org-scoped. Not `isMasterDataRole`. |
| **Q1** | An explicit copy-to-enrichment button? | **No.** A read row stays a read row. |
| **Q2** | An archived or superseded pinned version? | **Show it unchanged**, named with its version. |
| **Q3** | When do the documentation corrections land? | **One `chore(agents):` PR now**, before the build. |

## Follow-ups this ADR does not perform

Four documentation corrections are owed, and ruling **Q3** puts them in a
separate `chore(agents):` change **before the build starts** (AGENTS.md §9.10):

1. **`AGENTS.md` §6, the `alarms.philosophy` bullet** still reads *"no
   `automation_rules` row links back to the `TemplateAlarm` it may have come
   from"*. Migration `0067` added `source_alarm_code`; the sentence has been
   false since 2026-09-07, and this ADR had to work around it while drafting.
2. **`docs/BACKLOG.md` §1a (line 308)** still lists `E2.2` as blocked because
   `E2.1` is `⬜`. `E2.1` has been `✅` since 2026-08-19.
3. **`docs/BACKLOG.md` §1b** gives `E2.2` no slot; slot 9's Track D entry is
   `E2.1`, which is closed.
4. **`E2.2`'s effort estimate** reads 3–4 and must become **6–8** — see
   §Consequences. The row's one-line description should also say the KB is two
   surfaces, so the next reader does not re-derive Q0.
