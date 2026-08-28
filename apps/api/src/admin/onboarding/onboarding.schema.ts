import { assetDomainCodeSchema } from "@bms/shared";
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

export const draftLocationSchema = z
  .object({
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

export const draftRtuSchema = z
  .object({
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

export const draftPointKeySchema = z
  .object({
    code: z.string().min(1).max(128),
    name: z.string().min(1).max(255),
    domain: z.string().max(64).optional(),
    unit: z.string().max(32).optional(),
    description: z.string().optional(),
  });

export const draftAssetSchema = z
  .object({
    rtuIndex: z.number().int().min(0),
    code: z.string().min(2).max(64),
    name: z.string().min(2).max(255),
    siteName: z.string().min(2).max(255),
    // ADR 0031 Amendment 1: shape only — the live vocabulary is
    // `bms.asset_domains`, checked at commit. This path matters most of the
    // three: `onboarding-excel.service.ts` reads the `domain` column of an
    // uploaded spreadsheet verbatim, so an arbitrary cell can reach
    // `assets.domain`. `OnboardingCommitService` rejects an unknown code with the
    // valid list, instead of letting `assets_domain_fk` produce a 500.
    domain: assetDomainCodeSchema,
    meta: z.record(z.unknown()).optional(),
  });

export const draftAssetPointSchema = z
  .object({
    assetIndex: z.number().int().min(0),
    pointKey: z.string().min(1).max(128),
    sourceDataKey: z.string().min(1).max(128),
    sensorCode: z.string().max(64).optional(),
    unit: z.string().max(32).optional(),
  });

export const onboardingDraftMetaSchema = z
  .object({
    rtuTargetCount: z.number().int().positive().optional(),
    importedFromExcel: z.boolean().optional(),
    useExistingPointKeys: z.boolean().optional(),
  });

/**
 * **Deliberately NOT `.strict()`, and neither is anything below it (`E7.1f`).**
 *
 * ADR 0029 Amendment 3 ruling 1 keeps strictness a per-schema judgement. This
 * subtree is the node in this repository where the judgement comes out the
 * other way, and the reason is that **these schema objects validate three
 * different producers**, only one of which is an HTTP caller:
 *
 * 1. `PATCH :id/draft` — a real caller, where an unknown key is a caller error.
 * 2. **The stored draft**, re-parsed by `OnboardingValidateService.validate`.
 *    It carries the top-level `_secrets` key as soon as any RTU credential is
 *    set (`onboarding-redaction.ts:290`). Strict rejects it, and because
 *    `validate` returns before `validateCrossField`, `readyToCommit` can never
 *    become true again — while `onboarding-validate.service.ts` separately
 *    refuses an MQTT ingest RTU whose `credentialsSet` is false. Setting the
 *    credential is what breaks the parse, so the ADR 0022 pilot flow deadlocks.
 * 3. **The model's `draftPatch`** (`onboarding-chat.service.ts:238`), where the
 *    result is `.data ?? {}`. One invented key from the LLM would discard the
 *    operator's entire turn while the assistant still answers "I've updated the
 *    draft" — silent data loss, which is worse than the 200 this item set out
 *    to fix. Stripping is what the M2 fix there relies on.
 *
 * So the wrapper `patchDraftBodySchema` is strict — it declares only `draft`,
 * so nothing rides alongside — and the draft body itself strips, exactly as it
 * did before. **What is given up is real and is stated rather than hidden:** a
 * `PATCH {"draft":{"location":{"nope":1}}}` still answers 200 with `nope`
 * dropped. Closing that needs one schema per producer rather than one shared
 * object, which is a bigger change than `E7.1f` was scoped for.
 *
 * Do not add `.strict()` here without splitting those three producers first.
 */
export const onboardingDraftSchema = z
  .object({
    location: draftLocationSchema.optional(),
    rtus: z.array(draftRtuSchema).optional(),
    pointKeys: z.array(draftPointKeySchema).optional(),
    assets: z.array(draftAssetSchema).optional(),
    assetPoints: z.array(draftAssetPointSchema).optional(),
    onboardingMeta: onboardingDraftMetaSchema.optional(),
  });

export const createSessionBodySchema = z
  .object({
    organizationId: z.string().uuid(),
  })
  .strict();

export const chatBodySchema = z
  .object({
    message: z.string().min(1).max(8000),
  })
  .strict();

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
      })
      .describe("At least one credential field is required; an empty object is refused."),
  })
  .strict();

export type SetCredentialsBody = z.infer<typeof setCredentialsBodySchema>;

export const patchDraftBodySchema = z
  .object({
    draft: onboardingDraftSchema,
  })
  .strict();

export type OnboardingDraftInput = z.infer<typeof onboardingDraftSchema>;
export type OnboardingPhase = z.infer<typeof onboardingPhaseSchema>;
