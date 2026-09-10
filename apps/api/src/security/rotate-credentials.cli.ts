import "../load-env";

import { NestFactory } from "@nestjs/core";
import type pg from "pg";

import { AUTH_POOL, FLEET_POOL, TENANT_POOL } from "../database/database.tokens";
import { CredentialRotationModule } from "./credential-rotation.module";
import { CredentialRotationService } from "./credential-rotation.service";

/**
 * `E8.4` / ADR 0062 decision 6 — `pnpm --filter api rotate-credentials`.
 *
 * Opens a standalone Nest context on `CredentialRotationModule`, runs the walk
 * on the fleet pool, writes the report to stdout as JSON, and exits non-zero
 * when any row failed. Wiring like `main.ts`, and ungated for the same reason
 * (§4.6): the walk itself is what `credential-rotation.integration.spec.ts`
 * proves, and the running-container run in the plan's §12 is this file's
 * check.
 *
 * **The three pools are ended by hand.** `DatabaseModule`'s providers are
 * bare `pg.Pool` factories with no `onModuleDestroy`, so `app.close()` alone
 * leaves the fleet pool's connection open and the process never exits.
 *
 * `abortOnError: false`: Nest's default on an initialisation error is
 * `process.abort()`, a SIGABRT with no report. A dead key window throws from
 * `CredentialCryptoService`'s constructor (decision 5, Amendment 1) before any
 * pool has connected, so the rejection is caught here, named on stderr, and
 * the process exits 1 on its own — nothing is holding the event loop.
 *
 * `process.stdout.write`, not `console.log` — `scripts/checks/style-hygiene.mjs`.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(CredentialRotationModule, {
    logger: ["error", "warn"],
    abortOnError: false,
  });
  try {
    const report = await app.get(CredentialRotationService).run();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.failures.length > 0 ? 1 : 0;
  } finally {
    const pools = [AUTH_POOL, TENANT_POOL, FLEET_POOL].map((token) => app.get<pg.Pool>(token));
    await app.close();
    await Promise.all(pools.map((pool) => pool.end()));
  }
}

main().catch((err: unknown) => {
  const name = err instanceof Error ? err.name : "Error";
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`rotate-credentials: ${name}: ${message}\n`);
  process.exitCode = 1;
});
