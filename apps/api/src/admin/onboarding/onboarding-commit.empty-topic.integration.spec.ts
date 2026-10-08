import { expect } from "vitest";
import type pg from "pg";

import type { JwtPayload, OnboardingCommitResponseDto } from "@bms/shared";

import type { OnboardingCommitService } from "./onboarding-commit.service";

/**
 * `F4.228` — the onboarding commit stores an empty RTU topic as NULL.
 * `rtus_mqtt_topic_idx` is `UNIQUE (mqtt_topic) WHERE mqtt_topic IS NOT NULL`,
 * so a stored `''` is a value two RTUs cannot share. Assertions live here
 * (ADR 0014); the `.test` sibling owns the database lifecycle.
 */
export interface OnboardingEmptyTopicCtx {
  readonly ownerPool: pg.Pool;
  readonly commitSvc: OnboardingCommitService;
  readonly jwt: JwtPayload;
  readonly secondSessionId: string;
  readonly thirdSessionId: string;
  readonly committed: {
    first?: OnboardingCommitResponseDto;
    second?: OnboardingCommitResponseDto;
    third?: OnboardingCommitResponseDto;
  };
}

async function topicsOf(ctx: OnboardingEmptyTopicCtx, ids: readonly string[]) {
  const { rows } = await ctx.ownerPool.query<{ id: string; mqtt_topic: string | null }>(
    "SELECT id, mqtt_topic FROM bms.rtus WHERE id = ANY($1) ORDER BY code",
    [ids],
  );
  return rows;
}

/** E1 — the second empty-topic RTU saves. The store into ctx precedes the expect so afterAll can clean. */
export async function assertASecondOnboardedRtuWithAnEmptyTopicSaves(
  ctx: OnboardingEmptyTopicCtx,
): Promise<void> {
  ctx.committed.second = await ctx.commitSvc.commit(ctx.jwt, ctx.secondSessionId);
  expect(ctx.committed.second.rtuIds.length, "the second empty-topic RTU committed").toBe(1);
}

/**
 * E2 — measures the rows the commits wrote, not the value they returned. It reads
 * `committed.second`, which E1 stores, so it runs after E1 and not alone.
 */
export async function assertBothOnboardedEmptyTopicsAreNull(ctx: OnboardingEmptyTopicCtx): Promise<void> {
  const ids = [ctx.committed.first?.rtuIds[0], ctx.committed.second?.rtuIds[0]].filter(
    (id): id is string => id !== undefined,
  );
  const rows = await topicsOf(ctx, ids);
  expect({ count: rows.length, topics: rows.map((r) => r.mqtt_topic) }).toEqual({
    count: 2,
    topics: [null, null],
  });
}

/** E3 — `topic: ""` beside a legacy `mqttTopic` is an empty topic, not the legacy key. */
export async function assertAnEmptyTopicBesideALegacyKeyIsNull(ctx: OnboardingEmptyTopicCtx): Promise<void> {
  ctx.committed.third = await ctx.commitSvc.commit(ctx.jwt, ctx.thirdSessionId);
  const rows = await topicsOf(ctx, ctx.committed.third.rtuIds);
  expect(rows.map((r) => r.mqtt_topic)).toEqual([null]);
}
