import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchNotificationChannels, fetchNotificationDeliveries } from "../../api/notifications";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { StatusPill } from "../../components/status-pill";
import {
  deliveryStatusLabel,
  deliveryStatusTone,
} from "../../lib/notification-channels";
import type { AuthUser } from "../../stores/auth-store";

type NotificationDeliveriesPageProps = { user: AuthUser };

/**
 * `F3.8` — the delivery ledger (ADR 0041 decisions 4 and 10).
 *
 * **Every attempt, including every skip, and no default filter.** Decision 10
 * is explicit that `skipped_unconfigured` and `skipped_rate_limited` are the
 * two states an operator most needs to see and the two a "sent items" list
 * would hide. A filter exists, it starts at "all", and the empty state says
 * what an empty ledger means rather than looking like a loading failure.
 */
export function NotificationDeliveriesPage({ user }: NotificationDeliveriesPageProps) {
  const [channelFilter, setChannelFilter] = useState("");

  const deliveriesQ = useQuery({
    queryKey: ["notifications", "deliveries"],
    queryFn: () => fetchNotificationDeliveries(200),
  });

  const channelsQ = useQuery({
    queryKey: ["notifications", "channels"],
    queryFn: fetchNotificationChannels,
  });

  const items = (deliveriesQ.data?.items ?? []).filter(
    (item) => channelFilter === "" || item.channelId === channelFilter,
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
          {deliveriesQ.isLoading ? (
            <span className="text-sm text-bms-muted">Loading deliveries…</span>
          ) : null}
        </div>

        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-bms-muted">
              <th className="px-2 py-2">When</th>
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
                <td className="px-2 py-3 text-bms-muted" colSpan={5}>
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
