import { expect } from "vitest";

import { demoRoleForAsset } from "./asset-groups-seed";
import { assetCode, deviceDomain, loadPheCatalog } from "./phe-pilot-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * `F3.41` — `demoRoleForAsset` now carries a ruling, so it is worth asserting.
 *
 * **Why this file did not exist before.** Until `F3.41` every branch of
 * `demoRoleForAsset` was a reading of an ESKOM asset's own name —
 * `CR-XFMR-100KVA` is a transformer — and a test would have restated the
 * function. The two branches this row adds are different: they are the
 * repository owner's ruling of 2026-09-02, and the whole risk of adding them is
 * that a new branch steals a code an old branch used to claim, or the reverse.
 * That risk is only checkable by running both sets through the real function,
 * which is what this file does.
 *
 * **The PHE cases read the real catalog, not a fixture.** `loadPheCatalog`,
 * `assetCode` and `deviceDomain` are the same three functions `seedPheCatalog`
 * itself uses, so the codes here are the codes the seed will actually hand to
 * `demoRoleForAsset`. A hand-written list of six device names would agree with
 * whatever it was written from and would keep agreeing after the catalog moved,
 * which is ADR 0025's recorded class of test that proves nothing.
 */

/**
 * The ruling, as totals over the whole estate.
 *
 * **This is the anti-vacuity control for the two new branches.** Every other
 * assertion below is "this input gives that output", and a branch that matched
 * nothing at all would still satisfy the `null` cases. These three counts
 * cannot: they fail if a branch stops matching, and they fail if a branch
 * starts matching too much.
 *
 * 48 devices over six stations — per station 2 `MFM`, 2 `PUMP-M`, 2 `PUMP-C`
 * and 2 `AIRSP1051M`. So 12 meters, 24 pumps and 12 gateways, and the twelve
 * gateways take no role at all.
 */
export function assertTheRulingMapsEveryPheDevice(): void {
  const catalog = loadPheCatalog();
  const seen = new Map<string, string>();
  for (const row of catalog.rows) {
    seen.set(
      assetCode(row.DeviceCode),
      deviceDomain(row.DeviceCode, row.ModelDeviceCode),
    );
  }
  expect(seen.size, "the PHE catalog no longer holds 48 devices — re-read the ruling").toBe(48);

  const tally = new Map<string, number>();
  for (const [code, domain] of seen) {
    const role = demoRoleForAsset(code, domain) ?? "<null>";
    tally.set(role, (tally.get(role) ?? 0) + 1);
  }

  expect(
    Object.fromEntries([...tally.entries()].sort()),
    "the owner's 2026-09-02 ruling maps PHE WB's estate to 12 `meter`, 24 `pump` and 12 " +
      "unroled gateways. A different tally means a branch stopped matching, started " +
      "matching too much, or the catalog changed shape — read the ruling in " +
      "asset-groups-seed.ts before touching this number.",
  ).toEqual({ "<null>": 12, meter: 12, pump: 24 });
}

/**
 * The two pump shapes take **one** role, and that is the ruling rather than an
 * accident of the prefix test.
 *
 * `0051` step 4 made the junction's role index deliberately NOT UNIQUE so one
 * role may match several members, which is what lets a single `pump` code carry
 * both. Asserted as its own case so that splitting the branch later — into
 * `pump` and `dosing-pump`, say — fails here and not only in a count.
 */
export function assertBothPumpShapesTakeOneRole(): void {
  expect(demoRoleForAsset("PHE-MFM-000000001", "electrical")).toBe("meter");
  expect(demoRoleForAsset("PHE-PUMP-M-000000000", "electrical")).toBe("pump");
  expect(demoRoleForAsset("PHE-PUMP-C-000000000", "electrical")).toBe("pump");
}

/**
 * The gateway takes no role, and the **code** refuses it as well as the domain.
 *
 * `PHE-AIRSP1051M-*` is `environment` domain, so the function's first guard
 * already returns `null` for it. The second case passes `"electrical"`
 * deliberately: if `deviceDomain` ever re-files the gateway, the ruling must
 * still leave it unroled, and only a code-level refusal delivers that. Without
 * this case the whole claim would rest on a domain the seed decides elsewhere.
 */
export function assertTheGatewayTakesNoRole(): void {
  expect(demoRoleForAsset("PHE-AIRSP1051M-000000003", "environment")).toBeNull();
  expect(demoRoleForAsset("PHE-AIRSP1051M-000000003", "electrical")).toBeNull();
}

/**
 * Every ESKOM reading still resolves to what it resolved to before.
 *
 * This is the regression half, and it is the reason this file exists at all.
 * The two new branches test `code.startsWith("PHE-")`, and no ESKOM code begins
 * that way — but "no ESKOM code begins that way" is a claim, and this is what
 * makes it a checked one. It also runs the other direction: none of the
 * substring tests above the new branches (`UTILITY`, `XFMR`, `MAIN-BUS`, `MDB`,
 * `LIGHT-AUX`) may claim a PHE code, which
 * `assertTheRulingMapsEveryPheDevice` proves as a tally and this table proves
 * per code.
 */
export function assertEskomReadingsAreUnchanged(): void {
  const table: ReadonlyArray<readonly [string, string]> = [
    ["CR-UTILITY-11KV", "incoming-supply"],
    ["CR-XFMR-100KVA", "transformer"],
    ["TX-01", "transformer"],
    ["CR-MAIN-BUS", "lt-panel"],
    ["MDB-01", "lt-panel"],
    ["CR-Q1", "mcc"],
    ["CR-Q7", "mcc"],
    ["CR-Q12", "mcc"],
    ["CR-LIGHT-AUX", "utilities"],
    ["PV-INV-01", "utilities"],
  ];
  for (const [code, role] of table) {
    expect(demoRoleForAsset(code, "electrical"), `${code} changed role`).toBe(role);
  }
}

/**
 * A non-electrical asset takes no role, whatever its code says.
 *
 * The domain guard is the first line of the function and the HVAC paragraph of
 * its docblock depends on it: `CR-HVAC-1` decides nothing between `chiller` and
 * `ahu-fcu`, so it must stay NULL for an admin to fill. Pinned here because the
 * two new branches are prefix tests that would otherwise be reachable from any
 * domain if the guard were ever moved below them.
 */
export function assertOnlyElectricalAssetsTakeARole(): void {
  expect(demoRoleForAsset("CR-XFMR-100KVA", "hvac")).toBeNull();
  expect(demoRoleForAsset("PHE-MFM-000000001", "environment")).toBeNull();
  expect(demoRoleForAsset("CR-HVAC-1", "hvac")).toBeNull();
  expect(demoRoleForAsset("CR-CRAC-101", "hvac")).toBeNull();
}

/**
 * A code that decides nothing keeps its NULL.
 *
 * `ht-panel` is `0051`'s own case: the seeded ESKOM estate steps 11 kV incomer
 * → 100 kVA transformer → 415 V bus and holds no HT panel, so nothing may
 * resolve to it. A branch invented later to "fill the gap" would break this.
 */
export function assertAnUndecidedCodeStaysNull(): void {
  expect(demoRoleForAsset("CR-SOMETHING-ELSE", "electrical")).toBeNull();
  expect(demoRoleForAsset("", "electrical")).toBeNull();
}
