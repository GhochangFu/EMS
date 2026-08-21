/**
 * The Details tab (`F2.5`, ADR 0038 Unit 9a).
 *
 * Wiring only. Every rule — what counts as a change, what an emptied
 * description means, what is refused before the request goes out — lives in
 * `src/lib/template-details-form.ts` with its spec, because a `.tsx` is
 * unreachable by this repository's tests and invisible to the coverage gate.
 *
 * `domain` is a `<select>` over `assetDomains` from `GET /api/v1/vocabularies`,
 * never a hardcoded list: ADR 0031 Amendment 1 made the domains rows in
 * `bms.asset_domains` precisely so the three scheduled sector packs (`E5.1`
 * water treatment, `E5.2` mechanical, `E5.3` facility) arrive as seed data
 * rather than as a migration and a deploy. It reuses `vocabulariesQueryKey`, so
 * this tab shares one cache entry with the rules page, the rule builder and the
 * create form on the list page.
 *
 * `assetType` is free text, not a select. It has no vocabulary table — the
 * schema is `z.string().min(1).max(64)` — and inventing a closed list here
 * would be this app deciding something the data model deliberately left open.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { updateAdminAssetTemplate } from "../../api/admin/asset-templates";
import { apiErrorMessage } from "../../lib/api-error-message";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import {
  buildDetailsPatch,
  detailsFormErrors,
  detailsFormFrom,
  type TemplateDetailsForm,
} from "../../lib/template-details-form";
import { Field } from "./field";

type DetailsTabProps = {
  template: AdminAssetTemplateDto;
  /** `capabilities(status).editable` — false for a published or archived version. */
  editable: boolean;
  /** Refetches the template after a successful save. */
  onSaved: (next: AdminAssetTemplateDto) => void;
  /** Tells the page whether leaving this tab would discard an edit. */
  onDirtyChange: (dirty: boolean) => void;
};

export function DetailsTab({ template, editable, onSaved, onDirtyChange }: DetailsTabProps) {
  const [form, setForm] = useState<TemplateDetailsForm>(() => detailsFormFrom(template));
  const [error, setError] = useState<string | null>(null);

  // Reseed when the page moves to a **different row**, or when this row's
  // **lifecycle status** changes.
  //
  // The id half: "Edit this version" navigates to a new draft with this
  // component still mounted, and without it the form would keep the old row's
  // values while the header showed the new one.
  //
  // The status half was added after the section 7 browser pass. A successful
  // Publish makes this row read-only, and without a reseed the unsaved edits
  // stayed on screen in disabled inputs, still reported dirty, on a version
  // that can never accept a write — so every tab click raised "unsaved
  // changes" with no way to resolve it. Status changes only on a deliberate
  // lifecycle action, so this cannot fire on a background refetch.
  //
  // Deliberately **not** keyed on `template.updatedAt`. `main.tsx` builds a
  // bare `new QueryClient()`, so `refetchOnWindowFocus` is on and `staleTime`
  // is 0, and `afterChange` invalidates `["admin", "asset-template"]` after
  // every lifecycle action. Reseeding on a newer `updatedAt` would mean: type
  // into Details, click Publish in the header, and watch the typed text vanish
  // with no message. A save needs no reseed either — the form already holds
  // what was sent, and `buildDetailsPatch` compares against the refreshed
  // template, so Save disables itself.
  useEffect(() => {
    setForm(detailsFormFrom(template));
    setError(null);
  }, [template.id, template.status]);

  const errors = detailsFormErrors(form);
  const patch = buildDetailsPatch(form, template);
  const blocked = Object.keys(errors).length > 0;

  // `buildDetailsPatch` returns `null` for a form that matches what is stored,
  // so it is already the dirty signal — no second comparison to drift from it.
  // The cleanup reports clean on unmount so a switch away cannot leave the
  // page holding this tab's `true`.
  const dirty = patch !== null;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const saveM = useMutation({
    mutationFn: () => {
      if (!patch) {
        // Unreachable behind the disabled button. Refusing beats sending `{}`,
        // which validates, bumps `updatedAt` and writes an audit row recording
        // no change.
        return Promise.reject(new Error("Nothing has changed yet."));
      }
      return updateAdminAssetTemplate(template.id, patch);
    },
    onSuccess: (next) => {
      setError(null);
      onSaved(next);
    },
    // The service's own sentence is the actionable one — a point key that went
    // inactive, a domain that is not in the vocabulary. Rendered verbatim.
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  // The shared key, not a fourth fetch of the same nine-row payload — the rules
  // page, the rule builder and the create form all read this one cache entry.
  const vocabQ = useQuery({ queryKey: vocabulariesQueryKey, queryFn: fetchVocabularies });
  const domains = vocabQ.data?.assetDomains ?? [];

  // A published or archived row still holds a domain code. If the vocabulary
  // has not loaded, or the stored code was since deactivated, the select would
  // otherwise render blank and read as "no domain set".
  const domainIsKnown = domains.some((entry) => entry.code === form.domain);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked && patch) {
          saveM.mutate();
        }
      }}
    >
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name" error={errors.name}>
          <input
            type="text"
            value={form.name}
            disabled={!editable}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            className={inputClass(!editable, errors.name)}
          />
        </Field>

        <Field label="Asset type" error={errors.assetType} hint="For example: chiller, pump, ups.">
          <input
            type="text"
            value={form.assetType}
            disabled={!editable}
            onChange={(event) =>
              setForm((current) => ({ ...current, assetType: event.target.value }))
            }
            className={inputClass(!editable, errors.assetType)}
          />
        </Field>

        <Field label="Domain" error={errors.domain}>
          <select
            value={form.domain}
            disabled={!editable || vocabQ.isLoading}
            onChange={(event) =>
              setForm((current) => ({ ...current, domain: event.target.value }))
            }
            className={inputClass(!editable, errors.domain)}
          >
            <option value="">Select a domain…</option>
            {/* The stored code, when the vocabulary does not offer it. Keeping
                it selectable means a read-only view shows the truth, and an
                editable draft does not silently switch domain on the next save
                just because the author opened this tab. */}
            {!domainIsKnown && form.domain !== "" ? (
              <option value={form.domain}>{form.domain} (no longer offered)</option>
            ) : null}
            {domains.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description" error={errors.description}>
        <textarea
          rows={4}
          value={form.description}
          disabled={!editable}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
          className={inputClass(!editable, errors.description)}
        />
      </Field>

      {editable ? (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={blocked || !patch || saveM.isPending}
            className="rounded bg-bms-green px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saveM.isPending ? "Saving…" : "Save details"}
          </button>
          <span className="text-[11px] text-bms-muted">
            {blocked
              ? "Fix the fields above to save."
              : patch
                ? `Sends ${Object.keys(patch).length} changed field${
                    Object.keys(patch).length === 1 ? "" : "s"
                  }.`
                : "No changes yet."}
          </span>
        </div>
      ) : null}
    </form>
  );
}

function inputClass(disabled: boolean, error: string | undefined): string {
  const base = "w-full rounded border px-2 py-1.5 text-xs";
  const tone = error ? "border-red-300 bg-red-50" : "border-gray-200";
  return `${base} ${tone} ${disabled ? "bg-gray-50 text-bms-muted" : ""}`;
}
