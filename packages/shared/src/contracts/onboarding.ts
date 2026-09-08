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

/**
 * The maximum length of every string field an onboarding draft carries
 * (`F4.104`) — 24 fields across the five sub-schemas below, declared once here
 * and imported by both copies of the draft schema.
 *
 * ## Where each number comes from — the column, not a judgement
 *
 * Every value but one is the width of the `varchar` column that field commits
 * to, read from `packages/db/src/schema/bms-schema.ts`: `bms.locations`,
 * `bms.rtus`, `bms.point_keys`, `bms.assets` and `bms.asset_points`. That is
 * why importing them changed no behaviour on the two producers that already
 * parse a schema — `apps/api`'s copy carried these same numbers as inline
 * literals, and this record replaced the literals with their source. The pin
 * is executable rather than asserted, but it lives in
 * `apps/api/src/admin/onboarding/onboarding.schema.spec.ts`: this package
 * depends on `zod` and nothing else, so it cannot import `@bms/db` to read a
 * column width.
 *
 * Two fields are not a plain column read, and both are derivations rather than
 * new numbers:
 *
 * - **`pointKeys.description` = 2000.** `bms.point_keys.description` is `text`,
 *   so the column supplies no bound at all — it is the one field of the 24 that
 *   was unbounded on every producer, including the two that parse. The number
 *   comes from the sibling route writing the *same column*:
 *   `apps/api/src/admin/point-keys/point-keys.schema.ts` bounds
 *   `createPointKeyBodySchema.description` at 2000, and that schema's other
 *   four fields (128 / 255 / 64 / 32) are exactly this one's. The onboarding
 *   copy was the drifted one.
 * - **`assets.domain` = 64.** The number is real but it is not this record's to
 *   own: that field is `assetDomainCodeSchema` (`operations.ts`), shared with
 *   four other vocabularies, and `tests/f3.40-asset-role-write-path.test.ts`
 *   pins one of them by source text. So the bound is *not* extracted out of
 *   there and inlined here — the key exists so the coverage walk is complete,
 *   and `contracts/onboarding.spec.ts` pins it to `assetDomainCodeSchema.maxLength`.
 *
 * ## What the amplification looks like, measured
 *
 * A workbook cell holds up to 32,767 characters, and on this base **all eleven
 * cells the upload reads reach `bms.onboarding_sessions.draft` at that length**.
 * A workbook built exactly at `F4.103`'s count caps — 100 RTUs and 500 assets —
 * is 166 KB on disk and produces a **72.04 MB draft in 201 ms**: 453×
 * amplification, from a file small enough that no upload limit sees it. The
 * count caps bound how many rows; nothing bounded how wide one was.
 *
 * ## What these bounds do NOT bound
 *
 * - **The two producers that do not parse a schema.** A bound on a schema binds
 *   only the producers that parse it. `PATCH :id/draft` and the model's
 *   `draftPatch` parse one; `OnboardingExcelService`'s upload path and
 *   `handleRuleBasedTurn` do not, and for them the bound has to be applied where
 *   the value is read. That work is the rest of `F4.104` and is not in this
 *   declaration — until it lands, the 32,767-character cell above still reaches
 *   storage.
 * - **`location.meta`, `rtus[].meta`, `assets[].meta` and `rtus[].config`.**
 *   Those are `z.record(z.unknown())`, and their size, key count and depth are
 *   `E8.5`'s axis, recorded at `audit.service.ts`. One exception is bounded on
 *   the upload path instead, where it is read: `config.host`.
 * - **Completeness.** These are length bounds and nothing else. A draft is
 *   legitimately partial until it commits (ADR 0011, this file's head
 *   docblock), so nothing here gains a `.min()`, a `.trim()` or a regex, and
 *   the copy in this package carries none.
 *
 * `.max()` moves no inferred type — `OnboardingDraft` and every DTO built on it
 * are unchanged.
 *
 * ## Why refuse rather than truncate, on the producers that parse
 *
 * The same reason the count caps refuse: a silently shortened value commits
 * plant under a name nobody chose, and the operator finds out from the label on
 * the asset. `OnboardingValidateService.validate` re-parses the stored draft
 * with `safeParse` and reports each issue as a per-field error, so an over-long
 * value that is already in storage surfaces in the wizard as something to fix
 * rather than as a 500.
 */
export const ONBOARDING_DRAFT_STRING_MAX = {
  "location.code": 64,
  "location.slug": 64,
  "location.name": 255,
  "location.province": 64,
  "location.capital": 128,
  "rtus.code": 64,
  "rtus.displayName": 255,
  "rtus.domain": 64,
  "rtus.rtuCode": 64,
  "rtus.stationCode": 64,
  "rtus.stationName": 255,
  "pointKeys.code": 128,
  "pointKeys.name": 255,
  "pointKeys.domain": 64,
  "pointKeys.unit": 32,
  "pointKeys.description": 2000,
  "assets.code": 64,
  "assets.name": 255,
  "assets.siteName": 255,
  "assets.domain": 64,
  "assetPoints.pointKey": 128,
  "assetPoints.sourceDataKey": 128,
  "assetPoints.sensorCode": 64,
  "assetPoints.unit": 32,
} as const;

export const onboardingDraftLocationSchema = z.object({
  code: z.string().max(ONBOARDING_DRAFT_STRING_MAX["location.code"]),
  slug: z.string().max(ONBOARDING_DRAFT_STRING_MAX["location.slug"]),
  name: z.string().max(ONBOARDING_DRAFT_STRING_MAX["location.name"]),
  type: z.enum(["smoc_campus", "rsmoc", "csmoc"]),
  latitude: z.number(),
  longitude: z.number(),
  province: z.string().max(ONBOARDING_DRAFT_STRING_MAX["location.province"]).optional(),
  capital: z.string().max(ONBOARDING_DRAFT_STRING_MAX["location.capital"]).optional(),
  meta: z.record(z.unknown()).optional(),
});

export const onboardingDraftRtuSchema = z.object({
  code: z.string().max(ONBOARDING_DRAFT_STRING_MAX["rtus.code"]),
  displayName: z.string().max(ONBOARDING_DRAFT_STRING_MAX["rtus.displayName"]),
  protocol: onboardingProtocolSchema,
  config: z.record(z.unknown()),
  /** ADR 0022: a flag, never the secret. */
  credentialsSet: z.boolean().optional(),
  domain: z.string().max(ONBOARDING_DRAFT_STRING_MAX["rtus.domain"]).optional(),
  externalRtuId: z.number().optional(),
  rtuCode: z.string().max(ONBOARDING_DRAFT_STRING_MAX["rtus.rtuCode"]).optional(),
  stationCode: z.string().max(ONBOARDING_DRAFT_STRING_MAX["rtus.stationCode"]).optional(),
  stationName: z.string().max(ONBOARDING_DRAFT_STRING_MAX["rtus.stationName"]).optional(),
  ingestEnabled: z.boolean().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const onboardingDraftPointKeySchema = z.object({
  code: z.string().max(ONBOARDING_DRAFT_STRING_MAX["pointKeys.code"]),
  name: z.string().max(ONBOARDING_DRAFT_STRING_MAX["pointKeys.name"]),
  domain: z.string().max(ONBOARDING_DRAFT_STRING_MAX["pointKeys.domain"]).optional(),
  unit: z.string().max(ONBOARDING_DRAFT_STRING_MAX["pointKeys.unit"]).optional(),
  description: z.string().max(ONBOARDING_DRAFT_STRING_MAX["pointKeys.description"]).optional(),
});

export const onboardingDraftAssetSchema = z.object({
  rtuIndex: z.number(),
  code: z.string().max(ONBOARDING_DRAFT_STRING_MAX["assets.code"]),
  name: z.string().max(ONBOARDING_DRAFT_STRING_MAX["assets.name"]),
  siteName: z.string().max(ONBOARDING_DRAFT_STRING_MAX["assets.siteName"]),
  /**
   * ADR 0031 — this draft becomes a `bms.assets` row, so it carries the plant
   * vocabulary `assets_domain_fk` enforces. Shape only: the live value set is
   * a table (`bms.asset_domains`), so the check that the code *exists* happens
   * at commit against the database, not here.
   *
   * The `domain` fields on `onboardingDraftRtuSchema` and
   * `onboardingDraftPointKeySchema` above are **different columns**
   * (`rtus.domain`, `point_keys.domain`), both nullable and neither
   * constrained, and carry only the length bound `F4.104` gives every string
   * field.
   *
   * `F4.104` leaves this field as `assetDomainCodeSchema` rather than inlining
   * a `.max()`: that schema is `.min(1).max(64)`, shared with four other
   * vocabularies, and its length is pinned to
   * `ONBOARDING_DRAFT_STRING_MAX["assets.domain"]` by an assertion in
   * `onboarding.spec.ts` instead of being copied out of it.
   */
  domain: assetDomainCodeSchema,
  meta: z.record(z.unknown()).optional(),
});

export const onboardingDraftAssetPointSchema = z.object({
  assetIndex: z.number(),
  pointKey: z.string().max(ONBOARDING_DRAFT_STRING_MAX["assetPoints.pointKey"]),
  sourceDataKey: z.string().max(ONBOARDING_DRAFT_STRING_MAX["assetPoints.sourceDataKey"]),
  sensorCode: z.string().max(ONBOARDING_DRAFT_STRING_MAX["assetPoints.sensorCode"]).optional(),
  unit: z.string().max(ONBOARDING_DRAFT_STRING_MAX["assetPoints.unit"]).optional(),
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
 * plus the location insert, the closing session update, an `organizations`
 * select and two `MasterDataAuditService.write` calls in the same transaction —
 * and, before the transaction opens, one `bms.asset_domains` select per
 * *distinct* domain the draft names, which is bounded by that vocabulary rather
 * than by the sheet. Those four fixed statements do not move with the caps, so
 * the 6,700 is unaffected by them.
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
 *   `grep -c "code:"` over `packages/db/src/eskom-assets-seed.ts` also reports
 *   51, and that the two numbers agree is a coincidence: those 51 *lines* are
 *   39 written-out base entries, one `Array.from` line standing for twelve, six
 *   `demoAssetsForRsmoc` lines standing for forty-eight, two type declarations
 *   and three lines inside `seedEskomAssets`. Counting entries rather than lines
 *   is what gives 99. 500 assets is therefore about 5× that estate, in one
 *   session.
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
 *
 * **The caps stay on this copy too, and the residual is stated rather than
 * implied** (owner ruling, 2026-09-08). This is the *response* contract: it is
 * embedded in `onboardingSessionDtoSchema.draft` and
 * `onboardingValidateResponseDtoSchema.preview`, and ADR 0030 decision 5 has
 * `apps/web/src/api/admin/onboarding.ts` parse it at runtime. So a draft already
 * in storage that is over a cap would make the server's own reply fail its own
 * contract — throwing in dev and test, logging and passing in production. That
 * is accepted knowingly, on two measured grounds: every producer that can write
 * one of these arrays is now capped, and `bms.onboarding_sessions` held
 * `(0 rows)` when this shipped, so no such draft exists to be read back. Do not
 * "fix" it by taking `.max()` off this copy — bounding the write path alone is
 * the drift `tests/f4.103-draft-count-caps.test.ts` exists to refuse.
 *
 * **`F4.104` adds a length bound to every string field, and its residual is
 * wider than the caps' — deliberately, and only until the rest of `F4.104`
 * lands.** The reasoning above is unchanged: this is the response contract, so
 * an over-long *stored* string makes the reply fail its own schema. What is
 * different is the second ground. Of the draft's four producers, only two parse
 * a schema — `PATCH :id/draft` and the model's `draftPatch` — and they are
 * bounded by this declaration. The other two are not: `OnboardingExcelService`
 * writes an uploaded workbook's cells straight into the draft, and
 * `handleRuleBasedTurn` writes a slice of the chat message. Both are bounded
 * where they read, in the commits that follow this one, because a bound on a
 * schema binds only the producers that parse it. Until then the first ground
 * carries this on its own: `bms.onboarding_sessions` measured `(0 rows)` on the
 * base this shipped from, so there is no stored draft to read back and fail.
 *
 * **Re-measure that count as `bms_fleet`, never as `bms_owner`.** The table is
 * policied and `FORCE ROW LEVEL SECURITY` binds the owner, so a
 * `select count(*)` as `bms_owner` with no tenant context returns `0` whether
 * the table is empty or not — it reported `0` here while fourteen rows were
 * present, which is a measurement that cannot fail and therefore says nothing.
 * `bms_fleet` holds `BYPASSRLS` and is what this count was finally taken with.
 * The failure is also softer than the caps': `OnboardingValidateService.validate`
 * uses `safeParse` and turns each issue into a per-field wizard error, so an
 * over-long value already in storage is something the operator is shown and can
 * fix rather than a 500.
 *
 * ## Two residuals on this contract that `F4.104` did NOT close
 *
 * Written down because the paragraphs above are about **length**, and a reader
 * who takes them as "the draft now satisfies this schema" would be wrong on both
 * counts. Neither is a defect introduced here; both are older than the row.
 *
 * 1. **`assets[].domain` can be `""`, and `.min(1)` refuses it.**
 *    `assetDomainFromCell` in `onboarding-excel.service.ts` returns
 *    `cell.trim().toLowerCase()` with no fallback, so a blank `domain` cell — or
 *    an `ASSETS` header row that omits the column at all — yields `domain: ""`.
 *    `F4.104`'s parse-site guard checks only the **maximum**, so `""` passes it,
 *    and `onboardingSessionDtoSchema.draft.assets[].domain` is
 *    `assetDomainCodeSchema` = `z.string().min(1).max(64)`. The reader's runtime
 *    parse in `apps/web/src/api/admin/onboarding.ts` therefore throws in dev and
 *    test and logs-and-passes in production, on a session the operator uploaded
 *    successfully.
 *
 *    **This is deliberately out of scope and must not be "fixed" by widening a
 *    bound.** Owner ruling 1 scopes `F4.104` to length; `.min(1)` is the
 *    *completeness* axis, and completeness is what
 *    `OnboardingValidateService.validate` is for — refusing it at the upload
 *    boundary is the wholesale refusal of a partial workbook that ruling 1
 *    exists to prevent. Removing `.min(1)` here would close the symptom by
 *    letting an empty vocabulary code through to the commit instead.
 *
 * 2. **A lone surrogate is still possible, and it is a 500 rather than a schema
 *    failure.** `JSON.parse` accepts the `"\ud83d"` escape and `chatBodySchema`
 *    has no well-formedness check, so a caller can put an unpaired half of a
 *    surrogate pair into a chat message. `z.string().max()` counts it happily,
 *    but `JSON.stringify` re-emits the escape and Postgres refuses it in `jsonb`
 *    with `Unicode low surrogate must follow a high surrogate`. `F4.104`'s
 *    review closed the case where the *server* manufactured such a half by
 *    cutting through a pair (`cutToBound`); it did not close the case where the
 *    request already carried one. That needs a well-formedness check on the
 *    request boundary, which is a different axis again.
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
