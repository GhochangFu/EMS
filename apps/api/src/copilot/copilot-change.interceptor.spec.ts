import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException } from "@nestjs/common";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { defer, from, lastValueFrom } from "rxjs";
import { expect, vi } from "vitest";
import { z } from "zod";

import type { JwtPayload, UserRole } from "@bms/shared";

import { type ResolvedIdentity, rememberIdentity } from "../auth/identity-resolver";
import { bodyHash } from "./body-hash";
import type { CopilotAvailabilityService } from "./copilot-availability.service";
import { CHANGE_REFUSED, CopilotChangeInterceptor } from "./copilot-change.interceptor";
import type { ClaimedChange, CopilotPendingChangesService } from "./copilot-pending-changes.service";
import { copilotContext, currentCopilotChange } from "./copilot-request-context";

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
  handlerResult?: () => Promise<unknown>;
  /** The route's `@HttpCode`, set on the handler as Nest's decorator sets it. */
  httpCode?: number;
  contentType?: string;
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
    },
    body: "body" in options ? options.body : BODY,
    user: options.authenticated === false ? undefined : user,
  };
  const handlerFn = function create(): void {};
  if (options.httpCode !== undefined) Reflect.defineMetadata(HTTP_CODE_METADATA, options.httpCode, handlerFn);
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
  const next: CallHandler = { handle: () => defer(() => from(handler())) };
  const stored: ClaimedChange = {
    method: "POST",
    path: PATH,
    bodyHash: bodyHash(BODY),
    organizationId: ORG_ID,
    catalogId: "dashboards.create",
    ...options.stored,
  };
  const pending = {
    peek: vi.fn(async () => ({ organizationId: stored.organizationId })),
    claim: vi.fn(async () => stored),
    release: vi.fn(async () => undefined),
    record: vi.fn(async () => undefined),
  };
  const decide = vi.fn(async () => ({ available: true }));
  const interceptor = new CopilotChangeInterceptor(
    pending as unknown as CopilotPendingChangesService,
    { decide } as unknown as CopilotAvailabilityService,
    new Reflector(),
  );
  return { interceptor, context, next, handler, pending, decide, seen };
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

/** A multipart body is parsed after this interceptor, so its hash could not cover the upload: refused. */
export async function aMultipartRequestIs409(): Promise<void> {
  const h = harness({ contentType: "multipart/form-data; boundary=x" });
  expect(await refused(h)).toBeInstanceOf(ConflictException);
  expect(h.pending.peek).not.toHaveBeenCalled();
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
