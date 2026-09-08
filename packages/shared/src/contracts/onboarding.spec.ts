import {
  MAX_ONBOARDING_ASSET_POINTS,
  MAX_ONBOARDING_ASSETS,
  MAX_ONBOARDING_POINT_KEYS,
  MAX_ONBOARDING_RTUS,
  onboardingDraftSchema,
  onboardingSessionDtoSchema,
} from "./onboarding";

/**
 * `F4.103` — the four draft arrays carry a count cap.
 *
 * Assertions live here; `onboarding.test.ts` is the vitest entry point
 * (ADR 0014). Everything below is a plain object and needs no connection.
 *
 * **Every fixture length is written as `MAX_…` or `MAX_… + 1`, never as the
 * literal the constant holds today.** A restated `500` still passes once the
 * constant moves, and from that moment the test vouches for nothing — the
 * `F4.102` lesson, applied before it can be repeated here.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
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

/** `n` items from `build`, so a fixture length is always an expression of the cap. */
function times<T>(n: number, build: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => build(i));
}

/**
 * The at-cap parse is not decoration — it is what proves `cap + 1` failed for
 * the length and not because the fixture item was quietly invalid. The two
 * assertions only mean anything as a pair.
 */
function assertArrayCap(
  field: "rtus" | "pointKeys" | "assets" | "assetPoints",
  cap: number,
  build: (i: number) => unknown,
): void {
  assert(
    typeof cap === "number" && Number.isInteger(cap) && cap > 0,
    `${field}'s cap must be a positive integer, got ${String(cap)} — a stale @bms/shared dist ` +
      "makes it `undefined`, and `z.array(x).max(undefined)` refuses nothing at all",
  );

  const atCap = onboardingDraftSchema.safeParse({ [field]: times(cap, build) });
  assert(
    atCap.success,
    `a draft holding exactly the cap of ${field} must parse, got: ` +
      (atCap.success ? "" : JSON.stringify(atCap.error.issues[0])),
  );

  const overCap = onboardingDraftSchema.safeParse({ [field]: times(cap + 1, build) });
  assert(!overCap.success, `a draft holding cap + 1 ${field} must be refused`);
  assert(
    !overCap.success &&
      overCap.error.issues.some((issue) => issue.code === "too_big" && issue.path[0] === field),
    `the refusal must be a \`too_big\` on \`${field}\` itself, not an item-shape error: ` +
      (overCap.success ? "" : JSON.stringify(overCap.error.issues)),
  );
}

/**
 * `F4.103` — the count cap on the four draft arrays, in the shared contract.
 *
 * This is the copy ADR 0030 makes every response type `z.infer` of, so it is
 * also the copy `apps/web` parses a session and a validate preview through.
 * The API keeps its own copy in `apps/api/src/admin/onboarding/onboarding.schema.ts`;
 * `tests/f4.103-draft-count-caps.test.ts` is what stops the two drifting.
 */
export function assertDraftArrayCapsAreEnforced(): void {
  assertArrayCap("rtus", MAX_ONBOARDING_RTUS, rtuAt);
  assertArrayCap("pointKeys", MAX_ONBOARDING_POINT_KEYS, pointKeyAt);
  assertArrayCap("assets", MAX_ONBOARDING_ASSETS, assetAt);
  assertArrayCap("assetPoints", MAX_ONBOARDING_ASSET_POINTS, assetPointAt);

  // A draft at every cap at once still parses. Without this the four checks
  // above are all satisfiable by a schema that refuses everything.
  const atEveryCap = onboardingDraftSchema.safeParse({
    rtus: times(MAX_ONBOARDING_RTUS, rtuAt),
    pointKeys: times(MAX_ONBOARDING_POINT_KEYS, pointKeyAt),
    assets: times(MAX_ONBOARDING_ASSETS, assetAt),
    assetPoints: times(MAX_ONBOARDING_ASSET_POINTS, assetPointAt),
  });
  assert(
    atEveryCap.success,
    "a draft at all four caps simultaneously must parse — the caps are a ceiling, not a target",
  );

  // The declaration order is load-bearing, so it is gated rather than claimed
  // in a comment: zod reports an object's issues in key-declaration order, so a
  // draft breaching two caps fails first on `rtus`. This is the schema-level
  // half of the ordering only; which section of a *workbook* is refused first
  // is a separate question, decided on the upload path, which does not parse
  // this schema at all.
  const overTwoCaps = onboardingDraftSchema.safeParse({
    rtus: times(MAX_ONBOARDING_RTUS + 1, rtuAt),
    assetPoints: times(MAX_ONBOARDING_ASSET_POINTS + 1, assetPointAt),
  });
  assert(
    !overTwoCaps.success && overTwoCaps.error.issues[0]?.path[0] === "rtus",
    "a draft over both the RTU and the asset-point cap must report `rtus` first: " +
      (overTwoCaps.success ? "it parsed" : JSON.stringify(overTwoCaps.error.issues)),
  );
}

/**
 * The cap reaches the **response** contract, not only the bare draft schema.
 *
 * `onboardingDraftSchema` is embedded in `onboardingSessionDtoSchema.draft` and
 * in `onboardingValidateResponseDtoSchema.preview`, and `apps/web` parses both
 * at runtime (ADR 0030 decision 5). Gating that reach here rather than implying
 * it is the difference between knowing where the bound applies and hoping.
 */
export function assertSessionDtoCarriesTheCaps(): void {
  const session = (draft: unknown) => ({
    id: "s1",
    organizationId: "o1",
    organizationCode: "ORG",
    organizationName: "Org",
    status: "draft",
    currentPhase: "rtu",
    draft,
    messages: [],
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z",
    committedAt: null,
    result: null,
  });

  assert(
    onboardingSessionDtoSchema.safeParse(session({ rtus: times(MAX_ONBOARDING_RTUS, rtuAt) }))
      .success,
    "a session DTO whose draft is exactly at the RTU cap must parse",
  );

  const overCap = onboardingSessionDtoSchema.safeParse(
    session({ rtus: times(MAX_ONBOARDING_RTUS + 1, rtuAt) }),
  );
  assert(
    !overCap.success &&
      overCap.error.issues.some(
        (issue) =>
          issue.code === "too_big" && issue.path[0] === "draft" && issue.path[1] === "rtus",
      ),
    "an over-cap draft must be refused inside the session DTO too, at `draft.rtus`: " +
      (overCap.success ? "it parsed" : JSON.stringify(overCap.error.issues)),
  );
}
