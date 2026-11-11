import type { UnattributedDrop } from "@bms/shared";

import { DROP_REASON_LABELS } from "../../lib/device-health-format";
import { SectionCard } from "../section-card";

/**
 * `F3.16` / ADR 0127 decision 17 — drops the ingest host could not attribute
 * to an RTU (`unknownDevice`, `ambiguousDevice`), per host and endpoint, over
 * 24 h. The page renders this for the global admin only: a device key can
 * belong to any customer. Keys are device-supplied and render as text.
 */
export function UnregisteredDevicesSection({ items }: { items: readonly UnattributedDrop[] }) {
  return (
    <SectionCard title="Unregistered devices (24 h)" bodyClassName="p-3">
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">No readings from unregistered devices in the last 24 h.</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-ink-muted">
              <th className="px-2 py-2">Endpoint</th>
              <th className="px-2 py-2">Reason</th>
              <th className="px-2 py-2">Count</th>
              <th className="px-2 py-2">First device key</th>
              <th className="px-2 py-2">First source key</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.hostKey}|${item.endpointKey}|${item.reason}`} className="border-b border-well-deep">
                <td className="px-2 py-2 font-mono" title={`Ingest host ${item.hostKey}`}>
                  {item.endpointKey}
                </td>
                <td className="px-2 py-2">{DROP_REASON_LABELS[item.reason]}</td>
                <td className="px-2 py-2 font-mono">{item.count}</td>
                <td className="px-2 py-2 font-mono">{item.firstDeviceKey ?? "—"}</td>
                <td className="px-2 py-2 font-mono">{item.firstSourceKey ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}
