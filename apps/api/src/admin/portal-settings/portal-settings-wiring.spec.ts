import "reflect-metadata";

import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { MeController } from "../../me/me.controller";
import { MasterDataAuditService } from "../master-data-audit.service";
import { PortalSettingsController } from "./portal-settings.controller";
import { PortalSettingsModule } from "./portal-settings.module";
import { PortalSettingsService } from "./portal-settings.service";
import { PublicAppearanceController } from "./public-appearance.controller";

/**
 * `F4.341` (ADR 0118 decisions 10 and 12) — what Nest reads at boot for the appearance routes:
 * the module's controllers and providers, each controller's path and guards, and the one route of
 * the unauthenticated controller. Guards in this API are per controller, so the public route's
 * safety is that its controller carries no guard **and holds no other route**.
 */

type Proto = Record<string, unknown>;

/** Every method of a controller that Nest maps to a route: `[name, verb, path]`. */
function routesOf(controller: { prototype: object }): Array<[string, string, string]> {
  const proto = controller.prototype as Proto;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor" && Reflect.hasMetadata(PATH_METADATA, proto[name] as object))
    .map((name) => [
      name,
      RequestMethod[Reflect.getMetadata(METHOD_METADATA, proto[name] as object) as number],
      Reflect.getMetadata(PATH_METADATA, proto[name] as object) as string,
    ]);
}

export function theModuleWiresTheThreeControllers(): void {
  expect(Reflect.getMetadata("controllers", PortalSettingsModule)).toEqual([PortalSettingsController, PublicAppearanceController, MeController]);
  expect(Reflect.getMetadata("providers", PortalSettingsModule)).toEqual([PortalSettingsService, MasterDataAuditService]);
}

export function thePublicControllerHasNoGuardAndOneRoute(): void {
  expect(Reflect.getMetadata(PATH_METADATA, PublicAppearanceController)).toBe("public");
  expect(Reflect.getMetadata(GUARDS_METADATA, PublicAppearanceController)).toBeUndefined();
  expect(routesOf(PublicAppearanceController)).toEqual([["getAppearance", "GET", "appearance"]]);
  expect(Reflect.getMetadata(GUARDS_METADATA, (PublicAppearanceController.prototype as unknown as Proto).getAppearance as object)).toBeUndefined();
}

export function theWriteControllersAreGuarded(): void {
  for (const [controller, path] of [
    [PortalSettingsController, "admin/portal-settings"],
    [MeController, "me"],
  ] as const) {
    expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe(path);
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([JwtAuthGuard]);
  }
  expect(routesOf(PortalSettingsController)).toEqual([
    ["getAppearance", "GET", "appearance"],
    ["setAppearance", "PUT", "appearance"],
  ]);
  expect(routesOf(MeController)).toEqual([["setAppearance", "PUT", "appearance"]]);
}

/** The public read hands back exactly the two values of the row, from a stubbed service. */
export async function thePublicReadIsTwoKeys(): Promise<void> {
  const service = { readPublic: async () => ({ designSystem: "bento-ops", colourProfile: "sand" }) } as unknown as PortalSettingsService;
  const body = await new PublicAppearanceController(service).getAppearance();
  expect(Object.keys(body).sort()).toEqual(["colourProfile", "designSystem"]);
}
