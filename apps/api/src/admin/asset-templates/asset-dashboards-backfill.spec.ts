import { expect } from "vitest";

import type { InstantiatedDashboardDto, JwtPayload } from "@bms/shared";
import { ForbiddenException } from "@nestjs/common";

import type { AccessControlService } from "../../auth/access-control.service";
import type { MasterDataAuditService } from "../master-data-audit.service";
import { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import type { DashboardTargetAsset } from "./asset-dashboards-instantiate.service";
import type { AssetTemplatesAdminService } from "./asset-templates.service";

/**
 * `F3.2` / ADR 0067 Q7 — the backfill is **chunked and resumable**, and it is
 * gated by `assertOperationsWriteRole` as well as by `assertCanAuthor`.
 *
 * Both claims are proved without a database, and that is deliberate on each:
 *
 * - The chunk arithmetic is `MAX_DASHBOARD_WIDGET_ROWS / widgets per asset`.
 *   Reaching the real ceiling needs 8,000 widget rows, so a database case can
 *   only ever exercise the loop with the cap lowered anyway — and the mutation
 *   that matters here ("the map is reassigned per chunk, so the DTO reports the
 *   last chunk only") is visible on the returned value alone.
 * - The write-role gate runs before any read of the estate, so a connection
 *   would prove nothing extra and would make an owed guard skip on a machine
 *   with no `DATABASE_URL`.
 *
 * `instantiateForAssets` is overridden on the instance rather than faked
 * through drizzle: what is under test is the loop that calls it, the merge of
 * its per-chunk results and the audit row per chunk — not the insert path,
 * which `asset-templates.instantiate.dashboards.integration.spec.ts` owns
 * against real rows.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";

const JWT: JwtPayload = {
  sub: "44444444-4444-4444-8444-444444444444",
  email: "admin@bms.local",
  role: "admin",
} as JwtPayload;

/** The lowered cap the cases drive the loop with — see the docblock. */
const CAP = 20;

/** Ten featured keys per view: ten widget rows per asset, so `CAP` fits two. */
const CONTENT = {
  contentVersion: 1,
  dashboards: {
    overview: {
      featured: Array.from({ length: 10 }, (_unused, index) => `k${index}`),
    },
  },
};

/** The sentinel the write-role gate raises, so the case names the guard that fired. */
const ROLE_REFUSED = "operations write role refused this caller";

type AuditRow = Record<string, unknown>;

type Harness = {
  service: AssetDashboardsInstantiateService;
  /** One entry per chunk transaction that ran, in order. */
  audits: AuditRow[];
  /** The asset codes each call to `instantiateForAssets` received. */
  chunks: string[][];
  /** Every `(jwt, writeClass)` pair the write-role gate was asked about. */
  writeRoleCalls: string[];
};

/** A drizzle-shaped read builder answering from a queue, as the bound spec's. */
function fakeFleetDb(answers: unknown[][]): never {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "leftJoin", "where", "limit", "orderBy", "groupBy"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (value: unknown) => void) => {
    resolve(answers.shift() ?? []);
  };
  return { select: () => builder, selectDistinct: () => builder } as never;
}

/** `withTenant` opens a transaction and sets the GUC on it; both are answered here. */
function fakeTenantDb(): never {
  return {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({ execute: async () => undefined }),
  } as never;
}

function targetsOf(count: number): DashboardTargetAsset[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `asset-${index}`,
    code: `F32-CHUNK-${index}`,
    name: `Chunked ${index}`,
  }));
}

/**
 * The service under test with its reads answered and its writer stubbed.
 *
 * `assetsPerCode` decides what the stub claims to have written for each code,
 * so a case can make one asset write nothing without faking a database.
 */
function harness(options: {
  targets: DashboardTargetAsset[];
  viewsPerAsset?: (code: string) => number;
  writeRoleThrows?: boolean;
  failOnCode?: string;
}): Harness {
  const audits: AuditRow[] = [];
  const chunks: string[][] = [];
  const writeRoleCalls: string[] = [];

  const templateRow = {
    id: TEMPLATE_ID,
    organizationId: ORG,
    code: "F32-CHUNK",
    version: 1,
    status: "published",
    content: CONTENT,
  };

  const service = new AssetDashboardsInstantiateService(
    fakeFleetDb([
      // fetchTemplate
      [templateRow],
      // versionIds
      [{ id: TEMPLATE_ID }],
      // pinnedAssets
      options.targets,
      // assetsAlreadyStamped — nothing is stamped, so every target is created.
      [],
    ]),
    fakeTenantDb(),
    { assertCanAuthor: async () => undefined } as unknown as AssetTemplatesAdminService,
    {
      write: async (entry: { payload?: AuditRow }) => {
        audits.push(entry.payload ?? {});
      },
    } as unknown as MasterDataAuditService,
    {
      assertOperationsWriteRole: async (_jwt: JwtPayload, writeClass: string) => {
        writeRoleCalls.push(writeClass);
        if (options.writeRoleThrows === true) {
          throw new ForbiddenException(ROLE_REFUSED);
        }
      },
    } as unknown as AccessControlService,
  );

  // The write path, replaced: one report per view per asset, or none when the
  // case says this asset writes nothing.
  Object.defineProperty(service, "instantiateForAssets", {
    value: async (
      _tx: unknown,
      _template: unknown,
      _views: unknown,
      batch: readonly DashboardTargetAsset[],
    ) => {
      chunks.push(batch.map((target) => target.code));
      const byCode = new Map<string, InstantiatedDashboardDto[]>();
      for (const target of batch) {
        if (options.failOnCode === target.code) {
          throw new Error(`collision on ${target.code}`);
        }
        const views = options.viewsPerAsset?.(target.code) ?? 1;
        byCode.set(
          target.code,
          Array.from({ length: views }, () => ({
            slug: `${target.code.toLowerCase()}-overview`,
            view: "overview",
            widgetCount: 10,
            boundPoints: 10,
            omittedFeatured: 0,
            resolutions: [],
          })),
        );
      }
      return byCode;
    },
  });

  return { service, audits, chunks, writeRoleCalls };
}

/**
 * B1 — five assets at ten widget rows each, under a cap of twenty, run as
 * three chunks of 2, 2 and 1 **in code order**.
 */
export async function assertTheBackfillSplitsIntoChunksThatFitTheCap(): Promise<void> {
  const fixture = harness({ targets: targetsOf(5) });
  await fixture.service.backfill(JWT, TEMPLATE_ID, CAP);

  expect(fixture.chunks.map((chunk) => chunk.length)).toEqual([2, 2, 1]);
  expect(fixture.chunks.flat()).toEqual(targetsOf(5).map((target) => target.code));
}

/** B1b — one audit row per chunk, each naming its index and the chunk count. */
export async function assertEveryChunkLeavesItsOwnAuditRow(): Promise<void> {
  const fixture = harness({ targets: targetsOf(5) });
  await fixture.service.backfill(JWT, TEMPLATE_ID, CAP);

  expect(fixture.audits.map((payload) => payload.chunkIndex)).toEqual([0, 1, 2]);
  expect(fixture.audits.map((payload) => payload.chunkCount)).toEqual([3, 3, 3]);
  expect(fixture.audits.map((payload) => payload.createdCount)).toEqual([2, 2, 1]);
}

/**
 * B1c — the DTO is whole.
 *
 * The mutation this case exists for is a per-chunk map that replaces the
 * previous chunk's results instead of merging them: the totals would still look
 * plausible and a **first**-chunk asset would report no dashboards, so the
 * assertion is on the first asset's array rather than on the count alone.
 */
export async function assertTheResultCarriesEveryChunksDashboards(): Promise<void> {
  const fixture = harness({ targets: targetsOf(5) });
  const result = await fixture.service.backfill(JWT, TEMPLATE_ID, CAP);

  expect(result.assets.map((entry) => entry.code)).toEqual(
    targetsOf(5).map((target) => target.code),
  );
  expect(result.assets[0]?.dashboards.length).toBe(1);
  expect(result.assets[0]?.outcome).toBe("created");
  expect(result.assets.every((entry) => entry.dashboards.length === 1)).toBe(true);
  expect(result.createdCount).toBe(5);
  expect(result.skippedCount).toBe(0);
}

/**
 * B2 — an asset for which nothing was written is **not** reported `created`,
 * and does not raise `createdCount` (code review #2).
 */
export async function assertAnAssetWithNoViewsWrittenIsNotReportedCreated(): Promise<void> {
  const fixture = harness({
    targets: targetsOf(2),
    viewsPerAsset: (code) => (code.endsWith("-0") ? 0 : 1),
  });
  const result = await fixture.service.backfill(JWT, TEMPLATE_ID, CAP);

  expect(result.assets[0]?.dashboards).toEqual([]);
  expect(result.assets[0]?.outcome).not.toBe("created");
  expect(result.assets[1]?.outcome).toBe("created");
  expect(result.createdCount).toBe(1);
  expect(fixture.audits[0]?.createdCount).toBe(1);
}

/**
 * B3 — a failing chunk stops the call, and the error says how many assets were
 * created before it. The earlier chunk's audit row survives, which is what
 * makes "re-run it" a true instruction.
 */
export async function assertAFailingChunkReportsWhatEarlierChunksCreated(): Promise<void> {
  const fixture = harness({ targets: targetsOf(5), failOnCode: "F32-CHUNK-2" });
  let message = "";
  try {
    await fixture.service.backfill(JWT, TEMPLATE_ID, CAP);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }

  expect(message).toContain("collision on F32-CHUNK-2");
  expect(message).toContain("2 of 5");
  // The first chunk committed and left its record; the third never ran.
  expect(fixture.audits.length).toBe(1);
  expect(fixture.chunks.map((chunk) => chunk.length)).toEqual([2, 2]);
}

/**
 * B4 — `assertOperationsWriteRole(jwt, "configuration")` runs (AGENTS.md §4.7).
 *
 * The refusal is asserted by the **sentinel this fake raises**, not merely by a
 * `ForbiddenException`: `assertCanAuthor` throws the same class one line above,
 * so a case that only named the class would pass with the new gate deleted.
 */
export async function assertTheBackfillAsksForTheConfigurationWriteRole(): Promise<void> {
  const fixture = harness({ targets: targetsOf(2), writeRoleThrows: true });
  let message = "";
  try {
    await fixture.service.backfill(JWT, TEMPLATE_ID, CAP);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }

  expect(message).toContain(ROLE_REFUSED);
  expect(fixture.writeRoleCalls).toEqual(["configuration"]);
  // Refused before any chunk opened a transaction.
  expect(fixture.chunks.length).toBe(0);
}
