import "reflect-metadata";

import { MODULE_METADATA } from "@nestjs/common/constants";
import { expect } from "vitest";

import { AdminModule } from "../admin/admin.module";
import { OnboardingDiscoveryModule } from "../onboarding-discovery/onboarding-discovery.module";
import {
  MQTT_PLAINTEXT_ALLOWLIST,
  mqttPlaintextAllowlistProvider,
  readMqttPlaintextAllowlist,
} from "./mqtt-plaintext-hosts";

/**
 * `F4.326` / ADR 0114 decision 1, plan T2.1 and ruling 10 — the API and worker
 * read of `MQTT_PLAINTEXT_HOSTS`. Vitest entry point: the sibling `.test.ts`.
 */

/** M1 — unset is empty; a list is trimmed and lower-cased. */
export function theReadParsesTheList(): void {
  expect(readMqttPlaintextAllowlist({}).size).toBe(0);
  expect([...readMqttPlaintextAllowlist({ MQTT_PLAINTEXT_HOSTS: " A.Example ,b.example" })].sort()).toEqual([
    "a.example",
    "b.example",
  ]);
}

/** M2 — the factory throws on a bad entry (a Nest boot refusal), naming the position only. */
export function theFactoryThrowsOnABadEntry(): void {
  const saved = process.env.MQTT_PLAINTEXT_HOSTS;
  process.env.MQTT_PLAINTEXT_HOSTS = "ok.example,secret.example:1883";
  try {
    let message = "";
    try {
      mqttPlaintextAllowlistProvider.useFactory();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("MQTT_PLAINTEXT_HOSTS entry 2 is not a host name");
  } finally {
    if (saved === undefined) delete process.env.MQTT_PLAINTEXT_HOSTS;
    else process.env.MQTT_PLAINTEXT_HOSTS = saved;
  }
}

function providersOf(module: object): unknown[] {
  return (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) as unknown[] | undefined) ?? [];
}

/** M3 — both modules that consume the token register the throwing provider (api and worker). */
export function bothModulesRegisterTheProvider(): void {
  expect(mqttPlaintextAllowlistProvider.provide).toBe(MQTT_PLAINTEXT_ALLOWLIST);
  expect(providersOf(AdminModule)).toContain(mqttPlaintextAllowlistProvider);
  expect(providersOf(OnboardingDiscoveryModule)).toContain(mqttPlaintextAllowlistProvider);
}
