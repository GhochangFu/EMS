import { Catch, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";

/**
 * `F4.108` / **ADR 0060 decision 2** — the one exception filter in this
 * application, and the first one it has ever had.
 *
 * ---
 *
 * ## What it fixes
 *
 * 44 `idParamSchema.parse(id)` calls across 12 controllers sit outside a `try`.
 * `main.ts` registered neither `useGlobalFilters` nor `useGlobalPipes`, so a
 * `ZodError` from any of them reached Nest's default handler and became
 * `500 {"statusCode":500,"message":"Internal server error"}`. Two things are
 * wrong with that: a 500 is recorded as a *server* fault, so a mistyped link
 * pollutes whatever watches for real ones; and the operator who pasted the id
 * cannot tell they mistyped.
 *
 * ## Why the body is `err.flatten()` and not something friendlier
 *
 * ADR 0060 ruling 3. 70 sites in `apps/api/src` already throw
 * `new BadRequestException(err.flatten())`, and `HttpException.createBody`
 * returns an object argument unchanged — so their wire body is
 * `{"formErrors":[…],"fieldErrors":{…}}` with no `message`, `error` or
 * `statusCode`. `apiErrorMessage` (`apps/web/src/lib/api-error-message.ts`,
 * `F4.106`) renders exactly that shape. A second shape here would mean the same
 * failure looked different depending on whether the route happened to have a
 * `try`, so `res.json(exception.flatten())` is written directly rather than
 * through `BadRequestException`, whose `createBody` would be a second thing to
 * keep honest.
 *
 * **A malformed id lands in `formErrors`, unlabelled.** `idParamSchema` is
 * `z.string().uuid()` — a bare string with no object wrapper — so its issue has
 * an empty path and `flatten()` has no field to file it under. That is the
 * mirror image of `F4.115`, where `patchDraftBodySchema` wrapped the value and
 * the message landed in `fieldErrors.draft`. Unlabelled is correct: there is no
 * field to name here and naming one would invent it.
 *
 * ## Why `@Catch(ZodError)` is narrow on purpose
 *
 * The filter cannot tell who supplied the value that failed — `ZodError` carries
 * `issues` with a path *inside* the parsed value and nothing about its origin.
 * 400 is only ever the honest answer because ADR 0060 ruling 2 landed first and
 * routed every stored-data parse through `parseStoredContract`, which raises an
 * `HttpException` carrying 500. Widening this to `@Catch()` would swallow those
 * and report the server's own corrupt row as the caller's bad request;
 * `zod-error.filter.spec.ts` asserts the caught set, and
 * `tests/f4.108-service-parses-are-guarded.test.ts` asserts the other half —
 * that no new stored-data parse quietly starts answering 400.
 *
 * **The invariant a later reader must not break: a `.parse()` on data this
 * application stored belongs behind an explicit server fault, not behind this
 * filter.**
 */
@Catch(ZodError)
export class ZodErrorFilter implements ExceptionFilter<ZodError> {
  catch(exception: ZodError, host: ArgumentsHost): void {
    // A global filter is consulted for every execution context, and this
    // application runs a Socket.IO adapter alongside HTTP. `switchToHttp()` on
    // a ws host yields a client, not a response, so `.status(…)` would throw a
    // TypeError that replaces the original error with a worse one.
    //
    // **What re-throwing does NOT do**, corrected here because the sentence
    // this replaces claimed it: it does not hand the error to
    // `BaseWsExceptionFilter`. `ExceptionsHandler.invokeCustomFilters` calls
    // `filter.func(exception, host)` without wrapping it in a `try`, so a throw
    // from here propagates out of `WsProxy` as a rejected promise rather than
    // reaching the gateway's own error handling. Re-throwing is the least-bad
    // branch — it preserves the original error instead of burying it under a
    // TypeError — not a handoff.
    //
    // **The precondition, recorded because it is what makes that acceptable:**
    // this branch is unreachable today. `apps/api/src` declares no
    // `@SubscribeMessage` handler — `alarms.gateway.ts` and
    // `telemetry.gateway.ts` only emit — so no client payload is parsed in a ws
    // context and no `ZodError` can arise in one. The first handler that parses
    // a client payload must not inherit this silently: it needs a ws-aware
    // answer here, or a `try` of its own.
    if (host.getType() !== "http") {
      throw exception;
    }
    host.switchToHttp().getResponse<Response>().status(HttpStatus.BAD_REQUEST).json(
      exception.flatten(),
    );
  }
}
