import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import {
  BODY,
  errorMessage,
  FOREIGN_LOCATION,
  harness,
  JWT,
  ORG_ID,
  OTHER_LOCATION,
  save,
  type Scenario,
  WC,
} from "./report-files.service.spec";
import { LOCATION_IDS_OUTSIDE_ORGANIZATION, LOCATION_IDS_OUTSIDE_SCOPE } from "./report-scope";

/**
 * `F4.290` (ADR 0099 Amendment 9 E4) — the on-demand save with a site filter,
 * over `report-files.service.spec.ts`'s harness (that file is at the §4.5 cap,
 * so these claims live here). The body's `locationIds` is checked under the
 * schedule's own write rule (`assertLocationIdsInScope`), stamped on the row
 * as named, and rendered under `ReportScopeService.assetIdsInOrganization`'s
 * answer — the caller's readable assets of those subtrees. Without it the
 * save is unchanged and the scope service is never called. Vitest entry point:
 * the sibling `.test.ts`.
 */

const SCOPED = ["69696969-6969-4696-8696-696969696969"];

function scopeFake() {
  const calls: Array<{ organizationId: string; locationIds: readonly string[] }> = [];
  return {
    calls,
    scope: {
      assetIdsInOrganization: async (_jwt: unknown, organizationId: string, locationIds: readonly string[]) => {
        calls.push({ organizationId, locationIds });
        return SCOPED;
      },
    },
  };
}

const ORGANIZATION_ADMIN: Scenario = {
  writableLocationIds: [WC, OTHER_LOCATION],
  grantedLocationIds: [],
  writableOrganizationIds: [ORG_ID],
  readScope: { kind: "organization", organizationIds: [ORG_ID] },
  organizationLocations: [WC, OTHER_LOCATION],
};

/** Holds WC; OTHER_LOCATION is a location of the organization outside the grant. */
const LOCATION_ADMIN: Scenario = {
  writableLocationIds: [WC],
  grantedLocationIds: [WC],
  writableOrganizationIds: [ORG_ID],
  readScope: { kind: "location", organizationIds: [ORG_ID], locationIds: [WC] },
  organizationLocations: [WC, OTHER_LOCATION],
};

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the save to be refused, and it resolved");
}

/** An organization admin naming a site stamps the row with that site, not `{}`. */
export async function aNamedSiteIsTheRowsStamp(): Promise<void> {
  const h = harness({ ...ORGANIZATION_ADMIN, scope: scopeFake().scope });
  await save(h, { ...BODY, locationIds: [WC] });
  expect(h.inserted[0]?.locationIds).toEqual([WC]);
}

/** The render reads the scope service's answer, not the organization's whole readable set. */
export async function theRenderReadsTheNamedSitesAssets(): Promise<void> {
  const h = harness({ ...ORGANIZATION_ADMIN, scope: scopeFake().scope });
  await save(h, { ...BODY, locationIds: [WC] });
  expect(h.reports.calls[0]?.assetIds).toBe(SCOPED);
}

/** The scope service is asked for the save's own organization and the named sites. */
export async function theScopeIsAskedForTheSavesOrganization(): Promise<void> {
  const fake = scopeFake();
  await save(harness({ ...ORGANIZATION_ADMIN, scope: fake.scope }), { ...BODY, locationIds: [WC] });
  expect(fake.calls).toEqual([{ organizationId: ORG_ID, locationIds: [WC] }]);
}

/** A site outside the organization is the schedule's 400. */
export async function aSiteOutsideTheOrganizationIsA400(): Promise<void> {
  const err = await rejection(save(harness({ ...ORGANIZATION_ADMIN, scope: scopeFake().scope }), { ...BODY, locationIds: [FOREIGN_LOCATION] }));
  expect([err instanceof BadRequestException, errorMessage(err)]).toEqual([true, LOCATION_IDS_OUTSIDE_ORGANIZATION]);
}

/** That refusal comes before any render and any storage call. */
export async function theRefusalComesBeforeTheRenderAndTheObject(): Promise<void> {
  const h = harness({ ...ORGANIZATION_ADMIN, scope: scopeFake().scope });
  await rejection(save(h, { ...BODY, locationIds: [FOREIGN_LOCATION] }));
  expect(h.calls.filter((call) => call === "render" || call === "putObject")).toEqual([]);
}

/** A location admin naming a site of the organization outside its grant is the schedule's 403. */
export async function aSiteOutsideALocationAdminsGrantIsA403(): Promise<void> {
  const err = await rejection(save(harness({ ...LOCATION_ADMIN, scope: scopeFake().scope }), { ...BODY, locationIds: [OTHER_LOCATION] }));
  expect([err instanceof ForbiddenException, errorMessage(err)]).toEqual([true, LOCATION_IDS_OUTSIDE_SCOPE]);
}

/** A location admin naming its own site saves (the adjacent positive). */
export async function aLocationAdminNamingItsSiteSaves(): Promise<void> {
  const h = harness({ ...LOCATION_ADMIN, scope: scopeFake().scope });
  await save(h, { ...BODY, locationIds: [WC] });
  expect(h.inserted[0]?.locationIds).toEqual([WC]);
}

/** No `locationIds`: the stamp is still the author's grants (regression). */
export async function withoutLocationIdsTheStampIsStillTheGrants(): Promise<void> {
  const h = harness({ ...LOCATION_ADMIN, scope: scopeFake().scope });
  await save(h, BODY);
  expect(h.inserted[0]?.locationIds).toEqual([WC]);
}

/** No `locationIds`: the scope service is never called (the critic's regression). */
export async function withoutLocationIdsTheScopeIsNeverCalled(): Promise<void> {
  const fake = scopeFake();
  await save(harness({ ...ORGANIZATION_ADMIN, scope: fake.scope }), BODY);
  expect(fake.calls).toEqual([]);
}

/** The proposal check's read-only preview stamps the named sites too. */
export async function thePreviewStampsTheNamedSites(): Promise<void> {
  const h = harness({ ...ORGANIZATION_ADMIN, scope: scopeFake().scope });
  expect((await h.service.previewSave(JWT, ORG_ID, [OTHER_LOCATION])).locationIds).toEqual([OTHER_LOCATION]);
}
