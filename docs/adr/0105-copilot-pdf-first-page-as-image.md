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
   PDF that passes the picker's existing checks (`attachmentProblem`, the
   count, the 10 MB total), the dock renders its **first page** to a PNG in the
   browser and attaches that PNG **in place of** the PDF, named
   `<name without .pdf>-page-1.png`. The turn then carries an image, so the
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
   total in place of the PDF. The server re-checks every limit, as before.
4. **Refusals.** A PDF that `pdfjs-dist` cannot open — damaged, or protected
   by a password — is refused at the picker with one sentence:
   `"<name>" could not be read as a PDF.` Nothing is sent, and no password is
   asked for.
5. **The dependency.** `pdfjs-dist` `5.4.394` (Apache-2.0, Mozilla; engines
   `node >=20.16`), a dependency of `apps/web` only. It is loaded by a dynamic
   `import()` when a PDF is picked, with its worker as a separate asset, so the
   main bundle does not grow. `isEvalSupported: false` is set, which closes
   the font-code path of CVE-2024-4367 also on a version that already fixes it.
   Its optional `@napi-rs/canvas` is a Node-side renderer that this use does not
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
`page 1 of N`; a render failure gives the refusal sentence; the downscale loop
stops at the bound — each with a named mutation. Build: the main chunk does not
contain `pdfjs-dist`. Live stack: a real one-page drawing PDF, picked in the
dock, sends an `image/png` part and the turn's reply is from the vision model.
