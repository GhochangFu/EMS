import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import type { SiteWidgetTab } from "@bms/shared";

import { TabStatusMarker } from "./tab-status-marker";

/**
 * `F3.77` (plan D4, ADR 0087 Amendment 3 ruling 5) — the status marker a group tab carries in the
 * site view, the viewer and the builder: a dot in the tone plus text, never colour alone. A tab the
 * caller cannot read says "Outside scope", never a zero. `tab-status-marker.test.tsx` is the Vitest
 * entry point.
 */

type Status = NonNullable<SiteWidgetTab["status"]>;

function status(activeAlarms: number): Status {
  return { worstSeverity: "warning", tone: "warning", activeAlarms, offlineAssets: 0, assets: 4 };
}

/** Two alarms read "2 alarms". */
export function twoAlarmsReadTwoAlarms(): void {
  render(<TabStatusMarker status={status(2)} />);
  expect(screen.getByText("2 alarms")).toBeInTheDocument();
}

/** One alarm reads "1 alarm", singular. Mutation: always print the plural => red. */
export function oneAlarmReadsOneAlarm(): void {
  render(<TabStatusMarker status={status(1)} />);
  expect(screen.getByText("1 alarm")).toBeInTheDocument();
}

/**
 * A null status (members exist, none readable) reads "Outside scope" and no count; the readable
 * marker drawn beside it is the positive control for the count. Mutation: print `0 alarms` for a
 * null status => red.
 */
export function anUnreadableTabReadsOutsideScopeNeverAZero(): void {
  render(
    <>
      <p data-testid="readable">
        <TabStatusMarker status={status(2)} />
      </p>
      <p data-testid="unreadable">
        <TabStatusMarker status={null} />
      </p>
    </>,
  );
  expect(screen.getByTestId("readable")).toHaveTextContent("2 alarms");
  expect(screen.getByTestId("unreadable")).toHaveTextContent("Outside scope");
  expect(screen.getByTestId("unreadable").textContent).not.toMatch(/\d/);
}

/** The dot is decoration: hidden from assistive technology (the text carries the meaning). */
export function theDotIsAriaHidden(): void {
  const { container } = render(<TabStatusMarker status={status(2)} />);
  const dot = container.querySelector("[data-tab-marker-dot]");
  expect(dot).not.toBeNull();
  expect(dot).toHaveAttribute("aria-hidden", "true");
}
