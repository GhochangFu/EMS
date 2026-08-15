/**
 * The minimum type surface a consumer needs to *hold* a contract schema
 * without depending on `zod` itself.
 *
 * ## Why this exists
 *
 * `apps/web`'s response validator is generic over "some contract schema", which
 * is naturally spelled `ZodTypeAny` — and importing that would make `zod` a
 * direct dependency of `apps/web`, since pnpm's strict linking does not let a
 * package import what it has not declared.
 *
 * That is a **third manifest change**, and ADR 0030's Dependencies section says
 * one: `packages/shared` alone. A new dependency line in `apps/web` is gated by
 * AGENTS.md §9.4 and the ADR does not cover it.
 *
 * Re-exporting the two type aliases from here keeps `zod` an implementation
 * detail of the contracts package, which is what it should have been anyway.
 * A consumer of `@bms/shared/contracts` should not need to know what library
 * validates the shapes, only that they can be validated.
 */
import type { z } from "zod";

/** Any contract schema — the constraint for a function generic over one. */
export type ContractSchema = z.ZodTypeAny;

/** The value a contract schema describes. `z.infer`, without needing `z`. */
export type Contract<S extends ContractSchema> = z.infer<S>;
