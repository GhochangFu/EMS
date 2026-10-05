import { BadRequestException, ConflictException } from "@nestjs/common";
import { expect } from "vitest";

import {
  constraintOf,
  FOREIGN_KEY_VIOLATION,
  translateConstraintErrors,
  UNIQUE_VIOLATION,
} from "./translate-constraint-errors";

/**
 * `F3.78` U6 — `translateConstraintErrors`, moved out of `channels.service.ts`
 * so the grants API (and U8's asset groups) reuse it. One claim per exported
 * function; `translate-constraint-errors.test.ts` is the entry point.
 */

const fail = (code: string) => async () => {
  throw Object.assign(new Error(`pg ${code}`), { code });
};

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to throw");
}

const handlers = {
  onUnique: () => new ConflictException("taken"),
  onForeignKey: () => new BadRequestException("unknown parent"),
};

export async function assertAUniqueViolationIsTheCallersConflict(): Promise<void> {
  const err = await caught(translateConstraintErrors(fail(UNIQUE_VIOLATION), handlers));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as ConflictException).message).toBe("taken");
}

export async function assertAForeignKeyViolationIsTheCallersAnswer(): Promise<void> {
  const err = await caught(translateConstraintErrors(fail(FOREIGN_KEY_VIOLATION), handlers));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as BadRequestException).message).toBe("unknown parent");
}

/** The foreign-key handler sees the raw error, so a caller can tell one constraint from another. */
export async function assertTheForeignKeyHandlerSeesTheRawError(): Promise<void> {
  const seen: unknown[] = [];
  const raw = Object.assign(new Error("fk"), { code: FOREIGN_KEY_VIOLATION, constraint: "x_fkey" });
  await caught(
    translateConstraintErrors(
      async () => {
        throw raw;
      },
      {
        onUnique: handlers.onUnique,
        onForeignKey: (err) => {
          seen.push(err);
          return new BadRequestException("fk");
        },
      },
    ),
  );
  expect(seen).toEqual([raw]);
}

/** A row-level-security refusal (`42501`) is not a constraint the helper answers: it rethrows it. */
export async function assertAnyOtherCodeIsRethrownUnchanged(): Promise<void> {
  const raw = Object.assign(new Error("new row violates row-level security policy"), { code: "42501" });
  const err = await caught(
    translateConstraintErrors(async () => {
      throw raw;
    }, handlers),
  );
  expect(err).toBe(raw);
}

/** Without an `onForeignKey`, a foreign-key violation is rethrown, never guessed at. */
export async function assertAnUnhandledForeignKeyViolationIsRethrown(): Promise<void> {
  const raw = Object.assign(new Error("fk"), { code: FOREIGN_KEY_VIOLATION });
  const err = await caught(
    translateConstraintErrors(
      async () => {
        throw raw;
      },
      { onUnique: handlers.onUnique },
    ),
  );
  expect(err).toBe(raw);
}

export async function assertASuccessfulRunReturnsItsValue(): Promise<void> {
  expect(await translateConstraintErrors(async () => 42, handlers)).toBe(42);
}

/** `F4.211` — `constraintOf` reads the driver's `constraint` field, so a caller can pick the sentence. */
export function assertConstraintOfReadsTheDriverField(): void {
  expect(constraintOf({ code: UNIQUE_VIOLATION, constraint: "x" })).toBe("x");
}

/** `F4.211` — an error without a `constraint` string is `undefined`, never a guess. */
export function assertConstraintOfIsUndefinedWithoutOne(): void {
  expect(constraintOf({ code: UNIQUE_VIOLATION })).toBeUndefined();
}
