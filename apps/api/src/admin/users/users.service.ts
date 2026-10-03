import { randomUUID } from "node:crypto";

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { asc, eq, getTableColumns, inArray, ne, and, sql } from "drizzle-orm";
import type { ZodType, ZodTypeDef } from "zod";

import { users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  AdminUserDto,
  AdminUsersListResponse,
  JwtPayload,
  UserRole,
  UserWriteFollowUp,
  UserWriteResponse,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { resolveAuthMode } from "../../auth/auth-mode";
import { resolveIdentity, type ResolvedIdentity } from "../../auth/identity-resolver";
import { USER_DISABLED_NOTIFY_CHANNEL } from "../../auth/user-disabled-notify";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant, type BmsTx } from "../../database/tenant-context";
import { IdentityAdminError, type IdentityAdmin } from "../../identity/identity-admin.client";
import { IDENTITY_ADMIN, NotConfiguredIdentityAdmin } from "../../identity/identity-admin.module";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  createUserBodySchema,
  temporaryPasswordBodySchema,
  updateUserBodySchema,
} from "./users.schema";
import {
  canManageTarget,
  isManagerRole,
  mayAssignRole,
  roleChangeError,
  touchesAdmin,
  type ManagerRole,
} from "./user-management-rules";

/**
 * `F3.78` / ADR 0089 decisions 1–3, 6, 8, 11, 14 — the users API: list,
 * create, edit, deactivate, reactivate and set a temporary password.
 *
 * **Every manager decision reads the database row's role** (`resolveIdentity`),
 * never `jwt.role`: a token outlives a demotion.
 *
 * **Executor per write.** `0048`'s policy on `bms.users` has a strict
 * `WITH CHECK`, and its `NULL`-organization branch is `TO bms_fleet` only. A
 * write that touches a row whose old **or** new role is `admin` (create of an
 * admin, promotion, demotion, deactivate / reactivate / temporary password of
 * an admin) therefore runs in `fleetDb.transaction` with its audit row stamped
 * `organizationId: null` on the same transaction. Every other write runs in
 * `withTenant(tenantDb, target home organization)`.
 *
 * **Every `bms.users` `UPDATE` returns `id` and throws on an empty result**
 * ({@link CHANGED_UNDER_YOU}, no audit, no NOTIFY): under `FORCE` a GUC that no
 * longer matches the row updates zero rows and raises nothing.
 *
 * **Never `tx.insert(users)`.** drizzle-orm 0.38 lists every column in an
 * `INSERT` and sends `default` for an omitted one, so the statement would name
 * `password_hash`, which no pool role may insert. {@link insertUserRow} is raw
 * `sql` with the seven granted columns and an explicit `RETURNING` list
 * (`tests/f3.78-no-drizzle-insert-on-users.test.ts`).
 *
 * The statements are exported functions that take an executor and open no
 * transaction, so `users.integration.spec.ts` drives these same statements on
 * the real pool roles.
 */

// -- Refusal messages: one per cause, asserted by the specs ------------------

/** The same body for an out-of-scope target and for a nonexistent id (the `F4.64` rule). */
export const USER_NOT_FOUND = "User not found";
export const MANAGER_ROLE_REQUIRED = "User administration requires the admin or organization_admin role";
export const LOCAL_MODE_READ_ONLY = "User administration needs Keycloak; this deployment runs local sign-in";
export const NOT_CONFIGURED = "User administration is not configured";
export const DUPLICATE_EMAIL = "A user with this email already exists";
export const UNLINKED_USER = "This user must sign in once before it can be changed";
export const CHANGED_UNDER_YOU = "The user changed under you; reload and try again";
export const SELF_ROLE_CHANGE = "You cannot change your own role";
export const SELF_DEACTIVATE = "You cannot deactivate yourself";
export const LAST_ACTIVE_ADMIN = "This is the last active admin; promote another admin first";
export const ADMIN_ROLE_ADMIN_ONLY = "Only an admin can give the admin role";
export const ORGANIZATION_OUT_OF_SCOPE = "The organization is outside your access scope";
export const IDENTITY_PROVIDER_FAILED = "The identity provider refused the change";
/**
 * Keycloak answers a password its policy refuses with a 400, and the client
 * never reads the body (decision 5), so the rule is named by class only — the
 * policy's `notUsername` / `notEmail` rules — and never with the password.
 */
export const PASSWORD_POLICY_REFUSED =
  "The temporary password breaks the realm password policy: it must not match the user's username or email";

// -- Statements -------------------------------------------------------------

/** What a statement needs from a pool or a transaction. */
export type UsersExecutor = Pick<BmsDb, "execute" | "select" | "update">;

/** The columns every read and the insert's `RETURNING` name — never `password_hash`. */
const USER_COLUMNS = (({ id, email, displayName, role, organizationId, disabledAt, lastLoginAt, createdAt }) => ({
  id,
  email,
  displayName,
  role,
  organizationId,
  subject: getTableColumns(users).oidcSubject,
  disabledAt,
  lastLoginAt,
  createdAt,
}))(getTableColumns(users));

export type UserRow = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  organizationId: string | null;
  subject: string | null;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export type NewUserRow = {
  readonly id: string;
  readonly organizationId: string | null;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  /** The Keycloak id parsed from this request's create response — never from a request body. */
  readonly subject: string;
};

type RawUserRow = {
  id: string;
  organization_id: string | null;
  email: string;
  display_name: string;
  role: string;
  oidc_subject: string | null;
  disabled_at: Date | string | null;
  last_login_at: Date | string | null;
  created_at: Date | string;
};

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

const asDate = (value: Date | string | null): Date | null => (value === null ? null : new Date(value));

/**
 * The user insert: the seven columns `0098` grants `bms_tenant` and
 * `bms_fleet`, and an explicit `RETURNING` list (a bare `RETURNING *` would
 * select `password_hash`).
 */
export async function insertUserRow(tx: Pick<BmsDb, "execute">, row: NewUserRow): Promise<UserRow> {
  const result = await tx.execute(sql`
    INSERT INTO bms.users (id, organization_id, email, display_name, role, oidc_subject, created_at)
    VALUES (${row.id}, ${row.organizationId}, ${row.email}, ${row.displayName}, ${row.role}, ${row.subject}, now())
    RETURNING id, organization_id, email, display_name, role, oidc_subject, disabled_at, last_login_at, created_at
  `);
  const [raw] = rowsOf<RawUserRow>(result);
  if (!raw) {
    throw new ConflictException(CHANGED_UNDER_YOU);
  }
  return {
    id: raw.id,
    email: raw.email,
    displayName: raw.display_name,
    role: raw.role as UserRole,
    organizationId: raw.organization_id,
    subject: raw.oidc_subject,
    disabledAt: asDate(raw.disabled_at),
    lastLoginAt: asDate(raw.last_login_at),
    createdAt: new Date(raw.created_at),
  };
}

/**
 * The last-admin lock (decision 2): takes `FOR UPDATE` on every active admin
 * row and returns their ids. Two admins demoting each other at once serialise
 * here, and the second sees the first's committed change.
 */
export async function lockActiveAdminIds(tx: Pick<BmsDb, "execute">): Promise<string[]> {
  const result = await tx.execute(
    sql`SELECT id FROM bms.users WHERE role = 'admin' AND disabled_at IS NULL FOR UPDATE`,
  );
  return rowsOf<{ id: string }>(result).map((row) => row.id);
}

/** One `bms.users` `UPDATE`, guarded: zero rows is {@link CHANGED_UNDER_YOU}. */
export async function updateUserRow(
  tx: Pick<BmsDb, "update">,
  id: string,
  set: Partial<Pick<typeof users.$inferInsert, "displayName" | "role" | "organizationId" | "disabledAt">> | {
    disabledAt: ReturnType<typeof sql>;
  },
): Promise<void> {
  const updated = await tx
    .update(users)
    .set(set as Partial<typeof users.$inferInsert>)
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (updated.length === 0) {
    throw new ConflictException(CHANGED_UNDER_YOU);
  }
}

/** Decision 8: every API process closes the user's sockets on this NOTIFY. */
export async function notifyUserDisabled(tx: Pick<BmsDb, "execute">, id: string): Promise<void> {
  await tx.execute(sql`SELECT pg_notify(${USER_DISABLED_NOTIFY_CHANNEL}, ${id})`);
}

/** Organization ids every grant of each user names, keyed by user id — the grant half of the reach. */
async function grantOrganizationIds(
  db: Pick<BmsDb, "execute">,
  userIds: readonly string[],
): Promise<Map<string, string[]>> {
  const reach = new Map<string, string[]>();
  if (userIds.length === 0) {
    return reach;
  }
  const ids = `{${userIds.join(",")}}`;
  const result = await db.execute(sql`
    SELECT a.user_id, a.organization_id FROM bms.user_organization_access a
     WHERE a.user_id = ANY(${ids}::uuid[])
    UNION
    SELECT a.user_id, l.organization_id FROM bms.user_location_access a
      JOIN bms.locations l ON l.id = a.location_id
     WHERE a.user_id = ANY(${ids}::uuid[])
    UNION
    SELECT a.user_id, g.organization_id FROM bms.user_asset_group_access a
      JOIN bms.asset_groups g ON g.id = a.asset_group_id
     WHERE a.user_id = ANY(${ids}::uuid[])
  `);
  for (const row of rowsOf<{ user_id: string; organization_id: string }>(result)) {
    reach.set(row.user_id, [...(reach.get(row.user_id) ?? []), row.organization_id]);
  }
  return reach;
}

export function toAdminUserDto(row: UserRow): AdminUserDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    organizationId: row.organizationId,
    linked: row.subject !== null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The caller, once {@link UsersService.requireManager} has accepted it. */
export type Manager = { readonly identity: ResolvedIdentity; readonly role: ManagerRole; readonly writable: string[] | null };

type Executor = UsersExecutor & Pick<BmsDb, "insert">;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    @Inject(IDENTITY_ADMIN) private readonly identity: IdentityAdmin,
  ) {}

  /** `GET /admin/users` — the users the caller may manage. Works in local mode and unconfigured. */
  async list(jwt: JwtPayload): Promise<AdminUsersListResponse> {
    const manager = await this.requireManager(jwt);
    const conditions =
      manager.role === "admin"
        ? []
        : [ne(users.role, "admin"), inArray(users.organizationId, manager.writable ?? [])];
    if (manager.role !== "admin" && (manager.writable ?? []).length === 0) {
      return { items: [] };
    }
    const rows = (await this.fleetDb
      .select(USER_COLUMNS)
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(users.email))) as UserRow[];
    if (manager.role === "admin") {
      return { items: rows.map(toAdminUserDto) };
    }
    // The same predicate every write applies, so the list never shows a row a write would refuse.
    const reach = await grantOrganizationIds(this.fleetDb, rows.map((row) => row.id));
    return {
      items: rows
        .filter((row) =>
          canManageTarget(manager.role, manager.writable, {
            role: row.role,
            homeOrganizationId: row.organizationId,
            grantOrganizationIds: reach.get(row.id) ?? [],
          }),
        )
        .map(toAdminUserDto),
    };
  }

  /**
   * `POST /admin/users` — decision 3, in order: the duplicate check on
   * `fleetDb`; Keycloak create (disabled); temporary password; realm role; the
   * insert and its audit row in one transaction; after the commit, enable.
   * A failure at the password, the role or the insert deletes **only the id
   * parsed from this request's create** and rethrows. When that delete fails
   * too, the error keeps its status and its body gains
   * `followUp: "keycloak_orphan_disabled_account"` (decision 3: the response
   * says a disabled Keycloak account remains); the log names the Keycloak id only.
   */
  async create(jwt: JwtPayload, rawBody: unknown): Promise<UserWriteResponse> {
    const manager = await this.requireManager(jwt);
    this.assertKeycloakMode();
    this.assertConfigured();
    const body = parseBody(createUserBodySchema, rawBody);
    if (!mayAssignRole(manager.role, body.role)) {
      throw new ForbiddenException(ADMIN_ROLE_ADMIN_ONLY);
    }
    if (
      body.organizationId !== null &&
      manager.writable !== null &&
      !manager.writable.includes(body.organizationId)
    ) {
      throw new ForbiddenException(ORGANIZATION_OUT_OF_SCOPE);
    }

    const [duplicate] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${body.email}`)
      .limit(1);
    if (duplicate) {
      throw new ConflictException(DUPLICATE_EMAIL);
    }

    const { id: keycloakId } = await this.keycloak(() =>
      this.identity.createUser({ email: body.email, displayName: body.displayName }),
    );

    let created: UserRow;
    try {
      await this.keycloak(
        () => this.identity.setTemporaryPassword(keycloakId, body.temporaryPassword),
        PASSWORD_POLICY_REFUSED,
      );
      await this.keycloak(() => this.identity.setRealmRole(keycloakId, body.role));
      const newRow: NewUserRow = {
        id: randomUUID(),
        organizationId: body.organizationId,
        email: body.email,
        displayName: body.displayName,
        role: body.role,
        subject: keycloakId,
      };
      created = await this.inExecutor(body.role === "admin", body.organizationId, async (tx) => {
        const row = await insertUserRow(tx, newRow);
        await this.audit.write(
          {
            actor: jwt,
            action: "master.user.create",
            entityType: "user",
            entityId: row.id,
            organizationId: body.organizationId,
            payload: { role: body.role, organizationId: body.organizationId },
          },
          tx as BmsDb,
        );
        return row;
      });
    } catch (err) {
      try {
        await this.identity.deleteUser(keycloakId);
      } catch {
        this.logger.error(`F3.78: could not delete the disabled Keycloak user ${keycloakId} after a failed create`);
        throw withFollowUp(err, "keycloak_orphan_disabled_account");
      }
      throw err;
    }

    let followUp: UserWriteFollowUp | null = null;
    try {
      await this.identity.setEnabled(keycloakId, true);
    } catch {
      followUp = "keycloak_enable_failed";
    }
    return { user: toAdminUserDto(created), followUp };
  }

  /**
   * `PATCH /admin/users/:id`. A role change mirrors to Keycloak first and to
   * the database second; a database failure undoes the Keycloak mapping.
   */
  async update(jwt: JwtPayload, id: string, rawBody: unknown): Promise<UserWriteResponse> {
    const manager = await this.requireManager(jwt);
    this.assertKeycloakMode();
    this.assertConfigured();
    const body = parseBody(updateUserBodySchema, rawBody);
    const target = await this.requireManageableTarget(manager, id);
    const subject = requireLinked(target);

    const roleChanges = body.role !== undefined && body.role !== target.role;
    if (roleChanges && target.id === manager.identity.id) {
      throw new ForbiddenException(SELF_ROLE_CHANGE);
    }
    const boundary = roleChangeError(target.role, body);
    if (boundary !== null) {
      throw new BadRequestException(boundary);
    }
    const newRole = body.role ?? target.role;
    if (!mayAssignRole(manager.role, newRole)) {
      throw new ForbiddenException(ADMIN_ROLE_ADMIN_ONLY);
    }
    const crosses = (target.role === "admin") !== (newRole === "admin");
    const newOrganizationId = crosses ? (body.organizationId ?? null) : target.organizationId;
    const onFleet = touchesAdmin(target.role, newRole);

    const changed: string[] = [];
    const set: Partial<typeof users.$inferInsert> = {};
    if (body.displayName !== undefined && body.displayName !== target.displayName) {
      set.displayName = body.displayName;
      changed.push("displayName");
    }
    if (roleChanges) {
      set.role = newRole;
      changed.push("role");
    }
    if (crosses) {
      set.organizationId = newOrganizationId;
      changed.push("organizationId");
    }
    if (changed.length === 0) {
      return { user: toAdminUserDto(target), followUp: null };
    }

    let keycloakChanged = false;
    try {
      await this.inExecutor(onFleet, onFleet ? null : target.organizationId, async (tx) => {
        if (roleChanges && target.role === "admin") {
          await this.assertNotLastActiveAdmin(tx, target.id);
        }
        if (roleChanges) {
          await this.keycloak(() => this.identity.setRealmRole(subject, newRole));
          keycloakChanged = true;
        }
        await updateUserRow(tx, target.id, set);
        await this.audit.write(
          {
            actor: jwt,
            action: "master.user.update",
            entityType: "user",
            entityId: target.id,
            organizationId: onFleet ? null : target.organizationId,
            payload: roleChanges ? { changed, fromRole: target.role, toRole: newRole } : { changed },
          },
          tx as BmsDb,
        );
      });
    } catch (err) {
      if (keycloakChanged) {
        try {
          await this.identity.setRealmRole(subject, target.role);
        } catch {
          this.logger.error(`F3.78: could not restore the realm role of Keycloak user ${subject} after a failed update`);
        }
      }
      throw err;
    }
    return { user: toAdminUserDto(await this.readUser(target.id)), followUp: null };
  }

  /**
   * `POST /admin/users/:id/deactivate` — decision 8, idempotent. A fresh
   * deactivate stamps `disabled_at` and NOTIFYs; a retry on a disabled row
   * keeps its stamp, writes one `{ alreadyDisabled: true }` audit row and
   * skips the NOTIFY. Both then disable the Keycloak account and end its
   * sessions; a Keycloak failure is a 200 with `followUp`.
   */
  async deactivate(jwt: JwtPayload, id: string): Promise<UserWriteResponse> {
    const manager = await this.requireManager(jwt);
    this.assertKeycloakMode();
    this.assertConfigured();
    // `idParamSchema` accepts uppercase hex and Postgres matches it case-insensitively.
    if (id.toLowerCase() === manager.identity.id.toLowerCase()) {
      throw new ForbiddenException(SELF_DEACTIVATE);
    }
    const target = await this.requireManageableTarget(manager, id);
    const subject = requireLinked(target);
    const onFleet = target.role === "admin";
    const alreadyDisabled = target.disabledAt !== null;

    await this.inExecutor(onFleet, onFleet ? null : target.organizationId, async (tx) => {
      if (onFleet) {
        await this.assertNotLastActiveAdmin(tx, target.id);
      }
      if (!alreadyDisabled) {
        await updateUserRow(tx, target.id, { disabledAt: sql`now()` });
        await notifyUserDisabled(tx, target.id);
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.user.deactivate",
          entityType: "user",
          entityId: target.id,
          organizationId: onFleet ? null : target.organizationId,
          payload: { alreadyDisabled },
        },
        tx as BmsDb,
      );
    });

    let followUp: UserWriteFollowUp | null = null;
    try {
      await this.identity.setEnabled(subject, false);
      await this.identity.logoutSessions(subject);
    } catch {
      followUp = "keycloak_disable_failed";
    }
    return { user: toAdminUserDto(await this.readUser(target.id)), followUp };
  }

  /**
   * `POST /admin/users/:id/reactivate` — idempotent: clears `disabled_at` when
   * set, always writes one `{ clearedDisabledAt }` audit row, always enables
   * the Keycloak account (decision 3's recovery for a failed enable).
   */
  async reactivate(jwt: JwtPayload, id: string): Promise<UserWriteResponse> {
    const manager = await this.requireManager(jwt);
    this.assertKeycloakMode();
    this.assertConfigured();
    const target = await this.requireManageableTarget(manager, id);
    const subject = requireLinked(target);
    const onFleet = target.role === "admin";
    const clearedDisabledAt = target.disabledAt !== null;

    await this.inExecutor(onFleet, onFleet ? null : target.organizationId, async (tx) => {
      if (clearedDisabledAt) {
        await updateUserRow(tx, target.id, { disabledAt: null });
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.user.reactivate",
          entityType: "user",
          entityId: target.id,
          organizationId: onFleet ? null : target.organizationId,
          payload: { clearedDisabledAt },
        },
        tx as BmsDb,
      );
    });

    let followUp: UserWriteFollowUp | null = null;
    try {
      await this.identity.setEnabled(subject, true);
    } catch {
      followUp = "keycloak_enable_failed";
    }
    return { user: toAdminUserDto(await this.readUser(target.id)), followUp };
  }

  /**
   * `POST /admin/users/:id/temporary-password` — decision 6: a temporary
   * Keycloak password, then every session ended. The audit payload never
   * carries the password.
   *
   * **Decision 14: the credential never changes without an audit row.** The
   * audit transaction opens first and inserts `master.user.temporary_password.set`;
   * `setTemporaryPassword` and `logoutSessions` then run inside it. An audit
   * failure stops before any Keycloak call; a Keycloak failure rolls the audit
   * row back. Two residual windows remain: Keycloak succeeded and the `COMMIT` then failed
   * (the password changed, no audit row), and `setTemporaryPassword`
   * succeeded but `logoutSessions` failed (a 502, the audit rolled back, the
   * password changed). A Keycloak call cannot join the database transaction,
   * so neither window can close here; both are narrower than calling Keycloak
   * before the transaction, which left every audit failure in that state.
   */
  async temporaryPassword(jwt: JwtPayload, id: string, rawBody: unknown): Promise<UserWriteResponse> {
    const manager = await this.requireManager(jwt);
    this.assertKeycloakMode();
    this.assertConfigured();
    const body = parseBody(temporaryPasswordBodySchema, rawBody);
    const target = await this.requireManageableTarget(manager, id);
    const subject = requireLinked(target);
    const onFleet = target.role === "admin";

    await this.inExecutor(onFleet, onFleet ? null : target.organizationId, async (tx) => {
      await this.audit.write(
        {
          actor: jwt,
          action: "master.user.temporary_password.set",
          entityType: "user",
          entityId: target.id,
          organizationId: onFleet ? null : target.organizationId,
          payload: { sessionsEnded: true },
        },
        tx as BmsDb,
      );
      await this.keycloak(
        () => this.identity.setTemporaryPassword(subject, body.temporaryPassword),
        PASSWORD_POLICY_REFUSED,
      );
      await this.keycloak(() => this.identity.logoutSessions(subject));
    });
    return { user: toAdminUserDto(target), followUp: null };
  }

  // -- Helpers --------------------------------------------------------------

  /**
   * 403 unless the caller's **database row** is `admin` or `organization_admin`.
   * Public so `UserGrantsService` (U6) applies the same check, not a copy.
   */
  async requireManager(jwt: JwtPayload): Promise<Manager> {
    const identity = await resolveIdentity(this.fleetDb, jwt);
    if (!identity || !isManagerRole(identity.role)) {
      throw new ForbiddenException(MANAGER_ROLE_REQUIRED);
    }
    const writable = identity.role === "admin" ? null : await this.accessControl.writableOrganizationIds(jwt);
    return { identity, role: identity.role, writable };
  }

  /** Decision 11: local auth keeps user administration read-only. */
  private assertKeycloakMode(): void {
    if (resolveAuthMode(process.env) === "local") {
      throw new ConflictException(LOCAL_MODE_READ_ONLY);
    }
  }

  /**
   * Plan U5: an unconfigured provider makes every write 503 before any db
   * write. Without this, a displayName-only PATCH never calls Keycloak and
   * deactivate / reactivate commit first and turn the failure into a followUp.
   */
  private assertConfigured(): void {
    if (this.identity instanceof NotConfiguredIdentityAdmin) {
      throw new ServiceUnavailableException(NOT_CONFIGURED);
    }
  }

  private async readUser(id: string): Promise<UserRow> {
    const [row] = (await this.fleetDb.select(USER_COLUMNS).from(users).where(eq(users.id, id)).limit(1)) as UserRow[];
    if (!row) {
      throw new NotFoundException(USER_NOT_FOUND);
    }
    return row;
  }

  /**
   * The target, or a 404 that does not name it when it is missing or out of
   * scope. Public so `UserGrantsService` (U6) answers a C1 target with the
   * same body as a nonexistent id.
   */
  async requireManageableTarget(manager: Manager, id: string): Promise<UserRow> {
    const [row] = (await this.fleetDb.select(USER_COLUMNS).from(users).where(eq(users.id, id)).limit(1)) as UserRow[];
    if (!row) {
      throw new NotFoundException(USER_NOT_FOUND);
    }
    const reach = manager.role === "admin" ? new Map<string, string[]>() : await grantOrganizationIds(this.fleetDb, [row.id]);
    const allowed = canManageTarget(manager.role, manager.writable, {
      role: row.role,
      homeOrganizationId: row.organizationId,
      grantOrganizationIds: reach.get(row.id) ?? [],
    });
    if (!allowed) {
      throw new NotFoundException(USER_NOT_FOUND);
    }
    return row;
  }

  /** The organizations every grant of `userId` names (the grant half of its reach), read on `fleetDb`. */
  async reachOf(userId: string): Promise<string[]> {
    return (await grantOrganizationIds(this.fleetDb, [userId])).get(userId) ?? [];
  }

  /** Inside the fleet transaction: refuse when no other active admin would remain. */
  private async assertNotLastActiveAdmin(tx: Pick<BmsDb, "execute">, targetId: string): Promise<void> {
    const active = await lockActiveAdminIds(tx);
    if (active.includes(targetId) && active.filter((adminId) => adminId !== targetId).length === 0) {
      throw new ConflictException(LAST_ACTIVE_ADMIN);
    }
  }

  /** The executor rule: `fleetDb` for a write touching `admin`, else `withTenant` of the target's home organization. */
  private inExecutor<T>(onFleet: boolean, organizationId: string | null, fn: (tx: Executor) => Promise<T>): Promise<T> {
    if (onFleet) {
      return this.fleetDb.transaction(async (tx) => fn(tx as unknown as Executor));
    }
    if (organizationId === null) {
      // The CHECK makes this unreachable for a non-admin row; refuse rather than write without a GUC.
      throw new ConflictException(CHANGED_UNDER_YOU);
    }
    return withTenant(this.tenantDb, organizationId, async (tx: BmsTx) => fn(tx as unknown as Executor));
  }

  /**
   * A Keycloak call with its failure mapped: `not_configured` 503, `conflict`
   * 409, `bad_request` 400 with `badRequestMessage` when the call names one
   * (the password calls), anything else 502.
   */
  private async keycloak<T>(call: () => Promise<T>, badRequestMessage?: string): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof IdentityAdminError) {
        if (err.reason === "not_configured") throw new ServiceUnavailableException(NOT_CONFIGURED);
        if (err.reason === "conflict") throw new ConflictException(DUPLICATE_EMAIL);
        if (err.reason === "bad_request" && badRequestMessage !== undefined) {
          throw new BadRequestException(badRequestMessage);
        }
        throw new BadGatewayException(IDENTITY_PROVIDER_FAILED);
      }
      throw err;
    }
  }
}

/**
 * `err` with `followUp` added to its response body and its status kept. A
 * non-HTTP error (a failed insert) stays a 500 whose body names no internal
 * detail; the original is kept as `cause`, which is never serialised.
 */
function withFollowUp(err: unknown, followUp: UserWriteFollowUp): HttpException {
  const status = err instanceof HttpException ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
  const response = err instanceof HttpException ? err.getResponse() : "Internal server error";
  const body = typeof response === "string" ? { statusCode: status, message: response } : response;
  return new HttpException({ ...body, followUp }, status, { cause: err });
}

/** Unlinked rows have no Keycloak id to act on (decision 4): 409. */
function requireLinked(row: UserRow): string {
  if (row.subject === null) {
    throw new ConflictException(UNLINKED_USER);
  }
  return row.subject;
}

function parseBody<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }
  return result.data;
}
