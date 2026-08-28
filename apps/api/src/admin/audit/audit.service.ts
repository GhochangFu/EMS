import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as XLSX from "xlsx";

import { auditLog, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AuditLogListResponse, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE } from "../../database/database.tokens";
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
 * Reads `bms.audit_log` (ADR 0021, widened by ADR 0046).
 *
 * The global `admin` reads every organization unfiltered, exactly as before. An
 * `organization_admin` reads its own organizations' rows and nothing else —
 * `E7.1c` gave the column a writer, and `E7.1e` gives it a reader.
 * `location_admin` and `asset_group_admin` stay refused (ADR 0046 decision 4):
 * their scope is *sub*-organizational, an audit row carries an organization and
 * nothing finer, so returning their organization's rows would silently widen
 * them to `organization_admin`.
 *
 * **`organization_id IS NULL` is never in a scoped reader's result set** (ADR
 * 0046 decision 2) — not as pre-`0048` un-attributed history, not as a genuine
 * platform event. `inArray` never matches `NULL`, so the exclusion falls out of
 * the scope predicate rather than needing a clause of its own. It is asserted
 * directly in `audit.integration.spec.ts` all the same, because a later "show
 * the history too" edit would otherwise break it in silence.
 *
 * Every read runs on `fleetDb` (`bms_fleet`, BYPASSRLS), and ADR 0046 decision
 * 5 keeps it there for the scoped reader too — the ADR 0043 Amendment 3 named
 * reason. The tenant filter is explicit in the `WHERE` and is the same
 * predicate for `list` and `export`; a GUC-bound `tenantDb` read would add a
 * second, invisible filter that could only ever disagree with the first, and it
 * cannot express a multi-organization actor at all. `audit_log` also still
 * carries legitimately org-less rows (decision 5's platform events), which a
 * no-GUC tenant read makes invisible: `organization_id = current_org` is
 * `NULL = NULL`, never true. The provisioned-account probe in
 * {@link AuditAdminService.resolveReadScope} reads the same pool for the same
 * reason — an `admin` row is itself NULL-org.
 *
 * **Two disclosure questions this widening opens, and neither is answered by an
 * ADR yet.** The projection did not change; the audience did, which is exactly
 * the case ADR 0043 Amendment 6 exists to catch — a scoped read joining a table
 * that holds a legitimate `NULL`-organization row, where the `WHERE` clause is
 * not the whole gate and the `SELECT` list is the other half.
 *
 * 1. The actor left join returns `actorEmail`, and several writers put the
 *    acting operator's `oidcSubject` into `payload` (`rules.service.ts`,
 *    `alarm-enrichment.service.ts`, `channels.service.ts`). A fleet operator
 *    acting on a tenant's data is therefore identifiable to that tenant.
 * 2. `payload` is returned **verbatim** (ADR 0021), so the secret-bearing
 *    request-body surface recorded against `E8.3` now has a wider audience.
 *    ADR 0021 decision 6 was re-measured across every audit write site at
 *    `E7.1e`: no site passes a secret today, and `rtus.meta`
 *    (`z.record(z.unknown())`) is the one unbounded value space left.
 *
 * An earlier draft of this comment cited ADR 0021 decision 7 as settling
 * question 1. It does not — decision 7 rules only that `actor_id` stays
 * nullable and an unresolved actor renders as `null` rather than a fabricated
 * identity. It says nothing about who may read the actor. Both questions are
 * owed to the owner as an ADR 0046 amendment surface; nothing here pre-empts
 * the ruling, and the behaviour is unchanged from the global-admin reader.
 */
@Injectable()
export class AuditAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
  ) {}

  /** Lists audit rows, newest first. */
  async list(jwt: JwtPayload, query: AuditListQuery): Promise<AuditLogListResponse> {
    const scope = await this.resolveReadScope(jwt);
    const where = this.buildWhere(query, scope);

    const total = await this.count(where);
    const rows = await this.selectRows(where, query.limit, query.offset);

    return { items: rows, total, limit: query.limit, offset: query.offset };
  }

  /** Builds a CSV or XLSX export of the matching rows. */
  async export(jwt: JwtPayload, query: AuditExportQuery): Promise<AuditExportFile> {
    const scope = await this.resolveReadScope(jwt);
    const where = this.buildWhere(query, scope);

    // Count before selecting: refusing is the contract (ADR 0021 decision 5),
    // and a truncated export that looks complete is the failure being avoided.
    //
    // The count is of the SCOPED set (ADR 0046 decision 6). `where` already
    // carries the organization predicate, so a tenant admin is never refused an
    // export on the size of rows it cannot see.
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
   * The read gate, and the organization scope it resolves.
   *
   * ADR 0021 decision 1 (Amendment 1), as amended by ADR 0046 decisions 3 and
   * 4. Returns `null` for the global admin — read everything, unfiltered — or
   * the organization ids the caller may read. It was called
   * `requireGlobalAdmin` through `E7.1c`; a gate by that name that admits a
   * tenant is exactly the stale naming this repo has been bitten by, so the
   * name now states what it returns (decision 3).
   *
   * Three checks, in this order. **Check 2's role assertion is subsumed by
   * check 3** — `assertMasterDataRole` admits `location_admin`, which check 3
   * then refuses, so its only live function here is resolving the DB user.
   * Said explicitly because the opposite belief is the dangerous one: widening
   * check 3 to `location_admin` on the assumption that master data already
   * gates it would open the endpoint to a role ADR 0046 decision 4 refuses.
   *
   * **The provisioned-account probe stays first and unchanged.**
   * `AccessControlService` deliberately falls back to the JWT claim when **no**
   * `bms.users` row matches the token. ADR 0044 made a claimed `admin` refuse
   * outright, but every other claimed role still falls back, so an
   * unprovisioned principal claiming `organization_admin` would now reach the
   * scope branch below. Requiring a real row first means deleting a user's row
   * revokes rather than escalates them, on the wider gate as on the old one.
   *
   * **`requireMasterDataUser` stays**, and refuses `asset_group_admin` through
   * its `isMasterDataRole` check.
   *
   * **The role branch is keyed on the DB role, not on the scope and not on the
   * claim.** Not on the scope, because `writableOrganizationIds` resolves a
   * `location_admin` through `locationDerivedOrganizationIds` — its whole
   * organization, not its granted locations — so "a non-empty array means a
   * scoped read" would hand a `location_admin` the entire organization's audit
   * log and silently widen it to `organization_admin`, the exact read-gate-
   * wider-than-write-gate defect `E7.1c`'s review found on the channel routes
   * (§4.7). Not on `jwt.role`, because a token outlives a demotion by up to
   * `JWT_TTL` and the DB role is the authority every other gate here reads.
   *
   * An `organization_admin` with no grants resolves to an empty array, which
   * `buildWhere` turns into a predicate matching nothing — never into an
   * unfiltered read (§4.7).
   *
   * The claim fallback itself is pre-existing and out of scope to change here —
   * recorded against `F4.10` in `docs/BACKLOG.md` and owed its own ADR.
   */
  private async resolveReadScope(jwt: JwtPayload): Promise<string[] | null> {
    const [provisioned] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, jwt.sub), eq(users.email, jwt.email)))
      .limit(1);
    if (!provisioned) {
      throw new ForbiddenException(
        "Reading the audit log requires a provisioned account; this token matches no user",
      );
    }

    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role !== "admin" && user.role !== "organization_admin") {
      throw new ForbiddenException(
        "Reading the audit log requires the global admin or organization admin role",
      );
    }

    return this.accessControl.writableOrganizationIds(jwt);
  }

  /**
   * @param scope `null` reads every organization; an array reads exactly those,
   *   and `inArray` excludes the `NULL`-organization rows for free — ADR 0046
   *   decision 2. Conjoined here rather than in `selectRows` so `count` sees the
   *   same predicate, which is what makes the export cap count the scoped set
   *   (decision 6).
   */
  private buildWhere(
    query: AuditListQuery | AuditExportQuery,
    scope: string[] | null,
  ): SQL | undefined {
    const conditions: SQL[] = [];
    if (scope !== null) {
      // drizzle 0.38.4 compiles an empty array to `false`, so an
      // `organization_admin` with no grants matches nothing.
      conditions.push(inArray(auditLog.organizationId, scope));
    }
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
    const [row] = await this.fleetDb
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
    const rows = await this.fleetDb
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
