import { Global, Module } from "@nestjs/common";

import { AccessControlService } from "./access-control.service";

/**
 * `F3.11` / ADR 0064 Amendment 1 A1 — `AccessControlService` on its own,
 * provider-only, so the worker can resolve `ChannelsService` (which injects
 * it, `channels.service.ts`) without `AuthModule`.
 *
 * Before this carve `AuthModule` was the only provider of the service, and
 * `AuthModule` also loads `JwtModule.register({ global: true })` and mounts
 * `AuthController`. A `WorkerModule` that imported it would have served
 * `/auth` on `WORKER_PORT` — a host-published port — without `main.ts`'s
 * global filter and prefix, on the `dev-only-change-me` JWT fallback.
 *
 * `@Global()` for the same reason `AuthModule` was: 57 files inject the
 * service and none of their modules import anything for it. `AuthModule`
 * imports this module, so every existing importer resolves the same provider
 * through the global scope; no behaviour changes. The service's own
 * dependencies are the two drizzle tokens from the `@Global()`
 * `DatabaseModule`, so this module's closure is four files and reaches none
 * of the fence's forbidden ones (`tests/f4.24-worker-imports-no-api-loop.test.ts`).
 */
@Global()
@Module({
  providers: [AccessControlService],
  exports: [AccessControlService],
})
export class AccessControlModule {}
