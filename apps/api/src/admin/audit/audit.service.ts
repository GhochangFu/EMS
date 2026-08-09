import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as XLSX from "xlsx";

import { auditLog, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AuditLogListResponse, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { DRIZZLE } from "../../database/database.tokens";
import { MAX_EXPORT_ROWS, assertWithinExportCap } from "./audit.limits";
import type { AuditExportQuery, AuditListQuery } from "./audit.schema";
import { toCsv, toSheetRows } from "./audit.serialise";
import type { AuditRow } from "./audit.serialise";

/** A serialised export ready for the HTTP layer to send. */
export type AuditExportFile = {
  filename: string;
  contentType: string;
  body: string | Buffer;
};

/**
 * Reads `bms.audit_log` (ADR 0021). Global admin only — the table has no
 * tenancy column, so §4.7's scope predicates cannot be applied to it and
 * scoped reads are deferred to their own ADR.
 */
@Injectable()
export class AuditAdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly accessControl: AccessControlService,
  ) {}

  /** Lists audit rows, newest first. */
  async list(jwt: JwtPayload, query: AuditListQuery): Promise<AuditLogListResponse> {
    await this.requireGlobalAdmin(jwt);
    const where = this.buildWhere(query);

    const total = await this.count(where);
    const rows = await this.selectRows(where, query.limit, query.offset);

    return { items: rows, total, limit: query.limit, offset: query.offset };
  }

  /** Builds a CSV or XLSX export of the matching rows. */
  async export(jwt: JwtPayload, query: AuditExportQuery): Promise<AuditExportFile> {
    await this.requireGlobalAdmin(jwt);
    const where = this.buildWhere(query);

    // Count before selecting: refusing is the contract (ADR 0021 decision 5),
    // and a truncated export that looks complete is the failure being avoided.
    const total = await this.count(where);
    assertWithinExportCap(total);

    const rows = await this.selectRows(where, MAX_EXPORT_ROWS, 0);
    const stamp = query.from.slice(0, 10);

    if (query.format === "xlsx") {
      const sheet = XLSX.utils.aoa_to_sheet(toSheetRows(rows));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Audit");
      return {
        filename: `audit-${stamp}.xlsx`,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer,
      };
    }

    return {
      filename: `audit-${stamp}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: toCsv(rows),
    };
  }

  /**
   * ADR 0021 decision 1, as amended by Amendment 1.
   *
   * Two checks, and the first is not redundant. `AccessControlService`
   * deliberately falls back to the JWT claim when **no** `bms.users` row matches
   * the token, so an unprovisioned principal holding the realm role `admin`
   * resolves to `role: "admin"` and a `null` — i.e. unrestricted — scope. On
   * every other `/admin/*` endpoint a second scope check constrains that; here
   * the `null` scope *is* the whole control, so the fallback would hand the
   * entire audit log to anyone the IdP calls an admin, and deleting a user's
   * row would escalate rather than revoke them.
   *
   * So: require a real row first, then require that its role resolves to the
   * unrestricted scope. `writableOrganizationIds` returns `null` only for the
   * global admin; an empty array is a real user with no grants and must never
   * be mistaken for it (§4.7).
   *
   * The fallback itself is pre-existing and out of scope to change here — it is
   * recorded against `F4.10` in `docs/BACKLOG.md` and belongs to its own ADR.
   */
  private async requireGlobalAdmin(jwt: JwtPayload): Promise<void> {
    const [provisioned] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, jwt.sub), eq(users.email, jwt.email)))
      .limit(1);
    if (!provisioned) {
      throw new ForbiddenException(
        "Reading the audit log requires a provisioned account; this token matches no user",
      );
    }

    await this.accessControl.requireMasterDataUser(jwt);
    const writableOrgIds = await this.accessControl.writableOrganizationIds(jwt);
    if (writableOrgIds !== null) {
      throw new ForbiddenException("Reading the audit log requires the global admin role");
    }
  }

  private buildWhere(query: AuditListQuery | AuditExportQuery): SQL | undefined {
    const conditions: SQL[] = [];
    if (query.action) {
      conditions.push(eq(auditLog.action, query.action));
    }
    if (query.entityType) {
      conditions.push(eq(auditLog.entityType, query.entityType));
    }
    if (query.entityId) {
      conditions.push(eq(auditLog.entityId, query.entityId));
    }
    if (query.actorId) {
      conditions.push(eq(auditLog.actorId, query.actorId));
    }
    if (query.from) {
      conditions.push(gte(auditLog.createdAt, new Date(query.from)));
    }
    if (query.to) {
      conditions.push(lte(auditLog.createdAt, new Date(query.to)));
    }
    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  private async count(where: SQL | undefined): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(where);
    return row?.value ?? 0;
  }

  private async selectRows(
    where: SQL | undefined,
    limit: number,
    offset: number,
  ): Promise<AuditRow[]> {
    const rows = await this.db
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        actorId: auditLog.actorId,
        actorEmail: users.email,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        reason: auditLog.reason,
        payload: auditLog.payload,
      })
      .from(auditLog)
      // `actor_id` is nullable and rows whose actor lookup failed keep it null
      // (ADR 0021 decision 7) — a left join so those rows still appear.
      .leftJoin(users, eq(auditLog.actorId, users.id))
      .where(where)
      // `created_at` alone is not unique, and offset pagination over a
      // non-unique sort can repeat or skip a row between pages.
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(limit)
      .offset(offset);

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
