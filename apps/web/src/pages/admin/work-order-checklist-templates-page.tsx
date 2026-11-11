import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { WorkOrderChecklistTemplateDto } from "@bms/shared";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import {
  createChecklistTemplate,
  fetchAdminChecklistTemplates,
  updateChecklistTemplate,
} from "../../api/admin/work-order-checklist-templates";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { canManageWorkOrderSettings } from "../../lib/admin-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { AuthUser } from "../../stores/auth-store";

type ChecklistTemplatesAdminPageProps = { user: AuthUser };

/** The organizations list the other admin screens read; one cache entry for all of them. */
const ORGANIZATIONS_KEY = ["admin", "organizations", "all"] as const;
const MAX_ITEMS = 100;

function templatesKey(organizationId: string) {
  return ["admin", "work-order-checklist-templates", organizationId] as const;
}

/**
 * `E3.1` (ADR 0122 decision 4.2) — the organization-level screen for reusable work-order
 * checklist templates. A template's items are copied onto a work order at create.
 *
 * **It fails closed at the page.** For every role but `admin` and `organization_admin`
 * it renders one status sentence and mounts no query (the API would answer 403 anyway).
 */
export function WorkOrderChecklistTemplatesAdminPage({ user }: ChecklistTemplatesAdminPageProps) {
  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Checklist Templates"
        subtitle="Reusable checklists copied onto a work order when it is created"
      />
      {canManageWorkOrderSettings(user.role) ? (
        <TemplatesBody />
      ) : (
        <p role="status" className="text-sm text-ink-muted">
          Checklist templates are managed by an organization administrator or a global administrator.
        </p>
      )}
    </MasterDataLayout>
  );
}

/** The editor target: a template to edit, or `"new"`. */
type Editing = WorkOrderChecklistTemplateDto | "new" | null;

function TemplatesBody() {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const orgsQ = useQuery({ queryKey: ORGANIZATIONS_KEY, queryFn: () => fetchAdminOrganizations("all") });
  const organizations = orgsQ.data?.items ?? [];
  const organizationId = chosen || organizations[0]?.id || "";

  const templatesQ = useQuery({
    queryKey: templatesKey(organizationId),
    queryFn: () => fetchAdminChecklistTemplates(organizationId),
    enabled: organizationId !== "",
  });
  const vocabQ = useQuery({ queryKey: vocabulariesQueryKey, queryFn: fetchVocabularies });
  const domains = (vocabQ.data?.assetDomains ?? []).filter((domain) => domain.active);
  const labelOf = (code: string | null): string =>
    code === null ? "All domains" : (vocabQ.data?.assetDomains.find((d) => d.code === code)?.label ?? code);

  const templates = [...(templatesQ.data?.items ?? [])].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name),
  );

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: templatesKey(organizationId) });
  }

  const toggle = useMutation({
    mutationFn: (input: { id: string; active: boolean }) => updateChecklistTemplate(input.id, { active: input.active }),
    onSuccess: async () => {
      setRowError(null);
      await refresh();
    },
    onError: (err: unknown) => setRowError(apiErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="checklist-templates-organization" className="block text-xs font-semibold text-ink-muted">
          Organization
        </label>
        <select
          id="checklist-templates-organization"
          className="mt-1 surface-field px-3 py-2 text-sm"
          value={organizationId}
          onChange={(event) => {
            setChosen(event.target.value);
            setEditing(null);
          }}
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.code} — {organization.name}
            </option>
          ))}
        </select>
      </div>

      {orgsQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(orgsQ.error)}
        </p>
      ) : null}
      {templatesQ.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(templatesQ.error)}
        </p>
      ) : null}
      {rowError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {rowError}
        </p>
      ) : null}

      <SectionCard
        title="Templates"
        actions={
          <button
            type="button"
            className="surface-button px-3 py-2 text-xs font-semibold disabled:opacity-60"
            disabled={organizationId === ""}
            onClick={() => setEditing("new")}
          >
            New template
          </button>
        }
        bodyClassName="p-3 space-y-2"
      >
        {templatesQ.data && templates.length === 0 ? (
          <p className="text-sm text-ink-muted">No checklist templates yet.</p>
        ) : null}
        <ul className="space-y-2">
          {templates.map((template) => (
            <li key={template.id} data-template={template.name} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-semibold">{template.name}</span>
                <span className="ml-2 text-ink-muted">{labelOf(template.domain)}</span>
                <span className="ml-2 text-ink-muted">
                  {template.items.length === 1 ? "1 item" : `${template.items.length} items`}
                </span>
                {template.active ? null : <span className="ml-2 text-xs font-semibold text-ink-muted">Retired</span>}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="surface-button px-3 py-1 text-xs"
                  onClick={() => setEditing(template)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="surface-button px-3 py-1 text-xs disabled:opacity-60"
                  disabled={toggle.isPending}
                  aria-busy={toggle.isPending}
                  onClick={() => toggle.mutate({ id: template.id, active: !template.active })}
                >
                  {toggle.isPending ? "Saving…" : template.active ? "Retire" : "Restore"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      {editing ? (
        <TemplateEditor
          // A different target starts the draft again.
          key={editing === "new" ? "new" : editing.id}
          organizationId={organizationId}
          template={editing === "new" ? null : editing}
          domains={domains}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

type Row = { key: number; title: string; mandatory: boolean };

type TemplateEditorProps = {
  organizationId: string;
  template: WorkOrderChecklistTemplateDto | null;
  domains: readonly { code: string; label: string }[];
  onClose: () => void;
  onSaved: () => Promise<void>;
};

function TemplateEditor({ organizationId, template, domains, onClose, onSaved }: TemplateEditorProps) {
  const nextKey = useRef(0);
  const makeRow = (title: string, mandatory: boolean): Row => ({ key: nextKey.current++, title, mandatory });
  const [name, setName] = useState(template?.name ?? "");
  const [domain, setDomain] = useState(template?.domain ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    template && template.items.length > 0
      ? [...template.items].sort((a, b) => a.sortOrder - b.sortOrder).map((item) => makeRow(item.title, item.mandatory))
      : [makeRow("", false)],
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const items = rows.map((row) => ({ title: row.title.trim(), mandatory: row.mandatory }));
      const body = { name: name.trim(), domain: domain === "" ? null : domain, items };
      return template
        ? updateChecklistTemplate(template.id, body)
        : createChecklistTemplate({ organizationId, ...body });
    },
    onSuccess: onSaved,
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });

  const valid = name.trim().length >= 3 && rows.every((row) => row.title.trim().length >= 2);
  const knownDomain = domain === "" || domains.some((d) => d.code === domain);

  function patchRow(index: number, patch: Partial<Row>): void {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function move(index: number, by: -1 | 1): void {
    const target = index + by;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target] as Row, next[index] as Row];
    setRows(next);
  }

  return (
    <SectionCard title={template ? "Edit template" : "New template"} bodyClassName="p-3">
      <form
        aria-label="Checklist template"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !save.isPending) save.mutate();
        }}
      >
        <div>
          <label htmlFor="checklist-template-name" className="block text-xs font-semibold text-ink-muted">
            Template name
          </label>
          <input
            id="checklist-template-name"
            type="text"
            maxLength={255}
            className="mt-1 surface-field w-full px-3 py-2 text-sm"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="checklist-template-domain" className="block text-xs font-semibold text-ink-muted">
            Asset domain
          </label>
          <select
            id="checklist-template-domain"
            className="mt-1 surface-field px-3 py-2 text-sm"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          >
            <option value="">All domains</option>
            {knownDomain ? null : <option value={domain}>{domain}</option>}
            {domains.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <ol className="space-y-2">
          {rows.map((row, index) => {
            const n = index + 1;
            return (
              <li key={row.key} className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  maxLength={255}
                  aria-label={`Item ${n} title`}
                  className="surface-field min-w-[16rem] flex-1 px-3 py-2 text-sm"
                  value={row.title}
                  onChange={(event) => patchRow(index, { title: event.target.value })}
                />
                <label className="flex items-center gap-1 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    aria-label={`Item ${n} is mandatory`}
                    checked={row.mandatory}
                    onChange={(event) => patchRow(index, { mandatory: event.target.checked })}
                  />
                  Mandatory
                </label>
                <button
                  type="button"
                  className="surface-button px-2 py-1 text-xs disabled:opacity-60"
                  aria-label={`Move item ${n} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="surface-button px-2 py-1 text-xs disabled:opacity-60"
                  aria-label={`Move item ${n} down`}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  Down
                </button>
                <button
                  type="button"
                  className="surface-button px-2 py-1 text-xs disabled:opacity-60"
                  aria-label={`Remove item ${n}`}
                  disabled={rows.length === 1}
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ol>

        <button
          type="button"
          className="surface-button px-3 py-2 text-xs disabled:opacity-60"
          disabled={rows.length >= MAX_ITEMS}
          onClick={() => setRows([...rows, makeRow("", false)])}
        >
          Add item
        </button>

        <p className="text-xs text-ink-muted">
          Saving replaces the template&apos;s whole item list. Work orders already created keep the items they copied.
        </p>

        {error ? (
          <p role="alert" className="text-sm text-critical-ink">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="submit"
            className="surface-button px-3 py-2 text-xs font-semibold disabled:opacity-60"
            disabled={!valid || save.isPending}
            aria-busy={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save template"}
          </button>
          <button type="button" className="surface-button px-3 py-2 text-xs" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </SectionCard>
  );
}
