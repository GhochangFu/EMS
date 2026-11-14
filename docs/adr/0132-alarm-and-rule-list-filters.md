# ADR 0132 — Organization, location, asset group and asset filters on the Alarm Centre and Rule Engine (`F4.361`)

## Status

**Accepted — 2026-11-14** (owner, in chat: "Accepted"; proposed the same
day). Drafted by an agent for backlog row `F4.361` from an owner request on
2026-11-14. The owner ruled three questions in chat, one at a time; those
rulings are marked *(owner, 2026-11-14)*. Lines marked *(recommended)* were
the agent's calls; the owner accepted the ADR with them as written, so
**every *(recommended)* line is now a ruling**. The step-3 plan
([`docs/plans/f4.361-alarm-rule-filters.md`](../plans/f4.361-alarm-rule-filters.md))
followed, and the owner said "yes" to it on 2026-11-14.

Builds on [ADR 0074](./0074-domain-dashboard-parity.md) (the alarm list and summary
reads), [ADR 0130](./0130-persistent-alarm-bar.md) decision 15 (the
`locationId` subtree filter), [ADR 0131](./0131-maintenance-windows.md)
decision 19 (`state=suppressed`), [ADR 0043](./0043-multi-tenant-architecture.md)
(tenant scope), [ADR 0098](./0098-location-tree-of-any-depth.md) (the location
tree) and [ADR 0030](./0030-shared-api-contracts.md) (response contracts).
Adds **no** migration and **no** dependency.

## Context

The AWS demo holds five organizations (ESKOM, PHEWB, BCPL, SHAPOORJI,
WBLDC). `/alarms` and `/rules` list all of them mixed, and neither page can be
narrowed to an organization or a site.

What already exists (read on `main` at `126399f`):

- `GET /api/v1/alarms` and `/alarms/summary` accept `organizationId`
  (`F3.66`), `locationId` with its whole subtree (`F4.357`), and `assetIds`
  (at most 200). Each is ANDed onto the caller's readable assets, so it only
  narrows; a location the caller cannot read answers empty, never 403 (ADR
  0130 owner ruling P2). The list also takes `state`
  (`all` / `active` / `unacknowledged` / `suppressed`).
  `AlarmsService.list` already filters by `severity` code for the Copilot
  (`F4.291`), but the HTTP query does not expose it.
- The `/alarms` page sends only `state=suppressed` ("Suppressed only").
- `GET /api/v1/rules` takes **no** query. It returns every readable rule,
  unpaged; the item has `assetId` and `assetLocationName` but no organization
  or location id. `RulesPanel` filters category, status and lifecycle in the
  browser.
- No read lists the organizations, location tree, asset groups and assets a
  caller can **read**. `GET /admin/organizations` and `/admin/locations` need a
  master-data user and list **writable** organizations; `/me` lists readable
  locations (with `parentId`) and asset groups but no organization names and
  no assets.

## Decision

1. **Filters.** Both pages get Organization, Location (the site and the tree
   below it), Asset group and Asset pickers. `/alarms` also gets Severity and
   a State dropdown. *(owner, 2026-11-14: "also asset group + asset", read as
   including the severity and state of the option before it.)*

2. **Options come from one new scoped read** *(owner, 2026-11-14)*:
   `GET /api/v1/filter-options` returns

   ```
   { organizations: [{ id, code, name }],
     locations:     [{ id, name, code, parentId, organizationId }],
     assetGroups:   [{ id, name, code, locationId, organizationId }],
     assets:        [{ id, code, name, locationId, organizationId }] }
   ```

   Every list is built from the caller's own read scope —
   `AccessControlService.currentUser(jwt).scope` (the same source as `/me`)
   for locations and asset groups, `readableOrganizationIds` for
   organizations, `readableAssetIds` for assets — so it can list nothing the
   caller cannot read. A `parentId` the caller cannot read is `null`, as in
   `/me` (ADR 0098 Drafter choice 8). Active rows only. Any signed-in user may
   call it; there is no write role. The response is a shared Zod contract
   (ADR 0030). *(recommended)*

3. **Alarm list query gains two parameters** *(recommended)*:
   - `severity` — one severity code; the list keeps alarms of that severity.
     An unknown code answers an empty page, not a 400 (the vocabulary is
     data). Not on `/alarms/summary`, which is already one row per severity.
   - `assetGroupId` — uuid; keeps alarms on assets that are members of that
     group. On both the list and the summary.

   The asset filter reuses the existing `assetIds` (one id). Organization and
   location reuse the existing `organizationId` and `locationId`.

4. **Rule list query gains four parameters, filtered on the server** *(owner,
   2026-11-14)*: `GET /api/v1/rules?organizationId=&locationId=&assetGroupId=&assetId=`.
   `locationId` covers the subtree, using the same walk the alarm list uses.
   The rule item contract does not change. Category, status and lifecycle stay
   browser-side filters.

5. **Every new parameter only narrows** *(recommended)*. It is ANDed onto the
   caller's readable assets, never used in their place. An organization,
   location, group or asset outside the caller's scope answers an empty list
   — not 403 and not that scope's rows — the same rule as `organizationId`
   and `locationId` today (ADR 0130 P2). A rule with no asset matches no
   organization, location, group or asset filter, so it shows only when those
   four are empty. Ids are uuids, lower-cased before the scope check, as
   `locationId` is today.

6. **The pickers cascade** *(recommended)*: Organization narrows Location;
   Location narrows Asset group and Asset; Asset group narrows Asset. Changing
   a parent clears the children it no longer contains. A user with one
   organization sees it preselected and locked, as `HierarchyFilterBar` does
   today.

7. **State on `/alarms`** *(recommended)*: All / Active / Suppressed, which
   replaces the "Suppressed only" toggle. `unacknowledged` is left out: it is
   one page with no cursor (ADR 0130), so it cannot back a paged table.

8. **The filter lives in the URL** *(recommended)*: `?organizationId=…&locationId=…`
   and so on, so a reload or a shared link keeps it, and the browser Back
   button undoes a change. An id that is not in the options is dropped from
   the URL silently.

9. **Counts follow the filter** *(recommended)*: the `/alarms` severity cards
   and distribution are computed from the filtered list, and the `/rules`
   counters from the filtered rules, so the numbers always describe what the
   table shows.

## Consequences

- One new endpoint and its contract, two alarm query parameters and four rule
  query parameters. These change API read paths, so the API PR gets a
  `security-reviewer` pass as well as `code-reviewer` and
  `agents-compliance-reviewer`.
- The options read returns every readable asset in one answer. On the seed and
  the AWS demo that is hundreds of rows; if an organization reaches many
  thousands, the asset picker moves to a search-as-you-type read, which would
  be an amendment to this ADR.
- The alarm bar, the alarms rail and the Copilot are not touched.
- `AGENTS.md` owes a `chore(agents):` catch-up (§10.1): the status line, §4.7
  (the new read and the narrow-only rule), §4.8 (the new contract file) and
  §4.2 (the operator filter bar). Plan §10 lists it; it is tracked in
  `docs/BACKLOG.md` §5 until it lands.

## Non-goals

- Saved or named filters, and per-user default filters.
- Filters on other alarm surfaces (the alarm bar, the alarms rail, reports).
- A severity filter on `/rules` (a rule's severity is set per rule and is
  already visible in the row).
- Multi-select pickers.

## Build notes

Four plan-gate rulings (owner, in chat, 2026-11-14; plan
[`docs/plans/f4.361-alarm-rule-filters.md`](../plans/f4.361-alarm-rule-filters.md) §2).
They fill gaps between this ADR's words and the code; none reopens a decision.

1. **Readable asset groups (decision 2).** `currentUser(jwt).scope.assetGroups`
   lists groups only for an asset-group grant. A group is readable when it is
   one of the caller's granted groups, or when its location is one of the
   caller's readable locations. One function decides this for the options read
   and for the list filters.
2. **Group membership in the options (decision 6).** Each asset-group option
   gains `assetIds`: its members that are in the same answer's `assets` list,
   so "Asset group narrows Asset" works in the browser.
3. **Device alarms under `assetGroupId` (decision 3).** It narrows the caller's
   asset scope to the group's members, so it lists the same kinds of alarm as
   the existing `assetIds` filter: rule alarms, the comms alarm of an RTU
   serving a member, and the ingest-host alarm of their organization.
4. **An unreadable group answers empty (decision 5)**, even when some of its
   members are readable, checked before any read — the same rule as P2.

