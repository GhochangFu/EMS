import {
  assetDomainCodeSchema,
  // F4.103: the four draft count caps, imported rather than restated. The
  // numbers and their derivation live once, beside the shared contract's copy
  // of this schema (§4.8 — "a vocabulary is declared once and everything else
  // is derived from it"); `tests/f4.103-draft-count-caps.test.ts` is what stops
  // the two copies drifting. `@bms/shared` and not `@bms/shared/contracts`,
  // because apps/api compiles with moduleResolution "node" and ignores the
  // exports map — ADR 0030 Amendment 2.
  MAX_ONBOARDING_ASSET_POINTS,
  MAX_ONBOARDING_ASSETS,
  MAX_ONBOARDING_POINT_KEYS,
  MAX_ONBOARDING_RTUS,
  // F4.104: the length of every draft string field, on the same terms as the
  // four caps above. The numbers are the widths of the columns the draft
  // commits to, and they were inline literals here until this row moved them to
  // their single declaration; `onboarding.schema.spec.ts` pins each one against
  // the `@bms/db` column it came from, which `packages/shared` cannot do.
  ONBOARDING_DRAFT_STRING_MAX,
} from "@bms/shared";
import { z } from "zod";

// F4.115: the iterative depth walk, shared with
// `asset-templates-content.schema.ts`. The **walker** is shared; the two limits
// are not — see `MAX_ONBOARDING_DRAFT_DEPTH` below.
import { exceedsDepth } from "../stack-safe-json";

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
    code: z
      .string()
      .min(2)
      .max(ONBOARDING_DRAFT_STRING_MAX["location.code"])
      .regex(/^[A-Z0-9_-]+$/),
    slug: z
      .string()
      .min(2)
      .max(ONBOARDING_DRAFT_STRING_MAX["location.slug"])
      .regex(/^[a-z0-9-]+$/),
    name: z.string().min(2).max(ONBOARDING_DRAFT_STRING_MAX["location.name"]),
    type: z.enum(["smoc_campus", "rsmoc", "csmoc"]),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    province: z.string().max(ONBOARDING_DRAFT_STRING_MAX["location.province"]).optional(),
    capital: z.string().max(ONBOARDING_DRAFT_STRING_MAX["location.capital"]).optional(),
    meta: z.record(z.unknown()).optional(),
  });

export const draftRtuSchema = z
  .object({
    // Trimmed at the boundary so two RTUs cannot differ by invisible whitespace
    // alone. `_secrets` is keyed by this code (ADR 0022 Amendment 5), and JS
    // `.trim()` eats NBSP — which renders as an ordinary space in the wizard, so
    // the near-duplicate is undetectable by eye. `rtuCodeAt` refuses a contested
    // code independently; this stops the alias being created in the first place.
    // F4.104: `.trim()` stays *before* the length check. zod runs the checks in
    // declaration order and `trim` mutates the working value, so this bounds the
    // trimmed length; reordered, it would bound the padded one. `maxLength`
    // reads the same either way, so only the parse in the spec can tell them
    // apart.
    code: z.string().trim().min(2).max(ONBOARDING_DRAFT_STRING_MAX["rtus.code"]),
    displayName: z.string().min(2).max(ONBOARDING_DRAFT_STRING_MAX["rtus.displayName"]),
    protocol: onboardingProtocolSchema,
    config: z.record(z.unknown()).default({}),
    credentialsSet: z.boolean().optional(),
    domain: z.string().max(ONBOARDING_DRAFT_STRING_MAX["rtus.domain"]).optional(),
    externalRtuId: z.number().int().optional(),
    rtuCode: z.string().max(ONBOARDING_DRAFT_STRING_MAX["rtus.rtuCode"]).optional(),
    stationCode: z.string().max(ONBOARDING_DRAFT_STRING_MAX["rtus.stationCode"]).optional(),
    stationName: z.string().max(ONBOARDING_DRAFT_STRING_MAX["rtus.stationName"]).optional(),
    ingestEnabled: z.boolean().optional(),
    meta: z.record(z.unknown()).optional(),
  });

export const draftPointKeySchema = z
  .object({
    code: z.string().min(1).max(ONBOARDING_DRAFT_STRING_MAX["pointKeys.code"]),
    name: z.string().min(1).max(ONBOARDING_DRAFT_STRING_MAX["pointKeys.name"]),
    domain: z.string().max(ONBOARDING_DRAFT_STRING_MAX["pointKeys.domain"]).optional(),
    unit: z.string().max(ONBOARDING_DRAFT_STRING_MAX["pointKeys.unit"]).optional(),
    // F4.104: the one draft string field no producer bounded. Its column,
    // `bms.point_keys.description`, is `text` and supplies nothing, so the
    // number is derived from the sibling route writing the same column —
    // `createPointKeyBodySchema.description`, whose other four fields are
    // exactly the four above. This is the row's one caller-visible change:
    // `PATCH :id/draft` answered 200 at any length and now answers 400 past it.
    description: z.string().max(ONBOARDING_DRAFT_STRING_MAX["pointKeys.description"]).optional(),
  });

export const draftAssetSchema = z
  .object({
    rtuIndex: z.number().int().min(0),
    code: z.string().min(2).max(ONBOARDING_DRAFT_STRING_MAX["assets.code"]),
    name: z.string().min(2).max(ONBOARDING_DRAFT_STRING_MAX["assets.name"]),
    siteName: z.string().min(2).max(ONBOARDING_DRAFT_STRING_MAX["assets.siteName"]),
    // ADR 0031 Amendment 1: shape only — the live vocabulary is
    // `bms.asset_domains`, checked at commit. This path matters most of the
    // three: `onboarding-excel.service.ts` reads the `domain` column of an
    // uploaded spreadsheet verbatim, so an arbitrary cell can reach
    // `assets.domain`. `OnboardingCommitService` rejects an unknown code with the
    // valid list, instead of letting `assets_domain_fk` produce a 500.
    //
    // F4.104 leaves this as the vocabulary schema rather than inlining a
    // `.max()`: `assetDomainCodeSchema` is `.min(1).max(64)`, shared with four
    // other vocabularies in `operations.ts`, and one of them is pinned by source
    // text in `tests/f3.40-asset-role-write-path.test.ts`. The number is in
    // `ONBOARDING_DRAFT_STRING_MAX` so the coverage walk is complete, and the
    // spec pins the two to each other.
    domain: assetDomainCodeSchema,
    meta: z.record(z.unknown()).optional(),
  });

export const draftAssetPointSchema = z
  .object({
    assetIndex: z.number().int().min(0),
    pointKey: z.string().min(1).max(ONBOARDING_DRAFT_STRING_MAX["assetPoints.pointKey"]),
    sourceDataKey: z
      .string()
      .min(1)
      .max(ONBOARDING_DRAFT_STRING_MAX["assetPoints.sourceDataKey"]),
    sensorCode: z.string().max(ONBOARDING_DRAFT_STRING_MAX["assetPoints.sensorCode"]).optional(),
    unit: z.string().max(ONBOARDING_DRAFT_STRING_MAX["assetPoints.unit"]).optional(),
  });

export const onboardingDraftMetaSchema = z
  .object({
    rtuTargetCount: z.number().int().positive().optional(),
    importedFromExcel: z.boolean().optional(),
    useExistingPointKeys: z.boolean().optional(),
  });

/**
 * How deep a draft may nest, counting the draft object itself as level 1.
 *
 * **Three numbers, because a bound without its neighbours is just a magic
 * number:**
 *
 * - **Floor — 5.** The deepest shape any shipped producer writes:
 *   `draft` (1) → `rtus` (2) → `rtus[i]` (3) → `config` (4) → `config.host`
 *   (5). `OnboardingExcelService.parseRtus` writes
 *   `config: { host, port, tls, topic }`; `OnboardingChatService.defaultConfig`
 *   writes `{host,port,tls,topic}`, `{host,port,unitId,pollIntervalMs}` or
 *   `{}`; `buildTemplateBuffer`'s template rows become the same flat object.
 *   Nothing in this repository writes a nested `meta` at all, and the other
 *   draft branches are shallower — `_secrets` and `assetPoints` reach 4.
 * - **Bound — 10.** The draft skeleton consumes four levels before the first
 *   free-form byte, so this leaves a hand-written `config` or `meta` six levels
 *   of its own structure where every shipped producer uses one.
 * - **Ceiling, for contrast — ~2,000 and ~6,000.** The first observed failures:
 *   the clone inside `redactDraftForClient` at about 2,000, and the jsonb write
 *   itself at about 6,000. The bound sits twice above every shape the product
 *   writes and roughly 200x below the first observed failure, which is what
 *   makes it a semantic bound rather than one tuned to a crash point.
 *
 * `MAX_CONTENT_DEPTH = 12` in `asset-templates-content.schema.ts` is the same
 * *form* of judgement and a different number, because template `content` is an
 * authoring surface a human nests by hand while a draft's only free-form fields
 * are a connection config and metadata. The two share the walker, not the
 * limit.
 *
 * **It is declared here and NOT in `packages/shared/src/contracts/onboarding.ts`**,
 * which is the opposite of what the `F4.103` paragraph in that file argues for
 * the count caps — so the reason is written down rather than left to be
 * assumed. That copy is the **response** contract, parsed at runtime by
 * `apps/web/src/api/admin/onboarding.ts` (ADR 0030 decision 5). A depth refusal
 * there would throw in dev and test on exactly the already-stored deep draft
 * that ruling 2b requires to stay readable and patchable. `MAX_RTU_CREDENTIAL_CHARS`
 * below is the precedent for a bound that stays in this file with its
 * derivation.
 */
export const MAX_ONBOARDING_DRAFT_DEPTH = 10;

/**
 * The refusal sentence. Every field name in it is a **literal from this file**
 * and nothing is read from the draft — no key name, no path fragment and no
 * value (§4.3).
 *
 * The four paths named are the draft's only `z.record(z.unknown())` fields, and
 * so its only free-form ones. `onboardingMeta` is deliberately not among them:
 * it is a closed three-field object and cannot nest.
 */
export const DRAFT_TOO_DEEP_MESSAGE =
  `The draft nests deeper than ${MAX_ONBOARDING_DRAFT_DEPTH} levels. Flatten the value under ` +
  "`rtus[].config`, `rtus[].meta`, `assets[].meta` or `location.meta` and send it again.";

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
 *
 * **The four arrays are count-capped (`F4.103`), and that is a different axis
 * from strictness.** Permissive about *which keys* an item carries; bounded
 * about *how many items* the draft holds. This is the copy on the write path —
 * `patchDraftBodySchema` parses a `PATCH :id/draft` body through it, and
 * `OnboardingValidateService` re-parses the stored draft through it — so it is
 * where the bound has to be for a draft assembled by any of the three
 * producers above. The caps themselves and their derivation are declared once,
 * in `packages/shared/src/contracts/onboarding.ts`.
 *
 * **The caps re-arm producer 3's silent discard on a new axis, and that is
 * ruled acceptable for that producer only.** An over-cap `draftPatch` from the
 * model now fails `safeParse`, becomes `{}` through `.data ?? {}`, and the whole
 * turn is dropped while the assistant still answers "I've updated the draft" —
 * exactly the failure this docblock names above, now reachable by count as well
 * as by an invented key. It stands: a model emitting more than 100 RTUs in one
 * turn is already malfunctioning, and a discarded over-cap patch is the refusal
 * you want. Producer 1 answers a 400 at the controller, and the rule-based chat
 * branch — which never parses this schema at all — is refused by
 * `draftCountProblem` in `OnboardingService.chat`, so neither of those two turns
 * into a quiet drop. Do not generalise this ruling to them.
 *
 * **Every string field is length-bounded too (`F4.104`), which is a third axis
 * again.** Permissive about *which keys* an item carries; bounded about *how
 * many items* the draft holds; bounded about *how long* one value may be. The
 * lengths are the widths of the columns the draft commits to, declared once as
 * `ONBOARDING_DRAFT_STRING_MAX` beside the count caps and imported here.
 *
 * The same ruling carries over, on the same terms and no wider: an over-long
 * `draftPatch` from the model fails `safeParse`, becomes `{}` and drops the
 * turn. And the same thing is *not* true of the two producers that never parse
 * this schema — the workbook upload and the rule-based chat branch write their
 * strings straight into the draft, so a bound here does not reach them at all.
 * They are bounded where they read, in the commits that follow this one. A
 * bound on a schema binds only the producers that parse it.
 *
 * **And a fourth axis: how deep it nests (`F4.115`).** Permissive about which
 * keys an item carries; bounded about how many items the draft holds, how long
 * one value may be, and now how deep the whole may nest.
 *
 * The refinement is attached **here** and not to `patchDraftBodySchema`, and
 * that is what covers producer 3: the model's `draftPatch` parses this schema
 * directly and never touches the wrapper, so on the wrapper alone a deep patch
 * from the model would still be merged and stored. The same silent-discard
 * ruling as above carries over for that producer, on the same terms and no
 * wider.
 *
 * A refusal here also runs when `OnboardingValidateService` re-parses a
 * **stored** draft, and that is deliberate: it is a `safeParse` with an early
 * `return { valid: false, ... }` and it does not throw, so an already-deep
 * session stays readable — `getSession` never parses the draft, `validate`
 * returns `redactDraftForClient(session.draft)` regardless, and `patchDraft`
 * parses the request body only. It reports the depth error as a wizard error
 * and `readyToCommit` stays false until it is patched, which is what stops a
 * deep `config` reaching `rtu_connection_configs` at commit.
 *
 * The other two producers — the workbook upload and the rule-based chat branch
 * — parse nothing here and need **no** depth guard, and the reason is not that
 * they are trusted: `parseRtus` and `defaultConfig` write `config` as a flat
 * literal of at most four scalar keys and write no `meta` at all, so neither
 * can produce depth. Stated rather than left unsaid, because `F4.104` shipped a
 * docblock naming two producers where there were three.
 *
 * The check runs **after** the fields parse, which diverges from
 * `asset-templates-content.schema.ts`'s deliberate depth-first ordering. That
 * ordering exists there because its `superRefine` calls `JSON.stringify` on the
 * next line; nothing in this object's parse recurses or serialises —
 * `z.record(z.unknown())` returns its values by reference — and zod itself was
 * measured depth-safe to at least 4,000.
 */
export const onboardingDraftSchema = z
  .object({
    location: draftLocationSchema.optional(),
    rtus: z.array(draftRtuSchema).max(MAX_ONBOARDING_RTUS).optional(),
    pointKeys: z.array(draftPointKeySchema).max(MAX_ONBOARDING_POINT_KEYS).optional(),
    assets: z.array(draftAssetSchema).max(MAX_ONBOARDING_ASSETS).optional(),
    assetPoints: z.array(draftAssetPointSchema).max(MAX_ONBOARDING_ASSET_POINTS).optional(),
    onboardingMeta: onboardingDraftMetaSchema.optional(),
  })
  .superRefine((draft, ctx) => {
    if (exceedsDepth(draft, MAX_ONBOARDING_DRAFT_DEPTH)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: DRAFT_TOO_DEEP_MESSAGE });
    }
  })
  .describe(
    `The draft nests at most ${MAX_ONBOARDING_DRAFT_DEPTH} levels deep, counting the draft ` +
      "object itself as level 1.",
  );

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
 * The longest credential value this system accepts, on either route that
 * supplies one.
 *
 * It was an inline literal in `setCredentialsBodySchema` below until `F4.104`,
 * which found the workbook's `username` and `password` columns reaching
 * `CredentialCryptoService` without ever passing that schema — measured on
 * `9d384295`, a 32,767-character `password` cell was encrypted and stored, eight
 * times this bound. Named here rather than restated at the parse site so the two
 * routes cannot drift into two different answers (AGENTS.md §4.8). It stays in
 * this file, not in `ONBOARDING_DRAFT_STRING_MAX`: a credential never reaches
 * the draft at all — `parseRtus` pushes it to `rtuCredentials` — so it is not
 * one of the draft's string fields and must not be counted among them.
 */
export const MAX_RTU_CREDENTIAL_CHARS = 4096;

/**
 * `POST :id/credentials` (ADR 0022 decision 1). Values are plaintext in the
 * request body and encrypted before storage — they are never echoed back,
 * never written to `messages`, and never sent to the LLM.
 */
export const setCredentialsBodySchema = z
  .object({
    rtuIndex: z.number().int().min(0),
    credentials: z
      .record(z.string().min(1).max(MAX_RTU_CREDENTIAL_CHARS))
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
