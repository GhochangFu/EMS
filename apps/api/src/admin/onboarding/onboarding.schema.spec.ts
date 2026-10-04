import {
  MAX_ONBOARDING_ASSET_POINTS,
  MAX_ONBOARDING_ASSETS,
  MAX_ONBOARDING_POINT_KEYS,
  MAX_ONBOARDING_RTUS,
  MAX_ONBOARDING_TEMPLATES,
} from "@bms/shared";

import { convertZodSchema } from "../../openapi/zod-openapi";
import { exceedsDepth } from "../stack-safe-json";

import {
  DRAFT_TOO_DEEP_MESSAGE,
  draftLocationSchema,
  MAX_ONBOARDING_DRAFT_DEPTH,
  onboardingDraftSchema,
  patchDraftBodySchema,
} from "./onboarding.schema";

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Lightweight schema checks for onboarding DTOs. */
export function runOnboardingSchemaTests(): void {
  const loc = draftLocationSchema.parse({
    code: "DEMO_LOC",
    slug: "demo-loc",
    name: "Demo Location",
    type: "smoc_campus",
    latitude: -25.7,
    longitude: 28.2,
  });
  assert(loc.code === "DEMO_LOC", "location code parsed");

  const draft = onboardingDraftSchema.parse({
    location: loc,
    rtus: [
      {
        code: "RTU-1",
        displayName: "RTU 1",
        protocol: "mqtt",
        config: { topic: "phe/test" },
        credentialsSet: true,
      },
    ],
  });
  assert(draft.rtus?.length === 1, "draft rtus parsed");

  const bad = onboardingDraftSchema.safeParse({ location: { code: "bad slug!" } });
  assert(!bad.success, "invalid location rejected");
}

/**
 * `E7.1f` — the draft subtree must stay permissive, and here is why in tests.
 *
 * Both cases below were **live regressions** in the first cut of `E7.1f`, which
 * made this subtree `.strict()`. Neither was visible to `pnpm test`: `_secrets`
 * is only written when `CREDENTIAL_ENCRYPTION_KEY` holds a 32-byte key, and CI
 * does not set it. They are pinned here so the next person to reach for
 * `.strict()` on these schemas gets a red test instead of a deadlocked wizard.
 */
export function runDraftStaysPermissiveTests(): void {
  // 1. The STORED draft carries `_secrets` (onboarding-redaction.ts:290) and is
  //    re-parsed by OnboardingValidateService. Strict rejected it, `validate`
  //    returned before the cross-field checks, and `readyToCommit` could never
  //    become true again — while an MQTT ingest RTU is separately refused
  //    unless `credentialsSet` is true. Setting the credential was what broke
  //    the parse, so the ADR 0022 pilot flow deadlocked.
  const stored = onboardingDraftSchema.safeParse({
    location: {
      code: "DEMO_LOC",
      slug: "demo-loc",
      name: "Demo Location",
      type: "smoc_campus",
      latitude: -25.7,
      longitude: 28.2,
    },
    _secrets: { "RTU-1": { ciphertext: "…", iv: "…", tag: "…" } },
  });
  assert(
    stored.success,
    "a STORED draft carrying `_secrets` must parse. If this fails, onboarding can never " +
      "commit once any RTU credential is set (ADR 0022).",
  );
  assert(
    stored.success && !("_secrets" in stored.data),
    "`_secrets` must be stripped from the parsed result, never carried into it — the " +
      "encrypted store is not part of the draft contract",
  );

  // 2. The model's `draftPatch` (onboarding-chat.service.ts:238) is parsed with
  //    `.data ?? {}`. Under strict, one invented key discarded the operator's
  //    whole turn while the assistant still answered "I've updated the draft".
  const modelPatch = onboardingDraftSchema.safeParse({
    location: {
      code: "DEMO_LOC",
      slug: "demo-loc",
      name: "Demo Location",
      type: "smoc_campus",
      latitude: -25.7,
      longitude: 28.2,
      country: "India",
    },
  });
  assert(
    modelPatch.success,
    "a model-invented key nested inside the draft must be STRIPPED, not rejected. " +
      "Rejecting it discards the whole turn silently, which is worse than the 200 E7.1f " +
      "set out to fix.",
  );
  assert(
    modelPatch.success && !("country" in (modelPatch.data.location ?? {})),
    "the invented key must not survive into the merged draft — that is the M2 protection",
  );

  // 3. What IS still closed: the wrapper declares only `draft`, so nothing can
  //    ride alongside it. This is the half of the guarantee E7.1f keeps here.
  assert(
    !patchDraftBodySchema.safeParse({ draft: {}, _secrets: {} }).success,
    "the PATCH wrapper must refuse a sibling of `draft` — it declares only that one key",
  );
}

/** `n` items from `build`, so a fixture length is always an expression of the cap. */
export function times<T>(n: number, build: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => build(i));
}

export const rtuAt = (i: number) => ({
  code: `RTU-${i}`,
  displayName: `RTU ${i}`,
  protocol: "mqtt" as const,
  config: {},
});

export const pointKeyAt = (i: number) => ({ code: `pk_${i}`, name: `Point ${i}` });

export const assetAt = (i: number) => ({
  rtuIndex: 0,
  code: `ASSET-${i}`,
  name: `Asset ${i}`,
  siteName: "Site",
  domain: "electrical",
});

export const assetPointAt = (i: number) => ({
  assetIndex: 0,
  pointKey: `pk_${i}`,
  sourceDataKey: `src_${i}`,
});

/** `F3.22` — the smallest valid template entry: a stock import. */
export const stockTemplateAt = (i: number) => ({ stockCode: `stock_${i}` });

/**
 * `F4.103` — the API copy of the draft schema carries the same four count caps.
 *
 * **This is a second copy of the bound, deliberately.** ADR 0030 makes
 * `packages/shared/src/contracts/onboarding.ts` the schema every *response*
 * type is `z.infer`red from, and this file is the one the *write* path parses:
 * `patchDraftBodySchema` at `onboarding.controller.ts`, and the stored draft
 * re-parsed by `OnboardingValidateService.validate`. Bounding one and not the
 * other typechecks and passes both package suites, so
 * `tests/f4.103-draft-count-caps.test.ts` compares the two files' declarations
 * directly. What is asserted here is that this copy enforces its half.
 *
 * Every fixture length is `MAX_…` or `MAX_… + 1`, never the literal the
 * constant holds today — `F4.102`'s lesson. And every over-cap refusal is
 * paired with an at-cap parse, which is what proves the refusal came from the
 * length rather than from a quietly invalid fixture item.
 */
export function runDraftCountCapTests(): void {
  // `apps/api` reads these through `@bms/shared`'s built `dist`. A stale build
  // makes them `undefined`, `z.array(x).max(undefined)` then refuses nothing,
  // and every assertion below fails for a reason that explains nothing. This
  // one says it out loud instead.
  for (const [name, cap] of [
    ["MAX_ONBOARDING_RTUS", MAX_ONBOARDING_RTUS],
    ["MAX_ONBOARDING_POINT_KEYS", MAX_ONBOARDING_POINT_KEYS],
    ["MAX_ONBOARDING_ASSETS", MAX_ONBOARDING_ASSETS],
    ["MAX_ONBOARDING_ASSET_POINTS", MAX_ONBOARDING_ASSET_POINTS],
    ["MAX_ONBOARDING_TEMPLATES", MAX_ONBOARDING_TEMPLATES],
  ] as const) {
    assert(
      typeof cap === "number" && Number.isInteger(cap) && cap > 0,
      `${name} must be a positive integer, got ${String(cap)} — rebuild @bms/shared`,
    );
  }

  const cases: readonly (readonly [string, number, (i: number) => unknown])[] = [
    ["rtus", MAX_ONBOARDING_RTUS, rtuAt],
    ["pointKeys", MAX_ONBOARDING_POINT_KEYS, pointKeyAt],
    ["assets", MAX_ONBOARDING_ASSETS, assetAt],
    ["assetPoints", MAX_ONBOARDING_ASSET_POINTS, assetPointAt],
    // F3.22 (ADR 0091 decision 2).
    ["templates", MAX_ONBOARDING_TEMPLATES, stockTemplateAt],
  ];

  for (const [field, cap, build] of cases) {
    const atCap = onboardingDraftSchema.safeParse({ [field]: times(cap, build) });
    assert(
      atCap.success,
      `a draft holding exactly the cap of ${field} must parse, got: ` +
        (atCap.success ? "" : JSON.stringify(atCap.error.issues[0])),
    );

    const overCap = onboardingDraftSchema.safeParse({ [field]: times(cap + 1, build) });
    assert(
      !overCap.success &&
        overCap.error.issues.some((issue) => issue.code === "too_big" && issue.path[0] === field),
      `a draft holding cap + 1 ${field} must be refused with a \`too_big\` on \`${field}\`: ` +
        (overCap.success ? "it parsed" : JSON.stringify(overCap.error.issues)),
    );
  }

  // The live write path. `onboarding.controller.ts` calls
  // `patchDraftBodySchema.parse(body)` and turns the `ZodError` into a 400, so
  // this is the assertion that says `PATCH :id/draft` cannot store an over-cap
  // array at all.
  assert(
    !patchDraftBodySchema.safeParse({
      draft: { rtus: times(MAX_ONBOARDING_RTUS + 1, rtuAt) },
    }).success,
    "PATCH :id/draft must refuse a body whose draft holds more than the RTU cap",
  );
  assert(
    patchDraftBodySchema.safeParse({ draft: { rtus: times(MAX_ONBOARDING_RTUS, rtuAt) } }).success,
    "PATCH :id/draft must still accept a body exactly at the RTU cap",
  );

  // A draft at every cap at once still parses. The regression direction: without
  // it, a future tightening satisfies all four cases above by refusing
  // everything, and nothing here goes red.
  assert(
    onboardingDraftSchema.safeParse({
      rtus: times(MAX_ONBOARDING_RTUS, rtuAt),
      pointKeys: times(MAX_ONBOARDING_POINT_KEYS, pointKeyAt),
      assets: times(MAX_ONBOARDING_ASSETS, assetAt),
      assetPoints: times(MAX_ONBOARDING_ASSET_POINTS, assetPointAt),
    }).success,
    "a draft at all four caps simultaneously must parse — the caps are a ceiling, not a target",
  );
}

/* -------------------------------------------------------------------------- */
/* F4.115 — the draft's nesting depth                                         */
/* -------------------------------------------------------------------------- */

/**
 * A `config` whose deepest value sits at `depth`, **counting the draft object
 * itself as level 1**.
 *
 * The arithmetic is fixed by the draft skeleton and is the derivation
 * `MAX_ONBOARDING_DRAFT_DEPTH` records: `draft` (1) → `rtus` (2) → `rtus[i]`
 * (3) → `config` (4) → `config`'s own values (5 and below). So a flat `config`
 * — every shipped producer writes one — reaches exactly 5, and each extra wrap
 * adds one level.
 *
 * The nesting is planted under `rtus[].config` and not under an invented
 * top-level key on purpose. `onboardingDraftSchema` is a plain `z.object` with
 * no `.passthrough()`, so zod **strips** an unknown key before any
 * `.superRefine` on the object can see it: a chain under `{ junk: … }` would
 * satisfy the self-check below and then parse successfully, and the off-by-one
 * that appeared to cause would be in the fixture rather than in the schema.
 *
 * Built with a loop; a recursive builder would throw before the schema does.
 */
function configNestedToDepth(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf: "x" };
  for (let extra = 0; extra < depth - 5; extra += 1) {
    node = { next: node };
  }
  return node;
}

/** A whole draft whose deepest value sits at `depth`. */
function draftNestedToDepth(depth: number): Record<string, unknown> {
  return {
    rtus: [
      {
        code: "RTU-1",
        displayName: "RTU one",
        protocol: "mqtt",
        config: configNestedToDepth(depth),
      },
    ],
  };
}

/**
 * The fixture builder is itself checked, in both directions, before anything
 * else reads it.
 *
 * Without this an off-by-one in `configNestedToDepth` would make the two parse
 * assertions below vacuous rather than failing: a fixture built one level short
 * of the bound parses, and "the schema accepts a draft at the bound" would pass
 * having tested a draft that is not at the bound.
 */
export function assertDraftDepthFixturesSitExactlyAtTheBound(): void {
  const flat = { rtus: [{ code: "R1", config: { host: "h", port: 1883 } }] };
  assert(
    exceedsDepth(flat, 5) === false && exceedsDepth(flat, 4) === true,
    "the flat config every shipped producer writes reaches exactly five levels",
  );

  const atBound = draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH);
  assert(
    exceedsDepth(atBound, MAX_ONBOARDING_DRAFT_DEPTH) === false,
    "the at-bound fixture must not exceed the bound",
  );
  assert(
    exceedsDepth(atBound, MAX_ONBOARDING_DRAFT_DEPTH - 1) === true,
    "the at-bound fixture must sit exactly AT the bound, not below it",
  );

  const oneDeeper = draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH + 1);
  assert(
    exceedsDepth(oneDeeper, MAX_ONBOARDING_DRAFT_DEPTH) === true,
    "the over-bound fixture must exceed the bound by exactly one level",
  );
  assert(
    exceedsDepth(oneDeeper, MAX_ONBOARDING_DRAFT_DEPTH + 1) === false,
    "the over-bound fixture must not exceed the bound by more than one level",
  );
}

/** A draft sitting exactly at the bound is accepted, not refused. */
export function assertPatchDraftBodyAcceptsADraftAtTheBound(): void {
  const parsed = patchDraftBodySchema.safeParse({
    draft: draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH),
  });
  assert(
    parsed.success,
    "a draft nested exactly to the bound must still be accepted by PATCH :id/draft",
  );
}

/**
 * One level deeper is a 400 naming the limit.
 *
 * `fieldErrors.draft`, **not** `formErrors`, and the difference was measured
 * rather than assumed: the issue is raised path-less on the draft node, and the
 * wrapper prefixes `draft` onto it, so `ZodError.flatten` — which sorts on
 * `path.length > 0` — files it under the field. `apiErrorMessage` renders
 * exactly this shape already; `api-error-message.spec.ts` carries the same body
 * for `F4.103`'s count cap.
 *
 * Every assertion here is about **the parse**. The two that are about the
 * exported sentence moved to `assertTheDepthRefusalSentenceStatesTheLimit`,
 * with an `it()` of their own: they could not run at all once either assertion
 * above them threw, so deleting the `superRefine` reddened this function at its
 * first line and never reached the §4.3 claim.
 */
export function assertPatchDraftBodyRefusesADraftOneDeeper(): void {
  const parsed = patchDraftBodySchema.safeParse({
    draft: draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH + 1),
  });
  assert(!parsed.success, "a draft one level past the bound must be refused");

  const flattened = parsed.success ? null : parsed.error.flatten();
  const draftErrors = flattened?.fieldErrors.draft ?? [];
  assert(
    draftErrors.includes(DRAFT_TOO_DEEP_MESSAGE),
    `the refusal must name the depth limit under fieldErrors.draft, got: ${JSON.stringify(flattened)}`,
  );
}

/**
 * Two claims about the exported sentence itself, and about nothing else.
 *
 * They parse no draft and so cannot be blocked by a parse assertion failing
 * first — which is what they were, appended to
 * `assertPatchDraftBodyRefusesADraftOneDeeper` above. That is `F4.105`'s
 * lesson, now AGENTS.md §4.6: a mutation must redden **the** assertion that
 * owns the claim, and grouping decides whether it is ever reached.
 *
 * - The sentence states the limit, so the caller knows what to flatten to.
 * - It echoes **nothing from the input** (§4.3). The field names in it are
 *   literals from `onboarding.schema.ts` and the only interpolation is the
 *   constant, so the two fixture-only key names below can never appear in it.
 */
export function assertTheDepthRefusalSentenceStatesTheLimit(): void {
  assert(
    DRAFT_TOO_DEEP_MESSAGE.includes(String(MAX_ONBOARDING_DRAFT_DEPTH)),
    "the sentence must state the limit, so the caller knows what to flatten to",
  );
  assert(
    !DRAFT_TOO_DEEP_MESSAGE.includes("leaf") && !DRAFT_TOO_DEEP_MESSAGE.includes("next"),
    "§4.3: the refusal must not echo a key name read from the draft",
  );
}

/**
 * **The assertion that pins the placement**, and the only one that moves if the
 * check is attached to `patchDraftBodySchema` instead.
 *
 * The model's `draftPatch` parses `onboardingDraftSchema` directly
 * (`onboarding-chat.service.ts`) and never touches the wrapper, so on the
 * wrapper alone a deep patch from the model is still merged and stored — and
 * ruling 2a fails for the one producer that emits JSON nobody typed.
 *
 * The residual is the one already ruled acceptable **for that producer and no
 * wider**: an over-deep model patch fails `safeParse`, becomes `{}` through
 * `.data ?? {}`, and the turn is silently dropped. Producer 1 answers a 400 at
 * the controller. Do not generalise it to the other two.
 */
export function assertOnboardingDraftSchemaCoversTheModelProducer(): void {
  assert(
    onboardingDraftSchema.safeParse(draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH)).success,
    "the draft schema itself must accept a draft at the bound",
  );
  assert(
    onboardingDraftSchema.safeParse(draftNestedToDepth(MAX_ONBOARDING_DRAFT_DEPTH + 1)).success ===
      false,
    "the draft schema itself must refuse an over-deep draft, or the model's producer is unguarded",
  );
}

/**
 * The other direction: the guard must not fire where it should not.
 *
 * A draft in the shape the shipped producers actually write — `parseRtus` and
 * `defaultConfig` both emit a flat `config`, and nothing in the repository
 * writes a nested `meta` at all — parses at 100 RTUs with `_secrets` present.
 * `_secrets` is included because a stored draft carries it as soon as any
 * credential is set, and `OnboardingValidateService` re-parses the stored value
 * through this same schema.
 */
export function assertTheShippedProducerShapesStillParse(): void {
  const draft = {
    location: {
      code: "BERHAMPUR",
      slug: "berhampur",
      name: "Berhampur",
      type: "smoc_campus",
      latitude: 19.3,
      longitude: 84.8,
    },
    rtus: Array.from({ length: 100 }, (_unused, index) => ({
      code: `RTU-${index}`,
      displayName: `RTU ${index}`,
      protocol: "mqtt",
      config: { host: "broker.example", port: 8883, tls: true, topic: `site/${index}/data` },
    })),
    _secrets: { "RTU-0": { c: "Y2lwaGVy", iv: "aXY=" } },
  };

  const parsed = onboardingDraftSchema.safeParse(draft);
  assert(
    parsed.success,
    `a draft in the shape the shipped producers write must parse, got: ${
      parsed.success ? "" : JSON.stringify(parsed.error.flatten())
    }`,
  );
  assert(
    patchDraftBodySchema.safeParse({ draft }).success,
    "and the same draft must pass the PATCH :id/draft wrapper",
  );
}

/**
 * C6 (`F4.157`, ADR 0077 D4, OQ2) — this file's own copy of the draft location
 * schema, on the same terms as `packages/shared`'s: `type` is optional between
 * turns. Mutation: remove `.optional()`.
 */
export function assertApiDraftLocationParsesWithoutType(): void {
  const parsed = draftLocationSchema.safeParse({
    code: "DEMO_LOC",
    slug: "demo-loc",
    name: "Demo Location",
    latitude: -25.7,
    longitude: 28.2,
  });
  assert(
    parsed.success,
    `a draft location without type must parse, got: ${
      parsed.success ? "" : JSON.stringify(parsed.error.issues)
    }`,
  );
}

/**
 * D3 (`F4.170`, compliance review B1) — the generated document for
 * `PATCH :id/draft` says a draft location's `meta.seedKey` is seed-owned and
 * ignored on commit. Read from the converted schema, since a caller reads the
 * document, not this file.
 */
export function assertDraftLocationMetaDescribesTheSeedKey(): void {
  type Node = { properties?: Record<string, Node>; description?: unknown };
  const { schema } = convertZodSchema(patchDraftBodySchema, "patchDraftBody");
  const meta = (schema as Node).properties?.draft?.properties?.location?.properties?.meta;
  assert(
    typeof meta?.description === "string" && /seedKey.*seed-owned.*ignored/s.test(meta.description),
    `draft.location.meta must say seedKey is seed-owned and ignored, got: ${JSON.stringify(meta?.description)}`,
  );
}

/* -------------------------------------------------------------------------- */
/* F3.22 — the template reference's variable keys (API copy only)             */
/* -------------------------------------------------------------------------- */

/** A draft holding one templated asset whose variables are `vars`. */
function draftWithVars(vars: Record<string, string>): unknown {
  return { assets: [{ ...assetAt(0), template: { code: "pump", sourceDataKeyVars: vars } }] };
}

function refusesAtVars(vars: Record<string, string>): string | null {
  const parsed = patchDraftBodySchema.safeParse({ draft: draftWithVars(vars) });
  if (parsed.success) {
    return null;
  }
  const issue = parsed.error.issues.find(
    (candidate) =>
      candidate.path.slice(0, 5).join(".") === "draft.assets.0.template.sourceDataKeyVars",
  );
  return issue === undefined ? JSON.stringify(parsed.error.issues) : issue.message;
}

/**
 * `F3.22` — a variable key is a token of a source-key pattern, so on the write
 * path it must match the token grammar `[a-zA-Z0-9_]+`. The positive parse
 * beside the refusal proves the refusal is the key, not the fixture.
 */
export function assertTemplateVarKeyMustMatchTheTokenGrammar(): void {
  assert(
    refusesAtVars({ site_1: "PLANT" }) === null,
    "a variable key in the token grammar must parse",
  );
  const message = refusesAtVars({ "site-1": "PLANT" });
  assert(
    message !== null && /token/i.test(message),
    "a variable key outside `[a-zA-Z0-9_]+` must be refused under " +
      `draft.assets[0].template.sourceDataKeyVars, got: ${String(message)}`,
  );
}

/**
 * `F3.22` — `asset_code` is filled from the asset at instantiation
 * (`SOURCE_KEY_RESERVED_VAR`), so the draft may not supply it.
 */
export function assertTemplateVarKeyRefusesTheReservedName(): void {
  assert(
    refusesAtVars({ asset: "PLANT" }) === null,
    "a non-reserved key next to the reserved one must parse",
  );
  const message = refusesAtVars({ asset_code: "PLANT" });
  assert(
    message !== null && message.includes("asset_code"),
    "the reserved key `asset_code` must be refused under " +
      `draft.assets[0].template.sourceDataKeyVars, got: ${String(message)}`,
  );
}
