# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Control-room shift operator.** Works a 24×7 shift in a site or central (SMOC)
  control room. Watches a wall screen and a desk monitor. Job: see what is wrong
  now and where, then open the asset or acknowledge the alarm.
- **Site engineer / manager.** Checks a site from a desk or laptop a few times a
  day. Job: health, load and what changed, then drill into an asset or a domain.

The owner ruled (2026-10-01) that the two have **equal weight** on the site
Overview: the normal view serves both, and a wall mode serves the operator on a
wall screen.

## Product Purpose

IONSiTE NEXUS (internal name TRINETRA) is a real-time enterprise monitoring
platform (BMS/EMS) for electrical, HVAC, UPS/battery, water and environmental
telemetry across many sites. The pipeline is device or MQTT RTU → Postgres +
TimescaleDB → NestJS API → Socket.IO → React UI. Success: an operator sees an
abnormal state within seconds, knows where it is, and can act on it.

## Positioning

The Enterprise EMS product line for Ion Exchange (India) Ltd. (ADR 0013), forked
from the Eskom SMOC engagement. One Control Room section (ADR 0087) gives every
organization the same site view: a tabbed site layout copied from the "SMOC
standard" template, bound to the site through asset-group roles and point keys,
with the generated view as the fail-safe.

## Operating Context

- Organizations: ESKOM (CSMOC Gauteng and the RSMOC regions) and PHEWB (six pump
  stations), plus demo organizations. Seeded demo logins: `admin@bms.local`
  (global), `wc-admin@bms.local` (location), `wc-hvac-admin@bms.local` (group).
- A site view: an Overview tab, one tab per asset domain at the site (Electrical,
  UPS & battery, HVAC, Water, Environment, IT), and the fixed "Assets & RTUs" tab.
- Telemetry is live through a socket; alarms arrive on `/ws/alarms`.
- A wall PC stays on for a whole shift. Sessions expire (OIDC / local auth); the
  owner ruled no auth change for wall use (2026-10-01).
- First stable version (v1) ships 2026-10-02 to an AWS server.

## Capabilities and Constraints

- Dashboards are a 12-column grid of typed widgets (`widgetType` is a closed
  vocabulary, ADR 0047). Site layouts are copies of a versioned template; a later
  template version never overwrites an admin-edited copy (ADR 0087).
- Widget icons are a closed six-value vocabulary (`alert`, `clipboard`, `bolt`,
  `drop`, `recycle`, `gauge`).
- **Colours stay as they are** (owner ruling 2026-10-01): no palette change and no
  ISA-101 grey-for-normal conversion. The existing state colours, the brand accent
  and the neumorphic / flat surfaces (ADR 0085) are kept.
- Reference mockups `ESKOM_SMOC.html` and `TRINETRA.html` are read-only visual
  references (AGENTS.md §5).
- Scope changes move through ADRs (AGENTS.md §10); AGENTS.md is the rulebook.

## Brand Commitments

- On-screen name: **IONSiTE NEXUS**, "powered by Euphoria Infotech India Limited"
  (ADR 0083). Internal identifiers keep their Eskom-era names.
- Theme switch (light / dark) and surface switch (neumorphic / flat) are user
  choices (ADR 0085).

## Evidence on Hand

- Live seeded data on the shared stack: 7 seeded site layouts (CSMOC Gauteng and
  six PHEWB sites) with the simulator publishing control-room, HVAC, water and
  electrical points.
- Impeccable critique of the site layout, 2026-10-01: 20/40 (a local run, not
  committed: `.impeccable/critique/2026-10-01T07-09-25Z__…site-dashboard-view-tsx-fcc5e58b.md`).
- No user research, no operator interviews and no customer quotes exist. Do not
  invent them.

## Product Principles

1. **What is wrong now, and where, comes first.** Every operator surface leads
   with abnormal state and its location.
2. **One status, shown once per screen.** A domain's state appears in one place
   on a screen, and the same rule decides it everywhere (server `tabTone`).
3. **Never show stale data as live.** A lost session, a lost socket or a stale
   reading says so plainly.
4. **The site layout is the admin's.** Template upgrades touch only what the
   admin has not changed.

## Accessibility & Inclusion

- State is never colour alone: every pill and marker carries text.
- Keyboard: the ARIA tabs pattern and a visible `--focus` outline (F3.73).
- Wall use: readable from across a room; no information that needs hover.
