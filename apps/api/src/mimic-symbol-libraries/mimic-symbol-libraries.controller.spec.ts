import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { repoRoot } from "../testing/repo-root";
import { decoratorAt, methodBody } from "../testing/source-scan";
import { MimicSymbolLibrariesController } from "./mimic-symbol-libraries.controller";
import type { MimicSymbolLibrariesService, MimicSymbolUploadInput } from "./mimic-symbol-libraries.service";

/**
 * `F3.32f` slice 3 U2 — a **source scan** of `mimic-symbol-libraries.controller.ts` plus a
 * behavioural half over a stub service (the `asset-images-write.controller.spec.ts` shape).
 * Assertions live here; `mimic-symbol-libraries.controller.test.ts` is the Vitest entry point.
 *
 * Why a scan: esbuild emits no `design:paramtypes` (`F4.20`), so the module cannot be booted
 * here to ask the router. The text proves: the upload interceptor is spelled once, as a call,
 * with the four limits as exact strings (`f4.102` holds only that `fileSize` is named); inside
 * `uploadSymbol` the access gate precedes `requireFile(` and the service's upload; the filename
 * is decoded before it is parsed; the class carries `JwtAuthGuard`; `PUT settings/:libraryCode`
 * is declared before every `:id` route; no request schema is declared in the controller. Every
 * anchor goes through `decoratorAt`/`methodBody`, never a bare `indexOf` over the whole file,
 * because the class docblock describes the same calls.
 */
const CONTROLLER = join(repoRoot(), "apps/api/src/mimic-symbol-libraries/mimic-symbol-libraries.controller.ts");

const source = (): string => readFileSync(CONTROLLER, "utf8");

/** `uploadSymbol` runs from its `async uploadSymbol(` to the next route decorator. */
const uploadBody = (text: string): string => methodBody(text, "async uploadSymbol(", '@Patch(":id/symbols/:symbolId")');

export function assertTheInterceptorIsSpelledOnceWithTheFourLimits(): void {
  const text = source();
  const calls = [...text.matchAll(/\bFileInterceptor\s*\(/g)];
  expect(calls, "FileInterceptor( must appear exactly once, as the upload route's call").toHaveLength(1);
  const at = calls[0]?.index ?? -1;
  const expression = text.slice(at, text.indexOf("}),", at) + 3);
  expect(expression).toContain('"file"');
  expect(expression).toContain("fileSize: MAX_MIMIC_SYMBOL_SVG_BYTES");
  expect(expression).toContain("files: 1");
  expect(expression).toContain("fields: 3");
  expect(expression).toContain("fieldSize: 4096");
}

export function assertUploadChecksAccessBeforeRequireFile(): void {
  const body = uploadBody(source());
  const gate = body.indexOf("this.service.assertCanUploadTo(");
  const file = body.indexOf("requireFile(");
  expect(gate, "uploadSymbol must call this.service.assertCanUploadTo(").toBeGreaterThan(-1);
  expect(file, "uploadSymbol must call requireFile(").toBeGreaterThan(-1);
  expect(gate, "the access gate must precede requireFile(").toBeLessThan(file);
}

export function assertUploadChecksAccessBeforeTheService(): void {
  const body = uploadBody(source());
  const gate = body.indexOf("this.service.assertCanUploadTo(");
  const upload = body.indexOf("this.service.uploadSymbol(");
  expect(gate).toBeGreaterThan(-1);
  expect(upload, "uploadSymbol must call this.service.uploadSymbol(").toBeGreaterThan(-1);
  expect(gate, "the access gate must precede the upload").toBeLessThan(upload);
}

export function assertUploadParsesThePathBeforeTheGate(): void {
  const body = uploadBody(source());
  const parse = body.indexOf("idParamSchema.parse(");
  const gate = body.indexOf("this.service.assertCanUploadTo(");
  expect(parse).toBeGreaterThan(-1);
  expect(parse, "a non-uuid id is a 400 before any pool").toBeLessThan(gate);
}

export function assertUploadDecodesTheFilenameBeforeParsingIt(): void {
  const body = uploadBody(source());
  const decode = body.indexOf("decodeMulterFilename(");
  const parse = body.indexOf("mimicSymbolFilenameSchema.parse(");
  expect(decode).toBeGreaterThan(-1);
  expect(parse).toBeGreaterThan(-1);
  expect(decode, "the filename must be decoded before it is parsed").toBeLessThan(parse);
}

export function assertControllerIsGuardedByJwt(): void {
  const text = source();
  expect(decoratorAt(text, "@UseGuards(JwtAuthGuard)")).toBeGreaterThan(-1);
  expect(decoratorAt(text, "@UseGuards(JwtAuthGuard)")).toBeLessThan(decoratorAt(text, "export class MimicSymbolLibrariesController"));
}

export function assertSettingsRouteIsDeclaredBeforeTheIdRoutes(): void {
  const text = source();
  const settings = decoratorAt(text, '@Put("settings/:libraryCode")');
  const ids = ['@Patch(":id")', '@Post(":id/symbols")', '@Patch(":id/symbols/:symbolId")'].map((d) => decoratorAt(text, d));
  expect(settings, "the settings route decorator is missing").toBeGreaterThan(-1);
  for (const at of ids) {
    expect(at, "every :id route decorator must be found").toBeGreaterThan(-1);
    expect(settings).toBeLessThan(at);
  }
}

export function assertNoRequestSchemaIsDeclaredInTheController(): void {
  expect(source()).not.toMatch(/^\s*(?:export\s+)?const\s+\w*(?:Body|Query|Fields|Params?)Schema\s*=/m);
}

// ---------------------------------------------------------------------------
// Behaviour over a stub service
// ---------------------------------------------------------------------------

const USER = { sub: "u" } as unknown as JwtPayload;
const LIBRARY = "22222222-2222-4222-8222-222222222222";

type Calls = { gate: number; upload: MimicSymbolUploadInput[] };

function controllerOver(allowed: boolean): { controller: MimicSymbolLibrariesController; calls: Calls } {
  const calls: Calls = { gate: 0, upload: [] };
  const service = {
    assertCanUploadTo: async () => {
      calls.gate += 1;
      if (!allowed) throw new ForbiddenException("Organization is outside your access scope");
      return {};
    },
    uploadSymbol: async (_user: JwtPayload, _id: string, input: MimicSymbolUploadInput) => {
      calls.upload.push(input);
      return {};
    },
  } as unknown as MimicSymbolLibrariesService;
  return { controller: new MimicSymbolLibrariesController(service), calls };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a refusal");
}

export async function assertADeniedCallerWithNoFileIs403NotA400(): Promise<void> {
  const { controller, calls } = controllerOver(false);
  const err = await rejectionOf(controller.uploadSymbol(LIBRARY, undefined, {}, USER));
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(calls.upload).toEqual([]);
}

export async function assertAnAllowedCallerWithNoFileIs400(): Promise<void> {
  const { controller, calls } = controllerOver(true);
  const err = await rejectionOf(controller.uploadSymbol(LIBRARY, undefined, {}, USER));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(calls.gate).toBe(1);
  expect(calls.upload).toEqual([]);
}

export async function assertAnAllowedUploadReachesTheServiceWithTheDecodedName(): Promise<void> {
  const { controller, calls } = controllerOver(true);
  const buffer = Buffer.from("<svg/>");
  // "café.svg" as busboy hands it over: UTF-8 bytes as latin1 code units.
  const latin1 = Buffer.from("café.svg", "utf8").toString("latin1");
  await controller.uploadSymbol(LIBRARY, { buffer, mimetype: "image/svg+xml", originalname: latin1 }, { name: "", group: "water" }, USER);
  expect(calls.upload).toEqual([
    { buffer, declaredType: "image/svg+xml", originalFilename: "café.svg", name: undefined, label: undefined, group: "water" },
  ]);
}
