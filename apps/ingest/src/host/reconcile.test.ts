import { describe, it } from "vitest";

import {
  runDiffChangedDeviceSetReplacesTests,
  runDiffCredentialFingerprintReplacesTests,
  runDiffFingerprintChangeReplacesTests,
  runDiffGoneEndpointStopsTests,
  runDiffOrderingTests,
  runDiffPurityTests,
  runDiffSameDeviceSetSwapsIndexTests,
  runDiffStartsNewEndpointsTests,
  runRegistryBootTests,
  runRegistryFailedLaunchListedTests,
  runRegistryFailureIsolationTests,
  runRegistryCredentialReplaceTests,
  runRegistryFingerprintReplaceLogsReasonTests,
  runRegistryLogsNoCredentialsTests,
  runRegistryNoOverlapTests,
  runRegistryRejectedApplyClearsBusyTests,
  runRegistryReplaceAwaitsStopTests,
  runRegistryScannedBacklogTests,
  runRegistryStartThrowsStopsTests,
  runRegistryStopAllDuringReplaceTests,
  runRegistryStopAllTests,
  runRegistryStopAndStoppedBacklogTests,
  runRegistryStopClearsIndexTests,
  runRegistryStoppedSortedTests,
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

  it("launches nothing once stopAll has begun, and stops the old supervisor once", async () => {
    await runRegistryStopAllDuringReplaceTests();
  });

  it("stops a supervisor that was built but whose start() threw", async () => {
    await runRegistryStartThrowsStopsTests();
  });

  it("empties a stopped endpoint's point index so a queued tail is not written", async () => {
    await runRegistryStopClearsIndexTests();
  });

  it("lists a key that failed to start while it holds a backlog", async () => {
    await runRegistryFailedLaunchListedTests();
  });

  it("returns stopped entries sorted by key", async () => {
    await runRegistryStoppedSortedTests();
  });

  it("clears the busy state when an apply rejects", async () => {
    await runRegistryRejectedApplyClearsBusyTests();
  });

  it("names a scanned backlog the boot plan does not start (ADR 0115 Amendment 1)", async () => {
    await runRegistryScannedBacklogTests();
  });
});

describe("reload reconciliation — the decoder fingerprint (ADR 0116 decision 6)", () => {
  it("replaces an endpoint whose payload format changed, with the reason", () => {
    runDiffFingerprintChangeReplacesTests();
  });

  it("rebuilds on a fingerprint change and logs payload-format-changed", async () => {
    await runRegistryFingerprintReplaceLogsReasonTests();
  });
});

describe("reload reconciliation — the credential fingerprint (ADR 0129 decision 4, F4.333)", () => {
  it("replaces an endpoint whose credential fingerprint moved, with its own reason", () => {
    runDiffCredentialFingerprintReplacesTests();
  });

  it("rebuilds with the new credential and logs no secret or fingerprint", async () => {
    await runRegistryCredentialReplaceTests();
  });
});
