import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

import type { JwtPayload, LoginResponse, UserRole } from "@bms/shared";
import { users } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { DRIZZLE } from "../database/database.tokens";
import { isLocalLoginEnabled } from "./auth-mode";
import type { LoginBody } from "./login.schema";

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Validates credentials against `bms.users` and returns a signed JWT.
   *
   * Refused outright whenever the API is configured for OIDC (F4.12) — the
   * check runs before any credential lookup so a disabled endpoint cannot be
   * used as an account or password oracle.
   */
  async login(body: LoginBody): Promise<LoginResponse> {
    if (!isLocalLoginEnabled(process.env)) {
      throw new UnauthorizedException(
        "Local password login is disabled because this API is configured for OIDC. Sign in through the identity provider.",
      );
    }

    const row = await this.db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        displayName: users.displayName,
        role: users.role,
      })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    const user = row[0];
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const role = user.role as UserRole;
    await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.displayName,
      role,
    };

    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: process.env.JWT_TTL ?? "8h",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role,
      },
    };
  }
}
