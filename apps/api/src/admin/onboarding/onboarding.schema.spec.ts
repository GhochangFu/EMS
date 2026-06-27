import { onboardingDraftSchema, draftLocationSchema } from "./onboarding.schema";

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

if (require.main === module) {
  runOnboardingSchemaTests();
  process.stdout.write("onboarding.schema tests: ok\n");
}
