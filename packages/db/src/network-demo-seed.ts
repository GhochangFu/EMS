import type { EskomAssetSpec } from "./eskom-assets-seed";

/**
 * `F3.80` PR3 Task 3.1 — the demo assets behind the two ESKOM network mimics (ADR 0101): an HT/LT
 * single-line network and a pump/valve/damper flow network, both at the RSMOC-WC control room
 * (owner ruling 2026-10-15, OQ3 (a)).
 *
 * Fifteen assets, each code prefixed `NW-` and avoiding every substring `demoRoleForAsset` matches,
 * so none takes a role from the catalog and `eskomSmocRoledCodes` does not move. The roles are
 * written per group by `seedNetworkDemo` (Task 3.2). They sit in the ESKOM catalog, spread after
 * `DEMO_WATER_PLANT_ASSETS`, because `seedEskomAssets` precedes `seedEskomLadderRules`, which
 * covers every ESKOM electrical asset (the boot gate's "uncovered electrical" count stays 0).
 *
 * ESKOM only. No PHEWB row is written, because PHEWB is the real pilot.
 */

/**
 * The site name, the same string as `CONTROL_ROOM_SITE_NAME` in `eskom-assets-seed.ts`. Restated,
 * not imported: that file imports this one, and a value import would be a cycle. The spec holds
 * the two equal.
 */
const NETWORK_DEMO_SITE_NAME = "RSMOC Western Cape";

function asset(code: string, name: string, domain: string): EskomAssetSpec {
  return { code, name, siteName: NETWORK_DEMO_SITE_NAME, domain };
}

export const NETWORK_DEMO_ASSETS: readonly EskomAssetSpec[] = [
  // HT/LT network — branch A binds fully, branch B binds its two switching units only (OQ1 (a)).
  asset("NW-HT-GRID-CB", "Network Demo HT Grid Incomer Breaker", "electrical"),
  asset("NW-HT-COUPLER", "Network Demo HT Bus Coupler", "electrical"),
  asset("NW-DG-1", "Network Demo Diesel Generator 1", "electrical"),
  asset("NW-HT-DG-CB", "Network Demo HT DG Breaker", "electrical"),
  asset("NW-HT-OUT-CB", "Network Demo HT Outgoing Breaker A", "electrical"),
  asset("NW-TR-A", "Network Demo Transformer A", "electrical"),
  asset("NW-LT-A", "Network Demo LT Panel A", "electrical"),
  asset("NW-LT-A-F1", "Network Demo LT A Feeder 1", "electrical"),
  asset("NW-LT-A-F2", "Network Demo LT A Feeder 2", "electrical"),
  asset("NW-HT-ISO-B", "Network Demo HT Isolator B", "electrical"),
  asset("NW-LT-B-F1", "Network Demo LT B Mains Feeder 1", "electrical"),
  // Flow network — one drawing, water then air (OQ5 (a)); one roled isolation valve (OQ6 (a)).
  asset("NW-FL-PUMP", "Network Demo Pump", "water"),
  asset("NW-FL-ISO-V1", "Network Demo Isolation Valve 1", "water"),
  asset("NW-FL-CV", "Network Demo Control Valve", "water"),
  asset("NW-FL-DAMPER", "Network Demo Damper", "hvac"),
];
