import { ConflictException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { OnboardingCredentialCopyService } from "./onboarding-credential-copy.service";
import type { OnboardingService } from "./onboarding.service";

/**
 * `F4.339` / ADR 0117 decision 7 (plan T7.2) — the credential copy against a
 * real database: the blob as stored in `_secrets`, the audit row with codes and
 * no blob, a committed source's bytes and key version, another organization's
 * RTU as a 404, `replace`, and a broker mismatch that writes nothing.
 * Assertions here (ADR 0014); the sibling `.test.ts` owns the lifecycle.
 */
export type CopyCtx = {
  readonly pool: pg.Pool;
  readonly service: OnboardingService;
  readonly copies: OnboardingCredentialCopyService;
  readonly jwt: JwtPayload;
  /** A draft of three MQTT RTUs (`<p>-0..2`); the third's port is `thirdPort`. */
  readonly seed: (thirdPort?: number) => Promise<{ id: string; codes: string[] }>;
  /** A committed MQTT RTU with an encrypted credential: in the session's organization, or another. */
  readonly committedRtu: (own: boolean) => Promise<{ id: string; code: string; ciphertext: Buffer; keyVersion: number }>;
};

export const PORT = 8883;
const TEST_SECRET = { username: "f4339-test", password: "not-a-real-password" };

async function secretsOf(ctx: CopyCtx, id: string): Promise<Record<string, { c: string; iv: string; v?: number }>> {
  const { rows } = await ctx.pool.query<{ s: Record<string, { c: string; iv: string; v?: number }> | null }>(
    "SELECT draft->'_secrets' AS s FROM bms.onboarding_sessions WHERE id = $1",
    [id],
  );
  return rows[0]?.s ?? {};
}

async function audits(ctx: CopyCtx, id: string): Promise<unknown[]> {
  const { rows } = await ctx.pool.query<{ payload: unknown }>(
    "SELECT payload FROM bms.audit_log WHERE entity_id = $1 AND action = 'onboarding.credentials.copy' ORDER BY created_at",
    [id],
  );
  return rows.map((r) => r.payload);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a refusal");
}

/** CC1 — a same-draft copy: three equal blobs, both targets credentialsSet, one audit row with codes and no blob. */
export async function assertASameDraftCopy(ctx: CopyCtx): Promise<void> {
  const { id, codes } = await ctx.seed();
  await ctx.service.setCredentials(ctx.jwt, id, { rtuIndex: 0, credentials: TEST_SECRET });
  const dto = await ctx.copies.copy(ctx.jwt, id, { from: { rtuIndex: 0 }, toRtuIndexes: [1, 2] });

  expect(dto.draft.rtus?.map((r) => r.credentialsSet)).toEqual([true, true, true]);
  // ADR 0022: the answer is the redacted session.
  expect(JSON.stringify(dto)).not.toContain("_secrets");
  const secrets = await secretsOf(ctx, id);
  expect(Object.keys(secrets).sort()).toEqual([...codes].sort());
  // The stored bytes as they were, plus the broker binding (review H1).
  const bound = { ...secrets[codes[0]!], b: { host: "broker.test", port: PORT, tls: true } };
  expect(secrets[codes[1]!]).toEqual(bound);
  expect(secrets[codes[2]!]).toEqual(bound);
  const rows = await audits(ctx, id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ from: { rtuCode: codes[0] }, to: [codes[1], codes[2]], replace: false });
  expect(JSON.stringify(rows[0])).not.toContain(secrets[codes[0]!]!.c);
}

/** CC2 — held targets refuse without `replace`, naming both codes and writing nothing; `replace: true` copies. */
export async function assertReplaceDecides(ctx: CopyCtx): Promise<void> {
  const { id, codes } = await ctx.seed();
  await ctx.service.setCredentials(ctx.jwt, id, { rtuIndex: 0, credentials: TEST_SECRET });
  await ctx.copies.copy(ctx.jwt, id, { from: { rtuIndex: 0 }, toRtuIndexes: [1, 2] });
  const before = await secretsOf(ctx, id);

  const err = await rejection(ctx.copies.copy(ctx.jwt, id, { from: { rtuIndex: 0 }, toRtuIndexes: [1, 2] }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toContain(`${codes[1]}, ${codes[2]}`);
  expect(await secretsOf(ctx, id)).toEqual(before);
  expect(await audits(ctx, id)).toHaveLength(1);

  await ctx.copies.copy(ctx.jwt, id, { from: { rtuIndex: 0 }, toRtuIndexes: [1], replace: true });
  expect(await audits(ctx, id)).toHaveLength(2);
}

/** CC3 — a committed source: the draft blob is the row's bytes in base64, `v` its key version. */
export async function assertACommittedSourceCopiesItsBytes(ctx: CopyCtx): Promise<void> {
  const { id, codes } = await ctx.seed();
  const rtu = await ctx.committedRtu(true);
  await ctx.copies.copy(ctx.jwt, id, { from: { rtuId: rtu.id }, toRtuIndexes: [0] });
  const secrets = await secretsOf(ctx, id);
  expect(secrets[codes[0]!]?.c).toBe(rtu.ciphertext.toString("base64"));
  expect(secrets[codes[0]!]?.v).toBe(rtu.keyVersion);
  expect((await audits(ctx, id))[0]).toMatchObject({ from: { rtuId: rtu.id, rtuCode: rtu.code }, to: [codes[0]] });
}

/** CC4 — another organization's committed RTU reads as not found, and names nothing of it. */
export async function assertAnotherOrganizationsRtuIsNotFound(ctx: CopyCtx): Promise<void> {
  const { id } = await ctx.seed();
  const foreign = await ctx.committedRtu(false);
  const err = await rejection(ctx.copies.copy(ctx.jwt, id, { from: { rtuId: foreign.id }, toRtuIndexes: [0] }));
  expect(err).toBeInstanceOf(NotFoundException);
  expect((err as Error).message).not.toContain(foreign.code);
  expect(await secretsOf(ctx, id)).toEqual({});
}

/** CC5 — a target on another port refuses the whole copy; nothing is written. */
export async function assertABrokerMismatchWritesNothing(ctx: CopyCtx): Promise<void> {
  const { id, codes } = await ctx.seed(PORT + 1);
  await ctx.service.setCredentials(ctx.jwt, id, { rtuIndex: 0, credentials: TEST_SECRET });
  const before = await secretsOf(ctx, id);
  const err = await rejection(ctx.copies.copy(ctx.jwt, id, { from: { rtuIndex: 0 }, toRtuIndexes: [1, 2] }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toContain(codes[2]);
  expect(await secretsOf(ctx, id)).toEqual(before);
  expect(await audits(ctx, id)).toEqual([]);
}

/** CC6 (review H1) — after a copy, moving the target to another host drops its credential; the source keeps its own. */
export async function assertAHostEditDropsACopiedCredential(ctx: CopyCtx): Promise<void> {
  const { id, codes } = await ctx.seed();
  await ctx.service.setCredentials(ctx.jwt, id, { rtuIndex: 0, credentials: TEST_SECRET });
  const copied = await ctx.copies.copy(ctx.jwt, id, { from: { rtuIndex: 0 }, toRtuIndexes: [1] });
  const rtus = (copied.draft.rtus ?? []).map((rtu, i) => (i === 1 ? { ...rtu, config: { ...rtu.config, host: "elsewhere.test" } } : rtu));
  // The RTU section alone: a patch that names no location type skips the vocabulary check.
  const dto = await ctx.service.patchDraft(ctx.jwt, id, { rtus } as never);
  expect(dto.draft.rtus?.map((r) => r.credentialsSet)).toEqual([true, false, false]);
  expect(Object.keys(await secretsOf(ctx, id))).toEqual([codes[0]]);
}
