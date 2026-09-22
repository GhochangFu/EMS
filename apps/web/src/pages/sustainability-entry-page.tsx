import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { fetchDashboards } from "../api/dashboards";
import { AppShell } from "../layouts/app-shell";
import { apiErrorMessage } from "../lib/api-error-message";
import type { AuthUser } from "../stores/auth-store";

type SustainabilityEntryPageProps = {
  user: AuthUser;
};

/**
 * `E4.2` / ADR 0072 decision 1 — what the sidebar's **Sustainability** entry
 * opens.
 *
 * *"It opens the caller's organization's newest instance of the `sustainability`
 * section — the newest dashboard stamped from a template whose `section` is
 * `sustainability`, whatever its scope. When no instance exists the entry opens
 * `/dashboards` filtered to the section, so an admin sees the import action
 * rather than a 404."*
 *
 * **A route that redirects, rather than a second dashboard viewer.** The viewer
 * is `/dashboards/:slug` and it is not this row's to duplicate: a second
 * renderer would be a second place for the widget grid, the catalog read and the
 * refresh interval to drift. This page holds one query and one `<Navigate>`.
 *
 * **Newest by `createdAt`, not "the first item".** `list()` orders by
 * `dashboards.slug`, so `items[0]` is alphabetical and would open whichever
 * instance happens to sort first — a plant that imported the template twice
 * would land on the older one for as long as its slug sorted earlier, which no
 * user could explain. The comparison is on the string: `createdAt` is an ISO
 * timestamp from `toISOString()`, so lexical and chronological order agree.
 *
 * `organizationId` rides the redirect for the reason the list's Open link
 * carries it: on the fleet pool a slug can match more than one organization's
 * dashboard, and `GET /dashboards/:slug` answers a 400 rather than guessing (D5).
 */
export function SustainabilityEntryPage({ user }: SustainabilityEntryPageProps) {
  const listQ = useQuery({
    queryKey: ["dashboards", "list", { section: "sustainability" }],
    queryFn: () => fetchDashboards(undefined, undefined, "sustainability"),
  });

  if (listQ.isLoading) {
    return (
      <AppShell user={user} kpiRibbon={<span className="text-bms-ink">Sustainability</span>}>
        <p className="mx-auto max-w-[1200px] text-sm text-bms-muted">Opening Sustainability…</p>
      </AppShell>
    );
  }

  if (listQ.isError) {
    return (
      <AppShell user={user} kpiRibbon={<span className="text-bms-ink">Sustainability</span>}>
        <p className="mx-auto max-w-[1200px] rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {apiErrorMessage(listQ.error as Error)}
        </p>
      </AppShell>
    );
  }

  const newest = [...(listQ.data?.items ?? [])].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  )[0];

  if (!newest) {
    // The filtered list, never a 404 and never the unfiltered one: an admin who
    // has not imported the stock template yet needs to see the import action,
    // and an operator needs to see that the section is empty rather than that
    // the page is broken.
    return <Navigate replace to="/dashboards?section=sustainability" />;
  }

  // `encodeURIComponent`, the way this file's sibling reader spells the same
  // path (`api/dashboards.ts`, `fetchDashboard`). A slug is `[a-z0-9-]+` at
  // both write doors, so nothing should reach here needing the escape — but
  // this component reads a slug off the WIRE, not out of the schema, and an
  // unencoded `?`, `#` or `/` in it does not merely mis-navigate: it hands the
  // rest of the string to the router as query, fragment or an extra path
  // segment. The encode costs nothing and does not depend on the far end
  // staying correct. `organizationId` is a uuid from the same response and is
  // encoded for the same reason.
  return (
    <Navigate
      replace
      to={
        `/dashboards/${encodeURIComponent(newest.slug)}` +
        `?organizationId=${encodeURIComponent(newest.organizationId)}`
      }
    />
  );
}
