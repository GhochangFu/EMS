import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { makeSiteLayout, type MakeSiteLayoutAnswer, type MakeSiteLayoutBody } from "../../api/control-room";
import { apiErrorMessage } from "../../lib/api-error-message";

type AmbiguousTabs = Extract<MakeSiteLayoutAnswer, { kind: "ambiguous" }>["ambiguous"];

type MakeSiteLayoutButtonProps = {
  locationId: string;
};

/**
 * `F3.73` plan D10 (ruling Q4) — **Make site layout** on the site page's `no_site_layout` and
 * `dashboard_removed` notices. The site page renders it for `isMasterDataAdmin` roles only; the
 * API decides again (`requireMasterDataUser`, `assertCanManageLocation`, `canManageDashboard`),
 * and a refusal shows its own sentence here.
 *
 * The first click sends no choice. A made copy invalidates the page's resolve read
 * (`["control-room", "site-view", locationId]`, `site-page.tsx`) and nothing wider, so the page
 * re-resolves to the new `dashboard` view. A 409 `ambiguous` opens the picker: one select per
 * ambiguous tab, fed **from the 409 body's candidates** (no second read). Each select starts
 * empty and the retry stays disabled until every tab has a choice, so the action never sends a
 * group the administrator did not pick; the retry carries the choices as `tabGroups`.
 */
export function MakeSiteLayoutButton({ locationId }: MakeSiteLayoutButtonProps) {
  const queryClient = useQueryClient();
  const [ambiguous, setAmbiguous] = useState<AmbiguousTabs | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const make = useMutation({
    mutationFn: (body: MakeSiteLayoutBody) => makeSiteLayout(locationId, body),
    onSuccess: (answer) => {
      if (answer.kind === "ambiguous") {
        setAmbiguous(answer.ambiguous);
        setChoice({});
        return;
      }
      setAmbiguous(null);
      void queryClient.invalidateQueries({ queryKey: ["control-room", "site-view", locationId] });
    },
  });

  const chosenForEveryTab =
    ambiguous !== null && ambiguous.every((tab) => (choice[tab.tabKey] ?? "") !== "");

  const retry = () => {
    if (ambiguous === null || !chosenForEveryTab) {
      return;
    }
    const tabGroups: Record<string, string> = {};
    for (const tab of ambiguous) {
      tabGroups[tab.tabKey] = choice[tab.tabKey] as string;
    }
    make.mutate({ tabGroups });
  };

  return (
    <div className="space-y-2">
      {ambiguous === null ? (
        <button
          type="button"
          onClick={() => make.mutate({})}
          disabled={make.isPending}
          aria-busy={make.isPending}
          className="surface-button border border-warning-line px-3 py-1 text-sm font-semibold text-warning-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {make.isPending ? "Making the site layout…" : "Make site layout"}
        </button>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-warning-ink">Choose an asset group per tab</legend>
          {ambiguous.map((tab) => (
            <label key={tab.tabKey} className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <span>
                {tab.tabKey} tab ({tab.domain})
              </span>
              <select
                aria-label={`Asset group for the ${tab.tabKey} tab (${tab.domain})`}
                className="surface-field px-2 py-1 text-ink"
                value={choice[tab.tabKey] ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setChoice((previous) => ({ ...previous, [tab.tabKey]: value }));
                }}
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
          <button
            type="button"
            onClick={retry}
            disabled={!chosenForEveryTab || make.isPending}
            aria-busy={make.isPending}
            className="surface-button border border-warning-line px-3 py-1 text-sm font-semibold text-warning-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {make.isPending ? "Making the site layout…" : "Make site layout with these groups"}
          </button>
        </fieldset>
      )}
      {make.isError ? (
        <p role="alert" className="text-sm text-critical-ink">
          {apiErrorMessage(make.error)}
        </p>
      ) : null}
    </div>
  );
}
