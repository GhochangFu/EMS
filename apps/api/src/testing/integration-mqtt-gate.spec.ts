import { integrationMqttVerdict, requireIntegrationMqtt } from "./integration-mqtt-gate";

/**
 * `F3.24b` — the pure half of the MQTT broker gate, on the
 * `integration-redis-gate.spec.ts` shape: the guard's failure mode is a green
 * run, so the verdict is asserted directly, per input combination.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function withEnv<T>(env: { MQTT_TEST_URL?: string; CI?: string }, run: () => T): T {
  const saved = { MQTT_TEST_URL: process.env.MQTT_TEST_URL, CI: process.env.CI };
  const restore = (key: "MQTT_TEST_URL" | "CI", value: string | undefined): void => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };
  try {
    restore("MQTT_TEST_URL", env.MQTT_TEST_URL);
    restore("CI", env.CI);
    return run();
  } finally {
    restore("MQTT_TEST_URL", saved.MQTT_TEST_URL);
    restore("CI", saved.CI);
  }
}

export function assertSetUrlRunsLocally(): void {
  assert(integrationMqttVerdict({ MQTT_TEST_URL: "mqtt://127.0.0.1:1883" }).kind === "run", "a set URL locally must run");
}

export function assertSetUrlRunsInCi(): void {
  assert(
    integrationMqttVerdict({ MQTT_TEST_URL: "mqtt://127.0.0.1:1883", CI: "true" }).kind === "run",
    "a set URL in CI must run",
  );
}

export function assertUnsetLocallySkips(): void {
  assert(integrationMqttVerdict({}).kind === "skip", "no broker and not CI must skip");
}

export function assertUnsetInCiRefuses(): void {
  assert(integrationMqttVerdict({ CI: "true" }).kind === "refuse", "no broker in CI must refuse, never skip");
}

export function assertCiIsDetectedByValue(): void {
  assert(integrationMqttVerdict({ CI: "1" }).kind === "refuse", 'CI="1" must count as CI');
  for (const value of ["false", "0", "", "TRUE"]) {
    assert(integrationMqttVerdict({ CI: value }).kind === "skip", `CI="${value}" must not count as CI`);
  }
}

export function assertRefusalThrowsWithTheCallersReason(): void {
  let thrown: unknown;
  withEnv({ CI: "true" }, () => {
    try {
      requireIntegrationMqtt({ item: "F0.0", label: "probe tests", because: "SENTINEL-REASON-77aa" });
    } catch (err) {
      thrown = err;
    }
  });
  const message = (thrown as { message?: string } | undefined)?.message ?? "";
  assert(
    message.includes("SENTINEL-REASON-77aa") && message.includes("F0.0"),
    `requireIntegrationMqtt must throw under CI with the caller's reason; got: ${message || "no throw"}`,
  );
}

export function assertSkipReturnsUndefined(): void {
  const originalWrite = process.stderr.write.bind(process.stderr);
  const written: string[] = [];
  (process.stderr as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    written.push(String(chunk));
    return true;
  };
  try {
    const result = withEnv({}, () => requireIntegrationMqtt({ item: "F0.0", label: "probe tests", because: "unused" }));
    assert(result === undefined, "the skip path must return undefined");
    assert(written.join("").includes("MQTT_TEST_URL=mqtt://127.0.0.1:1883"), "the skip note must name the value to set");
  } finally {
    (process.stderr as unknown as { write: typeof originalWrite }).write = originalWrite;
  }
}
