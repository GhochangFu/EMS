/**
 * `F3.85` PR 10b / ADR 0099 decision 6 (plan §11.2) — Instantiate is the
 * `dashboardTemplate.instantiate` stepper on the shared `WizardShell`: Target,
 * Details, then Review. It replaces the page's two instantiate dialogs (the
 * group arm and the `F3.73` site arm) and keeps what they did: the
 * organization-wide option only for a template that binds no role (`E4.2`), the
 * slug rule, the trimmed slug and name, and the answer — the resolution report
 * for a group template (the page renders it: ADR 0049 Amendment 2 decision 1)
 * and the one site's copy for a site template.
 *
 * **One body, two arms.** The body is a union of two strict arms, and the stored
 * template's `target` picks the arm: a group template sends `{ assetGroupId,
 * slug, name }`, a site template `{ locationId }`. The wizard never puts the
 * other arm's keys in its values — a site template's Details step has no
 * inputs — since a body that mixes them fails both arms. A field with no input
 * (`description`, `tabGroups`, the other arm's key) is shown as text when the
 * copilot fills it.
 *
 * Moved out of `dashboard-template-detail-page.tsx` to keep that page under the
 * AGENTS.md §4.5 cap. It sends no `X-Copilot-Change` header (plan §10.5).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import {
  type DashboardTemplateDto,
  type InstantiateSectionTemplateBody,
  type InstantiateSectionTemplateResponse,
  type SiteLayoutResultDto,
  TEMPLATE_TARGET_BODY_MESSAGE,
  templateTargetBodyMessage,
} from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { fetchAdminAssetGroups } from "../../api/admin/asset-groups";
import {
  type InstantiateDashboardTemplateInput,
  instantiateAdminDashboardTemplate,
  instantiateSiteTemplate,
} from "../../api/admin/dashboard-templates";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  DASHBOARD_SLUG_HINT,
  DASHBOARD_SLUG_MAX,
  DASHBOARD_SLUG_MIN,
  DASHBOARD_SLUG_PATTERN,
} from "../../lib/dashboard-slug";
import type { WizardStep } from "../../lib/wizard-steps";
import { WizardShell } from "../wizard/wizard-shell";
import { madeSummary, useSiteLocations } from "./apply-to-sites-dialog";

/** The sentinel the group select uses for "no group". `""` is taken by the
 * "select one…" placeholder; the values hold `assetGroupId: null` instead. */
const ORGANIZATION_WIDE = "__organization_wide__";

/** The API's `E4.2` refusal (`dashboard-templates-instantiate.service.ts`), said before the wire. */
const ROLE_BINDINGS_NEED_A_GROUP = "A template with role bindings needs an asset group";

const FIELD_LABELS: Record<string, string> = {
  assetGroupId: "Asset group",
  locationId: "Location",
  tabGroups: "Tab groups",
  name: "Name",
  slug: "Slug",
  description: "Description",
};

type Answer =
  | { readonly kind: "group"; readonly result: InstantiateSectionTemplateResponse }
  | { readonly kind: "site"; readonly result: SiteLayoutResultDto };

/** The body as sent: the group arm's slug and name trimmed, as the dialog trimmed them. */
function trimmedBody(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  for (const field of ["slug", "name"]) {
    if (typeof next[field] === "string") next[field] = (next[field] as string).trim();
  }
  return next;
}

/** Lines for the values the copilot filled into fields this step shows no input for. */
function filledNotes(values: Record<string, unknown>, fields: readonly string[]): ReactNode {
  return fields
    .filter((field) => values[field] !== undefined)
    .map((field) => (
      <p key={field} className="text-[11px] text-ink-muted">
        {FIELD_LABELS[field] ?? field}:{" "}
        {typeof values[field] === "string" ? (values[field] as string) : JSON.stringify(values[field])} (filled by the
        copilot).
      </p>
    ));
}

/** The instantiate wizard and its answer, in the page's dialog frame. */
export function InstantiateWizard({
  template,
  onClose,
  renderReport,
}: {
  template: DashboardTemplateDto;
  onClose: () => void;
  /** The group arm's resolution report — rendered unconditionally on success. */
  renderReport: (result: InstantiateSectionTemplateResponse) => ReactNode;
}) {
  const isSite = template.target === "site";
  // The site arm takes no name or slug, so nothing is seeded for it.
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    isSite ? {} : { name: `${template.name} dashboard` },
  );
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);

  const groupsQ = useQuery({
    queryKey: ["admin", "asset-groups", "all"],
    queryFn: () => fetchAdminAssetGroups(),
    enabled: !isSite,
  });
  const groups = groupsQ.data?.items ?? [];
  const locationsQ = useSiteLocations(template, isSite);

  const instantiateM = useMutation({
    mutationFn: async (body: Record<string, unknown>): Promise<Answer> => {
      if (isSite) {
        // `refusal` already holds this; the narrow keeps a site send from ever carrying no location.
        if (typeof body.locationId !== "string") throw new Error(TEMPLATE_TARGET_BODY_MESSAGE);
        return {
          kind: "site",
          result: await instantiateSiteTemplate(
            template.id,
            body.locationId,
            body.tabGroups as Record<string, string> | undefined,
          ),
        };
      }
      return {
        kind: "group",
        result: await instantiateAdminDashboardTemplate(template.id, body as unknown as InstantiateDashboardTemplateInput),
      };
    },
    onSuccess: (response) => {
      setError(null);
      setAnswer(response);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  /** `E4.2`, ADR 0072 decision 1 — a binding resolves against a group's members, so a template
   * that binds one cannot instantiate organization-wide; the option is offered only without one. */
  const bindsARole = template.content.widgets.some((widget) => widget.bindings.length > 0);

  /**
   * What the API would refuse that Review cannot see, said before the wire. Review accepts either
   * union arm, and a copilot fill can put the other arm's keys in the values; the stored
   * template's `target` picks the arm (`templateTargetBodyMessage`, the service's own check). A
   * template that binds a role refuses an organization-wide body — the API's `E4.2` sentence.
   */
  function refusal(body: Record<string, unknown>): string | null {
    const targetMessage = templateTargetBodyMessage(template.target, body as InstantiateSectionTemplateBody);
    if (targetMessage !== null) return targetMessage;
    if (!isSite && bindsARole && body.assetGroupId === null) return ROLE_BINDINGS_NEED_A_GROUP;
    return null;
  }

  // A value change clears the last refusal: the shell shows `submitError` in place of Review's problems.
  function update(next: Record<string, unknown>): void {
    setError(null);
    setValues(next);
  }

  /** `values` with `field` set to `value`, or removed when it is "" — the wizard sends no key it left unset. */
  const set = (field: string, value: unknown) => update({ ...values, [field]: value === "" ? undefined : value });

  function renderStep(step: WizardStep): ReactNode {
    if (step.id === "target") return isSite ? renderSiteTarget() : renderGroupTarget();
    if (step.id !== "details") return null;
    if (isSite) {
      return (
        <>
          <p className="text-[11px] text-ink-muted">
            A site layout takes no name or slug: the copy is named for its site.
          </p>
          {filledNotes(values, ["name", "slug", "description"])}
        </>
      );
    }
    const text = (field: string) => (typeof values[field] === "string" ? (values[field] as string) : "");
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* The hint is a sibling of the label, never inside it: a wrapping label gives ALL its text
              to the control's accessible name, and the field must stay named "Slug". */}
          <div>
            <label className="block text-xs font-semibold text-ink">
              Slug
              <input
                required
                value={text("slug")}
                // The raw value is kept, so a space inside the slug fails the rule at Details (the dialog
                // refused it too); the ends are trimmed on blur, as the Name field does.
                onChange={(event) => set("slug", event.target.value)}
                onBlur={() => setValues(trimmedBody(values))}
                placeholder="electrical-plant-1"
                pattern={DASHBOARD_SLUG_PATTERN}
                minLength={DASHBOARD_SLUG_MIN}
                maxLength={DASHBOARD_SLUG_MAX}
                title={DASHBOARD_SLUG_HINT}
                aria-describedby="instantiate-slug-hint"
                className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
              />
            </label>
            <span id="instantiate-slug-hint" className="mt-1 block text-[11px] text-ink-muted">
              {DASHBOARD_SLUG_HINT}
            </span>
          </div>
          <label className="block text-xs font-semibold text-ink">
            Name
            <input
              required
              value={text("name")}
              onChange={(event) => set("name", event.target.value)}
              onBlur={() => setValues(trimmedBody(values))}
              className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
            />
          </label>
        </div>
        {filledNotes(values, ["description"])}
      </>
    );
  }

  function renderGroupTarget(): ReactNode {
    const selected =
      values.assetGroupId === null ? ORGANIZATION_WIDE : typeof values.assetGroupId === "string" ? values.assetGroupId : "";
    return (
      <>
        <label className="block text-xs font-semibold text-ink">
          Asset group
          <select
            required
            value={selected}
            // The sentinel never reaches the body: organization-wide is `assetGroupId: null`.
            onChange={(event) => set("assetGroupId", event.target.value === ORGANIZATION_WIDE ? null : event.target.value)}
            className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
          >
            <option value="">Select an asset group…</option>
            {bindsARole ? null : <option value={ORGANIZATION_WIDE}>Organization-wide (no group)</option>}
            {/* The location qualifier tells same-named groups apart (one "Electrical" per site), and the
                member count warns of an all-`unresolved` report before it happens (`F3.36`). */}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.locationName ? `${group.name} — ${group.locationName}` : group.name}
                {` (${group.memberCount} member${group.memberCount === 1 ? "" : "s"})`}
              </option>
            ))}
          </select>
        </label>
        {filledNotes(values, ["locationId", "tabGroups"])}
      </>
    );
  }

  function renderSiteTarget(): ReactNode {
    return (
      <>
        <label className="block text-xs font-semibold text-ink">
          Location
          <select
            required
            value={typeof values.locationId === "string" ? values.locationId : ""}
            onChange={(event) => set("locationId", event.target.value)}
            className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
          >
            <option value="">Select a location…</option>
            {(locationsQ.data?.items ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        {filledNotes(values, ["assetGroupId", "tabGroups"])}
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
      <div className="w-full max-w-2xl space-y-3 surface-dialog p-4">
        <h2 className="font-condensed text-base font-bold text-ink">
          Instantiate {template.code} v{template.version}
        </h2>
        {answer === null ? (
          <WizardShell
            entry={catalogEntry("dashboardTemplate.instantiate")!}
            values={values}
            onChange={update}
            renderStep={renderStep}
            onSubmit={(body) => {
              // A second Submit clears the last refusal first, as the dialogs did.
              setError(null);
              const refused = refusal(body);
              if (refused !== null) {
                setError(refused);
                return;
              }
              instantiateM.mutate(trimmedBody(body));
            }}
            onCancel={onClose}
            submitting={instantiateM.isPending}
            submitError={error}
            summary={catalogEntry("dashboardTemplate.instantiate")!.summary({
              body: values,
              params: { id: template.id },
              targetName: template.name,
              organizationName: "",
            })}
          />
        ) : (
          <>
            {answer.kind === "group" ? (
              renderReport(answer.result)
            ) : (
              <p className="rounded border border-accent/20 bg-ok-wash p-2 text-xs text-ok-ink">
                Created the site layout <strong>{answer.result.dashboardSlug}</strong>. {madeSummary(answer.result)}.
              </p>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="surface-button px-3 py-1.5">
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
