/**
 * The error `adminFetch` throws, carrying the HTTP status it was refused with
 * (`F4.63`).
 *
 * ## Why a subclass, and why that is not the 42-call-site change it looks like
 *
 * `F2.5` recorded that `adminFetch` is shared by 42 call sites and that
 * changing what it throws "would change all of them", so `F4.52` deliberately
 * left the chokepoint alone and unwrapped the message at the render site
 * instead. That reasoning was about a *breaking* change to the thrown value.
 *
 * This is not one. `ApiError extends Error`, `message` is byte-identical to
 * what `new Error(text)` produced, and every `instanceof Error`, `.message`
 * read and `apiErrorMessage()` call keeps working untouched. The status is
 * added, nothing is taken away — so the 42 call sites are not a cost here, and
 * the owner ruled it on that basis on 2026-08-22.
 *
 * ## Why it lives in `lib/` rather than beside `adminFetch`
 *
 * `apps/web`'s Vitest project runs `environment: "node"` over
 * `src/**\/*.test.ts`, and the coverage `include` stops at `src/lib/**`.
 * `api/admin/client.ts` reads `import.meta.env` at module scope, so importing
 * it from a spec drags Vite's environment into a node test. A module with no
 * imports is reachable by both gates; `client.ts` imports this instead.
 *
 * Deliberately **not** in `@bms/shared`. The API does not throw this — it
 * throws Nest exceptions — so a shared type would imply a contract that does
 * not exist, and ADR 0030 governs that package.
 */
export class ApiError extends Error {
  /** The HTTP status of the refused response. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    // `name` is not automatic on a subclass and is what a logged error shows.
    this.name = "ApiError";
    this.status = status;
  }
}
