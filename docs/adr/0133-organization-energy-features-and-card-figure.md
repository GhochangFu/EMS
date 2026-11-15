# ADR 0133 — Organization energy features and the location card's first figure (`F4.364`)

## Status

**Accepted — 2026-11-14** (owner, in chat: "Accepted"; proposed the same
day). Drafted by an agent for backlog row `F4.364` from an owner request on
2026-11-14. The owner ruled two questions in chat, one at a time; those
rulings are marked *(owner, 2026-11-14)*. Lines marked *(recommended)* were
the agent's calls; the owner accepted the ADR with them as written, so
**every *(recommended)* line is now a ruling**.

Builds on [ADR 0043](./0043-multi-tenant-architecture.md) (organizations),
[ADR 0050](./0050-asset-health-score.md) (the asset health score),
[ADR 0108](./0108-trend-and-energy-views.md) Amendment 4 (the site page's
**Trends & Energy** section, `F4.302`), [ADR 0118](./0118-selectable-design-systems.md)
(per-organization appearance on `bms.organizations`) and
[ADR 0030](./0030-shared-api-contracts.md) (response contracts).
Adds **one** migration and **no** dependency.

## Context

The owner, reviewing the AWS demo on 2026-11-14: WBLDC (cold chain) and BCPL
take no power readings, yet every location card shows a **kW** figure of `0.0`,
and every Control Room site page has a **Trends & Energy** section that can only
say "No kW data in this period". Energy is relevant for PHEWB and other energy
sites, not for these.

What exists (read on `main` at `52791712`):

- The location card (`apps/web/src/components/location-kpi-card.tsx`) shows
  three figures: kW, fresh assets, open alarms. It is used by the executive
  dashboard, the organization overview and the Control Room estate accordion.
- The kW figure is `DashboardService` summing each asset's latest `kw` point
  value per location, wrapped in `COALESCE(…, 0)` — so "no meter" and "zero
  load" both read `0.0`.
- The site page (`apps/web/src/pages/control-room/site-page.tsx`) always lists
  three sections: Site view, Assets & RTUs, Trends & Energy.
- `GET /api/v1/asset-health/summary?locationId=` already returns the ADR 0050
  weighted mean score (`0..1` or `null`) for a location.
- `bms.organizations` already carries per-organization display settings
  (`colour_profile`, `design_system`, ADR 0118).

Assets with a `kw` value in the last 30 days on AWS (read-only query,
2026-11-14): PHEWB 5 of 48, BCPL 0 of 21, ESKOM 0 of 120, WBLDC 0 of 19,
SHAPOORJI 0 of 0.

## Decision

1. **A per-organization setting, Auto by default** *(owner, 2026-11-14: "B:
   setting, Auto default")*. Migration adds to `bms.organizations`:
   - `energy_features varchar(8) NOT NULL DEFAULT 'auto'`, checked in
     `('auto','on','off')`;
   - `card_primary_metric varchar(16) NOT NULL DEFAULT 'auto'`, checked in
     `('auto','kw','health','critical_alarms','none')`.
   Existing rows take the defaults, so nothing changes for an organization
   with energy data.

2. **"Energy shown" for a location.** `on` → shown; `off` → not shown;
   `auto` → shown when the location has energy data. A location has energy data
   when at least one of its active assets has a `kw` point value in the last
   30 days *(recommended: data-based, so no template audit is needed; a meter
   that has been silent for 30 days stops counting, and `on` covers that case)*.

3. **The card's first figure.** `kw`, `health` (ADR 0050 location score as a
   percentage), `critical_alarms` (open alarms of critical tone), or `none`
   (the card shows two figures). `auto` resolves to `kw` when energy is shown
   and to **`health`** when it is not *(owner, 2026-11-14: "Asset health %")*.
   A location with no scored asset shows `—`, never `0`.

4. **Contract.** `LocationKpiSummary` (shared, Zod) gains
   `energyShown: boolean`, `primaryMetric: 'kw' | 'health' | 'critical_alarms' | 'none'`
   (resolved, never `auto`) and `healthScore: number | null`. `totalKw`
   becomes `number | null`: `null` when energy is not shown, and `null` (not
   `0`) when energy is shown but no asset has a `kw` value *(recommended)*.
   The API computes the health score in the same summary read so the card
   makes no extra request per location *(recommended)*.

5. **The site page.** When energy is not shown for the location, the section
   strip lists two entries (Site view, Assets & RTUs). A direct
   `/control-room/site/:id/trends` URL still renders, with one line saying
   energy is off for this organization and how to turn it on
   *(recommended: no redirect, so a bookmark does not fail silently)*.

6. **Editing.** The two settings sit on the organization's edit form next to
   the appearance settings, editable by whoever may edit the organization
   today, and audited as an organization update. The organization read and
   write contracts carry both fields.

7. **Out of scope.** The sidebar **Energy**, **Energy Analytics** and
   **Sustainability** entries and their pages (cross-organization), energy
   reports, the Copilot energy tools, and user-level overrides. Choosing every
   card field per organization (the owner's option C) is not adopted.

## Dependencies

None.

## Consequences

- WBLDC and BCPL lose the `0.0 kW` figure and the empty Trends & Energy section
  with no admin action; PHEWB is unchanged.
- "Energy shown" costs one extra existence check per location in the summary
  read; the plan must keep it inside the existing query's scope parameters.
- The health figure is only as good as the health bands: a template with no
  enabled threshold rules gives `—`.
- `AGENTS.md` gains a line for the setting in a separate `chore(agents):` PR
  after the build.

## Amendment 1 — Trends stay when energy is hidden (2026-11-14)

**Accepted — 2026-11-14** (owner, in chat, plan-gate question Q1: "Keep it as
'Trends'").

The step-3 plan ([`docs/plans/f4.364-energy-features.md`](../plans/f4.364-energy-features.md))
found that the site page's **Trends & Energy** section is not energy-only: its
nav is an **Energy** sub-tab plus one sub-tab per asset domain present at the
site (ADR 0108 Amendment 4). Removing the section, as decision 5 says, would
also hide WBLDC's temperature trends.

Decision 5 is replaced by:

5. **The site page.** When energy is not shown for the location, the third
   section entry is labelled **Trends** (same `/trends` path), its **Energy**
   sub-tab is omitted, and it opens on the first present segment. An explicit
   `?view=energy`, or a site with no segment, shows one line saying energy is
   off for this organization and how to turn it on. No redirect.

The other plan-gate rulings (Q2–Q6, owner 2026-11-14) need no amendment; they
are recorded in the plan's §2 and become build notes when the row closes.

## Build notes

Six plan-gate rulings (owner, in chat, 2026-11-14; plan
[`docs/plans/f4.364-energy-features.md`](../plans/f4.364-energy-features.md) §2)
and what the build found. They fill gaps between this ADR's words and the code;
none reopens a decision (Q1 is Amendment 1).

1. **Whose assets the card's health covers (decision 4, ruling Q3).** The card's
   `healthScore` is the ADR 0050 score of the location's **own** active assets,
   not its subtree — one asset set per card. For a leaf location it equals
   `GET /asset-health/summary?locationId=` (checked on AWS for every card).
2. **When the health score is read (decision 4, ruling Q6).** Only for locations
   whose resolved `primaryMetric` is `health`; `null` otherwise. One batch read,
   `AssetHealthService.scoresByLocation` — four statements whatever the location
   count (a test holds three locations to the statement count of one), sharing a
   private `scoreAssets` step with `summary()`; the window is
   `DEFAULT_HEALTH_WINDOW_MINUTES` (one day), the endpoint's own default.
3. **"Has energy data" (decision 2, plan D1).** `bool_or(a.active AND newest kw
   >= now() - 30 days)` inside the existing `kw_by_location` CTE, under the same
   `$2` asset scope — no new scan. `energyShown` and `healthScore` are therefore
   scope-relative: a caller who reads only an HVAC group sees that group's answer.
4. **`kw` honoured when hidden (decision 3, ruling Q5).** Only `auto` reads the
   energy state; a stored `kw` shows `—` when energy is not shown.
5. **Other kW readers (ruling Q4).** The "Total load" tiles on the generated site
   view and Assets & RTUs are not drawn when energy is not shown. Since the AWS
   check (2026-11-15) both views take the site summary's resolved `energyShown`
   from the site page, so the tile never flashes while their own read is
   pending (it did, for a few seconds, on a no-energy site), and an energy site
   keeps it while a new page or RTU tab loads. The organization accordion header
   omits its kW part when no shown location has a value. **Not covered:** a site
   whose view is a site-layout dashboard keeps that dashboard's own "Total load"
   widget (owner, 2026-11-14: dashboard content is per site and editable), and
   the estate ribbon (`kpis()`) still sums old kW (risk 7). Both are follow-ups.
6. **Editing (decision 6, ruling Q2).** The Edit dialog and `PATCH
   /admin/organizations/:id` only — global admin, audited
   `master.organization.update` with `organization_id` NULL. The create body is
   unchanged; an `organization_admin` gets 403.

**Measured.** `GET /dashboard/locations`: local median 25 ms → 37 ms (16
locations, 11 health cards); AWS 186–278 ms per read (25 locations).

## Amendment 2 — The leftover kW readers and editing by an organization admin (2026-11-15)

**Proposed — 2026-11-15.** Three owner rulings in chat on 2026-11-15, one at a
time, for row `F4.375`; each took the recommended option. They close three of
the four follow-ups named in build note 5 and decision 6. The fourth follow-up,
the clock-dependent freshness fixtures, is a test fix and needs no decision.

1. **The estate ribbon sums shown locations only** *(owner, 2026-11-15: "Sum
   shown sites only")*. `DashboardService.kpis()`'s Total load sums the latest
   `kw` only over assets whose location shows energy (decision 2, same 30-day
   rule and same organization setting). When no location in the caller's scope
   shows energy, the Total load tile is not drawn. This replaces the "risk 7"
   carve-out in build note 5.

2. **A kW-bound widget on a site-layout dashboard is hidden at render** *(owner,
   2026-11-15: "Hide it at render")*. The stored dashboard is not changed. While
   the site's energy is not shown, a widget whose every data source reads the
   `kw` point key (for example the stock "Total load" tile,
   `sustainability.total` with `pointKey: "kw"`) is not drawn; it returns when
   energy is shown again. A widget that mixes `kw` with other sources is drawn.
   The plan states the exact predicate and whether other power keys count. This
   replaces the "site-layout dashboard keeps its own widget" carve-out in build
   note 5.

3. **An organization admin may change the two settings for their own
   organization** *(owner, 2026-11-15: "Yes, own organization")*. Decision 6 is
   widened: `energyFeatures` and `cardPrimaryMetric` take the appearance gate —
   `requireMasterDataUser`, then `isOrganizationLevelAdmin` for that
   organization — and every change is audited. The other organization fields
   (name, currency, timezone and the rest) stay global-admin only. The plan
   chooses the route (a dedicated settings route beside `PUT :id/appearance`,
   or the appearance route widened) and the audit action name.

No migration and no dependency.
