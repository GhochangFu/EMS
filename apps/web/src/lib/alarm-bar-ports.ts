import { ackAlarm, fetchAlarmSummary, fetchUnacknowledgedAlarms } from "../api/alarms";
import { ALARM_BAR_LIST_LIMIT, ALARM_POPUP_MIN_RANK } from "./alarm-bar";
import type { AlarmBarPorts } from "./alarm-bar-feed";
import { openLiveSocket } from "./live-socket";
import { socketBaseUrl } from "./socket-url";

/**
 * `F4.357` U4 — the alarm bar feed's browser ports: one `/ws/alarms` socket
 * through `openLiveSocket` (so a rate-limited handshake recovers on its own,
 * `F4.17`), and the two scoped reads through `api/alarms.ts` (which keep
 * `checkResponse`). Plan Q3 ruling: the feed calls these functions rather than
 * a TanStack Query hook, because the list, "seen", the mute and the tone
 * cadence must outlive `AppShell`.
 */
export function browserAlarmBarPorts(): AlarmBarPorts {
  return {
    openSocket(token, on) {
      const socket = openLiveSocket(`${socketBaseUrl()}/ws/alarms`, { transports: ["websocket"], auth: { token } });
      socket.on("alarm", () => on.event());
      socket.on("connect", () => on.connect());
      // Our own close (a token renewal, a sign-out) is not a lost socket; a refused handshake is.
      socket.on("disconnect", (reason: string) => {
        if (reason !== "io client disconnect") on.disconnect();
      });
      socket.on("connect_error", () => on.disconnect());
      return { close: () => void socket.disconnect() };
    },
    fetchList: (scope) => fetchUnacknowledgedAlarms(scope, { minRank: ALARM_POPUP_MIN_RANK, limit: ALARM_BAR_LIST_LIMIT }),
    fetchSummary: (scope) => fetchAlarmSummary(scope),
    acknowledge: (id, reason) => ackAlarm(id, reason),
  };
}
