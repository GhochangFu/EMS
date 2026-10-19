import { useState } from "react";
import type { OnboardingDiscoveryErrorClass, OnboardingSessionDto } from "@bms/shared";
import { discoveryIsActive, MQTT_DISCOVERY_SHARED_USER_WARNING } from "@bms/shared/contracts";

import { fetchOnboardingSession } from "../../api/admin/onboarding";
import { StatusPill } from "../status-pill";
import { OnboardingDiscoveryWizard } from "./onboarding-discovery-wizard";

/** The reason shown once the route answered 503: no worker is running to listen. */
export const DISCOVERY_NEEDS_WORKER = "Discovery needs the worker.";

/** Discovered rows listed before "and n more" (the draft caps the list far higher). */
const LISTED_ROWS = 50;

type DiscoveryPanelProps = {
  session: OnboardingSessionDto;
  /** The wizard started a discovery: the session is read again so the poll can begin. */
  onSessionChange: (session: OnboardingSessionDto) => void;
  /** A chat turn is in flight: the Discover button waits, as the other drawer writes do. */
  busy: boolean;
};

type Broker = { host: string; port: number; topic: string };

function brokerOf(config: Record<string, unknown>): Broker | null {
  const { host, port, topic, mqttTopic } = config;
  if (typeof host !== "string" || host === "" || typeof port !== "number") return null;
  const saved = [topic, mqttTopic].find((v) => typeof v === "string");
  return { host, port, topic: typeof saved === "string" ? saved : "" };
}

/**
 * One sentence per error class. The class is a closed enum, not an error's message, so a
 * lookup — rather than a template over `d.error` — keeps the F4.204 raw-message gate exact.
 */
const FAILED_SENTENCE: Record<OnboardingDiscoveryErrorClass, string> = {
  "auth refused": "Failed: auth refused.",
  "host unreachable": "Failed: host unreachable.",
  "TLS failed": "Failed: TLS failed.",
  timeout: "Failed: timeout.",
  "blocked host": "Failed: blocked host.",
};

/** A `running` discovery past its stale bound: the worker stopped or its final write failed. */
export const DISCOVERY_STALE_SENTENCE = "The discovery did not finish. You can start it again.";

function statusLine(d: NonNullable<OnboardingSessionDto["discovery"]>, active: boolean): string {
  if (d.status === "queued") return "A discovery is queued.";
  if (d.status === "running" && !active) return DISCOVERY_STALE_SENTENCE;
  if (d.status === "running") return `A discovery is running. It listens for up to ${d.windowSeconds} s.`;
  if (d.status === "failed") return d.error ? FAILED_SENTENCE[d.error] : "Failed.";
  const keys = d.devices.reduce((n, dev) => n + dev.keys.length, 0);
  const counts = `Done: ${d.devices.length} ${d.devices.length === 1 ? "device" : "devices"}, ${keys} ${keys === 1 ? "key" : "keys"}.`;
  return d.truncated ? `${counts} The result was cut at a limit.` : counts;
}

/**
 * `F3.24b` (ADR 0103) — the drawer's Discovery section. Per MQTT RTU a
 * Discover button opens the `onboarding.discovery` wizard; below it the status
 * the session carries (the dock polls it), the empty-result sentence and the
 * mappings the agent made from a discovery, each with the Discovered badge and
 * the key's sample value.
 *
 * **Why the worker reason is remembered here.** No `/health` read exists in the
 * web app, so the only evidence the worker is down is the route's own 503. The
 * panel keeps that answer until it unmounts (the drawer closing), then lets the
 * user try again.
 */
export function DiscoveryPanel({ session, onSessionChange, busy }: DiscoveryPanelProps) {
  const [wizardFor, setWizardFor] = useState<number | null>(null);
  const [workerDown, setWorkerDown] = useState(false);
  const rtus = session.draft?.rtus ?? [];
  const mqtt = rtus.map((rtu, index) => ({ rtu, index })).filter(({ rtu }) => rtu.protocol === "mqtt");
  if (mqtt.length === 0) return null;

  const result = session.discovery;
  // The route's own busy rule (`discoveryIsActive`): a `running` past its window + 60 s no longer holds the session.
  const active = discoveryIsActive(result, Date.now());
  const discovered = (session.draft?.assetPoints ?? []).filter((row) => row.source === "discovery");
  const samples = new Map<string, string | number | boolean>();
  for (const device of result?.devices ?? []) {
    for (const key of device.keys) if (!samples.has(key.sourceKey)) samples.set(key.sourceKey, key.sampleValue);
  }
  const wizardRtu = wizardFor === null ? null : rtus[wizardFor];
  const wizardBroker = wizardRtu ? brokerOf(wizardRtu.config) : null;

  return (
    <div>
      <div className="mb-1 font-semibold uppercase tracking-wide text-ink-muted">Discovery</div>
      <ul className="space-y-2">
        {mqtt.map(({ rtu, index }) => {
          const broker = brokerOf(rtu.config);
          const reason = active
            ? null
            : !rtu.credentialsSet
              ? "Set the RTU's credentials first."
              : broker === null
                ? "Set the RTU's broker host and port first."
                : workerDown
                  ? DISCOVERY_NEEDS_WORKER
                  : null;
          return (
            <li key={rtu.code ?? index} className="surface-raised-sm p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px]">{rtu.code ?? `RTU ${index + 1}`}</span>
                <button
                  type="button"
                  className="surface-button px-2 py-1 text-[11px] disabled:opacity-50"
                  disabled={active || reason !== null || busy || broker === null}
                  aria-busy={busy}
                  onClick={() => setWizardFor(index)}
                >
                  {busy ? "Waiting for the chat turn…" : `Discover devices on ${rtu.code ?? `RTU ${index + 1}`}`}
                </button>
              </div>
              {reason !== null && <p className="mt-1 text-[11px] text-ink-muted">{reason}</p>}
              <p className="mt-1 text-[11px] text-ink-muted">{MQTT_DISCOVERY_SHARED_USER_WARNING}</p>
            </li>
          );
        })}
      </ul>
      {result !== null && (
        <div className="mt-2 text-[11px]">
          <p>{statusLine(result, active)}</p>
          {result.status === "done" && result.devices.length === 0 && <p>No device published in the window.</p>}
        </div>
      )}
      {discovered.length > 0 && (
        <ul aria-label="Discovered mappings" className="mt-2 space-y-1 text-[11px]">
          {discovered.slice(0, LISTED_ROWS).map((row, i) => {
            const sample = samples.get(row.sourceDataKey);
            return (
              <li key={`${row.assetIndex}-${row.pointKey}-${i}`} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{`${row.sourceDataKey} → ${row.pointKey}`}</span>
                <StatusPill label="Discovered" tone="info" />
                {sample !== undefined && <span className="text-ink-muted">{`sample ${String(sample)}`}</span>}
              </li>
            );
          })}
          {discovered.length > LISTED_ROWS && <li className="text-ink-muted">{`and ${discovered.length - LISTED_ROWS} more`}</li>}
        </ul>
      )}
      {wizardRtu && wizardBroker && (
        <OnboardingDiscoveryWizard
          session={session}
          rtu={{ code: wizardRtu.code ?? "", host: wizardBroker.host, port: wizardBroker.port, topic: wizardBroker.topic }}
          onStarted={() => {
            setWizardFor(null);
            // The session carries the queued status; the dock's poll takes it from there.
            void fetchOnboardingSession(session.id).then(onSessionChange, () => undefined);
          }}
          onRefused={(status) => {
            if (status === 503) setWorkerDown(true);
          }}
          onClose={() => setWizardFor(null)}
        />
      )}
    </div>
  );
}
