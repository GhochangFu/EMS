import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { OnboardingSessionDto, StartOnboardingDiscoveryBody, StartOnboardingDiscoveryResponseDto } from "@bms/shared";
import {
  MQTT_DISCOVERY_DEFAULT_WINDOW_SECONDS,
  MQTT_DISCOVERY_SHARED_USER_WARNING,
} from "@bms/shared/contracts";
import {
  type CatalogEntry,
  catalogEntry,
  type OnboardingCommitDraft,
  onboardingCommitSiteName,
} from "@bms/shared/copilot";

import { startOnboardingDiscovery } from "../../api/admin/onboarding";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import { WizardShell } from "../wizard/wizard-shell";

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.24b: the catalog has no entry "${id}"`);
  return entry;
}

/** A refused Submit (409): a discovery is already queued or running, or the RTU's broker changed. */
export const ONBOARDING_DISCOVERY_CONFLICT =
  "A discovery is already running on this draft, or the RTU's broker changed. Review the draft, then try again.";

/** The draft RTU whose broker the wizard listens on. */
export type OnboardingDiscoveryRtu = { code: string; host: string; port: number; topic?: string | null };

/** The saved topic up to its last "/" (`Airsprint-1051/Data/1051` → `Airsprint-1051/Data`); the topic itself when it has none. */
export function defaultDiscoveryTopicPrefix(topic: string | null | undefined): string {
  const t = (topic ?? "").trim();
  const cut = t.lastIndexOf("/");
  return cut > 0 ? t.slice(0, cut) : t;
}

type OnboardingDiscoveryWizardProps = {
  session: OnboardingSessionDto;
  rtu: OnboardingDiscoveryRtu;
  onStarted: (result: StartOnboardingDiscoveryResponseDto) => void;
  onClose: () => void;
};

/**
 * `F3.24b` (ADR 0103 decision 2) — the `onboarding.discovery` stepper: the
 * manual twin of the server-made Confirm card. It sends the same body
 * (`rtuCode`, `expected` = the broker shown here, `topicPrefix`,
 * `windowSeconds`) without the `X-Copilot-Change` header. TLS is always on
 * (build decision Q5), so there is no TLS field.
 */
export function OnboardingDiscoveryWizard({ session, rtu, onStarted, onClose }: OnboardingDiscoveryWizardProps) {
  const [error, setError] = useState<string | null>(null);
  // The title and the summary read this; the `<WizardShell entry=…>` below keeps its own literal call,
  // because the stepper gate (`tests/f3.85-stepper-coverage.test.ts`) reads only that form, not a variable.
  const entry = wizardEntry("onboarding.discovery");
  const [values, setValues] = useState<Record<string, unknown>>({
    rtuCode: rtu.code,
    expected: { host: rtu.host, port: rtu.port },
    topicPrefix: defaultDiscoveryTopicPrefix(rtu.topic),
    windowSeconds: MQTT_DISCOVERY_DEFAULT_WINDOW_SECONDS,
  });
  const startM = useMutation({
    mutationFn: (body: StartOnboardingDiscoveryBody) => startOnboardingDiscovery(session.id, body),
    onSuccess: onStarted,
    onError: (cause: unknown) =>
      setError(cause instanceof ApiError && cause.status === 409 ? ONBOARDING_DISCOVERY_CONFLICT : apiErrorMessage(cause)),
  });
  const topicPrefix = typeof values.topicPrefix === "string" ? values.topicPrefix : "";
  const seconds = typeof values.windowSeconds === "number" ? values.windowSeconds : MQTT_DISCOVERY_DEFAULT_WINDOW_SECONDS;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim/40 p-4">
      <div role="dialog" aria-labelledby="onboarding-discovery-wizard-title" className="w-full max-w-lg space-y-3 surface-dialog p-4">
        <h2 id="onboarding-discovery-wizard-title" className="font-condensed text-lg font-bold">
          {entry.title}: {rtu.code}
        </h2>
        <WizardShell
          entry={wizardEntry("onboarding.discovery")}
          values={values}
          onChange={setValues}
          renderStep={() => (
            <div className="space-y-2 text-xs">
              <p>
                Broker: {rtu.host}:{rtu.port}. TLS: always on.
              </p>
              <label className="block">
                Topic prefix
                <input
                  aria-label="Topic prefix"
                  className="surface-field mt-1 w-full px-2 py-1 font-mono"
                  value={topicPrefix}
                  onChange={(e) => setValues({ ...values, topicPrefix: e.target.value })}
                />
              </label>
              <p>
                Filter: <span className="font-mono">{`${topicPrefix}/#`}</span>. Window: {seconds} s.
              </p>
              <p className="text-ink-muted">{MQTT_DISCOVERY_SHARED_USER_WARNING}</p>
            </div>
          )}
          onSubmit={(body) => {
            setError(null);
            startM.mutate(body as StartOnboardingDiscoveryBody);
          }}
          onCancel={onClose}
          submitting={startM.isPending}
          submitError={error}
          summary={entry.summary({
            body: values,
            params: { id: session.id },
            targetName: onboardingCommitSiteName((session.draft ?? {}) as OnboardingCommitDraft),
            organizationName: session.organizationName,
          })}
        />
      </div>
    </div>
  );
}
