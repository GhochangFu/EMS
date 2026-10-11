import "reflect-metadata";

import { describe, it } from "vitest";

import {
  assertAListToolLoopsOverTheAllowedSet,
  assertAListToolRefusesAnOrganizationOutsideTheAllowedSet,
  assertAnAlarmSecretNeverReachesTheProvider,
  assertAnEmptyAllowedSetCallsNoService,
  assertAnInjectedProposeCallFindsNoTool,
  assertAResultIsParsedThroughItsContract,
  assertARowFromAnotherOrganizationFailsClosed,
  assertHealthReadsPerOrganizationNeverNull,
  assertKpisOfAnOwnKeyOrganizationsAssetNeverRun,
  assertListAlarmsPlacesANamedAsset,
  assertListLocationsRefusesAnAssetGroupAdmin,
  assertOpenPageNavigatesToAnAllowedRoute,
  assertOpenPageRefusesAnythingButAnAppRoute,
  assertTheModuleWiresTheReadTools,
  assertTheRegistryIsTheSevenReadTools,
  assertTheRouteTemplatesAreTheWebAppsRoutes,
} from "./copilot-read-tools.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("F3.85 PR 7 — the copilot's read tools", () => {
  it("a list tool refuses an organization outside the allowed set, and no service runs", assertAListToolRefusesAnOrganizationOutsideTheAllowedSet);
  it("a list tool with no organization loops over the allowed set, one call per organization", assertAListToolLoopsOverTheAllowedSet);
  it("get_health_summary reads per organization with an id array, never null", assertHealthReadsPerOrganizationNeverNull);
  it("an empty allowed set makes no service call from any list tool", assertAnEmptyAllowedSetCallsNoService);
  it("get_asset_kpis on an own-key organization's asset fails and the KPI service never runs", assertKpisOfAnOwnKeyOrganizationsAssetNeverRun);
  it("list_alarms places a named asset in an allowed organization first", assertListAlarmsPlacesANamedAsset);
  it("an alarm text holding a credential never reaches the provider's tool message", assertAnAlarmSecretNeverReachesTheProvider);
  it("a tool result is parsed through its contract schema", assertAResultIsParsedThroughItsContract);
  it("an injected propose call finds no tool and stores no action line", assertAnInjectedProposeCallFindsNoTool);
  it("the registry is the seven read tools with strict arguments", assertTheRegistryIsTheSevenReadTools);
  it("list_locations refuses an asset_group_admin before the service", assertListLocationsRefusesAnAssetGroupAdmin);
  it("a location or dashboard row from another organization fails closed", assertARowFromAnotherOrganizationFailsClosed);
  it("open_page refuses a scheme, //, a query and a non-listed path", assertOpenPageRefusesAnythingButAnAppRoute);
  it("open_page accepts an allow-listed route and the turn answers navigateTo", assertOpenPageNavigatesToAnAllowedRoute);
  it("every route template is a route of apps/web/src/app.tsx", assertTheRouteTemplatesAreTheWebAppsRoutes);
  it("CopilotModule binds the read-tool token to the tool set and reaches every service it injects", assertTheModuleWiresTheReadTools);
});
