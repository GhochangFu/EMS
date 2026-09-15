import { Logger } from "@nestjs/common";
import type { Response } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { vi } from "vitest";

import type { AssetImageDto, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { repoRoot } from "../testing/repo-root";
import { decoratorAt, methodBody } from "../testing/source-scan";
import { AssetImagesController } from "./asset-images.controller";
import type { AssetImagesService } from "./asset-images.service";

/**
 * `F3.3` (ADR 0066 decisions 4, 6) — a **source scan** of
 * `asset-images.controller.ts`. Assertions live here;
 * `asset-images.controller.test.ts` is the Vitest entry point (§4.6/ADR 0014).
 *
 * Why a scan and not an instance: `F4.20` records that esbuild emits no
 * `design:paramtypes`, so a Nest module cannot be booted here to ask the
 * router what it matched, and a hand-built controller would need a fake
 * `express.Response` that proves nothing about header order. What the text
 * *can* prove, and what the two routes' security rests on:
 *
 *  - both handlers call `canReadAsset` **before** `this.images.` (a guard that
 *    throws after the read has already read — the `asset-health.controller.ts`
 *    rule), with a positive control that the scan found both handlers;
 *  - the content handler takes `@Res()` (it streams, the `audit.controller.ts`
 *    precedent) and sets decision 6's four headers plus `nosniff` with these
 *    exact strings, plus `Content-Length` from the row, **every one before**
 *    the `pipeline(body, res, …)` call, and never `body.pipe(res)`;
 *  - no `@Param`/`@Query`/`@Body` argument is named `key` or `objectKey`
 *    (decision 4: a key is never accepted from a client), with the positive
 *    control that `@Param("assetId")` was found.
 *
 * Every anchor goes through `decoratorAt`/`methodBody`, never a bare
 * `indexOf`, because the class docblock quotes the decorators too.
 *
 * **And a behavioural half** (review finding, 2026-09-15), beside the scans:
 * the controller is constructed by hand over an `accessStub` and a
 * call-recording `imagesStub` (the `asset-health.controller.spec.ts` shape),
 * so "denied → 403 and the service is never called" is measured rather than
 * read, with the positive control that an allowed call reaches the service
 * once and the bytes reach a `Writable` standing in for `express.Response`.
 */
const CONTROLLER = join(repoRoot(), "apps/api/src/assets/asset-images.controller.ts");

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function source(): string {
  return readFileSync(CONTROLLER, "utf8");
}

/** `list` runs from its `async list(` to the content route's decorator. */
function listBody(text: string): string {
  return methodBody(text, "async list(", '@Get(":imageId/content")');
}

/** `content` is the last handler, so its body runs to the end of the file. */
function contentBody(text: string): string {
  const from = text.indexOf("async content(");
  assert(from > -1, "the controller must declare async content(");
  return text.slice(from);
}

/** Position of the guard call and of the first service call inside one handler body. */
function guardAndServiceAt(body: string): { guard: number; service: number } {
  return { guard: body.indexOf("canReadAsset"), service: body.indexOf("this.images.") };
}

// ---------------------------------------------------------------------------
// The guard runs before the service, in both handlers
// ---------------------------------------------------------------------------

export function assertScanFindsBothHandlers(): void {
  const text = source();
  const list = guardAndServiceAt(listBody(text));
  const content = guardAndServiceAt(contentBody(text));
  assert(list.guard > -1 && list.service > -1, "list must call canReadAsset and this.images.");
  assert(
    content.guard > -1 && content.service > -1,
    "content must call canReadAsset and this.images.",
  );
}

export function assertListChecksAccessBeforeTheService(): void {
  const { guard, service } = guardAndServiceAt(listBody(source()));
  assert(guard > -1 && service > -1, "the scan must find both calls in list");
  assert(guard < service, `list calls this.images. (at ${service}) before canReadAsset (at ${guard})`);
}

export function assertContentChecksAccessBeforeTheService(): void {
  const { guard, service } = guardAndServiceAt(contentBody(source()));
  assert(guard > -1 && service > -1, "the scan must find both calls in content");
  assert(
    guard < service,
    `content calls this.images. (at ${service}) before canReadAsset (at ${guard})`,
  );
}

export function assertBothHandlersRefuseWithTheScopeMessage(): void {
  const text = source();
  const message = '"Asset is outside your access scope"';
  assert(listBody(text).includes(message), "list must refuse with the asset-health 403 message");
  assert(contentBody(text).includes(message), "content must refuse with the asset-health 403 message");
}

// ---------------------------------------------------------------------------
// Streaming and decision 6's headers
// ---------------------------------------------------------------------------

export function assertContentRouteIsDeclaredAtALineStart(): void {
  assert(decoratorAt(source(), '@Get(":imageId/content")') > -1, "the content route decorator is missing");
}

export function assertContentHandlerTakesRes(): void {
  assert(contentBody(source()).includes("@Res()"), "content must declare @Res() to stream the body");
}

export function assertListHandlerDoesNotTakeRes(): void {
  assert(!listBody(source()).includes("@Res()"), "list must let Nest serialise its JSON body");
}

/**
 * Decision 6's four headers plus `X-Content-Type-Options: nosniff` (review
 * finding, 2026-09-15 — a browser must not sniff a stored image into a
 * script), each its own claim so the failing one is named.
 */
export const DECISION_6_HEADERS: readonly string[] = [
  'res.setHeader("Content-Type", row.contentType)',
  'res.setHeader("ETag", `"${row.sha256}"`)',
  'res.setHeader("Cache-Control", "private, max-age=0, must-revalidate")',
  'res.setHeader("Content-Disposition", "inline")',
  'res.setHeader("X-Content-Type-Options", "nosniff")',
];

export function assertContentSetsHeader(literal: string): void {
  assert(contentBody(source()).includes(literal), `content must set ${literal}`);
}

export function assertContentSetsContentLengthFromTheRow(): void {
  assert(
    contentBody(source()).includes('res.setHeader("Content-Length", String(row.byteSize))'),
    "content must set Content-Length from the row's byteSize",
  );
}

const PIPELINE_CALL = "pipeline(body, res,";

/**
 * `pipeline`, not `body.pipe(res)`: `pipe` never destroys the source when the
 * destination goes away, so a client that disconnects mid-download left the
 * object stream's socket open. `pipeline` tears down both ends on either
 * side's failure.
 */
export function assertContentPipelinesTheBodyToRes(): void {
  const body = contentBody(source());
  assert(body.includes(PIPELINE_CALL), `content must call ${PIPELINE_CALL} …) from node:stream`);
  assert(!body.includes("body.pipe(res)"), "content must not use body.pipe(res) — pipe leaks the source on a client abort");
}

/** Every header precedes the pipeline call — a header set after the first chunk is a throw. */
export function assertContentSetsEveryHeaderBeforeThePipeline(): void {
  const body = contentBody(source());
  const lastHeader = body.lastIndexOf("res.setHeader(");
  const pipelineAt = body.indexOf(PIPELINE_CALL);
  assert(lastHeader > -1 && pipelineAt > -1, "the scan must find both a setHeader call and the pipeline call");
  assert(
    lastHeader < pipelineAt,
    `content sets a header (at ${lastHeader}) after the pipeline call (at ${pipelineAt})`,
  );
}

export function assertContentWarnsInThePipelineCallback(): void {
  const body = contentBody(source());
  assert(body.includes(`${PIPELINE_CALL} (err)`), "content must pass pipeline a callback taking err");
  assert(
    /this\.logger\.warn\(\s*`asset image \$\{imageId\}/.test(body),
    "the pipeline callback must warn naming the image id",
  );
}

// ---------------------------------------------------------------------------
// Behavioural: the guard refuses before the service, over stubs
// (the asset-health.controller.spec.ts shape — no Nest DI needed)
// ---------------------------------------------------------------------------

const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const IMAGE_ID = "33333333-3333-4333-8333-333333333333";
const BYTES = Buffer.from("png-bytes");

const ROW: AssetImageDto = {
  id: IMAGE_ID,
  assetId: ASSET_ID,
  contentType: "image/png",
  byteSize: BYTES.length,
  sha256: "a".repeat(64),
  originalFilename: "pump.png",
  caption: null,
  createdBy: null,
  createdAt: "2026-09-15T10:00:00.000Z",
};

function accessStub(opts: { canReadAsset: boolean }) {
  const canReadAssetCalls: string[] = [];
  const access = {
    canReadAsset: async (_user: JwtPayload, assetId: string) => {
      canReadAssetCalls.push(assetId);
      return opts.canReadAsset;
    },
  } as unknown as AccessControlService;
  return { access, canReadAssetCalls };
}

/** Records every call so a test can assert a read did NOT happen, not only that it threw. */
function imagesStub(body: () => Readable) {
  const calls: string[] = [];
  const images = {
    list: async (assetId: string) => {
      calls.push(`list ${assetId}`);
      return [ROW];
    },
    content: async (assetId: string, imageId: string) => {
      calls.push(`content ${assetId} ${imageId}`);
      return { row: ROW, body: body() };
    },
  } as unknown as AssetImagesService;
  return { images, calls };
}

/** A `Writable` that records headers and bytes; `pipeline` ends or destroys it like a real response. */
function responseFake() {
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  Object.assign(res, {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  });
  return { res: res as unknown as Response, stream: res, headers, chunks };
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

async function capturingWarns<T>(fn: () => Promise<T>): Promise<{ result: T; warns: string[] }> {
  const warns: string[] = [];
  const spy = vi.spyOn(Logger.prototype, "warn").mockImplementation((message: unknown) => {
    warns.push(String(message));
  });
  try {
    return { result: await fn(), warns };
  } finally {
    spy.mockRestore();
  }
}

export const HANDLERS = ["list", "content"] as const;

async function runDenied(handler: (typeof HANDLERS)[number]) {
  const { access } = accessStub({ canReadAsset: false });
  const { images, calls } = imagesStub(() => Readable.from([BYTES]));
  const controller = new AssetImagesController(images, access);
  const { res } = responseFake();
  const err = await rejects(() =>
    handler === "list"
      ? controller.list(USER, ASSET_ID)
      : controller.content(USER, { assetId: ASSET_ID, imageId: IMAGE_ID }, res),
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

/** The positive control: allowed, list reaches the service exactly once. */
export async function assertAllowedListCallsTheServiceOnce(): Promise<void> {
  const { access } = accessStub({ canReadAsset: true });
  const { images, calls } = imagesStub(() => Readable.from([BYTES]));
  const controller = new AssetImagesController(images, access);
  const dtos = await controller.list(USER, ASSET_ID);
  assert(
    calls.length === 1 && calls[0] === `list ${ASSET_ID}` && dtos.length === 1,
    `expected one list call and one DTO, got calls ${calls.join(", ")} and ${dtos.length} DTOs`,
  );
}

async function runAllowedContent(body: () => Readable) {
  const { access } = accessStub({ canReadAsset: true });
  const { images, calls } = imagesStub(body);
  const controller = new AssetImagesController(images, access);
  const fake = responseFake();
  const { warns } = await capturingWarns(async () => {
    await controller.content(USER, { assetId: ASSET_ID, imageId: IMAGE_ID }, fake.res);
    // `pipeline` settles the response asynchronously; `finish` is the whole
    // body written, `close` is a teardown (which also emits `error` on the
    // fake, so it needs a listener or Node throws). Whichever comes, then
    // one more tick so the pipeline callback has run.
    fake.stream.on("error", () => undefined);
    await new Promise<void>((resolve) => {
      fake.stream.once("finish", resolve);
      fake.stream.once("close", resolve);
    });
    await new Promise((resolve) => setImmediate(resolve));
  });
  return { calls, warns, headers: fake.headers, bytes: Buffer.concat(fake.chunks) };
}

/** The positive control for content: allowed, the service is called once and the bytes reach the response. */
export async function assertAllowedContentCallsTheServiceOnceAndStreamsTheBytes(): Promise<void> {
  const run = await runAllowedContent(() => Readable.from([BYTES]));
  assert(run.calls.length === 1, `expected one content call, got ${run.calls.join(", ")}`);
  assert(run.bytes.equals(BYTES), `the response must receive the object's bytes, got ${run.bytes.length} bytes`);
  assert(run.warns.length === 0, `the happy path must not warn: ${run.warns.join(" | ")}`);
}

/** The header the row's `content_type` cannot be sniffed away from, on the wire and not only in the scan. */
export async function assertAllowedContentSendsNosniff(): Promise<void> {
  const run = await runAllowedContent(() => Readable.from([BYTES]));
  assert(
    run.headers["X-Content-Type-Options"] === "nosniff",
    `expected X-Content-Type-Options: nosniff, got ${JSON.stringify(run.headers)}`,
  );
}

/** A body that fails after the headers are set: one warn naming the image id, and never a throw. */
export async function assertABodyErrorAfterHeadersWarnsWithTheImageId(): Promise<void> {
  const run = await runAllowedContent(
    () =>
      new Readable({
        read() {
          this.destroy(new Error("fake transport failure"));
        },
      }),
  );
  assert(run.warns.length === 1, `expected one warn, saw ${run.warns.length}: ${run.warns.join(" | ")}`);
  assert(run.warns[0]?.includes(IMAGE_ID) === true, `the warn must name the image id: ${run.warns[0]}`);
  assert(!run.warns[0]?.includes("fake transport failure"), `the warn must not carry err.message (§9.6): ${run.warns[0]}`);
}

/**
 * Post-merge sweep (2026-09-15), defence in depth beside the service's
 * whole-DTO parse: anything that throws between `content()` returning and
 * `pipeline()` starting — `res.setHeader` on a header value Node refuses
 * (`ERR_INVALID_CHAR`) is the measured case — must destroy the body before
 * the error propagates, or the MinIO socket stays open until the SDK times
 * it out. The fake's `setHeader` throws on the first call; the body is a
 * `Readable` whose `destroyed` flag is the assertion.
 */
export async function assertAHeaderThrowDestroysTheBodyAndPropagates(): Promise<void> {
  const { access } = accessStub({ canReadAsset: true });
  const body = Readable.from([BYTES]);
  const { images } = imagesStub(() => body);
  const controller = new AssetImagesController(images, access);
  const fake = responseFake();
  const headerError = new TypeError("fake ERR_INVALID_CHAR");
  Object.assign(fake.res, {
    setHeader: () => {
      throw headerError;
    },
  });
  const err = await rejects(() =>
    controller.content(USER, { assetId: ASSET_ID, imageId: IMAGE_ID }, fake.res),
  );
  assert(err === headerError, `the header error must propagate unchanged, got ${errorName(err)}`);
  assert(body.destroyed, "the object body was left open after res.setHeader threw");
}

export function assertControllerDoesNotHandleIfNoneMatch(): void {
  assert(!source().includes("if-none-match"), "If-None-Match is a possible F3.4 follow-up, not F3.3");
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
  assert(/@Param\(\s*"assetId"\s*\)/.test(source()), '@Param("assetId") must be declared on list');
}

export function assertControllerIsGuardedByJwt(): void {
  const text = source();
  assert(decoratorAt(text, "@UseGuards(JwtAuthGuard)") > -1, "the controller must carry @UseGuards(JwtAuthGuard)");
  assert(decoratorAt(text, '@Controller("assets/:assetId/images")') > -1, "the route prefix is wrong");
}
