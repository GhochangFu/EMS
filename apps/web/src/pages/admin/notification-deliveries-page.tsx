import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { fetchNotificationChannels, fetchNotificationDeliveries } from "../../api/notifications";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import {
  deliveryStatusLabel,
  deliveryStatusTone,
  organizationLabel,
} from "../../lib/notification-channels";
import type { AuthUser } from "../../stores/auth-store";

type NotificationDeliveriesPageProps = { user: AuthUser };

/**
 * `F3.8` — the delivery ledger (ADR 0041 decisions 4 and 10), org-aware since
 * `E7.1d` (ADR 0043 Consequences).
 *
 * **Every attempt, including every skip, and no default filter.** Decision 10
 * is explicit that `skipped_unconfigured` and `skipped_rate_limited` are the
 * two states an operator most needs to see and the two a "sent items" list
 * would hide. A filter exists, it starts at "all", and the empty state says
 * what an empty ledger means rather than looking like a loading failure.
 *
 * **`E7.1d` adds the organization, as a column and as a filter.** The rows an
 * `admin` sees here span every tenant — `ChannelsService.listDeliveries`
 * filters by `writableOrganizationIds`, which is unrestricted for that role —
 * so without the column a failed delivery names a channel code and no tenant.
 * `organizationId` is NOT NULL on this DTO (migration `0048`), so unlike the
 * channels table there is no fleet-wide case to render here.
 *
 * The filter narrows client-side, matching the channel filter beside it:
 * `listDeliveriesQuerySchema` accepts `channelId` and `ruleId` and no
 * organization, and the ledger is a bounded recent list rather than a paged
 * one, so the whole set is already in hand.
 */
export function NotificationDeliveriesPage({ user }: NotificationDeliveriesPageProps) {
  const [channelFilter, setChannelFilter] = useState("");
  const [organizationFilter, setOrganizationFilter] = useState("");

  const deliveriesQ = useQuery({
    queryKey: ["notifications", "deliveries"],
    queryFn: () => fetchNotificationDeliveries(200),
  });

  const channelsQ = useQuery({
    queryKey: ["notifications", "channels"],
    queryFn: fetchNotificationChannels,
  });

  // `"all"` for the same reason the channels screen uses it: a delivery to a
  // deactivated organization is still a row that must name its tenant.
  const organizationsQ = useQuery({
    queryKey: ["admin", "organizations", "all"],
    queryFn: () => fetchAdminOrganizations("all"),
  });
  const organizations = useMemo(
    () => organizationsQ.data?.items ?? [],
    [organizationsQ.data?.items],
  );

  // Memoised the same way `organizations` is above: `?? []` allocates a fresh
  // array on every render while the query is unsettled, which would re-run the
  // `filterableOrganizations` memo below for no change.
  const deliveries = useMemo(
    () => deliveriesQ.data?.items ?? [],
    [deliveriesQ.data?.items],
  );

  // Only the organizations that actually appear in the ledger. Listing every
  // organization would offer filters that can only ever empty the table.
  const filterableOrganizations = useMemo(() => {
    const present = new Set(deliveries.map((item) => item.organizationId));
    return [...present]
      .map((id) => ({ id, name: organizationLabel(id, organizations) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [deliveries, organizations]);

  const items = deliveries.filter(
    (item) =>
      (channelFilter === "" || item.channelId === channelFilter) &&
      (organizationFilter === "" || item.organizationId === organizationFilter),
  );

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Notification Deliveries"
        subtitle="Every attempt, including the ones that sent nothing"
      />

      <SectionCard title="Recent attempts" bodyClassName="p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            <span className="mr-2 text-xs font-semibold uppercase text-bms-muted">Channel</span>
            <select
              className="rounded border px-3 py-1.5 text-sm"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
            >
              <option value="">All channels</option>
              {(channelsQ.data?.items ?? []).map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.code}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mr-2 text-xs font-semibold uppercase text-bms-muted">
              Organization
            </span>
            <select
              className="rounded border px-3 py-1.5 text-sm"
              value={organizationFilter}
              onChange={(event) => setOrganizationFilter(event.target.value)}
            >
              <option value="">All organizations</option>
              {filterableOrganizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          {deliveriesQ.isLoading ? (
            <span className="text-sm text-bms-muted">Loading deliveries…</span>
          ) : null}
        </div>

        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-bms-muted">
              <th className="px-2 py-2">When</th>
              <th className="px-2 py-2">Organization</th>
              <th className="px-2 py-2">Channel</th>
              <th className="px-2 py-2">Rule</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-gray-100">
                <td className="px-2 py-2 whitespace-nowrap">
                  {new Date(item.attemptedAt).toLocaleString()}
                </td>
                <td className="px-2 py-2">
                  {organizationLabel(item.organizationId, organizations)}
                </td>
                <td className="px-2 py-2 font-mono">{item.channelCode}</td>
                <td className="px-2 py-2">{item.ruleCode ?? "— (test)"}</td>
                <td className="px-2 py-2">
                  <StatusPill
                    label={deliveryStatusLabel(item.status)}
                    tone={deliveryStatusTone(item.status)}
                  />
                </td>
                <td className="px-2 py-2 max-w-[28rem] break-words">{item.error ?? "—"}</td>
              </tr>
            ))}
            {!deliveriesQ.isLoading && items.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-bms-muted" colSpan={6}>
                  No delivery attempts recorded yet. A rule marked notify writes a row here every
                  time it fires — including when it sends nothing.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </SectionCard>
    </MasterDataLayout>
  );
}
