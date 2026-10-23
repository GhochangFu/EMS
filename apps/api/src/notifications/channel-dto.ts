import type { NotificationChannelDto } from "@bms/shared";

/**
 * `F4.279` — the channel's API projection, shared by `ChannelsService` (the
 * reads the worker loads) and `ChannelWritesService` (the API-only writes).
 */

/** The shape the ciphertext holds. `CredentialCryptoService` stores objects. */
export const SECRET_FIELD = "secret";

/**
 * A stored row as the API returns it.
 *
 * `hasSecret`, never the secret — not the plaintext, not the ciphertext, not
 * the key version (§9.6, ADR 0041 decision 8). The boolean is the whole of what
 * the admin screen needs to render "secret set".
 */
export function toDto(row: {
  id: string;
  organizationId: string | null;
  code: string;
  name: string;
  kind: string;
  config: unknown;
  enabled: boolean;
  secretCiphertext: Buffer | null;
  createdAt: Date;
  updatedAt: Date;
}): NotificationChannelDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    kind: row.kind,
    config: (row.config ?? {}) as Record<string, unknown>,
    enabled: row.enabled,
    hasSecret: row.secretCiphertext !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
