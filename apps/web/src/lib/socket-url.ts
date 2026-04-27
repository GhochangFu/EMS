/** Base URL for Socket.IO (matches telemetry / alarms clients). */
export function socketBaseUrl(): string {
  return (
    import.meta.env.VITE_WS_URL ??
    import.meta.env.VITE_API_URL ??
    "http://localhost:4000"
  );
}
