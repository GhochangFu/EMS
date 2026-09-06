import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { AutomationRuleAction } from "@bms/shared";

import {
  fetchNotificationChannels,
  fetchRuleNotifications,
  setRuleNotifications,
} from "../api/notifications";

/**
 * `F3.7` — which channels a rule notifies, on the rule's own card.
 *
 * `F3.8` shipped `GET`/`PUT /api/v1/rules/:id/notifications` and the two client
 * functions, and nothing called them: the only way to make a rule notify
 * anybody was a hand-made `PUT`. This component is their first caller. It adds
 * no route, no client function and no contract.
 *
 * **ADR 0041 decision 11 — a rule notifies exactly the channels joined to it,
 * and there is no default recipient.** So the empty set is a real, saveable
 * state, and an empty channel list says why there is nothing to tick rather
 * than implying somebody is still being told.
 *
 * **A disabled channel stays selectable.** `NotificationsService.loadForRule`
 * filters on `enabled`, so a join to a disabled channel is stored and sends
 * nothing. The label says `(disabled)`; the box is not greyed out, because the
 * channel is re-enabled on the admin screen and the join should survive that.
 *
 * **A joined channel this operator cannot see is carried through the save**
 * (review finding, High; owner ruling 2026-09-06). `GET
 * /rules/:id/notifications` applies no organization filter and
 * `ChannelsService.list` does — `inArray(organizationId, writableOrgIds)`
 * never matches a fleet-managed global's `NULL` — so the join list can name a
 * channel that is not in this list. `PUT` replaces the whole set, so sending
 * only the visible ticks would delete that join silently. The hidden ids ride
 * along in the payload and their count is stated on screen; the server keeps
 * them too (belt and braces, and the server's copy is the one that binds a
 * hand-made request).
 *
 * **The caption follows the rule's action, not the join** (`F3.7` review,
 * Medium). `shouldNotify` is `notify`-only, so a `trace_only` or `review` rule
 * sends nothing however many channels are ticked, and saying "this rule
 * notifies exactly these channels" under one of those was simply false.
 *
 * Mounted by `RuleCard` **only while the picker is open**. 289 rules are live
 * on this database and each mounted editor issues one
 * `GET /rules/:id/notifications`.
 */
export function RuleChannelsEditor({
  ruleId,
  action,
}: {
  ruleId: string;
  action: AutomationRuleAction;
}) {
  const queryClient = useQueryClient();
  /**
   * `null` until the operator touches a box: the boxes then read from the
   * server's set. There is deliberately no effect syncing this from the query —
   * a background refetch would silently undo ticks the operator had made but
   * not yet saved, and a refused save must leave them exactly as they were.
   */
  const [selected, setSelected] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The same key the channels admin screen uses, so a channel created there is
  // in this list without a reload.
  const channelsQ = useQuery({
    queryKey: ["notifications", "channels"],
    queryFn: () => fetchNotificationChannels(),
  });
  const joinedQ = useQuery({
    queryKey: ["rules", ruleId, "notifications"],
    queryFn: () => fetchRuleNotifications(ruleId),
  });

  const saveM = useMutation({
    mutationFn: (channelIds: string[]) => setRuleNotifications({ ruleId, channelIds }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["rules", ruleId, "notifications"] });
      // Hand the boxes back to the server once its answer is in the cache —
      // `invalidateQueries` resolves after the active refetch. A save that
      // stored something other than what was ticked (a channel out of scope,
      // say) must read back as what is stored, not as what was asked for.
      // Deliberately not done on failure: a refusal keeps the operator's work.
      setSelected(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const channels = channelsQ.data?.items ?? [];
  const checked = new Set(selected ?? joinedQ.data?.channelIds ?? []);
  // Channel-list order, not click order: `PUT` replaces the whole set, and the
  // set an operator sees on screen is the one the request should carry.
  const channelIds = channels.filter((channel) => checked.has(channel.id)).map((c) => c.id);

  /**
   * Joined ids with no box to tick — read from the SERVER's set, never from
   * `checked`. `selected` is rebuilt from `channels` on every toggle, so
   * anything derived from it loses these ids at the first click, which is
   * exactly the moment they must survive.
   */
  const visibleIds = new Set(channels.map((channel) => channel.id));
  const hidden = (joinedQ.data?.channelIds ?? []).filter((id) => !visibleIds.has(id));

  function toggle(channelId: string): void {
    const next = new Set(checked);
    if (next.has(channelId)) {
      next.delete(channelId);
    } else {
      next.add(channelId);
    }
    setSelected(channels.filter((channel) => next.has(channel.id)).map((c) => c.id));
  }

  // A save on top of a join query that never answered would write the empty set
  // over whatever is stored. It waits, or says it cannot.
  const cannotSave = saveM.isPending || joinedQ.isPending || joinedQ.isError;

  const caption =
    action.type === "notify"
      ? "This rule notifies exactly these channels."
      : `This rule's action is ${action.type}, so joined channels receive nothing until it is notify.`;

  return (
    <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
        Notification channels
      </h4>

      {channelsQ.isPending ? (
        <p className="mt-2 text-xs text-bms-muted">Loading channels...</p>
      ) : null}

      {/*
        A failed list is not an empty list. `[]` is also what the query holds
        while it loads, so the "no channels" sentence below is reachable from a
        settled success only.
      */}
      {channelsQ.isError ? (
        <p className="mt-2 text-xs text-red-700">Could not load notification channels.</p>
      ) : null}

      {joinedQ.isError ? (
        <p className="mt-2 text-xs text-red-700">
          Could not load this rule&apos;s channels, so saving is disabled.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      {channelsQ.isSuccess && channels.length === 0 ? (
        <p className="mt-2 text-xs text-bms-muted">
          No channels you can manage. Create one under Admin → Notification channels.
        </p>
      ) : null}

      {channels.length > 0 ? (
        <>
          <div className="mt-2 space-y-1">
            {channels.map((channel) => {
              const inputId = `rule-${ruleId}-channel-${channel.id}`;
              return (
                <label
                  key={channel.id}
                  htmlFor={inputId}
                  className="flex items-center gap-2 text-xs text-bms-ink"
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked.has(channel.id)}
                    onChange={() => toggle(channel.id)}
                  />
                  {channel.enabled ? channel.name : `${channel.name} (disabled)`}
                </label>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded bg-bms-green px-2 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              disabled={cannotSave}
              onClick={() => saveM.mutate([...channelIds, ...hidden])}
            >
              {saveM.isPending ? "Saving..." : "Save"}
            </button>
            <span className="text-[11px] text-bms-muted">{caption}</span>
          </div>
          {/*
            Inside this block on purpose: `channels` is also `[]` while the
            list loads and after it fails, and out here every joined id would
            count as hidden and the count would be a lie in both states.
          */}
          {hidden.length > 0 ? (
            <p className="mt-1 text-[11px] text-bms-muted">
              {hidden.length === 1
                ? "1 joined channel outside your scope stays joined."
                : `${hidden.length} joined channels outside your scope stay joined.`}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
