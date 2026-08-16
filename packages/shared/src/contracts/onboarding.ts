/**
 * AI onboarding wizard contracts (ADR 0011, ADR 0022).
 *
 * The draft schemas carry a lot of `.optional()` — that is the wizard's whole
 * shape: a draft is legitimately partial until it commits, and the validator
 * reports what is missing rather than the type forbidding it.
 *
 * **Nothing here may carry a credential.** `OnboardingDraftRtu.credentialsSet`
 * is a boolean by deliberate design (ADR 0022): the secret itself goes to the
 * encrypted store, never into the draft, and never into `messages`.
 */
import { z } from "zod";

import { assetDomainCodeSchema } from "./operations";

/** Onboarding wizard phase tracked by the AI bot. */
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

export const onboardingSessionStatusSchema = z.enum(["draft", "committed", "abandoned"]);

export const onboardingChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  createdAt: z.string(),
});

export const onboardingFieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const onboardingAutoOpenReasonSchema = z.enum([
  "review",
  "validation_errors",
  "ready_to_commit",
]);

export const onboardingDraftLocationSchema = z.object({
  code: z.string(),
  slug: z.string(),
  name: z.string(),
  type: z.enum(["smoc_campus", "rsmoc", "csmoc"]),
  latitude: z.number(),
  longitude: z.number(),
  province: z.string().optional(),
  capital: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const onboardingDraftRtuSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  protocol: onboardingProtocolSchema,
  config: z.record(z.unknown()),
  /** ADR 0022: a flag, never the secret. */
  credentialsSet: z.boolean().optional(),
  domain: z.string().optional(),
  externalRtuId: z.number().optional(),
  rtuCode: z.string().optional(),
  stationCode: z.string().optional(),
  stationName: z.string().optional(),
  ingestEnabled: z.boolean().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const onboardingDraftPointKeySchema = z.object({
  code: z.string(),
  name: z.string(),
  domain: z.string().optional(),
  unit: z.string().optional(),
  description: z.string().optional(),
});

export const onboardingDraftAssetSchema = z.object({
  rtuIndex: z.number(),
  code: z.string(),
  name: z.string(),
  siteName: z.string(),
  /**
   * ADR 0031 — this draft becomes a `bms.assets` row, so it carries the plant
   * vocabulary `assets_domain_fk` enforces. Shape only: the live value set is
   * a table (`bms.asset_domains`), so the check that the code *exists* happens
   * at commit against the database, not here.
   *
   * The `domain` fields on `onboardingDraftRtuSchema` and
   * `onboardingDraftPointKeySchema` above are **different columns**
   * (`rtus.domain`, `point_keys.domain`), both nullable and neither
   * constrained, and deliberately stay a bare `z.string()`.
   */
  domain: assetDomainCodeSchema,
  meta: z.record(z.unknown()).optional(),
});

export const onboardingDraftAssetPointSchema = z.object({
  assetIndex: z.number(),
  pointKey: z.string(),
  sourceDataKey: z.string(),
  sensorCode: z.string().optional(),
  unit: z.string().optional(),
});

export const onboardingDraftMetaSchema = z.object({
  rtuTargetCount: z.number().optional(),
  importedFromExcel: z.boolean().optional(),
  /** Point keys step satisfied using org catalog (no new keys in draft). */
  useExistingPointKeys: z.boolean().optional(),
});

export const onboardingDraftSchema = z.object({
  location: onboardingDraftLocationSchema.optional(),
  rtus: z.array(onboardingDraftRtuSchema).optional(),
  pointKeys: z.array(onboardingDraftPointKeySchema).optional(),
  assets: z.array(onboardingDraftAssetSchema).optional(),
  assetPoints: z.array(onboardingDraftAssetPointSchema).optional(),
  onboardingMeta: onboardingDraftMetaSchema.optional(),
});

export const onboardingSessionDtoSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationCode: z.string(),
  organizationName: z.string(),
  status: onboardingSessionStatusSchema,
  currentPhase: onboardingPhaseSchema,
  draft: onboardingDraftSchema,
  messages: z.array(onboardingChatMessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  committedAt: z.string().nullable(),
  result: z.record(z.unknown()).nullable(),
});

export const onboardingChatResponseDtoSchema = z.object({
  assistantMessage: z.string(),
  session: onboardingSessionDtoSchema,
  suggestedReplies: z.array(z.string()).optional(),
  validationErrors: z.array(onboardingFieldErrorSchema).optional(),
  readyToCommit: z.boolean().optional(),
  autoOpenPreview: z.boolean().optional(),
  autoOpenReason: onboardingAutoOpenReasonSchema.optional(),
});

export const onboardingValidateResponseDtoSchema = z.object({
  valid: z.boolean(),
  errors: z.array(onboardingFieldErrorSchema),
  preview: onboardingDraftSchema,
  readyToCommit: z.boolean(),
  autoOpenPreview: z.boolean(),
  autoOpenReason: onboardingAutoOpenReasonSchema.optional(),
});

export const onboardingCommitResponseDtoSchema = z.object({
  sessionId: z.string(),
  locationId: z.string(),
  rtuIds: z.array(z.string()),
  assetIds: z.array(z.string()),
  pointKeyIds: z.array(z.string()),
  assetPointIds: z.array(z.string()),
});
