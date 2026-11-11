import { z } from "zod";

/**
 * `F4.17` / ADR 0125 decisions 10–15 — the `/api/v1/admin/service-accounts`
 * contracts. A service account is a `bms.users` row with `kind = 'service'`,
 * capped at `viewer` or `operator` (Q8); its tokens are `bms_sat_` bearer
 * tokens whose secret appears in **one** response only — the create-token
 * response — and is never stored, listed or audited.
 */

export const serviceAccountRoleSchema = z.enum(["viewer", "operator"]);

export const SERVICE_TOKEN_DEFAULT_EXPIRY_DAYS = 90;
export const SERVICE_TOKEN_MAX_EXPIRY_DAYS = 365;
/** Decision 13: at most two live tokens per account — enough to rotate with overlap. */
export const SERVICE_TOKEN_MAX_LIVE = 2;

const name = z.string().trim().min(1).max(128);

export const createServiceAccountBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    name,
    role: serviceAccountRoleSchema,
  })
  .strict();

export const updateServiceAccountBodySchema = z
  .object({
    name: name.optional(),
    role: serviceAccountRoleSchema.optional(),
    /** `true` disables the account and revokes every live token (decision 13); `false` re-enables it. */
    disabled: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to change" });

export const createServiceTokenBodySchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    expiresInDays: z
      .number()
      .int()
      .min(1)
      .max(SERVICE_TOKEN_MAX_EXPIRY_DAYS)
      .default(SERVICE_TOKEN_DEFAULT_EXPIRY_DAYS),
    readOnly: z.boolean().default(false),
  })
  .strict();

export const serviceAccountGrantKindSchema = z.enum(["location", "asset_group"]);

export const addServiceAccountGrantBodySchema = z
  .object({
    kind: serviceAccountGrantKindSchema,
    targetId: z.string().uuid(),
  })
  .strict();

export const serviceTokenStatusSchema = z.enum(["active", "revoked", "expired"]);

/** One token as every list shows it: the public id, never the secret or its hash. */
export const serviceTokenDtoSchema = z
  .object({
    id: z.string().uuid(),
    tokenId: z.string().regex(/^[A-Za-z0-9]{12}$/),
    name: z.string(),
    readOnly: z.boolean(),
    status: serviceTokenStatusSchema,
    expiresAt: z.string(),
    createdAt: z.string(),
    revokedAt: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
  })
  .strict();

export const serviceAccountGrantDtoSchema = z
  .object({
    id: z.string().uuid(),
    kind: serviceAccountGrantKindSchema,
    targetId: z.string().uuid(),
    targetName: z.string(),
  })
  .strict();

export const serviceAccountDtoSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    name: z.string(),
    role: serviceAccountRoleSchema,
    disabledAt: z.string().nullable(),
    createdAt: z.string(),
    tokens: z.array(serviceTokenDtoSchema),
    grants: z.array(serviceAccountGrantDtoSchema),
  })
  .strict();

export const serviceAccountsListResponseSchema = z.object({ items: z.array(serviceAccountDtoSchema) }).strict();

export const serviceAccountResponseSchema = z.object({ item: serviceAccountDtoSchema }).strict();

/** The **only** response that carries a secret. The SPA shows it once and keeps it nowhere. */
export const createServiceTokenResponseSchema = z
  .object({
    token: z.string().regex(/^bms_sat_[A-Za-z0-9]{12}_[A-Za-z0-9_-]{43}$/),
    item: serviceTokenDtoSchema,
  })
  .strict();

export type ServiceAccountRole = z.infer<typeof serviceAccountRoleSchema>;
export type CreateServiceAccountBody = z.infer<typeof createServiceAccountBodySchema>;
export type UpdateServiceAccountBody = z.infer<typeof updateServiceAccountBodySchema>;
export type CreateServiceTokenBody = z.input<typeof createServiceTokenBodySchema>;
export type AddServiceAccountGrantBody = z.infer<typeof addServiceAccountGrantBodySchema>;
export type ServiceTokenDto = z.infer<typeof serviceTokenDtoSchema>;
export type ServiceAccountGrantDto = z.infer<typeof serviceAccountGrantDtoSchema>;
export type ServiceAccountDto = z.infer<typeof serviceAccountDtoSchema>;
export type ServiceAccountsListResponse = z.infer<typeof serviceAccountsListResponseSchema>;
export type ServiceAccountResponse = z.infer<typeof serviceAccountResponseSchema>;
export type CreateServiceTokenResponse = z.infer<typeof createServiceTokenResponseSchema>;
