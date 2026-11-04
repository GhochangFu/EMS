import { BadRequestException, ForbiddenException } from "@nestjs/common";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import type { TreeFixture } from "../auth/location-tree.integration.spec";
import { assertTrendPointsSchedulable } from "./trend-points-schedule-check";

/**
 * `F4.303` U11 (ADR 0108 Amendment 6 item 6, "Who may schedule a `trend_points` report";
 * plan C17) — what the database answers the schedule's point check, over the real
 * `AccessControlService` on the `F2.10` tree fixture (`buildTreeFixture`):
 *
 *     F210-A:  R ── A ── A1 ── A1a        F210-B:  X ── X1
 *               └── B ── B1
 *
 * One asset per node; `grantee` (location_admin) holds A. The sibling `.test.ts` adds the
 * registrations: `kw` active on A, A1, B and X, `pf` retired on A. Every case names the pairs by
 * the fixture's ids, and every refusal is checked for its class, its exact sentence and the
 * absence of any id. Vitest entry point (and the transaction the fixture lives in): the sibling
 * `.test.ts`.
 */

export type CheckFixture = {
  readonly fx: TreeFixture;
  readonly admin: JwtPayload;
  readonly fleetDb: BmsDb;
  readonly accessControl: AccessControlService;
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function fail(message: string): never {
  throw new Error(message);
}

type Pair = { assetId: string; pointKey: string };

function deps(c: CheckFixture) {
  return { fleetDb: c.fleetDb, accessControl: c.accessControl };
}

async function refusal(promise: Promise<unknown>, what: string): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  return fail(`${what}: resolved, expected a refusal`);
}

function expectRefusal(err: Error, kind: "400" | "403", sentence: string, what: string): void {
  const klass = kind === "400" ? BadRequestException : ForbiddenException;
  if (!(err instanceof klass)) fail(`${what}: expected a ${kind}, got ${err.name}: ${err.message}`);
  if (err.message !== sentence) fail(`${what}: expected "${sentence}", got "${err.message}"`);
  if (UUID.test(err.message)) fail(`${what}: the sentence must carry no id, got "${err.message}"`);
}

/** K1: a pair whose asset is another organization's (X, in F210-B) is a 400 that names its index only. */
export async function aPairInAnotherOrganizationIs400(c: CheckFixture): Promise<void> {
  const points: Pair[] = [{ assetId: c.fx.assets.X, pointKey: "kw" }];
  const err = await refusal(assertTrendPointsSchedulable(deps(c), c.admin, c.fx.orgA, [], points), "X under F210-A");
  expectRefusal(err, "400", "point 0 names no asset of this organization", "X under F210-A");
}

/** K2: B is outside the subtree of A, so the second pair is a 400 for its index. */
export async function aPairOutsideTheLocationsIs400(c: CheckFixture): Promise<void> {
  const points: Pair[] = [
    { assetId: c.fx.assets.A1, pointKey: "kw" },
    { assetId: c.fx.assets.B, pointKey: "kw" },
  ];
  const err = await refusal(assertTrendPointsSchedulable(deps(c), c.admin, c.fx.orgA, [c.fx.nodes.A], points), "B under [A]");
  expectRefusal(err, "400", "point 1 is not at a location of this schedule", "B under [A]");
}

/** K3: the same two pairs with `locationIds: []` (the whole organization) pass — K2's adjacent positive. */
export async function theSamePairsPassForTheWholeOrganization(c: CheckFixture): Promise<void> {
  const points: Pair[] = [
    { assetId: c.fx.assets.A1, pointKey: "kw" },
    { assetId: c.fx.assets.B, pointKey: "kw" },
  ];
  await assertTrendPointsSchedulable(deps(c), c.admin, c.fx.orgA, [], points);
}

/** K4: the grantee holds A, so B's asset is unreadable to it — a 403 for the index, no id. */
export async function aPairTheAuthorCannotReadIs403(c: CheckFixture): Promise<void> {
  const points: Pair[] = [{ assetId: c.fx.assets.B, pointKey: "kw" }];
  const err = await refusal(assertTrendPointsSchedulable(deps(c), c.fx.grantee, c.fx.orgA, [], points), "grantee on B");
  expectRefusal(err, "403", "point 0 is outside your access scope", "grantee on B");
}

/** K4's adjacent positive: the grantee's own A1 under `[A]` passes. */
export async function aPairTheAuthorReadsPasses(c: CheckFixture): Promise<void> {
  const points: Pair[] = [{ assetId: c.fx.assets.A1, pointKey: "kw" }];
  await assertTrendPointsSchedulable(deps(c), c.fx.grantee, c.fx.orgA, [c.fx.nodes.A], points);
}

/** K5: A's `pf` is a retired registration, so the second pair is a 400 for its index. */
export async function aRetiredRegistrationIs400(c: CheckFixture): Promise<void> {
  const points: Pair[] = [
    { assetId: c.fx.assets.A1, pointKey: "kw" },
    { assetId: c.fx.assets.A, pointKey: "pf" },
  ];
  const err = await refusal(assertTrendPointsSchedulable(deps(c), c.admin, c.fx.orgA, [], points), "A · pf retired");
  expectRefusal(err, "400", "point 1 is not registered on its asset", "A · pf retired");
}

/** K6: the same pair twice is a 400 naming the repeat's index. */
export async function aDuplicatePairIs400(c: CheckFixture): Promise<void> {
  const points: Pair[] = [
    { assetId: c.fx.assets.A1, pointKey: "kw" },
    { assetId: c.fx.assets.A1, pointKey: "kw" },
  ];
  const err = await refusal(assertTrendPointsSchedulable(deps(c), c.admin, c.fx.orgA, [], points), "A1 · kw twice");
  expectRefusal(err, "400", "point 1 repeats an earlier point", "A1 · kw twice");
}

/**
 * K8: the positive case reads one fleet select (the assets and their registrations), one subtree
 * walk for the named locations and one `readableAssetIds` — counted on this call's own recorders.
 */
export async function thePositiveCaseReadsOnceEach(c: CheckFixture): Promise<void> {
  const counts = { select: 0, execute: 0, readableAssetIds: 0 };
  const fleetDb = new Proxy(c.fleetDb, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if ((prop === "select" || prop === "execute") && typeof value === "function") {
        return (...args: unknown[]) => {
          counts[prop] += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
  const accessControl = {
    readableAssetIds: async (jwt: JwtPayload) => {
      counts.readableAssetIds += 1;
      return c.accessControl.readableAssetIds(jwt);
    },
  } as unknown as AccessControlService;
  const points: Pair[] = [
    { assetId: c.fx.assets.A1, pointKey: "kw" },
    { assetId: c.fx.assets.A, pointKey: "kw" },
  ];
  await assertTrendPointsSchedulable({ fleetDb, accessControl }, c.fx.grantee, c.fx.orgA, [c.fx.nodes.A], points);
  const expected = { select: 1, execute: 1, readableAssetIds: 1 };
  if (JSON.stringify(counts) !== JSON.stringify(expected)) {
    fail(`expected ${JSON.stringify(expected)} for one call, got ${JSON.stringify(counts)}`);
  }
}
