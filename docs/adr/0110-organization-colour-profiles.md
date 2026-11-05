# ADR 0110 — Organization colour profiles (`F4.310`)

## Status

**Proposed — 2026-11-05.** Raised by `F4.310` (the owner, 2026-11-04). The
owner gave nine rulings in chat on 2026-11-05, one at a time, each as
recommended, before this record was written (listed under *Rulings*). The merge
of this record is the acceptance. Lines marked *(drafter)* are drafter calls
that the `F4.310` plan may refine; the others are rulings.

Amends [ADR 0078](./0078-colour-tokens-and-user-theme-switch.md) (Amendment 5:
the `ok` role and the fixed / changeable role lists). Code citations are to
`main` at `4fcbb13`.

## Context

**The request.** A fixed set of colour profiles. The organization admin
chooses one, and every page, dashboard and control room of that organization
changes its colours for all its users. The layout never changes.

**What the code does today.**

- `apps/web` paints only through **49 role tokens** (ADR 0078 decision 1,
  Amendment 4). Each role has one light value in `:root` and one dark value in
  `:root[data-theme="dark"]` of `apps/web/src/index.css`. The palette, hex and
  colour-function counts are hard zeros (ADR 0078 Amendment 3), so no
  call site holds a colour value.
- **No colour is stored as data.** Dashboard widgets store a `tone`, the trend
  strip stores a series role by name (ADR 0078 Amendment 4 item 5), and a mimic
  layout or symbol stores only geometry and role names
  (`packages/shared/src/contracts/mimic-layouts.ts:179`, `mimic-shapes.ts:6`).
  So new role values recolour all of them with no data change.
- ECharts reads the roles at render time through `resolveRoles` /
  `useChartTheme` (`apps/web/src/lib/theme.ts`, `lib/chart-theme.ts`). The
  result is cached per theme.
- The gates read exactly one light block and one dark block
  (`tests/support/colour-tokens.ts` `parseTokenBlocks`). They hold the declared
  pairs at 4.5:1 (text) and 3:1 (UI) in both themes
  (`tests/f3.65a-colour-contrast.test.ts` C1–C8). The light allowlist has known
  entries, most of them the brand green as text. The S1–S3 checks hold the
  series roles by CIEDE2000.
- **`accent` has two meanings.** It is the brand green (buttons, links, the
  wordmark), and it is also the "OK / healthy" state:
  `WIDGET_TONE_ROLE.ok` (`lib/widget-catalog.ts:87`), the map `healthy` marker
  (`lib/map-site.ts:132`), the health donut's good slice
  (`components/asset-health/health-summary-donut.tsx:29`), the sparkline and
  trend strip default (`components/control-room/sparkline.tsx:17`,
  `lib/trend-strip.ts:95`) and the chart series palette
  (`lib/chart-theme.ts:20`). A profile that changes `accent` would also change
  "OK".
- `bms.organizations` has no colour column. Only the global `admin` can write
  to an organization (`PATCH /admin/organizations/:id`,
  `apps/api/src/admin/organizations/organizations.service.ts`,
  `assertAdminRole`). The role `organization_admin` exists
  (`packages/shared/src/contracts/auth.ts:12`). The `timezone` column
  (migration 0106, ADR 0099 Amendment 1 A2) is the precedent for a small
  per-organization setting.
- `GET /auth/me` returns `{ user, scope }` and does not name a profile. A
  global `admin` has no home organization (`users.organization_id` NULL).

## Rulings

Asked one at a time on 2026-11-05. All nine were ruled as recommended.

| # | Question | Ruling |
|---|---|---|
| Q1 | Which colours can a profile change? | **The alarm and state colours are fixed in every profile.** A new fixed role `ok` takes the "OK / healthy" meaning off `accent`. A profile changes the neutrals, the `accent` family, the chrome, the focus ring and `series-1…8`. |
| Q2 | Who can choose? | **The global `admin` for any organization; an `organization_admin` for their own organization only.** Through a new narrow route, `PUT /admin/organizations/:id/colour-profile`, audited. The full `PATCH` stays global-admin only. |
| Q3 | Which profile does a user see? | **The profile of the user's home organization, everywhere in the app.** A global `admin` with no home organization sees the default. `GET /auth/me` returns the profile name. The web sets `data-profile` on `<html>` and caches it in `localStorage` (`bms.profile`) for the first paint. |
| Q4 | Do the wall, the reports and the emails follow? | **The control room wall follows** (a signed-in page). **PDF and Excel reports and the emails do not** (ADR 0078 Consequences: documents stay as they are). |
| Q5 | How does each profile pass the gates? | **Every profile passes all declared pairs in both themes**, text 4.5:1 and UI 3:1, on `surface` and on `canvas`. Only the default keeps today's allowlist; **each new profile has an empty allowlist**. Each profile's `series-*` passes S1/S2, and its `accent` is ΔE2000 ≥ 20 from `warning` and `critical`. |
| Q6 | What does a profile change besides colour? | **Colour only.** Light/Dark and Neumorphic/Flat stay each user's per-browser choice. No layout, font, density or logo change. **The sign-in page always shows the default profile.** Map tiles, the Keycloak pages and third-party defaults do not change. |
| Q7 | Which profiles? | **Six:** `nexus` (today's colours, the default), `ocean` (blue accent, cool blue-grey neutrals), `lagoon` (teal accent), `indigo` (indigo/violet accent), `graphite` (slate-grey accent, the least colour), `high-contrast` (the Nexus hues with darker inks, stronger lines and a stronger focus ring, for control rooms and walls). |
| Q8 | How is the choice stored? | **One column** `bms.organizations.colour_profile varchar(32) NOT NULL DEFAULT 'nexus'` with a CHECK on the six names, and one shared Zod enum. |
| Q9 | What form does the record take? | **This new ADR**, and a short ADR 0078 Amendment 5 for the `ok` role and the role lists. |

## Decision

1. **Six closed profiles (Q7).** `colourProfileSchema =
   z.enum(["nexus", "ocean", "lagoon", "indigo", "graphite", "high-contrast"])`
   in `packages/shared/src/contracts/` is the one list. The API, the web, the
   migration's CHECK and the test gates all read it or are held to it by a
   test. A new profile is a contract change and an amendment to this ADR.
   `nexus` is the default and is the present token values exactly, so a site
   that never chooses sees no pixel change.

2. **Fixed and changeable roles (Q1).** The 49 roles become **50** with `ok`
   (ADR 0078 Amendment 5). Each role is in exactly one list, and a test holds
   the lists to the token file:
   - **Changeable (25):** `canvas`, `surface`, `well`, `well-deep`, `line`,
     `line-strong`, `ink`, `ink-muted`, `ink-faint`, `ink-hint`,
     `neutral-ink`, `accent`, `accent-strong`, `chrome`, `chrome-nav`,
     `on-accent`, `focus`, `series-1` … `series-8`.
   - **Fixed (25):** `ok`, `ok-ink`, `ok-wash`, every `critical*` and
     `warning*` role, every `info*` role, `simulated-ink`, `on-dark` and
     `scrim`. A fixed role has one light and one dark value for all profiles.
     `on-dark` is fixed (white), so `chrome` must stay dark in every profile;
     the pairs `on-dark` on `chrome` / `chrome-nav` hold this (decision 5).

3. **The `ok` split (Q1).** `ok` has today's `accent` values exactly
   (`#00A651` light, `#3DCD58` dark), so the split moves no pixel. The
   "healthy" uses named in *Context* move from `accent` to `ok`; the brand uses
   stay on `accent`. *(drafter)* The plan lists each moved call site. The
   sparkline and trend strip default and the chart series palette's first
   colour are brand uses (a line, not a state) and stay on `accent`, unless
   the plan finds that one of them shows a state.

4. **How the web applies a profile (Q3, Q6).**
   - `index.css` keeps its two role blocks as the `nexus` values. Each other
     profile adds two blocks that set **only the changeable roles**:
     `:root[data-profile="<name>"]:not([data-theme="dark"]) { … }` and
     `:root[data-profile="<name>"][data-theme="dark"] { … }`. Both have
     specificity (0,3,0), above the base blocks' (0,1,0)/(0,2,0), so the
     order in the file does not matter, and a light profile block can never
     win in dark.
   - `GET /auth/me` adds `colourProfile` (the home organization's value, or
     `nexus` for a user with no home organization). After sign-in and on each
     `/auth/me` read, the web sets `data-profile` on `<html>` and writes
     `bms.profile`.
   - The boot script in `index.html` reads `bms.profile` and sets
     `data-profile` only for one of the six names, and only when a stored
     session exists. Otherwise it sets nothing (the default). Sign-out removes
     `bms.profile` and the attribute, so **the sign-in page always shows
     `nexus`**, also on a shared control-room PC.
   - `currentRoles()` caches per theme **and** profile, and charts re-render
     when either changes.
   - *(drafter)* Other open sessions of the same organization get the new
     profile on their next `/auth/me` read or page load. There is no
     WebSocket push.

5. **The gates per profile (Q5).** `parseTokenBlocks` learns the profile
   blocks and fails closed: on a profile name outside `colourProfileSchema`, on
   a profile with one theme block and not the other, on a profile block that
   leaves out a changeable role, and on a profile block that sets a fixed role.
   Each of the five non-default profiles is the `nexus` values with its own
   blocks laid over them, and it must pass:
   - every `TEXT_PAIRS` entry at 4.5:1 and every `UI_PAIRS` entry at 3:1, in
     both themes, with **an empty allowlist**. `nexus` keeps today's allowlist
     unchanged. The pairs include each status role on the profile's neutrals
     and the text pairs on `canvas` (the neumorphic cards paint `canvas`,
     ADR 0085);
   - S1/S2 on its `series-*` (ΔE2000 ≥ 20 from `warning` and `critical`, ≥ 10
     between two series), in both themes;
   - `accent` and `accent-strong` at ΔE2000 ≥ 20 from `warning` and
     `critical` in both themes.
   The PR that adds the profile values carries the value table and the
   measured ratios, and says that **merging it approves the value table**
   (AGENTS §10).

6. **Storage (Q8).** One forward-only migration adds
   `bms.organizations.colour_profile varchar(32) NOT NULL DEFAULT 'nexus'`
   and `CHECK (colour_profile IN ('nexus','ocean','lagoon','indigo','graphite','high-contrast'))`.
   Every existing row becomes `nexus`. The Drizzle schema follows, and a test
   holds the CHECK list to `colourProfileSchema`. No new table, no new role
   grant: the existing grants and RLS on `organizations` apply. If the mimic
   rows (`F4.307`–`F4.309`) also add a migration, the PR that merges second
   takes the next number.

7. **Who chooses, and the route (Q2).**
   `PUT /admin/organizations/:id/colour-profile`, body `{ colourProfile }`,
   answers the organization with its `colourProfile`. A global `admin` may set
   any organization. An `organization_admin` may set only the organization
   with the same id as their home organization; any other id answers 403.
   Every other role answers 403. The write goes through the access-control
   service the organization routes already use. A change writes an audit row,
   action `master.organization.colour_profile.update`, with the old and the new
   name. `GET /admin/organizations` and `GET /admin/organizations/:id` return
   `colourProfile`. The full `PATCH` does not accept the field. The OpenAPI
   document follows (ADR 0029, ADR 0030).

8. **The chooser.** *(drafter)* A "Colour profile" panel that the global
   admin sees on each organization, and the `organization_admin` sees for
   their own organization: six named swatches, each drawn from that profile's
   own role values in the current theme, and one Save. Saving applies the
   profile at once for the user who saves it (the `/auth/me` read is
   refetched). The copilot gets no colour-profile action in this row.

9. **What follows and what does not (Q4, Q6).** The profile recolours every
   page, every dashboard, the control room and its wall, the mimic drawings,
   the charts and the neumorphic shadows (they are built from roles). It does
   not change the PDF and Excel reports, the notification emails, the
   Keycloak pages, the map tiles, Tailwind preflight's `::placeholder` colour
   or other third-party CSS defaults. Light/Dark (`bms.theme`) and
   Neumorphic/Flat (`bms.surface`) stay per user and per browser.

## Dependencies

None. No new package; Tailwind, Zod and Drizzle are already in use. §9.4 is
not engaged. The schema change is this ADR's (decision 6).

## Consequences

- A new role must be put in the fixed list or in the changeable list. A
  changeable role needs a value in every profile block, and it is measured in
  every profile.
- An `organization_admin` gets one write on their own organization. This is
  the first organization write that is not global-admin only.
- A site that never chooses sees no change. The `ok` split moves no pixel.
- Each new profile has better contrast than `nexus` today (empty allowlist).
  Finding values that pass every pair in both themes is work for the plan, and
  `high-contrast` raises the bar for the neutrals only. It does not change the
  fixed status colours.
- A global admin always sees `nexus`. To see a client's profile, they use the
  chooser's swatches. A "preview as organization" choice is a later row.
- **Out of scope:** a per-user profile, a per-location profile, a profile
  colour picker or uploaded palette, a default theme or surface style per
  profile, profile colours in reports and emails, a live push of a profile
  change, and a copilot action.

## Amendment 1 — the plan rulings and the profile values (2026-11-05)

**Status: Accepted with the merge of `F4.310` PR D.** The owner ruled six plan questions in chat on
2026-11-05, one at a time, each as recommended (plan `docs/plans/f4.310-organization-colour-profiles.md`
§7). **Merging PR D approves the value table below** (AGENTS §10).

1. **OQ1 — the carry-over list (refines Q5).** "An empty allowlist" cannot pass: some of the
   default's failures come from a fixed role. A new profile may keep failing only these **10**
   entries of the default's allowlist, each measured again on the profile's own values: the four
   `warning`/`info` dots and bars on `surface`/`canvas`, the donut's `warning-on-dark` slice,
   `ok` on `canvas` (PR A: the same pixel as `accent` on `canvas`), the placeholder
   (`ink-hint` on `surface`), the white toggle knob (`on-dark` on `line-strong`), and in dark the
   two formula-editor selection entries. The seven brand-green entries never carry over, so every
   new profile's brand colour passes 4.5:1 as text.
2. **OQ2 — two more roles (refines decision 2).** `ok-strong` (fixed, = the default's
   `accent-strong`) and `accent-on-chrome` (changeable, the brand colour on the dark chrome: the
   wordmark). With `ok`, **52 roles**: 26 fixed, 26 changeable. One brand value cannot pass 4.5:1 on
   both the white `surface` and the dark `chrome`.
3. **OQ3 — the accent keeps away from the fixed state hues.** `accent` is ΔE2000 ≥ 12 from `info`
   and from `simulated-ink`, both themes, every profile; with decision 5, `accent` and
   `accent-strong` are ≥ 20 from `warning` and `critical`. `indigo` is therefore a deep
   indigo-navy, not a violet.
4. **OQ4 — the `organization_admin` gate (refines decision 7).** `isOrganizationLevelAdmin`: a
   direct organization grant, the gate a location move uses — not "the home organization". Users
   still **see** their home organization's profile (Q3).
5. **OQ5 — the split.** Serial PRs: A (the `ok` split, #1010), B (column, route, `/auth/me`, #1015),
   C (the mechanism, #1020), A2 (the mimic state sites), D (values and chooser).
6. **OQ6 — which `accent` sites are states.** Every site that shows a named state (normal, ok,
   healthy, running, energised, closed, good, sent, ON) uses `ok` / `ok-strong`, the schematics
   included; brand, selection, category and quantity uses keep `accent`. The mimic files moved in
   A2, after `F4.307`–`F4.309`, so no profile was visible with a half-moved mimic.

**Two drafter calls of the ADR, as built.** The chooser (decision 8) is a list of the six profiles
with a one-line description each; a choice previews the **whole page** in that profile's real
role values (no copy of the values), Cancel restores, Save writes and re-reads `/auth/me`.
`GET /admin/organizations/:id` keeps its summary DTO; the chooser reads the list.

**The values** (changeable roles only; every fixed role keeps the default's value).
`apps/web/src/index.css` is the authority; this table is read from it.



**Measured** (WCAG 2.x ratios and CIEDE2000, from the token file; every declared pair and the
distance rules are `tests/f3.65a-colour-contrast.test.ts` Q0–Q5):



## Owed after the build

- The `chore(agents):` sweep: AGENTS.md §5 (role tokens: 50 roles, the fixed
  and changeable lists, profiles per organization) and its status line.
- The Docker-stack, DB and browser checks of AGENTS §4.6, run later in the
  owner's local session: the migration hash and `\d bms.organizations`; the
  route's 403 cases with `curl`; a profile change seen by a second user of the
  same organization after reload; the sign-in page on `nexus` after sign-out;
  the wall in each profile.
