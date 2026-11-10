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

## Amendment 1 — the design review rulings (2026-11-09)

**Status: Proposed — 2026-11-09. The merge of this amendment is its
acceptance.** Before the plan, the owner asked for a review of the design
systems and the profiles against two design rulebooks: Impeccable 4.8.1
(`critique`, `audit`, `craft-floor`, `mode-operate`, `colorize`, `typeset`,
`layout`) and taste-skill 2.5.1 (`system`, `cards`, `icons`, `motion`,
`perf`, `copy-tells`, `library/type.json`, `library/palettes.json`). Both were
read as rules only: no launcher, binary or gate of either tool was run. The
reviews read the preview page and `apps/web/src/index.css`, and measured the
draft profiles with a WCAG 2.x and CIEDE2000 script that reproduces the known
`nexus` values. The owner then ruled six questions, one at a time, each as
recommended.

**What the reviews found** (the numbers that drove the rulings):

- `glass-showcase` blurred the alarm card (against decision 7), and
  `ink-faint` on a glass card measured 3.41–4.14:1 in every profile.
- `forest`'s draft `accent` `#6D28D9` is exactly the light `simulated-ink`, and
  its dark `series-3` `#FBBF24` is exactly `warning-on-dark`.
- `navy-pop`'s `accent` is ΔE2000 22.2 from `critical` (light) but 18.2 from
  `critical-ink` (dark) and its `accent-on-chrome` 17.5 from
  `critical-on-dark`. `sand`'s dark `accent` is ΔE2000 14.5 from `info`, and
  its `series-1` equals its `accent`. No draft sets `series-4…8`.
- `bento-ops` filled a 64px hero tile with `accent` (with `nexus`, a large
  green "OK" tile; `on-accent` at .85 opacity measured 2.71:1).
- `control-room-dark` drew accent corner brackets on every card, and set
  labels at 10–11px on a wall surface with an icon-only rail.
- `enterprise-flat`'s secondary button edge (`line-strong` on `surface`)
  measured 1.47–1.84:1. `nexus-soft` paints `ink-faint` text on `canvas`,
  4.32:1 in `nexus` light.

| # | Question | Ruling |
|---|---|---|
| A1 | `glass-showcase`? | **Dropped.** Five design systems. No `backdrop-filter` in the portal. |
| A2 | `enterprise-flat`'s font? | **IBM Plex Sans.** Roboto leaves the font list. |
| A3 | The `forest` profile? | **Re-coloured:** keep the forest-green and beige base, replace the violet accent with a forest/pine accent (two-tone), and replace `series-3` with a non-amber hue. |
| A4 | The accent gate? | **Every alarm role,** both themes (decision A4 below). |
| A5 | Accent use and decoration? | **An accent allow-list** for every design system (decision A5 below). |
| A6 | Type and readability? | **One rule set** for every design system (decision A6 below). |

**Decisions.** Each replaces or refines the decision it names.

- **A1 (amends S2 and decision 1).** `designSystemSchema = z.enum(["nexus-soft",
  "enterprise-flat", "swiss-grid", "bento-ops", "control-room-dark"])`. Five
  design systems. No design system uses `backdrop-filter`, translucency over
  content, or a gradient ground. The lobby or demo use goes to `bento-ops`.
  Decision 7's glass sentence and decision 14's glass example no longer apply.
- **A2 (amends decision 5).** The font list is IBM Plex Sans (variable, with
  the `wdth` axis), IBM Plex Mono, Archivo and Bricolage Grotesque. Roboto and
  the separate IBM Plex Sans Condensed family are removed: the condensed width
  comes from the `wdth` axis. *(drafter)* The plan confirms that the
  self-hosted Plex Sans file carries `wdth` 85–100; if no such file has a
  usable licence, Plex Sans Condensed comes back by an amendment.
- **A3 (amends decision 13).** The closed list keeps nine names, with `forest`
  re-coloured: its `accent`, `accent-strong` and `accent-on-chrome` are
  forest/pine hues on the beige base, and its `series-3` is not amber, brown
  or violet. The value table in the values PR is the authority.
- **A4 (amends decision 13 and ADR 0110 decision 5 / Amendment 1 OQ3, for
  every profile).** In both themes, `accent`, `accent-strong` and
  `accent-on-chrome` are each ΔE2000 ≥ 20 from **every** `critical*` and
  `warning*` role, and ≥ 12 from **every** `info*` role and `simulated-ink`.
  No `series-*` equals `accent`, and every `series-*` is ΔE2000 ≥ 20 from
  `warning` and `critical` and ≥ 12 from `info` (S1/S2 extended). Every
  profile sets `series-1…8`. A profile that fails is re-coloured; if
  `navy-pop`'s pink cannot pass, it is darkened, and if it still fails an
  amendment drops it. The existing six profiles are measured again under this
  gate in the values PR; a failure there is a value change in that PR, not a
  new ruling.
- **A5 (amends decision 2).** **The accent allow-list:** in every design
  system, `accent` paints only the primary button, the focus ring, links, a
  selection, the active navigation item and the wordmark. No tile, card,
  border decoration, ground or chart series is filled or drawn in `accent`. A
  test holds the list per design system. Then:
  - `bento-ops`'s large tile is a **neutral** span, and the fixed span table
    gives it only to the abnormal-now tile of a page (the active alarms or the
    worst asset), never to a quantity such as outflow. Its text is opaque.
  - `control-room-dark` has no corner brackets.
  - No primary button carries a shadow; `nexus-soft` keeps its raised cards.
  - A secondary button edge is ≥ 3:1 against its ground in every design
    system (a `UI_PAIRS` entry).
- **A6 (amends decisions 2, 3 and 14).** **One type and readability rule set**
  for every design system:
  - labels ≥ 12px, in sentence case, with no tracked capitals; the
    breadcrumb is a real breadcrumb in normal case, not an uppercase kicker;
  - weights 400, 500 and 600 only;
  - spacing tokens on the 4px scale;
  - a wall type-minimum token: body text on a wall surface is ≥ 16px
    *(drafter: the plan sets the exact scale)*;
  - every `--font-num` face proves tabular figures by a test;
  - at most two families per design system; Archivo and Bricolage Grotesque
    set headings (and, for Archivo, large figures) only, never body or table
    text;
  - `control-room-dark`'s rail shows text labels on a wall surface (a pinned
    expanded rail), because a wall has no hover;
  - text pairs are measured on every ground a design system paints, so
    `nexus-soft` adds `ink-faint` on `canvas` as a text pair: the values PR
    raises `ink-faint` or moves card meta text to `ink-muted`.

**Consequences of the amendment.**

- The gate matrix becomes 5 design systems × 2 surface variants × 9 profiles
  × 2 themes (180 combinations).
- The A4 gate may change values in the six shipped profiles. The values PR
  shows every changed value and its measured ratios, and merging it approves
  them (AGENTS §10).
- One font family fewer to ship (Roboto), and Plex Sans Condensed becomes an
  axis of Plex Sans.
- Out of scope, added: glass, gradient or translucent grounds; accent fills on
  tiles; decorative borders in `accent`.

## Amendment 2 — the plan rulings (2026-11-09)

**Status: Proposed — 2026-11-09. The merge of the PR that carries this
amendment and the plan `docs/plans/f4.341-selectable-design-systems.md` is its
acceptance.** The owner ruled seven plan questions in chat, one at a time
(plan §0, P1–P7). Two of them change this record; the others refine
*(drafter)* lines and live in the plan.

1. **P1/P7 — A6 is grandfathered for `nexus-soft` (amends A6's "for every
   design system").** `nexus-soft` keeps today's type: sizes under 12px,
   weight 700, uppercase and tracked labels, the uppercase breadcrumb. The A6
   rules are hard gates for the four other design systems. A4 and A5 still
   apply to every design system and profile, `nexus-soft` included: its first
   chart series moves off `accent`, and its primary button has no shadow.
   Because class strings are shared by every design system, the weight, the
   label case and the letter-spacing become design tokens (plan D8):
   `nexus-soft` keeps today's values, and the four others set A6's values. The
   A6 gates read the token blocks, not the class strings.
2. **P4 — the wall minimum is 16px in every design system**, `nexus-soft`
   included. It is a readability floor of the wall surface, not a style rule:
   on a wall every step under 16px is raised to it.
3. **P6 — `ink-faint` is raised (light) in every profile** until `ink-faint`
   on `canvas` passes 4.5:1 as text. This is a contrast fix in the values PR
   and applies to `nexus-soft` too.
4. **P5 — decision 10's alias.** The old route
   `PUT /admin/organizations/:id/colour-profile` and the `colourProfile` field
   of `GET /auth/me` are removed after the next release tag, by the follow-up
   row `F4.342`, not inside `F4.341`.
5. **D5 — two migrations (refines decision 9).** The nine-name CHECK on
   `bms.organizations.colour_profile` lands with the profile values (`0133`),
   before the appearance storage (`0134`).

The other rulings (P2 a Tailwind theme remap for the tokens, P3 the
`@fontsource` packages for the fonts) are plan choices within decisions 3 and
5.

## Values, as built (PR 2 of `F4.341`, 2026-11-09)

**Status: recorded with PR 2. Merging that PR approved the values (AGENTS §10).** The repository
gates measured every value below: `tests/f3.65a-colour-contrast.test.ts` Q0–Q3, A4a–c, T-ink and
C1–C8, for nine profiles in both themes. The PR body holds the full table of changeable roles.

**Changed shipped values** (A4, P6):

| Profile · theme | Role | Before | After | Why |
|---|---|---|---|---|
| nexus (base) · light | `ink-faint` | `#64748B` | `#5F6F85` | P6: 4.32 → 4.65:1 on `canvas` |
| nexus (base) · dark | `series-1` | `#60A5FA` | `#818CF8` | A4b: ΔE2000 8.6 → 19.5 from `info` |
| ocean · light | `ink-faint` | `#64748B` | `#607086` | P6: 4.34 → 4.61:1 |
| ocean · light | `series-1` | `#1D4ED8` | `#155E75` | A4b: it equalled `accent` |
| ocean · light | `accent-on-chrome` | `#60A5FA` | `#A5B4FC` | A4a: ΔE2000 8.6 from `info` |
| ocean · dark | `series-1` | `#60A5FA` | `#A5F3FC` | A4b (and kept off ocean's blue-violet `accent`) |
| lagoon · light | `series-2` | `#0F766E` | `#155E75` | A4b: it equalled `accent` |
| lagoon · dark | `series-1` / `series-2` | `#60A5FA` / `#2DD4BF` | `#818CF8` / `#F9A8D4` | A4b: `info`; `series-2` equalled `accent` |
| indigo · dark | `series-1` | `#60A5FA` | `#A5F3FC` | A4b (and kept off indigo's `accent`) |
| graphite · light | `ink-faint` | `#71717A` | `#6D6D76` | P6: 4.40 → 4.66:1 |
| graphite · light | `accent` / `accent-strong` | `#475569` / `#334155` | `#334155` / `#1E293B` | A4a: `accent` was ΔE2000 10.5 from `info-ink` |
| graphite · light | `accent-on-chrome` | `#CBD5E1` | `#A1A1AA` | A4a: ΔE2000 8.3–16.8 from the `critical`, `warning` and `info` wash and line roles |
| graphite · dark | `series-1` | `#60A5FA` | `#818CF8` | A4b |
| high-contrast · dark | `series-1` | `#60A5FA` | `#818CF8` | A4b |

**The three new profiles** start from the preview's tuned values (Amendment 1), with
`series-4…8` from the `nexus` sets and these changes made while measuring: `forest` light
`chrome` `#163323` → `#0E1C14` (`ok` and `critical` on the chrome were 4.29:1 and 2.84:1),
`forest` `series-3` light `#9D174D` / dark `#FDA4AF` (A3: not amber, brown or violet; the draft
`#334155` / `#CBD5E1` sat on `series-7`), `forest` dark `series-1` `#818CF8`, `sand`
`series-1` light `#155E75` / dark `#A5F3FC` (the drafts equalled `series-7`), `navy-pop`
`series-4` light `#57534E` / dark `#99F6E4`, and `navy-pop` dark `series-1` `#A5F3FC`. Every
draft `accent` passed A4 unchanged, `navy-pop`'s magenta included (light ΔE2000 20.9 from
`critical-line`, dark 21.3 from `critical-ink-strong`, the nearest alarm roles), so no profile
needed the amendment path.
## Dependencies, as built (PR 6 of `F4.341`, 2026-11-09)

**Status: recorded with PR 6.** Decision 5 and Amendment 1 A2 engage AGENTS §9.4; this is the
record. The plan's P3 chose the `@fontsource` packages. Four runtime dependencies of `apps/web`,
each pinned to its exact version and each under the SIL Open Font License 1.1 (the package
metadata's `license.type`):

| Package | Version | Faces imported in `apps/web/src/main.tsx` | Family name |
|---|---|---|---|
| `@fontsource-variable/ibm-plex-sans` | 5.3.0 | `standard.css` (`wght` 100–700 and `wdth` 75–100) | `IBM Plex Sans Variable` |
| `@fontsource/ibm-plex-mono` | 5.3.0 | 400, 500, 600 | `IBM Plex Mono` |
| `@fontsource-variable/archivo` | 5.3.0 | the default (`wght`) | `Archivo Variable` |
| `@fontsource-variable/bricolage-grotesque` | 5.3.0 | the default (`wght`) | `Bricolage Grotesque Variable` |

- **A2's `wdth` confirmation.** The Plex Sans package lists `wdth` 75–100
  (`tests/f4.341-fonts.test.ts` F2), so the separate IBM Plex Sans Condensed family is not shipped:
  `font-condensed` is Plex Sans at `font-stretch: 85%`. The Google Fonts `<link>` left
  `index.html`; no request goes to a Google host at run time (F1).
- **A6's tabular figures, as proved.** IBM Plex Sans and IBM Plex Mono carry **no `tnum` GSUB
  feature**: their default digits are already tabular (all ten share an advance of 600 units).
  Archivo and Bricolage Grotesque draw proportional digits by default and offer `tnum`. F6 therefore
  proves tabular figures from each WOFF2 as "the ten default digits share one advance width, or
  GSUB offers `tnum`", and the `font-num` utility sets `font-variant-numeric: tabular-nums` with
  `--font-num`, so a `tnum` face is tabular wherever numbers are set. The plan's "from the GSUB
  table" alone would have failed the two faces that are tabular as drawn.
- **F4's count.** `--font-mono` (IBM Plex Mono, the code face) is the same in every design system
  and is not one a design system chooses, so "at most two families" counts `--font-body`,
  `--font-head` and `--font-num`.
- An `@font-face` downloads only when a rule uses its family, so a design system loads only its own
  faces (decision 5).

## As built (`F4.341` closed, 2026-11-09)

**Status: recorded with PR 13.** The 13 PRs of the plan merged in order
(the PR list is in `docs/BACKLOG.md`, row `F4.341`). Where the build
departed from or read the plan, the reading is recorded here:

- **Migration 0134 grants column privileges on `bms.users`.** The plan said
  "no GRANT". `bms.users` holds column-level grants only, so the two new
  columns (`design_system`, `colour_profile`) are readable by no pool role
  until granted: `SELECT` to `bms_tenant`, `bms_fleet` and `bms_auth`, and
  `UPDATE` to `bms_fleet` (the user's own write). The role-grant matrix spec
  records both.
- **The text-size sweep (PRs 1b and 1c) moved a few sizes to the nearest
  step,** not pixel for pixel: 13px → `text-xs` (12px), 10.5px → `text-2xs`
  (11px), and the two non-SVG 9px sites → `text-3xs` (10px). SVG `<text>`
  sizes kept their pixels through the `fontSize` attribute (decision 15).
- **`control-room-dark` sets no heading width.** The plan's "Plex Sans heads at
  `font-stretch: 87.5%`" was not built: the type tokens carry families, not
  widths. Headings that already use `font-condensed` render at 85%.
- **Tabular figures and the font count** are recorded under *Dependencies, as
  built* (the digit-advance proof; `--font-mono` is not counted).
- **The portal appearance screen is a tab, not a card of its own.** The plan
  said "a card on the Master Data Hub". The hub draws one card per area, and
  the repo gates require every `/admin` route to belong to an area, so
  `/admin/portal-appearance` is a `globalAdminOnly` tab ("Portal Appearance")
  of Reference Data, listed in that card and rendered in the master-data
  layout.

**Still owed** (unchanged from *Owed after the build*): the `chore(agents):`
sweep of AGENTS.md, and the AGENTS §4.6 Docker, DB and browser checks, which
the cloud session could not run. `F4.342` removes the old colour-profile route
and field after the next release tag.

## Amendment 3 — shells after the AWS check, and four more profiles (2026-11-09)

**Status: Accepted — 2026-11-09, by the merge of the PR that carried this
amendment and the plan `docs/plans/f4.346-shells-and-four-profiles.md` (#1200).
Built by `F4.346` (see *As built* below).** After `F4.341` closed, the owner checked the live portal
(`bms.demosites.co.in`, deploy of `1d1efc26`) and found the Swiss Grid and
Bento Ops top menu unusable. A DOM check of every design system on 15 pages at
1440, 1024, 768 and 390 px measured the defects below (no console errors). The
owner approved the shell changes and asked for more colour profiles from
research; the drafts were shown in the preview artifact (version 3) and the
owner chose all four.

**Measured on AWS:**

| Shell | Defect |
|---|---|
| `topbar` (`swiss-grid`, `bento-ops`) | The module strip is 2,382 px wide at a 1440 px viewport; 8 of 19 items are off screen and reachable only by sideways scroll, with no cue. Three stacked bars put the page top at 142 px (the sidebar shell: 88 px). |
| `rail` (`control-room-dark`) | A fixed 176 px rail with no collapse and no narrow mode: at 390 px the page is 199 px wide and overflows by 252 px. |
| every shell, the Appearance panel | The preview sets `data-design` only; `AppShell` reads the store, so the shell changes only after Save. Swiss Grid previews on the sidebar shell. |

1. **Two shells, not three (amends decision 6).** `swiss-grid` and
   `bento-ops` render the `sidebar` shell. The `topbar` shell is removed;
   `SHELL_OF_DESIGN` maps four design systems to `sidebar` and
   `control-room-dark` to `rail`. The sidebar keeps one behaviour in every
   design system (the collapse button, the stored choice, the F4.318 64 px rail
   and overlay at ≤ `SHELL_RAIL_MAX_WIDTH`); each design system skins it with
   tokens only: `swiss-grid` square items on `surface`, a 3px ink rule, the
   selected item in ink; `bento-ops` pill items on the page ground, the
   selected item in ink. The skins obey A5 (the selected navigation item is on
   the accent allow-list but these two use ink, which A5 permits).
2. **The rail collapses (refines decision 6 and A6's rail rule).** The `rail`
   shell gets the sidebar's collapse button and narrow-viewport overlay. It
   opens **expanded with text labels** by default and on a wall (A6: a wall has
   no hover); collapsed, each item shows its `collapsedLabel` code with the full
   label as its accessible name, as the sidebar does.
3. **The preview changes the shell (amends decision 11).** `previewDesign`
   sets a preview value in the theme store as well as the attribute, and
   `AppShell` selects the shell from `preview ?? design`. Cancel, Save and
   leaving the panel clear the preview.
4. **Thirteen profiles (amends Q6 and Amendment 1 A3).** Four profiles join
   the closed list, each with a reason, not only a hue:

   | Name | Label | Reason | Accent light / dark (draft) |
   |---|---|---|---|
   | `hmi-grey` | HMI grey | ISA-101 high-performance HMI practice: a grey ground and muted chrome, so only alarm colours stand out | `#405A5C` / `#A8C4CC` |
   | `moss` | Moss | an olive green for water, environment and sustainability sites; no shipped profile is yellow-green | `#4F6B3A` / `#B5CF95` |
   | `colour-safe` | Colour-safe | chart series from the Okabe-Ito and Paul Tol palettes, distinct under red-green colour blindness, without their orange and vermillion members (near the alarm roles); a neutral ink accent | `#1F2937` / `#E5E7EB` |
   | `night-shift` | Night shift | a warm, dim, low-blue theme for 24-hour control rooms; a sage accent | `#3E6458` / `#94C2B0` |

   Every value meets A4 and the 4.5:1 text pairs; the draft script found 0
   failures. The full 27-role tables are drafted in the build PR, and **merging
   that PR approves the value table** (AGENTS §10). Copper, amber, plum and
   sky-blue accents were tested and rejected: each falls within ΔE 20 of a
   critical or warning role or within ΔE 12 of an info role.
5. **Storage.** A forward migration widens the three `colour_profile` CHECK
   constraints (`bms.organizations`, `bms.portal_settings`, `bms.users`) to the
   thirteen names. No data changes.

**Not in this amendment:** the chrome header overflows by 122 px at 390 px in
every shell, `nexus-soft` included. It predates `F4.341` and is row `F4.347`.

## As built (Amendment 3, `F4.346` closed, 2026-11-10)

**Status: recorded with PR 3 of `F4.346`.** The plan's three PRs merged in
order (the PR list is in `docs/BACKLOG.md`, row `F4.346`): #1201 the shells and
the preview, #1202 the four profiles and migration 0137. Where the build
departed from or read the plan:

- **The page body is portalled across a shell swap.** Decision 3 as written
  (`AppShell` picks the shell from `preview ?? design`) unmounted the page and
  the header's Appearance dialog on a swap; the panel's unmount ended the
  preview, so the shell flipped straight back (plan S5 caught it). `AppShell`
  renders the page body once, through a portal into one element that each
  shell's body slot adopts, and hosts the user's own Appearance dialog beside
  the shell (its open state in a small store). Save now re-reads `/auth/me`
  before it clears the preview, so the shell goes straight to the saved value.
  `setDesign` clears the preview.
- **The sidebar's slot is the `Modules` navigation landmark.** The sidebar had
  no `nav[aria-label="Modules"]` (S2 asks for one). The slot around the
  `<aside>` became that `nav`, outside the aside, so the S3 markup fixture is
  unchanged byte for byte.
- **One collapse behaviour.** The sidebar's collapse logic moved, unchanged,
  into `useCollapsibleNav`, which the rail shares under its own key
  (`bms-rail-collapsed`). The rail's top entries collapse to two-letter codes
  (`OV`, `SI`, `EN`, `SE`).
- **Skins.** `swiss-grid` reads its radius tokens (0), not a literal 0, to
  keep the Z4 gate; the selected item in both skins is `surface` on `ink`,
  now a `DS_TEXT_PAIRS` row held at 4.5:1 in every profile and theme.
- **A profile sets 26 roles, not 27.** `PROFILE_ROLES` is 26 long; every block
  sets all of them.
- **Five values moved from the drafts** (the four accents did not):
  `accent-on-chrome` of `hmi-grey`, `moss` and `colour-safe` (`#93A9AD`,
  `#8DB86A`, `#A3A9B4`) sat within ΔE 20 of a light alarm wash or ΔE 12 of an
  info wash; the light `surface` of `hmi-grey` (`#FCFCFC`) and `night-shift`
  (`#FCFAF6`), the light `chrome` of `hmi-grey` (`#1B2022`) and its dark
  `well` (`#25292B`) moved so the fixed `ok`, `critical` and `info` inks keep
  their pairs. No gate was relaxed. The full table is in #1202's body.
- **Frozen migrations keep their lists.** The static tests of 0133 and 0134
  now hold those files to the nine names they shipped; 0137's test holds the
  three live CHECKs to the contract.

**Still owed:** the AWS DOM check of the plan's *Owed after the build*, the
DB run of 0137 with the API integration case A10, and the `chore(agents):`
sweep of AGENTS.md §5 (two shells, thirteen profiles) with the one owed by
`F4.341`. These are local or AWS steps the cloud session could not run.

## Amendment 4 — icons in the navigation (2026-11-10)

**Status: Proposed — 2026-11-10. The merge of the PR that carries this
amendment and the plan `docs/plans/f4.348-nav-icons.md` is its acceptance**
(the owner's standing instruction of 2026-11-10: merge each PR of the session
on green CI). Owner request, 2026-11-10, after `F4.346`: "in the left-hand
collapsible menu, use icons with the menu names wherever applicable; the icons
should match the theme that was chosen." The owner's two rulings: the icons
**replace the letter codes** in the collapsed menu, and they match the theme
in **both** senses — the chosen colours, and a style per design system.

1. **An icon beside every navigation item (amends decision 6 and Amendment 3
   decisions 1–2).** Every module, administration and rail top entry carries
   one icon. Expanded, the icon sits before the text label (the label stays: A6
   holds, no item is icon-only while expanded). Collapsed, in the sidebar and in
   the rail, the icon **replaces** the letter code; the link's accessible name
   is its full label, and its `title` is the label too.
2. **The icons are the repo's Lucide shapes.** They are read from the
   generated `LUCIDE_SHAPES` (`lucide-static` 1.48.0, ISC/MIT, ADR 0084
   decision 5) by key, so no dependency, download or copy is added. Each item's
   icon is fixed in one table in `navigation-model.ts`; no two visible items
   share an icon (the gate replaces `F4.164`'s unique-code gate, whose codes and
   overrides are retired).
3. **The colour is the theme's.** An icon strokes `currentColor`, so it takes
   the item's ink in every colour profile and theme: `ink-muted` at rest, `ink`
   on hover, and the selected item's colour (`accent-strong`, or `surface` on
   the `ink` fill of `swiss-grid` and `bento-ops`). It never paints a fill or a
   role of its own, so A4 and A5 are untouched.
4. **The style is the design system's.** Four design tokens join decision 4's
   set and every design block (both variants): `--icon-size`, `--icon-stroke`,
   `--icon-linecap`, `--icon-linejoin`.

   | Design system | Size | Stroke | Caps / joins | Character |
   |---|---|---|---|---|
   | `nexus-soft` | 16px | 1.75 | round / round | today's soft line |
   | `enterprise-flat` | 16px | 1.5 | round / round | a thin, quiet line for dense admin |
   | `swiss-grid` | 16px | 2.25 | square / miter | a heavy, geometric line beside the ink rules |
   | `bento-ops` | 18px | 2 | round / round | a larger, friendly line for the pills |
   | `control-room-dark` | 20px | 2 | butt / miter | the largest, plainest line for a wall |

**Not in this amendment:** icons anywhere but the module navigation (the top
navigation bar of the sidebar shell keeps its text), and a second icon family.
