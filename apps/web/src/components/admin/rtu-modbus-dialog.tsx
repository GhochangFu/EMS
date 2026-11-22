import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";

import type { AdminRtuDto } from "@bms/shared";
import { setRtuModbusBodySchema } from "@bms/shared/contracts";

import { deviceProfilesKey, fetchDeviceProfiles } from "../../api/admin/device-profiles";
import { fetchAdminRtuSummary, setRtuModbus } from "../../api/admin/rtus";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  inheritedPollIntervalText,
  isSlowPollInterval,
  parsePollIntervalSeconds,
  POLL_INTERVAL_RANGE_MESSAGE,
  POLL_INTERVAL_SLOW_WARNING,
  pollIntervalSecondsText,
} from "../../lib/poll-interval-input";

/** The field each body key is typed in, so a refusal names what to fix. */
const FIELD_LABELS: Record<string, string> = {
  host: "Host",
  port: "Port",
  unitId: "Unit id",
  timeoutMs: "Timeout (ms)",
  interRequestDelayMs: "Delay between requests (ms)",
};

/** A typed number, or `NaN` for an empty field so the schema refuses it rather than reading 0. */
function numberOf(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text.trim());
}

function textOf(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

const FIELD_CLASS = "mt-1 w-full surface-field px-3 py-2 text-sm";
const LABEL_CLASS = "block text-xs font-semibold text-ink-muted";

/**
 * `F1.2` (ADR 0141 decisions 5, 6, 10 and 15, plan T7.4) — an RTU's **Modbus settings**: the
 * device profile its registers are copied from, the Modbus TCP connection, and the endpoint's poll
 * interval, saved through `PUT /admin/rtus/:id/modbus`. Opened from the RTU row action, for an RTU
 * with no connection row or a Modbus one.
 *
 * - The profile picker lists the profiles of the **RTU's** organization (the summary read gives its
 *   id); the server copies the chosen version's registers, so a later version reaches this RTU
 *   only when it is saved again (decision 15).
 * - The interval field says what an empty value inherits: the organization default carried on
 *   the row, else the adapter's own. Above 360 s it carries plan P4's warning.
 * - The API decides again on every write (the location gate, the other-organization endpoint 409,
 *   another protocol's 409), so a refusal is the server's sentence shown inline.
 */
export function RtuModbusDialog({ rtu, onDone }: { rtu: AdminRtuDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const stored = rtu.modbus;
  const summaryQ = useQuery({
    queryKey: ["admin", "rtu-summary", rtu.id],
    queryFn: () => fetchAdminRtuSummary(rtu.id),
  });
  const organizationId = summaryQ.data?.organizationId ?? "";
  // The profiles module's own key, so a profile saved on its screen refreshes this picker too.
  const profilesQ = useQuery({
    queryKey: deviceProfilesKey(organizationId),
    queryFn: () => fetchDeviceProfiles(organizationId),
    enabled: organizationId !== "",
  });
  const profiles = profilesQ.data ?? [];
  const boundId =
    stored?.profile === null || stored === null
      ? ""
      : (profiles.find((p) => p.code === stored.profile?.code && p.version === stored.profile?.version)?.id ?? "");

  const [chosen, setChosen] = useState<string | null>(null);
  const profileId = chosen ?? boundId;
  const [host, setHost] = useState(stored?.host ?? "");
  const [port, setPort] = useState(textOf(stored?.port ?? 502));
  const [unitId, setUnitId] = useState(textOf(stored?.unitId));
  const [intervalText, setIntervalText] = useState(pollIntervalSecondsText(stored?.pollIntervalMs ?? null));
  const [timeoutMs, setTimeoutMs] = useState(textOf(stored?.timeoutMs));
  const [delayMs, setDelayMs] = useState(textOf(stored?.interRequestDelayMs));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof setRtuModbus>[1]) => setRtuModbus(rtu.id, body),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "rtus"] });
      onDone();
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const noProfiles = profilesQ.isSuccess && profiles.length === 0;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (profileId === "") {
      setError("Choose a device profile.");
      return;
    }
    const pollIntervalMs = parsePollIntervalSeconds(intervalText);
    if (!pollIntervalMs.ok) {
      setError(POLL_INTERVAL_RANGE_MESSAGE);
      return;
    }
    const parsed = setRtuModbusBodySchema.safeParse({
      host: host.trim(),
      ...(port.trim() === "" ? {} : { port: numberOf(port) }),
      ...(timeoutMs.trim() === "" ? {} : { timeoutMs: numberOf(timeoutMs) }),
      ...(delayMs.trim() === "" ? {} : { interRequestDelayMs: numberOf(delayMs) }),
      unitId: numberOf(unitId),
      pollIntervalMs: pollIntervalMs.ms,
      profileId,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = FIELD_LABELS[String(issue?.path[0] ?? "")] ?? "A field";
      setError(`${field}: ${issue?.message ?? "invalid"}`);
      return;
    }
    save.mutate(parsed.data);
  }

  const inherited =
    rtu.organizationDefaultPollIntervalMs === null
      ? "Empty inherits the adapter default."
      : `Empty inherits the organization default: ${inheritedPollIntervalText(rtu.organizationDefaultPollIntervalMs, "")}.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="rtu-modbus-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto surface-dialog p-4"
        onSubmit={handleSubmit}
      >
        <h2 id="rtu-modbus-title" className="font-condensed text-lg font-bold text-ink">
          Modbus settings — {rtu.displayName}
        </h2>
        {stored?.profile ? (
          <p className="mt-1 text-xs text-ink-muted">
            Bound to {stored.profile.code} v{stored.profile.version} ({stored.registerCount} registers). Saving copies
            the chosen profile&apos;s registers; a later version of a profile changes this RTU only when it is saved
            again.
          </p>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className={`col-span-2 ${LABEL_CLASS}`}>
            Device profile
            <select className={FIELD_CLASS} value={profileId} onChange={(event) => setChosen(event.target.value)}>
              <option value="">Choose a profile</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {`${p.code} v${p.version} — ${p.vendor} ${p.model}`}
                </option>
              ))}
            </select>
          </label>
          {noProfiles ? (
            <p className="col-span-2 text-xs text-ink-muted">
              {rtu.organizationCode} has no device profiles yet. Create or import one under Device profiles first.
            </p>
          ) : null}
          <label className={`col-span-2 ${LABEL_CLASS}`}>
            Host
            <input className={FIELD_CLASS} value={host} onChange={(event) => setHost(event.target.value)} />
          </label>
          <label className={LABEL_CLASS}>
            Port
            <input className={FIELD_CLASS} inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} />
          </label>
          <label className={LABEL_CLASS}>
            Unit id
            <input className={FIELD_CLASS} inputMode="numeric" value={unitId} onChange={(event) => setUnitId(event.target.value)} />
          </label>
          <label className={`col-span-2 ${LABEL_CLASS}`}>
            Poll interval (seconds)
            <input
              className={FIELD_CLASS}
              inputMode="decimal"
              value={intervalText}
              onChange={(event) => setIntervalText(event.target.value)}
            />
          </label>
          <p className="col-span-2 text-xs text-ink-muted">{inherited}</p>
          {isSlowPollInterval(intervalText) ? (
            <p role="status" className="col-span-2 text-xs text-warning-ink">
              {POLL_INTERVAL_SLOW_WARNING}
            </p>
          ) : null}
          <label className={LABEL_CLASS}>
            Timeout (ms)
            <input
              className={FIELD_CLASS}
              inputMode="numeric"
              placeholder="1000"
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(event.target.value)}
            />
          </label>
          <label className={LABEL_CLASS}>
            Delay between requests (ms)
            <input
              className={FIELD_CLASS}
              inputMode="numeric"
              placeholder="0"
              value={delayMs}
              onChange={(event) => setDelayMs(event.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="col-span-2 text-xs text-critical-ink">
              {error}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="surface-button px-3 py-2" onClick={onDone}>
            Cancel
          </button>
          <button
            type="submit"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
            disabled={save.isPending || noProfiles}
            aria-busy={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
