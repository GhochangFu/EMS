import { ForbiddenException, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";

import type { JwtPayload } from "@bms/shared";

import { EvaluateThrottle, GLOBAL_ADMIN_THROTTLE_KEY } from "./evaluate-throttle";
import { RulesController } from "./rules.controller";

/**
 * `F3.47` — the throttle at the route, and where it sits in the handler.
 *
 * The ordering is the point, not decoration. A refused press costs
 * `resolveDbUser` twice and **at most one** grant walk — a global admin walks
 * zero, because `readableOrganizationIds` returns from its `role === "admin"`
 * branch before the loop over read scope sources. It must not cost the caller's
 * full asset-scope resolution, the 289 inserts, the 289 updates, or the
 * cross-org alarm raises and notification dispatches inside the sweep. And it
 * must not displace the 403: a viewer gets *Forbidden*, never *Too Many
 * Requests*, which is why this is an injectable the handler calls rather than a
 * guard.
 *
 * **One exported function per claim, and one `it()` per function.** These ran
 * as five numbered blocks inside a single `it()`; `assert` throws, so the first
 * failing block aborted every later one and a mutation to the header could not
 * be told apart from a mutation to the ordering.
 *
 * What these cannot prove, because there is no `@nestjs/testing` in
 * `apps/api/src` and none is being introduced: that the provider is a
 * **singleton**. A request-scoped provider would hand every request a fresh
 * `Map`, throttle nothing, and pass every assertion below. That claim belongs
 * to the HTTP layer.
 */

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

/** `rejects`, but handing back the refusal so its **body** can be read. The
 * message is not decoration: `Retry-After` is set and deliberately not exposed
 * across the origin, so the sentence is the only place an operator learns the
 * wait. */
async function refusalFrom(run: () => Promise<unknown>, why: string): Promise<HttpException> {
  try {
    await run();
  } catch (err) {
    assert(isTooManyRequests(err), `${why}: threw ${String(err)}`);
    return err as HttpException;
  }
  throw new Error(`${why}: it did not throw`);
}

/** The digits the refusal names, as they appear. A message that names no
 * number, or two, is a message an operator cannot act on. */
function secondsNamedIn(message: string): string[] {
  return message.match(/[0-9]+/g) ?? [];
}

type Ctor = ConstructorParameters<typeof RulesController>;

const isTooManyRequests = (err: unknown): boolean =>
  err instanceof HttpException && err.getStatus() === HttpStatus.TOO_MANY_REQUESTS;

/** The caller every block presses with. It carries a `name` because blocks 19
 * and 20 need one: `user.name` is the wrong-field mutation that matters at the
 * one call site, and a fixture with no display name would redden on
 * `"user:undefined"` — a mismatch that says nothing about which field arrived. */
const ADMIN_USER = {
  sub: "u1",
  email: "admin@bms.local",
  name: "Automation Admin",
} as unknown as JwtPayload;
/** A second human in the SAME organization. The bucket is per organization, not
 * per user, so this one is refused by the first one's press. */
const COLLEAGUE = { sub: "u2", email: "wc-hvac-admin@bms.local" } as unknown as JwtPayload;
/**
 * A third human, sharing `ADMIN_USER`'s **display name** on purpose:
 * `bms.users` puts no unique constraint on `display_name`, so two provisioned
 * accounts may carry the same one.
 *
 * Blocks 19 and 20 press with this user in opposite directions — its own bucket
 * when neither caller has an organization, the one shared bucket when both are
 * unrestricted admins. That is the sentinel split, read from the route rather
 * than from the helper.
 */
const DISPLAY_NAME_TWIN = {
  sub: "u3",
  email: "second-grantless@bms.local",
  name: "Automation Admin",
} as unknown as JwtPayload;

/** A distinct organization per harness. Not what keeps one block from
 * reddening another — every `controllerWith` builds its own `EvaluateThrottle`,
 * so no stamp crosses a harness, let alone a block. It is here so that
 * `keysOnTheOrganizationTheSafeHelperReturned` compares the keys against an id
 * that could only have come from this harness's `readableOrganizationIds`. */
let organizationsIssued = 0;
function freshOrganizationId(): string {
  organizationsIssued += 1;
  return `aaaaaaaa-0000-0000-0000-${String(organizationsIssued).padStart(12, "0")}`;
}

type Harness = {
  controller: RulesController;
  res: Response;
  /** The real throttle the controller holds, exposed so a block can move the
   * window rather than the clock — the controller reads `Date.now()` itself. */
  throttle: EvaluateThrottle;
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
 *
 * `readableOrganizations` reaches the two branches where `throttleKeysFor`
 * reads its second argument. It was `writeAllowed` alone, so every block ran
 * the non-empty branch and nothing here observed the identity the handler
 * passes — see block 19.
 */
function controllerWith(
  options: { writeAllowed?: boolean; readableOrganizations?: string[] | null } = {},
): Harness {
  const organizationId = freshOrganizationId();
  // `in`, not `options.readableOrganizations ?? [organizationId]`: `null` IS the
  // global-admin case, and `??` would fold it back into the default. Block 20
  // would then assert `fleet:admin` while silently exercising the organization
  // path, which is the failure mode this whole option exists to close.
  const readableOrganizations =
    "readableOrganizations" in options
      ? (options.readableOrganizations ?? null)
      : [organizationId];
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
    readableOrganizationIds: () => Promise.resolve(readableOrganizations),
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
    throttle,
    headers,
    counts,
    checkedKeys,
    organizationId,
  };
}

/**
 * 13. The second press inside the window runs no sweep.
 *
 * The absence ("still 1") is paired on the same fixture with the positive that
 * the sweep ran at all. An absence alone passes when the route is broken
 * outright.
 */
export async function runsNoSweepForARefusedPress(): Promise<void> {
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

/**
 * 14. The refusal says how long to wait, in BOTH channels.
 *
 * The header and the body are gated against each other, because the header
 * alone gates nothing an operator sees: ruling 4 sets `Retry-After` and
 * deliberately keeps it OUT of `main.ts`'s `exposedHeaders`, and the SPA is a
 * different origin — so it reads `null` from the header and takes the wait from
 * the sentence. Dropping `${retryAfterSeconds}` from that sentence left every
 * assertion in this file green.
 */
export async function saysTheSameWaitInTheHeaderAndTheBody(): Promise<void> {
  const { controller, res, headers } = controllerWith();

  await controller.evaluateEnabledRules(ADMIN_USER, res);
  const refused = await refusalFrom(
    () => controller.evaluateEnabledRules(ADMIN_USER, res),
    "a second press inside the window",
  );

  const retryAfter = headers.filter(([name]) => name.toLowerCase() === "retry-after");
  assert(
    retryAfter.length === 1,
    `the refusal sets Retry-After once, it set it ${retryAfter.length} times`,
  );
  const [, value] = retryAfter[0];
  assert(
    /^[0-9]+$/.test(value),
    `Retry-After is whole seconds — RFC 9110 delay-seconds — got ${JSON.stringify(value)}`,
  );
  assert(
    Number(value) >= 1 && Number(value) <= 30,
    `Retry-After is seconds, not milliseconds, got ${value}`,
  );

  const named = secondsNamedIn(refused.message);
  assert(
    named.length === 1,
    `the refusal must name the wait exactly once, and it is the only channel the SPA can read — got ${JSON.stringify(refused.message)}`,
  );
  assert(
    named[0] === value,
    `the body says ${named[0]} and the header says ${value}: the operator waits one number and the client honours the other`,
  );
}

/**
 * 18. The last second of the window is singular.
 *
 * `retryAfterSeconds === 1` was produced by nothing here, so `"second"` was
 * unreached and an always-plural message would have read "1 seconds" in
 * production with every assertion green.
 *
 * The controller reads `Date.now()` itself — deliberately, D5 puts the clock at
 * the caller — so the window is moved instead: stamping the real throttle
 * 29 001 ms in the past leaves 999 ms of it, and any delay shorter than that
 * yields exactly 1. A longer one fails as "it did not throw", never as a wrong
 * number.
 */
export async function usesTheSingularForAWaitOfOneSecond(): Promise<void> {
  const { controller, res, headers, throttle, organizationId } = controllerWith();

  throttle.check([organizationId], Date.now() - 29_001);

  const refused = await refusalFrom(
    () => controller.evaluateEnabledRules(ADMIN_USER, res),
    "a press in the last second of the window",
  );

  const [, value] = headers.filter(([name]) => name.toLowerCase() === "retry-after")[0];
  assert(value === "1", `the last second of the window asks for 1, got ${value}`);
  assert(
    refused.message.includes("1 second."),
    `one second is singular, got ${JSON.stringify(refused.message)}`,
  );
  assert(
    !refused.message.includes("seconds"),
    `"1 seconds" — the plural branch ran for a wait of one, got ${JSON.stringify(refused.message)}`,
  );
}

/**
 * 15. The role check still comes first.
 *
 * A guard would run before the handler body and answer 429 where 403 is
 * correct, and would let an unprivileged caller observe another organization's
 * throttle state. Paired with the allowed role, or "checked 0 times" passes
 * when the throttle is not wired in at all.
 */
export async function answers403BeforeItEverReachesTheThrottle(): Promise<void> {
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

/** 16. A refused press does not resolve the caller's asset scope — D1's cost
 * ordering, asserted rather than commented. */
export async function doesNotResolveTheAssetScopeForARefusedPress(): Promise<void> {
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

/** 17. The key is the organization the safe helper returned, and a colleague in
 * that organization is bound by it. */
export async function keysOnTheOrganizationTheSafeHelperReturned(): Promise<void> {
  const { controller, res, counts, checkedKeys, organizationId } = controllerWith();

  await controller.evaluateEnabledRules(ADMIN_USER, res);
  assert(
    checkedKeys.length === 1 && checkedKeys[0].length === 1 && checkedKeys[0][0] === organizationId,
    `the throttle keys on what readableOrganizationIds returned, got ${JSON.stringify(checkedKeys)}`,
  );
  assert(
    counts.writableOrganizationReads === 0,
    "the handler called writableOrganizationIds, which 403s an asset_group_admin the WRITE_MATRIX allows to press this button",
  );

  // The pairing that makes it per-organization rather than per-user: a
  // different human in the same organization is refused by the first one's
  // press. A caller WITH grants is keyed by organization even after the
  // grantless split — only a caller with no organization at all is keyed by
  // subject, and that caller has no organization to bypass. Blocks 19 and 20
  // own the two branches where that subject is read.
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

/**
 * 19. A grantless caller is keyed on the subject the controller passed.
 *
 * **The only block that observes the controller's second argument to
 * `throttleKeysFor`.** Every other block here runs the non-empty branch, where
 * that argument is discarded, and `evaluate-throttle.spec.ts` calls the helper
 * with an id of its own — so replacing `user.sub` at the one call site with any
 * other `string` typechecked and left the whole suite green. Found in review,
 * by both reviewers independently.
 *
 * `user.name` is the mutation that matters. A display name is not unique in
 * `bms.users`, so keying on it folds every grantless `configuration`-role
 * caller sharing one into a single bucket, and any of them then holds the
 * others' *Evaluate now* button for the life of the process — the exact
 * collapse the sentinel split closed, restored with the suite green. The
 * exact-key assertion below catches any wrong field; the twin's press after it
 * shows what the wrong field costs.
 */
export async function keysAGrantlessCallerOnTheSubjectTheControllerPassed(): Promise<void> {
  const { controller, res, counts, checkedKeys } = controllerWith({ readableOrganizations: [] });

  await controller.evaluateEnabledRules(ADMIN_USER, res);
  assert(counts.sweeps === 1, `the grantless press sweeps, it ran ${counts.sweeps} times`);
  assert(
    checkedKeys.length === 1 &&
      checkedKeys[0].length === 1 &&
      checkedKeys[0][0] === `user:${ADMIN_USER.sub}`,
    "a grantless caller is keyed on their token's sub — expected " +
      `["user:${ADMIN_USER.sub}"], the throttle was checked with ${JSON.stringify(checkedKeys)}`,
  );

  await rejects(
    () => controller.evaluateEnabledRules(ADMIN_USER, res),
    isTooManyRequests,
    "the same grantless caller pressing inside the window",
  );
  assert(
    counts.sweeps === 1,
    `the refused grantless press swept anyway (${counts.sweeps} sweeps)`,
  );

  // The twin shares ADMIN_USER's display name and nothing else, and must sweep.
  await controller.evaluateEnabledRules(DISPLAY_NAME_TWIN, res);
  assert(
    counts.sweeps === 2,
    "a second grantless caller was refused by the first one's press — two accounts sharing a " +
      `display name collapsed into one bucket (${counts.sweeps} sweeps)`,
  );
  assert(
    checkedKeys[2]?.[0] === `user:${DISPLAY_NAME_TWIN.sub}`,
    `the twin is keyed on its own sub, the throttle was checked with ${JSON.stringify(checkedKeys)}`,
  );
}

/**
 * 20. Every unrestricted global admin shares the one fleet bucket.
 *
 * The other empty branch, and the other half of the sentinel split.
 * `readableOrganizationIds` returns `null` for a global admin, which maps to a
 * literal no organization id and no subject can be — so here the identity the
 * handler passes is discarded, deliberately.
 *
 * Two different humans are what make that visible: the second is refused by the
 * first one's press. That is the accepted cost of not handing an unrestricted
 * role a per-user bucket, and it is also the assertion that a per-user key was
 * not quietly substituted for the shared one.
 */
export async function keysEveryGlobalAdminOnTheOneFleetBucket(): Promise<void> {
  const { controller, res, counts, checkedKeys } = controllerWith({ readableOrganizations: null });

  await controller.evaluateEnabledRules(ADMIN_USER, res);
  assert(counts.sweeps === 1, `the global admin's press sweeps, it ran ${counts.sweeps} times`);
  assert(
    checkedKeys.length === 1 &&
      checkedKeys[0].length === 1 &&
      checkedKeys[0][0] === GLOBAL_ADMIN_THROTTLE_KEY,
    `an unrestricted admin falls in the ${GLOBAL_ADMIN_THROTTLE_KEY} bucket, the throttle was ` +
      `checked with ${JSON.stringify(checkedKeys)}`,
  );

  await rejects(
    () => controller.evaluateEnabledRules(DISPLAY_NAME_TWIN, res),
    isTooManyRequests,
    "a second unrestricted admin pressing inside the window",
  );
  assert(
    counts.sweeps === 1,
    `the second admin swept — global admins share one bucket, they do not get one each (${counts.sweeps} sweeps)`,
  );
}
