import { expect } from "vitest";

import { resolveMigrationUrl } from "./migrate";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * ADR 0045 decision 3. The migration chain is history and is replayed whole on
 * a fresh deployment, so the runner needs `SUPERUSER`: `0039:33` issues
 * `ALTER ROLE bms_fleet BYPASSRLS`, and `0000` needs the Timescale extension
 * already present.
 *
 * What this catches is the quiet direction of that requirement. A fallback to
 * `DATABASE_URL` would keep working on every existing deployment — the chain is
 * already applied, so nothing replays — and fail only the next time someone
 * brings up an empty database, which is the moment furthest from the change.
 */
export function assertMigrationsDemandTheSuperuserUrl(): void {
  expect(resolveMigrationUrl({ DATABASE_URL_SUPERUSER: "postgres://s/db" })).toBe(
    "postgres://s/db",
  );
}

export function assertMigrationsNeverFallBackToTheOwnerUrl(): void {
  expect(() => resolveMigrationUrl({ DATABASE_URL: "postgres://owner/db" })).toThrow(
    "DATABASE_URL_SUPERUSER",
  );
  expect(() => resolveMigrationUrl({})).toThrow("DATABASE_URL_SUPERUSER");
}
