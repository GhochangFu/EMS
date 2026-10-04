import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import type { MasterDataAuditService } from "../master-data-audit.service";
import type { VocabulariesService } from "../../vocabularies/vocabularies.service";
import type { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import type { InstantiateAssetsBody } from "./asset-templates.schema";

/**
 * `F3.22` (ADR 0091 decision 5) — the instantiate core's location check is an
 * option, and only the onboarding commit turns it off.
 *
 * The onboarding commit writes the location and the RTU in the same
 * transaction it then instantiates onto. `canManageLocation` reads on the auth
 * and fleet pools, which cannot see an uncommitted row, so for that caller the
 * check would refuse every `organization_admin`. Decision 5 makes the
 * organization check the check there. These two cases hold both directions:
 *
 * - A1, the route's default: `canManageLocation` is asked once and the batch
 *   reaches its first write.
 * - A2, `{ locationAccess: "organization" }`: `canManageLocation` is **not**
 *   asked, and — the positive beside that absence — `canManageOrganization` is
 *   asked once, with the template's organization, and the batch still reaches
 *   its first write.
 *
 * The harness is `asset-templates-instantiate.dashboard-bound.spec.ts`'s: reads
 * answered from a queue, and a write that raises a sentinel. The template
 * carries no alarms and no views and the batch is one asset, so the only reads
 * before the write are the guards named in `txAnswers` below.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";

const JWT: JwtPayload = {
  sub: "44444444-4444-4444-8444-444444444444",
  email: "org-admin@bms.local",
  role: "organization_admin",
} as JwtPayload;

/** Raised by the first insert — reaching it is the proof that every guard passed. */
const WROTE = "the batch reached its first write";

type AccessCalls = { location: unknown[][]; organization: unknown[][] };

/** A drizzle-shaped builder answering from a queue; the dashboard-bound shape. */
function queueBuilder(answers: unknown[][]): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "groupBy"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (value: unknown) => void) => {
    resolve(answers.shift() ?? []);
  };
  return builder;
}

/** Every read the core makes on `tx` before its first insert, in order. */
function txAnswers(): unknown[][] {
  return [
    // fetchTemplateRow
    [
      {
        id: TEMPLATE_ID,
        organizationId: ORG,
        code: "F322-ACCESS",
        version: 1,
        status: "published",
        domain: "water",
        content: { contentVersion: 1 },
      },
    ],
    // resolveTarget, location branch
    [{ locationId: LOCATION_ID, locationName: "Access Site", organizationId: ORG, active: true }],
    // the template's points
    [{ pointKey: "flow", kind: "measured", required: true, unit: null, sourceDataKeyPattern: "{asset_code}_F" }],
    // assertCatalogActive
    [{ code: "flow", unit: null }],
    // assertAssetCodesFree, the same-organization read
    [],
  ];
}

function fakeTx(): Record<string, unknown> {
  const builder = queueBuilder(txAnswers());
  return {
    execute: async () => undefined,
    select: () => builder,
    selectDistinct: () => builder,
    insert: () => {
      throw new Error(WROTE);
    },
  };
}

/**
 * `fleetAnswers` differ by door: the route wrapper reads the template's
 * organization first; `instantiateInTransaction` does not. Both then make the
 * estate-wide asset-code read, answered `[]`.
 */
function serviceUnderTest(calls: AccessCalls, fleetAnswers: unknown[][]): AssetTemplateInstantiationService {
  const fleet = queueBuilder(fleetAnswers);
  const tx = fakeTx();
  const access = {
    requireMasterDataUser: async () => ({ role: "organization_admin" }),
    canManageOrganization: async (...args: unknown[]) => {
      calls.organization.push(args);
      return true;
    },
    canManageLocation: async (...args: unknown[]) => {
      calls.location.push(args);
      return true;
    },
    writableLocationIds: async () => null,
  } as unknown as AccessControlService;
  return new AssetTemplateInstantiationService(
    { select: () => fleet, selectDistinct: () => fleet } as never,
    { transaction: async (fn: (handle: unknown) => Promise<unknown>) => fn(tx) } as never,
    access,
    {} as MasterDataAuditService,
    {} as VocabulariesService,
    {
      instantiateForAssets: async () => {
        throw new Error(WROTE);
      },
    } as unknown as AssetDashboardsInstantiateService,
  );
}

const BODY = {
  target: { kind: "location", locationId: LOCATION_ID },
  assets: [{ code: "F322-ACCESS-1", name: "Access 1" }],
} as unknown as InstantiateAssetsBody;

async function messageOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "";
}

/** A1 — the route's default asks `canManageLocation` once, for the resolved location. */
export async function assertTheDefaultChecksTheTargetLocation(): Promise<void> {
  const calls: AccessCalls = { location: [], organization: [] };
  const message = await messageOf(
    serviceUnderTest(calls, [[{ organizationId: ORG }], []]).instantiate(JWT, TEMPLATE_ID, BODY),
  );
  expect(calls.location).toEqual([[JWT, LOCATION_ID]]);
  // The positive control: every guard passed and the batch reached its write.
  expect(message).toBe(WROTE);
}

/**
 * A2 — `{ locationAccess: "organization" }` does not ask `canManageLocation`,
 * and asks `canManageOrganization` once with the template's organization.
 */
export async function assertTheOrganizationOptionChecksTheOrganizationOnly(): Promise<void> {
  const calls: AccessCalls = { location: [], organization: [] };
  const service = serviceUnderTest(calls, [[]]);
  const message = await messageOf(
    service.instantiateInTransaction(fakeTx() as never, JWT, TEMPLATE_ID, BODY, {
      locationAccess: "organization",
    }),
  );
  expect(calls.location, "canManageLocation must not be asked").toEqual([]);
  expect(calls.organization).toEqual([[JWT, ORG]]);
  expect(message).toBe(WROTE);
}
