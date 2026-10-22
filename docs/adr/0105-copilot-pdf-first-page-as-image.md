# ADR 0105 — The copilot dock sends a PDF's first page as an image (`F4.269`)

## Status

**Proposed — 2026-10-22** (owner, in chat). Two gate questions were put to the
owner one at a time, each with options and a recommendation, and both were
ruled as recommended (see *Gate questions*). Drafted before any implementation
code; the merge of the `F4.269` PR approves the record. Code citations are to
`main` at `b6581b17`.

This record **amends ADR 0090 Amendment 3 ruling 6** ("Do PDF turns still go
to the vision model? … images only") for files the dock attaches, and adds one
web dependency, `pdfjs-dist` (AGENTS.md §9.4).

## Context

ADR 0099 Amendment 3 (`F3.87`) lets an administrator attach up to three files
to a copilot turn — PNG, JPEG, WebP, PDF or SVG. ADR 0090 Amendment 3 ruling 6
keeps a PDF turn on the main model, which OpenRouter feeds the parsed text, so
a text document works and **a drawing in a PDF loses its pictures**. `F4.268`
(#885) made the copilot say so and ask for an image instead. Single-line
diagrams and layout drawings arrive from sites as PDFs, so the user has to
export a page to an image by hand before the copilot can read it.

Sending the PDF to the vision model was measured and refused: on the AWS demo
`nvidia/nemotron-3.5-super-vl` failed 3 of 3 PDF turns on the 45 s deadline and
`z-ai/glm-5.3-flash` passed 2 of 3 (`docs/BACKLOG.md` F4.269). Rendering a page
to an image is the step the user does by hand today.

## Gate questions

1. **How should the copilot read a drawing inside a PDF?** Options: the
   browser renders page 1 with `pdfjs-dist`; the API renders page 1 (needs
   `pdfjs-dist` plus a native canvas package in the API and worker images);
   send the PDF to the vision model. **Ruled as recommended: the browser
   renders page 1.**
2. **What does the turn send?** Options: the PNG replaces the PDF; the PNG and
   the PDF (the server drops the PDF for the vision model); the user picks per
   file. **Ruled as recommended: the PNG replaces the PDF.**

## Decision

1. **The dock renders, the server does not change.** When the user picks a
   PDF that passes the picker's per-file check (`attachmentProblem`: the type
   and the 10 MB per-file size), the dock renders its **first page** to a PNG
   in the browser and attaches that PNG **in place of** the PDF, named
   `<name without .pdf>-page-1.png`. The count (three files a message) and
   the 10 MB total are checked **on the PNG, after the render**, not on the
   PDF before it. The turn then carries an image, so the
   API routes it to the organization's vision model (ADR 0090 Amendment 3) as
   it routes any image. The API, the contracts and ruling 6 for a PDF that
   reaches the server are unchanged; the dock no longer sends one.
2. **Pages 2 and later, and the PDF's text, are not sent.** The chip says
   `page 1 of N, sent as an image` so the user knows what goes. A user who
   needs another page exports it as an image, as today.
3. **Bounds.** The page renders at a scale whose longer side is at most
   2048 px. A PNG above `MAX_COPILOT_ATTACHMENT_BYTES` is rendered again at a
   smaller scale until it fits or the longer side would drop under 1024 px,
   after which the picker refuses the file. The PNG counts toward the 10 MB
   total in place of the PDF. One image inside the page decodes to at most
   4096 × 4096 pixels (`maxImageSize`), and the open plus the render are
   refused after 20 s: the loading task is destroyed and the picker gives the
   decision 4 sentence. While a render is in flight the composer shows a
   `Rendering <name>…` chip and Send waits; a turn in flight removes only
   the files it sent, so a page that lands meanwhile stays for the next one.
   The server re-checks every limit, as before.
4. **Refusals.** A PDF that `pdfjs-dist` cannot open — damaged, or protected
   by a password — is refused at the picker with one sentence:
   `"<name>" could not be read as a PDF.` Nothing is sent, and no password is
   asked for. A failure to load `pdfjs-dist` itself (the lazy chunk or the
   module, for example after a deploy replaced it) is not the file's fault and
   has its own sentence: `"<name>" could not be prepared: reload the page and
   try again.`
5. **The dependency.** `pdfjs-dist` `5.4.394` (Apache-2.0, Mozilla; engines
   `node >=20.16`), a dependency of `apps/web` only. It is loaded by a dynamic
   `import()` when a PDF is picked, with its worker as a separate asset, so the
   main bundle does not grow. The worker is imported with `?worker&url` and
   Vite's `worker.format: "es"`, so it is emitted as an ES module named
   `assets/*.js`: `pdfjs-dist` 5 starts it with
   `new Worker(src, { type: "module" })`, and nginx (`nginx:1.27-alpine`)
   serves `.mjs` as `application/octet-stream`, which a module worker
   refuses. Its wasm image decoders, standard fonts and packed CMaps are passed
   as same-origin `wasmUrl`, `standardFontDataUrl` and `cMapUrl`
   (`cMapPacked: true`) under `/pdfjs/`, each with a trailing slash;
   `apps/web/scripts/copy-pdfjs-assets.mjs` copies them from
   `node_modules/pdfjs-dist` into `apps/web/public/pdfjs/` (gitignored) as
   the `predev` and `prebuild` scripts, so `vite dev` serves them and every
   build, the web Dockerfile's included, ships them in `dist/pdfjs/`. No CDN
   is read. `isEvalSupported: false` is set as defence in depth:
   CVE-2024-4367 was the font glyph path, which has used no `eval` since
   `4.2.67`, so `5.4.394` is not exposed to it; in `5.4.394` the flag
   controls only the Type 4 PostScript function compiler. Its optional `@napi-rs/canvas` is a Node-side renderer that this use does not
   load.
6. **Privacy is unchanged.** The PNG goes to the same organization's provider
   under the same unscrubbed-file sentence (ADR 0099 Amendment 3 A7); the
   rendering happens in the user's own browser, and the server keeps only the
   placeholder line it keeps for any file.

## Consequences

- A drawing in a PDF reaches the vision model with no manual export.
- A text PDF picked in the dock now loses its text beyond what is visible on
  page 1. That is the trade gate question 2 made; the user can still paste the
  text.
- The web app gains one dependency and one lazy chunk; the API, worker and
  ingest images do not change.
- `F4.268`'s server note for a PDF-only turn stays for any client that still
  sends a PDF.

## Not in this ADR

Rendering in the API; a page picker; more than one page; OCR; sending the PDF
and the image together; a change to the server's PDF path or to ruling 6 for
a PDF the server receives.

## Verification owed

Unit (jsdom, `pdfjs-dist` stubbed at the module seam): a picked PDF becomes one
PNG `File` named `-page-1.png` and the PDF is not in the send; the chip shows
`page 1 of N`; a render failure gives the refusal sentence; a module-load
failure gives the reload sentence; the downscale loop stops at the bound;
`getDocument` receives `maxImageSize: 4096 * 4096` and the three same-origin
asset URLs; an open that outlives the injected timeout is refused; the loading
task is destroyed once on success, on an open failure, on the too-large refusal
and on a timeout; Send waits for a render in flight; a page that lands during a
send survives it; a late render never clears another banner — each with a
named mutation. Build: the main chunk does not contain `pdfjs-dist`; the
worker is emitted as `dist/assets/*.js`, not `.mjs`; and
`dist/pdfjs/wasm/openjpeg.wasm`, `dist/pdfjs/standard_fonts/` and
`dist/pdfjs/cmaps/` exist. Live stack: a real one-page drawing PDF, picked in the
dock, sends an `image/png` part and the turn's reply is from the vision model.
