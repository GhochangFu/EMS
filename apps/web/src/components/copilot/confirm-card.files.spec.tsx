import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { CopilotPendingChangeDto } from "@bms/shared";

import { forgetFiles, rememberFiles, sha256Hex } from "../../lib/copilot-file-memory";
import { answered, chips, choose, openPanel, READY_WITH_FILES, renderDock, send, stub } from "./copilot-dock.spec";
import { FILE_HASH_MISMATCH_SENTENCE, FILE_HASH_UNCHECKED_SENTENCE, FileAgainSlot } from "./file-again-slot";

/**
 * `F4.283` (ADR 0099 Amendment 8 Q18, Q19; owner rulings 2026-10-24, drafter
 * choices 4, 5 and 10) — a file-upload card in the dock: Confirm waits for the
 * file this tab kept or the same file picked again, and the import card shows
 * the route's preview counts and the mappings the commit would create. The
 * digest is injected: jsdom may lack `crypto.subtle`. One claim per `it()`.
 * Vitest entry point: the sibling `.test.tsx` (jsdom).
 */

/** A digest that answers the bytes' length in its first byte. */
const fakeDigest = async (bytes: ArrayBuffer): Promise<ArrayBuffer> => {
  const out = new Uint8Array(32);
  out[0] = bytes.byteLength;
  return out.buffer;
};

const CSV_TEXT = "asset_code,point_key,value,time\n";
const CSV_SHA = `${CSV_TEXT.length.toString(16).padStart(2, "0")}${"00".repeat(31)}`;

export const IMPORT_CARD: CopilotPendingChangeDto = {
  id: "55555555-5555-4555-8555-555555555555",
  catalogId: "telemetry.import",
  method: "POST",
  path: "/api/v1/admin/telemetry/import/commit",
  body: {
    sourceKind: "manual",
    conflictPolicy: "reject",
    filename: "readings.csv",
    fileSha256: CSV_SHA,
    preview: {
      totalRows: 14,
      acceptedCount: 12,
      rejectedCount: 2,
      rejected: [{ rowNumber: 5, field: "value", reason: "must be a number" }],
      mappingsToCreate: [{ assetCode: "PUMP-1", pointKey: "kw" }],
    },
  },
  summary: 'Import the readings in "readings.csv" into PHE Water (conflicting readings are rejected).',
  risk: "create",
  proposedAt: "2026-10-24T10:00:00.000Z",
  expiresAt: "2026-10-24T10:15:00.000Z",
  ifMatch: null,
};

async function importCard(): Promise<HTMLElement> {
  const stubs = stub();
  stubs.turn.mockResolvedValueOnce(answered("import this", "Confirm the card.", null, [IMPORT_CARD]));
  renderDock("admin");
  await openPanel();
  await send("import this");
  return screen.findByRole("region", { name: "Import telemetry readings from a file" });
}

/** No kept file (a reload): the card asks for the file again and Confirm is disabled. */
export async function withoutAKeptFileConfirmIsDisabled(): Promise<void> {
  forgetFiles();
  const card = await importCard();
  expect([
    within(card).getByLabelText("Attach readings.csv again") instanceof HTMLInputElement,
    (within(card).getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled,
  ]).toEqual([true, true]);
}

/** The file this tab kept with the turn: Confirm is enabled. */
export async function aKeptFileEnablesConfirm(): Promise<void> {
  forgetFiles();
  const file = new File([CSV_TEXT], "readings.csv", { type: "text/csv" });
  await rememberFiles([file], fakeDigest);
  expect(await sha256Hex(file, fakeDigest)).toBe(CSV_SHA);
  const card = await importCard();
  await waitFor(() => expect((within(card).getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(false));
}

/**
 * The real path: a file attached and sent with the turn enables Confirm on the card the turn
 * returns, with nothing kept beforehand. Mutation: keep the file without waiting for its hash
 * before the card reaches the cache (the slot reads a plain map) → red.
 */
export async function aFileSentWithTheTurnEnablesConfirm(): Promise<void> {
  forgetFiles();
  // A hash that lands a little later, as a 5 MiB file's does.
  const slowDigest = async (_name: string, bytes: ArrayBuffer): Promise<ArrayBuffer> => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return fakeDigest(bytes);
  };
  vi.stubGlobal("crypto", { subtle: { digest: slowDigest } });
  const stubs = stub(READY_WITH_FILES);
  stubs.turn.mockResolvedValueOnce(answered("import this", "Confirm the card.", null, [IMPORT_CARD]));
  renderDock("organization_admin");
  await openPanel();
  await screen.findByLabelText(/AI provider as it is, unscrubbed/);
  choose(new File([CSV_TEXT], "readings.csv", { type: "text/csv" }));
  await waitFor(() => expect(chips()).toEqual(["readings.csv"]));
  await send("import this");
  const card = await screen.findByRole("region", { name: "Import telemetry readings from a file" });
  expect((within(card).getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(false);
}

/** The import card shows the route's counts. */
export async function theImportCardShowsTheCounts(): Promise<void> {
  forgetFiles();
  const card = await importCard();
  expect(within(card).getByText("12 of 14 rows accepted, 2 rejected.")).toBeTruthy();
}

/**
 * Owner ruling 2026-10-25 (Q4): the sentence that commit can still reject rows the preview
 * accepted sits where the card shows the counts — the counts' next line.
 */
export async function theImportCardSaysCommitCanStillRejectBesideTheCounts(): Promise<void> {
  forgetFiles();
  const card = await importCard();
  const counts = within(card).getByText("12 of 14 rows accepted, 2 rejected.");
  expect(counts.nextElementSibling?.textContent).toBe("Commit can still reject rows that the preview accepted.");
}

/** The import card names the mappings the commit would create. */
export async function theImportCardNamesTheMappings(): Promise<void> {
  forgetFiles();
  const card = await importCard();
  expect(within(within(card).getByRole("list", { name: "Point mappings to create" })).getByText("PUMP-1/kw")).toBeTruthy();
}

// ---- the slot alone ----------------------------------------------------------------------------

/** A picked file of other bytes shows the hash sentence and hands up no file. */
export async function aMismatchingPickShowsTheSentence(): Promise<void> {
  const onFile = vi.fn();
  render(<FileAgainSlot filename="readings.csv" sha256={CSV_SHA} onFile={onFile} digest={fakeDigest} />);
  fireEvent.change(screen.getByLabelText("Attach readings.csv again"), { target: { files: [new File(["other bytes"], "readings.csv")] } });
  expect([(await screen.findByRole("alert")).textContent, onFile.mock.calls.at(-1)]).toEqual([FILE_HASH_MISMATCH_SENTENCE, [null]]);
}

/** The same bytes picked again: the file is handed up. */
export async function aMatchingPickHandsUpTheFile(): Promise<void> {
  const onFile = vi.fn();
  const file = new File([CSV_TEXT], "readings.csv");
  render(<FileAgainSlot filename="readings.csv" sha256={CSV_SHA} onFile={onFile} digest={fakeDigest} />);
  fireEvent.change(screen.getByLabelText("Attach readings.csv again"), { target: { files: [file] } });
  await waitFor(() => expect(onFile).toHaveBeenLastCalledWith(file));
}

/** A pick this browser cannot hash is handed up, not reported as a mismatch. Mutation: treat a failed digest as a mismatch → red. */
export async function anUnhashablePickIsHandedUp(): Promise<void> {
  const onFile = vi.fn();
  const file = new File(["other bytes"], "readings.csv");
  const noDigest = async (): Promise<ArrayBuffer> => {
    throw new Error("crypto.subtle is not available");
  };
  render(<FileAgainSlot filename="readings.csv" sha256={CSV_SHA} onFile={onFile} digest={noDigest} />);
  fireEvent.change(screen.getByLabelText("Attach readings.csv again"), { target: { files: [file] } });
  await waitFor(() => expect(onFile).toHaveBeenLastCalledWith(file));
}

/** A pick this browser cannot hash shows the unchecked sentence, not the mismatch one. */
export async function anUnhashablePickSaysItIsUnchecked(): Promise<void> {
  const noDigest = async (): Promise<ArrayBuffer> => {
    throw new Error("crypto.subtle is not available");
  };
  render(<FileAgainSlot filename="readings.csv" sha256={CSV_SHA} onFile={vi.fn()} digest={noDigest} />);
  fireEvent.change(screen.getByLabelText("Attach readings.csv again"), { target: { files: [new File(["x"], "readings.csv")] } });
  expect([await screen.findByText(FILE_HASH_UNCHECKED_SENTENCE), screen.queryByRole("alert")].map((n) => n !== null)).toEqual([true, false]);
}
