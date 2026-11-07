import { expect } from "vitest";

import {
  MQTT_PLAINTEXT_HOSTS_ENV,
  MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE,
  MqttPlaintextHostsConfigError,
  mqttConfigSchema,
  mqttDraftConfigSchema,
  mqttPlaintextDecision,
  parseMqttPlaintextHosts,
} from "./mqtt";

/**
 * `F4.326` / ADR 0114 decisions 1 and 2 — the plain-MQTT allowlist parser, the
 * one decision predicate the ingest host, discovery and the validator share, and
 * the `tls` config field.
 *
 * Assertions live here; `mqtt-plaintext.test.ts` is the vitest entry point
 * (ADR 0014). One claim per function.
 */

/** The message a throw carried; fails when nothing was thrown. */
function thrownMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MqttPlaintextHostsConfigError);
    return (error as Error).message;
  }
  throw new Error("expected a throw");
}

/** P1 — unset, empty and blank all mean "no host may connect plain" (today's behaviour). */
export function assertBlankInputParsesToAnEmptySet(): void {
  expect(MQTT_PLAINTEXT_HOSTS_ENV).toBe("MQTT_PLAINTEXT_HOSTS");
  for (const raw of [undefined, "", "   ", " , ,"]) {
    expect(parseMqttPlaintextHosts(raw).size, String(raw)).toBe(0);
  }
}

/** P2 — entries are split on commas, trimmed and lower-cased. */
export function assertEntriesAreTrimmedAndLowerCased(): void {
  expect([...parseMqttPlaintextHosts(" Broker.Example.com , 10.0.0.5,b.example ")].sort()).toEqual([
    "10.0.0.5",
    "b.example",
    "broker.example.com",
  ]);
}

/** P3 — a bad entry is a refusal that names its position, never its text (R2). */
export function assertABadEntryThrowsByPositionOnly(): void {
  const message = thrownMessage(() => parseMqttPlaintextHosts("ok.example, a.example:1883"));
  expect(message).toBe("MQTT_PLAINTEXT_HOSTS entry 2 is not a host name");
  expect(message).not.toContain("a.example");
}

/** P4 — wildcards, IPv6, ports, paths, credentials and whitespace are refused (ruling 9). */
export function assertTheGrammarRefusesNonHostNames(): void {
  for (const raw of [
    "*.example",
    "[::1]",
    "::1",
    "a b",
    "a.example/x",
    "u@a.example",
    "a..example",
    "-a.example",
    "a-.example",
    `${"a".repeat(64)}.example`,
    `${"a.".repeat(127)}ab`,
  ]) {
    expect(() => parseMqttPlaintextHosts(raw), raw).toThrow(MqttPlaintextHostsConfigError);
  }
  // Positive twins: a host name, a single label and an IPv4 literal pass.
  expect(parseMqttPlaintextHosts("shapoorji.thinkiot.co.in,mosquitto,10.0.0.5").size).toBe(3);
}

/** P5 — only the literal `false` asks for plain; every other value is TLS. */
export function assertOnlyLiteralFalseSelectsPlain(): void {
  const allowed = parseMqttPlaintextHosts("a.example");
  for (const tls of [undefined, true, "false", 0, null]) {
    expect(mqttPlaintextDecision(tls, "a.example", allowed), String(tls)).toBe("tls");
  }
  expect(mqttPlaintextDecision(false, "a.example", allowed)).toBe("plain");
}

/** P6 — a listed host matches case-insensitively; an unlisted one is refused, never TLS. */
export function assertListedIsPlainAndUnlistedIsRefused(): void {
  const allowed = parseMqttPlaintextHosts("a.example");
  expect(mqttPlaintextDecision(false, "A.Example", allowed)).toBe("plain");
  expect(mqttPlaintextDecision(false, "b.example", allowed)).toBe("refused");
  expect(mqttPlaintextDecision(false, "a.example", new Set())).toBe("refused");
  // No host at all (ruling 6): nothing to match, so refused.
  expect(mqttPlaintextDecision(false, undefined, allowed)).toBe("refused");
  expect(mqttPlaintextDecision(false, "", allowed)).toBe("refused");
  // The list alone never selects plain.
  expect(mqttPlaintextDecision(undefined, "a.example", allowed)).toBe("tls");
}

/** P7 — the fixed refusal names no host (ADR 0114 decision 5, §9.6). */
export function assertTheRefusalMessageIsFixed(): void {
  expect(MQTT_PLAINTEXT_NOT_ALLOWED_MESSAGE).toBe(
    "Plain MQTT is not allowed for this broker host; ask the operator to add it to MQTT_PLAINTEXT_HOSTS",
  );
}

/** P8 — `tls` defaults on, keeps an explicit `false`, and refuses the string `"false"`. */
export function assertTheConfigSchemaTlsField(): void {
  expect(mqttConfigSchema.parse({ host: "h", port: 8883 }).tls).toBe(true);
  expect(mqttConfigSchema.parse({ host: "h", port: 1883, tls: false }).tls).toBe(false);
  expect(mqttConfigSchema.safeParse({ host: "h", port: 1883, tls: "false" }).success).toBe(false);
}

/** P9 — the draft schema checks `tls` as a boolean and names its path. */
export function assertTheDraftSchemaTlsField(): void {
  const refused = mqttDraftConfigSchema.safeParse({ tls: "false" });
  expect(refused.success).toBe(false);
  expect(refused.success ? [] : refused.error.issues.map((i) => i.path.join("."))).toEqual(["tls"]);
  for (const tls of [true, false]) {
    const kept = mqttDraftConfigSchema.safeParse({ tls, host: "h", port: 1883 });
    expect(kept.success && kept.data.tls, String(tls)).toBe(tls);
  }
}
