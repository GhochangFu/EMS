import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AccessControlModule } from "./access-control.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * `F3.11` / ADR 0064 Amendment 1 A1: `AccessControlService` moved to the
 * `@Global()` `AccessControlModule`, imported here, so the worker can resolve
 * it without this module's `JwtModule` and `AuthController`. Every importer
 * of `AuthModule` still sees the service through the global scope.
 */
@Global()
@Module({
  imports: [
    AccessControlModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? "dev-only-change-me",
      signOptions: {
        expiresIn: process.env.JWT_TTL ?? "8h",
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
