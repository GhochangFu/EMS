import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import type { Response } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { vi } from "vitest";

import type { JwtPayload, ReportFileDto } from "@bms/shared";

import { REQUEST_SCHEMAS } from "../openapi/openapi-registry";
import { repoRoot } from "../testing/repo-root";
import { decoratorAt, methodBody } from "../testing/source-scan";
import { ReportFilesController } from "./report-files.controller";
import type { ReportFilesService } from "./report-files.service";

/**
 * `F3.5a` (ADR 0071 decision 11; Amendment 1) — `report-files.controller.ts`,
 * in two halves, the `asset-images.controller.spec.ts` shape. Assertions live
 * here; `report-files.controller.test.ts` is the Vitest entry point (§4.6).
 *
 * **Behavioural**, over a hand-built controller (no Nest DI — `F4.20`): the
 * download handler sets the five headers with these exact values on a stub
 * response, a header throw destroys the body before it propagates, `save`
 * refuses an unknown key with a 400 before the service is reached and hands a
 * valid body through parsed, `list` refuses `limit=500` and defaults to 50.
 *
 * **Source scan**, for what behaviour cannot see: every header precedes the
 * `pipeline(body, res, …)` call (a header after the first chunk is a throw),
 * `save` parses before it calls the service, no handler argument is named
 * `key`/`objectKey` (ADR 0066 decision 4), and the class carries the guard
 * and the prefix. Every anchor goes through `decoratorAt`/`methodBody`, never
 * a bare `indexOf`, because the class docblock quotes the decorators too.
 */
const CONTROLLER = join(repoRoot(), "apps/api/src/reports/report-files.controller.ts");

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function source(): string {
  return readFileSync(CONTROLLER, "utf8");
}

/** `save` runs from its `async save(` to the list route's decorator. */
function saveBody(text: string): string {
  return methodBody(text, "async save(", '@Get("files")');
}

/** `download` runs from its `async download(` to the delete route's decorator. */
function downloadBody(text: string): string {
  return methodBody(text, "async download(", '@Delete("files/:id")');
}

// ---------------------------------------------------------------------------
// Fixtures and fakes
// ---------------------------------------------------------------------------

const USER: JwtPayload = { sub: "u1", email: "admin@bms.local", name: "Admin", role: "admin" };
const FILE_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const BYTES = Buffer.from("%PDF-1.4 fake report bytes");

const ROW: ReportFileDto = {
  id: FILE_ID,
  organizationId: ORG_ID,
  templateId: "energy_consumption",
  format: "pdf",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-07",
  locationIds: [],
  contentType: "application/pdf",
  byteSize: BYTES.length,
  sha256: "a".repeat(64),
  filename: "energy-consumption-2026-09-01-to-2026-09-07.pdf",
  deliveryStatus: "none",
  deliveryError: null,
  scheduleId: null,
  createdBy: null,
  createdAt: "2026-09-21T10:00:00.000Z",
};

type Call = { method: string; args: unknown[] };

/** Records every call so a test can assert the service was NOT reached, not only that the handler threw. */
function serviceStub(body: () => Readable = () => Readable.from([BYTES])) {
  const calls: Call[] = [];
  const files = {
    saveOnDemand: async (...args: unknown[]) => {
      calls.push({ method: "saveOnDemand", args });
      return ROW;
    },
    list: async (...args: unknown[]) => {
      calls.push({ method: "list", args });
      return [ROW];
    },
    download: async (...args: unknown[]) => {
      calls.push({ method: "download", args });
      return { row: ROW, body: body() };
    },
    remove: async (...args: unknown[]) => {
      calls.push({ method: "remove", args });
    },
  } as unknown as ReportFilesService;
  return { files, calls };
}

/**
 * A `Writable` that records headers and bytes; `pipeline` ends or destroys it
 * like a real response. `throwOn` makes the n-th `setHeader` call throw
 * `HEADER_ERROR` — the first call proves the `try` exists, the fifth proves
 * every header is inside it (a header moved out of the `try` but still
 * before `pipeline` survived the order scan and a first-call throw alike).
 */
const HEADER_ERROR = new TypeError("fake ERR_INVALID_CHAR");

function responseFake(throwOn?: number) {
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let setHeaderCalls = 0;
  const res = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  Object.assign(res, {
    setHeader: (name: string, value: string) => {
      setHeaderCalls += 1;
      if (setHeaderCalls === throwOn) {
        throw HEADER_ERROR;
      }
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

async function runDownload(body: () => Readable = () => Readable.from([BYTES])) {
  const { files, calls } = serviceStub(body);
  const controller = new ReportFilesController(files);
  const fake = responseFake();
  await controller.download(USER, { id: FILE_ID }, fake.res);
  // `pipeline` settles the response asynchronously; `finish` is the whole
  // body written, `close` is a teardown. Whichever comes, then one more tick
  // so the pipeline callback has run.
  fake.stream.on("error", () => undefined);
  await new Promise<void>((resolve) => {
    fake.stream.once("finish", resolve);
    fake.stream.once("close", resolve);
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { calls, headers: fake.headers, bytes: Buffer.concat(fake.chunks) };
}

// ---------------------------------------------------------------------------
// Download: the five headers, on the stub response
// ---------------------------------------------------------------------------

/** The five headers and their values from the row — one claim each, so the failing one is named. */
export const DOWNLOAD_HEADERS: ReadonlyArray<readonly [name: string, expected: string]> = [
  ["Content-Type", ROW.contentType],
  ["Content-Disposition", `attachment; filename="${ROW.filename}"`],
  ["Cache-Control", "no-store"],
  ["Content-Length", String(ROW.byteSize)],
  ["X-Content-Type-Options", "nosniff"],
];

export async function assertDownloadSetsHeader(name: string, expected: string): Promise<void> {
  const run = await runDownload();
  assert(run.headers[name] === expected, `expected ${name}: ${expected}, got ${JSON.stringify(run.headers)}`);
}

/** The positive control: the service is reached once with the JWT and the parsed id, and the bytes reach the response. */
export async function assertDownloadReachesTheServiceOnceAndStreamsTheBytes(): Promise<void> {
  const run = await runDownload();
  assert(run.calls.length === 1 && run.calls[0]?.method === "download", `expected one download call, got ${JSON.stringify(run.calls)}`);
  assert(
    run.calls[0]?.args[0] === USER && run.calls[0]?.args[1] === FILE_ID,
    `download must receive the JWT and the parsed id, got ${JSON.stringify(run.calls[0]?.args)}`,
  );
  assert(run.bytes.equals(BYTES), `the response must receive the object's bytes, got ${run.bytes.length} bytes`);
}

/** A non-uuid id is a 400 before the service is asked. */
export async function assertDownloadRefusesANonUuidIdBeforeTheService(): Promise<void> {
  const { files, calls } = serviceStub();
  const controller = new ReportFilesController(files);
  const err = await rejects(() => controller.download(USER, { id: "not-a-uuid" }, responseFake().res));
  assert(errorName(err) === "BadRequestException", `a bad id threw ${errorName(err)}`);
  assert(calls.length === 0, `a bad id reached the service: ${JSON.stringify(calls)}`);
}

/** The number of headers, so the throw rows can name each position (1-based). */
export const HEADER_COUNT = DOWNLOAD_HEADERS.length;

/**
 * Anything that throws between `download()` returning and `pipeline()`
 * starting — `res.setHeader` on a value Node refuses is the measured case —
 * must destroy the body before the error propagates, or the bucket socket
 * stays open until the SDK times it out (ADR 0066 Amendment 2, the F3.3
 * shape). `destroy` is spied so the claim is "the handler called it", not
 * only "the stream ended". Run once per header position: a throw on the
 * first call proves the `try` exists; a throw on the last proves no header
 * was moved out of it (a mutation that survived the first-call form).
 */
export async function assertAHeaderThrowDestroysTheBodyAndPropagates(throwOn: number): Promise<void> {
  const body = Readable.from([BYTES]);
  const destroy = vi.spyOn(body, "destroy");
  const { files } = serviceStub(() => body);
  const controller = new ReportFilesController(files);
  const fake = responseFake(throwOn);
  const err = await rejects(() => controller.download(USER, { id: FILE_ID }, fake.res));
  assert(err === HEADER_ERROR, `the header error (call ${throwOn}) must propagate unchanged, got ${errorName(err)}`);
  assert(
    destroy.mock.calls.length === 1,
    `body.destroy() was called ${destroy.mock.calls.length} times after header call ${throwOn} threw, expected once`,
  );
  assert(body.destroyed, `the object body was left open after res.setHeader call ${throwOn} threw`);
}

// ---------------------------------------------------------------------------
// Download: the scan — order before the pipeline, the literals in the source
// ---------------------------------------------------------------------------

const PIPELINE_CALL = "pipeline(body, res,";

/** The header literals as the source spells them — the row is the only value authority. */
export const DOWNLOAD_HEADER_LITERALS: readonly string[] = [
  'res.setHeader("Content-Type", row.contentType)',
  'res.setHeader("Content-Disposition", `attachment; filename="${row.filename}"`)',
  'res.setHeader("Cache-Control", "no-store")',
  'res.setHeader("Content-Length", String(row.byteSize))',
  'res.setHeader("X-Content-Type-Options", "nosniff")',
];

export function assertDownloadSourceSetsHeader(literal: string): void {
  assert(downloadBody(source()).includes(literal), `download must set ${literal}`);
}

/** Every header precedes the pipeline call — a header set after the first chunk is a throw. */
export function assertDownloadSetsEveryHeaderBeforeThePipeline(): void {
  const body = downloadBody(source());
  const lastHeader = body.lastIndexOf("res.setHeader(");
  const pipelineAt = body.indexOf(PIPELINE_CALL);
  assert(lastHeader > -1 && pipelineAt > -1, "the scan must find both a setHeader call and the pipeline call");
  assert(lastHeader < pipelineAt, `download sets a header (at ${lastHeader}) after the pipeline call (at ${pipelineAt})`);
}

export function assertDownloadPipelinesTheBodyToRes(): void {
  const body = downloadBody(source());
  assert(body.includes(PIPELINE_CALL), `download must call ${PIPELINE_CALL} …) from node:stream`);
  assert(!body.includes("body.pipe(res)"), "download must not use body.pipe(res) — pipe leaks the source on a client abort");
  assert(body.includes("@Res()"), "download must declare @Res() to stream the body");
}

export function assertDownloadWarnsInThePipelineCallback(): void {
  const body = downloadBody(source());
  assert(body.includes(`${PIPELINE_CALL} (err)`), "download must pass pipeline a callback taking err");
  assert(/this\.logger\.warn\(\s*`report file \$\{id\}/.test(body), "the pipeline callback must warn naming the file id");
}

// ---------------------------------------------------------------------------
// Save: parse, then the service; 201
// ---------------------------------------------------------------------------

const VALID_BODY = { startDate: "2026-09-01", endDate: "2026-09-07", format: "pdf", organizationId: ORG_ID };

/** `.strict()` (decision 11): an unknown key is a 400, and the service never sees the body. */
export async function assertSaveRefusesAnUnknownKeyBeforeTheService(): Promise<void> {
  const { files, calls } = serviceStub();
  const controller = new ReportFilesController(files);
  const err = await rejects(() => controller.save(USER, { ...VALID_BODY, objectKey: "not-a-key" }));
  assert(errorName(err) === "BadRequestException", `an unknown key threw ${errorName(err)}`);
  assert(calls.length === 0, `an unknown key reached the service: ${JSON.stringify(calls)}`);
}

/**
 * Step-5 security M1 — a calendar-invalid date is refused at the parse, with
 * the field named, and the service never runs. The regex alone admits
 * `2026-02-30`; without the refine V8 rolls it to `03-02`, the render and the
 * `putObject` run, and Postgres rejects the `date` insert as a 500. The
 * controller parse is the gate (the service receives the parsed type), so
 * this is the one layer that holds the claim.
 *
 * `2026-13-01` is a second shape of the same defect: `new Date(...)` is
 * `Invalid Date` there, and a refine that calls `toISOString()` on it throws
 * `RangeError` — a 500 through the very guard meant to remove one.
 */
export async function assertSaveRefusesACalendarInvalidDateBeforeTheService(
  field: "startDate" | "endDate",
  value: string,
): Promise<void> {
  const { files, calls } = serviceStub();
  const controller = new ReportFilesController(files);
  const err = await rejects(() => controller.save(USER, { ...VALID_BODY, [field]: value }));
  assert(errorName(err) === "BadRequestException", `${field}=${value} threw ${errorName(err)}, not a 400`);
  // The message text, not the `fieldErrors` key: the key alone is satisfied by
  // any refine on the field, so it would not gate "the message names the field".
  const response = (err as { getResponse(): unknown }).getResponse() as {
    fieldErrors?: Record<string, string[] | undefined>;
  };
  const message = response.fieldErrors?.[field]?.[0];
  assert(
    message === `${field} is not a calendar date`,
    `the 400 for ${field}=${value} must carry the message naming the field, got ${JSON.stringify(response)}`,
  );
  assert(calls.length === 0, `${field}=${value} reached the service: ${JSON.stringify(calls)}`);
}

/** The positive control for the refine: the last day of February is accepted and reaches the service. */
export async function assertSaveAcceptsTheLastDayOfFebruary(): Promise<void> {
  const { files, calls } = serviceStub();
  const controller = new ReportFilesController(files);
  const body = { ...VALID_BODY, startDate: "2026-02-28", endDate: "2026-02-28" };
  await controller.save(USER, body);
  assert(calls.length === 1, `2026-02-28 must reach the service once, got ${JSON.stringify(calls)}`);
  assert(
    JSON.stringify(calls[0]?.args[1]) === JSON.stringify(body),
    `the service must receive 2026-02-28 unchanged, got ${JSON.stringify(calls[0]?.args[1])}`,
  );
}

/** The positive control: a valid body reaches the service once, parsed, with the JWT. */
export async function assertSaveHandsTheParsedBodyAndTheJwtToTheService(): Promise<void> {
  const { files, calls } = serviceStub();
  const controller = new ReportFilesController(files);
  const dto = await controller.save(USER, VALID_BODY);
  assert(calls.length === 1 && calls[0]?.method === "saveOnDemand", `expected one saveOnDemand call, got ${JSON.stringify(calls)}`);
  assert(calls[0]?.args[0] === USER, "saveOnDemand must receive the JWT as its first argument");
  assert(
    JSON.stringify(calls[0]?.args[1]) === JSON.stringify(VALID_BODY),
    `saveOnDemand must receive the parsed body, got ${JSON.stringify(calls[0]?.args[1])}`,
  );
  assert(dto === ROW, "save must answer the service's DTO verbatim");
}

export function assertSaveAnswers201(): void {
  assert(
    Reflect.getMetadata(HTTP_CODE_METADATA, ReportFilesController.prototype.save) === 201,
    "save must declare @HttpCode(201)",
  );
}

export function assertRemoveAnswers204(): void {
  assert(
    Reflect.getMetadata(HTTP_CODE_METADATA, ReportFilesController.prototype.remove) === 204,
    "remove must declare @HttpCode(204)",
  );
}

/** The scan: `save`'s text parses before it calls the service. */
export function assertSaveParsesBeforeTheService(): void {
  const body = saveBody(source());
  const parseAt = body.indexOf(".parse(");
  const serviceAt = body.indexOf("this.files.saveOnDemand(");
  assert(parseAt > -1 && serviceAt > -1, "the scan must find both .parse( and this.files.saveOnDemand( in save");
  assert(parseAt < serviceAt, `save calls the service (at ${serviceAt}) before it parses (at ${parseAt})`);
}

// ---------------------------------------------------------------------------
// List: the limit
// ---------------------------------------------------------------------------

export async function assertListRefusesALimitOverTheMax(): Promise<void> {
  const { files, calls } = serviceStub();
  const controller = new ReportFilesController(files);
  const err = await rejects(() => controller.list(USER, { limit: "500" }));
  assert(errorName(err) === "BadRequestException", `limit=500 threw ${errorName(err)}`);
  assert(calls.length === 0, `limit=500 reached the service: ${JSON.stringify(calls)}`);
}

export async function assertListDefaultsTheLimitTo50(): Promise<void> {
  const { files, calls } = serviceStub();
  const controller = new ReportFilesController(files);
  const dtos = await controller.list(USER, {});
  assert(calls.length === 1 && calls[0]?.method === "list", `expected one list call, got ${JSON.stringify(calls)}`);
  assert(calls[0]?.args[0] === USER && calls[0]?.args[1] === 50, `list must receive the JWT and 50, got ${JSON.stringify(calls[0]?.args)}`);
  assert(dtos.length === 1 && dtos[0] === ROW, "list must answer the service's DTOs verbatim");
}

/** The positive control for the default: an explicit limit is coerced and handed through. */
export async function assertListCoercesAnExplicitLimit(): Promise<void> {
  const { files, calls } = serviceStub();
  const controller = new ReportFilesController(files);
  await controller.list(USER, { limit: "7" });
  assert(calls[0]?.args[1] === 7, `list must receive the coerced limit 7, got ${JSON.stringify(calls[0]?.args)}`);
}

// ---------------------------------------------------------------------------
// Remove: parse, then the service
// ---------------------------------------------------------------------------

export async function assertRemoveHandsTheParsedIdToTheService(): Promise<void> {
  const { files, calls } = serviceStub();
  const controller = new ReportFilesController(files);
  await controller.remove(USER, { id: FILE_ID });
  assert(
    calls.length === 1 && calls[0]?.method === "remove" && calls[0]?.args[0] === USER && calls[0]?.args[1] === FILE_ID,
    `remove must reach the service once with the JWT and the id, got ${JSON.stringify(calls)}`,
  );
}

export async function assertRemoveRefusesANonUuidIdBeforeTheService(): Promise<void> {
  const { files, calls } = serviceStub();
  const controller = new ReportFilesController(files);
  const err = await rejects(() => controller.remove(USER, { id: "not-a-uuid" }));
  assert(errorName(err) === "BadRequestException", `a bad id threw ${errorName(err)}`);
  assert(calls.length === 0, `a bad id reached the service: ${JSON.stringify(calls)}`);
}

// ---------------------------------------------------------------------------
// Decision 4: no client-supplied key; the guard and the prefix
// ---------------------------------------------------------------------------

const KEY_ARGUMENT = /@(?:Param|Query|Body)\(\s*"(?:key|objectKey)"\s*\)/;

export function assertNoHandlerArgumentIsNamedKey(): void {
  assert(!KEY_ARGUMENT.test(source()), "no @Param/@Query/@Body may be named key or objectKey");
}

/**
 * The positive controls for the negative above: the scan read the file (it
 * finds `@Param()`), and the regex can fire (a synthetic `@Param("key")`
 * matches — this file has no quoted decorator argument to prove it on).
 */
export function assertScanFindsAParamDecorator(): void {
  assert(/@Param\(\s*\)/.test(source()), "@Param() must be declared on download and remove");
  assert(KEY_ARGUMENT.test('@Param("key")'), "the key regex must fire on a synthetic positive");
}

/**
 * The registry is keyed by `ControllerClass_handlerName` and nothing acts on
 * an orphaned key (`openapi-document.ts` computes `orphanedRegistryKeys`,
 * `main.ts` reads only `document`), so a typo'd key would document nothing
 * and stay green. Two keys, two handlers, checked both ways: every
 * `ReportFilesController_*` key names a method on the prototype, and the
 * body/query handlers `save` and `list` are both registered.
 */
export function assertRegistryKeysNameRealHandlers(): void {
  const keys = Object.keys(REQUEST_SCHEMAS).filter((id) => id.startsWith("ReportFilesController_"));
  const handlers = keys.map((id) => id.slice("ReportFilesController_".length));
  assert(
    JSON.stringify(handlers.sort()) === JSON.stringify(["list", "save"]),
    `expected ReportFilesController_list and _save in the registry, got ${JSON.stringify(keys)}`,
  );
  for (const handler of handlers) {
    const method = (ReportFilesController.prototype as unknown as Record<string, unknown>)[handler];
    assert(typeof method === "function", `registry key ReportFilesController_${handler} names no handler`);
  }
}

export function assertControllerIsGuardedByJwtOnTheReportsPrefix(): void {
  const text = source();
  assert(decoratorAt(text, "@UseGuards(JwtAuthGuard)") > -1, "the controller must carry @UseGuards(JwtAuthGuard)");
  assert(decoratorAt(text, '@Controller("reports")') > -1, "the route prefix must be reports");
}
