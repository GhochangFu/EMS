import {
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { catchError, concatMap, from, type Observable, throwError } from "rxjs";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { recalledIdentity } from "../auth/identity-resolver";
import { bodyHash } from "./body-hash";
import { COPILOT_ROLES } from "./copilot-availability";
import { CopilotAvailabilityService } from "./copilot-availability.service";
import { clientOnlyKeysFor } from "./copilot-client-only";
import { CopilotPendingChangesService, type PendingChangeOutcome } from "./copilot-pending-changes.service";
import { copilotContext } from "./copilot-request-context";

/** The header, lower-cased as Node delivers it. */
const HEADER = "x-copilot-change";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One message for every refusal that could otherwise tell a caller which check failed. */
export const CHANGE_REFUSED = "This copilot change cannot be applied";
export const COPILOT_UNAVAILABLE = "The copilot is not available here";

type CopilotRequest = {
  method: string;
  path: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  user?: JwtPayload;
};

/** The status the client sees for an error — the global `ZodErrorFilter` answers a `ZodError` with 400. */
export function statusOf(err: unknown): number {
  if (err instanceof HttpException) return err.getStatus();
  if (err instanceof ZodError) return 400;
  return 500;
}

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5 — applies a confirmed copilot change.
 * Global (`APP_INTERCEPTOR` in `CopilotModule`); a request without the
 * `X-Copilot-Change` header passes through untouched.
 *
 * With the header, in the ADR's order — the caller first, then the claim:
 *
 * 1. The header is a uuid and the request is authenticated, else 409.
 * 2. The caller's role (read from the database this request, by the guard)
 *    is one of the four copilot roles, else 403.
 * 3. The request carries no query string (no release-1 catalog route reads
 *    one), else 409.
 * 4. The change is this user's, pending and unexpired (a read), else 409.
 * 5. The copilot is available to the caller in the change's organization
 *    now, else 403 — the row stays `pending`.
 * 6. The atomic claim, `pending` → `applying`, else 409.
 * 7. The method, the raw path (`req.path`: the global prefix included, not
 *    decoded) and the body's canonical hash match the stored change, else the
 *    claim is released and 409.
 * 8. The request's copilot store is marked, so every audit row the handler
 *    writes carries `via: "copilot"` and the change id; the outcome is
 *    recorded (`applied` with the resource id, or `failed` with the status
 *    the client saw) before the response leaves.
 *
 * A record that fails is logged and does not change the response: the row
 * stays `applying`, and the sweep resolves it from the audit log.
 */
@Injectable()
export class CopilotChangeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CopilotChangeInterceptor.name);

  constructor(
    private readonly pending: CopilotPendingChangesService,
    private readonly availability: CopilotAvailabilityService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest<CopilotRequest>();
    const header = req.headers[HEADER];
    if (header === undefined) return next.handle();

    if (typeof header !== "string" || !UUID.test(header) || req.user === undefined) {
      throw new ConflictException(CHANGE_REFUSED);
    }
    const changeId = header;
    const identity = recalledIdentity(req.user);
    if (identity === null || !(COPILOT_ROLES as readonly string[]).includes(identity.role)) {
      throw new ForbiddenException(COPILOT_UNAVAILABLE);
    }
    if (req.originalUrl.includes("?")) throw new ConflictException(CHANGE_REFUSED);

    const store = copilotContext.getStore();
    if (store === undefined) {
      // The middleware did not run: an audit row would lose its mark, so fail closed before claiming.
      throw new InternalServerErrorException("The copilot request context is missing");
    }

    const peeked = await this.pending.peek(identity.id, changeId);
    if (peeked === null) throw new ConflictException(CHANGE_REFUSED);
    const decision = await this.availability.decide(identity, peeked.organizationId);
    if (!decision.available) throw new ForbiddenException(COPILOT_UNAVAILABLE);

    const claimed = await this.pending.claim(identity.id, changeId);
    if (claimed === null) throw new ConflictException(CHANGE_REFUSED);
    const hash = bodyHash(req.body ?? {}, clientOnlyKeysFor(claimed.catalogId));
    if (req.method !== claimed.method || req.path !== claimed.path || hash !== claimed.bodyHash) {
      await this.pending.release(identity.id, changeId);
      throw new ConflictException(CHANGE_REFUSED);
    }

    store.change = { via: "copilot", changeId };
    const success =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === "POST" ? 201 : 200);
    const record = (outcome: PendingChangeOutcome, status: number, resourceId: string | null) =>
      this.pending.record(identity.id, changeId, outcome, status, resourceId).catch((err: unknown) => {
        this.logger.warn(
          `could not record copilot change ${changeId} as ${outcome}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    return next.handle().pipe(
      concatMap((body: unknown) => {
        const id = body !== null && typeof body === "object" ? (body as { id?: unknown }).id : undefined;
        return from(record("applied", success, typeof id === "string" ? id : null).then(() => body));
      }),
      catchError((err: unknown) => from(record("failed", statusOf(err), null)).pipe(concatMap(() => throwError(() => err)))),
    );
  }
}
