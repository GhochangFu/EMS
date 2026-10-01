import { useEffect, useState } from "react";

type StatusBarClockProps = {
  /**
   * `F3.77` (plan D8) — `"minute"` (the default) is the footer clock; `"second"` is the wall
   * frame's top bar, which ticks every second and shows the seconds. One clock component, two
   * cadences.
   */
  precision?: "minute" | "second";
};

/** Footer clock for demo polish (local time, updates every minute — or every second on the wall). */
export function StatusBarClock({ precision = "minute" }: StatusBarClockProps = {}) {
  const [now, setNow] = useState(() => new Date());
  const seconds = precision === "second";

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), seconds ? 1_000 : 60_000);
    return () => window.clearInterval(id);
  }, [seconds]);

  return (
    <span className="font-mono tabular-nums">
      {now.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: seconds ? "medium" : "short",
      })}
    </span>
  );
}
