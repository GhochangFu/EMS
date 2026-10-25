import { createHash } from "node:crypto";

import { expect } from "vitest";

import { bodyHash } from "./body-hash";
import { catalogEntry } from "@bms/shared/copilot";

import { uploadBodyOf, uploadFieldsFor } from "./copilot-upload-change.interceptor";
import {
  type FileUploadAttachment,
  prepareFileUpload,
  prepareUpload,
  UPLOAD_NEEDS_FILE_ERROR,
  uploadWrongTypeError,
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

const ENTRY = { upload: { fileField: "file", kind: "svg", accepts: ["image/svg+xml"], maxBytes: 65_536 } } as const;
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

/** `F4.283` (Amendment 8 Q19): the attached files of a turn, as the inspection hands them. */
const CSV_BYTES = Buffer.from("asset_code,point_key,value,time\nPUMP-1,kw,1,2026-10-20T09:00:00Z\n", "utf8");
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const attached = (index: number, filename: string, mediaType: FileUploadAttachment["mediaType"], data: Buffer): FileUploadAttachment => ({
  index,
  filename,
  mediaType,
  byteSize: data.byteLength,
  sha256: createHash("sha256").update(data).digest("hex"),
  data,
});
const CSV_FILE = attached(1, "readings.csv", "text/csv", CSV_BYTES);
const PNG_FILE = attached(1, "panel.png", "image/png", PNG_BYTES);

function entryOf(id: string) {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(id);
  return entry;
}

/** A CSV at index 1: the options, `"reject"` written explicitly (Q21), the file's name and SHA-256. */
export function aCsvImportStoresItsNameAndHash(): void {
  const prepared = prepareFileUpload(entryOf("telemetry.import"), { sourceKind: "manual", file: { kind: "attachment", index: 1 } }, [CSV_FILE]);
  expect(prepared.ok ? prepared.body : prepared.error).toEqual({
    sourceKind: "manual",
    conflictPolicy: "reject",
    filename: "readings.csv",
    fileSha256: CSV_FILE.sha256,
  });
}

/** A4 "nothing is stored": no stored value is a Buffer or longer than 256 characters. Mutation: store `data` → red. */
export function aPreparedImportStoresNoBytes(): void {
  const prepared = prepareFileUpload(entryOf("telemetry.import"), { file: { kind: "attachment", index: 1 } }, [CSV_FILE]);
  if (!prepared.ok) throw new Error(prepared.error);
  const heavy = Object.entries(prepared.body).filter(([, value]) => Buffer.isBuffer(value) || String(value).length > 256);
  expect(heavy).toEqual([]);
}

/** Index 2 with one file — and a follow-up turn, which carries none — is the attach sentence. */
export function aMissingFileIsTheAttachSentence(): void {
  const model = { file: { kind: "attachment", index: 2 } };
  expect([
    prepareFileUpload(entryOf("telemetry.import"), model, [CSV_FILE]),
    prepareFileUpload(entryOf("telemetry.import"), { file: { kind: "attachment", index: 1 } }, undefined),
  ]).toEqual([
    { ok: false, error: UPLOAD_NEEDS_FILE_ERROR },
    { ok: false, error: UPLOAD_NEEDS_FILE_ERROR },
  ]);
}

/** A file of a type the entry does not take is the type sentence. Mutation: drop the `accepts` check → red. */
export function aPdfForTheImportIsTheTypeSentence(): void {
  const pdf = attached(1, "spec.pdf", "application/pdf", Buffer.from("%PDF-1.7"));
  const prepared = prepareFileUpload(entryOf("telemetry.import"), { file: { kind: "attachment", index: 1 } }, [pdf]);
  expect(prepared).toEqual({ ok: false, error: uploadWrongTypeError(entryOf("telemetry.import").upload?.accepts ?? []) });
}

/** A PNG for the asset image: its caption, the file's name and SHA-256 — and no `conflictPolicy`. */
export function aPngImageStoresItsCaptionNameAndHash(): void {
  const prepared = prepareFileUpload(entryOf("assetImage.upload"), { caption: "Front", file: { kind: "attachment", index: 1 } }, [PNG_FILE]);
  expect(prepared.ok ? prepared.body : prepared.error).toEqual({ caption: "Front", filename: "panel.png", fileSha256: PNG_FILE.sha256 });
}

/** The round trip: the stored body, sent as the browser sends it and read as multer hands it, hashes the same. */
export function aPreparedImportRoundTripsThroughTheRouteStage(): void {
  const prepared = prepareFileUpload(entryOf("telemetry.import"), { sourceKind: "manual", file: { kind: "attachment", index: 1 } }, [CSV_FILE]);
  if (!prepared.ok) throw new Error(prepared.error);
  const req = { headers: {}, body: { sourceKind: "manual", conflictPolicy: "reject" }, file: { originalname: "readings.csv", buffer: CSV_BYTES } };
  expect(bodyHash(uploadBodyOf(req, uploadFieldsFor("telemetry.import")))).toBe(bodyHash(prepared.body, ["preview"]));
}
