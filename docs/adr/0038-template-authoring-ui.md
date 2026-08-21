# ADR 0038 — Template authoring UI, and the formula editor inside it (`F2.5`)

## Status

**Accepted** — 2026-08-21, by the repository owner, at the
`build-operating-model.md` step 2 gate, the same day it was drafted for `F2.5`.

Eight questions were ruled, in two rounds on the same day. The four *shape*
questions below were ruled **before** this document was written and set its
scope. The four drafting questions the first draft left open were ruled
**after** it, are recorded under *Questions resolved at the §10 gate*, and are
folded into the decisions. One of them, Q4, **reverses** what the draft's
decision 7 said; the decision text carries the corrected answer and says so.

The four shape questions:

1. **Surface** — `F2.5` carries a *full* template authoring page, not a
   calc-only editor over an otherwise missing surface.
2. **Formula scope** — `F2.5` owns **both** authored-formula surfaces:
   `template_points.formula` and `kpis[].expression`.
3. **Editor** — a code-editor library, not a `<textarea>`. That makes this a
   §9.4 dependency ADR as well as a §10 scope ADR.
4. **Gate** — an ADR is required before any implementation.

## Context

ADR 0037 (`F2.4`) shipped the calc execution engine and named what it left
behind in one line:

> **No authoring UI.** `F2.5`.

It also recorded, in *Consequences*, the constraint that shapes this ADR more
than any other:

> `F2.5`'s live preview and the API's write-time validation must agree on what
> a formula computes, and one implementation is the only way they can.

Four facts about the repository decide the rest of the shape.

**1. There is no template UI at all — none, not a partial one.** This is the
central fact, and it is why `F2.5` is not the small item its backlog row
implies. `apps/web/src/api/admin/` holds a shared `client.ts` and nine clients
(`asset-points`, `assets`, `locations`, `manual-readings`, `onboarding`,
`organizations`, `point-keys`, `rtus`, `telemetry-import`) — **none for asset
templates**. `apps/web/src/pages/admin/` holds ten pages and **none for
templates**. `grep -rn "asset-templates\|assetTemplate" apps/web/src/` returns
nothing. The only `template` hits in the web app are the Excel onboarding
workbook (`onboarding.ts:68`), an unrelated artefact.

So the backlog row's 4–5 effort was estimated against a host page that does
not exist. Every template authored so far was authored by `POST`ing JSON, or
seeded.

**2. The backend is already complete for everything this UI needs.**
`AssetTemplatesAdminController` exposes nine routes — `GET /`, `GET /:id`,
`POST /`, `PATCH /:id`, `POST /:id/publish`, `POST /:id/archive`,
`POST /:id/instantiate`, `POST /:id/draft`, `DELETE /:id` — and
`templatePointBodySchema`
(`apps/api/src/admin/asset-templates/asset-templates.schema.ts:33`) **already
accepts every calc column `F2.4` added**: `formula`, `formulaDialect`,
`calcTrigger`, `calcIntervalSeconds`, `maxInputAgeSeconds`, with the
`kind`/formula and `kind`/calc-config cross-checks in its `superRefine`. The
cross-point rule (a derived formula's `{ref}` must resolve to a *measured*
sibling) is enforced one level up in `templatePointsBodySchema`.

`F2.5` therefore adds **no endpoint, no schema change and no migration**. It
is a pure `apps/web` item plus one export widening in `packages/shared`. That
is what makes the widened surface affordable at all.

**3. Published versions are immutable, and the UI cannot hide that.**
ADR 0015's central decision — restated in `asset-templates.service.ts:185` —
is that a published version never changes, because instantiated `asset_points`
rows are physical wiring that `apps/ingest` and the rule engine read. Editing
a published template is `POST /:id/draft`, which creates the next draft. A
naive "edit the formula field and save" UI is therefore *wrong on published
templates*, not merely blocked, and the page must make the draft/publish
lifecycle visible rather than papering over it.

**4. Three template content sections are closed, and a tabbed authoring page
is exactly the thing that would quietly open them.** ADR 0019, still standing
in AGENTS.md §6: `health` and `optimisation` are **rejected by the validator**
(they need `E1.1` and `E1.6`), and `dashboards` carries **ordered point keys
only** until `F3.1` defines the widget vocabulary. A tab strip invites a tab
per section. Two of those tabs must not exist, and the third must stay a
reorder control.

## Decision

**1. `F2.5` builds the full template authoring surface, and the backlog row is
re-scoped to say so.** Two routes in `apps/web`:

```
/admin/asset-templates          list — code, version, status, domain, point count
/admin/asset-templates/:id      detail — tabbed, lifecycle-aware
```

The list gets a `status` filter (`draft` / `published` / `archived`) mapping
to the existing query parameter, and groups versions under their `code` so
that "CHILLER v1, v2, v3" reads as one template's history rather than three
unrelated rows.

This supersedes the "Calculation configuration UI" framing of the `F2.5` row,
whose `4–5` effort covered roughly the Calculations tab alone. The revised
effort is **16–20** (Q2).

**2. The detail page has exactly five tabs.** Named here so that the closed
sections cannot arrive by accident:

| Tab | Writes | Notes |
|-----|--------|-------|
| Details | `PATCH /:id` — `name`, `assetType`, `domain`, `description` | `domain` is a select over `assetDomains` from `GET /api/v1/vocabularies` (ADR 0031 Amendment 1 made it data); reuse the existing `vocabulariesQueryKey` so this is not a fourth fetch of that payload |
| Points | `PATCH /:id` — `points[]` | `pointKey`, `label`, `unit`, `kind`, `sourceDataKeyPattern`, `required`, `sortOrder` |
| Calculations | `PATCH /:id` — the calc fields of `points[]` where `kind: "derived"` | the formula editor; `calcTrigger`, `calcIntervalSeconds`, `maxInputAgeSeconds` |
| KPIs | `PATCH /:id` — `content.kpis[]` | the same formula editor, different write target |
| Alarms | `PATCH /:id` — `content.alarms[]` | `severity` and `skill` are selects over their vocabularies (ADR 0032, ADR 0034) |

**There is no `health` tab and no `optimisation` tab.** The API rejects those
sections; a tab that always errors is worse than no tab. They arrive with
`E1.1` and `E1.6` respectively.

**`dashboards` gets no tab either.** Its only authorable content today is the
ordering of point keys, which belongs on the Points tab as the existing
`sortOrder` control rather than as a section editor implying a layout the
contract does not carry. It becomes a tab when `F3.1` gives it widgets.

Maintenance plans (`content.maintenance`) are deliberately omitted from this
first cut; see *Not in this ADR*.

**3. The lifecycle is a visible state, not a disabled-field detail.** On a
`draft`, every tab is editable and the page offers **Publish** and **Delete
draft**. On a `published` version, every tab is **read-only**, and the primary
action is **Edit this version**, which calls `POST /:id/draft` and navigates to
the new draft — the same mental model as `createDraftFrom`'s docblock. A
`published` version also offers **Instantiate** (`POST /:id/instantiate`,
`F2.2`) and **Archive**. An `archived` version is read-only with no actions.

The page must never render an editable formula field on a published template.
That is the single failure mode this decision exists to prevent.

**4. Both formula surfaces use one editor component, with two validation
contexts.** `<FormulaEditor>` takes the expression, the resolvable point keys,
and a mode. The two modes differ in what a `{ref}` may resolve to, and this
difference is real, not cosmetic:

- **Derived point** (`template_points.formula`) — a `{ref}` must resolve to a
  **measured** sibling in the same template. ADR 0036 decision 7 forbids
  derived-to-derived chaining, and `templatePointsBodySchema` enforces it
  server-side. The editor must apply the same rule, or the user learns it from
  a 400.
- **KPI** (`kpis[].expression`) — **two** checks, and the editor owes both.
  First, `templateKpiSchema` enforces a *two-way* cross-check against the KPI's
  own `pointKeys` array (`asset-templates-content.schema.ts:182`): every
  `{ref}` in the expression must appear in `pointKeys`, **and** every entry in
  `pointKeys` must be used. An unused `pointKeys` entry is an error, which is
  the half a naive editor would miss. Second, `assertContentRefsResolve` /
  `findUnresolvedContentRefs` requires every content point ref to resolve to a
  point key the *template* declares. So a KPI ref must be in `pointKeys` **and**
  in `points[]`.

A KPI expression is a read-time display value with no trigger, write path or
staleness policy, so the Calculations tab's trigger controls do not appear on
the KPIs tab. ADR 0037 recorded that split; this decision keeps it.

**5. Live preview evaluates with `evaluate()` from `@bms/shared`, in the
browser.** The user types sample values for each referenced point and sees the
computed result, or the evaluator's refusal, as they type. `packages/shared`
is a runtime package since ADR 0030, so this is an ordinary import — not a
duplicated evaluator, which is what ADR 0037's consequence forbids.

Preview is a **pure** function of the typed values. It does not fetch live
telemetry: a formula being authored belongs to a template, and a template has
no asset until `F2.2` instantiates it, so there is no live reading to read.

**6. Inline errors are placed by `position`, and no new grammar is written.**
ADR 0036 *Amendment 1* added `position` to `CalcParseError` precisely so a
per-node refusal can point at a character offset; that is what an inline
squiggle needs. Syntax highlighting is driven by the **existing**
`tokenize()` — a `ViewPlugin` mapping `Token[]` to decorations — rather than a
Lezer grammar. A Lezer grammar would mean `@lezer/generator` as a build
dependency and a **second** definition of the same syntax, which is the
duplication ADR 0037 warned about wearing different clothes.

**This requires one export widening.**
`packages/shared/src/calc-dsl/index.ts` currently exports `ast`, `limits`,
`parseFormula`, `validateFormula`, `formatCalcError` and `evaluate`, but
**not** `tokenize`, `Token`, `TokenKind` or `CalcTokenizeError`. It must
export them. This is additive and touches no existing consumer.

**7. The editor library is CodeMirror 6, taken as the `codemirror`
meta-package (§9.4).** One dependency line in `apps/web`. See *Dependencies*
for the comparison against Monaco and the small alternatives.

**This reverses the first draft, which specified a minimal four-package set**
and dismissed the meta-package as carrying features "a one-line arithmetic
field does not use". That was wrong on two of the four extras, and Q4 settled
it the other way:

- **`@codemirror/lint`** is the purpose-built tool for decision 6. Placing a
  parse error by its `position` is exactly what a `linter()` source does, and
  it brings the diagnostics panel, the hover tooltip and keyboard navigation
  between errors that a hand-rolled `Decoration.mark` does not.
- **`@codemirror/autocomplete`** completes `{pointKey}` from the template's own
  `points[]`. Decision 4 requires a two-way `pointKeys` check on the KPIs tab
  and a measured-sibling check on the Calculations tab; completion prevents
  those errors rather than reporting them.
- **`@codemirror/commands`** is undo and redo. A formula field without undo is
  a defect.
- **`@codemirror/search`** is the only genuinely unused member. It is never
  imported, so it must tree-shake out. The bundle measurement below is the
  check that it did, and a failure there is a real finding, not a formality.
  **This claim survives only under Amendment 1 — see below.** As written it was
  wrong: `basicSetup`, the meta-package's documented entry point, imports and
  uses `searchKeymap` and `highlightSelectionMatches`.

The meta-package also co-versions the set. CodeMirror's packages must agree on
`@codemirror/state`; two copies in one bundle fail at runtime, and six
hand-maintained version ranges are six chances to cause that.

**8. No API change, no migration, no seed change.** If implementation finds it
needs one, that is a signal the plan drifted from this ADR, and it comes back
to the gate. Decision 10 was the one place this was at risk, and it was
settled so that this holds.

**9. An `"unvalidated"` KPI expression is upgraded by opt-in, never by save.**
(Q1.) ADR 0036 decision 6 widened `dialect` and promised that "nothing forces
a re-save". Templates on `main` hold KPI expressions that never met the parser,
and the KPIs tab must not break them.

So: the expression stays **editable as free text** and the dialect stays
`"unvalidated"`. The editor offers a **Validate this expression** action. On a
successful parse the dialect switches to `"bms-calc-v1"` and the field gains
highlighting, live preview and the two-way `pointKeys` check. On a failure the
error renders and **nothing is written** — not the dialect, not the expression.

The rule this exists to prevent: opening a template to fix an alarm message and
pressing Save must never reject a KPI the author did not touch. Saving any
other tab leaves an `"unvalidated"` KPI exactly as it was.

**10. Authoring actions are hidden by role and refused by scope.** (Q3.)
`assertCanAuthor` (`asset-templates.service.ts:448`) makes two separate checks,
and only one of them needs the server:

- `user.role === "location_admin"` → forbidden. This is a **pure role check**,
  and `GET /api/v1/auth/me` already returns `user.role` in `sessionUserSchema`.
  The page computes it client-side and **hides** Create, Edit, Publish, Archive
  and Delete draft. Instantiate stays visible — a location admin deploys.
- `canManageTemplate(jwt, organizationId)` → forbidden. Organization scope is
  **not** derivable on the client: `accessibleScopeSchema` carries `locations`,
  `assetGroups` and `assetIds`, and no organizations. This case **falls through
  to the API's 403**, rendered inline. The message the service already writes
  ("Organization is outside your access scope") is the right one.

The alternative — a `canAuthor` boolean on the list and detail responses —
would hide both cases, and was rejected because it is an API change and
decision 8 says there is none. The residual failure is narrow: right role,
wrong organization.

## Not in this ADR

- **Per-asset overrides** of formula, trigger or staleness. ADR 0037 decision 4
  put the columns on `template_points`, so the unit of configuration is the
  template. Overrides are `F2.6`'s if anyone asks.
- **How a new version's formula changes reach assets built from the old one.**
  ADR 0037 left the lifecycle half to `F2.6` explicitly. This UI can *create*
  the next draft and publish it; what that means for already-instantiated
  assets is unchanged and unaddressed.
- **The tag-mapping bulk editor and the Excel mapping sheet.** `F2.7`. The
  Points tab edits `sourceDataKeyPattern` one row at a time; bulk is a separate
  row with its own shape.
- **Maintenance plan authoring** (`content.maintenance`). The section is open
  in the contract (ADR 0019), but no ruling has been asked for on whether
  class-level plans are authored here or with the work-order surface. Note that
  `maintenance-schedules-panel.tsx` is **not** that surface and is not related
  to it: its "templates" are maintenance *schedule* templates that generate
  work orders, a different entity from `asset_templates`. Omitted rather than
  guessed.
- **Dashboard widget authoring.** `F3.1` owns the vocabulary; §6 keeps
  `dashboards` at ordering only until then.
- **A second rule builder.** The Alarms tab writes `content.alarms[]`, whose
  entries carry `operator` and `thresholdValue` and so *look* like the rule
  builder `F4.44`/`F4.45` hardened. They are not the same thing: a
  `TemplateAlarm` is **class-level authoring** on a template, and ADR 0034
  recorded that no `automation_rules` row links back to the `TemplateAlarm` it
  may have come from. The tab must not be read, or built, as a way to edit
  live rules.
- **`F2.8`.** The PUE path is untouched and remains unreachable on
  `bms-calc-v1` for the reasons ADR 0037 *Consequences* records.
- **Backfill.** Unchanged: a formula produces values from the moment it is
  active.
- **New RBAC.** The page relies on the existing `requireMasterDataUser` /
  `assertCanAuthor` split — a location-scoped admin can deploy but not author,
  which `asset-templates.instantiate.integration.spec.ts` already asserts. The
  UI must *reflect* that split (hide authoring actions the user cannot take)
  rather than introduce a new one. See Q3.

## Dependencies

**New, in `apps/web` only.** This is the §9.4 change; the rest of the ADR is
§10.

**One line in `apps/web/package.json`:** `"codemirror": "^6.0.2"` (decision 7).
What it brings, all MIT:

| Package | Unpacked | Why it is here |
|---------|----------|----------------|
| `@codemirror/view` | 1.25 MB | the editor itself |
| `@codemirror/state` | 436 KB | document and selection model |
| `@codemirror/language` | 310 KB | `StreamLanguage`, highlight plumbing |
| `@codemirror/autocomplete` | 256 KB | `{pointKey}` completion (decision 7) |
| `@codemirror/commands` | 247 KB | undo / redo |
| `@codemirror/lint` | 97 KB | error placement by `position` (decision 6) |
| `@codemirror/search` | 137 KB | **unused** — must tree-shake |
| `@lezer/common` | 246 KB | transitive of `language` |
| `@lezer/highlight` | 100 KB | highlight tag vocabulary |

Total ≈ 3.1 MB unpacked. That figure is **on-disk source plus type definitions
plus source maps**, not shipped bytes, and it is the wrong number to reason
about. No shipped figure is quoted here because none has been measured; the
budget below makes measuring it part of the work.

`@codemirror/view` was last published 2026-08-16 and `@codemirror/state`
2026-07-05 — five days and seven weeks before this ADR. The project is alive.

**Why not the alternatives.**

- **Monaco** (`monaco-editor`, MIT) is **97.9 MB unpacked** and ships web
  workers needing Vite configuration. It is an IDE. `bms-calc-v1` is scalar
  arithmetic with brace references and five whitelisted functions. Rejected on
  proportion.
- **`react-simple-code-editor` + `prismjs`** (both MIT, ~70 KB) is the small
  option and was tempting. Rejected on maintenance: `react-simple-code-editor`
  last published **2024-07-04**, over two years stale, against
  `@codemirror/view`'s 2026-08-16. It also has no decoration API, so inline
  error placement by `position` — decision 6, the reason the editor exists —
  would have to be hand-built over a mirrored `<pre>`.
- **A plain `<textarea>`** takes no dependency and was offered at the gate. The
  owner ruled for a real editor.

**Bundle budget, and the code-splitting this forces.** The implementation must
measure the bundle delta and load the editor **lazily**, so that the dashboard
and control-room routes do not pay for it. Be clear about what that costs:
**`apps/web` has no route-level code splitting today.** `app.tsx` statically
imports all thirty-odd pages, and contains no `React.lazy` and no `Suspense`.
So "load it lazily" is not a flag — it introduces the first dynamic `import()`
boundary in the web app, together with the `Suspense` fallback that boundary
needs.

That is a small architectural first, and this ADR accepts it as part of
`F2.5` rather than pretending it is free. Scope it tightly: `React.lazy` on the
authoring route **only**, not a sweep converting every page. `echarts` and
`leaflet` are already eagerly bundled and stay that way; converting them is a
separate item nobody has raised.

A measured before/after figure is part of `F2.5`'s verification, not an
afterthought.

## Consequences

- **`F2.5`'s backlog row was wrong on two counts and is corrected**: the
  feature name ("Calculation configuration UI") understated it, and the `4–5`
  effort was sized against a page that does not exist. The owner set the
  revised effort at **16–20** (Q2). For calibration, `F3.1` (dashboard schema
  *and* builder UI) is `14–18` and `F2.1` (the template schema enabler) is
  `10–12`. `F2.5` sits above `F3.1` despite designing no schema, because the
  number deliberately buys headroom: an editable grid for templates near the
  500-point limit, the autocomplete of decision 7, the first `React.lazy`
  boundary proving out cleanly, and a full test pass on the editor.
- **`F2.5` is P0 on the critical path, and `16–20` moves wave 2.** Recorded so
  that the schedule consequence is not discovered later. It was accepted
  knowingly at the gate.
- **`F2.6` and `F2.7` inherit a host page.** Both were sized assuming somewhere
  to put their controls. `F2.6`'s per-asset overrides and `F2.7`'s bulk editor
  now have one, which should reduce them, and neither has to build a list view.
- **`packages/shared` gains a third frozen surface.** The AST was one
  (ADR 0036), `evaluate()` a second (ADR 0037), and exporting `tokenize()` for
  highlighting makes the token stream a third. Its `TokenKind` union is now a
  contract the editor's theme reads, so adding a token kind becomes a
  cross-package change.
- **AGENTS.md §6's three closed content sections are untouched.** Decision 2
  keeps them out of the UI, so nothing here reopens them, and each still
  reopens with its own consumer. This ADR does **not** soften any §6 bullet;
  no `chore(agents):` §6 edit is owed for the section list.
- **The status line and §2 do need a sweep** once this lands: a *Template
  authoring* row describing the five tabs, the lifecycle rule, and the
  CodeMirror dependency, in the separate `chore(agents):` PR §9.10 requires.
- **The `<FormulaEditor>` is reusable and will be reused.** `F2.8`, if it ever
  becomes expressible, and any later rule-expression surface will want it.
  Building it as a component under `apps/web/src/components/` rather than
  inside the page is therefore not speculative generality.

## Questions resolved at the §10 gate

All four were ruled by the repository owner on 2026-08-21, after the first
draft and on the same day. Each answer is folded into the decision it belongs
to; they are recorded here so a later reader can see what was actually asked
and what the alternatives were.

**Q1 — Existing `"unvalidated"` KPI expressions: migrate, or leave?**
*Ruled: opt-in validation.* See decision 9. The expression stays editable, the
dialect is untouched, and a **Validate this expression** action upgrades it
only when the author asks and only when it parses.

The two rejected answers, and why. *Read-only with a badge* would have made an
unvalidated KPI unfixable — not even a typo — so the only repair is delete and
re-add, and the badge is permanent. *Force `bms-calc-v1` on save* would have
meant opening a template to edit an alarm message and having Save rejected by a
KPI the author never touched, which is precisely what ADR 0036 promised would
not happen.

**Q2 — What effort goes on the re-scoped `F2.5` row?**
*Ruled: `16–20`,* replacing `4–5`. See *Consequences* for the calibration
against `F3.1` and `F2.1`, and for what the headroom buys. The wave-2
schedule consequence was accepted knowingly.

**Q3 — Does the page *hide* authoring actions, or merely fail them?**
*Ruled: hide on role, fail on organization scope.* See decision 10. This was
the answer that let decision 8 stand: hiding the organization case too would
have required a `canAuthor` field on the list and detail responses, and with it
an API change this ADR says it does not make.

**Q4 — Minimal CodeMirror set, or add `@codemirror/autocomplete`?**
*Ruled: neither — take the `codemirror` meta-package.* See decision 7, which
records the reversal in full. The draft asked the narrow question and the
answer went wider, correctly: `@codemirror/lint` is the right tool for
decision 6's error placement, `@codemirror/commands` is undo, and the
meta-package co-versions a set that must agree on `@codemirror/state`.

The one thing this answer owes: `@codemirror/search` is never imported and
must tree-shake out. The bundle measurement is not a formality here.

## Amendment 1 — compose from `minimalSetup`, never `basicSetup` (2026-08-21)

Found while writing the `F2.5` step-3 plan
(`docs/plans/f2.5-template-authoring-ui.md`), before any implementation code
was written. Ruled by the repository owner the same day.

**What was wrong.** Decision 7 justified taking the `codemirror` meta-package
partly on the ground that `@codemirror/search` "is the only genuinely unused
member... never imported, so it must tree-shake out", and the Dependencies
table records it as **unused**. The plan's first draft then told the
implementer to import `{ EditorView, basicSetup }` from `codemirror` — the
package's documented entry point. Those two instructions cannot both hold.

Verified against the published source of `codemirror@6.0.2`
(`https://unpkg.com/codemirror@6.0.2/dist/index.js`): `basicSetup` imports
`highlightSelectionMatches` and `searchKeymap` from `@codemirror/search` and
uses both — the former as a standalone extension, the latter spread into its
`keymap.of([...])`. `minimalSetup` uses neither. So `basicSetup` makes
`@codemirror/search` a live import **by construction**, and the bundle check
decision 7 owes would have failed at the end of the branch, reading as a
tree-shake defect when it was a planning defect.

**What changed.** The formula editor composes its extension list from
`minimalSetup` and **never imports `basicSetup`, and never imports
`@codemirror/search`**:

```ts
const extensions = [
  minimalSetup,          // specialChars, history, drawSelection,
                         // syntaxHighlighting, default + history keymap
  autocompletion({ override: [pointKeyCompletions] }),
  linter(calcLintSource),
  calcHighlightPlugin,   // ViewPlugin over safeTokenize()
  EditorView.editable.of(!readOnly),
];
```

Decision 7 is otherwise unchanged. The meta-package is still what is taken,
still for the reasons recorded there, and no second dependency is added:
`@codemirror/lint`, `@codemirror/autocomplete` and `@codemirror/commands`
resolve through the meta-package's transitives exactly as decision 7 says.
`minimalSetup` already carries `history`, so decision 7's undo requirement —
"a formula field without undo is a defect" — is met without a separate import.

**Why `minimalSetup` and not a vendored copy of `basicSetup` minus search.**
`basicSetup` is roughly 18 extensions: line numbers, a fold gutter, bracket
matching, rectangular selection, a crosshair cursor, active-line highlighting.
That is chrome for a code file. The two surfaces this editor serves —
`template_points.formula` and `content.kpis[].expression` — are single short
expressions, capped at 1000 characters by `templatePointBodySchema`. Copying
the array would also vendor 18 lines that must be re-checked on every
CodeMirror upgrade, to keep affordances this field does not want.

**Consequence for verification.** Decision 7's bundle check stays a real
assertion rather than becoming a measurement, and it gains a static partner:
the `F2.5` plan's Unit 8 invariant asserts that no file in `apps/web/src`
outside the lazy `formula-editor.tsx` imports `codemirror` or
`@codemirror/*`. A `@codemirror/search` symbol in the built output now means a
genuine regression — someone reached for `basicSetup` — and not an inherent
property of the dependency.
