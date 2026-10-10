import { Injectable, type NestMiddleware } from "@nestjs/common";

import { copilotContext } from "./copilot-request-context";

/**
 * `F3.85` PR 4 — opens the per-request copilot store (`change: null`) around
 * the rest of the request. Applied to every route by `CopilotModule.configure`;
 * see `copilot-request-context.ts` for why the interceptor mutates this store
 * rather than opening its own.
 */
@Injectable()
export class CopilotContextMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: () => void): void {
    copilotContext.run({ change: null }, () => next());
  }
}
