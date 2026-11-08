import pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { RtusAdminService } from "./rtus.service";

/**
 * `F4.339` / ADR 0117 decision 8 (plan T5.1) — deactivating an RTU releases its MQTT topic into
 * `released_mqtt_topic`, so another RTU can take it; reactivating restores it only while no RTU of
 * any organization holds it, and never names that holder. Assertions here (ADR 0014); the sibling
 * `.test.ts` owns the database lifecycle. Read-backs run on `bms_fleet` (BYPASSRLS).
 */
export type TopicReleaseCtx = {
  readonly svc: RtusAdminService;
  readonly fixturePool: pg.Pool;
  readonly locationId: string;
  /** A location of another organization, for the cross-tenant holder. */
  readonly otherLocationId: string;
  readonly otherOrganizationId: string;
  readonly createdRtuIds: string[];
};

let seq = 0;
const tag = (): string => `f4339-tr-${process.pid}-${Date.now()}-${seq++}`;

async function createRtu(ctx: TopicReleaseCtx, jwt: JwtPayload, mqttTopic?: string): Promise<string> {
  const code = tag();
  const rtu = await ctx.svc.create(jwt, {
    locationId: ctx.locationId,
    code,
    displayName: `F4.339 ${code}`,
    sourceType: "catalog",
    ...(mqttTopic === undefined ? {} : { mqttTopic }),
  });
  ctx.createdRtuIds.push(rtu.id);
  return rtu.id;
}

async function topicsOf(ctx: TopicReleaseCtx, id: string): Promise<{ mqtt_topic: string | null; released_mqtt_topic: string | null; active: boolean }> {
  const { rows } = await ctx.fixturePool.query<{ mqtt_topic: string | null; released_mqtt_topic: string | null; active: boolean }>(
    "SELECT mqtt_topic, released_mqtt_topic, active FROM bms.rtus WHERE id = $1",
    [id],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function auditPayloads(ctx: TopicReleaseCtx, id: string, action: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await ctx.fixturePool.query<{ payload: Record<string, unknown> }>(
    "SELECT payload FROM bms.audit_log WHERE entity_id = $1 AND action = $2 ORDER BY created_at",
    [id, action],
  );
  return rows.map((row) => row.payload);
}

/** TR1 — deactivate moves the topic to `released_mqtt_topic`, audits `topicReleased: true`, and frees the topic. */
export async function assertDeactivateReleasesTheTopic(ctx: TopicReleaseCtx, jwt: JwtPayload): Promise<void> {
  const topic = `${tag()}/t1`;
  const id = await createRtu(ctx, jwt, topic);
  const dto = await ctx.svc.deactivate(jwt, id);
  expect([dto.mqttTopic, dto.releasedMqttTopic]).toEqual([null, topic]);
  expect(await topicsOf(ctx, id)).toEqual({ mqtt_topic: null, released_mqtt_topic: topic, active: false });
  const payloads = await auditPayloads(ctx, id, "master.rtu.deactivate");
  expect(payloads).toHaveLength(1);
  expect(payloads[0]?.topicReleased).toBe(true);
  // The topic is free: a new RTU takes it.
  await createRtu(ctx, jwt, topic);
}

/** TR2 — reactivate with the topic free restores it and audits `topicRestored: true`. */
export async function assertReactivateRestoresAFreeTopic(ctx: TopicReleaseCtx, jwt: JwtPayload): Promise<void> {
  const topic = `${tag()}/t2`;
  const id = await createRtu(ctx, jwt, topic);
  await ctx.svc.deactivate(jwt, id);
  const dto = await ctx.svc.reactivate(jwt, id);
  expect([dto.active, dto.mqttTopic, dto.releasedMqttTopic]).toEqual([true, topic, null]);
  expect(await topicsOf(ctx, id)).toEqual({ mqtt_topic: topic, released_mqtt_topic: null, active: true });
  expect((await auditPayloads(ctx, id, "master.rtu.reactivate"))[0]?.topicRestored).toBe(true);
}

/** TR3 — a topic held by another organization's RTU is not restored, and the response names no other row. */
export async function assertReactivateKeepsAHeldTopicReleased(ctx: TopicReleaseCtx, jwt: JwtPayload): Promise<void> {
  const topic = `${tag()}/t3`;
  const id = await createRtu(ctx, jwt, topic);
  await ctx.svc.deactivate(jwt, id);
  const holderCode = tag();
  const holder = await ctx.fixturePool.query<{ id: string }>(
    `INSERT INTO bms.rtus (organization_id, location_id, code, display_name, mqtt_topic)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [ctx.otherOrganizationId, ctx.otherLocationId, holderCode, `F4.339 ${holderCode}`, topic],
  );
  ctx.createdRtuIds.push(holder.rows[0]!.id);
  const dto = await ctx.svc.reactivate(jwt, id);
  expect([dto.active, dto.mqttTopic, dto.releasedMqttTopic]).toEqual([true, null, topic]);
  expect(JSON.stringify(dto)).not.toContain(holderCode);
  expect(JSON.stringify(dto)).not.toContain(ctx.otherOrganizationId);
  expect(await topicsOf(ctx, id)).toEqual({ mqtt_topic: null, released_mqtt_topic: topic, active: true });
  expect((await auditPayloads(ctx, id, "master.rtu.reactivate"))[0]?.topicRestored).toBe(false);
}

/** TR4 — deactivating an RTU with no topic leaves `released_mqtt_topic` NULL and audits `topicReleased: false`. */
export async function assertDeactivateWithoutATopicReleasesNothing(ctx: TopicReleaseCtx, jwt: JwtPayload): Promise<void> {
  const id = await createRtu(ctx, jwt);
  await ctx.svc.deactivate(jwt, id);
  expect(await topicsOf(ctx, id)).toEqual({ mqtt_topic: null, released_mqtt_topic: null, active: false });
  expect((await auditPayloads(ctx, id, "master.rtu.deactivate"))[0]?.topicReleased).toBe(false);
}
