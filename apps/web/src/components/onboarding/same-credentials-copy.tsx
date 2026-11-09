import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { CopyOnboardingCredentialsBody, OnboardingSessionDto } from "@bms/shared";

import { copyOnboardingCredentials } from "../../api/admin/onboarding";
import { fetchAdminRtus } from "../../api/admin/rtus";
import { apiErrorMessage } from "../../lib/api-error-message";

type Broker = { host: string | null; port: number | null; tls: boolean };

/** The server's `brokerOf` (`onboarding-credential-copy.ts`): `tls` absent reads as `true`. */
function brokerOf(config: Record<string, unknown> | undefined): Broker {
  const c = config ?? {};
  return {
    host: typeof c.host === "string" && c.host.trim() !== "" ? c.host.trim().toLowerCase() : null,
    port: typeof c.port === "number" ? c.port : null,
    tls: c.tls !== false,
  };
}

const sameBroker = (a: Broker, b: Broker) => a.host === b.host && a.port === b.port && a.tls === b.tls;

type SameCredentialsCopyProps = {
  session: OnboardingSessionDto;
  /** The draft RTU that receives the credential. */
  index: number;
  /** Another write to the `rtus` list is in flight. */
  disabled: boolean;
  onCopied: (session: OnboardingSessionDto) => void;
  onError: (message: string | null) => void;
};

/**
 * `F4.339` (ADR 0117 decision 7, plan T7.3) — **Same credentials as …** on a
 * draft MQTT RTU's row: the draft's credentialed MQTT RTUs on the same broker,
 * then the organization's committed MQTT RTUs. The committed list is read only
 * once the control opens. The admin RTU DTO carries no host, so a committed
 * source on another broker is refused by the server (409), and that sentence is
 * shown. No secret passes through here: the server copies the stored blob.
 */
export function SameCredentialsCopy({ session, index, disabled, onCopied, onError }: SameCredentialsCopyProps) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const rtus = session.draft?.rtus ?? [];
  const target = rtus[index];
  const targetCode = target?.code ?? `RTU ${index + 1}`;
  const broker = brokerOf(target?.config);
  const draftSources = rtus.flatMap((rtu, i) =>
    i !== index && rtu.protocol === "mqtt" && rtu.credentialsSet === true && sameBroker(brokerOf(rtu.config), broker)
      ? [{ value: `d:${i}`, label: rtu.code ?? `RTU ${i + 1}` }]
      : [],
  );
  const committedQ = useQuery({
    queryKey: ["admin", "rtus", "true", "credential-copy-sources"],
    queryFn: () => fetchAdminRtus("true"),
    enabled: open,
  });
  const committed = (committedQ.data?.items ?? []).filter(
    (rtu) => rtu.organizationCode === session.organizationCode && rtu.tls !== null,
  );

  const copyM = useMutation({
    mutationFn: (from: CopyOnboardingCredentialsBody["from"]) =>
      copyOnboardingCredentials(session.id, { from, toRtuIndexes: [index] }),
    onSuccess: (updated) => {
      setOpen(false);
      setChoice("");
      onError(null);
      onCopied(updated);
    },
    onError: (err: Error) => onError(apiErrorMessage(err)),
  });

  if (target?.protocol !== "mqtt" || target.credentialsSet === true) return null;
  if (!open) {
    return (
      <button type="button" className="text-[11px] underline" onClick={() => setOpen(true)} disabled={disabled}>
        Same credentials as…
      </button>
    );
  }
  return (
    <span className="mt-2 flex flex-wrap items-center gap-1">
      <select
        aria-label={`Credential source for ${targetCode}`}
        className="surface-field px-2 py-1 text-[11px]"
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
      >
        <option value="">Choose an RTU…</option>
        {draftSources.length > 0 && (
          <optgroup label="This draft">
            {draftSources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </optgroup>
        )}
        {committed.length > 0 && (
          <optgroup label="Committed RTUs">
            {committed.map((rtu) => (
              <option key={rtu.id} value={`c:${rtu.id}`}>
                {rtu.code} · {rtu.locationName}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button
        type="button"
        className="surface-button px-2 py-1 text-[11px] disabled:opacity-50"
        disabled={choice === "" || disabled || copyM.isPending}
        aria-busy={copyM.isPending}
        onClick={() =>
          copyM.mutate(choice.startsWith("d:") ? { rtuIndex: Number(choice.slice(2)) } : { rtuId: choice.slice(2) })
        }
      >
        {copyM.isPending ? "Copying…" : "Copy credentials"}
      </button>
      <button type="button" className="text-[11px] underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}
