import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { HTTP_CODE_METADATA, INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { concatMap, defer, from, lastValueFrom, throwError } from "rxjs";
import { expect, vi } from "vitest";
import { z } from "zod";

import { instantiateAssetsBodySchema, type JwtPayload, type UserRole } from "@bms/shared";

import { type ResolvedIdentity, rememberIdentity } from "../auth/identity-resolver";
import { bodyHash } from "./body-hash";
import type { CopilotAvailabilityService } from "./copilot-availability.service";
import { CHANGE_REFUSED, CopilotChangeInterceptor } from "./copilot-change.interceptor";
import type { ClaimedChange, CopilotPendingChangesService } from "./copilot-pending-changes.service";
import { copilotContext, currentCopilotChange } from "./copilot-request-context";
import type { CopilotTurnService } from "./copilot-turn.service";
import { CopilotUploadChangeInterceptor } from "./copilot-upload-change.interceptor";
import { COPILOT_UPLOAD_ROUTE } from "./copilot-upload-route";

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5 — the `X-Copilot-Change` interceptor,
 * against a fake request, a fake pending-change store and a handler that
 * reads the copilot mark **when it runs**: `next.handle()` is
 * `defer(() => from(handler()))`, so the handler runs at subscription, after
 * `intercept` has returned — as Nest runs it. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 *
 * The request's `user` is the same object `rememberIdentity` stored the
 * identity against: the memo is a `WeakMap` keyed by that object, and a copy
 * would make every role check pass or fail for the wrong reason.
 */
const CHANGE_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "44444444-4444-4444-8444-444444444444";
const PATH = "/api/v1/dashboards";
const BODY = { organizationId: ORG_ID, title: "Ops" };

type Harness = {
  interceptor: CopilotChangeInterceptor;
  context: ExecutionContext;
  next: CallHandler;
  handler: ReturnType<typeof vi.fn>;
  pending: {
    peek: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    record: ReturnType<typeof vi.fn>;
  };
  decide: ReturnType<typeof vi.fn>;
  seen: Array<unknown>;
  followUp: ReturnType<typeof vi.fn>;
  order: string[];
};

type Options = {
  role?: UserRole;
  header?: string | string[] | undefined;
  method?: string;
  path?: string;
  originalUrl?: string;
  body?: unknown;
  authenticated?: boolean;
  type?: string;
  stored?: Partial<ClaimedChange>;
  /** `F4.247`: the `If-Match` header the Confirm sends (absent by default). */
  ifMatch?: string;
  handlerResult?: () => Promise<unknown>;
  /** The route's `@HttpCode`, set on the handler as Nest's decorator sets it. */
  httpCode?: number;
  contentType?: string;
  /** `F3.87` PR 6a: the handler carries `@CopilotUploadRoute()`. */
  uploadRoute?: boolean;
  /** `F3.87` PR 6a: the handler declares `CopilotUploadChangeInterceptor` (default: with `uploadRoute`). */
  routeStageDeclared?: boolean;
  /** `F3.87` PR 6a: what `next.handle()` is — the route stage over the handler (multer already ran), or a multer error. */
  routeStage?: "upload" | "multerError";
  /** `F3.87` PR 6a: the uploaded file multer would hand the route stage. */
  file?: { originalname: string; buffer: Buffer };
};

function harness(options: Options = {}): Harness {
  const user = { sub: "55555555-5555-4555-8555-555555555555", email: "admin@bms.local" } as JwtPayload;
  rememberIdentity(user, { id: user.sub, role: options.role ?? "admin", organizationId: null } as ResolvedIdentity);
  const method = options.method ?? "POST";
  const path = options.path ?? PATH;
  const req = {
    method,
    path,
    originalUrl: options.originalUrl ?? path,
    headers: {
      "x-copilot-change": "header" in options ? options.header : CHANGE_ID,
      "content-type": options.contentType ?? "application/json",
      ...(options.ifMatch !== undefined ? { "if-match": options.ifMatch } : {}),
    },
    body: "body" in options ? options.body : BODY,
    user: options.authenticated === false ? undefined : user,
    ...(options.file ? { file: options.file } : {}),
  };
  const handlerFn = function create(): void {};
  if (options.httpCode !== undefined) Reflect.defineMetadata(HTTP_CODE_METADATA, options.httpCode, handlerFn);
  if (options.uploadRoute) Reflect.defineMetadata(COPILOT_UPLOAD_ROUTE, true, handlerFn);
  if (options.routeStageDeclared ?? options.uploadRoute) {
    Reflect.defineMetadata(INTERCEPTORS_METADATA, [class MulterMixin {}, CopilotUploadChangeInterceptor], handlerFn);
  }
  const context = {
    getType: () => options.type ?? "http",
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handlerFn,
  } as unknown as ExecutionContext;
  const seen: unknown[] = [];
  const handler = vi.fn(async () => {
    seen.push(currentCopilotChange());
    return options.handlerResult ? options.handlerResult() : { id: "dash-1", title: "Ops" };
  });
  const inner: CallHandler = { handle: () => defer(() => from(handler())) };
  // `F3.87` PR 6a: Nest runs the route's interceptors inside the global one's `next.handle()`.
  const routeStage = new CopilotUploadChangeInterceptor();
  const next: CallHandler =
    options.routeStage === "upload"
      ? { handle: () => defer(() => from(routeStage.intercept(context, inner))).pipe(concatMap((stage) => stage)) }
      : options.routeStage === "multerError"
        ? { handle: () => throwError(() => new PayloadTooLargeException("File too large")) }
        : inner;
  const stored: ClaimedChange = {
    method: "POST",
    path: PATH,
    bodyHash: bodyHash(BODY),
    organizationId: ORG_ID,
    catalogId: "dashboards.create",
    precondition: null,
    ...options.stored,
  };
  const pending = {
    peek: vi.fn(async () => ({ organizationId: stored.organizationId, catalogId: stored.catalogId })),
    claim: vi.fn(async () => stored),
    release: vi.fn(async () => undefined),
    record: vi.fn(async () => {
      order.push("record");
    }),
  };
  const decide = vi.fn(async () => ({ available: true }));
  const order: string[] = [];
  const followUp = vi.fn(async () => {
    order.push("followUp");
  });
  const interceptor = new CopilotChangeInterceptor(
    pending as unknown as CopilotPendingChangesService,
    { decide } as unknown as CopilotAvailabilityService,
    new Reflector(),
    { followUp } as unknown as CopilotTurnService,
  );
  return { interceptor, context, next, handler, pending, decide, seen, followUp, order };
}

/** Runs one request inside a fresh store, as the middleware opens it. */
function run(h: Harness): Promise<unknown> {
  return copilotContext.run({ change: null }, async () => lastValueFrom(await h.interceptor.intercept(h.context, h.next)));
}

async function refused(h: Harness): Promise<unknown> {
  try {
    await run(h);
  } catch (err) {
    return err;
  }
  throw new Error("the request was applied, and it must be refused");
}

export async function noHeaderPassesThroughUntouched(): Promise<void> {
  const h = harness({ header: undefined });
  expect(await run(h)).toEqual({ id: "dash-1", title: "Ops" });
  expect(h.handler).toHaveBeenCalledTimes(1);
  expect(h.seen).toEqual([null]);
  expect(h.pending.peek).not.toHaveBeenCalled();
  expect(h.pending.claim).not.toHaveBeenCalled();
}

/** A WebSocket context passes through even with the header: only HTTP routes are catalog routes. */
export async function aNonHttpContextPassesThrough(): Promise<void> {
  const h = harness({ type: "ws" });
  await run(h);
  expect(h.handler).toHaveBeenCalledTimes(1);
  expect(h.pending.peek).not.toHaveBeenCalled();
}

export async function aMalformedHeaderIs409(): Promise<void> {
  for (const header of ["not-a-uuid", [CHANGE_ID, CHANGE_ID]]) {
    const h = harness({ header });
    const err = await refused(h);
    expect(err).toBeInstanceOf(ConflictException);
    expect(h.handler).not.toHaveBeenCalled();
    expect(h.pending.peek).not.toHaveBeenCalled();
  }
}

export async function anUnauthenticatedRequestIs409(): Promise<void> {
  const h = harness({ authenticated: false });
  expect(await refused(h)).toBeInstanceOf(ConflictException);
  expect(h.pending.peek).not.toHaveBeenCalled();
}

/** A demoted caller (the guard re-read the role this request) is refused before any read of the change. */
export async function aDemotedCallerIs403AndNothingIsRead(): Promise<void> {
  const h = harness({ role: "operator" });
  expect(await refused(h)).toBeInstanceOf(ForbiddenException);
  expect(h.pending.peek).not.toHaveBeenCalled();
  expect(h.pending.claim).not.toHaveBeenCalled();
  expect(h.handler).not.toHaveBeenCalled();
}

export async function aQueryStringIs409(): Promise<void> {
  const h = harness({ originalUrl: `${PATH}?x=1` });
  expect(await refused(h)).toBeInstanceOf(ConflictException);
  expect(h.pending.claim).not.toHaveBeenCalled();
}

/**
 * A multipart body for an entry with no `upload` is refused before any claim
 * (`F3.87` PR 6a: the peek names the entry, so this is decided before the claim).
 */
export async function aMultipartRequestIs409(): Promise<void> {
  const h = harness({ contentType: "multipart/form-data; boundary=x", uploadRoute: true });
  expect(await refused(h)).toBeInstanceOf(ConflictException);
  expect(h.pending.claim).not.toHaveBeenCalled();
  expect(h.handler).not.toHaveBeenCalled();
}

export async function anUnknownChangeIs409AndNothingIsClaimed(): Promise<void> {
  const h = harness();
  h.pending.peek.mockResolvedValueOnce(null);
  const err = await refused(h);
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(CHANGE_REFUSED);
  expect(h.pending.claim).not.toHaveBeenCalled();
  expect(h.handler).not.toHaveBeenCalled();
}

/** ADR order: availability is checked before the claim, so a refused caller leaves the row `pending`. */
export async function anUnavailableCopilotIs403BeforeTheClaim(): Promise<void> {
  const h = harness();
  h.decide.mockResolvedValueOnce({ available: false, reason: "organization_off" });
  expect(await refused(h)).toBeInstanceOf(ForbiddenException);
  expect(h.decide).toHaveBeenCalledWith(expect.objectContaining({ role: "admin" }), ORG_ID);
  expect(h.pending.claim).not.toHaveBeenCalled();
  expect(h.pending.release).not.toHaveBeenCalled();
  expect(h.handler).not.toHaveBeenCalled();
}

/** The claim lost (a concurrent request, or the row changed state after the read): 409, the handler never runs. */
export async function aLostClaimIs409(): Promise<void> {
  const h = harness();
  h.pending.claim.mockResolvedValueOnce(null);
  expect(await refused(h)).toBeInstanceOf(ConflictException);
  expect(h.handler).not.toHaveBeenCalled();
  expect(h.pending.release).not.toHaveBeenCalled();
}

async function expectReleased(h: Harness): Promise<void> {
  const err = await refused(h);
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(CHANGE_REFUSED);
  expect(h.pending.release).toHaveBeenCalledWith(expect.any(String), CHANGE_ID);
  expect(h.handler).not.toHaveBeenCalled();
  expect(h.pending.record).not.toHaveBeenCalled();
}

export async function aChangedBodyIs409AndReleased(): Promise<void> {
  await expectReleased(harness({ body: { ...BODY, title: "Ops 2" } }));
}

/** A bodyless entry stores `{}`; a request carrying any body does not match it. */
export async function aBodyOnABodylessEntryIs409(): Promise<void> {
  await expectReleased(harness({ body: { publish: true }, stored: { bodyHash: bodyHash({}) } }));
}

export async function aDifferentPathIs409(): Promise<void> {
  await expectReleased(harness({ path: "/api/v1/dashboards/other" }));
}

export async function aDifferentMethodIs409(): Promise<void> {
  await expectReleased(harness({ method: "PUT" }));
}

/** No body at all hashes as `{}`, so it matches a bodyless entry. */
export async function anAbsentBodyMatchesABodylessEntry(): Promise<void> {
  const h = harness({ body: undefined, stored: { bodyHash: bodyHash({}) } });
  await run(h);
  expect(h.handler).toHaveBeenCalledTimes(1);
}

/**
 * The handler sees the mark when it runs — at subscription, after `intercept`
 * returned. Mutations that turn this red: writing the mark inside the
 * response pipe, or opening a new store around `next.handle()`.
 */
export async function aMatchingChangeIsAppliedMarkedAndRecorded(): Promise<void> {
  const h = harness();
  expect(await run(h)).toEqual({ id: "dash-1", title: "Ops" });
  expect(h.seen).toEqual([{ via: "copilot", changeId: CHANGE_ID }]);
  expect(h.pending.record).toHaveBeenCalledWith(expect.any(String), CHANGE_ID, "applied", 201, "dash-1");
  expect(h.pending.release).not.toHaveBeenCalled();
}

/** A PUT answers 200, and a response with no string `id` records no resource. */
export async function aPutRecords200AndNoResource(): Promise<void> {
  const h = harness({ method: "PUT", stored: { method: "PUT" }, handlerResult: async () => ({ ok: true }) });
  await run(h);
  expect(h.pending.record).toHaveBeenCalledWith(expect.any(String), CHANGE_ID, "applied", 200, null);
}

/** A route's `@HttpCode` decides the recorded status: a publish POST answers 200, not the POST default 201. */
export async function theRoutesHttpCodeIsRecorded(): Promise<void> {
  const h = harness({ httpCode: 200, handlerResult: async () => ({ id: "tpl-1" }) });
  await run(h);
  expect(h.pending.record).toHaveBeenCalledWith(expect.any(String), CHANGE_ID, "applied", 200, "tpl-1");
}

/**
 * The outcome is recorded before the response leaves — on success and on
 * error. `record` is held open by hand: while it is unresolved, the request
 * must not settle. A fire-and-forget record settles at once and turns this red.
 */
export async function theOutcomeIsRecordedBeforeTheResponse(): Promise<void> {
  for (const failing of [false, true]) {
    const h = harness(failing ? { handlerResult: async () => Promise.reject(new BadRequestException("no")) } : {});
    let release: () => void = () => undefined;
    h.pending.record.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    let settled = false;
    const done = run(h).then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let i = 0; i < 5 && h.pending.record.mock.calls.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(h.pending.record, failing ? "error path" : "success path").toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(settled, `${failing ? "error" : "success"} path settled before the record finished`).toBe(false);
    release();
    await done;
    expect(settled).toBe(true);
  }
}

/** A refused write is recorded `failed` with the status the client sees, and the same error reaches the client. */
export async function aHandlerErrorIsRecordedAndRethrown(): Promise<void> {
  const error = new BadRequestException("slug taken");
  const h = harness({ handlerResult: async () => Promise.reject(error) });
  expect(await refused(h)).toBe(error);
  expect(h.pending.record).toHaveBeenCalledWith(expect.any(String), CHANGE_ID, "failed", 400, null);
}

/**
 * `F3.86` PR 2: a route's own 409 after the claim is the route's answer, not
 * the interceptor's refusal — recorded `failed` 409 and passed on with its own
 * sentence. The Confirm card tells the two apart by that sentence. Mutation:
 * map every handler error to `CHANGE_REFUSED` → red.
 */
export async function aRoutesOwnConflictKeepsItsSentence(): Promise<void> {
  const error = new ConflictException("This site has no active assets to lay out");
  const h = harness({ handlerResult: async () => Promise.reject(error) });
  const err = await refused(h);
  expect(err).toBe(error);
  expect((err as Error).message).toBe("This site has no active assets to lay out");
  expect((err as Error).message).not.toBe(CHANGE_REFUSED);
  expect(h.pending.record).toHaveBeenCalledWith(expect.any(String), CHANGE_ID, "failed", 409, null);
}

/** `clientOnlyKeysFor` answers this fixture id from the `.test.ts` wrapper's mock: one `clientOnly` field. */
export const CLIENT_ONLY_FIXTURE_ID = "fixture.user.create";

/**
 * `F3.86` PR 2 / ADR 0099 decision 3 — the value the user types on the Confirm
 * card (`temporaryPassword`) is sent beside the stored body; the hash leaves it
 * out, so the change applies. For an entry without that `clientOnly` field
 * the same request is a changed body, 409. Mutation: `stripKeys` returns the
 * body unchanged → the first reddens.
 */
export async function aClientOnlyValueBesideTheStoredBodyMatches(): Promise<void> {
  const typed = { ...BODY, temporaryPassword: "typed-on-the-card-1" };
  const applied = harness({ body: typed, stored: { catalogId: CLIENT_ONLY_FIXTURE_ID } });
  await run(applied);
  expect(applied.handler).toHaveBeenCalledTimes(1);
  expect(applied.pending.release).not.toHaveBeenCalled();
  await expectReleased(harness({ body: typed, stored: { catalogId: "dashboards.create" } }));
}

/** The global filter answers a bare `ZodError` with 400, so the row records 400, not 500. */
export async function aZodErrorIsRecordedAs400(): Promise<void> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse({ id: "x" });
  const error = parsed.success ? new Error("unreachable") : parsed.error;
  const h = harness({ handlerResult: async () => Promise.reject(error) });
  expect(await refused(h)).toBe(error);
  expect(h.pending.record).toHaveBeenCalledWith(expect.any(String), CHANGE_ID, "failed", 400, null);
}

/** Without the middleware's store the mark would be lost: refuse before anything is claimed. */
export async function aMissingStoreFailsClosed(): Promise<void> {
  const h = harness();
  let err: unknown;
  try {
    await lastValueFrom(await h.interceptor.intercept(h.context, h.next));
  } catch (caught) {
    err = caught;
  }
  expect(err).toBeInstanceOf(InternalServerErrorException);
  expect(h.pending.peek).not.toHaveBeenCalled();
  expect(h.pending.claim).not.toHaveBeenCalled();
}

/** A record that fails does not change what the client gets; the sweep resolves the row later. */
export async function aFailedRecordDoesNotChangeTheResponse(): Promise<void> {
  const h = harness();
  h.pending.record.mockRejectedValueOnce(new Error("connection lost"));
  expect(await run(h)).toEqual({ id: "dash-1", title: "Ops" });
}

/** Waits for the un-awaited follow-up the record starts. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `F3.85` PR 8, decision 4.7: an applied change starts one follow-up turn, after its outcome is recorded. */
export async function anAppliedChangeStartsOneFollowUpAfterTheRecord(): Promise<void> {
  const h = harness();
  await run(h);
  await settle();
  expect(h.followUp).toHaveBeenCalledTimes(1);
  expect(h.followUp.mock.calls[0]?.[1]).toBe(CHANGE_ID);
  expect((h.followUp.mock.calls[0]?.[0] as { identity: { id: string } }).identity.id).toBe("55555555-5555-4555-8555-555555555555");
  expect(h.order).toEqual(["record", "followUp"]);
}

/** A failed change starts the follow-up too, so the model can say what went wrong. */
export async function aFailedChangeStartsAFollowUpToo(): Promise<void> {
  const h = harness({ handlerResult: () => Promise.reject(new BadRequestException("no")) });
  await refused(h);
  await settle();
  expect(h.order).toEqual(["record", "followUp"]);
}

/** A refused claim records nothing and starts no follow-up. */
export async function aRefusedChangeStartsNoFollowUp(): Promise<void> {
  const h = harness();
  h.pending.claim.mockResolvedValueOnce(null);
  expect(await refused(h)).toBeInstanceOf(ConflictException);
  await settle();
  expect(h.followUp).not.toHaveBeenCalled();
}

/**
 * `F4.254` PR 3 (plan §5.4) — `assetTemplate.instantiate`'s body ends in a root
 * `.transform` whose output (`{ target, assets }`) is not its input. The
 * propose tool stored the hash of the **raw** body, and the interceptor hashes
 * `req.body` as Nest parsed the JSON — before the handler's own parse — so the
 * raw body matches and the handler runs. Mutation: hash
 * `entry.body.parse(req.body)` → the hashes differ → 409 → red.
 */
const INSTANTIATE_PATH = "/api/v1/admin/asset-templates/66666666-6666-4666-8666-666666666666/instantiate";
const INSTANTIATE_RAW = { locationId: "77777777-7777-4777-8777-777777777777", assets: [{ code: "P-1", name: "Pump 1" }] };

/** The positive control: the fixture really is a body whose parse changes it. */
export function theInstantiateBodyIsChangedByItsOwnParse(): void {
  expect(bodyHash(instantiateAssetsBodySchema.parse(INSTANTIATE_RAW))).not.toBe(bodyHash(INSTANTIATE_RAW));
}

export async function aRootTransformBodyIsHashedRaw(): Promise<void> {
  const h = harness({
    path: INSTANTIATE_PATH,
    body: INSTANTIATE_RAW,
    stored: { path: INSTANTIATE_PATH, bodyHash: bodyHash(INSTANTIATE_RAW), catalogId: "assetTemplate.instantiate" },
  });
  await run(h);
  expect(h.handler).toHaveBeenCalledTimes(1);
  expect(h.pending.release).not.toHaveBeenCalled();
}

/**
 * `F3.87` PR 6a (ADR 0099 Amendment 3 A3, plan D12) — the multipart Confirm in
 * two stages. `UPLOAD_FIXTURE_ID` is an `upload` entry in the `.test.ts`
 * wrapper's mock of `catalogEntry`, so these cases do not hang off the real
 * `mimicSymbol.upload` entry (PR 6b) and its hash-excluded keys.
 */
export const UPLOAD_FIXTURE_ID = "fixture.symbol.upload";
const LIBRARY_PATH = "/api/v1/mimic-symbol-libraries/66666666-6666-4666-8666-666666666666/symbols";
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24"/></svg>');
const FIELDS = { name: "pump", label: "Pump" };
const STORED_UPLOAD = {
  ...FIELDS,
  filename: "pump.svg",
  fileSha256: createHash("sha256").update(SVG).digest("hex"),
};

function uploadHarness(over: Options = {}): Harness {
  return harness({
    contentType: "multipart/form-data; boundary=x",
    uploadRoute: true,
    routeStage: "upload",
    path: LIBRARY_PATH,
    body: FIELDS,
    file: { originalname: "pump.svg", buffer: SVG },
    stored: { path: LIBRARY_PATH, catalogId: UPLOAD_FIXTURE_ID, bodyHash: bodyHash(STORED_UPLOAD) },
    ...over,
  });
}

/** A matching upload: claimed, the hash compared after multer, the handler marked, the outcome recorded. */
export async function aMatchingUploadIsAppliedAndMarked(): Promise<void> {
  const h = uploadHarness();
  await run(h);
  expect(h.handler).toHaveBeenCalledTimes(1);
  expect(h.seen).toEqual([{ via: "copilot", changeId: CHANGE_ID }]);
  expect(h.pending.release).not.toHaveBeenCalled();
  expect(h.pending.record).toHaveBeenCalledWith(expect.any(String), CHANGE_ID, "applied", 201, "dash-1");
}

/** A multipart Confirm to a handler without `@CopilotUploadRoute()` is refused before any claim. */
export async function anUploadToAnUnmarkedHandlerIs409BeforeTheClaim(): Promise<void> {
  // The route stage is declared and only the marker is missing, so this case gates the marker check alone.
  const h = uploadHarness({ uploadRoute: false, routeStageDeclared: true });
  expect(await refused(h)).toBeInstanceOf(ConflictException);
  expect(h.pending.claim).not.toHaveBeenCalled();
  expect(h.handler).not.toHaveBeenCalled();
}

/** An upload Confirmed against another library's path: 409 and released, the handler never runs (critique A6 item 8). */
export async function anUploadToAnotherLibraryIs409AndReleased(): Promise<void> {
  const other = "/api/v1/mimic-symbol-libraries/77777777-7777-4777-8777-777777777777/symbols";
  await expectReleased(uploadHarness({ path: other }));
}

/** One changed byte of the file: the route stage releases and refuses; nothing is recorded. */
export async function aChangedFileByteIs409AndReleased(): Promise<void> {
  const changed = Buffer.from(SVG);
  changed[changed.length - 2] = 0x20;
  const h = uploadHarness({ file: { originalname: "pump.svg", buffer: changed } });
  await expectReleased(h);
  expect(h.pending.release).toHaveBeenCalledTimes(1);
}

/** A changed text field: the same refusal. */
export async function aChangedUploadFieldIs409AndReleased(): Promise<void> {
  await expectReleased(uploadHarness({ body: { ...FIELDS, label: "Pump 2" } }));
}

/** A changed filename: the same refusal. */
export async function aChangedUploadFilenameIs409AndReleased(): Promise<void> {
  await expectReleased(uploadHarness({ file: { originalname: "other.svg", buffer: SVG } }));
}

/** `F4.283` (Amendment 8 Q19): a telemetry import Confirm — its fields are the entry body's, read from the catalog. */
const IMPORT_PATH = "/api/v1/admin/telemetry/import/commit";
const CSV = Buffer.from("asset_code,point_key,value,time\nPUMP-1,kw,1,2026-10-20T09:00:00Z\n", "utf8");
const IMPORT_FIELDS = { sourceKind: "manual", conflictPolicy: "reject" };
const STORED_IMPORT = { ...IMPORT_FIELDS, filename: "readings.csv", fileSha256: createHash("sha256").update(CSV).digest("hex") };

function importHarness(over: Options = {}): Harness {
  return uploadHarness({
    path: IMPORT_PATH,
    body: IMPORT_FIELDS,
    file: { originalname: "readings.csv", buffer: CSV },
    stored: { path: IMPORT_PATH, catalogId: "telemetry.import", bodyHash: bodyHash(STORED_IMPORT, ["preview"]) },
    ...over,
  });
}

/** The same bytes and the import's own fields: applied and marked. Mutation: keep the fixed symbol field list → red. */
export async function aMatchingImportIsAppliedAndMarked(): Promise<void> {
  const h = importHarness();
  await run(h);
  expect(h.seen).toEqual([{ via: "copilot", changeId: CHANGE_ID }]);
}

/** Other bytes under the same name: 409, and the claim is released once. */
export async function aChangedImportFileIs409AndReleasedOnce(): Promise<void> {
  const h = importHarness({ file: { originalname: "readings.csv", buffer: Buffer.concat([CSV, Buffer.from("x")]) } });
  await expectReleased(h);
  expect(h.pending.release).toHaveBeenCalledTimes(1);
}

/** A changed import field (overwrite on the wire): the same refusal. */
export async function aChangedImportFieldIs409AndReleased(): Promise<void> {
  await expectReleased(importHarness({ body: { ...IMPORT_FIELDS, conflictPolicy: "overwrite" } }));
}

/** A multer limit error before the route stage compared anything: released, not recorded `failed` (critique A6 item 12). */
export async function aMulterErrorBeforeTheCompareReleases(): Promise<void> {
  const h = uploadHarness({ routeStage: "multerError" });
  const err = await refused(h);
  expect(err).toBeInstanceOf(PayloadTooLargeException);
  expect(h.pending.release).toHaveBeenCalledTimes(1);
  expect(h.pending.record).not.toHaveBeenCalled();
}

/** A handler error after the compare is recorded `failed`, as for any change. */
export async function aHandlerErrorAfterTheCompareIsRecorded(): Promise<void> {
  const h = uploadHarness({ handlerResult: async () => Promise.reject(new ConflictException("A symbol named pump exists")) });
  expect(await refused(h)).toBeInstanceOf(ConflictException);
  expect(h.pending.release).not.toHaveBeenCalled();
  expect(h.pending.record).toHaveBeenCalledWith(expect.any(String), CHANGE_ID, "failed", 409, null);
}

/** The route stage alone: no header passes through; the header with no claim on the store fails closed. */
export async function theRouteStageFailsClosedWithoutAClaim(): Promise<void> {
  const stage = new CopilotUploadChangeInterceptor();
  const ran = vi.fn(async () => "ok");
  const ctx = (headers: Record<string, string>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers, body: FIELDS }) }) }) as unknown as ExecutionContext;
  const handle = { handle: () => defer(() => from(ran())) };
  await copilotContext.run({ change: null }, async () => {
    expect(await lastValueFrom(await stage.intercept(ctx({}), handle))).toBe("ok");
    await expect(stage.intercept(ctx({ "x-copilot-change": CHANGE_ID }), handle)).rejects.toBeInstanceOf(ConflictException);
  });
  expect(ran).toHaveBeenCalledTimes(1);
}

/** A handler with the marker but without the route stage: refused before any claim (review: fail closed). */
export async function aMarkedHandlerWithoutTheRouteStageIs409(): Promise<void> {
  const h = uploadHarness({ routeStageDeclared: false });
  expect(await refused(h)).toBeInstanceOf(ConflictException);
  expect(h.pending.claim).not.toHaveBeenCalled();
  expect(h.handler).not.toHaveBeenCalled();
}

/** A JSON Confirm of an upload entry: refused before any claim, so the row stays confirmable. */
export async function aJsonConfirmOfAnUploadEntryIs409BeforeTheClaim(): Promise<void> {
  const h = uploadHarness({ contentType: "application/json", routeStage: undefined, body: STORED_UPLOAD });
  expect(await refused(h)).toBeInstanceOf(ConflictException);
  expect(h.pending.claim).not.toHaveBeenCalled();
  expect(h.pending.record).not.toHaveBeenCalled();
}

/** A changed group field: released and refused. */
export async function aChangedUploadGroupIs409AndReleased(): Promise<void> {
  const stored = { ...STORED_UPLOAD, group: "electrical" };
  await expectReleased(
    uploadHarness({
      body: { ...FIELDS, group: "water" },
      stored: { path: LIBRARY_PATH, catalogId: UPLOAD_FIXTURE_ID, bodyHash: bodyHash(stored) },
    }),
  );
}

/**
 * `F4.247` (ADR 0099 Amendment 5 C2) — a change stored with a precondition is
 * applied only when the Confirm's `If-Match` names it. `STAMP` is a valid ms
 * instant, so a refusal is the compare's, never the header schema's.
 */
const STAMP = "2026-10-20T10:00:00.000Z";

/** Mutation: skip the compare when the header is absent. */
export async function aPreconditionWithoutIfMatchIs409AndReleased(): Promise<void> {
  await expectReleased(harness({ stored: { precondition: STAMP } }));
}

/** Mutation: check the header's presence only. */
export async function aPreconditionWithAnotherIfMatchIs409AndReleased(): Promise<void> {
  await expectReleased(harness({ stored: { precondition: STAMP }, ifMatch: '"2026-10-20T10:00:00.001Z"' }));
}

/** Mutation: compare the raw (quoted) header to the stored (bare) instant — the browser's quoting never matches. */
export async function aPreconditionWithItsIfMatchIsApplied(): Promise<void> {
  const h = harness({ stored: { precondition: STAMP }, ifMatch: `"${STAMP}"` });
  await run(h);
  expect(h.handler).toHaveBeenCalledTimes(1);
  expect(h.pending.record).toHaveBeenCalledWith(expect.any(String), CHANGE_ID, "applied", 201, "dash-1");
}

/** Mutation: refuse any `If-Match` on a change with no precondition — the route decides that one. */
export async function noPreconditionIgnoresTheIfMatch(): Promise<void> {
  const h = harness({ ifMatch: '"not an instant"' });
  await run(h);
  expect(h.handler).toHaveBeenCalledTimes(1);
  expect(h.pending.release).not.toHaveBeenCalled();
}

/**
 * `F4.284` (ADR 0106 decision 3): an acknowledge's reason is in its body, so the hash binds it. A
 * Confirm that sends another reason is refused (409) and the claim released; nothing runs.
 */
const ACK_PATH = "/api/v1/alarms/66666666-6666-4666-8666-666666666666/ack";
const ACK_STORED = { method: "POST", path: ACK_PATH, bodyHash: bodyHash({ reason: "Panel checked" }), catalogId: "alarm.acknowledge" };

export async function anAckWithAnotherReasonIs409AndReleased(): Promise<void> {
  const h = harness({ path: ACK_PATH, body: { reason: "Something else" }, stored: ACK_STORED });
  expect(await refused(h)).toBeInstanceOf(ConflictException);
  expect(h.pending.release).toHaveBeenCalledWith(expect.any(String), CHANGE_ID);
  expect(h.handler).not.toHaveBeenCalled();
}

/** The adjacent positive: the reason the card showed is applied. */
export async function anAckWithItsReasonIsApplied(): Promise<void> {
  const h = harness({ path: ACK_PATH, body: { reason: "Panel checked" }, stored: ACK_STORED });
  await run(h);
  expect(h.handler).toHaveBeenCalledTimes(1);
  expect(h.pending.release).not.toHaveBeenCalled();
}

/**
 * `F4.289` (ADR 0099 Amendment 9 E3), with the real catalog id: a batch Confirm that unticks a row
 * sends `excludedRows` beside the stored `rules`, and the hash leaves it out, so the change applies.
 */
const BATCH_PATH = "/api/v1/rules/batch";
const BATCH_RULE = (pointKey: string) => ({
  name: `Chiller ${pointKey}`,
  ruleType: "threshold",
  assetId: "55555555-5555-4555-8555-555555555555",
  pointKey,
  operator: "gt",
  thresholdValue: 3,
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
});
const BATCH_RULES = [BATCH_RULE("supply_temp_c"), BATCH_RULE("return_temp_c")];
const BATCH_STORED = { path: BATCH_PATH, bodyHash: bodyHash({ rules: BATCH_RULES }), catalogId: "rule.createBatch" };

export async function aBatchConfirmWithExcludedRowsIsApplied(): Promise<void> {
  const h = harness({ path: BATCH_PATH, body: { rules: BATCH_RULES, excludedRows: [0] }, stored: BATCH_STORED });
  await run(h);
  expect(h.handler).toHaveBeenCalledTimes(1);
  expect(h.pending.release).not.toHaveBeenCalled();
}

/** The adjacent negative: a row the card did not show (another point key) is 409, and the claim is released. */
export async function aBatchConfirmWithAChangedRowIs409AndReleased(): Promise<void> {
  const changed = [BATCH_RULES[0], { ...BATCH_RULE("return_temp_c"), pointKey: "flow_m3h" }];
  await expectReleased(harness({ path: BATCH_PATH, body: { rules: changed, excludedRows: [0] }, stored: BATCH_STORED }));
}
