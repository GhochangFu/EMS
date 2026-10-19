/**
 * `F3.24b` (ADR 0103 *Verification owed*; decisions Q1) — the integration-test
 * MQTT broker gate, the `MQTT_TEST_URL` twin of `integration-redis-gate.ts`.
 *
 * **The same asymmetry.** Locally, an unset `MQTT_TEST_URL` means "no broker
 * handy" — skip, and say on stderr what to run. In CI it means the workflow
 * lost its `mosquitto` step — `ci.yml` starts `eclipse-mosquitto:2.0` and
 * exports the URL — so a skip would be a green run that proved nothing about
 * discovery against a real broker. So it **throws**.
 *
 * The verdict is a pure function of the environment, so
 * `integration-mqtt-gate.spec.ts` enumerates every combination directly.
 */

export type IntegrationMqttVerdict =
  | { readonly kind: "run"; readonly url: string }
  | { readonly kind: "skip" }
  | { readonly kind: "refuse" };

/** The decision — the same CI predicate the database and Redis gates use. */
export function integrationMqttVerdict(env: {
  MQTT_TEST_URL?: string | undefined;
  CI?: string | undefined;
}): IntegrationMqttVerdict {
  const url = env.MQTT_TEST_URL;
  const isCi = env.CI === "true" || env.CI === "1";
  if (url) {
    return { kind: "run", url };
  }
  return isCi ? { kind: "refuse" } : { kind: "skip" };
}

/**
 * Applies {@link integrationMqttVerdict} to the real environment at module
 * scope. Returns the URL, or `undefined` when the suite must skip — feed it to
 * `describe.skipIf(!mqttUrl)`. Throws on `refuse`: a `describe` that never
 * registers is indistinguishable from one that passed.
 */
export function requireIntegrationMqtt({
  item,
  label,
  because,
}: {
  item: string;
  label: string;
  because: string;
}): string | undefined {
  const verdict = integrationMqttVerdict(process.env);

  if (verdict.kind === "refuse") {
    throw new Error(`${item} ${label} have no MQTT_TEST_URL in CI. Refusing to skip — ${because}`);
  }

  if (verdict.kind === "skip") {
    // `process.stderr.write`, not `console.warn`: Vitest discards module-scope
    // console output from a skipped file.
    process.stderr.write(
      `\n[${item}] Skipping ${label}: MQTT_TEST_URL is not set.\n` +
        "        docker run -d --name mosquitto -p 1883:1883 -v \"$PWD/infra/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro\" eclipse-mosquitto:2.0\n" +
        "        MQTT_TEST_URL=mqtt://127.0.0.1:1883 npx vitest run apps/api/src/onboarding-discovery\n\n",
    );
    return undefined;
  }

  return verdict.url;
}
