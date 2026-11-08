import "reflect-metadata";

import { build, draftWith, lastStored, PAYLOAD, runFully } from "./discovery-job.service.spec";

/**
 * `F4.334` / ADR 0116 decision 8 (plan T4.2) — the job reads the catalog in
 * phase A with the draft RTU's chosen format first, and stores the per-reason
 * skip counts. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CONFIG = { host: "broker.example.com", port: 8883, tls: true, topic: "Airsprint-1051/Data" };

/** F1 — the draft RTU's `payloadFormat` is the chosen code; with none, nothing is chosen. */
export async function theChosenFormatReachesTheCatalogRead(): Promise<void> {
  const chosen = build({ draft: draftWith({ config: { ...CONFIG, payloadFormat: "thinkiot-register-array" } }) });
  await runFully(chosen.service);
  assert(
    JSON.stringify(chosen.probe.formatChoices) === JSON.stringify(["thinkiot-register-array"]),
    `the chosen code reaches the read; got ${JSON.stringify(chosen.probe.formatChoices)}`,
  );
  const none = build({});
  await runFully(none.service);
  assert(
    none.probe.formatChoices?.length === 1 && none.probe.formatChoices[0] === undefined,
    `no payloadFormat chooses nothing; got ${JSON.stringify(none.probe.formatChoices)}`,
  );
}

/** F2 — a code the catalog does not hold still runs: discovery tries every format. */
export async function anUnknownChosenCodeStillRuns(): Promise<void> {
  const { service, probe } = build({ draft: draftWith({ config: { ...CONFIG, payloadFormat: "no-such" } }) });
  await runFully(service);
  assert(lastStored(probe)?.status === "done", `the discovery still runs; got ${JSON.stringify(lastStored(probe))}`);
}

/** F3 — the finish stores and audits `skippedReasons`; an invalid row is logged by code only. */
export async function theSkipReasonsAreStoredAndAudited(): Promise<void> {
  const { service, probe } = build({ invalidFormats: ["broken-format"] });
  await runFully(service);
  const stored = lastStored(probe);
  assert(
    stored?.skippedReasons !== undefined && JSON.stringify(stored.skippedReasons) === "{}",
    `the stored result carries skippedReasons; got ${JSON.stringify(stored)}`,
  );
  const finish = probe.audits.find((a) => a.action === "onboarding.discovery.finish");
  assert(finish?.payload.skippedReasons !== undefined, `the finish row carries skippedReasons; got ${JSON.stringify(finish)}`);
  const logged = JSON.stringify(probe.logs);
  assert(logged.includes("broken-format"), `the invalid row is named by code; got ${logged}`);
  assert(PAYLOAD.discoveryId.length > 0 && logged.includes(PAYLOAD.discoveryId), "the line carries the ids");
}
