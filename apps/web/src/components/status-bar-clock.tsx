import { useEffect, useState } from "react";

/** Footer clock for demo polish (local time, updates every minute). */
export function StatusBarClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="font-mono tabular-nums">
      {now.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}
    </span>
  );
}
