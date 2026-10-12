import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import type { SiteLayoutBody, SiteLayoutResultDto } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { makeSiteLayout, type MakeSiteLayoutAnswer } from "../../api/control-room";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { apiErrorMessage } from "../../lib/api-error-message";
import { domainLabel } from "../../lib/asset-browser";
import { madeSummary } from "../dashboard-templates/apply-to-sites-dialog";
import { WizardShell } from "../wizard/wizard-shell";

/**
 * The stock site template's tab labels, by tab key. The 409 body carries the key and the domain
 * code only, so the picker names a tab by this map and falls back to the key for a tab a custom
 * template added. A label on the 409 body would retire this map (reported, not built here).
 */
const STOCK_TAB_LABELS: Readonly<Record<string, string>> = {
  overview: "Overview",
  sld: "Electrical",
  ups: "UPS & battery",
  hvac: "HVAC",
  it: "IT",
  env: "Environment",
  water: "Water",
};

/** Shown on Review, in place of a request, when a tab of the last `ambiguous` answer has no group. */
export const CHOOSE_EVERY_TAB = "Choose a group for every tab";

type AmbiguousTabs = Extract<MakeSiteLayoutAnswer, { kind: "ambiguous" }>["ambiguous"];

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.86: the catalog has no entry "${id}"`);
  return entry;
}

/** The values' `tabGroups`, as a map of strings. */
function tabGroupsOf(values: Readonly<Record<string, unknown>>): Record<string, string> {
  const raw = values.tabGroups;
  if (raw === null || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw).filter((pair): pair is [string, string] => typeof pair[1] === "string"));
}

type SiteLayoutWizardProps = {
  locationId: string;
  /** The site's name, for the Review sentence. */
  siteName: string;
};

/**
 * `F3.73` plan D10 (ruling Q4), and since `F3.86` PR 3d (ADR 0099 decision 6, ruling Q7(b),
 * plan §5.5) the `location.siteLayout.make` stepper — **Make site layout** on the site page's
 * `no_site_layout` and `dashboard_removed` notices opens it. The site page renders it for
 * `isMasterDataAdmin` roles only; the API decides again (`requireMasterDataUser`,
 * `assertCanManageLocation`, `canManageDashboard`), and a refusal shows its own sentence on Review.
 *
 * Groups, then Review. The first Submit sends no choice (`{}`: the organization's newest
 * published site template). A 409 `ambiguous` is a plan with no write: the wizard keeps the tabs
 * **from the 409 body** (no second read), re-mounts the shell so it opens on Groups again, and
 * the step shows one select per ambiguous tab. Each starts empty, and a Submit before every tab
 * has a choice sends nothing — so the action never sends a group the administrator did not pick.
 * A copilot-filled `templateId` is shown as text; the wizard offers no template choice.
 *
 * A made copy shows its summary; Close invalidates the page's resolve read
 * (`["control-room", "site-view", locationId]`, `site-page.tsx`) and nothing wider, so the page
 * re-resolves to the new `dashboard` view — after the summary was read, since the re-resolve
 * drops the notice this wizard sits in. A copy made after Cancel closed the wizard invalidates the
 * same key at once. Submit sends no `X-Copilot-Change` header.
 */
export function SiteLayoutWizard({ locationId, siteName }: SiteLayoutWizardProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  /** Read by the mutation's `onSuccess`, which can run after Cancel closed the wizard. */
  const openRef = useRef(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [ambiguous, setAmbiguous] = useState<AmbiguousTabs | null>(null);
  /** A new shell per answer: the shell owns its step index, and a re-mount is the way back to Groups. */
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<SiteLayoutResultDto | null>(null);

  // The domain's label from the vocabulary, read only once the picker is open.
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
    enabled: ambiguous !== null,
  });
  const tabName = (tab: AmbiguousTabs[number]): string =>
    `${STOCK_TAB_LABELS[tab.tabKey] ?? tab.tabKey} tab (${domainLabel(tab.domain, vocabQ.data?.assetDomains ?? [])})`;

  const make = useMutation({
    mutationFn: (body: Record<string, unknown>) => makeSiteLayout(locationId, body as SiteLayoutBody),
    onSuccess: (answer) => {
      setError(null);
      if (answer.kind === "ambiguous") {
        setAmbiguous(answer.ambiguous);
        setValues((current) => ({ ...current, tabGroups: {} }));
        setAttempt((current) => current + 1);
        return;
      }
      setMade(answer.result);
      // Cancel during a pending Submit closed the wizard with no summary to Close, so the
      // success invalidates the resolve read itself: else the stale notice stays, and a second
      // Make site layout gets 409 `has_view`.
      if (!openRef.current) {
        void queryClient.invalidateQueries({ queryKey: ["control-room", "site-view", locationId] });
      }
    },
    onError: (cause: unknown) => setError(apiErrorMessage(cause)),
  });

  function start(): void {
    setValues({});
    setAmbiguous(null);
    setError(null);
    setMade(null);
    setAttempt((current) => current + 1);
    openRef.current = true;
    setOpen(true);
  }

  function close(): void {
    openRef.current = false;
    setOpen(false);
    if (made !== null) {
      void queryClient.invalidateQueries({ queryKey: ["control-room", "site-view", locationId] });
    }
  }

  function submit(body: Record<string, unknown>): void {
    setError(null);
    const chosen = tabGroupsOf(body);
    if (ambiguous !== null && !ambiguous.every((tab) => (chosen[tab.tabKey] ?? "") !== "")) {
      setError(CHOOSE_EVERY_TAB);
      return;
    }
    make.mutate(body);
  }

  function choose(tabKey: string, groupId: string): void {
    setError(null);
    const next = tabGroupsOf(values);
    if (groupId === "") delete next[tabKey];
    else next[tabKey] = groupId;
    setValues({ ...values, tabGroups: next });
  }

  function renderGroups(): ReactNode {
    const chosen = tabGroupsOf(values);
    const templateId = typeof values.templateId === "string" ? values.templateId : null;
    return (
      <>
        <p className="text-xs text-ink">
          Template:{" "}
          {templateId === null
            ? "the organization's newest published site template"
            : `${templateId} (filled by the copilot)`}
          .
        </p>
        {ambiguous === null ? (
          <p className="text-[11px] text-ink-muted">
            Each tab is matched to the site&apos;s asset groups. If more than one group fits a tab, you choose here after
            Submit.
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

  const entry = wizardEntry("location.siteLayout.make");
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={start}
        disabled={open}
        className="surface-button px-3 py-1 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
      >
        Make site layout
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
          <div role="dialog" aria-labelledby="site-layout-wizard-title" className="w-full max-w-lg space-y-3 surface-dialog p-4 text-ink">
            <h2 id="site-layout-wizard-title" className="font-condensed text-lg font-bold">
              {entry.title}: {siteName}
            </h2>
            {made === null ? (
              <WizardShell
                key={attempt}
                entry={wizardEntry("location.siteLayout.make")}
                values={values}
                onChange={(next) => {
                  setError(null);
                  setValues(next);
                }}
                renderStep={renderGroups}
                onSubmit={submit}
                onCancel={close}
                submitting={make.isPending}
                submitError={error}
                summary={entry.summary({ body: values, params: { id: locationId }, targetName: siteName, organizationName: "" })}
              />
            ) : (
              <>
                <p className="rounded border border-accent/20 bg-ok-wash p-2 text-xs text-ok-ink">
                  Created the site layout <strong>{made.dashboardSlug}</strong>. {madeSummary(made)}.
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
