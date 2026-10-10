import { expect } from "vitest";

import { CopilotContextMiddleware } from "./copilot-context.middleware";
import { copilotContext, currentCopilotChange } from "./copilot-request-context";

/**
 * `F3.85` PR 4 — the middleware opens one store per request, and a handler
 * awaited after `next()` still sees it, including a write made to it later
 * (what the interceptor does). Vitest entry point: the sibling `.test.ts`.
 */
export async function aHandlerAfterNextSeesTheStore(): Promise<void> {
  const middleware = new CopilotContextMiddleware();
  const seen = await new Promise<unknown>((resolve) => {
    middleware.use(undefined, undefined, () => {
      // The interceptor's write, then an awaited handler.
      const store = copilotContext.getStore();
      if (store) store.change = { via: "copilot", changeId: "c-1" };
      void Promise.resolve()
        .then(() => new Promise((r) => setTimeout(r, 1)))
        .then(() => resolve(currentCopilotChange()));
    });
  });
  expect(seen).toEqual({ via: "copilot", changeId: "c-1" });
}

/** Each request starts empty: a mark on one request does not reach the next. */
export async function eachRequestStartsWithNoChange(): Promise<void> {
  const middleware = new CopilotContextMiddleware();
  const first = await new Promise<unknown>((resolve) =>
    middleware.use(undefined, undefined, () => {
      const store = copilotContext.getStore();
      if (store) store.change = { via: "copilot", changeId: "c-1" };
      resolve(currentCopilotChange());
    }),
  );
  const second = await new Promise<unknown>((resolve) =>
    middleware.use(undefined, undefined, () => resolve(currentCopilotChange())),
  );
  expect(first).toEqual({ via: "copilot", changeId: "c-1" });
  expect(second).toBeNull();
  expect(currentCopilotChange(), "no store outside a request").toBeNull();
}
