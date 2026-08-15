/**
 * `@bms/shared/contracts` — the runtime half of this package (ADR 0030
 * decision 2).
 *
 * **The surface here is provisional.** `F4.23`'s spike is what currently
 * populates it; the implementation replaces `spike.ts` with the real schema
 * modules. The subpath itself is not provisional — it is the boundary decision
 * 2 chose, drawing the line between *contract* (validated, runtime) and
 * *constant* (`ELECTRICAL_POINT_KEYS` and friends, which stay on the root
 * entry) at the import site rather than in a second package.
 *
 * The export entry is declared in `package.json` beside `.` and `./ingest`.
 * An undeclared subpath fails at import under pnpm rather than at build, so
 * the declaration is load-bearing, not tidiness.
 */
export * from "./equality";
export * from "./spike";
