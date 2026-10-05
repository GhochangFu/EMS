import { unauthorizedEnvelopeSchema } from "./auth";

/**
 * `F4.203` — the 401 envelope `JwtAuthGuard` sends carries a machine code when
 * the account is deactivated, so the web can say why the session ended. A plain
 * 401 (expired or unverifiable token) carries no code and must still parse.
 *
 * Assertions live here; `auth.test.ts` is the vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const DEACTIVATED = {
  statusCode: 401,
  message: "This account is deactivated",
  error: "Unauthorized",
  code: "account_deactivated",
};

/** A1 — the deactivated body parses and keeps its code. */
export function runTheDeactivatedBodyParsesWithItsCode(): void {
  const parsed = unauthorizedEnvelopeSchema.safeParse(DEACTIVATED);
  assert(parsed.success, "the deactivated 401 body must parse");
  assert(
    parsed.success && parsed.data.code === "account_deactivated",
    "the parsed body must keep code account_deactivated",
  );
}

/** A2 — a plain 401 body with no code parses (an expired token is not deactivated). */
export function runABodyWithoutACodeParses(): void {
  const parsed = unauthorizedEnvelopeSchema.safeParse({
    statusCode: 401,
    message: "Invalid token",
    error: "Unauthorized",
  });
  assert(parsed.success, "a 401 body without a code must parse");
}

/** A3 — a code outside the closed set is refused. */
export function runAnUnknownCodeIsRefused(): void {
  const parsed = unauthorizedEnvelopeSchema.safeParse({ ...DEACTIVATED, code: "other" });
  assert(!parsed.success, "code \"other\" must be refused");
}
