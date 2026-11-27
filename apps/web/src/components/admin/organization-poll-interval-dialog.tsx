import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";

import type { AdminOrganizationDto } from "@bms/shared";

import { setOrganizationPollInterval } from "../../api/admin/organizations";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  isSlowPollInterval,
  parsePollIntervalSeconds,
  POLL_INTERVAL_RANGE_MESSAGE,
  POLL_INTERVAL_SLOW_WARNING,
  pollIntervalSecondsText,
} from "../../lib/poll-interval-input";

/** What a saved default changes on screen: the organization list and the RTU rows that inherit it. */
const QUERIES_AFTER_SAVE = [["admin", "organizations"], ["admin", "rtus"]] as const;

/**
 * `F1.2` (ADR 0141 decision 10, Amendment 1 (c), plan T7.4) — an organization's default poll
 * interval, between each endpoint's own value and the adapter default, on its own route (`PUT
 * …/poll-interval`). Opened from the row action **Poll interval** beside the ingest action, for the
 * global admin and an organization admin (ruling P12a); the API decides again on every write, so a
 * refusal is the server's sentence shown inline and the dialog stays open. Empty sends `null`; a
 * value above 360 s carries plan P4's warning.
 */
export function OrganizationPollIntervalDialog({
  organization,
  onClose,
}: {
  organization: AdminOrganizationDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [seconds, setSeconds] = useState(pollIntervalSecondsText(organization.defaultPollIntervalMs));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (defaultPollIntervalMs: number | null) =>
      setOrganizationPollInterval(organization.id, { defaultPollIntervalMs }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await Promise.all(QUERIES_AFTER_SAVE.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })));
      onClose();
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const parsed = parsePollIntervalSeconds(seconds);
    if (!parsed.ok) {
      setError(POLL_INTERVAL_RANGE_MESSAGE);
      return;
    }
    save.mutate(parsed.ms);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="organization-poll-interval-title"
        className="w-full max-w-md surface-dialog p-4"
        onSubmit={handleSubmit}
      >
        <h2 id="organization-poll-interval-title" className="font-condensed text-lg font-bold text-ink">
          Poll interval — {organization.name}
        </h2>
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-semibold text-ink-muted">
            Default poll interval (seconds)
            <input
              className="mt-1 w-full surface-field px-3 py-2 text-sm"
              inputMode="decimal"
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
            />
          </label>
          <p className="text-xs text-ink-muted">
            How often the platform reads this organization&apos;s polled devices (Modbus TCP and other poll
            protocols) when an endpoint sets no interval of its own. Empty uses each adapter&apos;s own default.
            MQTT is not affected: a device sets its own cadence. Applied at the ingest host&apos;s next reload.
          </p>
          {isSlowPollInterval(seconds) ? (
            <p role="status" className="text-xs text-warning-ink">
              {POLL_INTERVAL_SLOW_WARNING}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-critical-ink">
              {error}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="surface-button px-3 py-2" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
            disabled={save.isPending}
            aria-busy={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
