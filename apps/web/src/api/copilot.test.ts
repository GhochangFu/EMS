import { afterEach, describe, it, vi } from "vitest";

import {
  aTurnWithFilesIsSentAsFormData,
  aTurnWithFilesSetsNoContentType,
  aTurnWithoutFilesIsSentAsJson,
  anEmptyFileListIsSentAsJson,
} from "./copilot.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: the project's `node` default.
 */
describe("F3.87 PR 8 — sendCopilotTurn (ADR 0099 Amendment 3 A4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a turn with files as FormData: message, then one files entry per file", () =>
    aTurnWithFilesIsSentAsFormData());
  it("sets no Content-Type of its own on a turn with files", () => aTurnWithFilesSetsNoContentType());
  it("sends a turn without files as JSON", () => aTurnWithoutFilesIsSentAsJson());
  it("sends a turn with an empty file list as JSON", () => anEmptyFileListIsSentAsJson());
});
