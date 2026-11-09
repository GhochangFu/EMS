# Isometric glyphs — the `iso` mimic symbol library

The built-in `iso` library (ADR 0121, `F4.345`): 50 isometric glyphs — the 29 core mimic
symbols, the flow meter and RTU panel, and 19 equipment kinds — drawn with the vendored
anatomy kit (`../../vendor/anatomy-kit`, MIT, © 2026 Ryan) and written in the upload grammar of
ADR 0086 decision 6 (geometry only, at most 200 shapes, no class, fill, stroke or text). The
library is `fill` style: every line is a thin filled ribbon, 1/40 of the glyph.

Rebuild, from the repo root:

```bash
node scripts/mimic-symbols/sources/iso/build.mjs
node scripts/mimic-symbols/sources/iso/validate.mjs
node scripts/mimic-symbols/generate.mjs --iso scripts/mimic-symbols/sources/iso/out/fill --only iso
node scripts/mimic-symbols/generate.mjs --iso scripts/mimic-symbols/sources/iso/out/fill --sql-rows iso
```

1. `build.mjs` writes `out/fill/<id>.svg`, `out/manifest.json` (version, line width, the kit
   files' SHA-256, the glyph ids, the tank's level box) and `out/preview.html` (each glyph at
   120 px and at the mimic's 60 px, dark and light). `out/` is not committed.
2. `validate.mjs` runs every `out/fill/*.svg` through the real upload parser
   (`apps/api/src/mimic-symbol-libraries/svg-symbol-parser.ts`) and exits 1 on a failure.
3. `generate.mjs --iso … --only iso` reads them through `../iso.mjs` and writes the shared and
   web `iso.generated.ts` modules and the web `iso.level-boxes.generated.ts`.
4. `--sql-rows iso` prints the `bms.mimic_symbols` rows; a changed glyph set is a **new**
   migration (committed migrations are frozen).

- `glyphs/<id>.mjs` — one asset: `name`, `extent` (world points) and `parts(k, G, P)` in paint
  order, back to front; `tank.mjs` also exports `level` (the shell, for the live level fill).
  A new glyph is added to `CORE` in `build.mjs` and to `../../curation/iso.json` (name, label,
  palette group).
- `lib/flatten.mjs` — hidden-line removal: each part's outline and creases are cut where a nearer
  part covers them.
- `lib/ribbon.mjs` — each line as a thin filled ribbon; a `d` stays under the 8,192-character cap.
- `lib/shapes.mjs` — short helpers over the kit for glyph modules.
