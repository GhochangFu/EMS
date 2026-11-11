import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { ZodType, ZodTypeDef } from "zod";

import type { BmsDb } from "@bms/db";
import {
  addServiceAccountGrantBodySchema,
  createServiceAccountBodySchema,
  createServiceTokenBodySchema,
  SERVICE_TOKEN_MAX_LIVE,
  updateServiceAccountBodySchema,
  type CreateServiceTokenResponse,
  type JwtPayload,
  type ServiceAccountDto,
  type ServiceAccountGrantDto,
  type ServiceAccountResponse,
  type ServiceAccountsListResponse,
  type ServiceTokenDto,
} from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { notifyUserDisabled } from "../admin/users/users.service";
import { AccessControlService } from "../auth/access-control.service";
import { resolveActorId, resolveIdentity } from "../auth/identity-resolver";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { issueServiceToken } from "./service-token-codec";
import { notifyServiceTokenRevoked } from "./service-token-notify";

/**
 * `F4.17` / ADR 0125 decisions 10–15 — `/api/v1/admin/service-accounts`.
 *
 * **Who:** `admin` (any organization) and `organization_admin` (the
 * organizations it may write); every other role — and every service account,
 * which is `viewer` or `operator` by the CHECK — is a 403. The role is read
 * from the **database row**, never the token claim (ADR 0089).
 *
 * **Where:** reads on the fleet pool with an explicit organization filter (the
 * `UsersService` pattern); every write inside `withTenant` of the account's
 * organization, on `bms_tenant`, so RLS binds it and migration 0147's guard
 * trigger holds the token lifecycle (created_at now(), revocation final).
 *
 * **Never** the secret or its hash in a response, a log line or an audit
 * payload (AGENTS.md §9.6): the token is returned once, by `createToken`.
 */

const MANAGER_ONLY = "Only an admin or an organization admin can manage service accounts";
const ACCOUNT_NOT_FOUND = "Service account not found";
const TOKEN_NOT_FOUND = "Token not found";
const GRANT_NOT_FOUND = "Grant not found";
const GRANT_TARGET_NOT_FOUND = "No such location or asset group in the account's organization";

type Manager = { role: "admin" | "organization_admin"; writable: string[] | null };

type AccountRow = {
  id: string;
  organization_id: string;
  display_name: string;
  role: "viewer" | "operator";
  disabled_at: Date | string | null;
  created_at: Date | string;
};

type TokenRow = {
  id: string;
  service_account_id: string;
  token_id: string;
  name: string;
  read_only: boolean;
  expires_at: Date | string;
  created_at: Date | string;
  revoked_at: Date | string | null;
  last_used_at: Date | string | null;
};

type GrantRow = { id: string; user_id: string; kind: "location" | "asset_group"; target_id: string; target_name: string };

const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();
const isoOrNull = (v: Date | string | null): string | null => (v === null ? null : iso(v));

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten());
  }
  return parsed.data;
}

/** One token row as the API shows it: the public id and its derived status, never the secret or its hash. */
export function toTokenDto(row: TokenRow, now: number = Date.now()): ServiceTokenDto {
  const expiresAt = iso(row.expires_at);
  return {
    id: row.id,
    tokenId: row.token_id,
    name: row.name,
    readOnly: row.read_only,
    status: row.revoked_at !== null ? "revoked" : Date.parse(expiresAt) <= now ? "expired" : "active",
    expiresAt,
    createdAt: iso(row.created_at),
    revokedAt: isoOrNull(row.revoked_at),
    lastUsedAt: isoOrNull(row.last_used_at),
  };
}

/**
 * One `bms.users` UPDATE of a service row, guarded: zero rows is a 404 (the
 * `users.service.ts` RETURNING-guard rule; security review of PR 5, L3).
 */
async function updateOneUser(tx: BmsTx, set: ReturnType<typeof sql>, id: string): Promise<void> {
  const rows = rowsOf<{ id: string }>(
    await tx.execute(sql`UPDATE bms.users SET ${set} WHERE id = ${id}::uuid AND kind = 'service' RETURNING id`),
  );
  if (rows.length === 0) {
    throw new NotFoundException(ACCOUNT_NOT_FOUND);
  }
}

/** A grant INSERT whose unique-index race (23505) answers 409, not 500 (code review, 3). */
async function insertGrantOr409(tx: BmsTx, statement: ReturnType<typeof sql>): Promise<unknown> {
  try {
    return await tx.execute(statement);
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "23505") {
      throw new ConflictException("The service account already holds that grant");
    }
    throw err;
  }
}

/** The token columns a pool role may read — never `token_hash` (migration 0146). */
const TOKEN_COLUMNS = sql`id, service_account_id, token_id, name, read_only, expires_at, created_at, revoked_at, last_used_at`;

@Injectable()
export class ServiceAccountsAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  // -- Reads -----------------------------------------------------------------

  async list(jwt: JwtPayload): Promise<ServiceAccountsListResponse> {
    const manager = await this.requireManager(jwt);
    if (manager.writable !== null && manager.writable.length === 0) {
      return { items: [] };
    }
    const filter =
      manager.writable === null
        ? sql``
        : sql`AND organization_id IN (${sql.join(manager.writable.map((id) => sql`${id}::uuid`), sql`, `)})`;
    const accounts = rowsOf<AccountRow>(
      await this.fleetDb.execute(sql`
        SELECT id, organization_id, display_name, role, disabled_at, created_at
          FROM bms.users
         WHERE kind = 'service' ${filter}
         ORDER BY display_name, id`),
    );
    return { items: await this.withDetails(accounts) };
  }

  async get(jwt: JwtPayload, id: string): Promise<ServiceAccountResponse> {
    const manager = await this.requireManager(jwt);
    const account = await this.requireAccount(manager, id);
    const [item] = await this.withDetails([account]);
    return { item: item as ServiceAccountDto };
  }

  // -- Accounts --------------------------------------------------------------

  async create(jwt: JwtPayload, rawBody: unknown): Promise<ServiceAccountResponse> {
    const manager = await this.requireManager(jwt);
    const body = parse(createServiceAccountBodySchema, rawBody);
    this.assertCanManageOrganization(manager, body.organizationId);
    // A missing organization would answer 500 from the foreign key; an inactive one is refused (code review, 3).
    const [organization] = rowsOf<{ active: boolean }>(
      await this.fleetDb.execute(sql`SELECT active FROM bms.organizations WHERE id = ${body.organizationId}::uuid`),
    );
    if (!organization) {
      throw new NotFoundException("Organization not found");
    }
    if (!organization.active) {
      throw new ConflictException("The organization is inactive");
    }
    const id = randomUUID();
    await withTenant(this.tenantDb, body.organizationId, async (tx) => {
      // Raw SQL: bms_tenant holds column INSERT only, and a Drizzle insert names every column.
      await tx.execute(sql`
        INSERT INTO bms.users (id, organization_id, email, display_name, role, kind)
        VALUES (${id}::uuid, ${body.organizationId}::uuid, ${`svc-${id}@service-account.invalid`},
                ${body.name}, ${body.role}, 'service')`);
      await this.audit.write(
        {
          actor: jwt,
          organizationId: body.organizationId,
          action: "service_account.created",
          entityType: "service_account",
          entityId: id,
          payload: { name: body.name, role: body.role },
        },
        tx as unknown as BmsDb,
      );
    });
    return this.get(jwt, id);
  }

  async update(jwt: JwtPayload, id: string, rawBody: unknown): Promise<ServiceAccountResponse> {
    const manager = await this.requireManager(jwt);
    const body = parse(updateServiceAccountBodySchema, rawBody);
    const account = await this.requireAccount(manager, id);
    const actorId = await this.rowActor(jwt, account.organization_id);
    await withTenant(this.tenantDb, account.organization_id, async (tx) => {
      // The row is read again under a lock, inside the transaction, so two
      // PATCHes cannot each write a column from a stale read (code review, 1)
      // and two disables cannot both stamp and audit (code review, 2).
      const [current] = rowsOf<{ display_name: string; role: string; disabled_at: Date | null }>(
        await tx.execute(sql`
          SELECT display_name, role, disabled_at FROM bms.users
           WHERE id = ${id}::uuid AND kind = 'service' FOR UPDATE`),
      );
      if (!current) {
        throw new NotFoundException(ACCOUNT_NOT_FOUND);
      }
      const rename = body.name !== undefined && body.name !== current.display_name;
      const roleChange = body.role !== undefined && body.role !== current.role;
      const disable = body.disabled === true && current.disabled_at === null;
      const enable = body.disabled === false && current.disabled_at !== null;
      if (!rename && !roleChange && !disable && !enable) {
        return; // Nothing changes, so nothing is written or audited.
      }
      if (rename) {
        await updateOneUser(tx, sql`display_name = ${body.name}`, id);
      }
      if (roleChange) {
        await updateOneUser(tx, sql`role = ${body.role}`, id);
        // A role change must not wait out the verifier's 30 s cache: announce
        // each live token, so every process drops it and re-verifies it. The
        // token stays valid; the NOTIFY also closes its open sockets, which
        // reconnect under the new role (PR 4 review, L3; PR 5 review, 6).
        await this.announceLiveTokens(tx, id);
      }
      let revoked: string[] = [];
      if (disable) {
        await updateOneUser(tx, sql`disabled_at = now()`, id);
        // Decision 13: disabling the account revokes every live token, and
        // each revoke is announced, so no process keeps a cached token for the
        // 30 s the cache would otherwise allow.
        revoked = await this.revokeAllLive(tx, id, actorId);
        await notifyUserDisabled(tx, id);
      } else if (enable) {
        await updateOneUser(tx, sql`disabled_at = NULL`, id);
      }
      await this.audit.write(
        {
          actor: jwt,
          organizationId: account.organization_id,
          action: disable ? "service_account.disabled" : "service_account.updated",
          entityType: "service_account",
          entityId: id,
          payload: {
            ...(rename ? { name: body.name } : {}),
            ...(roleChange ? { role: body.role } : {}),
            ...(disable || enable ? { disabled: disable } : {}),
            ...(revoked.length > 0 ? { revokedTokenIds: revoked } : {}),
          },
        },
        tx as unknown as BmsDb,
      );
    });
    return this.get(jwt, id);
  }

  // -- Tokens ----------------------------------------------------------------

  async createToken(jwt: JwtPayload, id: string, rawBody: unknown): Promise<CreateServiceTokenResponse> {
    const manager = await this.requireManager(jwt);
    const body = parse(createServiceTokenBodySchema, rawBody);
    const account = await this.requireAccount(manager, id);
    const actorId = await this.rowActor(jwt, account.organization_id);
    const issued = issueServiceToken();
    const row = await withTenant(this.tenantDb, account.organization_id, async (tx) => {
      // Lock the account so two concurrent creates cannot both see one live token.
      const locked = rowsOf<{ disabled_at: Date | null }>(
        await tx.execute(sql`SELECT disabled_at FROM bms.users WHERE id = ${id}::uuid AND kind = 'service' FOR UPDATE`),
      );
      if (locked.length === 0) {
        throw new NotFoundException(ACCOUNT_NOT_FOUND);
      }
      if (locked[0]?.disabled_at !== null) {
        throw new ConflictException("The service account is disabled; enable it before issuing a token");
      }
      const live = rowsOf<{ n: number }>(
        await tx.execute(sql`
          SELECT count(*)::int AS n FROM bms.service_account_tokens
           WHERE service_account_id = ${id}::uuid AND revoked_at IS NULL AND expires_at > now()`),
      );
      if ((live[0]?.n ?? 0) >= SERVICE_TOKEN_MAX_LIVE) {
        throw new ConflictException(
          `A service account holds at most ${SERVICE_TOKEN_MAX_LIVE} live tokens; revoke one first`,
        );
      }
      const inserted = rowsOf<TokenRow>(
        await tx.execute(sql`
          INSERT INTO bms.service_account_tokens
            (organization_id, service_account_id, token_id, token_hash, name, read_only, expires_at, created_by)
          VALUES (${account.organization_id}::uuid, ${id}::uuid, ${issued.tokenId}, ${issued.tokenHash},
                  ${body.name}, ${body.readOnly}, now() + make_interval(days => ${body.expiresInDays}::int),
                  ${actorId}::uuid)
          RETURNING ${TOKEN_COLUMNS}`),
      );
      const token = inserted[0] as TokenRow;
      await this.audit.write(
        {
          actor: jwt,
          organizationId: account.organization_id,
          action: "service_token.issued",
          entityType: "service_account_token",
          entityId: token.id,
          // Public facts only: the id, never the secret or its hash.
          payload: {
            serviceAccountId: id,
            tokenId: token.token_id,
            name: token.name,
            readOnly: token.read_only,
            expiresAt: iso(token.expires_at),
          },
        },
        tx as unknown as BmsDb,
      );
      return token;
    });
    return { token: issued.token, item: toTokenDto(row) };
  }

  async revokeToken(jwt: JwtPayload, id: string, tokenRowId: string): Promise<ServiceAccountResponse> {
    const manager = await this.requireManager(jwt);
    const account = await this.requireAccount(manager, id);
    const actorId = await this.rowActor(jwt, account.organization_id);
    await withTenant(this.tenantDb, account.organization_id, async (tx) => {
      const existing = rowsOf<{ token_id: string; revoked_at: Date | null }>(
        await tx.execute(sql`
          SELECT token_id, revoked_at FROM bms.service_account_tokens
           WHERE id = ${tokenRowId}::uuid AND service_account_id = ${id}::uuid`),
      );
      const token = existing[0];
      if (!token) {
        throw new NotFoundException(TOKEN_NOT_FOUND);
      }
      if (token.revoked_at !== null) {
        return; // Revocation is final and idempotent: nothing to do, nothing to audit.
      }
      const updated = rowsOf<{ id: string }>(
        await tx.execute(sql`
          UPDATE bms.service_account_tokens SET revoked_at = now(), revoked_by = ${actorId}::uuid
           WHERE id = ${tokenRowId}::uuid AND revoked_at IS NULL
           RETURNING id`),
      );
      if (updated.length === 0) {
        return; // A concurrent revoke won: it notified and audited (code review, 2).
      }
      await notifyServiceTokenRevoked(tx, token.token_id);
      await this.audit.write(
        {
          actor: jwt,
          organizationId: account.organization_id,
          action: "service_token.revoked",
          entityType: "service_account_token",
          entityId: tokenRowId,
          payload: { serviceAccountId: id, tokenId: token.token_id },
        },
        tx as unknown as BmsDb,
      );
    });
    return this.get(jwt, id);
  }

  // -- Grants ----------------------------------------------------------------

  async addGrant(jwt: JwtPayload, id: string, rawBody: unknown): Promise<ServiceAccountResponse> {
    const manager = await this.requireManager(jwt);
    const body = parse(addServiceAccountGrantBodySchema, rawBody);
    const account = await this.requireAccount(manager, id);
    await withTenant(this.tenantDb, account.organization_id, async (tx) => {
      // Under the tenant GUC the target's own policy hides another organization's row.
      const target = rowsOf<{ id: string }>(
        await tx.execute(
          body.kind === "location"
            ? sql`SELECT id FROM bms.locations WHERE id = ${body.targetId}::uuid AND organization_id = ${account.organization_id}::uuid`
            : sql`SELECT id FROM bms.asset_groups WHERE id = ${body.targetId}::uuid AND organization_id = ${account.organization_id}::uuid`,
        ),
      );
      if (target.length === 0) {
        throw new NotFoundException(GRANT_TARGET_NOT_FOUND);
      }
      const duplicate = rowsOf<{ id: string }>(
        await tx.execute(
          body.kind === "location"
            ? sql`SELECT id FROM bms.user_location_access WHERE user_id = ${id}::uuid AND location_id = ${body.targetId}::uuid`
            : sql`SELECT id FROM bms.user_asset_group_access WHERE user_id = ${id}::uuid AND asset_group_id = ${body.targetId}::uuid`,
        ),
      );
      if (duplicate.length > 0) {
        throw new ConflictException("The service account already holds that grant");
      }
      const inserted = rowsOf<{ id: string }>(
        await insertGrantOr409(tx, body.kind === "location"
            ? sql`INSERT INTO bms.user_location_access (user_id, location_id) VALUES (${id}::uuid, ${body.targetId}::uuid) RETURNING id`
            : sql`INSERT INTO bms.user_asset_group_access (user_id, asset_group_id) VALUES (${id}::uuid, ${body.targetId}::uuid) RETURNING id`,
        ),
      );
      await this.audit.write(
        {
          actor: jwt,
          organizationId: account.organization_id,
          action: "service_account.grant_added",
          entityType: "service_account",
          entityId: id,
          payload: { grantId: inserted[0]?.id, kind: body.kind, targetId: body.targetId },
        },
        tx as unknown as BmsDb,
      );
    });
    return this.get(jwt, id);
  }

  async removeGrant(jwt: JwtPayload, id: string, kind: string, grantId: string): Promise<ServiceAccountResponse> {
    const manager = await this.requireManager(jwt);
    if (kind !== "location" && kind !== "asset_group") {
      throw new BadRequestException("kind must be location or asset_group");
    }
    const account = await this.requireAccount(manager, id);
    await withTenant(this.tenantDb, account.organization_id, async (tx) => {
      const deleted = rowsOf<{ id: string }>(
        await tx.execute(
          kind === "location"
            ? sql`DELETE FROM bms.user_location_access WHERE id = ${grantId}::uuid AND user_id = ${id}::uuid RETURNING id`
            : sql`DELETE FROM bms.user_asset_group_access WHERE id = ${grantId}::uuid AND user_id = ${id}::uuid RETURNING id`,
        ),
      );
      if (deleted.length === 0) {
        throw new NotFoundException(GRANT_NOT_FOUND);
      }
      // A narrower scope must reach open sockets, whose scope is fixed at
      // connect: announce each live token so its sockets reconnect under the
      // new grants (security review of PR 5, L4).
      await this.announceLiveTokens(tx, id);
      await this.audit.write(
        {
          actor: jwt,
          organizationId: account.organization_id,
          action: "service_account.grant_removed",
          entityType: "service_account",
          entityId: id,
          payload: { grantId, kind },
        },
        tx as unknown as BmsDb,
      );
    });
    return this.get(jwt, id);
  }

  // -- Helpers ---------------------------------------------------------------

  /** 403 unless the caller's database row is `admin` or `organization_admin`. */
  async requireManager(jwt: JwtPayload): Promise<Manager> {
    const identity = await resolveIdentity(this.fleetDb, jwt);
    if (!identity || identity.kind === "service") {
      throw new ForbiddenException(MANAGER_ONLY);
    }
    if (identity.role === "admin") {
      return { role: "admin", writable: null };
    }
    if (identity.role === "organization_admin") {
      return { role: "organization_admin", writable: (await this.accessControl.writableOrganizationIds(jwt)) ?? [] };
    }
    throw new ForbiddenException(MANAGER_ONLY);
  }

  private assertCanManageOrganization(manager: Manager, organizationId: string): void {
    if (manager.writable !== null && !manager.writable.includes(organizationId)) {
      throw new ForbiddenException("You cannot manage service accounts in that organization");
    }
  }

  /** The account, or a 404 that does not say whether it exists out of scope. */
  private async requireAccount(manager: Manager, id: string): Promise<AccountRow> {
    const [row] = rowsOf<AccountRow>(
      await this.fleetDb.execute(sql`
        SELECT id, organization_id, display_name, role, disabled_at, created_at
          FROM bms.users WHERE id = ${id}::uuid AND kind = 'service'`),
    );
    if (!row || (manager.writable !== null && !manager.writable.includes(row.organization_id))) {
      throw new NotFoundException(ACCOUNT_NOT_FOUND);
    }
    return row;
  }

  /**
   * The actor's `bms.users.id` for `created_by` / `revoked_by` — only when the
   * actor is a user **of the token's organization**. Every write here runs on
   * `bms_tenant`, and migration 0147's guard reads the actor's row under that
   * pool's RLS, which hides a global admin's row (no organization) as surely
   * as another organization's user. So a global admin, or an organization
   * admin acting through a grant elsewhere, leaves the column `NULL`, and
   * `bms.audit_log` — which every action here writes, with the actor — is the
   * record of who did it. Found by the live check: the guard refused the
   * global admin's first token with a 500.
   */
  private async rowActor(jwt: JwtPayload, organizationId: string): Promise<string | null> {
    const actorId = await resolveActorId(this.fleetDb, jwt);
    if (actorId === null) {
      return null;
    }
    const identity = await resolveIdentity(this.fleetDb, jwt);
    return identity?.organizationId === organizationId ? actorId : null;
  }

  /** Announces every live token of the account on `bms_service_token_revoked` without revoking it. */
  private async announceLiveTokens(tx: BmsTx, id: string): Promise<void> {
    const live = rowsOf<{ token_id: string }>(
      await tx.execute(sql`
        SELECT token_id FROM bms.service_account_tokens
         WHERE service_account_id = ${id}::uuid AND revoked_at IS NULL AND expires_at > now()`),
    );
    for (const row of live) {
      await notifyServiceTokenRevoked(tx, row.token_id);
    }
  }

  private async revokeAllLive(tx: BmsTx, id: string, actorId: string | null): Promise<string[]> {
    const revoked = rowsOf<{ token_id: string }>(
      await tx.execute(sql`
        UPDATE bms.service_account_tokens SET revoked_at = now(), revoked_by = ${actorId}::uuid
         WHERE service_account_id = ${id}::uuid AND revoked_at IS NULL AND expires_at > now()
         RETURNING token_id`),
    );
    for (const row of revoked) {
      await notifyServiceTokenRevoked(tx, row.token_id);
    }
    return revoked.map((row) => row.token_id);
  }

  private async withDetails(accounts: AccountRow[]): Promise<ServiceAccountDto[]> {
    if (accounts.length === 0) {
      return [];
    }
    const ids = sql.join(accounts.map((a) => sql`${a.id}::uuid`), sql`, `);
    const tokens = rowsOf<TokenRow>(
      await this.fleetDb.execute(sql`
        SELECT ${TOKEN_COLUMNS} FROM bms.service_account_tokens
         WHERE service_account_id IN (${ids}) ORDER BY created_at DESC, id`),
    );
    const grants = rowsOf<GrantRow>(
      await this.fleetDb.execute(sql`
        SELECT a.id, a.user_id, 'location' AS kind, l.id AS target_id, l.name AS target_name
          FROM bms.user_location_access a JOIN bms.locations l ON l.id = a.location_id
         WHERE a.user_id IN (${ids})
        UNION ALL
        SELECT g.id, g.user_id, 'asset_group' AS kind, ag.id AS target_id, ag.name AS target_name
          FROM bms.user_asset_group_access g JOIN bms.asset_groups ag ON ag.id = g.asset_group_id
         WHERE g.user_id IN (${ids})
         ORDER BY target_name, id`),
    );
    const now = Date.now();
    return accounts.map((a) => ({
      id: a.id,
      organizationId: a.organization_id,
      name: a.display_name,
      role: a.role,
      disabledAt: isoOrNull(a.disabled_at),
      createdAt: iso(a.created_at),
      tokens: tokens.filter((t) => t.service_account_id === a.id).map((t) => toTokenDto(t, now)),
      grants: grants
        .filter((g) => g.user_id === a.id)
        .map((g): ServiceAccountGrantDto => ({ id: g.id, kind: g.kind, targetId: g.target_id, targetName: g.target_name })),
    }));
  }
}
