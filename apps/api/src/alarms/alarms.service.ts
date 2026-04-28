import {
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";

import { alarms, assets, auditLog, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AlarmListItem, JwtPayload } from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";
import { AlarmsGateway } from "./alarms.gateway";

function encodeCursor(raisedAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ t: raisedAt.toISOString(), id }),
    "utf-8",
  ).toString("base64url");
}

function decodeCursor(raw: string): { raisedAt: Date; id: string } {
  const j = JSON.parse(
    Buffer.from(raw, "base64url").toString("utf-8"),
  ) as { t: string; id: string };
  return { raisedAt: new Date(j.t), id: j.id };
}

@Injectable()
export class AlarmsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly gateway: AlarmsGateway,
  ) {}

  private mapRow(r: {
    id: string;
    assetId: string;
    ruleKey: string | null;
    severity: string;
    message: string;
    raisedAt: Date;
    acknowledgedAt: Date | null;
    acknowledgedBy: string | null;
    assetCode: string;
    assetName: string;
    siteName: string;
  }): AlarmListItem {
    return {
      id: r.id,
      assetId: r.assetId,
      ruleKey: r.ruleKey,
      severity: r.severity,
      message: r.message,
      raisedAt: r.raisedAt.toISOString(),
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: r.acknowledgedBy,
      assetCode: r.assetCode,
      assetName: r.assetName,
      siteName: r.siteName,
    };
  }

  /**
   * Keyset pagination on `(raised_at DESC, id DESC)`.
   */
  async list(opts: {
    cursor?: string;
    limit: number;
  }): Promise<{ items: AlarmListItem[]; nextCursor: string | null }> {
    const limit = Math.min(100, Math.max(1, opts.limit));
    const cursor = opts.cursor;

    const base = this.db
      .select({
        id: alarms.id,
        assetId: alarms.assetId,
        ruleKey: alarms.ruleKey,
        severity: alarms.severity,
        message: alarms.message,
        raisedAt: alarms.raisedAt,
        acknowledgedAt: alarms.acknowledgedAt,
        acknowledgedBy: alarms.acknowledgedBy,
        assetCode: assets.code,
        assetName: assets.name,
        siteName: assets.siteName,
      })
      .from(alarms)
      .innerJoin(assets, eq(alarms.assetId, assets.id));

    const c = cursor ? decodeCursor(cursor) : null;
    const rows = await (c
      ? base
          .where(
            or(
              lt(alarms.raisedAt, c.raisedAt),
              and(eq(alarms.raisedAt, c.raisedAt), lt(alarms.id, c.id)),
            ),
          )
          .orderBy(desc(alarms.raisedAt), desc(alarms.id))
          .limit(limit + 1)
      : base.orderBy(desc(alarms.raisedAt), desc(alarms.id)).limit(limit + 1));

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(last.raisedAt, last.id)
        : null;

    return {
      items: page.map((r) => this.mapRow(r)),
      nextCursor,
    };
  }

  /**
   * Acknowledges an alarm and writes a lightweight audit row.
   */
  async acknowledge(
    alarmId: string,
    actor: Pick<JwtPayload, "sub" | "email">,
    reason: string,
  ): Promise<AlarmListItem> {
    const [actorRow] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, actor.sub), eq(users.email, actor.email)))
      .limit(1);
    const dbActorId = actorRow?.id ?? null;

    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(alarms)
        .set({
          acknowledgedAt: new Date(),
          acknowledgedBy: dbActorId,
        })
        .where(and(eq(alarms.id, alarmId), isNull(alarms.acknowledgedAt)))
        .returning({ id: alarms.id });

      if (updated.length === 0) {
        throw new NotFoundException("Alarm not found or already acknowledged");
      }

      await tx.insert(auditLog).values({
        actorId: dbActorId,
        action: "alarm_ack",
        entityType: "alarm",
        entityId: alarmId,
        reason,
        payload: {
          alarmId,
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });

      const [row] = await tx
        .select({
          id: alarms.id,
          assetId: alarms.assetId,
          ruleKey: alarms.ruleKey,
          severity: alarms.severity,
          message: alarms.message,
          raisedAt: alarms.raisedAt,
          acknowledgedAt: alarms.acknowledgedAt,
          acknowledgedBy: alarms.acknowledgedBy,
          assetCode: assets.code,
          assetName: assets.name,
          siteName: assets.siteName,
        })
        .from(alarms)
        .innerJoin(assets, eq(alarms.assetId, assets.id))
        .where(eq(alarms.id, alarmId))
        .limit(1);

      if (!row) {
        throw new NotFoundException("Alarm vanished after update");
      }

      const item = this.mapRow(row);
      this.gateway.broadcastAcknowledged(item);
      return item;
    });
  }
}
