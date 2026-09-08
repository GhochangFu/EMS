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

/**
 * The number of RTUs one onboarding session may carry (`F4.103`).
 *
 * ## What these four caps bound — and what they do not
 *
 * They bound the **work after the read**, not the read. `SHEET_ROWS_BOUND` and
 * `MAX_HEADER_COLUMNS` bound how much of an uploaded workbook is densified and
 * walked, and they shipped in `F4.102`; the first is a *read* bound of 20,102
 * rows, which is not a limit on anything and does not exist at all for a draft
 * that arrives through `PATCH :id/draft` or the chat patch.
 *
 * What a draft costs is what `OnboardingCommitService.commit` does with it: one
 * statement at a time, sequentially, inside a single `withTenant` transaction.
 * Counted from that method's own loops, the worst case these four numbers admit
 * is
 *
 * ```text
 *    100 RTUs        × 2  (`rtus`, then `rtu_connection_configs`)   =    200
 *    500 point keys  × 2  (catalog select, then insert when new;
 *                          0 on a `declaredInThisDraft` hit)        =  1,000
 *    500 assets      × 1                                           =    500
 *  5,000 asset points × 1                                          =  5,000
 *                                                                     -----
 *                                                                      6,700
 * ```
 *
 * plus the location insert and the closing session update — and, before the
 * transaction opens, one `bms.asset_domains` select per *distinct* domain the
 * draft names, which is bounded by that vocabulary rather than by the sheet.
 *
 * ## Why these numbers — each anchor measured, not restated
 *
 * Set **above** the longest real list with headroom rather than at it, the same
 * judgement `MAX_TABLE_COLUMNS` records: a cap tightened onto today's largest
 * estate turns tomorrow's legitimate one into a message about a limit.
 *
 * - **The template this system itself ships** holds **2 RTU data rows and 3
 *   asset data rows** (`OnboardingExcelService.buildTemplateBuffer`). So 100 is
 *   50× and 500 is 166× the workbook an operator is handed to fill in.
 * - **The whole Eskom demo estate is 99 assets** — measured by calling
 *   `buildEskomAssetCatalog` with the RSMOC block `seed.ts` builds: 51 entries
 *   from its own list (39 written out plus a twelve-entry `Array.from` block)
 *   and 48 from `demoAssetsForRsmoc` (6 entries across 8 RSMOC provinces). A
 *   `grep -c "code:"` over `packages/db/src/eskom-assets-seed.ts` reports 51,
 *   and that it matches the base list's length is a coincidence — it misses the
 *   RSMOC entries and the generated block and counts two type declarations.
 *   500 assets is therefore about 5× that estate, in one session.
 *   (`eskom-assets-seed.ts` is not the only asset seed: `phe-pilot-seed.ts`
 *   inserts more, from a data file outside this repository.)
 * - **Point keys and asset points have no template anchor and are not given a
 *   borrowed one.** No workbook produces either: `toDraftPatch` writes only
 *   `location`, `rtus`, `assets` and `onboardingMeta`, so both arrive solely
 *   through `PATCH :id/draft` or the chat patch. 500 point keys matches the
 *   asset cap — a session declaring more than 500 distinct measured quantities
 *   is a catalog import, not an onboarding — and 5,000 asset points is ten
 *   points per asset at the asset cap.
 *
 * ## Why refuse rather than truncate
 *
 * Both siblings refuse: `parseWorkbook` (`telemetry-import-rows.ts`) on
 * `MAX_IMPORT_ROWS`, and `onboardingSheetRangeProblem` on the sheet range. A
 * silently truncated draft commits half a plant and says nothing, and the
 * operator finds out from the assets that are missing.
 */
export const MAX_ONBOARDING_RTUS = 100;

/**
 * The number of point keys one onboarding session may declare (`F4.103`).
 * See `MAX_ONBOARDING_RTUS` for the derivation of all four caps.
 */
export const MAX_ONBOARDING_POINT_KEYS = 500;

/**
 * The number of assets one onboarding session may create (`F4.103`).
 * See `MAX_ONBOARDING_RTUS` for the derivation of all four caps.
 */
export const MAX_ONBOARDING_ASSETS = 500;

/**
 * The number of asset/point mappings one onboarding session may create
 * (`F4.103`). See `MAX_ONBOARDING_RTUS` for the derivation of all four caps.
 */
export const MAX_ONBOARDING_ASSET_POINTS = 5_000;

/**
 * The caps are attached in the arrays' declaration order, and that order is
 * load-bearing for one narrow reason and no wider one: zod reports an object's
 * issues in key-declaration order, so a draft over more than one cap fails
 * first on `rtus`. Nothing here claims which section of a *workbook* is refused
 * first — a workbook produces neither point keys nor asset points, and the
 * upload path does not parse this schema at all.
 *
 * `.max()` moves no inferred type — `OnboardingDraft` is unchanged.
 */
export const onboardingDraftSchema = z.object({
  location: onboardingDraftLocationSchema.optional(),
  rtus: z.array(onboardingDraftRtuSchema).max(MAX_ONBOARDING_RTUS).optional(),
  pointKeys: z.array(onboardingDraftPointKeySchema).max(MAX_ONBOARDING_POINT_KEYS).optional(),
  assets: z.array(onboardingDraftAssetSchema).max(MAX_ONBOARDING_ASSETS).optional(),
  assetPoints: z.array(onboardingDraftAssetPointSchema).max(MAX_ONBOARDING_ASSET_POINTS).optional(),
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
