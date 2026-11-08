import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminRtuDto } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { fetchMqttPayloadFormats, mqttPayloadFormatsQueryKey, setRtuPayloadFormat } from "../../api/admin/mqtt-payload-formats";
import { apiErrorMessage } from "../../lib/api-error-message";
import { wizardBody } from "../../lib/wizard-steps";
import { WizardShell } from "../wizard/wizard-shell";
import { AdminWizardFrame } from "./admin-wizard-frame";

/** The value the select shows for an RTU that names no format (ADR 0116 decision 2). */
const BUILTIN = "thinkiot-envelope";

function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.334: the catalog has no entry "${id}"`);
  return entry;
}

/**
 * `F4.334` / ADR 0099 Amendment 17 decision 4 (plan T5.4) — the `rtu.setPayloadFormat` wizard
 * (Payload format → Review) for an MQTT RTU on `/admin/rtus`. The built-in envelope is sent as
 * `null`, which removes the key; ingest decodes with the new format from its next reload.
 */
export function RtuPayloadFormatWizard({ rtu, onDone }: { rtu: AdminRtuDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState(rtu.payloadFormat ?? BUILTIN);
  const [error, setError] = useState<string | null>(null);
  const formats = useQuery({ queryKey: mqttPayloadFormatsQueryKey, queryFn: fetchMqttPayloadFormats });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      setRtuPayloadFormat(rtu.id, { payloadFormat: (body.payloadFormat as string | null | undefined) ?? null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "rtus"] });
      onDone();
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });
  const values = { payloadFormat: code === BUILTIN ? null : code };
  const entry = wizardEntry("rtu.setPayloadFormat");
  return (
    <AdminWizardFrame title="Payload format">
      <WizardShell
        key={`payload-format-${rtu.id}`}
        entry={wizardEntry("rtu.setPayloadFormat")}
        params={{ id: rtu.id }}
        values={values}
        current={{ payloadFormat: rtu.payloadFormat }}
        onChange={(next) => {
          setError(null);
          setCode(typeof next.payloadFormat === "string" ? next.payloadFormat : BUILTIN);
        }}
        renderStep={() => (
          <label className="block text-xs font-semibold text-ink-muted">
            Payload format
            <select
              autoFocus
              className="mt-1 w-full surface-field px-3 py-2 text-sm"
              value={code}
              onChange={(event) => {
                setError(null);
                setCode(event.target.value);
              }}
            >
              {(formats.data ?? []).map((format) => (
                <option key={format.code} value={format.code}>
                  {format.name}
                </option>
              ))}
            </select>
          </label>
        )}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onDone}
        submitting={save.isPending}
        submitError={error}
        summary={entry.summary({
          body: wizardBody(values),
          params: { id: rtu.id },
          targetName: rtu.displayName,
          organizationName: "",
          payloadFormat: rtu.payloadFormat,
        })}
      />
    </AdminWizardFrame>
  );
}
