// Runs each built SVG (out/fill/*.svg) through the real upload parser (apps/api
// svg-symbol-parser.ts, bundled on the fly with esbuild so the shared schema is the current
// source) and reports PASS or FAIL. Run from the repo root, after build.mjs:
//
//   node scripts/mimic-symbols/sources/iso/validate.mjs
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
// esbuild as the root dev dependency tsx resolves it, not a pinned pnpm store path.
const require = createRequire(createRequire(join(ROOT, "package.json")).resolve("tsx/package.json"));
const esbuild = require("esbuild");
const outfile = join(mkdtempSync(join(tmpdir(), "iso-glyph-parser-")), "parser.mjs");
await esbuild.build({
  entryPoints: [join(ROOT, "apps/api/src/mimic-symbol-libraries/svg-symbol-parser.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "error",
});
const { parseSvgSymbol } = await import(pathToFileURL(outfile).href);

let failed = 0;
const dir = join("out", "fill");
const files = readdirSync(join(HERE, dir))
  .filter((f) => f.endsWith(".svg"))
  .map((f) => join(dir, f));
for (const file of files) {
  try {
    const result = parseSvgSymbol(readFileSync(join(HERE, file)));
    console.log(`PASS ${file}: viewBox ${result.viewBox.join(" ")}, ${result.shapes.length} shapes`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${file}: ${error.reason ?? error.message}`);
  }
}
process.exit(failed ? 1 : 0);
