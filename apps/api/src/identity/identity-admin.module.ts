import { Module } from "@nestjs/common";
import type { UserRole } from "@bms/shared";

import {
  IdentityAdminError,
  KeycloakIdentityAdminClient,
  type IdentityAdmin,
  type NewIdentityUser,
} from "./identity-admin.client";
import { buildIdentityAdminConfig } from "./identity-admin.config";

/**
 * `F3.78` (ADR 0089 decision 5) — the `IDENTITY_ADMIN` provider.
 *
 * When `buildIdentityAdminConfig` returns `null`, the token resolves to
 * {@link NotConfiguredIdentityAdmin}: every write rejects with
 * `not_configured`, which the users API (U5) answers as 503 "user
 * administration is not configured" while its reads keep working. The module
 * still boots, so an unconfigured host is degraded, not down.
 */

/**
 * Nest injection token. A token rather than the interface type: Nest reflects
 * `Object` for an interface and cannot find a provider for it.
 */
export const IDENTITY_ADMIN = Symbol("IDENTITY_ADMIN");

export class NotConfiguredIdentityAdmin implements IdentityAdmin {
  private refuse(): Promise<never> {
    return Promise.reject(new IdentityAdminError("not_configured"));
  }

  createUser(_user: NewIdentityUser): Promise<{ id: string }> {
    return this.refuse();
  }

  setTemporaryPassword(_id: string, _password: string): Promise<void> {
    return this.refuse();
  }

  setEnabled(_id: string, _enabled: boolean): Promise<void> {
    return this.refuse();
  }

  setRealmRole(_id: string, _role: UserRole): Promise<void> {
    return this.refuse();
  }

  logoutSessions(_id: string): Promise<void> {
    return this.refuse();
  }

  deleteUser(_id: string): Promise<void> {
    return this.refuse();
  }
}

/** The provider's factory, as a function of the environment so a spec can drive it. */
export function createIdentityAdmin(
  env: NodeJS.ProcessEnv,
  warn?: (message: string) => void,
): IdentityAdmin {
  const config = buildIdentityAdminConfig(env, warn);
  return config === null
    ? new NotConfiguredIdentityAdmin()
    : new KeycloakIdentityAdminClient({ config });
}

@Module({
  providers: [{ provide: IDENTITY_ADMIN, useFactory: () => createIdentityAdmin(process.env) }],
  exports: [IDENTITY_ADMIN],
})
export class IdentityAdminModule {}
