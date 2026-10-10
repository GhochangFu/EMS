import { AsyncLocalStorage } from "node:async_hooks";

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5, drafter choice 4 — which copilot
 * change, if any, the current request applies.
 *
 * `CopilotContextMiddleware` opens a store with `change: null` around every
 * HTTP request. `CopilotChangeInterceptor` **mutates** that store once it has
 * claimed a pending change, before the handler runs, and
 * `MasterDataAuditService` reads it to mark the audit row `via: "copilot"`.
 *
 * The interceptor mutates rather than opening a new store with `als.run`:
 * Nest subscribes to `next.handle()` after `intercept` returns, so a store
 * opened around `next.handle()` would be gone when the handler runs.
 */
export type CopilotChangeMark = { via: "copilot"; changeId: string };

export type CopilotRequestStore = { change: CopilotChangeMark | null };

export const copilotContext = new AsyncLocalStorage<CopilotRequestStore>();

/** The change this request applies, or `null` — also `null` outside any request. */
export function currentCopilotChange(): CopilotChangeMark | null {
  return copilotContext.getStore()?.change ?? null;
}

/**
 * An audit payload with the copilot mark added when this request applies a
 * copilot change; the payload unchanged otherwise (`undefined` and `null`
 * stay as they are).
 */
export function withCopilotMark(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const change = currentCopilotChange();
  if (change === null) return payload;
  return { ...(payload ?? {}), via: change.via, changeId: change.changeId };
}
