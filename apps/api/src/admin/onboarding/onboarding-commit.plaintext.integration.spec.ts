import { BadRequestException } from "@nestjs/common";
import { MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE, type JwtPayload, type OnboardingCommitResponseDto } from "@bms/shared";
import type pg from "pg";
import { expect } from "vitest";

import type { OnboardingCommitService } from "./onboarding-commit.service";

/**
 * `F4.326` / ADR 0114 decisions 5 and 6 — the commit runs the validator's
 * plain-MQTT check before any write, stores a listed RTU's `config.tls` as the
 * JSON `false`, and records each plain RTU by code in the commit audit entry.
 * Assertions live here (ADR 0014); the `.test` sibling owns the database.
 */
export interface OnboardingPlaintextCtx {
  readonly ownerPool: pg.Pool;
  /** Built with `MQTT_PLAINTEXT_HOSTS` holding the plain RTU's host. */
  readonly listedSvc: OnboardingCommitService;
  /** Built with a bare validator: no host may connect plain. */
  readonly bareSvc: OnboardingCommitService;
  readonly jwt: JwtPayload;
  readonly refusedSessionId: string;
  readonly refusedLocationCode: string;
  readonly listedSessionId: string;
  readonly plainCode: string;
  readonly tlsCode: string;
  readonly committed: { listed?: OnboardingCommitResponseDto };
}

/** P1 — an unlisted plain RTU: the commit answers 400 with the fixed message and writes no location. */
export async function assertAnUnlistedPlainDraftCommitsNothing(ctx: OnboardingPlaintextCtx): Promise<void> {
  let thrown: unknown;
  try {
    await ctx.bareSvc.commit(ctx.jwt, ctx.refusedSessionId);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(BadRequestException);
  expect(JSON.stringify((thrown as BadRequestException).getResponse())).toContain(MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE);
  const { rows } = await ctx.ownerPool.query("SELECT 1 FROM bms.locations WHERE code = $1", [ctx.refusedLocationCode]);
  expect(rows).toHaveLength(0);
}

/** P2 — a listed plain RTU commits, and its stored config carries the JSON `false`. */
export async function assertAListedPlainRtuStoresTlsFalse(ctx: OnboardingPlaintextCtx): Promise<void> {
  ctx.committed.listed = await ctx.listedSvc.commit(ctx.jwt, ctx.listedSessionId);
  const { rows } = await ctx.ownerPool.query<{ code: string; plain: boolean }>(
    `SELECT r.code, c.config->'tls' = 'false'::jsonb AS plain
       FROM bms.rtus r JOIN bms.rtu_connection_configs c ON c.rtu_id = r.id
      WHERE r.id = ANY($1) ORDER BY r.code`,
    [ctx.committed.listed.rtuIds],
  );
  expect(rows.map((r) => [r.code, r.plain === true])).toEqual(
    [
      [ctx.plainCode, true],
      [ctx.tlsCode, false],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

/** P3 — the commit audit entry records the plain RTU by code only (ruling 7). Runs after P2. */
export async function assertTheCommitAuditRecordsThePlainRtu(ctx: OnboardingPlaintextCtx): Promise<void> {
  const { rows } = await ctx.ownerPool.query<{ plaintext: unknown }>(
    `SELECT payload->'plaintextRtus' AS plaintext FROM bms.audit_log
      WHERE action = 'master.onboarding.commit' AND entity_id = $1`,
    [ctx.listedSessionId],
  );
  expect(rows.map((r) => r.plaintext)).toEqual([[{ code: ctx.plainCode, tls: false }]]);
}
