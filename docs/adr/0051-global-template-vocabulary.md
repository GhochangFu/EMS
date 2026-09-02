# ADR 0051 — The global template vocabulary: a template may name only what the platform guarantees everywhere

## Status

Accepted — 2026-09-01, by the repository owner, at the
`build-operating-model.md` step 2 gate.

**Decision 1 is the owner's own ruling of the same day**, given in these words:
*"template should be such that they can be used across organizations already
have and for the future orgs as well."* Decisions 2–7 are what that requirement
forces on the schema, and they were accepted together with it.

## Context

`F3.36` (ADR 0049) shipped section dashboard templates: an administrator
imports one of six stock templates, publishes it, and instantiates it against an
asset group. A template does not name assets. It names an **`assetRoleCode`**
and a **`pointKey`**, and the resolver matches those against the group's members
at instantiation. That indirection is the whole reason one template can serve
many sites.

`F3.38` then found that **no stock template could resolve a single bound widget
for any organization**, on two independent counts: all eight `pointKey` values
in the catalog were camelCase names present in no vocabulary, and
`bms.asset_group_members.role` was NULL in every row of the database. `F3.38`
repairs both. It does not answer the question the owner raised on reading it,
which is larger than either bug and is decision 1 above.

A template names four things. **Three are already global; one is not.**

| Named by a template | Where it lives | Global today |
| --- | --- | --- |
| section code | `bms.dashboard_sections` | Yes — ADR 0049 Amendment 2 decision 5 |
| `assetRoleCode` | `bms.asset_roles`, 26 codes, FK from the junction | Yes — ADR 0049 decision 5 |
| metric `catalogKey` | source (ADR 0048) | Yes |
| **`pointKey`** | **`bms.point_keys`** | **No — per organization** |

Four facts, measured on the running stack on 2026-09-01 rather than inferred.

**1. `bms.point_keys` is tenant-scoped.** `organization_id` NOT NULL, unique on
`(organization_id, code)`, `tenant_isolation` with FORCE. ESKOM holds 34 codes
and PHEWB 15.

**2. The two vocabularies are nested, not conflicting.** PHEWB's 15 codes are a
subset of ESKOM's 34; the 19 extras are ESKOM-only, and no code carries two
meanings across the tenants. A merge into one global vocabulary is therefore
**non-lossy** — the union is 34 codes and nothing must be renamed or dropped.

**3. `bms.asset_points.point_key` has no foreign key.** It is a plain
`varchar(128)`. Nothing anywhere checks a registered point against any
vocabulary, in this organization or another.

**4. Because of fact 3, the vocabulary and the registered points have never
agreed.** 492 `asset_points` rows carry 31 distinct keys, and **16 of those
`(organization, key)` pairs exist on assets and in no vocabulary at all** —
every one of them PHEWB's, at 12 assets each:

```
battery_charge_pct  chlorine_pump_on  controller_power_status  frequency_hz
current_ib  current_ir  current_iy  kva  kwh_total  network_strength
voltage_vbn  voltage_vbr  voltage_vrn  voltage_vry  voltage_vyb  voltage_vyn
```

These are PHEWB's **real** pilot points, mapped from the RTU catalog. Meanwhile
the seed writes PHEWB a 15-code vocabulary built from the ESKOM constants, most
of which its assets do not carry. So the per-organization vocabulary is
**decorative**: it is neither a description of what the tenant holds nor a
constraint on what it may register.

Fact 4 is the one that decides this ADR. It is not a seeding oversight to be
patched — it is what an unenforced vocabulary always becomes, and it had gone
unnoticed because nothing ever read the table as a rule.

**The variation the scoping was meant to absorb is already absorbed one layer
down.** `bms.asset_points` carries `source_data_key` — the device's own tag,
`ai1`, `s12_r02` — beside `point_key`, the shared name. That is where a client's
tag naming belongs, and the ingest normaliser already translates between them.
Scoping `point_keys` per organization does the same job a second time at the
wrong level, and does it worse: it lets the **shared** name vary between
tenants, which is exactly the thing a template must be able to rely on.

## Decision

1. **A stock section dashboard template must resolve for every organization,
   existing and future, with no per-organization editing.** It follows that a
   template may name only vocabularies the platform guarantees globally. This is
   the owner's ruling; 2–7 are its consequences.

2. **`bms.point_keys` becomes global.** Drop `organization_id`, its unique
   index, its policy and its FORCE flag; `code` becomes the primary key. It
   joins `bms.alarm_skills`, `bms.asset_roles` and `bms.dashboard_sections` as a
   global vocabulary table — the class migration `0047` deliberately left alone.
   The migration merges to the union of what exists, per fact 2.

3. **Reconcile before constraining.** The 16 orphans of fact 4 are admitted to
   the global vocabulary in the same migration, with their domain and unit. They
   are ordinary three-phase electrical and RTU-health codes that any
   organization may want; nothing about them is PHEWB-specific.

4. **`bms.asset_points.point_key` gains a foreign key** to
   `bms.point_keys(code)`. After this, a point cannot be registered under a name
   the platform does not know, and `F3.38`'s failure class — a name that matches
   nothing and reports nothing — becomes impossible at the database rather than
   detectable by a source scan.

5. **The role vocabulary grows, and gains a write path.** `bms.asset_roles`'
   26 codes name a substation train and do not name the shapes the estate
   actually holds: there is no electrical `meter` and no `pump`, which is why
   PHEWB's two meters and four pumps per site fit nothing. Add the missing
   codes, and add `POST` / `PATCH /api/v1/admin/vocabularies/asset-roles`.
   **Gated to the global `admin` role only** — the table is global and unpoliced,
   so a tenant administrator must not edit fleet-wide master data (the ADR 0046
   reasoning for audit reads, applied to writes).

6. **The stock catalog is keyed by section × plant shape, not section alone.**
   Six templates keyed only by section encode one plant shape and silently
   exclude every other: "electrical" at a 100 kVA substation and "electrical" at
   a village pumping station are different trains, not different clients.
   `electrical-overview` keeps its substation shape and gains a sibling for the
   metered-pumping shape. A new shape is a catalog entry, not a per-tenant fork.

7. **The per-tenant escape hatch stays, and stays an escape hatch.** Importing a
   stock template already creates an editable copy inside one organization
   (`F3.36`). That remains available for a genuinely unique site. It is not the
   answer to a plant shape that will recur — the test is decision 6's: if the
   same edit is made twice for the same reason, the reason is a shape and
   belongs in the catalog.

## Dependencies

None. No new npm package in any workspace.

## Consequences

- **The `F3.38` guard tightens rather than disappears.**
  `tests/f3.38-stock-catalog-vocabulary.test.ts` currently proves a key exists
  in a `*_POINT_KEYS` array. Under decision 4 the database enforces
  registration, so the scan's remaining job is the half a constraint cannot
  reach: that the catalog names a key some asset actually *carries*. Its own
  header already records that limit.

- **`KEYS_AWAITING_A_VOCABULARY` is how this ADR will be seen to land.**
  `flow_rate`, `ph`, `cod` and `dissolved_oxygen` are exempted there because no
  water or process key set exists. This ADR does not create one — that is `E5.1`,
  still blocked on the client — but the exemption is written to fail the day
  those codes appear, which is the signal that the water, STP and ETP templates
  have become resolvable.

- **Decision 2 is a migration on a policied table with live rows**, so it is
  forward-only and needs the `SET ROLE bms_owner` bracket ADR 0045 established.
  Dropping a policy is not reversible by a later migration restoring it: the
  grants must be re-derived. `migration-reviewer` reviews it.

- **Decision 4 will fail on any database whose reconciliation has not run.**
  The constraint must be added in the same migration as decision 3, after it,
  never in a later one — a developer database seeded before this ADR carries the
  16 orphans and the ALTER would abort.

- **Decision 2 removes a tenant boundary, and that must be stated plainly.**
  After it, every organization sees every point-key code. A code is a
  measurement name — `kw`, `voltage_vry` — and names no asset, no site and no
  value, so this discloses nothing about another tenant's estate. The rows that
  do (`bms.asset_points`, `telemetry.point_values`) keep their policies
  unchanged.

- **PHEWB's dashboard is still not delivered by this ADR.** With decisions 3–6
  its meters and pumps become expressible, but which role each fills is a
  reading of the plant that the owner still owes, and the metered-pumping stock
  template of decision 6 is a build.

- **`F3.38` is unaffected and should merge on its own.** It repairs the spelling
  and seeds the ESKOM roles; this ADR stops the class returning. Neither waits
  for the other.

- **Deferred, deliberately.** No per-organization *extension* of the global
  vocabulary is added — a tenant that needs a code the platform lacks asks for
  it, exactly as decision 5's write path allows. Re-introducing per-tenant codes
  would restore fact 1 and with it the defect this ADR exists to close.

## Amendment 1 — onboarding may extend the global catalog, and is refused when the draft contradicts it (2026-09-01)

### Context

Decision 5 gates the asset-role write path to the global `admin` role, and gives
its reason in a sentence that reads wider than the endpoint it was written for:
*"the table is global and unpoliced, so a tenant administrator must not edit
fleet-wide master data."* `F3.39` made `bms.point_keys` a table of exactly that
class. `OnboardingCommitService.commit` writes it at `organization_admin`, on
the tenant connection, inside the wizard's transaction. The `security-reviewer`
sweep run after `F3.39` merged raised the contradiction as a High, and it is
right that the two sentences disagree.

**What had not been measured is the half that decides the correction: what the
shared row governs once it exists.** `telemetry-write.service.ts` resolves a
reading's unit as

```ts
const authoritativeUnit = existingMapping ? existingMapping.unit : catalog.unit;
```

An `asset_points` mapping **shadows** the catalog, so the catalog's unit labels
a reading only where no mapping for that asset and point exists yet. The
exposure is therefore narrow, and real: one organization's declared unit can
relabel or reject **another organization's first reading** for a point it has
not yet mapped, and the affected tenant cannot correct it, because `F3.39`
narrowed the point-key admin surface to the global `admin` role in the same row.
A reader who checks that line must find this record already saying so; it is not
the case that the catalog labels every reading.

Blocking the write is the wrong correction. A code names a quantity — `kw`,
`ph`, `voltage_vry` — not an estate, and refusing a new one at onboarding would
stop a new organization declaring a measurement its plant reads and no existing
tenant does. That is the opposite of decision 1, which is the ruling this whole
ADR exists to serve. What must stop is the **silent** part: the loop reused an
existing row by code and discarded whatever the draft declared beside it.

### Decision

1. **The onboarding commit path may create a global point-key code, at
   `organization_admin`.** Decision 5's ruling is scoped here to what it was
   written for — the vocabulary **admin** endpoints, which stay gated to the
   global `admin` role, unchanged and unbuilt. A tenant administrator still
   cannot *edit* fleet-wide master data. Through onboarding, they may *extend*
   it, under decision 2.

2. **A draft that contradicts an existing code is refused, and nothing is
   inherited silently.** When a draft point key names a code the catalog already
   holds, and declares a `unit` or a `domain` that is not the one on the catalog
   row, the commit fails with a `400` naming the code, the declared value and
   the catalog's. It neither reuses the row nor overwrites it. A draft that
   declares neither field asserts nothing, so it can contradict nothing and
   reuses the row exactly as before.

3. **A catalog field left unset is a conflict, not a gap the draft may fill.**
   Writing a unit onto a NULL is the same escalation as writing over a value:
   every organization shares the row. The refusal names the reconciliation.

4. **`unit` is compared exactly and `domain` case-folded.** A unit is a symbol
   and `kW` is not `kw`. `point_keys.domain` is a bare unconstrained string —
   the comment on `onboardingDraftPointKeySchema` in
   `packages/shared/src/contracts/onboarding.ts` says so — and refusing a commit
   over `Electrical` against `electrical` would be noise. `domain` is included
   for consistency of the shared row, **not** because it carries decision 2's
   telemetry consequence: only `unit` reaches the line quoted above.

### Consequences

- **This is fail-closed, and it will refuse drafts that are not malicious.**
  Four codes carry a NULL unit today — `battery_charge_pct`,
  `chlorine_pump_on`, `controller_power_status` and `network_strength`, all
  decision 3 orphans — so a draft declaring a unit for any of them is refused
  until a global administrator fills it in. That is the accepted cost of
  decision 3.

  **Correction, 2026-09-02: three, not four.** `F3.41` put
  `chlorine_pump_on` in `METERED_PUMPING_POINT_KEYS`, which gave it a
  `UNIT_BY_KEY` entry of `""` — the spelling `pf` and `breaker_main` already
  carry for a binary — so the seed now writes an empty string rather than
  leaving NULL. A draft declaring a unit for it is therefore **refused on a
  mismatch** instead of being refused for want of a unit, and one declaring no
  unit is accepted. The refusal is stricter, not looser, and the reasoning of
  this paragraph is unchanged for the remaining three. Recorded here rather
  than left, because the count is quoted as a fact and a reader checking it
  would otherwise find the record wrong. No decision of this amendment moves. **It also surfaces a gap in the original record**, which promised
  the orphans would be admitted *"with their domain and unit"* while migration
  `0057` wrote domain and left unit NULL. That gap is not ruled on here.

- **The check runs inside the commit transaction**, unlike the ADR 0031
  Amendment 1 domain check that precedes it. That one was moved out because a
  foreign-key failure reports a constraint name to the operator; this one raises
  its own message either way, and reading the catalog in the transaction that
  writes it leaves no window between the two.

- **The comparison is a pure function with its own gate**
  (`onboarding-point-key-conflict.ts`). `apps/api`'s Vitest project includes
  `src/**/*.test.ts` and the integration suites self-skip without
  `DATABASE_URL`, so a rule proved only there gates nothing on the developer
  machine where the next edit to it will be made. The integration suite keeps
  one assertion, for the wiring.

- **The same code declared twice in one draft is refused with a different
  message**, naming the duplicate declaration rather than a catalog row that
  this very loop created two statements earlier.

- **No new backlog row.** This lands as a `fix(api):` change against a closed
  row (`F3.39`), and its scope gate is this amendment.

## Amendment 2 — two clauses corrected against what shipped, and the records 0057 falsified (2026-09-01)

### Context

The `migration-reviewer` sweep run after `F3.39` merged read migration `0057`
against this record and found the two disagreeing in three places. It raised no
Critical and no High: the SQL, the journal, the forward-only rule, the role
bracket, idempotency, survivor determinism and the behaviour of the new foreign
key under row-level security were all verified sound against the running
database. What it found is a **record** defect, and this amendment is the fix.

An ADR that describes something other than what shipped is worse than no ADR,
because the next reader has no way to know which half to trust. Both corrections
below are stated as *what shipped, and what did not* rather than as a rewrite,
so a reader can see exactly which clause moved.

### Decision

#### 1. Decision 2's primary-key clause did not ship; the rest of decision 2 did

Decision 2 reads: *"Drop `organization_id`, its unique index, its policy and its
FORCE flag; `code` becomes the primary key."*

**The first half shipped exactly.** Migration `0057` drops the column, the
`(organization_id, code)` unique index, the `tenant_isolation` policy and the
`FORCE` flag, and `bms.point_keys` is now readable by every organization.

**`code` did not become the primary key, and must not.** `id` stays the primary
key and `code` takes a unique index (`point_keys_code_unique`). A foreign-key
target needs only a unique index, and four callers key on `id`:
`GET`/`PATCH /api/v1/admin/point-keys/:id`, the audit `entityId`, and
`tests/integration-fixture-isolation.test.ts`. `bms.asset_roles` uses `code` as
its primary key because it was born that way and has no id-keyed caller; this
table has four. The `0057` header records the correction; this record now does
too.

#### 2. Decision 3's orphans were admitted with their domain, and with a NULL unit

Decision 3 reads: *"The 16 orphans of fact 4 are admitted to the global
vocabulary in the same migration, with their domain and unit."*

**The admission shipped, in the same migration and before the constraint**, as
the consequence about a database seeded before this ADR requires.

**`domain` shipped; `unit` did not.** Step 4 takes `domain` from the owning
asset — a fact the database already holds, and measured single-valued, no orphan
code spanning two asset domains — and writes `NULL::varchar(32)` for the unit.
The reason is in the `0057` header and is accepted here rather than reversed:
these codes arrive from `phe-pilot-seed.ts`'s TeleCash sensor map, which carries
no units, and **a guessed unit is a claim rather than a record.** A NULL unit is
already the normal case for a boolean-valued point (`breaker_main`, `pf`).

The cost is real and is now recorded in two places. Four codes carry a NULL unit
today — `battery_charge_pct`, `chlorine_pump_on`, `controller_power_status`,
`network_strength` — and under
[Amendment 1](#amendment-1--onboarding-may-extend-the-global-catalog-and-is-refused-when-the-draft-contradicts-it-2026-09-01)
decision 3 an onboarding draft that declares a unit for one of them is refused
until a global administrator fills it in. Filling those four is ordinary master-
data work for whoever knows the instruments; it is not a code change and it is
not owed by this record.

**Correction, 2026-09-02: three, not four** — see the same correction under
Amendment 1's Consequences. `F3.41` gave `chlorine_pump_on` a `UNIT_BY_KEY`
entry of `""`, the spelling this paragraph itself names as normal for a
boolean-valued point (`breaker_main`, `pf`). Nothing about the refusal rule
moves: `onboarding-point-key-conflict.ts`'s `stated()` folds `""` to `null`, so
a draft declaring a unit for it is still refused. The paragraph above stays
correct for `battery_charge_pct`, `controller_power_status` and
`network_strength`.

#### 3. `0057` amends ADR 0010, ADR 0015 and ADR 0043 in part, and those records now say so

This ADR's `## Dependencies` section says `None`, and that is correct — it means
new npm packages, and there are none. What was missing is any record that making
`bms.point_keys` global **falsifies sentences in three earlier ADRs**, each of
which a reader may still reach first. Every passage below now carries an inline
notice pointing here. Nothing in those records is rewritten: the original text
stands, as the reasoning that was true when it was written.

**[ADR 0010](0010-hierarchical-master-data.md)** — the catalog is no longer
per-organization, so its context paragraph, decisions 1, 2, 5 and 6, and its
first consequence bullet are amended in part. Decision 2 is amended twice over:
`organization_admin` no longer manages a catalog of its own, and `F3.39`
narrowed the admin surface to the global `admin` role, with Amendment 1 above
permitting the onboarding extension only.

**[ADR 0015](0015-asset-template-schema.md)** — three passages, of which the
second and third are more than wording:

- §"What already exists" item 1 says `bms.asset_points.point_key` is *"a
  `varchar(128)`, **not a FK**"* and that validity is enforced in the service
  layer against a row *"with matching `organization_id`"*. Both halves are now
  false: `0057` adds `asset_points_point_key_point_keys_code_fk`, and
  `resolveCatalogPointKey` looks the code up alone.
- §3 reason 2 rejects a composite foreign key from `template_points` on the
  ground that *"`bms.point_keys` is unique on `(organization_id, code)`"*, which
  would force a denormalized `organization_id` onto the child row. **That premise
  is gone, so the reasoning is void** — `code` is unique by itself and a plain
  single-column FK is now possible with no denormalization, which is exactly what
  `0057` added to `asset_points`. Whether `template_points.point_key` should gain
  the same constraint is an **open question and a scope decision**, not a
  conclusion this amendment draws.
- §7 says templates are org-scoped *"exactly like `bms.point_keys`"*. Templates
  are still org-scoped; the comparison no longer holds.

**[ADR 0043](0043-multi-tenant-architecture.md)** — its context measurement that
*"only **five** tables carry `organization_id`"* is now four. That is a dated
measurement inside a Context section rather than a decision, so it takes an
inline notice and **not** an Amendment 7.

### Consequences

- **The three earlier records keep their original text.** A dated notice beside
  a false sentence teaches the next reader why it was written and what changed;
  a silent edit teaches nothing and loses the reasoning.

- **`template_points` is left with an open question, deliberately.** Adding the
  FK would be a schema change on a table `F3.36` writes, gated by §10 like any
  other. Recording it as open is the honest state; building it here would be
  scope this amendment was not asked for.

- **Nothing in this amendment changes runtime behaviour**, so it has no test to
  add. What gates it is the `repo` Vitest project and the anchors: a notice that
  points at a heading it cannot resolve is the failure mode of this kind of
  change.

## Amendment 3 — the same foreign key on template_points, and why an authored orphan must not be admitted (2026-09-01)

### Status

Accepted — 2026-09-01, by the repository owner, at the
`build-operating-model.md` step 2 gate. It closes the open question
[Amendment 2](#amendment-2--two-clauses-corrected-against-what-shipped-and-the-records-0057-falsified-2026-09-01)
decision 3 recorded against ADR 0015 §3 reason 2. The question was put with
three alternatives and a recommendation; the recommendation was ruled.

### Context

ADR 0015 §3 reason 2 rejected a foreign key from `bms.template_points` because
`bms.point_keys` was unique on `(organization_id, code)`, so the constraint
would have forced a denormalized `organization_id` onto the child row. Migration
`0057` removed that premise. `code` is unique by itself, and a plain
single-column foreign key needs no denormalization at all.

Four facts, measured on the running stack on 2026-09-01 rather than inferred.

**1. The constraint applies cleanly today.** `bms.template_points` holds 15 rows
carrying 14 distinct codes, and **zero** of them are absent from
`bms.point_keys`. Unlike `0057`, no reconciliation step is needed here.

**2. There is exactly one production write path, and it is gated three times.**
`AssetTemplatesService.replacePoints` is the only `INSERT`; there is no `UPDATE`
of `point_key` anywhere, because `replacePoints` deletes and re-inserts. Its
three callers — create, update and publish — each call
`assertPointKeysActive` first.

**3. That gate checks strictly more than a foreign key can, on one axis.** It
requires `active = true`, which no constraint can express: a retired code keeps
its row. It also names every offending code, where a constraint violation names
only itself.

**4. And there is already a writer that passes no gate at all.**
`packages/db/src/asset-template-health-seed.ts` writes `bms.template_points` by
raw SQL. It happens to be correct today — fact 1 — but nothing enforces that,
which is precisely the shape of this ADR's own fact 4 about `asset_points`: an
unenforced vocabulary is not a constraint on what may be written, and eventually
stops describing what is written.

### Decision

1. **`bms.template_points.point_key` gains a foreign key** to
   `bms.point_keys(code)`, in migration `0058`, named
   `template_points_point_key_point_keys_code_fk` to match `0057`'s constraint
   on `bms.asset_points`.

2. **`assertPointKeysActive` stays, and is not weakened to match.** The two
   controls check different things and neither subsumes the other: the database
   holds *existence*, against every writer including the ones that do not go
   through the service; the service holds *active* and names the offending
   codes. ADR 0015's own line — *"Validity is checked twice, and this is
   required, not belt-and-braces"* — is the reasoning, and it survives its
   §3 reason 2 being void.

3. **An orphan aborts the migration with its codes named. It is NOT admitted to
   the vocabulary.** This is a deliberate asymmetry with decision 3 of this ADR,
   which admitted `asset_points`' sixteen orphans, and the difference is what
   the row holds. An `asset_points` orphan is a **measurement a device
   actually carries** — refusing it would refuse a fact. A `template_points`
   orphan is **authored text**, and `F3.38`'s entire failure was eight camelCase
   names typed into the stock catalog that matched no vocabulary. Auto-admitting
   an authored orphan would turn each such typo into permanent global
   vocabulary, which is the defect this ADR exists to close, arriving by the
   other door.

4. **The abort is explicit, not a bare constraint violation.** `0058` raises
   before the `ALTER`, naming every `(template, code)` pair that would fail, for
   the reason `assertPointKeysActive` names its codes: an operator told only
   `template_points_point_key_point_keys_code_fk` has to bisect their templates
   by hand. The fix is theirs to choose — correct the template, or register the
   code.

### Consequences

- **`F3.42` is the row**, and `0051` is its gate; no separate ADR.

- **On this database the migration is a no-op plus a constraint**, so the risk
  is carried entirely by installs whose templates were authored before it. For
  those the outcome is a failed migration with a list, which is the loud
  outcome, and correct: a template naming a measurement the platform does not
  have cannot resolve a widget, which is `F3.38` restated.

- **`assertPointKeysActive`'s message is stale and moves with this row.** It
  still says *"Not in this organization's active point-key catalog"*; there is
  no organization catalog since `0057`. `resolveCatalogPointKey`'s equivalent
  message was corrected in `F3.39` and this one was missed.

- **The `template_points` half of ADR 0015 §3 is now settled**, and its inline
  notice points here rather than at an open question.

- **No per-organization escape is created.** A template that needs a code the
  platform lacks asks for it — decision 5's write path, or
  [Amendment 1](#amendment-1--onboarding-may-extend-the-global-catalog-and-is-refused-when-the-draft-contradicts-it-2026-09-01)'s
  onboarding extension. That is the same answer this ADR gives everywhere else.

## Amendment 4 — the database draws Amendment 1's line, not only the code (2026-09-01)

### Status

Accepted — 2026-09-01, by the repository owner, at the
`build-operating-model.md` step 2 gate. Raised by the `F3.42` post-merge
security review, which found that
[Amendment 1](#amendment-1--onboarding-may-extend-the-global-catalog-and-is-refused-when-the-draft-contradicts-it-2026-09-01)
decision 1's "may *extend*, cannot *edit*" boundary had no enforcement below the
service layer. The question was put with three alternatives and a
recommendation; the recommendation was ruled.

### Context

Four facts, all measured on the running stack on 2026-09-01.

1. **`bms.point_keys` carries no policy.** `0057` dropped its
   `tenant_isolation` policy and its `FORCE` flag to make the catalog global —
   `relrowsecurity = f`, zero rows in `pg_policies`.

2. **`bms_tenant` held all four verbs on it.** `0041:112`'s
   `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
   TO bms_tenant, bms_fleet` reaches every `bms` table. With the policy gone,
   the grant was the entire control, and it permitted the two verbs decision 1
   forbids.

3. **The reachable surface is one table, not the class.** `asset_domains`,
   `rule_categories`, `alarm_severities`, `alarm_skills`, `asset_roles` and
   `dashboard_sections` share the grant and the absent policy, and none has a
   tenant-pool writer. `bms.point_keys` has one: `OnboardingCommitService`
   inserts inside `withTenant(this.tenantDb, …)`, which Amendment 1 authorises.

4. **Nothing legitimate uses the two verbs on that connection.** Every
   production `UPDATE` and `DELETE` of the catalog runs on `fleetDb`
   (`point-keys.service.ts:129`, `:160`, `:181`); every test cleanup runs on an
   owner or fleet pool.

An `UPDATE bms.point_keys SET active = false` on the tenant pool retires a code
fleet-wide. `AssetTemplatesService.assertPointKeysActive` then refuses every
*other* organization's template edit and publish on that code, and
`TelemetryWriteService` resolves an unmapped point's unit from the catalog row.
Only a global administrator can undo it.

### Decision

1. **Migration `0059` revokes `UPDATE` and `DELETE` on `bms.point_keys` from
   `bms_tenant`.** It runs as `bms_owner`, which is the grantor — a superuser
   issuing the same statement removes nothing and reports success.

2. **`SELECT` and `INSERT` survive, and that is asserted rather than assumed.**
   `INSERT` is decision 1's authorised extension path; `SELECT` is how every
   tenant reads the vocabulary. `0059` raises if either is missing, and
   `role-grants.integration.spec.ts` proves all four verbs at runtime with
   `SET LOCAL ROLE`.

3. **The revoke narrows one table, not the global-vocabulary class.** Context
   fact 3 is the reason. A second table earns the same treatment when it grows a
   tenant-pool writer, not before.

4. **The onboarding insert stays on the tenant connection.** Moving it to
   `fleetDb` would revoke `INSERT` too, and it would trade this exposure for
   orphan catalog rows whenever a commit fails after it — the write currently
   shares the estate's transaction.

### Consequences

- **The class is now uneven on purpose.** Six global-vocabulary tables still
  grant `bms_tenant` all four verbs. That is defensible only while none of them
  has a tenant-pool writer, so adding one is the trigger for a matching revoke —
  and nothing enforces that today beyond this sentence.

- **`AGENTS.md` §4.4's platform-vocabulary list does not name `bms.point_keys`,
  and that omission is how the grant stayed unexamined.** The list is where a
  reviewer looks to ask which tables rely on grants alone. It is owed a
  `chore(agents):` PR along with the rest of the ADR 0051 sweep.

- **A tenant that needs a code changed still asks.** The answer is decision 5's
  global-admin write path, which is unchanged and still unbuilt.
