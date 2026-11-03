import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { ViewExportError } from "../../api/view-exports";
import { ExportMenu, EXPORT_FAILED_SENTENCE, EXPORT_REFUSED_SENTENCE } from "./export-menu";

/**
 * `F4.303` U7 (ADR 0108 Amendment 6 item 3) — `ExportMenu`: a labelled "Export" group of a CSV
 * and an XLSX button, `aria-busy` while the download runs, and a fixed sentence picked by status
 * on a failure — never the error's message (`F4.204`). Entry point: `export-menu.test.tsx`.
 */

/** M1: the two buttons sit in a group labelled "Export". */
export function theGroupHoldsCsvAndXlsx(): void {
  render(<ExportMenu onExport={() => Promise.resolve()} />);
  const group = screen.getByRole("group", { name: "Export" });
  expect(within(group).getByRole("button", { name: "CSV" })).toBeInTheDocument();
  expect(within(group).getByRole("button", { name: "XLSX" })).toBeInTheDocument();
}

/** M1: each button asks for its own format. */
export async function eachButtonAsksForItsFormat(): Promise<void> {
  const onExport = vi.fn(() => Promise.resolve());
  render(<ExportMenu onExport={onExport} />);
  await userEvent.click(screen.getByRole("button", { name: "XLSX" }));
  await waitFor(() => expect(onExport).toHaveBeenCalledWith("xlsx"));
  await userEvent.click(screen.getByRole("button", { name: "CSV" }));
  await waitFor(() => expect(onExport).toHaveBeenLastCalledWith("csv"));
}

/** M2: both buttons are `aria-busy` while the promise is pending, and the flag clears after. */
export async function theButtonsAreBusyWhilePending(): Promise<void> {
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  render(<ExportMenu onExport={() => pending} />);
  expect(screen.getByRole("button", { name: "CSV" })).not.toHaveAttribute("aria-busy", "true");

  await userEvent.click(screen.getByRole("button", { name: "CSV" }));
  expect(screen.getByRole("button", { name: "CSV" })).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "XLSX" })).toHaveAttribute("aria-busy", "true");

  release();
  await waitFor(() => expect(screen.getByRole("button", { name: "CSV" })).not.toHaveAttribute("aria-busy", "true"));
}

/** M2: a click while a download runs does not start a second one. */
export async function aSecondClickWhilePendingStartsNothing(): Promise<void> {
  const onExport = vi.fn(() => new Promise<void>(() => undefined));
  render(<ExportMenu onExport={onExport} />);
  await userEvent.click(screen.getByRole("button", { name: "CSV" }));
  await userEvent.click(screen.getByRole("button", { name: "XLSX" }));
  expect(onExport).toHaveBeenCalledTimes(1);
}

/**
 * M3: a `ViewExportError(400)` is the refusal sentence. A 400 is a query refusal (`from` after
 * `to`, a span over 365 days, a bad point list) or the row cap, so the sentence names neither
 * alone — no PR 1 route reaches the cap with today's bounds.
 */
export async function aFourHundredIsTheRefusalSentence(): Promise<void> {
  render(<ExportMenu onExport={() => Promise.reject(new ViewExportError(400))} />);
  await userEvent.click(screen.getByRole("button", { name: "CSV" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /^The export was refused\. Check the range and the points\.$/,
  );
  expect(EXPORT_REFUSED_SENTENCE).toBe("The export was refused. Check the range and the points.");
}

/** M3: any other status is "Export failed.". */
export async function anyOtherStatusIsExportFailed(): Promise<void> {
  render(<ExportMenu onExport={() => Promise.reject(new ViewExportError(403))} />);
  await userEvent.click(screen.getByRole("button", { name: "XLSX" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/^Export failed\.$/);
  expect(EXPORT_FAILED_SENTENCE).toBe("Export failed.");
}

/** M3: a plain error with a secret message renders "Export failed." and never the message. */
export async function theErrorMessageIsNeverRendered(): Promise<void> {
  render(<ExportMenu onExport={() => Promise.reject(new Error("SECRET"))} />);
  await userEvent.click(screen.getByRole("button", { name: "CSV" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Export failed.");
  expect(screen.queryByText(/SECRET/)).toBeNull();
}

/** M3: a new attempt clears the previous sentence. */
export async function aNewAttemptClearsTheSentence(): Promise<void> {
  const onExport = vi
    .fn<(format: "csv" | "xlsx") => Promise<void>>()
    .mockRejectedValueOnce(new ViewExportError(500))
    .mockResolvedValueOnce(undefined);
  render(<ExportMenu onExport={onExport} />);
  await userEvent.click(screen.getByRole("button", { name: "CSV" }));
  await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "CSV" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
}
