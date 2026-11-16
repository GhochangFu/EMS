import type { PointForecast } from "@bms/shared";

import { modelLabel } from "../lib/forecast-series";
import { StatusPill } from "./status-pill";

const dayKey = (ms: number, zone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

/**
 * The issue time in `zone`: `14:05`, or `15 Nov 14:05` when it is not the same calendar day as
 * `asOf` there (the server's "today", never the browser's). `—` for an unreadable time: in
 * production `checkResponse` passes a drifted payload through, and `Intl` throws on `NaN`, which
 * would take the whole history page down for an advisory caption.
 */
export function forecastIssuedLabel(issuedAt: string, asOf: string, zone: string): string {
  const issued = Date.parse(issuedAt);
  const now = Date.parse(asOf);
  if (!Number.isFinite(issued) || !Number.isFinite(now)) {
    return "—";
  }
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    issued,
  );
  if (dayKey(issued, zone) === dayKey(now, zone)) {
    return time;
  }
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" }).format(issued);
  return `${day} ${time}`;
}

type ForecastCaptionProps = {
  forecast: PointForecast;
  /** The forecast read's server instant (ISO). */
  asOf: string;
  /** The site zone the page formats every time in. */
  zone: string;
  /** Named when more than one charted point has a forecast, so each line says whose it is. */
  pointKey?: string | null;
};

/**
 * `E1.4a` / ADR 0135 Amendment 3 ruling 4 and R-g — "Forecast issued 14:05 · Chronos-2 ·
 * advisory", the time in the site zone, and a Stale pill when the run scored more than 3 h ago
 * (`stale` is the server's). Every surface that draws a forecast says "advisory".
 */
export function ForecastCaption({ forecast, asOf, zone, pointKey = null }: ForecastCaptionProps) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted" data-testid="forecast-caption">
      <span>
        {pointKey === null ? "" : `${pointKey} · `}Forecast issued {forecastIssuedLabel(forecast.issuedAt, asOf, zone)} ·{" "}
        {modelLabel(forecast.modelName)} · advisory
      </span>
      {forecast.stale ? <StatusPill label="Stale" tone="warning" /> : null}
    </p>
  );
}
