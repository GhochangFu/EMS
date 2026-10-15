import "reflect-metadata";

import { INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import { CopilotUploadChangeInterceptor } from "../copilot/copilot-upload-change.interceptor";
import { COPILOT_UPLOAD_ROUTE } from "../copilot/copilot-upload-route";
import { MimicSymbolLibrariesController } from "./mimic-symbol-libraries.controller";

/**
 * `F3.87` PR 6a (ADR 0099 Amendment 3 A3, plan D12) — the upload handler is
 * the copilot's multipart Confirm target: it carries `@CopilotUploadRoute()`,
 * and its interceptors are multer's `FileInterceptor` first and the route
 * stage second, so the stage reads the parsed fields and file. Vitest entry
 * point: the sibling `.test.ts` (ADR 0014).
 */
const handler = MimicSymbolLibrariesController.prototype.uploadSymbol;

export function theUploadHandlerIsMarked(): void {
  expect(Reflect.getMetadata(COPILOT_UPLOAD_ROUTE, handler)).toBe(true);
}

export function theRouteStageFollowsMulter(): void {
  const interceptors = (Reflect.getMetadata(INTERCEPTORS_METADATA, handler) ?? []) as unknown[];
  expect(interceptors).toHaveLength(2);
  // `FileInterceptor` returns a mixin class with a random name: it is the other interceptor, and it intercepts.
  const multer = interceptors[0] as { prototype?: { intercept?: unknown } };
  expect(multer).not.toBe(CopilotUploadChangeInterceptor);
  expect(typeof multer.prototype?.intercept).toBe("function");
  expect(interceptors[1]).toBe(CopilotUploadChangeInterceptor);
}

/** No other handler of the controller is a copilot upload target. */
export function noOtherHandlerIsMarked(): void {
  const names = Object.getOwnPropertyNames(MimicSymbolLibrariesController.prototype).filter((name) => name !== "constructor");
  const marked = names.filter(
    (name) => Reflect.getMetadata(COPILOT_UPLOAD_ROUTE, (MimicSymbolLibrariesController.prototype as unknown as Record<string, object>)[name] as object) === true,
  );
  expect(marked).toEqual(["uploadSymbol"]);
}
