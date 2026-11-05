import "reflect-metadata";

import { BadRequestException, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { MimicLayoutsController } from "./mimic-layouts.controller";

/**
 * `F4.308` (plan T3, C1) — `GET /api/v1/mimic-layouts/:id/preview?assetGroupId=` at the
 * controller, over stub services, no database. A missing, non-UUID or extra query key, and a bad
 * `:id`, are a 400 before any service runs; a good request reaches the preview service once with
 * `(user, id, assetGroupId)`. The checks behind it are `mimic-layout-preview.service.spec.ts`'s
 * and, against Postgres, `mimic-layout-preview.integration.spec.ts`'s.
 */

const ADMIN: JwtPayload = { sub: "u1", email: "admin@bms.local", name: "Admin", role: "admin" };
const LAYOUT = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const ANSWER = { dashboardId: LAYOUT, resolvedAt: "2026-11-05T10:00:00.000Z", widgets: [], stateMaps: [] };

function controllerWithRecorder(): { controller: MimicLayoutsController; seen: unknown[][] } {
  const seen: unknown[][] = [];
  const preview = {
    preview: (...args: unknown[]) => {
      seen.push(args);
      return Promise.resolve(ANSWER);
    },
  };
  const controller = new MimicLayoutsController(
    {} as unknown as ConstructorParameters<typeof MimicLayoutsController>[0],
    preview as unknown as ConstructorParameters<typeof MimicLayoutsController>[1],
  );
  return { controller, seen };
}

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected a 400, and the request was served");
}

/** K1 — the handler is `GET :id/preview`, so Nest's operationId is `MimicLayoutsController_preview`. */
export function previewRouteIsGetIdPreview(): void {
  const handler = MimicLayoutsController.prototype.preview as unknown as object;
  expect([Reflect.getMetadata(PATH_METADATA, handler), Reflect.getMetadata(METHOD_METADATA, handler)]).toEqual([
    ":id/preview",
    RequestMethod.GET,
  ]);
}

/** K2 — a missing `assetGroupId` is a 400 and the preview service never runs. */
export async function missingGroupIs400(): Promise<void> {
  const { controller, seen } = controllerWithRecorder();
  const err = await refusal(() => controller.preview(LAYOUT, {}, ADMIN));
  expect([err instanceof BadRequestException, seen.length]).toEqual([true, 0]);
}

/** K3 — a non-UUID `assetGroupId` is a 400 and the preview service never runs. */
export async function nonUuidGroupIs400(): Promise<void> {
  const { controller, seen } = controllerWithRecorder();
  const err = await refusal(() => controller.preview(LAYOUT, { assetGroupId: "not-a-uuid" }, ADMIN));
  expect([err instanceof BadRequestException, seen.length]).toEqual([true, 0]);
}

/** K4 — an extra query key is a 400 (`.strict()`), not a silently ignored filter. */
export async function extraQueryKeyIs400(): Promise<void> {
  const { controller, seen } = controllerWithRecorder();
  const err = await refusal(() => controller.preview(LAYOUT, { assetGroupId: GROUP, locationId: GROUP }, ADMIN));
  expect([err instanceof BadRequestException, seen.length]).toEqual([true, 0]);
}

/** K5 — a bad `:id` is a 400 and the preview service never runs. */
export async function badLayoutIdIs400(): Promise<void> {
  const { controller, seen } = controllerWithRecorder();
  const err = await refusal(() => controller.preview("nope", { assetGroupId: GROUP }, ADMIN));
  expect([err instanceof BadRequestException, seen.length]).toEqual([true, 0]);
}

/** K6 — a good request reaches the preview service once with `(user, id, assetGroupId)` and answers its value. */
export async function goodRequestReachesThePreviewOnce(): Promise<void> {
  const { controller, seen } = controllerWithRecorder();
  const answer = await controller.preview(LAYOUT, { assetGroupId: GROUP }, ADMIN);
  expect({ answer, seen }).toEqual({ answer: ANSWER, seen: [[ADMIN, LAYOUT, GROUP]] });
}
