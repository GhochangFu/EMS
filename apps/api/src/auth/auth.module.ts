import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AuthController } from "./auth.controller";
import { AccessControlService } from "./access-control.service";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? "dev-only-change-me",
      signOptions: {
        expiresIn: process.env.JWT_TTL ?? "8h",
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AccessControlService, AuthService, JwtAuthGuard],
  exports: [AccessControlService, JwtAuthGuard],
})
export class AuthModule {}
