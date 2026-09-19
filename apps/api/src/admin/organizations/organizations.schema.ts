import { z } from "zod";

/**
 * E4.1c / ADR 0070 decision 8 — is `code` a currency ISO 4217 knows? The
 * shape (`^[A-Z]{3}$`) is the regex's job and the database CHECK's; this is
 * the MEMBERSHIP check, through the engine's own table (162 codes on Node 20)
 * rather than a second copy of it. Guarded: `Intl.supportedValuesOf` is
 * ES2023 and absent on older engines, where the shape check alone stands —
 * the guard fails OPEN so an old engine does not refuse every create.
 */
export function isKnownCurrency(code: string): boolean {
  return typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("currency").includes(code)
    : true;
}

/** Three upper-case ASCII letters that ISO 4217 lists. The form uppercases; the API does not. */
const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "currency must be three upper-case letters (ISO 4217, e.g. INR)")
  .refine(isKnownCurrency, {
    message: "currency is not an ISO 4217 code the runtime knows (e.g. INR, ZAR, USD)",
  })
  // ADR 0029 decision 10: zod-to-json-schema emits nothing for a refinement.
  .describe("ISO 4217 currency code: three upper-case letters the runtime's Intl.supportedValuesOf('currency') lists (e.g. INR, ZAR, USD).");

export const createOrganizationBodySchema = z
  .object({
    code: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[A-Z0-9_-]+$/),
    name: z.string().min(2).max(255),
    // E4.1c (plan Q12): required on create — the column is NOT NULL with no
    // default, so a create without it would otherwise be a 500 off 23502.
    currency: currencySchema,
    meta: z.record(z.unknown()).optional(),
  })
  .strict();

export const updateOrganizationBodySchema = z
  .object({
    name: z.string().min(2).max(255).optional(),
    currency: currencySchema.optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .strict();

export type CreateOrganizationBody = z.infer<typeof createOrganizationBodySchema>;
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationBodySchema>;
