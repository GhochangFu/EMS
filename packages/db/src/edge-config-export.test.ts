import { describe, it } from "vitest";

import {
  runAnRtuNotExportedIsListed,
  runNothingToExportIsNoFile,
  runOneEndpointPerHostAndPort,
  runOnlyMappedRegistersAndNoSourceKeys,
  runTheArgumentsAreStrict,
  runTheFileIsOwnerOnlyAndNotOverwritten,
  runTheFileParsesThroughEverySchema,
  runTheIntervalIsTheResolvedValue,
} from "./edge-config-export.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the edge export (ADR 0141 decision 17, Amendment 1 (d))", () => {
  it("E1 — the file parses through edgeConfigFileSchema and the adapter's schemas", () => runTheFileParsesThroughEverySchema());
  it("E2 — RTUs on one host:port share one endpoint", () => runOneEndpointPerHostAndPort());
  it("E3 — pollIntervalMs is the resolved value", () => runTheIntervalIsTheResolvedValue());
  it("E4 — only mapped registers, and no sourceKeys key", () => runOnlyMappedRegistersAndNoSourceKeys());
  it("E5 — an RTU not exported is listed with its reason", () => runAnRtuNotExportedIsListed());
  it("E6 — nothing to export is no file", () => runNothingToExportIsNoFile());
  it("E7 — the CLI arguments are strict", () => runTheArgumentsAreStrict());
  it("E8 — the file is owner-only and not overwritten without --force", () => runTheFileIsOwnerOnlyAndNotOverwritten());
});
