import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { MqttPayloadFormatsAdminController } from "./mqtt-payload-formats.controller";
import type { MqttPayloadFormatsAdminService } from "./mqtt-payload-formats.service";

/**
 * `F4.334` / ADR 0116 decision 5 (plan T3.2) — the six routes, constructed
 * directly with a stubbed service (AGENTS.md §4.6: no Nest module in a test).
 * The service owns the gates and every parse, so each route hands it the raw
 * input. The `.test.ts` sibling runs these.
 */

const JWT = { sub: "u", email: "admin@bms.local", role: "admin" } as unknown as JwtPayload;

function controllerWith(calls: string[]): MqttPayloadFormatsAdminController {
  const answer = async (call: string) => {
    calls.push(call);
    return { call };
  };
  const service = {
    list: () => answer("list"),
    getByCode: (_jwt: JwtPayload, code: string) => answer(`get ${code}`),
    create: (_jwt: JwtPayload, body: unknown) => answer(`create ${JSON.stringify(body)}`),
    update: (_jwt: JwtPayload, code: string, body: unknown) => answer(`update ${code} ${JSON.stringify(body)}`),
    remove: async (_jwt: JwtPayload, code: string) => {
      await answer(`remove ${code}`);
    },
    test: (_jwt: JwtPayload, body: unknown) => answer(`test ${JSON.stringify(body)}`),
  };
  return new MqttPayloadFormatsAdminController(service as unknown as MqttPayloadFormatsAdminService);
}

/** Mounted at `admin/mqtt-payload-formats`; `DELETE` is 204, `POST test` is 200 and declared before `:code`. */
export function theRoutesAreMounted(): void {
  expect(Reflect.getMetadata(PATH_METADATA, MqttPayloadFormatsAdminController)).toBe("admin/mqtt-payload-formats");
  const proto = MqttPayloadFormatsAdminController.prototype;
  expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.remove)).toBe(HttpStatus.NO_CONTENT);
  expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.test)).toBe(HttpStatus.OK);
  expect(Reflect.getMetadata(PATH_METADATA, proto.test)).toBe("test");
  for (const handler of [proto.getByCode, proto.update, proto.remove]) {
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(":code");
  }
  const names = Object.getOwnPropertyNames(proto);
  expect(names.indexOf("test")).toBeLessThan(names.indexOf("getByCode"));
  expect(Reflect.getMetadata(METHOD_METADATA, proto.update)).toBe(RequestMethod.PUT);
}

/** Each verb reaches its service method with the raw input. */
export async function eachRouteReachesItsServiceMethod(): Promise<void> {
  const calls: string[] = [];
  const controller = controllerWith(calls);
  await controller.list(JWT);
  await controller.getByCode("thinkiot-envelope", JWT);
  await controller.create({ code: "x" }, JWT);
  await controller.update("x", { name: "y" }, JWT);
  await controller.remove("x", JWT);
  await controller.test({ sample: "{}" }, JWT);
  expect(calls).toEqual([
    "list",
    "get thinkiot-envelope",
    'create {"code":"x"}',
    'update x {"name":"y"}',
    "remove x",
    'test {"sample":"{}"}',
  ]);
}
