import { ForbiddenException, NotFoundException } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

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

const SCOPED_USER = { sub: "u2", email: "wc-hvac-admin@bms.local" } as unknown as JwtPayload;
const IN_SCOPE_RULE = "11111111-1111-1111-1111-111111111111";
const OUT_OF_SCOPE_RULE = "22222222-2222-2222-2222-222222222222";
const CHANNEL_ID = "33333333-3333-3333-3333-333333333333";

/**
 * A controller whose rules service enforces scope the way the real one does:
 * `assertRuleInScope` throws `NotFoundException` for a rule outside the
 * caller's asset scope (`rules.service.ts:585`).
 */
function controllerWith(options: { writeAllowed?: boolean } = {}): {
  controller: RulesController;
  writes: Array<{ ruleId: string; channelIds: string[] }>;
  reads: string[];
} {
  const writes: Array<{ ruleId: string; channelIds: string[] }> = [];
  const reads: string[] = [];

  const rules = {
    assertRuleInScope: (ruleId: string, assetIds?: string[] | null) => {
      if (assetIds === null || assetIds === undefined) return Promise.resolve();
      if (ruleId === OUT_OF_SCOPE_RULE) {
        return Promise.reject(new NotFoundException("Rule asset is outside your access scope"));
      }
      return Promise.resolve();
    },
  } as unknown as Ctor[0];

  const accessControl = {
    // The scoped roles this repository seeds: `location_admin` and
    // `asset_group_admin` both pass `configuration`.
    assertOperationsWriteRole: () =>
      options.writeAllowed === false
        ? Promise.reject(new ForbiddenException("configuration write denied"))
        : Promise.resolve(),
    readableAssetIds: () => Promise.resolve(["asset-in-scope"]),
  } as unknown as Ctor[1];

  const channels = {
    setRuleChannels: (ruleId: string, channelIds: string[]) => {
      writes.push({ ruleId, channelIds });
      return Promise.resolve(channelIds);
    },
    ruleChannelIds: (ruleId: string) => {
      reads.push(ruleId);
      return Promise.resolve([CHANNEL_ID]);
    },
  } as unknown as Ctor[2];

  return { controller: new RulesController(rules, accessControl, channels), writes, reads };
}

/**
 * `F3.8` — the scope gate on the two rule-notification routes (AGENTS.md §4.7).
 *
 * **These exist because the routes shipped without one.** The role check
 * (`assertOperationsWriteRole(user, "configuration")`) admits
 * `organization_admin`, `location_admin` and `asset_group_admin` — all scoped
 * roles — and nothing then checked that the rule was inside the caller's
 * scope. A location-scoped admin could attach a channel they own to any rule in
 * any other location and quietly redirect its alarms, or send `channelIds: []`
 * and silence it. §4.7 states the gates are additive: role AND scope. Found by
 * the `F3.8` compliance and security reviews, which found it independently.
 */
export async function runRuleNotificationScopeTests(): Promise<void> {
  // --- the write ------------------------------------------------------------
  {
    const { controller, writes } = controllerWith();

    await controller.setRuleNotifications(IN_SCOPE_RULE, { channelIds: [CHANNEL_ID] }, SCOPED_USER);
    assert(writes.length === 1, "an in-scope rule is written");

    await rejects(
      () =>
        controller.setRuleNotifications(
          OUT_OF_SCOPE_RULE,
          { channelIds: [CHANNEL_ID] },
          SCOPED_USER,
        ),
      (e) => e instanceof NotFoundException,
      "attaching a channel to a rule outside the caller's scope",
    );
    assert(
      writes.length === 1,
      "the out-of-scope write reached the join table — the scope check is not gating anything",
    );

    // The same route, the emptying case: silencing another site's rule is the
    // quieter half of the same defect.
    await rejects(
      () => controller.setRuleNotifications(OUT_OF_SCOPE_RULE, { channelIds: [] }, SCOPED_USER),
      (e) => e instanceof NotFoundException,
      "emptying the channel set of a rule outside the caller's scope",
    );
    assert(writes.length === 1, "no out-of-scope write may reach the join table");
  }

  // --- the role check is still there, and still first ----------------------
  {
    const { controller, writes } = controllerWith({ writeAllowed: false });
    await rejects(
      () =>
        controller.setRuleNotifications(IN_SCOPE_RULE, { channelIds: [CHANNEL_ID] }, SCOPED_USER),
      (e) => e instanceof ForbiddenException,
      "a role that may not write configuration",
    );
    assert(writes.length === 0, "a refused role writes nothing");
  }

  // --- the read -------------------------------------------------------------
  //
  // Lighter but the same class: the first version took no user at all, so any
  // authenticated viewer could enumerate the channel ids of any rule id.
  {
    const { controller, reads } = controllerWith();

    const result = await controller.listRuleNotifications(IN_SCOPE_RULE, SCOPED_USER);
    assert(result.channelIds.length === 1, "an in-scope rule's channels are readable");

    await rejects(
      () => controller.listRuleNotifications(OUT_OF_SCOPE_RULE, SCOPED_USER),
      (e) => e instanceof NotFoundException,
      "reading the channels of a rule outside the caller's scope",
    );
    assert(reads.length === 1, "the out-of-scope read reached the database");
  }

  // --- a malformed id is refused before anything else ----------------------
  {
    const { controller, writes, reads } = controllerWith();
    await rejects(
      () => controller.setRuleNotifications("not-a-uuid", { channelIds: [] }, SCOPED_USER),
      (e) => e instanceof Error,
      "a non-uuid rule id on the write",
    );
    await rejects(
      () => controller.listRuleNotifications("not-a-uuid", SCOPED_USER),
      (e) => e instanceof Error,
      "a non-uuid rule id on the read",
    );
    assert(writes.length === 0 && reads.length === 0, "a malformed id touches nothing");
  }
}
