// Runs each built SVG through the real upload parser (apps/api svg-symbol-parser.ts, bundled on
// the fly with esbuild so the shared schema is the current source) and reports PASS or FAIL.
// Run from the repo root: node iso-glyphs/validate.mjs
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const require = createRequire(join(ROOT, "node_modules", ".pnpm", "esbuild@0.25.12", "node_modules", "esbuild", "package.json"));
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
const files = ["out", join("out", "fill")].flatMap((dir) =>
  readdirSync(join(HERE, dir)).filter((f) => f.endsWith(".svg")).map((f) => join(dir, f)),
);
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
