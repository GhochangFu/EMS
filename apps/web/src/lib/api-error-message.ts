/**
 * Turns an `adminFetch` error into the sentence an author should read
 * (`F2.5`, ADR 0038 decision 10).
 *
 * ## What was actually on screen
 *
 * `adminFetch` throws `new Error(text)` where `text` is the **whole response
 * body**, so refusing to publish an empty template rendered this into the
 * page:
 *
 * ```
 * {"message":"A template with no points would instantiate assets with no
 * telemetry mapping","error":"Bad Request","statusCode":400}
 * ```
 *
 * The service writes a good sentence and the author never sees it. Found by
 * opening the screen — no test in this repository could have: `apps/web`'s
 * Vitest project runs `environment: "node"` over `src/**\/*.test.ts`, so no
 * `.tsx` is reachable, and the detail page's own docblock asserts the opposite
 * ("`adminFetch` throws it unwrapped for exactly this reason").
 *
 * ## Scope
 *
 * The narrow fix. `adminFetch` is shared by 42 call sites across every admin
 * page, and changing what it throws would change all of them — a decision
 * worth making deliberately rather than as a side effect of this item. So the
 * unwrapping happens where the message is rendered, and the same JSON still
 * shows on the other admin pages until that call is made.
 */

/** Nest's error envelope, as far as this needs to care. */
type ErrorEnvelope = {
  message?: unknown;
  error?: unknown;
};

/**
 * The readable message inside an error.
 *
 * Falls back to the raw text whenever the body is not a Nest envelope — a
 * proxy's HTML error page, a gateway timeout, an empty body. A wrong-looking
 * sentence is still better than nothing at all, and hiding the body would make
 * an unexpected failure impossible to diagnose from a screenshot.
 */
export function apiErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  const trimmed = raw.trim();
  if (trimmed === "") {
    return "The request failed.";
  }
  // Only attempt a parse on something that looks like a JSON object. `JSON.parse`
  // accepts bare numbers and quoted strings, so `"404"` would otherwise become
  // the number 404 and fall through to the raw text anyway — via an exception
  // this avoids paying.
  if (!trimmed.startsWith("{")) {
    return trimmed;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return trimmed;
  }

  const envelope = parsed as ErrorEnvelope;
  const { message } = envelope;

  // Zod validation errors arrive as an array of sentences. Joined rather than
  // reduced to the first, because a body can fail two rules at once and fixing
  // one would then reveal the other as a fresh surprise.
  if (Array.isArray(message)) {
    const parts = message.filter((part): part is string => typeof part === "string" && part.trim() !== "");
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  if (typeof message === "string" && message.trim() !== "") {
    return message.trim();
  }

  // `{"error":"Bad Request"}` with no message is not useful, but it is what the
  // server said.
  if (typeof envelope.error === "string" && envelope.error.trim() !== "") {
    return envelope.error.trim();
  }

  return trimmed;
}
