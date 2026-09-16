import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import type { MasterDataAuditService } from "../master-data-audit.service";
import type { VocabulariesService } from "../../vocabularies/vocabularies.service";
import type { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import { MAX_DASHBOARD_WIDGET_ROWS } from "./asset-dashboards-plan";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import type { InstantiateAssetsBody } from "./asset-templates.schema";

/**
 * `F3.2` / ADR 0067 decision 4, guard G3 — **`assertBatchFits` receives the
 * dashboard term.**
 *
 * The bound is reachable by legal content: `featured` holds up to 50 keys and
 * `MAX_DASHBOARD_WIDGETS` lays out 40 of them, so two featured-only views cost
 * 80 `dashboard_widgets` rows per asset and the contract's 200-asset batch asks
 * for 16,000 against a ceiling of {@link MAX_DASHBOARD_WIDGET_ROWS}. The pure
 * arithmetic is proved by `asset-dashboards-plan.spec.ts` (P12); what is proved
 * here is the **wiring**, and it is proved by driving the real `instantiate`.
 *
 * **Why not a call to the private `assertBatchFits`.** The mutation this guard
 * exists to catch is "the fourth argument is not passed, or is passed as `0`" —
 * a defect at the *call site*. A direct call with a hand-written fourth argument
 * proves the method body forwards what it is given and stays green through
 * exactly that mutation. Only the public path reddens for both.
 *
 * **Why not the database.** The refusal happens before anything is written, so
 * a real connection would prove nothing extra and would make an owed guard skip
 * on a machine with no `DATABASE_URL`. The reads `instantiate` makes before the
 * bound are answered from a queue instead, and the count of reads is asserted:
 * a query builder is itself thenable, so an extra promise hop would silently
 * shift a spare answer and the case would pass for the wrong reason.
 *
 * The plan's Task 6 wording asked for the refusal "before any read of the
 * target". That is not implementable as written and was not implemented: D7
 * pins the dashboard term to the existing `assertBatchFits` call, which runs
 * after `resolveTarget` because it needs the template's measured-point count.
 * Hoisting it would change the 404/400 precedence of a bad target. What is
 * asserted instead is that **no write is attempted** — with a positive control:
 * the tenant handle's `transaction` throws a distinctive error, so a service
 * that reached it fails loudly rather than by an absence check.
 */

/** How many `fleetDb.select()` chains `instantiate` runs before the bound. */
const EXPECTED_READS = 4;

const ORG = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";

const JWT: JwtPayload = {
  sub: "44444444-4444-4444-8444-444444444444",
  email: "admin@bms.local",
  role: "admin",
} as JwtPayload;

/** Fifty keys, which is `MAX_FEATURED_POINTS`, in two views — 80 widgets laid. */
function fiftyKeys(prefix: string): string[] {
  return Array.from({ length: 50 }, (_unused, index) => `${prefix}_${index}`);
}

const CONTENT = {
  contentVersion: 1,
  dashboards: {
    view_a: { featured: fiftyKeys("a") },
    view_b: { featured: fiftyKeys("b") },
  },
};

/** The sentinel a reached write raises — the positive control, not an absence test. */
const WROTE = "the batch reached the write; the dashboard bound did not refuse it";

type Reads = { count: number };

/**
 * A drizzle-shaped query builder that answers from a queue.
 *
 * Every chaining method returns the same object and `then` shifts one answer.
 * Written out rather than proxied so a method this service starts calling fails
 * with a named `TypeError` instead of resolving to an empty array.
 */
function fakeFleetDb(answers: unknown[][], reads: Reads): never {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "groupBy"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (value: unknown) => void) => {
    reads.count += 1;
    resolve(answers.shift() ?? []);
  };
  return { select: () => builder, selectDistinct: () => builder } as never;
}

/** Everything `instantiate` reads on `fleetDb` before the bound, in order. */
function answersForTheBound(): unknown[][] {
  const template = {
    id: TEMPLATE_ID,
    organizationId: ORG,
    code: "F32-BOUND",
    version: 1,
    status: "published",
    domain: "water",
    content: CONTENT,
  };
  return [
    // fetchTemplate
    [{ template }],
    // resolveTarget, location branch
    [{ locationId: LOCATION_ID, locationName: "Bound Site", organizationId: ORG, active: true }],
    // the template's points — two measured, so the POINT bound stays clear and
    // the dashboard term is the only one that can refuse this batch.
    // The patterns are load-bearing: with `sourceDataKeyPattern: null` a
    // required measured point has no resolvable source key, and the in-bound
    // case below never reaches the write at all — it failed on the point
    // instead, and its "not refused by the bound" claim passed for the wrong
    // reason. Found on 2026-09-17 by adding the positive control.
    [
      {
        pointKey: "a_0",
        kind: "measured",
        required: true,
        unit: null,
        sourceDataKeyPattern: "{asset_code}_A0",
      },
      {
        pointKey: "a_1",
        kind: "measured",
        required: true,
        unit: null,
        sourceDataKeyPattern: "{asset_code}_A1",
      },
    ],
    // assertCatalogActive — both keys still live.
    [
      { code: "a_0", unit: null },
      { code: "a_1", unit: null },
    ],
  ];
}

function serviceUnderTest(reads: Reads): AssetTemplateInstantiationService {
  const access = {
    requireMasterDataUser: async () => ({ role: "admin" }),
    canManageOrganization: async () => true,
    canManageLocation: async () => true,
  } as unknown as AccessControlService;
  const tenantDb = {
    transaction: () => {
      throw new Error(WROTE);
    },
  } as never;
  return new AssetTemplateInstantiationService(
    fakeFleetDb(answersForTheBound(), reads),
    tenantDb,
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

function bodyFor(assetCount: number): InstantiateAssetsBody {
  return {
    target: { kind: "location", locationId: LOCATION_ID },
    assets: Array.from({ length: assetCount }, (_unused, index) => ({
      code: `F32-BOUND-${index}`,
      name: `Bound ${index}`,
    })),
  } as unknown as InstantiateAssetsBody;
}

/**
 * 200 assets x two 50-key featured views = 16,000 widget rows, refused by name.
 *
 * The message is matched on all three numbers, so a wiring that passed a
 * constant instead of `dashboardWidgetRowsFor(views)` would have to reproduce
 * the arithmetic to pass.
 */
export async function assertTheDashboardTermRefusesAnOverLargeBatch(): Promise<void> {
  const reads: Reads = { count: 0 };
  const service = serviceUnderTest(reads);
  let message = "";
  try {
    await service.instantiate(JWT, TEMPLATE_ID, bodyFor(200));
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message).toContain("16000 dashboard widgets");
  expect(message).toContain("200 assets");
  expect(message).toContain("80 widgets per asset");
  expect(message).toContain(String(MAX_DASHBOARD_WIDGET_ROWS));
}

/**
 * The same call attempted no write — the positive control on the claim above.
 *
 * `WROTE` is raised by both the tenant transaction and the dashboards service,
 * so either of the two ways to reach a write turns this into a named failure
 * rather than a silent pass.
 */
export async function assertTheOverLargeBatchWroteNothing(): Promise<void> {
  const reads: Reads = { count: 0 };
  const service = serviceUnderTest(reads);
  let message = "";
  try {
    await service.instantiate(JWT, TEMPLATE_ID, bodyFor(200));
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message).not.toContain(WROTE);
  // The read count is the desync guard: the builder is thenable, so an extra
  // promise hop would shift a spare answer and the refusal above could come
  // from a read that returned `[]` rather than from the bound.
  expect(reads.count).toBe(EXPECTED_READS);
}

/**
 * A batch inside the bound is **not** refused by it.
 *
 * Without this the case above passes on a service that refuses everything. 99
 * assets x 80 widgets is 7,920 rows — one asset under the ceiling — so the call
 * proceeds and fails at the write instead, which is the fake's sentinel.
 */
export async function assertABatchInsideTheBoundIsNotRefused(): Promise<void> {
  const reads: Reads = { count: 0 };
  const service = serviceUnderTest(reads);
  let message = "";
  try {
    await service.instantiate(JWT, TEMPLATE_ID, bodyFor(99));
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message).not.toContain("dashboard widgets");
  // The positive half, and without it the case passes on a service that failed
  // for any other reason before the write — including one that refused the
  // batch with a different sentence. `WROTE` is the fake's sentinel: reaching
  // it is the proof that the bound let this batch through.
  expect(message).toContain(WROTE);
}
