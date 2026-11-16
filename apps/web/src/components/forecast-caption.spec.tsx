import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import type { PointForecast } from "@bms/shared";

import { ForecastCaption, forecastIssuedLabel } from "./forecast-caption";

/**
 * `E1.4a` — the forecast caption. The wrapper pins `TZ=America/St_Johns`, a zone no fixture
 * uses, so a time formatted in the browser's zone instead of the site's fails. Entry point:
 * `forecast-caption.test.tsx` (ADR 0014).
 */
const FORECAST: PointForecast = {
  issuedAt: "2026-11-16T08:35:00.000Z",
  modelName: "amazon/chronos-2",
  modelVersion: "0".repeat(40),
  stale: false,
  buckets: [],
};
const AS_OF = "2026-11-16T09:10:00.000Z";

/** The issue time in the site zone, the model's label and "advisory"; no pill when fresh. */
export function theCaptionNamesTheIssueTimeInTheSiteZoneTheModelAndAdvisory(): void {
  render(<ForecastCaption forecast={FORECAST} asOf={AS_OF} zone="Asia/Kolkata" />);
  // 08:35Z is 14:05 in Kolkata (and 05:05 in St John's, the browser's zone here).
  expect(screen.getByTestId("forecast-caption").textContent).toBe("Forecast issued 14:05 · Chronos-2 · advisory");
  expect(screen.queryByText("Stale")).toBeNull();
}

/** A stale forecast shows the Stale pill; with several forecasts the line names its point. */
export function aStaleForecastShowsThePill(): void {
  render(<ForecastCaption forecast={{ ...FORECAST, stale: true }} asOf={AS_OF} zone="Asia/Kolkata" pointKey="kw" />);
  const caption = screen.getByTestId("forecast-caption");
  expect(caption.textContent).toBe("kw · Forecast issued 14:05 · Chronos-2 · advisoryStale");
  expect(screen.getByText("Stale")).toBeInTheDocument();
}

/** The date joins the time when the issue day differs from `asOf`'s day in the site zone. */
export function anotherDayCarriesTheDate(): void {
  // 18:40Z is 00:10 on the 16th in Kolkata; issued 17:00Z on the 15th is 22:30 on the 15th there.
  expect(forecastIssuedLabel("2026-11-15T17:00:00.000Z", "2026-11-15T18:40:00.000Z", "Asia/Kolkata")).toBe("15 Nov 22:30");
  // The same two instants are the same day in UTC.
  expect(forecastIssuedLabel("2026-11-15T17:00:00.000Z", "2026-11-15T18:40:00.000Z", "UTC")).toBe("17:00");
}

/** An unreadable time (a drifted payload, passed through in production) is a dash, never a throw. */
export function anUnreadableTimeIsADash(): void {
  expect(forecastIssuedLabel("not a time", AS_OF, "Asia/Kolkata")).toBe("—");
  expect(forecastIssuedLabel(FORECAST.issuedAt, "", "Asia/Kolkata")).toBe("—");
}
