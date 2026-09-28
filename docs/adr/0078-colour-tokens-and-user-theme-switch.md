# ADR 0078 — Colour tokens and the user light/dark theme switch (`F3.65`)

## Status

Accepted — drafted on 2026-09-28, before any implementation code. Nine gate
questions were put to the owner one at a time; all nine were ruled as
recommended, and each ruling is recorded under *Gate questions*. **Q2 was
asked twice**: the first asking named the Nexus document as the client's,
which it is not, and the owner ruled again on the corrected facts. **Q9 was
added after the first draft**, which had assumed an answer to it. The owner
reviewed and approved this written record on 2026-09-28.

**Amendment 1** (`F3.65a`, 2026-09-28) records the plan gate: 41 roles, not
"about 30", the adjusted and derived dark values, the light allowlist, and
twelve owner rulings. Drafted with the `F3.65a` build; the owner reads it at
the merge gate.

Implements row `F3.65`, which [ADR 0074](./0074-domain-dashboard-parity.md)
decision 1 (Q1, Q1b) created with its own ADR. Promotes nothing out of
`AGENTS.md` §6. Splits `F3.65` into `F3.65a` → `F3.65b` → `F3.65c`, serial
(decision 8).

## Context

**The ruling this implements.** ADR 0074 Q1 kept the light canvas as the
default and asked for a user switch between light and dark, because the
client's reference dashboards are dark-canvas. It left three things to this
ADR: the colour-token layer, the dark palette, and where the choice is stored.

**What the code does today (measured 2026-09-28 at `6401cba2`).**

- `apps/web/src` has **zero** `dark:` classes and no colour variables.
  `apps/web/tailwind.config.js` extends one palette, `bms.*` (seven hex
  values: `green`, `green-light`, `green-dark`, `header`, `canvas`, `ink`,
  `muted`); everything else is Tailwind's stock palette.
- **137 of 154** non-test `.tsx` files carry a colour class — about **3,080
  uses of 154 distinct classes**. By palette: `bms` 1,339 · `gray` 745 ·
  `red` 406 · `white` 281 · `amber` 169 · `sky` 37 · `emerald` 35 ·
  `slate` 25 · `black` 23 · others 23.
- Those classes use **76 distinct shades** (104 counting the opacity
  modifier). **28** shades have 10 or more uses and carry most of the
  3,080; about **48** have fewer than 10. The top five are `bms-muted` 723,
  `gray-200` 387, `bms-ink` 321, `white` 281 and `bms-green` 271.
- **117** of those uses carry an opacity modifier (`text-white/70`,
  `bg-bms-green/10`). A CSS-variable colour keeps `/NN` working only when the
  variable holds bare RGB channels (`0 166 81`), not a hex value.
- **188 hex literals in 18 non-test files** sit outside Tailwind:
  `crac-schematic.tsx` 52, `electrical-sld.tsx` 18, the SMOC views under
  `components/control-room/smoc/` 44, `formula-editor.tsx` 13,
  `world-map.tsx` 7, and the chart components. **Nine** files use ECharts,
  which takes colours from a JS option object and ignores CSS classes.
  `components/live-svg/crac-styles.css` and `sld-styles.css` hold no hex.
- **No colour is stored as data.** A radial gauge band stores a `tone`
  (`gaugeThresholdSchema` in `packages/shared/src/contracts/dashboard-builder.ts`:
  `ok` · `info` · `warning` · `critical`), and code maps the tone to a hex
  value (`WIDGET_TONE_COLOR` in `apps/web/src/lib/widget-catalog.ts`). No
  contract and no `packages/db` table holds a colour, so every colour the app
  paints is code and can follow the theme.
- Tailwind is **3.4.17**, so `darkMode: ["selector", …]` (3.4.1+) and
  `rgb(var(--x) / <alpha-value>)` (3.3+) are both available. No new
  dependency is needed.
- `apps/web/nginx.conf` sets **no Content-Security-Policy**, so an inline
  script in `index.html` can run before the module bundle.
- The app already keeps one per-browser preference in `localStorage` — the
  collapsed rail in `layouts/app-shell.tsx`.
- `bms.users` has no preference column, and no self-service route writes to
  it (`auth.controller.ts` has `POST login` and `GET me` only).
- **At least three** spec files assert a colour class (`toHaveClass` or a `className`
  match on a palette class). Each one changes when its class is renamed.

**The palette sources — and whose they are.** The client's own dark picture
is the SOW reference images (pp. 9–10, `docs/BACKLOG.md` §7): a dark canvas
with neon accents, held only as images, with no measured colour values.
`docs/ux/ion-exchange-reference-alignment.md` §4.5 records the conflict with
both mockups, which are light-canvas.

`docs/ion-exchange-nexus-dashboard-2026-08-29.html` is **not** the client's.
It is our own workshop document for Ion Exchange — ADR 0048 calls it a
client mock *"drawn in the platform's own shell"*, and its stylesheet says its
tokens are *"drawn from the product's own Tailwind theme"*. Its
`:root[data-theme="dark"]` block styles the document page (the masthead, the
legend, the sheets), not the dashboard mock inside it, whose `--a-*` tokens
have light values only. It holds ten values:

| Role (Nexus name) | Light | Dark |
|---|---|---|
| `paper` / `paper-2` | page | `#141B25` / `#0F1620` |
| `sheet` / `sheet-line` | card / card rule | `#1A222D` / `#2E3A49` |
| `ink` / `ink-2` / `ink-3` | `#1A2230` / `#4A5464` / `#7A8494` | `#E8ECF1` / `#A7B2C0` / `#78849A` |
| `accent` / `accent-ink` / `accent-wash` | `#00A651` / `#007C3C` / `#E6F5EC` | `#3DCD58` / `#3DCD58` / `#14301F` |

The block covers the neutrals and the accent, and keeps the TRINETRA green.
It has **no** dark value for the status colours (`--h-crit`, `--h-poor`,
`--h-fair`, `--h-good` carry one value each) or for the header. The TRINETRA
design-system artifact holds 86 dark values, but it lives outside the
repository and several of its dark values equal the light ones.

**Measured contrast of the Nexus dark block (WCAG 2.x relative luminance).**

| Foreground | on `paper-2` `#0F1620` | on `paper` `#141B25` | on `sheet` `#1A222D` |
|---|---|---|---|
| `ink` `#E8ECF1` | 15.31 | 14.59 | 13.50 |
| `ink-2` `#A7B2C0` | 8.45 | 8.05 | 7.46 |
| `ink-3` `#78849A` | 4.81 | 4.59 | **4.25** |
| `accent` `#3DCD58` | 8.71 | 8.30 | 7.68 |
| `--h-crit` `#8F1F1B` | **2.06** | **1.96** | **1.82** |
| `--h-poor` `#C4571A` | **4.09** | **3.89** | **3.61** |
| `--h-good` `#00A651` | 5.69 | 5.42 | 5.02 |

`ink-3` fails AA body text on a card, and the critical red fails even the
3:1 UI-part threshold. The status colours cannot be copied into the dark
theme unchanged.

## Gate questions

Asked one at a time on 2026-09-28. All nine were ruled as recommended.

| # | Question | Ruling |
|---|---|---|
| Q1 | How does the app get a dark theme? | **Semantic tokens** — role names backed by CSS variables holding RGB channels, redefined under `[data-theme="dark"]`. Not a `dark:` twin per class; not re-pointing `white`/`gray-*`/`bms-*` themselves. |
| Q2 | Which source is the authority for the dark palette? | **The Nexus dark block, measured** — ruled twice. The first asking described the file as the client's; the second stated that it is our workshop document and that the client's only dark reference is the SOW images, with no measured values. The ruling held. Where a pair fails AA, this ADR (or its amendment) records the adjusted value and the reason. |
| Q3 | Where is the choice stored? | **Per browser**, in `localStorage`. No column, no route. |
| Q4 | Is there a "System" choice? | **No — Light and Dark only.** A user who never chooses sees light. |
| Q5 | Do charts and schematics follow the theme? | **Yes, all of them** — ECharts re-renders from the token values; the schematics move their hex to the same variables. |
| Q6 | What happens to the status colours? | **Same hue, tuned lightness** — each status keeps its hue; the dark value moves only as far as AA on the dark canvas needs. |
| Q7 | How is the rule kept? | **A source-scan gate** in `tests/`, a ratchet during the migration and zero at the end. |
| Q8 | How is the row split, and when is the switch visible? | **Three serial children; the switch appears in the last one.** Users never see a half-dark app. |
| Q9 | How are the 76 shades mapped to roles? | **About 30 roles; rare shades merge.** Frequent shades keep their exact light value; a rare shade maps to its nearest role, so a few light pixels shift. Not one role per shade (~76, close to the declined Q1 option), and not a hard merge to ~15 (a light redesign). |

## Decision

1. **Role tokens are the colour vocabulary of `apps/web` (Q1).** Each colour
   role is a CSS custom property in `apps/web/src/index.css` holding
   space-separated RGB channels, declared under `:root` (light) and redeclared
   under `:root[data-theme="dark"]`. `tailwind.config.js` maps each role to
   `rgb(var(--<role>) / <alpha-value>)`, so opacity modifiers keep working. A
   call site names a role (`bg-surface`, `text-ink-muted`, `border-line`),
   never a hue. The role list — about 30 roles (Q9): neutrals, accent, header
   chrome, focus, and a foreground/background pair for each status — is
   fixed in the `F3.65a` plan and shown to the owner at that plan's gate. `dark:` variants are not
   the mechanism: where a surface needs a different treatment in dark, it
   gets a role, not a `dark:` class.

2. **The light theme keeps its frequent shades exactly; rare shades merge
   (Q9).** Each of the 76 shades maps to one role. A role's light value is
   the exact value of the frequent shade it replaces, so most call sites
   change their class name and not their pixels. A rare shade maps to its
   nearest role, and its call sites shift slightly. The `F3.65a` plan lists
   every merged shade with its colour difference to the role, for the
   owner's review at that plan's gate. A **mapping-table test** holds the
   rule: every old class maps to a role, and a role's light value equals
   Tailwind's resolved value for each shade the table marks as exact. A
   light pair that fails AA today (for example white on `bms-green`,
   3.19:1) is recorded in the contrast test's exact allowlist with its
   reason; `F3.65` does not otherwise restyle the light theme.

3. **The dark palette is the Nexus dark block, measured (Q2).** The block is
   our own workshop document's, not the client's; it is the authority
   because it keeps the TRINETRA neutrals and green and is in the
   repository. The ten values in *Context* are the dark values of their
   roles. A role the block
   does not cover (status, header, focus) gets a dark value derived under
   decision 6. Two Nexus values fail and are adjusted in the `F3.65a` plan:
   `ink-3` on `sheet` (4.25:1, body text needs 4.5:1) and the status colours
   (decision 6). Each adjusted value and its measured ratio is recorded in an
   amendment to this ADR.

4. **The choice is per browser and has two values (Q3, Q4).** The key is
   `bms.theme` in `localStorage`, value `"light"` or `"dark"`. A missing key,
   any other value, or a storage access that throws means light. An inline
   script in `apps/web/index.html`, before the module script, sets
   `data-theme` on `<html>` from the key, so the first paint is already in
   the chosen theme; the stylesheet sets `color-scheme` to match, so native
   controls (scrollbars, date inputs) follow. There is no
   `prefers-color-scheme` listener and no "System" choice: ADR 0074's light
   default holds for every user who never chooses. The choice does not follow
   the user to another device. No column, no route, no migration.

5. **Charts and schematics follow the theme (Q5).** ECharts options read the
   role values at render time (from `getComputedStyle` on `<html>`), and each
   chart re-renders when the theme changes. The schematic SVGs (CRAC, SLD,
   the SMOC views, the world map) and `formula-editor.tsx` move their hex
   literals to the same CSS variables. No light panel sits on a dark page.
   `WIDGET_TONE_COLOR` maps a stored `tone` to a role, not to a hex value;
   the stored dashboard content does not change, because it holds tones and
   no colours.

6. **Status colours keep their hue and tune their lightness (Q6).** Critical,
   warning, OK, info, stale and offline each keep one hue in both themes; the
   dark value is lighter only as far as the contrast test needs on the dark
   canvas and card. A **contrast test** in `tests/` computes WCAG 2.x ratios
   from the token file itself and holds every declared text pair at 4.5:1
   and every UI-part pair at 3:1, in both themes, with the exact allowlist of
   decision 2.

7. **A source-scan gate holds the rule (Q7).** A `tests/` gate in the style of
   `F4.164` and `F4.168` scans `apps/web/src/**/*.{ts,tsx,css}` outside tests
   and specs, and fails on a stock or `bms-*` palette colour class, a hex
   colour literal, or a `dark:` variant, outside an exact allowlist. It fails
   closed on a file it cannot read. While `F3.65a` and `F3.65b` run it is a
   ratchet — a measured floor that may only fall; `F3.65c` sets it to zero.
   `AGENTS.md` §5 gains the rule in a `chore(agents):` PR after `F3.65a`.

8. **Three serial children; the switch is last (Q8).**
   - **`F3.65a`** — the token file, the Tailwind mapping, the inline script
     and the stored choice, the contrast test, the ratchet gate, and the
     application shell (`app-shell.tsx`, the login page) on tokens. No
     visible switch: dark is reachable only by setting the key, for tests
     and review.
   - **`F3.65b`** — every page and component on tokens, directory by
     directory; it may land as more than one PR.
   - **`F3.65c`** — charts and schematics (decision 5), the visible switch in
     the header's user area, and the gate at zero.

   The children run one after another. Each touches many `apps/web` files,
   so **no other `apps/web` row runs beside a child** — a parallel web row
   either waits or lands first.

## Dependencies

None. Tailwind 3.4.17 already supports the selector strategy and the
`<alpha-value>` placeholder; no theme library (for example `next-themes`) is
added, so §9.4 is not engaged.

## Consequences

- Every later web row writes role classes, not hues; the gate reddens a
  `bg-white` or a `#1A2230` added after `F3.65c`. The vocabulary becomes a
  review surface: a new role needs a light value, a dark value and a
  contrast pair.
- The migration renames about 3,080 class uses in 137 files. Light pixels
  change only where a rare shade merges (decision 2), and the mapping-table
  test holds the rest by construction, so no child needs a before-and-after
  screenshot comparison. The jsdom specs change only where they assert a
  class (at least three files today).
- Rows that share `app-shell.tsx` — `F3.29` (shell chrome) and `F3.33` (the
  IONSiTE NEXUS rebrand) — should not run beside `F3.65a` or `F3.65c`.
- **Out of scope:** the PDF and Excel reports and the notification emails
  stay light (they are documents, not screens); the Keycloak-hosted login
  pages keep Keycloak's theme; `ESKOM_SMOC.html` and `TRINETRA.html` stay
  read-only references with no dark variant.
- A user who clears site data, or opens the app in a private window or on a
  new device, sees light again. A per-user column stays available as a later
  row if the owner asks for the choice to follow the user.
- Owed after the children land: the `AGENTS.md` §5 visual-reference text
  (light canvas default, dark by the user switch, role tokens) in a
  `chore(agents):` PR; the TRINETRA design-system artifact's dark values
  replaced from the token file, on the owner's word.

## Amendment 1 — the `F3.65a` plan gate (2026-09-28)

The plan `docs/plans/f3.65a-colour-tokens.md` (on Fable, measured at
`7fd51d35`) turned decisions 1–3 and 6 into data. The session re-computed
sixteen of its ratios and colour differences before the gate; all matched.
Ten plan questions (OQ1–OQ10) and one build question were put to the owner
one at a time; all eleven were ruled as recommended. A twelfth ruling came
from the code review (§6).

**1. 41 roles, not "about 30" (OQ1, and the build ruling).** Each role is
counted once:

- **28 anchors.** Decision 2's own rule — every shade with 10 or more uses
  keeps its exact light value — gives 28 shades, one role each (`white` →
  `surface`, `red-600` → `critical`, `black` → `scrim`, and so on).
- **5 split roles.** Three shades serve more than one purpose and split by
  utility. `white` adds `on-dark` and `on-accent` beside its anchor
  `surface`; `red-600` adds `critical-ink-soft` beside `critical`;
  `bms-green-dark` (9 uses, so no anchor) gives `accent-strong` and
  `chrome-nav`.
- **3 anchors under 10 uses**, kept exact because their status needs its
  own value: `ok-wash` (emerald-50, 9), `info` (sky-500, 3) and `info-ink`
  (sky-800, 3, OQ9).
- **4 extra roles** for a purpose no anchor covers: `focus`, `chrome`, and
  `critical-on-dark` and `warning-on-dark`, which hold the footer's status
  text on chrome in both themes (OQ3).

That is 40, the list the plan gate ruled. The 41st, **`simulated-ink`**, was
ruled during the build: the provenance markers in `lib/value-provenance.ts`
tell three kinds of value apart by colour (nameplate slate, configuration
sky, simulated violet), and merging violet into `ink-faint` would have made
simulated look like nameplate. Merges touch about 106 of 3,104 palette uses (3.4 %); the other
96.6 % keep their light pixels. The mapping-table test records every shade,
its role, and each merged shade's ΔE2000.

**2. The Nexus value adjusted, and the values derived (decisions 3 and 6).**
`ink-3` `#78849A` on the card is 4.25:1, so body-weight tertiary text gets a
new dark value — `ink-faint` `#8791A5`, 5.05:1 on `sheet`. `#78849A` stays as
`ink-hint`, a 3:1 role for placeholders and faint strokes. Every other dark
value outside the Nexus block is derived by one rule: the light value's hue
and saturation, lightness raised in 0.5 % steps until the pair passes on
`sheet`, `paper` and the role's own dark wash. `simulated-ink` is `#A67DE8`
(5.13 on `sheet`, 4.59 on the dark `well`, which is its binding pair). The
three red text roles converge in dark (`#E76A6A`, `#E86A6A`, `#EC8585`) —
the rule's literal result, accepted (OQ6). The full table is the plan's
§2.2; the token file `apps/web/src/index.css` is the authority.

**3. `on-accent` flips (OQ2).** White on the dark accent `#3DCD58` is 2.09:1,
below even 3:1, so text on a green fill is white in light and `#0F1620` in
dark (8.71:1). `on-dark` stays white: chrome, status fills and scrims are
dark in both themes. `chrome-nav` stays `#007C3C` in both themes so the nav
keeps 5.32:1 under white text.

**4. The contrast test's allowlist.** Twelve light pairs fail today and are
kept, each with its reason: the brand green as text, as a UI part or under
white text (seven pairs, 2.86–3.19:1, decision 2), status dots and bars on a
light card (four pairs, 1.95–2.77:1, each duplicated by text), and a
placeholder glyph (2.54:1, WCAG 1.4.3's inactive exception). An entry
exempts its pair only at its own threshold, so `accent` on `canvas` has one
entry as text (4.5:1) and one as a UI part (3:1). **The dark allowlist is empty.**
Hairlines and card borders are not declared as pairs: they are decorative
boundaries and the focus ring is the state indicator (OQ5).

**5. The gate (OQ7, OQ8).** Three counted kinds per file — palette classes,
hex literals and colour-function literals (`rgb()`, `hsl()`, `oklch()`,
`oklab()`, `lab()`, `lch()`, `hwb()`, `color-mix()`) — against an exact
per-file floor measured at `7fd51d35` (305 files walked, 141 with findings:
palette 3,104, hex 190, functions 2). Beside them, hard zeros with no table,
each named by file and line: a `dark:` variant; an arbitrary variant aimed
at `data-theme`; a named colour; `prefers-color-scheme` and `matchMedia(`,
also in `apps/web/index.html`; `text-on-dark` in one class string with an
opaque `bg-accent` or `bg-accent-strong` (2.09:1 in dark); and an opacity
modifier on a role class that is not a Tailwind opacity step (§6). A role
declared outside the two theme blocks of `index.css` fails the token test.
`darkMode: ["selector", '[data-theme="dark"]']` is set defensively, so a
stray `dark:` class can never follow the OS.

**6. Smaller rulings.** The login hero's dark art (5 hex, 1 `rgba`) stays
until `F3.65c` (OQ4); `info-ink` anchors on sky-800 `#075985` (OQ9);
amber-700 merges into `warning-ink` at ΔE 15.2 (OQ10).

**Owner ruling from the code review (2026-09-28): a light change on the
login page.** `text-white/72` and `text-white/58` on the login hero were
never rendered at those steps: Tailwind 3 has no 72 or 58 opacity step, so
the classes emitted no CSS and the text showed at full white. They become
`text-on-dark/70` and `text-on-dark/60`, so the hero paragraph and the stat
labels now render at 70 % and 60 %. The gate now refuses an opacity
modifier on a role class that is not a Tailwind opacity step.

## Amendment 2 — the `F3.65b` migration (2026-09-28)

The plan `docs/plans/f3.65b-pages-on-roles.md` (on Fable, measured at
`349f26cb`) moved every stock-palette and `bms-*` colour class in
`apps/web/src` to role classes: **2,997 uses in 137 files**, by a one-shot
codemod `scripts/codemods/f3.65b-role-classes.ts`, driven by
`tests/support/colour-role-map.ts` as the one mapping source, in six
directory groups. `F3.65c` deletes the codemod.

**1. The tallies.** Over the six groups: table rule 2,898 · `text-white →
on-accent` (same class string as an opaque accent fill) 81 · `text-white →
on-dark` 4 (on constant-dark fills: `rule-builder-panel.tsx:499`,
`asset-template-detail-page.tsx:641`, `report-schedules.tsx:513`,
`reports-panel.tsx:395`) · `focus` 1 · alpha target `border-accent/20` 4 ·
hand table 9. **Merged shades applied: 110** — the 106 `F3.65a`-ruled
merges plus 4 hand merges: `bg-bms-ink → bg-chrome` ×2 (ΔE 1.27) and
`bg-gray-200 → bg-well-deep` ×2 (ΔE 2.94).

**2. Owner rulings for `F3.65b`.** One PR. The two stray hex sites move in
this row, no 42nd role: the tank-level outline `#8A94A6 → stroke-ink-hint`
(ΔE 5.43) and the SLD board wrapper `bg-[#F7F8FA] → bg-well` (ΔE 0.66). The
two `bg-bms-ink text-white` buttons become `bg-chrome text-on-dark` — a
dark button in both themes. The two `bg-gray-100 text-gray-500` pills
become `text-neutral-ink` (ΔE 17.65; `ink-faint` on `well-deep` was 4.32
light / 4.04 dark). `palette` becomes a hard zero, gate case R20. The
accent-button corollary `bg-accent text-on-accent hover:bg-accent-strong`
is decision 2 applied (`on-accent` on `accent-strong` 5.32 light / 10.0
dark).

**3. A session decision beyond the plan's OQ4 pills.** The CRAC and SLD
idle pills move `bg-gray-200 → bg-well-deep`, because `neutral-ink` on
`line` is 4.15 in dark.

**4. Contrast.** Three new declared pairs: `neutral-ink` on `canvas` 9.35
light / 6.22 dark, `ink-muted` on `line` 6.18 / 5.38, `on-dark` at 0.4 over
`chrome` (UI) 3.71 / 3.81. Two pairs are deliberately not declared, each
with its reason in the contrast test's docblock: `ink-faint` on `line` in
the SMOC offline boxes (an existing 3.50 failure in an 8 px SVG label that
`F3.65c` recolours) and `critical-ink-soft` on `canvas` (no `text-red-600`
shares a class string with a red wash). The review (§7) adds two UI pairs
for the rule toggle knob — `on-accent` on `accent` 3.19 / 8.71 and `on-dark`
on `line-strong` 1.47 / 9.02 — and one light allowlist entry for the second (owner ruling 2026-09-28),
the existing white knob on the gray track. **The dark allowlist stays
empty.**

**5. `FLOOR` after `F3.65b`.** 305 files walked, 16 rows, palette 0 · hex
188 · func 2 — all 16 are `F3.65c`'s files (the charts, the schematics, the
formula editor, `WIDGET_TONE_COLOR`, the login hero).

**6. What is not yet a defect.** Until `F3.65c` lands, the hex-coloured
schematics and ECharts keep light colours on a dark surface, **and the
reverse**: a role ink that turns light in dark still sits on a hex fill
that stays light, or a hex ink stays dark on a role fill that turns dark
(the §8 punch list). Both are a known transient state, not a defect of this
row, because the switch stays invisible until then (dark is reachable only
via `localStorage["bms.theme"]`).

**7. Review fixes (2026-09-28).**
- *Owner ruling R-f — priority split.* The migration had merged priority
  `high` and `medium` onto one warning pill. They differ again with
  existing roles: `high` is `border-warning bg-warning-wash-strong
  text-warning-ink` with the card rail `border-l-warning`; `medium` is
  `border-warning-line bg-warning-wash text-warning-ink` with the rail
  `border-l-warning/50` (`work-orders-page.tsx`,
  `maintenance-schedules-panel.tsx`). Status `assigned` and `in_progress`
  keep one info pill — accepted, because the kanban column shows the status.
- *Tailwind defaults.* `borderColor.DEFAULT` now reads `--line` (preflight's
  `border-color` on every element) and `ringOffsetColor.DEFAULT` reads
  `--surface` (the `--tw-ring-offset-color` default), so a bare `border`,
  `divide-y` or `ring-offset-*` follows the theme. Light is exact (`#E5E7EB`,
  `#FFFFFF`). The ring-offset value carries no `<alpha-value>`: the ring
  plugin copies it into the variable unsubstituted. No bare `ring` without
  a ring colour exists in `apps/web/src`, so `ringColor.DEFAULT` stays stock.
- *Leaflet popup.* `index.css` sets `.leaflet-popup-content-wrapper` and
  `.leaflet-popup-tip` `background: rgb(var(--surface))` — Leaflet's own
  `white` put the popup's role inks at 1.19:1 in dark. Background only, so
  light is exact; it wins on source order (`leaflet.css` bundles first).
- *Rule toggle knob by state.* `bg-on-accent` on the enabled `accent` track
  (white on the dark accent was 2.09:1), `bg-on-dark` on the disabled track;
  both white in light.
- *SMOC env marker letters.* The "T" / "S" letters on the hex marker fills
  are `fill-on-dark` (white in both themes); `fill-surface` turned dark in
  dark.

**8. `F3.65c` punch list — role inks on hex light fills.** Each pair below
must be recoloured together (the ink and its hex fill in one change),
because only one half of it follows the theme today. Dark ratios:
- `smoc/it.tsx:481` — the normal rack label `fill-[#1d3a8c]` on
  `fill-surface`: 1.55 (10.31 light).
- `smoc/env.tsx:496–504` — the five zone labels on their hex rects:
  `fill-info-ink` on `#eff6ff` 2.92, `fill-warning-ink` on `#fef3c7` 2.19,
  `fill-info-ink` on `#ecfeff` 3.05, `fill-critical-ink-strong` on
  `#fef2f2` 2.32, `fill-ink` on `#f3e8ff` 1.01.
- `world-map.tsx` — Leaflet's popup close button keeps its stock grey  (`.leaflet-popup-close-button`) on the popup, which now paints from  `surface`; not measured in `F3.65b`.

## Amendment 3 — the `F3.65c` build: charts, schematics and the switch (2026-09-28)

The plan `docs/plans/f3.65c-charts-schematics-switch.md` (on Fable, measured at
`88f6b8c6`) moved the last 188 hex literals and 2 colour functions in 16
files to roles and made the switch visible. The gate is now at zero:
`palette`, `hex` and `func` are hard zeros (R20, R21, R22), each failing by
file (317 files walked, 0 rows, corrected from the plan's stale 310/305;
315 at U11, and 317 once `main` was merged in, which added
`widgets/mimic-flow-dash.tsx` and `widgets/mimic-glyphs.tsx`).
`FLOOR`, `floorDiff` and R11 are deleted; the `F3.65b` codemod and its test
are gone; the stock palette and the `bms` block leave `tailwind.config.js`,
leaving the 41 roles plus `transparent`/`current`/`inherit` in
`theme.colors`. The built `dist/assets/index-*.css` was byte-identical
before and after that removal — no rule changed, only unused definitions
were dropped.

**1. One resolver, one store.** `apps/web/src/lib/theme.ts`'s `resolveRoles`
reads the 41 `--role` custom properties off `<html>` and throws naming the
role on an empty, malformed or out-of-range value — a chart that silently
painted ECharts' light defaults on a dark card was the failure this row
removes. `stores/theme-store.ts` holds `{ theme, setTheme }`; `setTheme`
sets `data-theme` first, then writes `"light"` or `"dark"` to
`bms.theme` inside a `try`/`catch`, so a throwing store still flips the
page — **choosing Light writes `"light"`**, it does not clear the key. This
store is the only reader of `bms.theme`; the boot script in `index.html`
stays the only reader on page load (`app-shell.tsx`'s separate
`localStorage` key, the collapsed rail, is unrelated). **Amended at
build:** the roles are not held in store state. `vite dev` evaluates
`main.tsx`'s `./app` (and the store) before `index.css` injects its
`<style>`, so a resolve at store creation would throw on empty properties;
roles now come from `currentRoles()`, resolved lazily and cached per theme.
jsdom gets the real tokens the same way the plan intended but not the
mechanism it named: `node:fs` does not typecheck in `apps/web` (no `node`
types), so `apps/web/vitest.config.ts` sets `test.css.include:
[/src[\\/]index\.css(?:$|\?)/]` (anchored at review; the id carries the
`?raw` query, so a bare `$` would match nothing) and `test-setup.ts` imports
`./index.css?raw` — no new dependency.

**2. Charts read one theme object.** `lib/chart-theme.ts`'s `echartsTheme`
builds every ECharts chrome default (text, axes, tooltip, legend, gauge)
from the resolved roles; each of the six `<ReactECharts>` call sites passes
it as `theme`, and each option's series colours come from the same roles.
`WIDGET_TONE_COLOR` is gone; `WIDGET_TONE_ROLE` maps a stored tone to a
role, `WIDGET_TONE_FILL_CLASS` gives the tank widget a literal fill class,
and `widgetToneColor(roles)` gives ECharts its stops.

**The formula editor, fixed at review.** Nothing set CodeMirror's
`EditorView.darkTheme` facet, so `@codemirror/view`'s `&light` base rules
(black cursor, lilac selection, light-grey tooltip) stayed on a dark page;
the facet is now a `Compartment` reconfigured on a toggle, and the editor's
theme overrides the cursor (`ink`), the selection (`well`, focused
`info-wash`) and the tooltips (`surface`, `ink`, `line-strong` border) at
the base rules' own specificity.

**3. Owner rulings OQ1–OQ8, all as recommended.** OQ1 the TRINETRA status
quartet merges into `accent`/`info`/`warning`/`critical`; OQ2 the ok tint
becomes `ok-wash`; OQ3 the CRAC pipes recolour semantically, supply `info`
return `warning`; OQ4 the health donut's five bands are `accent`,
`accent-strong`, `warning-on-dark`, `warning`, `critical`; OQ5 the SLD flow
dashes and the world-map `nominal` marker become `accent-strong`; OQ6 the
login hero moves to `chrome`/`chrome-nav`/`accent`; OQ7 the formula
"function" token reuses `simulated-ink` as a hue, not a semantic match;
OQ8 one PR. The plan's §2.4 lists every merged hex with its ΔE2000; this
amendment does not repeat the table.

**One deviation from OQ6, found at review.** The plan measured the login
badge's `scrim/40` wash "over `chrome`" at 18.16/19.47, but the badge sits
in the card on `bg-surface`, not the dark hero — a plan-defect
mismeasurement. `scrim/40` on `surface` is 2.85:1 in light, well under 4.5.
The badge now reads `bg-chrome text-on-dark` (constant-dark in both
themes, reproducing the original `#003366` chip's always-dark pixel); its
`on-dark` on `chrome` pair was already declared, so no new contrast entry
was needed. The owner has not yet reviewed this specific change; it is
flagged for the merge gate.

**4. Flagged calls that stood, one broadened at review.** The schematic
boards paint `surface`, not `well` (D5); halos are `stroke-surface` (D6).
D7 ("green text on an ok tint takes an `-ink` role, not the plain status
role") was applied at the one site the plan named, then broadened during
review to every status label painted on a tinted cell in the CRAC and SLD
schematics — the compressor cells, zone tiles, the SUP AIR label and the
feeder branch's code/load/kW text all read `accent-strong`,
`critical-ink` or `ink-muted` instead of the stroke-only tone.

**5. The Amendment 2 §8 punch list is closed.** The `it.tsx` rack label,
the five `env.tsx` zone labels (each ink recoloured with its fill in the
same change), and the Leaflet popup close button (now `ink-faint` at rest,
`ink` on hover/focus, asserted as two claims, T17a and T17b, after a review
split found the combined assertion untestable).

**6. The switch.** A `role="group"` labelled "Theme" holding "Light" and
"Dark" buttons with `aria-pressed`, in the header's user area between the
user block and Logout, painted on `chrome` with `on-dark` inks. A click
flips `data-theme` and writes the key with no reload.

**7. Contrast.** New pairs, from the contrast test's diff rather than the
plan's estimate: text — `accent-strong` on `ok-wash`, `info-ink` on `well`,
`warning-ink` and `critical-ink-strong` on `well`, `on-dark` on `chrome` at
0.85 (the switch's idle label, bare and under its hover wash), and the
formula editor's token inks over its selection (`ink`, `ink-muted`,
`accent-strong`, `simulated-ink`, `warning-ink` on `info-wash`;
`accent-strong` on `well`); UI —
`warning-on-dark` on `surface` (the donut's Fair slice) and `on-dark` on
`chrome` at 0.8 (the switch's focus ring, bare and under the pressed
button's wash — the ring is inset, so a keyboard-focused pressed button
shows both). One light allowlist entry: the donut's `warning-on-dark` on
`surface`, measured 1.67, reason "status slices are named in the legend
list; existing" (ruled with OQ4). **The dark allowlist stays empty.**

**8. What remains outside the gate.** Tailwind preflight's `::placeholder`
colour (stock `#9ca3af`, an unchanged pixel), third-party CSS
(`leaflet.css`), and a class name built by string concatenation — the
scanner needs a literal class and D4's status functions were written to
return whole literal strings for exactly this reason.
