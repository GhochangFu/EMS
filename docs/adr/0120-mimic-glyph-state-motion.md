# ADR 0120 — Mimic glyph state motion (`F4.344`)

## Status

**Accepted — 2026-11-09** (owner, in chat: "Accept, open the PR"; proposed the same day). Raised by the agent on 2026-11-09 after the owner
asked for animation in the new isometric mimic glyphs. The owner chose to
animate the **whole glyph by its state** and nothing else for now, and gave
three rulings in chat on 2026-11-09, one at a time, before this record was
written (listed under *Rulings*). Lines marked *(drafter)* are drafter calls
that the `F4.344` plan may refine; the others are rulings.

## Context

A mimic unit draws one glyph (`MimicGlyph`, `apps/web/src/components/widgets/mimic-glyphs.tsx`)
from the core set, a vendored library (ADR 0084, ADR 0086 decision 9) or an
organization library (ADR 0086). Today only the pipes move: the freshness
dash (`mimic-flow-dash.tsx`, `F3.32b`) runs along a pipe whose upstream unit
has fresh data, in the colour of its energy state (ADR 0088). The glyph
itself is still in every state.

Motion **cannot** come from the symbol file. The upload grammar (ADR 0086
decision 6) keeps seven shape tags and a fixed attribute list; any other
element refuses the file. Checked on 2026-11-09: a file with one `<animate>`
inside a `<path>` is refused with `Element <animate> inside <path> is not
allowed in a symbol`, and `style`, `class`, `fill` and `stroke` are dropped.
That grammar is a security boundary and stays as it is.

So motion belongs to the renderer, keyed on state the scene already derives:

- the unit status, `mimicNodeStatus` (`apps/web/src/lib/mimic.ts`):
  `alarm`, `live`, `stale`, `none`, `unassigned`;
- the top open alarm's severity **tone** (`pillToneSchema`: `critical`,
  `warning`, `info`, `offline`, `ok`), from the data-driven
  `bms.alarm_severities` vocabulary — no severity code is named in code;
- a switching unit's derived breaker state (`BreakerState`, ADR 0088):
  `offline`, `tripped`, `shut`, `open`, `flowing`, `closed`, `unknown`.

There is no general "running" state for a pump or a motor today; `live`
means the asset's data is fresh.

## Rulings (owner, 2026-11-09)

1. **Scope:** animate the whole glyph by its state; no per-part motion (no
   turning impeller or fan blades). Per-part motion would change the stored
   symbol grammar and is not decided here.
2. **States:** abnormal states and live — an alarm pulses, a tripped breaker
   blinks, and a live unit "breathes" slowly. Stale, none, unassigned and a
   unit with no asset stay still.
3. **Severity:** a critical alarm pulses faster than any other alarm.
4. **Off switch:** a per-widget "Glyph motion" switch, on by default, stored
   in the widget config; the viewer's reduced-motion setting always wins.

## Decision

1. **Renderer only.** The motion is a CSS animation on the glyph's own `<g>`
   in `MimicGlyph`. No change to the symbol grammar
   (`packages/shared/src/contracts/mimic-shapes.ts`), the upload parser
   (`apps/api/src/mimic-symbol-libraries/svg-symbol-parser.ts`), stored
   symbols, the mimic API responses or the database. It works the same for
   core, vendored and organization symbols, stroke and fill styles alike.
2. **One motion per unit, by priority** (highest first):

   | Motion | When | Cycle |
   | --- | --- | --- |
   | `blink` | the unit's breaker is `tripped` (a fan-out unit: any member) | 1.0 s, on/off |
   | `pulse-fast` | status `alarm` and the top alarm's tone is `critical` | 0.8 s |
   | `pulse` | status `alarm`, any other tone | 1.6 s |
   | `breathe` | status `live` | 3.2 s, ease-in-out |
   | none | `stale`, `none`, `unassigned`, no asset, every other breaker state | — |

   A pure function in `apps/web/src/lib/mimic.ts`,
   `mimicGlyphMotion(status, topAlarmTone, breakerStates)`, answers the motion;
   the scene passes it to `MimicGlyph`, which sets `data-motion` (for tests)
   and the motion class.
3. **What moves is opacity, and for a pulse a small scale** *(drafter)*:
   `breathe` 1 → 0.7; `pulse`/`pulse-fast` opacity 1 → 0.45 with scale
   1 → 1.06 about the glyph centre (`transform-box: fill-box`); `blink`
   opacity 1 → 0.15. Colour never changes — the glyph keeps its role class
   (ADR 0078), so the theme, the F4.341 colour profiles and the panel tone
   still decide it. The frame, status label and callout are unchanged and
   still carry the state; motion never carries it alone.
4. **Reduced motion.** Every motion class sits behind Tailwind's `motion-safe:`
   variant: with `prefers-reduced-motion: reduce` the glyph is still, at full
   opacity.
5. **Per-widget switch.** Both arms of `mimicConfigSchema`
   (`packages/shared/src/contracts/mimic-config.ts`) take
   `motion: z.boolean().optional()`; absent or `true` means on, `false` means
   off. The API's strict arms accept it. The mimic widget's settings form gets
   a "Glyph motion" switch. No migration: `bms.dashboard_widgets.config` is
   JSON and every existing widget reads as on.
6. **Where nothing moves:** the layout editor canvas, the symbol palette and
   its previews, and any print or export of a dashboard *(drafter)*. Motion is
   for the live widget only.
7. **Keyframes** live in `apps/web/tailwind.config.js` as `mimic-blink`,
   `mimic-pulse`, `mimic-pulse-fast` and `mimic-breathe` *(drafter)*. Units are
   not synchronised: each animation starts when its glyph mounts *(drafter)*.
8. **Safety limits.** Every cycle is at least 0.8 s, so nothing flashes more
   than three times a second (WCAG 2.3.1). The per-widget switch and the
   reduced-motion setting give the pause WCAG 2.2.2 asks for.

## Dependencies

None. Tailwind keyframes and the `motion-safe:` variant are already available.

## Consequences

- `apps/web` (scene, glyph, settings form, Tailwind config) and
  `packages/shared` (one optional config field) change; `apps/api` changes
  only where its strict config arms are composed. Specs: the motion function
  for every row of the table and every priority clash; `data-motion` on the
  drawn glyph; no motion under reduced motion, in the editor, or with
  `motion: false`.
- A control room with many live units shows many slow breathing glyphs. The
  owner chose this over "abnormal only" (the ISA-101 practice); the
  per-widget switch is the remedy where it distracts.
- **Deferred:** per-part motion (turning impellers, fan blades), which needs
  moving parts marked in the stored grammar — an ADR 0086 amendment; a true
  "running" state for pumps and motors from a run-status point; flashing an
  **unacknowledged** alarm differently from an acknowledged one (the node DTO
  carries no acknowledgement today); an organization-wide off switch.
