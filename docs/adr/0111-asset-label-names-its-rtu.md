# ADR 0111 — An asset label names its RTU (`F4.316`)

## Status

**Proposed — 2026-11-06.** Raised by `F4.316` (the owner, 2026-11-05, from the
AWS demo). The owner gave four rulings in chat on 2026-11-06, one at a time,
each as recommended, before this record was written (listed under *Rulings*).
The merge of this record is the acceptance. Lines marked *(drafter)* are
drafter calls that the `F4.316` plan may refine; the others are rulings.

Builds on [ADR 0030](./0030-shared-api-contracts.md) (response types are
`z.infer`red from shared Zod schemas, so a new field is a contract change).
Code citations are to `main` at `9d86d25`.

## Context

**The request.** An asset's code and name do not say which RTU it belongs to.
Most surfaces show only the code, so two meters at one site cannot be told
apart. On the AWS demo, PHE West Bengal has two RTUs per site (`Lotapata I`,
`Lotapata II`), each with one meter, one main pump breaker, one chlorine pump
and one RTU-health device; the site page's trend legend reads
`PHE-MFM-000000003` and `PHE-MFM-000000004` with nothing to say which RTU is
which.

**What the code does today.**

- `bms.assets.rtu_id` is optional (ADR 0018); every asset has a `location_id`.
  `bms.rtus.display_name` holds the RTU's name.
- `GET /admin/assets` and `GET /admin/assets/:id` already return
  `rtuDisplayName` and `locationName`. Most other read contracts that name an
  asset carry only `assetCode` (and sometimes `assetName`): the trend series,
  the alarm list and detail, the site-health and critical-systems cards,
  dashboard widget sources, reports and exports, and the copilot's read tools.
- There is no shared formatter: each surface prints the code itself.
- Stopgap (2026-11-05): the 48 PHE assets on the AWS demo were renamed
  `<RTU> · <type> (<device code>)`, and the PHE seed stopped writing an
  existing asset's name (#1044, ADR 0007 decision 4a's rule). Surfaces that
  show only the code are unchanged.

## Rulings (owner, 2026-11-06)

| # | Question | Ruling |
| - | -------- | ------ |
| C1 | The label's form | **`<code> · <RTU>`**, for example `PHE-MFM-000000003 · Lotapata I`. |
| C2 | An asset with no RTU | **`<code> · <location>`**, for example `WTR-WTP-01 · Lotapata`. |
| C3 | Which surfaces | **Every web screen, the PDF/CSV/XLSX reports and exports, and the copilot.** |
| C4 | A label that does not fit | **The `· <RTU>` part wraps** to the next line; nothing is truncated. |

## Decision

1. **One label rule.** An asset is shown as `<code> · <where>`, where
   `<where>` is the RTU's `display_name` when the asset has an RTU, else its
   location's name (C1, C2). The separator is ` · ` (a middle dot with a space
   on each side). The code is never shortened.
2. **The read contracts carry the parts.** Every shared response schema that
   names an asset by `assetCode` gains **`assetRtuName: string | null`** and
   **`assetLocationName: string | null`**, additive and nullable, filled by the
   same join everywhere (`assets` → `rtus`, `assets` → `locations`) under the
   caller's existing scope. No route, parameter or permission changes.
   *(drafter: the field names; the plan lists every schema.)*
3. **One formatter per output.** `apps/web/src/lib` gains one `assetLabel()`
   that every screen uses; the report and export writers use one server-side
   twin with the same rule (C3). A shared pure function in `packages/shared`
   is preferred so the two cannot drift. *(drafter)*
4. **Layout** (C4). On screens the code stays on one line and the `· <where>`
   part may wrap; no label is truncated or hidden behind a tooltip. In a CSV or
   XLSX export the label is one cell; the code stays in its own column where an
   export has one, so a sheet can still be filtered by code.
5. **The copilot** (C3). Its read tools that list or name assets return the
   two fields, and its answers and card summaries name an asset by the label.
6. **Out of scope.** Search and filters do not change (searching by RTU name is
   a later row). Asset names are data and are not rewritten by this record.

## Dependencies

None. No new npm package; no migration (the columns exist).

## Consequences

- Many shared schemas gain two optional fields; ADR 0030's validator and the
  contract specs cover each change. The `F4.316` plan lists the schemas and
  surfaces, and splits the work so each PR stays reviewable.
- The PHE rename stays as it is; on PHE screens the RTU then appears twice on
  surfaces that show the name and the label together. The plan decides where
  only one is shown. *(drafter)*
- A screen that wraps the label may grow a row; widget and table snapshots in
  the web specs change with it.
