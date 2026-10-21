import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import {
  type CreateAssetTemplateInput,
  type TemplatePointInput,
  createAdminAssetTemplate,
} from "../../api/admin/asset-templates";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { apiErrorMessage } from "../../lib/api-error-message";
import type { WizardStep } from "../../lib/wizard-steps";
import { WizardShell } from "../wizard/wizard-shell";

/** The catalog entry a wizard submits, by its literal id (the stepper coverage gate reads the id). */
function wizardEntry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (found === undefined) throw new Error(`No copilot catalog entry "${id}".`);
  return found;
}

/** `values` with `field` set, or removed when the input is cleared — a wizard sends no key it left unset. */
function withField(values: Record<string, unknown>, field: string, raw: string): Record<string, unknown> {
  const next = { ...values };
  if (raw === "") delete next[field];
  else next[field] = raw;
  return next;
}

function textOf(values: Record<string, unknown>, field: string): string {
  const value = values[field];
  return typeof value === "string" ? value : "";
}

/**
 * The create request from the wizard's body — the normalization the modal
 * applied before `F4.254`: code, name and asset type trimmed, a blank
 * description sent as `null`. A `content` or `points` the copilot filled
 * passes through as it is.
 */
export function createTemplateInput(body: Record<string, unknown>): CreateAssetTemplateInput {
  const description = textOf(body, "description").trim();
  const { content, points } = body;
  return {
    organizationId: textOf(body, "organizationId"),
    code: textOf(body, "code").trim(),
    name: textOf(body, "name").trim(),
    assetType: textOf(body, "assetType").trim(),
    domain: textOf(body, "domain"),
    description: description === "" ? null : description,
    // A copilot fill; the API validates both, so only the shape is narrowed here.
    ...(typeof content === "object" && content !== null && !Array.isArray(content)
      ? { content: content as Record<string, unknown> }
      : {}),
    ...(Array.isArray(points) ? { points: points as TemplatePointInput[] } : {}),
  };
}

/** What a filled value holds, in a few words: the step shows it, it does not edit it. */
function filledNote(label: string, value: unknown): string {
  if (Array.isArray(value)) return `${label}: ${value.length} filled by the copilot.`;
  if (typeof value === "object" && value !== null) {
    const kpis = (value as { kpis?: unknown }).kpis;
    return Array.isArray(kpis)
      ? `${label}: ${kpis.length} KPI${kpis.length === 1 ? "" : "s"} filled by the copilot.`
      : `${label}: filled by the copilot.`;
  }
  return `${label}: filled by the copilot.`;
}

/**
 * `F4.254` PR 2 (ADR 0099 decision 6) — New template on the shared
 * `WizardShell` for `assetTemplate.create`: one Basics step with the six
 * inputs the modal had, then Review, and only Review's Submit sends the
 * request. Points and content are authored on the detail tabs once the draft
 * exists, so they have no input here; a value the copilot's `fill_step` put
 * in either is named on the step, so the step never hides what Submit sends.
 * Used alone it sends the plain request, never `X-Copilot-Change`.
 */
export function CreateTemplateWizard({
  onClose,
  onClosedError,
}: {
  onClose: () => void;
  /** Called with a refusal that arrives after the dialog closed, which nothing else would show. */
  onClosedError?: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The same keys the page and the stock card use, so these are cache hits.
  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
  });
  const vocabQ = useQuery({ queryKey: vocabulariesQueryKey, queryFn: fetchVocabularies });

  const createM = useMutation({
    mutationFn: (body: Record<string, unknown>) => createAdminAssetTemplate(createTemplateInput(body)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "asset-templates"] });
      onClose();
    },
    // ADR 0038 decision 10's residual case — right role, wrong organization —
    // arrives as "Organization is outside your access scope", and that
    // sentence is the whole answer.
    onError: (cause: Error) => {
      // Cancelled before the answer: the card is gone, so the page shows it.
      if (mounted.current) setError(apiErrorMessage(cause));
      else onClosedError?.(apiErrorMessage(cause));
    },
  });

  const orgs = orgsQ.data?.items ?? [];
  // An id that is not in the list (a copilot fill can set any) is named by itself, never hidden.
  const orgName = (id: unknown): string =>
    orgs.find((org) => org.id === id)?.name ?? (typeof id === "string" && id !== "" ? id : "the organization");

  // A value change clears the last server error: the shell shows `submitError`
  // in place of Review's own problems and will not submit while those exist.
  function update(next: Record<string, unknown>): void {
    setError(null);
    setForm(next);
  }

  function renderStep(step: WizardStep) {
    if (step.id !== "basics") return null;
    const text = (field: string, label: string, placeholder: string) => (
      <label className="block text-xs font-semibold text-ink">
        {label}
        <input
          value={textOf(form, field)}
          onChange={(event) => update(withField(form, field, event.target.value))}
          // Trimmed when the field is left, so Review shows what Submit sends.
          onBlur={(event) => setForm(withField(form, field, event.target.value.trim()))}
          placeholder={placeholder}
          className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
        />
      </label>
    );
    return (
      <>
        <label className="block text-xs font-semibold text-ink">
          Organization
          <select
            value={textOf(form, "organizationId")}
            onChange={(event) => update(withField(form, "organizationId", event.currentTarget.value))}
            className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
          >
            <option value="">Select an organization…</option>
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.code} — {org.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("code", "Code", "CHILLER")}
          {text("name", "Name", "Water-cooled chiller")}
          {text("assetType", "Asset type", "chiller")}
          <label className="block text-xs font-semibold text-ink">
            Domain
            <select
              value={textOf(form, "domain")}
              onChange={(event) => update(withField(form, "domain", event.currentTarget.value))}
              className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
            >
              <option value="">Select a domain…</option>
              {(vocabQ.data?.assetDomains ?? []).map((domain) => (
                <option key={domain.code} value={domain.code}>
                  {domain.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-xs font-semibold text-ink">
          Description
          <textarea
            value={textOf(form, "description")}
            onChange={(event) => update(withField(form, "description", event.target.value))}
            // Trimmed when the field is left, as Submit sends it trimmed.
            onBlur={(event) => setForm(withField(form, "description", event.target.value.trim()))}
            rows={2}
            className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
          />
        </label>
        {form.content !== undefined ? (
          <p className="text-[11px] text-ink-muted">{filledNote("Content", form.content)}</p>
        ) : null}
        {form.points !== undefined ? (
          <p className="text-[11px] text-ink-muted">{filledNote("Points", form.points)}</p>
        ) : null}
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
      <div className="w-full max-w-lg space-y-3 surface-dialog p-4">
        <h2 className="font-condensed text-base font-bold text-ink">New template</h2>
        <p className="text-[11px] text-ink-muted">
          A template is created as a draft at version 1. Points, calculations, KPIs and alarms are
          added on the next screen.
        </p>
        <WizardShell
          entry={wizardEntry("assetTemplate.create")}
          params={{}}
          values={form}
          onChange={update}
          renderStep={renderStep}
          onSubmit={(body) => {
            setError(null);
            createM.mutate(body);
          }}
          onCancel={onClose}
          submitting={createM.isPending}
          submitError={error}
          summary={wizardEntry("assetTemplate.create").summary({
            body: form,
            params: {},
            targetName: orgName(form.organizationId),
            organizationName: orgName(form.organizationId),
          })}
        />
      </div>
    </div>
  );
}
