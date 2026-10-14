import { expect } from "vitest";
import type pg from "pg";

import type { OnboardingCommitResponseDto } from "@bms/shared";

/**
 * `F4.258` (ADR 0099 Amendment 2, owner option A) — a committed onboarding
 * session keeps no encrypted RTU credentials, measured on real rows.
 * Assertions live here (ADR 0014); the `.test` sibling owns the database
 * lifecycle and runs the commit once, in `beforeAll`, under a loaded key.
 *
 * The unit twin `onboarding-commit-strip-secrets.spec.ts` holds the shape of
 * the update. This file holds what only Postgres can say: that `jsonb - text`
 * on the stored column removes the key, that the RTU's
 * `rtu_connection_configs` row still received the ciphertext the strip
 * removed, and that an open draft in the same organization is untouched — the
 * positive beside the absence.
 */
export interface StripSecretsCtx {
  readonly ownerPool: pg.Pool;
  readonly committedSessionId: string;
  readonly openSessionId: string;
  readonly committed: OnboardingCommitResponseDto;
  /** The base64 ciphertext the committed draft's `_secrets` carried. */
  readonly committedCiphertext: string;
  /** The `_secrets` map the open draft was seeded with. */
  readonly openSecrets: Record<string, unknown>;
}

/** C1 — the committed row is committed, still has its draft, and holds no `_secrets` key. */
export async function assertTheCommittedDraftHoldsNoSecrets(ctx: StripSecretsCtx): Promise<void> {
  const { rows } = await ctx.ownerPool.query<{ status: string; has_location: boolean; has_secrets: boolean }>(
    `SELECT status, draft ? 'location' AS has_location, draft ? '_secrets' AS has_secrets
       FROM bms.onboarding_sessions WHERE id = $1`,
    [ctx.committedSessionId],
  );
  expect(rows).toEqual([{ status: "committed", has_location: true, has_secrets: false }]);
}

/** C2 — the RTU's connection config holds the ciphertext the draft carried. */
export async function assertTheConnectionConfigHoldsTheCiphertext(ctx: StripSecretsCtx): Promise<void> {
  const { rows } = await ctx.ownerPool.query<{ ciphertext: Buffer | null }>(
    `SELECT credentials_ciphertext AS ciphertext FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`,
    [ctx.committed.rtuIds],
  );
  expect(rows.map((row) => row.ciphertext?.toString("base64") ?? null)).toEqual([ctx.committedCiphertext]);
}

/** C3 — an open draft in the same organization keeps its `_secrets` as seeded. */
export async function assertAnOpenDraftKeepsItsSecrets(ctx: StripSecretsCtx): Promise<void> {
  const { rows } = await ctx.ownerPool.query<{ status: string; secrets: unknown }>(
    `SELECT status, draft->'_secrets' AS secrets FROM bms.onboarding_sessions WHERE id = $1`,
    [ctx.openSessionId],
  );
  expect(rows).toEqual([{ status: "draft", secrets: ctx.openSecrets }]);
}
