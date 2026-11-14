import { filterOptionsResponseSchema } from "./filter-options";

/**
 * `F4.361` / ADR 0132 decision 2 and build note 2 — the `GET /filter-options`
 * response contract. Assertions live here; `filter-options.test.ts` is the
 * vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ORG = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const CHILD = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const ASSET = "55555555-5555-4555-8555-555555555555";

function payload() {
  return {
    organizations: [{ id: ORG, code: "ESKOM", name: "Eskom" }],
    locations: [
      { id: SITE, name: "Site", code: "S", parentId: null as string | null, organizationId: ORG },
      { id: CHILD, name: "Child", code: "C", parentId: SITE as string | null, organizationId: ORG },
    ],
    assetGroups: [{ id: GROUP, name: "HVAC", code: "G", locationId: CHILD, organizationId: ORG, assetIds: [ASSET] }],
    assets: [{ id: ASSET, code: "A-1", name: "Chiller 1", locationId: CHILD, organizationId: ORG }],
  };
}

/** A full answer parses. */
export function assertAFullPayloadParses(): void {
  const result = filterOptionsResponseSchema.safeParse(payload());
  assert(result.success, `a full payload must parse: ${JSON.stringify(result.success ? undefined : result.error.issues)}`);
}

/** Every location carries its organization: the cascade reads it (decision 6). */
export function assertALocationWithoutOrganizationIdFails(): void {
  const body = payload();
  const { organizationId: _dropped, ...location } = body.locations[0]!;
  const result = filterOptionsResponseSchema.safeParse({ ...body, locations: [location] });
  assert(!result.success, "a location without organizationId must fail");
}

/** `parentId` is nullable, never optional: an unreadable parent is `null` (ADR 0098 Drafter choice 8). */
export function assertParentIdIsNullableNotOptional(): void {
  const body = payload();
  const { parentId: _dropped, ...withoutParent } = body.locations[1]!;
  const missing = filterOptionsResponseSchema.safeParse({ ...body, locations: [withoutParent] });
  assert(!missing.success, "a location with parentId undefined must fail");
  const nulled = filterOptionsResponseSchema.safeParse({ ...body, locations: [{ ...body.locations[1]!, parentId: null }] });
  assert(nulled.success, "a location with parentId null must parse");
}

/** Build note 2: a group option carries its listed members. */
export function assertAGroupWithoutAssetIdsFails(): void {
  const body = payload();
  const { assetIds: _dropped, ...group } = body.assetGroups[0]!;
  const result = filterOptionsResponseSchema.safeParse({ ...body, assetGroups: [group] });
  assert(!result.success, "an asset group without assetIds must fail");
}

/** An asset carries its location and organization, so the pickers can cascade. */
export function assertAnAssetWithoutOrganizationIdFails(): void {
  const body = payload();
  const { organizationId: _dropped, ...asset } = body.assets[0]!;
  const result = filterOptionsResponseSchema.safeParse({ ...body, assets: [asset] });
  assert(!result.success, "an asset without organizationId must fail");
}
