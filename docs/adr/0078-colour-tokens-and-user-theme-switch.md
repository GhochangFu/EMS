# ADR 0078 — Colour tokens and the user light/dark theme switch (`F3.65`)

## Status

Accepted — drafted on 2026-09-28, before any implementation code. Nine gate
questions were put to the owner one at a time; all nine were ruled as
recommended, and each ruling is recorded under *Gate questions*. **Q2 was
asked twice**: the first asking named the Nexus document as the client's,
which it is not, and the owner ruled again on the corrected facts. **Q9 was
added after the first draft**, which had assumed an answer to it. The owner
reviewed and approved this written record on 2026-09-28.

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
