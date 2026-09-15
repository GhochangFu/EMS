import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "../testing/repo-root";
import { decoratorAt, methodBody } from "../testing/source-scan";

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
 *    precedent) and sets decision 6's four headers with these exact strings,
 *    plus `Content-Length` from the row;
 *  - no `@Param`/`@Query`/`@Body` argument is named `key` or `objectKey`
 *    (decision 4: a key is never accepted from a client), with the positive
 *    control that `@Param("assetId")` was found.
 *
 * Every anchor goes through `decoratorAt`/`methodBody`, never a bare
 * `indexOf`, because the class docblock quotes the decorators too.
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

/** Decision 6's headers, each its own claim so the failing one is named. */
export const DECISION_6_HEADERS: readonly string[] = [
  'res.setHeader("Content-Type", row.contentType)',
  'res.setHeader("ETag", `"${row.sha256}"`)',
  'res.setHeader("Cache-Control", "private, max-age=0, must-revalidate")',
  'res.setHeader("Content-Disposition", "inline")',
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

export function assertContentPipesTheBody(): void {
  assert(contentBody(source()).includes("body.pipe(res)"), "content must pipe the object body to res");
}

export function assertContentDestroysTheResponseOnAStreamError(): void {
  const body = contentBody(source());
  assert(body.includes('body.on("error"'), "content must subscribe to the body's error event");
  assert(body.includes("res.destroy()"), "content must destroy the response on a stream error");
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
