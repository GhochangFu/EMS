import { z } from "zod";

export const onboardingPhaseSchema = z.enum([
  "location",
  "rtu",
  "point_keys",
  "assets",
  "mappings",
  "review",
]);

export const onboardingProtocolSchema = z.enum([
  "mqtt",
  "simulator",
  "catalog",
  "modbus_tcp",
  "bacnet",
  "opc_ua",
  "snmp",
  "rest_poller",
]);

export const draftLocationSchema = z.object({
  code: z.string().min(2).max(64).regex(/^[A-Z0-9_-]+$/),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(255),
  type: z.enum(["smoc_campus", "rsmoc", "csmoc"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  province: z.string().max(64).optional(),
  capital: z.string().max(128).optional(),
  meta: z.record(z.unknown()).optional(),
});

export const draftRtuSchema = z.object({
  // Trimmed at the boundary so two RTUs cannot differ by invisible whitespace
  // alone. `_secrets` is keyed by this code (ADR 0022 Amendment 5), and JS
  // `.trim()` eats NBSP — which renders as an ordinary space in the wizard, so
  // the near-duplicate is undetectable by eye. `rtuCodeAt` refuses a contested
  // code independently; this stops the alias being created in the first place.
  code: z.string().trim().min(2).max(64),
  displayName: z.string().min(2).max(255),
  protocol: onboardingProtocolSchema,
  config: z.record(z.unknown()).default({}),
  credentialsSet: z.boolean().optional(),
  domain: z.string().max(64).optional(),
  externalRtuId: z.number().int().optional(),
  rtuCode: z.string().max(64).optional(),
  stationCode: z.string().max(64).optional(),
  stationName: z.string().max(255).optional(),
  ingestEnabled: z.boolean().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const draftPointKeySchema = z.object({
  code: z.string().min(1).max(128),
  name: z.string().min(1).max(255),
  domain: z.string().max(64).optional(),
  unit: z.string().max(32).optional(),
  description: z.string().optional(),
});

export const draftAssetSchema = z.object({
  rtuIndex: z.number().int().min(0),
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(255),
  siteName: z.string().min(2).max(255),
  domain: z.string().min(1).max(64),
  meta: z.record(z.unknown()).optional(),
});

export const draftAssetPointSchema = z.object({
  assetIndex: z.number().int().min(0),
  pointKey: z.string().min(1).max(128),
  sourceDataKey: z.string().min(1).max(128),
  sensorCode: z.string().max(64).optional(),
  unit: z.string().max(32).optional(),
});

export const onboardingDraftMetaSchema = z.object({
  rtuTargetCount: z.number().int().positive().optional(),
  importedFromExcel: z.boolean().optional(),
  useExistingPointKeys: z.boolean().optional(),
});

export const onboardingDraftSchema = z.object({
  location: draftLocationSchema.optional(),
  rtus: z.array(draftRtuSchema).optional(),
  pointKeys: z.array(draftPointKeySchema).optional(),
  assets: z.array(draftAssetSchema).optional(),
  assetPoints: z.array(draftAssetPointSchema).optional(),
  onboardingMeta: onboardingDraftMetaSchema.optional(),
});

export const createSessionBodySchema = z.object({
  organizationId: z.string().uuid(),
});

export const chatBodySchema = z.object({
  message: z.string().min(1).max(8000),
});

/**
 * `POST :id/credentials` (ADR 0022 decision 1). Values are plaintext in the
 * request body and encrypted before storage — they are never echoed back,
 * never written to `messages`, and never sent to the LLM.
 */
export const setCredentialsBodySchema = z
  .object({
    rtuIndex: z.number().int().min(0),
    credentials: z
      .record(z.string().min(1).max(4096))
      .refine((value) => Object.keys(value).length > 0, {
        message: "At least one credential field is required",
      }),
  })
  .strict();

export type SetCredentialsBody = z.infer<typeof setCredentialsBodySchema>;

export const patchDraftBodySchema = z.object({
  draft: onboardingDraftSchema,
});

export type OnboardingDraftInput = z.infer<typeof onboardingDraftSchema>;
export type OnboardingPhase = z.infer<typeof onboardingPhaseSchema>;
