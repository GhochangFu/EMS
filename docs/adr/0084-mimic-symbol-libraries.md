# ADR 0084 — Preloaded mimic symbol libraries (`F3.32e`)

## Status

Accepted — drafted on 2026-09-29, before any implementation code. The owner
approved this written record on 2026-09-29, with one change: "Include other
free licenced libraries as well". Decision 4 names them.

The owner raised the need on 2026-09-29, after `F3.32d`: "we need to have a
broader set of glyph libraries preloaded into our system, the user during
creation can choose the glyph libraries". On the same day the owner ruled the
scope for the v1 release — **preloaded system libraries only** — and the
release condition: **if this work is not merged by the end of 2026-09-30, the
whole branch is held and the release ships `F3.32d` as it is.**

Amends [ADR 0081](./0081-mimic-layout-builder.md) decision 1 (a closed symbol
set restated by a CHECK) and [ADR 0082](./0082-mimic-domain-symbols-and-presets.md)
decisions 1 and 2. Promotes nothing out of `AGENTS.md` §6.

## Context

**What exists.** A unit in a mimic layout draws one of 29 symbols. The set is
a closed `z.enum` (`mimicSymbolSchema`), restated in
`mimic_layout_nodes_symbol_check` (migration `0089`), with a hand-drawn glyph
for each in `apps/web/src/components/widgets/mimic-glyphs.tsx`. Every new
symbol is a release, and a release adds a handful at a time.

**What the owner asks for.** A broad set of symbols, preloaded, grouped into
libraries, and a choice of libraries when a user creates a layout.

**Sources checked on 2026-09-29.**

| Source | Licence | Style | Fit |
|---|---|---|---|
| Tabler Icons 3.48.0 | MIT | outline, 24 grid, `path` only | general plant and building objects |
| Lucide 1.48.0 | ISC | outline, 24 grid, seven SVG shape elements | general objects; overlaps Tabler |
| Material Design Icons (Pictogrammers) 7.4.47 | Apache 2.0 | filled, 24 grid, one `path` | the widest industrial set: valves, pumps, heat pumps, HVAC, storage tanks, transmission towers, electric meters, silos |
| QElectroTech elements | CC-BY 3.0 | electrical schematics | per-file attribution work |
| Wikimedia Commons P&ID | public domain or CC-BY-SA per file | process symbols | per-file licence work |
| draw.io stencils | separate stencil clause | mixed | legal check first |
| IPD Studio | PolyForm Noncommercial 1.0.0 (AGPL-3.0 to v0.12.1) | P&ID | **not usable** |

The first three are permissive, ship machine-readable path data, and use our
24-unit grid. The others need per-file licence work.

**Why not the whole backlog row.** The row as raised (6–8 days) also has
organization-owned libraries, an administrator enable switch and SVG upload.
Organization-owned symbol rows need a shared-row disjunct in a read policy,
and an uploaded SVG is an XSS surface. Neither fits before the cutoff.

## Decision

1. **Two global lookup tables.** Migration `0090` creates, in the
   `bms.asset_roles` shape (global, no `organization_id`, no row security,
   privileges from `0041`'s default grants):
   - `bms.mimic_symbol_libraries` — `code` (primary key), `label`, `source`,
     `version`, `licence`, `attribution_url`, `style` (`stroke` or `fill`),
     `sort_order`, `active`.
   - `bms.mimic_symbols` — `key` (primary key, `varchar(64)`),
     `library_code` (foreign key), `label`, `group_code`, `sort_order`,
     `active`.

   It inserts one row per library and one row per symbol, in the `0087` idiom
   (`SET ROLE bms_owner`, bare `ON CONFLICT DO NOTHING`, a `DO $$`
   self-check).

   **Amended 2026-09-29 (owner ruling after the migration review):**
   `bms_tenant` loses `INSERT`, `UPDATE` and `DELETE` on both tables — they
   are fleet-wide master data, the line `0059` drew for `bms.point_keys` and
   `0085` for `bms.location_types`. `bms_fleet` keeps its privileges. The
   `ALTER`s on the two FORCE-RLS layout tables run as the migrator's
   superuser, after `RESET ROLE`, so the foreign key validates every row.
2. **A symbol key names its library.** A core key stays bare (`tank`,
   `transformer`), so every stored layout, preset and widget keeps its value.
   Every other key is `<library>:<name>` (`tabler:bolt`, `lucide:factory`,
   `mdi:heat-pump`). `mimic_layout_nodes.symbol` widens from `varchar(32)` to
   `varchar(64)`; the generator refuses a key longer than 64.
3. **A foreign key replaces the CHECK.** Migration `0090` drops
   `mimic_layout_nodes_symbol_check` (`0089` is frozen) and adds a foreign key
   from `mimic_layout_nodes.symbol` to `bms.mimic_symbols(key)`, with no
   `ON DELETE`: a symbol in use cannot be removed, only made inactive. The
   service maps the violation to a 400, as it does for `role_code`.
4. **Four libraries.**

   | Code | Label | Licence | Style | Set |
   |---|---|---|---|---|
   | `core` | Core | ours | stroke | the 29 existing symbols |
   | `tabler` | Tabler Icons | MIT | stroke | about 150 curated outline icons |
   | `lucide` | Lucide | ISC | stroke | about 100 curated outline icons |
   | `mdi` | Material Design Icons | Apache 2.0 | fill | about 150 curated industrial icons |

   **Amended 2026-09-29 (`F3.32e` plan ruling R7):** the core library is
   labelled "Core", not "TRINETRA Core" — ADR 0083 replaces the product
   name on screen, so no library label names the product.

   Each curated set is a checked-in list of names, chosen for plant and
   building use and sorted into the eight `F3.32d` palette groups (Water,
   Electrical, IT and UPS, HVAC, Mechanical, Environment, Facility, General).
   Left out: every Tabler `-filled` variant, every Lucide icon with a `fill`
   attribute, every MDI icon tagged "Brand / Logo" or marked deprecated, and
   every icon with an element or attribute outside decision 5's list.
5. **Path data is vendored code, not stored data.** A repository script reads
   the pinned release of each source and writes one generated TypeScript
   module per library: for each key, a list of shape elements. Permitted
   elements are `path`, `circle`, `ellipse`, `rect`, `line`, `polyline` and
   `polygon`; permitted attributes are their geometry only (`d`, `cx`, `cy`,
   `r`, `rx`, `ry`, `x`, `y`, `width`, `height`, `x1`, `y1`, `x2`, `y2`,
   `points`). The module header carries the source's licence notice. The
   renderer draws each element as a React element inside the existing glyph
   wrapper — never `innerHTML`, never an SVG string. The database holds keys,
   labels and groups only. A new icon is still a release; a new library is a
   script run and a migration.
6. **Colour stays with the role token (ADR 0078).** A `stroke` library draws
   as the core glyphs do: no fill, the role's stroke class. A `fill` library
   draws with no stroke and the matching fill class of the same role. The two
   class lists are literal strings in one web module, so Tailwind emits them.
   No glyph names a colour.
7. **The contract.** `packages/shared` keeps the 29 core keys as
   `mimicCoreSymbolSchema` and adds each library's curated keys, labels and
   groups (no path data). A node's `symbol` validates against the union, so an
   unknown key is a 400 before it reaches the foreign key. A gate compares the
   shared list, the generated modules and the rows of `0090`, both ways.
8. **A layout chooses its libraries.** `bms.mimic_layouts` gains
   `symbol_libraries varchar(32)[] NOT NULL DEFAULT '{core}'`, at least one
   member. The create form offers the active libraries as check boxes, with
   `core` checked. A save refuses a unit whose key belongs to a library the
   layout did not choose. An existing layout reads as `{core}` and draws as
   before.
9. **The palette.** The editor palette shows one tab per chosen library, the
   eight groups inside each tab, and a search box that filters by label across
   the chosen libraries. The inspector's symbol select lists the chosen
   libraries' symbols, grouped. Each tab names its source and licence
   ("Tabler Icons — MIT"), and the licence notices ship in the bundle.
10. **Out of this ADR, to a new row `F3.32f`:** organization-owned libraries,
    an administrator switch to enable a library for an organization, SVG
    upload and its sanitizer, an attributions page, and the sources that need
    per-file licence work (QElectroTech, Wikimedia Commons, draw.io).

## Dependencies

None. The path data of Tabler Icons 3.48.0, Lucide 1.48.0 and Material Design
Icons 7.4.47 is vendored under their licences; no package enters a manifest.

## Consequences

- The symbol vocabulary becomes a lookup table, as the dynamic-vocabulary rule
  asks. The path data stays code, so this is not yet a symbol an administrator
  can add; `F3.32f` takes that step.
- The web bundle grows by the path data of about 400 icons. The routes are not
  code-split, so it loads on first paint; the PR states the measured growth of
  the main chunk.
- A second draw style (`fill`) enters the mimic. A filled icon beside a line
  drawing looks heavier; the palette tab keeps each library together.
- The gates that pin the closed 29-symbol set (`mimicSymbolsAreTheTwentyNineInOrder`,
  the CHECK comparison in `tests/f3.32c-mimic-layouts-schema.test.ts`, the
  glyph specs, the palette and inspector group specs) move to the core list
  or to the lookup table. The `DO $$` block in the frozen `0089` stays as it
  is.
- The icons are drawings of objects, not standard process symbols. They widen
  what a layout can show; they do not replace a P&ID set, which needs the
  per-file licence work in `F3.32f`.
- A layout that chose a library cannot drop it while a unit still uses one of
  its symbols. The editor says which units block the change.
