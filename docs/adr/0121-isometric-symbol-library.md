# ADR 0121 — Built-in isometric symbol library (`F4.345`; extends ADR 0086 decision 9)

## Status

**Accepted — 2026-11-09** (owner, in chat: "Accept, open the PR"; proposed the same day). Raised by the agent on 2026-11-09 after the owner
asked for the new isometric thin-line glyphs to be usable by **every**
organization on `bms.demosites.co.in`. An uploaded organization library
(ADR 0086) belongs to one organization only, so a global set must be a
built-in library. The owner gave three rulings in chat on 2026-11-09, one at
a time, before this record was written (listed under *Rulings*). Lines marked
*(drafter)* are drafter calls that the `F4.345` plan may refine; the others
are rulings.

## Context

The mimic draws units with the 29 core symbols (`mimicCoreSymbolSchema`) and
six vendored libraries: tabler, lucide, mdi (ADR 0084) and qet, wmpid,
drawio (ADR 0086 decision 9, `F3.32f`, migration `0092`). Organizations can
also upload their own libraries (ADR 0086), scoped to that organization.

On 2026-11-09 the agent drew 50 isometric glyphs with the **anatomy** kit
(`wheresryan22/anatomy`, MIT licence, © 2026 Ryan): the 29 core symbols, the
flow meter and RTU panel (AWS asset types with no core symbol), and 19
equipment kinds the vendored libraries draw and the core set does not
(damper — in use on the AWS ESKOM flow network as `qet:air-damper` —,
butterfly and check valves, Y-strainer, plate heat exchanger, blower,
submersible pump, bar screen, filter press, horizontal tank, condensing unit,
solar PV, wind turbine, EV charger, capacitor bank, isolator, VFD, smoke
detector, pressure gauge). Hidden lines are removed at build time.

Two findings set the shape:

- **Line weight.** A `stroke` library is drawn with a line width of 1/16 of
  the glyph (`mimic-glyphs.tsx`), so the isometric glyphs' close lines merge.
  As a `fill` library each line is a thin filled ribbon, 1/40 of the glyph,
  and the detail reads at the mimic's 60-unit glyph size.
- **Colour.** The files carry no colour; the renderer paints them with the
  role token (ADR 0078), so themes, the F4.341 colour profiles and ADR 0120's
  motion apply unchanged.

All 50 files pass the upload parser (`svg-symbol-parser.ts`): at most 200
shapes, every `d` under 8,192 characters, the largest file 40,537 bytes.

## Rulings (owner, 2026-11-09)

1. **Source:** the repository holds the glyph scripts and a vendored copy of
   the anatomy kit with its MIT licence, so a glyph can be rebuilt or changed
   later; the generated library modules are committed too, like the other
   vendored libraries.
2. **Reach:** the glyphs appear in the mimic builder palette as a new library
   **and** a mimic widget gets a glyph-set switch, so a preset mimic (the PHE
   pump station, ESKOM LV single line, water train, HVAC chiller plant) can
   draw the isometric version of each core symbol.
3. **Default:** every existing widget keeps the core glyphs; an admin opts a
   widget in to the isometric set.

## Decision

1. **A seventh vendored library, code `iso`**, label "Isometric"
   *(drafter)*, **`fill` style**, `sort_order` 80. `iso` is appended to
   `mimicSymbolLibraryCodeSchema` (never reordered). Symbol keys are
   `iso:<name>`; the 29 core equivalents use the core key as the name
   (`iso:pump`, `iso:tank`, …), the others a kebab-case name
   (`iso:butterfly-valve`). Each symbol has a label and one of the eight
   palette groups (`MIMIC_SYMBOL_GROUP_CODES`).
2. **Source in the repository** (ruling 1):
   - `scripts/mimic-symbols/sources/iso/` — one module per glyph, the
     hidden-line and ribbon steps, and the build that writes the SVGs;
   - `scripts/mimic-symbols/vendor/anatomy-kit/` — the kit files the scripts
     import, unchanged, with the kit's `LICENSE` and a `SOURCE.md` naming the
     upstream repository and commit;
   - `scripts/mimic-symbols/generate.mjs --iso` writes the shared and web
     generated modules (`iso.generated.ts`) and `--sql-rows iso`, the same
     path qet, wmpid and drawio take.
3. **Migration** (next free number at build time): one row in
   `bms.mimic_symbol_libraries` (`licence` "Own work; anatomy kit MIT"
   *(drafter)*) and 50 rows in `bms.mimic_symbols`, generated, inside
   `SET ROLE bms_owner`, `ON CONFLICT DO NOTHING`, with the `DO $$` effect
   assertion — the `0092` pattern. No table, privilege or policy changes.
4. **On for every organization.** A global library with no
   `bms.mimic_library_settings` row is enabled, so every organization sees
   `iso` in the palette on deploy; an organization admin can turn it off
   (`PUT /api/v1/mimic-symbol-libraries/settings/iso`). It loads lazily, like
   qet, wmpid and drawio (`F3.32h`).
5. **Glyph-set switch** (rulings 2 and 3). Both arms of `mimicConfigSchema`
   take `glyphSet: z.enum(["core", "iso"]).optional()`; absent means `core`,
   so no widget changes on deploy and there is no migration of
   `bms.dashboard_widgets`. With `iso`, a unit whose symbol is a **core key**
   draws `iso:<key>` instead; a unit that already names a library or
   organization key is unchanged. The mimic widget's settings form gets a
   "Glyph set: Core / Isometric" control. Applied in the web only, where
   `MimicGlyph` resolves the kind *(drafter)*.
6. **The tank's live level.** The core tank draws a liquid fill from its
   level point. The isometric tank keeps that: the generated `iso` module
   carries a level box for `tank` (the shell's projected inner area), and the
   renderer clips the fill to it *(drafter — the plan may choose another
   way)*.
7. **Palette and editor.** The builder palette shows the `iso` library like
   any other; the layout editor draws `iso` units still (ADR 0120 decision 6).

## Dependencies

None from npm. The vendored kit is plain JavaScript with no dependencies,
used only by the offline scripts; nothing under `apps/*` imports it.

## Consequences

- Touches `packages/shared` (library code, generated module, config field),
  `apps/web` (generated module, glyph-set resolution, tank level box,
  settings control), `packages/db` (one migration), `scripts/mimic-symbols`
  (sources, vendored kit, generator) and the library tests
  (`tests/f3.32e-mimic-symbol-libraries*.test.ts`, which compare the
  migration rows with the generated modules both ways).
- The repository is public: the vendored kit ships with its MIT licence and
  attribution; the glyphs themselves are own work.
- Uploaded copies are no longer needed; any organization that uploaded the
  set as its own library can retire it.
- **Deferred:** per-part motion (needs an ADR 0086 amendment); a
  per-organization default glyph set; isometric versions of tabler, lucide or
  mdi icons.

## Amendment 1 — eight more glyphs; the PHE RTU and network nodes draw a tower and a gateway in the isometric set (`F4.352`) (owner, 2026-11-10)

**Status: Accepted — 2026-11-10** (owner, in chat: "Accept, merge on
green"; proposed the same day). The owner asked in chat on 2026-11-10
(1) whether the 50 glyphs cover the new WBLDC cold-chain site and (2) for the
PHE mimic's RTU signal to draw a mobile-tower glyph, not the sensor glyph. The
owner approved the gap list and asked for this amendment ("Yes, write the
ADR"). Lines marked *(drafter)* were not asked; the `F4.352` plan may refine
them.

### Facts the amendment rests on

- **WBLDC on AWS** (read-only, 2026-11-10): 19 cold-chain assets at two meat
  plants (Haringhata, Phansidewa) — blast freezers, deep freezers, cold rooms
  and chiller rooms — each with one point, `cold_room_temp_c`. Its four mimic
  widgets already use `glyphSet: "iso"` and two layouts whose 23 unit nodes
  name stand-ins: `iso:compressor` for a blast freezer, `iso:condensing-unit`
  for a deep freezer or cold room, `iso:chiller` for a chiller room. A
  compressor and a condensing unit are machines, not rooms, and `chiller` is
  the HVAC water chiller, so all three name the wrong equipment.
- **PHE RTU signal.** `MIMIC_NODE_GLYPHS` (`apps/web/src/lib/mimic.ts`) maps
  the `rtu` node of `pump_station_overview` and `pump_station_environment`
  and the `network` node of `pump_station_environment` to the core `sensor`
  symbol. Decision 5 makes the isometric set draw the core key's twin, so the
  18 PHE WB mimics (on `iso` since 2026-11-09) draw `iso:sensor` for the RTU
  link. The set has no tower and no gateway; `iso:rtu` is the RTU *panel*.

### Decision

1. **Eight glyphs join `iso`**, drawn with the same kit, hidden-line step and
   ribbon width (1/40), and appended after the existing 50 (never reordered):

   | Key | Label *(drafter)* | Group | Drawing |
   |---|---|---|---|
   | `iso:telemetry-tower` | Telemetry tower | `general` | A lattice mast with panel antennas and signal arcs |
   | `iso:gateway` | Network gateway | `it_ups` | A box with two antennas and port lights |
   | `iso:blast-freezer` | Blast freezer | `hvac` | An insulated tunnel room with a fan wall on its face |
   | `iso:cold-room` | Cold room | `hvac` | A walk-in insulated panel room with a hinged door and strip curtain |
   | `iso:deep-freezer` | Deep freezer | `hvac` | A walk-in room with a thick sliding door and frost marks |
   | `iso:unit-cooler` | Unit cooler | `hvac` | A ceiling evaporator with two fans |
   | `iso:temperature-probe` | Temperature probe | `environment` | A thermometer probe with a head and stem |
   | `iso:reefer` | Refrigerated container | `facility` | A reefer container with its front refrigeration unit |

   Each file passes the upload parser like the other 50 (at most 200 shapes,
   each `d` under 8,192 characters).
2. **Migration** (next free number at build time): eight rows in
   `bms.mimic_symbols` for the existing `iso` library, generated by
   `generate.mjs --iso --sql-rows iso`, inside `SET ROLE bms_owner`,
   `ON CONFLICT DO NOTHING`, with the `DO $$` effect assertion (58 `iso`
   rows after it) — the `0092` pattern. No table, privilege or policy changes;
   the library row is untouched.
3. **A node override in the isometric set only.** A preset node may name its
   own isometric glyph that wins over the core key's twin: the `rtu` nodes
   draw `iso:telemetry-tower` and the `network` node draws `iso:gateway`. The
   override is a typed table beside `MIMIC_NODE_GLYPHS` in
   `apps/web/src/lib/mimic.ts` *(drafter)*, read where `mimicGlyphKindFor`
   resolves the kind. **The core set does not change**: with `glyphSet`
   absent or `core`, these nodes still draw `sensor`, because the core set has
   no tower symbol (adding one is a `mimicCoreSymbolSchema` change, not part
   of this amendment). No widget or layout row changes for the override.
4. **WBLDC re-link, a data step after deploy** *(drafter)*: the agent backs up
   the two WBLDC layouts' node rows, then points the 23 stand-in units at
   `iso:blast-freezer`, `iso:deep-freezer` or `iso:cold-room` by the asset
   they bind, and records the backup path in the row. Not a migration — it is
   one organization's own layout data.

### Consequences

- Touches `scripts/mimic-symbols` (eight glyph modules, curation labels),
  the generated `iso` modules in `packages/shared` and `apps/web`, one
  migration in `packages/db`, the override in `apps/web/src/lib/mimic.ts`, and
  the library tests that compare migration rows with the generated modules.
- The lazily loaded `iso` chunk grows by about the size of eight glyphs
  (today 1,070.50 kB raw / 304.85 kB gzip for 50).
- **Deferred:** a core tower symbol for the core set; per-asset-type default
  glyphs; glyphs for door switches, humidity and power meters of a cold room.
