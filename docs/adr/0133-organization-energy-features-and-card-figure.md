# ADR 0133 — Organization energy features and the location card's first figure (`F4.364`)

## Status

**Proposed — 2026-11-14.** Drafted by an agent for backlog row `F4.364` from an
owner request on 2026-11-14. The owner ruled two questions in chat, one at a
time; those rulings are marked *(owner, 2026-11-14)*. Lines marked
*(recommended)* are the agent's calls and become rulings if the owner accepts
the ADR as written.

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
