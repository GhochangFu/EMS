// F4.269 (ADR 0105): copies the pdfjs-dist assets the browser fetches at run
// time — the wasm image decoders, the standard fonts and the packed CMaps — to
// apps/web/public/pdfjs/, so `vite dev` serves them and `vite build` copies
// them into dist/pdfjs/ from the same origin. No CDN is read. Runs as the
// `predev` and `prebuild` scripts; the target is in .gitignore.
import { cpSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(web, "package.json"));
const pdfjs = dirname(require.resolve("pdfjs-dist/package.json"));
const target = join(web, "public", "pdfjs");

rmSync(target, { recursive: true, force: true });
for (const dir of ["wasm", "standard_fonts", "cmaps"]) {
  cpSync(join(pdfjs, dir), join(target, dir), { recursive: true });
}
console.log(`copied pdfjs-dist wasm, standard_fonts and cmaps to ${target}`);
