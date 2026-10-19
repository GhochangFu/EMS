/**
 * `looksLikeCredential` lives in `security/credential-detect.ts` since F3.24b
 * (ADR 0103): the discovery collector runs in the worker closure, which
 * `tests/f4.24-worker-imports-no-api-loop.test.ts` keeps free of `llm/`. This
 * path re-exports it so every existing importer and its spec keep working.
 * The rationale for the predicate's shape is documented at its new home.
 */
export { looksLikeCredential } from "../security/credential-detect";
