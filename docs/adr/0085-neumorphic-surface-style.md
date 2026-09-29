# ADR 0085 — A neumorphic surface style beside the flat one (`F3.71`)

## Status

Accepted — drafted on 2026-09-29 at the `F3.71` start gate, before any
implementation code. The owner approved a full-page prototype first (see
*Context*), then ruled four gate questions one at a time; they are recorded
under *Gate questions*. **Q3 was asked twice**: the first option text claimed a
`line-strong` hairline keeps 3:1 contrast, a measurement showed it does not
(1.34:1), and the question was put again on the measured values. The owner
decides whether to merge after the build; the build does not wait for v1
(2026-10-02) but its merge is not part of it. The owner reviewed and approved
this written record on 2026-09-29.

## Context

[ADR 0078](./0078-colour-tokens-and-user-theme-switch.md) (`F3.65`) made the
colours of `apps/web` 41 role tokens with a light and a dark value, and gave
the user a Light / Dark switch. Every surface today is flat: a card is
`rounded border border-line bg-surface`, a well is `bg-well`, depth is a
hairline.

On 2026-09-29 the owner asked for the layout to become **neumorphic** —
surfaces that read as raised from, or pressed into, the page by a pair of soft
shadows (a light one up-left, a dark one down-right) — **keeping the same
colour palette**. The owner ruled for full neumorphism over a limited "soft UI"
that kept tables, forms and alarm banners flat, and asked for a prototype of
the most complex page first: the Control Room site view, SMOC *Main
Dashboard* tab (`components/control-room/smoc/overview.tsx`). The prototype was
built as a design canvas in three boards (neumorphic light, neumorphic dark, a
flat reference) and the owner approved it the same day.

**Three constraints the prototype surfaced.**

- *The surface must be the page colour.* A raised shape is drawn by shadows on
  its own ground, so a card cannot keep `surface` (`#FFFFFF`) on `canvas`
  (`#F2F4F7`). Neumorphic surfaces paint `canvas`; `surface` stays the flat
  style's card colour.
- *The chrome cannot be neumorphic.* The F3.33 wordmark's "IONSiTE" is
  `on-dark` (ADR 0083 decision 2); on `canvas` it disappears. The `chrome`
  header and the `chrome-nav` bar (5.32:1 under white text, ADR 0078
  Amendment 1) stay as they are.
- *Edge contrast is about 1:1 by construction.* A neumorphic edge is a shadow,
  not a line. For a card that is a decorative boundary, as ADR 0078
  Amendment 1 item 4 already records for hairlines. For a form field it is the
  control's boundary, and WCAG 1.4.11 asks 3:1. Measured on `canvas`:

  | Border role | Light | Dark |
  |---|---|---|
  | `line` (today's field border) | 1.12:1 | 1.50:1 |
  | `line-strong` | 1.34:1 | 1.92:1 |
  | `ink-hint` | 2.30:1 | 4.59:1 |
  | `ink-faint` | **4.32:1** | **5.46:1** |

  Only `ink-faint` reaches 3:1 in both themes. (Today's flat fields do not
  reach it either; ADR 0078 made the focus ring the state indicator.)

**Size.** At `04a23f8c`, 166 non-test `.tsx` files under `apps/web/src`, 48 of
them pages; `border-line` appears on 467 lines in 106 files, `bg-surface` on
156 lines in 71 files, `rounded` on 804 lines in 125 files. No spec asserts a
surface class.

## Decision

1. **A second, independent switch: the surface style (Q1).** The user chooses
   *Neumorphic* or *Flat*, beside and independent of Light / Dark, so four
   combinations exist. The choice is per browser, like the theme (ADR 0078
   decision 4): key `bms.surface`, values exactly `"neumorphic"` and
   `"flat"`, written by a header switch built like `ThemeSwitch` (native
   buttons, `aria-pressed`, `on-dark` shapes on the `chrome` header). The
   boot script in `apps/web/index.html` sets `data-surface` on `<html>` before
   first paint, next to `data-theme`. **The default is `neumorphic` (Q4)**: a
   missing key, any other value or a throwing storage read sets
   `neumorphic`. No `matchMedia`, no `prefers-*` query.

2. **The palette does not change.** The 41 roles and their light and dark
   values stay exactly as ADR 0078 and its amendments set them; no role is
   added. Depth comes from **shadow tokens composed only of existing roles**,
   declared in their own blocks of `index.css` keyed on `data-surface` (so the
   role blocks the token tests parse stay one light and one dark block):

   | Part | Light | Dark |
   |---|---|---|
   | dark shadow | `ink` at low alpha | `scrim` at about 0.55 |
   | light shadow | `surface` | `line-strong` at low alpha |
   | highlight edge | — | a 1 px `line-strong` inset |

   Exact offsets, blurs and alphas are plan work, measured against the
   prototype. No hex literal and no new colour function enters a source file
   outside `index.css`.

3. **What neumorphic means, per part.**
   - **Raised** (`canvas` ground, the shadow pair, no border, a larger
     radius): cards and sections, KPI tiles, page headers, the sidebar,
     dialogs and menus, buttons, tab strips, the capability footer.
   - **Pressed** (inset shadow pair): wells, table bodies, progress tracks,
     gauge dials, segmented-control tracks, the selected tab and the selected
     sidebar item.
   - **Not neumorphised**: the `chrome` header and `chrome-nav` bar (the
     wordmark constraint); the inside of a canvas that draws its own picture —
     the mimic scene, the SLD and live-SVG schematics, the Leaflet map, the
     ECharts plot area. Each sits in a pressed well; its own drawing is
     unchanged.
   - **Status colour is content, not surface**: pills keep their washes and
     inks, KPI tone bars, SVG strokes and fills keep their roles.
   - **Small accent text** on `canvas` uses `accent-strong`: `accent` on
     `canvas` is 2.90:1, `accent-strong` 4.83:1.

4. **Form fields are pressed and keep an `ink-faint` hairline (Q2, Q3).** An
   input, select or text area in the neumorphic style is pressed and has a
   1 px `ink-faint` border, 4.32:1 light and 5.46:1 dark on `canvas`, so the
   control's boundary meets WCAG 1.4.11. The contrast test gains these two
   pairs as declared UI-part pairs (3:1).

5. **One vocabulary serves both styles.** Call sites stop spelling a surface
   as its colour classes (`rounded border border-line bg-surface`) and use
   semantic surface classes — raised, raised-small, pressed, pressed-small, a
   field, a selected tab — defined once in `index.css`, whose rules differ by
   `data-surface`. The flat rules reproduce today's classes, so the Flat
   choice looks as the app does today. Names are plan work.

6. **Gates.**
   - The surface boot script gets the theme boot script's cases
     (`tests/f3.65a-theme-boot.test.ts` B1–B9): exact values, the default,
     a throwing read, no `matchMedia`, the exact key.
   - The storage key the switch writes equals the key the boot script reads.
   - The shadow tokens reference only role variables — no hex, no literal
     colour.
   - The spelled-out flat card pattern is gone from `apps/web/src`
     outside tests, with an exact allowlist for any site the plan keeps.
   - The existing F3.65 colour gates (tokens, roles, contrast, mapping) stay
     green, amended only where decision 4 adds pairs.

7. **Files in another item's flight wait.** The mimic editor's inspector and
   palette, `components/widgets/mimic-glyphs.tsx` and the mimic layout editor
   page are changing in `F3.32e` (ADR 0084). Their surfaces convert after
   `F3.32e` merges; `MIMIC_GLYPH_FILL_CLASS` and the mimic role classes are
   not touched by this item.

## Dependencies

None. No npm package is added; the shadows are CSS and Tailwind `theme`
configuration.

## Consequences

- Four combinations to check instead of two: every browser verification of a
  changed screen runs Light and Dark under both surface styles.
- A second persisted preference beside the theme; the header gains a second
  two-button switch.
- `surface` becomes the flat style's card colour only; the neumorphic style
  paints cards `canvas`.
- `AGENTS.md` §5 treats `ESKOM_SMOC.html` as the UX spec, which is flat. After
  a merge, a `chore(agents):` PR records the surface style there (§9.10).
- The owner may decide not to merge. The branch is then kept, not deleted, and
  nothing in `main` changes.
- Out of scope: the chrome, new colours, layout and information architecture
  (the grid, density and navigation stay), motion.

## Gate questions

| # | Question | Options put | Ruling |
|---|---|---|---|
| — | Neumorphism how far? | A limited soft UI after v1 (recommended) · prototype only first · full neumorphism after v1 · do not do it | **Full neumorphism, but prototype the Control Room page first** — prototype approved 2026-09-29 |
| — | When to build and merge? | Build now, merge after 10-02 (recommended) · start after 10-02 · put it in v1 | **Build now; the owner decides on the merge after the build** |
| Q1 | Does neumorphism replace the flat style, or do users get a switch? | Replace flat (recommended) · a user switch: flat / neumorphic · neumorphic with admin pages flat | **A user switch** — decision 1 |
| Q2 | What do form fields look like? | Pressed plus a hairline (recommended) · pressed only | **Pressed plus a hairline** — decision 4 |
| Q3 | Which hairline? (asked again after the measurement) | `ink-faint`, meets 3:1 (recommended) · `line-strong`, a lighter look below 3:1 | **`ink-faint`** — decision 4 |
| Q4 | Which style before the user chooses? | Neumorphic (recommended) · Flat | **Neumorphic** — decision 1 |
