# ADR 0118 — Selectable design systems (`F4.341`)

## Status

**Proposed — 2026-11-09.** Raised by `F4.341` (the owner, 2026-11-09). The
owner accepted the scope and the six-style shortlist in chat on 2026-11-09
after a live preview of every design system with every colour profile, then
gave six rulings one at a time (listed under *Rulings*). The merge of this
record is the acceptance. Lines marked *(drafter)* are drafter calls that the
`F4.341` plan may refine; the others are rulings.

Amends [ADR 0110](./0110-organization-colour-profiles.md) (Q3 who sees which
profile, Q6 colour only, Q7 the closed list, the sign-in page, and the
out-of-scope per-user profile) and
[ADR 0085](./0085-neumorphic-surface-style.md) (the surface vocabulary becomes
one axis of a design system). Code citations are to `main` at `ec7d095e`.

## Context

**The request.** Several predefined design systems held by the portal. The
global admin chooses one for the portal, an admin chooses one for an
organization, and a user chooses one for themself. A choice changes the look
and feel and the layout of the whole portal, not only the colours.

**What the code does today.**

- The look is three attributes on `<html>`: `data-theme` (Light / Dark, per
  browser, ADR 0078), `data-profile` (the colour profile of the home
  organization, ADR 0110) and `data-surface` (Neumorphic / Flat, per browser,
  ADR 0085). The boot script in `apps/web/index.html` sets them before the
  first paint.
- Colour is fully tokenized: 52 role tokens, no colour literal in a call site
  (ADR 0078 Amendment 3, ADR 0110 Amendment 1).
- Shape is mostly tokenized: about 650 call sites use the surface vocabulary
  (`surface-raised`, `surface-field`, `surface-button`, … in
  `apps/web/src/index.css`), and each class has a neumorphic and a flat rule.
- **Type and spacing are not tokenized.** In the 332 non-test `.tsx` files
  under `apps/web/src`, 1,706 lines carry a Tailwind text-size utility and
  2,253 lines a padding or gap utility. The one font is IBM Plex Sans
  (`apps/web/tailwind.config.js`).
- One app frame: `apps/web/src/layouts/app-shell.tsx` (chrome header and the
  navigation).
- The profile is stored only per organization
  (`bms.organizations.colour_profile`). There is no portal-level settings table
  and no per-user look preference.

**The preview.** A published preview showed the Control Room site overview in
each of the six design systems, with each of the six ADR 0110 profiles and
three draft profiles, in both themes. The owner accepted the shortlist from it.

## Rulings

| # | Question | Ruling |
|---|---|---|
| S1 | What can a design system change? | **Skin, type and spacing tokens, and one shell from a closed set.** No per-page layouts: every design system renders the same pages and widgets. |
| S2 | Which design systems? | **Six:** `nexus-soft` (the default, today's look), `enterprise-flat`, `swiss-grid`, `bento-ops`, `control-room-dark`, `glass-showcase` (demos and lobby screens). |
| Q1 | Design systems and colour profiles? | **Combine freely.** A design system sets shape, type, spacing and shell only. Any profile works with any design system. |
| Q2 | The Neumorphic / Flat switch? | **Kept for all.** Each design system has a neumorphic and a flat variant, and the user's per-browser switch picks between them. |
| Q3 | Who sets it, and which wins? | **User > Organization > Portal.** The global admin sets the portal default; the global admin or the organization admin sets an organization value; a user may set a personal value. An empty value falls through to the next level. |
| Q4 | Does the colour profile follow the same order? | **Yes.** One rule for both choices. A user may set a personal profile, and the portal has a default profile. |
| Q5 | The sign-in page? | **The portal default** design system and profile. It never shows an organization or a user value. |
| Q6 | The three draft profiles from the owner's references? | **All three join the closed list**, each under the same gates: `forest`, `sand`, `navy-pop`. |

## Decision

1. **Six closed design systems (S2).** `designSystemSchema =
   z.enum(["nexus-soft", "enterprise-flat", "swiss-grid", "bento-ops",
   "control-room-dark", "glass-showcase"])` in `packages/shared/src/contracts/`
   is the one list. The API, the web, the CHECKs and the gates read it or are
   held to it by a test. A new design system is a contract change and an
   amendment to this ADR. `nexus-soft` is today's look exactly, so a site that
   never chooses sees no pixel change.

2. **What a design system is (S1).** A design system is a set of values for
   **design tokens** plus one **shell**:
   - *Shape:* the surface vocabulary of ADR 0085 (radius, border, shadow and
     ground for each `surface-*` class), in a neumorphic and a flat variant
     (Q2).
   - *Type:* font families (`--font-body`, `--font-head`, `--font-num`) and a
     type scale (`--text-2xs` … `--text-3xl`) with weights and the label case
     and letter-spacing.
   - *Spacing:* a density scale (`--space-1` … `--space-8`, the card padding
     and the grid gap).
   - *Shell:* one of `sidebar`, `topbar` or `rail` (decision 6).
   - *(drafter)* Board arrangement: a design system may give a dashboard or
     overview a different column count and tile span **from a fixed table per
     page**, never free placement, so an alarm card can never be hidden.

   A design system **never** sets a colour role. The colour stays the
   profile's (Q1). It may compose colours from roles only (for example a
   gradient or a translucent card built from `accent`, `series-*` and
   `surface`), as the neumorphic shadows do today.

3. **The tokenization prerequisite.** Before any design system other than
   `nexus-soft` ships, every text-size, padding and gap utility in
   `apps/web/src` moves to the type and spacing tokens, with `nexus-soft`
   values equal to today's Tailwind values (no pixel change). A gate holds the
   count of raw size and spacing utilities at zero, as ADR 0078 Amendment 3
   does for colours. *(drafter)* The plan splits this by page area; it is
   mechanical and lands before any new design system.

4. **How the web applies it.** `index.css` keeps the `nexus-soft` values as
   the base. Each other design system adds blocks keyed on
   `:root[data-design="<name>"]` (and with `[data-surface="flat"]` for the
   flat variant) that set only design tokens and the surface rules. The boot
   script sets `data-design` beside the other three attributes. Charts read
   the type tokens through `resolveRoles` / `useChartTheme`, and
   `currentRoles()` caches per theme, profile **and** design system.

5. **Fonts.** Every font a design system names is self-hosted from
   `apps/web` (no Google Fonts call at run time; some sites have no internet).
   Only OFL or Apache-2.0 fonts: IBM Plex Sans, IBM Plex Sans Condensed,
   IBM Plex Mono, Roboto, Archivo and Bricolage Grotesque. Adding the font files
   is a dependency under AGENTS §9.4 and this ADR is its record. A design system
   loads only its own faces.

6. **Three shells.** `app-shell.tsx` becomes a selector over three shell
   components that share one navigation model (the same items, order,
   permissions and routes):
   - `sidebar` — the chrome header and a left navigation (`nexus-soft`,
     `enterprise-flat`);
   - `topbar` — the chrome header and a horizontal tab bar (`swiss-grid`,
     `bento-ops`, `glass-showcase`);
   - `rail` — a narrow icon rail and a thin header with a live status strip
     (`control-room-dark`).
   The wordmark (ADR 0083) and the alarm bell appear in every shell. The
   control room wall keeps its own frame and takes only the tokens.

7. **The alarm colours stay fixed.** No design system changes a fixed role of
   ADR 0110 decision 2 (`ok*`, `critical*`, `warning*`, `info*`). No design
   system adds a glow, blur or animation to an alarm state. The
   `glass-showcase` blur never applies under an alarm card or the alarm list:
   those surfaces are opaque in every design system.

8. **Precedence (Q3, Q4).** The effective design system and the effective
   profile each resolve as: **the user's value, else the home organization's
   value, else the portal value.** A global `admin` with no home organization
   falls through from the user to the portal. `GET /auth/me` returns both
   effective values and the level each came from.

9. **Storage.** One forward-only migration:
   - `bms.portal_settings`, one row (`id smallint PRIMARY KEY CHECK (id = 1)`),
     with `design_system varchar(32) NOT NULL DEFAULT 'nexus-soft'` and
     `colour_profile varchar(32) NOT NULL DEFAULT 'nexus'`, each with a CHECK on
     its closed list. Read by every signed-in role; written only by the global
     `admin`. *(drafter)* RLS and grants follow the pattern of the other global
     tables; the migration review confirms them.
   - `bms.organizations.design_system varchar(32) NULL` with a CHECK. NULL
     means "use the portal value".
   - `bms.organizations.colour_profile` becomes **nullable** with the same
     meaning. Existing rows keep their value, so no organization sees a change.
   - `bms.users.design_system varchar(32) NULL` and
     `bms.users.colour_profile varchar(32) NULL`, each with a CHECK. NULL means
     "use the organization value".
   Tests hold every CHECK list to its shared Zod enum.

10. **Routes.** Each write is audited with the old and the new value, and the
    OpenAPI document follows (ADR 0029, ADR 0030):
    - `GET` / `PUT /admin/portal-settings/appearance` — global `admin` only;
      action `master.portal.appearance.update`.
    - `PUT /admin/organizations/:id/appearance`, body
      `{ designSystem, colourProfile }` (each nullable) — the global `admin`
      for any organization, an organization-level admin for their own
      (`isOrganizationLevelAdmin`, ADR 0110 Amendment 1 OQ4); action
      `master.organization.appearance.update`. It replaces
      `PUT /admin/organizations/:id/colour-profile`; the old route stays one
      release as an alias and is then removed.
    - `PUT /me/appearance`, body `{ designSystem, colourProfile }` (each
      nullable) — any signed-in user, for themself only; action
      `user.appearance.update`.

11. **The choosers.** *(drafter)* One "Appearance" panel, reused at the three
    levels (portal settings, the organization, the user menu): the design
    systems and the profiles as two lists, a choice previews the whole page
    with the real tokens, Cancel restores, Save writes and re-reads
    `/auth/me`. Each list has an "Inherit (<value>)" item that writes NULL,
    except at the portal level.

12. **The sign-in page (Q5).** The sign-in page shows the portal default. A
    public, unauthenticated `GET /public/appearance` returns only
    `{ designSystem, colourProfile }` of `bms.portal_settings`. The boot script
    caches it as `bms.portal-appearance`. Sign-out removes the user's cached
    values (`bms.profile`, `bms.design`), so a shared control-room PC returns
    to the portal default, never to the last user's organization.

13. **Nine colour profiles (Q6).** `colourProfileSchema` grows to
    `["nexus", "ocean", "lagoon", "indigo", "graphite", "high-contrast",
    "forest", "sand", "navy-pop"]`. Each new profile sets only the changeable
    roles and passes every ADR 0110 decision 5 gate and Amendment 1 OQ1/OQ3
    rule in both themes. `navy-pop`'s `accent` must also be ΔE2000 ≥ 20 from
    `critical` in both themes; if no pink passes, the plan darkens it, and if
    it still fails the profile is dropped by an amendment. The PR that adds the
    values carries the value table and the measured ratios, and merging it
    approves the table (AGENTS §10).

14. **The gates per design system.** For every design system × surface variant
    × profile × theme:
    - every `TEXT_PAIRS` and `UI_PAIRS` entry on the grounds that design system
      paints (for example the `glass-showcase` card, measured over its worst
      gradient point; the `swiss-grid` page on `surface`);
    - body text at least `--text-xs` and wall text at least the wall minimum;
    - a test that each design system defines every design token and every
      `surface-*` rule in both variants, and sets no colour role.
    *(drafter)* Pairs that a design system does not change are measured once
    per profile, not once per combination.

15. **What follows and what does not.** A design system restyles every page,
    dashboard, the control room and its wall, the mimic frames, the charts'
    type and the dialogs. It does not change the PDF and Excel reports, the
    emails, the Keycloak pages, the map tiles or the mimic drawings' geometry.

## Dependencies

Self-hosted font files under `apps/web` (decision 5): IBM Plex Sans Condensed,
IBM Plex Mono, Roboto, Archivo and Bricolage Grotesque, all OFL or Apache-2.0.
*(drafter)* The plan picks the delivery (the `@fontsource/*` packages or files
in `apps/web/public/fonts`). Either way §9.4 is engaged and this ADR is the
record. The schema change is this ADR's (decision 9).

## Consequences

- The type and spacing tokenization (decision 3) is the largest part of the
  work and is a prerequisite. It brings no visible change by itself.
- The gate matrix grows from 6 profiles × 2 themes to 6 design systems × 2
  surface variants × 9 profiles × 2 themes (216 combinations). Decision 14
  keeps the test time bounded by measuring only the pairs a design system
  changes.
- Keeping Neumorphic / Flat for every design system (Q2) doubles the shape
  rules to design and test.
- A user can now override the organization's colours and look for themself
  (Q3, Q4). An organization cannot lock its value. A lock is a later row if it
  is needed.
- The sign-in page can change, by the portal default only (Q5).
- `glass-showcase` is the most expensive design system at run time
  (`backdrop-filter`); decision 7 keeps it off the alarm surfaces.
- **Out of scope:** per-page layouts, free tile placement, a per-location
  design system, an organization lock, a custom or uploaded design system,
  design systems in reports and emails, a live push of a change, and a copilot
  action.

## Owed after the build

- The `chore(agents):` sweep: AGENTS.md §5 (design systems, design tokens,
  shells, the precedence order) and its status line.
- The Docker-stack, DB and browser checks of AGENTS §4.6: the migration hash
  and `\d` of the three tables; the route 403 cases with `curl`; the
  precedence at each level after reload; the sign-in page on the portal
  default after sign-out; the wall in each design system.
