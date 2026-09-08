/**
 * The API error unwrapper (`F2.5`, ADR 0038).
 *
 * The first assertion is the defect verbatim, copied from what was actually on
 * screen during the section 7 browser pass.
 */
import { apiErrorMessage } from "./api-error-message";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The body that was rendered to the author, character for character. */
export function runNestEnvelopeTests(): void {
  const body =
    '{"message":"A template with no points would instantiate assets with no telemetry mapping","error":"Bad Request","statusCode":400}';
  const shown = apiErrorMessage(new Error(body));

  assert(
    shown === "A template with no points would instantiate assets with no telemetry mapping",
    `expected the sentence, got "${shown}"`,
  );
  // The three things the author must never read.
  for (const leak of ["statusCode", '"message"', "Bad Request"]) {
    assert(!shown.includes(leak), `the envelope leaked "${leak}" into the message: ${shown}`);
  }

  // `F4.52`. The 403 envelope, character for character as the running stack
  // returned it to `phe-admin@bms.local` opening an out-of-scope template by
  // URL. This is the body ADR 0038 decision 10 depends on, and it is the case
  // that decides whether the author reads the sentence or the word "Forbidden":
  // `error` is a plausible-looking fallback, so a rewrite that preferred it
  // would still produce something readable and still be wrong.
  const forbidden = apiErrorMessage(
    new Error(
      '{"message":"Template is outside your access scope","error":"Forbidden","statusCode":403}',
    ),
  );
  assert(
    forbidden === "Template is outside your access scope",
    `D10's residual case must render the service's sentence, got "${forbidden}"`,
  );
  for (const leak of ["Forbidden", "statusCode", "403"]) {
    assert(!forbidden.includes(leak), `the 403 envelope leaked "${leak}": ${forbidden}`);
  }
}

/** A Zod array message keeps every sentence, not just the first. */
export function runArrayMessageTests(): void {
  const shown = apiErrorMessage(
    new Error('{"message":["code is required","name is too long"],"statusCode":400}'),
  );
  assert(shown.includes("code is required"), `lost the first sentence: ${shown}`);
  assert(
    shown.includes("name is too long"),
    `lost the second — fixing one rule would then reveal the other as a surprise: ${shown}`,
  );
}

/**
 * Anything that is not a Nest envelope survives untouched.
 *
 * The fallback matters as much as the unwrapping. A proxy's HTML page or a
 * gateway's plain text is the only clue an unexpected failure leaves, and
 * swallowing it would make a screenshot undiagnosable.
 */
export function runFallbackTests(): void {
  for (const raw of [
    "admin /asset-templates 502",
    "<html><body>504 Gateway Timeout</body></html>",
    "Failed to fetch",
    "{not json at all",
  ]) {
    assert(
      apiErrorMessage(new Error(raw)) === raw,
      `a non-envelope body must pass through unchanged: ${raw}`,
    );
  }

  // An envelope with no usable message falls back to `error`, then to the body.
  assert(
    apiErrorMessage(new Error('{"error":"Bad Request","statusCode":400}')) === "Bad Request",
    "an envelope with no message falls back to error",
  );
  assert(
    apiErrorMessage(new Error('{"statusCode":400}')) === '{"statusCode":400}',
    "an envelope with neither message nor error shows what the server said",
  );

  // A blank or missing cause must still render something actionable rather
  // than an empty red box.
  for (const empty of [new Error(""), new Error("   "), null, undefined]) {
    const shown = apiErrorMessage(empty);
    assert(shown.trim() !== "", `an empty cause must not render blank, got "${shown}"`);
  }
}

/**
 * `F4.106` C1 — the Zod `flatten()` four onboarding routes throw verbatim.
 *
 * The body is `F4.103`'s `PATCH :id/draft` refusal, character for character as
 * `scratchpad/f4106-probe-envelope.mjs` built it from the real
 * `BadRequestException`. It carries no `message`, no `error` and no
 * `statusCode`, so before this the operator read the JSON object itself.
 *
 * **Equality, and no separate leak loop.** The plan asked for a second half
 * asserting the output holds none of `fieldErrors`, `formErrors` or `{`,
 * because the raw body contains `Array must contain at most 100 element(s)` as
 * a substring and a *substring* presence assertion would survive the mutation.
 * `===` already excludes every leak, so the loop would be an assertion no
 * mutation can reach on its own — the shape §4.6 exists to keep out. The page
 * spec keeps its loop, because `toHaveTextContent` really is a substring match
 * and the loop there is what reddens.
 */
export function runZodFlattenFieldErrorTests(): void {
  const shown = apiErrorMessage(
    new Error(
      '{"formErrors":[],"fieldErrors":{"draft":["Array must contain at most 100 element(s)"]}}',
    ),
  );
  assert(
    shown === "draft: Array must contain at most 100 element(s)",
    `expected the field and its message, got "${shown}"`,
  );
}

/**
 * `F4.106` C2 — a whole-body complaint carries no field, and none is invented.
 *
 * `z.object(...).parse([])` produces exactly this: `formErrors` populated and
 * `fieldErrors` empty. Labelling it with a field name would name a field the
 * server never mentioned.
 */
export function runZodFlattenFormErrorTests(): void {
  const shown = apiErrorMessage(
    new Error('{"formErrors":["Expected object, received array"],"fieldErrors":{}}'),
  );
  assert(
    shown === "Expected object, received array",
    `a formErrors-only body must render its own sentence, got "${shown}"`,
  );
}

/**
 * `F4.106` C3 — the new branch regresses no existing caller.
 *
 * 22 components import this function, and the argument that the change is safe
 * for all of them is entirely about **where** the branch sits: last, so every
 * body that already produced a sentence still does. That is a claim about other
 * people's screens, so it is asserted rather than written in a comment — moving
 * the branch above the `message` branch reddens this and nothing else.
 */
export function runEnvelopeMessageWinsOverFieldErrorsTests(): void {
  const shown = apiErrorMessage(
    new Error(
      '{"message":"Validation failed","error":"Bad Request","statusCode":400,"fieldErrors":{"code":["Required"]}}',
    ),
  );
  // Equality, so "and does not name the field" needs no second assertion —
  // see `runZodFlattenFieldErrorTests` for why the loop is left out here.
  assert(shown === "Validation failed", `the envelope message must still win, got "${shown}"`);
}

/**
 * `F4.106` C4 — a flatten with nothing usable in it still shows the body.
 *
 * The fallback is the point of the whole function: an empty `fieldErrors`, or a
 * key whose message list is empty, says nothing an operator can act on. Showing
 * the server's own body beats inventing a generic line that hides it.
 */
export function runEmptyZodFlattenTests(): void {
  for (const raw of ['{"formErrors":[],"fieldErrors":{}}', '{"fieldErrors":{"a":[]}}']) {
    const shown = apiErrorMessage(new Error(raw));
    assert(shown === raw, `an unusable flatten must show what the server said, got "${shown}"`);
  }
}

/**
 * A non-`Error` throw is handled.
 *
 * `adminFetch` always throws an `Error`, but a mutation's `onError` is typed
 * loosely and a rejected promise can carry anything.
 */
export function runNonErrorTests(): void {
  assert(apiErrorMessage("plain string").trim() !== "", "a string cause renders");
  assert(
    apiErrorMessage('{"message":"from a string throw"}') === "from a string throw",
    "a string cause is unwrapped the same way",
  );
}
