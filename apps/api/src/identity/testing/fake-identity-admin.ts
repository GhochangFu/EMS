import type { UserRole } from "@bms/shared";

import {
  IdentityAdminError,
  type IdentityAdmin,
  type IdentityAdminFailureReason,
  type NewIdentityUser,
} from "../identity-admin.client";

/**
 * `F3.78` — an in-memory {@link IdentityAdmin} for the users-API specs (U5).
 *
 * Records every call in order, with its arguments, so a spec can assert what
 * reached Keycloak and in which order relative to the database. `failNext`
 * queues one failure per method: the next call of that method rejects with an
 * `IdentityAdminError` of the given reason (and is still recorded), and the
 * call after it succeeds.
 */

export type FakeIdentityAdminCall =
  | { method: "createUser"; args: [NewIdentityUser] }
  | { method: "setTemporaryPassword"; args: [string, string] }
  | { method: "setEnabled"; args: [string, boolean] }
  | { method: "setRealmRole"; args: [string, UserRole] }
  | { method: "logoutSessions"; args: [string] }
  | { method: "deleteUser"; args: [string] };

type Method = FakeIdentityAdminCall["method"];

export class FakeIdentityAdmin implements IdentityAdmin {
  readonly calls: FakeIdentityAdminCall[] = [];
  private readonly failures = new Map<Method, IdentityAdminFailureReason[]>();
  private created = 0;

  failNext(method: Method, reason: IdentityAdminFailureReason): void {
    const queue = this.failures.get(method) ?? [];
    queue.push(reason);
    this.failures.set(method, queue);
  }

  async createUser(user: NewIdentityUser): Promise<{ id: string }> {
    this.record({ method: "createUser", args: [user] });
    this.created += 1;
    return { id: `fake-kc-${this.created}` };
  }

  async setTemporaryPassword(id: string, password: string): Promise<void> {
    this.record({ method: "setTemporaryPassword", args: [id, password] });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    this.record({ method: "setEnabled", args: [id, enabled] });
  }

  async setRealmRole(id: string, role: UserRole): Promise<void> {
    this.record({ method: "setRealmRole", args: [id, role] });
  }

  async logoutSessions(id: string): Promise<void> {
    this.record({ method: "logoutSessions", args: [id] });
  }

  async deleteUser(id: string): Promise<void> {
    this.record({ method: "deleteUser", args: [id] });
  }

  /** Records the call, then throws if a failure is queued for its method. */
  private record(call: FakeIdentityAdminCall): void {
    this.calls.push(call);
    const reason = this.failures.get(call.method)?.shift();
    if (reason !== undefined) {
      throw new IdentityAdminError(reason);
    }
  }
}
