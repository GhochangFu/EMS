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
