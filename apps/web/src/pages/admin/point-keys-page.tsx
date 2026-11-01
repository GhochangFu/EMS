import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { AdminPointKeyDto, MasterDataActiveFilter } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import {
  createAdminPointKey,
  deactivateAdminPointKey,
  fetchAdminPointKeys,
  reactivateAdminPointKey,
  updateAdminPointKey,
} from "../../api/admin/point-keys";
import { ActiveFilterBar } from "../../components/admin/active-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import { WizardShell } from "../../components/wizard/wizard-shell";
import { canWritePointKeys } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type PointKeysAdminPageProps = { user: AuthUser };

/** `smallint`'s ceiling — the API body's `.max()` (`point-key-writes.ts`). */
const HEADLINE_RANK_MAX = 32767;
const HEADLINE_RANK_ERROR = `Headline rank must be a whole number from 1 to ${HEADLINE_RANK_MAX}.`;

/** The form's text, one string per body field. */
type FormState = {
  code: string;
  name: string;
  domain: string;
  unit: string;
  description: string;
  headlineRank: string;
  /** `F4.300` — the catalog trend-point flag (ADR 0108 decision 3). */
  trendDefault: boolean;
  /**
   * The admin (or a copilot fill) set the box. The DTO reads a stored `NULL`
   * as `false`, so on such a row a touched-and-unchecked box is the only way
   * to record a decided `false`; an untouched one sends nothing.
   */
  trendDefaultTouched: boolean;
};

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  domain: "",
  unit: "",
  description: "",
  headlineRank: "",
  trendDefault: false,
  trendDefaultTouched: false,
};

/**
 * `F3.68` / ADR 0076 decision 7 — the rank text to the body value.
 * Empty means unranked, so it is `null` (sent explicitly: `JSON.stringify`
 * drops `undefined`, and the rank would never clear). Anything that is not a
 * whole number in range is `"invalid"`.
 */
function parseHeadlineRank(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const rank = Number(trimmed);
  return rank >= 1 && rank <= HEADLINE_RANK_MAX ? rank : "invalid";
}

/**
 * The rank as a wizard value. An invalid text is passed through as typed, so
 * the body schema refuses it and Next holds the Details step (the field shows
 * {@link HEADLINE_RANK_ERROR} beside it).
 */
function rankValue(text: string): unknown {
  const rank = parseHeadlineRank(text);
  return rank === "invalid" ? text : rank;
}

/**
 * `F3.86` PR 3c (ADR 0099 decision 6) — the catalog entry a wizard submits.
 * Each `WizardShell` writes the literal id on its `entry` prop, the form the
 * stepper gate (`tests/f3.85-stepper-coverage`) detects. A missing entry is a
 * build defect, so it throws.
 */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.86: the catalog has no entry "${id}"`);
  return entry;
}

/**
 * The `pointKey.create` values. Code and name stay `""` when empty (never
 * `undefined`), so the step check refuses them on Basics; the optional text
 * fields are left out when empty, as the old form sent them.
 */
function createValues(form: FormState): Record<string, unknown> {
  return {
    code: form.code,
    name: form.name,
    domain: form.domain || undefined,
    unit: form.unit || undefined,
    description: form.description || undefined,
    headlineRank: rankValue(form.headlineRank),
    // Unchecked is "undecided" (omitted), so a create never writes a `false`.
    ...(form.trendDefault ? { trendDefault: true } : {}),
  };
}

/** The `pointKey.update` values: the old form's PATCH, field for field (the code is not editable). */
function updateValues(form: FormState, stored: AdminPointKeyDto): Record<string, unknown> {
  return {
    name: form.name,
    domain: form.domain || undefined,
    unit: form.unit || undefined,
    description: form.description || undefined,
    headlineRank: rankValue(form.headlineRank),
    // `F4.300` — the flag is tri-state. It is sent only when the admin set the
    // box, so an edit of another field never turns an undecided flag into
    // `false`, and a box touched and left unchecked records a decided `false`.
    ...(form.trendDefaultTouched || form.trendDefault !== stored.trendDefault
      ? { trendDefault: form.trendDefault }
      : {}),
  };
}

/** A copilot `fill_step` (merged by the shell into the named step) written back into the form's text. */
function formWithValues(form: FormState, values: Readonly<Record<string, unknown>>): FormState {
  const next = { ...form };
  for (const key of ["code", "name", "domain", "unit", "description"] as const) {
    if (typeof values[key] === "string") next[key] = values[key] as string;
  }
  if (typeof values.trendDefault === "boolean") {
    next.trendDefault = values.trendDefault;
    next.trendDefaultTouched = true;
  }
  if (values.headlineRank === null) next.headlineRank = "";
  else if (typeof values.headlineRank === "number") next.headlineRank = String(values.headlineRank);
  return next;
}

function formOf(item: AdminPointKeyDto): FormState {
  return {
    code: item.code,
    name: item.name,
    domain: item.domain ?? "",
    unit: item.unit ?? "",
    description: item.description ?? "",
    headlineRank: item.headlineRank === null ? "" : String(item.headlineRank),
    trendDefault: item.trendDefault,
    trendDefaultTouched: false,
  };
}

/**
 * Admin screen for the fleet-wide point key catalog.
 *
 * **`F3.39` / ADR 0051 — this screen lost its organization axis entirely.** The
 * organization column, the `HierarchyFilterBar`, the deep link and the create
 * form's organization picker all named a column migration `0057` drops. What
 * is left is one list for the whole fleet, which is what makes a stock
 * dashboard template's `pointKey` resolvable anywhere.
 *
 * `canWritePointKeys` narrowed to the global `admin` in the same row, so an
 * organization administrator reads this screen and cannot edit it.
 *
 * `F3.86` PR 3c (ADR 0099 decision 6, ruling Q9) — Add and Edit are the
 * `pointKey.create` / `pointKey.update` wizards (Basics → Details → Review),
 * and Deactivate / Reactivate are Review-alone wizards, so every write here is
 * the catalog route the copilot proposes. A wizard used alone sends no
 * `X-Copilot-Change` header.
 */
export function PointKeysAdminPage({ user }: PointKeysAdminPageProps) {
  const queryClient = useQueryClient();
  const canWrite = canWritePointKeys(user.role);
  const [activeFilter, setActiveFilter] = useState<MasterDataActiveFilter>("all");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPointKeyDto | null>(null);
  const [form, setFormState] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  // Ruling Q9: the key whose deactivate or reactivate Review is open.
  const [toggling, setToggling] = useState<AdminPointKeyDto | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["admin", "point-keys", activeFilter],
    queryFn: () => fetchAdminPointKeys(activeFilter),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = listQ.data?.items ?? [];
    if (!q) return items;
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.domain ?? "").toLowerCase().includes(q),
    );
  }, [listQ.data?.items, search]);

  /** A refusal names the values it refused; once they change it is stale. */
  function setForm(next: FormState): void {
    setError(null);
    setFormState(next);
  }

  // The wizard's Review parsed `body` against the entry's schema, and the
  // request is that body: what Review showed is what is sent.
  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (editing) {
        return updateAdminPointKey(editing.id, body as Parameters<typeof updateAdminPointKey>[1]);
      }
      return createAdminPointKey(body as Parameters<typeof createAdminPointKey>[0]);
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "point-keys"] });
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (item: AdminPointKeyDto) =>
      item.active ? deactivateAdminPointKey(item.id) : reactivateAdminPointKey(item.id),
    onSuccess: async () => {
      setToggling(null);
      setToggleError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "point-keys"] });
    },
    onError: (err: unknown) => setToggleError(apiErrorMessage(err)),
  });

  function openCreate(): void {
    setEditing(null);
    setFormState(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(item: AdminPointKeyDto): void {
    setEditing(item);
    setFormState(formOf(item));
    setError(null);
    setModalOpen(true);
  }

  function openToggle(item: AdminPointKeyDto): void {
    setToggleError(null);
    setToggling(item);
  }

  const rankInvalid = parseHeadlineRank(form.headlineRank) === "invalid";

  const textField = (key: "code" | "name" | "domain" | "unit", label: string) => (
    <label className="block text-xs font-semibold text-ink-muted">
      {label}
      <input
        className="mt-1 w-full surface-field px-3 py-2 text-sm"
        value={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
      />
    </label>
  );

  // Every step's elements are built here, once per render, and `renderStep`
  // only picks one (the `calc-parameters-page.tsx` rule: an element built
  // inside `renderStep` is new on every shell render).
  const basicsFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      {editing ? (
        <p className="text-xs text-ink-muted sm:col-span-2">
          Code <span className="font-mono">{editing.code}</span> cannot be changed.
        </p>
      ) : (
        textField("code", "Code")
      )}
      {textField("name", "Name")}
      {textField("domain", "Domain")}
      {textField("unit", "Unit")}
    </div>
  );

  const detailsFields = (
    <div className="grid gap-3">
      <div>
        <label htmlFor="point-key-headline-rank" className="block text-xs font-semibold text-ink-muted">
          Headline rank
        </label>
        <input
          id="point-key-headline-rank"
          type="text"
          inputMode="numeric"
          aria-describedby="point-key-headline-rank-hint"
          aria-invalid={rankInvalid}
          className="mt-1 w-full surface-field px-3 py-2 text-sm"
          value={form.headlineRank}
          onChange={(event) => setForm({ ...form, headlineRank: event.target.value })}
        />
        <p id="point-key-headline-rank-hint" className="mt-1 text-xs text-ink-muted">
          Lower shows first on a generated site card. Leave empty to unrank; a seeded code gets its default
          rank again on the next seed.
        </p>
        {rankInvalid ? <p className="mt-1 text-xs text-critical-ink">{HEADLINE_RANK_ERROR}</p> : null}
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
        <input
          type="checkbox"
          checked={form.trendDefault}
          onChange={(event) => setForm({ ...form, trendDefault: event.target.checked, trendDefaultTouched: true })}
        />
        Trend default
      </label>
      <label className="block text-xs font-semibold text-ink-muted">
        Description
        <textarea
          className="mt-1 w-full surface-field px-3 py-2 text-sm"
          value={form.description}
          rows={3}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </label>
    </div>
  );

  const renderStep = (step: { id: string }) => (step.id === "basics" ? basicsFields : detailsFields);
  const toggleProps = {
    values: {},
    onChange: () => undefined,
    renderStep: () => null,
    onSubmit: () => {
      if (toggling) toggleMutation.mutate(toggling);
    },
    onCancel: () => setToggling(null),
    submitting: toggleMutation.isPending,
    submitError: toggleError,
  };
  const toggleSummary = (id: string) =>
    toggling
      ? wizardEntry(id).summary({ body: {}, params: { id: toggling.id }, targetName: toggling.code, organizationName: "" })
      : undefined;

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Point Keys"
        subtitle="Fleet-wide catalog of telemetry point keys used in asset mappings"
        actions={
          canWrite ? (
            <button
              type="button"
              className="surface-button-primary bg-accent px-3 py-2 text-xs font-semibold text-on-accent"
              onClick={openCreate}
            >
              Add point key
            </button>
          ) : null
        }
      />
      <SectionCard title="Point key catalog" bodyClassName="p-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          <ActiveFilterBar value={activeFilter} onChange={setActiveFilter} />
          <input
            className="surface-field px-3 py-1.5 text-sm"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Domain</th>
              <th className="px-2 py-2">Unit</th>
              <th className="px-2 py-2">Headline rank</th>
              <th className="px-2 py-2">Trend default</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b border-well-deep">
                <td className="px-2 py-2 font-mono">{item.code}</td>
                <td className="px-2 py-2">{item.name}</td>
                <td className="px-2 py-2">{item.domain ?? "—"}</td>
                <td className="px-2 py-2">{item.unit ?? "—"}</td>
                <td className="px-2 py-2">{item.headlineRank ?? "—"}</td>
                <td className="px-2 py-2">{item.trendDefault ? "Yes" : "—"}</td>
                <td className="px-2 py-2">
                  <StatusPill
                    label={item.active ? "Active" : "Inactive"}
                    tone={item.active ? "ok" : "offline"}
                  />
                </td>
                <td className="px-2 py-2">
                  {canWrite ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs font-semibold text-accent-strong"
                        onClick={() => openEdit(item)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-ink-muted"
                        onClick={() => openToggle(item)}
                      >
                        {item.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-ink-muted">Read only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {modalOpen && canWrite ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          <div
            role="dialog"
            aria-label={editing ? "Edit point key" : "Add point key"}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto surface-dialog p-4"
          >
            <h2 className="font-condensed text-lg font-bold">{editing ? "Edit point key" : "Add point key"}</h2>
            <div className="mt-3">
              {editing ? (
                <WizardShell
                  key={`update-${editing.id}`}
                  entry={wizardEntry("pointKey.update")}
                  params={{ id: editing.id }}
                  values={updateValues(form, editing)}
                  onChange={(values) => setForm(formWithValues(form, values))}
                  renderStep={renderStep}
                  onSubmit={(body) => saveMutation.mutate(body)}
                  onCancel={() => setModalOpen(false)}
                  submitting={saveMutation.isPending}
                  submitError={error}
                  current={{
                    name: editing.name,
                    domain: editing.domain,
                    unit: editing.unit,
                    description: editing.description,
                    headlineRank: editing.headlineRank,
                  }}
                />
              ) : (
                <WizardShell
                  key="create"
                  entry={wizardEntry("pointKey.create")}
                  params={{}}
                  values={createValues(form)}
                  onChange={(values) => setForm(formWithValues(form, values))}
                  renderStep={renderStep}
                  onSubmit={(body) => saveMutation.mutate(body)}
                  onCancel={() => setModalOpen(false)}
                  submitting={saveMutation.isPending}
                  submitError={error}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {toggling !== null && canWrite ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          <div
            role="dialog"
            aria-label={toggling.active ? "Deactivate point key" : "Reactivate point key"}
            className="w-full max-w-lg surface-dialog p-4"
          >
            <h2 className="font-condensed text-lg font-bold">
              {toggling.active ? "Deactivate" : "Reactivate"} {toggling.code}
            </h2>
            <div className="mt-3">
              {toggling.active ? (
                <WizardShell
                  key={`deactivate-${toggling.id}`}
                  entry={wizardEntry("pointKey.deactivate")}
                  {...toggleProps}
                  params={{ id: toggling.id }}
                  summary={toggleSummary("pointKey.deactivate")}
                />
              ) : (
                <WizardShell
                  key={`reactivate-${toggling.id}`}
                  entry={wizardEntry("pointKey.reactivate")}
                  {...toggleProps}
                  params={{ id: toggling.id }}
                  summary={toggleSummary("pointKey.reactivate")}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </MasterDataLayout>
  );
}
