import { ForbiddenException, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";

import type { JwtPayload } from "@bms/shared";

import { EvaluateThrottle } from "./evaluate-throttle";
import { RulesController } from "./rules.controller";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function rejects(
  run: () => Promise<unknown>,
  is: (err: unknown) => boolean,
  why: string,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    assert(is(err), `${why}: threw ${String(err)}`);
    return;
  }
  throw new Error(`${why}: it did not throw`);
}

type Ctor = ConstructorParameters<typeof RulesController>;

const isTooManyRequests = (err: unknown): boolean =>
  err instanceof HttpException && err.getStatus() === HttpStatus.TOO_MANY_REQUESTS;

const ADMIN_USER = { sub: "u1", email: "admin@bms.local" } as unknown as JwtPayload;
/** A second human in the SAME organization. The bucket is per organization, not
 * per user, so this one is refused by the first one's press. */
const COLLEAGUE = { sub: "u2", email: "wc-hvac-admin@bms.local" } as unknown as JwtPayload;

/** A distinct organization per block, so no block inherits another's stamp. */
let organizationsIssued = 0;
function freshOrganizationId(): string {
  organizationsIssued += 1;
  return `aaaaaaaa-0000-0000-0000-${String(organizationsIssued).padStart(12, "0")}`;
}

type Harness = {
  controller: RulesController;
  res: Response;
  headers: Array<[string, string]>;
  counts: {
    sweeps: number;
    assetScopeReads: number;
    throttleChecks: number;
    writableOrganizationReads: number;
  };
  checkedKeys: string[][];
  organizationId: string;
};

/**
 * The controller with its four collaborators faked, counting every call.
 *
 * Built here rather than shared with `rules-notifications.spec.ts`: a fixture
 * built once for another purpose hides the mutation class it was not built for,
 * and this one has to count calls that fixture never made.
 */
function controllerWith(options: { writeAllowed?: boolean } = {}): Harness {
  const organizationId = freshOrganizationId();
  const counts = {
    sweeps: 0,
    assetScopeReads: 0,
    throttleChecks: 0,
    writableOrganizationReads: 0,
  };
  const headers: Array<[string, string]> = [];
  const checkedKeys: string[][] = [];

  const rules = {
    evaluateEnabledRules: () => {
      counts.sweeps += 1;
      return Promise.resolve({ items: [] });
    },
  } as unknown as Ctor[0];

  const accessControl = {
    assertOperationsWriteRole: () =>
      options.writeAllowed === false
        ? Promise.reject(new ForbiddenException("configuration write denied"))
        : Promise.resolve(),
    readableOrganizationIds: () => Promise.resolve([organizationId]),
    // The trap. `writableOrganizationIds` calls `assertMasterDataRole`, which
    // excludes `asset_group_admin` — a role `WRITE_MATRIX` gives
    // `configuration: true` — so reaching for it would answer 403 to someone
    // allowed to press this button. This fake **succeeds** rather than
    // throwing: a throwing fake would redden the first block instead of the
    // assertion below that owns the claim, and the call count is the gate.
    writableOrganizationIds: () => {
      counts.writableOrganizationReads += 1;
      return Promise.resolve([organizationId]);
    },
    readableAssetIds: () => {
      counts.assetScopeReads += 1;
      return Promise.resolve(["asset-in-scope"]);
    },
  } as unknown as Ctor[1];

  const channels = {} as unknown as Ctor[2];

  // A real throttle, wrapped to record the keys it is handed. Wrapped rather
  // than stubbed: the decision the controller acts on must be the real one.
  const throttle = new EvaluateThrottle();
  const check = throttle.check.bind(throttle);
  throttle.check = (keys: string[], now: number) => {
    counts.throttleChecks += 1;
    checkedKeys.push(keys);
    return check(keys, now);
  };

  const res = {
    setHeader: (name: string, value: string) => {
      headers.push([name, String(value)]);
    },
  } as unknown as Response;

  return {
    controller: new RulesController(rules, accessControl, channels, throttle),
    res,
    headers,
    counts,
    checkedKeys,
    organizationId,
  };
}

/**
 * `F3.47` — the throttle at the route, and where it sits in the handler.
 *
 * The ordering is the point, not decoration. A refused press costs
 * `resolveDbUser` twice and one grant walk; it must not cost the caller's full
 * asset-scope resolution, the 289 inserts, the 289 updates, or the cross-org
 * alarm raises and notification dispatches inside the sweep. And it must not
 * displace the 403: a viewer gets *Forbidden*, never *Too Many Requests*, which
 * is why this is an injectable the handler calls rather than a guard.
 *
 * What these cannot prove, because there is no `@nestjs/testing` in
 * `apps/api/src` and none is being introduced: that the provider is a
 * **singleton**. A request-scoped provider would hand every request a fresh
 * `Map`, throttle nothing, and pass every assertion below. That claim belongs
 * to the HTTP layer.
 */
export async function runEvaluateThrottleRouteTests(): Promise<void> {
  // --- 13. the second press inside the window runs no sweep ----------------
  //
  // The absence ("still 1") is paired on the same fixture with the positive
  // that the sweep ran at all. An absence alone passes when the route is broken
  // outright.
  {
    const { controller, res, counts } = controllerWith();

    await controller.evaluateEnabledRules(ADMIN_USER, res);
    assert(counts.sweeps === 1, `the first press sweeps, it ran ${counts.sweeps} times`);

    await rejects(
      () => controller.evaluateEnabledRules(ADMIN_USER, res),
      isTooManyRequests,
      "a second press inside the window",
    );
    assert(
      counts.sweeps === 1,
      `the refused press swept anyway — the throttle is wired in and its answer ignored (${counts.sweeps} sweeps)`,
    );
  }

  // --- 14. the refusal says how long to wait -------------------------------
  {
    const { controller, res, headers } = controllerWith();

    await controller.evaluateEnabledRules(ADMIN_USER, res);
    await rejects(
      () => controller.evaluateEnabledRules(ADMIN_USER, res),
      isTooManyRequests,
      "a second press inside the window",
    );

    const retryAfter = headers.filter(([name]) => name.toLowerCase() === "retry-after");
    assert(retryAfter.length === 1, `the refusal sets Retry-After once, it set it ${retryAfter.length} times`);
    const [, value] = retryAfter[0];
    assert(
      /^[0-9]+$/.test(value),
      `Retry-After is whole seconds — RFC 9110 delay-seconds — got ${JSON.stringify(value)}`,
    );
    assert(
      Number(value) >= 1 && Number(value) <= 30,
      `Retry-After is seconds, not milliseconds, got ${value}`,
    );
  }

  // --- 15. the role check still comes first --------------------------------
  //
  // A guard would run before the handler body and answer 429 where 403 is
  // correct, and would let an unprivileged caller observe another
  // organization's throttle state. Paired with the allowed role, or "checked 0
  // times" passes when the throttle is not wired in at all.
  {
    const refused = controllerWith({ writeAllowed: false });
    await rejects(
      () => refused.controller.evaluateEnabledRules(ADMIN_USER, refused.res),
      (err) => err instanceof ForbiddenException,
      "a role that may not write configuration",
    );
    assert(
      refused.counts.throttleChecks === 0,
      "a refused role reached the throttle — 403 must come first, and a 429 would leak another organization's state",
    );
    assert(refused.counts.sweeps === 0, "a refused role swept");

    const allowed = controllerWith();
    await allowed.controller.evaluateEnabledRules(ADMIN_USER, allowed.res);
    assert(
      allowed.counts.throttleChecks === 1,
      `an allowed role is checked exactly once, it was checked ${allowed.counts.throttleChecks} times`,
    );
  }

  // --- 16. a refused press does not resolve the caller's asset scope -------
  //
  // D1's cost ordering, asserted rather than commented.
  {
    const { controller, res, counts } = controllerWith();

    await controller.evaluateEnabledRules(ADMIN_USER, res);
    assert(
      counts.assetScopeReads === 1,
      `an allowed press resolves the asset scope once, it did ${counts.assetScopeReads} times`,
    );

    await rejects(
      () => controller.evaluateEnabledRules(ADMIN_USER, res),
      isTooManyRequests,
      "a second press inside the window",
    );
    assert(
      counts.assetScopeReads === 1,
      `the refused press resolved the caller's asset scope anyway — the throttle sits after the scope read (${counts.assetScopeReads} reads)`,
    );
  }

  // --- 17. the key is the organization, and the safe helper reads it -------
  {
    const { controller, res, counts, checkedKeys, organizationId } = controllerWith();

    await controller.evaluateEnabledRules(ADMIN_USER, res);
    assert(
      checkedKeys.length === 1 &&
        checkedKeys[0].length === 1 &&
        checkedKeys[0][0] === organizationId,
      `the throttle keys on what readableOrganizationIds returned, got ${JSON.stringify(checkedKeys)}`,
    );
    assert(
      counts.writableOrganizationReads === 0,
      "the handler called writableOrganizationIds, which 403s an asset_group_admin the WRITE_MATRIX allows to press this button",
    );

    // The pairing that makes it per-organization rather than per-user: a
    // different human in the same organization is refused by the first one's
    // press.
    await rejects(
      () => controller.evaluateEnabledRules(COLLEAGUE, res),
      isTooManyRequests,
      "a colleague in the same organization pressing inside the window",
    );
    assert(
      counts.sweeps === 1,
      `keying on the user, not the organization, doubles the real rate (${counts.sweeps} sweeps)`,
    );
  }
}
