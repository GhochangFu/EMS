import "reflect-metadata";

import { parseMqttPlaintextHosts } from "@bms/shared";

import { buildConnectOptions, PRODUCTION_TRANSPORT_OPTIONS } from "./discovery-transport";
import { build, draftWith, lastStored, PAYLOAD, runFully } from "./discovery-job.service.spec";

/**
 * `F4.326` / ADR 0114 decision 4 — discovery follows the plain-MQTT rule (ruling
 * Q2): `mqtt://` only for a draft RTU with the literal `tls: false` whose host
 * is on `MQTT_PLAINTEXT_HOSTS`; an unlisted one is the refusal class
 * `plaintext not allowed` and never connects. The host guard runs first.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const PLAIN_DRAFT = draftWith({ config: { host: "Plain.Example", port: 1883, tls: false, topic: "t" } });
const LISTED = parseMqttPlaintextHosts("plain.example");

/** J1 — unlisted (or no list at all): failed, one refuse row, zero connects. */
export async function assertUnlistedPlainIsRefused(): Promise<void> {
  for (const plaintextHosts of [undefined, parseMqttPlaintextHosts("other.example")]) {
    const { service, probe } = build({ draft: PLAIN_DRAFT, ...(plaintextHosts ? { plaintextHosts } : {}) });
    const result = await service.run({ ...PAYLOAD, tls: false }, { tx: "a" } as never);
    const refuse = probe.audits.filter((a) => a.action === "onboarding.discovery.refuse");
    assert(result === undefined && probe.connects.length === 0, "an unlisted plain RTU never connects");
    assert(
      lastStored(probe)?.status === "failed" && lastStored(probe)?.error === "plaintext not allowed",
      `stored failed/plaintext not allowed; got ${JSON.stringify(lastStored(probe))}`,
    );
    assert(
      refuse.length === 1 && refuse[0]?.payload.refusal === "plaintext not allowed",
      `one refuse row; got ${JSON.stringify(probe.audits)}`,
    );
  }
}

/** J2 — listed (case-insensitive): connects `mqtt`, still passing `rejectUnauthorized: true` (ruling 8). */
export async function assertListedPlainConnectsMqtt(): Promise<void> {
  const { service, probe } = build({ draft: PLAIN_DRAFT, plaintextHosts: LISTED });
  const result = await service.run({ ...PAYLOAD, tls: false }, { tx: "a" } as never);
  if (typeof result === "object" && result !== null) await result.afterCommit();
  const c = probe.connects[0];
  assert(c?.protocol === "mqtt", `a listed plain RTU connects mqtt; got ${String(c?.protocol)}`);
  assert(c?.rejectUnauthorized === true, "rejectUnauthorized is kept (ruling 8)");
  assert(lastStored(probe)?.status === "done", `the window finishes; got ${String(lastStored(probe)?.status)}`);
}

/** J3 — the list alone never selects plain: a TLS RTU on a listed host stays `mqtts`. */
export async function assertTheListAloneNeverSelectsPlain(): Promise<void> {
  for (const tls of [undefined, true, "false"]) {
    const config: Record<string, unknown> = { host: "plain.example", port: 8883, topic: "t" };
    if (tls !== undefined) config.tls = tls;
    const { service, probe } = build({ draft: draftWith({ config }), plaintextHosts: LISTED });
    await runFully(service);
    assert(probe.connects[0]?.protocol === "mqtts", `tls=${String(tls)} must connect mqtts`);
  }
}

/** J4 — the host guard runs before the plain check: a blocked host is `blocked host`, listed or not. */
export async function assertBlockedHostWinsOverThePlainCheck(): Promise<void> {
  const { service, probe } = build({
    draft: PLAIN_DRAFT,
    resolution: { ok: false, error: "blocked host", reason: "own subnet" },
  });
  await service.run({ ...PAYLOAD, tls: false }, { tx: "a" } as never);
  const refuse = probe.audits.filter((a) => a.action === "onboarding.discovery.refuse");
  assert(
    refuse.length === 1 && refuse[0]?.payload.refusal === "blocked host" && probe.connects.length === 0,
    `blocked host wins; got ${JSON.stringify(probe.audits)}`,
  );
}

/** J5 — `buildConnectOptions` picks `mqtt` only on `plaintext`; the production transport stays `mqtts`. */
export function assertConnectOptionsFollowThePlainChoice(): void {
  const input = { address: "203.0.113.7", typedHost: "plain.example", port: 1883, discoveryId: PAYLOAD.discoveryId, credentials: {} };
  assert(buildConnectOptions({ ...input, plaintext: true }, PRODUCTION_TRANSPORT_OPTIONS).protocol === "mqtt", "plain → mqtt");
  assert(buildConnectOptions({ ...input, plaintext: false }, PRODUCTION_TRANSPORT_OPTIONS).protocol === "mqtts", "TLS → mqtts");
  assert(PRODUCTION_TRANSPORT_OPTIONS.protocol === "mqtts", "the production transport itself is unchanged");
}

/**
 * J6 — `F4.326` security review L1: the job connects with the TLS choice the
 * user confirmed (the route puts it in the payload), not with whatever the draft
 * says when the worker runs. A draft switched to `tls: false` after a "TLS: on"
 * card fails with no connection, even on a listed host; a payload with no `tls`
 * (queued before this field existed) reads as on.
 */
export async function assertTheConfirmedTlsChoiceBindsTheJob(): Promise<void> {
  for (const payload of [{ ...PAYLOAD, tls: true }, PAYLOAD]) {
    const { service, probe } = build({ draft: PLAIN_DRAFT, plaintextHosts: LISTED });
    const result = await service.run(payload, { tx: "a" } as never);
    assert(result === undefined && probe.connects.length === 0, "a changed TLS choice never connects");
    assert(lastStored(probe)?.status === "failed", `failed; got ${JSON.stringify(lastStored(probe))}`);
  }
  const { service, probe } = build({ draft: PLAIN_DRAFT, plaintextHosts: LISTED });
  const result = await service.run({ ...PAYLOAD, tls: false }, { tx: "a" } as never);
  if (typeof result === "object" && result !== null) await result.afterCommit();
  assert(probe.connects[0]?.protocol === "mqtt", "the confirmed plain choice connects mqtt");
}
