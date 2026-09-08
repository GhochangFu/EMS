import {
  MAX_ONBOARDING_ASSET_POINTS,
  MAX_ONBOARDING_ASSETS,
  MAX_ONBOARDING_POINT_KEYS,
  MAX_ONBOARDING_RTUS,
} from "@bms/shared";

import {
  draftLocationSchema,
  onboardingDraftSchema,
  patchDraftBodySchema,
} from "./onboarding.schema";

function assert(condition: boolean, message: string): void {
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
function times<T>(n: number, build: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => build(i));
}

const rtuAt = (i: number) => ({
  code: `RTU-${i}`,
  displayName: `RTU ${i}`,
  protocol: "mqtt" as const,
  config: {},
});

const pointKeyAt = (i: number) => ({ code: `pk_${i}`, name: `Point ${i}` });

const assetAt = (i: number) => ({
  rtuIndex: 0,
  code: `ASSET-${i}`,
  name: `Asset ${i}`,
  siteName: "Site",
  domain: "electrical",
});

const assetPointAt = (i: number) => ({
  assetIndex: 0,
  pointKey: `pk_${i}`,
  sourceDataKey: `src_${i}`,
});

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
