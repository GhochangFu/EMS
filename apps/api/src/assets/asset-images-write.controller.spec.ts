import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetImageDto, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { repoRoot } from "../testing/repo-root";
import { decoratorAt, methodBody } from "../testing/source-scan";
import { AssetImagesWriteController } from "./asset-images-write.controller";
import type { AssetImageUploadInput, AssetImagesWriteService } from "./asset-images-write.service";

/**
 * `F3.4` (ADR 0066 decision 7, Amendment 3 R-8/R-9) — a **source scan** of
 * `asset-images-write.controller.ts` plus a behavioural half over stubs.
 * Assertions live here; `asset-images-write.controller.test.ts` is the
 * Vitest entry point (§4.6/ADR 0014).
 *
 * Why a scan: `F4.20` records that esbuild emits no `design:paramtypes`, so
 * the module cannot be booted here to ask the router what it matched. What
 * the text proves, and what the two write routes' security rests on:
 *
 *  - both handlers call `canManageAsset` **before** `this.writes.`, and
 *    `upload` calls it **before** `requireFile(` as well (a 403 must not be
 *    reachable only after a 400 has told the caller whether a file arrived),
 *    with a positive control that the scan found both handlers;
 *  - the `FileInterceptor(` call expression carries decision 7's three
 *    limits as exact strings — `tests/f4.102-file-interceptor-limits.test.ts`
 *    holds only that `fileSize` is *named*, so `files: 1`, `fields: 2` and
 *    `fieldSize: 4096` are gated here or nowhere;
 *  - `@HttpCode(HttpStatus.NO_CONTENT)` precedes `async remove(` and
 *    `@HttpCode(HttpStatus.CREATED)` precedes `async upload(`;
 *  - no `@Param`/`@Query`/`@Body` argument is named `key` or `objectKey`
 *    (decision 4), with the positive control that `@Param("assetId")` was
 *    found.
 *
 * Every anchor goes through `decoratorAt`/`methodBody`, never a bare
 * `indexOf`, because the class docblock quotes the decorators too.
 *
 * The behavioural half constructs the controller by hand over an
 * `accessStub` and a call-recording `writesStub` (the
 * `asset-images.controller.spec.ts` shape), so "denied → 403 and the service
 * is never called" is measured rather than read, beside the positive
 * controls that an allowed call reaches the service with the mapped input.
 */
const CONTROLLER = join(repoRoot(), "apps/api/src/assets/asset-images-write.controller.ts");

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function source(): string {
  return readFileSync(CONTROLLER, "utf8");
}

/** `upload` runs from its `async upload(` to the delete route's decorator. */
function uploadBody(text: string): string {
  return methodBody(text, "async upload(", '@Delete(":imageId")');
}

/** `remove` is the last handler; its body runs to the end of the file (`requireFile` is a module-level function after the class). */
function removeBody(text: string): string {
  const from = text.indexOf("async remove(");
  assert(from > -1, "the controller must declare async remove(");
  return text.slice(from);
}

/** Position of the guard call and of the first service call inside one handler body. */
function guardAndServiceAt(body: string): { guard: number; service: number } {
  return { guard: body.indexOf("canManageAsset"), service: body.indexOf("this.writes.") };
}

// ---------------------------------------------------------------------------
// The guard runs before the service (and before requireFile), in both handlers
// ---------------------------------------------------------------------------

export function assertScanFindsBothHandlers(): void {
  const text = source();
  const upload = guardAndServiceAt(uploadBody(text));
  const remove = guardAndServiceAt(removeBody(text));
  assert(upload.guard > -1 && upload.service > -1, "upload must call canManageAsset and this.writes.");
  assert(remove.guard > -1 && remove.service > -1, "remove must call canManageAsset and this.writes.");
}

export function assertUploadChecksAccessBeforeTheService(): void {
  const { guard, service } = guardAndServiceAt(uploadBody(source()));
  assert(guard > -1 && service > -1, "the scan must find both calls in upload");
  assert(guard < service, `upload calls this.writes. (at ${service}) before canManageAsset (at ${guard})`);
}

export function assertUploadChecksAccessBeforeRequireFile(): void {
  const body = uploadBody(source());
  const guard = body.indexOf("canManageAsset");
  const file = body.indexOf("requireFile(");
  assert(guard > -1 && file > -1, "the scan must find canManageAsset and requireFile( in upload");
  assert(guard < file, `upload calls requireFile( (at ${file}) before canManageAsset (at ${guard})`);
}

export function assertRemoveChecksAccessBeforeTheService(): void {
  const { guard, service } = guardAndServiceAt(removeBody(source()));
  assert(guard > -1 && service > -1, "the scan must find both calls in remove");
  assert(guard < service, `remove calls this.writes. (at ${service}) before canManageAsset (at ${guard})`);
}

export function assertBothHandlersRefuseWithTheScopeMessage(): void {
  const text = source();
  const message = '"Asset is outside your access scope"';
  assert(uploadBody(text).includes(message), "upload must refuse with the asset-health 403 message");
  assert(removeBody(text).includes(message), "remove must refuse with the asset-health 403 message");
}

// ---------------------------------------------------------------------------
// Route declarations and status codes
// ---------------------------------------------------------------------------

export function assertPostRouteIsDeclaredAtALineStart(): void {
  assert(decoratorAt(source(), "@Post()") > -1, "the upload route decorator @Post() is missing");
}

export function assertDeleteRouteIsDeclaredAtALineStart(): void {
  assert(decoratorAt(source(), '@Delete(":imageId")') > -1, "the delete route decorator is missing");
}

export function assertControllerIsGuardedByJwt(): void {
  const text = source();
  assert(decoratorAt(text, "@UseGuards(JwtAuthGuard)") > -1, "the controller must carry @UseGuards(JwtAuthGuard)");
  assert(decoratorAt(text, '@Controller("assets/:assetId/images")') > -1, "the route prefix is wrong");
}

/** `@HttpCode(HttpStatus.CREATED)` sits at a line start before `async upload(`. */
export function assertCreatedPrecedesUpload(): void {
  const text = source();
  const code = decoratorAt(text, "@HttpCode(HttpStatus.CREATED)");
  const handler = text.indexOf("async upload(");
  assert(code > -1 && handler > -1, "the scan must find @HttpCode(HttpStatus.CREATED) and async upload(");
  assert(code < handler, `@HttpCode(HttpStatus.CREATED) (at ${code}) must precede async upload( (at ${handler})`);
}

/** `@HttpCode(HttpStatus.NO_CONTENT)` sits at a line start before `async remove(`, and after `async upload(` (so it decorates remove, not upload). */
export function assertNoContentPrecedesRemove(): void {
  const text = source();
  const code = decoratorAt(text, "@HttpCode(HttpStatus.NO_CONTENT)");
  const upload = text.indexOf("async upload(");
  const remove = text.indexOf("async remove(");
  assert(code > -1 && upload > -1 && remove > -1, "the scan must find @HttpCode(HttpStatus.NO_CONTENT), async upload( and async remove(");
  assert(
    upload < code && code < remove,
    `@HttpCode(HttpStatus.NO_CONTENT) (at ${code}) must sit between async upload( (at ${upload}) and async remove( (at ${remove})`,
  );
}

// ---------------------------------------------------------------------------
// Decision 7's interceptor limits, as exact strings inside the call expression
// ---------------------------------------------------------------------------

const INTERCEPTOR_CALL = /\bFileInterceptor\s*\(/g;

/**
 * From the `(` after `FileInterceptor` to its matching `)`, by depth counting
 * (the f4.102 scan's shape), anchored at the `@UseInterceptors(` decorator at
 * a line start — a docblock that spelled the call would otherwise be read
 * first, and its parentheses are prose.
 */
function fileInterceptorCall(text: string): string {
  const decorator = decoratorAt(text, "@UseInterceptors(");
  assert(decorator > -1, "the controller must declare @UseInterceptors( at a line start");
  const rest = text.slice(decorator);
  const rel = rest.search(INTERCEPTOR_CALL);
  assert(rel > -1, "@UseInterceptors( must be followed by a FileInterceptor call");
  const open = text.indexOf("(", decorator + rel);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error("the FileInterceptor( call never closes");
}

export const INTERCEPTOR_LIMITS: readonly string[] = [
  "fileSize: MAX_ASSET_IMAGE_BYTES",
  "files: 1",
  "fields: 2",
  // Multer's default is 1 MB per field, so `fields: 2` alone bounded the
  // count and not the bytes. Nothing else in the repository holds this.
  "fieldSize: 4096",
];

/** The positive control for the three rows below: the call expression was found and names `limits:`. */
export function assertFileInterceptorCallDeclaresLimits(): void {
  const call = fileInterceptorCall(source());
  assert(/limits\s*:/.test(call), `FileInterceptor( must pass a limits object, got ${call}`);
}

export function assertFileInterceptorLimit(literal: string): void {
  const call = fileInterceptorCall(source());
  assert(call.includes(literal), `FileInterceptor( must carry ${literal} inline, got ${call.replace(/\s+/g, " ")}`);
}

/**
 * The f4.102 scan walks **every** `FileInterceptor(`-shaped occurrence in the
 * file, docblock mentions included, and depth-counts from each. A prose
 * mention with an unbalanced parenthesis swallows the real call and passes
 * by accident (measured 2026-09-16 while this spec was written). Exactly one
 * occurrence means the gate reads the call and nothing else.
 */
export function assertFileInterceptorIsSpelledOnceAsACall(): void {
  const occurrences = [...source().matchAll(INTERCEPTOR_CALL)].length;
  assert(occurrences === 1, `expected exactly one FileInterceptor( occurrence in the file, found ${occurrences}`);
}

export function assertFileInterceptorFieldIsFile(): void {
  assert(/\bFileInterceptor\s*\(\s*"file"/.test(source()), 'FileInterceptor must read the "file" field');
}

// ---------------------------------------------------------------------------
// Decision 4: no client-supplied key
// ---------------------------------------------------------------------------

const KEY_ARGUMENT = /@(?:Param|Query|Body)\(\s*"(?:key|objectKey)"\s*\)/;

export function assertNoHandlerArgumentIsNamedKey(): void {
  assert(!KEY_ARGUMENT.test(source()), "no @Param/@Query/@Body may be named key or objectKey");
}

/** The positive control for the negative above: the same regex shape does find `assetId`. */
export function assertScanFindsTheAssetIdParam(): void {
  assert(/@Param\(\s*"assetId"\s*\)/.test(source()), '@Param("assetId") must be declared on upload');
}

// ---------------------------------------------------------------------------
// Behavioural: the guard refuses before the service, over stubs
// ---------------------------------------------------------------------------

const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "admin" };
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const IMAGE_ID = "33333333-3333-4333-8333-333333333333";

type StubFile = { buffer: Buffer; mimetype: string; originalname: string };

const FILE: StubFile = { buffer: Buffer.from("png-bytes"), mimetype: "image/png", originalname: "pump.png" };

const ROW: AssetImageDto = {
  id: IMAGE_ID,
  assetId: ASSET_ID,
  contentType: "image/png",
  byteSize: FILE.buffer.length,
  sha256: "a".repeat(64),
  originalFilename: FILE.originalname,
  caption: null,
  createdBy: null,
  createdAt: "2026-09-16T10:00:00.000Z",
};

function accessStub(opts: { canManageAsset: boolean }) {
  const canManageAssetCalls: string[] = [];
  const access = {
    canManageAsset: async (_user: JwtPayload, assetId: string) => {
      canManageAssetCalls.push(assetId);
      return opts.canManageAsset;
    },
  } as unknown as AccessControlService;
  return { access, canManageAssetCalls };
}

/** Records every call and every upload input, so a test can assert a write did NOT happen and what one received. */
function writesStub() {
  const calls: string[] = [];
  const uploads: AssetImageUploadInput[] = [];
  const writes = {
    upload: async (_jwt: JwtPayload, assetId: string, input: AssetImageUploadInput) => {
      calls.push(`upload ${assetId}`);
      uploads.push(input);
      return ROW;
    },
    remove: async (_jwt: JwtPayload, assetId: string, imageId: string) => {
      calls.push(`remove ${assetId} ${imageId}`);
    },
  } as unknown as AssetImagesWriteService;
  return { writes, calls, uploads };
}

function build(opts: { canManageAsset: boolean }) {
  const access = accessStub(opts);
  const stub = writesStub();
  const controller = new AssetImagesWriteController(stub.writes, access.access);
  return { controller, ...stub, canManageAssetCalls: access.canManageAssetCalls };
}

async function rejects(run: () => Promise<unknown>): Promise<unknown> {
  let rejected = false;
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    rejected = true;
    caught = err;
  }
  assert(rejected, "expected the call to reject, and it resolved");
  return caught;
}

function errorName(err: unknown): string {
  return typeof err === "object" && err !== null ? String((err as { name?: unknown }).name) : String(err);
}

export const HANDLERS = ["upload", "remove"] as const;

async function runDenied(handler: (typeof HANDLERS)[number]) {
  const { controller, calls } = build({ canManageAsset: false });
  const err = await rejects(() =>
    handler === "upload"
      ? controller.upload(USER, ASSET_ID, FILE, { caption: "x" })
      : controller.remove(USER, { assetId: ASSET_ID, imageId: IMAGE_ID }),
  );
  return { err, calls };
}

export async function assertDeniedHandlerThrowsForbidden(handler: (typeof HANDLERS)[number]): Promise<void> {
  const { err } = await runDenied(handler);
  assert(errorName(err) === "ForbiddenException", `${handler} on a denied asset threw ${errorName(err)}`);
}

export async function assertDeniedHandlerNeverCallsTheService(handler: (typeof HANDLERS)[number]): Promise<void> {
  const { calls } = await runDenied(handler);
  assert(calls.length === 0, `${handler} on a denied asset reached the service: ${calls.join(", ")}`);
}

/** The behavioural twin of the ordering scan: denied AND no file is a 403, not the 400 requireFile would give. */
export async function assertDeniedUploadRefusesBeforeRequireFile(): Promise<void> {
  const { controller } = build({ canManageAsset: false });
  const err = await rejects(() => controller.upload(USER, ASSET_ID, undefined, undefined));
  assert(
    errorName(err) === "ForbiddenException",
    `a denied upload without a file must be a ForbiddenException, got ${errorName(err)}`,
  );
}

/** A non-uuid segment is the filter's 400 before the guard ever runs (no pool is touched). */
export async function assertNonUuidAssetIdRejectsBeforeTheGuard(): Promise<void> {
  const { controller, canManageAssetCalls, calls } = build({ canManageAsset: true });
  const err = await rejects(() => controller.upload(USER, "not-a-uuid", FILE, undefined));
  assert(errorName(err) === "ZodError", `a non-uuid assetId must escape as ZodError, got ${errorName(err)}`);
  assert(
    canManageAssetCalls.length === 0 && calls.length === 0,
    `the guard (${canManageAssetCalls.length} calls) and the service (${calls.length} calls) must not run on a non-uuid assetId`,
  );
}

async function runAllowedUpload(file: StubFile | undefined, body: unknown) {
  const { controller, calls, uploads } = build({ canManageAsset: true });
  const dto = await controller.upload(USER, ASSET_ID, file, body);
  return { dto, calls, uploads };
}

/** The positive control: allowed, upload reaches the service exactly once and returns its DTO. */
export async function assertAllowedUploadCallsTheServiceOnce(): Promise<void> {
  const { dto, calls } = await runAllowedUpload(FILE, { caption: "Pump room" });
  assert(
    calls.length === 1 && calls[0] === `upload ${ASSET_ID}` && dto === ROW,
    `expected one upload call returning the service's DTO, got calls ${calls.join(", ")}`,
  );
}

export async function assertAllowedUploadPassesTheMimetypeAsDeclaredType(): Promise<void> {
  const { uploads } = await runAllowedUpload(FILE, { caption: "Pump room" });
  assert(uploads[0]?.declaredType === FILE.mimetype, `declaredType must be file.mimetype, got ${uploads[0]?.declaredType}`);
}

export async function assertAllowedUploadPassesTheBufferAndFilename(): Promise<void> {
  const { uploads } = await runAllowedUpload(FILE, { caption: "Pump room" });
  assert(uploads[0]?.buffer === FILE.buffer, "the service must receive file.buffer itself");
  assert(
    uploads[0]?.originalFilename === FILE.originalname,
    `originalFilename must be file.originalname, got ${uploads[0]?.originalFilename}`,
  );
}

/** The positive control for the two null-caption rows: a real caption reaches the service unchanged. */
export async function assertAllowedUploadPassesANonEmptyCaption(): Promise<void> {
  const { uploads } = await runAllowedUpload(FILE, { caption: "Pump room" });
  assert(uploads[0]?.caption === "Pump room", `a caption must reach the service, got ${String(uploads[0]?.caption)}`);
}

export async function assertBlankCaptionBecomesNull(): Promise<void> {
  const { uploads } = await runAllowedUpload(FILE, { caption: "" });
  assert(uploads[0]?.caption === null, `caption "" must reach the service as null, got ${String(uploads[0]?.caption)}`);
}

/** multer gives `@Body()` `undefined` when the form has no non-file field at all. */
export async function assertAbsentBodyBecomesNullCaption(): Promise<void> {
  const { uploads } = await runAllowedUpload(FILE, undefined);
  assert(uploads[0]?.caption === null, `an absent body must reach the service as caption null, got ${String(uploads[0]?.caption)}`);
}

export async function assertMissingFileIsBadRequest(): Promise<void> {
  const { controller } = build({ canManageAsset: true });
  const err = await rejects(() => controller.upload(USER, ASSET_ID, undefined, undefined));
  assert(errorName(err) === "BadRequestException", `a missing file must be a BadRequestException, got ${errorName(err)}`);
  assert(
    String((err as { message?: unknown }).message) === "Image file is required",
    `the 400 must say "Image file is required", got ${String((err as { message?: unknown }).message)}`,
  );
}

export async function assertMissingFileNeverCallsTheService(): Promise<void> {
  const { controller, calls } = build({ canManageAsset: true });
  await rejects(() => controller.upload(USER, ASSET_ID, undefined, undefined));
  assert(calls.length === 0, `a missing file reached the service: ${calls.join(", ")}`);
}

export async function assertEmptyFileIsBadRequest(): Promise<void> {
  const { controller, calls } = build({ canManageAsset: true });
  const err = await rejects(() => controller.upload(USER, ASSET_ID, { ...FILE, buffer: Buffer.alloc(0) }, undefined));
  assert(errorName(err) === "BadRequestException", `an empty file must be a BadRequestException, got ${errorName(err)}`);
  assert(calls.length === 0, `an empty file reached the service: ${calls.join(", ")}`);
}

/** A 1001-char caption: the ZodError escapes for the global filter to turn into a 400, and the service never runs. */
export async function assertOverlongCaptionEscapesAsZodError(): Promise<void> {
  const { controller, calls } = build({ canManageAsset: true });
  const err = await rejects(() => controller.upload(USER, ASSET_ID, FILE, { caption: "c".repeat(1001) }));
  assert(errorName(err) === "ZodError", `a 1001-char caption must escape as ZodError, got ${errorName(err)}`);
  assert(calls.length === 0, `an overlong caption reached the service: ${calls.join(", ")}`);
}

/** A 256-char filename: the same, through `assetImageFilenameSchema`. */
export async function assertOverlongFilenameEscapesAsZodError(): Promise<void> {
  const { controller, calls } = build({ canManageAsset: true });
  const err = await rejects(() =>
    controller.upload(USER, ASSET_ID, { ...FILE, originalname: "f".repeat(256) }, undefined),
  );
  assert(errorName(err) === "ZodError", `a 256-char filename must escape as ZodError, got ${errorName(err)}`);
  assert(calls.length === 0, `an overlong filename reached the service: ${calls.join(", ")}`);
}

/** An unknown non-file field is refused by the strict schema, before the service. */
export async function assertUnknownFieldEscapesAsZodError(): Promise<void> {
  const { controller, calls } = build({ canManageAsset: true });
  const err = await rejects(() => controller.upload(USER, ASSET_ID, FILE, { caption: "x", objectKey: "not-a-field" }));
  assert(errorName(err) === "ZodError", `an unknown field must escape as ZodError, got ${errorName(err)}`);
  assert(calls.length === 0, `an unknown field reached the service: ${calls.join(", ")}`);
}

/** The positive control for remove: allowed, the service receives both ids once. */
export async function assertAllowedRemoveCallsTheServiceWithBothIds(): Promise<void> {
  const { controller, calls } = build({ canManageAsset: true });
  await controller.remove(USER, { assetId: ASSET_ID, imageId: IMAGE_ID });
  assert(
    calls.length === 1 && calls[0] === `remove ${ASSET_ID} ${IMAGE_ID}`,
    `expected one remove call with both ids, got ${calls.join(", ")}`,
  );
}

export async function assertRemoveWithANonUuidImageIdRejectsBeforeTheGuard(): Promise<void> {
  const { controller, canManageAssetCalls, calls } = build({ canManageAsset: true });
  const err = await rejects(() => controller.remove(USER, { assetId: ASSET_ID, imageId: "not-a-uuid" }));
  assert(errorName(err) === "ZodError", `a non-uuid imageId must escape as ZodError, got ${errorName(err)}`);
  assert(
    canManageAssetCalls.length === 0 && calls.length === 0,
    `the guard (${canManageAssetCalls.length} calls) and the service (${calls.length} calls) must not run on a non-uuid imageId`,
  );
}
