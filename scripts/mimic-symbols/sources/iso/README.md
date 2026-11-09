# iso-glyphs

Simplified isometric asset glyphs for the Plant Mimic symbol library, drawn with the
`anatomy` skill's kit (`~/.claude/skills/anatomy/kit`) and flattened into the upload grammar of
ADR 0086 decision 6 (geometry only, at most 200 shapes, no class, fill, stroke or text).

```bash
node iso-glyphs/build.mjs      # writes out/<id>.svg and out/preview.html
node iso-glyphs/validate.mjs   # runs every out/*.svg through the real upload parser
```

- `glyphs/<id>.mjs` — one asset: `name`, `extent` (world points) and `parts(k, G, P)` in paint
  order, back to front. Add the id to `GLYPHS` in `build.mjs`.
- `lib/flatten.mjs` — hidden-line removal: a "stroke" library draws with `fill="none"`, so each
  part's outline and creases are cut where a nearer part covers them.
- `out/preview.html` — the glyph drawn the way `mimic-glyphs.tsx` draws a stroke library
  (stroke width 1.5 × side / 24), at 240, 96, 48 and 32 px, dark and light.

Upload: Admin → mimic symbol libraries → a library with style **stroke** → upload `out/<id>.svg`.
Set `ANATOMY_KIT` if the skill lives somewhere else.
