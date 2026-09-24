import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

import type { AlarmSocketEvent } from "@bms/shared";

import { useAuthStore } from "../stores/auth-store";

function socketBase(): string {
  return (
    import.meta.env.VITE_WS_URL ??
    import.meta.env.VITE_API_URL ??
    "http://localhost:4000"
  );
}

/**
 * One `/ws/alarms` subscription for the life of the calling component
 * (`F3.28`; lifted from `alarms-page.tsx` so `/alarms` and the `/cr-overview`
 * rail share one transport shape).
 *
 * The callback is held in a ref, so a caller may pass a fresh closure on every
 * render without tearing the socket down and dialling it again. Only a new
 * access token reconnects — the handshake authenticates with it.
 */
export function useAlarmsSocket(onAlarm: (event: AlarmSocketEvent) => void): void {
  const accessToken = useAuthStore((state) => state.accessToken);
  const onAlarmRef = useRef(onAlarm);
  onAlarmRef.current = onAlarm;

  useEffect(() => {
    const socket: Socket = io(`${socketBase()}/ws/alarms`, {
      transports: ["websocket"],
      auth: { token: accessToken },
    });
    socket.on("alarm", (event: AlarmSocketEvent) => {
      onAlarmRef.current(event);
    });
    return () => {
      socket.disconnect();
    };
  }, [accessToken]);
}
