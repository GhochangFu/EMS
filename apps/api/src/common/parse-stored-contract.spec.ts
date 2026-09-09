import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import { expect, vi } from "vitest";
import { z } from "zod";

import { parseStoredContract } from "./parse-stored-contract";

/**
 * `F4.108` / ADR 0060 ruling 2 — assertions only (ADR 0014, §4.6).
 * `parse-stored-contract.test.ts` is the Vitest entry point.
 *
 * ## The schema these assertions parse against is chosen, not arbitrary
 *
 * `z.enum(...)` and `.strict()` are the two zod constructs that put **caller
 * data** into the issue message: an enum failure reads *"Invalid enum value.
 * Expected 'alpha' | 'beta', received 's3cr3t-value'"* and a strict object
 * failure reads *"Unrecognized key(s) in object: 'leakedKey'"*. A plain
 * `z.string()` failure says only *"Expected string, received number"* and would
 * make the §4.3 assertions below pass against an implementation that pasted
 * `err.message` straight into the exception. So the fixture is built to make
 * the leak possible, and then asserts it does not happen.
 */
const LEAKY_SCHEMA = z.object({ kind: z.enum(["alpha", "beta"]) }).strict();

/** Both halves are distinctive strings, so a substring test cannot be a coincidence. */
const CORRUPT_ROW = { kind: "s3cr3t-value", leakedKey: "leaked-value" };

/** One of the eight literals `StoredContractContext` declares. */
const CONTEXT = "dashboard_templates.publish.content" as const;

/** Proof the fixture leaks when nothing stops it — a precondition, not a claim. */
function assertTheFixtureCanLeak(): void {
  const result = LEAKY_SCHEMA.safeParse(CORRUPT_ROW);
  expect(result.success, "the fixture must fail to parse or every assertion below is vacuous").toBe(
    false,
  );
  const raw = result.success ? "" : result.error.message;
  expect(
    raw.includes("s3cr3t-value") && raw.includes("leakedKey"),
    "zod's own message must carry the value AND the key, or the §4.3 assertions prove nothing",
  ).toBe(true);
}

export function assertAValidStoredValueIsReturned(): void {
  expect(parseStoredContract(LEAKY_SCHEMA, { kind: "alpha" }, CONTEXT)).toEqual({ kind: "alpha" });
}

/**
 * The observable change ruling 2 buys: what escapes the eight sites stops being
 * a `ZodError`.
 *
 * These sites answer 500 before and after, so the status is not the change —
 * the **type** is. `ZodErrorFilter` catches `ZodError` and answers 400; an
 * `HttpException` carrying 500 passes through it untouched. That is why this
 * commit has to land first.
 *
 * **A `thrown instanceof ZodError === false` check stood here and was removed on
 * review** (§4.6 decoration). `HttpException` and `ZodError` are disjoint
 * prototype chains — `ZodError` extends `Error` directly — so nothing can be an
 * instance of both, and that assertion could not fail while the
 * `toBeInstanceOf(HttpException)` above it passed. Its reason moved into that
 * line's message, which is where the claim actually lives.
 */
export function assertAContractViolationThrowsAServerFaultAndNotAZodError(): void {
  let thrown: unknown;
  try {
    parseStoredContract(LEAKY_SCHEMA, CORRUPT_ROW, CONTEXT);
  } catch (err) {
    thrown = err;
  }
  expect(
    thrown,
    "a corrupt stored row must throw an HttpException. A bare ZodError — which is not an " +
      "HttpException — would be reclassified as a 400 by ZodErrorFilter, and ADR 0060 ruling 2 " +
      "exists to stop exactly that.",
  ).toBeInstanceOf(HttpException);
  expect((thrown as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
}

/** §4.3 — the refusal names the contract that broke and nothing out of the row. */
export function assertTheMessageNamesTheContextAndEchoesNothingFromTheValue(): void {
  assertTheFixtureCanLeak();

  let thrown: HttpException | undefined;
  try {
    parseStoredContract(LEAKY_SCHEMA, CORRUPT_ROW, CONTEXT);
  } catch (err) {
    thrown = err as HttpException;
  }
  const wire = JSON.stringify(thrown?.getResponse() ?? {});

  expect(wire, "the 500 must say which contract broke, or the fault is not actionable").toContain(
    CONTEXT,
  );
  expect(
    /s3cr3t-value|leaked-value|leakedKey/.test(wire),
    `§4.3 — the body echoes the stored value or one of its keys:\n${wire}`,
  ).toBe(false);
}

/** §9.6 — the log line carries the authored literal and zod's closed code vocabulary. */
export function assertTheLogCarriesTheContextAndNoRowData(): void {
  assertTheFixtureCanLeak();

  const spy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  try {
    try {
      parseStoredContract(LEAKY_SCHEMA, CORRUPT_ROW, CONTEXT);
    } catch {
      // the throw is assertAContractViolationThrowsAServerFaultAndNotAZodError's claim
    }
    const logged = spy.mock.calls.map((call) => JSON.stringify(call)).join("\n");

    expect(logged, "a server fault nobody logged is a server fault nobody can diagnose").toContain(
      CONTEXT,
    );
    expect(logged, "the issue codes are a closed zod vocabulary, so they are safe and useful").toContain(
      "unrecognized_keys",
    );
    expect(
      /s3cr3t-value|leaked-value|leakedKey/.test(logged),
      `§9.6 — the log echoes the stored value or one of its keys:\n${logged}`,
    ).toBe(false);
  } finally {
    spy.mockRestore();
  }
}

/**
 * A `RangeError` from a stack-safe walk (`F4.115`) is not a contract violation,
 * and mislabelling it would send the next reader to the wrong schema.
 */
export function assertANonZodThrowPassesThroughUnchanged(): void {
  const boom = new RangeError("Maximum call stack size exceeded");
  const exploding = {
    parse: (): never => {
      throw boom;
    },
  };
  expect(() => parseStoredContract(exploding, CORRUPT_ROW, CONTEXT)).toThrow(boom);
}
