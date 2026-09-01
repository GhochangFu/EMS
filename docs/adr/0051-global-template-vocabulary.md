# ADR 0051 — The global template vocabulary: a template may name only what the platform guarantees everywhere

## Status

Proposed — drafted 2026-09-01.

**Decision 1 is the repository owner's ruling of the same day**, given in these
words: *"template should be such that they can be used across organizations
already have and for the future orgs as well."* Decisions 2–7 are what that
requirement forces on the schema, and they are the part still owed the
`build-operating-model.md` step 2 gate.

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
