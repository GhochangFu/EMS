import { describe, it } from "vitest";

import {
  runDarkKeyEscapeTests,
  runDarkPointTests,
  runDarkRtuEscapeTests,
  runDeviceStalenessTests,
  runEndpointKeyEscapeTests,
  runHealthRenderTests,
  runPlainIdentifierTests,
  runRtusMemberEscapeTests,
  runSkippedDetailEscapeTests,
  runSkippedRtuEscapeTests,
  runStaleRtuEscapeTests,
  runNoStoppedLineTests,
  runStoppedKeyEscapeTests,
  runStoppedLinePositionTests,
  runStoppedVerdictTests,
} from "./health-server.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("health endpoint", () => {
  it("reports per-endpoint state, loss counters and skipped RTUs", () => {
    runHealthRenderTests();
  });

  it("names a silent RTU on a connected endpoint", () => {
    runDeviceStalenessTests();
  });

  it("names a dark point on an RTU that is otherwise still talking", () => {
    runDarkPointTests();
  });

});

/** One `it()` per claim — `assert` throws, so a shared block hides later sites. */
describe("health endpoint: stopped endpoints (ADR 0115 decision 7)", () => {
  it("renders the stopped line between the endpoint lines and the stale lines", () => {
    runStoppedLinePositionTests();
  });

  it("percent-encodes a stopped endpoint's key", () => {
    runStoppedKeyEscapeTests();
  });

  it("renders no stopped line for an empty list", () => {
    runNoStoppedLineTests();
  });

  it("does not degrade the verdict for a stopped backlog", () => {
    runStoppedVerdictTests();
  });
});

/** One `it()` per claim — `assert` throws, so a shared block hides later sites. */
describe("health endpoint identifiers (F4.58 security review L1)", () => {
  it("a dark key with CR, LF, space, = and % stays one record", () => {
    runDarkKeyEscapeTests();
  });

  it("a dark record's RTU code is encoded", () => {
    runDarkRtuEscapeTests();
  });

  it("a stale RTU code with a newline stays one record and forges no header", () => {
    runStaleRtuEscapeTests();
  });

  it("ordinary identifiers render byte-identical", () => {
    runPlainIdentifierTests();
  });

  it("a | inside an RTU code cannot forge a second rtus= member", () => {
    runRtusMemberEscapeTests();
  });

  it("the endpoint key is encoded on every line that prints it", () => {
    runEndpointKeyEscapeTests();
  });

  it("a skipped RTU code is encoded; the (no rtu_code) literal is not", () => {
    runSkippedRtuEscapeTests();
  });

  it("a skip detail is encoded", () => {
    runSkippedDetailEscapeTests();
  });
});
