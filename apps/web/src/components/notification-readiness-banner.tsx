import { useQuery } from "@tanstack/react-query";

import { fetchNotificationReadiness } from "../api/notifications";

/**
 * `F3.8` — "a rule marked notify has nowhere to send" made visible where rules
 * are edited (ADR 0041 decisions 5 and 10).
 *
 * **On the rules surface, not only inside the notifications screen.** The
 * person writing a `notify` rule is the person who needs to know no transport
 * is configured, and they may never open an admin screen. `GET
 * /notifications/readiness` is authenticated but not admin-only for exactly
 * this reason: it answers one boolean and one sentence per kind, with no host,
 * no port and no credential.
 *
 * Renders nothing when everything is configured, and nothing while the query is
 * loading or has failed — an absent banner must mean "nothing to say", never
 * "the check did not run", and a banner that flickers in on every page load
 * would train people to ignore it.
 */
export function NotificationReadinessBanner() {
  const readinessQ = useQuery({
    queryKey: ["notifications", "readiness"],
    queryFn: fetchNotificationReadiness,
    // Configuration, not telemetry: it changes when someone edits an
    // environment file, not second by second.
    staleTime: 60_000,
  });

  const unready = (readinessQ.data?.items ?? []).filter((item) => !item.configured);
  if (unready.length === 0) return null;

  return (
    <div
      role="status"
      className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <p className="font-semibold">Notifications are not fully configured</p>
      {unready.map((item) => (
        <p key={item.kind}>
          <span className="font-semibold uppercase">{item.kind}</span>: {item.detail}
        </p>
      ))}
      <p className="text-xs">
        A rule whose action is <span className="font-mono">notify</span> still raises its alarm.
        It just tells nobody until this is fixed.
      </p>
    </div>
  );
}
