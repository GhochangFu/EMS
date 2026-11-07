import { describe, it } from "vitest";

import {
  runDiffChangedDeviceSetReplacesTests,
  runDiffGoneEndpointStopsTests,
  runDiffOrderingTests,
  runDiffPurityTests,
  runDiffSameDeviceSetSwapsIndexTests,
  runDiffStartsNewEndpointsTests,
  runRegistryBootTests,
  runRegistryFailureIsolationTests,
  runRegistryLogsNoCredentialsTests,
  runRegistryNoOverlapTests,
  runRegistryReplaceAwaitsStopTests,
  runRegistryStopAllTests,
  runRegistryStopAndStoppedBacklogTests,
  runRegistrySwapIndexTests,
} from "./reconcile.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("reload reconciliation — the pure diff (ADR 0115 decision 6)", () => {
  it("starts every endpoint that is not running", () => {
    runDiffStartsNewEndpointsTests();
  });

  it("swaps the point index only when the device set is unchanged", () => {
    runDiffSameDeviceSetSwapsIndexTests();
  });

  it("replaces an endpoint whose device set changed, naming added and removed", () => {
    runDiffChangedDeviceSetReplacesTests();
  });

  it("stops an endpoint that is no longer in the plan", () => {
    runDiffGoneEndpointStopsTests();
  });

  it("orders stops and replaces before starts, stable by key (plan R10)", () => {
    runDiffOrderingTests();
  });

  it("reads no clock and mutates nothing", () => {
    runDiffPurityTests();
  });
});

describe("reload reconciliation — the endpoint registry", () => {
  it("builds and starts each plan at boot", async () => {
    await runRegistryBootTests();
  });

  it("awaits the old stop() before building the replacement (plan R10)", async () => {
    await runRegistryReplaceAwaitsStopTests();
  });

  it("drops a stopped endpoint and lists it only while it holds a backlog (plan R7)", async () => {
    await runRegistryStopAndStoppedBacklogTests();
  });

  it("refuses an overlapping reload as busy and changes nothing (plan R6)", async () => {
    await runRegistryNoOverlapTests();
  });

  it("swaps the index a running supervisor reads without rebuilding it", async () => {
    await runRegistrySwapIndexTests();
  });

  it("logs a failed build or stop and still applies the other actions", async () => {
    await runRegistryFailureIsolationTests();
  });

  it("stops every running supervisor on stopAll and starts nothing after", async () => {
    await runRegistryStopAllTests();
  });

  it("never writes a credential to a log line", async () => {
    await runRegistryLogsNoCredentialsTests();
  });
});
