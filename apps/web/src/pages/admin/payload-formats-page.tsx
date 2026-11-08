import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useState } from "react";
import type { MqttPayloadFormatDto, TestMqttPayloadFormatResponse } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import {
  createMqttPayloadFormat,
  deleteMqttPayloadFormat,
  fetchMqttPayloadFormats,
  invalidateMqttPayloadFormatReads,
  MqttPayloadFormatInUseError,
  mqttPayloadFormatsQueryKey,
  testMqttPayloadFormat,
  updateMqttPayloadFormat,
} from "../../api/admin/mqtt-payload-formats";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { WizardShell } from "../../components/wizard/wizard-shell";
import { canManagePayloadFormats } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import { wizardBody, type WizardStep } from "../../lib/wizard-steps";
import type { AuthUser } from "../../stores/auth-store";

/** ADR 0099 Amendment 17 decision 3: the fixed note beside the copilot. */
export const PAYLOAD_SAMPLE_COPILOT_NOTE =
  "A sample message you paste into the copilot goes to the copilot model. Never paste broker credentials.";
export const DEFINITION_NOT_JSON = "The definition is not valid JSON.";

/** The literal id on each `WizardShell`, the form the stepper gate detects; a missing entry is a build defect. */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.334: the catalog has no entry "${id}"`);
  return entry;
}

const NEW_DEFINITION = JSON.stringify(
  {
    kind: "declarative",
    root: "object",
    deviceKey: ["dev_id"],
    readings: [{ key: "flow", field: ["values", "flow"] }],
  },
  null,
  2,
);

/** The textarea's text as the body's `definition`: parsed JSON, or the text itself so the step refuses it. */
export function definitionOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** A Next refusal in the page's words: invalid JSON says so; any other names its path, never a value. */
export function formatProblem(problem: string): string {
  const path = problem.slice(0, problem.indexOf(":"));
  return path === "definition" && problem.includes("Expected object") ? DEFINITION_NOT_JSON : problem;
}

type FormState = { code: string; name: string; description: string; definition: string };
type Editing = "create" | MqttPayloadFormatDto | null;

function formOf(item: MqttPayloadFormatDto): FormState {
  return {
    code: item.code,
    name: item.name,
    description: item.description,
    definition: JSON.stringify(item.definition, null, 2),
  };
}

function withValues(form: FormState, values: Readonly<Record<string, unknown>>): FormState {
  const next = { ...form };
  for (const field of ["code", "name", "description"] as const) {
    if (typeof values[field] === "string") next[field] = values[field] as string;
  }
  if (values.definition !== undefined) {
    next.definition = typeof values.definition === "string" ? values.definition : JSON.stringify(values.definition, null, 2);
  }
  return next;
}

/** Escape presses the wizard's own Cancel (the State Labels page's rule). */
function escapeAsCancel(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  const asking = event.currentTarget.querySelector('[role="alertdialog"]') !== null;
  buttons.find((button) => button.textContent === (asking ? "Stay in the wizard" : "Cancel"))?.click();
}

/** "used by 1 RTU (BCPL_LAKWA_02, BCPL) and 0 drafts" — the 409's list (ruling Q5). */
export function inUseSentence(error: MqttPayloadFormatInUseError): string {
  const rtus = error.conflict.rtus.map((r) => `${r.rtuCode} (${r.organizationCode})`);
  const drafts = error.conflict.drafts.map((d) => `draft ${d.sessionId} (${d.organizationCode})`);
  return `This format is used by ${rtus.length} RTU(s) and ${drafts.length} draft(s); it cannot be deleted. ${[...rtus, ...drafts].join(", ")}`;
}

/**
 * `F4.334` / ADR 0116 decision 5, ADR 0099 Amendment 17 (plan T5.2, ruling Q12) — the MQTT
 * payload format catalog: how a message from a device is decoded into readings. Fails closed at
 * the page for any role but the global `admin` (the Location Types rule). New, Edit and Delete are
 * the `mqttPayloadFormat.*` wizards, so every write is the catalog route the copilot proposes; the
 * built-in envelope shows "Built-in" and no control. The Definition step carries the test box: a
 * pasted sample decodes against the edited definition through `POST …/test`, which stores nothing.
 */
export function PayloadFormatsAdminPage({ user }: { user: AuthUser }) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Payload Formats"
        subtitle="Platform-wide formats that decode MQTT messages into readings; each MQTT RTU names one"
      />
      {canManagePayloadFormats(user.role) ? (
        <PayloadFormatsCatalog />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Payload formats are managed by a global administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

function PayloadFormatsCatalog() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<MqttPayloadFormatDto | null>(null);
  const [form, setFormState] = useState<FormState>({ code: "", name: "", description: "", definition: NEW_DEFINITION });
  const [error, setError] = useState<string | null>(null);
  const [testTopic, setTestTopic] = useState("");
  const [testSample, setTestSample] = useState("");
  const [tested, setTested] = useState<TestMqttPayloadFormatResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const listQ = useQuery({ queryKey: mqttPayloadFormatsQueryKey, queryFn: fetchMqttPayloadFormats });

  function setForm(next: FormState): void {
    setError(null);
    setFormState(next);
  }

  function open(next: Editing): void {
    setError(null);
    setTested(null);
    setTestError(null);
    if (next === "create") setFormState({ code: "", name: "", description: "", definition: NEW_DEFINITION });
    else if (next !== null) setFormState(formOf(next));
    setEditing(next);
  }

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      editing !== null && editing !== "create"
        ? updateMqttPayloadFormat(editing.code, body as Parameters<typeof updateMqttPayloadFormat>[1])
        : createMqttPayloadFormat(body as Parameters<typeof createMqttPayloadFormat>[0]),
    onSuccess: async () => {
      setEditing(null);
      await invalidateMqttPayloadFormatReads(queryClient);
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: MqttPayloadFormatDto) => deleteMqttPayloadFormat(item.code),
    onSuccess: async () => {
      setDeleting(null);
      setError(null);
      await invalidateMqttPayloadFormatReads(queryClient);
    },
    onError: (err: unknown) => setError(err instanceof MqttPayloadFormatInUseError ? inUseSentence(err) : apiErrorMessage(err)),
  });

  const testMutation = useMutation({
    mutationFn: async () =>
      testMqttPayloadFormat({
        definition: definitionOf(form.definition) as Parameters<typeof testMqttPayloadFormat>[0]["definition"],
        topic: testTopic,
        sample: testSample,
      }),
    onSuccess: (result) => {
      setTestError(null);
      setTested(result);
    },
    onError: (err: unknown) => {
      setTested(null);
      setTestError(apiErrorMessage(err));
    },
  });

  const items = listQ.data ?? [];
  const definition = definitionOf(form.definition);
  const createValues = {
    code: form.code.trim(),
    name: form.name.trim(),
    ...(form.description.trim() === "" ? {} : { description: form.description.trim() }),
    definition,
  };
  const updateValues = { name: form.name.trim(), description: form.description.trim(), definition };

  const field = (label: string, key: "code" | "name" | "description", disabled = false) => (
    <label className="block text-xs font-semibold text-ink-muted">
      {label}
      <input
        className="mt-1 w-full surface-field px-3 py-2 text-sm"
        value={form[key]}
        disabled={disabled}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
      />
    </label>
  );

  const testBox = (
    <div className="space-y-2 rounded border border-well-deep p-2">
      <div className="text-xs font-semibold text-ink-muted">Test with a sample message</div>
      <input
        aria-label="Sample topic"
        placeholder="Topic"
        className="w-full surface-field px-2 py-1 font-mono text-xs"
        value={testTopic}
        onChange={(event) => setTestTopic(event.target.value)}
      />
      <textarea
        aria-label="Sample message"
        rows={4}
        className="w-full surface-field px-2 py-1 font-mono text-xs"
        value={testSample}
        onChange={(event) => setTestSample(event.target.value)}
      />
      <button
        type="button"
        className="surface-button px-2 py-1 text-xs"
        disabled={testMutation.isPending || testSample === ""}
        onClick={() => testMutation.mutate()}
      >
        {testMutation.isPending ? "Decoding…" : "Decode sample"}
      </button>
      {testError !== null && (
        <p role="alert" className="text-xs text-critical-ink">
          {testError}
        </p>
      )}
      {tested !== null && !tested.ok && <p className="text-xs text-critical-ink">{`Not decoded: ${tested.reason ?? "unknown"}.`}</p>}
      {tested !== null && tested.ok && (
        <ul aria-label="Decoded records" className="space-y-1 text-xs">
          {tested.records.length === 0 && <li>No record in this message.</li>}
          {tested.records.map((record, i) => (
            <li key={`${record.deviceKey}-${i}`}>
              <div className="font-mono">{`${record.deviceKey} · ${record.at ?? "no time"}`}</div>
              {Object.entries(record.values).map(([key, value]) => (
                <div key={key} className="font-mono text-ink-muted">{`${key} = ${value === null ? "empty" : String(value)}`}</div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const renderStep = (step: WizardStep) =>
    step.id === "format" ? (
      <div className="grid gap-3">
        {editing === "create" ? field("Code", "code") : <p className="text-xs text-ink-muted">Code <span className="font-mono">{form.code}</span> cannot be changed.</p>}
        {field("Name", "name")}
        {field("Description", "description")}
      </div>
    ) : (
      <div className="grid gap-3">
        <label className="block text-xs font-semibold text-ink-muted">
          Definition (JSON)
          <textarea
            rows={12}
            className="mt-1 w-full surface-field px-2 py-1 font-mono text-xs"
            value={form.definition}
            onChange={(event) => setForm({ ...form, definition: event.target.value })}
          />
        </label>
        {testBox}
      </div>
    );

  const wizardProps = {
    onChange: (values: Record<string, unknown>) => setForm(withValues(form, values)),
    renderStep,
    onSubmit: (body: Record<string, unknown>) => saveMutation.mutate(body),
    onCancel: () => setEditing(null),
    submitting: saveMutation.isPending,
    submitError: error,
    formatProblem,
  };

  return (
    <>
      <SectionCard title="Payload format catalog" bodyClassName="p-3 space-y-3">
        <p className="text-xs text-ink-muted">{PAYLOAD_SAMPLE_COPILOT_NOTE}</p>
        <div className="flex justify-end">
          <button
            type="button"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
            onClick={() => open("create")}
          >
            New format
          </button>
        </div>
        {listQ.isError ? (
          <p role="alert" className="text-xs text-critical-ink">
            {apiErrorMessage(listQ.error)}
          </p>
        ) : null}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Kind</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.code} className="border-b border-well-deep">
                <td className="px-2 py-2 font-mono">{item.code}</td>
                <td className="px-2 py-2">{item.name}</td>
                <td className="px-2 py-2">{item.definition.kind}</td>
                <td className="px-2 py-2">
                  {item.builtin ? (
                    <StatusPill label="Built-in" tone="info" />
                  ) : (
                    <div className="flex gap-2">
                      <button type="button" aria-label={`Edit ${item.code}`} className="text-xs font-semibold text-accent-strong" onClick={() => open(item)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${item.code}`}
                        className="text-xs font-semibold text-critical-ink"
                        onClick={() => {
                          setError(null);
                          setDeleting(item);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {editing !== null || deleting !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={deleting !== null ? "Delete payload format" : editing === "create" ? "New payload format" : "Edit payload format"}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto surface-dialog p-4"
            onKeyDown={escapeAsCancel}
          >
            {deleting !== null ? (
              <WizardShell
                key={`delete-${deleting.code}`}
                entry={wizardEntry("mqttPayloadFormat.delete")}
                params={{ code: deleting.code }}
                values={{}}
                onChange={() => undefined}
                renderStep={() => null}
                onSubmit={() => deleteMutation.mutate(deleting)}
                onCancel={() => setDeleting(null)}
                submitting={deleteMutation.isPending}
                submitError={error}
                summary={wizardEntry("mqttPayloadFormat.delete").summary({
                  body: {},
                  params: { code: deleting.code },
                  targetName: deleting.name,
                  organizationName: "",
                })}
              />
            ) : editing === "create" ? (
              <WizardShell
                key="create"
                {...wizardProps}
                entry={wizardEntry("mqttPayloadFormat.create")}
                params={{}}
                values={createValues}
                summary={wizardEntry("mqttPayloadFormat.create").summary({
                  body: wizardBody(createValues),
                  params: {},
                  targetName: "",
                  organizationName: "",
                })}
              />
            ) : editing !== null ? (
              <WizardShell
                key={`update-${editing.code}`}
                {...wizardProps}
                entry={wizardEntry("mqttPayloadFormat.update")}
                params={{ code: editing.code }}
                values={updateValues}
                current={{ name: editing.name, description: editing.description, definition: editing.definition }}
                summary={wizardEntry("mqttPayloadFormat.update").summary({
                  body: wizardBody(updateValues),
                  params: { code: editing.code },
                  targetName: editing.name,
                  organizationName: "",
                })}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
