import {
  createUserBodySchema,
  temporaryPasswordBodySchema,
  updateUserBodySchema,
} from "@bms/shared";
import type { CreateUserBody, TemporaryPasswordBody, UpdateUserBody } from "@bms/shared";

/**
 * `F3.78` (ADR 0089 decision 1) — the users API request bodies.
 *
 * **Re-exported from `@bms/shared`, not restated here** (§4.8, ADR 0030): the
 * web client parses the same schemas. The refinements live in
 * `packages/shared/src/contracts/users.ts`, each followed by its `.describe()`
 * (ADR 0029 decision 10).
 */
export { createUserBodySchema, temporaryPasswordBodySchema, updateUserBodySchema };
export type { CreateUserBody, TemporaryPasswordBody, UpdateUserBody };
