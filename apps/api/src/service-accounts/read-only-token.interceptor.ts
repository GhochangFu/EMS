import { type CallHandler, type ExecutionContext, ForbiddenException, Injectable, type NestInterceptor } from "@nestjs/common";
import type { Observable } from "rxjs";

import { serviceTokenOf } from "../auth/jwt-auth.guard";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * `F4.17` / ADR 0125 decision 12 — a token issued `read_only` may read and
 * nothing else: any other method is a 403 `token_read_only` before the
 * handler runs, so no route needs to know about it.
 *
 * **An interceptor, not the guard**: `JwtAuthGuard` answers 401 and never 403
 * (`F4.52`, `tests/f4.52-auth-failure-status.test.ts`) — the SPA clears its
 * session on 401 only. A read-only refusal is not an authentication failure.
 * Registered globally (`APP_INTERCEPTOR`), so it runs before every
 * controller-scoped interceptor, `FileInterceptor` included: a refused upload
 * is never buffered.
 */
@Injectable()
export class ReadOnlyServiceTokenInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === "http") {
      const req = context.switchToHttp().getRequest<{ method?: string; user?: unknown }>();
      const facts = req.user && typeof req.user === "object" ? serviceTokenOf(req.user) : null;
      if (facts?.readOnly && !READ_METHODS.has((req.method ?? "GET").toUpperCase())) {
        throw new ForbiddenException({
          statusCode: 403,
          message: "This token is read-only",
          error: "Forbidden",
          code: "token_read_only",
        });
      }
    }
    return next.handle();
  }
}
