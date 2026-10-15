import { createHash } from "node:crypto";

import { expect } from "vitest";

import { bodyHash } from "./body-hash";
import { uploadBodyOf } from "./copilot-upload-change.interceptor";
import {
  prepareUpload,
  UPLOAD_BAD_FILENAME_ERROR,
  UPLOAD_NEEDS_ATTACHMENT_ERROR,
  UPLOAD_NO_SVG_ERROR,
  UPLOAD_TOO_LARGE_ERROR,
} from "./copilot-upload-prepare";

/**
 * `F3.87` PR 6a (ADR 0099 Amendment 3 A3, plan §8.2) — the propose step of an
 * upload entry: the SVG is checked by the route's own parser, and the stored
 * body holds the text fields, the file's name and SHA-256, and the text.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ENTRY = { upload: { fileField: "file", contentType: "image/svg+xml", maxBytes: 65_536 } } as const;
export const VALID_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 12h20"/></svg>';
const sha = (text: string): string => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

/** A valid SVG text: the stored body is the fields, the derived filename, the SHA-256 and the text. */
export function aValidSvgTextIsStoredWithItsHash(): void {
  const prepared = prepareUpload(ENTRY, { name: "pump", label: "Pump", svg: { kind: "text", text: VALID_SVG } });
  expect(prepared).toEqual({
    ok: true,
    body: { name: "pump", label: "Pump", filename: "pump.svg", fileSha256: sha(VALID_SVG), svgText: VALID_SVG },
  });
}

/** An SVG the parser refuses is the tool's error, and nothing is prepared. */
export function aRefusedSvgIsTheToolError(): void {
  const prepared = prepareUpload(ENTRY, { name: "x", svg: { kind: "text", text: "<svg><script>alert(1)</script></svg>" } });
  expect(prepared.ok).toBe(false);
  expect(prepared.ok === false && prepared.error.startsWith("The SVG cannot be a symbol:")).toBe(true);
}

/** Over `maxBytes`: refused before the parser runs. */
export function anOversizeSvgIsRefused(): void {
  const big = VALID_SVG.replace("</svg>", `<!--${"x".repeat(70_000)}--></svg>`);
  expect(prepareUpload(ENTRY, { svg: { kind: "text", text: big } })).toEqual({ ok: false, error: UPLOAD_TOO_LARGE_ERROR });
}

/** An attachment index this turn does not carry is refused; one it carries supplies the text and the filename. */
export function anAttachmentIsUsedOnlyWhenTheTurnCarriesIt(): void {
  expect(prepareUpload(ENTRY, { svg: { kind: "attachment", index: 1 } })).toEqual({ ok: false, error: UPLOAD_NEEDS_ATTACHMENT_ERROR });
  const prepared = prepareUpload(ENTRY, { svg: { kind: "attachment", index: 1 } }, [{ filename: "valve.svg", svgText: VALID_SVG }]);
  expect(prepared.ok && prepared.body.filename).toBe("valve.svg");
  expect(prepared.ok && prepared.body.svgText).toBe(VALID_SVG);
}

/** No svg at all: refused. */
export function aMissingSvgIsRefused(): void {
  expect(prepareUpload(ENTRY, { name: "pump" })).toEqual({ ok: false, error: UPLOAD_NO_SVG_ERROR });
}

/**
 * The round trip the Confirm depends on: the body `prepareUpload` stores,
 * sent as the browser sends it (each stored field, the file under its stored
 * name) and read as multer hands it, hashes to the stored hash — an empty
 * `name` and a `group` included.
 */
export function aPreparedBodyRoundTripsThroughTheRouteStage(): void {
  const prepared = prepareUpload(ENTRY, { name: "", label: "Pump", group: "electrical", svg: { kind: "text", text: VALID_SVG } });
  if (!prepared.ok) throw new Error(prepared.error);
  const { svgText, filename, fileSha256: _sha, ...fields } = prepared.body as Record<string, string>;
  const req = { headers: {}, body: fields, file: { originalname: filename as string, buffer: Buffer.from(svgText as string, "utf8") } };
  expect(bodyHash(uploadBodyOf(req))).toBe(bodyHash(prepared.body, ["svgText"]));
  expect(fields).toEqual({ name: "", label: "Pump", group: "electrical" });
}

/** An attached file whose name has a quote or a slash is refused: multer would hand the route another name. */
export function aFilenameThatMulterChangesIsRefused(): void {
  for (const filename of ['a"b.svg', "x/y.svg", "x\\y.svg"]) {
    expect(prepareUpload(ENTRY, { svg: { kind: "attachment", index: 1 } }, [{ filename, svgText: VALID_SVG }])).toEqual({
      ok: false,
      error: UPLOAD_BAD_FILENAME_ERROR,
    });
  }
}
