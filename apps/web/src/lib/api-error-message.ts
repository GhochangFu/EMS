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
  /** A Zod `flatten()` thrown verbatim — see `flattenedZodMessage`. */
  formErrors?: unknown;
  fieldErrors?: unknown;
};

/** The non-blank strings of an unknown array, trimmed. */
function usableStrings(values: readonly unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => value.trim());
}

/**
 * A Zod `flatten()` thrown verbatim, as one sentence — or `null`.
 *
 * The four onboarding routes this row was filed for
 * `throw new BadRequestException(err.flatten())`, and
 * `HttpException.createBody` returns an object argument unchanged, so the wire
 * body is `{"formErrors":[…],"fieldErrors":{…}}` with **no** `message`, `error`
 * or `statusCode` at all. Before `F4.106` that fell through to the raw text and
 * the whole JSON object was what the operator read.
 *
 * **Those four are not the only ones, and reading this paragraph as if they
 * were is what made the branch below look like a change for nobody.** Measured
 * on this branch, the same throw appears 73 times in `apps/api/src` — 71 across
 * 26 controllers and 2 in `asset-templates-stock.service.ts`. See the comment
 * on the branch itself.
 *
 * `formErrors` first and unlabelled — those are the whole-body complaints and
 * naming a field there would invent one. Then each `fieldErrors` key that has
 * at least one usable message, in `Object.keys` order.
 *
 * **What this shape cannot say, stated rather than implied.** `z.flatten()`
 * collapses a nested path to its top-level key, so `PATCH :id/draft` refusing an
 * over-cap array reports the field `draft` and cannot name the offending
 * element. That is `F4.103`'s recorded residual; naming `draft` is the most
 * this body carries, and this function does not manufacture more.
 */
function flattenedZodMessage(envelope: ErrorEnvelope): string | null {
  const parts = Array.isArray(envelope.formErrors) ? usableStrings(envelope.formErrors) : [];

  const { fieldErrors } = envelope;
  if (typeof fieldErrors === "object" && fieldErrors !== null && !Array.isArray(fieldErrors)) {
    for (const [field, messages] of Object.entries(fieldErrors)) {
      const usable = Array.isArray(messages) ? usableStrings(messages) : [];
      if (usable.length > 0) {
        parts.push(`${field}: ${usable.join(" ")}`);
      }
    }
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

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

  // LAST, and the placement is the whole safety argument for a function 24
  // modules import: everything above still wins — the `message` branch and the
  // `error` branch — so this branch fires only on bodies that used to return
  // raw JSON. Both halves are asserted rather than asserted-in-a-comment; see
  // `runEnvelopeMessageWinsOverFieldErrorsTests` and
  // `runEnvelopeErrorWinsOverFieldErrorsTests`. The second was added by the
  // review pass, which measured that before it existed, moving this branch
  // above `error` alone left the whole `apps/web` suite green — half the claim
  // this comment makes was gated by nothing.
  //
  // **It is not "a change for none", and that sentence was wrong by about 17x.**
  // Measured on this branch: `throw new BadRequestException(err.flatten())`
  // appears at 71 sites in 26 controllers (`rules` 9, `asset-templates` 7,
  // `dashboard-templates` 5, and on down), plus 2 more in
  // `asset-templates-stock.service.ts` — not the four onboarding routes named
  // above. So this branch changes the rendered refusal text repo-wide, at 46
  // `apiErrorMessage` call sites across 24 modules, while editing none of them.
  //
  // What is true is that the change is **non-increasing**. The rendered
  // sentence is never longer than the raw body it replaces, because every part
  // it keeps costs more inside the JSON than outside it: a message loses its
  // two quotes and any escaping, a field name loses `":["` and `"]` and gains
  // only `": "`, and the `{"formErrors":[],"fieldErrors":{}}` wrapper is
  // dropped whole. Measured over 15 bodies — twelve built by parsing
  // adversarial input through the four real onboarding schemas, three
  // hand-built to minimise the JSON overhead — the output was strictly shorter
  // in all 15. The closest was a hand-built single-field body carrying a
  // 100,000-character message: 100,003 rendered against 100,026 raw.
  const flattened = flattenedZodMessage(envelope);
  if (flattened !== null) {
    return flattened;
  }

  return trimmed;
}
