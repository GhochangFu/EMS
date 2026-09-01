/**
 * `@bms/shared/contracts` — the runtime half of this package (ADR 0030
 * decision 2).
 *
 * These schemas ARE the response contracts. Every corresponding type on the
 * root entry is `z.infer` of one of them, so there is no second description to
 * drift — ADR 0029 decision 1's thesis applied to the response side.
 *
 * **The subpath does not reach `apps/api`, and that is measured, not assumed.**
 * `apps/api` compiles with `moduleResolution: "node"` (node10), which ignores
 * the package `exports` map entirely; `tsc` reports *"There are types at
 * …/dist/contracts/index.d.ts, but this result could not be resolved under your
 * current 'moduleResolution' setting."* Node's own runtime resolution honours
 * `exports` and works, which is the dangerous half — it would have compiled
 * nowhere and run fine. `index.ts` therefore re-exports everything here, the
 * same workaround `./ingest` already uses and for the same documented reason.
 * See ADR 0030 Amendment 2.
 *
 * So: `apps/web` may import `@bms/shared/contracts` and get the contract/
 * constant separation decision 2 wanted. `apps/api` imports from `@bms/shared`
 * until its module resolution changes, which is its own decision.
 */
export * from "./admin";
export * from "./auth";
export * from "./dashboard";
export * from "./dashboard-builder";
export * from "./dashboard-templates";
export * from "./envelopes";
export * from "./health";
export type * from "./schema-types";
export * from "./notifications";
export * from "./onboarding";
export * from "./operations";
export * from "./telemetry-entry";
export * from "./telemetry-import";
export * from "./template-lifecycle";
export type { Assignable, Measured, Strict } from "./equality";
