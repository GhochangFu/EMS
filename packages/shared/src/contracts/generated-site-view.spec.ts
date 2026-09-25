import { adminPointKeyDtoSchema } from "./admin";
import { generatedSiteViewDtoSchema } from "./generated-site-view";

/**
 * `F3.68` / ADR 0076 decision 7 — the generated site view contracts, and the
 * admin point-key DTO's rank field.
 *
 * Assertions live here; `generated-site-view.test.ts` is the Vitest entry
 * point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectAccepts(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === true, `${message} — expected success, got a refusal`);
}

function expectRejects(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === false, `${message} — expected a refusal, got success`);
}

const validPoint = {
  pointKey: "kw",
  name: "Active Power",
  unit: "kW",
  headlineRank: 1,
  latest: { value: 12.5, time: "2026-09-25T10:00:00.000Z" },
};

const unsampledPoint = {
  pointKey: "frequency_hz",
  name: "Frequency",
  unit: "Hz",
  headlineRank: null,
  latest: null,
};

const validAsset = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "UPS-1",
  name: "UPS 1",
  domain: "electrical",
  latestTelemetryAt: "2026-09-25T10:00:00.000Z",
  freshness: "live",
  points: [validPoint],
};

const twoDomainPayload = {
  locationId: "22222222-2222-4222-8222-222222222222",
  asOf: "2026-09-25T10:00:00.000Z",
  domains: [
    { code: "electrical", label: "Electrical", assets: [validAsset] },
    {
      code: "hvac",
      label: "HVAC",
      assets: [
        {
          ...validAsset,
          id: "33333333-3333-4333-8333-333333333333",
          domain: "hvac",
          // a point with no sample yet — exercises `latest: null` (D6/D2).
          points: [validPoint, unsampledPoint],
        },
      ],
    },
  ],
};

/** C1 — a two-domain payload parses. */
export function runTwoDomainPayloadTest(): void {
  expectAccepts(generatedSiteViewDtoSchema, twoDomainPayload, "the two-domain payload");
}

/** C2 — an unknown freshness value ("old") is refused. */
export function runUnknownFreshnessTest(): void {
  const withOldFreshness = {
    ...twoDomainPayload,
    domains: [
      {
        ...twoDomainPayload.domains[0],
        assets: [{ ...validAsset, freshness: "old" }],
      },
    ],
  };
  expectRejects(generatedSiteViewDtoSchema, withOldFreshness, "an asset with freshness: old");
}

/** C2b — freshness: "stale" is one of the three accepted values. */
export function runStaleFreshnessAcceptedTest(): void {
  const withStaleFreshness = {
    ...twoDomainPayload,
    domains: [
      {
        ...twoDomainPayload.domains[0],
        assets: [{ ...validAsset, freshness: "stale" }],
      },
    ],
  };
  expectAccepts(generatedSiteViewDtoSchema, withStaleFreshness, "an asset with freshness: stale");
}

/** C3 — a non-integer headlineRank (1.5) is refused. */
export function runFractionalHeadlineRankTest(): void {
  const withFractionalRank = {
    ...twoDomainPayload,
    domains: [
      {
        ...twoDomainPayload.domains[0],
        assets: [
          { ...validAsset, points: [{ ...validPoint, headlineRank: 1.5 }] },
        ],
      },
    ],
  };
  expectRejects(generatedSiteViewDtoSchema, withFractionalRank, "a point with headlineRank: 1.5");
}

/** C4 — adminPointKeyDtoSchema refuses a row with no headlineRank field. */
export function runAdminPointKeyRequiresHeadlineRankTest(): void {
  const withoutHeadlineRank = {
    id: "11111111-1111-4111-8111-111111111111",
    code: "kw",
    name: "Active Power",
    domain: "electrical",
    unit: "kW",
    description: null,
    active: true,
    createdAt: "2026-09-25T10:00:00.000Z",
  };
  expectRejects(adminPointKeyDtoSchema, withoutHeadlineRank, "an admin point-key row with no headlineRank");
}
