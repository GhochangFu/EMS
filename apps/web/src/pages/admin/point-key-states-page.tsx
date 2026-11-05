import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { AdminPointKeyStateDto, PointKeyStateTone } from "@bms/shared";
import { pointKeyStateToneSchema } from "@bms/shared/contracts";

import { fetchAdminPointKeys } from "../../api/admin/point-keys";
import {
  adminPointKeyStatesQueryKey,
  createAdminPointKeyState,
  deleteAdminPointKeyState,
  fetchAdminPointKeyStates,
  invalidatePointKeyStateReads,
  updateAdminPointKeyState,
} from "../../api/admin/point-key-states";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { isGlobalAdmin } from "../../lib/admin-access";
import { parseStateValue } from "../../lib/point-key-state-value";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

/** The key picker's read: the active point keys, on the key the other active-key pickers share. */
const ACTIVE_POINT_KEYS_KEY = ["admin", "point-keys", "true"] as const;

/** The body's `.max(32)` (`contracts/point-key-state-writes.ts`). */
const LABEL_MAX = 32;
const VALUE_ERROR = "Value must be a number";
const KEY_ERROR = "Choose a point key";
const LABEL_ERROR = `Label must be 1 to ${LABEL_MAX} characters`;

type FormState = { pointKey: string; value: string; label: string; tone: PointKeyStateTone };

const EMPTY_FORM: FormState = { pointKey: "", value: "", label: "", tone: "closed" };

/** `null` for open, `"create"` for Add, the row for Edit. */
type Editing = "create" | AdminPointKeyStateDto | null;

/**
 * `F4.309` (ADR 0088 Amendment 3, plan C14) — the State Labels screen: which value of a switching
 * point key reads as which label and tone on the mimic and the state legend
 * (`bms.point_key_states`, fleet-wide).
 *
 * **It fails closed at the page** (owner ruling Q1), the Location Types rule: the tab is the
 * global `admin`'s alone, but a typed URL reaches this route through `AdminRoute`; for any other
 * role the page renders one status line and mounts no query. Everyone else reads the rows through
 * `/vocabularies`.
 *
 * A seeded row (decision 3) shows "Seeded" and no control: its `PATCH` and `DELETE` are 409. On
 * Edit the key and the value are read-only and only `label` and `tone` are sent (decision 4).
 * Every write refreshes this list and `/vocabularies` (`invalidatePointKeyStateReads`).
 */
export function PointKeyStatesAdminPage({ user }: { user: AuthUser }) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="State Labels"
        subtitle="Fleet-wide labels and tones for the values of switching point keys, drawn by the mimic and the state legend"
      />
      {isGlobalAdmin(user.role) ? (
        <StateLabelsCatalog />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          State labels are managed by a global administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

function StateLabelsCatalog() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const [form, setFormState] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminPointKeyStateDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const listQ = useQuery({ queryKey: adminPointKeyStatesQueryKey, queryFn: fetchAdminPointKeyStates });
  const keysQ = useQuery({ queryKey: ACTIVE_POINT_KEYS_KEY, queryFn: () => fetchAdminPointKeys("true") });

  /** A refusal names the values it refused; once they change it is stale. */
  function setForm(next: FormState): void {
    setError(null);
    setFormState(next);
  }

  const saveMutation = useMutation({
    mutationFn: async (target: "create" | AdminPointKeyStateDto) => {
      const label = form.label.trim();
      if (target === "create") {
        const value = parseStateValue(form.value) as number;
        return createAdminPointKeyState({ pointKey: form.pointKey, value, label, tone: form.tone });
      }
      return updateAdminPointKeyState(target.id, { label, tone: form.tone });
    },
    onSuccess: async () => {
      setEditing(null);
      setError(null);
      await invalidatePointKeyStateReads(queryClient);
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: AdminPointKeyStateDto) => deleteAdminPointKeyState(item.id),
    onSuccess: async () => {
      setDeleteError(null);
      await invalidatePointKeyStateReads(queryClient);
    },
    onError: (err: unknown) => setDeleteError(apiErrorMessage(err)),
  });

  function openCreate(): void {
    setFormState(EMPTY_FORM);
    setError(null);
    setEditing("create");
  }

  function openEdit(item: AdminPointKeyStateDto): void {
    setFormState({ pointKey: item.pointKey, value: String(item.value), label: item.label, tone: item.tone });
    setError(null);
    setEditing(item);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (editing === null) return;
    if (editing === "create" && form.pointKey === "") {
      setError(KEY_ERROR);
      return;
    }
    if (editing === "create" && parseStateValue(form.value) === null) {
      setError(VALUE_ERROR);
      return;
    }
    const label = form.label.trim();
    if (label.length === 0 || label.length > LABEL_MAX) {
      setError(LABEL_ERROR);
      return;
    }
    saveMutation.mutate(editing);
  }

  const items = listQ.data?.items ?? [];
  const activeKeys = keysQ.data?.items ?? [];
  const dialogName = editing === "create" ? "Add state label" : "Edit state label";

  return (
    <>
      <SectionCard title="State label catalog" bodyClassName="p-3 space-y-3">
        <div className="flex justify-end">
          <button
            type="button"
            className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
            onClick={openCreate}
          >
            Add state label
          </button>
        </div>
        {listQ.isError ? <p className="text-xs text-critical-ink">{apiErrorMessage(listQ.error)}</p> : null}
        {deleteError ? <p className="text-xs text-critical-ink">{deleteError}</p> : null}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Point key</th>
              <th className="px-2 py-2">Value</th>
              <th className="px-2 py-2">Label</th>
              <th className="px-2 py-2">Tone</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const deletingThis = deleteMutation.isPending && deleteMutation.variables?.id === item.id;
              // Review L7: each row's buttons name the row ("Edit breaker_main = 2").
              const rowName = `${item.pointKey} = ${item.value}`;
              return (
                <tr key={item.id} className="border-b border-well-deep">
                  <td className="px-2 py-2 font-mono">{item.pointKey}</td>
                  <td className="px-2 py-2 font-mono">{item.value}</td>
                  <td className="px-2 py-2">{item.label}</td>
                  <td className="px-2 py-2">{item.tone}</td>
                  <td className="px-2 py-2">
                    {item.seeded ? (
                      <StatusPill label="Seeded" tone="info" />
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          aria-label={`Edit ${rowName}`}
                          className="text-xs font-semibold text-accent-strong"
                          onClick={() => openEdit(item)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-critical-ink"
                          disabled={deleteMutation.isPending}
                          aria-busy={deletingThis}
                          aria-label={deletingThis ? `Deleting ${rowName}` : `Delete ${rowName}`}
                          onClick={() => {
                            setDeleteError(null);
                            setConfirming(item);
                          }}
                        >
                          {deletingThis ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>

      {editing !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          <form
            role="dialog"
            aria-label={dialogName}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto surface-dialog p-4"
            onSubmit={submit}
          >
            <h2 className="font-condensed text-lg font-bold">{dialogName}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {editing === "create" ? (
                <>
                  <label className="block text-xs font-semibold text-ink-muted">
                    Point key
                    <select
                      className="mt-1 w-full surface-field px-3 py-2 text-sm"
                      value={form.pointKey}
                      onChange={(event) => setForm({ ...form, pointKey: event.target.value })}
                    >
                      <option value="">{KEY_ERROR}</option>
                      {activeKeys.map((key) => (
                        <option key={key.id} value={key.code}>
                          {key.code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-ink-muted">
                    Value
                    <input
                      type="text"
                      inputMode="decimal"
                      className="mt-1 w-full surface-field px-3 py-2 font-mono text-sm"
                      value={form.value}
                      onChange={(event) => setForm({ ...form, value: event.target.value })}
                    />
                  </label>
                </>
              ) : (
                <p className="text-xs text-ink-muted sm:col-span-2">
                  Point key <span className="font-mono">{editing.pointKey}</span> and value{" "}
                  <span className="font-mono">{editing.value}</span> cannot be changed.
                </p>
              )}
              <label className="block text-xs font-semibold text-ink-muted">
                Label
                <input
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={form.label}
                  maxLength={LABEL_MAX}
                  onChange={(event) => setForm({ ...form, label: event.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-ink-muted">
                Tone
                <select
                  className="mt-1 w-full surface-field px-3 py-2 text-sm"
                  value={form.tone}
                  onChange={(event) => setForm({ ...form, tone: event.target.value as PointKeyStateTone })}
                >
                  {pointKeyStateToneSchema.options.map((tone) => (
                    <option key={tone} value={tone}>
                      {tone}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {error ? <p className="mt-3 text-xs text-critical-ink">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="surface-button px-3 py-2" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="submit"
                className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
                disabled={saveMutation.isPending}
                aria-busy={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {confirming !== null ? (
        <ConfirmDialog
          title="Delete state label"
          body={`${confirming.pointKey} = ${confirming.value} stops reading as "${confirming.label}": the mimic draws that value as unknown.`}
          confirmLabel="Delete state label"
          onConfirm={() => {
            deleteMutation.mutate(confirming);
            setConfirming(null);
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
