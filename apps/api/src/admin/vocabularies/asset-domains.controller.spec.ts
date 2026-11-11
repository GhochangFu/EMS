import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { AssetDomainsAdminController } from "./asset-domains.controller";
import type { AssetDomainsAdminService } from "./asset-domains.service";

/**
 * `E3.1` (ADR 0122 rulings P8 and R4; plan T7.1) — the controller's parse boundary,
 * with no database: a bad code or body is a 400 that never reaches the service. The
 * role gate and the write are the integration suite's. Assertions live here;
 * `asset-domains.controller.test.ts` runs them (ADR 0014).
 */

const JWT: JwtPayload = { sub: "00000000-0000-4000-8000-000000000000", email: "admin@bms.local", name: "spec", role: "admin" };
const ROW = { code: "water", label: "Water", sortOrder: 40, active: true, workOrderPrefix: "WATER" };

function harness(): { controller: AssetDomainsAdminController; calls: unknown[] } {
  const calls: unknown[] = [];
  const service = {
    async list() {
      calls.push("list");
      return { items: [ROW] };
    },
    async update(_jwt: JwtPayload, code: string, body: unknown) {
      calls.push({ code, body });
      return ROW;
    },
  } as unknown as AssetDomainsAdminService;
  return { controller: new AssetDomainsAdminController(service), calls };
}

/** A well-formed PATCH reaches the service with the parsed code and body; `null` clears the prefix. */
export async function aGoodPatchReachesTheService(): Promise<void> {
  const { controller, calls } = harness();
  await expect(controller.update("water", { workOrderPrefix: "STP" }, JWT)).resolves.toEqual(ROW);
  await expect(controller.update("water", { workOrderPrefix: null }, JWT)).resolves.toEqual(ROW);
  expect(calls).toEqual([
    { code: "water", body: { workOrderPrefix: "STP" } },
    { code: "water", body: { workOrderPrefix: null } },
  ]);
}

/** The body is the prefix and nothing else: `label`, `active` or `code` beside it is a 400 (strict). */
export async function aBodyNamingAnotherFieldIsRefused(): Promise<void> {
  const { controller, calls } = harness();
  for (const extra of [{ label: "Wastewater" }, { active: false }, { code: "stp" }, { sortOrder: 1 }]) {
    await expect(controller.update("water", { workOrderPrefix: "STP", ...extra }, JWT), JSON.stringify(extra)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  }
  expect(calls, "the service was never called").toEqual([]);
}

/** A prefix that is not two to eight upper-case letters or digits is a 400; so is a body without one. */
export async function aBadPrefixIsRefused(): Promise<void> {
  const { controller, calls } = harness();
  for (const workOrderPrefix of ["stp", "S", "TOOLONG99", "ST-P", "", 12, undefined]) {
    await expect(controller.update("water", { workOrderPrefix }, JWT), String(workOrderPrefix)).rejects.toBeInstanceOf(BadRequestException);
  }
  await expect(controller.update("water", {}, JWT), "an empty body").rejects.toBeInstanceOf(BadRequestException);
  expect(calls).toEqual([]);
}

/** A code that is not a domain code's shape is a 400, before the service. */
export async function aBadCodeIsRefused(): Promise<void> {
  const { controller, calls } = harness();
  for (const code of ["Water", "wa ter", "1water", "x".repeat(65)]) {
    await expect(controller.update(code, { workOrderPrefix: "STP" }, JWT), code).rejects.toBeInstanceOf(BadRequestException);
  }
  expect(calls).toEqual([]);
}

/** The list passes the caller through to the service, which holds the gate. */
export async function theListAsksTheService(): Promise<void> {
  const { controller, calls } = harness();
  await expect(controller.list(JWT)).resolves.toEqual({ items: [ROW] });
  expect(calls).toEqual(["list"]);
}
