import { Module } from "@nestjs/common";

import { OpenApiController, OpenApiDocumentStore } from "./openapi.controller";

/**
 * `F4.20` / ADR 0029 — the guarded document endpoint.
 *
 * `JwtAuthGuard` is not provided here: `AuthModule` is `@Global()` and exports
 * it, which is how the other 29 call sites reach it.
 */
@Module({
  controllers: [OpenApiController],
  providers: [OpenApiDocumentStore],
  exports: [OpenApiDocumentStore],
})
export class OpenApiModule {}
