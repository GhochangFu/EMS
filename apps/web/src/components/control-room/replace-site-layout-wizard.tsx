import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import type { SiteLayoutBody, SiteLayoutReplacePreviewDto, SiteLayoutReplaceResultDto } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import {
  fetchSiteLayoutReplacePreview,
  replaceSiteLayout,
  type ReplaceSiteLayoutAnswer,
  siteLayoutReplacePreviewKey,
} from "../../api/admin/site-layout-replace";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { apiErrorMessage } from "../../lib/api-error-message";
import { domainLabel } from "../../lib/asset-browser";
import { dashboardsAfterReplaceFilters, editFlagText, heldCopyText, REPLACE_LOSES } from "../../lib/site-layout-replace";
import { madeSummary } from "../../lib/site-layout-made-summary";
import { WizardShell } from "../wizard/wizard-shell";
import { CHOOSE_EVERY_TAB, stockTabLabel, tabGroupsOf } from "./site-layout-wizard";

type AmbiguousTabs = Extract<ReplaceSiteLayoutAnswer, { kind: "ambiguous" }>["ambiguous"];
type PreviewSite = SiteLayoutReplacePreviewDto["sites"][number];

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.320: the catalog has no entry "${id}"`);
  return entry;
}

type ReplaceSiteLayoutWizardProps = {
  locationId: string;
  /** The site's name, for the title and the Review sentence. */
  siteName: string;
};

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decisions 3–10, ADR 0099 Amendment 15) — **Replace with this
 * version** on the site page, the `location.siteLayout.replace` stepper. The site page renders it
 * for a master-data admin on a `dashboard` view (the roles that see Make); the button itself shows
 * only when the preview read says the view is a template copy that Replace would rebuild
 * (`outcome = "replace"`). The API decides again at Submit (the Make permission rule).
 *
 * Groups, then Review — the Make wizard's shape (`site-layout-wizard.tsx`): the first Submit sends
 * no choice, and a 409 `ambiguous` re-opens Groups with one select per tab from the 409 body. The
 * Review step adds the confirm of decisions 6 and 9: the copy held, the version it becomes, what is
 * lost, and the edit flag ("Edited 3 times since the copy, last on … by …", or "No recorded edit
 * since the copy"). The flag is advice: Submit is never refused for an edited copy.
 *
 * A rebuilt copy has a new dashboard id under the same slug, so Close invalidates the site's resolve
 * read (and, by prefix, this preview) and the `["dashboards"]` reads by slug or list (the canvas reads
 * the dashboard by slug). It skips the id-keyed reads (`dashboardsAfterReplaceFilters`): the canvas
 * still holds the deleted id, and a re-read of it is a 404.
 * A Replace that lands after Cancel closed the wizard invalidates the same keys at once.
 */
export function ReplaceSiteLayoutWizard({ locationId, siteName }: ReplaceSiteLayoutWizardProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  /** Read by the mutation's `onSuccess`, which can run after Cancel closed the wizard. */
  const openRef = useRef(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [ambiguous, setAmbiguous] = useState<AmbiguousTabs | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [replaced, setReplaced] = useState<SiteLayoutReplaceResultDto | null>(null);

  const previewQ = useQuery({
    queryKey: siteLayoutReplacePreviewKey(locationId),
    queryFn: () => fetchSiteLayoutReplacePreview(locationId),
    // A refusal (no published version, a role the API refuses) hides the button; it is not retried.
    retry: false,
  });
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
    enabled: ambiguous !== null,
  });

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ["control-room", "site-view", locationId] });
    void queryClient.invalidateQueries(dashboardsAfterReplaceFilters());
  }

  const replace = useMutation({
    mutationFn: (body: Record<string, unknown>) => replaceSiteLayout(locationId, body as SiteLayoutBody),
    onSuccess: (answer) => {
      setError(null);
      if (answer.kind === "ambiguous") {
        setAmbiguous(answer.ambiguous);
        setValues((current) => ({ ...current, tabGroups: {} }));
        setAttempt((current) => current + 1);
        return;
      }
      setReplaced(answer.result);
      if (!openRef.current) refresh();
    },
    onError: (cause: unknown) => setError(apiErrorMessage(cause)),
  });

  const preview = previewQ.data;
  const site: PreviewSite | undefined = preview?.sites.find((row) => row.locationId === locationId);
  if (preview === undefined || site === undefined || site.outcome !== "replace" || site.held === null) {
    return null;
  }
  const held = site.held;

  const tabName = (tab: AmbiguousTabs[number]): string =>
    `${stockTabLabel(tab.tabKey)} tab (${domainLabel(tab.domain, vocabQ.data?.assetDomains ?? [])})`;

  function start(): void {
    // The page may have sat open for a while: read the edit flag again for the confirm step.
    void previewQ.refetch();
    setValues({});
    setAmbiguous(null);
    setError(null);
    setReplaced(null);
    setAttempt((current) => current + 1);
    openRef.current = true;
    setOpen(true);
  }

  function close(): void {
    openRef.current = false;
    setOpen(false);
    if (replaced !== null) refresh();
  }

  function submit(body: Record<string, unknown>): void {
    setError(null);
    const chosen = tabGroupsOf(body);
    if (ambiguous !== null && !ambiguous.every((tab) => (chosen[tab.tabKey] ?? "") !== "")) {
      setError(CHOOSE_EVERY_TAB);
      return;
    }
    replace.mutate(body);
  }

  function choose(tabKey: string, groupId: string): void {
    setError(null);
    const next = tabGroupsOf(values);
    if (groupId === "") delete next[tabKey];
    else next[tabKey] = groupId;
    setValues({ ...values, tabGroups: next });
  }

  const templateId = typeof values.templateId === "string" ? values.templateId : null;
  const target =
    templateId === null ? `${preview.templateCode} v${preview.version}` : `template ${templateId} (filled by the copilot)`;

  function renderGroups(): ReactNode {
    const chosen = tabGroupsOf(values);
    return (
      <>
        <p className="text-xs text-ink">
          Template: {templateId === null ? `the newest published version, ${target}` : target}.
        </p>
        {ambiguous === null ? (
          <p className="text-[11px] text-ink-muted">
            Each tab keeps the asset group the copy bound. A new tab is matched to the site&apos;s asset groups; if more
            than one fits, you choose here after Submit.
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Choose an asset group per tab</legend>
            {ambiguous.map((tab) => (
              <label key={tab.tabKey} className="flex flex-wrap items-center gap-2 text-sm text-ink">
                <span>{tabName(tab)}</span>
                <select
                  aria-label={`Asset group for the ${tabName(tab)}`}
                  className="surface-field px-2 py-1 text-ink"
                  value={chosen[tab.tabKey] ?? ""}
                  onChange={(event) => choose(tab.tabKey, event.target.value)}
                >
                  <option value="">Choose a group</option>
                  {tab.candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
        )}
      </>
    );
  }

  const confirm = (
    <section aria-label="What Replace changes" className="space-y-1 text-xs text-ink">
      <p>
        This site holds <strong>{heldCopyText(held)}</strong>. Replace makes it again from <strong>{target}</strong>.
      </p>
      <p className="text-critical-ink">{REPLACE_LOSES}</p>
      <p data-testid="replace-edit-flag" className="font-semibold">
        {editFlagText(site.edits)}
      </p>
    </section>
  );

  const entry = wizardEntry("location.siteLayout.replace");
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={start}
        disabled={open}
        className="surface-button px-3 py-1 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
      >
        Replace with this version
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          <div
            role="dialog"
            aria-labelledby="replace-site-layout-wizard-title"
            className="w-full max-w-lg space-y-3 surface-dialog p-4 text-ink"
          >
            <h2 id="replace-site-layout-wizard-title" className="font-condensed text-lg font-bold">
              {entry.title}: {siteName}
            </h2>
            {replaced === null ? (
              <WizardShell
                key={attempt}
                entry={wizardEntry("location.siteLayout.replace")}
                params={{ id: locationId }}
                values={values}
                onChange={(next) => {
                  setError(null);
                  setValues(next);
                }}
                renderStep={renderGroups}
                onSubmit={submit}
                onCancel={close}
                submitting={replace.isPending}
                submitError={error}
                review={{ omit: [], detail: confirm }}
                summary={entry.summary({ body: values, params: { id: locationId }, targetName: siteName, organizationName: "" })}
              />
            ) : (
              <>
                <p className="rounded border border-accent/20 bg-ok-wash p-2 text-xs text-ok-ink">
                  Replaced v{replaced.previousVersion} with v{replaced.version}: <strong>{replaced.dashboardSlug}</strong>.{" "}
                  {madeSummary(replaced)}.
                </p>
                <div className="flex justify-end">
                  <button type="button" onClick={close} className="surface-button px-3 py-1.5">
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
