import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OnboardingDiscoveryErrorClass, OnboardingDiscoverySkipReason, OnboardingSessionDto } from "@bms/shared";
import {
  discoveryEmptySentence,
  discoveryIsActive,
  MQTT_DISCOVERY_SHARED_USER_WARNING,
  ONBOARDING_DRAFT_STRING_MAX,
} from "@bms/shared/contracts";

import { fetchMqttPayloadFormats, mqttPayloadFormatsQueryKey } from "../../api/admin/mqtt-payload-formats";
import { fetchOnboardingSession, patchOnboardingDraft } from "../../api/admin/onboarding";
import { apiErrorMessage } from "../../lib/api-error-message";
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

type Broker = { host: string; port: number; tls: boolean; topic: string };

function brokerOf(config: Record<string, unknown>): Broker | null {
  const { host, port, topic, mqttTopic, tls } = config;
  if (typeof host !== "string" || host === "" || typeof port !== "number") return null;
  const saved = [topic, mqttTopic].find((v) => typeof v === "string");
  // F4.326 (ADR 0114): only the literal `false` is plain, as ingest and the API read it.
  return { host, port, tls: tls !== false, topic: typeof saved === "string" ? saved : "" };
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
  "plaintext not allowed": "Failed: plain MQTT is not allowed for this broker host.",
};

/** `F4.334` (ADR 0116 decision 2): the format an RTU with no `payloadFormat` decodes with. */
export const BUILTIN_PAYLOAD_FORMAT = "thinkiot-envelope";

/** `F4.335`: one fixed phrase per skip reason — counts only, never wire text. */
const SKIP_REASON_TEXT: Record<OnboardingDiscoverySkipReason, string> = {
  "no-format": "matched no known payload format",
  oversize: "were too large",
  "unusable-topic": "had an unusable topic",
  "unusable-device-key": "had an unusable device key",
};

/** "Not decoded: 4 matched no known payload format, 2 were too large." — or null when nothing was skipped. */
export function skippedReasonsLine(d: NonNullable<OnboardingSessionDto["discovery"]>): string | null {
  if (d.skipped <= 0) return null;
  const parts = (Object.keys(SKIP_REASON_TEXT) as OnboardingDiscoverySkipReason[])
    .filter((reason) => (d.skippedReasons?.[reason] ?? 0) > 0)
    .map((reason) => `${d.skippedReasons?.[reason] ?? 0} ${SKIP_REASON_TEXT[reason]}`);
  return parts.length === 0 ? `Not decoded: ${d.skipped}.` : `Not decoded: ${parts.join(", ")}.`;
}

/** The draft config with `payloadFormat` set, or removed for the built-in (plan T5.3). */
export function withPayloadFormat(config: Record<string, unknown>, code: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  if (code === BUILTIN_PAYLOAD_FORMAT) {
    delete next.payloadFormat;
  } else {
    next.payloadFormat = code;
  }
  return next;
}

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
  const [formatError, setFormatError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  // F4.334 (plan T5.3): the catalog for the per-RTU format picker.
  const formats = useQuery({ queryKey: mqttPayloadFormatsQueryKey, queryFn: fetchMqttPayloadFormats });
  const formatMutation = useMutation({
    mutationFn: (vars: { index: number; code: string }) =>
      patchOnboardingDraft(session.id, {
        rtus: (session.draft?.rtus ?? []).map((rtu, i) =>
          i === vars.index ? { ...rtu, config: withPayloadFormat(rtu.config, vars.code) } : rtu,
        ),
      }),
    onSuccess: (updated) => {
      setFormatError(null);
      onSessionChange(updated);
      queryClient.setQueryData(["onboarding", updated.id], updated);
    },
    onError: (err: Error) => setFormatError(apiErrorMessage(err)),
  });
  // F4.339 (ADR 0117 decision 6, ruling Q2): one found device → its devId as the discovered RTU's device key.
  const deviceKeyMutation = useMutation({
    mutationFn: (vars: { index: number; devId: string }) =>
      patchOnboardingDraft(session.id, {
        rtus: (session.draft?.rtus ?? []).map((rtu, i) => (i === vars.index ? { ...rtu, rtuCode: vars.devId, ingestEnabled: true } : rtu)),
      }),
    onSuccess: (updated) => {
      setFormatError(null);
      onSessionChange(updated);
      queryClient.setQueryData(["onboarding", updated.id], updated);
    },
    onError: (err: Error) => setFormatError(apiErrorMessage(err)),
  });
  const rtus = session.draft?.rtus ?? [];
  const mqtt = rtus.map((rtu, index) => ({ rtu, index })).filter(({ rtu }) => rtu.protocol === "mqtt");
  if (mqtt.length === 0) return null;

  const result = session.discovery;
  const deviceKeyIndex = result === null ? -1 : rtus.findIndex((rtu) => rtu.code === result.rtuCode);
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
                <span className="font-mono text-2xs">{rtu.code ?? `RTU ${index + 1}`}</span>
                <button
                  type="button"
                  className="surface-button px-2 py-1 text-2xs disabled:opacity-50"
                  disabled={active || reason !== null || busy || broker === null}
                  aria-busy={busy}
                  onClick={() => setWizardFor(index)}
                >
                  {busy ? "Waiting for the chat turn…" : `Discover devices on ${rtu.code ?? `RTU ${index + 1}`}`}
                </button>
              </div>
              {reason !== null && <p className="mt-1 text-2xs text-ink-muted">{reason}</p>}
              {formats.data !== undefined && (
                <label className="mt-1 flex items-center gap-2 text-2xs">
                  <span>Payload format</span>
                  <select
                    className="surface-field px-1 py-0.5 text-2xs"
                    value={typeof rtu.config.payloadFormat === "string" ? rtu.config.payloadFormat : BUILTIN_PAYLOAD_FORMAT}
                    disabled={busy || formatMutation.isPending}
                    onChange={(event) => formatMutation.mutate({ index, code: event.target.value })}
                  >
                    {formats.data.map((format) => (
                      <option key={format.code} value={format.code}>
                        {format.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="mt-1 text-2xs text-ink-muted">{MQTT_DISCOVERY_SHARED_USER_WARNING}</p>
            </li>
          );
        })}
      </ul>
      {result !== null && (
        <div className="mt-2 text-2xs">
          <p>{statusLine(result, active)}</p>
          {/* F4.335: when messages arrived and none decoded, say so (fixed text, counts only). */}
          {result.status === "done" && result.devices.length === 0 && <p>{discoveryEmptySentence(result)}</p>}
          {result.status === "done" && skippedReasonsLine(result) !== null && (
            <p className="text-ink-muted">{skippedReasonsLine(result)}</p>
          )}
        </div>
      )}
      {formatError !== null && <p className="mt-1 text-2xs text-critical-ink">{formatError}</p>}
      {result !== null && result.status === "done" && result.devices.length > 0 && (
        <ul aria-label="Discovered devices" className="mt-2 space-y-1 text-2xs">
          {result.devices.slice(0, LISTED_ROWS).map((device) => (
            <li key={`${device.topic}-${device.devId}`} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{device.devId}</span>
              <span className="text-ink-muted">{device.topic}</span>
              <StatusPill label={device.payloadFormat ?? BUILTIN_PAYLOAD_FORMAT} tone="info" />
            </li>
          ))}
          {result.devices.length > LISTED_ROWS && (
            <li className="text-ink-muted">{`and ${result.devices.length - LISTED_ROWS} more`}</li>
          )}
        </ul>
      )}
      {result !== null &&
        result.status === "done" &&
        result.devices.length === 1 &&
        deviceKeyIndex >= 0 &&
        // A devId longer than `rtuCode` holds is not offered: the PATCH would be refused (code review).
        result.devices[0]!.devId.length <= ONBOARDING_DRAFT_STRING_MAX["rtus.rtuCode"] && (
        <button
          type="button"
          className="mt-1 rounded border border-hairline px-2 py-0.5 text-2xs"
          disabled={busy || deviceKeyMutation.isPending}
          aria-busy={deviceKeyMutation.isPending}
          onClick={() => deviceKeyMutation.mutate({ index: deviceKeyIndex, devId: result.devices[0]!.devId })}
        >
          {deviceKeyMutation.isPending ? "Saving the RTU code…" : `Use ${result.devices[0]!.devId} as the RTU code`}
        </button>
      )}
      {discovered.length > 0 && (
        <ul aria-label="Discovered mappings" className="mt-2 space-y-1 text-2xs">
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
          rtu={{ code: wizardRtu.code ?? "", host: wizardBroker.host, port: wizardBroker.port, tls: wizardBroker.tls, topic: wizardBroker.topic }}
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
