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
