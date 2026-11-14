import { BadRequestException } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import type { AssetScopeFilter } from "../filter-options/asset-filter-scope.service";
import { EvaluateThrottle } from "./evaluate-throttle";
import { RulesController } from "./rules.controller";

/**
 * `F4.361` U5 (ADR 0132 decisions 4 and 5, plan D2 and D7) — `GET /rules`'
 * four filters, driven by hand (the `rules-batch.controller.spec.ts` style,
 * §4.6: no Nest module in a unit test). The query is parsed `.strict()` before
 * anything runs; the four keys reach `AssetFilterScopeService.narrow` as one
 * filter; its answer is the scope `RulesService.listRules` gets, unchanged —
 * `[]` stays `[]`, so an out-of-scope filter is an empty list, never every rule.
 * `rules-list.controller.test.ts` is the Vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

type Ctor = ConstructorParameters<typeof RulesController>;

const USER = { sub: "u1", email: "wc-admin@bms.local" } as unknown as JwtPayload;
const ORG = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const ASSET = "44444444-4444-4444-8444-444444444444";

function harness(narrowed: string[] | null) {
  const narrowCalls: AssetScopeFilter[] = [];
  const listCalls: (string[] | null | undefined)[] = [];
  const rules = {
    listRules: async (assetIds?: string[] | null) => {
      listCalls.push(assetIds);
      return { items: [] };
    },
  } as unknown as Ctor[0];
  const assetFilterScope = {
    narrow: async (_user: JwtPayload, filter: AssetScopeFilter) => {
      narrowCalls.push(filter);
      return narrowed;
    },
  } as unknown as Ctor[6];
  const unused = {} as unknown;
  const controller = new RulesController(
    rules,
    unused as Ctor[1],
    unused as Ctor[2],
    new EvaluateThrottle(),
    unused as Ctor[4],
    unused as Ctor[5],
    assetFilterScope,
  );
  return { controller, narrowCalls, listCalls };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** No query: `narrow` gets an empty filter (it hands back `readableAssetIds`), and that scope is listed. */
export async function assertNoQueryNarrowsByNothing(): Promise<void> {
  const h = harness(null);
  await h.controller.listRules(USER, {});
  assert(same(h.narrowCalls, [{}]), `narrow got ${JSON.stringify(h.narrowCalls)}, not {}`);
  assert(h.listCalls.length === 1 && h.listCalls[0] === null, `listRules got ${JSON.stringify(h.listCalls)}, not the unrestricted null`);
}

/** Each of the four keys reaches `narrow`, lower-cased. */
export async function assertEachKeyReachesNarrow(): Promise<void> {
  for (const [key, id] of [["organizationId", ORG], ["locationId", SITE], ["assetGroupId", GROUP], ["assetId", ASSET]] as const) {
    const h = harness([ASSET]);
    await h.controller.listRules(USER, { [key]: id.toUpperCase() });
    assert(same(h.narrowCalls, [{ [key]: id }]), `${key}: narrow got ${JSON.stringify(h.narrowCalls)}`);
    assert(same(h.listCalls, [[ASSET]]), `${key}: listRules got ${JSON.stringify(h.listCalls)}`);
  }
  const all = harness([ASSET]);
  await all.controller.listRules(USER, { organizationId: ORG, locationId: SITE, assetGroupId: GROUP, assetId: ASSET });
  assert(
    same(all.narrowCalls, [{ organizationId: ORG, locationId: SITE, assetGroupId: GROUP, assetId: ASSET }]),
    `all four: narrow got ${JSON.stringify(all.narrowCalls)}`,
  );
}

/** An unknown key or a non-uuid id is a 400 (plan D7), and nothing — not narrow, not the list — runs. */
export async function assertABadQueryIsA400RunningNothing(): Promise<void> {
  for (const query of [{ foo: "1" }, { organizationId: "not-a-uuid" }, { assetId: "1" }, { severity: "critical" }]) {
    const h = harness([ASSET]);
    let thrown: unknown;
    try {
      await h.controller.listRules(USER, query);
    } catch (err) {
      thrown = err;
    }
    assert(thrown instanceof BadRequestException, `${JSON.stringify(query)} threw ${String(thrown)}, not a 400`);
    assert(h.narrowCalls.length === 0 && h.listCalls.length === 0, `${JSON.stringify(query)} reached narrow or the list`);
  }
}

/** A filter `narrow` answers `[]` for reaches the list as `[]` — never `null`, never the readable set. */
export async function assertAnEmptyNarrowingStaysEmpty(): Promise<void> {
  const h = harness([]);
  await h.controller.listRules(USER, { organizationId: ORG });
  assert(same(h.listCalls, [[]]), `listRules got ${JSON.stringify(h.listCalls)}, not [[]]`);
}
